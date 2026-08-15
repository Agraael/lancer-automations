/* global canvas, PIXI, game, ui, $, document, globalThis */

import {
    isHexGrid, getHexCenter,
    drawHexAt, getOccupiedOffsets,
    getDistanceTokenToPoint,
    snapTokenCenter, getOccupiedGridSpaces, getInRangeOffsets,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import { keyCodesFor } from "../keybindings.js";

import {
    _queueCard, _queueCardUrgent, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    TG,
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    createPickerSession, createCursorPreview, drawRangeHighlight, applyKnockbackMoves, gridLineWidth, makeText,
    suppressEvent,
} from "../canvas-helpers.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { createWaypointCollector, movePathPoints, drawMovePath, movePathSegments } from "../move-waypoints.js";

let _lastKbPresenceAt = 0;

export function knockBackToken(tokens, distance, options = {})
{
    const _title = options.title || 'KNOCKBACK';
    const _queue = options.urgent === false ? _queueCard : _queueCardUrgent;
    return _queue(() => new Promise((resolve) =>
    {
        // reactive card: jumps any open mount-pick / weapon-pick card already in the queue.
        const {
            title = "KNOCKBACK",
            description = "Select destination for each token.",
            icon,
            headerClass = "",
            triggeringToken = null,
            actionName = "",
            item = null,
            asVoluntary = false
        } = options;

        if (!tokens || (Array.isArray(tokens) && tokens.length === 0))
        {
            resolve([]);
            return;
        }

        // State
        const tokenList = Array.isArray(tokens) ? tokens : [tokens];
        let activeIndex = 0;
        const moves = new Map();
        let confirmRunning = false;
        let lastCommit = null;

        // Visuals
        const traces = new Map(); // tokenId -> Graphics
        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        // Auto elevation follows the terrain under the active token's destination; Q/E shifts an offset.
        let pendingElevationOffset = 0;
        const waypointCollector = createWaypointCollector();
        let lastDest = null;
        let lastCursorColor = TG.inRange; // mirrors the live cursor's valid/invalid colour
        const groundUnder = (token, dest) =>
        {
            const terrainTools = globalThis.terrainHeightTools;
            if (!terrainTools)
                return 0;
            let max = 0;
            for (const cellOffset of getOccupiedOffsets(token, dest))
            {
                const groundElevation = Number(getHexGroundElevation(cellOffset.col, cellOffset.row, terrainTools)) || 0;
                if (groundElevation > max)
                    max = groundElevation;
            }
            return max;
        };
        const elevAtDest = (token, dest) => groundUnder(token, dest) + pendingElevationOffset;
        const elevStr = (elevation) => elevation > 0 ? `↑ ${elevation}` : elevation < 0 ? `↓ ${-elevation}` : `↕ 0`;
        const cursorElevLabel = makeText('', {
            fontFamily: 'Arial',
            fontSize: Math.max(14, canvas.grid.size * 0.22),
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: gridLineWidth(4),
            fontWeight: 'bold',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        canvas.stage.addChild(cursorElevLabel).eventMode = 'none';
        const updateElevLabel = (token, dest) =>
        {
            const cellCenter = token.getCenterPoint(dest);
            cursorElevLabel.text = elevStr(elevAtDest(token, dest));
            cursorElevLabel.x = cellCenter.x;
            cursorElevLabel.y = cellCenter.y - canvas.grid.size * 0.45;
            cursorElevLabel.visible = true;
        };
        // Presence: live cursor footprint (blue) + chosen destinations (yellow) + elevation labels.
        const presenceData = () =>
        {
            const placedCells = [];
            const originCells = [];
            const lines = [];
            const labels = [];
            for (const [id, moveRecord] of moves)
            {
                const token = tokenList.find(tk => tk.id === id);
                if (!token)
                    continue;
                for (const cellOffset of getOccupiedOffsets(token, { x: moveRecord.x, y: moveRecord.y }))
                    placedCells.push(`${cellOffset.col},${cellOffset.row}`);
                for (const cellOffset of getOccupiedOffsets(token))
                    originCells.push(`${cellOffset.col},${cellOffset.row}`);
                lines.push(...movePathSegments(movePathPoints(token, moveRecord.waypoints, { x: moveRecord.x, y: moveRecord.y })));
                const cellCenter = token.getCenterPoint({ x: moveRecord.x, y: moveRecord.y });
                labels.push({ x: cellCenter.x, y: cellCenter.y - canvas.grid.size * 0.45, text: elevStr(moveRecord.elevation) });
            }
            const activeToken = tokenList[activeIndex];
            const cells = (activeToken && lastDest)
                ? getOccupiedOffsets(activeToken, { x: lastDest.x, y: lastDest.y }).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                : [];
            if (activeToken && waypointCollector.length)
                lines.push(...movePathSegments(movePathPoints(activeToken, waypointCollector.list)));
            if (cursorElevLabel.visible)
                labels.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
            return {
                cells,
                placedCells,
                originCells,
                lines,
                labels,
                tokens: [],
                placedColor: TG.traceEnd,
                cellColor: lastCursorColor,
                lineColor: TG.traceLine,
                relatedToken: triggeringToken,
            };
        };

        const restoreLayerClick = suppressTokenLayerClick();
        let stopPresenceBeat = /** @type {null | (() => void)} */ (null);

        const doCleanup = () =>
        {
            if (stopPresenceBeat)
                stopPresenceBeat();
            clearToolPresence('knockBackToken');
            session.unbind();
            restoreLayerClick();
            waypointCollector.dispose();

            disposeCursorPreview();
            destroyGraphics(cursorElevLabel);
            rangePulse.clear('interactive:knockBack');
            for (const traceGraphic of traces.values())
                destroyGraphics(traceGraphic);

            _removeInfoCard(cardEl);
            setTimeout(() =>
            {
                if (!$('.la-info-card[data-card-type="knockBack"]').length)
                    $(`head style#la-kb-styles`).remove();
            }, 300);
        };

        // UI Card
        const cardEl = _createInfoCard("knockBack", {
            title,
            icon,
            headerClass,
            description,
            range: distance,
            count: tokenList.length,
            onConfirm: async () =>
            {
                if (confirmRunning)
                    return;
                confirmRunning = true;
                const pendingToken = tokenList[activeIndex];
                if (waypointCollector.length && pendingToken && !moves.has(pendingToken.id))
                {
                    const taken = waypointCollector.take();
                    const finalStop = taken.pop();
                    moves.set(pendingToken.id, { x: finalStop.x, y: finalStop.y, elevation: finalStop.elevation, waypoints: taken });
                }
                const moveList = [];
                for (const [id, move] of moves.entries())
                {
                    const token = tokenList.find(tok => tok.id === id);
                    if (token)
                        moveList.push({ tokenId: id, updateData: { x: move.x, y: move.y, elevation: move.elevation, waypoints: move.waypoints } });
                }

                if (game.user.isGM)
                    await applyKnockbackMoves(moveList, triggeringToken, distance, actionName, item, { asVoluntary });
                else
                {
                    game.socket.emit('module.lancer-automations', {
                        action: "moveTokens",
                        payload: {
                            moves: moveList,
                            triggeringTokenId: triggeringToken?.id || null,
                            distance,
                            actionName,
                            itemId: item?.id || null,
                            asVoluntary
                        }
                    });
                }

                doCleanup();
                resolve([]);
            },

            onCancel: () =>
            {
                doCleanup();
                resolve(null);
            }
        });

        if ($('head style#la-kb-styles').length === 0)
        {
            $('head').append(`
                <style id="la-kb-styles">
                    .la-knockback-list {
                        display: flex;
                        flex-direction: column;
                        gap: 4px;
                        max-height: 200px;
                        overflow-y: auto;
                    }
                    .la-knockback-item {
                        display: flex;
                        align-items: center;
                        padding: 4px;
                        border-radius: 4px;
                        cursor: pointer;
                        background: rgba(0,0,0,0.1);
                        border: 1px solid transparent;
                    }
                    .la-knockback-item:hover {
                        background: rgba(0,0,0,0.2);
                    }
                    .la-knockback-item.la-kb-active {
                        border-color: var(--lancer-color-orange, #ff6400);
                        background: rgba(255, 100, 0, 0.1);
                    }
                    .la-knockback-item.la-kb-moved .la-kb-name {
                        text-decoration: line-through;
                        opacity: 0.7;
                    }
                    .la-kb-img {
                        width: 24px;
                        height: 24px;
                        margin-right: 8px;
                        border: 1px solid #000;
                    }
                    .la-kb-name {
                        flex: 1;
                        white-space: nowrap;
                        overflow: hidden;
                        text-overflow: ellipsis;
                    }
                    .la-kb-status {
                        width: 20px;
                        text-align: center;
                    }
                </style>
            `);
        }

        const drawTrace = (token, targetX, targetY, waypoints = []) =>
        {
            if (traces.has(token.id))
                destroyGraphics(traces.get(token.id));

            const trace = new PIXI.Graphics();
            const gridSize = canvas.grid.size;

            // Draw Original Position
            trace.lineStyle(gridLineWidth(2), TG.traceStart, 0.8);
            trace.beginFill(TG.traceStart, 0.3);
            for (const cellOffset of getOccupiedOffsets(token))
            {
                if (isHexGrid())
                    drawHexAt(trace, cellOffset.col, cellOffset.row);
                else
                {
                    const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
                }
            }
            trace.endFill();

            // Draw Target Position
            trace.lineStyle(gridLineWidth(2), TG.traceEnd, 0.8);
            trace.beginFill(TG.traceEnd, 0.3);
            for (const cellOffset of getOccupiedOffsets(token, { x: targetX, y: targetY }))
            {
                if (isHexGrid())
                    drawHexAt(trace, cellOffset.col, cellOffset.row);
                else
                {
                    const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
                }
            }
            trace.endFill();

            trace.lineStyle(gridLineWidth(3), TG.traceLine, 1);
            drawMovePath(trace, movePathPoints(token, waypoints, { x: targetX, y: targetY }), { markerRadius: gridLineWidth(4) });

            addGraphicsBelowTokens(trace);
            traces.set(token.id, trace);
        };

        const updateVisuals = () =>
        {
            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;
            if (distance < 0)
            {
                rangePulse.clear('interactive:knockBack');
                return;
            }
            rangePulse.set('interactive:knockBack', {
                priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                signature: `${activeToken.id}|${distance}`,
                build: () =>
                {
                    const rangeHighlight = drawRangeHighlight(activeToken, distance, TG.rangeFill, 0.1, true);
                    return () => destroyGraphics(rangeHighlight);
                },
            });
        };

        const updateCard = () =>
        {
            _updateInfoCard(cardEl, "knockBack", {
                tokens: tokenList,
                moves,
                activeIndex,
                onSelectToken: (idx) =>
                {
                    activeIndex = idx;
                    waypointCollector.clear();
                    updateCard();
                    updateVisuals();
                }
            });
        };


        // Handlers
        const moveHandler = (event) =>
        {
            const { x: worldX, y: worldY } = pointerToWorld(event);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: worldX, y: worldY});
            const snappedX = snapped.x;
            const snappedY = snapped.y;
            const gridSize = canvas.grid.size;

            // Check validity (distance; -1 = infinite)
            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            const offsets = getOccupiedOffsets(activeToken, { x: snappedX, y: snappedY });
            if (offsets[0])
                playTargetingMove(offsets[0].col, offsets[0].row);
            const inRangeSet = distance < 0 ? null : getInRangeOffsets(activeToken, distance, { includeSelf: true });
            const inRange = distance < 0 || (dist <= distance && offsets.some(o => inRangeSet.has(`${o.col},${o.row}`)));

            const otherOccupied = getOccupiedGridSpaces([activeToken.id]);

            cursorPreview.clear();

            for (const o of offsets)
            {
                const key = `${o.col},${o.row}`;
                const isOverlapping = otherOccupied.has(key);

                let color, alpha;
                if (!inRange)
                {
                    color = 0x555555; // Greyish for out of range
                    alpha = 0.5;
                }
                else if (isOverlapping)
                {
                    color = TG.outOfRange;
                    alpha = 0.6;
                }
                else
                {
                    color = TG.inRange; // Blue valid
                    alpha = 0.4;
                }

                if (!inRange)
                    color = TG.outOfRange;
                else if (isOverlapping)
                    color = TG.outOfRange;

                cursorPreview.lineStyle(gridLineWidth(2), color, 0.8);
                cursorPreview.beginFill(color, alpha);
                if (isHexGrid())
                    drawHexAt(cursorPreview, o.col, o.row);
                else
                {
                    const center = getHexCenter(o.col, o.row);
                    cursorPreview.drawRect(center.x - gridSize/2, center.y - gridSize/2, gridSize, gridSize);
                }
                cursorPreview.endFill();
            }
            const anyOverlap = offsets.some(o => otherOccupied.has(`${o.col},${o.row}`));
            lastCursorColor = (!inRange || anyOverlap) ? TG.outOfRange : TG.inRange;
            lastDest = { x: snappedX, y: snappedY };
            updateElevLabel(activeToken, lastDest);
            const presenceNow = Date.now();
            if (presenceNow - _lastKbPresenceAt >= 80)
            {
                _lastKbPresenceAt = presenceNow;
                broadcastToolPresence('knockBackToken', presenceData());
            }
        };

        const clickHandler = (event) =>
        {
            const { x: worldX, y: worldY } = pointerToWorld(event);

            const activeToken = tokenList[activeIndex];
            if (!activeToken)
                return;

            const snapped = snapTokenCenter(activeToken, {x: worldX, y: worldY});
            const snappedX = snapped.x;
            const snappedY = snapped.y;

            const dist = getDistanceTokenToPoint({ x: snappedX + activeToken.w/2, y: snappedY + activeToken.h/2 }, activeToken);
            const dstOffsets = getOccupiedOffsets(activeToken, { x: snappedX, y: snappedY });
            const dstInRangeSet = distance < 0 ? null : getInRangeOffsets(activeToken, distance, { includeSelf: true });
            const dstInRange = distance < 0 || (dist <= distance && dstOffsets.some(o => dstInRangeSet.has(`${o.col},${o.row}`)));
            if (!dstInRange)
            {
                ui.notifications.warn("Destination is out of range!");
                return;
            }

            if (waypointCollector.isAddClick(event))
            {
                waypointCollector.add({ x: snappedX, y: snappedY, elevation: elevAtDest(activeToken, { x: snappedX, y: snappedY }) });
                playUiSound('targeting');
                drawTrace(activeToken, snappedX, snappedY, waypointCollector.list.slice(0, -1));
                broadcastToolPresence('knockBackToken', presenceData());
                return;
            }

            const commitNow = Date.now();
            const duplicateCommit = lastCommit && (commitNow - lastCommit.time) < 250
                && Math.round(lastCommit.x) === Math.round(snappedX) && Math.round(lastCommit.y) === Math.round(snappedY);
            if (duplicateCommit)
                return;
            lastCommit = { x: snappedX, y: snappedY, time: commitNow };
            const previousMove = moves.get(activeToken.id);
            const samePlacement = previousMove && Math.round(previousMove.x) === Math.round(snappedX) && Math.round(previousMove.y) === Math.round(snappedY);
            const committedWaypoints = waypointCollector.length
                ? waypointCollector.take()
                : (samePlacement ? (previousMove.waypoints ?? []) : []);
            moves.set(activeToken.id, { x: snappedX, y: snappedY, elevation: elevAtDest(activeToken, { x: snappedX, y: snappedY }), waypoints: committedWaypoints });
            playUiSound('targetingConfirm');
            drawTrace(activeToken, snappedX, snappedY, moves.get(activeToken.id).waypoints);
            broadcastToolPresence('knockBackToken', presenceData());

            let nextIndex = -1;
            for (let i = 1; i <= tokenList.length; i++)
            {
                const idx = (activeIndex + i) % tokenList.length;
                if (!moves.has(tokenList[idx].id))
                {
                    nextIndex = idx;
                    break;
                }
            }

            if (nextIndex !== -1)
                activeIndex = nextIndex;
            else
                activeIndex = (activeIndex + 1) % tokenList.length;

            updateCard();
            updateVisuals();
        };

        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const keyHandler = (event) =>
        {
            if (event.key === "Escape")
            {
                suppressEvent(event);
                doCleanup();
                resolve(null);
                return;
            }
            let step = 0;
            if (ascendKeys.has(event.code))
                step = 1;
            else if (descendKeys.has(event.code))
                step = -1;
            if (step === 0)
                return;
            // Swallow Q/E so it never changes the real token's elevation.
            suppressEvent(event);
            pendingElevationOffset += step;
            const token = tokenList[activeIndex];
            if (token && lastDest)
                updateElevLabel(token, lastDest);
            playUiSound('targeting');
        };

        // Initialize
        updateVisuals();
        updateCard();

        const session = createPickerSession('knockBackToken', () =>
        {
            try
            {
                doCleanup();
            }
            catch
            { /* */ }
            resolve([]);
        });
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler });
        stopPresenceBeat = startToolHeartbeat('knockBackToken', presenceData);
    }), _title);
}
