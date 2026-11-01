import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';

export function bindKeybindingEditor(app, $html)
{
    const captureKey = (onDone) =>
    {
        const km = /** @type {any} */ (globalThis).KeyboardManager;
        const protectedKeys = new Set(km?.PROTECTED_KEYS ?? ['F5', 'F11', 'F12', 'PrintScreen', 'ScrollLock', 'NumLock', 'CapsLock', 'Pause', 'Break', 'Insert', 'Home', 'PageUp', 'PageDown', 'End', 'ContextMenu']);
        const handler = (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.key === 'Escape')
            {
                document.removeEventListener('keydown', handler, true);
                onDone(null);
                return;
            }
            if (['Alt', 'AltLeft', 'AltRight', 'Control', 'ControlLeft', 'ControlRight', 'Shift', 'ShiftLeft', 'ShiftRight', 'Meta', 'MetaLeft', 'MetaRight'].includes(ev.code))
                return;
            if (protectedKeys.has(ev.code))
            {
                ui.notifications.warn(localizeFormat('LA.notify.keyReservedByFoundry', { key: ev.code }));
                document.removeEventListener('keydown', handler, true);
                onDone(null);
                return;
            }
            const modifiers = [];
            if (ev.altKey)
                modifiers.push('Alt');
            if (ev.ctrlKey)
                modifiers.push('Control');
            if (ev.shiftKey)
                modifiers.push('Shift');
            if (ev.metaKey)
                modifiers.push('Meta');
            document.removeEventListener('keydown', handler, true);
            onDone({ key: ev.code, modifiers });
        };
        document.addEventListener('keydown', handler, true);
    };
    const splitFullKey = (fullKey) =>
    {
        const dot = fullKey.indexOf('.');
        return [fullKey.slice(0, dot), fullKey.slice(dot + 1)];
    };
    const writeBindings = async (fullKey, next) =>
    {
        const [ns, action] = splitFullKey(fullKey);
        await game.keybindings.set(ns, action, next);
        app.render(true);
    };

    const placeholderStyle = 'flex:0 0 auto; padding:2px 10px; height:24px; line-height:20px; border:1px solid var(--primary-color, #991e2a); background:rgba(153,30,42,0.08); color:var(--primary-color, #991e2a); border-radius:3px; font-family:inherit; font-size:0.78em; font-style:italic; margin:0; cursor:default;';

    $html.find('.la-kb-key').on('click', (/** @type {any} */ ev) =>
    {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const row = btn.closest('.la-keybinding-row');
        const fullKey = row?.dataset.fullKey;
        const idx = parseInt(btn.dataset.idx, 10);
        if (!fullKey || Number.isNaN(idx))
            return;
        const original = btn.outerHTML;
        const placeholder = document.createElement('span');
        placeholder.style.cssText = placeholderStyle;
        placeholder.textContent = localize('LA.settingsMenus.pressKey');
        btn.replaceWith(placeholder);
        captureKey(async (binding) =>
        {
            if (!binding)
            {
                placeholder.outerHTML = original;
                return;
            }
            const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
            current[idx] = binding;
            await writeBindings(fullKey, current);
        });
    });
    $html.find('.la-kb-key').on('contextmenu', async (/** @type {any} */ ev) =>
    {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const row = btn.closest('.la-keybinding-row');
        const fullKey = row?.dataset.fullKey;
        const idx = parseInt(btn.dataset.idx, 10);
        if (!fullKey || Number.isNaN(idx))
            return;
        const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
        current.splice(idx, 1);
        await writeBindings(fullKey, current);
    });
    $html.find('.la-kb-reset').on('click', async (/** @type {any} */ ev) =>
    {
        ev.preventDefault();
        const row = ev.currentTarget.closest('.la-keybinding-row');
        const fullKey = row?.dataset.fullKey;
        if (!fullKey)
            return;
        const action = /** @type {any} */ (game.keybindings).actions?.get(fullKey);
        const defaults = (action?.editable ?? []).map(/** @type {any} */ binding => ({ key: binding.key, modifiers: [...(binding.modifiers ?? [])] }));
        await writeBindings(fullKey, defaults);
    });
    $html.find('.la-kb-add').on('click', (/** @type {any} */ ev) =>
    {
        ev.preventDefault();
        const btn = ev.currentTarget;
        const row = btn.closest('.la-keybinding-row');
        const binds = row?.querySelector('.la-kb-binds');
        const fullKey = row?.dataset.fullKey;
        if (!fullKey || !binds)
            return;
        const placeholder = document.createElement('span');
        placeholder.style.cssText = placeholderStyle;
        placeholder.textContent = localize('LA.settingsMenus.pressKey');
        const resetBtn = binds.querySelector('.la-kb-reset');
        binds.insertBefore(placeholder, resetBtn);
        btn.style.display = 'none';
        captureKey(async (binding) =>
        {
            if (!binding)
            {
                placeholder.remove();
                btn.style.display = '';
                return;
            }
            const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
            current.push(binding);
            await writeBindings(fullKey, current);
        });
    });
}

