import { snapTokenCenter, getInRangeOffsets, getOccupiedOffsets, pixelToOffset, getHexCenter, neighborKeys } from "../../combat/grid-helpers.js";
import { playTargetingMove, playUiSound, WAYPOINT_ADD_SOUND, WAYPOINT_REMOVE_SOUND } from "../../tah/sound.js";
import { _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard } from "../cards.js";
import {
    RANGE_PULSE_STYLE,
    pointerToWorld, suppressTokenLayerClick, addGraphicsBelowTokens,
    createPickerSession, createMultiPlusIndicator, isCtrlDown,
    _groupCellsByDistance, _makeRangePulseTick,
    paintCellRegion, paintPerimeterGlow,
    _staticGridAlpha,
    suppressEvent,
    teardownRangePulse,
    applyKnockbackMoves,
} from "../canvas-helpers.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { moveTokenTo, awaitMovementSettled } from "../../movement/move-api.js";
import { _transformFoundPath } from "../../movement/terrain-trigger-waypoints.js";

// Above this budget the cost-aware Dijkstra sweep gets too big; fall back to plain grid range.
const REACHABLE_BUDGET_CAP = 15;

/**
 * moveToken variant rendered with the core drag ruler (pathfinding included).
 * Hover previews the path, Ctrl+click adds a waypoint, right-click removes the last one
 * (or clears the picked destination), click picks the destination; only the card's Confirm
 * commits, Cancel exits. The range pulse shows cost-aware reachable cells, re-anchored on
 * the last waypoint. With several tokens, each is planned in turn (card row click switches)
 * and Confirm commits every planned move.
 * @param {Token|Token[]} tokenOrTokens
 * @param {Object} [options]
 * @param {number} [options.range=-1] Max movement budget in grid units (-1 = unlimited), soft warning only
 * @param {boolean} [options.free=false] Free movement: no cap consumption, involuntary
 * @param {string} [options.action] Movement action from CONFIG.Token.movement.actions ("walk", "fly", "blink", "displace", ...). "blink" teleports, "displace"/"forced" are forced; these ignore walls and cost.
 * @param {string} [options.title="MOVE"]
 * @param {string} [options.description="Select destination."]
 * @param {string} [options.icon]
 * @param {string} [options.headerClass]
 * @param {number} [options.cost] Fixed movement cost recorded for the move, instead of the measured path cost
 * @param {boolean} [options.urgent=false] Jump the card queue
 * @param {boolean} [options.planOnly=false] Resolve the planned paths without moving: Array<{token, path}>
 * @returns {Promise<TokenDocument|TokenDocument[]|Array<{token: Token, path: object[]}>|null>} Moved doc(s) matching the input shape (plans with planOnly), null on cancel
 */
