/* global game, ui, canvas, $ */

import { applyEffectsToTokens } from "../flagged-effects.js";
import { laRenderWeaponProfile, laRenderTextSection, laRenderTags, laRenderActions, laDetailPopup, laPositionPopup } from "../interactive/detail-renderers.js";
import { startChoiceCard } from "../interactive/network.js";
import { getWeaponProfiles_WithBonus } from "../misc-tools.js";

const structTableTitles = [
    "Crushing Hit",
    "Direct Hit",
    "System Trauma",
    "System Trauma",
    "System Trauma",
    "Glancing Blow",
    "Glancing Blow",
];

function structTableDescriptions(roll, remStruct) {
    switch (roll) {
    case 0:
        return "Roll a <strong>HULL</strong> check. On a success, your mech is Dazed until the end of your next turn. On a Failure, your mech is immediately destroyed.";
    case 1:
        switch (remStruct) {
        case 2:
            return "Roll a <strong>HULL</strong> check. On a success, your mech is Impaired and Slowed until the end of your next turn. On a failure, you take the <strong>SYSTEM TRAUMA</strong> result from this table, and your mech is Impaired and Immobilized until the end of your next turn. If there are no valid systems or weapons remaining, this result becomes a <strong>CRUSHING HIT</strong> instead.";
        case 1:
            return "You take the <strong>SYSTEM TRAUMA</strong> result from this table and must roll a <strong>HULL</strong> check. On a success, your mech is Impaired and Slowed until the end of your next turn. On a Failure, Your mech is Stunned until the end of your next turn. If there are no valid weapons or systems remaining, this result becomes a <strong>CRUSHING HIT</strong> instead.";
        default:
            return "Your mech is Impaired and Slowed until the end of your next turn.";
        }
    case 2:
    case 3:
    case 4:
        return "Parts of your mech are torn off by the damage. Roll 1d6. On a 1–3, all weapons on one mount of your choice are destroyed; on a 4–6, a system of your choice is destroyed. LIMITED systems and weapons that are out of charges are not valid choices. If there are no valid choices remaining, it becomes the other result. If there are no valid systems or weapons remaining, this result becomes a <strong>DIRECT HIT</strong> instead.";
    case 5:
    case 6:
        return "Emergency systems kick in and stabilize your mech, but it's Impaired until the end of your next turn.";
    }
    return "";
}

const getRollCount = (roll, num_to_count) => {
    return roll
        ? roll.terms[0].results.filter((v) => v.result === num_to_count).length
        : 0;
};

/**
 * Validates that the actor is a mech or NPC.
 * @param {Actor} actor - The actor to validate.
 * @returns {boolean} - True if valid, false otherwise.
 */
function isValidActor(actor) {
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can perform this action.");
        return false;
    }
    return true;
}

async function createCrushingHitRoll(damage) {
    const roll = new Roll(`${damage}d6kl1`);
    await roll.evaluate({ allowInteractive: false });
    const term0 = /** @type {DiceTerm} */ (roll.terms[0]);
    term0.results = term0.results.map(r => ({
        result: 1,
        active: r.active,
        discarded: r.discarded,
        hidden: true
    }));
    /** @type {any} */ (roll)._total = 1;
    return roll;
}

async function createDirectHitRoll(damage) {
    const roll = new Roll(`${damage}d6kl1`);
    await roll.evaluate({ allowInteractive: false });
    const term0 = /** @type {DiceTerm} */ (roll.terms[0]);
    if (term0.results.length > 0) {
        term0.results[0] = {
            result: 1,
            active: true,
            discarded: false,
            hidden: true
        };
    }
    /** @type {any} */ (roll)._total = 1;
    return roll;
}

/**
 * Pre-roll step for 1-structure NPCs: bypass the table entirely and show
 * an immediate "Crushing Hit – destroyed" card, mirroring oneStructFlowStep
 * from csm-lancer-qol. Injected before preStructureRollChecks in StructureFlow.
 */
export async function npcOneStructStep(state) {
    const actor = state.actor;
    if (!actor?.is_npc() || actor.system.structure.max !== 1)
        return true;

    if (!state.data)
        state.data = {};
    state.data.title = "Crushing Hit";
    state.data.desc = "Your mech is damaged beyond repair \u2013 it is destroyed. You may still exit it as normal.";
    state.data.result = undefined;

    const onStructureStep = game.lancer.flowSteps?.get("lancer-automations:onStructure");
    if (onStructureStep)
        await onStructureStep(state);

    const printStructureCard = game.lancer.flowSteps?.get("printStructureCard");
    if (printStructureCard)
        await printStructureCard(state);

    await actor.update({ "system.structure.value": actor.system.structure.value - 1 });
    return false;
}

