import { linkTierGate } from "./tier-gate.js";
import { getLAFlag, setLAFlag } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { setItemFlag, unsetItemFlag } from "../socket.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { applyActionOverlays } from "./action-overlays.js";

/**
 * Get the effective actions for an item, merging system.actions with extra actions
 * stored in the 'lancer-automations.extraActions' flag.
 * @param {Item} item
 * @param {{extraOnly?: boolean}} [opts]  extraOnly: return only LA extra actions (skip system/profile)
 * @returns {Array} Array of action objects
 */
const actionGateCache = new Map();

function compileActionGate(src)
{
    let fn = actionGateCache.get(src);
    if (!fn)
    {
        fn = new Function('actor', 'action', 'item', `return(${src})(actor,action,item);`);
        actionGateCache.set(src, fn);
    }
    return fn;
}

/**
 * True when an action's grantor token is gone from the scene it was granted on.
 * @param {any} action
 * @returns {boolean}
 */
export function isGrantStale(action)
{
    const grant = action?._grant;
    if (!grant?.tokenId)
        return false;
    if (grant.sceneId && grant.sceneId !== canvas.scene?.id)
        return false;
    return !canvas.tokens?.get(grant.tokenId);
}

/**
 * Resolve a granted action's grantor back into live documents.
 * @param {any} actionOrGrant  an action carrying `_grant`, or the grant itself
 * @returns {{ token: Token|null, actor: Actor|null, item: Item|null }|null} null when there is no grant
 */
export function resolveGrant(actionOrGrant)
{
    const grant = actionOrGrant?._grant ?? actionOrGrant;
    if (!grant?.tokenId)
        return null;
    const token = canvas.tokens?.get(grant.tokenId) ?? null;
    const actor = /** @type {any} */ (token)?.actor ?? null;
    const item = grant.itemId ? (actor?.items?.get(grant.itemId) ?? null) : null;
    return { token, actor, item };
}

/**
 * Find a granted extra action on a holder and resolve its grantor in one step.
 * @param {Item|Token|Actor} holder
 * @param {string} name  the action's name
 * @returns {{ action: any, token: Token|null, actor: Actor|null, item: Item|null }|null}
 */
export function findGrantedAction(holder, name)
{
    const action = getActorActions(holder).find((/** @type {any} */ entry) => entry.name === name);
    if (!action)
        return null;
    return { action, ...(resolveGrant(action) ?? { token: null, actor: null, item: null }) };
}

/**
 * Resolve an extra action's runtime gate.
 * @param {any} action
 * @param {Actor|null} actor  the holder
 * @param {Item|null} [item]  the holding item, null for actor-held entries
 * @returns {'visible'|'hidden'|'locked'|'disabled'}
 */
export function resolveActionGate(action, actor, item = null)
{
    if (isGrantStale(action))
        return 'hidden';
    const gate = action?.condition;
    if (!gate)
        return 'visible';
    let result;
    try
    {
        if (typeof gate === 'function')
            result = gate(actor, action, item);
        else if (typeof gate === 'string')
        {
            const src = gate.startsWith('@@fn:') ? gate.slice('@@fn:'.length).trim() : gate.trim();
            result = compileActionGate(src)(actor, action, item);
        }
        else
            return 'visible';
    }
    catch (err)
    {
        console.warn(`lancer-automations | resolveActionGate: condition threw on "${action?.name}"`, err);
        return 'visible';
    }
    if (result === false || result === 'hidden')
        return 'hidden';
    if (result === 'locked' || result === 'disabled')
        return result;
    return 'visible';
}

/**
 * Drop hidden entries and stamp `_gate` on locked / disabled ones.
 * @param {any[]} actions
 * @param {Actor|null} actor
 * @param {Item|null} [item]
 * @returns {any[]}
 */
export function gateActions(actions, actor, item = null)
{
    const out = [];
    for (const action of actions ?? [])
    {
        const gate = resolveActionGate(action, actor, item);
        if (gate === 'hidden')
            continue;
        out.push(gate === 'visible' ? action : { ...action, _gate: gate });
    }
    return out;
}

