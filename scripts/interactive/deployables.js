/* global canvas, PIXI, game, ui, $, Dialog, fromUuid */

import {
    placeToken, chooseToken, gridLineWidth
} from "./canvas.js";

import { startChoiceCard } from "./network.js";
import { setActorFlag, unsetActorFlag, setItemFlag, unsetItemFlag, setTokenFlag, unsetTokenFlag } from "../socket.js";
import { playActionFxByActivation, playDeployableFX, playReloadFX } from "../fx/actionFX.js";
import { stripDeployOwner } from "./detail-renderers.js";

import {
    isHexGrid, getOccupiedOffsets, drawHexAt
} from "../combat/grid-helpers.js";

import { applyActionOverlays } from "./action-overlays.js";
import { itemAllTags } from "../combat/per-frequency-tags.js";
import { getItemActionLocks, lockEntryId } from "../combat/action-limits.js";

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
export async function deployWeaponToken(weapon, ownerActor, originToken = null, options = {})
{
    const {
        range = 1,
        title = "DEPLOY WEAPON",
        description = "",
        at = null
    } = options;

    const templateName = "Template Throw";
    let templateActor = game.actors.contents.find((/** @type {any} */ actor) =>
        actor.name === templateName && actor.type === 'deployable'
    );

    if (!templateActor)
    {
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

        if (!templateActor)
        {
            ui.notifications.error("Failed to create Template Throw actor.");
            return null;
        }
    }

    let ownerName = /** @type {string} */ (ownerActor.name || "");
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved")
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;

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
        onSpawn: async () =>
        {
            await weapon.update(/** @type {any} */({ 'system.disabled': true }));
        }
    });

    if (result)
    {
        await stampDeployableSource(result, weapon);
        const api = game.modules.get('lancer-automations')?.api;
        if (api?.handleTrigger)
        {
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
export async function spawnHardCover(originToken, options = {})
{
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

    let templateActor = game.actors.contents.find((/** @type {any} */ actor) =>
        actor.name === templateName && actor.type === 'deployable'
    );

    if (!templateActor)
    {
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

        if (!templateActor)
        {
            ui.notifications.error("Failed to create Template Hard Cover actor.");
            return null;
        }
    }

    // Ensure stats.hp is correct: Lancer derives hp.max from stats.hp, not hp.max directly
    const _templateActor = /** @type {any} */ (templateActor);
    if (_templateActor.system?.stats?.hp !== 10)
        await _templateActor.update({ "system.stats.hp": 10, "system.hp.value": 10, "system.hp.max": 10 });

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
    // Override size and HP on the token's synthetic actor via delta
    if (size !== 1)
    {
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
export async function pickupWeaponToken(ownerToken)
{
    if (!ownerToken?.actor)
    {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const thrownTokens = canvas.tokens.placeables.filter(token =>
    {
        const flags = token.document.flags?.['lancer-automations'];
        return flags?.thrownWeapon && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (thrownTokens.length === 0)
    {
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

    if (game.user.isGM)
    {
        const weapon = ownerActor.items.get(weaponId);
        if (weapon)
            await weapon.update(/** @type {any} */({ 'system.disabled': false }));
        await pickedToken.document.delete();
    }
    else
    {
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

// Unlinked tokens share a base actor and the deployable stores the base uuid, so match the base too or a 2nd token of the same NPC makes a duplicate.
function _deployableOwnerMatches(ownerVal, ownerActor)
{
    if (!ownerActor)
        return false;
    const ownerId = typeof ownerVal === 'string' ? ownerVal : ownerVal?.id;
    if (!ownerId)
        return false;
    const base = ownerActor.token?.baseActor ?? ownerActor;
    return ownerId === ownerActor.uuid || ownerId === ownerActor.id ||
        ownerId === base.uuid || ownerId === base.id;
}

/**
 * Resolve a deployable actor from either a direct reference or a LID string.
 * Searches actor folder (owned by the given actor) first, then compendiums.
 * @param {Actor|string} deployableOrLid - A deployable Actor or a LID string (e.g. "dep_turret")
 * @param {Actor} ownerActor - The actor that owns the deployable (used for folder search)
 * @returns {Promise<{deployable: Actor|null, source: string|null}>} The deployable and its source ('actor', 'compendium', or null)
 */
export async function resolveDeployable(deployableOrLid, ownerActor)
{
    if (typeof deployableOrLid !== 'string')
    {
        if (deployableOrLid)
            return { deployable: deployableOrLid, source: 'actor' };
        return { deployable: null, source: null };
    }
    const lid = deployableOrLid;
    if (!lid)
        return { deployable: null, source: null };

    // UUID-shaped string: try fromUuid first (e.g. "Actor.abc", "Compendium.pack.Actor.id").
    if (lid.startsWith('Compendium.') || /^Actor\.[A-Za-z0-9]+$/.test(lid))
    {
        try
        {
            const doc = /** @type {any} */ (await fromUuid(lid));
            if (doc?.documentName === 'Actor')
            {
                return {
                    deployable: doc,
                    source: lid.startsWith('Compendium.') ? 'compendium' : 'actor'
                };
            }
        }
        catch
        { /* fall through to LID search */ }
    }

    let deployable = /** @type {Actor} */(game.actors.contents.find((/** @type {any} */ actor) =>
    {
        if (actor.type !== 'deployable' || actor.system?.lid !== lid)
            return false;
        return _deployableOwnerMatches(actor.system?.owner, ownerActor);
    }));

    if (deployable)
        return { deployable, source: 'actor' };

    for (const pack of game.packs.filter(pack => pack.documentName === 'Actor'))
    {
        const index = await pack.getIndex();
        const entry = index.find(indexEntry => indexEntry.system?.lid === lid);

        if (entry)
        {
            deployable = await pack.getDocument(entry._id);
            if (deployable?.type === 'deployable')
                return { deployable, source: 'compendium' };
        }
    }

    return { deployable: null, source: null };
}

/**
 * Compendium-only deployable finder. Skips world actors, for callers that need the
 * canonical template rather than an existing instance.
 * Cached for the session, cleared on the `lancer-automations.clearCaches` hook.
 * @param {string} lid e.g. "dep_moonlight_drone"
 * @returns {Promise<Actor|null>}
 */
const _compendiumDeployableCache = new Map();
export async function findDeployableInCompendium(lid)
{
    if (!lid)
        return null;
    if (_compendiumDeployableCache.has(lid))
        return _compendiumDeployableCache.get(lid);
    for (const pack of game.packs.filter(pack => pack.documentName === 'Actor'))
    {
        const index = await pack.getIndex();
        const entry = index.find(indexEntry => indexEntry.system?.lid === lid);
        if (!entry)
            continue;
        const doc = await pack.getDocument(entry._id);
        if (doc?.type === 'deployable')
        {
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
async function stampDeployableSource(tokens, sourceItem)
{
    const uuid = sourceItem?.uuid;
    if (!uuid)
        return;
    const tokenList = Array.isArray(tokens) ? tokens : (tokens ? [tokens] : []);
    for (const token of tokenList)
    {
        const doc = token?.document ?? token;
        if (!doc?.update)
            continue;
        try
        {
            await doc.update({ 'flags.lancer-automations.sourceItemUuid': uuid });
        }
        catch (error)
        {
            console.warn('lancer-automations | stampDeployableSource failed:', error);
        }
    }
}

/**
 * Resolve the item that a deployable actor originated from. Walks the owner actor's
 * items for one whose `system.deployables[]` contains the deployable LID, then falls
 * back to scanning Item compendiums (npc_feature, mech_system, weapon_mod, frame).
 * Frames also walk `core_system.deployables` and `traits[].deployables`.
 * Cached by deployable LID, cleared on `lancer-automations.clearCaches`.
 * @param {Actor} deployableActor
 * @returns {Promise<Item|null>}
 */
const _sourceItemCache = new Map();
export async function resolveDeployableSourceItem(deployableActor)
{
    if (deployableActor?.type !== 'deployable')
        return null;
    const lid = deployableActor.system?.lid;
    if (!lid)
        return null;

    // Flag stamped at deploy time identifies the exact source item.
    try
    {
        const tokens = deployableActor.getActiveTokens?.() ?? [];
        for (const token of tokens)
        {
            const uuid = token?.document?.flags?.['lancer-automations']?.sourceItemUuid;
            if (uuid)
            {
                const item = await fromUuid(uuid);
                if (item)
                    return item;
            }
        }
    }
    catch (error)
    { /* fall through */ }

    const itemHasDeployable = (item) =>
    {
        if (!item)
            return false;
        const sys = item.system;
        if (Array.isArray(sys?.deployables) && sys.deployables.includes(lid))
            return true;
        if (Array.isArray(sys?.core_system?.deployables) && sys.core_system.deployables.includes(lid))
            return true;
        for (const tr of (sys?.traits ?? []))
        {
            if (Array.isArray(tr?.deployables) && tr.deployables.includes(lid))
                return true;
        }
        return false;
    };

    try
    {
        const ownerVal = deployableActor.system?.owner;
        const ownerUuid = typeof ownerVal === 'string' ? ownerVal : ownerVal?.id ?? null;
        if (ownerUuid)
        {
            const ownerActor = /** @type {any} */ (await fromUuid(ownerUuid));
            if (ownerActor?.items)
            {
                for (const item of ownerActor.items)
                {
                    if (itemHasDeployable(item))
                        return item;
                }
            }
        }
    }
    catch (error)
    { /* fall through */ }

    if (_sourceItemCache.has(lid))
        return _sourceItemCache.get(lid);

    // Compendium fallback. Restrict to item types that can hold deployables.
    const interestingTypes = new Set(['npc_feature', 'mech_system', 'weapon_mod', 'frame']);
    for (const pack of game.packs.filter(pack => pack.documentName === 'Item'))
    {
        const idx = await pack.getIndex({ fields: ['type', 'system.deployables', 'system.core_system.deployables', 'system.traits'] });
        const entry = idx.find(indexEntry => interestingTypes.has(indexEntry.type) && (
            (Array.isArray(indexEntry.system?.deployables) && indexEntry.system.deployables.includes(lid))
            || (Array.isArray(indexEntry.system?.core_system?.deployables) && indexEntry.system.core_system.deployables.includes(lid))
            || (Array.isArray(indexEntry.system?.traits) && indexEntry.system.traits.some(tr => Array.isArray(tr?.deployables) && tr.deployables.includes(lid)))
        ));
        if (entry)
        {
            const doc = await pack.getDocument(entry._id);
            if (doc)
            {
                _sourceItemCache.set(lid, doc);
                return doc;
            }
        }
    }
    _sourceItemCache.set(lid, null);
    return null;
}

Hooks.on('lancer-automations.clearCaches', () =>
{
    _compendiumDeployableCache.clear();
    _sourceItemCache.clear();
});

/**
 * Cache lid -> { name, img }, filled lazily by `getDeployableInfo`.
 * @type {Map<string, { name: string, img: string, activation: string | null } | null>}
 */
const _deployableInfoCache = new Map();

function _findWorldDeployable(lid, ownerActor)
{
    const all = /** @type {any[]} */ (game.actors?.contents ?? []).filter(
        actor => actor.type === 'deployable' && actor.system?.lid === lid
    );
    if (!all.length)
        return null;
    if (ownerActor)
    {
        const owned = all.find(actor => _deployableOwnerMatches(actor.system?.owner, ownerActor));
        if (owned)
            return owned;
    }
    return all[0];
}

/**
 * Synchronous read from the deployable info cache (populated by `getDeployableInfo`).
 * Returns null if not yet cached, call `getDeployableInfo` first to warm it.
 * @param {string} lid
 * @returns {{ name: string, img: string, activation: string | null } | null}
 */
export function getDeployableInfoSync(lid, ownerActor = null)
{
    if (!lid)
        return null;
    if (typeof lid === 'string' && /^Actor\.[A-Za-z0-9]+$/.test(lid))
    {
        try
        {
            const doc = /** @type {any} */ (fromUuidSync(lid));
            if (doc?.documentName === 'Actor')
                return { name: doc.name, img: doc.img, activation: doc.system?.activation ?? null, type: doc.system?.type ?? null };
        }
        catch
        { /* fall through */ }
    }
    const worldActor = _findWorldDeployable(lid, ownerActor);
    if (worldActor)
        return { name: worldActor.name, img: worldActor.img, activation: worldActor.system?.activation ?? null, type: worldActor.system?.type ?? null };
    return _deployableInfoCache.get(lid) ?? null;
}

/**
 * Get the name and img for a deployable LID.
 * Checks world actors first (sync), then the cache, then async-resolves from compendium and caches.
 * Returns a plain `{ name, img }` object, never the full Actor to keep it lightweight.
 *
 * @param {string} lid
 * @param {any} [ownerActor] - Used by resolveDeployable for folder search
 * @returns {Promise<{ name: string, img: string, activation: string | null } | null>}
 */
export async function getDeployableInfo(lid, ownerActor = null)
{
    if (!lid)
        return null;
    // World actor takes priority: most accurate, no cache needed
    const worldActor = _findWorldDeployable(lid, ownerActor);
    if (worldActor)
        return { name: worldActor.name, img: worldActor.img, activation: worldActor.system?.activation ?? null, type: worldActor.system?.type ?? null };
    if (_deployableInfoCache.has(lid))
        return _deployableInfoCache.get(lid);
    const resolved = await resolveDeployable(lid, ownerActor);
    const info = resolved.deployable
        ? { name: resolved.deployable.name, img: resolved.deployable.img, activation: resolved.deployable.system?.activation ?? null, type: resolved.deployable.system?.type ?? null }
        : null;
    _deployableInfoCache.set(lid, info);
    return info;
}

function _applyDeployableTypeImage(actorData)
{
    const type = String(actorData?.system?.type ?? '');
    const typeImg = /mine/i.test(type) ? 'systems/lancer/assets/icons/mine.svg'
        : /drone/i.test(type) ? 'systems/lancer/assets/icons/drone.svg'
            : null;
    if (!typeImg)
        return;
    actorData.img = typeImg;
    actorData.prototypeToken = actorData.prototypeToken || {};
    actorData.prototypeToken.texture = { ...(actorData.prototypeToken.texture ?? {}), src: typeImg };
    actorData.prototypeToken.img = typeImg;
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
export async function placeDeployable(options = /** @type {any} */({}))
{
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

    const itemFlags = systemItem ? getItemFlags(systemItem) : {};
    const range = rangeOpt ?? itemFlags.deployRange ?? 1;
    const count = countOpt ?? itemFlags.deployCount ?? 1;
    const elevationOffset = options.elevationOffset ?? itemFlags.deployElevationOffset ?? 0;

    if (!ownerActor)
    {
        ui.notifications.error("No owner actor specified.");
        return null;
    }

    let ownerName = /** @type {string} */ (ownerActor.name || "");
    if (ownerActor.is_mech?.() && ownerActor.system.pilot?.status === "resolved")
        ownerName = ownerActor.system.pilot.value.system.callsign || ownerActor.system.pilot.value.name;

    const disposition = dispositionOpt ?? ownerActor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    let team = teamOpt;
    if (team === null || team === undefined)
        team = game.modules.get('token-factions')?.active ? ownerActor.getFlag('token-factions', 'team') : null;
    team = team ?? null;

    const originToken = at || ownerActor.getActiveTokens()?.[0] || null;

    const deployableInputs = Array.isArray(deployableOrLid) ? deployableOrLid : [deployableOrLid];

    const isDrone = (actor, item) =>
    {
        if (actor?.system?.type === 'Drone')
            return true;
        const tagHas = (tags) => Array.isArray(tags)
            && tags.some(tag => /drone/i.test(tag?.lid ?? '') || /drone/i.test(tag?.id ?? ''));
        return tagHas(actor?.system?.tags) || tagHas(item?.system?.tags);
    };

    const actorEntries = [];
    let anyDrone = false;
    for (const input of deployableInputs)
    {
        const resolved = await resolveDeployable(input, ownerActor);
        let actualDeployable = resolved.deployable;
        const isFromCompendium = fromCompendium || resolved.source === 'compendium';

        if (!actualDeployable)
        {
            ui.notifications.warn(`Deployable not found: ${input}`);
            continue;
        }

        if (isFromCompendium)
        {
            const actorData = /** @type {any} */(actualDeployable.toObject());
            const ownerBaseActor = /** @type {Actor} */(ownerActor.token?.baseActor ?? ownerActor);
            actorData.system.owner = ownerBaseActor.uuid;
            actorData.name = `${actualDeployable.name} [${ownerName}]`;
            actorData.folder = ownerActor.folder?.id;
            actorData.ownership = foundry.utils.duplicate(ownerActor.ownership);

            actorData.prototypeToken = actorData.prototypeToken || {};
            actorData.prototypeToken.disposition = disposition;
            if (team !== null)
            {
                actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                actorData.prototypeToken.flags['token-factions'].team = team;
            }
            actorData.flags = actorData.flags || {};
            _applyDeployableTypeImage(actorData);
            const LancerActor = game.lancer?.LancerActor || Actor;
            actualDeployable = await LancerActor.create(actorData);
            if (!actualDeployable)
            {
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

    if (actorEntries.length === 0)
    {
        ui.notifications.error("No valid deployables found.");
        return null;
    }

    // One deployable passes the actor directly, several pass the array so placeToken shows the actor selector.
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

    if (result && systemItem)
    {
        const updates = {};

        if (consumeUse)
        {
            let disabled = new Set();
            try
            {
                const { getAutoConsumeDisabled } = await import('./extra-config.js');
                disabled = getAutoConsumeDisabled(systemItem);
            }
            catch (err)
            {
                console.warn('lancer-automations | consume opt-out check failed:', err);
            }
            const uses = systemItem.system?.uses;
            if (uses && typeof uses.value === 'number' && !disabled.has('uses'))
            {
                // Match Lancer 3.1.2+ behaviour: deduct the deploy action's cost (defaults to 1).
                const actions = systemItem.system?.actions ?? [];
                const deployAction = actions.find(/** @type {any} */ act => Array.isArray(act?.deployables) && act.deployables.length);
                const cost = Math.max(1, Number(deployAction?.cost) || 1);
                const minUses = uses.min ?? 0;
                updates["system.uses.value"] = Math.max(uses.value - cost, minUses);
            }
            if (systemItem.system?.charged && !disabled.has('charged'))
                updates["system.charged"] = false;
            if (Object.keys(updates).length > 0)
                await systemItem.update(updates);
        }
    }

    // Play per-deployable FX on each deployed token (requires a source token).
    if (result && originToken)
    {
        const deployedTokens = Array.isArray(result) ? result : [result];
        for (const deployedToken of deployedTokens)
        {
            if (deployedToken)
                playDeployableFX(deployedToken);
        }
    }

    if (result)
    {
        await stampDeployableSource(result, systemItem);
        const api = game.modules.get('lancer-automations')?.api;
        if (api?.handleTrigger)
        {
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
export async function deployDeployable(actor, deployableLid, parentItem, consumeUse)
{
    const depInfo = getDeployableInfoSync(deployableLid, actor);
    const sceneId = canvas?.scene?.id;
    const tokens = actor.getActiveTokens?.() || [];
    const sourceToken = tokens.find(token => token?.scene?.id === sceneId) || tokens[0] || null;
    if (sourceToken && depInfo?.activation)
        playActionFxByActivation(depInfo.activation, sourceToken, stripDeployOwner(depInfo.name));
    await _printDeployableCard(parentItem);
    const extraOpts = getExtraDeployableOpts(parentItem ?? actor, deployableLid) || {};
    await placeDeployable({
        deployable: deployableLid,
        ownerActor: actor,
        systemItem: parentItem,
        consumeUse: (consumeUse ?? false) && !_printFlowConsumedUses(parentItem),
        range: extraOpts.range ?? null,
        count: extraOpts.count ?? null,
    });
}

// The card printed above already spends the use when treatGenericPrintAsActivation is on (tg_limited), so don't double-consume here.
function _printFlowConsumedUses(item)
{
    const tags = item?.system?.all_base_tags ?? item?.system?.tags ?? [];
    if (!Array.isArray(tags) || !tags.some(tag => tag?.lid === 'tg_limited'))
        return false;
    try
    {
        return !!game.settings.get('lancer-automations', 'treatGenericPrintAsActivation');
    }
    catch
    {
        return false;
    }
}

async function _printDeployableCard(parentItem)
{
    if (!parentItem)
        return;
    const begin = game.lancer?.beginItemChatFlow;
    if (typeof begin !== 'function')
        return;
    try
    {
        await begin(parentItem, {});
    }
    catch (error)
    {
        console.warn('lancer-automations | Could not print deployable card:', error);
    }
}

/**
 * Add or update lancer-automations flags on an item document.
 * Uses setFlag for reliable persistence (bypasses TypeDataModel restrictions).
 * Known flag keys:
 *   - deployRange {number} - default range when placing this item's deployables
 *   - deployCount {number} - default count when placing this item's deployables
 *   - activeStateData {Object} - contains { active: boolean, endAction: string, endActionDescription: string }
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function addItemFlags(item, flags)
{
    if (!item || typeof flags !== 'object')
    {
        ui.notifications.error("addItemFlags: item and flags object are required.");
        return null;
    }
    for (const [key, flagValue] of Object.entries(flags))
        await setItemFlag(item, 'lancer-automations', key, flagValue);
    return item;
}

/**
 * Removes flags from an item document.
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Keys to remove from the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function removeItemFlags(item, flags)
{
    if (!item || typeof flags !== 'object')
    {
        ui.notifications.error("removeItemFlags: item and flags object are required.");
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetItemFlag(item, 'lancer-automations', key);
    return item;
}

/**
 * Add or update lancer-automations flags on an actor document.
 * @param {Actor} actor     The Foundry Actor document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Actor>} The updated actor
 */
export async function addActorFlags(actor, flags)
{
    if (!actor || typeof flags !== 'object')
    {
        ui.notifications.error("addActorFlags: actor and flags object are required.");
        return null;
    }
    for (const [key, value] of Object.entries(flags))
        await setActorFlag(actor, 'lancer-automations', key, value);
    return actor;
}

/**
 * Removes lancer-automations flags from an actor document.
 * @param {Actor} actor     The Foundry Actor document
 * @param {Object} flags    Object whose keys are flags to unset
 * @returns {Promise<Actor>} The updated actor
 */
export async function removeActorFlags(actor, flags)
{
    if (!actor || typeof flags !== 'object')
    {
        ui.notifications.error("removeActorFlags: actor and flags object are required.");
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetActorFlag(actor, 'lancer-automations', key);
    return actor;
}

/**
 * Add or update lancer-automations flags on a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 */
export async function addTokenFlags(tokenOrDoc, flags)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object')
    {
        ui.notifications.error("addTokenFlags: token and flags object are required.");
        return null;
    }
    for (const [key, value] of Object.entries(flags))
        await setTokenFlag(td, 'lancer-automations', key, value);
    return td;
}

/**
 * Remove lancer-automations flags from a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Object whose keys are flags to unset
 */
export async function removeTokenFlags(tokenOrDoc, flags)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object')
    {
        ui.notifications.error("removeTokenFlags: token and flags object are required.");
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetTokenFlag(td, 'lancer-automations', key);
    return td;
}

/**
 * Read lancer-automations flag(s) from a token document.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {string} [flagName] If omitted, returns the whole `lancer-automations` namespace object.
 */
export function getTokenFlags(tokenOrDoc, flagName = null)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td)
    {
        ui.notifications.error("getTokenFlags: token is required.");
        return null;
    }
    if (flagName)
        return td.getFlag('lancer-automations', flagName);
    return td.flags?.['lancer-automations'] || {};
}

function _resolveActor(target)
{
    if (!target)
        return null;
    if (target.documentName === 'Actor')
        return target;
    return target.actor ?? target.document?.actor ?? null;
}

// Item target: lock lives on the item (off while destroyed/disabled, gone when removed). Actor target: source-tracked manual lock.
export async function lockActorAction(target, actionName, sourceIdOrOpts = null, opts = null, kind = null)
{
    if (target?.documentName === 'Item')
    {
        if (!actionName)
        {
            ui.notifications.error("lockActorAction: actionName is required.");
            return null;
        }
        const reason = (typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : sourceIdOrOpts?.reason) ?? null;
        const locks = /** @type {any[]} */ (target.getFlag('lancer-automations', 'actionLocks') ?? []);
        if (locks.some(lock => lock?.actionName === actionName))
            return target;
        await target.setFlag('lancer-automations', 'actionLocks', [...locks, { actionName, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) }]);
        return target;
    }
    const actor = _resolveActor(target);
    const sourceId = typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : null;
    if (!actor || !actionName || !sourceId)
    {
        ui.notifications.error("lockActorAction: actor, actionName and sourceId are required.");
        return null;
    }
    const reason = opts?.reason ?? null;
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    const entries = Array.isArray(current[actionName]) ? current[actionName].slice() : [];
    const idx = entries.findIndex(entry => lockEntryId(entry) === sourceId);
    const entry = (reason || kind) ? { id: sourceId, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) } : sourceId;
    if (idx === -1)
        entries.push(entry);
    else if (reason)
        entries[idx] = entry;
    await addActorFlags(actor, { lockedActions: { ...current, [actionName]: entries } });
    return actor;
}

/**
 * Same as lockActorAction, but keyed on activation type instead of a single action name.
 * @param {Item|Actor|Token} target - Item: lock held by the item. Actor: source-tracked manual lock.
 * @param {string|string[]} activationTypes - e.g. `"Quick"` or `["Full", "Protocol"]`. `"*"` locks every type.
 * @param {string|{reason?: string, except?: string[]}} [sourceIdOrOpts] - Actor target: sourceId. Item target: opts.
 * @param {{reason?: string, except?: string[]}} [opts] - Actor target only.
 * @returns {Promise<Item|Actor|null>}
 */
export async function lockActorActionTypes(target, activationTypes, sourceIdOrOpts = null, opts = null, kind = null)
{
    const types = (Array.isArray(activationTypes) ? activationTypes : [activationTypes]).filter(Boolean).map(type => String(type));
    if (!types.length)
    {
        ui.notifications.error("lockActorActionTypes: at least one activation type is required.");
        return null;
    }
    const settings = (typeof sourceIdOrOpts === 'object' && sourceIdOrOpts !== null ? sourceIdOrOpts : opts) ?? {};
    const except = (Array.isArray(settings.except) ? settings.except : [settings.except]).filter(Boolean).map(name => String(name));
    const reason = settings.reason ?? null;

    if (target?.documentName === 'Item')
    {
        const locks = /** @type {any[]} */ (target.getFlag('lancer-automations', 'actionTypeLocks') ?? []);
        const kept = locks.filter(lock => String(lock?.types) !== String(types));
        const entry = /** @type {any} */ ({ types, except });
        if (reason)
            entry.reason = reason;
        if (kind)
            entry.kind = kind;
        await target.setFlag('lancer-automations', 'actionTypeLocks', [...kept, entry]);
        return target;
    }

    const actor = _resolveActor(target);
    const sourceId = typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : null;
    if (!actor || !sourceId)
    {
        ui.notifications.error("lockActorActionTypes: actor, activationTypes and sourceId are required.");
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActionTypes')) ?? {};
    const next = { ...current };
    for (const type of types)
    {
        const entries = Array.isArray(next[type]) ? next[type].slice() : [];
        const idx = entries.findIndex(entry => lockEntryId(entry) === sourceId);
        const entry = { id: sourceId, except, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) };
        if (idx === -1)
            entries.push(entry);
        else
            entries[idx] = entry;
        next[type] = entries;
    }
    await addActorFlags(actor, { lockedActionTypes: next });
    return actor;
}

/** Inverse of lockActorActionTypes. Item target drops the item's lock, actor target unlocks by sourceId. */
export async function unlockActorActionTypes(target, activationTypes = null, sourceId = null, kind = null)
{
    const types = activationTypes
        ? (Array.isArray(activationTypes) ? activationTypes : [activationTypes]).filter(Boolean).map(type => String(type))
        : null;

    if (target?.documentName === 'Item')
    {
        if (!types)
        {
            if (kind === null)
            {
                await target.unsetFlag('lancer-automations', 'actionTypeLocks');
                return target;
            }
            const all = /** @type {any[]} */ (target.getFlag('lancer-automations', 'actionTypeLocks') ?? []);
            await target.setFlag('lancer-automations', 'actionTypeLocks', all.filter(lock => (lock?.kind ?? null) !== kind));
            return target;
        }
        const locks = /** @type {any[]} */ (target.getFlag('lancer-automations', 'actionTypeLocks') ?? []);
        await target.setFlag('lancer-automations', 'actionTypeLocks', locks.filter(lock => String(lock?.types) !== String(types) || (lock?.kind ?? null) !== kind));
        return target;
    }

    const actor = _resolveActor(target);
    if (!actor || !types || !sourceId)
    {
        ui.notifications.error("unlockActorActionTypes: actor, activationTypes and sourceId are required.");
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActionTypes')) ?? {};
    const next = { ...current };
    for (const type of types)
    {
        const entries = Array.isArray(next[type]) ? next[type].filter(entry => lockEntryId(entry) !== sourceId || (entry?.kind ?? null) !== kind) : [];
        if (entries.length)
            next[type] = entries;
        else
            delete next[type];
    }
    await addActorFlags(actor, { lockedActionTypes: next });
    return actor;
}

/** Inverse of lockActorAction. Item target drops the item's lock, actor target unlocks by sourceId. */
export async function unlockActorAction(target, actionName, sourceId = null, kind = null)
{
    if (target?.documentName === 'Item')
    {
        const locks = /** @type {any[]} */ (target.getFlag('lancer-automations', 'actionLocks') ?? []);
        const kept = locks.filter(lock => lock?.actionName !== actionName || (lock?.kind ?? null) !== kind);
        if (kept.length !== locks.length)
            await target.setFlag('lancer-automations', 'actionLocks', kept);
        return target;
    }
    const actor = _resolveActor(target);
    if (!actor || !actionName || !sourceId)
    {
        ui.notifications.error("unlockActorAction: actor, actionName and sourceId are required.");
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    const entries = Array.isArray(current[actionName]) ? current[actionName].filter(entry => lockEntryId(entry) !== sourceId || (entry?.kind ?? null) !== kind) : [];
    const next = { ...current };
    if (entries.length)
        next[actionName] = entries;
    else
        delete next[actionName];
    await addActorFlags(actor, { lockedActions: next });
    return actor;
}

/** Same as lockActorAction, but shown yellow (disabled) in the HUD instead of grey. */
export async function disableActorAction(target, actionName, sourceIdOrOpts = null, opts = null)
{
    return lockActorAction(target, actionName, sourceIdOrOpts, opts, 'disabled');
}

/** Inverse of disableActorAction. Only removes disabled-kind entries. */
export async function enableActorAction(target, actionName, sourceId = null)
{
    return unlockActorAction(target, actionName, sourceId, 'disabled');
}

/** Same as lockActorActionTypes, but shown yellow (disabled) in the HUD instead of grey. */
export async function disableActorActionTypes(target, activationTypes, sourceIdOrOpts = null, opts = null)
{
    return lockActorActionTypes(target, activationTypes, sourceIdOrOpts, opts, 'disabled');
}

/** Inverse of disableActorActionTypes. Only removes disabled-kind entries. */
export async function enableActorActionTypes(target, activationTypes = null, sourceId = null)
{
    return unlockActorActionTypes(target, activationTypes, sourceId, 'disabled');
}

/** Marks the item destroyed (Lancer native field). */
export async function destroyItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.destroyed': true });
    return item;
}

/** Marks the item disabled (skipped by locks, greyed by the system). */
export async function disableItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.disabled': true });
    return item;
}

/** Clears destroyed and disabled on the item. */
export async function restoreItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.destroyed': false, 'system.disabled': false });
    return item;
}

export function isActionLocked(target, actionName)
{
    const actor = _resolveActor(target);
    if (!actor || !actionName)
        return false;
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    if (Array.isArray(current[actionName]) && current[actionName].length > 0)
        return true;
    return getItemActionLocks(actor, actionName).length > 0;
}

export function getLockedActions(target)
{
    const actor = _resolveActor(target);
    if (!actor)
        return [];
    const current = /** @type {Record<string,any[]>} */(actor.getFlag('lancer-automations', 'lockedActions')) ?? {};
    const names = new Set(Object.keys(current).filter(key => Array.isArray(current[key]) && current[key].length > 0));
    for (const lock of getItemActionLocks(actor))
        names.add(lock.actionName);
    return [...names];
}

/**
 * Marks an item as activated.
 * @param {Item} item - The item to mark natively
 * @param {Token} token - The token that owns the item (kept for signature compatibility)
 * @param {string} endAction - A string defining what action is used to end the activation (e.g. "Quick", "Full")
 * @param {string} [endActionDescription=""] - Optional text description shown when ending the activation
 * @returns {Promise<Item>} The updated item
 */
export async function setItemAsActivated(item, token, endAction, endActionDescription = "")
{
    if (!item)
    {
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
export function getActivatedItems(token)
{
    if (!token?.actor)
        return [];
    const allItems = token.actor.items;
    return allItems.filter(item =>
    {
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
export async function endItemActivation(item, token)
{
    if (!item || !token?.actor)
        return false;

    const flags = getItemFlags(item);
    if (!flags?.activeStateData?.active)
        return false;

    const endAction = flags.activeStateData.endAction || "Unknown";
    const endActionDescription = flags.activeStateData.endActionDescription || "";

    await removeItemFlags(item, { activeStateData: true });

    const api = game.modules.get('lancer-automations')?.api;
    if (api?.executeSimpleActivation)
    {
        const result = await api.executeSimpleActivation(token.actor, {
            title: endActionDescription || `End ${item.name}`,
            action: { name: item.name, activation: endAction },
            detail: item.system?.effect || "",
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
export async function openEndActivationMenu(token)
{
    if (!token?.actor)
    {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const activatedItems = getActivatedItems(token);
    if (activatedItems.length === 0)
    {
        ui.notifications.warn(`No activated items found for ${token.name}.`);
        return null;
    }

    const chosenItem = await pickItem(activatedItems, {
        title: "END ITEM ACTIVATION",
        description: `Select an activated item to end for ${token.name}:`,
        icon: "fas fa-power-off",
        formatText: (activatedItem) =>
        {
            const flags = getItemFlags(activatedItem);
            const actionText = flags?.activeStateData?.endAction ? ` [${flags.activeStateData.endAction}]` : "";
            return `${flags?.activeStateData?.endActionDescription || `End ${activatedItem.name}`}${actionText}`;
        }
    });

    if (chosenItem)
    {
        await endItemActivation(chosenItem, token);
        return chosenItem;
    }

    return null;
}


/**
 * Get the effective actions for an item, merging system.actions with extra actions
 * stored in the 'lancer-automations.extraActions' flag.
 * @param {Item} item
 * @param {{extraOnly?: boolean}} [opts]  extraOnly: return only LA extra actions (skip system/profile)
 * @returns {Array} Array of action objects
 */
export function getItemActions(item, opts = {})
{
    if (!item)
        return [];
    const owner = item.parent?.documentName === 'Actor' ? item.parent : null;
    const extraActions = (item.getFlag?.('lancer-automations', 'extraActions') || [])
        .filter(action => linkTierGate(action, owner, item));
    if (opts.extraOnly)
        return extraActions;
    const systemActions = applyActionOverlays(item, item.system?.actions ?? []);
    // Multi-profile weapons (e.g. Dynamo Blade) keep per-profile actions here.
    const profileActions = applyActionOverlays(item, item.system?.active_profile?.actions ?? []);
    // Some weapons list the same action in both system.actions and the active profile, drop exact dupes.
    const seen = new Set();
    return [...systemActions, ...profileActions, ...extraActions].filter(action =>
    {
        const key = `${action.name}|${action.activation}|${action.detail ?? ''}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
}

/**
 * Extra action object: LancerAction shape plus an optional TAH icon field.
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
export async function addExtraActions(target, actions)
{
    if (!target)
    {
        ui.notifications.error("addExtraActions: target is required.");
        return null;
    }
    const newActions = Array.isArray(actions) ? actions : [actions];
    if (newActions.length === 0)
        return null;

    // Items store on themselves, tokens/actors use their actor doc.
    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    // Stamp _sourceItemId on item extras so onlyOnSourceMatch can trace back.
    const isItem = doc.documentName === 'Item';
    if (isItem)
    {
        // Strip consumable tags already on the item to avoid double-tracking state.
        const CONSUMABLE_LIDS = new Set(['tg_loading', 'tg_recharge', 'tg_limited']);
        const FIELD_FOR = { tg_loading: 'loaded', tg_recharge: 'charged', tg_limited: 'uses' };
        const itemTagLids = new Set(((doc.system?.tags ?? [])).map((/** @type {any} */ tag) => tag.lid));
        for (const action of newActions)
        {
            const actionAny = /** @type {any} */ (action);
            if (Array.isArray(actionAny.tags) && actionAny.tags.length)
            {
                const dropped = [];
                actionAny.tags = actionAny.tags.filter((/** @type {any} */ tag) =>
                {
                    if (CONSUMABLE_LIDS.has(tag.lid) && itemTagLids.has(tag.lid))
                    {
                        dropped.push(tag.lid);
                        const fieldName = FIELD_FOR[tag.lid];
                        if (fieldName && fieldName in actionAny)
                            delete actionAny[fieldName];
                        if (tag.lid === 'tg_recharge' && 'recharge' in actionAny)
                            delete actionAny.recharge;
                        return false;
                    }
                    return true;
                });
                if (dropped.length)
                    ui.notifications.warn(`Tag(s) ${dropped.join(', ')} already on ${doc.name}, removed from extra action "${actionAny.name}".`);
            }
        }
        for (const action of newActions)
        {
            const actionAny = /** @type {any} */ (action);
            if (!actionAny._sourceItemId)
                actionAny._sourceItemId = doc.id;
        }
    }

    const existing = doc.getFlag('lancer-automations', 'extraActions') || [];
    const merged = [...existing, ...newActions];

    await doc.setFlag('lancer-automations', 'extraActions', merged);
    console.log(`lancer-automations | addExtraActions: Added action(s) to ${doc.name}:`, newActions);
    return doc;
}

/**
 * Get extra actions stored on an item, token, or actor via addExtraActions.
 * Reads from the item itself, or from the actor for tokens/actors, mirroring
 * addExtraActions so getter and setter agree on which doc holds the flag.
 * @param {Item|Token|Actor} target
 * @returns {Array<Object>}
 */
export function getActorActions(target)
{
    if (!target)
        return [];
    const asAny = /** @type {any} */ (target);
    const doc = (asAny.documentName === 'Item') ? asAny : (asAny.actor ?? asAny.document ?? asAny);
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
export async function removeExtraActions(target, filter = null)
{
    if (!target)
        return;
    const asAny = /** @type {any} */ (target);
    const doc = (asAny.documentName === 'Item') ? asAny : (asAny.actor ?? asAny.document ?? asAny);
    const existing = doc.getFlag?.('lancer-automations', 'extraActions') || [];
    if (existing.length === 0)
        return;

    let kept;
    if (!filter)
        kept = [];
    else if (typeof filter === 'function')
        kept = existing.filter(action => !filter(action));
    else
    {
        const names = Array.isArray(filter) ? filter : [filter];
        kept = existing.filter(action => !names.includes(action.name));
    }

    await doc.setFlag('lancer-automations', 'extraActions', kept);
}

// Spend the consumable state on an actor-level extra action. Returns false when depleted so the caller bails.
export async function consumeExtraAction(actor, actionName)
{
    if (!actor)
        return true;
    const all = actor.getFlag('lancer-automations', 'extraActions') || [];
    const idx = all.findIndex(action => action.name === actionName);
    if (idx < 0)
        return true;
    const entry = { ...all[idx] };
    const tags = entry.tags ?? [];
    const hasLoading = tags.some(tag => tag.lid === 'tg_loading');
    const hasRecharge = tags.some(tag => tag.lid === 'tg_recharge');
    const hasLimited = tags.some(tag => tag.lid === 'tg_limited');
    const hasPerTurn = tags.some(tag => tag.lid === 'tg_turn');
    const hasPerRound = tags.some(tag => tag.lid === 'tg_round');
    let needsWrite = false;

    if (hasLoading)
    {
        if (entry.loaded === false)
        {
            ui.notifications.warn(`${entry.name} is not loaded.`);
            return false;
        }
        entry.loaded = false;
        needsWrite = true;
    }
    if (hasRecharge)
    {
        if (entry.charged === false)
        {
            ui.notifications.warn(`${entry.name} is uncharged.`);
            return false;
        }
        entry.charged = false;
        needsWrite = true;
    }
    if (hasLimited)
    {
        const cur = entry.uses?.value ?? 0;
        if (cur <= 0)
        {
            ui.notifications.warn(`${entry.name} has no uses left.`);
            return false;
        }
        entry.uses = { ...entry.uses, value: cur - 1 };
        needsWrite = true;
    }
    if (hasPerTurn)
    {
        const cur = entry.usesPerTurn?.value ?? 0;
        if (cur <= 0)
        {
            ui.notifications.warn(`${entry.name}: per-turn limit reached.`);
            return false;
        }
        entry.usesPerTurn = { ...entry.usesPerTurn, value: cur - 1 };
        needsWrite = true;
    }
    if (hasPerRound)
    {
        const cur = entry.usesPerRound?.value ?? 0;
        if (cur <= 0)
        {
            ui.notifications.warn(`${entry.name}: per-round limit reached.`);
            return false;
        }
        entry.usesPerRound = { ...entry.usesPerRound, value: cur - 1 };
        needsWrite = true;
    }

    if (needsWrite)
    {
        const next = all.slice();
        next[idx] = entry;
        await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    return true;
}

// Reset the consumable state on a single actor-level extra action.
export async function reloadExtraAction(actor, actionName)
{
    if (!actor)
        return;
    const all = actor.getFlag('lancer-automations', 'extraActions') || [];
    const idx = all.findIndex(action => action.name === actionName);
    if (idx < 0)
        return;
    const entry = { ...all[idx] };
    const tags = entry.tags ?? [];
    let changed = false;
    if (tags.some(tag => tag.lid === 'tg_loading') && entry.loaded !== true)
    {
        entry.loaded = true;
        changed = true;
    }
    if (tags.some(tag => tag.lid === 'tg_recharge') && entry.charged !== true)
    {
        entry.charged = true;
        changed = true;
    }
    if (tags.some(tag => tag.lid === 'tg_limited') && entry.uses?.max != null && entry.uses?.value !== entry.uses.max)
    {
        entry.uses = { ...entry.uses, value: entry.uses.max };
        changed = true;
    }
    if (entry.usesPerTurn?.max != null && entry.usesPerTurn?.value !== entry.usesPerTurn.max)
    {
        entry.usesPerTurn = { ...entry.usesPerTurn, value: entry.usesPerTurn.max };
        changed = true;
    }
    if (entry.usesPerRound?.max != null && entry.usesPerRound?.value !== entry.usesPerRound.max)
    {
        entry.usesPerRound = { ...entry.usesPerRound, value: entry.usesPerRound.max };
        changed = true;
    }
    if (changed)
    {
        const next = all.slice();
        next[idx] = entry;
        await actor.setFlag('lancer-automations', 'extraActions', next);
    }
}

// Encode dots in LID/UUID keys, Foundry setFlag treats dot-separated keys as nested paths.
function _encodeOptsKey(key)
{
    return String(key).replace(/\./g, '$DOT$');
}

export function getExtraDeployableOpts(target, key)
{
    if (!target || !key)
        return null;
    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);
    const map = doc.getFlag?.('lancer-automations', 'extraDeployableOpts') || {};
    return map[_encodeOptsKey(key)] ?? null;
}

export async function setExtraDeployableOpts(target, key, opts)
{
    if (!target || !key)
        return null;
    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);
    const map = { ...(doc.getFlag?.('lancer-automations', 'extraDeployableOpts') || {}) };
    const encoded = _encodeOptsKey(key);
    const cur = { ...map[encoded] };
    for (const [optKey, optValue] of Object.entries(opts || {}))
    {
        if (optValue == null || optValue === '')
            delete cur[optKey];
        else
            cur[optKey] = optValue;
    }
    if (Object.keys(cur).length === 0)
        delete map[encoded];
    else
        map[encoded] = cur;
    await doc.setFlag('lancer-automations', 'extraDeployableOpts', map);
    return doc;
}

// Effective deploy range/count, matching placeDeployable (extra opts > deployRange flag > drones use sensor).
export function resolveDeployRangeCount(item, lid, actor)
{
    const optsSource = item ?? actor;
    const extraOpts = optsSource ? (getExtraDeployableOpts(optsSource, lid) || {}) : {};
    const itemFlags = item ? (getItemFlags(item) || {}) : {};
    const rangeOpt = extraOpts.range ?? null;
    const deployRangeFlag = itemFlags.deployRange ?? null;
    const count = extraOpts.count ?? itemFlags.deployCount ?? 1;

    let range = rangeOpt ?? deployRangeFlag ?? 1;
    if (rangeOpt == null && deployRangeFlag == null)
    {
        const info = getDeployableInfoSync(lid, actor);
        const itemDrone = (item?.system?.tags ?? []).some(tag => /drone/i.test(tag?.lid ?? '') || /drone/i.test(tag?.id ?? ''));
        if (/drone/i.test(info?.type ?? '') || itemDrone)
            range = actor?.type === 'pilot' ? 5 : (actor?.system?.sensor_range ?? 10);
    }
    return { range: Math.max(1, range), count };
}

// True if the item's primary (base) action is hidden in the TAH, leaving only its deployables/extras.
export function isPrimaryActionHidden(item)
{
    return !!(item?.getFlag?.('lancer-automations', 'hidePrimaryAction'));
}

/**
 * Hide (or show) an item's primary action in the TAH. For deploy-only items whose base
 * action is redundant with an added deployable (the deploy row already prints the card).
 * @param {Item|string} itemOrUuid  An Item document or its uuid
 * @param {boolean} [hidden=true]    true to hide the primary action, false to restore it
 * @returns {Promise<Item|null>}
 */
export async function setHidePrimaryAction(itemOrUuid, hidden = true)
{
    const item = typeof itemOrUuid === 'string' ? /** @type {any} */ (await fromUuid(itemOrUuid)) : itemOrUuid;
    if (!item || item.documentName !== 'Item')
    {
        ui.notifications.error('setHidePrimaryAction: an Item (or its uuid) is required.');
        return null;
    }
    if (hidden)
        await setItemFlag(item, 'lancer-automations', 'hidePrimaryAction', true);
    else
        await unsetItemFlag(item, 'lancer-automations', 'hidePrimaryAction');
    return item;
}

// Roll 1d6 recharge for uncharged tg_recharge extra actions on actor and items, charged if roll >= entry.recharge.
export async function rechargeExtraActionsForActor(actor)
{
    if (!actor)
        return;
    const rollFor = (list) =>
    {
        let mutated = false;
        const next = list.map(entry =>
        {
            let current = entry;
            const tags = entry?.tags ?? [];
            if (tags.some(tag => tag.lid === 'tg_recharge') && current.charged === false)
            {
                const threshold = Number(current.recharge ?? 6);
                if (1 + Math.floor(Math.random() * 6) >= threshold)
                {
                    current = { ...current, charged: true };
                    mutated = true;
                }
            }
            // Per-turn usage resets at the actor's turn start.
            if (current.usesPerTurn?.max != null && current.usesPerTurn.value !== current.usesPerTurn.max)
            {
                current = { ...current, usesPerTurn: { ...current.usesPerTurn, value: current.usesPerTurn.max } };
                mutated = true;
            }
            return current;
        });
        return { next, mutated };
    };
    const actorList = actor.getFlag('lancer-automations', 'extraActions') || [];
    if (actorList.length)
    {
        const { next, mutated } = rollFor(actorList);
        if (mutated)
            await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    for (const item of (actor.items ?? []))
    {
        const itemList = item.getFlag?.('lancer-automations', 'extraActions') || [];
        if (!itemList.length)
            continue;
        const { next, mutated } = rollFor(itemList);
        if (mutated)
            await item.setFlag('lancer-automations', 'extraActions', next);
    }
}

// Reset per-round usage (tg_round) on an actor's + items' extra actions. Called at round start.
export async function resetPerRoundExtraActionsForActor(actor)
{
    if (!actor)
        return;
    const resetList = (list) =>
    {
        let mutated = false;
        const next = list.map(entry =>
        {
            if (entry?.usesPerRound?.max != null && entry.usesPerRound.value !== entry.usesPerRound.max)
            {
                mutated = true;
                return { ...entry, usesPerRound: { ...entry.usesPerRound, value: entry.usesPerRound.max } };
            }
            return entry;
        });
        return { next, mutated };
    };
    const actorList = actor.getFlag('lancer-automations', 'extraActions') || [];
    if (actorList.length)
    {
        const { next, mutated } = resetList(actorList);
        if (mutated)
            await actor.setFlag('lancer-automations', 'extraActions', next);
    }
    for (const item of (actor.items ?? []))
    {
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
 * NPC tier behavior (read-side, via `getItemDeployables`): passing exactly 3 LIDs treats
 * them as T1/T2/T3 in order and picks the one matching the actor's tier. 1 LID = all tiers.
 * Explicit gating: pass `{ lid, tier?, range?, count? }` objects to set each entry's opts in the same call.
 * @param {Item|Actor|Token} target     The document to attach LIDs to
 * @param {string|Array<string|{lid:string,tier?:number,range?:number,count?:number}>} lids  LID string(s), or { lid, ...opts } object(s)
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraDeploymentLids(target, lids)
{
    if (!target)
    {
        ui.notifications.error("addExtraDeploymentLids: target is required.");
        return null;
    }
    const rawList = Array.isArray(lids) ? lids : [lids];
    const entries = rawList.map(entry => (typeof entry === 'string' ? { lid: entry } : entry));
    if (entries.length === 0 || entries.some(entry => typeof entry?.lid !== 'string'))
    {
        ui.notifications.error("addExtraDeploymentLids: each entry must be a LID string or { lid, ... } object.");
        return null;
    }
    const newLids = entries.map(entry => entry.lid);

    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    const existingFlags = doc.getFlag('lancer-automations', 'extraDeployables') || [];
    const merged = [...new Set([...existingFlags, ...newLids])];

    if (merged.length !== existingFlags.length)
    {
        await doc.setFlag('lancer-automations', 'extraDeployables', merged);
        console.log(`lancer-automations | addExtraDeploymentLids: Added LID(s) to ${doc.name}:`, newLids);
    }

    for (const entry of entries)
    {
        const opts = {};
        if (entry.tier != null)
            opts.tier = entry.tier;
        if (entry.range != null)
            opts.range = entry.range;
        if (entry.count != null)
            opts.count = entry.count;
        if (Object.keys(opts).length)
            await setExtraDeployableOpts(doc, entry.lid, opts);
    }

    const actorForInfo = (doc.documentName === 'Item') ? (doc.actor ?? null) : doc;
    const uiMarker = doc.getFlag('lancer-automations', 'extraDeployableLidsViaUI') || [];
    const markerLids = new Set(uiMarker.map((/** @type {any} */ entry) => (typeof entry === 'string' ? entry : entry?.lid)));
    const addedMarkers = [];
    for (const lid of merged)
    {
        if (markerLids.has(lid))
            continue;
        const info = getDeployableInfoSync(lid, actorForInfo);
        addedMarkers.push({ lid, name: info?.name ?? lid, img: info?.img ?? null });
    }
    if (addedMarkers.length)
        await doc.setFlag('lancer-automations', 'extraDeployableLidsViaUI', [...uiMarker, ...addedMarkers]);

    return doc;
}

/**
 * Add extra deployable actors (by reference or UUID) to an item, actor, or token via flags.
 * Mirrors addExtraDeploymentLids but stores actor UUIDs under 'lancer-automations.extraDeployableActors'.
 * @param {Item|Actor|Token} target                       The document to attach the deployables to
 * @param {any|string|Array<any|string>} actors           Actor doc, UUID string, or array of either
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraDeploymentActor(target, actors)
{
    if (!target)
    {
        ui.notifications.error("addExtraDeploymentActor: target is required.");
        return null;
    }
    const inputs = Array.isArray(actors) ? actors : [actors];
    if (inputs.length === 0)
    {
        ui.notifications.error("addExtraDeploymentActor: actors must be an Actor, UUID, or array of them.");
        return null;
    }

    // Normalize to UUIDs, validating each input resolves to a deployable actor.
    const validUuids = [];
    for (const input of inputs)
    {
        if (!input)
            continue;
        let uuid = null;
        let resolved = null;
        if (typeof input === 'string')
        {
            uuid = input;
            try
            {
                resolved = /** @type {any} */ (await fromUuid(uuid));
            }
            catch
            { /* invalid uuid string */ }
        }
        else if (typeof input === 'object' && input?.uuid)
        {
            uuid = input.uuid;
            resolved = input;
        }
        if (!uuid || resolved?.documentName !== 'Actor')
        {
            ui.notifications.warn(`addExtraDeploymentActor: skipping non-actor input: ${typeof input === 'string' ? input : input?.name}`);
            continue;
        }
        validUuids.push(uuid);
    }
    if (validUuids.length === 0)
        return null;

    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    const existing = doc.getFlag('lancer-automations', 'extraDeployableActors') || [];
    const merged = [...new Set([...existing, ...validUuids])];

    if (merged.length !== existing.length)
    {
        await doc.setFlag('lancer-automations', 'extraDeployableActors', merged);
        console.log(`lancer-automations | addExtraDeploymentActor: Added actor UUID(s) to ${doc.name}:`, validUuids);
    }

    const uiMarker = doc.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
    const mergedMarker = [...new Set([...uiMarker, ...merged])];
    if (mergedMarker.length !== uiMarker.length)
        await doc.setFlag('lancer-automations', 'extraDeployableActorsViaUI', mergedMarker);

    return doc;
}

/**
 * Searchable picker for deployable actors across all Actor compendia.
 * onPick receives the picked entry, return 'keep-open' to prevent auto-close.
 * @param {{ title?: string, onPick?: (entry: {lid: string, uuid: string, name: string, img: string, pack: string, type: string}) => any }} [opts]
 */
export async function openDeployablePicker({ title = 'Find Deployable', onPick = null } = {})
{
    const deployables = [];
    for (const pack of game.packs)
    {
        if (pack.documentName !== 'Actor')
            continue;
        const index = await pack.getIndex({ fields: ['system.lid', 'type', 'img'] });
        for (const entry of index)
        {
            if (entry.type !== 'deployable')
                continue;
            const lid = entry.system?.lid;
            if (!lid)
                continue;
            deployables.push({
                name: entry.name,
                lid,
                type: entry.type,
                img: entry.img || 'icons/svg/mystery-man.svg',
                uuid: entry.uuid,
                pack: pack.metadata.label,
            });
        }
    }
    deployables.sort((left, right) => left.name.localeCompare(right.name));
    const MAX_RESULTS = 50;
    const canPick = !!onPick;
    const subtitle = canPick
        ? 'Search for a deployable actor by name or LID. Click an entry to pick it.'
        : 'Search for a deployable actor by name or LID. Click <i class="fas fa-copy"></i> to copy.';

    const buildEntry = (deployableEntry) => `
        <div class="lancer-item-card deployable-entry" data-lid="${deployableEntry.lid}" style="margin-bottom:6px;padding:10px;${canPick ? '' : 'cursor:default;'}">
            <div class="lancer-item-icon"><i class="fas fa-rocket"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${deployableEntry.name}</div>
                <div class="lancer-item-details">${deployableEntry.type} | LID: ${deployableEntry.lid}</div>
            </div>
            <a class="copy-lid-btn" title="Copy LID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;

    let dlg = null;
    dlg = new Dialog({
        title,
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">${title}</h1>
                <p class="lancer-dialog-subtitle">${subtitle}</p>
            </div>
            <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                <div style="flex:1;position:relative;">
                    <i class="fas fa-search lancer-search-icon"></i>
                    <input type="text" id="deploy-search" placeholder="Search by name or LID..." style="padding-left:35px;">
                </div>
                <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                    <input type="checkbox" id="deploy-show-all"> Show all
                </label>
            </div>
            <div id="deploy-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                <div style="padding:20px;text-align:center;color:#888;font-style:italic;">
                    <i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables…
                </div>
            </div>
        `,
        buttons: { close: { label: '<i class="fas fa-times"></i> Close' } },
        render: (html) =>
        {
            const searchInput = html.find('#deploy-search');
            const showAllCb = html.find('#deploy-show-all');
            const listContainer = html.find('#deploy-list');

            const updateList = () =>
            {
                const query = String(searchInput.val() || '').toLowerCase().trim();
                const showAll = showAllCb.is(':checked');
                if (!query && !showAll)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables…</div>');
                    return;
                }
                const matched = deployables.filter(deployable => !query || deployable.name.toLowerCase().includes(query) || deployable.lid.toLowerCase().includes(query));
                if (matched.length === 0)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No deployables found.</div>');
                    return;
                }
                const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                const more = matched.length - slice.length;
                let resultHtml = slice.map(buildEntry).join('');
                if (more > 0)
                    resultHtml += `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more, keep typing or check 'Show all'</div>`;
                listContainer.html(resultHtml);
            };

            let timer;
            searchInput.on('input', () =>
            {
                clearTimeout(timer); timer = setTimeout(updateList, 200);
            });
            showAllCb.on('change', updateList);

            listContainer.on('click', '.copy-lid-btn', async function (ev)
            {
                ev.preventDefault();
                ev.stopPropagation();
                const lid = $(this).closest('.deployable-entry').data('lid');
                if (lid)
                {
                    await navigator.clipboard.writeText(lid);
                    ui.notifications.info(`Copied LID: ${lid}`);
                }
            });
            if (canPick)
            {
                listContainer.on('click', '.deployable-entry', async (ev) =>
                {
                    if ($(ev.target).closest('.copy-lid-btn').length)
                        return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const lid = $(ev.currentTarget).data('lid');
                    const entry = deployables.find(deployable => deployable.lid === lid);
                    if (!entry)
                        return;
                    const result = await onPick(entry);
                    if (result !== 'keep-open')
                        dlg?.close();
                });
            }
            listContainer.on('contextmenu', '.deployable-entry', async function (ev)
            {
                ev.preventDefault();
                const entry = deployables.find(deployable => deployable.lid === $(this).data('lid'));
                if (entry)
                {
                    const actor = /** @type {any} */ (await fromUuid(entry.uuid));
                    if (actor)
                        actor.sheet.render(true);
                }
            });
            setTimeout(() => searchInput.focus(), 50);
        },
    }, { width: 600, height: 580, classes: ['lancer-dialog-base', 'lancer-item-browser-dialog', 'lancer-no-title'] });
    dlg.render(true);
}

/**
 * Search dialog over world actors and scenes.
 * @param {{ title?: string, onPick?: (entry: { uuid: string, id: string, name: string, documentName: string }) => Promise<any> }} [opts]
 */
export async function openDocumentPicker({ title = 'Find Actor or Scene', documentTypes = ['Actor', 'Scene'], onPick = null } = {})
{
    const entries = [];
    if (documentTypes.includes('Actor'))
    {
        entries.push(...game.actors.map(actor => ({
            uuid: actor.uuid,
            id: actor.id,
            name: actor.name,
            documentName: 'Actor',
            details: actor.folder ? `${actor.type} | ${actor.folder.name}` : actor.type,
            icon: 'fa-user',
        })));
    }
    if (documentTypes.includes('Scene'))
    {
        entries.push(...game.scenes.map(scene => ({
            uuid: scene.uuid,
            id: scene.id,
            name: scene.name,
            documentName: 'Scene',
            details: 'Scene',
            icon: 'fa-map',
        })));
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const MAX_RESULTS = 50;
    const canPick = !!onPick;
    const subtitle = canPick
        ? 'Search by name or UUID. Click an entry to pick it.'
        : 'Search by name or UUID. Click <i class="fas fa-copy"></i> to copy.';

    const buildEntry = (entry) => `
        <div class="lancer-item-card document-entry" data-uuid="${entry.uuid}" style="margin-bottom:6px;padding:10px;${canPick ? '' : 'cursor:default;'}">
            <div class="lancer-item-icon"><i class="fas ${entry.icon}"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${entry.name}</div>
                <div class="lancer-item-details">${entry.details} | ${entry.uuid}</div>
            </div>
            <a class="copy-uuid-btn" title="Copy UUID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;
    const emptyHint = '<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search…</div>';

    let dlg = null;
    dlg = new Dialog({
        title,
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">${title}</h1>
                <p class="lancer-dialog-subtitle">${subtitle}</p>
            </div>
            <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                <div style="flex:1;position:relative;">
                    <i class="fas fa-search lancer-search-icon"></i>
                    <input type="text" id="document-search" placeholder="Search by name or UUID..." style="padding-left:35px;">
                </div>
                <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                    <input type="checkbox" id="document-show-all"> Show all
                </label>
            </div>
            <div id="document-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">${emptyHint}</div>
        `,
        buttons: { close: { label: '<i class="fas fa-times"></i> Close' } },
        render: (html) =>
        {
            const searchInput = html.find('#document-search');
            const showAllCb = html.find('#document-show-all');
            const listContainer = html.find('#document-list');

            const updateList = () =>
            {
                const query = String(searchInput.val() || '').toLowerCase().trim();
                const showAll = showAllCb.is(':checked');
                if (!query && !showAll)
                {
                    listContainer.html(emptyHint);
                    return;
                }
                const matched = entries.filter(entry => !query || entry.name.toLowerCase().includes(query) || entry.uuid.toLowerCase().includes(query));
                if (matched.length === 0)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No match.</div>');
                    return;
                }
                const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                const more = matched.length - slice.length;
                let resultHtml = slice.map(buildEntry).join('');
                if (more > 0)
                    resultHtml += `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more, keep typing or check 'Show all'</div>`;
                listContainer.html(resultHtml);
            };

            let timer;
            searchInput.on('input', () =>
            {
                clearTimeout(timer); timer = setTimeout(updateList, 200);
            });
            showAllCb.on('change', updateList);

            listContainer.on('click', '.copy-uuid-btn', async function (ev)
            {
                ev.preventDefault();
                ev.stopPropagation();
                const uuid = $(this).closest('.document-entry').data('uuid');
                if (uuid)
                {
                    await navigator.clipboard.writeText(uuid);
                    ui.notifications.info(`Copied UUID: ${uuid}`);
                }
            });
            if (canPick)
            {
                listContainer.on('click', '.document-entry', async (ev) =>
                {
                    if ($(ev.target).closest('.copy-uuid-btn').length)
                        return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const entry = entries.find(candidate => candidate.uuid === $(ev.currentTarget).data('uuid'));
                    if (!entry)
                        return;
                    const result = await onPick(entry);
                    if (result !== 'keep-open')
                        dlg?.close();
                });
            }
            listContainer.on('contextmenu', '.document-entry', async function (ev)
            {
                ev.preventDefault();
                const doc = await fromUuid($(this).data('uuid'));
                doc?.sheet?.render(true);
            });
            setTimeout(() => searchInput.focus(), 50);
        },
    }, { width: 600, height: 580, classes: ['lancer-dialog-base', 'lancer-item-browser-dialog', 'lancer-no-title'] });
    dlg.render(true);
}

/**
 * Remove extra deployable actor UUIDs from an item, actor, or token via flags.
 * Also strips matching entries from the sibling `extraDeployableActorsViaUI` marker flag if present.
 * @param {Item|Actor|Token} target
 * @param {any|string|Array<any|string>} actors  Actor doc, UUID string, or array of either
 * @returns {Promise<Item|Actor|null>}
 */
export async function removeExtraDeploymentActor(target, actors)
{
    if (!target)
        return null;
    const inputs = Array.isArray(actors) ? actors : [actors];
    const removeUuids = inputs
        .map(input => typeof input === 'string' ? input : input?.uuid)
        .filter(Boolean);
    if (removeUuids.length === 0)
        return null;
    const removeSet = new Set(removeUuids);

    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    const existing = doc.getFlag('lancer-automations', 'extraDeployableActors') || [];
    const kept = existing.filter(uuid => !removeSet.has(uuid));
    let mutated = kept.length !== existing.length;
    if (mutated)
        await doc.setFlag('lancer-automations', 'extraDeployableActors', kept);

    const uiMarkers = doc.getFlag('lancer-automations', 'extraDeployableActorsViaUI') || [];
    const keptMarkers = uiMarkers.filter(uuid => !removeSet.has(uuid));
    if (keptMarkers.length !== uiMarkers.length)
    {
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
 * document, the same flag `placeDeployable` writes and `recallDeployable` reads.
 * Already-linked tokens are marked invalid in the picker (with a "click to UNLINK" warning).
 * @param {Token} ownerToken
 * @returns {Promise<void>}
 */
export async function promptLinkOrUnlinkActor(ownerToken)
{
    const owner = ownerToken?.actor;
    if (!owner)
    {
        ui.notifications.warn("promptLinkOrUnlinkActor: token has no actor.");
        return;
    }
    const ownerUuid = owner.uuid;
    const isLinkedToOwner = (/** @type {any} */ token) =>
        token?.document?.getFlag?.('lancer-automations', 'ownerActorUuid') === ownerUuid;

    const picked = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        title: 'LINK / UNLINK ACTOR',
        description: 'Pick a token to link. Already-linked tokens will be unlinked.',
        icon: 'cci cci-deployable',
        filter: (/** @type {any} */ token) => !isLinkedToOwner(token),
        filterWarning: 'Already linked, click to UNLINK',
    });
    const target = picked?.[0];
    if (!target?.document)
        return;
    if (isLinkedToOwner(target))
    {
        await target.document.unsetFlag('lancer-automations', 'ownerActorUuid');
        await target.document.unsetFlag('lancer-automations', 'ownerName');
        ui.notifications.info(`Unlinked ${target.actor?.name ?? target.name} from ${owner.name}.`);
    }
    else
    {
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
export function getActorDeployables(tokenOrActor)
{
    if (!tokenOrActor)
        return [];
    const asAny = /** @type {any} */ (tokenOrActor);
    const doc = asAny.actor ?? asAny.document ?? asAny;
    const keys = [
        ...(doc.getFlag?.('lancer-automations', 'extraDeployables') || []),
        ...(doc.getFlag?.('lancer-automations', 'extraDeployableActors') || []),
    ];
    return keys.filter(key => linkTierGate(getExtraDeployableOpts(doc, key), doc));
}

/**
 * Read extra actions attached to an item, actor, or token (from `flags.extraActions`).
 * Only the linked extras, does not merge `system.actions`. Use `getItemActions` for the merge.
 * Symmetric with `getLinkedBonuses` / `getLinkedEffects`.
 * @param {Item|Actor|Token} source
 * @returns {any[]}
 */
export function getLinkedActions(source)
{
    if (!source)
        return [];
    const asAny = /** @type {any} */ (source);
    const doc = (asAny.documentName === 'Item') ? asAny : (asAny.actor ?? asAny.document ?? asAny);
    return /** @type {any[]} */ (doc.getFlag?.('lancer-automations', 'extraActions') || []);
}

/**
 * Read extra deployables (LIDs + actor UUIDs) linked to an item, actor, or token.
 * Combined array of `flags.extraDeployables` (LIDs) + `flags.extraDeployableActors` (UUIDs).
 * Does not tier-slice - use `getItemDeployables(item, actor)` for that.
 * Symmetric with `getLinkedBonuses` / `getLinkedEffects`.
 * @param {Item|Actor|Token} source
 * @returns {string[]}
 */
export function getLinkedDeployables(source)
{
    if (!source)
        return [];
    const asAny = /** @type {any} */ (source);
    const doc = (asAny.documentName === 'Item') ? asAny : (asAny.actor ?? asAny.document ?? asAny);
    return [
        ...(doc.getFlag?.('lancer-automations', 'extraDeployables') || []),
        ...(doc.getFlag?.('lancer-automations', 'extraDeployableActors') || []),
    ];
}

// NPC tier honoring tier_override, null for non-NPC / unowned (never tier-gated).
export function getOwnerTier(ownerActor, item = null)
{
    if (ownerActor?.type !== 'npc')
        return null;
    const override = Number(item?.system?.tier_override ?? 0);
    const tier = override > 0 ? override : (Number(ownerActor.system?.tier) || 1);
    return Math.max(1, Math.min(3, tier));
}

// A link applies unless gated to a tier the NPC owner is not. Non-NPC owners ignore the gate.
export function linkTierGate(entry, ownerActor, item = null)
{
    const gate = Number(entry?.tier ?? 0);
    if (!gate)
        return true;
    const ownerTier = getOwnerTier(ownerActor, item);
    if (ownerTier == null)
        return true;
    return gate === ownerTier;
}

// Explicit per-entry tier wins, else legacy positional slice (1 or 3 = tier) so old content works.
export function sliceDeployablesForTier(combined, ownerActor, optsSource, item = null)
{
    if (!Array.isArray(combined) || combined.length <= 1)
        return combined ?? [];
    const optsOf = (key) => getExtraDeployableOpts(optsSource, key);
    if (combined.some(key => Number(optsOf(key)?.tier ?? 0) > 0))
        return combined.filter(key => linkTierGate(optsOf(key), ownerActor, item));
    const ownerTier = getOwnerTier(ownerActor, item);
    if (ownerTier == null)
        return combined;
    return [combined[Math.max(0, Math.min(combined.length - 1, ownerTier - 1))]];
}

// All deployable keys an item can produce, without the tier slice (membership/recall lookups).
export function getAllItemDeployables(item)
{
    if (!item)
        return [];
    const systemDeployables = item.type === 'frame'
        ? item.system?.core_system?.deployables || []
        : item.system?.deployables || [];
    const extraDeployables = item.getFlag?.('lancer-automations', 'extraDeployables') || [];
    const extraDeployableActors = item.getFlag?.('lancer-automations', 'extraDeployableActors') || [];
    // Dedupe exact-duplicate LIDs so a native deployable re-added via the old flow spawns once.
    return [...new Set([...systemDeployables, ...extraDeployables, ...extraDeployableActors])];
}

/**
 * Effective deployable LIDs for an item: system.deployables + extraDeployables flag, then the NPC tier gate.
 * Explicit per-deployable tier (extraDeployableOpts[key].tier) wins, else the legacy positional 1-or-3 slice.
 * @param {Item} item    The item document
 * @param {Actor} [actor] The owner actor (needed for NPC tier selection)
 * @returns {string[]} Array of deployable LID strings
 */
export function getItemDeployables(item, actor = null)
{
    if (!item)
        return [];
    return sliceDeployablesForTier(getAllItemDeployables(item), actor, item, item);
}



/**
 * Retrieve lancer-automations flags from an item document.
 * @param {Item} item          The Foundry Item document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or an object containing all lancer-automations flags if no key was provided.
 */
export function getItemFlags(item, flagName = null)
{
    if (!item)
    {
        ui.notifications.error("getItemFlags: item is required.");
        return null;
    }
    if (flagName)
        return item.getFlag('lancer-automations', flagName);
    return item.flags?.['lancer-automations'] || {};
}

/**
 * Retrieve lancer-automations flags from an actor document.
 * @param {Actor} actor        The Foundry Actor document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or all lancer-automations flags if no key was provided.
 */
export function getActorFlags(actor, flagName = null)
{
    if (!actor)
    {
        ui.notifications.error("getActorFlags: actor is required.");
        return null;
    }
    if (flagName)
        return actor.getFlag('lancer-automations', flagName);
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
export async function beginDeploymentCard(options = /** @type {any} */({}))
{
    const {
        actor,
        item,
        deployableOptions = []
    } = options;

    if (!actor || !item)
    {
        ui.notifications.warn("Actor and item are required.");
        return null;
    }

    const deployablesArray = getItemDeployables(item, actor);

    if (deployablesArray.length === 0)
    {
        ui.notifications.warn(`No deployables found on ${item.name}.`);
        return null;
    }

    const isFrameCore = item.type === 'frame';
    let hasUses = false;
    let hasRechargeTag = false;
    let isUncharged = false;

    if (!isFrameCore)
    {
        const uses = item.system?.uses;
        hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
        if (hasUses && uses.value <= 0)
        {
            ui.notifications.warn(`${item.name} has no uses remaining.`);
            return null;
        }

        hasRechargeTag = item.system?.tags?.some(tag => tag.lid === "tg_recharge");
        isUncharged = hasRechargeTag && item.system?.charged === false;
        if (isUncharged)
        {
            ui.notifications.warn(`${item.name} is uncharged. You must reload or recharge it before deploying.`);
            return null;
        }
    }

    const allLids = [];
    let totalCount = 0;

    // First range wins, counts sum. Per-deployable extra opts are the next fallback.
    let rangeOpt = null;
    for (let i = 0; i < deployablesArray.length; i++)
    {
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
export async function openDeployableMenu(actor)
{
    if (!actor)
    {
        ui.notifications.warn("No actor specified.");
        return;
    }

    const allSystemsWithDeployables = actor.items.filter(item =>
        getItemDeployables(item, actor).length > 0
    );
    const actorLevelDeployables = getActorDeployables(actor);

    if (allSystemsWithDeployables.length === 0 && actorLevelDeployables.length === 0)
    {
        ui.notifications.warn(`No deployables found for ${actor.name}.`);
        return;
    }

    const items = [];

    for (const system of allSystemsWithDeployables)
    {
        const isFrameCore = system.type === 'frame';
        const deployablesArray = getItemDeployables(system, actor);

        let uses, hasUses, noUsesLeft, hasRechargeTag, needsRecharge;
        if (isFrameCore)
        {
            uses = null;
            hasUses = false;
            noUsesLeft = false;
            hasRechargeTag = false;
            needsRecharge = false;
        }
        else
        {
            uses = system.system.uses;
            hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
            noUsesLeft = hasUses && uses.value <= 0;
            hasRechargeTag = system.system.tags?.some(tag => tag.lid === "tg_recharge");
            needsRecharge = hasRechargeTag && system.system.charged === false;
        }

        for (const lid of deployablesArray)
        {
            const { deployable, source } = await resolveDeployable(lid, actor);

            if (deployable)
            {
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
            }
            else
            {
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

    for (const lid of actorLevelDeployables)
    {
        const { deployable, source } = await resolveDeployable(lid, actor);
        if (deployable)
        {
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
        }
        else
        {
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

    if (items.length === 0)
    {
        ui.notifications.warn(`No deployables available for ${actor.name}.`);
        return;
    }

    let selectedId = items.find(item => !item.disabled)?.id;
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
                callback: async () =>
                {
                    const item = items.find(candidate => candidate.id === selectedId);
                    if (!item || item.disabled || !item.deployableId)
                        return;
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
        render: (html) =>
        {
            html.find('.lancer-item-card:not(.disabled)').on('click', function ()
            {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function ()
            {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.deploy').click();
            });

            html.find('.lancer-item-generate').on('click', async function (event)
            {
                event.stopPropagation();
                const itemId = $(this).data('item-id');
                const item = items.find(candidate => candidate.id === itemId);

                if (!item?.deployableData || !game.user.isGM)
                    return;

                const actorData = item.deployableData.toObject();

                let ownerName = /** @type {string} */ (actor.name || "");
                if (actor.is_mech?.() && actor.system.pilot?.status === "resolved")
                    ownerName = actor.system.pilot.value.system.callsign || actor.system.pilot.value.name;

                const ownerBaseActor = actor.token?.baseActor ?? actor;
                actorData.system.owner = ownerBaseActor.uuid;
                actorData.name = `${item.deployableName} [${ownerName}]`;
                actorData.folder = actor.folder?.id;
                actorData.ownership = foundry.utils.duplicate(actor.ownership);

                actorData.prototypeToken = actorData.prototypeToken || {};
                actorData.prototypeToken.disposition = actor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
                const actorTeam = game.modules.get('token-factions')?.active ? actor.getFlag('token-factions', 'team') : null;
                if (actorTeam !== null)
                {
                    actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                    actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                    actorData.prototypeToken.flags['token-factions'].team = actorTeam;
                }
                actorData.flags = actorData.flags || {};
                _applyDeployableTypeImage(actorData);
                const LancerActor = game.lancer?.LancerActor || Actor;
                const newActor = await LancerActor.create(actorData);
                if (newActor)
                {
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
export async function recallDeployable(ownerToken)
{
    if (!ownerToken?.actor)
    {
        ui.notifications.warn("No valid token selected.");
        return null;
    }

    const ownerActor = ownerToken.actor;
    const deployedTokens = canvas.tokens.placeables.filter(token =>
    {
        const flags = token.document.flags?.['lancer-automations'];
        return flags?.deployedItem && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (deployedTokens.length === 0)
    {
        ui.notifications.warn("No deployed items found for this character.");
        return null;
    }

    // Highlight tokens that lack system.recall in red as a warning.
    const recallHighlights = [];
    for (const token of deployedTokens)
    {
        const tokenActor = token.actor;
        if (!tokenActor?.system?.recall)
        {
            const hl = new PIXI.Graphics();
            hl.lineStyle(gridLineWidth(2), 0xff4444, 0.8);
            hl.beginFill(0xff4444, 0.25);
            if (isHexGrid())
            {
                const offsets = getOccupiedOffsets(token);
                for (const offset of offsets)
                    drawHexAt(hl, offset.col, offset.row);
            }
            else
            {
                const gridSize = canvas.grid.size;
                hl.drawRect(token.document.x, token.document.y,
                    token.document.width * gridSize, token.document.height * gridSize);
            }
            hl.endFill();
            if (canvas.tokens?.parent)
                canvas.tokens.parent.addChildAt(hl, canvas.tokens.parent.getChildIndex(canvas.tokens));
            else
                canvas.stage.addChild(hl).eventMode = 'none';
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

    for (const hl of recallHighlights)
        hl.destroy({ children: true });

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = pickedToken.document?.flags?.['lancer-automations'];
    const deployableName = flags?.deployableName || "Deployable";
    const deployableId = flags?.deployableId;

    if (game.user.isGM)
        await pickedToken.document.delete();
    else
    {
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
export function pickItem(items, options = {})
{
    return new Promise((resolve) =>
    {
        if (!items || items.length === 0)
        {
            ui.notifications.warn("No items available to pick.");
            return resolve(null);
        }

        const choices = items.map(item =>
        {
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
export function getWeapons(entity)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (entity))?.actor || entity);
    if (!actor?.items)
        return [];

    return actor.items.filter(item =>
        item.type === 'mech_weapon' ||
        item.type === 'pilot_weapon' ||
        (item.system?.type?.toLowerCase() === 'weapon')
    );
}

/**
 * Finds an item on an actor by its Lancer ID (lid).
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to search.
 * @param {string} lid - The Lancer ID to find.
 * @returns {Item|null} The item, or null if not found.
 */
export function findItemByLid(actorOrToken, lid)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items)
        return null;
    return actor.items.find(item => item.system?.lid === lid) || null;
}

/**
 * Returns true if the actor (mech / pilot / npc / deployable) has any item whose LID matches.
 * Accepts a single LID string or an array of LIDs (any-match).
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {string|string[]} lidOrLids
 * @returns {boolean}
 */
export function hasItem(actorOrToken, lidOrLids)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items || !lidOrLids)
        return false;
    const lids = Array.isArray(lidOrLids) ? lidOrLids : [lidOrLids];
    if (lids.length === 0)
        return false;
    return actor.items.some(item => lids.includes(item.system?.lid));
}

/**
 * Prompts the user to pick an unloaded weapon from an actor and reloads it.
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to reload weapons for.
 * @param {string} [targetName] - Optional target name for the UI notification.
 * @returns {Promise<Item|null>} The reloaded weapon, or null if cancelled.
 */
export async function reloadOneWeapon(actorOrToken, targetName)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor)
    {
        ui.notifications.warn("No valid actor provided for reloading.");
        return null;
    }

    const weapons = getWeapons(actor);
    const unloadedWeapons = weapons.filter(weapon =>
    {
        const tags = itemAllTags(weapon);
        return tags.some(tag => tag.lid === 'tg_loading') && weapon.system.loaded === false;
    });

    if (unloadedWeapons.length === 0)
    {
        ui.notifications.warn(`${name} has no unloaded weapons to reload!`);
        return null;
    }

    const chosenWeapon = await pickItem(unloadedWeapons, {
        title: "CHOOSE WEAPON TO RELOAD",
        description: `Select which of ${name}'s weapons to reload:`,
        icon: "fas fa-sync",
        formatText: (weapon) => `Reload ${weapon.name}`
    });

    if (chosenWeapon)
    {
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
export async function rechargeSystem(actorOrToken, targetName)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor)
    {
        ui.notifications.warn("No valid actor provided for recharging.");
        return null;
    }

    const depletedItems = actor.items.filter(item =>
    {
        if (item.type === 'mech_weapon' || item.type === 'pilot_weapon')
            return false;
        if (item.system?.type?.toLowerCase() === 'weapon')
            return false;
        const sys = item.system;
        const tags = itemAllTags(sys);
        const hasLimited = tags.some(tag => tag.lid === 'tg_limited');
        const hasRecharge = tags.some(tag => tag.lid === 'tg_recharge');
        if (hasLimited)
        {
            const usesValue = typeof sys.uses === 'number' ? sys.uses : (sys.uses?.value ?? 0);
            if (usesValue <= 0)
                return true;
        }
        if (hasRecharge && sys.charged === false)
            return true;
        return false;
    });

    if (depletedItems.length === 0)
    {
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
    const tags = itemAllTags(sys);
    const hasLimited = tags.some(tag => tag.lid === 'tg_limited');
    const hasRecharge = tags.some(tag => tag.lid === 'tg_recharge');
    const update = /** @type {any} */ ({});

    if (hasLimited)
    {
        if (typeof sys.uses === 'number')
            update['system.uses'] = sys.uses_max ?? sys.max_uses ?? 0;
        else
            update['system.uses.value'] = sys.uses?.max ?? 0;
    }
    if (hasRecharge)
        update['system.charged'] = true;

    await chosen.update(update);
    ui.notifications.info(`${name}'s ${chosen.name} recharged!`);
    return chosen;
}

/**
 * createToken hook handler. With the linkManualDeploy setting on, links a hand-placed
 * deployable token to its owner (auto with one candidate, chooseToken prompt otherwise),
 * then fires onDeploy.
 * @param {TokenDocument} tokenDocument
 */
export async function handleManualDeployLink(tokenDocument, { force = false } = {})
{
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

    // Mech/pilot deployables carry their owner in system.owner.
    const ownerUuidRaw = deployableActor.system?.owner;
    const ownerUuid = typeof ownerUuidRaw === 'string'
        ? ownerUuidRaw
        : (ownerUuidRaw?.id ?? null);
    const directOwner = ownerUuid ? await fromUuid(ownerUuid) : null;
    if (directOwner && (directOwner.type === 'mech' || directOwner.type === 'pilot'))
    {
        ownerActor = directOwner;
        ownerToken = allTokens.find(token => token.actor?.uuid === directOwner.uuid) ?? null;
        if (!ownerToken)
        {
            // Owner has no token on this scene, don't link
            return;
        }
    }
    else
    {
        // NPC path: filter scene tokens whose actor owns an item producing this LID
        const candidateTokens = allTokens.filter(token =>
        {
            if (token.document.id === tokenDocument.id)
                return false;
            if (!token.actor)
                return false;
            return token.actor.items.some(item => getAllItemDeployables(item).includes(deployableLid));
        });

        if (candidateTokens.length === 0)
            return;

        if (candidateTokens.length === 1)
            ownerToken = candidateTokens[0];
        else
        {
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
        getAllItemDeployables(item).includes(deployableLid)
    );
    let systemItem = null;
    if (candidateItems.length === 1)
        systemItem = candidateItems[0];
    else if (candidateItems.length > 1)
    {
        systemItem = await pickItem(candidateItems, {
            title: "LINK DEPLOYABLE",
            description: `Which item deployed ${deployableActor.name}?`,
            icon: "cci cci-deployable",
            relatedToken: ownerToken
        });
    }

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

    const api = game.modules.get('lancer-automations')?.api;
    if (api?.handleTrigger)
    {
        const deployableToken = canvas.tokens.get(tokenDocument.id);
        await api.handleTrigger('onDeploy', {
            triggeringToken: ownerToken,
            item: systemItem,
            deployedTokens: deployableToken ? [deployableToken] : [],
            deployType: "deployable"
        });
    }
}