export async function altRollStructure(state) {
    if (!state.data)
        throw new TypeError(`Structure roll flow data missing!`);
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    let remStruct = state.data?.reroll_data?.structure ?? actor.system.structure.value;
    let roll;
    let result;

    if (remStruct >= actor.system.structure.max) {
        ui.notifications.info(
            "The mech is at full Structure, no structure check to roll."
        );
        return false;
    } else {
        let damage = actor.system.structure.max - remStruct;
        let formula = `${damage}d6kl1`;
        // If it's an NPC with legendary, change the formula to roll twice and keep the best result.
        if (actor.is_npc() &&
      actor.items.some((i) => ["npcf_legendary_ultra", "npcf_legendary_veteran"].includes(i.system.lid)
      )) {
            formula = `{${formula}, ${formula}}kh`;
        }
        roll = await new Roll(formula).evaluate();
        result = roll.total;
    }

    if (result === undefined)
        return false;

    state.data = {
        type: "structure",
        title: structTableTitles[result],
        desc: structTableDescriptions(result, remStruct),
        remStruct: remStruct,
        val: actor.system.structure.value,
        max: actor.system.structure.max,
        roll_str: roll.formula,
        result: {
            roll: roll,
            tt: await roll.getTooltip(),
            total: (roll.total ?? 0).toString(),
        },
    };

    return true;
}
export async function structCheckMultipleOnes(state) {
    if (!state.data)
        throw new TypeError(`Structure roll flow data missing!`);

    if (!isValidActor(state.actor))
        return false;

    const roll = state.data.result?.roll;
    if (!roll)
        throw new TypeError(`Structure check hasn't been rolled yet!`);

    let one_count = getRollCount(roll, 1);
    if (one_count > 1) {
        state.data.title = structTableTitles[0];
        state.data.desc = structTableDescriptions(0, 1);
    }

    return true;
}
export async function insertHullCheckButton(state) {
    if (!state.data)
        throw new TypeError(`Structure roll flow data missing!`);

    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    let show_button = false;
    const result = state.data.result;
    if (!result)
        throw new TypeError(`Structure check hasn't been rolled yet!`);

    const roll = result.roll;
    const structure = state.data.remStruct;
    const rollTotal = roll.total;

    switch (rollTotal) {
    case 1:
        switch (structure) {
        case 1:
        case 2:
            show_button = true;
            break;
        }
        break;
    }

    let one_count = getRollCount(roll, 1);

    if (show_button) {
        state.data.embedButtons = state.data.embedButtons || [];

        const validWeapons = getValidWeaponMounts(actor);
        const validSystems = getValidSystems(actor);
        const hasWeaponsOrSystems = validWeapons.length > 0 || validSystems.length > 0;

        if (one_count > 1) {
            // Crushing Hit (Multiple 1's): Special HULL check
            state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="CrushingHitHullCheckFlow"
            data-check-type="hull"
            data-actor-id="${actor.uuid}"
          >
            <i class="fas fa-dice-d20 i--sm"></i> HULL
          </a>`);
        } else if (rollTotal === 1 && structure === 2) {
            // Direct Hit with 2 Structure: HULL check with conditional TEAR OFF
            state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="DirectHitHullCheckFlow"
            data-check-type="hull"
            data-actor-id="${actor.uuid}"
            data-rem-struct="${structure}"
            data-has-items="${hasWeaponsOrSystems}"
          >
            <i class="fas fa-dice-d20 i--sm"></i> HULL
          </a>`);
        } else if (rollTotal === 1 && structure === 1) {
            state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="DirectHitHullCheckFlow"
            data-check-type="hull"
            data-actor-id="${actor.uuid}"
            data-rem-struct="${structure}"
            data-has-items="${hasWeaponsOrSystems}"
          >
            <i class="fas fa-dice-d20 i--sm"></i> HULL
          </a>`);
        } else {
            state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="check"
            data-check-type="hull"
            data-actor-id="${actor.uuid}"
          >
            <i class="fas fa-dice-d20 i--sm"></i> HULL
          </a>`);
        }
    }
    return true;
}

export async function insertSecondaryRollButton(state) {
    if (!state.data)
        throw new TypeError(`Structure roll flow data missing!`);

    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Structure check hasn't been rolled yet!`);

    let show_button = false;
    const roll = result.roll;
    const structure = state.data.remStruct;

    switch (roll.total) {
    case 1:
        switch (structure) {
        case 1:
            break;
        case 2:
            break;
        }
        break;
    case 2:
    case 3:
    case 4:
        // System Trauma: Always show TEAR OFF
        show_button = true;
        break;
    }

    const validWeapons = getValidWeaponMounts(actor);
    const validSystems = getValidSystems(actor);
    const hasWeaponsOrSystems = validWeapons.length > 0 || validSystems.length > 0;

    if (show_button) {
        state.data.embedButtons = state.data.embedButtons || [];
        if (hasWeaponsOrSystems) {
            state.data.embedButtons.push(`<a
          class="flow-button lancer-button"
          data-flow-type="secondaryStructure"
          data-actor-id="${actor.uuid}"
        >
          <i class="fas fa-dice-d6 i--sm"></i> TEAR OFF
        </a>`);
        } else {
            state.data.embedButtons.push(`<a
              class="flow-button lancer-button"
              data-flow-type="TearOffDirectHitFlow"
              data-actor-id="${actor.uuid}"
            >
              <i class="fas fa-dice-d6 i--sm"></i> DIRECT HIT
            </a>`);
        }
    }
    return true;
}

// #region Item Destruction Helpers

/**
 * Check if an item is a valid choice for destruction
 * - Items already destroyed are not valid
 * - LIMITED items with no uses remaining are not valid
 */
function isValidDestructionChoice(item) {
    if (!item)
        return false;
    if (item.system?.destroyed === true) {
        return false;
    }
    const isLimited = item.system?.tags?.some((t) => t.lid === "tg_limited" || t.is_limited);
    if (isLimited) {
        const uses = item.system?.uses?.value ?? 0;
        return uses > 0;
    }
    return true;
}

