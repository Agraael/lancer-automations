/* global canvas, PIXI, game, ui, $, Dialog */

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
    _runCardCallback, _updatePendingBadge
} from "./cards.js";

import {
    drawRangeHighlight, placeToken, chooseToken
} from "./canvas.js";

import { startChoiceCard } from "./network.js";

import {
    isHexGrid, getOccupiedOffsets, drawHexAt
} from "../grid-helpers.js";

/**
 * Deploy a weapon as a token on the ground using interactive placement.
 * Creates a "Template Throw" deployable actor if it doesn't exist, then uses placeToken for placement.
 * @param {Item} weapon - The weapon item to deploy
 * @param {Actor} ownerActor - The actor who owns the weapon
 * @param {Token} [originToken=null] - The token placing the weapon (used for range origin)
 * @param {Object} [options={}] - Extra options
 * @param {number|null} [options.range=1] - Placement range in grid units (null for unlimited)
 * @param {Token|Object|null} [options.at=null] - Origin override for range measurement
 * @param {string} [options.title] - Card title override
 * @param {string} [options.description] - Card description override
 * @returns {Promise<Array<TokenDocument>|null>} Spawned token documents, or null if cancelled
 */
export async function deployWeaponToken(weapon, ownerActor, originToken = null, options = {}) {
    const {
        range = 1,
        title = "DEPLOY WEAPON",
        description = "",
        at = null
    } = options;

    const templateName = "Template Throw";
    let templateActor = game.actors.contents.find((/** @type {any} */ a) =>
        a.name === templateName && a.type === 'deployable'
    );

    if (!templateActor) {
        const LancerActor = game.lancer?.LancerActor || Actor;
        templateActor = await LancerActor.create({
            name: templateName,
            type: 'deployable',
            img: 'systems/lancer/assets/icons/white/melee.svg',
            system: {
                hp: { value: 5, max: 5, min: 0 },
                evasion: 5,
                edef: 5,
                armor: 0,
                size: 0.5,
                activations: 0
            },
            folder: null,
            ownership: { default: 0 },
            prototypeToken: {
                name: templateName,
                img: 'systems/lancer/assets/icons/white/melee.svg',
                width: 1,
                height: 1,
                displayName: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.OWNER_HOVER,
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                bar1: { attribute: 'hp' }
            }
        });

        if (!templateActor) {
            ui.notifications.error("Failed to create Template Throw actor.");
            return null;
        }
    }

    let ownerName = /** @type {string} */ (ownerActor.name || "");
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved") {
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;
    }

    const extraData = {
        name: weapon.name,
        actorData: { name: `${weapon.name} [${ownerName}]` },
        flags: {
            'lancer-automations': {
                thrownWeapon: true,
                weaponName: weapon.name,
                weaponId: weapon.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName: ownerName
            }
        }
    };
    const result = await placeToken({
        actor: /** @type {Actor} */(templateActor),
        range,
        count: 1,
        origin: at || originToken,
        title,
        description,
        icon: "fas fa-hammer",
        extraData,
        onSpawn: async () => {
            await weapon.update(/** @type {any} */({ 'system.disabled': true }));
        }
    });

    // Fire onDeploy trigger
    if (result) {
        const api = game.modules.get('lancer-automations')?.api;
        if (api?.handleTrigger) {
            await api.handleTrigger('onDeploy', {
                triggeringToken: originToken || ownerActor.getActiveTokens()?.[0] || null,
                item: weapon,
                deployedTokens: Array.isArray(result) ? result : [result],
                deployType: "throw"
            });
        }
    }

    return result;
}

/**
 * Spawn one or more Hard Cover tokens on the canvas.
 * @param {Token|null} originToken - Origin token for range measurement
 * @param {Object} [options]
 * @param {number|null} [options.range=null] - Max placement range in grid units (null = unlimited)
 * @param {number} [options.count=1] - Number of cover pieces to place
 * @param {number} [options.size=1] - Token size (1 or 2). HP scales with size (10 × size).
 * @param {string} [options.name="Hard Cover"] - Name for the placed token(s)
 * @param {string} [options.title="PLACE HARD COVER"] - Card title
 * @param {string} [options.description=""] - Card description
 * @returns {Promise<Array<TokenDocument>|null>}
 */
export async function spawnHardCover(originToken, options = {}) {
    const {
        range = null,
        count = 1,
        size = 1,
        name = "Hard Cover",
        title = "PLACE HARD COVER",
        description = ""
    } = options;

    const templateName = "Template Hard Cover";
    const iconPath = "modules/lancer-automations/icons/stone-pile.svg";

    let templateActor = game.actors.contents.find((/** @type {any} */ a) =>
        a.name === templateName && a.type === 'deployable'
    );

    if (!templateActor) {
        const LancerActor = /** @type {any} */ (game.lancer?.LancerActor || Actor);
        templateActor = await LancerActor.create({
            name: templateName,
            type: 'deployable',
            img: iconPath,
            system: {
                hp: { value: 10, max: 10, min: 0 },
                stats: { hp: 10, evasion: 5, edef: 5, armor: 0, size: 1, speed: 0, save: 10, heatcap: 0 },
                activations: 0
            },
            folder: null,
            ownership: { default: 0 },
            prototypeToken: {
                name: templateName,
                img: iconPath,
                width: 1,
                height: 1,
                displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
                displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL,
                bar1: { attribute: 'hp' }
            }
        });

        if (!templateActor) {
            ui.notifications.error("Failed to create Template Hard Cover actor.");
            return null;
        }
    }

    // Ensure stats.hp is correct — Lancer derives hp.max from stats.hp, not hp.max directly
    const _templateActor = /** @type {any} */ (templateActor);
    if (_templateActor.system?.stats?.hp !== 10) {
        await _templateActor.update({ "system.stats.hp": 10, "system.hp.value": 10, "system.hp.max": 10 });
    }

    const hp = 10 * size;
    const extraData = /** @type {any} */ ({
        name,
        width: size,
        height: size,
        flags: {
            'lancer-automations': {
                hardCover: true
            }
        }
    });
    // Override size and HP on the token's synthetic actor via delta (Foundry v12)
    if (size !== 1) {
        extraData.delta = {
            system: {
                stats: { hp, size },
                hp: { value: hp, max: hp, min: 0 }
            }
        };
    }

    return placeToken({
        actor: /** @type {Actor} */ (templateActor),
        range,
        count,
        origin: originToken,
        title,
        description,
        icon: "fas fa-cube",
        extraData
    });
}

/**
 * Pick up a thrown weapon token from the scene. Shows a chooseToken card restricted
 * to the owner's thrown weapons. Re-enables the weapon and deletes the deployed token.
 * @param {Token} ownerToken - The token whose actor owns the thrown weapons
 * @returns {Promise<Object|null>} { weaponName, weaponId } or null if cancelled/none found
 */
