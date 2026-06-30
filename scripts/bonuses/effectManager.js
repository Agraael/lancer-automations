/* global canvas, game, ui, FilePicker, Dialog, CodeMirror */

import {
    applyEffectsToTokens
} from "./flagged-effects.js";
import {
    addGlobalBonus,
    removeGlobalBonus,
    removeConstantBonus
} from "./genericBonuses.js";
import { openItemBrowserDialog } from "../tools/misc-tools.js";
import { installLancerHints } from "../setup/codemirror-hints.js";

/**
 * Renders an inline "code field" row: a read-only preview + Edit/Clear icon buttons.
 * The actual code lives in a hidden input read on submit.
 */
function codeFieldRow(id, label, placeholder) {
    return `
        <div class="form-group">
            <label>${label}:</label>
            <div style="flex:1; display:flex; gap:6px; align-items:center; min-width:0;">
                <button type="button" id="${id}-badge" class="code-field-badge" data-target="${id}" title="${placeholder}">
                    <span class="code-field-dot"></span>
                    <span class="code-field-state">Empty</span>
                </button>
                <input type="hidden" id="${id}-value">
                <button type="button" class="code-clear-btn" data-target="${id}" title="Clear" style="flex:0 0 24px; width:24px; height:24px; padding:0; line-height:1;"><i class="fas fa-times"></i></button>
            </div>
        </div>
    `;
}

function updateCodeFieldBadge(html, fieldId) {
    const value = String(html.find(`#${fieldId}-value`).val() || '').trim();
    const $badge = html.find(`#${fieldId}-badge`);
    if (!$badge.length)
        return;
    if (value) {
        $badge.addClass('has-value');
        $badge.find('.code-field-state').text('Set');
        const preview = value.replace(/\s+/g, ' ').trim().slice(0, 300);
        $badge.attr('title', preview);
    } else {
        $badge.removeClass('has-value');
        $badge.find('.code-field-state').text('Empty');
        $badge.attr('title', 'Click to set');
    }
}

function presetBarHtml(prefix, presets) {
    return `
        <div class="preset-bar" data-prefix="${prefix}">
            <label>Preset:</label>
            <select id="${prefix}-preset-load" style="flex:1;">
                <option value="">— Load —</option>
                ${presets.map(p => `<option value="${p.name}">${p.name}</option>`).join('')}
            </select>
            <button type="button" class="te-btn-icon ${prefix}-preset-delete" title="Delete selected preset" style="flex:0 0 28px; width:28px; height:26px; padding:0;"><i class="fas fa-trash"></i></button>
        </div>
    `;
}

// Token-related field IDs that should NOT be saved/restored in a preset.
const PRESET_SKIP_IDS = {
    std: ['std-target', 'std-origin', 'std-trigger-origin'],
    cust: ['cust-target', 'cust-saved', 'cust-origin', 'cust-trigger-origin'],
    bonus: ['bonus-target', 'bonus-durOrigin', 'bonus-trigger-origin', 'bonus-applyTo']
};

function presetCategoryFor(prefix) {
    return prefix === 'std' ? 'standard' : prefix === 'cust' ? 'custom' : 'bonus';
}

function getStoredPresets() {
    const raw = game.user.getFlag('lancer-automations', 'effectManagerPresets') || {};
    return { standard: raw.standard || [], custom: raw.custom || [], bonus: raw.bonus || [] };
}

async function setStoredPresets(presets) {
    await game.user.setFlag('lancer-automations', 'effectManagerPresets', presets);
}

