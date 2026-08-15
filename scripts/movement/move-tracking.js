import { moveTokenTo } from "./move-api.js";
import { isForceFreeMovement } from "./keybindings.js";
import { parseAction } from "./movement-actions.js";
import { consumeAction, executeSimpleActivation } from "../tools/misc-tools.js";
import * as actionFX from "../fx/actionFX.js";
import { handleTrigger } from "../activations/reactions-engine.js";
import { cancelRulerDrag, startChoiceCard, getTokenOwnerUserId, drawMovementTrace } from "../interactive/index.js";
import { splitPathAtCosts, legUsable } from "./path-replay.js";
import { findEffectOnToken } from "../bonuses/flagged-effects.js";

// Bridges multi-segment moves where preUpdateToken fires per-segment.
export const _moveHistoryCache = new Map();

// Per-mover action stack for chained move/activation sequences. New push wipes the previous one.
/**
 * @typedef {Object} MoveStackFrame
 * @property {'awaitMove'|'awaitActivation'} kind
 * @property {string} [matchActionName]
 * @property {() => Promise<void>} [onSatisfy]
 */
/**
 * @typedef {Object} MoveStack
 * @property {string} tokenId
 * @property {number} cursor
 * @property {MoveStackFrame[]} frames
 * @property {ReturnType<typeof setTimeout>} [_timer]
 */
/** @type {MoveStack | null} */
let _activeMoveStack = null;
const _MOVE_STACK_TIMEOUT_MS = 5000;
const _MOVE_STACK_INTER_DELAY_MS = 1000;

export function _isActiveMoveStackFor(tokenId)
{
    return !!(_activeMoveStack && _activeMoveStack.tokenId === tokenId);
}

export function _wipeMoveStack()
{
    if (!_activeMoveStack)
        return;
    if (_activeMoveStack._timer)
        clearTimeout(_activeMoveStack._timer);
    _activeMoveStack = null;
}

function _pushMoveStack(tokenId, frames)
{
    _wipeMoveStack();
    _activeMoveStack = { tokenId, cursor: 0, frames };
    _activeMoveStack._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
}

export async function _advanceMoveStack(kind, tokenId, cancelled, ctx = {})
{
    const stack = _activeMoveStack;
    if (!stack || stack.tokenId !== tokenId)
        return;
    const frame = stack.frames[stack.cursor];
    if (!frame || frame.kind !== kind)
        return;
    if (frame.matchActionName && ctx.actionName !== frame.matchActionName)
        return;
    if (cancelled)
    {
        _wipeMoveStack(); return;
    }
    const onSatisfy = frame.onSatisfy;
    stack.cursor++;
    // Wall-clock safety timer: reset on progress.
    if (stack._timer)
        clearTimeout(stack._timer);
    stack._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
    if (stack.cursor >= stack.frames.length)
        _wipeMoveStack();
    if (onSatisfy)
    {
        try
        {
            // Inter-action grace period: lets async side-effects from the just-completed frame settle before the next fires.
            await new Promise(resolve => setTimeout(resolve, _MOVE_STACK_INTER_DELAY_MS));
            await onSatisfy();
        }
        catch (err)
        {
            console.error('lancer-automations | move stack onSatisfy failed', err); _wipeMoveStack();
        }
    }
}

function _getMoveHistoryDoc(tokenOrId)
{
    if (typeof tokenOrId === 'string')
        return canvas.tokens.get(tokenOrId)?.document ?? null;
    return tokenOrId?.document ?? tokenOrId ?? null;
}

function _getMoveHistoryData(tokenOrId)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
}

function _writeMoveHistory(tokenDoc, data)
{
    if (!tokenDoc)
        return;
    const tokenId = tokenDoc.id ?? tokenDoc._id;
    if (tokenId)
        _moveHistoryCache.set(tokenId, data);
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', data);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.moveHistory': data });
}