export async function moveTokenRuler(tokenOrTokens, options = {})
{
    const isMulti = Array.isArray(tokenOrTokens);
    const tokenList = (isMulti ? tokenOrTokens : [tokenOrTokens]).filter(candidate => candidate?.document);
    if (!tokenList.length)
        return null;
    const range = options.range ?? -1;
    const free = !!options.free;
    const cost = Number.isFinite(options.cost) ? options.cost : null;
    const action = options.action ?? null;
    const actions = CONFIG.Token?.movement?.actions ?? {};
    if (action && !actions[action])
        console.warn(`lancer-automations | moveTokenRuler: unknown movement action "${action}", core falls back to displace.`);
    const unconstrained = !!(action && (actions[action]?.teleport || action === 'displace' || action === 'forced'));

    const picked = await _queueCard(() => new Promise((resolve) =>
    {
        const {
            title = "MOVE",
            description = "Select destination.",
            icon,
            headerClass = ""
        } = /** @type {any} */ (options);

        const states = new Map();
        for (const moveTok of tokenList)
        {
            const doc = moveTok.document;
            states.set(moveTok.id, {
                origin: {
                    x: doc.x,
                    y: doc.y,
                    elevation: doc.elevation,
                    width: doc.width,
                    height: doc.height,
                    shape: doc.shape,
                    action: action ?? doc.movementAction,
                    snapped: false,
                    explicit: false,
                    checkpoint: true
                },
                waypoints: [],
                selectedPos: null,
                commitPath: null,
                pendingElevationOffset: 0,
                pathfinderStarted: false
            });
        }
        let activeIndex = 0;
        const active = () => tokenList[activeIndex];
        const stateOf = (moveTok) => states.get(moveTok.id);
        let search = null;
        let searchId = 0;
        let lastSnapped = null;
        let reachableSet = null;
        const plusIndicator = createMultiPlusIndicator({ modifier: 'Control' });
        const GridCoordinates3d = CONFIG.GeometryLib?.lib?.threeD?.GridCoordinates3d ?? null;

        // ER's findMovementPath wrap only pathfinds while its per-token pathfinder is started (drag lifecycle).
        const startPathfinder = (moveTok) =>
        {
            const pathfinder = moveTok.elevationruler?.pathfinding;
            if (!pathfinder || !GridCoordinates3d || stateOf(moveTok).pathfinderStarted)
                return;
            try
            {
                const start = GridCoordinates3d.fromObject(moveTok.getCenterPoint());
                start.elevation = moveTok.bottomE;
                pathfinder.startPathfinding(start);
                stateOf(moveTok).pathfinderStarted = true;
            }
            catch (err)
            {
                console.warn('lancer-automations | moveTokenRuler: pathfinder start failed:', err);
            }
        };
        const endPathfinder = (moveTok) =>
        {
            if (!stateOf(moveTok).pathfinderStarted)
                return;
            try
            {
                moveTok.elevationruler?.pathfinding?.endPathfinding();
            }
            catch
            {
            }
            stateOf(moveTok).pathfinderStarted = false;
        };

        const clearRulerPreview = (moveTok) =>
        {
            if (game.user.id in moveTok._plannedMovement)
            {
                delete moveTok._plannedMovement[game.user.id];
                moveTok.renderFlags.set({ refreshRuler: true, refreshState: true });
            }
        };

        const showRulerPath = (moveTok, path) =>
        {
            const doc = moveTok.document;
            const foundPath = doc.getCompleteMovementPath(moveTok.createTerrainMovementPath(path, { preview: true }));
            const combined = [...doc.movementHistory, ...foundPath];
            const measurement = moveTok.measureMovementPath(combined, { preview: true });
            for (let waypointIdx = doc.movementHistory.length; waypointIdx < combined.length; waypointIdx++)
                combined[waypointIdx].cost = measurement.waypoints[waypointIdx].backward?.cost ?? 0;
            const current = doc.movementHistory.at(-1);
            const first = foundPath[0];
            first.action = (current !== undefined) && !TokenDocument.arePositionsEqual(current, first)
                ? "displace" : (current?.action ?? first.action);
            first.terrain = null;
            first.snapped = false;
            first.explicit = false;
            first.checkpoint = true;
            first.cost = 0;
            moveTok._plannedMovement[game.user.id] = {
                foundPath,
                unreachableWaypoints: [],
                history: doc.movementHistory,
                hidden: false,
                searching: false
            };
            moveTok.renderFlags.set({ refreshRuler: true, refreshState: true });
        };

        const destWaypoint = (moveTok, snapped) =>
        {
            const doc = moveTok.document;
            const state = stateOf(moveTok);
            return {
                x: snapped.x,
                y: snapped.y,
                elevation: doc.elevation + state.pendingElevationOffset,
                width: doc.width,
                height: doc.height,
                shape: doc.shape,
                action: action ?? moveTok._getDragMovementAction(),
                snapped: true,
                explicit: true,
                checkpoint: true
            };
        };

        const recalcPath = (moveTok, snapped) =>
        {
            const state = stateOf(moveTok);
            search?.cancel();
            searchId += 1;
            const thisSearch = searchId;
            const explicitWaypoints = [state.origin, ...state.waypoints, destWaypoint(moveTok, snapped)];
            search = moveTok.findMovementPath(explicitWaypoints, moveTok._getDragPathfindingOptions());
            search.promise.then((path) =>
            {
                if (!path || thisSearch !== searchId || moveTok.destroyed)
                    return;
                // same route injection LA applies to real drags (A* around bodies/terrain + trigger splits)
                let routed = path;
                try
                {
                    routed = _transformFoundPath(moveTok, path) ?? path;
                }
                catch
                {
                    routed = path;
                }
                state.commitPath = routed;
                showRulerPath(moveTok, routed);
            }).catch(() =>
            {});
        };

        const cellWaypoint = (moveTok, center, elevation) =>
        {
            const doc = moveTok.document;
            return {
                x: center.x - moveTok.w / 2,
                y: center.y - moveTok.h / 2,
                elevation,
                width: doc.width,
                height: doc.height,
                shape: doc.shape,
                action: action ?? doc.movementAction
            };
        };

        const wallBlocked = (centerA, centerB) =>
            CONFIG.Canvas.polygonBackends.move.testCollision(centerA, centerB, { type: 'move', mode: 'any' });

        const stepCostBetween = (moveTok, centerA, centerB, elevation) =>
        {
            try
            {
                const stepCost = moveTok.measureMovementPath(
                    [cellWaypoint(moveTok, centerA, elevation), cellWaypoint(moveTok, centerB, elevation)],
                    { preview: true }).cost;
                return Number.isFinite(stepCost) ? Math.max(1, stepCost) : Infinity;
            }
            catch
            {
                return 1;
            }
        };

        const computeReachableSet = (moveTok, fromWaypoint, budget) =>
        {
            const reachable = new Set();
            if (budget <= 0)
                return reachable;
            const fromCenter = { x: fromWaypoint.x + moveTok.w / 2, y: fromWaypoint.y + moveTok.h / 2 };
            if (unconstrained || budget > REACHABLE_BUDGET_CAP)
                return getInRangeOffsets(fromCenter, budget, { includeSelf: true });
            const dist = new Map();
            for (const startCell of getOccupiedOffsets(moveTok, { x: fromWaypoint.x, y: fromWaypoint.y }))
            {
                const key = `${startCell.col},${startCell.row}`;
                dist.set(key, 0);
                reachable.add(key);
            }
            const frontier = [...reachable];
            while (frontier.length)
            {
                let bestIdx = 0;
                for (let idx = 1; idx < frontier.length; idx++)
                {
                    if ((dist.get(frontier[idx]) ?? Infinity) < (dist.get(frontier[bestIdx]) ?? Infinity))
                        bestIdx = idx;
                }
                const currentKey = frontier.splice(bestIdx, 1)[0];
                const currentCost = dist.get(currentKey);
                const [col, row] = currentKey.split(',').map(Number);
                const currentCenter = getHexCenter(col, row);
                for (const neighborKey of neighborKeys(currentKey))
                {
                    const [neighborCol, neighborRow] = neighborKey.split(',').map(Number);
                    const neighborCenter = getHexCenter(neighborCol, neighborRow);
                    const nextCost = currentCost + stepCostBetween(moveTok, currentCenter, neighborCenter, fromWaypoint.elevation);
                    if (nextCost > budget)
                        continue;
                    if (nextCost >= (dist.get(neighborKey) ?? Infinity))
                        continue;
                    if (wallBlocked(currentCenter, neighborCenter))
                        continue;
                    dist.set(neighborKey, nextCost);
                    reachable.add(neighborKey);
                    frontier.push(neighborKey);
                }
            }
            return reachable;
        };

        const usedBudget = (moveTok) =>
        {
            const state = stateOf(moveTok);
            if (!state.waypoints.length)
                return 0;
            try
            {
                const usedCost = moveTok.measureMovementPath([state.origin, ...state.waypoints], { preview: true }).cost;
                return Number.isFinite(usedCost) ? usedCost : 0;
            }
            catch
            {
                return 0;
            }
        };

        const rebuildPulse = () =>
        {
            if (range < 0)
                return;
            const moveTok = active();
            const state = stateOf(moveTok);
            const fromWaypoint = state.waypoints.at(-1) ?? state.origin;
            const remaining = Math.max(0, range - usedBudget(moveTok));
            reachableSet = computeReachableSet(moveTok, fromWaypoint, remaining);
            const fromOffsets = getOccupiedOffsets(moveTok, { x: fromWaypoint.x, y: fromWaypoint.y });
            rangePulse.set('interactive:moveTokenRuler', {
                priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                build: () =>
                {
                    const baseGraphic = new PIXI.Graphics();
                    paintCellRegion(baseGraphic, reachableSet, {
                        color: RANGE_PULSE_STYLE.baseColor,
                        alpha: RANGE_PULSE_STYLE.staticFillAlpha,
                        lineColor: RANGE_PULSE_STYLE.lineColor,
                        lineAlpha: _staticGridAlpha(RANGE_PULSE_STYLE.staticLineAlpha),
                    });
                    paintPerimeterGlow(baseGraphic, reachableSet);
                    addGraphicsBelowTokens(baseGraphic);
                    const pulseGraphic = new PIXI.Graphics();
                    canvas.stage.addChild(pulseGraphic).eventMode = 'none';
                    const hexesByDist = _groupCellsByDistance(fromOffsets, reachableSet);
                    const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, Math.max(1, remaining), { originToken: moveTok });
                    canvas.app.ticker.add(wavePulse);
                    return () => teardownRangePulse(wavePulse, baseGraphic, pulseGraphic);
                },
            });
        };

        const isDestInRange = (moveTok, snappedX, snappedY) =>
        {
            if (range < 0 || !reachableSet)
                return true;
            return getOccupiedOffsets(moveTok, { x: snappedX, y: snappedY })
                .some(cellOffset => reachableSet.has(`${cellOffset.col},${cellOffset.row}`));
        };

        const updateCard = () =>
        {
            const state = stateOf(active());
            _updateInfoCard(cardEl, "teleport", {
                tokens: tokenList.length > 1
                    ? tokenList.map(moveTok => ({
                        name: moveTok.name,
                        img: moveTok.document.texture.src,
                        planned: !!stateOf(moveTok).selectedPos
                    }))
                    : null,
                activeIndex,
                onSelectToken: selectToken,
                selectedPos: state.selectedPos,
                tokenName: active().name
            });
        };

        const selectToken = (idx) =>
        {
            if (idx === activeIndex || !tokenList[idx])
                return;
            endPathfinder(active());
            activeIndex = idx;
            startPathfinder(active());
            lastSnapped = null;
            rebuildPulse();
            updateCard();
        };

        const advanceToUnplanned = () =>
        {
            for (let step = 1; step <= tokenList.length; step++)
            {
                const idx = (activeIndex + step) % tokenList.length;
                if (!stateOf(tokenList[idx]).selectedPos)
                {
                    selectToken(idx);
                    return;
                }
            }
            updateCard();
        };

        const restoreLayerClick = suppressTokenLayerClick();
        const doCleanup = () =>
        {
            search?.cancel();
            searchId += 1;
            for (const moveTok of tokenList)
            {
                clearRulerPreview(moveTok);
                endPathfinder(moveTok);
            }
            plusIndicator.dispose();
            rangePulse.clear('interactive:moveTokenRuler');
            session.unbind();
            restoreLayerClick();
            _removeInfoCard(cardEl);
        };

        const cardEl = _createInfoCard("teleport", {
            title,
            icon,
            headerClass,
            description,
            isMulti: tokenList.length > 1,
            range: range >= 0 ? range : undefined,
            onConfirm: () =>
            {
                const plans = tokenList
                    .filter(moveTok => stateOf(moveTok).selectedPos && stateOf(moveTok).commitPath)
                    .map(moveTok => ({ token: moveTok, path: stateOf(moveTok).commitPath }));
                if (!plans.length)
                {
                    ui.notifications.warn("Pick a destination first.");
                    return;
                }
                doCleanup();
                resolve(plans);
            },
            onCancel: () =>
            {
                doCleanup();
                resolve(null);
            }
        });

        const moveHandler = (event) =>
        {
            const { x, y } = pointerToWorld(event);
            plusIndicator.move(isCtrlDown(event), x, y);
            const moveTok = active();
            if (stateOf(moveTok).selectedPos)
                return;
            const snapped = snapTokenCenter(moveTok, { x, y });
            lastSnapped = snapped;
            const snappedOffset = pixelToOffset(snapped.x, snapped.y);
            playTargetingMove(snappedOffset.col, snappedOffset.row);
            recalcPath(moveTok, snapped);
        };

        const clickHandler = (event) =>
        {
            const moveTok = active();
            const state = stateOf(moveTok);
            const { x, y } = pointerToWorld(event);
            const snapped = snapTokenCenter(moveTok, { x, y });
            lastSnapped = snapped;
            if (!isDestInRange(moveTok, snapped.x, snapped.y))
                ui.notifications.warn("Destination is out of range.");
            if (isCtrlDown(event))
            {
                state.selectedPos = null;
                state.waypoints.push(destWaypoint(moveTok, snapped));
                playUiSound(WAYPOINT_ADD_SOUND);
                rebuildPulse();
                recalcPath(moveTok, snapped);
                updateCard();
                return;
            }
            if (state.selectedPos)
            {
                state.selectedPos = null;
                recalcPath(moveTok, snapped);
                updateCard();
                return;
            }
            state.selectedPos = { x: snapped.x, y: snapped.y, elevation: moveTok.document.elevation + state.pendingElevationOffset };
            playUiSound('targetingConfirm');
            recalcPath(moveTok, snapped);
            if (tokenList.length > 1)
                advanceToUnplanned();
            else
                updateCard();
        };

        const rightHandler = (event) =>
        {
            const moveTok = active();
            const state = stateOf(moveTok);
            if (!state.selectedPos && !state.waypoints.length)
                return;
            suppressEvent(event);
            if (state.selectedPos)
                state.selectedPos = null;
            else
                state.waypoints.pop();
            playUiSound(WAYPOINT_REMOVE_SOUND);
            rebuildPulse();
            if (lastSnapped)
                recalcPath(moveTok, lastSnapped);
            updateCard();
        };

        const keyHandler = (event) =>
        {
            if (event.key === 'Escape')
            {
                suppressEvent(event);
                doCleanup();
                resolve(null);
                return;
            }
            let step = 0;
            if (event.code === 'KeyE')
                step = 1;
            else if (event.code === 'KeyQ')
                step = -1;
            if (step === 0)
                return;
            suppressEvent(event);
            stateOf(active()).pendingElevationOffset += step;
            playUiSound('targeting');
        };

        const session = createPickerSession('moveTokenRuler', () =>
        {
            try
            {
                doCleanup();
            }
            catch
            {
            }
            resolve(null);
        });
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler, rightClick: rightHandler, clickFirst: true });
        startPathfinder(active());
        rebuildPulse();
        updateCard();
    }), options.title ?? "MOVE", { urgent: !!options.urgent });

    if (!picked)
        return null;
    if (options.planOnly)
        return picked;
    const movedDocs = [];
    for (const plan of picked)
    {
        await moveTokenTo(plan.token, plan.path.slice(1), {
            showRuler: true,
            ...(free ? {} : { isDrag: true }),
            ...(cost !== null ? { lancerSegmentCost: cost, lancerSegmentDistance: cost } : {}),
            ...(unconstrained ? { constrainOptions: { ignoreWalls: true, ignoreCost: true } } : {})
        });
        await awaitMovementSettled(plan.token.document);
        movedDocs.push(plan.token.document);
    }
    return isMulti ? movedDocs : (movedDocs[0] ?? null);
}

