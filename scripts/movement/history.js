/* global game, Hooks, canvas, libWrapper, foundry */

const MODULE_ID = 'lancer-automations';
const SETTING_CLEAR_ON_TURN = 'historyClearOnTurn';
const SETTING_CLEAR_ON_ROUND = 'historyClearOnRound';

import { clearMoveTracking } from './move-tracking.js';

function asTokenDoc(tokenLike)
{
    if (!tokenLike)
        return null;
    return tokenLike.document ?? tokenLike;
}

function laDebug()
{
    try
    {
        return !!game.settings.get(MODULE_ID, 'debugMovement');
    }
    catch
    {
        return false;
    }
}

export function getLastMoveDistance(tokenLike)
{
    const doc = asTokenDoc(tokenLike);
    return doc?.movement?.history?.recorded?.cost ?? 0;
}

export function getRecordedWaypoints(tokenLike)
{
    const doc = asTokenDoc(tokenLike);
    return doc?.movement?.history?.recorded?.waypoints ?? [];
}

export async function clearTokenMovementHistory(tokenLike)
{
    const doc = asTokenDoc(tokenLike);
    if (!doc?.clearMovementHistory)
        return false;
    if (!doc.isOwner)
        return false;
    await doc.clearMovementHistory();
    return true;
}

function samePosition(waypointA, waypointB)
{
    return waypointA.x === waypointB.x
        && waypointA.y === waypointB.y
        && waypointA.elevation === waypointB.elevation
        && waypointA.width === waypointB.width
        && waypointA.height === waypointB.height;
}

// Reversed waypoint list retracing the reverted move; null when nothing to retrace.
function buildRevertWaypoints(doc, history, priorIdx)
{
    const rawSegment = history.slice(priorIdx);
    if (rawSegment.length < 2)
        return null;

    // keep prior and current position, skip per-cell intermediates and stalls
    const segment = [];
    for (let idx = 0; idx < rawSegment.length; idx++)
    {
        const waypoint = rawSegment[idx];
        if (idx !== 0 && idx !== rawSegment.length - 1 && waypoint.intermediate)
            continue;
        if (segment.length > 0 && samePosition(segment.at(-1), waypoint))
            continue;
        segment.push(waypoint);
    }
    if (segment.length < 2)
        return null;

    const validActions = CONFIG?.Token?.movement?.actions ?? {};
    const waypoints = [];
    for (let idx = segment.length - 2; idx >= 0; idx--)
    {
        const target = segment[idx];
        // segment idx -> idx+1 is retraced with the action it was walked with
        const forwardAction = segment[idx + 1].action;
        waypoints.push({
            x: target.x,
            y: target.y,
            elevation: target.elevation,
            width: target.width ?? doc.width,
            height: target.height ?? doc.height,
            shape: target.shape ?? doc.shape,
            ...(forwardAction in validActions ? { action: forwardAction } : {}),
            snapped: target.snapped ?? false,
            explicit: false,
            checkpoint: idx === 0
        });
    }
    return waypoints.length > 0 ? waypoints : null;
}

