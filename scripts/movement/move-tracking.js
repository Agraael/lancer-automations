import { moveTokenTo } from "./move-api.js";
import { isForceFreeMovement } from "./keybindings.js";
import { consumeAction, executeSimpleActivation } from "../tools/misc-tools.js";
import * as actionFX from "../fx/actionFX.js";
import { handleTrigger } from "../activations/reactions-engine.js";
import { cancelRulerDrag, startChoiceCard, getTokenOwnerUserId } from "../interactive/index.js";
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

export function _isActiveMoveStackFor(tokenId) {
    return !!(_activeMoveStack && _activeMoveStack.tokenId === tokenId);
}

export function _wipeMoveStack() {
    if (!_activeMoveStack)
        return;
    if (_activeMoveStack._timer)
        clearTimeout(_activeMoveStack._timer);
    _activeMoveStack = null;
}

function _pushMoveStack(tokenId, frames) {
    _wipeMoveStack();
    _activeMoveStack = { tokenId, cursor: 0, frames };
    _activeMoveStack._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
}

export async function _advanceMoveStack(kind, tokenId, cancelled, ctx = {}) {
    const s = _activeMoveStack;
    if (!s || s.tokenId !== tokenId)
        return;
    const frame = s.frames[s.cursor];
    if (!frame || frame.kind !== kind)
        return;
    if (frame.matchActionName && ctx.actionName !== frame.matchActionName)
        return;
    if (cancelled) {
        _wipeMoveStack(); return;
    }
    const onSatisfy = frame.onSatisfy;
    s.cursor++;
    // Wall-clock safety timer: reset on progress.
    if (s._timer)
        clearTimeout(s._timer);
    s._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
    if (s.cursor >= s.frames.length)
        _wipeMoveStack();
    if (onSatisfy) {
        try {
            // Inter-action grace period: lets async side-effects from the just-completed
            // frame propagate before the next one fires.
            await new Promise(r => setTimeout(r, _MOVE_STACK_INTER_DELAY_MS));
            await onSatisfy();
        } catch (err) {
            console.error('lancer-automations | move stack onSatisfy failed', err); _wipeMoveStack();
        }
    }
}

function _getMoveHistoryDoc(tokenOrId) {
    if (typeof tokenOrId === 'string')
        return canvas.tokens.get(tokenOrId)?.document ?? null;
    return tokenOrId?.document ?? tokenOrId ?? null;
}

function _getMoveHistoryData(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
}

function _writeMoveHistory(tokenDoc, data) {
    if (!tokenDoc)
        return;
    const tid = tokenDoc.id ?? tokenDoc._id;
    if (tid) {
        _moveHistoryCache.set(tid, data);
    }
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', data);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.moveHistory': data });
}

function _writeMovementCap(tokenDoc, value) {
    if (!tokenDoc)
        return;
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.movementCap', value);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.movementCap': value });
}

export function clearMoveData(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const tid = doc.id ?? doc._id;
    if (tid) {
        _moveHistoryCache.delete(tid);
    }
    foundry.utils.setProperty(doc.flags, 'lancer-automations.moveHistory', null);
    if (doc.isOwner)
        doc.update({ 'flags.lancer-automations.-=moveHistory': null });
    initMovementCap(doc);
}

export function undoMoveData(tokenOrId, _distance) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const data = doc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const moves = (data.moves || []).slice(0, -1);
    _writeMoveHistory(doc, { ...data, moves });
}

