/* global canvas, PIXI, game, ui, Hooks, document */

import {
    isHexGrid, offsetToCube, cubeDistance,
    getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    getInRangeOffsets
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import { _rulerMove } from "../main.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "./presence.js";

/**
 * Convert a PixiJS pointer event's global screen position to canvas world coordinates.
 * Uses the full inverse world transform so it works correctly with isometric-perspective,
 * which adds skew components that the manual (tx/scale) decomposition ignores.
 * @param {PIXI.FederatedPointerEvent} event
 * @returns {{x: number, y: number}}
 */
export function pointerToWorld(event) {
    return canvas.stage.worldTransform.applyInverse(event.global);
}

const _LA_PICKER_OVERRIDE = Symbol('la-picker-override');

/** Suppress TokenLayer's release-on-click. Returns a restorer that only undoes our override. */
export function suppressTokenLayerClick() {
    const layer = canvas.tokens;
    if (!layer)
        return () => {};
    const prev = layer._onClickLeft;
    const stub = () => {};
    stub[_LA_PICKER_OVERRIDE] = true;
    layer._onClickLeft = stub;
    return () => {
        if (canvas.tokens?._onClickLeft === stub)
            canvas.tokens._onClickLeft = prev;
    };
}

// Scene change wipes any orphan picker stub left behind by a crashed handler.
Hooks.on('canvasTearDown', () => {
    const layer = canvas.tokens;
    if (layer?._onClickLeft?.[_LA_PICKER_OVERRIDE])
        delete layer._onClickLeft;
});

/** Unparent + destroy a PIXI display object (containers destroy their children too). Safe with null/undefined. */
export function destroyGraphics(g) {
    if (!g)
        return;
    if (g.parent)
        g.parent.removeChild(g);
    g.destroy({ children: true });
}

/** Insert a graphic below the tokens layer (so tokens overlay it), or fall back to canvas.stage. */
export function addGraphicsBelowTokens(g) {
    if (canvas.tokens?.parent)
        canvas.tokens.parent.addChildAt(g, canvas.tokens.parent.getChildIndex(canvas.tokens));
    else
        canvas.stage.addChild(g);
    return g;
}

/** Build the safe(fn) wrapper used by every interactive tool. Logs context + invokes onError. */
export function makeSafe(label, onError) {
    return (fn) => function safeHandler(...args) {
        try {
            return fn.apply(this, args);
        } catch (e) {
            console.error(`${label} handler crash, cleaning up:`, e);
            try {
                onError?.();
            } catch { /* */ }
        }
    };
}

/** Pulsing cursor-preview graphics + tick. Returns { graphics, dispose }. */
export function createCursorPreview() {
    const cursorPreview = new PIXI.Graphics();
    canvas.stage.addChild(cursorPreview);
    const cursorPulse = () => {
        cursorPreview.alpha = 0.75 + 0.25 * Math.sin(performance.now() / 250);
    };
    canvas.app.ticker.add(cursorPulse);
    return {
        graphics: cursorPreview,
        dispose() {
            canvas.app.ticker.remove(cursorPulse);
            destroyGraphics(cursorPreview);
        },
    };
}

// A small green "+" near the cursor while Shift is held, signalling multi add/select mode.
// Call move(shiftHeld, x, y) from the picker's pointermove; it also tracks Shift keydown/keyup.
export function createMultiPlusIndicator() {
    const label = new PIXI.Text('+', {
        fontFamily: 'Arial', fontSize: Math.max(18, canvas.grid.size * 0.32),
        fill: 0x33ff66, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold',
    });
    label.anchor.set(0.5);
    label.visible = false;
    canvas.stage.addChild(label);
    let last = null;
    const place = (shiftHeld) => {
        if (shiftHeld && last) {
            label.x = last.x + canvas.grid.size * 0.4;
            label.y = last.y - canvas.grid.size * 0.4;
            label.visible = true;
        } else {
            label.visible = false;
        }
    };
    const onKey = (event) => {
        if (event.key === 'Shift')
            place(event.type === 'keydown');
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    return {
        move(shiftHeld, x, y) {
            last = { x, y };
            place(shiftHeld);
        },
        dispose() {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKey, true);
            destroyGraphics(label);
        },
    };
}

/** Paint a list of cells (hex or square) onto a PIXI.Graphics. Caller sets fill/stroke. */
export function _paintCells(graphics, cells, { gridSize = canvas.grid.size } = {}) {
    const hex = isHexGrid();
    for (const cell of cells) {
        const col = typeof cell === 'string' ? Number(cell.split(',')[0]) : cell.col;
        const row = typeof cell === 'string' ? Number(cell.split(',')[1]) : cell.row;
        if (hex) {
            drawHexAt(graphics, col, row);
        } else {
            const c = getHexCenter(col, row);
            graphics.drawRect(c.x - gridSize / 2, c.y - gridSize / 2, gridSize, gridSize);
        }
    }
}

/** Group cells by min distance from any origin offset. Skips dist 0. */
export function _groupCellsByDistance(originOffsets, cellKeys) {
    const hex = isHexGrid();
    const byDist = new Map();
    for (const key of cellKeys) {
        const [col, row] = key.split(',').map(Number);
        let minDist = Infinity;
        for (const originOffset of originOffsets) {
            const dist = hex
                ? cubeDistance(offsetToCube(originOffset.col, originOffset.row), offsetToCube(col, row))
                : Math.max(Math.abs(originOffset.col - col), Math.abs(originOffset.row - row));
            if (dist < minDist)
                minDist = dist;
        }
        if (minDist === 0)
            continue;
        if (!byDist.has(minDist))
            byDist.set(minDist, []);
        byDist.get(minDist).push({ col, row });
    }
    return byDist;
}

/** Wave-pulse tick for canvas.app.ticker.add(...). */
export function _makeRangePulseTick(pulseGraphic, hexesByDist, range, opts = {}) {
    const {
        color = 0x929292,
        lineColor = 0xFFFFFF,
        peakAlpha = 0.1,
        baseAlpha = 0.00,
        baseLineAlpha = 0.00,
        msPerCell = 300,
        slowRangeThreshold = 5,
        slowFloorMs = 2400,
        ringWidth = 1,
        lineWidth = 1.2,
        lineAlphaMul = 6,
    } = opts;
    const basePeriod = msPerCell * (range + 1);
    const periodMs = opts.periodMs ?? (range < slowRangeThreshold ? Math.max(slowFloorMs, basePeriod) : basePeriod);
    return () => {
        pulseGraphic.clear();
        const phase = (performance.now() % periodMs) / periodMs;
        const wavePos = phase * range;
        for (const [ringDist, ringCells] of hexesByDist) {
            const rawDist = Math.abs(ringDist - wavePos);
            const wrappedDist = Math.min(rawDist, range - rawDist);
            const waveAlpha = wrappedDist > ringWidth ? 0 : peakAlpha * (1 - wrappedDist / ringWidth);
            const fillAlpha = Math.min(1, baseAlpha + waveAlpha);
            const lineAlpha = Math.min(1, baseLineAlpha + waveAlpha * lineAlphaMul);
            if (lineAlpha > 0) {
                // dark halo under the bright pulse line so the wave reads on light + dark maps
                pulseGraphic.lineStyle(lineWidth + 1, 0x000000, lineAlpha);
                _paintCells(pulseGraphic, ringCells);
            }
            pulseGraphic.lineStyle(lineWidth, lineColor, lineAlpha);
            pulseGraphic.beginFill(color, fillAlpha);
            _paintCells(pulseGraphic, ringCells);
            pulseGraphic.endFill();
        }
    };
}

export function drawRangeHighlight(casterToken, range, color = 0x00ff00, alpha = 0.2, includeSelf = false, opts = {}) {
    const highlight = new PIXI.Graphics();
    const inRange = getInRangeOffsets(casterToken, range, { includeSelf });
    const lineAlpha = opts.lineAlpha ?? (isHexGrid() ? 0.4 : 0.7);
    const lineWidth = opts.lineWidth ?? 2;
    const lineColor = opts.lineColor ?? 0xFFFFFF;

    // Dark halo under a bright line so the border reads on light AND dark maps.
    if (lineWidth > 0 && lineAlpha > 0) {
        highlight.lineStyle(lineWidth + 2, 0x000000, Math.min(1, lineAlpha + 0.25));
        _paintCells(highlight, inRange);
        highlight.lineStyle(lineWidth, lineColor, Math.min(1, lineAlpha + 0.2));
    }
    if (alpha > 0)
        highlight.beginFill(color, alpha);
    _paintCells(highlight, inRange);
    if (alpha > 0)
        highlight.endFill();

    addGraphicsBelowTokens(highlight);
    return highlight;
}

/**
 * Hex range highlight (gray, low-alpha) with animated wave pulse, matching the
 * visual used by choose-token / knockback cards. Returns a destroy() function.
 */
export function createPulsingRangeHighlight(casterToken, range, { includeSelf = false, staticFillAlpha = 0.1, staticLineAlpha = 0.15, fadeInMs = 180, fadeOutMs = 180 } = {}) {
    const rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, staticFillAlpha, includeSelf, { lineAlpha: staticLineAlpha, lineColor: 0xFFFFFF });

    const pulseGraphic = new PIXI.Graphics();
    addGraphicsBelowTokens(pulseGraphic);

    const hexesByDist = _groupCellsByDistance(
        getOccupiedOffsets(casterToken),
        getInRangeOffsets(casterToken, range, { includeSelf: true })
    );
    const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range);
    canvas.app.ticker.add(wavePulse);

    rangeHighlight.alpha = 0;
    pulseGraphic.alpha = 0;
    let fadeStart = performance.now();
    let fadeFrom = 0;
    let fadeTo = 1;
    let fadeDur = Math.max(1, fadeInMs);
    let onFadeDone = null;
    const fadeTick = () => {
        const elapsed = performance.now() - fadeStart;
        const fadeProgress = Math.min(1, elapsed / fadeDur);
        const alpha = fadeFrom + (fadeTo - fadeFrom) * fadeProgress;
        rangeHighlight.alpha = alpha;
        pulseGraphic.alpha = alpha;
        if (fadeProgress >= 1) {
            canvas.app.ticker.remove(fadeTick);
            const doneCallback = onFadeDone;
            onFadeDone = null;
            if (doneCallback)
                doneCallback();
        }
    };
    canvas.app.ticker.add(fadeTick);

    const doDestroy = () => {
        canvas.app.ticker.remove(wavePulse);
        destroyGraphics(rangeHighlight);
        destroyGraphics(pulseGraphic);
    };

    return () => {
        if (fadeOutMs <= 0) {
            doDestroy();
            return;
        }
        fadeStart = performance.now();
        fadeFrom = rangeHighlight.alpha ?? 1;
        fadeTo = 0;
        fadeDur = Math.max(1, fadeOutMs);
        onFadeDone = doDestroy;
        canvas.app.ticker.add(fadeTick);
    };
}