function getValidWeaponMounts(actor, includeDestroyed = false) {
    // Handle NPCs - they store weapons as items, not in loadout
    if (actor.is_npc?.()) {
        const validWeapons = [];
        const weapons = actor.items.filter(i =>
            i.type === "npc_feature" &&
      i.system.type === "Weapon"
        );
        for (let i = 0; i < weapons.length; i++) {
            const weaponItem = weapons[i];
            if (includeDestroyed || isValidDestructionChoice(weaponItem)) {
                validWeapons.push({
                    index: i,
                    mount: { type: "Weapon", slots: [] },
                    weapons: [weaponItem],
                    name: weaponItem.name,
                    itemId: weaponItem.id
                });
            }
        }
        return validWeapons;
    }

    // Handle Mechs - they have weapon mounts
    if (!actor.system?.loadout?.weapon_mounts)
        return [];
    const validMounts = [];
    for (let i = 0; i < actor.system.loadout.weapon_mounts.length; i++) {
        const mount = actor.system.loadout.weapon_mounts[i];
        const weapons = [];
        for (const slot of mount.slots || []) {
            if (slot.weapon && slot.weapon.status === "resolved" && slot.weapon.value) {
                const weaponItem = slot.weapon.value;
                if (includeDestroyed || isValidDestructionChoice(weaponItem)) {
                    weapons.push(weaponItem);
                }
            }
        }
        if (weapons.length > 0) {
            validMounts.push({
                index: i,
                mount: mount,
                weapons: weapons,
                name: `${mount.type} Mount`
            });
        }
    }
    return validMounts;
}

function getValidSystems(actor, includeDestroyed = false) {
    // Handle NPCs - they store features as items, not in loadout
    if (actor.is_npc?.()) {
        const validSystems = [];
        const features = actor.items.filter(i =>
            i.type === "npc_feature" && i.system.type === "System"
        );
        for (const featureItem of features) {
            if (includeDestroyed || isValidDestructionChoice(featureItem)) {
                validSystems.push(featureItem);
            }
        }
        return validSystems;
    }

    // Handle Mechs - they have systems in loadout
    if (!actor.system?.loadout?.systems)
        return [];
    const validSystems = [];
    for (const systemRef of actor.system.loadout.systems) {
        if (systemRef && systemRef.status === "resolved" && systemRef.value) {
            const systemItem = systemRef.value;
            if (includeDestroyed || isValidDestructionChoice(systemItem)) {
                validSystems.push(systemItem);
            }
        }
    }
    return validSystems;
}

// #endregion

