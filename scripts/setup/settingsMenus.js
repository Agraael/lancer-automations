/* global game, ui, canvas, FormApplication, foundry, jQuery, Dialog, $ */

import { TAB_DEFS, NAV_GROUPS } from './settings-fields.js';
import { _requiredKeys, _allKeyedFields, _fieldName, _fieldByKey, _parseRequirement, _isRequirementMet, _requirementHint, _syncRequirementLines, _fieldsWithRequirements } from './settings-requirements.js';
import { _extNamespaceActive, _visibleTabs, _groupSections, _dropEmptySections, _tabItems, _newCount } from './settings-rows.js';
import { bindKeybindingEditor, bindConfigSearch } from './settings-listeners.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
import { getFCSData, repairFCSForcedValues, setFCSForceBulk, toggleFCSForce } from './fcs.js';
import { isExecutorGM } from '../tools/misc-tools.js';
import { getFCCData, getFCCModeKey, toggleFCCForce } from './fcc.js';
import { isFreshWorld, runSettingsOnboarding } from './settings-onboarding.js';
import { afterFirstRun } from './first-run-queue.js';

import { MODULE_ID } from '../tools/constants.js';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/lancer-automations-config.html`;
const SETTING_SEEN_KEYS = 'seenSettingKeys';
const SETTING_NEW_KEYS = 'newSettingKeys';
const SETTING_SOFT_SEEDED = 'fcsSoftSeeded';

// A select hands back a string, and core's numeric settings are DataFields that reject one.
function _coerceExtValue(setting, raw)
{
    if (setting?.type === Boolean)
        return !!raw;
    const isNumeric = setting?.type === Number
        || setting?.type instanceof foundry.data.fields.NumberField;
    if (!isNumeric)
        return raw;
    if (raw === '' || raw === null || raw === undefined)
        return setting?.type?.nullable ? null : raw;
    return Number(raw);
}

/** @type {Record<string, string>} */
const _FCS_ICONS = {
    'hard-gm': 'fa-lock',
    'soft-gm': 'fa-unlock-keyhole',
    'open-gm': 'fa-lock-keyhole-open',
    'unlocked-gm': 'fa-dungeon',
    'hard-client': 'fa-lock',
    'soft-client': 'fa-unlock-keyhole',
    'unlocked-client': 'fa-lock-keyhole-open',
};

/** @param {any} html @param {any[]} fields @param {any} _app */
function _injectFCSLocks(html, fields, _app)
{
    const fcs = getFCSData();
    if (!fcs)
        return;
    const isGM = game.user?.isGM;
    const faIcons = _FCS_ICONS;
    const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
    // compactStatusFx skipped: values live in world-scoped statusFXConfig, so FCS per-key forcing doesn't apply.
    /** @type {any[]} */
    const expanded = [];
    for (const field of fields)
    {
        if (field.type === 'compactBooleans')
        {
            for (const it of (field.items ?? []))
                expanded.push({ key: it.key, type: 'boolean', _inCompactGrid: true });
        }
        else if (field.type === 'compactStatusFx')
            continue;
        else
            expanded.push(field);
    }
    for (const field of expanded)
    {
        if (!field.key || field.type === 'section' || field.type === 'button' || field.type === 'table')
            continue;
        const isExternal = ['moduleSelect', 'moduleBoolean', 'moduleSlider', 'moduleColor'].includes(field.type);
        const key = isExternal ? `${field.module}.${field.key}` : `${MODULE_ID}.${field.key}`;
        const setting = game.settings.settings.get(key);
        if (!setting || setting.scope === 'world')
            continue;
        const $input = $html.find(`[name="${isExternal ? `__ext.${field.module}.${field.key}` : field.key}"]`);
        if ($input.length === 0)
            continue;
        const $label = field._inCompactGrid
            ? $input.closest('label')
            : $input.closest('.form-group').find('label').first();
        if ($label.length === 0)
            continue;
        let mode = fcs.forced.get(key)?.mode ?? 'open';
        if ((mode === 'soft' || isGM) && fcs.unlocked.has(key))
            mode = 'unlocked';
        const modeKey = mode + (isGM ? '-gm' : '-client');
        if (modeKey === 'open-client')
            continue;
        const icon = faIcons[modeKey];
        if (!icon)
            continue;
        const lockIcon = document.createElement('span');
        lockIcon.innerHTML = '&nbsp;';
        lockIcon.title = localize(`FORCECLIENTSETTINGS.ui.${modeKey}-hint`);
        lockIcon.dataset.settingsKey = key;
        lockIcon.className = `fas ${icon} la-fcs-lock`;
        lockIcon.style.cursor = 'pointer';
        lockIcon.style.marginRight = '4px';
        $label.prepend(lockIcon);
        $label.find('.la-row-tag-you').remove();
        if (['hard-client', 'soft-client'].includes(modeKey))
            $input.prop('disabled', true);
    }
}

/** @param {any} $row @param {string} modeKey */
function _renderFCCRowLock($row, modeKey)
{
    $row.find('.la-fcc-lock').remove();
    const icon = _FCS_ICONS[modeKey];
    if (icon)
    {
        const lockIcon = document.createElement('span');
        lockIcon.innerHTML = '&nbsp;';
        lockIcon.title = localize(`FORCECLIENTCONTROLS.ui.${modeKey}-hint`);
        lockIcon.className = `fas ${icon} la-fcc-lock`;
        lockIcon.style.cursor = 'pointer';
        lockIcon.style.marginRight = '4px';
        $row.find('> div').first().children().first().prepend(lockIcon);
    }
    $row.find('.la-kb-add, .la-kb-key, .la-kb-reset').prop('disabled', ['hard-client', 'soft-client'].includes(modeKey));
}

// FCC only decorates Foundry's own controls config, so the Control tab grows its own locks.
/** @param {any} html */
function _injectControlLocks(html)
{
    const fcc = getFCCData();
    if (!fcc)
        return;
    const isGM = !!game.user?.isGM;
    const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
    $html.find('.la-keybinding-row').each(function ()
    {
        const $row = $(this);
        const action = $row.attr('data-full-key');
        if (!action)
            return;
        const modeKey = getFCCModeKey(action, fcc, isGM);
        if (modeKey !== 'open-client')
            _renderFCCRowLock($row, modeKey);
    });
}

/** @param {string} key */
async function _previewSettingSound(key)
{
    if (!key)
        return;
    const sound = await import('../tah/sound.js');
    const fx = await import('../fx/actionFX.js');
    if (key.startsWith('tah.uiSound.'))
        sound.playUiSound(/** @type {any} */ (key.slice('tah.uiSound.'.length)), { force: true });
    else if (key.startsWith('tah.tokenSound.'))
        sound.playUiSound(/** @type {any} */ (key.slice('tah.tokenSound.'.length)), { force: true });
    else if (key.startsWith('tah.damageSound.'))
        await sound.playDamageSound(key.slice('tah.damageSound.'.length), { force: true });
    else if (key.startsWith('tah.statSound.'))
        sound.playStatsSound(key.slice('tah.statSound.'.length), { force: true });
    else if (key.startsWith('tah.statusSfx.'))
        sound.playStatusSfxSound(key.slice('tah.statusSfx.'.length), { force: true });
    else if (key.startsWith('tah.actionFxSound.'))
        fx.previewActionFxSound(key.slice('tah.actionFxSound.'.length));
}

/** Snapshot form values into a Map so button callbacks see unsaved edits. */
function _readFormSettings(form)
{
    const map = new Map();
    if (!form)
        return map;
    const els = form.querySelectorAll('input[name], select[name], textarea[name]');
    for (const el of /** @type {any} */ (els))
    {
        const name = el.name;
        if (!name)
            continue;
        let value;
        if (el.type === 'checkbox')
            value = !!el.checked;
        else if (el.type === 'number' || el.type === 'range')
            value = el.value === '' ? null : Number(el.value);
        else
            value = el.value;
        map.set(name, value);
    }
    return map;
}

function _sameAsSnapshot(snapshot, key, value)
{
    if (!snapshot?.has(key))
        return false;
    const before = snapshot.get(key);
    if (typeof before === 'boolean')
        return before === !!value;
    if (typeof before === 'number' || before === null)
        return before === (value === '' || value == null ? null : Number(value));
    return String(before) === String(value ?? '');
}

/**
 * Temporarily wraps `game.settings.get` so keys present in `formMap` return the form's current value, coerced to the registered setting type.
 * @param {Map<string, any>} formMap
 * @returns {() => void} restore function
 */
function _patchSettingsGet(formMap)
{
    const original = game.settings.get.bind(game.settings);
    // defineProperty, not assignment: libWrapper's accessor setter would keep this as a permanent override.
    const patched = function(namespace, key, options)
    {
        // set() fetches the current document through this.get
        if (namespace === MODULE_ID && formMap.has(key) && !options?.document)
        {
            const cfg = /** @type {any} */ (game.settings.settings.get(`${namespace}.${key}`));
            const raw = formMap.get(key);
            try
            {
                if (cfg?.type === Boolean)
                    return Boolean(raw);
                if (cfg?.type === Number)
                    return raw === null ? cfg.default : Number(raw);
                if (cfg?.type === String)
                    return raw == null ? "" : String(raw);
            }
            catch
            { /* fall through */ }
            return raw;
        }
        return original(namespace, key, options);
    };
    Object.defineProperty(game.settings, 'get', { value: patched, configurable: true, writable: true, enumerable: false });
    return () =>
    {
        delete game.settings.get;
    };
}

/** @param {any} $header @param {boolean} collapsed @param {boolean} [animate] */
function _toggleSection($header, collapsed, animate = false)
{
    const $box = $header.closest('.la-card, .la-sub');
    const $body = $box.children('.la-card-body, .la-sub-body').first();
    $box.toggleClass('collapsed', collapsed);
    $header.attr('aria-expanded', collapsed ? 'false' : 'true');
    if (!animate)
    {
        $body.toggle(!collapsed);
        return;
    }
    $body.stop(true, false);
    if (collapsed)
        $body.slideUp(150);
    else
        $body.slideDown(150);
}

function _openNewSettings()
{
    const open = Object.values(ui.windows).find(app => app instanceof LancerAutomationsConfig);
    const app = open ?? new LancerAutomationsConfig();
    app._openNewFilter = true;
    app.render(true);
}

async function _seedSoftLocks()
{
    const fcs = getFCSData();
    if (!fcs || !isExecutorGM())
        return;
    await repairFCSForcedValues(fcs);
    const seeded = new Set(getModuleSetting(SETTING_SOFT_SEEDED) ?? []);
    const fresh = [...new Set(_allKeyedFields().map(field => field?.key).filter(Boolean))]
        .map(key => `${MODULE_ID}.${key}`)
        .filter(fullKey => !seeded.has(fullKey) && game.settings.settings.get(/** @type {any} */ (fullKey))?.scope === 'client');
    if (!fresh.length)
        return;
    if (isFreshWorld() || seeded.size)
        await setFCSForceBulk(fresh.filter(fullKey => !fcs.forced.has(fullKey)).map(fullKey => ({ fullKey, mode: 'soft' })), fcs);
    await game.settings.set(MODULE_ID, SETTING_SOFT_SEEDED, [...seeded, ...fresh]);
}

async function _noticeNewSettings()
{
    const keys = [...new Set(_allKeyedFields().map(field => field?.key).filter(Boolean))];
    const seen = getModuleSetting(SETTING_SEEN_KEYS) ?? [];
    if (!seen.length)
    {
        await game.settings.set(MODULE_ID, SETTING_SEEN_KEYS, keys);
        return;
    }
    const seenKeys = new Set(seen);
    const unseen = keys.filter(key => !seenKeys.has(key));
    if (!unseen.length)
        return;
    const merged = new Set(_allKeyedFields().filter(field => field?.mergedFrom?.some(key => seenKeys.has(key))).map(field => field.key));
    await game.settings.set(MODULE_ID, SETTING_SEEN_KEYS, [...seen, ...unseen]);
    const fresh = unseen.filter(key => !merged.has(key));
    if (!fresh.length)
        return;
    const newKeys = new Set([...(getModuleSetting(SETTING_NEW_KEYS) ?? []), ...fresh]);
    await game.settings.set(MODULE_ID, SETTING_NEW_KEYS, [...newKeys]);
    const count = _visibleTabs().reduce((sum, tab) => sum + _newCount(_tabItems(tab, newKeys)), 0);
    if (!count)
        return;
    await afterFirstRun();
    const marker = document.createElement('span');
    marker.className = 'la-new-settings-toast';
    marker.textContent = localizeFormat('LA.configUi.newSettingsToast', { count });
    ui.notifications.info(marker.outerHTML);
    const onClick = (/** @type {any} */ ev) =>
    {
        if (!ev.target?.closest?.('.notification')?.querySelector('.la-new-settings-toast'))
            return;
        document.removeEventListener('click', onClick, true);
        _openNewSettings();
    };
    document.addEventListener('click', onClick, true);
}

let _laConfigState = null;

export class LancerAutomationsConfig extends FormApplication
{
    constructor(...args)
    {
        super(...args);
        this._needsReload = false;
        this._openNewFilter = false;
        /** @type {Map<string, boolean>} label → collapsed; survives app.render() so toggles like FCS lock don't reset open sections. */
        this._sectionStates = new Map(_laConfigState?.sections ?? []);
        /** @type {IntersectionObserver|null} */
        this._stripObserver = null;
    }

    static get defaultOptions()
    {
        const saved = _laConfigState;
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'lancer-automations-config',
            title: localize('LA.config.windowTitle'),
            template: TEMPLATE_PATH,
            width: saved?.width ?? 860,
            height: saved?.height ?? 820,
            top: saved?.top ?? undefined,
            left: saved?.left ?? undefined,
            resizable: true,
            closeOnSubmit: false,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: saved?.tab ?? 'activations' }],
        });
    }

    getData()
    {
        const newKeys = new Set(getModuleSetting(SETTING_NEW_KEYS) ?? []);
        const visible = _visibleTabs().map(tab =>
        {
            const items = _tabItems(tab, newKeys);
            return { ...tab, hasNew: _newCount(items) > 0, sections: _dropEmptySections(_groupSections(tab.id, items)) };
        }).filter(tab => tab.sections.length > 0);
        const firstEnabledIdx = visible.findIndex(tab => !tab._disabled);
        const tabs = visible.map((tab, idx) =>
        {
            const sections = tab.sections;
            const settingCount = sections.reduce((sum, section) => sum + section.count, 0);
            const sectionCount = sections.filter(section => !section.headerless).length;
            return {
                id: tab.id,
                label: localize(tab.label),
                icon: tab.icon,
                active: idx === Math.max(firstEnabledIdx, 0),
                docUrl: tab.doc ? `https://agraael.github.io/lancer-automations/feature/${tab.doc}.html` : '',
                disabled: tab._disabled,
                disabledReason: localize(tab._disabledReason),
                sections,
                settingCount,
                sectionCount,
                pageMeta: localizeFormat('LA.configUi.pageMeta', { settings: settingCount, sections: sectionCount }),
                hasNew: tab.hasNew,
            };
        });
        const tabController = this._tabs?.[0];
        if (tabController && !tabs.some(tab => tab.id === tabController.active))
            tabController.active = tabs.find(tab => tab.active)?.id ?? tabs[0]?.id;
        const grouped = new Set();
        const groups = NAV_GROUPS.map(group => ({
            label: localize(group.label),
            icon: group.icon,
            tabs: group.tabs.map(id => tabs.find(tab => tab.id === id)).filter(Boolean).map(tab => (grouped.add(tab.id), tab)),
        })).filter(group => group.tabs.length > 0);
        const leftover = tabs.filter(tab => !grouped.has(tab.id));
        if (leftover.length > 0)
            groups.push({ label: localize('LA.settingsMenus.navGroup.other.label'), icon: 'fas fa-ellipsis', tabs: leftover });
        const fcsLegend = game.user.isGM && getFCSData()
            ? localizeFormat('LA.configUi.fcsLegend', {
                open: `<i class="fas ${_FCS_ICONS['open-gm']}"></i>`,
                soft: `<i class="fas ${_FCS_ICONS['soft-gm']}"></i>`,
                hard: `<i class="fas ${_FCS_ICONS['hard-gm']}"></i>`,
            })
            : '';
        return { tabs, groups, fcsLegend, isGM: game.user.isGM };
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
        this._formSnapshot = _readFormSettings(this.form ?? $html[0]);

        // Measured on hover rather than on render, so it stays right through resizes and tab switches
        const root = $html[0];
        if (root)
        {
            root.addEventListener('pointerover', event =>
            {
                const label = event.target?.closest?.('.la-opt-label');
                const text = label?.querySelector('.la-opt-label-text');
                if (!text)
                    return;
                const overflow = Math.round(text.scrollWidth - label.clientWidth);
                if (overflow <= 1)
                    return;
                label.style.setProperty('--la-pan', `-${overflow}px`);
                label.classList.add('la-pans');
            });

            root.addEventListener('pointerout', event =>
            {
                const label = event.target?.closest?.('.la-opt-label');
                if (label && !label.contains(event.relatedTarget))
                    label.classList.remove('la-pans');
            });
        }

        const scroller = $html.find('.la-config-content')[0];
        if (_laConfigState?.scroll != null && scroller)
        {
            requestAnimationFrame(() =>
            {
                scroller.scrollTop = _laConfigState.scroll;
            });
        }
        $html.find('.la-config-rail .item.la-tab-disabled').on('click', (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        });
        $html.find('.la-config-rail .item').on('click', () =>
        {
            if (scroller)
                scroller.scrollTop = 0;
        });
        $html.find('.la-config-rail').on('keydown', (/** @type {any} */ ev) =>
        {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')
                return;
            const items = $html.find('.la-config-rail .item:not(.la-tab-disabled)').toArray();
            const index = items.indexOf(document.activeElement);
            if (index < 0)
                return;
            ev.preventDefault();
            const next = items[(index + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            next.focus();
            next.click();
        });
        $html.find('.la-config-rail .item').attr('tabindex', '0');

        const gated = [];
        const allWatched = new Set();
        for (const field of _fieldsWithRequirements())
        {
            const $target = $html.find(`[name="${_fieldName(field)}"]`);
            if (!$target.length)
                continue;
            const keys = _requiredKeys(field);
            const isMet = (key) => _isRequirementMet($html, key);
            const $row = $target.closest('.form-group, .la-compact-bool');
            gated.push({ field, $row });
            const warningIcon = document.createElement('i');
            warningIcon.className = 'fas fa-triangle-exclamation la-req-icon';
            warningIcon.dataset.tooltip = _requirementHint(field);
            ($row.find('label').first().length ? $row.find('label').first() : $row).append(warningIcon);
            const syncRequirement = () =>
            {
                const met = field.requiresAll ? keys.every(isMet) : keys.some(isMet);
                if (field.softRequires)
                {
                    $row.toggleClass('la-req-soft', !met);
                    return;
                }
                $target.prop('disabled', !met);
                $row.toggleClass(field.hideUnmet ? 'la-req-hidden' : 'la-req-unmet', !met);
            };
            const watched = new Set();
            const watch = (key) =>
            {
                const { name } = _parseRequirement(key);
                if (watched.has(name))
                    return;
                watched.add(name);
                allWatched.add(name);
                for (const sub of _requiredKeys(_fieldByKey(name)))
                    watch(sub);
            };
            keys.forEach(watch);
            $html.find([...watched].map(key => `[name="${key}"]`).join(', ')).on('change', syncRequirement);
            syncRequirement();
        }
        if (allWatched.size)
            $html.find([...allWatched].map(key => `[name="${key}"]`).join(', ')).on('change', () => _syncRequirementLines($html, gated));
        _syncRequirementLines($html, gated);

        const isDefault = (/** @type {any} */ row) =>
        {
            const input = row.querySelector('[name]');
            const fallback = row.dataset.default ?? '';
            if (!input)
                return true;
            if (input.type === 'checkbox')
                return input.checked === (fallback === 'true');
            if (input.type === 'number' || input.type === 'range')
                return Number(input.value) === Number(fallback);
            if (input.type === 'color')
                return String(input.value).toLowerCase() === fallback.toLowerCase();
            return String(input.value ?? '') === fallback;
        };
        const refreshChanged = (/** @type {any[]} */ rows) =>
        {
            for (const row of rows)
                row.classList.toggle('la-changed', !isDefault(row));
            const searching = this.element.find('form.la-config-form').hasClass('la-searching');
            $html.find('.la-config-rail .item').each((/** @type {number} */ _i, /** @type {any} */ item) =>
            {
                const count = $html.find(`.tab[data-tab="${item.dataset.tab}"] .la-changed`).length;
                const $badge = $(item).find('.la-rail-badge');
                $badge.attr('data-count', count || '');
                if (searching)
                    return;
                $badge.text(count || '');
                $badge.toggleClass('hit', count > 0);
            });
            $html.find('.la-card-changed').each((/** @type {number} */ _i, /** @type {any} */ slot) =>
            {
                const count = slot.closest('.la-card')?.querySelectorAll('.la-changed').length ?? 0;
                slot.textContent = count ? String(count) : '';
            });
        };
        refreshChanged($html.find('[data-default]').toArray());
        $html.off('change.laChanged input.laChanged').on('change.laChanged input.laChanged', '[data-default] [name]', (/** @type {any} */ ev) =>
        {
            refreshChanged([ev.currentTarget.closest('[data-default]')]);
        });
        $html.off('click.laRowReset').on('click.laRowReset', '.la-row-reset', (/** @type {any} */ ev) =>
        {
            const row = ev.currentTarget.closest('[data-default]');
            const input = row?.querySelector('[name]');
            if (!input || input.disabled)
                return;
            if (input.type === 'checkbox')
                input.checked = row.dataset.default === 'true';
            else
                input.value = row.dataset.default;
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
        });
        bindKeybindingEditor(this, $html);

        $html.find('.la-tour-play').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            const row = ev.currentTarget.closest('.la-tour-row');
            const fullKey = row?.dataset.fullKey;
            if (!fullKey)
                return;
            const tour = /** @type {any} */ (game.tours)?.get?.(fullKey);
            if (!tour)
                return;
            // Close the config window before starting the tour (matches Foundry's native Tour Manager UX).
            try
            {
                const appEl = ev.currentTarget.closest('.window-app');
                const appId = appEl?.dataset.appid;
                const app = appId ? ui.windows?.[appId] : null;
                if (app)
                    await app.close();
            }
            catch
            { /* ignore */ }
            try
            {
                await tour.start();
            }
            catch (e)
            {
                console.error('lancer-automations | failed to start tour', fullKey, e);
            }
        });

        $html.find('button[data-action-key]').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            const key = ev.currentTarget.dataset.actionKey;
            for (const tab of TAB_DEFS)
            {
                const matchedField = /** @type {any} */ (tab.fields.find((/** @type {any} */ field) => field.key === key));
                if (matchedField?.onClick)
                {
                    const formEl = ev.currentTarget.closest('form');
                    const formMap = _readFormSettings(formEl);
                    const restore = _patchSettingsGet(formMap);
                    try
                    {
                        await matchedField.onClick();
                    }
                    catch (error)
                    {
                        console.error(`lancer-automations | config button "${key}" failed:`, error);
                        ui.notifications?.error(localizeFormat('LA.notify.configButtonFailed', { label: matchedField.label }));
                    }
                    finally
                    {
                        restore();
                    }
                    if (typeof matchedField.state === 'function')
                        $(ev.currentTarget).find('.la-btn-state').text(matchedField.state());
                    return;
                }
            }
        });
        $html.find('.la-wizard-btn').on('click', () => runSettingsOnboarding());
        $html.find('.la-preview-btn').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await _previewSettingSound(ev.currentTarget.dataset.previewKey);
        });
        const $headers = $html.find('.la-collapsible');
        const sectionKey = (/** @type {any} */ $h) =>
        {
            const $box = $h.closest('.la-card, .la-sub');
            return `${$box.closest('.la-card').attr('id') ?? ''}:${$box.attr('data-label') ?? ''}`;
        };
        const applySectionState = (/** @type {any} */ h) =>
        {
            const $h = $(h);
            const label = sectionKey($h);
            const collapsed = this._sectionStates.has(label)
                ? this._sectionStates.get(label)
                : $h.closest('.la-card, .la-sub').hasClass('collapsed');
            _toggleSection($h, collapsed);
        };
        const applyAllSectionStates = () =>
        {
            $headers.each((/** @type {number} */ _i, /** @type {any} */ h) => applySectionState(h));
        };
        applyAllSectionStates();
        $headers.on('click', (/** @type {any} */ ev) =>
        {
            const $h = $(ev.currentTarget);
            const next = !$h.closest('.la-card, .la-sub').hasClass('collapsed');
            _toggleSection($h, next, true);
            this._sectionStates.set(sectionKey($h), next);
        });
        $html.find('.la-page-tools [data-sections]').on('click', (/** @type {any} */ ev) =>
        {
            const collapsed = ev.currentTarget.dataset.sections === 'collapse';
            $(ev.currentTarget).closest('.tab').find('.la-collapsible').each((/** @type {number} */ _i, /** @type {any} */ head) =>
            {
                const $head = $(head);
                _toggleSection($head, collapsed, true);
                this._sectionStates.set(sectionKey($head), collapsed);
            });
        });

        $html.find('.la-bulk [data-bulk]').on('click', (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            const checked = ev.currentTarget.dataset.bulk === 'all';
            const card = ev.currentTarget.closest('.la-card');
            for (const input of card.querySelectorAll(':scope > .la-card-body > .la-compact-bools input[type="checkbox"]:not(:disabled)'))
            {
                if (input.checked === checked)
                    continue;
                input.checked = checked;
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        });

        $html.find('.la-strip .la-chip').on('click', (/** @type {any} */ ev) =>
        {
            const target = $html.find(`#${ev.currentTarget.dataset.target}`);
            if (!target.length)
                return;
            const $head = target.find('.la-collapsible').first();
            if (target.hasClass('collapsed') && $head.length)
            {
                _toggleSection($head, false);
                this._sectionStates.set(sectionKey($head), false);
            }
            if (!scroller)
            {
                target[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
                return;
            }
            const top = scroller.scrollTop + target[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            scroller.scrollTo({ top, behavior: 'smooth' });
        });
        if (scroller && typeof IntersectionObserver === 'function')
        {
            this._stripObserver?.disconnect();
            const visibleCards = new Set();
            this._stripObserver = new IntersectionObserver(entries =>
            {
                for (const entry of entries)
                {
                    if (entry.isIntersecting)
                        visibleCards.add(entry.target.id);
                    else
                        visibleCards.delete(entry.target.id);
                }
                $html.find('.la-strip .la-chip').each((/** @type {number} */ _i, /** @type {any} */ chip) =>
                {
                    chip.classList.toggle('active', visibleCards.has(chip.dataset.target));
                });
            }, { root: scroller, threshold: 0.01 });
            $html.find('.la-card').each((/** @type {number} */ _i, /** @type {any} */ card) => this._stripObserver.observe(card));
        }
        this._bindTruncatedLabels($html);
        for (const tab of TAB_DEFS)
            _injectFCSLocks(html, tab.fields, this);
        _injectControlLocks(html);
        $html.off('click.laFccLock').on('click.laFccLock', '.la-fcc-lock', async (/** @type {any} */ ev) =>
        {
            ev.stopPropagation();
            const action = $(ev.currentTarget).closest('.la-keybinding-row').attr('data-full-key');
            if (!action || !getFCCData())
                return;
            await toggleFCCForce(ev, action);
            this.render(true);
        });
        // Delegated so the lock keeps working after the search filter rebuilds a label's HTML.
        $html.off('click.laFcsLock').on('click.laFcsLock', '.la-fcs-lock', async function (/** @type {any} */ ev)
        {
            ev.preventDefault();
            const fcsData = getFCSData();
            if (!fcsData)
                return;
            const isGM = game.user?.isGM;
            const $icon = $(this);
            const lockKey = $icon.attr('data-settings-key');
            if (!lockKey)
                return;
            await toggleFCSForce(lockKey, fcsData);
            let resolved = fcsData.forced.get(lockKey)?.mode ?? 'open';
            if ((resolved === 'soft' || isGM) && fcsData.unlocked.has(lockKey))
                resolved = 'unlocked';
            const newModeKey = resolved + (isGM ? '-gm' : '-client');
            const newIcon = _FCS_ICONS[newModeKey] ?? 'fa-lock-keyhole-open';
            $icon.attr('class', `fas ${newIcon} la-fcs-lock`);
            $icon.prop('title', localize(`FORCECLIENTSETTINGS.ui.${newModeKey}-hint`));
            const inputName = lockKey.startsWith(`${MODULE_ID}.`) ? lockKey.slice(MODULE_ID.length + 1) : `__ext.${lockKey}`;
            $html.find(`[name="${inputName}"]`).prop('disabled', ['hard-client', 'soft-client'].includes(newModeKey));
            // drop the search cache for this label so a re-search re-stashes the new icon
            $icon.closest('label').removeData('la-orig');
        });

        bindConfigSearch(this, $html, applyAllSectionStates);
    }

    // Cut-off labels put their full text at the top of the row tooltip.
    _bindTruncatedLabels($html)
    {
        const measure = () =>
        {
            $html.find('.la-compact-label').each((/** @type {number} */ _i, /** @type {any} */ el) =>
            {
                const row = el.closest('.la-compact-bool');
                if (!row)
                    return;
                const full = (el.textContent ?? '').trim();
                if (row.dataset.laHint === undefined)
                    row.dataset.laHint = row.dataset.tooltip ?? '';
                const hint = row.dataset.laHint;
                const cut = el.scrollWidth > el.clientWidth + 1;
                el.classList.toggle('is-truncated', cut);
                const tooltip = cut ? (hint ? `<b>${full}</b><br>${hint}` : full) : hint;
                if (tooltip)
                    row.dataset.tooltip = tooltip;
                else
                    delete row.dataset.tooltip;
            });
        };
        measure();
        this._truncObserver?.disconnect();
        if (typeof ResizeObserver !== 'function')
            return;
        this._truncObserver = new ResizeObserver(() => measure());
        $html.find('.la-compact-bools').each((/** @type {number} */ _i, /** @type {any} */ el) => this._truncObserver.observe(el));
    }

    /** @param {'idle'|'saving'|'saved'} state */
    _setSaveState(state)
    {
        const button = this.element?.find?.('.la-config-save');
        if (!button?.length)
            return;
        clearTimeout(this._saveStateTimer);
        button.removeClass('is-saving is-saved').prop('disabled', state === 'saving');
        if (state === 'saving')
            button.addClass('is-saving').html(`<i class="fas fa-circle-notch fa-spin"></i> ${localize('LA.configUi.saving')}`);
        else if (state === 'saved')
        {
            button.addClass('is-saved').html(`<i class="fas fa-check"></i> ${localize('LA.configUi.saved')}`);
            this._saveStateTimer = setTimeout(() => this._setSaveState('idle'), 1600);
        }
        else
            button.html(`<i class="fas fa-save"></i> ${localize('LA.configUi.save')}`);
    }

    async _updateObject(_event, formData)
    {
        this._setSaveState('saving');
        // non-GM submits skip world-scoped writes so player saves don't clobber GM values
        const isGM = !!game.user?.isGM;
        const _canWrite = (moduleId, key) =>
        {
            const setting = game.settings.settings.get(`${moduleId}.${key}`);
            if (!setting)
                return false;
            if (setting.scope === 'world')
                return isGM;
            return true;
        };

        for (const formKey of Object.keys(formData))
        {
            if (!formKey.startsWith('__ext.'))
                continue;
            const rest = formKey.slice('__ext.'.length);
            const dot = rest.indexOf('.');
            if (dot < 1)
                continue;
            const moduleId = rest.slice(0, dot);
            const settingKey = rest.slice(dot + 1);
            if (!_extNamespaceActive(moduleId))
                continue;
            if (!_canWrite(moduleId, settingKey))
                continue;
            if (_sameAsSnapshot(this._formSnapshot, formKey, formData[formKey]))
                continue;
            try
            {
                const targetSetting = game.settings.settings.get(`${moduleId}.${settingKey}`);
                const raw = formData[formKey];
                await game.settings.set(moduleId, settingKey, _coerceExtValue(targetSetting, raw));
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save ${moduleId}.${settingKey}`, e);
            }
        }


        const sfxSubs = new Set();
        for (const tab of TAB_DEFS)
        {
            for (const fRaw of tab.fields)
            {
                const f = /** @type {any} */ (fRaw);
                if (f.type === 'statusFx' && f.sub)
                    sfxSubs.add(f.sub);
                else if (f.type === 'compactStatusFx')
                {
                    for (const it of (f.items ?? []))
                    {
                        if (it?.sub)
                            sfxSubs.add(it.sub);
                    }
                }
            }
        }
        if (sfxSubs.size > 0 && _canWrite(MODULE_ID, 'statusFXConfig'))
        {
            try
            {
                const existing = getModuleSetting('statusFXConfig') ?? {};
                /** @type {any} */
                const next = { ...existing };
                let changed = false;
                for (const sub of sfxSubs)
                {
                    const formKey = `_sfx.${sub}`;
                    if (!(formKey in formData))
                        continue;
                    const newVal = !!formData[formKey];
                    if (next[sub] !== newVal)
                    {
                        next[sub] = newVal;
                        changed = true;
                    }
                }
                if (changed)
                {
                    await game.settings.set(MODULE_ID, 'statusFXConfig', next);
                    const setting = game.settings.settings.get(`${MODULE_ID}.statusFXConfig`);
                    if (setting?.requiresReload)
                        this._needsReload = true;
                }
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save statusFXConfig`, e);
            }
        }

        /** @type {any[]} */
        const allFields = [];
        for (const tab of TAB_DEFS)
        {
            for (const fRaw of tab.fields)
            {
                const f = /** @type {any} */ (fRaw);
                if (!f.key && f.type === 'table' && f.tableKeys)
                {
                    for (const tk of f.tableKeys)
                    {
                        const setting = game.settings.settings.get(`${MODULE_ID}.${tk}`);
                        allFields.push({ key: tk, type: setting?.type === Boolean ? 'boolean' : 'string' });
                    }
                }
                else if (f.type === 'compactBooleans')
                {
                    for (const it of (f.items ?? []))
                        allFields.push({ key: it.key, type: 'boolean' });
                }
                else if (f.type === 'compactStatusFx')
                    continue;
                else if (f.key && f.type !== 'section' && f.type !== 'button' && f.type !== 'statusFx')
                    allFields.push(f);
            }
        }
        for (const f of allFields)
        {
            if (!_canWrite(MODULE_ID, f.key))
                continue;
            if (!(f.key in formData))
                continue;
            if (_sameAsSnapshot(this._formSnapshot, f.key, formData[f.key]))
                continue;
            let newValue = formData[f.key];
            if (f.type === 'number' || f.type === 'slider')
                newValue = Number(newValue);
            if (f.type === 'boolean')
                newValue = !!newValue;
            try
            {
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`);
                const prev = getModuleSetting(f.key);
                if (prev !== newValue && setting?.requiresReload)
                    this._needsReload = true;
                await game.settings.set(MODULE_ID, f.key, newValue);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
            }
        }
        this._formSnapshot = _readFormSettings(this.form);
        this._setSaveState('saved');
        await this._promptReload();
    }

    async _promptReload()
    {
        if (!this._needsReload)
            return;
        this._needsReload = false;
        const reload = await Dialog.confirm({
            title: localize('LA.dialogTitle.reloadRequired'),
            content: localize('LA.settingsMenus.content.oneOrMoreChangesRequireA'),
            yes: () => true,
            no: () => false,
            defaultYes: true,
        });
        if (reload)
            foundry.utils.debouncedReload();
    }

    async close(options)
    {
        clearTimeout(this._saveStateTimer);
        this._truncObserver?.disconnect();
        try
        {
            const root = this.element?.[0];
            const activeNav = /** @type {any} */ (root?.querySelector('.tabs .item.active'));
            const scroller = root?.querySelector('.la-config-content');
            this._stripObserver?.disconnect();
            const pos = /** @type {any} */ (this.position ?? {});
            _laConfigState = {
                tab: activeNav?.dataset?.tab ?? null,
                scroll: scroller?.scrollTop ?? 0,
                top: pos.top ?? null,
                left: pos.left ?? null,
                width: pos.width ?? null,
                height: pos.height ?? null,
                sections: [...this._sectionStates],
            };
        }
        catch
        { /* ignore */ }
        if (getModuleSetting(SETTING_NEW_KEYS)?.length)
            await game.settings.set(MODULE_ID, SETTING_NEW_KEYS, []);
        const closeResult = await super.close(options);
        await this._promptReload();
        return closeResult;
    }
}

export function registerSettingsMenus()
{
    game.settings.registerMenu(MODULE_ID, 'lancerAutomationsConfigMenu', {
        name: 'LA.settings.lancerAutomationsConfigMenu.name',
        label: 'LA.settings.lancerAutomationsConfigMenu.label',
        hint: 'LA.settings.lancerAutomationsConfigMenu.hint',
        icon: 'fas fa-sliders-h',
        type: LancerAutomationsConfig,
        restricted: false,
    });
    game.settings.register(MODULE_ID, SETTING_SEEN_KEYS, { scope: 'client', config: false, type: Array, default: [] });
    game.settings.register(MODULE_ID, SETTING_NEW_KEYS, { scope: 'client', config: false, type: Array, default: [] });
    game.settings.register(MODULE_ID, SETTING_SOFT_SEEDED, { scope: 'world', config: false, type: Array, default: [] });
    Hooks.once('ready', () =>
    {
        _noticeNewSettings();
        _seedSoftLocks();
    });
}

export { settingLabel, choiceLabel } from './settings-requirements.js';
export { getExportableModuleBooleanFields, getExportableKeybindingFields } from './settings-fields.js';
