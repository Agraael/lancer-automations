/* global canvas, PIXI, game, ui, $, Dialog */

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
    _runCardCallback, _updatePendingBadge
} from "./cards.js";

import {
    drawRangeHighlight, placeToken, chooseToken
} from "./canvas.js";

import { startChoiceCard } from "./network.js";
import { setActorFlag, unsetActorFlag, setItemFlag, unsetItemFlag, setTokenFlag, unsetTokenFlag } from "../socket.js";
import { playActionFxByActivation, playDeployableFX, playReloadFX } from "../fx/actionFX.js";

import {
    isHexGrid, getOccupiedOffsets, drawHexAt
} from "../combat/grid-helpers.js";

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
                bar1: { attribute: 'hp' },
                flags: { 'lancer-automations': { awarenessMode: 'simple' } }
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

    if (result) {
        await stampDeployableSource(result, weapon);
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
    const iconPath = "modules/lancer-automations/icons/black/stone-pile.svg";

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
                bar1: { attribute: 'hp' },
                flags: { 'lancer-automations': { awarenessMode: 'simple' } }
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

    const result = await placeToken({
        actor: /** @type {Actor} */ (templateActor),
        range,
        count,
        origin: originToken,
        title,
        description,
        icon: "fas fa-cube",
        extraData
    });
    if (result)
        await _applyProvokeImmunity(result);
    return result;
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

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: thrownTokens,
        title: "PICK UP WEAPON",
        description: `${thrownTokens.length} thrown weapon(s) available.`,
        icon: "fas fa-hand"
    });

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
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
    if (typeof deployableOrLid !== 'string') {
        if (deployableOrLid)
            return { deployable: deployableOrLid, source: 'actor' };
        return { deployable: null, source: null };
    }
    const lid = deployableOrLid;
    if (!lid)
        return { deployable: null, source: null };

    // UUID-shaped string: try fromUuid first (e.g. "Actor.abc", "Compendium.pack.Actor.id").
    if (lid.startsWith('Compendium.') || /^Actor\.[A-Za-z0-9]+$/.test(lid)) {
        try {
            const doc = /** @type {any} */ (await fromUuid(lid));
            if (doc?.documentName === 'Actor') {
                return {
                    deployable: doc,
                    source: lid.startsWith('Compendium.') ? 'compendium' : 'actor'
                };
            }
        } catch { /* fall through to LID search */ }
    }

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
 * Compendium-only deployable finder. Skips world actors entirely; useful for callers
 * that need the canonical template rather than an existing instance.
 * Cached for the session; cleared on the `lancer-automations.clearCaches` hook.
 * @param {string} lid e.g. "dep_moonlight_drone"
 * @returns {Promise<Actor|null>}
 */
const _compendiumDeployableCache = new Map();
export async function findDeployableInCompendium(lid) {
    if (!lid)
        return null;
    if (_compendiumDeployableCache.has(lid))
        return _compendiumDeployableCache.get(lid);
    for (const pack of game.packs.filter(p => p.documentName === 'Actor')) {
        const index = await pack.getIndex();
        const entry = index.find(e => e.system?.lid === lid);
        if (!entry)
            continue;
        const doc = await pack.getDocument(entry._id);
        if (doc?.type === 'deployable') {
            _compendiumDeployableCache.set(lid, doc);
            return doc;
        }
    }
    _compendiumDeployableCache.set(lid, null);
    return null;
}

/**
 * Stamp `flags.lancer-automations.sourceItemUuid` on each deployed token document.
 * `resolveDeployableSourceItem` consults this flag before falling back to LID walks,
 * so reactions on the correct source item fire when the owner has multiple matching items.
 * @param {Token[]|Token|null} tokens
 * @param {Item|null} sourceItem
 */
async function stampDeployableSource(tokens, sourceItem) {
    const uuid = sourceItem?.uuid;
    if (!uuid)
        return;
    const arr = Array.isArray(tokens) ? tokens : (tokens ? [tokens] : []);
    for (const t of arr) {
        const doc = t?.document ?? t;
        if (!doc?.update)
            continue;
        try {
            await doc.update({ 'flags.lancer-automations.sourceItemUuid': uuid });
        } catch (e) {
            console.warn('lancer-automations | stampDeployableSource failed:', e);
        }
    }
}

/**
 * Resolve the item that a deployable actor originated from. Walks the owner actor's
 * items for one whose `system.deployables[]` contains the deployable LID; falls back
 * to scanning Item compendiums (npc_feature, mech_system, weapon_mod, frame).
 * Frames are special: also walks `core_system.deployables` and `traits[].deployables`.
 * Cached by deployable LID; cleared on `lancer-automations.clearCaches`.
 * @param {Actor} deployableActor
 * @returns {Promise<Item|null>}
 */