async function showSystemTraumaDialog(actor, traumaType) {
    const validMounts = getValidWeaponMounts(actor);
    const validSystems = getValidSystems(actor);
    const allMounts = getValidWeaponMounts(actor, true);
    const allSystems = getValidSystems(actor, true);

    let items = [];
    let titleHtml = "";
    let subtitle = "";

    if (traumaType === "weapon") {
        if (validMounts.length === 0 && validSystems.length > 0)
            traumaType = "system";
        else if (validMounts.length === 0 && validSystems.length === 0)
            return null;
    } else if (traumaType === "system") {
        if (validSystems.length === 0 && validMounts.length > 0)
            traumaType = "weapon";
        else if (validSystems.length === 0 && validMounts.length === 0)
            return null;
    }

    if (traumaType === "weapon") {
        titleHtml = "SYSTEM TRAUMA // WEAPON DESTRUCTION";
        subtitle = actor.is_npc?.()
            ? "Select a weapon to destroy."
            : "Select a weapon mount to destroy. All destructible weapons on the selected mount will be destroyed.";
        items = allMounts.map(m => {
            const allIndestructible = m.weapons.length > 0 && m.weapons.every(w =>
                (w.system?.all_tags ?? w.system?.tags)?.some(t => t.lid === 'tg_indestructible')
            );
            const labelHtml = m.weapons.map(w => {
                const isDestroyed = w.system?.destroyed === true;
                const isIndestructible = !isDestroyed && (w.system?.all_tags ?? w.system?.tags)?.some(t => t.lid === 'tg_indestructible');
                const badge = isDestroyed
                    ? `<span style="font-size:0.7em;background:#b71c1c;color:#fff;padding:1px 4px;border-radius:3px;margin-left:5px;vertical-align:middle;">✕ DESTROYED</span>`
                    : isIndestructible
                        ? `<span style="font-size:0.7em;background:#1a3a5c;color:#7ec8e3;padding:1px 4px;border-radius:3px;margin-left:5px;vertical-align:middle;">INDESTRUCTIBLE</span>`
                        : '';
                return `<div style="display:block;margin-bottom:2px;"><span style="font-weight:bold;">${w.name}${badge}</span></div>`;
            }).join('');
            const weaponDetails = m.weapons.map(w => {
                const sys = w.system;
                if (!sys)
                    return null;
                const profiles = getWeaponProfiles_WithBonus(w, actor);
                if (!profiles.length)
                    return null;
                const size = sys.size?.toLowerCase() === 'superheavy' ? 'Superheavy' : (sys.size || "");
                const type = sys.active_profile?.type || sys.type || "";
                return { name: w.name, img: w.img, size, type, profiles };
            }).filter(Boolean);
            return {
                id: `mount_${m.index}`,
                type: "mount",
                data: m,
                img: m.weapons[0]?.img || "icons/svg/item-bag.svg",
                labelHtml,
                sublabel: m.name,
                selectable: !allIndestructible && m.weapons.some(w => isValidDestructionChoice(w)),
                detail: { weaponDetails },
            };
        });
        const armamentRedundancy = validSystems.find(s => s.system.lid === "ms_armament_redundancy");
        if (armamentRedundancy) {
            items.push({
                id: `system_${armamentRedundancy.id}`,
                type: "system",
                data: armamentRedundancy,
                img: armamentRedundancy.img || "systems/lancer/assets/icons/mech_system.svg",
                labelHtml: `<div style="display:block;margin-bottom:2px;"><span style="font-weight:bold;">${armamentRedundancy.name}</span></div><div style="font-size:0.82em;color:#bbb;margin-top:2px;">Destroy this system to prevent weapon destruction.</div>`,
                sublabel: armamentRedundancy.system?.type || "SYSTEM",
                selectable: true,
                detail: {
                    weaponDetails: null,
                    effect: armamentRedundancy.system?.effect || "",
                    tags: armamentRedundancy.system?.tags ?? [],
                    actions: armamentRedundancy.system?.actions ?? []
                },
            });
        }
    } else {
        titleHtml = "SYSTEM TRAUMA // SYSTEM DESTRUCTION";
        subtitle = "Select a system to destroy.";
        items = allSystems.map(s => {
            const isDestroyed = s.system?.destroyed === true;
            const isIndestructible = !isDestroyed && s.system?.tags?.some(t => t.lid === 'tg_indestructible');
            const badge = isDestroyed
                ? `<span style="font-size:0.7em;background:#b71c1c;color:#fff;padding:1px 4px;border-radius:3px;margin-left:5px;vertical-align:middle;">✕ DESTROYED</span>`
                : isIndestructible
                    ? `<span style="font-size:0.7em;background:#1a3a5c;color:#7ec8e3;padding:1px 4px;border-radius:3px;margin-left:5px;vertical-align:middle;">INDESTRUCTIBLE</span>`
                    : '';
            return {
                id: `system_${s.id}`,
                type: "system",
                data: s,
                img: s.img || "systems/lancer/assets/icons/mech_system.svg",
                labelHtml: `<div style="display:block;margin-bottom:2px;"><span style="font-weight:bold;">${s.name}${badge}</span></div>`,
                sublabel: s.system?.type || "SYSTEM",
                selectable: isValidDestructionChoice(s) && !isIndestructible,
                detail: {
                    weaponDetails: null,
                    effect: s.system?.effect || "",
                    tags: s.system?.tags ?? [],
                    actions: s.system?.actions ?? []
                },
            };
        });
    }

    return new Promise((resolve) => {
        let selectedId = items.find(i => i.selectable)?.id ?? null;

        const content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">${titleHtml}</div>
                <div class="lancer-dialog-subtitle">${subtitle}</div>
            </div>
            <div class="lancer-dialog-body" style="padding: 10px;">
                <div style="font-size:0.72em;color:#777;font-style:italic;margin-bottom:6px;"><i class="fas fa-mouse-pointer"></i> Right-click a row for details</div>
                <div class="la-choice-list" style="max-height: 350px; overflow-y: auto; padding-right: 5px;">
                    ${items.map(item => `
                        <div class="la-choice-item ${item.selectable ? '' : 'unselectable'}" data-item-id="${item.id}"
                             style="display:flex;align-items:center;padding:5px 8px;border:1px solid ${item.selectable ? (item.id === selectedId ? '#ff6400' : '#444') : '#222'};
                                    margin-bottom:3px;cursor:${item.selectable ? 'pointer' : 'not-allowed'};border-radius:3px;
                                    background:${item.selectable ? (item.id === selectedId ? 'rgba(255,100,0,0.05)' : 'rgba(255,255,255,0.03)') : 'rgba(0,0,0,0.2)'};
                                    opacity:${item.selectable ? '1' : '0.75'};transition:all 0.15s;">
                            <img src="${item.img}" style="width:28px;height:28px;object-fit:contain;margin-right:8px;border:1px solid #333;flex-shrink:0;">
                            <div style="flex:1;display:flex;flex-direction:column;min-width:0;">
                                <div style="margin-bottom:1px;">${item.labelHtml}</div>
                                <span style="font-size:0.68em;opacity:0.45;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">${item.sublabel}</span>
                            </div>
                            <i class="fas fa-check selection-check" style="color:#ff6400;margin-left:6px;font-size:0.85em;visibility:${item.id === selectedId ? 'visible' : 'hidden'};"></i>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        new Dialog({
            title: "System Trauma",
            content,
            buttons: {
                destroy: {
                    icon: '<i class="fas fa-trash"></i>',
                    label: "Destroy",
                    callback: () => {
                        const item = items.find(i => i.id === selectedId);
                        if (!item) {
                            resolve(null);
                            return;
                        }
                        if (!item.selectable) {
                            ui.notifications.warn("This item cannot be destroyed.");
                            resolve(null);
                            return;
                        }
                        if (item.type === "mount")
                            resolve({ type: "mount", mount: item.data });
                        else
                            resolve({ type: "system", system: item.data });
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            default: "destroy",
            render: (html) => {
                html.find('.la-choice-item').on('contextmenu', function(e) {
                    e.preventDefault();
                    $('.la-trauma-detail-popup').remove();
                    const itemId = $(this).data('item-id');
                    const item = items.find(i => i.id === itemId);
                    if (!item?.detail)
                        return;

                    let title = '', subtitle = '', bodyHtml = '', theme = 'weapon';
                    if (item.type === "mount" && item.detail.weaponDetails?.length) {
                        bodyHtml = item.detail.weaponDetails.map(wd => {
                            const wName = item.detail.weaponDetails.length > 1
                                ? `<div style="font-size:0.8em;font-weight:bold;color:#ff6400;margin-bottom:6px;border-bottom:1px solid #333;padding-bottom:4px;">${wd.name}</div>`
                                : '';
                            const showProfileNames = wd.profiles.length > 1;
                            const profilesHtml = wd.profiles
                                .map(p => laRenderWeaponProfile(p, showProfileNames))
                                .join('<div style="border-top:1px dashed #333;margin:5px 0;"></div>');
                            return `${wName}${profilesHtml}`;
                        }).join('<hr style="border:0;border-top:1px solid #333;margin:6px 0;">');
                        title = item.detail.weaponDetails.length > 1 ? item.sublabel : (item.detail.weaponDetails[0]?.name ?? '');
                        subtitle = item.detail.weaponDetails.length > 1
                            ? item.detail.weaponDetails.map(w => w.name).join(' / ')
                            : [item.detail.weaponDetails[0]?.size, item.detail.weaponDetails[0]?.type].filter(Boolean).join(' · ');
                    } else if (item.type === "system") {
                        const d = item.detail;
                        if (!d.effect && !d.tags?.length && !d.actions?.length)
                            return;
                        title = item.data.name;
                        subtitle = item.sublabel;
                        bodyHtml = laRenderTextSection('EFFECT', d.effect, '#e65100')
                            + laRenderTags(d.tags)
                            + laRenderActions(d.actions);
                        theme = 'system';
                    } else {
                        return;
                    }
                    const popup = laDetailPopup('la-trauma-detail-popup', title, subtitle, bodyHtml, theme);
                    laPositionPopup(popup, html);
                });

                html.find('.la-choice-item:not(.unselectable)').on('click', function() {
                    html.find('.la-choice-item')
                        .css({ 'border-color': '#444', 'background': 'rgba(255,255,255,0.03)' })
                        .find('.selection-check').css('visibility', 'hidden');
                    $(this).css({ 'border-color': '#ff6400', 'background': 'rgba(255,100,0,0.05)' })
                        .find('.selection-check').css('visibility', 'visible');
                    selectedId = $(this).data('item-id');
                });
            }
        }, {
            classes: ['lancer-dialog-base', 'lancer-no-title'],
            width: 480,
            top: 450,
            left: 150
        }).render(true);
    });
}

/**
 * Manual System Trauma function for macros/hotkeys
 * Shows a dialog to select weapon or system trauma, then applies it to the selected token
 */
export async function manualSystemTrauma() {
    let token = canvas.tokens.controlled[0];
    if (!token && game.user.character) {
        const tokens = game.user.character.getActiveTokens();
        token = tokens[0];
    }
    if (!token) {
        ui.notifications.error("No token selected!");
        return;
    }
    const actor = token.actor;
    if (!actor || (!actor.is_mech() && !actor.is_npc())) {
        ui.notifications.error("Selected token must be a mech or NPC!");
        return;
    }

    const validWeapons = getValidWeaponMounts(actor);
    const validSystems = getValidSystems(actor);
    const hasWeapons = validWeapons.length > 0;
    const hasSystems = validSystems.length > 0;

    if (!hasWeapons && !hasSystems) {
        ui.notifications.warn("No weapons or systems available to destroy!");
        return;
    }

    let traumaType = null;
    await startChoiceCard({
        title: "SYSTEM TRAUMA",
        mode: "or",
        choices: [
            ...(hasWeapons ? [{
                text: "Weapon Mount",
                icon: "cci cci-weapon",
                callback: async () => {
                    traumaType = "weapon";
                }
            }] : []),
            ...(hasSystems ? [{
                text: "System",
                icon: "cci cci-system",
                callback: async () => {
                    traumaType = "system";
                }
            }] : [])
        ]
    });

    if (!traumaType) {
        return;
    }
    console.log(`lancer-automations (alt-struct): Manual System Trauma - ${traumaType}`);

    const choice = await showSystemTraumaDialog(actor, traumaType);
    if (!choice) {
        return;
    }

    let destroyedItems = [];
    if (choice.type === "mount") {
        for (const weapon of choice.mount.weapons) {
            const isIndestructible = (weapon.system?.all_tags ?? weapon.system?.tags)?.some(t => t.lid === 'tg_indestructible');
            if (!isIndestructible) {
                await weapon.update({ "system.destroyed": true });
                destroyedItems.push(weapon.name);
            }
        }
    } else if (choice.type === "system") {
        await choice.system.update({ "system.destroyed": true });
        destroyedItems.push(choice.system.name);
    }

    const itemsList = destroyedItems.join(', ');
    ui.notifications.info(`System Trauma: ${itemsList} destroyed`);

    ChatMessage.create({
        author: game.user.id,
        speaker: ChatMessage.getSpeaker({ token: token }),
        content: `
      <div class="card clipped-bot" style="margin: 0px;">
        <div class="lancer-header lancer-primary">
          <i class="cci cci-structure i--m"></i> SYSTEM TRAUMA
        </div>
        <div class="effect-text">
          <p><strong>Type:</strong> ${traumaType === "weapon" ? "Weapon Destruction" : "System Destruction"}</p>
          <p><strong>Destroyed:</strong> ${itemsList}</p>
        </div>
      </div>
    `
    });
    console.log(`lancer-automations (alt-struct): Manual System Trauma complete - ${itemsList}`);
}

/**
 * Handles the "Tear Off" choice when a fallback to Direct Hit is needed.
 * (Triggered by a 2-4 on the structure table)
 */
export async function selectDestructionTargetDirectHitFallback(state) {
    return handleTearOffChoice(state, true);
}

/**
 * Handles the "Tear Off" choice when a fallback to Crushing Hit is needed.
 * (Triggered by a failed HULL check on a Direct Hit)
 */
export async function selectDestructionTargetCrushingHitFallback(state) {
    return handleTearOffChoice(state, false);
}

/**
 * Secondary Structure selection step - runs after TEAR OFF roll
 * Shows dialog to select which item to destroy based on 1d6 roll
 */
async function handleTearOffChoice(state, isSystemTrauma) {
    if (!state.data)
        throw new TypeError(`Secondary Structure roll flow data missing!`);

    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Secondary Structure check hasn't been rolled yet!`);

    const traumaType = result.roll.total <= 3 ? "weapon" : "system";
    const choice = await showSystemTraumaDialog(actor, traumaType);

    if (!choice) {
        const damage = actor.system.structure.max - actor.system.structure.value;
        const hitType = isSystemTrauma ? "Direct Hit" : "Crushing Hit";
        const hitDescription = isSystemTrauma
            ? "No weapons or systems available! This triggers a <strong>Direct Hit</strong>."
            : "No weapons or systems available! This triggers a <strong>Crushing Hit</strong>.";

        const confirmed = await new Promise((resolve) => {
            new Dialog({
                title: "System Trauma - No Equipment Available",
                content: `
          <style>
            .no-equipment-dialog {
              text-align: center;
              padding: 20px;
            }
            .no-equipment-dialog h2 {
              color: var(--primary-color);
              margin-bottom: 15px;
            }
            .no-equipment-dialog p {
              margin-bottom: 20px;
              font-size: 14px;
            }
            .no-equipment-dialog .warning-icon {
              font-size: 48px;
              color: var(--primary-color);
              margin-bottom: 10px;
            }
          </style>
          <div class="no-equipment-dialog">
            <div class="warning-icon"><i class="fas fa-exclamation-triangle"></i></div>
            <h2>No Equipment Available</h2>
            <p>${hitDescription}</p>
            <p>Click the button below to proceed with the ${hitType} roll.</p>
          </div>
        `,
                buttons: {
                    proceed: {
                        icon: '<i class="cci cci-structure"></i>',
                        label: hitType,
                        callback: () => resolve(true)
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel",
                        callback: () => resolve(false)
                    }
                },
                default: "proceed"
            }, {
                width: 400,
                height: "auto"
            }).render(true);
        });

        if (!confirmed) {
            return false;
        }

        let simulatedRoll;
        if (isSystemTrauma) {
            simulatedRoll = await createDirectHitRoll(damage);
        } else {
            simulatedRoll = await createCrushingHitRoll(damage);
        }

        const SimulatedStructureFlow = game.lancer?.flows?.get("SimulatedStructureFlow");
        if (SimulatedStructureFlow && typeof SimulatedStructureFlow === "function") {
            new SimulatedStructureFlow(actor.uuid, { overrideRoll: simulatedRoll }).begin();
        } else if (SimulatedStructureFlow?.steps) {
            const GenericFlow = class extends game.lancer.Flow {
                constructor(uuid, data) {
                    super(uuid, data || {});
                }
            };
            GenericFlow.steps = SimulatedStructureFlow.steps;
            new GenericFlow(actor.uuid, { overrideRoll: simulatedRoll }).begin();
        } else {
            console.error("lancer-automations (alt-struct): SimulatedStructureFlow not found!");
        }
        return false;
    }

    if (choice.type === "mount") {
        const destroyedWeapons = [];
        for (const weapon of choice.mount.weapons) {
            const isIndestructible = (weapon.system?.all_tags ?? weapon.system?.tags)?.some(t => t.lid === 'tg_indestructible');
            if (!isIndestructible) {
                await weapon.update({ "system.destroyed": true });
                destroyedWeapons.push(weapon.name);
            }
        }
        const weaponList = destroyedWeapons.join(', ');
        state.data.title = "Weapons Destroyed";
        if (destroyedWeapons.length > 0) {
            state.data.description = `The following weapons on <strong>${choice.mount.name}</strong> have been destroyed: ${weaponList}`;
        } else {
            state.data.description = `No weapons on <strong>${choice.mount.name}</strong> could be destroyed as they are all indestructible.`;
        }
        state.data.tags = [];
    } else if (choice.type === "system") {
        await choice.system.update({ "system.destroyed": true });
        state.data.title = "System Destroyed";
        state.data.description = `System <strong>${choice.system.name}</strong> has been destroyed.`;
        state.data.tags = [];
    }

    // Clear the result to prevent printGenericCard from showing the TEAR OFF roll
    delete state.data.result;

    // If this was Direct Hit with 1 Structure, add HULL check button
    const currentStructure = actor.system.structure.value;
    if (currentStructure === 1) {
        state.data.embedButtons = state.data.embedButtons || [];
        state.data.embedButtons.push(`<a
          class="flow-button lancer-button"
          data-flow-type="DirectHitHullCheckFlow"
          data-check-type="hull"
          data-actor-id="${actor.uuid}"
          data-rem-struct="1"
        >
          <i class="fas fa-dice-d20 i--sm"></i> HULL
        </a>`);
    }
    return true;
}

export async function tearOffDirectHitFlow(state) {
    if (!state.data)
        throw new TypeError(`Check flow data missing!`);
    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const damage = actor.system.structure.max - actor.system.structure.value;
    const confirmed = await new Promise((resolve) => {
        new Dialog({
            title: "System Trauma  - No Equipment Available",
            content: `
              <style>
                .no-equipment-dialog {
                  text-align: center;
                  padding: 20px;
                }
                .no-equipment-dialog h2 {
                  color: var(--primary-color);
                  margin-bottom: 15px;
                }
                .no-equipment-dialog p {
                  margin-bottom: 20px;
                  font-size: 14px;
                }
                .no-equipment-dialog .warning-icon {
                  font-size: 48px;
                  color: var(--primary-color);
                  margin-bottom: 10px;
                }
              </style>
              <div class="no-equipment-dialog">
                <div class="warning-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <h2>No Equipment Available</h2>
                <p>No weapons or systems available! This triggers a <strong>Direct Hit</strong>.</p>
                <p>Click the button below to proceed with the Direct Hit roll.</p>
              </div>
            `,
            buttons: {
                proceed: {
                    icon: '<i class="cci cci-structure"></i>',
                    label: "Direct Hit",
                    callback: () => resolve(true)
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(false)
                }
            },
            default: "proceed"
        }, {
            width: 400,
            height: "auto"
        }).render(true);
    });

    if (!confirmed) {
        console.log("lancer-automations (alt-struct): Player cancelled Direct Hit");
        return true;
    }

    console.log("lancer-automations (alt-struct): No weapons/systems, launching SimulatedStructureFlow with Direct Hit");
    const crushingRoll = await createDirectHitRoll(damage);
    const SimulatedStructureFlow = game.lancer?.flows?.get("SimulatedStructureFlow");
    if (SimulatedStructureFlow && typeof SimulatedStructureFlow === "function") {
        new SimulatedStructureFlow(actor.uuid, { overrideRoll: crushingRoll }).begin();
    } else if (SimulatedStructureFlow?.steps) {
        const GenericFlow = class extends game.lancer.Flow {
            constructor(uuid, data) {
                super(uuid, data || {});
            }
        };
        GenericFlow.steps = SimulatedStructureFlow.steps;
        new GenericFlow(actor.uuid, { overrideRoll: crushingRoll }).begin();
    } else {
        console.error("lancer-automations (alt-struct): SimulatedStructureFlow not found!");
    }
    return true;
}

export async function tearOffCrushingHitFlow(state) {
    if (!state.data)
        throw new TypeError(`Check flow data missing!`);
    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const damage = actor.system.structure.max - actor.system.structure.value;
    const confirmed = await new Promise((resolve) => {
        new Dialog({
            title: "Direct Hit - No Equipment Available",
            content: `
              <style>
                .no-equipment-dialog {
                  text-align: center;
                  padding: 20px;
                }
                .no-equipment-dialog h2 {
                  color: var(--primary-color);
                  margin-bottom: 15px;
                }
                .no-equipment-dialog p {
                  margin-bottom: 20px;
                  font-size: 14px;
                }
                .no-equipment-dialog .warning-icon {
                  font-size: 48px;
                  color: var(--primary-color);
                  margin-bottom: 10px;
                }
              </style>
              <div class="no-equipment-dialog">
                <div class="warning-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <h2>No Equipment Available</h2>
                <p>No weapons or systems available! This triggers a <strong>Crushing Hit</strong>.</p>
                <p>Click the button below to proceed with the Crushing Hit roll.</p>
              </div>
            `,
            buttons: {
                proceed: {
                    icon: '<i class="cci cci-structure"></i>',
                    label: "Crushing Hit",
                    callback: () => resolve(true)
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(false)
                }
            },
            default: "proceed"
        }, {
            width: 400,
            height: "auto"
        }).render(true);
    });

    if (!confirmed) {
        console.log("lancer-automations (alt-struct): Player cancelled Crushing Hit");
        return true;
    }

    console.log("lancer-automations (alt-struct): No weapons/systems, launching SimulatedStructureFlow with Crushing Hit");
    const crushingRoll = await createCrushingHitRoll(damage);
    const SimulatedStructureFlow = game.lancer?.flows?.get("SimulatedStructureFlow");
    if (SimulatedStructureFlow && typeof SimulatedStructureFlow === "function") {
        new SimulatedStructureFlow(actor.uuid, { overrideRoll: crushingRoll }).begin();
    } else if (SimulatedStructureFlow?.steps) {
        const GenericFlow = class extends game.lancer.Flow {
            constructor(uuid, data) {
                super(uuid, data || {});
            }
        };
        GenericFlow.steps = SimulatedStructureFlow.steps;
        new GenericFlow(actor.uuid, { overrideRoll: crushingRoll }).begin();
    } else {
        console.error("lancer-automations (alt-struct): SimulatedStructureFlow not found!");
    }
    return true;
}

/**
 * Handle Direct Hit with 1 or 2 Structure after HULL check
 */
export async function handleDirectHitHullCheckResult(state) {
    console.log("lancer-automations (alt-struct): handleDirectHitHullCheckResult EXECUTING");
    if (!state.data)
        throw new TypeError(`Check flow data missing!`);
    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const remStruct = actor.system.structure.value;
    if (remStruct !== 1 && remStruct !== 2) {
        return true;
    }

    const result = state.data.result;
    if (!result)
        throw new TypeError(`HULL check hasn't been rolled yet!`);

    const roll = result.roll;
    const DC = 10;
    const success = roll.total >= DC;

    const tokens = actor.getActiveTokens();
    const token = tokens?.[0];
    state.data.embedButtons = state.data.embedButtons || [];

    const validWeapons = getValidWeaponMounts(actor);
    const validSystems = getValidSystems(actor);
    const hasWeaponsOrSystems = validWeapons.length > 0 || validSystems.length > 0;

    if (remStruct === 2) {
        if (success) {
            if (token) {
                try {
                    await applyEffectsToTokens({
                        tokens: [token],
                        effectNames: ["slow", "impaired"],
                        note: "Direct Hit (HULL check success)",
                        duration: { label: 'end', turns: 1, rounds: 0 },
                    });
                } catch (error) {
                    console.warn("lancer-automations (alt-struct): Could not apply effects:", error);
                }
            }
        } else {
            if (hasWeaponsOrSystems) {
                if (token) {
                    try {
                        await applyEffectsToTokens({
                            tokens: [token],
                            effectNames: ["immobilized", "impaired"],
                            note: "Direct Hit (HULL check failed)",
                            duration: { label: 'end', turns: 1, rounds: 0 },
                        });
                    } catch (error) {
                        console.warn("lancer-automations (alt-struct): Could not apply effects:", error);
                    }
                }
                state.data.embedButtons.push(`<a
          class="flow-button lancer-button"
          data-flow-type="secondaryStructureCrushingHit"
          data-actor-id="${actor.uuid}"
        >
          <i class="fas fa-dice-d6 i--sm"></i> TEAR OFF
        </a>`);
            } else {
                state.data.embedButtons.push(`<a
              class="flow-button lancer-button"
              data-flow-type="TearOffCrushingHitFlow"
              data-actor-id="${actor.uuid}"
            >
              <i class="fas fa-dice-d6 i--sm"></i> CRUSHING HIT
            </a>`);
            }
        }
    } else if (remStruct === 1) {
        if (!hasWeaponsOrSystems) {
            state.data.embedButtons.push(`<a
              class="flow-button lancer-button"
              data-flow-type="TearOffCrushingHitFlow"
              data-actor-id="${actor.uuid}"
            >
              <i class="fas fa-dice-d6 i--sm"></i> CRUSHING HIT
            </a>`);
        } else {
            state.data.embedButtons.push(`<a
              class="flow-button lancer-button"
              data-flow-type="secondaryStructureCrushingHit"
              data-actor-id="${actor.uuid}"
            >
              <i class="fas fa-dice-d6 i--sm"></i> TEAR OFF
            </a>`);
            if (success) {
                if (token) {
                    try {
                        await applyEffectsToTokens({
                            tokens: [token],
                            effectNames: ["slow", "impaired"],
                            note: "Direct Hit (HULL check success)",
                            duration: { label: 'end', turns: 1, rounds: 0 },
                        });
                    } catch (error) {
                        console.warn("lancer-automations (alt-struct): Could not apply effects:", error);
                    }
                }
            } else {
                if (token) {
                    try {
                        await applyEffectsToTokens({
                            tokens: [token],
                            effectNames: ["stunned"],
                            note: "Direct Hit (HULL check failed)",
                            duration: { label: 'end', turns: 1, rounds: 0 },
                        });
                    } catch (error) {
                        console.warn("lancer-automations (alt-struct): Could not apply effects:", error);
                    }
                }
            }
        }
    }
    return true;
}

/**
 * Handle Crushing Hit (Multiple 1's) after HULL check
 * Success: Apply Dazed until end of next turn
 * Failure: Mech is destroyed
 */
export async function handleCrushingHitHullCheckResult(state) {
    console.log("lancer-automations (alt-struct): handleCrushingHitHullCheckResult EXECUTING");
    if (!state.data)
        throw new TypeError(`Check flow data missing!`);
    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const result = state.data.result;
    if (!result)
        throw new TypeError(`HULL check hasn't been rolled yet!`);

    const roll = result.roll;
    const DC = 10;
    const success = roll.total >= DC;

    const tokens = actor.getActiveTokens();
    const token = tokens?.[0];

    if (success) {
        if (token) {
            try {
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["Dazed"],
                    note: "Crushing Hit - Cannot take reactions, can only take one quick action",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } catch (error) {
                console.warn("lancer-automations (alt-struct): Could not apply Dazed effect:", error);
            }
        }
    } else {
        try {
            await actor.update({
                "system.structure.value": 0,
                "system.hp.value": actor.system.hp.value - actor.system.hp.max
            });
        } catch (error) {
            console.error("lancer-automations (alt-struct): Failed to destroy mech:", error);
            ui.notifications.error("HULL check failed! The mech is DESTROYED.");
        }
    }
    return true;
}

/**
 * Apply automatic effects based on structure roll result
 * - Glancing Blow (5-6): Apply IMPAIRED until end of next turn
 */
export async function applyStructureEffects(state) {
    if (!state.data)
        throw new TypeError(`Structure roll flow data missing!`);
    if (!isValidActor(state.actor))
        return false;
    const actor = state.actor;

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Structure check hasn't been rolled yet!`);

    const roll = result.roll;
    const rollTotal = roll.total;
    const remStruct = state.data.remStruct;

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0) {
        console.log("lancer-automations (alt-struct): No active token found for actor");
        return true;
    }
    const token = tokens[0];

    switch (rollTotal) {
    case 1:
        // Direct Hit - 3+ Structure: IMPAIRED + SLOWED until end of next turn
        if (remStruct >= 3) {
            try {
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "impaired"],
                    note: "Direct Hit",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } catch (error) {
                console.warn("lancer-automations (alt-struct): Could not apply Direct Hit effects:", error);
            }
        }
        break;
    case 5:
    case 6:
        // Glancing Blow: IMPAIRED until end of next turn
        try {
            await applyEffectsToTokens({
                tokens: [token],
                effectNames: ["impaired"],
                note: "Glancing Blow",
                duration: { label: 'end', turns: 1, rounds: 0 },
            });
        } catch (error) {
            console.warn("lancer-automations (alt-struct): Could not apply IMPAIRED effect:", error);
        }
        break;
    }
    return true;
}