export async function pickupWeaponToken(ownerToken) {
    if (!ownerToken?.actor) {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const thrownTokens = canvas.tokens.placeables.filter(t => {
        const flags = t.document.flags?.['lancer-automations'];
        return flags?.thrownWeapon && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (thrownTokens.length === 0) {
        ui.notifications.warn("No thrown weapons found for this character.");
        return null;
    }

    const choices = thrownTokens.map((t, idx) => {
        const flags = t.document.flags?.['lancer-automations'];
        return { idx, token: t, name: flags?.weaponName || t.name, img: t.document?.texture?.src || 'icons/svg/item-bag.svg' };
    });
    const listHtml = choices.map(c => `
        <div class="la-pickup-item" data-idx="${c.idx}"
             style="display:flex;align-items:center;padding:5px 8px;border:1px solid #444;margin-bottom:3px;
                    cursor:pointer;border-radius:3px;background:rgba(255,255,255,0.03);transition:all 0.15s;">
            <img src="${c.img}" style="width:28px;height:28px;object-fit:contain;margin-right:8px;border:1px solid #333;flex-shrink:0;">
            <div style="flex:1;">
                <div style="font-weight:bold;">${c.name}</div>
                <div style="font-size:0.68em;opacity:0.45;text-transform:uppercase;font-weight:bold;letter-spacing:0.5px;">Thrown Weapon</div>
            </div>
            <i class="fas fa-check" style="color:#ff6400;margin-left:6px;font-size:0.85em;visibility:hidden;"></i>
        </div>`).join('');
    const content = `
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">PICK UP WEAPON</div>
            <div class="lancer-dialog-subtitle">${choices.length} thrown weapon(s) available.</div>
        </div>
        <div class="lancer-dialog-body" style="padding:10px;">
            <div style="max-height:350px;overflow-y:auto;padding-right:5px;">${listHtml}</div>
        </div>`;
    const pickedToken = await new Promise(resolveDialog => {
        let selectedIdx = null;
        new Dialog({
            title: 'Pick Up Weapon',
            content,
            buttons: {
                confirm: {
                    icon: '<i class="fas fa-check"></i>',
                    label: 'Pick Up',
                    callback: () => resolveDialog(selectedIdx !== null ? choices[selectedIdx].token : null),
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Cancel',
                    callback: () => resolveDialog(null),
                },
            },
            default: 'confirm',
            render: (html) => {
                const confirmBtn = html.parent().find('button.confirm');
                confirmBtn.prop('disabled', true);
                html.find('.la-pickup-item').on('click', function() {
                    html.find('.la-pickup-item').css({ 'border-color': '#444', background: 'rgba(255,255,255,0.03)' }).find('i').css('visibility', 'hidden');
                    selectedIdx = Number.parseInt($(this).data('idx'));
                    $(this).css({ 'border-color': '#ff6400', background: 'rgba(255,100,0,0.05)' }).find('i').css('visibility', 'visible');
                    confirmBtn.prop('disabled', false);
                });
            },
        }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 400, top: 450, left: 150 }).render(true);
    });

    if (!pickedToken)
        return null;
    const flags = pickedToken.document?.flags?.['lancer-automations'];
    const weaponId = flags?.weaponId;
    const weaponName = flags?.weaponName || "Weapon";

    if (game.user.isGM) {
        const weapon = ownerActor.items.get(weaponId);
        if (weapon)
            await weapon.update(/** @type {any} */({ 'system.disabled': false }));
        await pickedToken.document.delete();
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "pickupWeapon",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                weaponId,
                ownerActorUuid: ownerActor.uuid,
                weaponName
            }
        });
    }

    ui.notifications.info(`Picked up ${weaponName}.`);
    return { weaponName, weaponId };
}

/**
 * Resolve a deployable actor from either a direct reference or a LID string.
 * Searches actor folder (owned by the given actor) first, then compendiums.
 * @param {Actor|string} deployableOrLid - A deployable Actor or a LID string (e.g. "dep_turret")
 * @param {Actor} ownerActor - The actor that owns the deployable (used for folder search)
 * @returns {Promise<{deployable: Actor|null, source: string|null}>} The deployable and its source ('actor', 'compendium', or null)
 */
export async function resolveDeployable(deployableOrLid, ownerActor) {
    // If it's already an Actor, return directly
    if (deployableOrLid && typeof deployableOrLid !== 'string') {
        return { deployable: deployableOrLid, source: 'actor' };
    }

    const lid = deployableOrLid;
    if (!lid)
        return { deployable: null, source: null };

    // First, look in actor folder owned by this actor
    let deployable = /** @type {Actor} */(game.actors.contents.find((/** @type {any} */ a) => {
        if (a.type !== 'deployable' || a.system?.lid !== lid) {
            return false;
        }
        const ownerVal = a.system?.owner;
        return ownerVal === ownerActor?.uuid ||
               ownerVal === ownerActor?.id ||
               ownerVal?.id === ownerActor?.uuid ||
               ownerVal?.id === ownerActor?.id;
    }));

    if (deployable) {
        return { deployable, source: 'actor' };
    }

    // If not found, search in compendiums
    for (const pack of game.packs.filter(p => p.documentName === 'Actor')) {
        const index = await pack.getIndex();
        const entry = index.find(e => e.system?.lid === lid);

        if (entry) {
            deployable = await pack.getDocument(entry._id);
            if (deployable?.type === 'deployable') {
                return { deployable, source: 'compendium' };
            }
        }
    }

    return { deployable: null, source: null };
}

/**
 * Module-level cache: lid → { name, img }.
 * Populated lazily by `getDeployableInfo`. Benefits the whole module.
 * @type {Map<string, { name: string, img: string, activation: string | null } | null>}
 */
const _deployableInfoCache = new Map();

/**
 * Get the name and img for a deployable LID.
 * Checks world actors first (sync), then the cache, then async-resolves from compendium and caches.
 * Returns a plain `{ name, img }` object — never the full Actor to keep it lightweight.
 *
 * @param {string} lid
 * @param {any} [ownerActor] - Used by resolveDeployable for folder search
 * @returns {Promise<{ name: string, img: string, activation: string | null } | null>}
 */
/**
 * Synchronous read from the deployable info cache (populated by `getDeployableInfo`).
 * Returns null if not yet cached — call `getDeployableInfo` first to warm the cache.
 * @param {string} lid
 * @returns {{ name: string, img: string, activation: string | null } | null}
 */
/**
 * @param {string} lid
 * @param {any} ownerActor
 * @returns {any|null}
 */
function _findWorldDeployable(lid, ownerActor) {
    const all = /** @type {any[]} */ (game.actors?.contents ?? []).filter(
        a => a.type === 'deployable' && a.system?.lid === lid
    );
    if (!all.length) return null;
    if (ownerActor) {
        const owned = all.find(a => {
            const ownerVal = a.system?.owner;
            return ownerVal === ownerActor.uuid || ownerVal === ownerActor.id ||
                   ownerVal?.id === ownerActor.uuid || ownerVal?.id === ownerActor.id;
        });
        if (owned) return owned;
    }
    return all[0];
}

export function getDeployableInfoSync(lid, ownerActor = null) {
    if (!lid)
        return null;
    const worldActor = _findWorldDeployable(lid, ownerActor);
    if (worldActor)
        return { name: worldActor.name, img: worldActor.img, activation: worldActor.system?.activation ?? null };
    return _deployableInfoCache.get(lid) ?? null;
}

