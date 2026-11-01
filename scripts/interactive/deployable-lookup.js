import { getLAFlags } from "../tools/flag-utils.js";

// Unlinked tokens share a base actor and the deployable stores the base uuid, so match the base too or a 2nd token of the same NPC makes a duplicate.
function _deployableOwnerMatches(ownerRef, ownerActor)
{
    if (!ownerActor)
        return false;
    const ownerId = typeof ownerRef === 'string' ? ownerRef : ownerRef?.id;
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
export async function stampDeployableSource(tokens, sourceItem)
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
            const uuid = getLAFlags(token?.document)?.sourceItemUuid;
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
 * Cache lid -> { name, img, activation, type }, filled lazily by `getDeployableInfo`.
 * @type {Map<string, { name: string, img: string, activation: string | null, type: string | null } | null>}
 */
const _deployableInfoCache = new Map();

function _findWorldDeployable(lid, ownerActor)
{
    const candidates = /** @type {any[]} */ (game.actors?.contents ?? []).filter(
        actor => actor.type === 'deployable' && actor.system?.lid === lid
    );
    if (!candidates.length)
        return null;
    if (ownerActor)
    {
        const owned = candidates.find(actor => _deployableOwnerMatches(actor.system?.owner, ownerActor));
        if (owned)
            return owned;
    }
    return candidates[0];
}

/**
 * Synchronous read from the deployable info cache (populated by `getDeployableInfo`).
 * Returns null if not yet cached, call `getDeployableInfo` first to warm it.
 * @param {string} lid
 * @returns {{ name: string, img: string, activation: string | null, type: string | null } | null}
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
 * Returns a plain `{ name, img, activation, type }` object, never the full Actor to keep it lightweight.
 *
 * @param {string} lid
 * @param {any} [ownerActor] - Used by resolveDeployable for folder search
 * @returns {Promise<{ name: string, img: string, activation: string | null, type: string | null } | null>}
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
