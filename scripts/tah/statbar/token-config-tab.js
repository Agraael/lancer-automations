import { isLancerActor as isLancerCombatant, resolvePilot } from '../../utils/lancer-token.js';
import { escapeAttr as _escAttr } from '../../tools/misc-tools.js';
import * as altFlags from '../../integrations/alt-sheets-flags.js';
import {
    MODULE_ID,
    SETTING_AUTO_INJECT_TALENTS,
    VIS_ALL, VIS_OWNER, VIS_NONE, VIS_SCANNED, SHOW_ALWAYS, SHOW_HOVER,
    FLAG_HIDDEN, FLAG_DISABLED, FLAG_COMBAT_ONLY, FLAG_SHOW_MODE, FLAG_ROW_HEIGHT, FLAG_VIS_OUT_OF_COMBAT, FLAG_VIS_IN_COMBAT,
    FLAG_PILOT_STRESS, FLAG_EXTRAS, FLAG_TEMPLATES,
    DEFAULT_EXTRA_BAR_ICON,
} from './config.js';
import { isEnabled, statBarHidden, statBarDisabled, statBarCombatOnly, showsPilotStress, statBarRowHeight } from './rules.js';
import { _resetAutoInjectedExtras, _groupExtrasIntoLines, _defaultExtraBar, reinjectAutoBarsForActor } from './extras.js';
import { getModuleSetting } from '../../tools/settings-utils.js';
import { getLAFlag, setLAFlag } from '../../tools/flag-utils.js';
import { localize } from '../../tools/string-utils.js';

