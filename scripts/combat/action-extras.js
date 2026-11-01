import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { getStatusLockedFields } from './action-limits.js';
import { isExecutorGM } from '../utils/lancer-token.js';

const USED_FLAG = 'actionExtrasUsed';
const TEMP_FLAG = 'actionExtrasTemp';
export const EXTRA_ACTION_KINDS = ['reaction', 'quick', 'full'];
export const EXTRA_USED_KEYS = ['reaction', 'slots'];
export const SLOT_COST = { quick: 1, full: 2 };
/** @type {(actor: any) => any} */
let grantedProvider = () => ({});

export function setActionExtrasProvider(provider)
{
    grantedProvider = provider;
}

function countsOf(keys, source)
{
    return Object.fromEntries(keys.map(key => [key, Math.max(0, Number(source?.[key]) || 0)]));
}

export function actionExtrasGranted(actor)
{
    return countsOf(EXTRA_ACTION_KINDS, actor ? grantedProvider(actor) : null);
}

export function actionExtrasUsed(actor)
{
    return countsOf(EXTRA_USED_KEYS, getLAFlag(actor, USED_FLAG));
}

function actionExtrasTemp(actor)
{
    return countsOf(EXTRA_USED_KEYS, getLAFlag(actor, TEMP_FLAG));
}

function slotPool(granted)
{
    return granted.quick * SLOT_COST.quick + granted.full * SLOT_COST.full;
}

function extraPool(actor)
{
    const granted = actionExtrasGranted(actor);
    const temp = actionExtrasTemp(actor);
    return { reaction: granted.reaction + temp.reaction, slots: slotPool(granted) + temp.slots };
}

function blockedKinds(actor)
{
    const locked = getStatusLockedFields(actor);
    const blocked = new Set();
    if (locked.has('reaction') || foundry.utils.getProperty(actor?.overrides ?? {}, 'system.action_tracker.reaction') === false)
        blocked.add('reaction');
    if (locked.has('full') || locked.has('quick'))
        blocked.add('slots');
    return blocked;
}

export function actionExtrasLeft(actor)
{
    const pool = extraPool(actor);
    const used = actionExtrasUsed(actor);
    const blocked = blockedKinds(actor);
    return {
        reaction: blocked.has('reaction') ? 0 : Math.max(0, pool.reaction - used.reaction),
        slots: blocked.has('slots') ? 0 : Math.max(0, pool.slots - used.slots)
    };
}

function slotUnits(tracker)
{
    return Math.min(2, (tracker?.full ? 1 : 0) + (tracker?.quick ? 1 : 0));
}

function slotFields(units)
{
    return { full: units >= 2, quick: units >= 1 };
}

export function actionCounts(actor)
{
    const tracker = actor?.system?.action_tracker ?? {};
    const left = actionExtrasLeft(actor);
    const units = slotUnits(tracker);
    const quick = units + left.slots;
    return { reaction: tracker.reaction ? 1 + left.reaction : 0, full: Math.floor(quick / SLOT_COST.full), quick };
}

export function reactionCounts(actor)
{
    const left = actionCounts(actor).reaction;
    const total = 1 + actionExtrasGranted(actor).reaction;
    return { left, total, text: total > 1 || left > total ? `${left}/${total}` : String(left) };
}

function isOwnTurn(actor)
{
    return (game.combats ?? []).some((/** @type {any} */ combat) => combat.started && combat.combatant?.actor?.uuid === actor?.uuid);
}

export function settleSlots(actor, tracker, change)
{
    const used = actionExtrasUsed(actor);
    const units = slotUnits(tracker);
    if (blockedKinds(actor).has('slots'))
        return { fields: slotFields(Math.max(0, Math.min(2, units + change))), used };
    const pool = extraPool(actor).slots;
    const total = Math.max(0, Math.min(2 + pool, units + Math.max(0, pool - used.slots) + change));
    const front = Math.min(2, total);
    used.slots = pool - (total - front);
    return { fields: slotFields(front), used };
}