export async function getDeployableInfo(lid, ownerActor = null) {
    if (!lid)
        return null;
    // World actor takes priority — most accurate, no cache needed
    const worldActor = _findWorldDeployable(lid, ownerActor);
    if (worldActor)
        return { name: worldActor.name, img: worldActor.img, activation: worldActor.system?.activation ?? null };
    // Cache hit
    if (_deployableInfoCache.has(lid))
        return _deployableInfoCache.get(lid);
    // Async resolve from compendium and populate cache
    const resolved = await resolveDeployable(lid, ownerActor);
    const info = resolved.deployable
        ? { name: resolved.deployable.name, img: resolved.deployable.img, activation: resolved.deployable.system?.activation ?? null }
        : null;
    _deployableInfoCache.set(lid, info);
    return info;
}

/**
 * Place a deployable token on the scene with interactive placement.
 * @param {Object} [options={}]
 * @param {Actor|string|Array<Actor|string>} [options.deployable] - A deployable Actor, LID string, or array of them
 * @param {Actor} [options.ownerActor] - The actor that owns the deployable
 * @param {Object|null} [options.systemItem=null] - The system/item that grants the deployable (for use consumption)
 * @param {boolean} [options.consumeUse=false] - Whether to consume a use from systemItem
 * @param {boolean} [options.fromCompendium=false] - Whether the deployable is from a compendium (creates a new actor)
 * @param {number|null} [options.width=null] - Token width override (defaults to deployable.prototypeToken.width)
 * @param {number|null} [options.height=null] - Token height override (defaults to deployable.prototypeToken.height)
 * @param {number} [options.range=1] - Placement range (null for unlimited)
 * @param {number} [options.count=1] - Total number of tokens to place (-1 for unlimited)
 * @param {Token|Object|null} [options.at=null] - Origin override for range measurement
 * @param {string} [options.title="DEPLOY"] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {boolean} [options.noCard=false] - Whether to skip rendering the card
 * @param {number|null} [options.disposition=null] - Token disposition override
 * @param {string|null} [options.team=null] - Token faction team override
 * @returns {Promise<Object|null>} Placement result or null
 */
export async function placeDeployable(options = /** @type {any} */({})) {
    const {
        deployable: deployableOrLid,
        ownerActor,
        systemItem = null,
        consumeUse = false,
        fromCompendium = false,
        width = null,
        height = null,
        range: rangeOpt = null,
        at = null,
        count: countOpt = null,
        title = "DEPLOY",
        description = "",
        noCard = false,
        disposition: dispositionOpt = null,
        team: teamOpt = null
    } = /** @type {any} */(options);

    // Read deploy flags from systemItem if not explicitly provided in options
    const itemFlags = systemItem ? getItemFlags(systemItem) : {};
    const range = rangeOpt ?? itemFlags.deployRange ?? 1;
    const count = countOpt ?? itemFlags.deployCount ?? 1;

    if (!ownerActor) {
        ui.notifications.error("No owner actor specified.");
        return null;
    }

    let ownerName = /** @type {string} */ (ownerActor.name || "");
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved") {
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;
    }

    // Determine defaults for disposition and team from owner
    const disposition = dispositionOpt ?? ownerActor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    let team = teamOpt;
    if (team === null || team === undefined) {
        team = game.modules.get('token-factions')?.active ? ownerActor.getFlag('token-factions', 'team') : null;
    }
    team = team ?? null;

    // Determine origin
    const originToken = at || ownerActor.getActiveTokens()?.[0] || null;

    // --- Normalize deployable input to array ---
    const deployableInputs = Array.isArray(deployableOrLid) ? deployableOrLid : [deployableOrLid];

    // Resolve all deployables and build actor entries
    const actorEntries = [];
    for (const input of deployableInputs) {
        const resolved = await resolveDeployable(input, ownerActor);
        let actualDeployable = resolved.deployable;
        const isFromCompendium = fromCompendium || resolved.source === 'compendium';

        if (!actualDeployable) {
            ui.notifications.warn(`Deployable not found: ${input}`);
            continue;
        }

        // If from compendium, create a new actor first
        if (isFromCompendium) {
            const actorData = /** @type {any} */(actualDeployable.toObject());
            const ownerBaseActor = /** @type {Actor} */(ownerActor.token?.baseActor ?? ownerActor);
            actorData.system.owner = ownerBaseActor.uuid;
            actorData.name = `${actualDeployable.name} [${ownerName}]`;
            actorData.folder = ownerActor.folder?.id;
            actorData.ownership = foundry.utils.duplicate(ownerActor.ownership);

            // Inherit disposition and team for the new actor
            actorData.prototypeToken = actorData.prototypeToken || {};
            actorData.prototypeToken.disposition = disposition;
            if (team !== null) {
                actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                actorData.prototypeToken.flags['token-factions'].team = team;
            }
            actorData.flags = actorData.flags || {};
            const LancerActor = game.lancer?.LancerActor || Actor;
            actualDeployable = await LancerActor.create(actorData);
            if (!actualDeployable) {
                ui.notifications.error(`Failed to create deployable actor for: ${input}`);
                continue;
            }
            ui.notifications.info(`Created ${actorData.name}`);
        }

        const tokenWidth = width ?? actualDeployable.prototypeToken?.width ?? 1;
        const tokenHeight = height ?? actualDeployable.prototypeToken?.height ?? 1;

        actorEntries.push({
            actor: actualDeployable,
            extraData: {
                width: tokenWidth,
                height: tokenHeight,
                actorData: { name: `${actualDeployable.name}` },
                flags: {
                    'lancer-automations': {
                        deployedItem: true,
                        deployableName: actualDeployable.name,
                        deployableId: actualDeployable.id,
                        ownerActorUuid: ownerActor.uuid,
                        ownerName: ownerName,
                        systemItemId: systemItem?.id || null
                    }
                }
            }
        });
    }

    if (actorEntries.length === 0) {
        ui.notifications.error("No valid deployables found.");
        return null;
    }

    // Single deployable → pass actor directly; multiple → pass array for actor selector
    const actorParam = actorEntries.length === 1
        ? actorEntries[0].actor
        : actorEntries;

    const extraDataParam = actorEntries.length === 1
        ? actorEntries[0].extraData
        : {};

    const result = await placeToken({
        actor: actorParam,
        range,
        count,
        origin: originToken,
        title,
        description,
        icon: "cci cci-deployable",
        extraData: extraDataParam,
        noCard: noCard,
        disposition,
        team
    });

    if (result && systemItem) {
        const updates = {};

        if (consumeUse) {
            const uses = systemItem.system?.uses;
            if (uses && typeof uses.value === 'number') {
                const minUses = uses.min ?? 0;
                updates["system.uses.value"] = Math.max(uses.value - 1, minUses);
            }
            if (systemItem.system?.charged) {
                updates["system.charged"] = false;
            }
            if (Object.keys(updates).length > 0) {
                await systemItem.update(updates);
            }
        }
    }

    // Fire onDeploy trigger
    if (result) {
        const api = game.modules.get('lancer-automations')?.api;
        if (api?.handleTrigger) {
            await api.handleTrigger('onDeploy', {
                triggeringToken: originToken,
                item: systemItem,
                deployedTokens: Array.isArray(result) ? result : [result],
                deployType: "deployable"
            });
        }
    }

    return result;
}