function _renderExtraBarRowHtml(entry, idx, overflow, collapsed)
{
    const valueSource = entry.valueSource ?? {};
    const maxSource = entry.maxSource ?? {};
    const stops = entry.color?.stops ?? ['#888888'];
    const summary = entry.label || (valueSource.kind === 'path' ? (valueSource.path || 'unset') : `${valueSource.value ?? 0}`);
    return `
        <div class="la-extra-bar-row${collapsed ? ' collapsed' : ''}" data-idx="${idx}" data-id="${entry.id}">
            <div class="la-extra-bar-header">
                <span class="la-extra-bar-drag" draggable="true" title="Drag to reorder">≡</span>
                <button type="button" class="la-extra-bar-toggle" title="${collapsed ? 'Expand' : 'Collapse'}">
                    <i class="fas fa-chevron-${collapsed ? 'right' : 'down'}"></i>
                </button>
                <input type="text" class="la-extra-bar-label" data-field="label" value="${_escAttr(entry.label ?? '')}" placeholder="${localize('LA.common.label')}" maxlength="14">
                <span class="la-extra-bar-summary" title="${_escAttr(summary)}">${_escAttr(summary)}</span>
                <input type="number" data-field="widthPct" value="${entry.widthPct}" min="1" max="100" step="1" title="Width %" class="la-extra-bar-width" style="${overflow ? 'border-color:#c33;color:#c33;' : ''}">
                <span class="la-extra-bar-pct">%</span>
                ${(() =>
                {
                    const vis = entry.visibility ?? (entry.ownerOnly === true ? 'owner' : entry.ownerOnly === false ? 'all' : 'scanned');
                    return `<select class="la-extra-bar-vis" data-field="visibility" title="Visibility: who sees this bar">
                        <option value="owner" ${vis === 'owner' ? 'selected' : ''}>Owner only</option>
                        <option value="scanned" ${vis === 'scanned' ? 'selected' : ''}>Scanned</option>
                        <option value="all" ${vis === 'all' ? 'selected' : ''}>All</option>
                    </select>`;
                })()}
                <button type="button" class="la-extra-bar-del" title="Delete"><i class="fas fa-trash"></i></button>
            </div>
            <div class="la-extra-bar-body" style="${collapsed ? 'display:none;' : ''}">
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Layout</span>
                    <select data-field="layoutMode">
                        <option value="newLine" ${entry.layoutMode === 'newLine' ? 'selected' : ''}>New line</option>
                        <option value="sameLine" ${entry.layoutMode === 'sameLine' ? 'selected' : ''}>Same line</option>
                    </select>
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Value</span>
                    <select data-field="valueSource.kind">
                        <option value="path" ${valueSource.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${valueSource.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="valueSource.path" value="${_escAttr(valueSource.path ?? '')}" placeholder="system.hp.value" class="la-extra-bar-grow" style="${valueSource.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="valueSource.value" value="${valueSource.value ?? 0}" step="1" style="${valueSource.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Max</span>
                    <select data-field="maxSource.kind">
                        <option value="path" ${maxSource.kind === 'path' ? 'selected' : ''}>Path</option>
                        <option value="manual" ${maxSource.kind === 'manual' ? 'selected' : ''}>Manual</option>
                    </select>
                    <input type="text" data-field="maxSource.path" value="${_escAttr(maxSource.path ?? '')}" placeholder="system.hp.max" class="la-extra-bar-grow" style="${maxSource.kind !== 'path' ? 'display:none;' : ''}">
                    <input type="number" data-field="maxSource.value" value="${maxSource.value ?? 1}" step="1" style="${maxSource.kind !== 'manual' ? 'display:none;' : ''}">
                </div>
                <div class="la-extra-bar-line">
                    <label class="la-extra-bar-cb" title="Display as discrete pips using the max value as the segment count."><input type="checkbox" data-field="segmented" ${entry.segmented ? 'checked' : ''}><span>Segmented</span></label>
                    <span class="la-extra-bar-tag" style="margin-left:auto;">Color</span>
                    <input type="color" data-field="color.stops.0" value="${stops[0] ?? '#888888'}">
                </div>
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag">Icon</span>
                    <img class="la-extra-bar-icon-preview" src="${_escAttr(entry.icon ?? DEFAULT_EXTRA_BAR_ICON)}" alt="" onerror="this.style.opacity='0.3';">
                    <input type="text" data-field="icon" value="${_escAttr(entry.icon ?? DEFAULT_EXTRA_BAR_ICON)}" placeholder="${DEFAULT_EXTRA_BAR_ICON}" class="la-extra-bar-grow">
                    <button type="button" class="la-extra-bar-icon-pick" title="Browse files"><i class="fas fa-file-import"></i></button>
                    <label class="la-extra-bar-cb" title="Show label next to the icon in the hover stat hint"><input type="checkbox" data-field="showLabelInHint" ${entry.showLabelInHint ? 'checked' : ''}><span>Show label in hint</span></label>
                    <label class="la-extra-bar-cb" title="Float a +/- text over the token and play the generic_stat sound on value change"><input type="checkbox" data-field="audioTextFeedback" ${entry.audioTextFeedback ? 'checked' : ''}><span>Audio/Text Feedback</span></label>
                </div>
                ${entry.autoKey ? '' : `
                <div class="la-extra-bar-line">
                    <span class="la-extra-bar-tag" title="Right-click in TAH Resources opens this item's sheet.">Linked Item</span>
                    <input type="text" data-field="linkedItemUuid" value="${_escAttr(entry.linkedItemUuid ?? '')}" placeholder="${localize('LA.extras.uuidPlaceholder')}" class="la-extra-bar-grow" readonly>
                    <button type="button" class="la-extra-bar-item-pick" title="Pick an item from the actor"><i class="fas fa-link"></i></button>
                    <button type="button" class="la-extra-bar-item-clear" title="Clear linked item"><i class="fas fa-times"></i></button>
                </div>`}
            </div>
        </div>
    `;
}

