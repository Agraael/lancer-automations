/* global CONFIG, canvas, game, Dialog, ui, FilePicker */

import {
    applyFlaggedEffectToTokens
} from "./flagged-effects.js";
import {
    addGlobalBonus,
    removeGlobalBonus,
    removeConstantBonus
} from "./genericBonuses.js";

/**
 * Open a searchable item browser dialog and return the selected item's LID.
 * Simplified from the reaction editor's _openItemBrowser.
 * @param {jQuery} targetInput - The input element to populate with the selected LID
 */
export async function openItemBrowser(targetInput) {
    const items = [];
    for (const pack of game.packs) {
        if (pack.documentName !== "Item")
            continue;
        const index = await pack.getIndex({
            fields: ["system.lid", "type"]
        });
        for (const entry of index) {
            if (entry.system?.lid) {
                items.push({
                    name: entry.name,
                    lid: entry.system.lid,
                    type: entry.type
                });
            }
        }
    }

    items.sort((a, b) => a.name.localeCompare(b.name));

    const itemListHtml = items.map(item =>
        `<div class="item-browser-entry lancer-list-item" data-lid="${item.lid}">
            <strong>${item.name}</strong> <span style="color: #444; font-size: 0.85em;">(${item.type}) [${item.lid}]</span>
        </div>`
    ).join('');

    return new Promise((resolve) => {
        new Dialog({
            title: "Find Item",
            content: `
                <div class="lancer-dialog-base">
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">Find Item</div>
                </div>
                <div class="lancer-search-container">
                    <i class="fas fa-search lancer-search-icon"></i>
                    <input type="text" id="item-search" placeholder="Search by name or LID...">
                </div>
                <div id="item-list" style="max-height: 300px; overflow-y: auto;">
                    ${itemListHtml}
                </div>
                </div>
            `,
            buttons: {
                cancel: {
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            render: (html) => {
                const searchInput = html.find('#item-search');
                const listContainer = html.find('#item-list');

                searchInput.on('input', () => {
                    const query = searchInput.val().toLowerCase();
                    listContainer.find('.item-browser-entry').each((i, el) => {
                        const text = $(el).text().toLowerCase();
                        $(el).toggle(text.includes(query));
                    });
                });

                listContainer.on('click', '.item-browser-entry', (ev) => {
                    const lid = $(ev.currentTarget).data('lid');
                    if (targetInput)
                        targetInput.val(lid);
                    resolve(lid);
                    html.closest('.dialog').find('.header-button.close').click();
                });
            },
            default: "cancel"
        }, {
            width: 400
        }).render(true);
    });
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
    <option value="onActivation">On Activation</option>
    <option value="onCheck">On Check</option>
    <option value="onHeat">On Heat</option>
    <option value="onHpLoss">On HP Loss</option>
    <option value="onTurnStart">On Turn Start</option>
    <option value="onTurnEnd">On Turn End</option>
`;

const CONSUMPTION_FILTER_MAP = {
    onAttack: ['cfilter-itemLid'],
    onHit: ['cfilter-itemLid'],
    onMiss: ['cfilter-itemLid'],
    onDamage: ['cfilter-itemLid'],
    onTechAttack: ['cfilter-itemLid'],
    onTechHit: ['cfilter-itemLid'],
    onMove: ['cfilter-boost'],
    onPreMove: ['cfilter-boost'],
    onActivation: ['cfilter-actionName'],
    onCheck: ['cfilter-check']
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
                <select id="${prefix}-trigger-origin">
                    <option value="">Same as Target</option>
                    ${tokensHtml}
                </select>
            </div>
            <div class="form-group cfilter-itemLid" style="display:none;">
                <label data-tooltip="Only consume a charge when this specific item is used. Leave empty to consume on any item.">Consume on item:</label>
                <div style="flex:1; display:flex; gap:3px;">
                    <input type="text" id="${prefix}-filter-itemLid" placeholder="e.g. mw_assault_rifle, mw_pistol" style="flex:1;">
                    <button type="button" class="find-lid-btn" data-target="${prefix}-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
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
    });

    html.find(`#${prefix}-trigger-fields .find-lid-btn`).on('click', function (e) {
        e.preventDefault();
        const targetId = $(this).data('target');
        openItemBrowser(html.find(`#${targetId}`));
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
    const actionName = html.find(`#${prefix}-filter-actionName`).val()?.trim();
    if (actionName)
        consumption.actionName = actionName;
    const isBoost = html.find(`#${prefix}-filter-isBoost`).is(':checked');
    if (isBoost)
        consumption.isBoost = true;
    const checkType = html.find(`#${prefix}-filter-checkType`).val()?.trim();
    if (checkType)
        consumption.checkType = checkType;
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
                await effect.update({
                    "flags.statuscounter.visible": true
                });
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
                await effect.update({
                    "flags.statuscounter.value": newStack,
                    "flags.statuscounter.visible": newStack > 1
                });
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

// Main Function: executeEffectManager
export async function executeEffectManager(options = {}) {
    console.log('lancer-automations | Executing Effect Manager');

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
        value: "onActivation",
        label: "On Activation"
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
    }
    ].map(o => `<option value="${o.value}">${o.label}</option>`).join('');

    const dmgTypeOptionsHtml = ['Kinetic', 'Explosive', 'Energy', 'Heat', 'Burn', 'Variable']
        .map(t => `<option value="${t}">${t}</option>`).join('');

    const content = `
    <style>
        .te-dialog { min-width: 440px; font-family: var(--font-primary); }
        .te-tabs { display: flex; border-bottom: 3px solid #991e2a; margin-bottom: 8px; cursor: pointer; }
        .te-tab { padding: 8px 14px; font-weight: 600; opacity: 0.5; font-size: 0.9em; transition: all 0.2s ease; color: #000; border-bottom: 3px solid transparent; margin-bottom: -3px; }
        .te-tab:hover { opacity: 0.8; }
        .te-tab.active { opacity: 1; border-bottom-color: #991e2a; color: #991e2a; }
        .te-content { display: none; padding: 8px 0; }
        .te-content.active { display: block; }
        .te-dialog .form-group { margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
        .te-dialog .form-group label { flex: 0 0 70px; font-size: 0.85em; white-space: nowrap; font-weight: 600; color: #000; }
        .te-dialog .form-group select,
        .te-dialog .form-group input[type="text"],
        .te-dialog .form-group input[type="number"] { flex: 1; height: 26px; font-size: 0.9em; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; color: #000; padding: 0 6px; transition: border-color 0.2s ease; }
        .te-dialog .form-group select:focus,
        .te-dialog .form-group input:focus { border-color: #991e2a; outline: none; box-shadow: 0 0 4px rgba(153,30,42,0.3); }
        .te-dialog .form-group.two-col { display: grid; grid-template-columns: 70px 1fr 70px 1fr; gap: 5px; align-items: center; }
        .te-dialog .form-group.two-col label { flex: unset; }
        .te-effect-list { max-height: 200px; overflow-y: auto; padding: 4px; margin-bottom: 8px; }
        .te-effect-item { display: flex; align-items: center; justify-content: space-between; padding: 8px; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; margin-bottom: 6px; font-size: 0.9em; transition: all 0.2s ease; }
        .te-effect-item:hover { border-color: #991e2a; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
        .te-effect-info { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
        .te-delete-btn { color: #991e2a; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: all 0.2s ease; }
        .te-delete-btn:hover { background: #ffe0e0; }
        .te-btn-group { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
        .te-btn { background: #f5f5f5; border: 2px solid #555; color: #000; padding: 6px 14px; border-radius: 6px; cursor: pointer; font-size: 0.9em; font-weight: 600; transition: all 0.2s ease; }
        .te-btn:hover { background: #ffe0e0; border-color: #991e2a; box-shadow: 0 2px 8px rgba(0,0,0,0.3); transform: translateY(-1px); }
        .te-btn i { margin-right: 5px; color: #991e2a; }
        .te-stack-ctrl { display: flex; gap: 4px; }
        .te-stack-ctrl i { cursor: pointer; padding: 2px 4px; border-radius: 3px; transition: all 0.2s ease; color: #991e2a; }
        .te-stack-ctrl i:hover { background: #ffe0e0; }
        .te-divider { border: none; border-top: 2px solid #991e2a; margin: 10px 0; }
        .te-section-title { font-weight: 600; color: #991e2a; font-size: 13px; margin: 8px 0 6px; text-transform: uppercase; letter-spacing: 0.5px; }
        .te-bonus-item { display: flex; align-items: center; justify-content: space-between; padding: 6px 8px; background: #f5f5f5; border: 2px solid #999; border-radius: 4px; margin-bottom: 4px; font-size: 0.9em; transition: all 0.2s ease; }
        .te-bonus-item:hover { border-color: #991e2a; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
    </style>
    <div class="te-dialog lancer-dialog-base">
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">Effect Manager</div>
        </div>
        <div class="te-tabs">
            <div class="te-tab active" data-tab="standard">Standard</div>
            ${hasCustomStatus ? '<div class="te-tab" data-tab="custom">Custom</div>' : ''}
            <div class="te-tab" data-tab="bonus">Bonus</div>
            <div class="te-tab" data-tab="manage">Manage</div>
        </div>

        <!-- STANDARD TAB -->
        <div class="te-content active" id="tab-standard">
            <div class="form-group">
                <label>Target:</label>
                <select id="std-target">${tokensHtml}</select>
            </div>
            <div class="form-group" style="flex-direction: column; align-items: stretch; gap: 8px;">
                <div style="display:flex; justify-content:space-between; align-items: center;">
                    <label>Apply:</label>
                    <div style="display:flex; gap:5px; align-items:center;">
                        <span id="std-effect-label" style="font-weight:bold; color:#991e2a;">Bolster</span>
                        <img id="std-effect-icon" src="" width="30" height="30" style="border:2px solid #991e2a; border-radius:4px; background:#1a1a1a; display:block; object-fit: contain; padding:2px;">
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
                    <select id="std-origin" class="dur-opts" style="max-width: 100px;">${tokensHtml}</select>
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
                <select id="cust-target">${tokensHtml}</select>
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
                    <select id="cust-origin" class="dur-opts" style="max-width: 100px;">${tokensHtml}</select>
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
                <select id="manage-target">${tokensHtml}</select>
            </div>
            <div class="te-effect-list" id="manage-list">
                <p style="text-align:center">Loading...</p>
            </div>
            <div class="te-btn-group">
                <button type="button" class="te-btn manage-close"><i class="fas fa-times"></i> Close</button>
            </div>
        </div>

        <!-- BONUS TAB -->
        <div class="te-content" id="tab-bonus">
            <div class="form-group">
                <label>Token:</label>
                <select id="bonus-target">${tokensHtml}</select>
            </div>
            <div class="te-effect-list" id="bonus-list">
                <p style="text-align:center; color:#666; font-style:italic;">No active bonuses.</p>
            </div>
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
                    <select id="bonus-durOrigin" class="bonus-dur-opts" style="max-width:100px;">${tokensHtml}</select>
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
                    <select id="bonus-trigger-origin">
                        <option value="">Same as Target</option>
                        ${tokensHtml}
                    </select>
                </div>
                <div class="form-group bonus-filter-itemLid" style="display:none;">
                    <label data-tooltip="Only consume a charge when this specific item is used. Leave empty to consume on any item.">Consume on item:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-filter-itemLid" placeholder="e.g. mw_assault_rifle" style="flex:1;">
                        <button type="button" class="find-lid-btn" data-target="bonus-filter-itemLid" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                    </div>
                </div>
                <div class="form-group bonus-filter-actionName" style="display:none;">
                    <label data-tooltip="Only consume a charge when this specific action is activated.">Consume on action:</label>
                    <input type="text" id="bonus-filter-actionName" placeholder="e.g. Stabilize">
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
                    <label>Roll Type:</label>
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
            <div id="bonus-items-row" style="display:none;">
                <div class="form-group" id="row-bonus-targetTypes-roll" style="display:none;">
                    <label>Target Type:</label>
                    <select id="bonus-targetTypes-roll">
                        <option value="all">All Flows</option>
                        <option value="attack">Weapon Attacks (All)</option>
                        <option value="tech_attack">Tech Attacks</option>
                        <option value="melee">Melee Attacks</option>
                        <option value="ranged">Ranged Attacks</option>
                        <option value="nexus">Nexus Attacks</option>
                        <option value="tech">Tech (Item Type)</option>
                        <option value="check">Checks (All)</option>
                        <option value="hull">Hull Check</option>
                        <option value="agility">Agility Check</option>
                        <option value="systems">Systems Check</option>
                        <option value="engineering">Engineering Check</option>
                        <option value="grit">Grit Check</option>
                        <option value="tier">Tier Check (NPC)</option>
                        <option value="structure">Structure Roll</option>
                        <option value="overheat">Overheat Roll</option>
                    </select>
                </div>
                <div class="form-group" id="row-bonus-targetTypes-damage" style="display:none;">
                    <label>Target Type:</label>
                    <select id="bonus-targetTypes-damage">
                        <option value="all">All Damage</option>
                        <option value="melee">Melee Damage</option>
                        <option value="ranged">Ranged Damage</option>
                        <option value="nexus">Nexus Damage</option>
                        <option value="tech">Tech Damage</option>
                    </select>
                </div>
                <div class="form-group">
                    <label data-tooltip="Only apply this bonus when using these specific items (by LID). Leave empty to apply to all weapons.">Apply to items:</label>
                    <div style="flex:1; display:flex; gap:3px;">
                        <input type="text" id="bonus-itemLids" placeholder="e.g. mb_knife, cqb_shotgun" style="flex:1;">
                        <button type="button" class="find-lid-btn" data-target="bonus-itemLids" style="flex:0 0 28px; padding:0;" title="Find Item"><i class="fas fa-search"></i></button>
                    </div>
                </div>
            </div>
            <div style="margin-top:8px;">
                <button type="button" class="te-btn" id="bonus-add" style="width:100%;"><i class="fas fa-plus-circle"></i> Add Bonus</button>
            </div>
            <hr class="te-divider">
            <button type="button" class="te-btn" id="bonus-clear-all" style="width:100%; border-color:#991e2a;"><i class="fas fa-trash"></i> Clear All Bonuses</button>
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
                html.closest('.dialog').css('height', 'auto');
            });

            // Duration toggle
            const toggleDurOpts = (prefix) => {
                const val = html.find(`#${prefix}-duration`).val();
                if (val === 'indefinite') {
                    html.find(`#${prefix}-duration`).siblings('.dur-opts').hide();
                } else {
                    html.find(`#${prefix}-duration`).siblings('.dur-opts').show();
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
                }).browse(input.val());
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
                $(this).css('border-color', '#991e2a').css('box-shadow', '0 0 5px rgba(153,30,42,0.5)');
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
                    const targetID = html.find('#std-target').val();
                    const effectName = html.find('#std-effect').val();
                    const stack = parseInt(html.find('#std-stack').val()) || 1;
                    const durationLabel = html.find('#std-duration').val();
                    const originID = html.find('#std-origin').val();
                    const note = html.find('#std-note').val();
                    const turnsInput = parseInt(html.find('#std-turns').val()) || 1;

                    let duration = {
                        label: 'indefinite',
                        turns: null,
                        rounds: null
                    };
                    if (durationLabel !== 'indefinite') {
                        duration = {
                            label: durationLabel,
                            turns: turnsInput,
                            rounded: 0
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

                    await applyFlaggedEffectToTokens({
                        tokens: [token],
                        effectNames: effectName,
                        note: note,
                        duration: duration,
                        useTokenAsOrigin: false,
                        customOriginId: originID
                    }, extraOptions);
                    ui.notifications.info(`Applied ${effectName} to ${token.name}.`);

                } else if (tab === 'custom') {
                    const targetID = html.find('#cust-target').val();
                    const name = html.find('#cust-name').val();
                    const icon = html.find('#cust-icon').val();
                    const stack = parseInt(html.find('#cust-stack').val()) || 1;
                    const durationLabel = html.find('#cust-duration').val();
                    const originID = html.find('#cust-origin').val();
                    const note = html.find('#cust-note').val();
                    const turnsInput = parseInt(html.find('#cust-turns').val()) || 1;

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

                    await applyFlaggedEffectToTokens({
                        tokens: [token],
                        effectNames: effectData,
                        note: note,
                        duration: duration,
                        useTokenAsOrigin: false,
                        customOriginId: originID
                    }, extraOptions);
                    ui.notifications.info(`Applied ${name} to ${token.name}.`);
                }
            });

            // Manage Tab
            const updateManageList = () => {
                const targetID = html.find('#manage-target').val();
                const target = canvas.tokens.get(targetID);
                const list = html.find('#manage-list');
                list.empty();

                if (!target || !target.actor)
                    return;

                const effects = target.actor.effects.filter(e => !e.disabled && (e.icon || e.img));

                if (effects.length === 0) {
                    list.html('<p style="text-align:center; color:#ccc">No effects found.</p>');
                    return;
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
                        consumptionText = `<span style="font-size:0.75em; color:#991e2a; margin-left:4px;">[${consumption.trigger}]</span>`;
                    }

                    const item = $(`
                        <div class="te-effect-item">
                            <div class="te-effect-info">
                                <img src="${e.img}" width="24" height="24" style="border:none;">
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
            };

            html.find('#manage-target').change(updateManageList);
            html.find('.te-tab[data-tab="manage"]').click(updateManageList);

            // ========== BONUS TAB ==========
            const updateBonusList = () => {
                const targetID = html.find('#bonus-target').val();
                const target = canvas.tokens.get(targetID);
                const list = html.find('#bonus-list');
                list.empty();

                if (!target || !target.actor)
                    return;
                const actor = target.actor;
                const bonuses = actor.getFlag("lancer-automations", "global_bonuses") || [];
                const constantBonusesCheck = actor.getFlag("lancer-automations", "constant_bonuses") || [];

                if (bonuses.length === 0 && constantBonusesCheck.length === 0) {
                    list.html('<p style="text-align:center; color:#666; font-style:italic; padding:8px;">No active bonuses.</p>');
                    return;
                }

                bonuses.forEach(b => {
                    let details = "";
                    if (b.type === 'accuracy')
                        details = `(Accuracy +${b.val})`;
                    else if (b.type === 'difficulty')
                        details = `(Difficulty +${b.val})`;
                    else if (b.type === 'stat') {
                        const statLabel = b.stat?.split('.').pop() || b.stat;
                        details = `(${statLabel} ${parseInt(b.val) >= 0 ? '+' : ''}${b.val})`;
                    } else if (b.type === 'damage') {
                        details = '(' + (b.damage || []).map(d => `${d.val} ${d.type}`).join(' + ') + ')';
                    }

                    let usesInfo = '';
                    if (b.uses !== undefined) {
                        const effect = actor.effects.find(e => e.getFlag("lancer-automations", "linkedBonusId") === b.id);
                        const remaining = effect ? (effect.flags?.statuscounter?.value ?? null) : null;
                        usesInfo = remaining !== null ? ` <span style="color:#991e2a;">[${remaining}/${b.uses}]</span>` : ` <span style="color:#991e2a;">[uses: ${b.uses}]</span>`;
                    }
                    const lids = (b.itemLids && b.itemLids.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[${b.itemLids.join(', ')}]</span>` : '';
                    const types = (b.targetTypes && b.targetTypes.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[Flows: ${b.targetTypes.join(', ')}]</span>` : '';

                    const item = $(`
                        <div class="te-bonus-item">
                            <span><strong>${b.name}</strong> ${details}${usesInfo}${lids}${types}</span>
                            <div class="te-delete-btn bonus-remove-btn" data-id="${b.id}" title="Remove"><i class="fas fa-trash"></i></div>
                        </div>
                    `);

                    item.find('.bonus-remove-btn').click(async () => {
                        await removeGlobalBonus(actor, b.id);
                        setTimeout(updateBonusList, 200);
                    });

                    list.append(item);
                });

                if (constantBonusesCheck.length > 0) {
                    const constantBonuses = constantBonusesCheck;
                    list.append($('<p style="margin:8px 0 4px; font-weight:bold; border-top:1px solid #555; padding-top:6px;">Constant Bonuses</p>'));
                    constantBonuses.forEach(b => {
                        let details = "";
                        if (b.type === 'accuracy')
                            details = `(Accuracy +${b.val})`;
                        else if (b.type === 'difficulty')
                            details = `(Difficulty +${b.val})`;
                        else if (b.type === 'stat') {
                            const statLabel = b.stat?.split('.').pop() || b.stat;
                            details = `(${statLabel} ${parseInt(b.val) >= 0 ? '+' : ''}${b.val})`;
                        } else if (b.type === 'damage') {
                            details = '(' + (b.damage || []).map(d => `${d.val} ${d.type}`).join(' + ') + ')';
                        }

                        const lids = (b.itemLids && b.itemLids.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[${b.itemLids.join(', ')}]</span>` : '';
                        const types = (b.targetTypes && b.targetTypes.length > 0) ? ` <span style="font-size:0.8em; opacity:0.7;">[Flows: ${b.targetTypes.join(', ')}]</span>` : '';

                        const item = $(`
                            <div class="te-bonus-item">
                                <span><strong>${b.name}</strong> ${details}${lids}${types}</span>
                                <div class="te-delete-btn constant-remove-btn" data-id="${b.id}" title="Remove"><i class="fas fa-trash"></i></div>
                            </div>
                        `);

                        item.find('.constant-remove-btn').click(async () => {
                            await removeConstantBonus(actor, b.id);
                            setTimeout(updateBonusList, 200);
                        });

                        list.append(item);
                    });
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
            };
            html.find('#bonus-duration').on('change', toggleBonusDurOpts);
            toggleBonusDurOpts();

            // Bonus consumption trigger filter toggle
            const bonusFilterMap = {
                onAttack: ['bonus-filter-itemLid'],
                onHit: ['bonus-filter-itemLid'],
                onMiss: ['bonus-filter-itemLid'],
                onDamage: ['bonus-filter-itemLid'],
                onTechAttack: ['bonus-filter-itemLid'],
                onTechHit: ['bonus-filter-itemLid'],
                onMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onPreMove: ['bonus-filter-boost', 'bonus-filter-distance'],
                onActivation: ['bonus-filter-actionName'],
                onCheck: ['bonus-filter-check', 'bonus-filter-checkValues']
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
            });

            // Bonus LID finder buttons
            html.find('#tab-bonus .find-lid-btn').on('click', function (e) {
                e.preventDefault();
                const targetId = $(this).data('target');
                openItemBrowser(html.find(`#${targetId}`));
            });

            // Add bonus handler
            const addBonusFromTab = async (type) => {
                const targetID = html.find('#bonus-target').val();
                const target = canvas.tokens.get(targetID);
                if (!target || !target.actor)
                    return ui.notifications.error("Target token not found!");
                const actor = target.actor;

                const name = html.find('#bonus-name').val() || "Test Bonus";
                const usesStr = html.find('#bonus-uses').val();
                const uses = usesStr ? parseInt(usesStr) : undefined;
                const duration = html.find('#bonus-duration').val();
                const durOrigin = html.find('#bonus-durOrigin').val();
                const durTurns = parseInt(html.find('#bonus-durTurns').val()) || 1;
                const itemLidsStr = html.find('#bonus-itemLids').val();
                const itemLids = itemLidsStr ? itemLidsStr.split(',').map(s => s.trim()).filter(s => s) : [];

                let targetTypes = [];
                if (type === 'accuracy' || type === 'difficulty') {
                    targetTypes = [html.find('#bonus-targetTypes-roll').val()];
                } else if (type === 'damage') {
                    targetTypes = [html.find('#bonus-targetTypes-damage').val()];
                }

                const bonusData = {
                    name,
                    type,
                    uses,
                    itemLids,
                    targetTypes
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
                    const filterItemLid = html.find('#bonus-filter-itemLid').val()?.trim();
                    if (filterItemLid)
                        consumption.itemLid = filterItemLid;
                    const filterActionName = html.find('#bonus-filter-actionName').val()?.trim();
                    if (filterActionName)
                        consumption.actionName = filterActionName;
                    const filterIsBoost = html.find('#bonus-filter-isBoost').is(':checked');
                    if (filterIsBoost)
                        consumption.isBoost = true;
                    const filterMinDistance = html.find('#bonus-filter-minDistance').val();
                    if (filterMinDistance)
                        consumption.minDistance = parseInt(filterMinDistance);
                    const filterCheckType = html.find('#bonus-filter-checkType').val()?.trim();
                    if (filterCheckType)
                        consumption.checkType = filterCheckType;
                    const filterCheckAbove = html.find('#bonus-filter-checkAbove').val();
                    if (filterCheckAbove)
                        consumption.checkAbove = parseInt(filterCheckAbove);
                    const filterCheckBelow = html.find('#bonus-filter-checkBelow').val();
                    if (filterCheckBelow)
                        consumption.checkBelow = parseInt(filterCheckBelow);
                    addOptions.consumption = consumption;
                }

                await addGlobalBonus(actor, bonusData, addOptions);
                setTimeout(updateBonusList, 200);
            };

            // Bonus type selector - show/hide relevant inputs
            html.find('#bonus-type').on('change', function () {
                const type = $(this).val();
                html.find('#bonus-type-stat, #bonus-type-roll, #bonus-type-damage').hide();
                html.find(`#bonus-type-${type}`).show();

                const showItems = type === 'roll' || type === 'damage';
                html.find('#bonus-items-row').toggle(showItems);
                if (showItems) {
                    html.find('#row-bonus-targetTypes-roll').toggle(type === 'roll');
                    html.find('#row-bonus-targetTypes-damage').toggle(type === 'damage');
                }

                html.closest('.dialog').css('height', 'auto');
            });

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
            });

            html.on('click', '.bonus-remove-dmg', function () {
                const $list = html.find('#bonus-damage-list');
                if ($list.find('.bonus-damage-entry').length > 1) {
                    $(this).closest('.bonus-damage-entry').remove();
                }
            });

            // Clear all bonuses
            html.find('#bonus-clear-all').click(async () => {
                const targetID = html.find('#bonus-target').val();
                const target = canvas.tokens.get(targetID);
                if (!target || !target.actor)
                    return;
                await target.actor.unsetFlag("lancer-automations", "global_bonuses");
                setTimeout(updateBonusList, 200);
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
        }
    }, {
        width: 'auto',
        height: 'auto'
    });

    dialog.render(true);
}