function gatherPresetData(html, prefix) {
    const $tab = html.find(`#tab-${presetCategoryFor(prefix)}`);
    const skip = new Set(PRESET_SKIP_IDS[prefix] || []);
    const data = {};
    // Standard inputs/selects/textareas inside the tab.
    $tab.find('input, select, textarea').each(function () {
        const id = this.id;
        if (!id || skip.has(id))
            return;
        const $el = $(this);
        const type = ($el.attr('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio')
            data[id] = $el.is(':checked');
        else
            data[id] = $el.val();
    });
    // Multi-select checkboxes (la-multi-select-panel): they may have been moved to body.
    $tab.find('.la-multi-select-panel').each(function () {
        const panelId = this.id;
        if (!panelId)
            return;
        const checked = $(`#${panelId} input[type=checkbox]:checked`).map((_, el) => el.value).get();
        data[`__panel__${panelId}`] = checked;
    });
    // Dynamic damage entries (bonus tab only).
    if (prefix === 'bonus') {
        const dmg = [];
        $tab.find('#bonus-damage-list .bonus-damage-entry').each(function () {
            const $entry = $(this);
            const idx = $entry.data('index');
            dmg.push({
                val: $entry.find(`#bonus-dmgVal-${idx}`).val(),
                type: $entry.find(`#bonus-dmgType-${idx}`).val()
            });
        });
        data.__damageEntries = dmg;
        // Selected immunity options.
        data.__immunityEffects = $tab.find('.bonus-immunity-effect-option.selected').map((_, el) => $(el).data('effect')).get();
        data.__immunityDamage = $tab.find('.bonus-immunity-damage-option.selected').map((_, el) => $(el).data('type')).get();
    }
    return data;
}

function applyPresetData(html, prefix, data) {
    const $tab = html.find(`#tab-${presetCategoryFor(prefix)}`);
    const skip = new Set(PRESET_SKIP_IDS[prefix] || []);
    for (const [id, value] of Object.entries(data)) {
        if (id.startsWith('__'))
            continue;
        if (skip.has(id))
            continue;
        const $el = $tab.find(`#${id}`);
        if (!$el.length)
            continue;
        const type = ($el.attr('type') || '').toLowerCase();
        if (type === 'checkbox' || type === 'radio')
            $el.prop('checked', !!value);
        else
            $el.val(value);
    }
    // Restore multi-select panel checkboxes (find by panel id, even if moved to body).
    for (const [key, val] of Object.entries(data)) {
        if (!key.startsWith('__panel__'))
            continue;
        const panelId = key.slice('__panel__'.length);
        $(`#${panelId} input[type=checkbox]`).each(function () {
            $(this).prop('checked', val.includes(this.value));
        });
        // Trigger change so any dependent UI updates.
        $(`#${panelId} input[type=checkbox]`).first().trigger('change');
    }
    // Damage entries — drop the dynamic list and rebuild (bonus tab).
    if (prefix === 'bonus' && Array.isArray(data.__damageEntries)) {
        const $list = $tab.find('#bonus-damage-list');
        $list.empty();
        data.__damageEntries.forEach((entry, idx) => {
            $list.append(`
                <div class="bonus-damage-entry form-group" data-index="${idx}">
                    <input type="text" id="bonus-dmgVal-${idx}" value="${entry.val ?? '1d6'}" placeholder="1d6" style="flex:1;">
                    <select id="bonus-dmgType-${idx}" style="flex:1;"></select>
                    <button type="button" class="bonus-remove-dmg te-delete-btn" data-index="${idx}" style="flex:0 0 22px;"><i class="fas fa-times"></i></button>
                </div>
            `);
            // Refill the damage-type select options from the existing first entry, then set value.
            // The dmgTypeOptionsHtml was rendered at initial render; copy from existing one if available.
            const $firstTypeSelect = $tab.find('select[id^="bonus-dmgType-"]').first();
            const optionsHtml = $firstTypeSelect.html();
            if (optionsHtml)
                $tab.find(`#bonus-dmgType-${idx}`).html(optionsHtml).val(entry.type);
        });
    }
    // Immunity selections.
    if (prefix === 'bonus' && Array.isArray(data.__immunityEffects)) {
        $tab.find('.bonus-immunity-effect-option').each(function () {
            $(this).toggleClass('selected', data.__immunityEffects.includes($(this).data('effect')));
        });
    }
    if (prefix === 'bonus' && Array.isArray(data.__immunityDamage)) {
        $tab.find('.bonus-immunity-damage-option').each(function () {
            $(this).toggleClass('selected', data.__immunityDamage.includes($(this).data('type')));
        });
    }
    // Bonus-type-specific section visibility.
    $tab.find('#bonus-type').trigger('change');
    // Sync icon previews if present.
    const $icon = $tab.find('#cust-icon, #bonus-icon');
    if ($icon.length) {
        $icon.each(function () {
            const path = String($(this).val() || '');
            const $img = $tab.find(`#${this.id}-preview`);
            if ($img.length) {
                $img.attr('src', path);
                $img[0].style.opacity = '1';
            }
        });
    }
    // Code-field badges.
    $tab.find('.code-field-badge').each(function () {
        updateCodeFieldBadge(html, $(this).data('target'));
    });
    // Update multi-select trigger button labels.
    $tab.find('.la-multi-select').each(function () {
        const trigger = $(this).find('.la-multi-select-trigger');
        const panelId = $(this).find('.la-multi-select-panel').attr('id');
        if (!panelId)
            return;
        const checked = $(`#${panelId} input:checked`);
        if (checked.length === 0)
            trigger.text('— Select —');
        else
            trigger.text(checked.map((_, el) => $(el).closest('label').text().trim()).get().join(', '));
    });
}

/**
 * Opens a CodeMirror editor dialog bound to a hidden input + preview pair.
 * Mirrors reaction-manager's expanded editor (Alt-Enter completion via installLancerHints).
 */
function openCodeFieldDialog(html, fieldId, title, defaultCode = '') {
    const $value = html.find(`#${fieldId}-value`);
    const stored = String($value.val() || '');
    const initial = stored || defaultCode;
    let editor;
    let resizeObserver;

    new Dialog({
        title: `Edit ${title}`,
        content: `<div class="lcm-host"></div>
            <style>
                .lcm-dialog .window-content { padding:0 !important; overflow:hidden !important; background:#272822; }
                .lcm-dialog .dialog-buttons { height:40px !important; min-height:40px !important; max-height:40px !important; background:#333 !important; border-top:1px solid #111 !important; padding:0 !important; margin:0 !important; display:flex !important; }
                .lcm-dialog button.dialog-button { background:#444 !important; color:#fff !important; border:none !important; border-right:1px solid #222 !important; width:100% !important; height:100% !important; margin:0 !important; display:flex !important; align-items:center !important; justify-content:center !important; font-size:1em !important; border-radius:0 !important; box-shadow:none !important; }
                .lcm-dialog button.dialog-button:last-child { border-right:none !important; }
                .lcm-dialog button.dialog-button:hover { background:#555 !important; }
            </style>`,
        buttons: {
            save: {
                label: "Save",
                icon: '<i class="fas fa-save" style="margin-right:8px;"></i>',
                callback: () => {
                    const v = editor.getValue();
                    $value.val(v);
                    updateCodeFieldBadge(html, fieldId);
                }
            },
            cancel: {
                label: "Cancel",
                icon: '<i class="fas fa-times" style="margin-right:8px;"></i>'
            }
        },
        default: "save",
        render: (dlgHtml) => {
            const host = dlgHtml.find('.lcm-host')[0];
            editor = CodeMirror(host, {
                value: initial,
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                matchBrackets: true,
                styleActiveLine: true,
                indentUnit: 4,
                smartIndent: true,
                lineWrapping: false,
                scrollbarStyle: "native"
            });
            installLancerHints(editor, 'evaluate');
            const windowEl = dlgHtml.closest('.window-app')[0];
            const updateSize = () => {
                if (!windowEl) return;
                const headerH = /** @type {HTMLElement|null} */ (windowEl.querySelector('.window-header'))?.offsetHeight ?? 34;
                editor.setSize(null, windowEl.offsetHeight - headerH - 40);
                editor.refresh();
            };
            setTimeout(updateSize, 50);
            resizeObserver = new ResizeObserver(updateSize);
            resizeObserver.observe(windowEl);
        },
        close: () => { resizeObserver?.disconnect(); }
    }, {
        width: 700,
        height: 500,
        resizable: true,
        classes: ["dialog", "lcm-dialog", "lancer-dialog-base", "lancer-no-title"]
    }).render(true);
}

/**
 * Open item browser and populate targetInput with the selected LID.
 * @param {JQuery} targetInput
 * @returns {Promise<string|null>}
 */
export async function openItemBrowser(targetInput) {
    const result = await openItemBrowserDialog();
    if (result && targetInput)
        targetInput.val(result.lid);
    return result?.lid ?? null;
}

/**
 * Open a status picker dialog and populate targetInput with the selected status ID.
 * Shows all CONFIG.statusEffects plus custom statuses from temporary-custom-statuses if present.
 * @param {JQuery} targetInput
 */
function openStatusPicker(targetInput) {
    const statuses = [...(CONFIG.statusEffects || [])];

    const customApi = game.modules.get('temporary-custom-statuses')?.api;
    if (customApi && typeof customApi.getStatuses === 'function') {
        const customStatuses = customApi.getStatuses() || [];
        for (const customStatus of customStatuses) {
            if (!statuses.some(existing => existing.id === customStatus.id))
                statuses.push(customStatus);
        }
    }

    const currentVal = targetInput ? /** @type {string} */ (targetInput.val()) || '' : '';
    const alreadySelected = new Set(currentVal.split(',').map(s => s.trim()).filter(Boolean));

    const gridHtml = statuses.map(s => {
        const icon = s.img || s.icon || '';
        const id = s.id || s.name || '';
        let label = s.name || id;
        if (typeof s.name === 'string' && s.name.startsWith('lancer')) {
            label = game.i18n.localize(s.name);
        }
        const isSelected = alreadySelected.has(id);
        return `<div class="lancer-status-entry${isSelected ? ' selected' : ''}" data-id="${id}" title="${label}"
            style="display:inline-flex;flex-direction:column;align-items:center;width:56px;margin:3px;cursor:pointer;padding:4px;border-radius:4px;border:2px solid ${isSelected ? 'var(--primary-color)' : 'transparent'};">
            <div style="width:40px;height:40px;background:#1a1a1a;border-radius:4px;display:flex;align-items:center;justify-content:center;">
                <img src="${icon}" width="32" height="32" style="object-fit:contain;">
            </div>
            <span style="font-size:0.6em;text-align:center;word-break:break-all;margin-top:2px;max-width:54px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${label}</span>
        </div>`;
    }).join('');

    const dialog = new Dialog({
        title: 'Pick Status',
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">PICK STATUS</h1>
                <p class="lancer-dialog-subtitle">Click to toggle. Multiple can be selected.</p>
            </div>
            <div style="max-height:300px;overflow-y:auto;padding:4px;">
                <div style="display:flex;flex-wrap:wrap;">${gridHtml}</div>
            </div>
        `,
        buttons: {
            confirm: {
                label: '<i class="fas fa-check"></i> Confirm',
                callback: (html) => {
                    const selected = html.find('.lancer-status-entry.selected').map(function () {
                        return $(this).data('id');
                    }).get();
                    if (targetInput)
                        targetInput.val(selected.join(', '));
                }
            },
            cancel: { label: '<i class="fas fa-times"></i> Cancel', callback: () => {} }
        },
        render: (html) => {
            html.find('.lancer-status-entry').on('click', function () {
                $(this).toggleClass('selected');
                $(this).css('border-color', $(this).hasClass('selected') ? 'var(--primary-color)' : 'transparent');
            });
        },
        default: "confirm"
    }, { width: 420, classes: ["lancer-dialog-base", "lancer-no-title"] });
    dialog.render(true);
}

const CONSUMPTION_TRIGGER_LIST = [
    { value: 'onAttack', label: 'On Attack' },
    { value: 'onHit', label: 'On Hit' },
    { value: 'onMiss', label: 'On Miss' },
    { value: 'onDamage', label: 'On Damage' },
    { value: 'onTechAttack', label: 'On Tech Attack' },
    { value: 'onTechHit', label: 'On Tech Hit' },
    { value: 'onMove', label: 'On Move' },
    { value: 'onPreMove', label: 'On Pre Move' },
    { value: 'onInitActivation', label: 'On Init Activation' },
    { value: 'onActivation', label: 'On Activation' },
    { value: 'onDeploy', label: 'On Deploy' },
    { value: 'onCheck', label: 'On Check' },
    { value: 'onHeatGain', label: 'On Heat' },
    { value: 'onHpLoss', label: 'On HP Loss' },
    { value: 'onTurnStart', label: 'On Turn Start' },
    { value: 'onTurnEnd', label: 'On Turn End' },
    { value: 'onRoundStart', label: 'On Round Start' },
    { value: 'onEnterCombat', label: 'On Enter Combat' },
    { value: 'onExitCombat', label: 'On Exit Combat' },
    { value: 'onPreStatusApplied', label: 'On Pre Status Applied' },
    { value: 'onPreStatusRemoved', label: 'On Pre Status Removed' },
    { value: 'onStatusApplied', label: 'On Status Applied' },
    { value: 'onStatusRemoved', label: 'On Status Removed' }
];

function consumptionTriggerCheckboxesHtml() {
    return CONSUMPTION_TRIGGER_LIST
        .map(o => `<label><input type="checkbox" value="${o.value}"> ${o.label}</label>`)
        .join('');
}

/**
 * Hoisted la-multi-select initializer (button-trigger + checkbox panel).
 * @param {JQuery} html
 * @param {string} containerId
 */
function initLaMultiSelect(html, containerId) {
    const container = html.find(`#${containerId}`);
    const trigger = container.find('.la-multi-select-trigger');
    const panel = container.find('.la-multi-select-panel');
    const updateTriggerLabel = () => {
        const checked = panel.find('input:checked');
        if (checked.length === 0) {
            trigger.text('— Select —');
        } else {
            trigger.text(checked.map((_, el) => $(el).closest('label').text().trim()).get().join(', '));
        }
    };
    const panelHome = panel.parent();
    const positionPanel = () => {
        const rect = trigger[0].getBoundingClientRect();
        const el = panel[0].style;
        el.setProperty('position', 'fixed', 'important');
        el.setProperty('top', `${rect.bottom + 2}px`, 'important');
        el.setProperty('left', `${rect.left}px`, 'important');
        el.setProperty('right', 'auto', 'important');
        el.setProperty('bottom', 'auto', 'important');
        el.setProperty('width', `${rect.width}px`, 'important');
        el.setProperty('min-width', '0', 'important');
        el.setProperty('max-width', `${rect.width}px`, 'important');
    };
    const closePanel = () => {
        panel.removeClass('open');
        panel[0].style.cssText = '';
        if (panel.parent().is('body'))
            panelHome.append(panel);
    };
    trigger.on('click', (e) => {
        e.stopPropagation();
        const wasOpen = panel.hasClass('open');
        $('.la-multi-select-panel.open').each(function () {
            $(this).removeClass('open');
        });
        if (!wasOpen) {
            $('body').append(panel);
            positionPanel();
            panel.addClass('open');
        } else {
            closePanel();
        }
    });
    panel.on('click', (e) => e.stopPropagation());
    panel.find('input[type=checkbox]').on('change', updateTriggerLabel);
    $(document).on('click.la-multiselect', closePanel);
    updateTriggerLabel();
}

const CONSUMPTION_FILTER_MAP = {
    onAttack: ['cfilter-itemLid', 'cfilter-itemId'],
    onHit: ['cfilter-itemLid', 'cfilter-itemId'],
    onMiss: ['cfilter-itemLid', 'cfilter-itemId'],
    onDamage: ['cfilter-itemLid', 'cfilter-itemId'],
    onTechAttack: ['cfilter-itemLid', 'cfilter-itemId'],
    onTechHit: ['cfilter-itemLid', 'cfilter-itemId'],
    onMove: ['cfilter-boost'],
    onPreMove: ['cfilter-boost'],
    onInitActivation: ['cfilter-actionName'],
    onActivation: ['cfilter-actionName'],
    onDeploy: ['cfilter-itemLid', 'cfilter-itemId'],
    onCheck: ['cfilter-check'],
    onPreStatusApplied: ['cfilter-statusId'],
    onPreStatusRemoved: ['cfilter-statusId'],
    onStatusApplied: ['cfilter-statusId'],
    onStatusRemoved: ['cfilter-statusId']
};

/**
 * Generate inline trigger fields HTML for a given prefix (std/cust)
 */
function triggerFieldsHtml(prefix, tokensHtml) {
    return `
        <div class="form-group">
            <label>Consume on:</label>
            <div class="la-multi-select" id="${prefix}-trigger">
                <button type="button" class="la-multi-select-trigger">— Select —</button>
                <div class="la-multi-select-panel" id="${prefix}-trigger-panel">
                    ${consumptionTriggerCheckboxesHtml()}
                </div>
            </div>
        </div>
        <div id="${prefix}-trigger-fields" style="display:none;">
            <div class="form-group">
                <label>Origin:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="${prefix}-trigger-origin" style="flex:1;">
                        <option value="">Same as Target</option>
                        ${tokensHtml}
                    </select>
                    <button type="button" class="token-picker-btn" data-target="${prefix}-trigger-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
            </div>
            <div class="form-group cfilter-itemLid" style="display:none;">
                <label data-tooltip="Only consume a charge when this specific item is used. Leave empty to consume on any item.">Consume on item:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <input type="text" id="${prefix}-filter-itemLid" placeholder="e.g. mw_assault_rifle, mw_pistol" style="flex:1;">
                    <button type="button" class="find-lid-btn" data-target="${prefix}-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                </div>
            </div>
            <div class="form-group cfilter-itemId" style="display:none;">
                <label data-tooltip="Only consume a charge when this specific item (by actor item ID) is used.">Consume on item ID:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <input type="text" id="${prefix}-filter-itemId" placeholder="Item ID" style="flex:1;">
                    <button type="button" class="item-picker-btn" data-target="${prefix}-filter-itemId" data-token-source="${prefix}-target" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                </div>
            </div>
            <div class="form-group cfilter-actionName" style="display:none;">
                <label data-tooltip="Only consume a charge when this specific action is activated.">Consume on action:</label>
                <input type="text" id="${prefix}-filter-actionName" placeholder="e.g. Stabilize">
            </div>
            <div class="form-group cfilter-boost" style="display:none;">
                <label><input type="checkbox" id="${prefix}-filter-isBoost"> Boost only</label>
            </div>
            <div class="form-group cfilter-check" style="display:none;">
                <label>Check:</label>
                <input type="text" id="${prefix}-filter-checkType" placeholder="hull" style="width:50%;">
            </div>
            <div class="form-group cfilter-statusId" style="display:none;">
                <label data-tooltip="Only consume when one of these statuses is applied or removed (comma-separated).">Status:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <input type="text" id="${prefix}-filter-statusId" placeholder="e.g. lockon, shredded" style="flex:1;">
                    <button type="button" class="status-picker-btn" data-target="${prefix}-filter-statusId" style="flex:0 0 28px; padding:0;" title="Pick Status"><i class="fas fa-shield-alt"></i></button>
                </div>
            </div>
            ${codeFieldRow(`${prefix}-evaluate`, 'Evaluate', '(triggerType, triggerData, effectBearerToken, effect) => true')}
        </div>
    `;
}

/**
 * Setup trigger field toggle + item browser buttons for a given prefix
 */
function setupTriggerUI(html, prefix) {
    initLaMultiSelect(html, `${prefix}-trigger`);

    const updateTriggerFilterFields = () => {
        const triggers = $(`#${prefix}-trigger-panel input:checked`)
            .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
        const $fields = html.find(`#${prefix}-trigger-fields`);
        $fields.find('.form-group[class*="cfilter-"]').hide();
        if (triggers.length > 0) {
            $fields.show();
            const classes = new Set(triggers.flatMap(t => CONSUMPTION_FILTER_MAP[t] ?? []));
            classes.forEach(cls => $fields.find(`.${cls}`).show());
        } else {
            $fields.hide();
        }
        html.closest('.dialog').css('height', 'auto');
    };
    $(document).on('change', `#${prefix}-trigger-panel input[type=checkbox]`, updateTriggerFilterFields);

    html.find(`#${prefix}-trigger-fields .find-lid-btn`).on('click', function (e) {
        e.preventDefault();
        const targetId = $(this).data('target');
        openItemBrowser(html.find(`#${targetId}`));
    });

    html.find(`#${prefix}-trigger-fields .item-picker-btn`).on('click', async function (e) {
        e.preventDefault();
        const targetId = $(this).data('target');
        const tokenSourceId = $(this).data('token-source');

        let targetToken = null;
        if (tokenSourceId) {
            const tokenId = html.find(`#${tokenSourceId}`).val();
            targetToken = canvas.tokens.get(tokenId);
        }
        if (!targetToken)
            targetToken = canvas.tokens.controlled[0];

        if (!targetToken?.actor) {
            ui.notifications.warn("Please select a target token first.");
            return;
        }

        const items = targetToken.actor.items.filter(i => !['skill', 'talent', 'core_bonus', 'integrated'].includes(i.type));
        if (items.length === 0) {
            ui.notifications.warn(`${targetToken.name} has no valid items.`);
            return;
        }

        items.sort((a, b) => {
            if (a.type !== b.type)
                return a.type.localeCompare(b.type);
            return a.name.localeCompare(b.name);
        });

        const buildItemHtml = (item) => {
            const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
            const displayType = item.system?.type ? `${item.type.toUpperCase()} - ${item.system.type.toUpperCase()}` : item.type.toUpperCase();
            return `<div class="lancer-item-card actor-item-entry" data-id="${item.id}" style="margin-bottom:6px;padding:10px;cursor:pointer;display:flex;gap:10px;">
                <div style="width:32px;height:32px;background:url('${icon}') no-repeat center/contain;flex-shrink:0;"></div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:bold;">${item.name}</div>
                    <div style="font-size:0.85em;opacity:0.8;">[${displayType}]</div>
                </div>
            </div>`;
        };

        const pickerDialog = new Dialog({
            title: `Select Item on ${targetToken.name}`,
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <h1 class="lancer-dialog-title">Select Item on ${targetToken.name.toUpperCase()}</h1>
                    <p class="lancer-dialog-subtitle">Choose which item to filter consumption by.</p>
                </div>
                <div style="height:350px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                    ${items.map(buildItemHtml).join('')}
                </div>
            `,
            buttons: {
                cancel: { label: '<i class="fas fa-times"></i> Cancel', callback: () => {} }
            },
            render: (htmlContent) => {
                htmlContent.find('.actor-item-entry').on('click', (ev) => {
                    const id = $(ev.currentTarget).data('id');
                    html.find(`#${targetId}`).val(id).change();
                    pickerDialog.close();
                });
            },
            default: "cancel"
        }, { width: 500, classes: ["lancer-dialog-base", "lancer-no-title"] });
        pickerDialog.render(true);
    });

    html.find(`#${prefix}-trigger-fields .status-picker-btn`).on('click', function (e) {
        e.preventDefault();
        const targetId = $(this).data('target');
        openStatusPicker(html.find(`#${targetId}`));
    });
}

/**
 * Collect trigger/consumption config from form fields (no more 'uses')
 */
function getTriggerConfig(html, prefix) {
    const triggers = html.find(`#${prefix}-trigger input:checked`)
        .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
    if (triggers.length === 0)
        return null;

    const consumption = {
        trigger: triggers.length === 1 ? triggers[0] : triggers
    };
    const origin = html.find(`#${prefix}-trigger-origin`).val();
    if (origin)
        consumption.originId = origin;

    const itemLid = html.find(`#${prefix}-filter-itemLid`).val()?.trim();
    if (itemLid)
        consumption.itemLid = itemLid;
    const itemId = html.find(`#${prefix}-filter-itemId`).val()?.trim();
    if (itemId)
        consumption.itemId = itemId;
    const actionName = html.find(`#${prefix}-filter-actionName`).val()?.trim();
    if (actionName)
        consumption.actionName = actionName;
    const isBoost = html.find(`#${prefix}-filter-isBoost`).is(':checked');
    if (isBoost)
        consumption.isBoost = true;
    const checkType = html.find(`#${prefix}-filter-checkType`).val()?.trim();
    if (checkType)
        consumption.checkType = checkType;
    const statusId = html.find(`#${prefix}-filter-statusId`).val()?.trim();
    if (statusId)
        consumption.statusId = statusId;
    const evaluateSrc = String(html.find(`#${prefix}-evaluate-value`).val() || '').trim();
    if (evaluateSrc)
        consumption.evaluate = evaluateSrc;
    return consumption;
}

async function modifyEffectStack(targetID, effectID, delta) {
    const target = canvas.tokens.get(targetID);
    if (!target)
        return;

    const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
    if (customStatusApi) {
        await customStatusApi.modifyStack(target.actor, effectID, delta);

        const effect = target.actor.effects.get(effectID);
        if (effect) {
            const newStack = effect.getFlag("statuscounter", "value") || effect.getFlag("temporary-custom-statuses", "stack") || 1;
            if (newStack > 1) {
                await effect.update(/** @type {any} */({
                    "flags.statuscounter.visible": true
                }));
            }
        }
    } else {
        const effect = target.actor.effects.get(effectID);
        if (effect) {
            const currentStack = effect.getFlag("statuscounter", "value") || effect.getFlag("temporary-custom-statuses", "stack") || 1;
            const newStack = currentStack + delta;
            if (newStack <= 0)
                await effect.delete();
            else
                await effect.update(/** @type {any} */({
                    "flags.statuscounter.value": newStack,
                    "flags.statuscounter.visible": newStack > 1
                }));
        }
    }
}

async function pushRemoveEffect(targetID, effectID) {
    const target = canvas.tokens.get(targetID);
    if (!target)
        return;

    if (game.user.isGM) {
        await target.actor.deleteEmbeddedDocuments("ActiveEffect", [effectID]);
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "removeEffect",
            payload: {
                targetID,
                effectID
            }
        });
    }
}