/**
 * Find a deployable by LID and place it interactively using placeDeployable.
 * @param {Actor} actor - The owner actor
 * @param {string} deployableLid - The LID of the deployable
 * @param {Object|null} parentItem - The item that grants the deployable (for use consumption)
 * @param {boolean} consumeUse - Whether to consume a use from parentItem
 */
export async function deployDeployable(actor, deployableLid, parentItem, consumeUse) {
    await placeDeployable({
        deployable: deployableLid,
        ownerActor: actor,
        systemItem: parentItem,
        consumeUse: consumeUse ?? false,
    });
}

/**
 * Add or update lancer-automations flags on an item document.
 * Uses setFlag for reliable persistence (bypasses TypeDataModel restrictions).
 * Known flag keys:
 *   - deployRange {number}  — default range when placing this item's deployables
 *   - deployCount {number}  — default count when placing this item's deployables
 *   - activeStateData {Object} — contains { active: boolean, endAction: string, endActionDescription: string }
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function addItemFlags(item, flags) {
    if (!item || typeof flags !== 'object') {
        ui.notifications.error("addItemFlags: item and flags object are required.");
        return null;
    }
    for (const [key, val] of Object.entries(flags)) {
        await item.setFlag('lancer-automations', key, val);
    }
    return item;
}

/**
 * Removes flags from an item document.
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function removeItemFlags(item, flags) {
    if (!item || typeof flags !== 'object') {
        ui.notifications.error("removeItemFlags: item and flags object are required.");
        return null;
    }
    for (const [key, val] of Object.entries(flags)) {
        await item.unsetFlag('lancer-automations', key);
    }
    return item;
}

/**
 * Marks an item as activated.
 * @param {Item} item - The item to mark natively
 * @param {Token} token - The token that owns the item (kept for signature compatibility)
 * @param {string} endAction - A string defining what action is used to end the activation (e.g. "Quick", "Full")
 * @param {string} [endActionDescription=""] - Optional text description shown when ending the activation
 * @returns {Promise<Item>} The updated item
 */
export async function setItemAsActivated(item, token, endAction, endActionDescription = "") {
    if (!item) {
        ui.notifications.warn("No item provided to setItemAsActivated.");
        return null;
    }
    return await addItemFlags(item, {
        activeStateData: {
            active: true,
            endAction: endAction,
            endActionDescription: endActionDescription
        }
    });
}

/**
 * Gets all activated items for a token.
 * @param {Token} token
 * @returns {Array<Item>} Array of activated items.
 */
export function getActivatedItems(token) {
    if (!token?.actor) {
        return [];
    }
    const allItems = token.actor.items;
    return allItems.filter(item => {
        const flags = getItemFlags(item);
        return flags?.activeStateData?.active === true;
    });
}

/**
 * Ends an item's activation. Removes the activated flags and posts a chat message (via SimpleActivationFlow).
 * @param {Item} item - The activated item
 * @param {Token} token - The token (needed for the flow)
 * @returns {Promise<boolean>} Whether the flow completed
 */
export async function endItemActivation(item, token) {
    if (!item || !token?.actor) {
        return false;
    }

    const flags = getItemFlags(item);
    if (!flags?.activeStateData?.active) {
        return false;
    }

    const endAction = flags.activeStateData.endAction || "Unknown";
    const endActionDescription = flags.activeStateData.endActionDescription || "";

    // Unset the activation flag
    await removeItemFlags(item, { activeStateData: true });

    const api = game.modules.get('lancer-automations')?.api;
    if (api?.executeSimpleActivation) {
        const result = await api.executeSimpleActivation(token.actor, {
            title: `End ${item.name}`,
            action: { name: item.name, activation: endAction },
            detail: endActionDescription,
            tags: item.system?.tags || []
        }, {
            item: item,
            endActivation: true
        });
        return result.completed;
    }
    return false;
}

/**
 * Opens a prompt to choose an activated item to end.
 * @param {Token} token - The token that has the activated items.
 * @returns {Promise<Item|null>} The item that was selected and ended, or null if canceled.
 */
export async function openEndActivationMenu(token) {
    if (!token?.actor) {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const activatedItems = getActivatedItems(token);
    if (activatedItems.length === 0) {
        ui.notifications.warn(`No activated items found for ${token.name}.`);
        return null;
    }

    const chosenItem = await pickItem(activatedItems, {
        title: "END ITEM ACTIVATION",
        description: `Select an activated item to end for ${token.name}:`,
        icon: "fas fa-power-off",
        formatText: (w) => {
            const flags = getItemFlags(w);
            const actionText = flags?.activeStateData?.endAction ? ` [${flags.activeStateData.endAction}]` : "";
            return `End ${w.name}${actionText}`;
        }
    });

    if (chosenItem) {
        await endItemActivation(chosenItem, token);
        return chosenItem;
    }

    return null;
}


/**
 * Get the effective actions for an item, merging system.actions with extra actions
 * stored in the 'lancer-automations.extraActions' flag.
 * @param {Item} item
 * @returns {Array} Array of action objects
 */
export function getItemActions(item) {
    if (!item)
        return [];
    const systemActions = item.system?.actions ?? [];
    const extraActions = item.getFlag?.('lancer-automations', 'extraActions') || [];
    return [...systemActions, ...extraActions];
}

/**
 * Extra action object — LancerAction shape plus an optional TAH icon field.
 * @typedef {LancerAction & { icon?: string }} ExtraAction
 */

/**
 * Add extra action objects to an item, token, or actor via flags.
 * - Item: stores in item's 'lancer-automations.extraActions' flag (system.actions is read-only)
 * - Token / Actor: stores in actor's 'lancer-automations.extraActions' flag
 * @param {Item|Token|Actor} target         Item, Token, or Actor to attach actions to
 * @param {ExtraAction|ExtraAction[]} actions  A single action object or array of action objects
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraActions(target, actions) {
    if (!target) {
        ui.notifications.error("addExtraActions: target is required.");
        return null;
    }
    const newActions = Array.isArray(actions) ? actions : [actions];
    if (newActions.length === 0)
        return null;

    // Resolve to a Foundry document that supports getFlag/setFlag.
    // Items store actions on themselves; tokens/actors store on the actor.
    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);

    // When adding to an Item, stamp _sourceItemId so the activation flow
    // can resolve the source item later (needed for onlyOnSourceMatch).
    const isItem = doc.documentName === 'Item';
    if (isItem) {
        for (const action of newActions) {
            const a = /** @type {any} */ (action);
            if (!a._sourceItemId) a._sourceItemId = doc.id;
        }
    }

    const existing = doc.getFlag('lancer-automations', 'extraActions') || [];
    const merged = [...existing, ...newActions];

    await doc.setFlag('lancer-automations', 'extraActions', merged);
    console.log(`lancer-automations | addExtraActions: Added action(s) to ${doc.name}:`, newActions);
    return doc;
}