function _writeMovementCap(tokenDoc, value)
{
    if (!tokenDoc)
        return;
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.movementCap', value);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.movementCap': value });
}

export function clearMoveData(tokenOrId)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const tokenId = doc.id ?? doc._id;
    if (tokenId)
        _moveHistoryCache.delete(tokenId);
    foundry.utils.setProperty(doc.flags, 'lancer-automations.moveHistory', null);
    if (doc.isOwner)
        doc.update({ 'flags.lancer-automations.-=moveHistory': null });
    initMovementCap(doc);
}

export async function clearMoveTracking(tokenOrId)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const tokenId = doc.id ?? doc._id;
    if (tokenId)
        _moveHistoryCache.delete(tokenId);
    const hadHistory = doc.getFlag('lancer-automations', 'moveHistory') != null;
    const hadCap = doc.getFlag('lancer-automations', 'movementCap') != null;
    foundry.utils.setProperty(doc.flags, 'lancer-automations.moveHistory', null);
    foundry.utils.setProperty(doc.flags, 'lancer-automations.movementCap', null);
    if ((hadHistory || hadCap) && doc.isOwner)
    {
        await doc.update({
            'flags.lancer-automations.-=moveHistory': null,
            'flags.lancer-automations.-=movementCap': null,
        });
    }
}

// Tag a Boost so reverting the move it enabled refunds the cap raise.
export function recordBoostCast(tokenOrId, speed)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc || !(speed > 0))
        return;
    const data = doc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const boostCasts = [...(data.boostCasts ?? []), { atMoveIndex: (data.moves ?? []).length, speed }];
    _writeMoveHistory(doc, { ...data, boostCasts });
}

export function undoMoveData(tokenOrId, _distance)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const data = doc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const moves = data.moves || [];
    const newLength = Math.max(0, moves.length - 1);
    let capRefund = 0;
    const boostCasts = [];
    for (const cast of (data.boostCasts ?? []))
    {
        if (moves.length > 0 && cast.atMoveIndex === newLength)
            capRefund += cast.speed ?? 0;
        else if (cast.atMoveIndex > newLength)
            boostCasts.push({ ...cast, atMoveIndex: newLength });
        else
            boostCasts.push(cast);
    }
    _writeMoveHistory(doc, { ...data, moves: moves.slice(0, -1), boostCasts });
    if (capRefund > 0)
        _writeMovementCap(doc, Math.max(0, getMovementCap(tokenOrId) - capRefund));
}

