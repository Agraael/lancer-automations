/* global game, canvas, foundry, Hooks */

const MODULE_ID = 'lancer-automations';
const RESTORE_FLAG = 'actionTrackerRestore';

// brace / dazed: 1 quick action only (Lancer "prefer full, then quick" spend logic means
// full=false + quick=true allows exactly one quick before quick flips to false).
const ACTION_LIMITING_EFFECTS = [
    { statusId: 'brace',                          locks: ['protocol', 'full'],            actionLocks: ['Overcharge', 'Overcharge (NPC)'] },
    { statusId: 'dazed',                          locks: ['protocol', 'full', 'reaction', 'free'], actionLocks: ['Overcharge', 'Overcharge (NPC)'] },
    { statusId: 'DeadRings_statuses_staggered',   locks: ['protocol', 'reaction', 'free'], actionLocks: ['Overcharge', 'Overcharge (NPC)'] },
    { statusId: 'slow',                           locks: [],                              actionLocks: ['Boost'] },
];
const ALL_LOCKABLE_FIELDS = ['protocol', 'full', 'quick', 'reaction', 'free'];
export const LIMITING_STATUS_IDS = new Set(ACTION_LIMITING_EFFECTS.map(e => e.statusId));

export function isStaleStatusSource(source)
{
    return typeof source === 'string' && (source.startsWith('status:') || LIMITING_STATUS_IDS.has(source));
}

// Manual actor-lock entries: legacy plain string, or { id, reason? }.
export function lockEntryId(entry)
{
    return typeof entry === 'string' ? entry : String(entry?.id ?? '');
}

export function lockEntryLabel(entry)
{
    if (typeof entry === 'string')
        return entry;
    return String(entry?.reason || entry?.id || '');
}

// Item-held locks (actionLocks item flag), live only while the item is owned and active.
export function getItemActionLocks(actor, actionName = null)
{
    const out = [];
    for (const item of actor?.items ?? [])
    {
        if (item.system?.destroyed || item.system?.disabled)
            continue;
        for (const lock of (item.getFlag?.('lancer-automations', 'actionLocks') ?? []))
        {
            if (!lock?.actionName || (actionName && lock.actionName !== actionName))
                continue;
            out.push({ item, actionName: lock.actionName, reason: lock.reason ?? null });
        }
    }
    return out;
}

function typeLockApplies(lock, activation, actionName)
{
    const types = (lock?.types ?? []).map(type => String(type).toLowerCase());
    if (!types.includes('*') && !types.includes(String(activation ?? '').toLowerCase()))
        return false;
    return !(actionName && (lock.except ?? []).some(name => String(name) === String(actionName)));
}

// Item-held type locks (actionTypeLocks item flag), live only while the item is owned and active.
export function getItemActionTypeLocks(actor, actionName = null, activation = null)
{
    if (!activation)
        return [];
    const out = [];
    for (const item of actor?.items ?? [])
    {
        if (item.system?.destroyed || item.system?.disabled)
            continue;
        for (const lock of (item.getFlag?.('lancer-automations', 'actionTypeLocks') ?? []))
        {
            if (typeLockApplies(lock, activation, actionName))
                out.push({ item, actionName, activation, reason: lock.reason ?? null });
        }
    }
    return out;
}

// Actor-held type locks (lockedActionTypes actor flag), keyed by activation type.
export function getActorActionTypeLocks(actor, actionName = null, activation = null)
{
    if (!activation)
        return [];
    const byType = /** @type {Record<string,any[]>} */ (actor?.getFlag?.('lancer-automations', 'lockedActionTypes')) ?? {};
    const out = [];
    for (const [type, entries] of Object.entries(byType))
    {
        for (const entry of (entries ?? []))
        {
            if (typeLockApplies({ types: [type], except: entry?.except }, activation, actionName))
                out.push(entry);
        }
    }
    return out;
}

