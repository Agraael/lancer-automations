/* global canvas, PIXI, ui, Ray, document */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    getDistanceTokenToPoint,
    snapTokenCenter, getInRangeOffsets,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import { playTargetingMove, playUiSound } from "../../tah/sound.js";
import { keyCodesFor } from "../keybindings.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    TG,
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight,
    _groupCellsByDistance, _makeRangePulseTick, gridLineWidth, makeText,
    suppressEvent,
} from "../canvas-helpers.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";
import { createWaypointCollector, movePathPoints, drawMovePath, movePathSegments, movePathLegs } from "../move-waypoints.js";
import { awaitMovementSettled } from "../../movement/move-api.js";

/**
 * Move a token to a destination, bypassing normal movement rules (like knockback).
 * If no destination is provided, shows an interactive card with range highlight.
 * Records movement in lancer-automations history.
 * @param {Token} token - The token to move
 * @param {Object} [options={}]
 * @param {{x: number, y: number}} [options.destination] - Destination center point. If omitted, interactive mode.
 * @param {number} [options.cost] - Override movement cost (default: actual grid distance)
 * @param {boolean} [options.teleport=false] - If true, plays teleport VFX and marks as teleport in history
 * @param {string} [options.action] - Movement action key from CONFIG.Token.movement.actions ("fly", "walk", "blink", ...). Animates the move with that type; forced (ignores walls/cost). v13 only; "blink" is teleport. Takes precedence over teleport.
 * @param {number} [options.range=-1] - Max range in grid units (-1 = unlimited)
 * @param {string} [options.title] - Card title (default: "TELEPORT" or "MOVE")
 * @param {string} [options.description="Select destination."] - Card description
 * @returns {Promise<TokenDocument|null>} Updated doc, or null if cancelled
 */