// Native undo() without args reverts the OLDEST move; we want the latest.
export async function revertLastMovement(tokenLike)
{
    const doc = asTokenDoc(tokenLike);
    if (!doc)
        return true;
    if (!doc.isOwner)
        return false;
    const history = doc._source?._movementHistory ?? [];
    if (history.length === 0)
        return true;

    const lastMovementId = history.at(-1).movementId;
    const startIdx = history.findIndex(waypoint => waypoint.movementId === lastMovementId);
    const priorIdx = Math.max(startIdx - 1, 0);
    const prior = history[priorIdx];

    const trimmedHistory = history.slice(0, startIdx).map(waypoint => ({
        ...waypoint,
        cost: waypoint.cost === Infinity ? null : waypoint.cost
    }));

    const update = {
        x: prior.x,
        y: prior.y,
        elevation: prior.elevation,
        width: prior.width ?? doc.width,
        height: prior.height ?? doc.height,
        shape: prior.shape ?? doc.shape,
        _movementHistory: trimmedHistory
    };

    // isUndo takes these waypoints verbatim; method must stay implicit ("undo")
    let revertWaypoints = null;
    try
    {
        revertWaypoints = buildRevertWaypoints(doc, history, priorIdx);
    }
    catch (err)
    {
        console.warn('lancer-automations | revertLastMovement waypoint build failed', err);
    }

    const options = { isUndo: true, diff: false, animate: true };
    if (revertWaypoints)
        options.movement = { [doc.id]: { waypoints: revertWaypoints } };

    const before = history.length;
    try
    {
        await doc.update(update, options);
    }
    catch (err)
    {
        if (!revertWaypoints)
            throw err;
        // straight-line fallback, same as the pre-retrace behavior
        console.warn('lancer-automations | revertLastMovement retrace rejected, falling back', err);
        await doc.update(update, { isUndo: true, diff: false, animate: true });
    }
    const after = doc._source?._movementHistory?.length ?? 0;
    if (laDebug())
    {
        console.log('lancer-automations | revertLastMovement', {
            tokenId: doc.id,
            lastMovementId,
            before,
            after,
            prior: { x: prior.x, y: prior.y, elevation: prior.elevation }
        });
    }
    return after === 0;
}

async function clearCombatantsHistory(combat, full = false)
{
    if (!game.user?.isGM)
        return;
    for (const c of combat?.combatants ?? [])
    {
        const doc = c.token;
        if (!doc)
            continue;
        try
        {
            if ((doc._source?._movementHistory?.length ?? 0) > 0)
                await doc.clearMovementHistory();
            if (full)
                await clearMoveTracking(doc);
        }
        catch
        { /* ignore */ }
    }
}

// Native requires combat.started; relax to any combatant so pre-combat setup records.
Hooks.once('setup', () =>
{
    const proto = foundry.documents.TokenDocument.prototype;
    proto._shouldRecordMovementHistory = function()
    {
        return !!this.combatant;
    };
});

Hooks.on('recordToken', (tokenDoc) =>
{
    const len = tokenDoc?._source?._movementHistory?.length ?? 0;
    if (laDebug())
        console.log('lancer-automations | recordToken fired', { tokenId: tokenDoc?.id, historyLen: len });
});

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SETTING_CLEAR_ON_TURN, {
        name: 'Clear movement history on turn change',
        hint: 'When a combatant\'s turn ends, wipe their recorded movement trail.',
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
    game.settings.register(MODULE_ID, SETTING_CLEAR_ON_ROUND, {
        name: 'Clear movement history on round change',
        hint: 'At the start of each new round, wipe every combatant\'s recorded movement trail.',
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
});


Hooks.on('combatStart', async (combat) =>
{
    await clearCombatantsHistory(combat);
});

Hooks.on('combatRound', async (combat, _changed, opts) =>
{
    if (opts?.direction !== 1)
        return;
    if (!game.settings.get(MODULE_ID, SETTING_CLEAR_ON_ROUND))
        return;
    await clearCombatantsHistory(combat);
});

Hooks.on('combatTurnChange', async (combat, prior, _current) =>
{
    if (!game.user?.isGM)
        return;
    if (!game.settings.get(MODULE_ID, SETTING_CLEAR_ON_TURN))
        return;
    const priorToken = prior?.tokenId ? canvas.scene?.tokens?.get(prior.tokenId) : null;
    if (priorToken)
    {
        try
        {
            await priorToken.clearMovementHistory();
        }
        catch
        { /* ignore */ }
    }
});

Hooks.on('deleteCombat', async (combat) =>
{
    await clearCombatantsHistory(combat, true);
});

Hooks.on('deleteCombatant', async (combatant) =>
{
    if (!game.user?.isGM)
        return;
    const doc = combatant?.token;
    if (!doc)
        return;
    try
    {
        if ((doc._source?._movementHistory?.length ?? 0) > 0)
            await doc.clearMovementHistory();
        await clearMoveTracking(doc);
    }
    catch
    { /* ignore */ }
});