export function coverSpentActions(actor, tracker, { reaction = true, slots = true } = {})
{
    const left = actionExtrasLeft(actor);
    const used = actionExtrasUsed(actor);
    const next = { ...tracker };
    const fields = [];
    if (reaction && !next.reaction && left.reaction > 0)
    {
        next.reaction = true;
        used.reaction += 1;
        fields.push('reaction');
    }
    if (slots && left.slots > 0 && slotUnits(next) < 2 && isOwnTurn(actor))
    {
        const settled = settleSlots(actor, next, 0);
        Object.assign(next, settled.fields);
        used.slots = settled.used.slots;
        fields.push('full', 'quick');
    }
    return fields.length ? { tracker: next, used, fields } : null;
}

export function refundReactionExtra(actor, tracker)
{
    const used = actionExtrasUsed(actor);
    if (!tracker?.reaction || !used.reaction)
        return null;
    used.reaction -= 1;
    return used;
}

export function trackerSnapshot(actor)
{
    return { ...(actor?.system?.action_tracker ?? {}), extras: actionExtrasUsed(actor) };
}

export function extrasUsedUpdate(used)
{
    return { [`flags.${MODULE_ID}.${USED_FLAG}`]: countsOf(EXTRA_USED_KEYS, used) };
}

export function extrasClearUpdate()
{
    return { ...extrasUsedUpdate({}), [`flags.${MODULE_ID}.${TEMP_FLAG}`]: countsOf(EXTRA_USED_KEYS, {}) };
}

export async function resetActionExtras(actor, keys = EXTRA_USED_KEYS)
{
    if (!actor)
        return;
    const used = actionExtrasUsed(actor);
    const temp = actionExtrasTemp(actor);
    if (!keys.some(key => used[key] || temp[key]))
        return;
    for (const key of keys)
    {
        used[key] = 0;
        temp[key] = 0;
    }
    await actor.update({ ...extrasUsedUpdate(used), [`flags.${MODULE_ID}.${TEMP_FLAG}`]: temp }, { laActionExtras: true });
}

export function isActionAtMax(actor, kind)
{
    const tracker = actor?.system?.action_tracker ?? {};
    const used = actionExtrasUsed(actor);
    if (kind === 'reaction')
        return !!tracker.reaction && !used.reaction;
    if (kind in SLOT_COST)
        return slotUnits(tracker) === 2 && !used.slots;
    return false;
}

export async function addTemporaryAction(actor, kind)
{
    const key = kind === 'reaction' ? 'reaction' : 'slots';
    if (!actor || !(kind === 'reaction' || kind in SLOT_COST))
        return;
    const temp = actionExtrasTemp(actor);
    temp[key] += kind === 'reaction' ? 1 : SLOT_COST[kind];
    await actor.update({ [`flags.${MODULE_ID}.${TEMP_FLAG}`]: temp }, { laActionExtras: true });
}

export async function expireSlotExtras(actor)
{
    if (!actor)
        return;
    const pool = extraPool(actor).slots;
    const used = actionExtrasUsed(actor);
    if (used.slots >= pool)
        return;
    used.slots = pool;
    await actor.update(extrasUsedUpdate(used), { laActionExtras: true });
}

async function resetCombatExtras(combat)
{
    if (!isExecutorGM())
        return;
    for (const combatant of combat?.combatants ?? [])
        await resetActionExtras(combatant.actor);
}

export function initActionExtras()
{
    Hooks.on('updateActor', (actor, changes, options) =>
    {
        if (/** @type {any} */ (options)?.laActionExtras || !isExecutorGM() || !foundry.utils.getProperty(changes, 'system.action_tracker'))
            return;
        const covered = coverSpentActions(actor, actor.system?.action_tracker ?? {});
        if (!covered)
            return;
        const trackerUpdate = Object.fromEntries(covered.fields.map(field => [`system.action_tracker.${field}`, covered.tracker[field]]));
        actor.update(/** @type {any} */ ({ ...trackerUpdate, ...extrasUsedUpdate(covered.used) }), /** @type {any} */ ({ laActionExtras: true }));
    });
    Hooks.on('combatStart', resetCombatExtras);
    Hooks.on('deleteCombat', resetCombatExtras);
}