export async function moveToken(token, options = {})
{
    if (!token?.document)
        return null;

    let destTopLeft;
    let pathWaypoints = null;
    if (options.destination)
    {
        // Direct mode: snap destination center to top-left
        const center = canvas.grid.getCenterPoint(options.destination);
        destTopLeft = token.getSnappedPosition({ x: center.x - token.w / 2, y: center.y - token.h / 2 });
    }
    else
    {
        // Interactive mode: show card with range highlight, user clicks hex
        const range = options.range ?? -1;
        const defaultTitle = options.teleport ? "TELEPORT" : "MOVE";
        const picked = await _queueCard(() => new Promise((resolve) =>
        {
            const {
                title = defaultTitle,
                description = "Select destination.",
                icon,
                headerClass = ""
            } = options;

            const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
            let trace = null;
            let selectedPos = null;
            const waypointCollector = createWaypointCollector();

            // Auto elevation follows the terrain under the destination footprint; Q/E shifts an offset.
            let autoElevation = true;
            let pendingElevationOffset = 0;
            let lastDest = null;
            let lastCursorColor = 0x00cc66; // mirrors the live cursor's in-range/out-of-range colour
            const groundUnder = (dest) =>
            {
                const terrainAPI = globalThis.terrainHeightTools;
                if (!terrainAPI)
                    return 0;
                let maxHeight = 0;
                for (const cellOffset of getOccupiedOffsets(token, dest))
                {
                    const groundHeight = Number(getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI)) || 0;
                    if (groundHeight > maxHeight)
                        maxHeight = groundHeight;
                }
                return maxHeight;
            };
            const elevAtDest = (dest) => (autoElevation ? groundUnder(dest) : 0) + pendingElevationOffset;
            const elevStr = (elev) => elev > 0 ? `↑ ${elev}` : elev < 0 ? `↓ ${-elev}` : `↕ 0`;
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
            const updateElevLabel = (dest) =>
            {
                const centerPoint = token.getCenterPoint(dest);
                cursorElevLabel.text = elevStr(elevAtDest(dest));
                cursorElevLabel.x = centerPoint.x;
                cursorElevLabel.y = centerPoint.y - canvas.grid.size * 0.45;
                cursorElevLabel.visible = true;
            };
            // Presence: live cursor footprint (blue) + chosen destination (yellow) + elevation labels.
            const presenceData = () =>
            {
                const placedCells = selectedPos
                    ? getOccupiedOffsets(token, { x: selectedPos.x, y: selectedPos.y }).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const originCells = selectedPos
                    ? getOccupiedOffsets(token).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const lines = [];
                if (selectedPos)
                    lines.push(...movePathSegments(movePathPoints(token, selectedPos.waypoints, { x: selectedPos.x, y: selectedPos.y })));
                if (waypointCollector.length)
                    lines.push(...movePathSegments(movePathPoints(token, waypointCollector.list)));
                const cells = lastDest
                    ? getOccupiedOffsets(token, { x: lastDest.x, y: lastDest.y }).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const labels = [];
                if (cursorElevLabel.visible)
                    labels.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
                if (selectedPos)
                {
                    const centerPoint = token.getCenterPoint({ x: selectedPos.x, y: selectedPos.y });
                    labels.push({ x: centerPoint.x, y: centerPoint.y - canvas.grid.size * 0.45, text: elevStr(selectedPos.elevation) });
                }
                return {
                    cells,
                    placedCells,
                    originCells,
                    lines,
                    labels,
                    tokens: [],
                    cellColor: lastCursorColor,
                    placedColor: 0x00cc66,
                    lineColor: 0x00cc66,
                    relatedToken: token,
                };
            };

            const restoreLayerClick = suppressTokenLayerClick();
            let safeMove, safeClick, safeAbort, safeKey;
            let stopPresenceBeat = /** @type {null | (() => void)} */ (null);

            const doCleanup = () =>
            {
                if (stopPresenceBeat)
                    stopPresenceBeat();
                clearToolPresence('moveToken');
                disposeCursorPreview();
                destroyGraphics(cursorElevLabel);
                rangePulse.clear('interactive:moveToken');
                if (safeClick)
                    canvas.stage.off('click', safeClick);
                if (safeAbort)
                    canvas.stage.off('rightdown', safeAbort);
                if (safeMove)
                    canvas.stage.off('pointermove', safeMove);
                if (safeKey)
                    document.removeEventListener('keydown', safeKey, true);
                restoreLayerClick();
                waypointCollector.dispose();
                destroyGraphics(trace);
                _removeInfoCard(cardEl);
            };

            const cardEl = _createInfoCard("teleport", {
                title,
                icon,
                headerClass,
                description,
                range: range >= 0 ? range : undefined,
                onConfirm: () =>
                {
                    if (!selectedPos && waypointCollector.length)
                    {
                        const taken = waypointCollector.take();
                        const finalStop = taken.pop();
                        selectedPos = { ...finalStop, waypoints: taken };
                    }
                    doCleanup();
                    resolve(selectedPos);
                },
                onCancel: () =>
                {
                    doCleanup(); resolve(null);
                }
            });

            const inRangeSet = range >= 0 ? getInRangeOffsets(token, range, { includeSelf: true }) : null;
            const isDestInRange = (snappedX, snappedY) =>
            {
                if (!inRangeSet)
                    return true;
                return getOccupiedOffsets(token, { x: snappedX, y: snappedY })
                    .some(cellOffset => inRangeSet.has(`${cellOffset.col},${cellOffset.row}`));
            };
            if (range >= 0)
            {
                rangePulse.set('interactive:moveToken', {
                    priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                    build: () =>
                    {
                        const rangeHighlight = drawRangeHighlight(token, range, TG.rangeFill, 0.1, true);
                        const pulseGraphic = new PIXI.Graphics();
                        addGraphicsBelowTokens(pulseGraphic);
                        const hexesByDist = _groupCellsByDistance(getOccupiedOffsets(token), inRangeSet);
                        const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range, { originToken: token });
                        canvas.app.ticker.add(wavePulse);
                        return () =>
                        {
                            canvas.app.ticker.remove(wavePulse);
                            destroyGraphics(rangeHighlight);
                            destroyGraphics(pulseGraphic);
                        };
                    },
                });
            }

            const drawTeleportTrace = (targetX, targetY, waypoints = []) =>
            {
                destroyGraphics(trace);
                trace = new PIXI.Graphics();
                const gridSize = canvas.grid.size;
                // Original position
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
                // Target position (green for teleport)
                trace.lineStyle(gridLineWidth(2), 0x00cc66, 0.8);
                trace.beginFill(0x00cc66, 0.3);
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
                trace.lineStyle(gridLineWidth(3), 0x00cc66, 0.8);
                drawMovePath(trace, movePathPoints(token, waypoints, { x: targetX, y: targetY }), { markerRadius: gridLineWidth(4) });
                addGraphicsBelowTokens(trace);
            };

            const moveHandler = (event) =>
            {
                const { x, y } = pointerToWorld(event);
                const snapped = snapTokenCenter(token, { x, y });
                const snappedOffset = pixelToOffset(snapped.x, snapped.y);
                playTargetingMove(snappedOffset.col, snappedOffset.row);
                const inRange = isDestInRange(snapped.x, snapped.y);
                cursorPreview.clear();
                const offsets = getOccupiedOffsets(token, { x: snapped.x, y: snapped.y });
                const color = inRange ? 0x00cc66 : TG.outOfRange;
                lastCursorColor = color;
                const alpha = inRange ? 0.4 : 0.5;
                cursorPreview.lineStyle(gridLineWidth(2), color, 0.8);
                cursorPreview.beginFill(color, alpha);
                for (const cellOffset of offsets)
                {
                    if (isHexGrid())
                        drawHexAt(cursorPreview, cellOffset.col, cellOffset.row);
                    else
                    {
                        const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); cursorPreview.drawRect(cellCenter.x - canvas.grid.size / 2, cellCenter.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
                    }
                }
                cursorPreview.endFill();
                lastDest = { x: snapped.x, y: snapped.y };
                updateElevLabel(lastDest);
                broadcastToolPresence('moveToken', presenceData());
            };

            const clickHandler = (event) =>
            {
                const { x, y } = pointerToWorld(event);
                const snapped = snapTokenCenter(token, { x, y });
                if (!isDestInRange(snapped.x, snapped.y))
                    ui.notifications.warn("Destination is out of range.");
                if (waypointCollector.isAddClick(event))
                {
                    waypointCollector.add({ x: snapped.x, y: snapped.y, elevation: elevAtDest({ x: snapped.x, y: snapped.y }) });
                    playUiSound('targeting');
                    drawTeleportTrace(snapped.x, snapped.y, waypointCollector.list.slice(0, -1));
                    broadcastToolPresence('moveToken', presenceData());
                    return;
                }
                const samePlacement = selectedPos && Math.round(selectedPos.x) === Math.round(snapped.x) && Math.round(selectedPos.y) === Math.round(snapped.y);
                const committedWaypoints = waypointCollector.length
                    ? waypointCollector.take()
                    : (samePlacement ? (selectedPos.waypoints ?? []) : []);
                selectedPos = { x: snapped.x, y: snapped.y, elevation: elevAtDest({ x: snapped.x, y: snapped.y }), waypoints: committedWaypoints };
                playUiSound('targetingConfirm');
                drawTeleportTrace(snapped.x, snapped.y, selectedPos.waypoints);
                broadcastToolPresence('moveToken', presenceData());
                _updateInfoCard(cardEl, "teleport", { selectedPos, tokenName: token.name });
            };

            const ascendKeys = keyCodesFor('elevationUp');
            const descendKeys = keyCodesFor('elevationDown');
            const keyHandler = (e) =>
            {
                if (e.key === 'Escape')
                {
                    suppressEvent(e);
                    doCleanup(); resolve(null);
                    return;
                }
                let step = 0;
                if (ascendKeys.has(e.code))
                    step = 1;
                else if (descendKeys.has(e.code))
                    step = -1;
                if (step === 0)
                    return;
                // Swallow Q/E so it never changes the real token's elevation.
                suppressEvent(e);
                pendingElevationOffset += step;
                if (lastDest)
                    updateElevLabel(lastDest);
                playUiSound('targeting');
            };

            const safe = makeSafe('moveToken', () =>
            {
                try
                {
                    doCleanup();
                }
                catch
                { /* */ }
                resolve(null);
            });
            safeMove = safe(moveHandler);
            safeClick = safe(clickHandler);
            safeKey = safe(keyHandler);
            canvas.stage.on('click', safeClick);
            canvas.stage.on('pointermove', safeMove);
            document.addEventListener('keydown', safeKey, true);
            stopPresenceBeat = startToolHeartbeat('moveToken', presenceData);
        }), defaultTitle);
        if (!picked)
            return null;
        destTopLeft = { ...picked };
        pathWaypoints = Array.isArray(destTopLeft.waypoints) && destTopLeft.waypoints.length ? destTopLeft.waypoints : null;
        delete destTopLeft.waypoints;
    }

    // Path collision check: stop before blocking tokens
    if (options.canBeBlocked)
    {
        const startCenterCheck = token.getCenterPoint({ x: token.document.x, y: token.document.y });
        const endCenterCheck = token.getCenterPoint(destTopLeft);
        const ray = new Ray(startCenterCheck, endCenterCheck);
        if (ray.distance > 0)
        {
            const movingIsIntangible = !!token.actor?.statuses?.has('intangible');
            const selfOffsets = getOccupiedOffsets(token);
            const selfKeys = new Set(selfOffsets.map(cellOffset => `${cellOffset.col},${cellOffset.row}`));

            const sampleCount = Math.max(Math.ceil(ray.distance / Math.min(canvas.grid.sizeX, canvas.grid.sizeY)), 1);
            const pathOffsets = [];
            const seenKeys = new Set();
            for (let i = 0; i <= sampleCount; i++)
            {
                const t = i / sampleCount;
                const samplePoint = ray.project(t);
                const sampleOffset = pixelToOffset(samplePoint.x, samplePoint.y);
                const key = `${sampleOffset.col},${sampleOffset.row}`;
                if (!seenKeys.has(key) && !selfKeys.has(key))
                {
                    seenKeys.add(key);
                    pathOffsets.push(sampleOffset);
                }
            }

            const allTokens = canvas.tokens.placeables.filter(other => other.id !== token.id && other.actor);
            for (let i = 0; i < pathOffsets.length; i++)
            {
                const sampleOffset = pathOffsets[i];
                const blocked = allTokens.find(other =>
                {
                    const otherIsIntangible = !!other.actor?.statuses?.has('intangible');
                    if (movingIsIntangible !== otherIsIntangible)
                        return false;
                    const otherOffsets = getOccupiedOffsets(other);
                    return otherOffsets.some(otherOffset => otherOffset.col === sampleOffset.col && otherOffset.row === sampleOffset.row);
                });
                if (blocked)
                {
                    ui.notifications.warn(`Movement blocked by ${blocked.name}.`);
                    if (i === 0)
                        return null; // Blocked immediately, can't move
                    const lastFreeOffset = pathOffsets[i - 1];
                    const lastFreeCenter = getHexCenter(lastFreeOffset.col, lastFreeOffset.row);
                    destTopLeft = token.getSnappedPosition({
                        x: lastFreeCenter.x - token.w / 2,
                        y: lastFreeCenter.y - token.h / 2
                    });
                    break;
                }
            }
        }
    }

    const endCenter = token.getCenterPoint(destTopLeft);
    const moveCost = options.cost ?? getDistanceTokenToPoint(endCenter, token);

    // Picker already resolved auto-ground + Q/E offset; direct mode / blocked stop falls back to terrain.
    const updateData = { ...destTopLeft };
    if (typeof destTopLeft.elevation !== 'number')
    {
        const terrainAPI = globalThis.terrainHeightTools;
        if (terrainAPI)
        {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(token, destTopLeft))
            {
                const groundHeight = getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI);
                if (groundHeight > maxHeight)
                    maxHeight = groundHeight;
            }
            updateData.elevation = maxHeight;
        }
    }

    const moveFlags = {
        isDrag: true,
        rulerSegment: false,
        firstRulerSegment: true,
        lastRulerSegment: true,
        lancerSegmentCost: moveCost,
        lancerSegmentDistance: moveCost,
        lancerTerrainPenalty: 0
    };
    const action = options.action ?? (options.teleport ? 'blink' : null);
    if (action)
    {
        const actions = /** @type {any} */ (globalThis).CONFIG?.Token?.movement?.actions ?? {};
        if (!actions[action])
            console.warn(`lancer-automations | moveToken: unknown movement action "${action}", core falls back to displace.`);
        moveFlags.teleport = !!actions[action]?.teleport;
        const legs = movePathLegs(pathWaypoints, { ...updateData, action });
        for (let legIdx = 0; legIdx < legs.length; legIdx++)
        {
            const isLast = legIdx === legs.length - 1;
            await token.document.move({ ...legs[legIdx], action }, {
                ...moveFlags,
                lancerSegmentCost: isLast ? moveCost : 0,
                lancerSegmentDistance: isLast ? moveCost : 0,
                constrainOptions: { ignoreWalls: true, ignoreCost: true },
                autoRotate: false,
                showRuler: false
            });
            await awaitMovementSettled(token.document);
        }
        return token.document;
    }
    if (pathWaypoints)
    {
        const legs = movePathLegs(pathWaypoints, { ...updateData });
        for (let legIdx = 0; legIdx < legs.length; legIdx++)
        {
            const isLast = legIdx === legs.length - 1;
            await token.document.update({ x: legs[legIdx].x, y: legs[legIdx].y, elevation: legs[legIdx].elevation }, {
                ...moveFlags,
                lancerSegmentCost: isLast ? moveCost : 0,
                lancerSegmentDistance: isLast ? moveCost : 0
            });
            await awaitMovementSettled(token.document);
        }
        return token.document;
    }
    const doc = await token.document.update(updateData, moveFlags);
    return doc;
}