/**
 * Draw a visual trace of a token's movement on the canvas.
 * @param {Token} token
 * @param {Object} originalEndPos
 * @param {Object|null} newEndPos
 * @returns {PIXI.Graphics}
 */
let _moveTraceSeq = 0;
export function drawMovementTrace(token, originalEndPos, newEndPos = null, { suppressBroadcast = false } = {}) {
    const trace = new PIXI.Graphics();
    const centerStart = token.center;
    const gridSize = canvas.grid.size;

    const drawFootprint = (targetX, targetY, lineColor, fillColor) => {
        trace.lineStyle(3, lineColor, 0.8);
        trace.beginFill(fillColor, 0.3);
        const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
        for (const cellOffset of offsets) {
            if (isHexGrid()) {
                drawHexAt(trace, cellOffset.col, cellOffset.row);
            } else {
                const cellCenter = getHexCenter(cellOffset.col, cellOffset.row);
                trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
            }
        }
        trace.endFill();
    };

    // Start Position
    drawFootprint(token.document.x, token.document.y, 0xffff00, 0xffff00);

    // Original End Position
    const originalColor = newEndPos ? 0xff0000 : 0xff6400;
    const centerOriginal = { x: originalEndPos.x + token.w/2, y: originalEndPos.y + token.h/2 };
    drawFootprint(originalEndPos.x, originalEndPos.y, originalColor, originalColor);

    // Line to Original End
    trace.lineStyle(4, 0xffffff, 0.5); // white fading line
    trace.moveTo(centerStart.x, centerStart.y);
    trace.lineTo(centerOriginal.x, centerOriginal.y);

    if (newEndPos) {
        // New End Position
        const centerNew = { x: newEndPos.x + token.w/2, y: newEndPos.y + token.h/2 };
        drawFootprint(newEndPos.x, newEndPos.y, 0xff6400, 0xff6400);

        // Line to New End
        trace.lineStyle(4, 0xffffff, 1);
        trace.moveTo(centerStart.x, centerStart.y);
        trace.lineTo(centerNew.x, centerNew.y);
    }

    addGraphicsBelowTokens(trace);

    // Mirror the trace to other clients: start (yellow), base destination (cells), new destination (placed), lines.
    // Relay sites (socket/network GM trace) pass suppressBroadcast so only the originating client broadcasts.
    if (!suppressBroadcast) {
        const kind = `moveTrace:${token.id}:${++_moveTraceSeq}`;
        const startCells = getOccupiedOffsets(token).map(o => `${o.col},${o.row}`);
        const origCells = getOccupiedOffsets(token, { x: originalEndPos.x, y: originalEndPos.y }).map(o => `${o.col},${o.row}`);
        const newCells = newEndPos ? getOccupiedOffsets(token, { x: newEndPos.x, y: newEndPos.y }).map(o => `${o.col},${o.row}`) : [];
        const traceLines = [{ x1: centerStart.x, y1: centerStart.y, x2: centerOriginal.x, y2: centerOriginal.y }];
        if (newEndPos)
            traceLines.push({ x1: centerStart.x, y1: centerStart.y, x2: newEndPos.x + token.w / 2, y2: newEndPos.y + token.h / 2 });
        const tracePresence = {
            originCells: startCells,
            cells: origCells,
            cellColor: originalColor,
            placedCells: newCells,
            placedColor: 0xff6400,
            originColor: 0xffff00,
            lines: traceLines,
            lineColor: 0xffffff,
            relatedToken: token,
        };
        broadcastToolPresence(kind, tracePresence);
        let destroyed = false; // guard a heartbeat tick that fires after destroy
        const stopTraceBeat = startToolHeartbeat(kind, () => destroyed ? null : tracePresence);
        const origDestroy = trace.destroy.bind(trace);
        trace.destroy = (...a) => {
            destroyed = true;
            stopTraceBeat();
            clearToolPresence(kind);
            return origDestroy(...a);
        };
    }

    return trace;
}

