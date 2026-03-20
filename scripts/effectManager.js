/* global canvas, game, ui, FilePicker */

import {
    applyEffectsToTokens
} from "./flagged-effects.js";
import {
    addGlobalBonus,
    removeGlobalBonus,
    removeConstantBonus
} from "./genericBonuses.js";
import { openItemBrowserDialog } from "./misc-tools.js";

/**
 * Open item browser and populate targetInput with the selected LID.
 * @param {JQuery} targetInput
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
        const customs = customApi.getStatuses() || [];
        for (const cs of customs) {
            if (!statuses.some(s => s.id === cs.id))
                statuses.push(cs);
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

const CONSUMPTION_TRIGGER_OPTIONS = `
    <option value="">None</option>
    <option value="onAttack">On Attack</option>
    <option value="onHit">On Hit</option>
    <option value="onMiss">On Miss</option>
    <option value="onDamage">On Damage</option>
    <option value="onTechAttack">On Tech Attack</option>
    <option value="onTechHit">On Tech Hit</option>
    <option value="onMove">On Move</option>
    <option value="onPreMove">On Pre Move</option>
    <option value="onInitActivation">On Init Activation</option>
    <option value="onActivation">On Activation</option>
    <option value="onDeploy">On Deploy</option>
    <option value="onCheck">On Check</option>
    <option value="onHeat">On Heat</option>
    <option value="onHpLoss">On HP Loss</option>
    <option value="onTurnStart">On Turn Start</option>
    <option value="onTurnEnd">On Turn End</option>
    <option value="onEnterCombat">On Enter Combat</option>
    <option value="onExitCombat">On Exit Combat</option>
    <option value="onPreStatusApplied">On Pre Status Applied</option>
    <option value="onPreStatusRemoved">On Pre Status Removed</option>
    <option value="onStatusApplied">On Status Applied</option>
    <option value="onStatusRemoved">On Status Removed</option>
`;

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
            <select id="${prefix}-trigger">${CONSUMPTION_TRIGGER_OPTIONS}</select>
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
        </div>
    `;
}

/**
 * Setup trigger field toggle + item browser buttons for a given prefix
 */