// Helper: Fetch all tags from loaded Lancer compendiums
async function fetchAvailableTags() {
    let tags = [];
    // The Lancer core tags are typically in 'lancer-data.tags' or we can check all packs
    for (const pack of game.packs) {
        if (pack.metadata.type === "Item" && pack.metadata.packageName === "lancer-data") {
            const index = pack.index || await pack.getIndex({ fields: ["type", "system.lid", "system.val"] });
            for (const item of index) {
                if (item.type === "tag") {
                    tags.push({
                        id: item.system?.lid || item._id, // Use LID if available, fallback to ID
                        name: item.name,
                        val: item.system?.val || 0
                    });
                }
            }
        }
    }
    // Sort alphabetically
    tags.sort((a, b) => a.name.localeCompare(b.name));

    // Fallback if none found (e.g. system not fully loaded or different pack structure)
    if (tags.length === 0) {
        tags = [
            { id: "tg_accurate", name: "Accurate" },
            { id: "tg_inaccurate", name: "Inaccurate" },
            { id: "tg_reliable", name: "Reliable" },
            { id: "tg_ap", name: "Armor Piercing" },
            { id: "tg_knockback", name: "Knockback" },
            { id: "tg_overkill", name: "Overkill" },
            { id: "tg_heat_self", name: "Heat (Self)" },
            { id: "tg_burn", name: "Burn" },
            { id: "tg_smart", name: "Smart" },
            { id: "tg_seeking", name: "Seeking" },
            { id: "tg_arcing", name: "Arcing" }
        ];
    }
    return tags;
}

/**
 * Main Function: executeEffectManager
 * @returns {Promise<void>}
 */