const _sourceItemCache = new Map();
export async function resolveDeployableSourceItem(deployableActor) {
    if (deployableActor?.type !== 'deployable')
        return null;
    const lid = deployableActor.system?.lid;
    if (!lid)
        return null;

    // Flag stamped at deploy time identifies the exact source item.
    try {
        const tokens = deployableActor.getActiveTokens?.() ?? [];
        for (const tk of tokens) {
            const uuid = tk?.document?.flags?.['lancer-automations']?.sourceItemUuid;
            if (uuid) {
                const item = await fromUuid(uuid);
                if (item)
                    return item;
            }
        }
    } catch (e) { /* fall through */ }

    const itemHasDeployable = (item) => {
        if (!item)
            return false;
        const sys = item.system;
        if (Array.isArray(sys?.deployables) && sys.deployables.includes(lid))
            return true;
        if (Array.isArray(sys?.core_system?.deployables) && sys.core_system.deployables.includes(lid))
            return true;
        for (const tr of (sys?.traits ?? [])) {
            if (Array.isArray(tr?.deployables) && tr.deployables.includes(lid))
                return true;
        }
        return false;
    };

    // Owner-actor walk first.
    try {
        const ownerVal = deployableActor.system?.owner;
        const ownerUuid = typeof ownerVal === 'string' ? ownerVal : ownerVal?.id ?? null;
        if (ownerUuid) {
            const ownerActor = /** @type {any} */ (await fromUuid(ownerUuid));
            if (ownerActor?.items) {
                for (const item of ownerActor.items) {
                    if (itemHasDeployable(item))
                        return item;
                }
            }
        }
    } catch (e) { /* fall through */ }

    if (_sourceItemCache.has(lid))
        return _sourceItemCache.get(lid);

    // Compendium fallback. Restrict to item types that can hold deployables.
    const interestingTypes = new Set(['npc_feature', 'mech_system', 'weapon_mod', 'frame']);
    for (const pack of game.packs.filter(p => p.documentName === 'Item')) {
        const idx = await pack.getIndex({ fields: ['type', 'system.deployables', 'system.core_system.deployables', 'system.traits'] });
        const entry = idx.find(e => interestingTypes.has(e.type) && (
            (Array.isArray(e.system?.deployables) && e.system.deployables.includes(lid))
            || (Array.isArray(e.system?.core_system?.deployables) && e.system.core_system.deployables.includes(lid))
            || (Array.isArray(e.system?.traits) && e.system.traits.some(tr => Array.isArray(tr?.deployables) && tr.deployables.includes(lid)))
        ));
        if (entry) {
            const doc = await pack.getDocument(entry._id);
            if (doc) {
                _sourceItemCache.set(lid, doc);
                return doc;
            }
        }
    }
    _sourceItemCache.set(lid, null);
    return null;
}

Hooks.on('lancer-automations.clearCaches', () => {
    _compendiumDeployableCache.clear();
    _sourceItemCache.clear();
});

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
    if (!all.length)
        return null;
    if (ownerActor) {
        const owned = all.find(a => {
            const ownerVal = a.system?.owner;
            return ownerVal === ownerActor.uuid || ownerVal === ownerActor.id ||
                   ownerVal?.id === ownerActor.uuid || ownerVal?.id === ownerActor.id;
        });
        if (owned)
            return owned;
    }
    return all[0];
}

