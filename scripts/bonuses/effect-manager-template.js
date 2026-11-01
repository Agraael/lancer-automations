import { tierGateControl } from "../interactive/tier-gate.js";
import { localize } from "../tools/string-utils.js";
import { STATUS_GROUP_ORDER, statusGroupKey } from "../tah/status-groups.js";

// Bonus composition modes. First entry is the default for backward compatibility.
const DAMAGE_BONUS_MODES = [
    { value: 'add', label: 'LA.effectManager.mode.bonus' },
    { value: 'add_base', label: 'LA.effectManager.mode.add' },
    { value: 'replace', label: 'LA.effectManager.mode.replace' },
    { value: 'change_type', label: 'LA.effectManager.mode.changeType' },
];
const DAMAGE_CHANGE_TYPE_SCOPES = [
    { value: 'base', label: 'LA.effectManager.mode.weaponDamage' },
    { value: 'bonus', label: 'LA.effectManager.mode.bonusDamage' },
    { value: 'all', label: 'LA.effectManager.mode.both' },
];
const STAT_BONUS_MODES = [
    { value: 'add', label: 'LA.effectManager.mode.add' },
    { value: 'replace_base', label: 'LA.effectManager.mode.replaceBase' },
    { value: 'overwrite', label: 'LA.effectManager.mode.highestWins' },
    { value: 'replace', label: 'LA.effectManager.mode.setFinal' },
];
export const DAMAGE_CHANGE_TYPE_ALL = 'all';