/**
 * Get extra actions stored on a token or actor via addExtraActions.
 * @param {Token|Actor} tokenOrActor
 * @returns {Array<Object>}
 */
export function getActorActions(tokenOrActor) {
    if (!tokenOrActor)
        return [];
    const t = /** @type {any} */ (tokenOrActor);
    const doc = t.actor ?? t.document ?? t;
    return doc.getFlag?.('lancer-automations', 'extraActions') || [];
}

/**
 * Remove extra actions from an item, token, or actor.
 * Accepts a predicate to select which actions to remove, a name string, or an array of names.
 * If no filter is provided, clears all extra actions.
 * @param {Item|Token|Actor} target
 * @param {Function|string|string[]|null} [filter]  (action) => boolean, name string, or array of name strings
 * @returns {Promise<void>}
 */
export async function removeExtraActions(target, filter = null) {
    if (!target)
        return;
    const t = /** @type {any} */ (target);
    const doc = t.actor ?? t.document ?? t;
    const existing = doc.getFlag?.('lancer-automations', 'extraActions') || [];
    if (existing.length === 0)
        return;

    let kept;
    if (!filter) {
        kept = [];
    } else if (typeof filter === 'function') {
        kept = existing.filter(a => !filter(a));
    } else {
        const names = Array.isArray(filter) ? filter : [filter];
        kept = existing.filter(a => !names.includes(a.name));
    }

    await doc.setFlag('lancer-automations', 'extraActions', kept);
}

/**
 * Add extra deployable LIDs to an item via flags (system.deployables is read-only due to Lancer's TypeDataModel).
 * Stores extra LIDs in the 'lancer-automations.extraDeployables' flag, deduplicating against existing entries.
 * @param {Item} item                   The Foundry Item document to update
 * @param {string|Array<string>} lids   A single LID string or array of LID strings to add
 * @returns {Promise<Item|null>} The updated item, or null on failure
 */
export async function addExtraDeploymentLids(item, lids) {
    if (!item) {
        ui.notifications.error("addExtraDeploymentLids: item is required.");
        return null;
    }
    const newLids = Array.isArray(lids) ? lids : [lids];
    if (newLids.length === 0 || newLids.some(l => typeof l !== 'string')) {
        ui.notifications.error("addExtraDeploymentLids: lids must be a string or array of strings.");
        return null;
    }

    const existingFlags = item.getFlag('lancer-automations', 'extraDeployables') || [];
    const merged = [...new Set([...existingFlags, ...newLids])];

    // Skip if nothing new to add
    if (merged.length === existingFlags.length) {
        return item;
    }

    await item.setFlag('lancer-automations', 'extraDeployables', merged);
    console.log(`lancer-automations | addExtraDeploymentLids: Added LID(s) to ${item.name}:`, newLids);
    return item;
}

/**
 * Get the effective deployable LIDs for an item, merging system.deployables with
 * extra LIDs from the lancer-automations.extraDeployables flag.
 * For NPC actors, applies tier-based selection (1 entry = all tiers, 3 entries = pick by tier).
 * @param {Item} item    The item document
 * @param {Actor} [actor] The owner actor (needed for NPC tier selection)
 * @returns {string[]} Array of deployable LID strings
 */
export function getItemDeployables(item, actor = null) {
    if (!item)
        return [];

    const isFrameCore = item.type === 'frame';
    const systemDeployables = isFrameCore
        ? item.system?.core_system?.deployables || []
        : item.system?.deployables || [];
    const extraDeployables = item.getFlag?.('lancer-automations', 'extraDeployables') || [];
    let deployablesArray = [...systemDeployables, ...extraDeployables];

    if (deployablesArray.length === 0)
        return [];

    // NPC tier-based selection: pick the tier-appropriate deployable
    if (actor?.type === 'npc') {
        const tier = actor.system?.tier ?? 1;
        const tierIndex = Math.max(0, Math.min(2, tier - 1));

        if (deployablesArray.length > 3) {
            console.warn(`lancer-automations | ${item.name} has ${deployablesArray.length} deployables (expected 1 or 3 for NPC tier selection).`);
        }

        if (deployablesArray.length === 1) {
            // Single deployable — same for all tiers
            deployablesArray = [deployablesArray[0]];
        } else if (deployablesArray.length >= 3) {
            // Pick by tier index (0=T1, 1=T2, 2=T3)
            deployablesArray = [deployablesArray[tierIndex]];
        }
    }

    return deployablesArray;
}



/**
 * Retrieve lancer-automations flags from an item document.
 * @param {Item} item          The Foundry Item document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or an object containing all lancer-automations flags if no key was provided.
 */
export function getItemFlags(item, flagName = null) {
    if (!item) {
        ui.notifications.error("getItemFlags: item is required.");
        return null;
    }
    if (flagName) {
        return item.getFlag('lancer-automations', flagName);
    }
    return item.flags?.['lancer-automations'] || {};
}

/**
 * Show a deployment card for a specific item's deployables. Resolves all deployable LIDs and
 * opens a single placeDeployable session with the actor selector for multi-deployable placement.
 * @param {Object} [options={}]
 * @param {Actor} [options.actor] - The owner actor
 * @param {Object} [options.item] - The system/frame item that has deployables
 * @param {Array} [options.deployableOptions=[]] - Per-index options overrides for placeDeployable. e.g. [{ range: 3, count: 2 }, { range: 1 }]
 * @returns {Promise<boolean>} true if confirmed, null if cancelled
 */
export async function beginDeploymentCard(options = /** @type {any} */({})) {
    const {
        actor,
        item,
        deployableOptions = []
    } = options;

    if (!actor || !item) {
        ui.notifications.warn("Actor and item are required.");
        return null;
    }

    // Get deployable LIDs (handles system.deployables + extra flags + NPC tier selection)
    const deployablesArray = getItemDeployables(item, actor);

    if (deployablesArray.length === 0) {
        ui.notifications.warn(`No deployables found on ${item.name}.`);
        return null;
    }

    // Compute uses/charge info
    const isFrameCore = item.type === 'frame';
    let hasUses = false;
    let hasRechargeTag = false;
    let isUncharged = false;

    if (!isFrameCore) {
        const uses = item.system?.uses;
        hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
        if (hasUses && uses.value <= 0) {
            ui.notifications.warn(`${item.name} has no uses remaining.`);
            return null;
        }

        hasRechargeTag = item.system?.tags?.some(tag => tag.lid === "tg_recharge");
        isUncharged = hasRechargeTag && item.system?.charged === false;
        if (isUncharged) {
            ui.notifications.warn(`${item.name} is uncharged. You must reload or recharge it before deploying.`);
            return null;
        }
    }

    // Collect all deployable LIDs (duplicates allowed)
    const allLids = [];
    let totalCount = 0;

    // Read per-index options for range and count; use the first range found, sum all counts
    let rangeOpt = null;
    for (let i = 0; i < deployablesArray.length; i++) {
        const lid = deployablesArray[i];
        const idxOpts = deployableOptions[i] || {};
        const depCount = idxOpts.count || 1;
        totalCount += depCount;
        if (idxOpts.range !== undefined && rangeOpt === null) {
            rangeOpt = idxOpts.range;
        }
        // Push the LID once per deployable entry
        allLids.push(lid);
    }

    const result = await placeDeployable({
        deployable: allLids,
        ownerActor: actor,
        systemItem: item,
        consumeUse: hasUses,
        range: rangeOpt,
        title: item.name,
        description: ""
    });

    return result ? true : null;
}