export function getDeployableInfoSync(lid, ownerActor = null) {
    if (!lid)
        return null;
    if (typeof lid === 'string' && /^Actor\.[A-Za-z0-9]+$/.test(lid)) {
        try {
            const doc = /** @type {any} */ (fromUuidSync(lid));
            if (doc?.documentName === 'Actor')
                return { name: doc.name, img: doc.img, activation: doc.system?.activation ?? null };
        } catch { /* fall through */ }
    }
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
    const elevationOffset = options.elevationOffset ?? itemFlags.deployElevationOffset ?? 0;

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

    const isDrone = (actor, item) => {
        if (actor?.system?.type === 'Drone')
            return true;
        const tagHas = (tags) => Array.isArray(tags)
            && tags.some(t => /drone/i.test(t?.lid ?? '') || /drone/i.test(t?.id ?? ''));
        return tagHas(actor?.system?.tags) || tagHas(item?.system?.tags);
    };

    // Resolve all deployables and build actor entries
    const actorEntries = [];
    let anyDrone = false;
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

        if (isDrone(actualDeployable, systemItem))
            anyDrone = true;

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

    const baseElevation = originToken?.document?.elevation ?? 0;
    const noExplicitRange = rangeOpt == null && itemFlags.deployRange == null;
    const finalRange = (noExplicitRange && anyDrone)
        ? (ownerActor.type === 'pilot' ? 5 : (ownerActor.system?.sensor_range ?? 10))
        : range;
    const result = await placeToken({
        actor: actorParam,
        range: finalRange,
        count,
        origin: originToken,
        title,
        description,
        icon: "cci cci-deployable",
        extraData: extraDataParam,
        noCard: noCard,
        disposition,
        team,
        elevation: baseElevation + elevationOffset
    });

    if (result && systemItem) {
        const updates = {};

        if (consumeUse) {
            const uses = systemItem.system?.uses;
            if (uses && typeof uses.value === 'number') {
                // Match Lancer 3.1.2+ behaviour: deduct the deploy action's cost (defaults to 1).
                const actions = systemItem.system?.actions ?? [];
                const deployAction = actions.find(/** @type {any} */ a => Array.isArray(a?.deployables) && a.deployables.length);
                const cost = Math.max(1, Number(deployAction?.cost) || 1);
                const minUses = uses.min ?? 0;
                updates["system.uses.value"] = Math.max(uses.value - cost, minUses);
            }
            if (systemItem.system?.charged) {
                updates["system.charged"] = false;
            }
            if (Object.keys(updates).length > 0) {
                await systemItem.update(updates);
            }
        }
    }

    // Play per-deployable FX on each deployed token (requires a source token).
    if (result && originToken) {
        const deployedTokens = Array.isArray(result) ? result : [result];
        for (const t of deployedTokens) {
            if (t)
                playDeployableFX(t);
        }
    }

    // Fire onDeploy trigger
    if (result) {
        await stampDeployableSource(result, systemItem);
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
 * @returns {Promise<void>}
 */
export async function deployDeployable(actor, deployableLid, parentItem, consumeUse) {
    const depInfo = getDeployableInfoSync(deployableLid, actor);
    const sceneId = canvas?.scene?.id;
    const tokens = actor.getActiveTokens?.() || [];
    const sourceToken = tokens.find(t => t?.scene?.id === sceneId) || tokens[0] || null;
    if (sourceToken && depInfo?.activation) {
        playActionFxByActivation(depInfo.activation, sourceToken, depInfo.name);
    }
    await _printDeployableCard(parentItem);
    const extraOpts = getExtraDeployableOpts(parentItem ?? actor, deployableLid) || {};
    await placeDeployable({
        deployable: deployableLid,
        ownerActor: actor,
        systemItem: parentItem,
        consumeUse: consumeUse ?? false,
        range: extraOpts.range ?? null,
        count: extraOpts.count ?? null,
    });
}

async function _printDeployableCard(parentItem) {
    if (!parentItem)
        return;
    const begin = game.lancer?.beginItemChatFlow;
    if (typeof begin !== 'function')
        return;
    try {
        await begin(parentItem, {});
    } catch (e) {
        console.warn('lancer-automations | Could not print deployable card:', e);
    }
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
        await setItemFlag(item, 'lancer-automations', key, val);
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
    for (const key of Object.keys(flags)) {
        await unsetItemFlag(item, 'lancer-automations', key);
    }
    return item;
}

/**
 * Add or update lancer-automations flags on an actor document.
 * @param {Actor} actor     The Foundry Actor document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Actor>} The updated actor
 */
export async function addActorFlags(actor, flags) {
    if (!actor || typeof flags !== 'object') {
        ui.notifications.error("addActorFlags: actor and flags object are required.");
        return null;
    }
    for (const [key, val] of Object.entries(flags)) {
        await setActorFlag(actor, 'lancer-automations', key, val);
    }
    return actor;
}

/**
 * Removes lancer-automations flags from an actor document.
 * @param {Actor} actor     The Foundry Actor document
 * @param {Object} flags    Object whose keys are flags to unset
 * @returns {Promise<Actor>} The updated actor
 */
export async function removeActorFlags(actor, flags) {
    if (!actor || typeof flags !== 'object') {
        ui.notifications.error("removeActorFlags: actor and flags object are required.");
        return null;
    }
    for (const key of Object.keys(flags)) {
        await unsetActorFlag(actor, 'lancer-automations', key);
    }
    return actor;
}

/**
 * Add or update lancer-automations flags on a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 */
export async function addTokenFlags(tokenOrDoc, flags) {
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object') {
        ui.notifications.error("addTokenFlags: token and flags object are required.");
        return null;
    }
    for (const [key, val] of Object.entries(flags)) {
        await setTokenFlag(td, 'lancer-automations', key, val);
    }
    return td;
}

/**
 * Remove lancer-automations flags from a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Object whose keys are flags to unset
 */
export async function removeTokenFlags(tokenOrDoc, flags) {
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object') {
        ui.notifications.error("removeTokenFlags: token and flags object are required.");
        return null;
    }
    for (const key of Object.keys(flags)) {
        await unsetTokenFlag(td, 'lancer-automations', key);
    }
    return td;
}

/**
 * Read lancer-automations flag(s) from a token document.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {string} [flagName] If omitted, returns the whole `lancer-automations` namespace object.
 */
export function getTokenFlags(tokenOrDoc, flagName = null) {
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td) {
        ui.notifications.error("getTokenFlags: token is required.");
        return null;
    }
    if (flagName)
        return td.getFlag('lancer-automations', flagName);
    return td.flags?.['lancer-automations'] || {};
}

function _resolveActor(target) {
    if (!target)
        return null;
    if (target.documentName === 'Actor')
        return target;
    return target.actor ?? target.document?.actor ?? null;
}