/** Renders a code field row: preview badge + Edit/Clear buttons; code stored in a hidden input. */
function codeFieldRow(id, label, placeholder)
{
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

function presetBarHtml(prefix, presets)
{
    return `
        <div class="preset-bar" data-prefix="${prefix}">
            <label>Preset:</label>
            <select id="${prefix}-preset-load" style="flex:1;">
                <option value="">— Load —</option>
                ${presets.map(preset => `<option value="${preset.name}">${preset.name}</option>`).join('')}
            </select>
            <button type="button" class="te-btn-icon ${prefix}-preset-delete" title="Delete selected preset" style="flex:0 0 28px; width:28px; height:26px; padding:0;"><i class="fas fa-trash"></i></button>
        </div>
    `;
}

const CONSUMPTION_TRIGGER_LIST = [
    { value: 'onAttack', label: 'LA.effectManager.trigger.onAttack' },
    { value: 'onHit', label: 'LA.effectManager.trigger.onHit' },
    { value: 'onMiss', label: 'LA.effectManager.trigger.onMiss' },
    { value: 'onPreDamage', label: 'LA.effectManager.trigger.onPreDamage' },
    { value: 'onDamage', label: 'LA.effectManager.trigger.onDamage' },
    { value: 'onTechAttack', label: 'LA.effectManager.trigger.onTechAttack' },
    { value: 'onTechHit', label: 'LA.effectManager.trigger.onTechHit' },
    { value: 'onMove', label: 'LA.effectManager.trigger.onMove' },
    { value: 'onPreMove', label: 'LA.effectManager.trigger.onPreMove' },
    { value: 'onInitActivation', label: 'LA.effectManager.trigger.onInitActivation' },
    { value: 'onActivation', label: 'LA.effectManager.trigger.onActivation' },
    { value: 'onInitEndActivation', label: 'LA.effectManager.trigger.onInitEndActivation' },
    { value: 'onEndActivation', label: 'LA.effectManager.trigger.onEndActivation' },
    { value: 'onPostActivation', label: 'LA.effectManager.trigger.onPostActivation' },
    { value: 'onPostEndActivation', label: 'LA.effectManager.trigger.onPostEndActivation' },
    { value: 'onDeploy', label: 'LA.effectManager.trigger.onDeploy' },
    { value: 'onCheck', label: 'LA.effectManager.trigger.onCheck' },
    { value: 'onHeatGain', label: 'LA.effectManager.trigger.onHeatGain' },
    { value: 'onHpLoss', label: 'LA.effectManager.trigger.onHpLoss' },
    { value: 'onTurnStart', label: 'LA.effectManager.trigger.onTurnStart' },
    { value: 'onTurnEnd', label: 'LA.effectManager.trigger.onTurnEnd' },
    { value: 'onRoundStart', label: 'LA.effectManager.trigger.onRoundStart' },
    { value: 'onRoundEnd', label: 'LA.effectManager.trigger.onRoundEnd' },
    { value: 'onEnterCombat', label: 'LA.effectManager.trigger.onEnterCombat' },
    { value: 'onExitCombat', label: 'LA.effectManager.trigger.onExitCombat' },
    { value: 'onFullRepair', label: 'LA.effectManager.trigger.onFullRepair' },
    { value: 'onPreStatusApplied', label: 'LA.effectManager.trigger.onPreStatusApplied' },
    { value: 'onPreStatusRemoved', label: 'LA.effectManager.trigger.onPreStatusRemoved' },
    { value: 'onStatusApplied', label: 'LA.effectManager.trigger.onStatusApplied' },
    { value: 'onStatusRemoved', label: 'LA.effectManager.trigger.onStatusRemoved' }
];

function consumptionTriggerCheckboxesHtml()
{
    return CONSUMPTION_TRIGGER_LIST
        .map(triggerOption => `<label><input type="checkbox" value="${triggerOption.value}"> ${localize(triggerOption.label)}</label>`)
        .join('');
}

/**
 * Generate inline trigger fields HTML for a given prefix (std/cust)
 */
function triggerFieldsHtml(prefix, tokensHtml)
{
    return `
        <div class="form-group">
            <label>Auto-consume on:</label>
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
            <div class="te-row-2col">
                <div class="form-group cfilter-itemLid" style="display:none;">
                    <label data-tooltip="${localize('LA.effectManager.tip.consumeItemLid')}">Item:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="${prefix}-filter-itemLid" placeholder="${localize('LA.effectManager.ph.itemLidEg')}" style="flex:1;">
                        <button type="button" class="find-lid-btn" data-target="${prefix}-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                    </div>
                </div>
                <div class="form-group cfilter-itemId" style="display:none;">
                    <label data-tooltip="${localize('LA.effectManager.tip.consumeItemId')}">Item ID:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="${prefix}-filter-itemId" placeholder="${localize('LA.common.itemId')}" style="flex:1;">
                        <button type="button" class="item-picker-btn" data-target="${prefix}-filter-itemId" data-token-source="${prefix}-target" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                    </div>
                </div>
            </div>
            <div class="form-group cfilter-actionName" style="display:none;">
                <label data-tooltip="${localize('LA.effectManager.tip.consumeActionEg')}">Consume on action:</label>
                <input type="text" id="${prefix}-filter-actionName" placeholder="${localize('LA.effectManager.ph.actionEg')}">
            </div>
            <div class="form-group cfilter-check" style="display:none;">
                <label>Check:</label>
                <input type="text" id="${prefix}-filter-checkType" placeholder="hull" style="width:50%;">
            </div>
            <div class="form-group cfilter-statusId" style="display:none;">
                <label data-tooltip="${localize('LA.effectManager.tip.consumeStatus')}">Status:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <input type="text" id="${prefix}-filter-statusId" placeholder="${localize('LA.effectManager.ph.statusEg')}" style="flex:1;">
                    <button type="button" class="status-picker-btn" data-target="${prefix}-filter-statusId" style="flex:0 0 28px; padding:0;" title="Pick Status"><i class="fas fa-shield-alt"></i></button>
                </div>
            </div>
            <div class="form-group cfilter-role" style="display:none;">
                <label data-tooltip="${localize('LA.effectManager.tip.consumeRoleOrigin')}">Consume as:</label>
                <select id="${prefix}-filter-role" style="width:50%;">
                    <option value="">Source</option>
                    <option value="target">Target</option>
                    <option value="any">Source or target</option>
                </select>
            </div>
            ${codeFieldRow(`${prefix}-evaluate`, 'Evaluate', '(triggerType, triggerData, effectBearerToken, effect) => true')}
        </div>
    `;
}

export function buildEffectManagerContent(view)
{
    const {
        hasCustomStatus, allPresets, targetsHtml, tokensHtml, originsHtml, durationOptionsHtml, bonusDurationOptionsHtml,
        dmgTypeOptionsHtml, statusEffectIconsHtml, damageTypeIconsHtml, savedStatuses, availableTags, STAT_BONUS_GROUPS,
    } = view;
    return `
    <style>
        .te-dialog { min-width: 560px; font-family: var(--font-primary); }
        .te-tabs { display: flex; border-bottom: 3px solid var(--primary-color); margin-bottom: 8px; cursor: pointer; }
        .te-tab { padding: 8px 14px; font-weight: 600; opacity: 0.5; font-size: 0.9em; transition: all 0.2s ease; color: var(--la-ink); border-bottom: 3px solid transparent; margin-bottom: -3px; }
        .te-tab:hover { opacity: 0.8; }
        .te-tab.active { opacity: 1; border-bottom-color: var(--primary-color); color: var(--la-accent); }
        .te-content { display: none; padding: 8px 0; }
        .te-content.active { display: block; }
        .te-dialog .form-group { margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .te-dialog .form-group label { flex: 0 0 70px; font-size: 0.85em; white-space: nowrap; font-weight: 600; color: var(--la-ink); }
        .te-dialog .form-group select,
        .te-dialog .form-group input[type="text"],
        .te-dialog .form-group input[type="number"] { flex: 1; height: 26px; font-size: 0.9em; background: color-mix(in srgb, var(--la-plate), var(--la-ink) 8%); border: 2px solid var(--la-edge); border-radius: 4px; color: var(--la-ink); padding: 0 6px; transition: border-color 0.2s ease; }
        .te-dialog .form-group select:focus,
        .te-dialog .form-group input:focus { border-color: var(--primary-color); outline: none; box-shadow: 0 0 4px color-mix(in srgb, var(--primary-color), transparent 70%); }
        .te-dialog .form-group.two-col { display: grid; grid-template-columns: 70px 1fr 70px 1fr; gap: 5px; align-items: center; }
        .te-dialog .form-group.two-col label { flex: unset; }
        .te-icon-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 4px; max-height: 120px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 4px; border: 1px solid var(--la-edge); }
        .te-icon-option { cursor: pointer; width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border: 1px solid var(--la-edge); border-radius: 4px; background: #1a1a1a; transition: all 0.2s; }
        .te-icon-option img { object-fit: contain; pointer-events: none; }
        .te-icon-option.selected { border: 2px solid var(--primary-color); box-shadow: 0 0 5px color-mix(in srgb, var(--primary-color), transparent 50%); }
        .std-effect-option:hover, .bonus-immunity-effect-option:hover { background: color-mix(in srgb, var(--primary-color) 18%, var(--la-plate)) !important; }
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
        .te-effect-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; background: var(--la-plate); border: 2px solid var(--la-edge); border-radius: 4px; margin-bottom: 6px; font-size: 0.9em; transition: all 0.2s ease; }
        .te-effect-item:hover { border-color: var(--primary-color); box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
        .te-effect-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .te-delete-btn { color: var(--primary-color); cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: all 0.2s ease; }
        .te-delete-btn:hover { background: color-mix(in srgb, var(--primary-color) 18%, var(--la-plate)); }
        .te-btn-group { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
        .te-btn { background: var(--la-plate); border: 2px solid var(--la-edge); color: var(--la-ink); padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; transition: all 0.2s ease; }
        .te-btn-group .save-preset-btn, .te-btn-group .extract-code-btn { flex: 0 0 auto; width: auto; white-space: nowrap; }
        .te-btn-group .apply-btn, .te-btn-group #bonus-add { flex: 1 1 auto; }
        .te-btn:hover { background: color-mix(in srgb, var(--primary-color) 18%, var(--la-plate)); border-color: var(--primary-color); box-shadow: 0 2px 8px rgba(0,0,0,0.3); transform: translateY(-1px); }
        .te-btn i { margin-right: 5px; color: var(--primary-color); }
        .te-stack-ctrl { display: flex; gap: 4px; }
        .te-stack-ctrl i { cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: all 0.2s ease; color: var(--primary-color); }
        .te-stack-ctrl i:hover { background: color-mix(in srgb, var(--primary-color) 18%, var(--la-plate)); }
        .te-divider { border: none; border-top: 2px solid var(--primary-color); margin: 10px 0; }
        .te-section-title { font-weight: 600; color: var(--la-accent); font-size: 13px; margin: 8px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .te-section { font-weight: 700; color: var(--la-accent); font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.6px; margin: 10px 0 4px; padding: 0 0 3px 2px; border-bottom: 1px solid color-mix(in srgb, var(--primary-color) 35%, transparent); }
        .te-section:first-child { margin-top: 0; }
        .te-row-2col { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
        .te-row-2col > .form-group { margin-bottom: 0; }
        .te-advanced { margin-top: 8px; }
        .te-advanced > summary { cursor: pointer; font-weight: 700; font-size: 0.78em; text-transform: uppercase; letter-spacing: 0.6px; color: var(--la-ink-dim); padding: 5px 2px; border-top: 1px dashed var(--la-edge); user-select: none; list-style: none; }
        .te-advanced > summary::before { content: "\\25B6"; display: inline-block; margin-right: 6px; transition: transform 0.15s ease; font-size: 0.7em; color: var(--primary-color); }
        .te-advanced[open] > summary::before { transform: rotate(90deg); }
        .te-advanced[open] > summary { color: var(--la-accent); border-top-color: var(--primary-color); }
        .te-advanced > summary::-webkit-details-marker { display: none; }
        .code-field-badge { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; height: 26px; background: var(--la-plate); border: 1.5px solid var(--la-edge); border-radius: 13px; font-size: 0.82em; cursor: pointer; flex: 0 0 auto; transition: all 0.15s ease; color: var(--la-ink-dim); }
        .code-field-badge:hover { border-color: var(--primary-color); background: color-mix(in srgb, var(--la-plate), var(--la-ink) 12%); }
        .code-field-badge .code-field-dot { width: 8px; height: 8px; border-radius: 50%; background: #bbb; flex: 0 0 8px; }
        .code-field-badge.has-value { border-color: #4a8a3a; background: #e6f3e0; color: #2d5a1f; font-weight: 600; }
        .code-field-badge.has-value .code-field-dot { background: #4a8a3a; box-shadow: 0 0 4px rgba(74,138,58,0.5); }
        .bonus-summary-pill { flex: 0 0 auto; padding: 2px 8px; background: color-mix(in srgb, var(--la-plate), #000 6%); border-radius: 10px; font-size: 0.72em; color: var(--la-ink-dim); font-weight: 600; text-align: center; min-width: 36px; }
        .bonus-summary-pill.has-bonuses { background: #d6e8d2; color: #2d5a1f; }
        .preset-bar { display: flex; gap: 6px; align-items: center; padding: 4px 6px; margin-bottom: 6px; background: rgba(0,0,0,0.04); border-radius: 4px; border: 1px dashed var(--la-edge); }
        .preset-bar label { flex: 0 0 50px; font-size: 0.8em; font-weight: 600; color: var(--la-ink-dim); text-transform: uppercase; letter-spacing: 0.3px; }
        .preset-bar select { flex: 1; height: 24px; font-size: 0.85em; }
        .te-btn-icon { background: var(--la-plate); border: 1.5px solid var(--la-edge); border-radius: 4px; cursor: pointer; color: var(--primary-color); }
        .te-btn-icon:hover { background: color-mix(in srgb, var(--primary-color) 18%, var(--la-plate)); border-color: var(--primary-color); }
        .te-bonus-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: var(--la-plate); border: 2px solid var(--la-edge); border-radius: 4px; margin-bottom: 4px; font-size: 0.9em; transition: all 0.2s ease; }
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
                    <select id="std-target" style="flex:1;">${targetsHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="std-target" style="flex:0 0 28px; padding:0;" title="Pick Token (Shift-click to add)"><i class="fas fa-crosshairs"></i></button>
                    <span class="em-tier-slot" data-tab="std" style="display:none; align-self:center; margin-left:4px;">${tierGateControl(null, 'data-role="em-std"')}</span>
                </div>
            </div>
            <div class="form-group" style="flex-direction: column; align-items: stretch; gap: 8px;">
                <div style="display:flex; justify-content:space-between; align-items: center;">
                    <label>Apply:</label>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <span id="std-effect-label" style="font-weight:bold; color:var(--la-accent);">Bolster</span>
                        <img id="std-effect-icon" src="" width="30" height="30" style="border:2px solid var(--primary-color); border-radius:4px; background:#1a1a1a; display:block; object-fit: contain; padding:2px;">
                        x<input type="number" id="std-stack" value="1" min="1" style="width: 45px; height:30px; text-align:center;">
                    </div>
                </div>
                <input type="hidden" id="std-effect" value="Bolster">
                <input type="text" id="std-effect-search" placeholder="${localize('LA.common.searchEffects')}" style="height:24px; font-size:0.85em; padding:0 6px;">
                <div id="std-effect-grid" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1px; max-height:180px; overflow-y:auto; padding:3px; background:color-mix(in srgb, var(--la-plate), var(--la-ink) 7%); border-radius:4px; border:1px solid var(--la-edge);">
                     ${STATUS_GROUP_ORDER.filter(groupKey => groupKey !== 'favorites').map(groupKey =>
                    {
                        const members = /** @type {any[]} */ ([...CONFIG.statusEffects])
                            .filter(statusEffect => statusGroupKey(statusEffect.id) === groupKey)
                            .sort((a, b) => (localize(a.name) || a.name).localeCompare(localize(b.name) || b.name));
                        if (!members.length)
                            return '';
                        return `<div class="la-hud-status-section std-effect-group" data-group="${groupKey}" style="font-weight:bold; text-transform:uppercase;">${localize(`LA.tokenHud.statusGroup.${groupKey}`)}</div>` + members.map(statusEffect =>
                        {
                            const label = localize(statusEffect.name);
                            return `
                        <div class="std-effect-option" data-id="${statusEffect.name}" data-name="${label}" data-icon="${statusEffect.img || statusEffect.icon}" data-group="${groupKey}" title="${label}" style="cursor:pointer; display:flex; align-items:center; gap:3px; padding:0 3px; border-radius:2px; border-left:3px solid transparent; background:var(--la-plate); color:var(--la-ink); font-size:0.75em; min-width:0;">
                            <img src="${statusEffect.img || statusEffect.icon}" style="width:20px; height:20px; object-fit:contain; flex-shrink:0; background:#2a2a2a; border-radius:2px; padding:1px; pointer-events:none;" title="${label}">
                            <span class="la-hud-clip" style="flex:1; overflow:hidden; min-width:0; pointer-events:none;"><span class="la-hud-pan" style="display:inline-block; white-space:nowrap; padding-right:6px;">${label}</span></span>
                        </div>`;
                        }).join('');
                    }).join('')}
                </div>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="std-duration" style="flex:0 0 120px !important; width:120px !important; max-width:120px !important;">${durationOptionsHtml}</select>
                    <span class="dur-opts dur-origin" style="flex-shrink:0;"> of </span>
                    <div class="dur-opts dur-origin" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="std-origin" style="flex:1; min-width:0;">${originsHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="std-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts dur-count" style="margin-left:5px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="std-turns" value="1" min="0" class="dur-opts" title="0 = next matching trigger (end/start of the current or next turn)" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="std-note" placeholder="${localize('LA.common.optionalNote')}">
            </div>
            <div class="te-section">Consumption</div>
            ${triggerFieldsHtml('std', tokensHtml)}
            <div class="te-btn-group">
                <button type="button" class="te-btn save-preset-btn" data-prefix="std"><i class="fas fa-bookmark"></i> Save Preset</button>
                <button type="button" class="te-btn extract-code-btn" data-tab="standard" title="Show the api call for this form, to use in automation code"><i class="fas fa-code"></i> Extract Code</button>
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
                    <select id="cust-target" style="flex:1;">${targetsHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="cust-target" style="flex:0 0 28px; padding:0;" title="Pick Token (Shift-click to add)"><i class="fas fa-crosshairs"></i></button>
                    <span class="em-tier-slot" data-tab="cust" style="display:none; align-self:center; margin-left:4px;">${tierGateControl(null, 'data-role="em-cust"')}</span>
                </div>
                <label style="text-align:right; padding-right:5px;">Saved:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="cust-saved-icon" src="" width="26" height="26" style="border:2px solid var(--la-edge); border-radius:4px; background:#1a1a1a; display:none; object-fit: contain;">
                    <select id="cust-saved" style="flex:1;">
                        <option value="">-- Select --</option>
                        ${savedStatuses.map(savedStatus => `<option value="${savedStatus.name}" data-icon="${savedStatus.icon}">${savedStatus.name}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group two-col" style="grid-template-columns: 80px 1fr 60px 60px;">
                <label>Name:</label>
                <div style="display:flex; gap:4px; align-items:center; min-width:0; width:100%;">
                    <input type="text" id="cust-name" placeholder="${localize('LA.effectManager.ph.statusName')}" style="flex:1; min-width:0;">
                    <button type="button" class="save-status-btn" title="Save Status (add Name + Icon + Description to the Saved list)" style="flex:0 0 28px; width:28px; height:28px; padding:0; line-height:1;"><i class="fas fa-save"></i></button>
                </div>
                <label style="text-align:right; padding-right:5px;">Stack:</label>
                <input type="number" id="cust-stack" value="1" min="1">
            </div>
            <div class="form-group">
                <label>Icon:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="cust-icon-preview" src="systems/lancer/assets/icons/white/d20-framed.svg" style="width:26px; height:26px; flex:0 0 26px; object-fit:contain; background:#1a1a1a; border:2px solid var(--la-edge); border-radius:4px; padding:1px;" onerror="this.style.opacity='0.3';">
                    <input type="text" id="cust-icon" value="systems/lancer/assets/icons/white/d20-framed.svg" style="flex:1; min-width:0;">
                    <button type="button" class="file-picker" data-type="image" data-target="cust-icon" title="Browse Files" tabindex="-1" style="flex:0 0 30px;"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
            </div>
            <div class="form-group">
                <label>Description:</label>
                <textarea id="cust-description" rows="2" placeholder="${localize('LA.effectManager.ph.statusDescription')}" style="flex:1; min-width:0; resize:vertical;"></textarea>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="cust-duration" style="flex:0 0 120px !important; width:120px !important; max-width:120px !important;">${durationOptionsHtml}</select>
                    <span class="dur-opts dur-origin" style="flex-shrink:0;"> of </span>
                    <div class="dur-opts dur-origin" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="cust-origin" style="flex:1; min-width:0;">${originsHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="cust-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts dur-count" style="margin-left:5px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="cust-turns" value="1" min="0" class="dur-opts" title="0 = next matching trigger (end/start of the current or next turn)" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="cust-note" placeholder="${localize('LA.common.optionalNote')}">
            </div>
            <div class="te-section">Consumption</div>
            ${triggerFieldsHtml('cust', tokensHtml)}
            <details class="te-advanced">
                <summary>Advanced</summary>
                ${codeFieldRow('cust-changes', 'Active Effect Changes', '[{"key":"system.armor","mode":2,"value":"1"}]')}
            </details>
            <div class="te-btn-group">
                <button type="button" class="te-btn save-preset-btn" data-prefix="cust"><i class="fas fa-bookmark"></i> Save Preset</button>
                <button type="button" class="te-btn extract-code-btn" data-tab="custom" title="Show the api call for this form, to use in automation code"><i class="fas fa-code"></i> Extract Code</button>
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
            <details class="te-advanced" id="manage-presets">
                <summary>Presets</summary>
                <div id="manage-presets-list" style="display:flex; flex-direction:column; gap:3px; padding:4px 0;"></div>
            </details>
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
                    <select id="bonus-target" style="flex:1;">${targetsHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="bonus-target" style="flex:0 0 28px; padding:0;" title="Pick Token (Shift-click to add)"><i class="fas fa-crosshairs"></i></button>
                </div>
                <span id="bonus-summary" class="bonus-summary-pill">—</span>
                <span class="em-tier-slot" data-tab="bonus" style="display:none;">${tierGateControl(null, 'data-role="em-bonus"')}</span>
            </div>
            <div class="te-section">Add New Bonus</div>
            <div class="form-group">
                <label>Name:</label>
                <input type="text" id="bonus-name" value="Test Bonus">
            </div>
            <div class="form-group">
                <label>Icon:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <img id="bonus-icon-preview" src="" style="width:26px; height:26px; flex:0 0 26px; object-fit:contain; background:#1a1a1a; border:2px solid var(--la-edge); border-radius:4px; padding:1px;" onerror="this.style.opacity='0.3';">
                    <input type="text" id="bonus-icon" placeholder="${localize('LA.effectManager.ph.iconAuto')}" style="flex:1; min-width:0;">
                    <button type="button" class="file-picker" data-type="image" data-target="bonus-icon" title="Browse Files" tabindex="-1" style="flex:0 0 30px;"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
            </div>
            <div class="te-section">Duration</div>
            <div class="form-group">
                <label>Duration:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="bonus-duration" style="flex:0 0 120px !important; width:120px !important; max-width:120px !important;">${bonusDurationOptionsHtml}</select>
                    <span class="bonus-dur-opts dur-origin" style="flex-shrink:0;"> of </span>
                    <div class="bonus-dur-opts dur-origin" style="flex:0 0 130px; display:flex; gap:3px;">
                        <select id="bonus-durOrigin" style="flex:1; min-width:0;">${originsHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="bonus-durOrigin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="bonus-dur-opts dur-count" style="margin-left:3px; flex-shrink:0; white-space:nowrap;">Turns:</span>
                    <input type="number" id="bonus-durTurns" value="1" min="0" class="bonus-dur-opts" title="0 = next matching trigger (end/start of the current or next turn)" style="flex:0 0 50px; min-width:50px; max-width:50px;">
                </div>
            </div>
            <div class="form-group" style="justify-content:flex-start;">
                <label style="flex:0 0 70px;">Uses:</label>
                <div style="display:flex; gap:4px; align-items:center;">
                    <button type="button" class="bonus-uses-step" data-step="-1" title="Decrement" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-uses" placeholder="${localize('LA.effectManager.ph.usesInfinite')}" min="1" style="flex:0 0 70px; min-width:70px; max-width:70px; text-align:center;">
                    <button type="button" class="bonus-uses-step" data-step="1" title="Increment" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                    <label id="bonus-consume-usage-row" style="display:none; align-items:center; gap:4px; margin-left:10px; white-space:nowrap;" data-tooltip="${localize('LA.effectManager.tip.consumeOnUsage')}">
                        <input type="checkbox" id="bonus-consumeOnUsage" checked> Consume on usage
                    </label>
                    <label id="bonus-frequency-row" style="display:flex; align-items:center; gap:4px; margin-left:10px; white-space:nowrap;">
                        Limit:
                        <input type="number" id="bonus-frequency-count" value="1" min="1" style="display:none; flex:0 0 46px; min-width:46px; max-width:46px; text-align:center;">
                        <select id="bonus-frequency" style="flex:0 0 auto; width:auto; min-width:90px;">
                            <option value="">None</option>
                            <option value="round">/round</option>
                            <option value="turn">/turn</option>
                            <option value="combat">/combat</option>
                            <option value="mission">/mission</option>
                        </select>
                    </label>
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
                        <option value="resistance">Resistance</option>
                        <option value="vulnerability">Vulnerability</option>
                        <option value="target_modifier">Target Modifier</option>
                        <option value="reroll">Reroll</option>
                        <option value="movement_extra">Movement Extra</option>
                        <option value="action_extra">Action Extra</option>
                    </select>
                </div>
                <div class="form-group" style="flex:1; margin:0;">
                    <label>Auto-consume on:</label>
                    <div class="la-multi-select" id="bonus-trigger">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel" id="bonus-trigger-panel">
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
                <div class="te-row-2col">
                    <div class="form-group bonus-filter-itemLid" style="display:none;">
                        <label data-tooltip="${localize('LA.effectManager.tip.consumeItemLid')}">Item:</label>
                        <div style="flex:1; display:flex; gap:3px;">
                            <input type="text" id="bonus-filter-itemLid" placeholder="${localize('LA.effectManager.ph.itemLidEg')}" style="flex:1;">
                            <button type="button" class="find-lid-btn" data-target="bonus-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                        </div>
                    </div>
                    <div class="form-group bonus-filter-itemId" style="display:none;">
                        <label data-tooltip="${localize('LA.effectManager.tip.consumeItemId')}">Item ID:</label>
                        <div style="flex:1; display:flex; gap:3px;">
                            <input type="text" id="bonus-filter-itemId" placeholder="${localize('LA.common.itemId')}" style="flex:1;">
                            <button type="button" class="item-picker-btn" data-target="bonus-filter-itemId" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                        </div>
                    </div>
                </div>
                <div class="form-group bonus-filter-actionName" style="display:none;">
                    <label data-tooltip="${localize('LA.effectManager.tip.consumeAction')}">Consume on action:</label>
                    <input type="text" id="bonus-filter-actionName" placeholder="${localize('LA.effectManager.ph.actionEg')}">
                </div>
                <div class="form-group bonus-filter-statusId" style="display:none;">
                    <label data-tooltip="${localize('LA.effectManager.tip.consumeStatus')}">Status:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-filter-statusId" placeholder="${localize('LA.effectManager.ph.statusEg')}" style="flex:1;">
                        <button type="button" class="bonus-status-picker-btn" data-target="bonus-filter-statusId" style="flex:0 0 28px; padding:0;" title="Pick Status"><i class="fas fa-shield-alt"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-role" style="display:none;">
                    <label data-tooltip="${localize('LA.effectManager.tip.consumeRoleBearer')}">Consume as:</label>
                    <select id="bonus-filter-role" style="width:50%;">
                        <option value="">Source</option>
                        <option value="target">Target</option>
                        <option value="any">Source or target</option>
                    </select>
                </div>
                <div class="form-group bonus-filter-distance" style="display:none;">
                    <label>Min distance:</label>
                    <input type="number" id="bonus-filter-minDistance" placeholder="0" min="0">
                </div>
                <div class="form-group bonus-filter-check" style="display:none;">
                    <label>Check type:</label>
                    <input type="text" id="bonus-filter-checkType" placeholder="${localize('LA.effectManager.ph.checkTypeEg')}">
                </div>
                <div class="form-group bonus-filter-checkValues" style="display:none;">
                    <label>Above:</label>
                    <input type="number" id="bonus-filter-checkAbove" placeholder="any" style="width:40%;">
                    <label>Below:</label>
                    <input type="number" id="bonus-filter-checkBelow" placeholder="any" style="width:40%;">
                </div>
            </div>
            <div id="bonus-type-stat">
                <div style="display:flex; gap:10px; align-items:center;">
                    <div class="form-group" style="flex:0 0 auto; margin:0; display:flex; gap:6px; align-items:center;">
                        <label style="flex:0 0 auto;">Mode:</label>
                        <select id="bonus-statMode" style="flex:0 0 auto; width:auto; min-width:90px;">
                            ${STAT_BONUS_MODES.map(mode => `<option value="${mode.value}">${localize(mode.label)}</option>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; min-width:0; margin:0; display:flex; gap:6px; align-items:center;">
                        <label style="flex:0 0 auto;">Stat:</label>
                        <select id="bonus-stat" style="flex:1; min-width:0;">
                            ${STAT_BONUS_GROUPS.map(group => `<optgroup label="${group.label}">${Object.entries(group.stats).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</optgroup>`).join('')}
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; margin:0; display:flex; gap:6px; align-items:center; justify-content:flex-start;">
                        <label style="flex:0 0 auto;">Value:</label>
                        <button type="button" class="la-num-step" data-target="bonus-statVal" data-step="-1" title="Decrement" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                        <input type="number" id="bonus-statVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; font-size:0.9em; border:2px solid var(--la-edge); border-radius:4px;">
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
                            <option value="flat">Flat</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:1; margin:0; display:flex; gap:6px; align-items:center; justify-content:flex-start;">
                        <label style="flex:0 0 auto;">Value:</label>
                        <button type="button" class="la-num-step" data-target="bonus-accDiffVal" data-step="-1" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                        <input type="number" id="bonus-accDiffVal" value="1" min="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; font-size:0.9em; border:2px solid var(--la-edge); border-radius:4px;">
                        <button type="button" class="la-num-step" data-target="bonus-accDiffVal" data-step="1" style="flex:0 0 28px; width:28px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                    </div>
                </div>
            </div>
            <div id="bonus-type-damage" style="display:none;">
                <div class="form-group" style="justify-content:flex-start;">
                    <label>Mode:</label>
                    <select id="bonus-damageMode" style="flex:0.6;">
                        ${DAMAGE_BONUS_MODES.map(mode => `<option value="${mode.value}">${localize(mode.label)}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" id="bonus-damageScope-row" style="justify-content:flex-start; display:none;">
                    <label>Scope:</label>
                    <select id="bonus-damageScope" style="flex:0.6;">
                        ${DAMAGE_CHANGE_TYPE_SCOPES.map(scope => `<option value="${scope.value}">${localize(scope.label)}</option>`).join('')}
                    </select>
                </div>
                <div id="bonus-damageMode-warning" style="display:none; color:#c33; font-size:0.85em; margin: 4px 0 6px; padding: 4px 8px; background: rgba(204,51,51,0.08); border-left: 3px solid #c33;">
                    Replace and Change Type apply globally to the weapon. Per-target selection will be ignored.
                </div>
                <div id="bonus-damage-list">
                    <div class="bonus-damage-entry form-group" data-index="0">
                        <select id="bonus-dmgFrom-0" class="bonus-damage-from" style="flex:1; display:none;">
                            <option value="${DAMAGE_CHANGE_TYPE_ALL}">All Types</option>
                            ${dmgTypeOptionsHtml}
                        </select>
                        <span class="bonus-damage-arrow" style="display:none; padding:0 4px;">→</span>
                        <input type="text" id="bonus-dmgVal-0" value="1d6" placeholder="1d6" class="bonus-damage-val" style="flex:1;">
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
                        ${availableTags.map(tag => `<option value="${tag.id}">${tag.name}</option>`).join('')}
                    </select>
                </div>
                <div class="form-group" style="justify-content:flex-start;">
                    <label>Mode:</label>
                    <select id="bonus-tagMode" style="flex:0.6;">
                        <option value="add">Add Value</option>
                        <option value="override">Override Value</option>
                        <option value="at_least">At least</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <button type="button" class="la-num-step" data-target="bonus-tagVal" data-step="-1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-tagVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; border:2px solid var(--la-edge); border-radius:4px;">
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
                        <option value="at_least">At least</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <button type="button" class="la-num-step" data-target="bonus-rangeVal" data-step="-1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-minus"></i></button>
                    <input type="number" id="bonus-rangeVal" value="1" style="flex:0 0 50px; min-width:50px; max-width:50px; text-align:center; height:30px; border:2px solid var(--la-edge); border-radius:4px;">
                    <button type="button" class="la-num-step" data-target="bonus-rangeVal" data-step="1" style="flex:0 0 26px; padding:0; height:26px;"><i class="fas fa-plus"></i></button>
                </div>
            </div>
            <div id="bonus-type-immunity" style="display:none;">
                <div class="form-group">
                    <label>Immunity Subtype:</label>
                    <select id="bonus-immunity-subtype">
                        <option value="effect">Effect</option>
                        <option value="damage">Damage</option>
                        <option value="crit">Critical Hit</option>
                        <option value="hit">Hit</option>
                        <option value="miss">Miss</option>
                        <option value="elevation">Elevation</option>
                        <option value="terrain">Terrain</option>
                        <option value="obstacle">Obstacle (Phasing)</option>
                        <option value="provoke">Provoke (Engagement &amp; Reactions)</option>
                    </select>
                </div>
                <div id="bonus-immunity-effects-row">
                    <label style="display:block; font-weight:600; font-size:0.85em; margin-bottom:4px;">Select Status Effects:</label>
                    <input type="text" id="bonus-immunity-effect-search" placeholder="${localize('LA.common.searchEffects')}" style="width:100%; height:24px; font-size:0.85em; padding:0 6px; margin-bottom:4px;">
                    <div id="bonus-immunity-effects" style="display:grid; grid-template-columns:repeat(4, 1fr); gap:1px; max-height:180px; overflow-y:auto; padding:3px; background:color-mix(in srgb, var(--la-plate), var(--la-ink) 7%); border-radius:4px; border:1px solid var(--la-edge);">
                        ${statusEffectIconsHtml}
                    </div>
                </div>
            </div>
            <div id="bonus-immunity-damage-row" style="display:none;">
                <label style="display:block; font-weight:600; font-size:0.85em; margin-bottom:4px;">Select Damage Types:</label>
                <div class="te-icon-grid" id="bonus-immunity-damageTypes">
                    ${damageTypeIconsHtml}
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
                        <div class="la-multi-select-panel" id="bonus-reroll-rollTypes-panel">
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
            <div id="bonus-type-movement_extra" style="display:none;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <div class="form-group" style="flex:1; margin:0;">
                        <label>Applies to:</label>
                        <select name="movement-extra-subtype" id="bonus-movement-extra-subtype">
                            <option value="boost">Boost</option>
                            <option value="standard">Standard Move</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:0 0 auto; margin:0;">
                        <label>Spaces:</label>
                        <input type="number" id="bonus-movement-extra-val" value="1" style="width:60px; text-align:center;" title="Added to each Standard Move or Boost.">
                    </div>
                </div>
            </div>
            <div id="bonus-type-action_extra" style="display:none;">
                <div style="display:flex; gap:10px; align-items:center;">
                    <div class="form-group" style="flex:1; margin:0;">
                        <label>Action:</label>
                        <select name="action-extra-subtype" id="bonus-action-extra-subtype">
                            <option value="reaction">Reaction</option>
                            <option value="quick">Quick Action</option>
                            <option value="full">Full Action</option>
                        </select>
                    </div>
                    <div class="form-group" style="flex:0 0 auto; margin:0;">
                        <label>Count:</label>
                        <input type="number" id="bonus-action-extra-val" value="1" min="1" style="width:60px; text-align:center;" title="Extra uses each turn.">
                    </div>
                </div>
            </div>
            <div id="bonus-items-row" style="display:none;">
                <div class="form-group" id="row-bonus-rollTypes-roll" style="display:none;">
                    <label>Roll Type:</label>
                    <div class="la-multi-select" id="bonus-rollTypes-roll">
                        <button type="button" class="la-multi-select-trigger">— Select —</button>
                        <div class="la-multi-select-panel" id="bonus-rollTypes-roll-panel">
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
                        <div class="la-multi-select-panel" id="bonus-rollTypes-damage-panel">
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
                        <div class="form-group" id="row-bonus-itemLids">
                            <label data-tooltip="${localize('LA.effectManager.tip.applyItemLids')}">Items (LID):</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-itemLids" placeholder="${localize('LA.effectManager.ph.itemLidsEg')}" style="flex:1;">
                                <button type="button" class="find-lid-btn" data-target="bonus-itemLids" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                            </div>
                        </div>
                        <div class="form-group" id="row-bonus-itemId">
                            <label data-tooltip="${localize('LA.effectManager.tip.applyItemId')}">Item ID:</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-itemId" placeholder="${localize('LA.common.itemId')}" style="flex:1;">
                                <button type="button" class="item-picker-btn" data-target="bonus-itemId" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                            </div>
                        </div>
                    </div>
                    <div class="te-row-2col" id="row-bonus-tokens">
                        <div class="form-group">
                            <label data-tooltip="${localize('LA.effectManager.tip.applyTokens')}">Tokens:</label>
                            <div style="flex:1; display:flex; gap:3px;">
                                <input type="text" id="bonus-applyTo" placeholder="${localize('LA.effectManager.ph.tokenIds')}" style="flex:1;">
                                <button type="button" class="token-picker-btn" data-target="bonus-applyTo" data-count="-1" style="flex:0 0 28px; padding:0;" title="Select Tokens"><i class="fas fa-crosshairs"></i></button>
                            </div>
                        </div>
                        <div class="form-group" style="justify-content:flex-start;">
                            <label data-tooltip="${localize('LA.effectManager.tip.applyToTargetter')}" style="flex:0 0 auto; margin-right:6px;">Targetter:</label>
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
                <button type="button" class="te-btn extract-code-btn" data-tab="bonus" title="Show the api call for this form, to use in automation code"><i class="fas fa-code"></i> Extract Code</button>
                <button type="button" class="te-btn" id="bonus-add"><i class="fas fa-plus-circle"></i> Add Bonus</button>
            </div>
            <hr class="te-divider">
            <button type="button" class="te-btn" id="bonus-clear-all" style="width:100%; border-color:var(--primary-color);"><i class="fas fa-trash"></i> Clear All Bonuses</button>
        </div>
    </div>
    `;
}