/**
 * Open a dialog menu showing all deployables available to an actor.
 * Allows selecting and deploying them with unlimited range.
 * @param {Actor} actor - The actor whose deployables to show
 * @returns {Promise<void>}
 */
export async function openDeployableMenu(actor) {
    if (!actor) {
        ui.notifications.warn("No actor specified.");
        return;
    }

    // Get all items that have deployables (system field or extra flags)
    const allSystemsWithDeployables = actor.items.filter(item =>
        getItemDeployables(item, actor).length > 0
    );

    if (allSystemsWithDeployables.length === 0) {
        ui.notifications.warn(`No systems with deployables found for ${actor.name}.`);
        return;
    }

    // Build deployable items list
    const items = [];

    for (const system of allSystemsWithDeployables) {
        const isFrameCore = system.type === 'frame';
        const deployablesArray = getItemDeployables(system, actor);

        let uses, hasUses, noUsesLeft, hasRechargeTag, needsRecharge;
        if (isFrameCore) {
            uses = null;
            hasUses = false;
            noUsesLeft = false;
            hasRechargeTag = false;
            needsRecharge = false;
        } else {
            uses = system.system.uses;
            hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
            noUsesLeft = hasUses && uses.value <= 0;
            hasRechargeTag = system.system.tags?.some(tag => tag.lid === "tg_recharge");
            needsRecharge = hasRechargeTag && system.system.charged === false;
        }

        for (const lid of deployablesArray) {
            const { deployable, source } = await resolveDeployable(lid, actor);

            if (deployable) {
                const usesText = hasUses ? `${uses.value}/${uses.max}` : '';
                const chargesText = hasRechargeTag ? (needsRecharge ? "Uncharged" : "Charged") : "";
                const isFromCompendium = source === 'compendium';
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: deployable.id,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: deployable.name,
                    deployableImg: deployable.img,
                    deployableData: deployable,
                    usesText: usesText,
                    chargesText: chargesText,
                    disabled: noUsesLeft || needsRecharge,
                    needsRecharge: needsRecharge,
                    hasUses: hasUses,
                    fromCompendium: isFromCompendium,
                    tokenWidth: deployable.prototypeToken?.width || 1,
                    tokenHeight: deployable.prototypeToken?.height || 1
                });
            } else {
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: null,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: `Not found: ${lid}`,
                    deployableImg: 'icons/svg/hazard.svg',
                    usesText: '',
                    chargesText: '',
                    disabled: true,
                    needsRecharge: false,
                    hasUses: false,
                    notFound: true,
                    fromCompendium: false,
                    tokenWidth: 1,
                    tokenHeight: 1
                });
            }
        }
    }

    if (items.length === 0) {
        ui.notifications.warn(`No deployables available for ${actor.name}.`);
        return;
    }

    let selectedId = items.find(i => !i.disabled)?.id;
    const isGM = game.user.isGM;
    const content = `
        <style>
            .lancer-items-grid {
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 10px;
                max-height: 60vh;
                overflow-y: auto;
            }
            .lancer-item-card {
                min-height: 50px;
                padding: 8px 10px;
                padding-top: 20px;
                position: relative;
                overflow: hidden;
            }
            .lancer-item-card.disabled {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: #888;
                background-color: #00000030;
            }
            .lancer-item-card.disabled:hover {
                border-color: #888;
                box-shadow: none;
            }
            .lancer-item-header {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                margin-bottom: 4px;
            }
            .lancer-item-icon {
                width: 32px;
                height: 32px;
                min-width: 32px;
                object-fit: cover;
                border-radius: 3px;
                flex-shrink: 0;
            }
            .lancer-item-name {
                flex: 1;
                font-weight: bold;
                word-wrap: break-word;
                overflow-wrap: break-word;
                line-height: 1.1;
                font-size: 0.95em;
            }
            .lancer-item-system {
                font-size: 0.8em;
                opacity: 0.7;
                margin-top: 1px;
                font-style: italic;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-uses {
                font-size: 0.8em;
                color: #ff6400;
                margin-top: 1px;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-not-found {
                color: #ff4444;
                font-style: italic;
            }
            .lancer-item-badge {
                position: absolute;
                top: 6px;
                right: 6px;
                background: #ff6400;
                color: white;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.7em;
                font-weight: bold;
                text-transform: uppercase;
            }
            .lancer-item-generate {
                margin-top: 3px;
                padding: 2px 6px;
                background: var(--primary-color);
                color: white;
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 0.7em;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
            }
            .lancer-item-generate:hover:not(:disabled) {
                background: #b5242f;
            }
            .lancer-item-generate:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                background: #555;
            }
            .lancer-item-note {
                font-size: 0.65em;
                color: #aaa;
                font-style: italic;
                margin-top: 1px;
            }
        </style>
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">DEPLOY SYSTEM ITEMS</div>
                <div class="lancer-dialog-subtitle">Select a deployable to place on the battlefield.</div>
            </div>
            <div class="lancer-items-grid">
                ${items.map(item => `
                    <div class="lancer-item-card ${item.disabled ? 'disabled' : ''} ${item.id === selectedId ? 'selected' : ''}"
                         data-item-id="${item.id}"
                         title="${item.disabled ? (item.notFound ? 'Deployable not found' : (item.needsRecharge ? 'Uncharged' : 'No uses remaining')) : item.deployableName}">
                        ${item.fromCompendium ? '<div class="lancer-item-badge">Compendium</div>' : ''}
                        <div class="lancer-item-header">
                            <img src="${item.deployableImg}" class="lancer-item-icon" />
                            <div class="lancer-item-name ${item.notFound ? 'lancer-item-not-found' : ''}">
                                ${item.deployableName}
                            </div>
                        </div>
                        <div class="lancer-item-system">
                            <i class="cci cci-system i--sm"></i> ${item.systemName}
                        </div>
                        ${item.usesText ? `<div class="lancer-item-uses"><i class="fas fa-battery-three-quarters"></i> ${item.usesText}</div>` : ''}
                        ${item.chargesText ? `<div class="lancer-item-uses" style="color:#4488ff"><i class="fas fa-bolt"></i> ${item.chargesText}</div>` : ''}
                        ${item.fromCompendium ? `
                            <button class="lancer-item-generate" data-item-id="${item.id}" ${!isGM ? 'disabled' : ''}>
                                ${isGM ? '<i class="fas fa-plus"></i> Generate' : '<i class="fas fa-lock"></i> GM Only'}
                            </button>
                            ${!isGM ? '<div class="lancer-item-note">GM must create</div>' : ''}
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: "Deploy System Items",
        content: content,
        buttons: {
            deploy: {
                icon: '<i class="cci cci-deployable"></i>',
                label: "Deploy",
                callback: async () => {
                    const item = items.find(i => i.id === selectedId);
                    if (!item || item.disabled || !item.deployableId) {
                        return;
                    }
                    const system = actor.items.get(item.systemId);

                    await placeDeployable({
                        deployable: item.fromCompendium ? item.deployableData : game.actors.get(item.deployableId),
                        ownerActor: actor,
                        systemItem: system,
                        consumeUse: item.hasUses,
                        fromCompendium: item.fromCompendium,
                        width: item.tokenWidth,
                        height: item.tokenHeight,
                        range: null,
                        at: null,
                        title: `DEPLOY ${item.deployableName}`,
                        description: ""
                    });
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "deploy",
        render: (html) => {
            html.find('.lancer-item-card:not(.disabled)').on('click', function () {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function () {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.deploy').click();
            });

            // Handle Generate button
            html.find('.lancer-item-generate').on('click', async function (e) {
                e.stopPropagation();
                const itemId = $(this).data('item-id');
                const item = items.find(i => i.id === itemId);

                if (!item?.deployableData || !game.user.isGM) {
                    return;
                }

                const actorData = item.deployableData.toObject();

                let ownerName = /** @type {string} */ (actor.name || "");
                if (actor.is_mech?.() && actor.system.pilot?.status === "resolved") {
                    ownerName = actor.system.pilot.value.system.callsign || actor.system.pilot.value.name;
                }

                const ownerBaseActor = actor.token?.baseActor ?? actor;
                actorData.system.owner = ownerBaseActor.uuid;
                actorData.name = `${item.deployableName} [${ownerName}]`;
                actorData.folder = actor.folder?.id;
                actorData.ownership = foundry.utils.duplicate(actor.ownership);

                // Inherit disposition and team for the new actor
                actorData.prototypeToken = actorData.prototypeToken || {};
                actorData.prototypeToken.disposition = actor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
                const actorTeam = game.modules.get('token-factions')?.active ? actor.getFlag('token-factions', 'team') : null;
                if (actorTeam !== null) {
                    actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                    actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                    actorData.prototypeToken.flags['token-factions'].team = actorTeam;
                }
                actorData.flags = actorData.flags || {};
                const LancerActor = game.lancer?.LancerActor || Actor;
                const newActor = await LancerActor.create(actorData);
                if (newActor) {
                    ui.notifications.info(`Created ${actorData.name}`);
                    item.deployableId = newActor.id;
                    item.deployableData = newActor;
                    item.fromCompendium = false;

                    const card = html.find(`.lancer-item-card[data-item-id="${itemId}"]`);
                    card.find('.lancer-item-badge').remove();
                    card.find('.lancer-item-generate').remove();
                    card.find('.lancer-item-note').remove();
                }
            });
        }
    }, {
        width: 680,
        height: "auto",
        classes: ['lancer-dialog-base', 'lancer-dialog-base', 'lancer-no-title']
    });

    dialog.render(true);
}

/**
 * Recall (pick up) a deployed deployable from the scene. Shows a chooseToken card
 * restricted to tokens deployed by the owner. Deployables WITHOUT system.recall are
 * highlighted in red as a warning. Deletes the token on recall.
 * @param {Token} ownerToken - The token whose actor owns the deployables
 * @returns {Promise<Object|null>} { deployableName, deployableId } or null if cancelled/none found
 */
export async function recallDeployable(ownerToken) {
    if (!ownerToken?.actor) {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const deployedTokens = canvas.tokens.placeables.filter(t => {
        const flags = t.document.flags?.['lancer-automations'];
        return flags?.deployedItem && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (deployedTokens.length === 0) {
        ui.notifications.warn("No deployed items found for this character.");
        return null;
    }

    // Check which tokens have system.recall on their actor and apply red highlights
    const recallHighlights = [];
    for (const token of deployedTokens) {
        const tokenActor = token.actor;
        if (!tokenActor?.system?.recall) {
            const hl = new PIXI.Graphics();
            hl.lineStyle(2, 0xff4444, 0.8);
            hl.beginFill(0xff4444, 0.25);
            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token);
                for (const o of offsets) {
                    drawHexAt(hl, o.col, o.row);
                }
            } else {
                const gridSize = canvas.grid.size;
                hl.drawRect(token.document.x, token.document.y,
                    token.document.width * gridSize, token.document.height * gridSize);
            }
            hl.endFill();
            if (canvas.tokens?.parent) {
                canvas.tokens.parent.addChildAt(hl, canvas.tokens.parent.getChildIndex(canvas.tokens));
            } else {
                canvas.stage.addChild(hl);
            }
            recallHighlights.push(hl);
        }
    }

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: deployedTokens,
        title: "RECALL DEPLOYABLE",
        description: `${deployedTokens.length} deployed item(s) available. Red highlights indicate deployables with Recall.`,
        icon: "fas fa-hand"
    });

    // Clean up recall highlights
    for (const hl of recallHighlights) {
        hl.destroy({ children: true });
    }

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = pickedToken.document?.flags?.['lancer-automations'];
    const deployableName = flags?.deployableName || "Deployable";
    const deployableId = flags?.deployableId;

    if (game.user.isGM) {
        await pickedToken.document.delete();
    } else {
        game.socket.emit('module.lancer-automations', {
            action: "recallDeployable",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                ownerActorUuid: ownerActor.uuid,
                deployableName
            }
        });
    }

    ui.notifications.info(`Recalled ${deployableName}.`);
    return { deployableName, deployableId };
}

/**
 * Prompts the user to pick an item from a list of items using a Choice Card.
 * @param {Item[]} items - Array of items to choose from.
 * @param {Object} [options] - Options for the choice card.
 * @param {string} [options.title="PICK ITEM"] - Title of the choice card.
 * @param {string} [options.description="Select an item:"] - Description text.
 * @param {string} [options.icon="fas fa-box"] - Icon class for the choice card.
 * @param {function} [options.formatText] - Optional function to format the button text. Defaults to `(item) => item.name`.
 * @param {Token} [options.relatedToken=null] - Optional token to show in the card header.
 * @returns {Promise<Item|null>} The selected item or null if cancelled (or ignored).
 */
export function pickItem(items, options = {}) {
    return new Promise((resolve) => {
        if (!items || items.length === 0) {
            ui.notifications.warn("No items available to pick.");
            return resolve(null);
        }

        const choices = items.map(item => {
            const text = options.formatText ? options.formatText(item) : item.name;
            const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
            return {
                text: text,
                icon: icon,
                callback: () => resolve(item)
            };
        });

        startChoiceCard({
            title: options.title || "PICK ITEM",
            description: options.description || "Select an item:",
            choices: choices,
            icon: options.icon || "fas fa-box",
            relatedToken: options.relatedToken ?? null
        });
    });
}

/**
 * Retrieves all valid weapon items from an actor, handling both Mechs and NPCs.
 * @param {Actor|Token|TokenDocument} entity - The actor or token to get weapons from.
 * @returns {Item[]} Array of weapon items.
 */
export function getWeapons(entity) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (entity))?.actor || entity);
    if (!actor?.items)
        return [];

    return actor.items.filter(i =>
        i.type === 'mech_weapon' ||
        i.type === 'pilot_weapon' ||
        (i.system?.type?.toLowerCase() === 'weapon')
    );
}

/**
 * Finds an item on an actor by its Lancer ID (lid).
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to search.
 * @param {string} lid - The Lancer ID to find.
 * @returns {Item|null} The item, or null if not found.
 */
export function findItemByLid(actorOrToken, lid) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items)
        return null;
    return actor.items.find(i => i.system?.lid === lid) || null;
}

/**
 * Prompts the user to pick an unloaded weapon from an actor and reloads it.
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to reload weapons for.
 * @param {string} [targetName] - Optional target name for the UI notification.
 * @returns {Promise<Item|null>} The reloaded weapon, or null if cancelled.
 */
export async function reloadOneWeapon(actorOrToken, targetName) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor) {
        ui.notifications.warn("No valid actor provided for reloading.");
        return null;
    }

    const weapons = getWeapons(actor);
    const unloadedWeapons = weapons.filter(w => {
        const tags = [...(w.system.active_profile?.tags ?? []), ...(w.system.all_base_tags ?? w.system.tags ?? [])];
        return tags.some(t => t.lid === 'tg_loading') && w.system.loaded === false;
    });

    if (unloadedWeapons.length === 0) {
        ui.notifications.warn(`${name} has no unloaded weapons to reload!`);
        return null;
    }

    const chosenWeapon = await pickItem(unloadedWeapons, {
        title: "CHOOSE WEAPON TO RELOAD",
        description: `Select which of ${name}'s weapons to reload:`,
        icon: "fas fa-sync",
        formatText: (w) => `Reload ${w.name}`
    });

    if (chosenWeapon) {
        await chosenWeapon.update(/** @type {any} */({ "system.loaded": true }));
        ui.notifications.info(`${name}'s ${chosenWeapon.name} reloaded!`);
    }
    return chosenWeapon;
}