export function getItemActions(item, opts = {})
{
    if (!item)
        return [];
    const owner = item.parent?.documentName === 'Actor' ? item.parent : null;
    const extraActions = gateActions(
        (getLAFlag(item,'extraActions') || []).filter(action => linkTierGate(action, owner, item)),
        owner,
        item
    );
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

/** @typedef {{ tokenId?: string, actorUuid?: string, itemId?: string, sceneId?: string|null, label?: string }} ActionGrant */

/**
 * Extra action object: LancerAction shape plus an optional TAH icon field.
 * @typedef {LancerAction & { icon?: string, condition?: string|((actor: Actor|null, action: any, item: Item|null) => any), ignoresLineOfSight?: boolean, _grant?: ActionGrant }} ExtraAction
 */

/**
 * Add extra action objects to an item, token, or actor via flags.
 * - Item: stores in item's 'lancer-automations.extraActions' flag (system.actions is read-only)
 * - Token / Actor: stores in actor's 'lancer-automations.extraActions' flag
 * @param {Item|Token|Actor} target         Item, Token, or Actor to attach actions to
 * @param {ExtraAction|ExtraAction[]} actions  A single action object or array of action objects
 * @param {{ grant?: ActionGrant }} [opts]  grant: stamped on every entry that has no `_grant` of its own
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function addExtraActions(target, actions, opts = {})
{
    if (!target)
    {
        ui.notifications.error(localize('LA.notify.addExtraActionsTarget'));
        return null;
    }
    const newActions = Array.isArray(actions) ? actions : [actions];
    if (newActions.length === 0)
        return null;

    // Flags are JSON, so a function-valued gate has to be serialized the way bonus lambdas are.
    for (const action of newActions)
    {
        const actionAny = /** @type {any} */ (action);
        if (typeof actionAny.condition === 'function')
            actionAny.condition = '@@fn:' + actionAny.condition.toString();
        if (!actionAny._grant && opts?.grant)
            actionAny._grant = { ...opts.grant };
        if (actionAny._grant?.tokenId && actionAny._grant.sceneId === undefined)
            actionAny._grant.sceneId = canvas.scene?.id ?? null;
    }

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
                    ui.notifications.warn(localizeFormat('LA.notify.tagsAlreadyOn', { tags: dropped.join(', '), doc: doc.name, action: actionAny.name }));
            }
        }
        for (const action of newActions)
        {
            const actionAny = /** @type {any} */ (action);
            if (!actionAny._sourceItemId)
                actionAny._sourceItemId = doc.id;
        }
    }

    const existing = getLAFlag(doc,'extraActions') || [];
    // Same-name entries keep their stored state, so onInit re-runs stay idempotent.
    // Keyed by grantor too, so two sources granting the same action stay independently revocable.
    const grantKey = (/** @type {any} */ entry) => `${entry.name}|${entry._grant?.tokenId ?? ''}`;
    const existingKeys = new Set(existing.map(grantKey));
    const fresh = newActions.filter(action => !existingKeys.has(grantKey(action)));
    if (!fresh.length)
        return doc;

    await setLAFlag(doc,'extraActions', [...existing, ...fresh]);
    console.log(`lancer-automations | addExtraActions: Added action(s) to ${doc.name}:`, fresh);
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
    return getLAFlag(doc,'extraActions') || [];
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
    const existing = getLAFlag(doc,'extraActions') || [];
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

    await setLAFlag(doc,'extraActions', kept);
}

/**
 * Drop every granted extra action whose grantor token or item is gone. GM only, the writes are direct.
 * @param {{ tokenId?: string|null, itemId?: string|null }} [source]
 * @returns {Promise<void>}
 */
export async function sweepStaleGrants({ tokenId = null, itemId = null } = {})
{
    if (!tokenId && !itemId)
        return;
    const matches = (/** @type {any} */ action) =>
    {
        const grant = action?._grant;
        if (!grant)
            return false;
        return (!!tokenId && grant.tokenId === tokenId) || (!!itemId && grant.itemId === itemId);
    };
    const sweep = async (/** @type {any} */ doc) =>
    {
        if ((getLAFlag(doc,'extraActions') || []).some(matches))
            await removeExtraActions(doc, matches);
    };
    for (const token of (canvas.tokens?.placeables ?? []))
    {
        const actor = /** @type {any} */ (token).actor;
        if (!actor)
            continue;
        await sweep(actor);
        for (const item of (actor.items ?? []))
            await sweep(item);
    }
}