/** Lock a standard action on an actor. Source-tracked: stays locked until every source is removed. */
export async function lockActorAction(target, actionName, sourceId) {
    const actor = _resolveActor(target);
    if (!actor || !actionName || !sourceId) {
        ui.notifications.error("lockActorAction: actor, actionName and sourceId are required.");
        return null;
    }
    const current = /** @type {Record<string,string[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    const sources = Array.isArray(current[actionName]) ? current[actionName].slice() : [];
    if (!sources.includes(sourceId))
        sources.push(sourceId);
    await addActorFlags(actor, { lockedActions: { ...current, [actionName]: sources } });
    return actor;
}

/** Inverse of lockActorAction. Unlocks once every source has been removed. */
export async function unlockActorAction(target, actionName, sourceId) {
    const actor = _resolveActor(target);
    if (!actor || !actionName || !sourceId) {
        ui.notifications.error("unlockActorAction: actor, actionName and sourceId are required.");
        return null;
    }
    const current = /** @type {Record<string,string[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    const sources = Array.isArray(current[actionName]) ? current[actionName].filter(s => s !== sourceId) : [];
    const next = { ...current };
    if (sources.length)
        next[actionName] = sources;
    else
        delete next[actionName];
    await addActorFlags(actor, { lockedActions: next });
    return actor;
}

export function isActionLocked(target, actionName) {
    const actor = _resolveActor(target);
    if (!actor || !actionName)
        return false;
    const current = /** @type {Record<string,string[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    return Array.isArray(current[actionName]) && current[actionName].length > 0;
}

export function getLockedActions(target) {
    const actor = _resolveActor(target);
    if (!actor)
        return [];
    const current = /** @type {Record<string,string[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    return Object.keys(current).filter(k => Array.isArray(current[k]) && current[k].length > 0);
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
    // Multi-profile weapons (e.g. Dynamo Blade) keep per-profile actions here.
    const profileActions = item.system?.active_profile?.actions ?? [];
    const extraActions = item.getFlag?.('lancer-automations', 'extraActions') || [];
    return [...systemActions, ...profileActions, ...extraActions];
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
        // Dedup tag conflicts: any consumable tag on the action that already exists on the
        // parent item is stripped, with its state field, so item-level state stays the single
        // source of truth for that tag.
        const CONSUMABLE_LIDS = new Set(['tg_loading', 'tg_recharge', 'tg_limited']);
        const FIELD_FOR = { tg_loading: 'loaded', tg_recharge: 'charged', tg_limited: 'uses' };
        const itemTagLids = new Set(((doc.system?.tags ?? [])).map((/** @type {any} */ t) => t.lid));
        for (const action of newActions) {
            const a = /** @type {any} */ (action);
            if (Array.isArray(a.tags) && a.tags.length) {
                const dropped = [];
                a.tags = a.tags.filter((/** @type {any} */ t) => {
                    if (CONSUMABLE_LIDS.has(t.lid) && itemTagLids.has(t.lid)) {
                        dropped.push(t.lid);
                        const f = FIELD_FOR[t.lid];
                        if (f && f in a)
                            delete a[f];
                        if (t.lid === 'tg_recharge' && 'recharge' in a)
                            delete a.recharge;
                        return false;
                    }
                    return true;
                });
                if (dropped.length)
                    ui.notifications.warn(`Tag(s) ${dropped.join(', ')} already on ${doc.name}; removed from extra action "${a.name}".`);
            }
        }
        for (const action of newActions) {
            const a = /** @type {any} */ (action);
            if (!a._sourceItemId)
                a._sourceItemId = doc.id;
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

// Decrement / mark-spent the consumable state on an actor-level extra action. Returns true if
// the caller can proceed to execute, false if the action is depleted (caller should bail out).
export async function consumeExtraAction(actor, actionName) {
    if (!actor)
        return true;
    const all = actor.getFlag('lancer-automations', 'extraActions') || [];
    const idx = all.findIndex(a => a.name === actionName);
    if (idx < 0)
        return true;
    const entry = { ...all[idx] };
    const tags = entry.tags ?? [];
    const hasLoading = tags.some(t => t.lid === 'tg_loading');
    const hasRecharge = tags.some(t => t.lid === 'tg_recharge');
    const hasLimited = tags.some(t => t.lid === 'tg_limited');
    const hasPerTurn = tags.some(t => t.lid === 'tg_turn');
    const hasPerRound = tags.some(t => t.lid === 'tg_round');
    let needsWrite = false;

    if (hasLoading) {
        if (entry.loaded === false) {
            ui.notifications.warn(`${entry.name} is not loaded.`);
            return false;
        }
        entry.loaded = false;
        needsWrite = true;
    }
    if (hasRecharge) {
        if (entry.charged === false) {
            ui.notifications.warn(`${entry.name} is uncharged.`);
            return false;
        }
        entry.charged = false;
        needsWrite = true;
    }
    if (hasLimited) {
        const cur = entry.uses?.value ?? 0;
        if (cur <= 0) {
            ui.notifications.warn(`${entry.name} has no uses left.`);
            return false;
        }
        entry.uses = { ...entry.uses, value: cur - 1 };
        needsWrite = true;
    }
    if (hasPerTurn) {
        const cur = entry.usesPerTurn?.value ?? 0;
        if (cur <= 0) {
            ui.notifications.warn(`${entry.name}: per-turn limit reached.`);
            return false;
        }
        entry.usesPerTurn = { ...entry.usesPerTurn, value: cur - 1 };
        needsWrite = true;
    }
    if (hasPerRound) {
        const cur = entry.usesPerRound?.value ?? 0;
        if (cur <= 0) {
            ui.notifications.warn(`${entry.name}: per-round limit reached.`);
            return false;
        }
        entry.usesPerRound = { ...entry.usesPerRound, value: cur - 1 };
        needsWrite = true;
    }

    if (needsWrite) {
        const next = all.slice();
        next[idx] = entry;
        await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    return true;
}

// Reset the consumable state on a single actor-level extra action.
export async function reloadExtraAction(actor, actionName) {
    if (!actor)
        return;
    const all = actor.getFlag('lancer-automations', 'extraActions') || [];
    const idx = all.findIndex(a => a.name === actionName);
    if (idx < 0)
        return;
    const entry = { ...all[idx] };
    const tags = entry.tags ?? [];
    let changed = false;
    if (tags.some(t => t.lid === 'tg_loading') && entry.loaded !== true) {
        entry.loaded = true;
        changed = true;
    }
    if (tags.some(t => t.lid === 'tg_recharge') && entry.charged !== true) {
        entry.charged = true;
        changed = true;
    }
    if (tags.some(t => t.lid === 'tg_limited') && entry.uses?.max != null && entry.uses?.value !== entry.uses.max) {
        entry.uses = { ...entry.uses, value: entry.uses.max };
        changed = true;
    }
    if (entry.usesPerTurn?.max != null && entry.usesPerTurn?.value !== entry.usesPerTurn.max) {
        entry.usesPerTurn = { ...entry.usesPerTurn, value: entry.usesPerTurn.max };
        changed = true;
    }
    if (entry.usesPerRound?.max != null && entry.usesPerRound?.value !== entry.usesPerRound.max) {
        entry.usesPerRound = { ...entry.usesPerRound, value: entry.usesPerRound.max };
        changed = true;
    }
    if (changed) {
        const next = all.slice();
        next[idx] = entry;
        await actor.setFlag('lancer-automations', 'extraActions', next);
    }
}

// Per-extra-deployable range/count overrides. Keyed by LID or UUID, stored on whatever document
// holds the extras (Item or Actor). When set, these override the item-level deployRange / deployCount
// flags for that specific deployable.
// Foundry setFlag treats dots in object keys as nested paths; encode them so UUIDs (which contain dots) stay flat.
function _encodeOptsKey(key) {
    return String(key).replace(/\./g, '$DOT$');
}

export function getExtraDeployableOpts(target, key) {
    if (!target || !key)
        return null;
    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);
    const map = doc.getFlag?.('lancer-automations', 'extraDeployableOpts') || {};
    return map[_encodeOptsKey(key)] ?? null;
}

export async function setExtraDeployableOpts(target, key, opts) {
    if (!target || !key)
        return null;
    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);
    const map = { ...(doc.getFlag?.('lancer-automations', 'extraDeployableOpts') || {}) };
    const encoded = _encodeOptsKey(key);
    const cur = { ...map[encoded] };
    for (const [k, v] of Object.entries(opts || {})) {
        if (v == null || v === '')
            delete cur[k];
        else
            cur[k] = v;
    }
    if (Object.keys(cur).length === 0)
        delete map[encoded];
    else
        map[encoded] = cur;
    await doc.setFlag('lancer-automations', 'extraDeployableOpts', map);
    return doc;
}

