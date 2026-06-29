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
    _groupCellsByDistance, _makeRangePulseTick,
} from "../canvas-helpers.js";

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
            const groundUnder = (dest) => {
                const tAPI = globalThis.terrainHeightTools;
                if (!tAPI)
                    return 0;
                let max = 0;
                for (const o of getOccupiedOffsets(token, dest)) {
                    const h = Number(getHexGroundElevation(o.col, o.row, tAPI)) || 0;
                    if (h > max)
                        max = h;
                }
                return max;
            };
            const elevAtDest = (dest) => (autoElevation ? groundUnder(dest) : 0) + pendingElevationOffset;
            const elevStr = (e) => e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
            const cursorElevLabel = new PIXI.Text('', {
                fontFamily: 'Arial', fontSize: Math.max(14, canvas.grid.size * 0.22),
                fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold',
            });
            cursorElevLabel.anchor.set(0.5);
            cursorElevLabel.visible = false;
            canvas.stage.addChild(cursorElevLabel);
            const updateElevLabel = (dest) => {
                const c = token.getCenterPoint(dest);
                cursorElevLabel.text = elevStr(elevAtDest(dest));
                cursorElevLabel.x = c.x;
                cursorElevLabel.y = c.y - canvas.grid.size * 0.45;
                cursorElevLabel.visible = true;
            };

            const restoreLayerClick = suppressTokenLayerClick();
            let safeMove, safeClick, safeAbort, safeKey;

            const doCleanup = () => {
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
                    .some(o => inRangeSet.has(`${o.col},${o.row}`));
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
                trace.lineStyle(2, 0xffff00, 0.8);
                trace.beginFill(0xffff00, 0.3);
                for (const o of getOccupiedOffsets(token)) {
                    if (isHexGrid())
                        drawHexAt(trace, o.col, o.row);
                    else {
                        const c = getHexCenter(o.col, o.row); trace.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
                    }
                }
                trace.endFill();
                // Target position (green for teleport)
                trace.lineStyle(2, 0x00cc66, 0.8);
                trace.beginFill(0x00cc66, 0.3);
                for (const o of getOccupiedOffsets(token, { x: targetX, y: targetY })) {
                    if (isHexGrid())
                        drawHexAt(trace, o.col, o.row);
                    else {
                        const c = getHexCenter(o.col, o.row); trace.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
                    }
                }
                trace.endFill();
                // Dashed line
                trace.lineStyle(3, 0x00cc66, 0.8);
                const cs = token.center;
                trace.moveTo(cs.x, cs.y);
                trace.lineTo(targetX + token.w / 2, targetY + token.h / 2);
                addGraphicsBelowTokens(trace);
            };

            const moveHandler = (event) => {
                const { x: tx, y: ty } = pointerToWorld(event);
                const snapped = snapTokenCenter(token, { x: tx, y: ty });
                const _o = pixelToOffset(snapped.x, snapped.y);
                playTargetingMove(_o.col, _o.row);
                const inRange = isDestInRange(snapped.x, snapped.y);
                cursorPreview.clear();
                const offsets = getOccupiedOffsets(token, { x: snapped.x, y: snapped.y });
                const color = inRange ? 0x00cc66 : 0xff0000;
                const alpha = inRange ? 0.4 : 0.5;
                cursorPreview.lineStyle(2, color, 0.8);
                cursorPreview.beginFill(color, alpha);
                for (const o of offsets) {
                    if (isHexGrid())
                        drawHexAt(cursorPreview, o.col, o.row);
                    else {
                        const c = getHexCenter(o.col, o.row); cursorPreview.drawRect(c.x - canvas.grid.size / 2, c.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
                    }
                }
                cursorPreview.endFill();
                lastDest = { x: snapped.x, y: snapped.y };
                updateElevLabel(lastDest);
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
            const selfKeys = new Set(selfOffsets.map(o => `${o.col},${o.row}`));

            // Sample hexes along the straight line
            const nSteps = Math.max(Math.ceil(ray.distance / Math.min(canvas.grid.sizeX, canvas.grid.sizeY)), 1);
            const pathOffsets = [];
            const seenKeys = new Set();
            for (let i = 0; i <= nSteps; i++) {
                const t = i / nSteps;
                const pt = ray.project(t);
                const off = pixelToOffset(pt.x, pt.y);
                const key = `${off.col},${off.row}`;
                if (!seenKeys.has(key) && !selfKeys.has(key)) {
                    seenKeys.add(key);
                    pathOffsets.push(off);
                }
            }

            // Check each hex for blocking tokens
            const allTokens = canvas.tokens.placeables.filter(t => t.id !== token.id && t.actor);
            for (let i = 0; i < pathOffsets.length; i++) {
                const off = pathOffsets[i];
                const blocked = allTokens.find(other => {
                    const otherIsIntangible = !!other.actor?.statuses?.has('intangible');
                    if (movingIsIntangible !== otherIsIntangible)
                        return false;
                    const otherOffsets = getOccupiedOffsets(other);
                    return otherOffsets.some(oo => oo.col === off.col && oo.row === off.row);
                });
                if (blocked) {
                    ui.notifications.warn(`Movement blocked by ${blocked.name}.`);
                    if (i === 0)
                        return null; // Blocked immediately, can't move
                    // Stop at last free hex
                    const lastFree = pathOffsets[i - 1];
                    const lastCenter = getHexCenter(lastFree.col, lastFree.row);
                    destTopLeft = token.getSnappedPosition({
                        x: lastCenter.x - token.w / 2,
                        y: lastCenter.y - token.h / 2
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
            for (const o of getOccupiedOffsets(token, destTopLeft)) {
                const h = getHexGroundElevation(o.col, o.row, terrainAPI);
                if (h > maxHeight)
                    maxHeight = h;
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
