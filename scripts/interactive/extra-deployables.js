import { getDeployableInfoSync } from "./deployable-lookup.js";
import { getOwnerTier, linkTierGate } from "./tier-gate.js";
import { getItemFlags } from "./document-flags.js";
import { getLAFlag, setLAFlag } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { localize, localizeFormat } from "../tools/string-utils.js";

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
    const map = getLAFlag(doc,'extraDeployableOpts') || {};
    return map[_encodeOptsKey(key)] ?? null;
}

export async function setExtraDeployableOpts(target, key, opts)
{
    if (!target || !key)
        return null;
    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);
    const map = { ...(getLAFlag(doc,'extraDeployableOpts') || {}) };
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
    await setLAFlag(doc,'extraDeployableOpts', map);
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
            range = actor?.type === 'pilot' ? 5 : (game.modules.get(MODULE_ID)?.api?.getSensorRange_WithBonus?.(actor) ?? actor?.system?.sensor_range ?? 10);
    }
    return { range: Math.max(1, range), count };
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
        ui.notifications.error(localize('LA.notify.addExtraDeploymentLidsTarget'));
        return null;
    }
    const rawList = Array.isArray(lids) ? lids : [lids];
    const entries = rawList.map(entry => (typeof entry === 'string' ? { lid: entry } : entry));
    if (entries.length === 0 || entries.some(entry => typeof entry?.lid !== 'string'))
    {
        ui.notifications.error(localize('LA.notify.addExtraDeploymentLidsEntry'));
        return null;
    }
    const newLids = entries.map(entry => entry.lid);

    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    const existingFlags = getLAFlag(doc,'extraDeployables') || [];
    const merged = [...new Set([...existingFlags, ...newLids])];

    if (merged.length !== existingFlags.length)
    {
        await setLAFlag(doc,'extraDeployables', merged);
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
    const uiMarker = getLAFlag(doc,'extraDeployableLidsViaUI') || [];
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
        await setLAFlag(doc,'extraDeployableLidsViaUI', [...uiMarker, ...addedMarkers]);

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
        ui.notifications.error(localize('LA.notify.addExtraDeploymentActorTarget'));
        return null;
    }
    const inputs = Array.isArray(actors) ? actors : [actors];
    if (inputs.length === 0)
    {
        ui.notifications.error(localize('LA.notify.addExtraDeploymentActorActors'));
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
            ui.notifications.warn(localizeFormat('LA.notify.addExtraDeploymentActorSkip', { input: typeof input === 'string' ? input : input?.name }));
            continue;
        }
        validUuids.push(uuid);
    }
    if (validUuids.length === 0)
        return null;

    const anyTarget = /** @type {any} */ (target);
    const doc = (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);

    const existing = getLAFlag(doc,'extraDeployableActors') || [];
    const merged = [...new Set([...existing, ...validUuids])];

    if (merged.length !== existing.length)
    {
        await setLAFlag(doc,'extraDeployableActors', merged);
        console.log(`lancer-automations | addExtraDeploymentActor: Added actor UUID(s) to ${doc.name}:`, validUuids);
    }

    const uiMarker = getLAFlag(doc,'extraDeployableActorsViaUI') || [];
    const mergedMarker = [...new Set([...uiMarker, ...merged])];
    if (mergedMarker.length !== uiMarker.length)
        await setLAFlag(doc,'extraDeployableActorsViaUI', mergedMarker);

    return doc;
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

    const existing = getLAFlag(doc,'extraDeployableActors') || [];
    const kept = existing.filter(uuid => !removeSet.has(uuid));
    let mutated = kept.length !== existing.length;
    if (mutated)
        await setLAFlag(doc,'extraDeployableActors', kept);

    const uiMarkers = getLAFlag(doc,'extraDeployableActorsViaUI') || [];
    const keptMarkers = uiMarkers.filter(uuid => !removeSet.has(uuid));
    if (keptMarkers.length !== uiMarkers.length)
    {
        await setLAFlag(doc,'extraDeployableActorsViaUI', keptMarkers);
        mutated = true;
    }

    if (mutated)
        console.log(`lancer-automations | removeExtraDeploymentActor: Removed actor UUID(s) from ${doc.name}:`, [...removeSet]);
    return doc;
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
        ...(getLAFlag(doc,'extraDeployables') || []),
        ...(getLAFlag(doc,'extraDeployableActors') || []),
    ];
    return keys.filter(key => linkTierGate(getExtraDeployableOpts(doc, key), doc));
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
        ...(getLAFlag(doc,'extraDeployables') || []),
        ...(getLAFlag(doc,'extraDeployableActors') || []),
    ];
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
    const extraDeployables = getLAFlag(item,'extraDeployables') || [];
    const extraDeployableActors = getLAFlag(item,'extraDeployableActors') || [];
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
