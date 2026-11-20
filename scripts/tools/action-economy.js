import { isCombatant } from "../utils/lancer-token.js";
import { updateRouted } from "./routed-update.js";
import { billingToken } from "../interactive/deployable-owner.js";
import { coverSpentActions, refundReactionExtra, settleSlots, spendQuickOnly, freeUsedChange, SLOT_COST, actionExtrasUsed, extrasUsedUpdate, isActionAtMax, addTemporaryAction, trackerSnapshot } from "../combat/action-extras.js";
import { getModuleSetting } from "./settings-utils.js";
import { localizeFormat } from "./string-utils.js";

// Reaction spends in flight, so a second reaction evaluated before the update lands already sees it gone.
const _reactionSpendPending = new Set();
const RESERVE_TIMEOUT_MS = 10000;
let _reserveHook = null;

export function hasReactionAvailable(target)
{
    const tokenOrActor = billingToken(target);
    const actor = tokenOrActor?.actor || tokenOrActor;
    const inCombat = isCombatant(tokenOrActor);

    if (!inCombat)
        return true;
    if (actor?.uuid && _reactionSpendPending.has(actor.uuid))
        return false;
    if (actor?.statuses?.has('preparing'))
        return false;

    const reaction = actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && Number(reaction) > 0;
}

export function reserveReaction(target)
{
    const tokenOrActor = billingToken(target);
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

export async function consumeReaction(target)
{
    const tokenOrActor = billingToken(target);
    const actor = tokenOrActor?.actor || tokenOrActor;
    if (actor?.type === 'deployable')
        return true;
    if (!actor || !hasReactionAvailable(tokenOrActor))
        return false;
    _reactionSpendPending.add(actor.uuid);

    try
    {
        const left = (actor.system.action_tracker.reaction ?? 1) - 1;
        const covered = coverSpentActions(actor, { ...actor.system.action_tracker, reaction: left }, { slots: false });
        await updateRouted(actor, covered
            ? { 'system.action_tracker.reaction': true, ...extrasUsedUpdate(covered.used) }
            : { 'system.action_tracker.reaction': left }, { laActionExtras: true });
    }
    finally
    {
        _reactionSpendPending.delete(actor.uuid);
    }

    return true;
}

let _heldReactionHook = null;

export function setHeldReactionHook(fn)
{
    _heldReactionHook = fn;
}

export async function runHeldReactionHook(target)
{
    await _heldReactionHook?.(target);
}

/**
 * @param {Token|Actor} target
 * @param {{ held?: boolean }} [options] held: a prepared action, its Preparing status ends with the spend
 * @returns {Promise<{ before: any, after: any } | null>} the tape entry tracker, null when nothing was spent
 */
export async function spendReactionForTape(target, { held = false } = {})
{
    if (held)
        await runHeldReactionHook(target);
    if (!getModuleSetting('consumeReaction'))
        return null;

    const tokenOrActor = billingToken(target);
    const actor = tokenOrActor?.actor || tokenOrActor;
    const before = trackerSnapshot(actor);

    if (!(await consumeReaction(target)))
    {
        ui.notifications.warn(localizeFormat('LA.notify.noReactionAvailable', { name: tokenOrActor?.name ?? actor?.name ?? '?' }));
        return null;
    }

    return { before, after: trackerSnapshot(actor) };
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

const ACTIVATION_SPEND = { 'Quick': 'quick', 'Quick Action': 'quick', 'Quick Tech': 'quick', 'Invade': 'quick', 'Full': 'full', 'Full Action': 'full', 'Full Tech': 'full', 'Reaction': 'reaction', 'Protocol': 'protocol', 'Free': 'free' };

export function activationSpendKind(activation)
{
    return ACTIVATION_SPEND[activation] ?? null;
}

export function activationSpendKinds(activation)
{
    return String(activation ?? '').split('/').map(activationSpendKind).filter(Boolean);
}

/** Mirrors Lancer's modAction cascade. spend=true consumes, spend=false refunds. */
export async function modifyAction(target, kind, spend = true)
{
    const actorOrToken = billingToken(target);
    const actor = actorOrToken?.actor ?? actorOrToken;
    if (!actor || actor.type === 'deployable')
        return null;

    const before = { ...(actor.system?.action_tracker ?? {}) };
    const usedBefore = actionExtrasUsed(actor);
    const actionTracker = /** @type {any} */ ({ ...before });
    let extraChange = null;

    switch (kind)
    {
        case 'free':
            actionTracker.free = !spend;
            extraChange = freeUsedChange(actor, spend);
            break;
        case 'quick':

        case 'full':
        {
            const quickOnly = spend && kind === 'quick' ? spendQuickOnly(actor) : null;

            if (quickOnly)
            {
                extraChange = quickOnly;
                break;
            }

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