/** @returns {number} */
export function getGridDistance(pos1, pos2) {
    if (isHexGrid()) {
        const offset1 = pixelToOffset(pos1.x, pos1.y);
        const offset2 = pixelToOffset(pos2.x, pos2.y);
        const cube1 = offsetToCube(offset1.col, offset1.row);
        const cube2 = offsetToCube(offset2.col, offset2.row);
        return cubeDistance(cube1, cube2);
    } else {
        const gridDistance = canvas.scene.grid.distance;
        const distPixels = canvas.grid.measurePath([pos1, pos2], {}).distance;
        return Math.round(distPixels / gridDistance);
    }
}

/**
 * Small popup at a screen point listing tokens to disambiguate a click on overlapping tokens.
 * Same UX used inside chooseToken; reused by the click-time overlap picker.
 * @param {Token[]} tokens
 * @param {number} screenX
 * @param {number} screenY
 * @param {{isSelected?: (t: Token) => boolean, onPick?: (t: Token) => void}} [options]
 * @returns {() => void} close handle
 */
export function showOverlapStackPicker(tokens, screenX, screenY, { isSelected = () => false, onPick = () => {} } = {}) {
    let popupEl = null;
    let outsideHandler = null;
    let escHandler = null;
    const close = () => {
        if (popupEl) {
            popupEl.remove(); popupEl = null;
        }
        if (outsideHandler) {
            document.removeEventListener('pointerdown', outsideHandler, true);
            outsideHandler = null;
        }
        if (escHandler) {
            document.removeEventListener('keydown', escHandler, true);
            escHandler = null;
        }
    };
    const el = document.createElement('div');
    el.className = 'la-stack-picker';
    el.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:10000;background:#1c1c1c;border:2px solid #ff6400;border-radius:4px;padding:4px;min-width:160px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Signika,sans-serif;`;
    for (const token of tokens) {
        const sel = !!isSelected(token);
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:3px;${sel ? 'background:rgba(255,100,0,0.25);' : ''}`;
        row.innerHTML = `
            <img src="${token.document.texture.src}" style="width:24px;height:24px;object-fit:contain;border:1px solid #555;border-radius:2px;background:#000;">
            <span style="color:#fff;font-size:0.9em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${token.name}</span>
            ${sel ? '<i class="fas fa-check" style="color:#5cff5c;"></i>' : ''}`;
        row.addEventListener('mouseenter', () => {
            row.style.background = 'rgba(255,100,0,0.4)';
        });
        row.addEventListener('mouseleave', () => {
            row.style.background = sel ? 'rgba(255,100,0,0.25)' : 'transparent';
        });
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            onPick(token);
            close();
        });
        el.appendChild(row);
    }
    document.body.appendChild(el);
    popupEl = el;
    const r = el.getBoundingClientRect();
    if (r.right > window.innerWidth)
        el.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
    if (r.bottom > window.innerHeight)
        el.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
    outsideHandler = (e) => {
        if (popupEl && !popupEl.contains(/** @type {Node} */ (e.target)))
            close();
    };
    escHandler = (e) => {
        if (e.key === 'Escape') {
            e.preventDefault(); close();
        }
    };
    setTimeout(() => {
        document.addEventListener('pointerdown', outsideHandler, true);
        document.addEventListener('keydown', escHandler, true);
    }, 0);
    return close;
}

/**
 * Trim the token's native movement history so a cancelled drag doesn't leave a phantom waypoint.
 * Called from preUpdateToken / triggered-cancel paths.
 * @param {Token} token
 * @param {object|null} _moveInfo
 */
export function cancelRulerDrag(token, _moveInfo = null) {
    const doc = token?.document;
    const history = doc?._source?._movementHistory;
    if (!Array.isArray(history) || history.length === 0)
        return;
    const currentX = doc.x, currentY = doc.y;
    let lastValidIdx = -1;
    for (let i = history.length - 1; i >= 0; i--) {
        const waypoint = history[i];
        if (Math.abs((waypoint.x ?? 0) - currentX) < 2 && Math.abs((waypoint.y ?? 0) - currentY) < 2) {
            lastValidIdx = i; break;
        }
    }
    if (lastValidIdx === history.length - 1)
        return;
    const trimmed = history.slice(0, lastValidIdx + 1);
    try {
        doc.update({ _movementHistory: trimmed }, { diff: false });
    } catch (e) {
        console.warn('lancer-automations | cancelRulerDrag trim failed', e);
    }
}

/**
 * Apply pre-resolved knockback moves.
 * Used by knockBackToken (after the destination picker resolves) and the socket handler.
 * @param {Array<{tokenId: string, updateData: {x: number, y: number}}>} moveList - Per-token resolved destinations.
 * @param {Token|null} triggeringToken - Token that caused the knockback. Required for `triggerSelf` reactions; warns when null.
 * @param {number} distance - Max knockback distance in grid units (used by the `onInvoluntaryMove` trigger).
 * @param {string} [actionName=""] - Name of the action that produced the knockback.
 * @param {Item} [item=null] - Source item, if any.
 * @param {Object} [options]
 * @param {boolean} [options.asVoluntary=false] - If true, skip the `onInvoluntaryMove` trigger and the
 *   `forceUnintentional` move flag (treat the displacement as a voluntary move).
 * @param {boolean} [options.setElevation=false] - If true (and Terrain Height Tools is active), snap each
 *   token to the max solid-terrain height under its destination footprint. Off by default.
 * @returns {Promise<void>}
 */
export async function applyKnockbackMoves(moveList, triggeringToken, distance, actionName = "", item = null, options = {}) {
    if (!triggeringToken)
        console.warn("lancer-automations | applyKnockbackMoves called without a triggeringToken. Reactions using triggerSelf will not work correctly.");

    const asVoluntary = !!options.asVoluntary;
    const setElevation = !!options.setElevation;
    const api = game.modules.get('lancer-automations').api;

    const extraOpts = {
        ignoreMovementCap: true,
        _skipBoostOffer: true,
        useRuler: true
    };

    const terrainAPI = globalThis.terrainHeightTools;

    // Sequential — ER.moveTokenTo uses the singleton canvas.controls.ruler; parallel runs corrupt it.
    for (const { tokenId, updateData } of moveList) {
        const t = canvas.tokens.get(tokenId);
        if (!t)
            continue;

        if (!asVoluntary) {
            let cancelled = false;
            const cancel = (reason) => {
                cancelled = true;
                if (reason)
                    ui.notifications.info(reason);
            };
            await api.handleTrigger('onInvoluntaryMove', {
                triggeringToken,
                token: t,
                distance,
                actionName,
                item,
                destination: { x: updateData.x, y: updateData.y },
                cancel
            });
            if (cancelled)
                continue;
        }

        const dest = { x: updateData.x, y: updateData.y };
        if (!asVoluntary)
            dest.action = 'forced';
        if (typeof updateData.elevation === 'number') {
            dest.elevation = updateData.elevation; // chosen in the picker (auto-ground + Q/E offset)
        } else if (setElevation && terrainAPI) {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(t, dest)) {
                const cellHeight = getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI);
                if (cellHeight > maxHeight)
                    maxHeight = cellHeight;
            }
            dest.elevation = maxHeight;
        }
        await _rulerMove(t, dest, extraOpts);
    }
}
