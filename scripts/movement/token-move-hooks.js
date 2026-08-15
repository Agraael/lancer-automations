import { isForceDebugMovement } from "./keybindings.js";
import { getOriginalMovePath, trimPathToPosition } from "./path-replay.js";
import {
    _moveHasForcedAction, _moveHasTeleportAction, _computeMoveData, _rulerMove,
    _handleMovementCapExceeded, handleTokenMove,
    _isActiveMoveStackFor, _wipeMoveStack, _moveHistoryCache
} from "./move-tracking.js";
import { getMovementPathHexes, drawDebugPath } from "../combat/grid-helpers.js";
import { cancelRulerDrag, getActiveGMId, drawMovementTrace, startChoiceCard } from "../interactive/index.js";
import { _buildCancelFn } from "../activations/flow-steps.js";
import { handleTrigger } from "../activations/reactions-engine.js";

// Carry our flags across core's checkpoint continuation segments.
const _replayOptionCache = new Map();
const _REPLAY_OPTION_KEYS = ['isDrag', 'ignoreMovementCap', '_skipBoostOffer', '_cancelledBy',
    'IgnorePreMove', 'IgnoreOnMove', 'isModified', 'teleport', 'lancerFreeMovement'];

Hooks.on('preUpdateToken', (document, change, options, userId) =>
{
    // [V] held or option set -> bypass everything (history, triggers)
    if (options.lancerDebugMovement || isForceDebugMovement())
    {
        options.lancerDebugMovement = true;
        if (change.x !== undefined || change.y !== undefined || change.elevation !== undefined)
            options.animate = false;
        return true;
    }

    const moveOp = options._movement?.[document.id];
    const chainRoot = options._movementArguments?.chain?.[0];
    if (chainRoot && _replayOptionCache.has(chainRoot))
        Object.assign(options, _replayOptionCache.get(chainRoot));
    else if (moveOp?.pending?.waypoints?.length && moveOp.id)
    {
        const carried = {};
        for (const key of _REPLAY_OPTION_KEYS)
        {
            if (key in options)
                carried[key] = options[key];
        }
        // Cost was already billed in full on the passed part of the split leg.
        if ('lancerSegmentDistance' in options)
        {
            carried.lancerSegmentDistance = 0;
            carried.lancerSegmentCost = 0;
            carried.lancerTerrainPenalty = 0;
        }
        _replayOptionCache.set(moveOp.id, carried);
    }
    if (chainRoot && !(moveOp?.pending?.waypoints?.length))
        _replayOptionCache.delete(chainRoot);

    // Native drags set method:'dragging'; our own moves (moveToken/_rulerMove) set isDrag/rulerSegment.
    const v13Method = options.movement?.[document.id]?.method;
    const isForceMovement = _moveHasForcedAction(document, options);
    const isDrag = !isForceMovement && (
        'rulerSegment' in options || options.isDrag || v13Method === 'dragging'
    );

    if (options.IgnorePreMove)
    {
        if (isDrag)
        {
            const token = canvas.tokens.get(document.id);
            handleTokenMove(token, change, options, userId);
        }
        return true;
    }

    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return;
    if (options.isUndo)
        return;

    if (isDrag)
    {
        let cancelUpdate = false;
        const token = canvas.tokens.get(document.id);

        const startPos = { x: document.x, y: document.y, elevation: document.elevation };
        const endPos = { x: change.x ?? document.x, y: change.y ?? document.y, elevation: change.elevation ?? document.elevation };
        const elevationToMove = change.elevation ?? document.elevation;

        const { distanceMoved: distanceToMove, movementCost: moveCost, isFreeMovement: moveIsFreeMovement } = _computeMoveData(options, startPos, endPos, 0, document);

        const isTeleport = !!options.teleport || _moveHasTeleportAction(document, options);
        const moveInfo = {
            isInvoluntary: !isDrag,
            isTeleport,
            isUndo: options.isUndo,
            isModified: options.isModified,
            pathHexes: getMovementPathHexes(token, change, options.movement?.[document.id]?.waypoints)
        };
        options.lancerPathHexes = moveInfo.pathHexes;

        const triggerData = {
            token: token,
            distanceToMove,
            elevationToMove,
            startPos,
            endPos,
            isDrag,
            moveInfo,
            cancel: () =>
            {
                cancelUpdate = true;
            }
        };

        const originalAction = options.movement?.[document.id]?.waypoints?.find(waypoint => waypoint?.action)?.action;
        const originalIsTeleport = !!CONFIG.Token?.movement?.actions?.[originalAction]?.teleport;
        const originalPathWaypoints = getOriginalMovePath(document, options);
        const intentEndPos = originalPathWaypoints.at(-1) ?? endPos;
        const continueCallback = async () =>
        {
            const dest = { x: change.x ?? token.x, y: change.y ?? token.y };
            if (change.elevation !== undefined)
                dest.elevation = change.elevation;
            if (originalAction)
                dest.action = originalAction;
            // Strip v13-internal options before re-firing: the cancelled call froze them with defineProperty, and spreading them crashes #preUpdateMovement.
            const { _movement, _movementArguments, movement, _laTeleFxPlayed, ...cleanOptions } = options;
            await _rulerMove(token, originalPathWaypoints.length ? originalPathWaypoints : dest, { ...cleanOptions, _cancelledBy: triggerData._cancelledBy, isDrag: true, useRuler: true, teleport: originalIsTeleport || cleanOptions.teleport });
        };
        triggerData._cancelledBy = options._cancelledBy || [];
        const _cancelMoveCard = _buildCancelFn({
            setFlag: () =>
            {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
            },
            cancelledBy: triggerData._cancelledBy,
            getIgnoreCallback: () => continueCallback,
            defaultReason: "This movement has been canceled.",
            defaultTitle: "MOVEMENT CANCELED",
            choice1Text: "Stop",
            choice2Text: "Ignore",
            getExtraCardOptions: (userIdControl) => ({
                traceData: (userIdControl ?? getActiveGMId()) ? { tokenId: token.id, endPos: intentEndPos, newEndPos: null, path: originalPathWaypoints } : null
            }),
        });
        // adapter: trace drawn here (not in _cancelMoveCard) so it shows during preConfirm too
        triggerData.cancelTriggeredMove = (reasonText = "This movement has been canceled.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) =>
        {
            _cancelMoveCard._reactorIdentity = triggerData.cancelTriggeredMove._reactorIdentity;
            _cancelMoveCard._engineCancel = triggerData.cancelTriggeredMove._engineCancel;
            const trace = drawMovementTrace(token, intentEndPos, null, { path: originalPathWaypoints });
            const cleanup = () =>
            {
                if (trace?.parent)
                    trace.parent.removeChild(trace);
                trace?.destroy();
            };
            const result = _cancelMoveCard(reasonText, undefined, allowConfirm, userIdControl, preConfirm, postChoice, opts);
            Promise.resolve(result).finally(cleanup);
            return result;
        };

        triggerData.changeTriggeredMove = async (position, extraData = {}, reasonText = "This movement has been rerouted.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) =>
        {
            triggerData.cancel();
            cancelRulerDrag(token, moveInfo);
            const identity = triggerData.changeTriggeredMove._reactorIdentity;
            if (identity && triggerData._cancelledBy)
                triggerData._cancelledBy.push(identity);
            const trimmedPath = trimPathToPosition(token, originalPathWaypoints, startPos, position, originalAction);

            // Rerouted move is a real new move on purpose: no _cancelledBy carry, reactors may evaluate it again.
            const executeChange = () =>
            {
                setTimeout(async () =>
                {
                    const dest = { x: position.x, y: position.y };
                    if (extraData.elevation !== undefined)
                        dest.elevation = extraData.elevation;
                    if (originalAction)
                        dest.action = originalAction;
                    const trimmed = trimmedPath ? [...trimmedPath] : null;
                    if (trimmed && extraData.elevation !== undefined)
                        trimmed[trimmed.length - 1] = { ...trimmed[trimmed.length - 1], elevation: extraData.elevation };
                    await _rulerMove(token, trimmed ?? dest, { isUndo: false, isModified: true, isDrag: true, useRuler: true, teleport: originalIsTeleport, ...extraData });
                }, 50);
            };
            const executeOriginal = async () =>
            {
                if (originalPathWaypoints.length)
                {
                    const { _movement, _movementArguments, movement, _laTeleFxPlayed, ...cleanOptions } = options;
                    await _rulerMove(token, originalPathWaypoints, { ...cleanOptions, _cancelledBy: triggerData._cancelledBy, isDrag: true, useRuler: true, teleport: originalIsTeleport || cleanOptions.teleport });
                    return;
                }
                const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                if (change.elevation !== undefined)
                    originalUpdate.elevation = change.elevation;
                // strip v13-internal frozen options (see continueCallback)
                const { _movement, _movementArguments, movement, ...cleanOptions } = options;
                await token.document.update(originalUpdate, { ...cleanOptions, _cancelledBy: triggerData._cancelledBy, isDrag: true });
            };

            if (preConfirm)
            {
                const confirmed = await preConfirm();
                if (!confirmed)
                {
                    await executeOriginal();
                    return;
                }
            }

            if (!allowConfirm)
            {
                executeChange();
                await postChoice?.(true);
                return;
            }

            const trace = drawMovementTrace(token, intentEndPos, position, { path: originalPathWaypoints, newPath: trimmedPath });

            try
            {
                await startChoiceCard({
                    mode: "or",
                    title: "MOVEMENT REROUTED",
                    description: reasonText,
                    item,
                    originToken,
                    relatedToken,
                    userIdControl: userIdControl ?? getActiveGMId(),
                    traceData: (userIdControl ?? getActiveGMId()) ? { tokenId: token.id, endPos: intentEndPos, newEndPos: position, path: originalPathWaypoints, newPath: trimmedPath } : null,
                    choices: [
                        { text: "Confirm",
                            icon: "fas fa-check",
                            callback: async () =>
                            {
                                executeChange();
                                await postChoice?.(true);
                            } },
                        { text: "Ignore",
                            icon: "fas fa-times",
                            callback: async () =>
                            {
                                await postChoice?.(false);
                                await executeOriginal();
                            } }
                    ]
                });
            }
            finally
            {
                if (trace.parent)
                    trace.parent.removeChild(trace);
                trace.destroy();
            }
        };

        _handleMovementCapExceeded(token, { options, change, startPos, endPos, moveInfo, moveToMovementCost: moveCost, moveIsFreeMovement, triggerData, intentPath: originalPathWaypoints, intentEndPos });

        // no await: sync reactors flip cancelUpdate before the next line reads it
        if (!cancelUpdate)
            handleTrigger('onPreMove', { triggeringToken: token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo, cancel: triggerData.cancel, cancelTriggeredMove: triggerData.cancelTriggeredMove, changeTriggeredMove: triggerData.changeTriggeredMove, _cancelledBy: triggerData._cancelledBy });

        if (cancelUpdate)
        {
            // a reactor (Overwatch/Engagement/…) cancelled; the awaiting stack is broken
            if (_isActiveMoveStackFor(token.id))
                _wipeMoveStack();
            return false;
        }

        handleTokenMove(token, change, options, userId);

        if (game.settings.get('lancer-automations', 'debugPathHexCalculation') && moveInfo.pathHexes.length > 0)
        {
            try
            {
                drawDebugPath(moveInfo.pathHexes);
                setTimeout(() =>
                {
                    if (canvas.lancerDebugPath && !canvas.lancerDebugPath.destroyed)
                        canvas.lancerDebugPath.clear();
                }, 3000);
            }
            catch (err)
            {
                console.error("lancer-automations | Error drawing visual path debug:", err);
            }
        }
    }
    else
    {
        // unintentional move (knockback etc.): log it so the ruler trail shows white
        const token = canvas.tokens.get(document.id);
        if (token)
            handleTokenMove(token, change, options, userId);
    }
    return true;
});

Hooks.on('updateToken', async function(document, change, options, userId)
{
    if (game.user.id !== userId)
        return;

    // stamp v13 movementId on the last LA history entry (id only exists after preUpdateToken)
    const moveId = document.movement?.id;
    if (moveId && !options.lancerDebugMovement)
    {
        const moveHistory = _moveHistoryCache.get(document.id) ?? document.getFlag('lancer-automations', 'moveHistory');
        const lastEntry = moveHistory?.moves?.at(-1);
        if (lastEntry && !lastEntry.movementId)
        {
            lastEntry.movementId = moveId;
            _moveHistoryCache.set(document.id, moveHistory);
            foundry.utils.setProperty(document.flags, 'lancer-automations.moveHistory', moveHistory);
            if (document.isOwner)
                document.update({ 'flags.lancer-automations.moveHistory': moveHistory });
        }
    }

    if (change.hidden !== undefined)
    {
        const hiddenToken = canvas.tokens.get(document.id);
        if (hiddenToken)
            await handleTrigger('onTokenVisibility', { triggeringToken: hiddenToken, isHidden: !!change.hidden });
    }

    const hasPositionChange = change.x !== undefined || change.y !== undefined || change.elevation !== undefined;
    if (!hasPositionChange)
        return;
    if (options.lancerDebugMovement)
        return;

    if (options.rulerSegment && !options.lastRulerSegment)
        return;

    const token = canvas.tokens.get(document.id);
    if (!token)
        return;

    // wait for the real animation, not a guessed duration
    const animPromise = token.movementAnimationPromise;
    if (animPromise)
        await animPromise;
    await handleTrigger("onUpdate", { triggeringToken: token, document, change, options });
});