export function getFieldLockingStatuses(actor, field)
{
    if (!field || !actor?.statuses)
        return [];
    return ACTION_LIMITING_EFFECTS
        .filter(effect => effect.locks?.includes(field) && actor.statuses.has(effect.statusId))
        .map(effect => effect.statusId);
}

// Inverse lookup: action name -> status IDs that disable it. Built once.
const STATUS_DISABLING_ACTION = (() =>
{
    const actionToStatuses = {};
    for (const { statusId, actionLocks } of ACTION_LIMITING_EFFECTS)
    {
        for (const name of (actionLocks ?? []))
        {
            if (!actionToStatuses[name])
                actionToStatuses[name] = [];
            actionToStatuses[name].push(statusId);
        }
    }
    return actionToStatuses;
})();

export function getActionLockInfo(actor, actionName, activation = null)
{
    const statuses = (STATUS_DISABLING_ACTION[actionName] ?? []).filter(statusId => actor?.statuses?.has?.(statusId));
    const tracker = /** @type {any[]} */ ((actor?.getFlag?.('lancer-automations', 'lockedActions') ?? {})[actionName] ?? []);
    const sources = [
        ...tracker.filter(entry => !isStaleStatusSource(lockEntryId(entry))),
        ...getActorActionTypeLocks(actor, actionName, activation)
    ];
    const itemLocks = [...getItemActionLocks(actor, actionName), ...getItemActionTypeLocks(actor, actionName, activation)];
    return { statuses, sources, itemLocks };
}

export function isActionDisabledByStatus(actor, actionName)
{
    const statuses = STATUS_DISABLING_ACTION[actionName];
    if (!statuses)
        return false;
    const actorStatuses = actor?.statuses;
    if (!actorStatuses)
        return false;
    return statuses.some(statusId => actorStatuses.has(statusId));
}

function _hasStatus(actor, statusId)
{
    return !!actor?.statuses?.has(statusId);
}

export function getStatusLockedFields(actor)
{
    const locked = new Set();
    for (const { statusId, locks } of ACTION_LIMITING_EFFECTS)
    {
        if (!locks?.length || !_hasStatus(actor, statusId))
            continue;
        for (const field of locks)
            locked.add(field);
    }
    return locked;
}

export async function refreshActionLimits(token, { turnStart = false } = {})
{
    const actor = token?.actor;
    if (!actor)
        return;
    const lockedFields = new Set();
    for (const { statusId, locks } of ACTION_LIMITING_EFFECTS)
    {
        if (!locks?.length)
            continue;
        if (!_hasStatus(actor, statusId))
            continue;
        for (const field of locks)
            lockedFields.add(field);
    }
    const prevRestore = actor.getFlag(MODULE_ID, RESTORE_FLAG) ?? {};
    const restore = { ...prevRestore };
    const tracker = actor.system?.action_tracker ?? {};
    const updates = {};
    for (const field of ALL_LOCKABLE_FIELDS)
    {
        const isLocked = lockedFields.has(field);
        const hadCapture = field in prevRestore;
        if (isLocked)
        {
            // First lock or turn-start re-capture records the current "natural" value.
            if (!hadCapture || turnStart)
                restore[field] = tracker[field] ?? false;
            if (tracker[field] !== false)
                updates[`system.action_tracker.${field}`] = false;
        }
        else if (hadCapture)
        {
            if (tracker[field] !== prevRestore[field])
                updates[`system.action_tracker.${field}`] = prevRestore[field];
            delete restore[field];
        }
    }
    const restoreChanged = !foundry.utils.objectsEqual(prevRestore, restore);
    if (restoreChanged && Object.keys(restore).length > 0)
        updates[`flags.${MODULE_ID}.${RESTORE_FLAG}`] = restore;
    if (Object.keys(updates).length > 0)
        await actor.update(updates, { _laActionLimits: true });
    if (restoreChanged && Object.keys(restore).length === 0)
        await actor.unsetFlag(MODULE_ID, RESTORE_FLAG);
}