export function getCumulativeMoveData(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(m => !m.isFreeMovement).reduce(
        (acc, m) => ({ moved: acc.moved + m.distanceMoved, cost: acc.cost + (m.movementCost ?? m.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

export function getIntentionalMoveData(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(m => m.isDrag && !m.isFreeMovement).reduce(
        (acc, m) => ({ moved: acc.moved + m.distanceMoved, cost: acc.cost + (m.movementCost ?? m.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

export function getMovementCap(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'movementCap') ?? 0;
}

// Used by the token-ruler overlay to look up which past waypoints belong to free/debug moves.
export function getMoveDataList(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    return data.moves || [];
}

export function getMovementHistory(tokenOrId) {
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
    let nbBoostUsed = 0;
    const startPosition = moves[0].startPos;

    for (const move of moves) {
        const moved = move.distanceMoved;
        const cost = move.movementCost ?? move.distanceMoved;
        totalMoved += moved;
        totalCost += cost;
        if (move.isDrag) {
            if (move.isFreeMovement) {
                intentionalFreeMoved += moved;
                intentionalFreeCost += cost;
            } else {
                intentionalRegularMoved += moved;
                intentionalRegularCost += cost;
            }
            if (move.boostSet && move.boostSet.length > 0) {
                nbBoostUsed += move.boostSet.length;
            }
        } else {
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
        nbBoostUsed,
        startPosition,
        movementCap: getMovementCap(tokenOrId)
    };
}

export function initMovementCap(token) {
    const doc = _getMoveHistoryDoc(token);
    if (!doc)
        return;
    const tokenId = doc.id ?? doc._id;
    const isInCombat = !!game.combat?.combatants.find(c => c.token?.id === tokenId);
    if (!isInCombat)
        return;
    const isImmobilized = !!findEffectOnToken(token, 'immobilized');
    const speed = isImmobilized ? 0 : (token.actor?.system?.speed ?? 0);
    _writeMovementCap(doc, speed);
}

export function increaseMovementCap(tokenOrId, value) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    _writeMovementCap(doc, getMovementCap(tokenOrId) + value);
}

/**
 * Cap-overflow handler invoked from `preUpdateToken` when the requested move would exceed the
 * remaining movement allowance. Cancels the original update, then offers Boost & Move (any actor)
 * or Overcharge & Boost & Move (mech-only 3-leg path). Each accepted offer pushes a move stack.
 */
export function _handleMovementCapExceeded(token, ctx) {
    const { options, change, startPos, endPos, moveInfo, moveToMovementCost, moveIsFreeMovement, triggerData } = ctx;
    const capDetect = game.settings.get('lancer-automations', 'enableMovementCapDetection');
    const boostOffer = game.settings.get('lancer-automations', 'enableBoostOffer');
    const isTokenInCombat = !!game.combat?.combatants.find(c => c.token?.id === token.id);
    if (options.ignoreMovementCap
        || (!capDetect && !boostOffer)
        || !isTokenInCombat || moveIsFreeMovement || moveToMovementCost <= 0) {
        return;
    }

    const cap = getMovementCap(token);
    const history = getMovementHistory(token);
    const spent = history.exists ? history.intentional.regularCost : 0;
    if (!(spent <= cap && spent + moveToMovementCost > cap)) {
        return;
    }

    let freeKey = '[free movement key]';
    try { freeKey = game.keybindings.get('lancer-automations', 'freeMovement')?.[0]?.key ?? freeKey; } catch { /* not registered yet */ }
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

    const finalX = change.x ?? endPos.x;
    const finalY = change.y ?? endPos.y;
    const finalElev = change.elevation;
    const capOriginalAction = options.movement?.[token.id]?.waypoints?.find(w => w?.action)?.action;
    const finalDest = { x: finalX, y: finalY, elevation: finalElev, action: capOriginalAction };

    const fireBoost = () => executeSimpleActivation(token.actor, {
        title: 'Boost',
        action: { name: 'Boost', activation: 'Quick' },
        detail: 'Move your speed.',
    });
    const fireOvercharge = async () => {
        if (isMech) {
            const OverchargeFlow = game.lancer?.flows?.get?.('OverchargeFlow');
            if (OverchargeFlow) {
                const flow = new OverchargeFlow(token.actor.uuid);
                await flow.begin();
            }
            return;
        }
        // NPC path: fire the registered "Overcharge (NPC)" extra action so its built-in
        // reaction (heat roll + FX) handles it.
        await executeSimpleActivation(token.actor, {
            title: 'Overcharge (NPC)',
            action: { name: 'Overcharge (NPC)', activation: 'Protocol' },
            detail: npcOvercharge?.detail || '',
        });
    };
    const computeMid = (/** @type {number} */ cost) => {
        const ratio = moveToMovementCost > 0 ? Math.max(0, cost / moveToMovementCost) : 0;
        const snapped = token.getSnappedPosition({
            x: startPos.x + (endPos.x - startPos.x) * ratio,
            y: startPos.y + (endPos.y - startPos.y) * ratio,
        });
        if (capOriginalAction)
            snapped.action = capOriginalAction;
        return snapped;
    };

    if (canBoost && boostOffer && !options._skipBoostOffer) {
        const remaining = cap - spent;
        const snapMid = remaining > 0 ? computeMid(remaining) : null;
        (async () => {
            const result = await startChoiceCard({
                title: 'BOOST & MOVE',
                icon: 'modules/lancer-automations/icons/speedometer.svg',
                description: `Movement exceeds cap (${need}/${cap}). Boost adds +${speed}.`,
                originToken: token,
                userIdControl: getTokenOwnerUserId(token),
                choices: [
                    { text: 'Boost & Move', icon: 'modules/lancer-automations/icons/speedometer.svg' },
                    { text: 'Ignore', icon: 'fas fa-forward' },
                ]
            });
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1) {
                // Ignore: do the move anyway, bypassing the cap (and any further offer).
                await _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
                return;
            }
            if (choiceIdx !== 0)
                return; // Card cancelled: do nothing.
            const fireFinalLeg = () => _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            if (snapMid) {
                // Cap not yet exhausted: leg1 -> Boost -> leg2.
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await _rulerMove(token, snapMid, { _skipBoostOffer: true, isDrag: true, useRuler: true });
            } else {
                // Cap already exhausted: skip leg1, fire Boost immediately.
                _pushMoveStack(token.id, [
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await fireBoost();
            }
        })();
    } else if (canOvercharge && boostOffer && !options._skipBoostOffer) {
        // 3-leg path: leg1 -> Boost -> leg2 -> Overcharge -> Boost -> leg3.
        // If cap already exhausted, skip leg1 and start at the Boost.
        const remaining = cap - spent;
        const mid1 = remaining > 0 ? computeMid(remaining) : null;
        const mid2 = computeMid(remaining + speed);
        (async () => {
            const result = await startChoiceCard({
                title: 'OVERCHARGE & BOOST & MOVE',
                icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg',
                description: `Movement exceeds cap+boost (${need}/${cap + speed}). Overcharge grants an extra Boost (+${speed}).`,
                originToken: token,
                userIdControl: getTokenOwnerUserId(token),
                choices: [
                    { text: 'Overcharge & Boost & Move', icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg' },
                    { text: 'Ignore', icon: 'fas fa-forward' },
                ]
            });
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1) {
                await _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
                return;
            }
            if (choiceIdx !== 0)
                return; // Card cancelled: do nothing.
            const mid2Move = () => _rulerMove(token, mid2, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            const finalMove = () => _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, isDrag: true, useRuler: true });
            const tailFrames = [
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: mid2Move },
                { kind: 'awaitMove', onSatisfy: fireOvercharge },
                { kind: 'awaitActivation', matchActionName: overchargeActionName, onSatisfy: fireBoost },
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: finalMove },
                { kind: 'awaitMove' }
            ];
            if (mid1) {
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    ...tailFrames
                ]);
                await _rulerMove(token, mid1, { _skipBoostOffer: true, isDrag: true, useRuler: true });
            } else {
                _pushMoveStack(token.id, tailFrames);
                await fireBoost();
            }
        })();
    } else {
        triggerData.cancelTriggeredMove(
            `Movement exceeds cap (${need} > ${cap}) and cannot be covered by Boost or Overcharge. ` +
            `Hold <b>${freeKey}</b> for free movement.`
        );
    }
}

/**
 * Move a token from code. `useRuler` routes through Token.move() (Lancer cost rules apply);
 * otherwise plain TokenDocument.update for an exact land.
 */
export async function _rulerMove(token, destination, extraOpts = {}) {
    const { useRuler, ...passthroughOpts } = extraOpts;
    if (useRuler) {
        await moveTokenTo(token, destination, passthroughOpts);
    } else {
        const update = { x: destination.x, y: destination.y };
        if (destination.elevation !== undefined) {
            update.elevation = destination.elevation;
        }
        // No implicit isDrag; caller opts in via passthroughOpts for cap consumption.
        await token.document.update(update, passthroughOpts);
    }
}

export function _computeMoveData(options, startPos, endPos, elevationFallback = 0, tokenDoc = null) {
    const isFreeMovement = !!options.lancerFreeMovement || isForceFreeMovement();
    const sceneDist = canvas.scene?.grid?.distance ?? 1;

    // Knockback/teleport set a forced cost via these options.
    if (options.lancerSegmentDistance !== undefined) {
        const distanceMoved = Math.max(0, Math.round(options.lancerSegmentCost - (options.lancerTerrainPenalty ?? 0)));
        const movementCost = Math.round(options.lancerSegmentCost);
        return { distanceMoved, movementCost, isFreeMovement };
    }

    const op = options?._movement?.[tokenDoc?.id];
    if (op?.passed) {
        const cost = Number(op.passed.cost);
        const dist = Number(op.passed.distance);
        if (Number.isFinite(cost)) {
            const movementCost = Math.round(cost / sceneDist);
            const distanceMoved = Number.isFinite(dist) ? Math.round(dist / sceneDist) : movementCost;
            return { distanceMoved, movementCost, isFreeMovement };
        }
    }

    if (tokenDoc?.measureMovementPath) {
        try {
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
        } catch { /* fall through */ }
    }

    const dist2D = Math.round(canvas.grid.measurePath([startPos, endPos], {}).distance / sceneDist);
    const distanceMoved = dist2D + Math.floor(elevationFallback);
    return { distanceMoved, movementCost: distanceMoved, isFreeMovement };
}

export function _moveHasForcedAction(document, options) {
    const wps = options?.movement?.[document.id]?.waypoints;
    if (Array.isArray(wps) && wps.some(w => w?.action === 'forced'))
        return true;
    const cwps = options?.changes?.[document.id]?.waypoints ?? options?.waypoints;
    if (Array.isArray(cwps) && cwps.some(w => w?.action === 'forced'))
        return true;
    return false;
}

export function _moveHasTeleportAction(document, options) {
    const cfg = CONFIG.Token?.movement?.actions;
    const isTele = (a) => !!cfg?.[a]?.teleport;
    const wps = options?.movement?.[document.id]?.waypoints;
    if (Array.isArray(wps) && wps.some(w => isTele(w?.action)))
        return true;
    const cwps = options?.changes?.[document.id]?.waypoints ?? options?.waypoints;
    if (Array.isArray(cwps) && cwps.some(w => isTele(w?.action)))
        return true;
    return false;
}

export async function handleTokenMove(document, change, options, userId) {
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
    const isForceMovement = _moveHasForcedAction(document, options) || !!options.forceUnintentional;
    const isDrag = !isForceMovement && (
        'rulerSegment' in options || options.isDrag || v13Method === 'dragging'
    );
    const isTeleport = !!options.teleport || _moveHasTeleportAction(document, options);

    if (isTeleport && isDrag && !options._laTeleFxPlayed && typeof Sequencer !== 'undefined') {
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

    const { distanceMoved, movementCost, isFreeMovement } = _computeMoveData(options, startPos, endPos, elevationMoved, document);

    const moveInfo = {
        isInvoluntary: !isDrag,
        isTeleport,
        pathHexes: options.lancerPathHexes || [],
        isModified: options.isModified || false,
        extraData: Object.keys(options).reduce((acc, key) => {
            if (!['isDrag', 'isUndo', 'isModified', 'rulerSegment', 'teleport', 'animation'].includes(key)) {
                acc[key] = options[key];
            }
            return acc;
        }, {})
    };

    // Outside of combat, always start fresh so history reflects only the current movement.
    const tokenDoc = document.document;
    const inCombat = !!game.combat?.active;
    const tokenId = tokenDoc.id ?? tokenDoc._id;
    const existingData = (inCombat ? (_moveHistoryCache.get(tokenId) ?? tokenDoc.getFlag('lancer-automations', 'moveHistory')) : null) ?? { moves: [] };
    const existingMoves = existingData.moves || [];

    // Use movementCost (not raw distance) so terrain penalty counts toward the boost threshold.
    const prevIntentional = existingMoves
        .filter(m => m.isDrag && !m.isFreeMovement && !m.isForceMovement)
        .reduce((acc, m) => acc + (m.movementCost ?? m.distanceMoved), 0);

    if (game.settings.get('lancer-automations', 'experimentalBoostDetection') && isDrag && !isFreeMovement) {
        const speed = token.actor?.system?.speed || 0;
        const currentIntentional = prevIntentional + movementCost;

        const boostSet = [];
        if (speed > 0) {
            // Boost N is consumed when intentional cost crosses N*speed.
            const prevBoostCount = prevIntentional > 0 ? Math.floor((prevIntentional - 1) / speed) : 0;
            const newBoostCount = currentIntentional > 0 ? Math.floor((currentIntentional - 1) / speed) : 0;
            for (let n = prevBoostCount + 1; n <= newBoostCount; n++) {
                boostSet.push(n);
            }
        }
        moveInfo.boostSet = boostSet;
        moveInfo.isBoost = boostSet.length > 0;

        if (game.settings.get('lancer-automations', 'debugBoostDetection')) {
            ui.notifications.info(`${token.name}: moved ${distanceMoved} (cost ${movementCost}), intentional ${prevIntentional + movementCost}/${speed} | isBoost: ${moveInfo.isBoost}, boostSet: [${boostSet.join(',')}]`);
        }
    }

    // movementId is generated in #preUpdateMovement, after our preUpdateToken hook;
    // leave null here and let updateToken stamp it once finalized.
    const newData = {
        ...existingData,
        moves: [...existingMoves, {
            movementId: null,
            distanceMoved,
            movementCost,
            isDrag,
            isFreeMovement,
            isForceMovement,
            boostSet: moveInfo.boostSet || [],
            startPos
        }]
    };
    if (inCombat) {
        _moveHistoryCache.set(tokenId, newData);
        foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', newData);
        const isLastSegment = !options.rulerSegment || options.lastRulerSegment === true;
        if (tokenDoc.isOwner && isLastSegment) {
            tokenDoc.update({ 'flags.lancer-automations.moveHistory': newData });
        }
        if (isDrag && !isFreeMovement && !isTeleport && prevIntentional === 0)
            consumeAction(token, 'move');
    }

    if (!isDrag || options.IgnoreOnMove)
        return;

    await handleTrigger('onMove', { triggeringToken: token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });

    _advanceMoveStack('awaitMove', token.id, false);
}