// Roll recharge dice for any uncharged extras action with tg_recharge — both on the actor and on
// any of its items. Mirrors NPCRechargeFlow semantics: 1d6, charged if roll >= entry.recharge.
export async function rechargeExtraActionsForActor(actor) {
    if (!actor)
        return;
    const rollFor = (list) => {
        let mutated = false;
        const next = list.map(entry => {
            let e = entry;
            const tags = entry?.tags ?? [];
            if (tags.some(t => t.lid === 'tg_recharge') && e.charged === false) {
                const threshold = Number(e.recharge ?? 6);
                if (1 + Math.floor(Math.random() * 6) >= threshold) {
                    e = { ...e, charged: true };
                    mutated = true;
                }
            }
            // Per-turn usage resets at the actor's turn start.
            if (e.usesPerTurn?.max != null && e.usesPerTurn.value !== e.usesPerTurn.max) {
                e = { ...e, usesPerTurn: { ...e.usesPerTurn, value: e.usesPerTurn.max } };
                mutated = true;
            }
            return e;
        });
        return { next, mutated };
    };
    const actorList = actor.getFlag('lancer-automations', 'extraActions') || [];
    if (actorList.length) {
        const { next, mutated } = rollFor(actorList);
        if (mutated)
            await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    for (const item of (actor.items ?? [])) {
        const itemList = item.getFlag?.('lancer-automations', 'extraActions') || [];
        if (!itemList.length)
            continue;
        const { next, mutated } = rollFor(itemList);
        if (mutated)
            await item.setFlag('lancer-automations', 'extraActions', next);
    }
}

// Reset per-round usage (tg_round) on an actor's + items' extra actions. Called at round start.
export async function resetPerRoundExtraActionsForActor(actor) {
    if (!actor)
        return;
    const resetList = (list) => {
        let mutated = false;
        const next = list.map(entry => {
            if (entry?.usesPerRound?.max != null && entry.usesPerRound.value !== entry.usesPerRound.max) {
                mutated = true;
                return { ...entry, usesPerRound: { ...entry.usesPerRound, value: entry.usesPerRound.max } };
            }
            return entry;
        });
        return { next, mutated };
    };
    const actorList = actor.getFlag('lancer-automations', 'extraActions') || [];
    if (actorList.length) {
        const { next, mutated } = resetList(actorList);
        if (mutated)
            await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    for (const item of (actor.items ?? [])) {
        const itemList = item.getFlag?.('lancer-automations', 'extraActions') || [];
        if (!itemList.length)
            continue;
        const { next, mutated } = resetList(itemList);
        if (mutated)
            await item.setFlag('lancer-automations', 'extraActions', next);
    }
}

/**
 * Add extra deployable LIDs to an item, actor, or token via flags.
 * - Item: stores on item (system.deployables is read-only).
 * - Token/Actor: stores on the actor.
 * @param {Item|Actor|Token} target     The document to attach LIDs to
 * @param {string|Array<string>} lids   A single LID string or array of LID strings to add
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraDeploymentLids(target, lids) {
    if (!target) {
        ui.notifications.error("addExtraDeploymentLids: target is required.");
        return null;
    }
    const newLids = Array.isArray(lids) ? lids : [lids];
    if (newLids.length === 0 || newLids.some(l => typeof l !== 'string')) {
        ui.notifications.error("addExtraDeploymentLids: lids must be a string or array of strings.");
        return null;
    }

    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);

    const existingFlags = doc.getFlag('lancer-automations', 'extraDeployables') || [];
    const merged = [...new Set([...existingFlags, ...newLids])];

    // Skip if nothing new to add
    if (merged.length === existingFlags.length) {
        return doc;
    }

    await doc.setFlag('lancer-automations', 'extraDeployables', merged);
    console.log(`lancer-automations | addExtraDeploymentLids: Added LID(s) to ${doc.name}:`, newLids);
    return doc;
}

/**
 * Add extra deployable actors (by reference or UUID) to an item, actor, or token via flags.
 * Mirrors addExtraDeploymentLids but stores actor UUIDs under 'lancer-automations.extraDeployableActors'.
 * @param {Item|Actor|Token} target                       The document to attach the deployables to
 * @param {any|string|Array<any|string>} actors           Actor doc, UUID string, or array of either
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraDeploymentActor(target, actors) {
    if (!target) {
        ui.notifications.error("addExtraDeploymentActor: target is required.");
        return null;
    }
    const inputs = Array.isArray(actors) ? actors : [actors];
    if (inputs.length === 0) {
        ui.notifications.error("addExtraDeploymentActor: actors must be an Actor, UUID, or array of them.");
        return null;
    }

    // Normalize to UUIDs, validating each input resolves to a deployable actor.
    const validUuids = [];
    for (const input of inputs) {
        if (!input)
            continue;
        let uuid = null;
        let resolved = null;
        if (typeof input === 'string') {
            uuid = input;
            try {
                resolved = /** @type {any} */ (await fromUuid(uuid));
            } catch { /* invalid uuid string */ }
        } else if (typeof input === 'object' && input?.uuid) {
            uuid = input.uuid;
            resolved = input;
        }
        if (!uuid || resolved?.documentName !== 'Actor') {
            ui.notifications.warn(`addExtraDeploymentActor: skipping non-actor input: ${typeof input === 'string' ? input : input?.name}`);
            continue;
        }
        validUuids.push(uuid);
    }
    if (validUuids.length === 0)
        return null;

    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);

    const existing = doc.getFlag('lancer-automations', 'extraDeployableActors') || [];
    const merged = [...new Set([...existing, ...validUuids])];

    if (merged.length === existing.length)
        return doc;

    await doc.setFlag('lancer-automations', 'extraDeployableActors', merged);
    console.log(`lancer-automations | addExtraDeploymentActor: Added actor UUID(s) to ${doc.name}:`, validUuids);
    return doc;
}