function _findTokenForActor(actor)
{
    if (!actor)
        return null;
    if (actor.token)
        return actor.token.object ?? canvas.tokens.get(actor.token.id);
    return canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
}

function _resolveActorToken(effect)
{
    if (!game.users.activeGM?.isSelf)
        return null;
    const actor = effect?.parent;
    if (!actor || actor.documentName !== 'Actor')
        return null;
    return _findTokenForActor(actor);
}

async function _cleanupStaleStatusLocks()
{
    if (!game.users.activeGM?.isSelf)
        return;
    for (const actor of game.actors ?? [])
    {
        const locks = actor.getFlag(MODULE_ID, 'lockedActions');
        if (!locks || typeof locks !== 'object')
            continue;
        const next = {};
        let changed = false;
        for (const [name, sources] of Object.entries(locks))
        {
            const sourcesArray = Array.isArray(sources) ? sources : [];
            const kept = sourcesArray.filter(source => !isStaleStatusSource(source));
            if (kept.length !== sourcesArray.length)
                changed = true;
            if (kept.length)
                next[name] = kept;
        }
        if (changed)
        {
            console.log(`LA action-limits cleanup: ${actor.name} had stale status: locks`, locks, '→', next);
            if (Object.keys(next).length)
                await actor.setFlag(MODULE_ID, 'lockedActions', next);
            else
                await actor.unsetFlag(MODULE_ID, 'lockedActions');
        }
    }
}

export function registerActionLimitsHooks()
{
    Hooks.once('ready', () =>
    {
        _cleanupStaleStatusLocks();
    });
    Hooks.on('createActiveEffect', async (effect) =>
    {
        const token = _resolveActorToken(effect);
        if (token)
            await refreshActionLimits(token);
    });
    Hooks.on('deleteActiveEffect', async (effect) =>
    {
        const token = _resolveActorToken(effect);
        if (token)
            await refreshActionLimits(token);
    });
    // Self-heal stale capture (e.g. effect removed via DB/migration).
    Hooks.on('updateActor', async (actor, _changes, options) =>
    {
        if (options?._laActionLimits)
            return;
        if (!game.users.activeGM?.isSelf)
            return;
        const hasCapture = !!actor.getFlag(MODULE_ID, RESTORE_FLAG);
        const hasLimiting = ACTION_LIMITING_EFFECTS.some(e => e.locks?.length && _hasStatus(actor, e.statusId));
        if (!hasCapture && !hasLimiting)
            return;
        const token = _findTokenForActor(actor);
        if (token)
            await refreshActionLimits(token);
    });
    // Catch Lancer's turn-start refill (and any other actor.update touching action_tracker)
    // BEFORE commit so locked fields land at false in the same write. No blink.
    Hooks.on('preUpdateActor', (actor, changes, options) =>
    {
        if (options?._laActionLimits)
            return;
        const trackerChange = foundry.utils.getProperty(changes, 'system.action_tracker');
        if (!trackerChange)
            return;
        const lockedFields = new Set();
        for (const { statusId, locks } of ACTION_LIMITING_EFFECTS)
        {
            if (!locks?.length)
                continue;
            if (!_hasStatus(actor, statusId))
                continue;
            for (const field of locks)
                lockedFields.add(field);
        }
        if (!lockedFields.size)
            return;
        const prevRestore = actor.getFlag(MODULE_ID, RESTORE_FLAG) ?? {};
        const restore = { ...prevRestore };
        let restoreChanged = false;
        for (const field of lockedFields)
        {
            if (!(field in trackerChange))
                continue;
            if (restore[field] !== trackerChange[field])
            {
                restore[field] = trackerChange[field];
                restoreChanged = true;
            }
            trackerChange[field] = false;
        }
        if (restoreChanged)
            foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${RESTORE_FLAG}`, restore);
    });
}