/**
 * Prompts the user to pick a depleted system from an actor and restores its uses or charged state.
 * Targets system items (mech_system, pilot_gear, NPC non-weapon features) with tg_limited (uses <= 0) or tg_recharge (charged === false).
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {string} [targetName]
 * @returns {Promise<Item|null>}
 */
export async function rechargeSystem(actorOrToken, targetName) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor) {
        ui.notifications.warn("No valid actor provided for recharging.");
        return null;
    }

    const depletedItems = actor.items.filter(item => {
        if (item.type === 'mech_weapon' || item.type === 'pilot_weapon') return false;
        if (item.system?.type?.toLowerCase() === 'weapon') return false;
        const sys = item.system;
        const tags = [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])];
        const hasLimited = tags.some(t => t.lid === 'tg_limited');
        const hasRecharge = tags.some(t => t.lid === 'tg_recharge');
        if (hasLimited) {
            const val = typeof sys.uses === 'number' ? sys.uses : (sys.uses?.value ?? 0);
            if (val <= 0) return true;
        }
        if (hasRecharge && sys.charged === false) return true;
        return false;
    });

    if (depletedItems.length === 0) {
        ui.notifications.warn(`${name} has no depleted systems to recharge!`);
        return null;
    }

    const chosen = await pickItem(depletedItems, {
        title: "CHOOSE SYSTEM TO RECHARGE",
        description: `Select which of ${name}'s systems to recharge:`,
        icon: "fas fa-bolt",
        formatText: (item) => `Recharge ${item.name}`
    });

    if (!chosen) return null;

    const sys = chosen.system;
    const tags = [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])];
    const hasLimited = tags.some(t => t.lid === 'tg_limited');
    const hasRecharge = tags.some(t => t.lid === 'tg_recharge');
    const update = /** @type {any} */ ({});

    if (hasLimited) {
        if (typeof sys.uses === 'number') {
            update['system.uses'] = sys.uses_max ?? sys.max_uses ?? 0;
        } else {
            update['system.uses.value'] = sys.uses?.max ?? 0;
        }
    }
    if (hasRecharge) {
        update['system.charged'] = true;
    }

    await chosen.update(update);
    ui.notifications.info(`${name}'s ${chosen.name} recharged!`);
    return chosen;
}