// Inject CSS once for the extra-bars editor.
function _ensureExtraBarsStyles()
{
    if (document.getElementById('la-extra-bars-styles'))
        return;
    const styleEl = document.createElement('style');
    styleEl.id = 'la-extra-bars-styles';
    styleEl.textContent = `
        .la-extra-bars-group { grid-column: 1 / -1; display: block !important; } /* Span both columns of the form grid and lay the section out vertically. */
        .la-extra-bars-group > label { display: block; margin-bottom: 4px; }
        .la-extra-bars-group > .notes { display: block; margin-top: 6px; }
        .la-extra-bars-list { display: flex; flex-direction: column; gap: 4px; margin: 4px 0; width: 100%; }
        .la-extra-bar-row { border: 1px solid #888; border-radius: 3px; background: rgba(0,0,0,0.04); width: 100%; box-sizing: border-box; }
        .la-extra-bar-row.dragging { opacity: 0.4; }
        .la-extra-bar-row.drag-over { border-color: var(--color-warm-1, #c97a2b); }
        .la-extra-bar-row.collapsed { background: rgba(0,0,0,0.02); }
        .la-extra-bar-header { display: flex; align-items: center; gap: 4px; padding: 4px 6px; width: 100%; box-sizing: border-box; }
        .la-extra-bar-body { display: flex; flex-direction: column; gap: 4px; padding: 4px 6px 6px; border-top: 1px dashed rgba(128,128,128,0.4); }
        .la-extra-bar-line { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; width: 100%; }
        .la-extra-bar-tag { font-size: 0.75em; text-transform: uppercase; opacity: 0.65; letter-spacing: 0.05em; min-width: 44px; flex-shrink: 0; }
        .la-extra-bar-drag { cursor: grab; user-select: none; padding: 0 2px; font-size: 1.1em; opacity: 0.55; flex-shrink: 0; }
        .la-extra-bar-drag:active { cursor: grabbing; }
        .la-extra-bar-toggle { background: none; border: none; cursor: pointer; padding: 2px 4px; color: inherit; opacity: 0.7; flex-shrink: 0; }
        .la-extra-bar-toggle:hover { opacity: 1; }
        .la-extra-bar-label { width: 110px; flex-shrink: 0; }
        .la-extra-bar-summary { font-size: 0.8em; opacity: 0.6; flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding-left: 4px; font-family: var(--font-mono, monospace); }
        .la-extra-bar-row:not(.collapsed) .la-extra-bar-summary { display: none; }
        .la-extra-bar-width { width: 50px; flex-shrink: 0; }
        .la-extra-bar-pct { opacity: 0.55; font-size: 0.85em; margin-left: -2px; }
        .la-extra-bar-cb { display: inline-flex; align-items: center; gap: 3px; font-size: 0.85em; white-space: nowrap; flex-shrink: 0; }
        .la-extra-bar-cb input { margin: 0; width: auto; }
        .la-extra-bar-del { background: none; border: 1px solid #c33; color: #c33; padding: 2px 6px; border-radius: 3px; cursor: pointer; flex-shrink: 0; }
        .la-extra-bar-del:hover { background: #c33; color: #fff; }
        .la-extra-bar-stops { padding: 2px 6px; cursor: pointer; flex-shrink: 0; }
        .la-extra-bars-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-top: 4px; }
        .la-extra-bars-add, .la-extra-bars-reset { padding: 4px 10px; cursor: pointer; }
        .la-extra-bars-reset { background: rgba(25, 97, 97, 0.18); border-color: #196161; }
        .la-extra-bars-reset:hover { background: rgba(25, 97, 97, 0.32); }
        .la-extra-bar-row select, .la-extra-bar-row input[type="text"], .la-extra-bar-row input[type="number"] { height: 24px; padding: 0 4px; font-size: 0.9em; box-sizing: border-box; } /* Compact form controls so multiple fit on a line. */
        .la-extra-bar-row select { width: auto; min-width: 90px; }
        .la-extra-bar-row input[type="number"] { width: 60px; }
        .la-extra-bar-grow { flex: 1; min-width: 100px; }
        .la-extra-bar-row input[type="color"] { width: 28px; height: 24px; padding: 0; cursor: pointer; flex-shrink: 0; border-radius: 3px; }
        .la-extra-bar-icon-preview { width: 22px; height: 22px; flex-shrink: 0; object-fit: contain; background: rgba(0,0,0,0.25); border: 1px solid #888; border-radius: 3px; padding: 1px; }
        .la-extra-bar-icon-pick { padding: 2px 6px; cursor: pointer; flex-shrink: 0; background: none; border: 1px solid #888; border-radius: 3px; color: inherit; height: 24px; }
        .la-extra-bar-icon-pick:hover { background: rgba(255,255,255,0.05); }
    `;
    document.head.appendChild(styleEl);
}