/**
 * Remove extra deployable actor UUIDs from an item, actor, or token via flags.
 * Also strips matching entries from the sibling `extraDeployableActorsViaUI` marker flag if present.
 * @param {Item|Actor|Token} target
 * @param {any|string|Array<any|string>} actors  Actor doc, UUID string, or array of either
 * @returns {Promise<Item|Actor|null>}
 */
export async function removeExtraDeploymentActor(target, actors) {
    if (!target)
        return null;
    const inputs = Array.isArray(actors) ? actors : [actors];
    const removeUuids = inputs
        .map(i => typeof i === 'string' ? i : i?.uuid)
        .filter(Boolean);
    if (removeUuids.length === 0)
        return null;
    const removeSet = new Set(removeUuids);

    const t = /** @type {any} */ (target);
    const doc = (t.documentName === 'Item') ? t : (t.actor ?? t.document ?? t);

    const existing = doc.getFlag('lancer-automations', 'extraDeployableActors') || [];
    const kept = existing.filter(u => !removeSet.has(u));
    let mutated = kept.length !== existing.length;
    if (mutated)
        await doc.setFlag('lancer-automations', 'extraDeployableActors', kept);

    const uiMarkers = doc.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
    const keptMarkers = uiMarkers.filter(u => !removeSet.has(u));
    if (keptMarkers.length !== uiMarkers.length) {
        await doc.setFlag('lancer-automations', 'extraDeployableActorsViaUI', keptMarkers);
        mutated = true;
    }

    if (mutated)
        console.log(`lancer-automations | removeExtraDeploymentActor: Removed actor UUID(s) from ${doc.name}:`, [...removeSet]);
    return doc;
}