function setupTriggerUI(html, prefix) {
    html.find(`#${prefix}-trigger`).on('change', function () {
        const trigger = $(this).val();
        const $fields = html.find(`#${prefix}-trigger-fields`);
        $fields.find('.form-group').hide();
        if (trigger && CONSUMPTION_FILTER_MAP[trigger]) {
            $fields.show();
            // Always show origin when trigger is set
            $fields.find('.form-group').first().show();
            CONSUMPTION_FILTER_MAP[trigger].forEach(cls => $fields.find(`.${cls}`).show());
        } else {
            $fields.hide();
        }
        html.closest('.dialog').css('height', 'auto');
    });

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
    const trigger = html.find(`#${prefix}-trigger`).val();
    if (!trigger)
        return null;

    const consumption = {
        trigger
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

// Main Function: executeEffectManager
export async function executeEffectManager(options = {}) {
    console.log('lancer-automations | Executing Effect Manager');

    const availableTags = await fetchAvailableTags();


    let defaultTarget = null;
    if (canvas.tokens.controlled.length > 0)
        defaultTarget = canvas.tokens.controlled[0];
    else if (game.user.targets.size > 0)
        defaultTarget = game.user.targets.first();

    const tokens = canvas.tokens.placeables;
    const tokensHtml = tokens.map(t => {
        const isSelf = t.id === defaultTarget?.id;
        return `<option value="${t.id}" ${isSelf ? 'selected' : ''}>${t.name}${isSelf ? ' (self)' : ''}</option>`;
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
    durations.push({
        label: 'indefinite',
        turns: null,
        rounded: null,
        name: "Indefinite"
    });

    if (!game.combat) {
        durations = durations.filter(d => d.label === 'indefinite');
    }

    const customStatusModule = game.modules.get("temporary-custom-statuses");
    const hasCustomStatus = customStatusModule?.active;
    const savedStatuses = hasCustomStatus ? (game.settings.get("temporary-custom-statuses", "savedStatuses") || []) : [];

    const durationOptionsHtml = durations.map(d => `<option value="${d.label}" ${d.label === 'indefinite' ? 'selected' : ''}>${d.name}</option>`).join('');

    // Bonus tab: duration options (includes "None" for permanent bonuses with no icon)
    const bonusDurationOptionsHtml = '<option value="">None (Permanent, no Icon)</option>' +
        durations.map(d => `<option value="${d.label}" ${d.label === 'indefinite' ? 'selected' : ''}>${d.name}</option>`).join('');

    const bonusTriggerOptionsHtml = [{
        value: "",
        label: "None"
    },
    {
        value: "onAttack",
        label: "On Attack"
    }, {
        value: "onHit",
        label: "On Hit"
    },
    {
        value: "onMiss",
        label: "On Miss"
    }, {
        value: "onDamage",
        label: "On Damage"
    },
    {
        value: "onTechAttack",
        label: "On Tech Attack"
    }, {
        value: "onTechHit",
        label: "On Tech Hit"
    },
    {
        value: "onMove",
        label: "On Move"
    }, {
        value: "onPreMove",
        label: "On Pre Move"
    }, {
        value: "onInitActivation",
        label: "On Init Activation"
    }, {
        value: "onActivation",
        label: "On Activation"
    },
    {
        value: "onDeploy",
        label: "On Deploy"
    },
    {
        value: "onCheck",
        label: "On Check"
    }, {
        value: "onHeat",
        label: "On Heat"
    },
    {
        value: "onHpLoss",
        label: "On HP Loss"
    }, {
        value: "onTurnStart",
        label: "On Turn Start"
    },
    {
        value: "onTurnEnd",
        label: "On Turn End"
    },
    {
        value: "onEnterCombat",
        label: "On Enter Combat"
    },
    {
        value: "onExitCombat",
        label: "On Exit Combat"
    }, {
        value: "onPreStatusApplied",
        label: "On Pre Status Applied"
    }, {
        value: "onPreStatusRemoved",
        label: "On Pre Status Removed"
    }, {
        value: "onStatusApplied",
        label: "On Status Applied"
    }, {
        value: "onStatusRemoved",
        label: "On Status Removed"
    }
    ].map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    const dmgTypeOptionsHtml = ['Kinetic', 'Explosive', 'Energy', 'Heat', 'Burn', 'Variable']
        .map(t => `<option value="${t}">${t}</option>`).join('');

    const statusEffectIconsHtml = [...CONFIG.statusEffects]
        .sort((a, b) => (game.i18n.localize(a.name) || a.name).localeCompare(game.i18n.localize(b.name) || b.name))
        .map(e => `
        <div class="bonus-immunity-effect-option te-icon-option" data-effect="${e.name}" title="${game.i18n.localize(e.name) || e.name}">
            <img src="${e.img || e.icon}" width="24" height="24">
        </div>
    `).join('');

    const damageTypes = [
        { name: 'Kinetic', icon: 'systems/lancer/assets/icons/white/damage_kinetic.svg' },
        { name: 'Energy', icon: 'systems/lancer/assets/icons/white/damage_energy.svg' },
        { name: 'Explosive', icon: 'systems/lancer/assets/icons/white/damage_explosive.svg' },
        { name: 'Heat', icon: 'systems/lancer/assets/icons/white/damage_heat.svg' },
        { name: 'Burn', icon: 'systems/lancer/assets/icons/white/damage_burn.svg' }
    ];
    const damageTypeIconsHtml = damageTypes.map(t => `
        <div class="bonus-immunity-damage-option te-icon-option" data-type="${t.name}" title="${t.name}">
            <img src="${t.icon}" width="24" height="24">
        </div>
    `).join('');

    const content = `
    <style>
        .te-dialog { min-width: 440px; font-family: var(--font-primary); }
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
                <div id="std-effect-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(36px, 1fr)); gap: 4px; max-height: 150px; overflow-y: auto; background: rgba(0,0,0,0.05); padding: 5px; border-radius: 4px; border: 1px solid #ccc;">
                     ${[...CONFIG.statusEffects].sort((a, b) => (game.i18n.localize(a.name) || a.name).localeCompare(game.i18n.localize(b.name) || b.name)).map(s => {
        const label = game.i18n.localize(s.name);
        return `
                        <div class="std-effect-option" data-id="${s.name}" data-name="${label}" data-icon="${s.img || s.icon}" title="${label}" style="cursor:pointer; width:36px; height:36px; display:flex; align-items:center; justify-content:center; border:1px solid #ccc; border-radius:4px; background:#1a1a1a; transition: all 0.2s;">
                            <img src="${s.img || s.icon}" width="28" height="28" style="object-fit: contain; pointer-events:none;" title="${label}">
                        </div>`;
    }).join('')}
                </div>
            </div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="std-duration">${durationOptionsHtml}</select>
                    <span class="dur-opts"> of </span>
                    <div class="dur-opts" style="flex:1; display:flex; gap:3px; max-width: 130px;">
                        <select id="std-origin" style="flex:1;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="std-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts" style="margin-left:5px;">Turns:</span>
                    <input type="number" id="std-turns" value="1" min="1" class="dur-opts" style="max-width: 40px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="std-note" placeholder="Optional note">
            </div>
            ${triggerFieldsHtml('std', tokensHtml)}
            <div class="te-btn-group">
                <button type="button" class="te-btn apply-btn" data-tab="standard"><i class="fas fa-check"></i> Apply</button>
            </div>
        </div>

        <!-- CUSTOM TAB -->
        ${hasCustomStatus ? `
        <div class="te-content" id="tab-custom">
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
                <input type="text" id="cust-name" placeholder="Status Name">
                <label style="text-align:right; padding-right:5px;">Stack:</label>
                <input type="number" id="cust-stack" value="1" min="1">
            </div>
            <div class="form-group">
                <label>Icon:</label>
                <div style="flex:1; display:flex; gap:5px;">
                    <input type="text" id="cust-icon" value="icons/svg/mystery-man.svg">
                    <button type="button" class="file-picker" data-type="image" data-target="cust-icon" title="Browse Files" tabindex="-1" style="flex:0 0 30px;"><i class="fas fa-file-import fa-fw"></i></button>
                </div>
            </div>
            <div class="form-group">
                <label>Until:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="cust-duration">${durationOptionsHtml}</select>
                    <span class="dur-opts"> of </span>
                    <div class="dur-opts" style="flex:1; display:flex; gap:3px; max-width: 130px;">
                        <select id="cust-origin" style="flex:1;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="cust-origin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="dur-opts" style="margin-left:5px;">Turns:</span>
                    <input type="number" id="cust-turns" value="1" min="1" class="dur-opts" style="max-width: 40px;">
                </div>
            </div>
            <div class="form-group">
                <label>Note:</label>
                <input type="text" id="cust-note" placeholder="Optional note">
            </div>
            ${triggerFieldsHtml('cust', tokensHtml)}
            <div class="te-btn-group">
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
            <div class="form-group">
                <label>Token:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <select id="bonus-target" style="flex:1;">${tokensHtml}</select>
                    <button type="button" class="token-picker-btn" data-target="bonus-target" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                </div>
            </div>
            <div id="bonus-summary" style="padding:4px 0 8px; font-size:0.85em; color:#aaa; font-style:italic;">No active bonuses.</div>
            <hr class="te-divider">
            <div class="te-section-title">Add New Bonus</div>
            <div class="form-group">
                <label>Name:</label>
                <input type="text" id="bonus-name" value="Test Bonus">
            </div>
            <div class="form-group">
                <label>Duration:</label>
                <div style="flex:1; display:flex; gap:5px; align-items:center;">
                    <select id="bonus-duration">${bonusDurationOptionsHtml}</select>
                    <span class="bonus-dur-opts"> of </span>
                    <div class="bonus-dur-opts" style="flex:1; display:flex; gap:3px; max-width:130px;">
                        <select id="bonus-durOrigin" style="flex:1;">${tokensHtml}</select>
                        <button type="button" class="token-picker-btn" data-target="bonus-durOrigin" style="flex:0 0 28px; padding:0;" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
                    </div>
                    <span class="bonus-dur-opts" style="margin-left:3px;">Turns:</span>
                    <input type="number" id="bonus-durTurns" value="1" min="1" class="bonus-dur-opts" style="max-width:40px;">
                </div>
            </div>
            <div class="form-group">
                <label>Uses:</label>
                <input type="number" id="bonus-uses" placeholder="Infinite" min="1">
            </div>
            <div class="form-group">
                <label>Consume on:</label>
                <select id="bonus-trigger">${bonusTriggerOptionsHtml}</select>
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
            <div class="form-group" style="margin-top:10px;">
                <label>Bonus Type:</label>
                <select id="bonus-type">
                    <option value="stat">Stat</option>
                    <option value="roll">Roll (Acc/Diff)</option>
                    <option value="damage">Damage</option>
                    <option value="tag">Tag</option>
                    <option value="range">Range</option>
                    <option value="immunity">Immunity</option>
                </select>
            </div>
            <div id="bonus-type-stat">
                <div class="form-group">
                    <label>Stat:</label>
                    <select id="bonus-stat">
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
                <div class="form-group" style="justify-content:center;">
                    <label>Value:</label>
                    <input type="number" id="bonus-statVal" value="1" style="width:60px; text-align:center; height:30px; font-size:0.9em; border:2px solid #999; border-radius:4px;">
                </div>
            </div>
            <div id="bonus-type-roll" style="display:none;">
                <div class="form-group">
                    <label>Bonus Roll Type:</label>
                    <select id="bonus-rollType">
                        <option value="accuracy">Accuracy</option>
                        <option value="difficulty">Difficulty</option>
                    </select>
                </div>
                <div class="form-group" style="justify-content:center;">
                    <label>Value:</label>
                    <input type="number" id="bonus-accDiffVal" value="1" min="1" style="width:60px; text-align:center; height:30px; font-size:0.9em; border:2px solid #999; border-radius:4px;">
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
                <div class="form-group" style="justify-content:center;">
                    <label>Mode:</label>
                    <select id="bonus-tagMode" style="flex:0.6;">
                        <option value="add">Add Value</option>
                        <option value="override">Override Value</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <input type="number" id="bonus-tagVal" value="1" style="width:50px; text-align:center; height:30px; border:2px solid #999; border-radius:4px;">
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
                <div class="form-group" style="justify-content:center;">
                    <label>Mode:</label>
                    <select id="bonus-rangeMode" style="flex:0.6;">
                        <option value="add">Add Value</option>
                        <option value="override">Override Value</option>
                        <option value="change">Change All Ranges</option>
                    </select>
                    <label style="margin-left: 10px;">Value:</label>
                    <input type="number" id="bonus-rangeVal" value="1" style="width:50px; text-align:center; height:30px; border:2px solid #999; border-radius:4px;">
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
                    </select>
                </div>
                <div id="bonus-immunity-effects-row">
                    <label style="display:block; font-weight:600; font-size:0.85em; margin-bottom:4px;">Select Status Effects:</label>
                    <div class="te-icon-grid" id="bonus-immunity-effects">
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
                <div class="form-group">
                    <label data-tooltip="Only apply this bonus when using these specific items (by LID). Leave empty to apply to all weapons.">Apply to items:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-itemLids" placeholder="e.g. mb_knife, cqb_shotgun" style="flex:1;">
                        <button type="button" class="find-lid-btn" data-target="bonus-itemLids" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                    </div>
                </div>
                <div class="form-group">
                    <label data-tooltip="Apply this bonus to specific token IDs. Use the selector to pick tokens from the map.">Apply to tokens:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-applyTo" placeholder="Token IDs (comma-separated)" style="flex:1;">
                        <button type="button" class="token-picker-btn" data-target="bonus-applyTo" data-count="-1" style="flex:0 0 28px; padding:0;" title="Select Tokens"><i class="fas fa-crosshairs"></i></button>
                    </div>
                </div>
                <div class="form-group">
                    <label data-tooltip="Apply this bonus selectively to a specific item ID on an actor.">Apply to specific Item ID:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-itemId" placeholder="Item ID" style="flex:1;">
                        <button type="button" class="item-picker-btn" data-target="bonus-itemId" style="flex:0 0 28px; padding:0;" title="Select Item on Token"><i class="fas fa-box"></i></button>
                    </div>
                </div>
                <div class="form-group">
                    <label data-tooltip="If checked, this bonus is applied by the target to the attacker. Useful for debuffing attackers.">Apply to Targetter:</label>
                    <input type="checkbox" id="bonus-applyToTargetter" style="margin:0; width:min-content;">
                </div>
            </div>
            <div style="margin-top:8px;">
                <button type="button" class="te-btn" id="bonus-add" style="width:100%;"><i class="fas fa-plus-circle"></i> Add Bonus</button>
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
                if (val === 'indefinite') {
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

            // File Picker
            html.find('.file-picker').click(ev => {
                const input = html.find('#cust-icon');
                new FilePicker({
                    type: "image",
                    callback: (path) => input.val(path)
                }).browse(String(input.val()));
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
                html.find('.std-effect-option').css('border-color', '#ccc').css('box-shadow', 'none');
                $(this).css('border-color', 'var(--primary-color)').css('box-shadow', '0 0 5px color-mix(in srgb, var(--primary-color), transparent 50%)');
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

            // Apply Button
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
                    if (durationLabel !== 'indefinite') {
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
                    if (durationLabel !== 'indefinite') {
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
            const getBonusDetailString = (subB) => {
                if (subB.type === 'accuracy')
                    return `Accuracy +${subB.val}`;
                if (subB.type === 'difficulty')
                    return `Difficulty +${subB.val}`;
                if (subB.type === 'stat')
                    return `${subB.stat?.split('.').pop() || subB.stat} ${Number.parseInt(subB.val) >= 0 ? '+' : ''}${subB.val}`;
                if (subB.type === 'damage')
                    return (subB.damage || []).map(d => `${d.val} ${d.type}`).join(' + ');
                if (subB.type === 'tag') {
                    if (subB.removeTag)
                        return `Remove Tag: ${subB.tagName}`;
                    const action = subB.tagMode === 'override' ? 'Set' : 'Add';
                    return `${action} ${subB.tagName} ${subB.val}`;
                }
                if (subB.type === 'range') {
                    const rangeLabel = subB.rangeMode === 'override' ? 'Set' : subB.rangeMode === 'change' ? 'Change All →' : 'Add';
                    return `${rangeLabel} ${subB.rangeType} ${subB.val}`;
                }
                if (subB.type === 'immunity') {
                    if (subB.subtype === 'effect' && subB.effects)
                        return `Immunity: ${subB.effects.join(', ')}`;
                    if ((subB.subtype === 'damage' || subB.subtype === 'resistance') && subB.damageTypes)
                        return `${subB.subtype}: ${subB.damageTypes.join(', ')}`;
                    if (subB.subtype === 'crit')
                        return 'Immunity: Critical Hit';
                    if (subB.subtype === 'hit')
                        return 'Immunity: Hit';
                    if (subB.subtype === 'miss')
                        return 'Immunity: Miss';
                    if (subB.subtype === 'elevation')
                        return 'Immunity: Elevation';
                    return subB.subtype;
                }
                return subB.type || 'Unknown';
            };
            const renderBonusDetails = (b) => {
                if (b.type === 'multi' && Array.isArray(b.bonuses))
                    return `[${b.bonuses.map(getBonusDetailString).join(' | ')}]`;
                return `(${getBonusDetailString(b)})`;
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

                effects.forEach(e => {
                    const dur = e.getFlag('lancer-automations', 'duration') || e.getFlag('csm-lancer-qol', 'duration');
                    const consumption = e.getFlag('lancer-automations', 'consumption');
                    const stack = e.flags?.statuscounter?.value ||
                        e.flags?.['temporary-custom-statuses']?.stack || 0;

                    let durText = "Indefinite";
                    if (dur) {
                        durText = `${dur.label}, ${dur.turns}t`;
                    }

                    let consumptionText = '';
                    if (consumption?.trigger) {
                        let cLabel = consumption.trigger;
                        if (consumption.itemId)
                            cLabel += ` ID:${consumption.itemId}`;
                        else if (consumption.itemLid)
                            cLabel += ` ${consumption.itemLid}`;
                        consumptionText = `<span style="font-size:0.75em; color:var(--primary-color); margin-left:4px;">[${cLabel}]</span>`;
                    }

                    const item = $(`
                        <div class="te-effect-item">
                            <div class="te-effect-info">
                                <img src="${e.img}" width="24" height="24" style="border:none; background:#1a1a1a; border-radius:3px; padding:1px; object-fit:contain;">
                                <span>${e.name}</span>
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
                        await pushRemoveEffect(targetID, e.id);
                        setTimeout(updateManageList, 200);
                    });

                    item.find('.stack-btn').click(async (ev) => {
                        const action = $(ev.currentTarget).data('action');
                        const delta = action === 'inc' ? 1 : -1;
                        await modifyEffectStack(targetID, e.id, delta);
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
                    allBonuses.forEach(b => {
                        const details = renderBonusDetails(b);
                        const lids = (b.itemLids && b.itemLids.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[${b.itemLids.join(', ')}]</span>` : '';
                        const types = (b.rollTypes && b.rollTypes.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[Flows: ${b.rollTypes.join(', ')}]</span>` : '';
                        const itemIdInfo = b.itemId ? ` <span style="font-size:0.8em; opacity:0.7;">[Item: ${b.itemId}]</span>` : '';
                        const kindLabel = b._kind === 'constant' ? ' <span style="font-size:0.75em; color:#aaa;">(constant)</span>' : '';

                        let usesInfo = '';
                        if (b.uses !== undefined) {
                            const linkedEffect = actor.effects.find(e => e.getFlag("lancer-automations", "linkedBonusId") === b.id);
                            const remaining = linkedEffect ? (linkedEffect.flags?.statuscounter?.value ?? null) : null;
                            usesInfo = remaining === null ? ` <span style="color:var(--primary-color);">[uses: ${b.uses}]</span>` : ` <span style="color:var(--primary-color);">[${remaining}/${b.uses}]</span>`;
                        }

                        const item = $(`
                            <div class="te-bonus-item">
                                <span><strong>${b.name}</strong>${kindLabel} ${details}${usesInfo}${lids}${itemIdInfo}${types}</span>
                                <div class="te-delete-btn manage-bonus-remove-btn" data-id="${b.id}" data-kind="${b._kind}" title="Remove"><i class="fas fa-trash"></i></div>
                            </div>
                        `);

                        item.find('.manage-bonus-remove-btn').click(async () => {
                            if (b._kind === 'constant')
                                await removeConstantBonus(actor, b.id);
                            else
                                await removeGlobalBonus(actor, b.id);
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
                    summary.text('No active bonuses.');
                    return;
                }
                const actor = target.actor;
                const bonuses = actor.getFlag("lancer-automations", "global_bonuses") || [];
                const constantBonuses = actor.getFlag("lancer-automations", "constant_bonuses") || [];
                const total = bonuses.length + constantBonuses.length;
                summary.text(total > 0 ? `${total} active bonus${total > 1 ? 'es' : ''} — see Manage tab.` : 'No active bonuses.');

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

            html.find('#bonus-trigger').on('change', function () {
                const trigger = $(this).val();
                const $fields = html.find('#bonus-trigger-fields');
                $fields.find('.form-group').hide();
                if (trigger && bonusFilterMap[trigger]) {
                    $fields.show();
                    $fields.find('.form-group').first().show();
                    bonusFilterMap[trigger].forEach(cls => $fields.find(`.${cls}`).show());
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
                } else {
                    bonusData.val = html.find('#bonus-accDiffVal').val() || "1";
                }

                const addOptions = {
                    duration,
                    durationTurns: durTurns,
                    origin: durOrigin
                };

                // Build consumption config
                const consumptionTrigger = html.find('#bonus-trigger').val();
                if (consumptionTrigger) {
                    const consumption = {
                        trigger: consumptionTrigger
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
                html.find('#bonus-type-stat, #bonus-type-roll, #bonus-type-damage, #bonus-type-tag, #bonus-type-range, #bonus-type-immunity').hide();
                html.find(`#bonus-type-${type}`).show();

                const showItems = type === 'roll' || type === 'damage' || type === 'tag' || type === 'range';
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

            html.find('.bonus-immunity-effect-option, .bonus-immunity-damage-option').on('click', function() {
                $(this).toggleClass('selected');
            });

            // Multi-select dropdowns for roll types
            const initMultiSelect = (containerId) => {
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
                trigger.on('click', (e) => {
                    e.stopPropagation();
                    const isOpen = panel.hasClass('open');
                    html.find('.la-multi-select-panel.open').removeClass('open');
                    if (!isOpen) {
                        panel.addClass('open');
                    }
                });
                panel.find('input[type=checkbox]').on('change', updateTriggerLabel);
                $(document).on('click.la-multiselect', () => panel.removeClass('open'));
            };
            initMultiSelect('bonus-rollTypes-roll');
            initMultiSelect('bonus-rollTypes-damage');

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
        width: 'auto',
        height: 'auto',
        left: 100,
        top: 60,
        classes: ['lancer-effect-manager', 'lancer-dialog-base', 'lancer-no-title']
    }));

    dialog.render(true);
}

export const EffectManagerAPI = {
    executeEffectManager,
    openItemBrowser
};