function _bindExtraBarsUI(root, tokenDoc, app, storeOverride = null)
{
    _ensureExtraBarsStyles();
    const listEl = root.querySelector?.('[data-extras]');
    const addBtn = root.querySelector?.('.la-extra-bars-add');
    const formEl = root.querySelector?.('form') ?? root.closest?.('form') ?? root;
    if (!listEl || !addBtn || !formEl)
        return;

    // Default reads/writes FLAG_EXTRAS; callers pass storeOverride for prototype config.
    const store = storeOverride ?? {
        read: () => getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [],
        write: (working) => setLAFlag(tokenDoc,FLAG_EXTRAS, working),
        onReset: () => _resetAutoInjectedExtras(tokenDoc),
    };

    // Working copy. Persisted on form submit.
    let workingExtras = foundry.utils.deepClone(store.read());

    // Per-id collapsed state. Existing rows start collapsed so the list is scannable.
    const collapsedIds = new Set(workingExtras.map(/** @type {any} */ entry => entry?.id).filter(Boolean));

    const computeOverflow = () =>
    {
        const lines = _groupExtrasIntoLines(workingExtras);
        // Mark every entry whose requested width pushed it onto a new line.
        const overflowing = new Set();
        let currentLine = null;
        for (const extra of workingExtras)
        {
            const widthPct = Math.max(1, Math.min(100, Number(extra?.widthPct) || 100));
            const breaks = !currentLine || extra?.layoutMode === 'newLine' || (currentLine.used + widthPct) > 100;
            if (breaks)
            {
                if (currentLine && extra?.layoutMode === 'sameLine' && (currentLine.used + widthPct) > 100)
                    overflowing.add(extra.id);
                currentLine = { used: 0 };
            }
            currentLine.used += widthPct;
        }
        void lines;
        return overflowing;
    };

    const rerender = () =>
    {
        const overflowing = computeOverflow();
        listEl.innerHTML = workingExtras.map((entry, i) => _renderExtraBarRowHtml(entry, i, overflowing.has(entry.id), collapsedIds.has(entry.id))).join('');
        bindRow();
        if (typeof app.setPosition === 'function')
            app.setPosition({ height: 'auto' });
    };

    const setField = (entry, field, value) =>
    {
        if (field.includes('.'))
            foundry.utils.setProperty(entry, field, value);
        else
            entry[field] = value;
    };

    const bindRow = () =>
    {
        listEl.querySelectorAll('.la-extra-bar-row').forEach(/** @type {any} */(rowEl) =>
        {
            const idx = Number(rowEl.dataset.idx);
            const entry = workingExtras[idx];
            if (!entry)
                return;

            rowEl.querySelectorAll('[data-field]').forEach(/** @type {any} */(input) =>
            {
                input.addEventListener('change', () =>
                {
                    const field = input.dataset.field;
                    let value;
                    if (input.type === 'checkbox')
                        value = input.checked;
                    else if (input.type === 'number')
                        value = Number(input.value) || 0;
                    else
                        value = input.value;
                    setField(entry, field, value);
                    // Re-render on changes that affect visibility of dependent fields.
                    if (field === 'valueSource.kind' || field === 'maxSource.kind'
                        || field === 'segmented'
                        || field === 'layoutMode' || field === 'widthPct')

                        rerender();

                });
                input.addEventListener('input', () =>
                {
                    // Live-update on color pickers so the saved value reflects the last pick.
                    if (input.type === 'color')
                        setField(entry, input.dataset.field, input.value);
                });
            });

            rowEl.querySelector('.la-extra-bar-del')?.addEventListener('click', async () =>
            {
                if (entry.autoKey?.startsWith('flag:'))
                {
                    const flagId = entry.autoKey.split(':')[2];
                    if (tokenDoc.actor && flagId)
                        await altFlags.setBarLink(tokenDoc.actor, flagId, false);
                }
                collapsedIds.delete(entry.id);
                workingExtras.splice(idx, 1);
                rerender();
            });

            // Icon path → live-update the preview img on input.
            const iconInput = /** @type {any} */ (rowEl.querySelector('input[data-field="icon"]'));
            const iconPreview = /** @type {any} */ (rowEl.querySelector('.la-extra-bar-icon-preview'));
            iconInput?.addEventListener('input', () =>
            {
                if (iconPreview)
                {
                    iconPreview.src = iconInput.value || DEFAULT_EXTRA_BAR_ICON;
                    iconPreview.style.opacity = '';
                }
            });

            // Icon picker button → open Foundry's FilePicker at the current icon (the LA icons folder by default).
            rowEl.querySelector('.la-extra-bar-icon-pick')?.addEventListener('click', () =>
            {
                const current = (entry.icon || DEFAULT_EXTRA_BAR_ICON);
                const fp = new FilePicker({
                    type: 'imagevideo',
                    current,
                    callback: (path) =>
                    {
                        entry.icon = path;
                        if (iconInput)
                            iconInput.value = path;
                        if (iconPreview)
                        {
                            iconPreview.src = path;
                            iconPreview.style.opacity = '';
                        }
                    },
                });
                fp.browse();
            });

            // Item picker → choose an Item from the actor or its pilot to link.
            rowEl.querySelector('.la-extra-bar-item-pick')?.addEventListener('click', async () =>
            {
                const actor = tokenDoc?.actor ?? tokenDoc?.parent?.actor;
                const pilot = resolvePilot(actor);
                const sources = [];
                if (actor)
                    sources.push({ label: actor.name ?? 'Actor', items: [...(actor.items?.values?.() ?? [])] });
                if (pilot && pilot !== actor)
                    sources.push({ label: `${pilot.name ?? 'Pilot'} (Pilot)`, items: [...(pilot.items?.values?.() ?? [])] });
                const optionGroups = sources.filter(source => source.items.length).map(source =>
                    `<optgroup label="${_escAttr(source.label)}">${source.items.map(item =>
                        `<option value="${_escAttr(item.uuid)}" ${entry.linkedItemUuid === item.uuid ? 'selected' : ''}>${_escAttr(item.name)} [${_escAttr(item.type)}]</option>`
                    ).join('')}</optgroup>`
                ).join('');
                const content = `<form><div class="form-group"><label>Linked Item</label><select name="uuid" style="width:100%;">${optionGroups || '<option value="">(no items found)</option>'}</select></div></form>`;
                const picked = await Dialog.prompt({
                    title: localize('LA.dialogTitle.linkItemToExtraBar'),
                    content,
                    label: localize('LA.scan.link'),
                    callback: (/** @type {any} */ html) =>
                    {
                        const sel = (html?.find?.('select[name="uuid"]')?.[0]) ?? html?.querySelector?.('select[name="uuid"]');
                        return sel?.value ?? '';
                    },
                    rejectClose: false,
                });
                if (typeof picked === 'string')
                {
                    entry.linkedItemUuid = picked;
                    rerender();
                }
            });
            rowEl.querySelector('.la-extra-bar-item-clear')?.addEventListener('click', () =>
            {
                entry.linkedItemUuid = '';
                rerender();
            });

            rowEl.querySelector('.la-extra-bar-toggle')?.addEventListener('click', () =>
            {
                if (collapsedIds.has(entry.id))
                    collapsedIds.delete(entry.id);
                else
                    collapsedIds.add(entry.id);
                rerender();
            });

            // HTML5 drag/drop reorder: dragstart fires from the handle only.
            const dragHandle = rowEl.querySelector('.la-extra-bar-drag');
            if (dragHandle)
            {
                dragHandle.addEventListener('dragstart', (/** @type {any} */ ev) =>
                {
                    rowEl.classList.add('dragging');
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData('text/plain', String(idx));
                });
                dragHandle.addEventListener('dragend', () => rowEl.classList.remove('dragging'));
            }
            rowEl.addEventListener('dragover', (/** @type {any} */ ev) =>
            {
                ev.preventDefault();
                rowEl.classList.add('drag-over');
            });
            rowEl.addEventListener('dragleave', () => rowEl.classList.remove('drag-over'));
            rowEl.addEventListener('drop', (/** @type {any} */ ev) =>
            {
                ev.preventDefault();
                rowEl.classList.remove('drag-over');
                const from = Number(ev.dataTransfer.getData('text/plain'));
                const to = idx;
                if (Number.isFinite(from) && from !== to)
                {
                    const moved = workingExtras.splice(from, 1)[0];
                    workingExtras.splice(to, 0, moved);
                    rerender();
                }
            });
        });
    };

    addBtn.addEventListener('click', () =>
    {
        const entry = _defaultExtraBar();
        workingExtras.push(entry);
        collapsedIds.add(entry.id);
        rerender();
    });

    // Re-syncs auto bars from talents/templates, or wipes them when the world setting is off.
    const resetBtn = root.querySelector?.('.la-extra-bars-reset');
    resetBtn?.addEventListener('click', async () =>
    {
        const settingOn = !!getModuleSetting(SETTING_AUTO_INJECT_TALENTS);
        // Persist the in-memory edits first so user changes aren't blown away by races.
        try
        {
            await store.write(workingExtras);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | reset auto: failed to persist current state`, err);
        }
        const ok = await store.onReset();
        if (!ok)
        {
            ui.notifications.warn(localize('LA.notify.resetFailedSeeTheConsole'));
            return;
        }
        // Pull the fresh array back into the editor and re-render.
        workingExtras = foundry.utils.deepClone(store.read());
        for (const entry of workingExtras)
        {
            if (entry?.id && entry.autoKey)
                collapsedIds.add(entry.id);
        }
        rerender();
        ui.notifications.info(settingOn
            ? 'Auto-injected bars re-synced.'
            : 'Auto-injected bars removed.');
    });

    // Persist on form submit. Foundry's submit fires before close.
    formEl.addEventListener('submit', () =>
    {
        // Defer so this runs after Foundry's own form-data extraction.
        Promise.resolve().then(() =>
        {
            try
            {
                store.write(workingExtras);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | failed to persist extra bars`, err);
            }
        });
    }, true);

    rerender();
}