/**
 * Pick a token on the canvas to toggle its owner-link to `ownerToken.actor`.
 * Sets/removes the `lancer-automations.ownerActorUuid` (+ ownerName) flag on the picked token's
 * document — the same flag `placeDeployable` writes and `recallDeployable` reads.
 * Already-linked tokens are marked invalid in the picker (with a "click to UNLINK" warning).
 * @param {Token} ownerToken
 * @returns {Promise<void>}
 */
export async function promptLinkOrUnlinkActor(ownerToken) {
    const owner = ownerToken?.actor;
    if (!owner) {
        ui.notifications.warn("promptLinkOrUnlinkActor: token has no actor.");
        return;
    }
    const ownerUuid = owner.uuid;
    const isLinkedToOwner = (/** @type {any} */ t) =>
        t?.document?.getFlag?.('lancer-automations', 'ownerActorUuid') === ownerUuid;

    const picked = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        title: 'LINK / UNLINK ACTOR',
        description: 'Pick a token to link. Already-linked tokens will be unlinked.',
        icon: 'cci cci-deployable',
        filter: (/** @type {any} */ t) => !isLinkedToOwner(t),
        filterWarning: 'Already linked — click to UNLINK',
    });
    const target = picked?.[0];
    if (!target?.document)
        return;
    if (isLinkedToOwner(target)) {
        await target.document.unsetFlag('lancer-automations', 'ownerActorUuid');
        await target.document.unsetFlag('lancer-automations', 'ownerName');
        ui.notifications.info(`Unlinked ${target.actor?.name ?? target.name} from ${owner.name}.`);
    } else {
        await target.document.setFlag('lancer-automations', 'ownerActorUuid', ownerUuid);
        await target.document.setFlag('lancer-automations', 'ownerName', owner.name ?? '');
        ui.notifications.info(`Linked ${target.actor?.name ?? target.name} to ${owner.name}.`);
    }
}

/**
 * Read extra deployable LIDs + actor UUIDs stored on an actor (or the actor under a token).
 * Used to surface "loose" deployables not tied to any item.
 * @param {Actor|Token} tokenOrActor
 * @returns {string[]} LIDs and UUIDs intermixed.
 */
