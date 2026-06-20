/* global game, canvas, foundry, Hooks */

const MODULE_ID = 'lancer-automations';
const RESTORE_FLAG = 'actionTrackerRestore';

// brace / dazed: 1 quick action only (Lancer "prefer full, then quick" spend logic means
// full=false + quick=true allows exactly one quick before quick flips to false).
const ACTION_LIMITING_EFFECTS = [
    { statusId: 'brace',                          locks: ['protocol', 'full'],            actionLocks: ['Overcharge', 'Overcharge (NPC)'] },
    { statusId: 'dazed',                          locks: ['protocol', 'full'],            actionLocks: ['Overcharge', 'Overcharge (NPC)'] },
    { statusId: 'DeadRings_statuses_staggered',   locks: ['protocol', 'reaction', 'free'] },
    { statusId: 'slow',                           locks: [],                              actionLocks: ['Boost'] },
];
const ALL_LOCKABLE_FIELDS = ['protocol', 'full', 'quick', 'reaction', 'free'];
export const LIMITING_STATUS_IDS = new Set(ACTION_LIMITING_EFFECTS.map(e => e.statusId));

export function isStaleStatusSource(s) {
    return typeof s === 'string' && (s.startsWith('status:') || LIMITING_STATUS_IDS.has(s));
}

// Inverse lookup: action name -> status IDs that disable it. Built once.
const STATUS_DISABLING_ACTION = (() => {
    const m = {};
    for (const { statusId, actionLocks } of ACTION_LIMITING_EFFECTS) {
        for (const name of (actionLocks ?? [])) {
            if (!m[name])
                m[name] = [];
            m[name].push(statusId);
        }
    }
    return m;
})();

export function getActionLockInfo(actor, actionName) {
    const statuses = (STATUS_DISABLING_ACTION[actionName] ?? []).filter(s => actor?.statuses?.has?.(s));
    const tracker = /** @type {Record<string,string[]>} */(actor?.getFlag?.('lancer-automations', 'lockedActions') ?? {})[actionName] ?? [];
    const sources = tracker.filter(s => !isStaleStatusSource(s));
    return { statuses, sources };
}

export function isActionDisabledByStatus(actor, actionName) {
    const statuses = STATUS_DISABLING_ACTION[actionName];
    if (!statuses)
        return false;
    const has = actor?.statuses;
    if (!has)
        return false;
    return statuses.some(s => has.has(s));
}

function _hasStatus(actor, statusId) {
    return !!actor?.statuses?.has(statusId);
}

export async function refreshActionLimits(token, { turnStart = false } = {}) {
    const actor = token?.actor;
    if (!actor)
        return;
    const lockedFields = new Set();
    for (const { statusId, locks } of ACTION_LIMITING_EFFECTS) {
        if (!locks?.length)
            continue;
        if (!_hasStatus(actor, statusId))
            continue;
        for (const f of locks)
            lockedFields.add(f);
    }
    const prevRestore = actor.getFlag(MODULE_ID, RESTORE_FLAG) ?? {};
    const restore = { ...prevRestore };
    const tracker = actor.system?.action_tracker ?? {};
    const updates = {};
    for (const field of ALL_LOCKABLE_FIELDS) {
        const isLocked = lockedFields.has(field);
        const hadCapture = field in prevRestore;
        if (isLocked) {
            // First lock or turn-start re-capture records the current "natural" value.
            if (!hadCapture || turnStart)
                restore[field] = tracker[field] ?? false;
            if (tracker[field] !== false)
                updates[`system.action_tracker.${field}`] = false;
        } else if (hadCapture) {
            if (tracker[field] !== prevRestore[field]) {
                updates[`system.action_tracker.${field}`] = prevRestore[field];
            }
            delete restore[field];
        }
    }
    const restoreChanged = !foundry.utils.objectsEqual(prevRestore, restore);
    if (restoreChanged && Object.keys(restore).length > 0) {
        updates[`flags.${MODULE_ID}.${RESTORE_FLAG}`] = restore;
    }
    if (Object.keys(updates).length > 0) {
        await actor.update(updates, { _laActionLimits: true });
    }
    if (restoreChanged && Object.keys(restore).length === 0) {
        await actor.unsetFlag(MODULE_ID, RESTORE_FLAG);
    }
}

function _findTokenForActor(actor) {
    if (!actor)
        return null;
    if (actor.token)
        return actor.token.object ?? canvas.tokens.get(actor.token.id);
    return canvas.tokens.placeables.find(t => t.actor?.id === actor.id) ?? null;
}

function _resolveActorToken(effect) {
    if (!game.users.activeGM?.isSelf)
        return null;
    const actor = effect?.parent;
    if (!actor || actor.documentName !== 'Actor')
        return null;
    return _findTokenForActor(actor);
}

async function _cleanupStaleStatusLocks() {
    if (!game.users.activeGM?.isSelf)
        return;
    for (const actor of game.actors ?? []) {
        const locks = actor.getFlag(MODULE_ID, 'lockedActions');
        if (!locks || typeof locks !== 'object')
            continue;
        const next = {};
        let changed = false;
        for (const [name, sources] of Object.entries(locks)) {
            const arr = Array.isArray(sources) ? sources : [];
            const kept = arr.filter(s => !isStaleStatusSource(s));
            if (kept.length !== arr.length)
                changed = true;
            if (kept.length)
                next[name] = kept;
        }
        if (changed) {
            console.log(`LA action-limits cleanup: ${actor.name} had stale status: locks`, locks, '→', next);
            if (Object.keys(next).length)
                await actor.setFlag(MODULE_ID, 'lockedActions', next);
            else
                await actor.unsetFlag(MODULE_ID, 'lockedActions');
        }
    }
}

export function registerActionLimitsHooks() {
    Hooks.once('ready', () => {
        _cleanupStaleStatusLocks();
    });
    Hooks.on('createActiveEffect', async (effect) => {
        const token = _resolveActorToken(effect);
        if (token)
            await refreshActionLimits(token);
    });
    Hooks.on('deleteActiveEffect', async (effect) => {
        const token = _resolveActorToken(effect);
        if (token)
            await refreshActionLimits(token);
    });
    // Self-heal stale capture (e.g. effect removed via DB/migration).
    Hooks.on('updateActor', async (actor, _changes, options) => {
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
    Hooks.on('preUpdateActor', (actor, changes, options) => {
        if (options?._laActionLimits)
            return;
        const trackerChange = foundry.utils.getProperty(changes, 'system.action_tracker');
        if (!trackerChange)
            return;
        const lockedFields = new Set();
        for (const { statusId, locks } of ACTION_LIMITING_EFFECTS) {
            if (!locks?.length)
                continue;
            if (!_hasStatus(actor, statusId))
                continue;
            for (const f of locks)
                lockedFields.add(f);
        }
        if (!lockedFields.size)
            return;
        const prevRestore = actor.getFlag(MODULE_ID, RESTORE_FLAG) ?? {};
        const restore = { ...prevRestore };
        let restoreChanged = false;
        for (const field of lockedFields) {
            if (!(field in trackerChange))
                continue;
            if (restore[field] !== trackerChange[field]) {
                restore[field] = trackerChange[field];
                restoreChanged = true;
            }
            trackerChange[field] = false;
        }
        if (restoreChanged) {
            foundry.utils.setProperty(changes, `flags.${MODULE_ID}.${RESTORE_FLAG}`, restore);
        }
    });
}