export async function executeEffectManager(options = {}) {
    console.log('lancer-automations | Executing Effect Manager');

    const availableTags = await fetchAvailableTags();


    let defaultTarget = null;
    if (canvas.tokens.controlled.length > 0)
        defaultTarget = canvas.tokens.controlled[0];
    else if (game.user.targets.size > 0)
        defaultTarget = game.user.targets.first();

    const tokens = canvas.tokens.placeables;
    const tokensHtml = tokens.map(token => {
        const isSelf = token.id === defaultTarget?.id;
        return `<option value="${token.id}" ${isSelf ? 'selected' : ''}>${token.name}${isSelf ? ' (self)' : ''}</option>`;
    }).join('');

    let durations = [{
        label: 'end',
        turns: 1,
        rounded: 0,
        name: "End of Turn"
    },
    {
        label: 'start',
        turns: 1,
        rounded: 0,
        name: "Start of Turn"
    }
    ];
    // Permanent: same as indefinite at apply time, but survives Full Repair (snapshot/restore in lancer-modif.js).
    durations.push(
        { label: 'indefinite', turns: null, rounded: null, name: "Indefinite" },
        { label: 'permanent',  turns: null, rounded: null, name: "Permanent" }
    );

    if (!game.combat) {
        durations = durations.filter(duration => duration.label === 'indefinite' || duration.label === 'permanent');
    }

    const customStatusModule = game.modules.get("temporary-custom-statuses");
    const hasCustomStatus = customStatusModule?.active;
    const savedStatuses = hasCustomStatus ? (game.settings.get("temporary-custom-statuses", "savedStatuses") || []) : [];
    const allPresets = getStoredPresets();

    const defaultDuration = game.combat ? 'end' : 'indefinite';
    const durationOptionsHtml = durations.map(duration => `<option value="${duration.label}" ${duration.label === defaultDuration ? 'selected' : ''}>${duration.name}</option>`).join('');

    // Bonus tab: duration options (includes "None" for permanent bonuses with no icon).
    // 'permanent' is omitted here; bonuses use the "None" entry as their permanent option.
    const bonusDurationOptionsHtml = '<option value="">None (Permanent, no Icon)</option>' +
        durations.filter(duration => duration.label !== 'permanent').map(duration => `<option value="${duration.label}" ${duration.label === defaultDuration ? 'selected' : ''}>${duration.name}</option>`).join('');

    const dmgTypeOptionsHtml = ['Kinetic', 'Explosive', 'Energy', 'Heat', 'Burn', 'Infection', 'Variable']
        .map(dmgType => `<option value="${dmgType}">${dmgType}</option>`).join('');

    const statusEffectIconsHtml = [...CONFIG.statusEffects]
        .sort((a, b) => (game.i18n.localize(a.name) || a.name).localeCompare(game.i18n.localize(b.name) || b.name))
        .map(statusEffect => {
            const label = game.i18n.localize(statusEffect.name) || statusEffect.name;
            return `
        <div class="bonus-immunity-effect-option" data-effect="${statusEffect.name}" data-name="${label}" title="${label}" style="cursor:pointer; display:flex; align-items:center; gap:3px; padding:0 3px; border-radius:2px; border-left:3px solid transparent; background:#f5f5f5; color:#000; font-size:0.75em; min-width:0;">
            <img src="${statusEffect.img || statusEffect.icon}" style="width:20px; height:20px; object-fit:contain; flex-shrink:0; background:#2a2a2a; border-radius:2px; padding:1px; pointer-events:none;">
            <span class="la-hud-clip" style="flex:1; overflow:hidden; min-width:0; pointer-events:none;"><span class="la-hud-pan" style="display:inline-block; white-space:nowrap; padding-right:6px;">${label}</span></span>
        </div>`;
        }).join('');

    const damageTypes = [
        { name: 'Kinetic', icon: 'systems/lancer/assets/icons/white/damage_kinetic.svg' },
        { name: 'Energy', icon: 'systems/lancer/assets/icons/white/damage_energy.svg' },
        { name: 'Explosive', icon: 'systems/lancer/assets/icons/white/damage_explosive.svg' },
        { name: 'Heat', icon: 'systems/lancer/assets/icons/white/damage_heat.svg' },
        { name: 'Burn', icon: 'systems/lancer/assets/icons/white/damage_burn.svg' }
    ];
    const damageTypeIconsHtml = damageTypes.map(dmgType => `
        <div class="bonus-immunity-damage-option te-icon-option" data-type="${dmgType.name}" title="${dmgType.name}">
            <img src="${dmgType.icon}" width="24" height="24">
        </div>
    `).join('');

    const content = `
    <style>
        .te-dialog { min-width: 560px; font-family: var(--font-primary); }
        .te-tabs { display: flex; border-bottom: 3px solid var(--primary-color); margin-bottom: 8px; cursor: pointer; }
        .te-tab { padding: 8px 14px; font-weight: 600; opacity: 0.5; font-size: 0.9em; transition: all 0.2s ease; color: #000; border-bottom: 3px solid transparent; margin-bottom: -3px; }
        .te-tab:hover { opacity: 0.8; }
        .te-tab.active { opacity: 1; border-bottom-color: var(--primary-color); color: var(--primary-color); }
        .te-content { display: none; padding: 8px 0; }
        .te-content.active { display: block; }
        .te-dialog .form-group { margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .te-dialog .form-group label { flex: 0 0 70px; font-size: 0.85em; white-space: nowrap; font-weight: 600; color: #000; }
        .te-dialog .form-group select,
        .te-dialog .form-group input[type="text"],
        .te-dialog .form-group input[type="number"] { flex: 1; height: 26px; font-size: 0.9em; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; color: #000; padding: 0 6px; transition: border-color 0.2s ease; }
        .te-dialog .form-group select:focus,
        .te-dialog .form-group input:focus { border-color: var(--primary-color); outline: none; box-shadow: 0 0 4px color-mix(in srgb, var(--primary-color), transparent 70%); }
        .te-dialog .form-group.two-col { display: grid; grid-template-columns: 70px 1fr 70px 1fr; gap: 5px; align-items: center; }
        .te-dialog .form-group.two-col label { flex: unset; }
        .te-icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 4px; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 4px; border: 1px solid #ccc; }
        .te-icon-option { cursor: pointer; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid #ccc; border-radius: 4px; background: #1a1a1a; transition: all 0.2s; }
        .te-icon-option img { object-fit: contain; pointer-events: none; }
        .te-icon-option.selected { border: 2px solid var(--primary-color); box-shadow: 0 0 5px color-mix(in srgb, var(--primary-color), transparent 50%); }
        .std-effect-option:hover, .bonus-immunity-effect-option:hover { background: color-mix(in srgb, var(--primary-color) 18%, #f5f5f5) !important; }
        #std-effect-grid::-webkit-scrollbar,
        #bonus-immunity-effects::-webkit-scrollbar,
        .te-icon-grid::-webkit-scrollbar,
        .te-effect-list::-webkit-scrollbar { width: 10px; }
        #std-effect-grid::-webkit-scrollbar-track,
        #bonus-immunity-effects::-webkit-scrollbar-track,
        .te-icon-grid::-webkit-scrollbar-track,
        .te-effect-list::-webkit-scrollbar-track { background: #1a1a1a; border-radius: 3px; }
        #std-effect-grid::-webkit-scrollbar-thumb,
        #bonus-immunity-effects::-webkit-scrollbar-thumb,
        .te-icon-grid::-webkit-scrollbar-thumb,
        .te-effect-list::-webkit-scrollbar-thumb { background: var(--primary-color); border-radius: 3px; border: 2px solid #1a1a1a; }
        #std-effect-grid, #bonus-immunity-effects, .te-icon-grid, .te-effect-list { scrollbar-color: var(--primary-color) #1a1a1a; scrollbar-width: thin; }
        .te-effect-list { max-height: 200px; overflow-y: auto; padding: 4px; margin-bottom: 8px; }
        .te-effect-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; margin-bottom: 6px; font-size: 0.9em; transition: all 0.2s ease; }
        .te-effect-item:hover { border-color: var(--primary-color); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
        .te-effect-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .te-delete-btn { color: var(--primary-color); cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: all 0.2s ease; }
        .te-delete-btn:hover { background: #ffe0e0; }
        .te-btn-group { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
        .te-btn { background: #f5f5f5; border: 2px solid #555; color: #000; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; transition: all 0.2s ease; }
        .te-btn:hover { background: #ffe0e0; border-color: var(--primary-color); box-shadow: 0 2px 8px rgba(0,0,0,0.3); transform: translateY(-1px); }
        .te-btn i { margin-right: 5px; color: var(--primary-color); }
        .te-stack-ctrl { display: flex; gap: 4px; }
        .te-stack-ctrl i { cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: all 0.2s ease; color: var(--primary-color); }
        .te-stack-ctrl i:hover { background: #ffe0e0; }
        .te-divider { border: none; border-top: 2px solid var(--primary-color); margin: 10px 0; }
        .te-section-title { font-weight: 600; color: var(--primary-color); font-size: 13px; margin: 8px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .te-section { font-weight: 700; color: var(--primary-color); font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.6px; margin: 10px 0 4px; padding: 0 0 3px 2px; border-bottom: 1px solid color-mix(in srgb, var(--primary-color) 35%, transparent); }
        .te-section:first-child { margin-top: 0; }
        .te-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .te-row-2col > .form-group { margin-bottom: 0; }
        .te-advanced { margin-top: 8px; }
        .te-advanced > summary { cursor: pointer; font-weight: 700; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.6px; color: #555; padding: 5px 2px; border-top: 1px dashed #bbb; user-select: none; list-style: none; }
        .te-advanced > summary::before { content: "\\25B6"; display: inline-block; margin-right: 6px; transition: transform 0.15s ease; font-size: 0.7em; color: var(--primary-color); }
        .te-advanced[open] > summary::before { transform: rotate(90deg); }
        .te-advanced[open] > summary { color: var(--primary-color); border-top-color: var(--primary-color); }
        .te-advanced > summary::-webkit-details-marker { display: none; }
        .code-field-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; height: 26px; background: #f5f5f5; border: 1.5px solid #999; border-radius: 13px; font-size: 0.82em; cursor: pointer; flex: 0 0 auto; transition: all 0.15s ease; color: #555; }
        .code-field-badge:hover { border-color: var(--primary-color); background: #fff; }
        .code-field-badge .code-field-dot { width: 8px; height: 8px; border-radius: 50%; background: #bbb; flex: 0 0 8px; }
        .code-field-badge.has-value { border-color: #4a8a3a; background: #e6f3e0; color: #2d5a1f; font-weight: 600; }
        .code-field-badge.has-value .code-field-dot { background: #4a8a3a; box-shadow: 0 0 4px rgba(74,138,58,0.5); }
        .bonus-summary-pill { flex: 0 0 auto; padding: 2px 8px; background: #eee; border-radius: 10px; font-size: 0.72em; color: #888; font-weight: 600; text-align: center; min-width: 36px; }
        .bonus-summary-pill.has-bonuses { background: #d6e8d2; color: #2d5a1f; }
        .preset-bar { display: flex; gap: 6px; align-items: center; padding: 4px 6px; margin-bottom: 6px; background: rgba(0,0,0,0.04); border-radius: 4px; border: 1px dashed #bbb; }
        .preset-bar label { flex: 0 0 50px; font-size: 0.8em; font-weight: 600; color: #555; text-transform: uppercase; letter-spacing: 0.3px; }
        .preset-bar select { flex: 1; height: 24px; font-size: 0.85em; }
        .te-btn-icon { background: #f5f5f5; border: 1.5px solid #999; border-radius: 4px; cursor: pointer; color: var(--primary-color); }
        .te-btn-icon:hover { background: #ffe0e0; border-color: var(--primary-color); }
        .te-bonus-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; margin-bottom: 4px; font-size: 0.9em; transition: all 0.2s ease; }
        .te-bonus-item:hover { border-color: var(--primary-color); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
    </style>
    <div class="te-dialog lancer-dialog-base">
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">Effect Manager</div>
        </div>
        <div class="te-tabs">
            <div class="te-tab active" data-tab="standard">Standard</div>
            ${hasCustomStatus ? '<div class="te-tab" data-tab="custom">Custom</div>' : ''}
            <div class="te-tab" data-tab="bonus">Bonus</div>
            <div class="te-tab" data-tab="manage">Manage <span id="manage-tab-count" style="font-size:0.75em; opacity:0.7;"></span></div>
        </div>

        <!-- STANDARD TAB -->
        <div class="te-content active" id="tab-standard">
            ${presetBarHtml('std', allPresets.standard)}
            <div class="te-section">Effect</div>
            <div class="form-group">
                <label>Target:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="std-target" style="flex:1;">${tokensHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="std-target" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
            </div>
            <div class="form-group" style="flex-direction: column; align-items: stretch; gap: 8px;">
                <div style="display:flex; justify-content:space-between; align-items: center;">
                    <label>Apply:</label>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <span id="std-effect-label" style="font-weight:bold; color:var(--primary-color);">Bolster</span>
                        <img id="std-effect-icon" src="" width="30" height="30" style="border:2px solid var(--primary-color); border-radius:4px; background:#1a1a1a; display:block; object-fit: contain; padding:2px;">
                        x<input type="number" id="std-stack" value="1" min="1" style="width: 45px; height:30px; text-align:center;">
                    </div>
                </div>
                <input type="hidden" id="std-effect" value="Bolster">
                <input type="text" id="std-effect-search" placeholder="Search effects..." style="height:24px; font-size:0.85em; padding:0 6px;">
                <div id="std-effect-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1px; max-height:180px; overflow-y:auto; padding:3px; background:#f5f5f5; border-radius:4px; border:1px solid #ccc;">
                     ${[...CONFIG.statusEffects].sort((a, b) => (game.i18n.localize(a.name) || a.name).localeCompare(game.i18n.localize(b.name) || b.name)).map(s => {
        const label = game.i18n.localize(s.name);
        return `
                        <div class="std-effect-option" data-id="${s.name}" data-name="${label}" data-icon="${s.img || s.icon}" title="${label}" style="cursor:pointer; display:flex; align-items:center; gap:3px; padding:0 3px; border-radius:2px; border-left:3px solid transparent; background:#f5f5f5; color:#000; font-size:0.75em; min-width:0;">
                            <img src="${s.img || s.icon}" style="width:20px; height:20px; object-fit:contain; flex-shrink:0; background:#2a2a2a; border-radius:2px; padding:1px; pointer-events:none;" title="${label}">
                            <span class="la-hud-clip" style="flex:1; overflow:hidden; min-width:0; pointer-events:none;"><span class="la-hud-pan" style="display:inline-block; white-space:nowrap; padding-right:6px;">${label}</span></span>
                        </div>`;
    }).join('')}
                </div>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="std-duration" style="flex:0 0 110px;">${durationOptionsHtml}</select>
                    <span class="dur-opts" style="flex-shrink:0;"> of </span>
                    <div class="dur-opts" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="std-origin" style="flex:1; min-width:0;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="std-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts" style="margin-left:5px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="std-turns" value="1" min="1" class="dur-opts" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="std-note" placeholder="Optional note">
            </div>
            <div class="te-section">Consumption</div>
            ${triggerFieldsHtml('std', tokensHtml)}
            <div class="te-btn-group">
                <button type="button" class="te-btn save-preset-btn" data-prefix="std"><i class="fas fa-bookmark"></i> Save Preset</button>
                <button type="button" class="te-btn apply-btn" data-tab="standard"><i class="fas fa-check"></i> Apply</button>
            </div>
        </div>

        <!-- CUSTOM TAB -->
        ${hasCustomStatus ? `
        <div class="te-content" id="tab-custom">
            ${presetBarHtml('cust', allPresets.custom)}
            <div class="te-section">Effect</div>
            <div class="form-group two-col">
                <label>Target:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="cust-target" style="flex:1;">${tokensHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="cust-target" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
                <label style="text-align:right; padding-right:5px;">Saved:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="cust-saved-icon" src="" width="26" height="26" style="border:2px solid #999; border-radius:4px; background:#1a1a1a; display:none; object-fit: contain;">
                    <select id="cust-saved" style="flex:1;">
                        <option value="">-- Select --</option>
                        ${savedStatuses.map(s => `<option value="${s.name}" data-icon="${s.icon}">${s.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group two-col" style="grid-template-columns: 80px 1fr 60px 60px;">
                <label>Name:</label>
                <div style="display:flex; gap:4px; align-items:center; min-width:0; width:100%;">
                    <input type="text" id="cust-name" placeholder="Status Name" style="flex:1; min-width:0;">
                    <button type="button" class="save-status-btn" title="Save Status (add Name + Icon to the Saved list)" style="flex:0 0 28px; width:28px; height:28px; padding:0; line-height:1;"><i class="fas fa-save"></i></button>
                </div>
                <label style="text-align:right; padding-right:5px;">Stack:</label>
                <input type="number" id="cust-stack" value="1" min="1">
            </div>
            <div class="form-group">
                <label>Icon:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="cust-icon-preview" src="systems/lancer/assets/icons/white/d20-framed.svg" style="width:26px; height:26px; flex:0 0 26px; object-fit:contain; background:#1a1a1a; border:2px solid #999; border-radius:4px; padding:1px;" onerror="this.style.opacity='0.3';">
                    <input type="text" id="cust-icon" value="systems/lancer/assets/icons/white/d20-framed.svg" style="flex:1; min-width:0;">
                    <button type="button" class="file-picker" data-type="image" data-target="cust-icon" title="Browse Files" tabindex="-1" style="flex:0 0 30px;"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="cust-duration" style="flex:0 0 110px;">${durationOptionsHtml}</select>
                    <span class="dur-opts" style="flex-shrink:0;"> of </span>
                    <div class="dur-opts" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="cust-origin" style="flex:1; min-width:0;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="cust-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts" style="margin-left:5px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="cust-turns" value="1" min="1" class="dur-opts" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="cust-note" placeholder="Optional note">
            </div>
            <div class="te-section">Consumption</div>
            ${triggerFieldsHtml('cust', tokensHtml)}
            <details class="te-advanced">
                <summary>Advanced</summary>
                ${codeFieldRow('cust-changes', 'Active Effect Changes', '[{"key":"system.armor","mode":2,"value":"1"}]')}
            </details>
            <div class="te-btn-group">
                <button type="button" class="te-btn save-preset-btn" data-prefix="cust"><i class="fas fa-bookmark"></i> Save Preset</button>
                <button type="button" class="te-btn apply-btn" data-tab="custom"><i class="fas fa-check"></i> Apply</button>
            </div>
        </div>
        ` : ''}

        <!-- MANAGE TAB -->
        <div class="te-content" id="tab-manage">
            <div class="form-group">
                <label>Token:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="manage-target" style="flex:1;">${tokensHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="manage-target" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
            </div>
            <div class="te-effect-list" id="manage-list">
                <p style="text-align:center">Loading...</p>
            </div>
            <div id="manage-bonus-list"></div>
            <div class="te-btn-group">
                <button type="button" class="te-btn manage-close"><i class="fas fa-times"></i> Close</button>
            </div>
        </div>

        <!-- BONUS TAB -->
        <div class="te-content" id="tab-bonus">
            ${presetBarHtml('bonus', allPresets.bonus)}
            <div class="form-group">
                <label>Token:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="bonus-target" style="flex:1;">${tokensHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="bonus-target" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
                <span id="bonus-summary" class="bonus-summary-pill">—</span>
            </div>
            <div class="te-section">Add New Bonus</div>
            <div class="form-group">
                <label>Name:</label>
                <input type="text" id="bonus-name" value="Test Bonus">
            </div>
            <div class="form-group">
                <label>Icon:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="bonus-icon-preview" src="" style="width:26px; height:26px; flex:0 0 26px; object-fit:contain; background:#1a1a1a; border:2px solid #999; border-radius:4px; padding:1px;" onerror="this.style.opacity='0.3';">
                    <input type="text" id="bonus-icon" placeholder="Auto (based on bonus type)" style="flex:1; min-width:0;">
                    <button type="button" class="file-picker" data-type="image" data-target="bonus-icon" title="Browse Files" tabindex="-1" style="flex:0 0 30px;"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Duration:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="bonus-duration" style="flex:0 0 120px !important; width:120px !important; max-width:120px !important;">${bonusDurationOptionsHtml}</select>
                    <span class="bonus-dur-opts" style="flex-shrink:0;"> of </span>
                    <div class="bonus-dur-opts" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="bonus-durOrigin" style="flex:1; min-width:0;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="bonus-durOrigin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="bonus-dur-opts" style="margin-left:3px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="bonus-durTurns" value="1" min="1" class="bonus-dur-opts" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group" style="justify-content:flex-start;">
                <label style="flex:0 0 70px;">Uses:</label>
                <div style="display:flex; gap:4px; align-items:center;">
                    <button type="button" class="bonus-uses-step" data-step="-1" title="Decrement" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-uses" placeholder="Infinite" min="1" style="flex:0 0 70px; min-width:70px; max-width:70px; text-align:center;">
                    <button type="button" class="bonus-uses-step" data-step="1" title="Increment" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div class="te-section">Type</div>
            <div style="display:flex; gap:10px; align-items:flex-start;">
                <div class="form-group" style="flex:1; margin:0;">
                    <label>Bonus Type:</label>
                    <select id="bonus-type">
                        <option value="stat">Stat</option>
                        <option value="roll">Roll (Acc/Diff)</option>
                        <option value="damage">Damage</option>
                        <option value="tag">Tag</option>
                        <option value="range">Range</option>
                        <option value="immunity">Immunity</option>
                        <option value="target_modifier">Target Modifier</option>
                        <option value="reroll">Reroll</option>
                    </select>
                </div>
                <div class="form-group" style="flex:1; margin:0;">
                    <label>Consume on:</label>
                    <div class="la-multi-select" id="bonus-trigger">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel">
                            ${consumptionTriggerCheckboxesHtml()}
                        </div>
                    </div>
                </div>
            </div>
            <div id="bonus-trigger-fields" style="display:none;">
                <div class="form-group">
                    <label>Origin:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <select id="bonus-trigger-origin" style="flex:1;">
                            <option value="">Same as Target</option>
                            ${tokensHtml}
                        </select>
                        <button type="button" class="token-picker-btn" data-target="bonus-trigger-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-itemLid" style="display:none;">
                    <label data-tooltip="Only consume a charge when this specific item is used. Leave empty to consume on any item.">Consume on item:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-filter-itemLid" placeholder="e.g. mw_assault_rifle" style="flex:1;">
                        <button type="button" class="find-lid-btn" data-target="bonus-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-itemId" style="display:none;">
                    <label data-tooltip="Only consume a charge when this specific item (by actor item ID) is used.">Consume on item ID:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-filter-itemId" placeholder="Item ID" style="flex:1;">
                        <button type="button" class="item-picker-btn" data-target="bonus-filter-itemId" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-actionName" style="display:none;">
                    <label data-tooltip="Only consume a charge when this specific action is activated.">Consume on action:</label>
                    <input type="text" id="bonus-filter-actionName" placeholder="e.g. Stabilize">
                </div>
                <div class="form-group bonus-filter-statusId" style="display:none;">
                    <label data-tooltip="Only consume when one of these statuses is applied or removed (comma-separated).">Status:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-filter-statusId" placeholder="e.g. lockon, shredded" style="flex:1;">
                        <button type="button" class="bonus-status-picker-btn" data-target="bonus-filter-statusId" style="flex:0 0 28px; padding:0;" title="Pick Status"><i class="fas fa-shield-alt"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-boost" style="display:none;">
                    <label><input type="checkbox" id="bonus-filter-isBoost"> Boost only</label>
                </div>
                <div class="form-group bonus-filter-distance" style="display:none;">
                    <label>Min distance:</label>
                    <input type="number" id="bonus-filter-minDistance" placeholder="0" min="0">
                </div>
                <div class="form-group bonus-filter-check" style="display:none;">
                    <label>Check type:</label>
                    <input type="text" id="bonus-filter-checkType" placeholder="e.g. hull">
                </div>
                <div class="form-group bonus-filter-checkValues" style="display:none;">
                    <label>Above:</label>
                    <input type="number" id="bonus-filter-checkAbove" placeholder="any" style="width:40%;">
                    <label>Below:</label>
                    <input type="number" id="bonus-filter-checkBelow" placeholder="any" style="width:40%;">
                </div>
            </div>
            <div id="bonus-type-stat">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div class="form-group" style="flex:1; min-width:0; margin:0;">
                        <label>Stat:</label>
                        <select id="bonus-stat" style="min-width:0;">
                            <optgroup label="Resources (Max)">
                                <option value="system.hp.max">HP (Max)</option>
                                <option value="system.heat.max">Heat Cap (Max)</option>
                                <option value="system.repairs.max">Repair Cap (Max)</option>
                                <option value="system.structure.max">Structure (Max)</option>
                                <option value="system.stress.max">Stress (Max)</option>
                            </optgroup>
                            <optgroup label="Resources (Current)">
                                <option value="system.hp.value">HP (Current)</option>
                                <option value="system.heat.value">Heat (Current)</option>
                                <option value="system.overshield.value">Overshield</option>
                                <option value="system.burn">Burn</option>
                                <option value="system.repairs.value">Repairs (Current)</option>
                            </optgroup>
                            <optgroup label="Stats">
                                <option value="system.speed">Speed</option>
                                <option value="system.evasion">Evasion</option>
                                <option value="system.edef">E-Defense</option>
                                <option value="system.save">Save Target</option>
                                <option value="system.sensor_range">Sensor Range</option>
                                <option value="system.tech_attack">Tech Attack</option>
                                <option value="system.armor">Armor</option>
                                <option value="system.size">Size</option>
                            </optgroup>
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; margin:0; display:flex; gap:6px; align-items:center; justify-content:flex-start;">
                        <label style="flex:0 0 auto;">Value:</label>
                        <button type="button" class="la-num-step" data-target="bonus-statVal" data-step="-1" title="Decrement" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                        <input type="number" id="bonus-statVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; font-size:0.9em; border:2px solid #999; border-radius:4px;">
                        <button type="button" class="la-num-step" data-target="bonus-statVal" data-step="1" title="Increment" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
            </div>
            <div id="bonus-type-roll" style="display:none;">
                <div style="display:flex; gap:10px; align-items:flex-start;">
                    <div class="form-group" style="flex:1; min-width:0; margin:0;">
                        <label>Bonus Roll Type:</label>
                        <select id="bonus-rollType" style="min-width:0;">
                            <option value="accuracy">Accuracy</option>
                            <option value="difficulty">Difficulty</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; margin:0; display:flex; gap:6px; align-items:center; justify-content:flex-start;">
                        <label style="flex:0 0 auto;">Value:</label>
                        <button type="button" class="la-num-step" data-target="bonus-accDiffVal" data-step="-1" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                        <input type="number" id="bonus-accDiffVal" value="1" min="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; font-size:0.9em; border:2px solid #999; border-radius:4px;">
                        <button type="button" class="la-num-step" data-target="bonus-accDiffVal" data-step="1" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
            </div>
            <div id="bonus-type-damage" style="display:none;">
                <div id="bonus-damage-list">
                    <div class="bonus-damage-entry form-group" data-index="0">
                        <input type="text" id="bonus-dmgVal-0" value="1d6" placeholder="1d6" style="flex:1;">
                        <select id="bonus-dmgType-0" style="flex:1;">${dmgTypeOptionsHtml}</select>
                        <button type="button" class="bonus-remove-dmg te-delete-btn" data-index="0" style="flex:0 0 22px;"><i class="fas fa-times"></i></button>
                    </div>
                </div>
                <div style="display:flex; gap:8px; margin-top:6px;">
                    <button type="button" class="te-btn" id="bonus-add-dmg-entry" style="flex:1;"><i class="fas fa-plus"></i> Add Damage Entry</button>
                </div>
            </div>
            <div id="bonus-type-tag" style="display:none;">
                <div class="form-group">
                    <label>Tag:</label>
                    <select id="bonus-tagSelect">
                        ${availableTags.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="justify-content:flex-start;">
                    <label>Mode:</label>
                    <select id="bonus-tagMode" style="flex:0.6;">
                        <option value="add">Add Value</option>
                        <option value="override">Override Value</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <button type="button" class="la-num-step" data-target="bonus-tagVal" data-step="-1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-tagVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; border:2px solid #999; border-radius:4px;">
                    <button type="button" class="la-num-step" data-target="bonus-tagVal" data-step="1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                </div>
                <div class="form-group" style="justify-content:flex-start;">
                    <label style="width: auto; margin-right: 5px;">Remove Tag instead:</label>
                    <input type="checkbox" id="bonus-removeTag" style="width: auto;">
                </div>
            </div>
            <div id="bonus-type-range" style="display:none;">
                <div class="form-group">
                    <label>Range Type:</label>
                    <select id="bonus-rangeType">
                        <option value="Range">Range</option>
                        <option value="Threat">Threat</option>
                        <option value="Blast">Blast</option>
                        <option value="Burst">Burst</option>
                        <option value="Cone">Cone</option>
                        <option value="Line">Line</option>
                    </select>
                </div>
                <div class="form-group" style="justify-content:flex-start;">
                    <label>Mode:</label>
                    <select id="bonus-rangeMode" style="flex:0.6;">
                        <option value="add">Add Value</option>
                        <option value="override">Override Value</option>
                        <option value="change">Change All Ranges</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <button type="button" class="la-num-step" data-target="bonus-rangeVal" data-step="-1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-rangeVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; border:2px solid #999; border-radius:4px;">
                    <button type="button" class="la-num-step" data-target="bonus-rangeVal" data-step="1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div id="bonus-type-immunity" style="display:none;">
                <div class="form-group">
                    <label>Immunity Subtype:</label>
                    <select id="bonus-immunity-subtype">
                        <option value="effect">Effect</option>
                        <option value="damage">Damage</option>
                        <option value="resistance">Resistance</option>
                        <option value="crit">Critical Hit</option>
                        <option value="hit">Hit</option>
                        <option value="miss">Miss</option>
                        <option value="elevation">Elevation</option>
                        <option value="terrain">Terrain</option>
                        <option value="provoke">Provoke (Engagement &amp; Reactions)</option>
                    </select>
                </div>
                <div id="bonus-immunity-effects-row">
                    <label style="display:block; font-weight:600; font-size:0.85em; margin-bottom:4px;">Select Status Effects:</label>
                    <input type="text" id="bonus-immunity-effect-search" placeholder="Search effects..." style="width:100%; height:24px; font-size:0.85em; padding:0 6px; margin-bottom:4px;">
                    <div id="bonus-immunity-effects" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1px; max-height:180px; overflow-y:auto; padding:3px; background:#f5f5f5; border-radius:4px; border:1px solid #ccc;">
                        ${statusEffectIconsHtml}
                    </div>
                </div>
                <div id="bonus-immunity-damage-row" style="display:none;">
                    <label style="display:block; font-weight:600; font-size:0.85em; margin-bottom:4px;">Select Damage Types:</label>
                    <div class="te-icon-grid" id="bonus-immunity-damageTypes">
                        ${damageTypeIconsHtml}
                    </div>
                </div>
            </div>
            <div id="bonus-type-target_modifier" style="display:none;">
                <div class="form-group">
                    <label>Target Modifier:</label>
                    <select id="bonus-target-modifier-subtype">
                        <option value="invisible">Invisible (50% miss)</option>
                        <option value="no_invisible">Not Invisible (ignore 50% miss)</option>
                        <option value="no_cover">No Cover</option>
                        <option value="soft_cover">Soft Cover</option>
                        <option value="hard_cover">Hard Cover</option>
                        <option value="ap">Armor Piercing (AP)</option>
                        <option value="half_damage">Half Damage</option>
                        <option value="paracausal">Cannot be Reduced</option>
                        <option value="crit">Force Crit</option>
                        <option value="hit">Force Hit</option>
                        <option value="miss">Force Miss</option>
                    </select>
                </div>
            </div>
            <div id="bonus-type-reroll" style="display:none;">
                <div class="form-group">
                    <label>Subtype:</label>
                    <select name="reroll-subtype" id="bonus-reroll-subtype">
                        <option value="retry">Retry</option>
                        <option value="highest">Highest</option>
                        <option value="lowest">Lowest</option>
                        <option value="choose">Choose</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Roll Types (empty = all):</label>
                    <div class="la-multi-select" id="bonus-reroll-rollTypes">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel">
                            <label><input type="checkbox" value="attackRoll"> Attack Roll</label>
                            <label><input type="checkbox" value="techAttackRoll"> Tech Attack Roll</label>
                            <label><input type="checkbox" value="damageRoll"> Damage Roll</label>
                            <label><input type="checkbox" value="skillRoll"> Skill / Check / Save Roll</label>
                            <label><input type="checkbox" value="structureRoll"> Structure Roll</label>
                            <label><input type="checkbox" value="stressRoll"> Stress Roll</label>
                        </div>
                    </div>
                </div>
            </div>
            <div id="bonus-items-row" style="display:none;">
                <div class="form-group" id="row-bonus-rollTypes-roll" style="display:none;">
                    <label>Roll Type:</label>
                    <div class="la-multi-select" id="bonus-rollTypes-roll">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel">
                            <label><input type="checkbox" value="all"> All Flows</label>
                            <label><input type="checkbox" value="attack"> Weapon Attacks</label>
                            <label><input type="checkbox" value="tech_attack"> Tech Attacks</label>
                            <label><input type="checkbox" value="melee"> Melee Attacks</label>
                            <label><input type="checkbox" value="ranged"> Ranged Attacks</label>
                            <label><input type="checkbox" value="nexus"> Nexus Attacks</label>
                            <label><input type="checkbox" value="tech"> Tech (Item Type)</label>
                            <label><input type="checkbox" value="check"> Checks (All)</label>
                            <label><input type="checkbox" value="hull"> Hull Check</label>
                            <label><input type="checkbox" value="agility"> Agility Check</label>
                            <label><input type="checkbox" value="systems"> Systems Check</label>
                            <label><input type="checkbox" value="engineering"> Engineering Check</label>
                            <label><input type="checkbox" value="grit"> Grit Check</label>
                            <label><input type="checkbox" value="tier"> Tier Check (NPC)</label>
                            <label><input type="checkbox" value="structure"> Structure Roll</label>
                            <label><input type="checkbox" value="overheat"> Overheat Roll</label>
                        </div>
                    </div>
                </div>
                <div class="form-group" id="row-bonus-rollTypes-damage" style="display:none;">
                    <label>Damage Roll Type:</label>
                    <div class="la-multi-select" id="bonus-rollTypes-damage">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel">
                            <label><input type="checkbox" value="all"> All Damage</label>
                            <label><input type="checkbox" value="melee"> Melee Damage</label>
                            <label><input type="checkbox" value="ranged"> Ranged Damage</label>
                            <label><input type="checkbox" value="nexus"> Nexus Damage</label>
                            <label><input type="checkbox" value="tech"> Tech Damage</label>
                        </div>
                    </div>
                </div>
                <details class="te-advanced">
                    <summary>Filters</summary>
                    <div class="te-row-2col">
                        <div class="form-group">
                            <label data-tooltip="Only apply this bonus when using these specific items (by LID). Leave empty to apply to all weapons.">Items (LID):</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-itemLids" placeholder="e.g. mb_knife, cqb_shotgun" style="flex:1;">
                                <button type="button" class="find-lid-btn" data-target="bonus-itemLids" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                            </div>
                        </div>
                        <div class="form-group">
                            <label data-tooltip="Apply this bonus selectively to a specific item ID on an actor.">Item ID:</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-itemId" placeholder="Item ID" style="flex:1;">
                                <button type="button" class="item-picker-btn" data-target="bonus-itemId" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="te-row-2col">
                        <div class="form-group">
                            <label data-tooltip="Apply this bonus to specific token IDs. Use the selector to pick tokens from the map.">Tokens:</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-applyTo" placeholder="Token IDs" style="flex:1;">
                                <button type="button" class="token-picker-btn" data-target="bonus-applyTo" data-count="-1" style="flex:0 0 28px; padding:0;" title="Select Tokens"><i class="fas fa-crosshairs"></i></button>
                            </div>
                        </div>
                        <div class="form-group" style="justify-content:flex-start;">
                            <label data-tooltip="If checked, this bonus is applied by the target to the attacker. Useful for debuffing attackers." style="flex:0 0 auto; margin-right:6px;">Targetter:</label>
                            <input type="checkbox" id="bonus-applyToTargetter" style="margin:0; width:min-content; flex:0 0 auto;">
                        </div>
                    </div>
                </details>
                <details class="te-advanced">
                    <summary>Advanced</summary>
                    ${codeFieldRow('bonus-condition', 'Condition', '(state, actor, data, context) => true')}
                    ${codeFieldRow('bonus-applyToCondition', 'Apply-to Condition', '(target, state, reactorToken) => true')}
                </details>
            </div>
            <div class="te-btn-group">
                <button type="button" class="te-btn save-preset-btn" data-prefix="bonus"><i class="fas fa-bookmark"></i> Save Preset</button>
                <button type="button" class="te-btn" id="bonus-add"><i class="fas fa-plus-circle"></i> Add Bonus</button>
            </div>
            <hr class="te-divider">
            <button type="button" class="te-btn" id="bonus-clear-all" style="width:100%; border-color:var(--primary-color);"><i class="fas fa-trash"></i> Clear All Bonuses</button>
        </div>
    </div>
    `;

    const dialog = new Dialog({
        title: "Effect Manager",
        content: content,
        buttons: {},
        render: (html) => {
            const root = html[0] ?? html.get(0);
            const dlg = /** @type {any} */ (dialog);

            const _rebuildDurationSelects = () => {
                const inCombat = !!game.combat;
                const def = inCombat ? 'end' : 'indefinite';
                const opts = '<option value="end">End of Turn</option><option value="start">Start of Turn</option><option value="indefinite">Indefinite</option><option value="permanent">Permanent</option>';
                const bonusOpts = '<option value="end">End of Turn</option><option value="start">Start of Turn</option><option value="indefinite">Indefinite</option>';
                const noteHtml = inCombat
                    ? ''
                    : '<span class="la-em-oocombat-note" style="font-size:0.78em; font-style:italic; color:#a05; margin-left:6px;">⚠ no combat: turn-based won\'t tick</span>';
                for (const id of ['#std-duration', '#cust-duration']) {
                    const $sel = html.find(id);
                    if (!$sel.length)
                        continue;
                    const cur = String($sel.val() ?? '');
                    $sel.html(opts);
                    $sel.val($sel.find(`option[value="${cur}"]`).length ? cur : def);
                    $sel.siblings('.la-em-oocombat-note').remove();
                    if (noteHtml)
                        $sel.after(noteHtml);
                    $sel.trigger('change');
                }
                const $bonusSel = html.find('#bonus-duration');
                if ($bonusSel.length) {
                    const bonusCur = String($bonusSel.val() ?? '');
                    $bonusSel.html('<option value="">None (Permanent, no Icon)</option>' + bonusOpts);
                    $bonusSel.val(($bonusSel.find(`option[value="${bonusCur}"]`).length ? bonusCur : def));
                    $bonusSel.siblings('.la-em-oocombat-note').remove();
                    if (noteHtml)
                        $bonusSel.after(noteHtml);
                    $bonusSel.trigger('change');
                }
            };
            const _onCombatChange = () => _rebuildDurationSelects();
            Hooks.on('createCombat', _onCombatChange);
            Hooks.on('deleteCombat', _onCombatChange);
            Hooks.on('combatStart', _onCombatChange);
            dlg._laCombatHooks = _onCombatChange;

            if (root && typeof ResizeObserver !== 'undefined' && !dlg._laResizeObserver) {
                let lastH = 0;
                let raf = 0;
                const refit = () => {
                    raf = 0;
                    if (!dlg.element?.length)
                        return;
                    const h = root.scrollHeight;
                    if (h === lastH || h === 0)
                        return;
                    lastH = h;
                    dlg.setPosition(/** @type {any} */ ({ height: 'auto', left: dlg.position.left, top: dlg.position.top }));
                };
                const ro = new ResizeObserver(() => {
                    if (raf) cancelAnimationFrame(raf);
                    raf = requestAnimationFrame(refit);
                });
                ro.observe(root);
                dlg._laResizeObserver = ro;
            }

            // Tabs
            html.find('.te-tab').click(e => {
                const tab = $(e.currentTarget).data('tab');
                html.find('.te-tab').removeClass('active');
                html.find('.te-content').removeClass('active');
                $(e.currentTarget).addClass('active');
                html.find(`#tab-${tab}`).addClass('active');
                if (tab === 'manage')
                    updateManageList();
                if (tab === 'bonus')
                    updateBonusList();
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            // Duration toggle
            const toggleDurOpts = (prefix) => {
                const val = html.find(`#${prefix}-duration`).val();
                if (val === 'indefinite' || val === 'permanent') {
                    html.find(`#${prefix}-duration`).siblings('.dur-opts').hide();
                } else {
                    html.find(`#${prefix}-duration`).siblings('.dur-opts').show();
                }
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            };
            html.find('#std-duration').change(() => toggleDurOpts('std'));
            html.find('#cust-duration').change(() => toggleDurOpts('cust'));
            toggleDurOpts('std');
            toggleDurOpts('cust');

            // Trigger UI setup
            setupTriggerUI(html, 'std');
            setupTriggerUI(html, 'cust');

            // Close button
            html.find('.manage-close').click(() => dialog.close());

            const _syncIconPreview = (inputId) => {
                const path = String(html.find(`#${inputId}`).val() ?? '');
                const $img = html.find(`#${inputId}-preview`);
                if ($img.length) {
                    $img.attr('src', path);
                    $img[0].style.opacity = '1';
                }
            };
            const _syncCustIconPreview = () => _syncIconPreview('cust-icon');

            // File Picker — honors the button's data-target so each input has its own.
            html.find('.file-picker').click(function () {
                const targetId = $(this).data('target') || 'cust-icon';
                const input = html.find(`#${targetId}`);
                new FilePicker({
                    type: "image",
                    callback: (path) => {
                        input.val(path);
                        _syncIconPreview(targetId);
                    }
                }).browse(String(input.val()));
            });

            html.find('#cust-icon').on('input change', _syncCustIconPreview);
            html.find('#bonus-icon').on('input change', () => _syncIconPreview('bonus-icon'));

            const _findStatusDesc = (id) => {
                const s = (CONFIG.statusEffects ?? []).find(x => x.id === id || x.name === id);
                if (!s)
                    return '';
                const desc = /** @type {any} */ (s).description;
                return typeof desc === 'string' && desc.trim() ? desc : '';
            };
            let _laHoverTip = null;
            const _hideEffectTooltip = () => {
                _laHoverTip?.remove();
                _laHoverTip = null;
            };
            const _showEffectTooltip = (anchor, label, desc) => {
                _hideEffectTooltip();
                if (!desc)
                    return;
                const tip = $(`<div class="la-status-tooltip" style="position:fixed;z-index:9999;background:#1a1a1a;color:#eee;border:1px solid #555;border-radius:3px;padding:6px 8px;max-width:280px;font-size:0.78em;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.6);">
                    <div style="font-weight:bold;color:#fff;margin-bottom:4px;">${label}</div>
                    <div style="color:#bbb;line-height:1.4;">${desc}</div>
                </div>`);
                $('body').append(tip);
                const rect = anchor.getBoundingClientRect();
                const ttH = tip.outerHeight() ?? 0;
                const top = Math.min(rect.top, window.innerHeight - ttH - 8);
                tip.css({ top, left: rect.right + 6 });
                _laHoverTip = tip;
            };
            const _attachEffectHoverTooltip = (selector, idAttr) => {
                let timer = null;
                html.find(selector)
                    .on('mouseenter', function () {
                        const id = $(this).attr(idAttr) ?? $(this).data('name');
                        const label = String($(this).data('name') ?? id ?? '');
                        const desc = _findStatusDesc(String(id));
                        if (!desc)
                            return;
                        const el = this;
                        timer = setTimeout(() => _showEffectTooltip(el, label, desc), 500);
                    })
                    .on('mouseleave', function () {
                        if (timer) {
                            clearTimeout(timer);
                            timer = null;
                        }
                        _hideEffectTooltip();
                    });
            };
            _attachEffectHoverTooltip('.std-effect-option', 'data-id');
            _attachEffectHoverTooltip('.bonus-immunity-effect-option', 'data-effect');

            html.find('.bonus-uses-step').on('click', function () {
                const step = Number($(this).data('step')) || 0;
                const $input = html.find('#bonus-uses');
                const currentUses = Number.parseInt(String($input.val() ?? ''));
                const nextUses = Number.isFinite(currentUses) ? currentUses + step : (step > 0 ? 1 : 0);
                if (nextUses < 1)
                    $input.val('');
                else
                    $input.val(nextUses);
            });

            html.find('.la-num-step').on('click', function () {
                const target = String($(this).data('target') ?? '');
                if (!target)
                    return;
                const step = Number($(this).data('step')) || 0;
                const $input = html.find(`#${target}`);
                if (!$input.length)
                    return;
                const min = Number($input.attr('min'));
                const currentValue = Number.parseInt(String($input.val() ?? '0'));
                let nextValue = (Number.isFinite(currentValue) ? currentValue : 0) + step;
                if (Number.isFinite(min) && nextValue < min)
                    nextValue = min;
                $input.val(nextValue).trigger('change');
            });

            // Saved Status
            html.find('#cust-saved').change(e => {
                const val = $(e.currentTarget).val();
                if (val) {
                    html.find('#cust-name').val(val);
                    const icon = $(e.currentTarget).find(':selected').data('icon');
                    if (icon) {
                        html.find('#cust-icon').val(icon);
                        html.find('#cust-saved-icon').attr('src', icon).show();
                        _syncCustIconPreview();
                    } else {
                        html.find('#cust-saved-icon').hide();
                    }
                } else {
                    html.find('#cust-saved-icon').hide();
                }
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            // Standard Effect Grid Selection
            html.find('.std-effect-option').click(function() {
                const id = $(this).data('id');
                const name = $(this).data('name');
                const icon = $(this).data('icon');
                html.find('#std-effect').val(id);
                html.find('#std-effect-label').text(name);
                html.find('#std-effect-icon').attr('src', icon).attr('title', name).show();
                html.find('.std-effect-option').css({ background: '#f5f5f5', borderLeftColor: 'transparent' });
                $(this).css({ background: '#b8d4f0', borderLeftColor: '#1a4a7a' });
            }).on('mouseenter', function () {
                const clip = this.querySelector('.la-hud-clip');
                const pan = this.querySelector('.la-hud-pan');
                if (clip && pan) {
                    const overflow = pan.scrollWidth - clip.clientWidth;
                    if (overflow > 4)
                        $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                }
            }).on('mouseleave', function () {
                $(this).find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
            });

            // Set initial state for standard grid
            const initStdGrid = () => {
                const initialId = html.find('#std-effect').val();
                const $initOpt = html.find(`.std-effect-option[data-id="${initialId}"]`);
                if ($initOpt.length) {
                    $initOpt.click();
                } else {
                    // Fallback to first if initial hidden value doesn't match a data-id
                    html.find('.std-effect-option').first().click();
                }
            };
            initStdGrid();

            html.find('#std-effect-search').on('input', function () {
                const q = String($(this).val() ?? '').toLowerCase().trim();
                html.find('.std-effect-option').each(function () {
                    const name = String($(this).data('name') ?? '').toLowerCase();
                    $(this).toggle(!q || name.includes(q));
                });
            });

            // Apply Button
            html.find('.save-status-btn').click(async () => {
                const name = String(html.find('#cust-name').val() || '').trim();
                const icon = String(html.find('#cust-icon').val() || '').trim();
                if (!name)
                    return ui.notifications.warn('Name is required to save a status.');
                if (!icon)
                    return ui.notifications.warn('Icon is required to save a status.');
                const list = game.settings.get('temporary-custom-statuses', 'savedStatuses') || [];
                const existing = list.find(s => s.name === name);
                if (existing)
                    existing.icon = icon;
                else
                    list.push({ name, icon });
                await game.settings.set('temporary-custom-statuses', 'savedStatuses', list);
                // Refresh the Saved dropdown so the new entry is selectable immediately.
                const $sel = html.find('#cust-saved');
                const prev = String($sel.val() || '');
                $sel.find('option:not(:first)').remove();
                for (const s of list)
                    $sel.append(`<option value="${s.name}" data-icon="${s.icon}">${s.name}</option>`);
                $sel.val(prev || name);
                ui.notifications.info(`Saved "${name}" to custom statuses.`);
            });

            const _codeFieldMeta = {
                'bonus-condition':        { title: 'Condition',            def: '(state, actor, data, context) => { return true; }' },
                'bonus-applyToCondition': { title: 'Apply-to Condition',   def: '(target, state, reactorToken) => { return true; }' },
                'std-evaluate':           { title: 'Consumption Evaluate', def: '(triggerType, triggerData, effectBearerToken, effect) => { return true; }' },
                'cust-evaluate':          { title: 'Consumption Evaluate', def: '(triggerType, triggerData, effectBearerToken, effect) => { return true; }' },
                'cust-changes':           { title: 'Active Effect Changes', def: '// Modes: 0=CUSTOM 1=MULTIPLY 2=ADD 3=DOWNGRADE 4=UPGRADE 5=OVERRIDE\n[\n // { "key": "system.armor", "mode": 2, "value": "1" }\n]' },
            };
            const _rebuildPresetSelect = (prefix) => {
                const cat = presetCategoryFor(prefix);
                const presets = getStoredPresets()[cat] || [];
                const $sel = html.find(`#${prefix}-preset-load`);
                const prev = String($sel.val() || '');
                $sel.empty();
                $sel.append('<option value="">— Load —</option>');
                for (const p of presets)
                    $sel.append(`<option value="${p.name}">${p.name}</option>`);
                $sel.val(prev);
            };
            html.find('.save-preset-btn').click(async function () {
                const prefix = $(this).data('prefix');
                const cat = presetCategoryFor(prefix);
                const name = await new Promise((resolve) => {
                    new Dialog({
                        title: 'Save Preset',
                        content: '<p style="padding:6px 8px;">Preset name:</p><input type="text" id="preset-name-input" style="width:100%; padding:4px;">',
                        buttons: {
                            save: { icon: '<i class="fas fa-save"></i>', label: 'Save', callback: (h) => resolve(String(h.find('#preset-name-input').val() || '').trim()) },
                            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Cancel', callback: () => resolve('') }
                        },
                        default: 'save',
                        close: () => resolve(''),
                        render: (h) => setTimeout(() => h.find('#preset-name-input').focus(), 50)
                    }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
                });
                if (!name) return;
                const all = getStoredPresets();
                const data = gatherPresetData(html, prefix);
                const existing = all[cat].find(p => p.name === name);
                if (existing) {
                    const overwrite = await new Promise((resolve) => {
                        new Dialog({
                            title: 'Preset Exists',
                            content: `<p style="padding:6px 8px;">A preset named "${name}" already exists. Overwrite?</p>`,
                            buttons: {
                                yes: { icon: '<i class="fas fa-check"></i>', label: 'Overwrite', callback: () => resolve(true) },
                                no:  { icon: '<i class="fas fa-times"></i>', label: 'Cancel', callback: () => resolve(false) }
                            },
                            default: 'yes',
                            close: () => resolve(false)
                        }, { classes: ['lancer-dialog-base', 'lancer-no-title'] }).render(true);
                    });
                    if (!overwrite) return;
                    existing.data = data;
                } else {
                    all[cat].push({ name, data });
                }
                await setStoredPresets(all);
                _rebuildPresetSelect(prefix);
                html.find(`#${prefix}-preset-load`).val(name);
                ui.notifications.info(`Saved preset "${name}".`);
            });
            html.find('#std-preset-load, #cust-preset-load, #bonus-preset-load').change(function () {
                const name = String($(this).val() || '');
                if (!name) return;
                const id = this.id;
                const prefix = id.startsWith('std') ? 'std' : id.startsWith('cust') ? 'cust' : 'bonus';
                const cat = presetCategoryFor(prefix);
                const preset = getStoredPresets()[cat].find(p => p.name === name);
                if (!preset) return;
                applyPresetData(html, prefix, preset.data);
                ui.notifications.info(`Loaded preset "${name}".`);
            });
            html.find('.std-preset-delete, .cust-preset-delete, .bonus-preset-delete').click(async function () {
                const prefix = $(this).closest('.preset-bar').data('prefix');
                const $sel = html.find(`#${prefix}-preset-load`);
                const name = String($sel.val() || '');
                if (!name) return ui.notifications.warn('Select a preset to delete first.');
                const all = getStoredPresets();
                const cat = presetCategoryFor(prefix);
                all[cat] = (all[cat] || []).filter(p => p.name !== name);
                await setStoredPresets(all);
                _rebuildPresetSelect(prefix);
                $sel.val('');
                ui.notifications.info(`Deleted preset "${name}".`);
            });

            html.find('.code-field-badge').click(function () {
                const id = $(this).data('target');
                const meta = _codeFieldMeta[id] ?? { title: 'Code', def: '' };
                openCodeFieldDialog(html, id, meta.title, meta.def);
            });
            html.find('.code-clear-btn').click(function () {
                const id = $(this).data('target');
                html.find(`#${id}-value`).val('');
                updateCodeFieldBadge(html, id);
            });

            html.find('.apply-btn').click(async (e) => {
                e.preventDefault();
                const tab = $(e.currentTarget).data('tab');

                if (tab === 'standard') {
                    const targetID = String(html.find('#std-target').val());
                    const effectName = html.find('#std-effect').val();
                    const stack = Number.parseInt(String(html.find('#std-stack').val())) || 1;
                    const durationLabel = String(html.find('#std-duration').val());
                    const originID = String(html.find('#std-origin').val());
                    const note = String(html.find('#std-note').val());
                    const turnsInput = Number.parseInt(String(html.find('#std-turns').val())) || 1;

                    let duration = {
                        label: 'indefinite',
                        turns: null,
                        rounds: null
                    };
                    if (durationLabel === 'permanent') {
                        duration.label = 'permanent';
                    } else if (durationLabel !== 'indefinite') {
                        duration = {
                            label: durationLabel,
                            turns: turnsInput,
                            rounds: 0
                        };
                        if (game.combat?.current?.tokenId === originID)
                            duration.turns = turnsInput + 1;
                    }

                    const consumption = getTriggerConfig(html, 'std');
                    const extraOptions = {};
                    if (stack > 1 || consumption)
                        extraOptions.stack = stack;
                    if (consumption) {
                        if (!consumption.originId)
                            consumption.originId = targetID;
                        extraOptions.consumption = consumption;
                    }

                    const token = canvas.tokens.get(targetID);
                    if (!token)
                        return ui.notifications.error("Target token not found!");

                    await applyEffectsToTokens({
                        tokens: [token],
                        effectNames: effectName,
                        note: note,
                        duration: { ...duration, overrideTurnOriginId: originID },
                    }, extraOptions);
                    ui.notifications.info(`Applied ${effectName} to ${token.name}.`);
                    setTimeout(updateManageTabCount, 200);

                } else if (tab === 'custom') {
                    const targetID = String(html.find('#cust-target').val());
                    const name = html.find('#cust-name').val();
                    const icon = html.find('#cust-icon').val();
                    const stack = Number.parseInt(String(html.find('#cust-stack').val())) || 1;
                    const durationLabel = String(html.find('#cust-duration').val());
                    const originID = String(html.find('#cust-origin').val());
                    const note = String(html.find('#cust-note').val());
                    const turnsInput = Number.parseInt(String(html.find('#cust-turns').val())) || 1;

                    if (!name)
                        return ui.notifications.error("Name is required!");

                    let duration = {
                        label: 'indefinite',
                        turns: null,
                        rounds: null
                    };
                    if (durationLabel === 'permanent') {
                        duration.label = 'permanent';
                    } else if (durationLabel !== 'indefinite') {
                        duration = {
                            label: durationLabel,
                            turns: turnsInput,
                            rounds: 0
                        };
                        if (game.combat?.current?.tokenId === originID)
                            duration.turns = turnsInput + 1;
                    }

                    const consumption = getTriggerConfig(html, 'cust');
                    const extraOptions = {};
                    if (stack > 1)
                        extraOptions.stack = stack;
                    if (consumption) {
                        if (!consumption.originId)
                            consumption.originId = targetID;
                        extraOptions.consumption = consumption;
                        extraOptions.stack = stack;
                    }
                    const changesSrc = String(html.find('#cust-changes-value').val() || '').trim();
                    if (changesSrc) {
                        try {
                            const parsed = (new Function(`return (${changesSrc});`))();
                            if (!Array.isArray(parsed))
                                return ui.notifications.error('Active Effect Changes must be an array.');
                            extraOptions.changes = parsed;
                        } catch (err) {
                            return ui.notifications.error(`Active Effect Changes parse error: ${err.message}`);
                        }
                    }

                    const token = canvas.tokens.get(targetID);
                    if (!token)
                        return ui.notifications.error("Target token not found!");

                    const effectData = {
                        name: name,
                        icon: icon,
                        stack: stack,
                        isCustom: true
                    };

                    await applyEffectsToTokens({
                        tokens: [token],
                        effectNames: effectData,
                        note: note,
                        duration: { ...duration, overrideTurnOriginId: originID },
                    }, extraOptions);
                    ui.notifications.info(`Applied ${name} to ${token.name}.`);
                    setTimeout(updateManageTabCount, 200);
                }
            });

            // Shared bonus detail helpers
            const getBonusDetailString = (bonus) => {
                if (bonus.type === 'accuracy')
                    return `Accuracy +${bonus.val}`;
                if (bonus.type === 'difficulty')
                    return `Difficulty +${bonus.val}`;
                if (bonus.type === 'stat')
                    return `${bonus.stat?.split('.').pop() || bonus.stat} ${Number.parseInt(bonus.val) >= 0 ? '+' : ''}${bonus.val}`;
                if (bonus.type === 'damage')
                    return (bonus.damage || []).map(dmg => `${dmg.val} ${dmg.type}`).join(' + ');
                if (bonus.type === 'tag') {
                    if (bonus.removeTag)
                        return `Remove Tag: ${bonus.tagName}`;
                    const action = bonus.tagMode === 'override' ? 'Set' : 'Add';
                    return `${action} ${bonus.tagName} ${bonus.val}`;
                }
                if (bonus.type === 'range') {
                    const rangeLabel = bonus.rangeMode === 'override' ? 'Set' : bonus.rangeMode === 'change' ? 'Change All →' : 'Add';
                    return `${rangeLabel} ${bonus.rangeType} ${bonus.val}`;
                }
                if (bonus.type === 'immunity') {
                    if (bonus.subtype === 'effect' && bonus.effects)
                        return `Immunity: ${bonus.effects.join(', ')}`;
                    if ((bonus.subtype === 'damage' || bonus.subtype === 'resistance') && bonus.damageTypes)
                        return `${bonus.subtype}: ${bonus.damageTypes.join(', ')}`;
                    if (bonus.subtype === 'crit')
                        return 'Immunity: Critical Hit';
                    if (bonus.subtype === 'hit')
                        return 'Immunity: Hit';
                    if (bonus.subtype === 'miss')
                        return 'Immunity: Miss';
                    if (bonus.subtype === 'elevation')
                        return 'Immunity: Elevation';
                    if (bonus.subtype === 'terrain')
                        return 'Immunity: Terrain';
                    if (bonus.subtype === 'provoke')
                        return 'Immunity: Provoke (Engagement & Reactions)';
                    return bonus.subtype;
                }
                if (bonus.type === 'target_modifier') {
                    const labels = {
                        invisible: 'Invisible (50% miss)', no_invisible: 'Not Invisible', no_cover: 'No Cover', soft_cover: 'Soft Cover', hard_cover: 'Hard Cover',
                        ap: 'Armor Piercing', half_damage: 'Half Damage', paracausal: 'Cannot be Reduced',
                        crit: 'Force Crit', hit: 'Force Hit', miss: 'Force Miss'
                    };
                    return `Target: ${labels[bonus.subtype] || bonus.subtype}`;
                }
                if (bonus.type === 'reroll') {
                    const rerollTypes = Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0 ? bonus.rollTypes.join(', ') : 'any';
                    const subtype = String(bonus.subtype ?? 'retry');
                    return `Reroll [${subtype}]: ${rerollTypes}`;
                }
                return bonus.type || 'Unknown';
            };
            const renderBonusDetails = (bonus) => {
                if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
                    return `[${bonus.bonuses.map(getBonusDetailString).join(' | ')}]`;
                return `(${getBonusDetailString(bonus)})`;
            };

            // Manage Tab
            const updateManageTabCount = () => {
                const targetID = String(html.find('#manage-target').val());
                const target = canvas.tokens.get(targetID);
                if (!target?.actor) {
                    html.find('#manage-tab-count').text('');
                    return;
                }
                const actor = target.actor;
                const effectCount = actor.effects.filter(e =>
                    !e.disabled && (e.icon || e.img) && !e.getFlag("lancer-automations", "linkedBonusId")
                ).length;
                const bonusCount = (actor.getFlag("lancer-automations", "global_bonuses") || []).length
                    + (actor.getFlag("lancer-automations", "constant_bonuses") || []).length;
                const total = effectCount + bonusCount;
                html.find('#manage-tab-count').text(total > 0 ? `(${total})` : '');
            };

            const updateManageList = () => {
                const targetID = String(html.find('#manage-target').val());
                const target = canvas.tokens.get(targetID);
                const list = html.find('#manage-list');
                list.empty();

                if (!target?.actor)
                    return;

                const effects = target.actor.effects.filter(e =>
                    !e.disabled &&
                    (e.icon || e.img) &&
                    !e.getFlag("lancer-automations", "linkedBonusId")
                );

                if (effects.length === 0) {
                    list.html('<p style="text-align:center; color:#ccc">No effects found.</p>');
                }

                effects.forEach(effect => {
                    const dur = effect.getFlag('lancer-automations', 'duration') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'duration') : null);
                    const consumption = effect.getFlag('lancer-automations', 'consumption');
                    const stack = effect.flags?.statuscounter?.value ||
                        effect.flags?.['temporary-custom-statuses']?.stack || 0;

                    let durText = "Indefinite";
                    if (dur) {
                        durText = `${dur.label}, ${dur.turns}t`;
                    }

                    let consumptionText = '';
                    if (consumption?.trigger) {
                        let triggerLabel = Array.isArray(consumption.trigger)
                            ? consumption.trigger.join(', ')
                            : consumption.trigger;
                        if (consumption.itemId)
                            triggerLabel += ` ID:${consumption.itemId}`;
                        else if (consumption.itemLid)
                            triggerLabel += ` ${consumption.itemLid}`;
                        consumptionText = `<span style="font-size:0.75em; color:var(--primary-color); margin-left:4px;">[${triggerLabel}]</span>`;
                    }

                    const item = $(`
                        <div class="te-effect-item">
                            <div class="te-effect-info">
                                <img src="${effect.img}" width="24" height="24" style="border:none; background:#1a1a1a; border-radius:3px; padding:1px; object-fit:contain;">
                                <span>${effect.name}</span>
                                <span style="font-size:0.8em; opacity:0.7">(${durText})</span>
                                ${consumptionText}
                                ${stack > 0 ? `<span style="font-weight:bold; margin-left:4px;">x${stack}</span>` : ''}
                            </div>
                            <div style="display:flex; gap: 5px; align-items: center;">
                                ${stack > 0 ? `
                                <div class="te-stack-ctrl">
                                    <i class="fas fa-minus stack-btn" data-action="dec"></i>
                                    <i class="fas fa-plus stack-btn" data-action="inc"></i>
                                </div>` : ''}
                                <div class="te-delete-btn" title="Remove"><i class="fas fa-trash"></i></div>
                            </div>
                        </div>
                    `);

                    item.find('.te-delete-btn').click(async () => {
                        await pushRemoveEffect(targetID, effect.id);
                        setTimeout(updateManageList, 200);
                    });

                    item.find('.stack-btn').click(async (ev) => {
                        const action = $(ev.currentTarget).data('action');
                        const delta = action === 'inc' ? 1 : -1;
                        await modifyEffectStack(targetID, effect.id, delta);
                        setTimeout(updateManageList, 200);
                    });

                    list.append(item);
                });

                // Bonuses section
                const bonusList = html.find('#manage-bonus-list');
                bonusList.empty();
                const actor = target.actor;
                const globalBonuses = actor.getFlag("lancer-automations", "global_bonuses") || [];
                const constantBonuses = actor.getFlag("lancer-automations", "constant_bonuses") || [];
                const allBonuses = [
                    ...globalBonuses.map(b => ({ ...b, _kind: 'global' })),
                    ...constantBonuses.map(b => ({ ...b, _kind: 'constant' }))
                ];

                updateManageTabCount();

                if (allBonuses.length > 0) {
                    bonusList.append($('<p style="margin:8px 0 4px; font-weight:bold; border-top:1px solid #555; padding-top:6px;">Bonuses</p>'));
                    allBonuses.forEach(bonus => {
                        const details = renderBonusDetails(bonus);
                        const lids = (bonus.itemLids && bonus.itemLids.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[${bonus.itemLids.join(', ')}]</span>` : '';
                        const types = (bonus.rollTypes && bonus.rollTypes.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[Flows: ${bonus.rollTypes.join(', ')}]</span>` : '';
                        const itemIdInfo = bonus.itemId ? ` <span style="font-size:0.8em; opacity:0.7;">[Item: ${bonus.itemId}]</span>` : '';
                        const kindLabel = bonus._kind === 'constant' ? ' <span style="font-size:0.75em; color:#aaa;">(constant)</span>' : '';

                        let usesInfo = '';
                        if (bonus.uses !== undefined) {
                            const linkedEffect = actor.effects.find(effect => effect.getFlag("lancer-automations", "linkedBonusId") === bonus.id);
                            const remaining = linkedEffect ? (linkedEffect.flags?.statuscounter?.value ?? null) : null;
                            usesInfo = remaining === null ? ` <span style="color:var(--primary-color);">[uses: ${bonus.uses}]</span>` : ` <span style="color:var(--primary-color);">[${remaining}/${bonus.uses}]</span>`;
                        }

                        const item = $(`
                            <div class="te-bonus-item">
                                <span><strong>${bonus.name}</strong>${kindLabel} ${details}${usesInfo}${lids}${itemIdInfo}${types}</span>
                                <div class="te-delete-btn manage-bonus-remove-btn" data-id="${bonus.id}" data-kind="${bonus._kind}" title="Remove"><i class="fas fa-trash"></i></div>
                            </div>
                        `);

                        item.find('.manage-bonus-remove-btn').click(async () => {
                            if (bonus._kind === 'constant')
                                await removeConstantBonus(actor, bonus.id);
                            else
                                await removeGlobalBonus(actor, bonus.id);
                            setTimeout(updateManageList, 200);
                        });

                        bonusList.append(item);
                    });
                }

                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            };

            html.find('#manage-target').change(updateManageList);
            html.find('.te-tab[data-tab="manage"]').click(updateManageList);

            // ========== BONUS TAB ==========
            const updateBonusList = () => {
                const targetID = String(html.find('#bonus-target').val());
                const target = canvas.tokens.get(targetID);
                const summary = html.find('#bonus-summary');

                if (!target?.actor) {
                    summary.text('—').removeClass('has-bonuses').attr('title', 'No token selected');
                    return;
                }
                const actor = target.actor;
                const bonuses = actor.getFlag("lancer-automations", "global_bonuses") || [];
                const constantBonuses = actor.getFlag("lancer-automations", "constant_bonuses") || [];
                const total = bonuses.length + constantBonuses.length;
                if (total > 0)
                    summary.text(`${total} active`).addClass('has-bonuses').attr('title', `${total} active bonus${total > 1 ? 'es' : ''} — see Manage tab.`);
                else
                    summary.text('—').removeClass('has-bonuses').attr('title', 'No active bonuses');

                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            };

            html.find('#bonus-target').change(updateBonusList);

            // Bonus duration toggle
            const toggleBonusDurOpts = () => {
                const val = html.find('#bonus-duration').val();
                if (!val || val === 'indefinite') {
                    html.find('.bonus-dur-opts').hide();
                } else {
                    html.find('.bonus-dur-opts').show();
                }
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            };
            html.find('#bonus-duration').on('change', toggleBonusDurOpts);
            toggleBonusDurOpts();

            // Bonus consumption trigger filter toggle
            const bonusFilterMap = {
                onAttack: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onHit: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onMiss: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onDamage: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onTechAttack: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onTechHit: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onPreMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onInitActivation: ['bonus-filter-actionName'],
                onActivation: ['bonus-filter-actionName'],
                onDeploy: ['bonus-filter-itemLid', 'bonus-filter-itemId'],
                onCheck: ['bonus-filter-check', 'bonus-filter-checkValues'],
                onPreStatusApplied: ['bonus-filter-statusId'],
                onPreStatusRemoved: ['bonus-filter-statusId'],
                onStatusApplied: ['bonus-filter-statusId'],
                onStatusRemoved: ['bonus-filter-statusId']
            };

            initLaMultiSelect(html, 'bonus-trigger');
            html.find('#bonus-trigger input[type=checkbox]').on('change', function () {
                const triggers = html.find('#bonus-trigger input:checked')
                    .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
                const $fields = html.find('#bonus-trigger-fields');
                $fields.find('.form-group').hide();
                if (triggers.length > 0) {
                    $fields.show();
                    $fields.find('.form-group').first().show();
                    const classes = new Set(triggers.flatMap(t => bonusFilterMap[t] ?? []));
                    classes.forEach(cls => $fields.find(`.${cls}`).show());
                } else {
                    $fields.hide();
                }
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            // Bonus LID finder buttons
            html.find('#tab-bonus .find-lid-btn').on('click', function (e) {
                e.preventDefault();
                const targetId = $(this).data('target');
                openItemBrowser(html.find(`#${targetId}`));
            });

            // Token selector buttons (interactive picking)
            html.find('.token-picker-btn').on('click', async function (e) {
                e.preventDefault();
                const targetId = $(this).data('target');
                const count = Number.parseInt($(this).data('count')) || 1;
                const api = game.modules.get('lancer-automations').api;

                // Use currently selected token as caster for the selection tool context if possible
                const currentVal = String(html.find(`#${targetId}`).val());
                const caster = canvas.tokens.get(currentVal) || canvas.tokens.controlled[0];

                const selected = await api.chooseToken(caster, {
                    count: count,
                    includeSelf: true,
                    title: count === 1 ? "Pick Token" : "Select Tokens",
                    description: count === 1 ? "Select a token on the map to update the field." : "Select tokens to apply this bonus to. Close the card to confirm.",
                    icon: "fas fa-crosshairs"
                });

                if (selected && selected.length > 0) {
                    if (count === 1) {
                        html.find(`#${targetId}`).val(selected[0].id).change();
                    } else {
                        const ids = selected.map(t => t.id).join(', ');
                        html.find(`#${targetId}`).val(ids).change();
                    }
                }
            });

            // Specific Item ID selector buttons (interactive picking)
            html.find('.item-picker-btn').on('click', async function (e) {
                e.preventDefault();
                const targetId = $(this).data('target');
                const api = game.modules.get('lancer-automations').api;

                // We need a specific token to pick an item from. Let's trace it back from `bonus-applyTo` if available, or selected token.
                const applyToStr = String(html.find('#bonus-applyTo').val());
                let targetToken = null;

                if (applyToStr) {
                    const firstTargetId = applyToStr.split(',')[0].trim();
                    targetToken = canvas.tokens.get(firstTargetId);
                }
                if (!targetToken) {
                    targetToken = canvas.tokens.controlled[0];
                }

                if (!targetToken?.actor) {
                    ui.notifications.warn("Please select a target token on the map, or fill in the 'Apply to tokens' field first, to pick an item from them.");
                    return;
                }

                const items = targetToken.actor.items.filter(i => !['skill', 'talent', 'core_bonus', 'integrated'].includes(i.type));
                if (items.length === 0) {
                    ui.notifications.warn(`${targetToken.name} has no valid items.`);
                    return;
                }

                // Sort items by type, then name
                items.sort((a, b) => {
                    if (a.type !== b.type)
                        return a.type.localeCompare(b.type);
                    return a.name.localeCompare(b.name);
                });

                const buildItemHtml = (item) => {
                    const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
                    const displayType = item.system?.type ? `${item.type.toUpperCase()} - ${item.system.type.toUpperCase()}` : item.type.toUpperCase();
                    return `<div class="lancer-item-card actor-item-entry" data-id="${item.id}" data-type="${item.type}" style="margin-bottom:6px;padding:10px; cursor:pointer; display:flex; gap:10px;">
                        <div class="lancer-item-icon" style="width:32px; height:32px; background:url('${icon}') no-repeat center/contain;"></div>
                        <div class="lancer-item-content" style="flex:1;min-width:0;">
                            <div class="lancer-item-name" style="font-weight:bold;">${item.name}</div>
                            <div class="lancer-item-details" style="font-size:0.85em; opacity:0.8;">[${displayType}]</div>
                        </div>
                    </div>`;
                };

                const dialog = new Dialog({
                    title: `Select Item on ${targetToken.name}`,
                    content: `
                        <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                            <h1 class="lancer-dialog-title">Select Item on ${targetToken.name.toUpperCase()}</h1>
                            <p class="lancer-dialog-subtitle">Choose which item this bonus applies to.</p>
                        </div>
                        <div id="actor-item-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                            ${items.map(buildItemHtml).join('')}
                        </div>
                    `,
                    buttons: {
                        cancel: { label: '<i class="fas fa-times"></i> Cancel', callback: () => {} }
                    },
                    render: (htmlContent) => {
                        htmlContent.find('#actor-item-list').on('click', '.actor-item-entry', (ev) => {
                            const el = $(ev.currentTarget);
                            html.find(`#${targetId}`).val(el.data('id')).change();
                            dialog.close();
                        });
                    },
                    default: "cancel"
                }, {
                    width: 500,
                    classes: ["lancer-dialog-base", "lancer-item-browser-dialog", "lancer-no-title"]
                });
                dialog.render(true);
            });

            // Status picker button for bonus consumption filter
            html.find('.bonus-status-picker-btn').on('click', function (e) {
                e.preventDefault();
                const targetId = $(this).data('target');
                openStatusPicker(html.find(`#${targetId}`));
            });

            // Add bonus handler
            const addBonusFromTab = async (type) => {
                const targetID = String(html.find('#bonus-target').val());
                const target = canvas.tokens.get(targetID);
                if (!target?.actor)
                    return ui.notifications.error("Target token not found!");
                const actor = target.actor;

                const name = String(html.find('#bonus-name').val() || "Test Bonus");
                const usesStr = String(html.find('#bonus-uses').val());
                const uses = usesStr ? Number.parseInt(usesStr) : undefined;
                const duration = html.find('#bonus-duration').val();
                const durOrigin = html.find('#bonus-durOrigin').val();
                const durTurns = Number.parseInt(String(html.find('#bonus-durTurns').val())) || 1;
                const itemLidsStr = String(html.find('#bonus-itemLids').val());
                const itemLids = itemLidsStr ? itemLidsStr.split(',').map(s => s.trim()).filter(s => s) : [];

                let rollTypes = [];
                if (type === 'accuracy' || type === 'difficulty') {
                    rollTypes = html.find('#bonus-rollTypes-roll input:checked').map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
                } else if (type === 'damage') {
                    rollTypes = html.find('#bonus-rollTypes-damage input:checked').map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
                }

                const applyToStr = String(html.find('#bonus-applyTo').val());
                const applyTo = applyToStr ? applyToStr.split(',').map(s => s.trim()).filter(s => s) : undefined;
                const applyToTargetter = html.find('#bonus-applyToTargetter').is(':checked');
                const itemId = String(html.find('#bonus-itemId').val())?.trim() || undefined;

                const bonusData = {
                    name,
                    type,
                    uses,
                    itemLids,
                    itemId,
                    rollTypes,
                    applyTo,
                    applyToTargetter
                };
                const conditionSrc = String(html.find('#bonus-condition-value').val() || '').trim();
                if (conditionSrc)
                    bonusData.condition = '@@fn:' + conditionSrc;
                const applyToConditionSrc = String(html.find('#bonus-applyToCondition-value').val() || '').trim();
                if (applyToConditionSrc)
                    bonusData.applyToCondition = '@@fn:' + applyToConditionSrc;

                if (type === 'stat') {
                    bonusData.stat = html.find('#bonus-stat').val();
                    bonusData.val = html.find('#bonus-statVal').val() || "1";
                } else if (type === 'damage') {
                    const damageEntries = [];
                    html.find('#bonus-damage-list .bonus-damage-entry').each(function () {
                        const idx = $(this).data('index');
                        const val = $(this).find(`#bonus-dmgVal-${idx}`).val() || "1d6";
                        const dtype = $(this).find(`#bonus-dmgType-${idx}`).val();
                        damageEntries.push({
                            val,
                            type: dtype
                        });
                    });
                    bonusData.damage = damageEntries.length > 0 ? damageEntries : [{
                        val: "1d6",
                        type: "Kinetic"
                    }];
                } else if (type === 'tag') {
                    const selectEl = /** @type {HTMLSelectElement} */ (html.find('#bonus-tagSelect')[0]);
                    bonusData.tagId = selectEl.options[selectEl.selectedIndex].value;
                    bonusData.tagName = selectEl.options[selectEl.selectedIndex].text;
                    bonusData.tagMode = html.find('#bonus-tagMode').val();
                    bonusData.val = html.find('#bonus-tagVal').val() || "0";
                    bonusData.removeTag = html.find('#bonus-removeTag').is(':checked');
                } else if (type === 'range') {
                    bonusData.rangeType = html.find('#bonus-rangeType').val();
                    bonusData.rangeMode = html.find('#bonus-rangeMode').val();
                    bonusData.val = html.find('#bonus-rangeVal').val() || "0";
                } else if (type === 'immunity') {
                    bonusData.subtype = html.find('#bonus-immunity-subtype').val();
                    if (bonusData.subtype === 'effect') {
                        bonusData.effects = [];
                        html.find('.bonus-immunity-effect-option.selected').each(function() {
                            bonusData.effects.push($(this).data('effect'));
                        });
                    } else if (bonusData.subtype === 'damage' || bonusData.subtype === 'resistance') {
                        bonusData.damageTypes = [];
                        html.find('.bonus-immunity-damage-option.selected').each(function() {
                            bonusData.damageTypes.push($(this).data('type'));
                        });
                    }
                } else if (type === 'target_modifier') {
                    bonusData.subtype = html.find('#bonus-target-modifier-subtype').val();
                } else if (type === 'reroll') {
                    const list = $('#bonus-reroll-rollTypes input:checked').map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
                    if (list.length > 0)
                        bonusData.rollTypes = list;
                    const sub = String(html.find('#bonus-reroll-subtype').val() ?? 'retry');
                    bonusData.subtype = ['retry', 'highest', 'lowest', 'choose'].includes(sub) ? sub : 'retry';
                } else {
                    bonusData.val = html.find('#bonus-accDiffVal').val() || "1";
                }

                const addOptions = {
                    duration,
                    durationTurns: durTurns,
                    origin: durOrigin
                };
                const customIcon = String(html.find('#bonus-icon').val() || '').trim();
                if (customIcon)
                    addOptions.icon = customIcon;

                // Build consumption config
                const consumptionTriggers = html.find('#bonus-trigger input:checked')
                    .map((_, el) => /** @type {HTMLInputElement} */ (el).value).get();
                if (consumptionTriggers.length > 0) {
                    const consumption = {
                        trigger: consumptionTriggers.length === 1 ? consumptionTriggers[0] : consumptionTriggers
                    };
                    const cOrigin = html.find('#bonus-trigger-origin').val();
                    if (cOrigin)
                        consumption.originId = cOrigin;
                    const filterItemLid = String(html.find('#bonus-filter-itemLid').val())?.trim();
                    if (filterItemLid)
                        consumption.itemLid = filterItemLid;
                    const filterItemId = String(html.find('#bonus-filter-itemId').val())?.trim();
                    if (filterItemId)
                        consumption.itemId = filterItemId;
                    const filterActionName = String(html.find('#bonus-filter-actionName').val())?.trim();
                    if (filterActionName)
                        consumption.actionName = filterActionName;
                    const filterIsBoost = html.find('#bonus-filter-isBoost').is(':checked');
                    if (filterIsBoost)
                        consumption.isBoost = true;
                    const filterMinDistance = String(html.find('#bonus-filter-minDistance').val());
                    if (filterMinDistance)
                        consumption.minDistance = Number.parseInt(filterMinDistance);
                    const filterCheckType = String(html.find('#bonus-filter-checkType').val())?.trim();
                    if (filterCheckType)
                        consumption.checkType = filterCheckType;
                    const filterCheckAbove = String(html.find('#bonus-filter-checkAbove').val());
                    if (filterCheckAbove)
                        consumption.checkAbove = Number.parseInt(filterCheckAbove);
                    const filterCheckBelow = String(html.find('#bonus-filter-checkBelow').val());
                    if (filterCheckBelow)
                        consumption.checkBelow = Number.parseInt(filterCheckBelow);
                    const filterStatusId = String(html.find('#bonus-filter-statusId').val())?.trim();
                    if (filterStatusId)
                        consumption.statusId = filterStatusId;
                    addOptions.consumption = consumption;
                }

                await addGlobalBonus(actor, bonusData, addOptions);
                setTimeout(updateBonusList, 200);
                setTimeout(updateManageTabCount, 200);
            };

            // Bonus type selector - show/hide relevant inputs
            html.find('#bonus-type').on('change', function () {
                const type = $(this).val();
                html.find('#bonus-type-stat, #bonus-type-roll, #bonus-type-damage, #bonus-type-tag, #bonus-type-range, #bonus-type-immunity, #bonus-type-target_modifier, #bonus-type-reroll').hide();
                html.find(`#bonus-type-${type}`).show();

                const showItems = type === 'roll' || type === 'damage' || type === 'tag' || type === 'range' || type === 'target_modifier';
                html.find('#bonus-items-row').toggle(showItems);
                if (showItems) {
                    html.find('#row-bonus-rollTypes-roll').toggle(type === 'roll');
                    html.find('#row-bonus-rollTypes-damage').toggle(type === 'damage');
                }

                // Range bonuses are applied via libWrapper on currentProfile() — applyToTargetter makes no sense for them
                const targetter = html.find('#bonus-applyToTargetter');
                if (type === 'range') {
                    targetter.prop('checked', false).closest('.form-group').hide();
                } else {
                    targetter.closest('.form-group').show();
                }

                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            html.find('#bonus-immunity-subtype').on('change', function () {
                const subtype = $(this).val();
                html.find('#bonus-immunity-effects-row').toggle(subtype === 'effect');
                html.find('#bonus-immunity-damage-row').toggle(subtype === 'damage' || subtype === 'resistance');
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            html.find('.bonus-immunity-damage-option').on('click', function() {
                $(this).toggleClass('selected');
            });

            html.find('.bonus-immunity-effect-option').on('click', function() {
                const $el = $(this);
                $el.toggleClass('selected');
                if ($el.hasClass('selected'))
                    $el.css({ background: '#b8d4f0', borderLeftColor: '#1a4a7a' });
                else
                    $el.css({ background: '#f5f5f5', borderLeftColor: 'transparent' });
            }).on('mouseenter', function () {
                const clip = this.querySelector('.la-hud-clip');
                const pan = this.querySelector('.la-hud-pan');
                if (clip && pan) {
                    const overflow = pan.scrollWidth - clip.clientWidth;
                    if (overflow > 4)
                        $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                }
            }).on('mouseleave', function () {
                $(this).find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
            });

            html.find('#bonus-immunity-effect-search').on('input', function () {
                const q = String($(this).val() ?? '').toLowerCase().trim();
                html.find('.bonus-immunity-effect-option').each(function () {
                    const name = String($(this).data('name') ?? '').toLowerCase();
                    $(this).toggle(!q || name.includes(q));
                });
            });

            // Multi-select dropdowns for roll types
            initLaMultiSelect(html, 'bonus-rollTypes-roll');
            initLaMultiSelect(html, 'bonus-rollTypes-damage');
            initLaMultiSelect(html, 'bonus-reroll-rollTypes');

            html.find('#bonus-add').click(() => {
                const type = html.find('#bonus-type').val();
                if (type === 'roll') {
                    addBonusFromTab(html.find('#bonus-rollType').val());
                } else {
                    addBonusFromTab(type);
                }
            });

            // Dynamic damage entries
            let bonusDmgEntryCounter = 1;
            html.find('#bonus-add-dmg-entry').click(function () {
                const idx = bonusDmgEntryCounter++;
                const newEntry = $(`
                    <div class="bonus-damage-entry form-group" data-index="${idx}">
                        <input type="text" id="bonus-dmgVal-${idx}" value="1d6" placeholder="1d6" style="flex:1;">
                        <select id="bonus-dmgType-${idx}" style="flex:1;">${dmgTypeOptionsHtml}</select>
                        <button type="button" class="bonus-remove-dmg te-delete-btn" data-index="${idx}" style="flex:0 0 22px;"><i class="fas fa-times"></i></button>
                    </div>
                `);
                html.find('#bonus-damage-list').append(newEntry);
                if (dialog.position) {
                    dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                }
            });

            html.on('click', '.bonus-remove-dmg', function () {
                const $list = html.find('#bonus-damage-list');
                if ($list.find('.bonus-damage-entry').length > 1) {
                    $(this).closest('.bonus-damage-entry').remove();
                    if (dialog.position) {
                        dialog.setPosition({ height: 'auto', left: dialog.position.left, top: dialog.position.top });
                    }
                }
            });

            // Clear all bonuses
            html.find('#bonus-clear-all').click(async () => {
                const targetID = String(html.find('#bonus-target').val());
                const target = canvas.tokens.get(targetID);
                if (!target?.actor)
                    return;
                await target.actor.unsetFlag("lancer-automations", "global_bonuses");
                setTimeout(updateBonusList, 200);
                setTimeout(updateManageTabCount, 200);
            });

            // Initial tab selection
            if (options.initialTab) {
                html.find('.te-tab').removeClass('active');
                html.find('.te-content').removeClass('active');
                html.find(`.te-tab[data-tab="${options.initialTab}"]`).addClass('active');
                html.find(`#tab-${options.initialTab}`).addClass('active');
                if (options.initialTab === 'bonus')
                    updateBonusList();
                if (options.initialTab === 'manage')
                    updateManageList();
            }
            updateManageTabCount();
        }
    }, /** @type {any} */ ({
        width: 560,
        height: 'auto',
        left: 100,
        top: 60,
        classes: ['lancer-effect-manager', 'lancer-dialog-base', 'lancer-no-title']
    }));

    const _origClose = dialog.close.bind(dialog);
    dialog.close = (...args) => {
        const dlg = /** @type {any} */ (dialog);
        try {
            dlg._laResizeObserver?.disconnect();
        } catch {
            /* noop */
        }
        dlg._laResizeObserver = null;
        if (dlg._laCombatHooks) {
            try {
                Hooks.off('createCombat', dlg._laCombatHooks);
                Hooks.off('deleteCombat', dlg._laCombatHooks);
                Hooks.off('combatStart', dlg._laCombatHooks);
            } catch {
                /* noop */
            }
            dlg._laCombatHooks = null;
        }
        return _origClose(...args);
    };

    dialog.render(true);
}

export const EffectManagerAPI = {
    executeEffectManager,
    openItemBrowser
};