/**
 * Called from the createToken hook for every newly placed token.
 * When the "Link Manually Placed Deployables" setting is on, detects deployable tokens
 * placed by hand (no existing lancer-automations owner flag), finds candidate owner tokens,
 * and either auto-links (single candidate or all linked actors) or prompts via chooseToken
 * (multiple candidates where any owner actor is unlinked).
 * After linking, fires the onDeploy trigger.
 * @param {TokenDocument} tokenDocument
 */
export async function handleManualDeployLink(tokenDocument) {
    if (!game.settings.get('lancer-automations', 'linkManualDeploy'))
        return;
    if (tokenDocument.actor?.type !== 'deployable')
        return;
    // Skip if already linked by placeDeployable
    if (tokenDocument.flags?.['lancer-automations']?.deployedItem)
        return;

    const deployableActor = tokenDocument.actor;
    const deployableLid = deployableActor?.system?.lid;
    if (!deployableLid)
        return;

    // Find scene tokens whose actor owns an item that produces this deployable LID
    const allTokens = canvas.tokens?.placeables ?? [];
    const candidateTokens = allTokens.filter(t => {
        if (t.document.id === tokenDocument.id)
            return false;
        if (!t.actor)
            return false;
        return t.actor.items.some(item => getItemDeployables(item, t.actor).includes(deployableLid));
    });

    if (candidateTokens.length === 0)
        return;

    let ownerToken;
    const needsPicker = candidateTokens.length > 1
        || candidateTokens.some(t => !t.document.actorLink);

    if (needsPicker) {
        const deployableToken = canvas.tokens.get(tokenDocument.id);
        const picked = await chooseToken(deployableToken ?? candidateTokens[0], {
            count: 1,
            includeSelf: false,
            selection: candidateTokens,
            title: "LINK DEPLOYABLE",
            description: `Which token owns the deployed ${deployableActor.name}?`,
            icon: "cci cci-deployable"
        });
        if (!picked || picked.length === 0)
            return;
        ownerToken = picked[0];
    } else {
        ownerToken = candidateTokens[0];
    }

    const ownerActor = ownerToken.actor;
    const ownerName = ownerActor.name ?? "";

    // Find the item on the owner that grants this deployable (first match)
    const systemItem = ownerActor.items.find(item =>
        getItemDeployables(item, ownerActor).includes(deployableLid)
    ) ?? null;

    // Stamp ownership flags onto the token
    await tokenDocument.update({
        flags: {
            'lancer-automations': {
                deployedItem: true,
                deployableName: deployableActor.name,
                deployableId: deployableActor.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName,
                systemItemId: systemItem?.id ?? null
            }
        }
    });

    // Fire onDeploy trigger
    const api = game.modules.get('lancer-automations')?.api;
    if (api?.handleTrigger) {
        const deployableToken = canvas.tokens.get(tokenDocument.id);
        await api.handleTrigger('onDeploy', {
            triggeringToken: ownerToken,
            item: systemItem,
            deployedTokens: deployableToken ? [deployableToken] : [],
            deployType: "deployable"
        });
    }
}
