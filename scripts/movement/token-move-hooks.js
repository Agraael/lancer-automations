import { isForceDebugMovement } from "./keybindings.js";
import {
    _moveHasForcedAction, _moveHasTeleportAction, _computeMoveData, _rulerMove,
    _handleMovementCapExceeded, handleTokenMove,
    _isActiveMoveStackFor, _wipeMoveStack, _moveHistoryCache
} from "./move-tracking.js";
import { getMovementPathHexes, drawDebugPath } from "../combat/grid-helpers.js";
import { cancelRulerDrag, getActiveGMId, drawMovementTrace, startChoiceCard } from "../interactive/index.js";
import { _buildCancelFn } from "../activations/flow-steps.js";
import { handleTrigger } from "../activations/reactions-engine.js";

Hooks.on('preUpdateToken', (document, change, options, userId) => {
    // [V] held or option set -> bypass everything (history, triggers)
    if (options.lancerDebugMovement || isForceDebugMovement()) {
        options.lancerDebugMovement = true;
        return true;
    }

    // v13 drags go through Token.move({method:'dragging'}); v12 set rulerSegment/isDrag directly
    const v13Method = options.movement?.[document.id]?.method;
    const isForceMovement = _moveHasForcedAction(document, options) || !!options.forceUnintentional;
    const isDrag = !isForceMovement && (
        'rulerSegment' in options || options.isDrag || v13Method === 'dragging'
    );

    if (options.IgnorePreMove) {
        if (isDrag) {
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

    if (isDrag) {
        let cancelUpdate = false;
        const token = canvas.tokens.get(document.id);

        const startPos = { x: document.x, y: document.y, elevation: document.elevation };
        const endPos = { x: change.x ?? document.x, y: change.y ?? document.y, elevation: change.elevation ?? document.elevation };
        const elevationToMove = change.elevation ?? document.elevation;

        const { distanceMoved: distanceToMove, movementCost: moveToMovementCost, isFreeMovement: moveIsFreeMovement } = _computeMoveData(options, startPos, endPos, 0, document);

        const isTeleport = !!options.teleport || _moveHasTeleportAction(document, options);
        const shouldCalculatePath = game.settings.get('lancer-automations', 'enablePathHexCalculation');
        const moveInfo = {
            isInvoluntary: !isDrag,
            isTeleport,
            isUndo: options.isUndo,
            isModified: options.isModified,
            pathHexes: shouldCalculatePath ? getMovementPathHexes(token, change) : /** @type {PathHexArray} */ (/** @type {any} */ ([]))
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
            cancel: () => {
                cancelUpdate = true;
            }
        };

        const originalAction = options.movement?.[document.id]?.waypoints?.find(w => w?.action)?.action;
        const originalIsTeleport = !!CONFIG.Token?.movement?.actions?.[originalAction]?.teleport;
        const continueCallback = async () => {
            const dest = { x: change.x ?? token.x, y: change.y ?? token.y };
            if (change.elevation !== undefined) {
                dest.elevation = change.elevation;
            }
            if (originalAction)
                dest.action = originalAction;
            // strip v13-internal options before re-firing; the cancelled call froze them
            // with non-configurable defineProperty and spreading them crashes #preUpdateMovement
            const { _movement, _movementArguments, movement, _laTeleFxPlayed, ...cleanOptions } = options;
            await _rulerMove(token, dest, { ...cleanOptions, _cancelledBy: triggerData._cancelledBy, isDrag: true, useRuler: true, teleport: originalIsTeleport || cleanOptions.teleport });
        };
        triggerData._cancelledBy = options._cancelledBy || [];
        const _cancelMoveCard = _buildCancelFn({
            setFlag: () => {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
            },
            cancelledBy: triggerData._cancelledBy,
            getIgnoreCallback: () => continueCallback,
            defaultReason: "This movement has been canceled.",
            defaultTitle: "MOVEMENT CANCELED",
            choice1Text: "Stop",
            choice2Text: "Ignore",
            getExtraCardOptions: (uc) => ({
                traceData: (uc ?? getActiveGMId()) ? { tokenId: token.id, endPos, newEndPos: null } : null
            }),
        });
        // adapter: trace drawn here (not in _cancelMoveCard) so it shows during preConfirm too
        triggerData.cancelTriggeredMove = (reasonText = "This movement has been canceled.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
            _cancelMoveCard._reactorIdentity = triggerData.cancelTriggeredMove._reactorIdentity;
            _cancelMoveCard._engineCancel = triggerData.cancelTriggeredMove._engineCancel;
            const trace = drawMovementTrace(token, endPos);
            const cleanup = () => {
                if (trace?.parent)
                    trace.parent.removeChild(trace);
                trace?.destroy();
            };
            const result = _cancelMoveCard(reasonText, undefined, allowConfirm, userIdControl, preConfirm, postChoice, opts);
            Promise.resolve(result).finally(cleanup);
            return result;
        };

        triggerData.changeTriggeredMove = async (position, extraData = {}, reasonText = "This movement has been rerouted.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
            triggerData.cancel();
            cancelRulerDrag(token, moveInfo);
            const identity = triggerData.changeTriggeredMove._reactorIdentity;
            if (identity && triggerData._cancelledBy)
                triggerData._cancelledBy.push(identity);

            const executeChange = () => {
                setTimeout(async () => {
                    const dest = { x: position.x, y: position.y };
                    if (extraData.elevation !== undefined) {
                        dest.elevation = extraData.elevation;
                    }
                    if (originalAction)
                        dest.action = originalAction;
                    await _rulerMove(token, dest, { isUndo: false, isModified: true, isDrag: true, useRuler: true, teleport: originalIsTeleport, ...extraData });
                }, 50);
            };
            const executeOriginal = async () => {
                const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                if (change.elevation !== undefined)
                    originalUpdate.elevation = change.elevation;
                // strip v13-internal frozen options (see continueCallback)
                const { _movement, _movementArguments, movement, ...cleanOptions } = options;
                await token.document.update(originalUpdate, { ...cleanOptions, _cancelledBy: triggerData._cancelledBy, isDrag: true });
            };

            if (preConfirm) {
                const confirmed = await preConfirm();
                if (!confirmed) {
                    await executeOriginal();
                    return;
                }
            }

            if (!allowConfirm) {
                executeChange();
                await postChoice?.(true);
                return;
            }

            const trace = drawMovementTrace(token, endPos, position);

            await startChoiceCard({
                mode: "or",
                title: "MOVEMENT REROUTED",
                description: reasonText,
                item,
                originToken,
                relatedToken,
                userIdControl: userIdControl ?? getActiveGMId(),
                traceData: (userIdControl ?? getActiveGMId()) ? { tokenId: token.id, endPos, newEndPos: position } : null,
                choices: [
                    { text: "Confirm",
                        icon: "fas fa-check",
                        callback: async () => {
                            executeChange();
                            await postChoice?.(true);
                        } },
                    { text: "Ignore",
                        icon: "fas fa-times",
                        callback: async () => {
                            await postChoice?.(false);
                            await executeOriginal();
                        } }
                ]
            });

            if (trace.parent)
                trace.parent.removeChild(trace);
            trace.destroy();
        };

        _handleMovementCapExceeded(token, { options, change, startPos, endPos, moveInfo, moveToMovementCost, moveIsFreeMovement, triggerData });

        // no await: sync reactors flip cancelUpdate before the next line reads it
        if (!cancelUpdate) {
            handleTrigger('onPreMove', { triggeringToken: token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo, cancel: triggerData.cancel, cancelTriggeredMove: triggerData.cancelTriggeredMove, changeTriggeredMove: triggerData.changeTriggeredMove, _cancelledBy: triggerData._cancelledBy });
        }

        if (cancelUpdate) {
            // a reactor (Overwatch/Engagement/…) cancelled; the awaiting stack is broken
            if (_isActiveMoveStackFor(token.id)) {
                _wipeMoveStack();
            }
            return false;
        }

        handleTokenMove(token, change, options, userId);

        if (game.settings.get('lancer-automations', 'debugPathHexCalculation') && moveInfo.pathHexes.length > 0) {
            try {
                drawDebugPath(moveInfo.pathHexes);
                setTimeout(() => {
                    if (canvas.lancerDebugPath && !canvas.lancerDebugPath.destroyed) {
                        canvas.lancerDebugPath.clear();
                    }
                }, 3000);
            } catch (err) {
                console.error("lancer-automations | Error drawing visual path debug:", err);
            }
        }
    } else {
        // unintentional move (knockback etc.): log it so the ruler trail shows white
        const token = canvas.tokens.get(document.id);
        if (token) handleTokenMove(token, change, options, userId);
    }
    return true;
});

Hooks.on('updateToken', async function(document, change, options, userId) {
    if (game.user.id !== userId)
        return;

    // stamp v13 movementId on the last LA history entry (id only exists after preUpdateToken)
    const moveId = document.movement?.id;
    if (moveId && !options.lancerDebugMovement) {
        const data = _moveHistoryCache.get(document.id) ?? document.getFlag('lancer-automations', 'moveHistory');
        const lastEntry = data?.moves?.at(-1);
        if (lastEntry && !lastEntry.movementId) {
            lastEntry.movementId = moveId;
            _moveHistoryCache.set(document.id, data);
            foundry.utils.setProperty(document.flags, 'lancer-automations.moveHistory', data);
            if (document.isOwner) document.update({ 'flags.lancer-automations.moveHistory': data });
        }
    }

    if (change.hidden !== undefined) {
        const tok = canvas.tokens.get(document.id);
        if (tok)
            await handleTrigger('onTokenVisibility', { triggeringToken: tok, isHidden: !!change.hidden });
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

    // wait for the real animation; v12 needed a setTimeout that guessed the duration
    const animPromise = token.movementAnimationPromise;
    if (animPromise) await animPromise;
    await handleTrigger("onUpdate", { triggeringToken: token, document, change, options });
});