// Spend the consumable state on an actor-level extra action. Returns false when depleted so the caller bails.
export async function consumeExtraAction(actor, actionName)
{
    if (!actor)
        return true;
    const all = getLAFlag(actor,'extraActions') || [];
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
            ui.notifications.warn(localizeFormat('LA.notify.notLoaded', { name: entry.name }));
            return false;
        }
        entry.loaded = false;
        needsWrite = true;
    }
    if (hasRecharge)
    {
        if (entry.charged === false)
        {
            ui.notifications.warn(localizeFormat('LA.notify.uncharged', { name: entry.name }));
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
            ui.notifications.warn(localizeFormat('LA.notify.noUsesLeft', { name: entry.name }));
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
            ui.notifications.warn(localizeFormat('LA.notify.perTurnLimit', { name: entry.name }));
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
            ui.notifications.warn(localizeFormat('LA.notify.perRoundLimit', { name: entry.name }));
            return false;
        }
        entry.usesPerRound = { ...entry.usesPerRound, value: cur - 1 };
        needsWrite = true;
    }

    if (needsWrite)
    {
        const next = all.slice();
        next[idx] = entry;
        await setLAFlag(actor,'extraActions', next);
    }
    return true;
}

// Reset the consumable state on a single actor-level extra action.
export async function reloadExtraAction(actor, actionName)
{
    if (!actor)
        return;
    const all = getLAFlag(actor,'extraActions') || [];
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
        await setLAFlag(actor,'extraActions', next);
    }
}

// True if the item's primary (base) action is hidden in the TAH, leaving only its deployables/extras.
export function isPrimaryActionHidden(item)
{
    return !!(getLAFlag(item,'hidePrimaryAction'));
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
        ui.notifications.error(localize('LA.notify.setHidePrimaryActionItem'));
        return null;
    }
    if (hidden)
        await setItemFlag(item, MODULE_ID,'hidePrimaryAction', true);
    else
        await unsetItemFlag(item, MODULE_ID,'hidePrimaryAction');
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
    const actorList = getLAFlag(actor,'extraActions') || [];
    if (actorList.length)
    {
        const { next, mutated } = rollFor(actorList);
        if (mutated)
            await setLAFlag(actor,'extraActions', next);
    }
    for (const item of (actor.items ?? []))
    {
        const itemList = getLAFlag(item,'extraActions') || [];
        if (!itemList.length)
            continue;
        const { next, mutated } = rollFor(itemList);
        if (mutated)
            await setLAFlag(item,'extraActions', next);
    }
}

// Reset per-round usage (tg_round) on an actor's + items' extra actions. Called at the owner's turn start.
export async function resetPerRoundExtraActionsForActor(actor)
{
    await resetExtraActionUses(actor, 'usesPerRound');
}

export async function resetPerTurnExtraActionsForActor(actor)
{
    await resetExtraActionUses(actor, 'usesPerTurn');
}

async function resetExtraActionUses(actor, field)
{
    if (!actor)
        return;
    const resetList = (list) =>
    {
        let mutated = false;
        const next = list.map(entry =>
        {
            if (entry?.[field]?.max != null && entry[field].value !== entry[field].max)
            {
                mutated = true;
                return { ...entry, [field]: { ...entry[field], value: entry[field].max } };
            }
            return entry;
        });
        return { next, mutated };
    };
    const actorList = getLAFlag(actor,'extraActions') || [];
    if (actorList.length)
    {
        const { next, mutated } = resetList(actorList);
        if (mutated)
            await setLAFlag(actor,'extraActions', next);
    }
    for (const item of (actor.items ?? []))
    {
        const itemList = getLAFlag(item,'extraActions') || [];
        if (!itemList.length)
            continue;
        const { next, mutated } = resetList(itemList);
        if (mutated)
            await setLAFlag(item,'extraActions', next);
    }
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
    return /** @type {any[]} */ (getLAFlag(doc,'extraActions') || []);
}