/**
 * Knockback with the drag-ruler picker. Plans every token like moveTokenRuler, then commits
 * through applyKnockbackMoves (GM) or the moveTokens socket (player): onInvoluntaryMove
 * trigger, immovable warning, forced action, battlelog source.
 * @param {Token|Token[]} tokens
 * @param {number} distance Knockback distance in grid units (-1 = unlimited)
 * @param {Object} [options]
 * @param {Token} [options.triggeringToken] Source of the knockback (reactions, battlelog)
 * @param {string} [options.actionName]
 * @param {any} [options.item]
 * @param {boolean} [options.asVoluntary=false]
 * @param {boolean} [options.setElevation=false]
 * @param {boolean} [options.urgent=true] Jump the card queue; pass false to queue normally
 * @param {string} [options.title="KNOCKBACK"]
 * @param {string} [options.description="Select destination for each token."]
 * @returns {Promise<Array<{tokenId: string, updateData: object}>>} The planned moves, [] on cancel
 */
export async function knockBackToken(tokens, distance, options = {})
{
    const plans = await moveTokenRuler(Array.isArray(tokens) ? tokens : [tokens], {
        range: distance,
        action: 'forced',
        planOnly: true,
        urgent: options.urgent !== false,
        title: options.title || 'KNOCKBACK',
        description: options.description || 'Select destination for each token.',
        icon: /** @type {any} */ (options).icon ?? 'fas fa-arrow-right',
        headerClass: /** @type {any} */ (options).headerClass ?? ''
    });
    if (!Array.isArray(plans) || !plans.length)
        return [];
    const moveList = plans.map(plan =>
    {
        const dest = plan.path.at(-1);
        const intermediate = plan.path.slice(1, -1)
            .map(waypoint => ({ x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation, action: waypoint.action }));
        return {
            tokenId: plan.token.id,
            updateData: {
                x: dest.x,
                y: dest.y,
                elevation: dest.elevation,
                ...(intermediate.length ? { waypoints: intermediate } : {})
            }
        };
    });
    if (game.user.isGM)
    {
        await applyKnockbackMoves(moveList, options.triggeringToken ?? null, distance, options.actionName ?? "", options.item ?? null, {
            asVoluntary: !!options.asVoluntary,
            setElevation: !!options.setElevation
        });
    }
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "moveTokens",
            payload: {
                moves: moveList,
                triggeringTokenId: options.triggeringToken?.id || null,
                distance,
                actionName: options.actionName ?? "",
                itemId: options.item?.id || null,
                asVoluntary: !!options.asVoluntary
            }
        });
    }
    return moveList;
}

export const knockBackTokenRuler = knockBackToken;