export function getCumulativeMoveData(tokenOrId)
{
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(move => !move.isFreeMovement).reduce(
        (acc, move) => ({ moved: acc.moved + move.distanceMoved, cost: acc.cost + (move.movementCost ?? move.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

export function getIntentionalMoveData(tokenOrId)
{
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(move => move.isDrag && !move.isFreeMovement).reduce(
        (acc, move) => ({ moved: acc.moved + move.distanceMoved, cost: acc.cost + (move.movementCost ?? move.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

export function getMovementCap(tokenOrId)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'movementCap') ?? 0;
}

// Used by the token-ruler overlay to look up which past waypoints belong to free/debug moves.
export function getMoveDataList(tokenOrId)
{
    const data = _getMoveHistoryData(tokenOrId);
    return data.moves || [];
}

export function getMovementHistory(tokenOrId)
{
    const data = _getMoveHistoryData(tokenOrId);
    const moves = data.moves || [];
    if (moves.length === 0)
        return { exists: false };
    let totalMoved = 0;
    let totalCost = 0;
    let intentionalRegularMoved = 0;
    let intentionalRegularCost = 0;
    let intentionalFreeMoved = 0;
    let intentionalFreeCost = 0;
    let unintentionalMoved = 0;
    let unintentionalCost = 0;
    let boostCount = 0;
    const startPosition = moves[0].startPos;

    for (const move of moves)
    {
        const moved = move.distanceMoved;
        const cost = move.movementCost ?? move.distanceMoved;
        totalMoved += moved;
        totalCost += cost;
        if (move.isDrag)
        {
            if (move.isFreeMovement)
            {
                intentionalFreeMoved += moved;
                intentionalFreeCost += cost;
            }
            else
            {
                intentionalRegularMoved += moved;
                intentionalRegularCost += cost;
            }
            if (move.boostSet && move.boostSet.length > 0)
                boostCount += move.boostSet.length;
        }
        else
        {
            unintentionalMoved += moved;
            unintentionalCost += cost;
        }
    }

    return {
        exists: true,
        totalMoved,
        totalCost,
        intentional: {
            total: intentionalRegularMoved + intentionalFreeMoved,
            totalCost: intentionalRegularCost + intentionalFreeCost,
            regular: intentionalRegularMoved,
            regularCost: intentionalRegularCost,
            free: intentionalFreeMoved,
            freeCost: intentionalFreeCost
        },
        unintentional: unintentionalMoved,
        unintentionalCost,
        nbBoostUsed: boostCount,
        startPosition,
        movementCap: getMovementCap(tokenOrId)
    };
}

export function initMovementCap(token)
{
    const doc = _getMoveHistoryDoc(token);
    if (!doc)
        return;
    const tokenId = doc.id ?? doc._id;
    const isInCombat = !!game.combat?.combatants.find(combatant => combatant.token?.id === tokenId);
    if (!isInCombat)
        return;
    const isImmobilized = !!findEffectOnToken(token, 'immobilized');
    const speed = isImmobilized ? 0 : (token.actor?.system?.speed ?? 0);
    _writeMovementCap(doc, speed);
}

export function increaseMovementCap(tokenOrId, value)
{
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    _writeMovementCap(doc, getMovementCap(tokenOrId) + value);
}

function _clearCapRuler(token)
{
    try
    {
        token.document.stopMovement?.();
    }
    catch (err)
    {
        console.warn('lancer-automations | stopMovement after cap cancel failed', err);
    }
    try
    {
        token.ruler?.clear?.();
    }
    catch (err)
    {
        console.warn('lancer-automations | ruler clear after cap cancel failed', err);
    }
    token.document.update({}, { animate: false, diff: false, noHook: true })
        .then(() => token.renderFlags?.set?.({ refreshRuler: true, refreshState: true }))
        .catch(err => console.warn('lancer-automations | ruler teardown after cap cancel failed', err));
}

/** Cancels a cap-exceeding move, then offers Boost&Move (any actor) or Overcharge+Boost&Move (mech-only); each accepted offer pushes a move stack. */
export function _handleMovementCapExceeded(token, ctx)
{
    const { options, change, startPos, endPos, moveInfo, moveToMovementCost, moveIsFreeMovement, triggerData, intentPath, intentEndPos } = ctx;
    const capDetect = game.settings.get('lancer-automations', 'enableMovementCapDetection');
    const boostOffer = game.settings.get('lancer-automations', 'enableBoostOffer');
    const isTokenInCombat = !!game.combat?.combatants.find(combatant => combatant.token?.id === token.id);
    if (options.ignoreMovementCap
        || (!capDetect && !boostOffer)
        || !isTokenInCombat || moveIsFreeMovement || moveToMovementCost <= 0)

        return;


    const cap = getMovementCap(token);
    const history = getMovementHistory(token);
    const spent = history.exists ? history.intentional.regularCost : 0;
    if (!(spent <= cap && spent + moveToMovementCost > cap))
        return;

    let freeKey = '[free movement key]';
    try
    {
        freeKey = game.keybindings.get('lancer-automations', 'freeMovement')?.[0]?.key ?? freeKey;
    }
    catch
    { /* not registered yet */ }
    const speed = token.actor?.system?.speed ?? 0;
    const isMech = token.actor?.type === 'mech';
    const npcOvercharge = !isMech && token.actor?.type === 'npc'
        ? (token.actor.getFlag('lancer-automations', 'extraActions') || []).find(a => a.name === 'Overcharge (NPC)')
        : null;
    const need = spent + moveToMovementCost;
    const canBoost = speed > 0 && need <= (cap + speed);
    const canOvercharge = (isMech || !!npcOvercharge) && speed > 0 && need > (cap + speed) && need <= (cap + speed * 2);
    const overchargeActionName = isMech ? 'Overcharge' : 'Overcharge (NPC)';

    options.ignoreMovementCap = true;
    triggerData.cancelTriggeredMove._engineCancel = true;

    triggerData.cancel();
    cancelRulerDrag(token, moveInfo);

    const finalX = intentEndPos?.x ?? change.x ?? endPos.x;
    const finalY = intentEndPos?.y ?? change.y ?? endPos.y;
    const finalElev = intentEndPos?.elevation ?? change.elevation;
    const capOriginalAction = options.movement?.[token.id]?.waypoints?.find(waypoint => waypoint?.action)?.action;
    const finalDest = { x: finalX, y: finalY, elevation: finalElev, action: capOriginalAction };
    const origWaypoints = intentPath ?? [];
    const finalPath = origWaypoints.length ? origWaypoints : [finalDest];

    const fireBoost = () => executeSimpleActivation(token.actor, {
        title: 'Boost',
        action: { name: 'Boost', activation: 'Quick' },
        detail: 'Move your speed.',
    });
    const fireOvercharge = async () =>
    {
        if (isMech)
        {
            const OverchargeFlow = game.lancer?.flows?.get?.('OverchargeFlow');
            if (OverchargeFlow)
            {
                const flow = new OverchargeFlow(token.actor.uuid);
                await flow.begin();
            }
            return;
        }
        // NPC path: fire 'Overcharge (NPC)' action; its built-in reaction handles it.
        await executeSimpleActivation(token.actor, {
            title: 'Overcharge (NPC)',
            action: { name: 'Overcharge (NPC)', activation: 'Protocol' },
            detail: npcOvercharge?.detail || '',
        });
    };
    const computeMid = (/** @type {number} */ cost) =>
    {
        const ratio = moveToMovementCost > 0 ? Math.max(0, cost / moveToMovementCost) : 0;
        const snapped = token.getSnappedPosition({
            x: startPos.x + (endPos.x - startPos.x) * ratio,
            y: startPos.y + (endPos.y - startPos.y) * ratio,
        });
        if (capOriginalAction)
            snapped.action = capOriginalAction;
        return snapped;
    };

    if (canBoost && boostOffer && !options._skipBoostOffer)
    {
        const remaining = cap - spent;
        const snapMid = remaining > 0 ? computeMid(remaining) : null;
        const capLegs = remaining > 0 ? splitPathAtCosts(token, origWaypoints, startPos, [remaining], capOriginalAction) : null;
        const splitTail = !!(capLegs && capLegs[1]?.length);
        const usePathSplit = splitTail && legUsable(capLegs[0], startPos);
        const midLeg = usePathSplit ? capLegs[0] : (splitTail ? null : snapMid);
        const finalLeg = splitTail ? capLegs[1] : (remaining > 0 ? finalDest : finalPath);
        (async () =>
        {
            const moveTrace = drawMovementTrace(token, finalDest, null, { path: origWaypoints });
            let result;
            try
            {
                result = await startChoiceCard({
                    title: 'BOOST & MOVE',
                    icon: 'modules/lancer-automations/icons/speedometer.svg',
                    description: `Movement exceeds cap (${need}/${cap}). Boost adds +${speed}.`,
                    originToken: token,
                    userIdControl: getTokenOwnerUserId(token),
                    traceData: { tokenId: token.id, endPos: finalDest, newEndPos: null, path: origWaypoints },
                    choices: [
                        { text: 'Boost & Move', icon: 'modules/lancer-automations/icons/speedometer.svg' },
                        { text: 'Ignore', icon: 'fas fa-forward' },
                    ]
                });
            }
            finally
            {
                if (moveTrace?.parent)
                    moveTrace.parent.removeChild(moveTrace);
                moveTrace?.destroy();
            }
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1)
            {
                // Ignore: do the move anyway, bypassing the cap (and any further offer).
                await _rulerMove(token, finalPath, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
                return;
            }
            if (choiceIdx !== 0)
            {
                _clearCapRuler(token);
                return;
            }
            const fireFinalLeg = () => _rulerMove(token, finalLeg, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            if (midLeg)
            {
                // Cap not yet exhausted: leg1 -> Boost -> leg2.
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await _rulerMove(token, midLeg, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            }
            else
            {
                // Cap already exhausted: skip leg1, fire Boost immediately.
                _pushMoveStack(token.id, [
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await fireBoost();
            }
        })();
    }
    else if (canOvercharge && boostOffer && !options._skipBoostOffer)
    {
        // 3-leg: leg1 -> Boost -> leg2 -> Overcharge -> Boost -> leg3; skip leg1 if cap exhausted.
        const remaining = cap - spent;
        const mid1 = remaining > 0 ? computeMid(remaining) : null;
        const mid2 = computeMid(remaining + speed);
        const ocLegs = splitPathAtCosts(token, origWaypoints, startPos, remaining > 0 ? [remaining, remaining + speed] : [remaining + speed], capOriginalAction);
        const ocSecondRaw = ocLegs ? (remaining > 0 ? ocLegs[1] : ocLegs[0]) : null;
        const ocThirdRaw = ocLegs ? (remaining > 0 ? ocLegs[2] : ocLegs[1]) : null;
        const ocPrevEnd = remaining > 0 ? (ocLegs?.[0]?.at(-1) ?? startPos) : startPos;
        const useOcLegs = !!(ocSecondRaw?.length && ocThirdRaw?.length && legUsable(ocSecondRaw, ocPrevEnd));
        const ocFirstLeg = useOcLegs ? (remaining > 0 && legUsable(ocLegs[0], startPos) ? ocLegs[0] : null) : mid1;
        const ocSecondLeg = useOcLegs ? ocSecondRaw : mid2;
        const ocFinalLeg = useOcLegs ? ocThirdRaw : finalDest;
        (async () =>
        {
            const moveTrace = drawMovementTrace(token, finalDest, null, { path: origWaypoints });
            let result;
            try
            {
                result = await startChoiceCard({
                    title: 'OVERCHARGE & BOOST & MOVE',
                    icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg',
                    description: `Movement exceeds cap+boost (${need}/${cap + speed}). Overcharge grants an extra Boost (+${speed}).`,
                    originToken: token,
                    userIdControl: getTokenOwnerUserId(token),
                    traceData: { tokenId: token.id, endPos: finalDest, newEndPos: null, path: origWaypoints },
                    choices: [
                        { text: 'Overcharge & Boost & Move', icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg' },
                        { text: 'Ignore', icon: 'fas fa-forward' },
                    ]
                });
            }
            finally
            {
                if (moveTrace?.parent)
                    moveTrace.parent.removeChild(moveTrace);
                moveTrace?.destroy();
            }
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1)
            {
                await _rulerMove(token, finalPath, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
                return;
            }
            if (choiceIdx !== 0)
            {
                _clearCapRuler(token);
                return;
            }
            const mid2Move = () => _rulerMove(token, ocSecondLeg, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            const finalMove = () => _rulerMove(token, ocFinalLeg, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            const tailFrames = [
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: mid2Move },
                { kind: 'awaitMove', onSatisfy: fireOvercharge },
                { kind: 'awaitActivation', matchActionName: overchargeActionName, onSatisfy: fireBoost },
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: finalMove },
                { kind: 'awaitMove' }
            ];
            if (ocFirstLeg)
            {
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    ...tailFrames
                ]);
                await _rulerMove(token, ocFirstLeg, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            }
            else
            {
                _pushMoveStack(token.id, tailFrames);
                await fireBoost();
            }
        })();
    }
    else
    {
        triggerData.cancelTriggeredMove(
            `Movement exceeds cap (${need} > ${cap}) and cannot be covered by Boost or Overcharge. ` +
            `Hold <b>${freeKey}</b> for free movement.`
        );
    }
}

/** Move a token from code. `useRuler` routes through Token.move() (Lancer cost rules apply); else TokenDocument.update for an exact land. */
export async function _rulerMove(token, destination, extraOpts = {})
{
    const { useRuler, ...passthroughOpts } = extraOpts;
    if (useRuler)
        await moveTokenTo(token, destination, passthroughOpts);
    else
    {
        const endPoint = Array.isArray(destination) ? destination[destination.length - 1] : destination;
        const update = { x: endPoint.x, y: endPoint.y };
        if (endPoint.elevation !== undefined)
            update.elevation = endPoint.elevation;
        // No implicit isDrag; caller opts in via passthroughOpts for cap consumption.
        await token.document.update(update, passthroughOpts);
    }
}

export function _computeMoveData(options, startPos, endPos, elevationFallback = 0, tokenDoc = null)
{
    const isFreeMovement = !!options.lancerFreeMovement || isForceFreeMovement() || (tokenDoc ? _moveHasFreeAction(tokenDoc, options) : false);
    const sceneDist = canvas.scene?.grid?.distance ?? 1;

    // Knockback/teleport set a forced cost via these options.
    if (options.lancerSegmentDistance !== undefined)
    {
        const distanceMoved = Math.max(0, Math.round(options.lancerSegmentCost - (options.lancerTerrainPenalty ?? 0)));
        const movementCost = Math.round(options.lancerSegmentCost);
        return { distanceMoved, movementCost, isFreeMovement, costOverridden: true };
    }

    const moveOp = options?._movement?.[tokenDoc?.id];
    if (moveOp?.passed)
    {
        const cost = Number(moveOp.passed.cost);
        const dist = Number(moveOp.passed.distance);
        if (Number.isFinite(cost))
        {
            const movementCost = Math.round(cost / sceneDist);
            const distanceMoved = Number.isFinite(dist) ? Math.round(dist / sceneDist) : movementCost;
            return { distanceMoved, movementCost, isFreeMovement };
        }
    }

    if (tokenDoc?.measureMovementPath)
    {
        try
        {
            const wpStart = {
                x: startPos.x,
                y: startPos.y,
                elevation: startPos.elevation ?? tokenDoc.elevation ?? 0,
                width: tokenDoc.width,
                height: tokenDoc.height
            };
            const wpEnd = {
                x: endPos.x,
                y: endPos.y,
                elevation: endPos.elevation ?? wpStart.elevation,
                width: tokenDoc.width,
                height: tokenDoc.height
            };
            const result = tokenDoc.measureMovementPath([wpStart, wpEnd]);
            const cost = Number(result?.cost) || 0;
            const terrainPenalty = Number(result?.lancerTerrainPenalty) || 0;
            const movementCost = Math.round(cost / sceneDist);
            const distanceMoved = Math.max(0, Math.round((cost - terrainPenalty) / sceneDist));
            return { distanceMoved, movementCost, isFreeMovement };
        }
        catch
        { /* fall through */ }
    }

    const dist2D = Math.round(canvas.grid.measurePath([startPos, endPos], {}).distance / sceneDist);
    const distanceMoved = dist2D + Math.floor(elevationFallback);
    return { distanceMoved, movementCost: distanceMoved, isFreeMovement };
}

export function _moveHasForcedAction(document, options)
{
    const executedWaypoints = options?._movement?.[document.id]?.passed?.waypoints;
    const requestWaypoints = options?.movement?.[document.id]?.waypoints;
    const requestForced = (Array.isArray(requestWaypoints) && requestWaypoints.some(waypoint => waypoint?.action === 'forced'))
        || (Array.isArray(options?.waypoints) && options.waypoints.some(waypoint => waypoint?.action === 'forced'))
        || !!options?.forceUnintentional;
    if (Array.isArray(executedWaypoints))
    {
        const executedForced = executedWaypoints.some(waypoint => waypoint?.action === 'forced');
        if (requestForced && !executedForced)
        {
            console.warn('LA | forced marker on request channels but not in executed path', {
                tokenId: document.id,
                movementId: options._movement[document.id].id,
                requestWaypoints,
                topLevelWaypoints: options.waypoints,
                forceUnintentional: options.forceUnintentional
            });
        }
        return executedForced;
    }
    return requestForced;
}

export function _moveHasFreeAction(document, options)
{
    const executedWaypoints = options?._movement?.[document.id]?.passed?.waypoints;
    if (Array.isArray(executedWaypoints))
        return executedWaypoints.some(waypoint => parseAction(waypoint?.action).free);
    const requestWaypoints = options?.movement?.[document.id]?.waypoints;
    return Array.isArray(requestWaypoints) && requestWaypoints.some(waypoint => parseAction(waypoint?.action).free);
}

export function _moveHasTeleportAction(document, options)
{
    const movementActions = CONFIG.Token?.movement?.actions;
    const isTeleportAction = (actionKey) => !!movementActions?.[actionKey]?.teleport;
    const executedWaypoints = options?._movement?.[document.id]?.passed?.waypoints;
    if (Array.isArray(executedWaypoints))
        return executedWaypoints.some(waypoint => isTeleportAction(waypoint?.action));
    const requestWaypoints = options?.movement?.[document.id]?.waypoints;
    return Array.isArray(requestWaypoints) && requestWaypoints.some(waypoint => isTeleportAction(waypoint?.action));
}

export async function handleTokenMove(document, change, options, userId)
{
    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return true;
    if (options.isUndo)
        return true;

    const token = canvas.tokens.get(document.id);
    if (!token)
        return;

    const startPos = { x: document.x, y: document.y, elevation: document.elevation };
    const endPos = { x: change.x ?? document.x, y: change.y ?? document.y, elevation: change.elevation ?? document.elevation };
    const elevationMoved = change.elevation ?? document.elevation;

    const v13Method = options.movement?.[document.id]?.method;
    const isForceMovement = _moveHasForcedAction(document, options);
    const isDrag = !isForceMovement && (
        'rulerSegment' in options || options.isDrag || v13Method === 'dragging'
    );
    const isTeleport = !!options.teleport || _moveHasTeleportAction(document, options);

    if (isTeleport && isDrag && !options._laTeleFxPlayed && typeof Sequencer !== 'undefined')
    {
        options._laTeleFxPlayed = true;
        const startCenter = token.getCenterPoint(startPos);
        const endCenter = token.getCenterPoint(endPos);
        const tokenSize = Math.max(1, token.document.width ?? 1, token.document.height ?? 1) * canvas.grid.size;
        new Sequence()
            .effect().file('jb2a.impact.003.yellow').atLocation(startCenter).size(tokenSize * 3).mirrorX().playbackRate(2)
            .effect().file('jb2a.impact.003.yellow').atLocation(endCenter).size(tokenSize * 3)
            .play();
        actionFX.playTeleportSoundFX();
    }

    const { distanceMoved, movementCost, isFreeMovement, costOverridden } = _computeMoveData(options, startPos, endPos, elevationMoved, document);

    const moveInfo = {
        isInvoluntary: !isDrag,
        isTeleport,
        pathHexes: options.lancerPathHexes || [],
        isModified: options.isModified || false,
        extraData: Object.keys(options).reduce((acc, key) =>
        {
            if (!['isDrag', 'isUndo', 'isModified', 'rulerSegment', 'teleport', 'animation'].includes(key))
                acc[key] = options[key];
            return acc;
        }, {})
    };

    // History/cap only apply to actual combatants of the active combat; non-combatants start fresh.
    const tokenDoc = document.document;
    const tokenId = tokenDoc.id ?? tokenDoc._id;
    const inCombat = !!game.combat?.active && !!game.combat.combatants.find(combatant => combatant.token?.id === tokenId);
    if (!inCombat
        && (tokenDoc.getFlag('lancer-automations', 'moveHistory') != null
            || tokenDoc.getFlag('lancer-automations', 'movementCap') != null))

        clearMoveTracking(tokenDoc);

    const existingData = (inCombat ? (_moveHistoryCache.get(tokenId) ?? tokenDoc.getFlag('lancer-automations', 'moveHistory')) : null) ?? { moves: [] };
    const existingMoves = existingData.moves || [];

    // Use movementCost (not raw distance) so terrain penalty counts toward the boost threshold.
    const prevIntentional = existingMoves
        .filter(m => m.isDrag && !m.isFreeMovement && !m.isForceMovement)
        .reduce((acc, m) => acc + (m.movementCost ?? m.distanceMoved), 0);

    if (game.settings.get('lancer-automations', 'experimentalBoostDetection') && isDrag && !isFreeMovement)
    {
        const speed = token.actor?.system?.speed || 0;
        const currentIntentional = prevIntentional + movementCost;

        const boostSet = [];
        if (speed > 0)
        {
            // Boost N is consumed when intentional cost crosses N*speed.
            const prevBoostCount = prevIntentional > 0 ? Math.floor((prevIntentional - 1) / speed) : 0;
            const newBoostCount = currentIntentional > 0 ? Math.floor((currentIntentional - 1) / speed) : 0;
            for (let boostNumber = prevBoostCount + 1; boostNumber <= newBoostCount; boostNumber++)
                boostSet.push(boostNumber);
        }
        moveInfo.boostSet = boostSet;
        moveInfo.isBoost = boostSet.length > 0;

        if (game.settings.get('lancer-automations', 'debugBoostDetection'))
            ui.notifications.info(`${token.name}: moved ${distanceMoved} (cost ${movementCost}), intentional ${prevIntentional + movementCost}/${speed} | isBoost: ${moveInfo.isBoost}, boostSet: [${boostSet.join(',')}]`);
    }

    // id from the live movement op; updateToken stamps the fallback.
    const newData = {
        ...existingData,
        moves: [...existingMoves, {
            movementId: options._movement?.[tokenId]?.id ?? null,
            distanceMoved,
            movementCost,
            isDrag,
            isFreeMovement,
            isForceMovement,
            costOverridden: costOverridden === true,
            boostSet: moveInfo.boostSet || [],
            startPos
        }]
    };
    if (inCombat)
    {
        _moveHistoryCache.set(tokenId, newData);
        foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', newData);
        const isLastSegment = !options.rulerSegment || options.lastRulerSegment === true;
        if (tokenDoc.isOwner && isLastSegment)
            tokenDoc.update({ 'flags.lancer-automations.moveHistory': newData });
        if (isDrag && !isFreeMovement && !isTeleport && prevIntentional === 0)
            consumeAction(token, 'move');
        if (isForceMovement && !isFreeMovement && !options.isUndo)
            Hooks.callAll('lancer-automations.battelog.involuntaryMove', { token, distance: distanceMoved });
    }

    if (!isDrag || options.IgnoreOnMove)
        return;

    await handleTrigger('onMove', { triggeringToken: token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });

    const pendingWaypointCount = options._movement?.[token.id]?.pending?.waypoints?.length ?? 0;
    if (pendingWaypointCount === 0)
        _advanceMoveStack('awaitMove', token.id, false);
}