// Prototype-config store adapter. _tid round-trips the template id via the entry object.
function _makeActorTemplateStore(actor)
{
    return {
        read: () => (getLAFlag(actor,FLAG_TEMPLATES) ?? [])
            .map(/** @type {any} */ record => ({ ...(record.entry ?? {}), _tid: record.id })),
        write: async (entries) =>
        {
            const records = (entries ?? []).map(/** @type {any} */ entry =>
            {
                const { _tid, ...rest } = entry;
                return { id: _tid ?? foundry.utils.randomID(), entry: rest };
            });
            await setLAFlag(actor,FLAG_TEMPLATES, records);
            await reinjectAutoBarsForActor(actor);
        },
        onReset: async () =>
        {
            await reinjectAutoBarsForActor(actor);
            return true;
        },
    };
}

// Scene-token adapter: manuals promote to actor templates; actor-linked rows round-trip via tid.
function _makeSceneTokenStore(actor, tokenDoc)
{
    const actorSrc = `actor:${actor.id}`;
    const linkedActorTid = (autoKey) =>
    {
        if (typeof autoKey !== 'string' || !autoKey.startsWith('linked:'))
            return null;
        if (!autoKey.endsWith(`:${actorSrc}`))
            return null;
        return autoKey.split(':')[1] || null;
    };
    const initialArr = getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [];
    const initiallyVisibleTids = new Set(
        initialArr.map(/** @type {any} */ entry => linkedActorTid(entry?.autoKey)).filter(Boolean),
    );
    return {
        read: () => getLAFlag(tokenDoc,FLAG_EXTRAS) ?? [],
        write: async (working) =>
        {
            const workingTids = new Set();
            const newManuals = [];
            const templateUpdates = new Map();
            const tokenRows = [];
            for (const entry of working ?? [])
            {
                if (!entry)
                    continue;
                if (!entry.autoKey)
                {
                    const { _tid, autoKey, ...rest } = entry;
                    newManuals.push(rest);
                    continue;
                }
                const tid = linkedActorTid(entry.autoKey);
                if (tid)
                {
                    workingTids.add(tid);
                    const { _tid, autoKey, id, linkedItemUuid, ...rest } = entry;
                    templateUpdates.set(tid, rest);
                    continue;
                }
                tokenRows.push(entry);
            }
            const existing = getLAFlag(actor,FLAG_TEMPLATES) ?? [];
            const merged = [];
            for (const record of existing)
            {
                const wasVisible = initiallyVisibleTids.has(record.id);
                const stillVisible = workingTids.has(record.id);
                if (wasVisible && !stillVisible)
                    continue;
                if (templateUpdates.has(record.id))
                    merged.push({ id: record.id, entry: templateUpdates.get(record.id) });
                else
                    merged.push(record);
            }
            for (const rest of newManuals)
                merged.push({ id: foundry.utils.randomID(), entry: rest });
            await setLAFlag(actor,FLAG_TEMPLATES, merged);
            await setLAFlag(tokenDoc,FLAG_EXTRAS, tokenRows);
            await reinjectAutoBarsForActor(actor);
        },
        onReset: () => _resetAutoInjectedExtras(tokenDoc),
    };
}

