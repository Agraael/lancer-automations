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
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight,
    _groupCellsByDistance, _makeRangePulseTick, gridLineWidth, makeText,
} from "../canvas-helpers.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "../presence.js";

/**
 * Move a token to a destination, bypassing normal movement rules (like knockback).
 * If no destination is provided, shows an interactive card with range highlight.
 * Records movement in lancer-automations history.
 * @param {Token} token - The token to move
 * @param {Object} [options={}]
 * @param {{x: number, y: number}} [options.destination] - Destination center point. If omitted, interactive mode.
 * @param {number} [options.cost] - Override movement cost (default: actual grid distance)
 * @param {boolean} [options.teleport=false] - If true, plays teleport VFX and marks as teleport in history
 * @param {number} [options.range=-1] - Max range in grid units (-1 = unlimited)
 * @param {string} [options.title] - Card title (default: "TELEPORT" or "MOVE")
 * @param {string} [options.description="Select destination."] - Card description
 * @returns {Promise<TokenDocument|null>} Updated doc, or null if cancelled
 */
export async function moveToken(token, options = {}) {
    if (!token?.document)
        return null;

    let destTopLeft;
    if (options.destination) {
        // Direct mode: snap destination center to top-left
        const center = canvas.grid.getCenterPoint(options.destination);
        destTopLeft = token.getSnappedPosition({ x: center.x - token.w / 2, y: center.y - token.h / 2 });
    } else {
        // Interactive mode: show card with range highlight, user clicks hex
        const range = options.range ?? -1;
        const _title = options.teleport ? "TELEPORT" : "MOVE";
        const picked = await _queueCard(() => new Promise((resolve) => {
            const {
                title = _title,
                description = "Select destination.",
                icon,
                headerClass = ""
            } = options;

            let rangeHighlight = null;
            const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
            const pulseGraphic = new PIXI.Graphics();
            let trace = null;
            let selectedPos = null;
            addGraphicsBelowTokens(pulseGraphic);
            let wavePulse = null;

            // Auto elevation follows the terrain under the destination footprint; Q/E shifts an offset.
            let autoElevation = true;
            let pendingElevationOffset = 0;
            let lastDest = null;
            let lastCursorColor = 0x00cc66; // mirrors the live cursor's in-range/out-of-range colour
            const groundUnder = (dest) => {
                const terrainAPI = globalThis.terrainHeightTools;
                if (!terrainAPI)
                    return 0;
                let maxHeight = 0;
                for (const cellOffset of getOccupiedOffsets(token, dest)) {
                    const groundHeight = Number(getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI)) || 0;
                    if (groundHeight > maxHeight)
                        maxHeight = groundHeight;
                }
                return maxHeight;
            };
            const elevAtDest = (dest) => (autoElevation ? groundUnder(dest) : 0) + pendingElevationOffset;
            const elevStr = (elev) => elev > 0 ? `↑ ${elev}` : elev < 0 ? `↓ ${-elev}` : `↕ 0`;
            const cursorElevLabel = makeText('', {
                fontFamily: 'Arial', fontSize: Math.max(14, canvas.grid.size * 0.22),
                fill: 0xffffff, stroke: 0x000000, strokeThickness: gridLineWidth(4), fontWeight: 'bold',
            });
            cursorElevLabel.anchor.set(0.5);
            cursorElevLabel.visible = false;
            canvas.stage.addChild(cursorElevLabel);
            const updateElevLabel = (dest) => {
                const centerPoint = token.getCenterPoint(dest);
                cursorElevLabel.text = elevStr(elevAtDest(dest));
                cursorElevLabel.x = centerPoint.x;
                cursorElevLabel.y = centerPoint.y - canvas.grid.size * 0.45;
                cursorElevLabel.visible = true;
            };
            // Presence: live cursor footprint (blue) + chosen destination (yellow) + elevation labels.
            const presenceData = () => {
                const placedCells = selectedPos
                    ? getOccupiedOffsets(token, { x: selectedPos.x, y: selectedPos.y }).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const originCells = selectedPos
                    ? getOccupiedOffsets(token).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const lines = selectedPos
                    ? [{ x1: token.center.x, y1: token.center.y, x2: selectedPos.x + token.w / 2, y2: selectedPos.y + token.h / 2 }]
                    : [];
                const cells = lastDest
                    ? getOccupiedOffsets(token, { x: lastDest.x, y: lastDest.y }).map(cellOffset => `${cellOffset.col},${cellOffset.row}`)
                    : [];
                const labels = [];
                if (cursorElevLabel.visible)
                    labels.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
                if (selectedPos) {
                    const centerPoint = token.getCenterPoint({ x: selectedPos.x, y: selectedPos.y });
                    labels.push({ x: centerPoint.x, y: centerPoint.y - canvas.grid.size * 0.45, text: elevStr(selectedPos.elevation) });
                }
                return {
                    cells, placedCells, originCells, lines, labels, tokens: [],
                    cellColor: lastCursorColor, placedColor: 0x00cc66, lineColor: 0x00cc66,
                    relatedToken: token,
                };
            };

            const restoreLayerClick = suppressTokenLayerClick();
            let safeMove, safeClick, safeAbort, safeKey;
            let stopPresenceBeat = /** @type {null | (() => void)} */ (null);

            const doCleanup = () => {
                if (stopPresenceBeat)
                    stopPresenceBeat();
                clearToolPresence('moveToken');
                disposeCursorPreview();
                destroyGraphics(cursorElevLabel);
                if (wavePulse)
                    canvas.app.ticker.remove(wavePulse);
                if (safeClick)
                    canvas.stage.off('click', safeClick);
                if (safeAbort)
                    canvas.stage.off('rightdown', safeAbort);
                if (safeMove)
                    canvas.stage.off('pointermove', safeMove);
                if (safeKey)
                    document.removeEventListener('keydown', safeKey, true);
                restoreLayerClick();
                destroyGraphics(rangeHighlight);
                destroyGraphics(pulseGraphic);
                destroyGraphics(trace);
                _removeInfoCard(cardEl);
            };

            const cardEl = _createInfoCard("teleport", {
                title,
                icon,
                headerClass,
                description,
                range: range >= 0 ? range : undefined,
                onConfirm: () => {
                    doCleanup(); resolve(selectedPos);
                },
                onCancel: () => {
                    doCleanup(); resolve(null);
                }
            });

            const inRangeSet = range >= 0 ? getInRangeOffsets(token, range, { includeSelf: true }) : null;
            const isDestInRange = (snappedX, snappedY) => {
                if (!inRangeSet)
                    return true;
                return getOccupiedOffsets(token, { x: snappedX, y: snappedY })
                    .some(cellOffset => inRangeSet.has(`${cellOffset.col},${cellOffset.row}`));
            };
            if (range >= 0) {
                rangeHighlight = drawRangeHighlight(token, range, 0x888888, 0.1, true);
                const hexesByDist = _groupCellsByDistance(getOccupiedOffsets(token), inRangeSet);
                wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range);
                canvas.app.ticker.add(wavePulse);
            }

            const drawTeleportTrace = (targetX, targetY) => {
                destroyGraphics(trace);
                trace = new PIXI.Graphics();
                const gridSize = canvas.grid.size;
                // Original position (yellow)
                trace.lineStyle(gridLineWidth(2), 0xffff00, 0.8);
                trace.beginFill(0xffff00, 0.3);
                for (const cellOffset of getOccupiedOffsets(token)) {
                    if (isHexGrid())
                        drawHexAt(trace, cellOffset.col, cellOffset.row);
                    else {
                        const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
                    }
                }
                trace.endFill();
                // Target position (green for teleport)
                trace.lineStyle(gridLineWidth(2), 0x00cc66, 0.8);
                trace.beginFill(0x00cc66, 0.3);
                for (const cellOffset of getOccupiedOffsets(token, { x: targetX, y: targetY })) {
                    if (isHexGrid())
                        drawHexAt(trace, cellOffset.col, cellOffset.row);
                    else {
                        const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
                    }
                }
                trace.endFill();
                // Dashed line
                trace.lineStyle(gridLineWidth(3), 0x00cc66, 0.8);
                const startCenter = token.center;
                trace.moveTo(startCenter.x, startCenter.y);
                trace.lineTo(targetX + token.w / 2, targetY + token.h / 2);
                addGraphicsBelowTokens(trace);
            };

            const moveHandler = (event) => {
                const { x: tx, y: ty } = pointerToWorld(event);
                const snapped = snapTokenCenter(token, { x: tx, y: ty });
                const snappedOffset = pixelToOffset(snapped.x, snapped.y);
                playTargetingMove(snappedOffset.col, snappedOffset.row);
                const inRange = isDestInRange(snapped.x, snapped.y);
                cursorPreview.clear();
                const offsets = getOccupiedOffsets(token, { x: snapped.x, y: snapped.y });
                const color = inRange ? 0x00cc66 : 0xff0000;
                lastCursorColor = color;
                const alpha = inRange ? 0.4 : 0.5;
                cursorPreview.lineStyle(gridLineWidth(2), color, 0.8);
                cursorPreview.beginFill(color, alpha);
                for (const cellOffset of offsets) {
                    if (isHexGrid())
                        drawHexAt(cursorPreview, cellOffset.col, cellOffset.row);
                    else {
                        const cellCenter = getHexCenter(cellOffset.col, cellOffset.row); cursorPreview.drawRect(cellCenter.x - canvas.grid.size / 2, cellCenter.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
                    }
                }
                cursorPreview.endFill();
                lastDest = { x: snapped.x, y: snapped.y };
                updateElevLabel(lastDest);
                broadcastToolPresence('moveToken', presenceData());
            };

            const clickHandler = (event) => {
                const { x: tx, y: ty } = pointerToWorld(event);
                const snapped = snapTokenCenter(token, { x: tx, y: ty });
                if (!isDestInRange(snapped.x, snapped.y)) {
                    ui.notifications.warn("Destination is out of range!"); return;
                }
                selectedPos = { x: snapped.x, y: snapped.y, elevation: elevAtDest({ x: snapped.x, y: snapped.y }) };
                playUiSound('targetingConfirm');
                drawTeleportTrace(snapped.x, snapped.y);
                broadcastToolPresence('moveToken', presenceData());
                _updateInfoCard(cardEl, "teleport", { selectedPos, tokenName: token.name });
            };

            const ascendKeys = keyCodesFor('elevationUp');
            const descendKeys = keyCodesFor('elevationDown');
            const keyHandler = (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();
                    doCleanup(); resolve(null);
                    return;
                }
                let step = 0;
                if (ascendKeys.has(e.code)) step = 1;
                else if (descendKeys.has(e.code)) step = -1;
                if (step === 0)
                    return;
                // Swallow Q/E so it never changes the real token's elevation.
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                pendingElevationOffset += step;
                if (lastDest)
                    updateElevLabel(lastDest);
                playUiSound('targeting');
            };

            const safe = makeSafe('moveToken', () => {
                try {
                    doCleanup();
                } catch { /* */ }
                resolve(null);
            });
            safeMove = safe(moveHandler);
            safeClick = safe(clickHandler);
            safeKey = safe(keyHandler);
            canvas.stage.on('click', safeClick);
            canvas.stage.on('pointermove', safeMove);
            document.addEventListener('keydown', safeKey, true);
            stopPresenceBeat = startToolHeartbeat('moveToken', presenceData);
        }), _title);
        if (!picked)
            return null;
        destTopLeft = picked;
    }

    // Path collision check: stop before blocking tokens
    if (options.canBeBlocked) {
        const startCenterCheck = token.getCenterPoint({ x: token.document.x, y: token.document.y });
        const endCenterCheck = token.getCenterPoint(destTopLeft);
        const ray = new Ray(startCenterCheck, endCenterCheck);
        if (ray.distance > 0) {
            const movingIsIntangible = !!token.actor?.statuses?.has('intangible');
            const selfOffsets = getOccupiedOffsets(token);
            const selfKeys = new Set(selfOffsets.map(cellOffset => `${cellOffset.col},${cellOffset.row}`));

            // Sample hexes along the straight line
            const sampleCount = Math.max(Math.ceil(ray.distance / Math.min(canvas.grid.sizeX, canvas.grid.sizeY)), 1);
            const pathOffsets = [];
            const seenKeys = new Set();
            for (let i = 0; i <= sampleCount; i++) {
                const t = i / sampleCount;
                const samplePoint = ray.project(t);
                const sampleOffset = pixelToOffset(samplePoint.x, samplePoint.y);
                const key = `${sampleOffset.col},${sampleOffset.row}`;
                if (!seenKeys.has(key) && !selfKeys.has(key)) {
                    seenKeys.add(key);
                    pathOffsets.push(sampleOffset);
                }
            }

            // Check each hex for blocking tokens
            const allTokens = canvas.tokens.placeables.filter(other => other.id !== token.id && other.actor);
            for (let i = 0; i < pathOffsets.length; i++) {
                const sampleOffset = pathOffsets[i];
                const blocked = allTokens.find(other => {
                    const otherIsIntangible = !!other.actor?.statuses?.has('intangible');
                    if (movingIsIntangible !== otherIsIntangible)
                        return false;
                    const otherOffsets = getOccupiedOffsets(other);
                    return otherOffsets.some(otherOffset => otherOffset.col === sampleOffset.col && otherOffset.row === sampleOffset.row);
                });
                if (blocked) {
                    ui.notifications.warn(`Movement blocked by ${blocked.name}.`);
                    if (i === 0)
                        return null; // Blocked immediately, can't move
                    // Stop at last free hex
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

    // Execute move
    const endCenter = token.getCenterPoint(destTopLeft);
    const moveCost = options.cost ?? getDistanceTokenToPoint(endCenter, token);

    // Picker already resolved auto-ground + Q/E offset; direct mode / blocked stop falls back to terrain.
    const updateData = { ...destTopLeft };
    if (typeof destTopLeft.elevation !== 'number') {
        const terrainAPI = globalThis.terrainHeightTools;
        if (terrainAPI) {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(token, destTopLeft)) {
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
    if (options.teleport) {
        moveFlags.teleport = true;
        const waypoint = { ...updateData, action: 'blink' };
        await token.document.move(waypoint, moveFlags);
        return token.document;
    }
    const doc = await token.document.update(updateData, moveFlags);
    return doc;
}