export function bindConfigSearch(app, $html, applyAllSectionStates)
{
    const $search = $html.find('.la-config-search-input');
    const $clear = $html.find('.la-config-search-clear');
    const escapeRe = (/** @type {string} */ str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const stash =(/** @type {any} */ $el) =>
    {
        if ($el.data('la-orig') === undefined)
            $el.data('la-orig', $el.html());
    };
    const restore = (/** @type {any} */ $el) =>
    {
        const orig = $el.data('la-orig');
        if (orig !== undefined)
            $el.html(orig);
    };
    const MARK_OPEN = '<mark style="background:#f8d96b;color:#111;padding:0 1px;border-radius:2px;">';
    const MARK_CLOSE = '</mark>';
    const highlightIn = (/** @type {any} */ $el, /** @type {RegExp} */ re) =>
    {
        stash($el);
        const orig = $el.data('la-orig') ?? '';
        $el.html(orig);
        const root = $el[0];
        if (!root)
            return;
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        /** @type {Text[]} */
        const textNodes = [];
        let textNode;
        while ((textNode = walker.nextNode()))
            textNodes.push(/** @type {Text} */ (textNode));
        for (const node of textNodes)
        {
            const text = node.nodeValue ?? '';
            re.lastIndex = 0;
            if (!re.test(text))
                continue;
            re.lastIndex = 0;
            let replaced = '';
            let cursor = 0;
            for (const hit of text.matchAll(re))
            {
                replaced += escapeHtml(text.slice(cursor, hit.index)) + MARK_OPEN + escapeHtml(hit[0]) + MARK_CLOSE;
                cursor = hit.index + hit[0].length;
            }
            replaced += escapeHtml(text.slice(cursor));
            const span = document.createElement('span');
            span.innerHTML = replaced;
            node.parentNode?.replaceChild(span, node);
        }
    };
    const ROW_SELECTOR = '.la-opt-row, .la-compact-bool, .la-keybinding-row, .la-tour-row, .la-config-table';
    const rowText = (/** @type {any} */ $row) =>
    {
        const hints = $row.find('[data-tooltip]').toArray().map((/** @type {any} */ el) => el.dataset.tooltip ?? '').join(' ');
        const own = $row.attr('data-tooltip') ?? '';
        const names = $row.find('[name]').toArray().map((/** @type {any} */ el) => el.getAttribute('name') ?? '').join(' ');
        return `${$row.text()} ${hints} ${own} ${names}`.toLowerCase();
    };
    const $newFilter = $html.find('.la-new-filter');
    let newOnly = false;
    const applyFilter = (query) =>
    {
        const normalizedQuery = (query || '').trim().toLowerCase();
        const filtering = !!normalizedQuery || newOnly;
        $clear.toggleClass('visible', filtering);
        $newFilter.prop('hidden', !newOnly);
        app.element.find('form.la-config-form').toggleClass('la-searching', filtering);
        const re = normalizedQuery ? new RegExp(escapeRe(normalizedQuery), 'gi') : null;
        const titleHit = (/** @type {string} */ text) => String(text ?? '').toLowerCase().includes(normalizedQuery);
        $html.find('.tab').each((/** @type {number} */ _i, /** @type {any} */ tab) =>
        {
            const $tab = $(tab);
            const $rows = $tab.find(ROW_SELECTOR);
            const $titles = $tab.find('.la-card-title, .la-sub-title, .la-page-head h1');
            let tabHits = 0;
            if (!filtering)
            {
                $rows.css('display', '');
                $rows.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ el) => restore($(el)));
                $titles.each((/** @type {number} */ _k, /** @type {any} */ el) => restore($(el)));
                $tab.find('.la-card, .la-sub, .la-compact-bools').css('display', '');
            }
            else
            {
                const tabHit = !newOnly && titleHit($tab.find('.la-page-head h1').text());
                $titles.each((/** @type {number} */ _k, /** @type {any} */ el) =>
                {
                    if (!newOnly && titleHit($(el).text()))
                        highlightIn($(el), /** @type {RegExp} */ (re));
                    else
                        restore($(el));
                });
                $rows.each((/** @type {number} */ _j, /** @type {any} */ el) =>
                {
                    const $row = $(el);
                    const headHit = tabHit
                        || titleHit($row.closest('.la-card').children('.la-card-head').find('.la-card-title').text())
                        || titleHit($row.closest('.la-sub').children('.la-sub-head').find('.la-sub-title').text());
                    const match = newOnly ? $row.hasClass('la-new-row') : headHit || rowText($row).includes(normalizedQuery);
                    $row.css('display', match ? '' : 'none');
                    if (match)
                        tabHits++;
                    if (match && re)
                        $row.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ child) => highlightIn($(child), /** @type {RegExp} */ (re)));
                    else
                        $row.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ child) => restore($(child)));
                });
                const hasVisibleRow = (/** @type {any} */ $box) => $box.find(ROW_SELECTOR).toArray().some((/** @type {any} */ el) => el.style.display !== 'none');
                $tab.find('.la-compact-bools').each((/** @type {number} */ _k, /** @type {any} */ el) => $(el).css('display', hasVisibleRow($(el)) ? '' : 'none'));
                $tab.find('.la-sub').each((/** @type {number} */ _k, /** @type {any} */ el) => $(el).css('display', hasVisibleRow($(el)) ? '' : 'none'));
                $tab.find('.la-card').each((/** @type {number} */ _k, /** @type {any} */ el) =>
                {
                    const $card = $(el);
                    $card.css('display', hasVisibleRow($card) ? '' : 'none');
                    $card.removeClass('collapsed').children('.la-card-body').css('display', '');
                    $card.find('.la-sub').removeClass('collapsed').children('.la-sub-body').css('display', '');
                });
            }
            $tab.toggleClass('la-no-hits', filtering && tabHits === 0);
            const $navItem = $html.find(`.la-config-rail .item[data-tab="${$tab.data('tab')}"]`);
            const $badge = $navItem.find('.la-rail-badge');
            $badge.text(filtering ? tabHits : ($badge.attr('data-count') ?? ''));
            $badge.toggleClass('hit', filtering ? tabHits > 0 : !!$badge.attr('data-count'));
            $navItem.toggleClass('la-dim', filtering && tabHits === 0);
        });
        if (!filtering)
            applyAllSectionStates();
        if (filtering)
            $html.find('.tab').addClass('active').css('display', '');
        else
        {
            $html.find('.tab').removeClass('active');
            const activeId = $html.find('.tabs .item.active').data('tab')
                || $html.find('.tab').first().data('tab');
            $html.find(`.tab[data-tab="${activeId}"]`).addClass('active');
        }
    };
    $search.on('input', (/** @type {any} */ ev) =>
    {
        newOnly = false;
        applyFilter(ev.currentTarget.value);
    });
    $search.on('keydown', (/** @type {any} */ ev) =>
    {
        if (ev.key === 'Escape' && ($search.val() || newOnly))
        {
            ev.stopPropagation();
            newOnly = false;
            $search.val('');
            applyFilter('');
        }
    });
    $clear.on('click', () =>
    {
        newOnly = false;
        $search.val('');
        applyFilter('');
        $search.trigger('focus');
    });
    if (app._openNewFilter)
    {
        app._openNewFilter = false;
        newOnly = true;
        $search.val('');
        applyFilter('');
    }
    $html.on('keydown', (/** @type {any} */ ev) =>
    {
        if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f')
        {
            ev.preventDefault();
            $search.trigger('focus');
            $search.trigger('select');
        }
    });
}