// Handler for both scene TokenConfig + prototype TokenConfig (v13 fires distinct hooks).
export function renderConfigHandler(app, html)
{
    if (!isEnabled())
        return;
    const isPrototype = app.isPrototype === true;
    const tokenDoc = app.token ?? app.object;
    const actor = app.actor ?? tokenDoc?.actor ?? tokenDoc?.parent;
    if (!isLancerCombatant(actor) || !tokenDoc)
        return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const tab = root?.querySelector?.('.tab[data-tab="resources"]');
    if (!tab)
        return;
    const hidden = statBarHidden(tokenDoc);
    const disabled = statBarDisabled(tokenDoc);
    const combatOnly = statBarCombatOnly(tokenDoc);
    const rowHeight = statBarRowHeight(tokenDoc);
    const visOut = getLAFlag(tokenDoc,FLAG_VIS_OUT_OF_COMBAT) ?? '';
    const visIn = getLAFlag(tokenDoc,FLAG_VIS_IN_COMBAT) ?? '';
    const showMode = getLAFlag(tokenDoc,FLAG_SHOW_MODE) ?? '';
    const isPilotActor = tokenDoc?.actor?.type === 'pilot';
    const pilotStress = showsPilotStress(tokenDoc);
    const visOption = (val, label, current) =>
        `<option value="${val}" ${current === val ? 'selected' : ''}>${label}</option>`;
    const visSelect = (name, current) => `
        <select name="${name}">
            ${visOption('', 'Use world default', current)}
            ${visOption(VIS_ALL, 'All', current)}
            ${visOption(VIS_OWNER, 'Owners only', current)}
            ${visOption(VIS_SCANNED, 'Owners + scanned', current)}
            ${visOption(VIS_NONE, 'None', current)}
        </select>
    `;
    // Hidden bar1/bar2 fields so Foundry's submit handler doesn't crash.
    const bar1Attr = tokenDoc.bar1?.attribute ?? '';
    const bar2Attr = tokenDoc.bar2?.attribute ?? '';
    tab.innerHTML = `
        <input type="hidden" name="bar1.attribute" value="${bar1Attr}"/>
        <input type="hidden" name="bar2.attribute" value="${bar2Attr}"/>
        <div class="la-stat-bar-config">
        <p class="notes la-managed-by">Lancer Automations is managing this token's bars.</p>
        <div class="form-group">
            <label>Hide Stat Bar</label>
            <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_HIDDEN}" ${hidden ? 'checked' : ''}/>
            <p class="notes">Hide the stat bar hub for this token. It still flashes briefly when a value changes.</p>
        </div>
        <div class="form-group">
            <label>Disable Stat Bar</label>
            <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_DISABLED}" ${disabled ? 'checked' : ''}/>
            <p class="notes">Never show the hub for this token, not even on value changes.</p>
        </div>
        <div class="form-group">
            <label>Show Only In Combat</label>
            <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_COMBAT_ONLY}" ${combatOnly ? 'checked' : ''}/>
            <p class="notes">Only display the stat bar hub while this token is part of an active combat encounter.</p>
        </div>
        <div class="form-group">
            <label>Row Height (px)</label>
            <input type="number" min="0" step="1" name="flags.${MODULE_ID}.${FLAG_ROW_HEIGHT}" value="${rowHeight || ''}" placeholder="auto"/>
            <p class="notes">Override the height of each bar row, in pixels. Leave blank for the default (scales with grid size).</p>
        </div>
        <div class="form-group">
            <label>Visibility: Out of Combat</label>
            ${visSelect(`flags.${MODULE_ID}.${FLAG_VIS_OUT_OF_COMBAT}`, visOut)}
            <p class="notes">Per-token override of who sees the bars when no combat is active. Leave on "Use world default" to inherit from the module settings.</p>
        </div>
        <div class="form-group">
            <label>Visibility: In Combat</label>
            ${visSelect(`flags.${MODULE_ID}.${FLAG_VIS_IN_COMBAT}`, visIn)}
            <p class="notes">Per-token override of who sees the bars while this token is in an active combat.</p>
        </div>
        <div class="form-group">
            <label>Show Bars</label>
            <select name="flags.${MODULE_ID}.${FLAG_SHOW_MODE}">
                ${visOption('', 'Use world default', showMode)}
                ${visOption(SHOW_HOVER, 'On hover', showMode)}
                ${visOption(SHOW_ALWAYS, 'Always', showMode)}
            </select>
            <p class="notes">On hover also shows them when selected, targeted or while Alt is held.</p>
        </div>
        ${isPilotActor ? `
        <div class="form-group">
            <label>Display Stress</label>
            <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_PILOT_STRESS}" ${pilotStress ? 'checked' : ''}/>
            <p class="notes">Show the bond stress bar (and input) on this pilot's token.</p>
        </div>
        ` : ''}
        <div class="form-group la-extra-bars-group">
            <label>Extra Bars</label>
            <div class="la-extra-bars-list" data-extras></div>
            <div class="la-extra-bars-actions">
                <button type="button" class="la-extra-bars-add"><i class="fas fa-plus"></i> Add Bar</button>
                <button type="button" class="la-extra-bars-reset" title="Re-apply auto-injected counter bars (or remove them when the world setting is off)">
                    <i class="fas fa-rotate"></i> Reset Auto-Injected
                </button>
            </div>
            <p class="notes">User-defined bars drawn below the standard ones. Layout: 100% width per line; "same line" lays out side-by-side until the line is full.</p>
        </div>
        </div>
    `;
    const storeOverride = isPrototype
        ? _makeActorTemplateStore(actor)
        : _makeSceneTokenStore(actor, tokenDoc);
    _bindExtraBarsUI(root, tokenDoc, app, storeOverride);
    if (typeof app.setPosition === 'function')
        app.setPosition({ height: 'auto' });
}
