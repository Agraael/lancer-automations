import { isCombatant } from "../utils/lancer-token.js";
import { coverSpentActions, refundReactionExtra, settleSlots, SLOT_COST, actionExtrasUsed, extrasUsedUpdate, isActionAtMax, addTemporaryAction } from "../combat/action-extras.js";

// Reaction spends in flight, so a second reaction evaluated before the update lands already sees it gone.
const _reactionSpendPending = new Set();
const RESERVE_TIMEOUT_MS = 10000;
let _reserveHook = null;

export function hasReactionAvailable(tokenOrActor)
{
    const actor = tokenOrActor?.actor || tokenOrActor;
    const inCombat = isCombatant(tokenOrActor);
    if (!inCombat)
        return true;
    if (actor?.uuid && _reactionSpendPending.has(actor.uuid))
        return false;
    const reaction = actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && Number(reaction) > 0;
}

export function reserveReaction(tokenOrActor)
{
    const actor = tokenOrActor?.actor || tokenOrActor;
    if (!actor?.uuid)
        return;
    _reactionSpendPending.add(actor.uuid);
    if (_reserveHook === null)
    {
        _reserveHook = Hooks.on('updateActor', (updated, changes) =>
        {
            if (foundry.utils.getProperty(changes, 'system.action_tracker.reaction') !== undefined)
                _reactionSpendPending.delete(updated.uuid);
        });
    }
    setTimeout(() => _reactionSpendPending.delete(actor.uuid), RESERVE_TIMEOUT_MS);
}

export async function consumeReaction(tokenOrActor)
{
    const actor = tokenOrActor?.actor || tokenOrActor;
    if (!actor || !hasReactionAvailable(tokenOrActor))
        return false;
    _reactionSpendPending.add(actor.uuid);
    try
    {
        const left = (actor.system.action_tracker.reaction ?? 1) - 1;
        const covered = coverSpentActions(actor, { ...actor.system.action_tracker, reaction: left }, { slots: false });
        await actor.update(covered
            ? { 'system.action_tracker.reaction': true, ...extrasUsedUpdate(covered.used) }
            : { 'system.action_tracker.reaction': left }, { laActionExtras: true });
    }
    finally
    {
        _reactionSpendPending.delete(actor.uuid);
    }
    return true;
}

/**
 * Sets reaction availability for an actor.
 * @param {Token|Actor} actorOrToken
 * @param {boolean} value  true = reaction available, false = reaction spent
 * @returns {Promise<void>}
 */
export async function setReaction(actorOrToken, value)
{
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor)
        return;
    await actor.update({ "system.action_tracker.reaction": Boolean(value) });
}

const ACTIVATION_SPEND = { 'Quick': 'quick', 'Quick Tech': 'quick', 'Invade': 'quick', 'Full': 'full', 'Full Tech': 'full', 'Reaction': 'reaction', 'Protocol': 'protocol' };

export function activationSpendKind(activation)
{
    return ACTIVATION_SPEND[activation] ?? null;
}

/** Mirrors Lancer's modAction cascade. spend=true consumes, spend=false refunds. */
export async function modifyAction(actorOrToken, kind, spend = true)
{
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor)
        return null;
    const before = { ...(actor.system?.action_tracker ?? {}) };
    const usedBefore = actionExtrasUsed(actor);
    const actionTracker = /** @type {any} */ ({ ...before });
    let extraChange = null;
    switch (kind)
    {
        case 'free':
            actionTracker.free = !spend;
            break;
        case 'quick':
        case 'full':
        {
            const settled = settleSlots(actor, before, (spend ? -1 : 1) * SLOT_COST[kind]);
            Object.assign(actionTracker, settled.fields);
            extraChange = settled.used;
            break;
        }
        case 'protocol':
            actionTracker.protocol = !spend;
            break;
        case 'reaction':
            actionTracker.reaction = !spend;
            break;
        case 'move':
            actionTracker.move = spend ? 0 : (actor.system?.speed ?? 0);
            break;
        default:
            actionTracker[kind] = !spend;
    }
    if (spend && kind !== 'protocol')
        actionTracker.protocol = false;
    let after = actionTracker;
    if (kind === 'reaction')
    {
        const covered = spend ? coverSpentActions(actor, actionTracker, { slots: false }) : null;
        after = covered?.tracker ?? actionTracker;
        extraChange = covered?.used ?? (spend ? null : refundReactionExtra(actor, before));
    }
    await actor.update(/** @type {any} */ ({ 'system.action_tracker': after, ...(extraChange ? extrasUsedUpdate(extraChange) : {}) }), { laActionExtras: true });
    return { before: { ...before, extras: usedBefore }, after: { ...after, extras: extraChange ?? usedBefore } };
}

export async function consumeAction(actorOrToken, kind)
{
    return modifyAction(actorOrToken, kind, true);
}

export async function gainAction(actorOrToken, kind)
{
    return modifyAction(actorOrToken, kind, false);
}

export async function restoreAction(actorOrToken, kind)
{
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor)
        return null;
    if (!isActionAtMax(actor, kind))
        return modifyAction(actor, kind, false);
    await addTemporaryAction(actor, kind);
    return null;
}