export function getActorDeployables(tokenOrActor) {
    if (!tokenOrActor)
        return [];
    const t = /** @type {any} */ (tokenOrActor);
    const doc = t.actor ?? t.document ?? t;
    return [
        ...(doc.getFlag?.('lancer-automations', 'extraDeployables') || []),
        ...(doc.getFlag?.('lancer-automations', 'extraDeployableActors') || []),
    ];
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
    const extraDeployableActors = item.getFlag?.('lancer-automations', 'extraDeployableActors') || [];
    let deployablesArray = [...systemDeployables, ...extraDeployables, ...extraDeployableActors];

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
 * Retrieve lancer-automations flags from an actor document.
 * @param {Actor} actor        The Foundry Actor document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or all lancer-automations flags if no key was provided.
 */
export function getActorFlags(actor, flagName = null) {
    if (!actor) {
        ui.notifications.error("getActorFlags: actor is required.");
        return null;
    }
    if (flagName) {
        return actor.getFlag('lancer-automations', flagName);
    }
    return actor.flags?.['lancer-automations'] || {};
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

    // Read per-index options for range and count; use the first range found, sum all counts.
    // Per-deployable extra opts (set via setExtraDeployableOpts) act as the next fallback.
    let rangeOpt = null;
    for (let i = 0; i < deployablesArray.length; i++) {
        const lid = deployablesArray[i];
        const idxOpts = deployableOptions[i] || {};
        const extraOpts = getExtraDeployableOpts(item, lid) || {};
        const depCount = idxOpts.count ?? extraOpts.count ?? 1;
        totalCount += depCount;
        const effectiveRange = idxOpts.range !== undefined ? idxOpts.range : extraOpts.range;
        if (effectiveRange !== undefined && rangeOpt === null)
            rangeOpt = effectiveRange;
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
    const actorLevelDeployables = getActorDeployables(actor);

    if (allSystemsWithDeployables.length === 0 && actorLevelDeployables.length === 0) {
        ui.notifications.warn(`No deployables found for ${actor.name}.`);
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

    for (const lid of actorLevelDeployables) {
        const { deployable, source } = await resolveDeployable(lid, actor);
        if (deployable) {
            const isFromCompendium = source === 'compendium';
            items.push({
                id: `__actor_${lid}`,
                systemId: null,
                deployableId: deployable.id,
                deployableLid: lid,
                systemName: 'Extra Deployables',
                deployableName: deployable.name,
                deployableImg: deployable.img,
                deployableData: deployable,
                usesText: '',
                chargesText: '',
                disabled: false,
                needsRecharge: false,
                hasUses: false,
                fromCompendium: isFromCompendium,
                tokenWidth: deployable.prototypeToken?.width || 1,
                tokenHeight: deployable.prototypeToken?.height || 1
            });
        } else {
            items.push({
                id: `__actor_${lid}`,
                systemId: null,
                deployableId: null,
                deployableLid: lid,
                systemName: 'Extra Deployables',
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
                <div class="lancer-dialog-title">DEPLOY ACTORS</div>
                <div class="lancer-dialog-subtitle">Select an actor to place on the battlefield.</div>
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
        title: "Deploy Actors",
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
                    const system = item.systemId ? actor.items.get(item.systemId) : null;
                    const holder = system ?? actor;
                    const extraOpts = getExtraDeployableOpts(holder, item.deployableLid) || {};

                    await placeDeployable({
                        deployable: item.fromCompendium ? item.deployableData : game.actors.get(item.deployableId),
                        ownerActor: actor,
                        systemItem: system,
                        consumeUse: item.hasUses,
                        fromCompendium: item.fromCompendium,
                        width: item.tokenWidth,
                        height: item.tokenHeight,
                        range: extraOpts.range ?? null,
                        count: extraOpts.count ?? null,
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
 * Returns true if the actor (mech / pilot / npc / deployable) has any item whose LID matches.
 * Accepts a single LID string or an array of LIDs (any-match).
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {string|string[]} lidOrLids
 * @returns {boolean}
 */
export function hasItem(actorOrToken, lidOrLids) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items || !lidOrLids)
        return false;
    const lids = Array.isArray(lidOrLids) ? lidOrLids : [lidOrLids];
    if (lids.length === 0)
        return false;
    return actor.items.some(i => lids.includes(i.system?.lid));
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
        const token = (/** @type {any} */ (actorOrToken))?.actor
            ? /** @type {any} */ (actorOrToken)
            : actor.getActiveTokens?.()?.[0];
        if (token)
            playReloadFX(token);
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
        if (item.type === 'mech_weapon' || item.type === 'pilot_weapon')
            return false;
        if (item.system?.type?.toLowerCase() === 'weapon')
            return false;
        const sys = item.system;
        const tags = [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])];
        const hasLimited = tags.some(t => t.lid === 'tg_limited');
        const hasRecharge = tags.some(t => t.lid === 'tg_recharge');
        if (hasLimited) {
            const val = typeof sys.uses === 'number' ? sys.uses : (sys.uses?.value ?? 0);
            if (val <= 0)
                return true;
        }
        if (hasRecharge && sys.charged === false)
            return true;
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

    if (!chosen)
        return null;

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
export async function handleManualDeployLink(tokenDocument, { force = false } = {}) {
    if (!force && !game.settings.get('lancer-automations', 'linkManualDeploy'))
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

    const allTokens = canvas.tokens?.placeables ?? [];
    let ownerToken = null;
    let ownerActor = null;

    // For mech/pilot deployables: use the deployable's system.owner to find the owning actor directly
    const ownerUuidRaw = deployableActor.system?.owner;
    const ownerUuid = typeof ownerUuidRaw === 'string'
        ? ownerUuidRaw
        : (typeof ownerUuidRaw?.uuid === 'string' ? ownerUuidRaw.uuid : null);
    const directOwner = ownerUuid ? await fromUuid(ownerUuid) : null;
    if (directOwner && (directOwner.type === 'mech' || directOwner.type === 'pilot')) {
        ownerActor = directOwner;
        ownerToken = allTokens.find(t => t.actor?.uuid === directOwner.uuid) ?? null;
        if (!ownerToken) {
            // Owner has no token on this scene — don't link
            return;
        }
    } else {
        // NPC path: filter scene tokens whose actor owns an item producing this LID
        const candidateTokens = allTokens.filter(t => {
            if (t.document.id === tokenDocument.id)
                return false;
            if (!t.actor)
                return false;
            return t.actor.items.some(item => getItemDeployables(item, t.actor).includes(deployableLid));
        });

        if (candidateTokens.length === 0)
            return;

        if (candidateTokens.length === 1) {
            ownerToken = candidateTokens[0];
        } else {
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
        }
        ownerActor = ownerToken.actor;
    }

    const ownerName = ownerActor.name ?? "";

    const candidateItems = ownerActor.items.filter(item =>
        getItemDeployables(item, ownerActor).includes(deployableLid)
    );
    let systemItem = null;
    if (candidateItems.length === 1) {
        systemItem = candidateItems[0];
    } else if (candidateItems.length > 1) {
        systemItem = await pickItem(candidateItems, {
            title: "LINK DEPLOYABLE",
            description: `Which item deployed ${deployableActor.name}?`,
            icon: "cci cci-deployable",
            relatedToken: ownerToken
        });
    }

    // Stamp ownership flags onto the token
    await tokenDocument.update({
        flags: {
            'lancer-automations': {
                deployedItem: true,
                deployableName: deployableActor.name,
                deployableId: deployableActor.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName,
                systemItemId: systemItem?.id ?? null,
                sourceItemUuid: systemItem?.uuid ?? null
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
