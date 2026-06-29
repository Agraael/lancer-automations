/* global canvas, PIXI, game, document, globalThis, performance */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import {
    pointerToWorld, suppressTokenLayerClick, makeSafe, createCursorPreview,
    addGraphicsBelowTokens, destroyGraphics, _paintCells,
} from "../canvas-helpers.js";
import { computeArea, rotationStepsFor } from "../area-geometry.js";
import { playUiSound, playTargetingMove } from "../../tah/sound.js";
import { keyCodesFor } from "../keybindings.js";

// Cancel fn of the running picker (null when idle). Lets the button toggle it.
let _activeCancel = null;
export function isAreaPickerActive() {
    return !!_activeCancel;
}
export function cancelAreaPicker() {
    if (_activeCancel)
        _activeCancel();
}

// Placed shapes + targeted ids, kept after the picker exits (cleared on restart/HUD-close/scene-change).
let _persistG = null;      // Container: shape + elevation labels
let _persistGfx = null;    // cells Graphics, accumulated across placements
let _persistPulse = null;  // ticker breathing the alpha
const _persistTargetIds = new Set();
export function clearAreaTargetShape() {
    if (_persistPulse) {
        canvas.app.ticker.remove(_persistPulse);
        _persistPulse = null;
    }
    if (_persistG) {
        if (_persistG.parent)
            _persistG.parent.removeChild(_persistG);
        _persistG.destroy({ children: true });
        _persistG = null;
    }
    _persistGfx = null;
    _persistTargetIds.clear();
}
function releasePickerTargets() {
    for (const id of _persistTargetIds) {
        const t = canvas.tokens.get(id);
        if (t)
            t.setTarget(false, { releaseOthers: false });
    }
    _persistTargetIds.clear();
}

// One elevation: ↑ positive / ↓ negative / ↕ for 0.
function elevText(e) {
    const v = Math.round(e || 0);
    return v > 0 ? `↑ ${v}` : v < 0 ? `↓ ${-v}` : `↕ 0`;
}
// Two-line ↑top/↓bot band (blast/cone/burst reach).
function bandLabel(r) {
    const top = Math.round(r.elevTop ?? r.elev ?? 0);
    const bot = Math.round(r.elevBot ?? r.elev ?? 0);
    return `↑ ${top}\n↓ ${bot}`;
}
// A line is "tilted" only when its cells span more than one elevation.
function isTiltedLine(r) {
    if (!r.elevByCell)
        return false;
    const vals = [...r.elevByCell.values()];
    return vals.some(e => e !== vals[0]);
}

/**
 * Cardless AoE target picker. Move to aim, click to place; caught tokens become game.user.targets.
 * Hold Shift to keep it open and accumulate placements. Ctrl+wheel rotates cone/line,
 * Q/E shifts elevation (when elevation-aware). Escape cancels.
 *
 * @param {any} casterToken
 * @param {{ pattern?: string, areaRange?: number, size?: number, includeSelf?: boolean,
 *          includeHidden?: boolean, keepExisting?: boolean,
 *          getToggles?: () => {elevationAware?:boolean, autoElevation?:boolean, propagation?:boolean} }} [opts]
 * @returns {Promise<any[]|null>}
 */
export function pickAreaTargetToggle(casterToken = null, opts = {}) {
    const {
        pattern = 'blast',
        areaRange = 1,
        size = 1,
        includeSelf = true,
        includeHidden = true,
        keepExisting = false,
        getToggles = () => ({ elevationAware: true, autoElevation: true, propagation: true }),
    } = opts;

    return new Promise((resolve) => {
        // Fresh start drops the previous placed shapes + their targets; Shift-restart keeps them.
        if (!keepExisting) {
            releasePickerTargets();
            clearAreaTargetShape();
        }
        const isBurst = pattern === 'burst';
        const isAimed = pattern === 'cone' || pattern === 'line';
        const rotMod = rotationStepsFor(pattern, areaRange);
        let pendingRotation = 0;
        let pendingElevOffset = 0;
        let pendingTilt = 0; // line only: end elevation delta (W/S)

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
        const selectHighlight = new PIXI.Graphics();
        canvas.stage.addChild(selectHighlight); // above tokens
        const elevLabel = new PIXI.Text('', {
            fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold', align: 'center',
        });
        elevLabel.anchor.set(0.5);
        elevLabel.visible = false;
        canvas.stage.addChild(elevLabel);
        // live per-cell elevation numbers (tilted lines)
        const cellLabelLayer = new PIXI.Container();
        canvas.stage.addChild(cellLabelLayer);
        const clearCellLabels = () => {
            for (const ch of cellLabelLayer.removeChildren())
                ch.destroy();
        };
        const makeCellLabel = (col, row, elev) => {
            const c = getHexCenter(col, row);
            const t = new PIXI.Text(elevText(elev), {
                fontFamily: 'Arial', fontSize: Math.max(11, canvas.grid.size * 0.18),
                fill: 0xffffff, stroke: 0x000000, strokeThickness: 3, fontWeight: 'bold',
            });
            t.anchor.set(0.5);
            t.x = c.x;
            t.y = c.y;
            return t;
        };

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        const restoreLayerClick = suppressTokenLayerClick();

        let safeMove, safeClick, safeKey, safeWheel;
        const doCleanup = () => {
            _activeCancel = null;
            disposeCursorPreview();
            destroyGraphics(selectHighlight);
            destroyGraphics(elevLabel);
            clearCellLabels();
            destroyGraphics(cellLabelLayer);
            if (safeClick) canvas.stage.off('click', safeClick);
            if (safeMove) canvas.stage.off('pointermove', safeMove);
            if (safeKey) document.removeEventListener('keydown', safeKey, true);
            if (safeWheel) document.removeEventListener('wheel', safeWheel, { capture: true });
            canvas.tokens.interactiveChildren = prevInteractive;
            restoreLayerClick();
        };

        const ctx = () => {
            const t = getToggles() || {};
            return {
                elevationAware: !!t.elevationAware,
                propagation: !!t.propagation,
                includeHidden,
                includeSelf,
                casterToken,
            };
        };
        const autoElevation = () => !!(getToggles() || {}).autoElevation;
        const groundAt = (pt) => {
            const tAPI = globalThis.terrainHeightTools;
            if (!tAPI)
                return 0;
            const off = pixelToOffset(pt.x, pt.y);
            return Number(getHexGroundElevation(off.col, off.row, tAPI)) || 0;
        };

        const tokenUnderCursor = (tx, ty) => canvas.tokens.placeables.find(t => {
            if (!includeHidden && t.document.hidden)
                return false;
            if (!includeSelf && casterToken && t.id === casterToken.id)
                return false;
            const b = t.bounds;
            return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
        }) || null;

        // null when a burst has no token under the cursor.
        const computeAt = (tx, ty) => {
            const cc = ctx();
            if (isBurst) {
                const host = tokenUnderCursor(tx, ty);
                if (!host)
                    return null;
                const res = computeArea({ pattern: 'burst', hostToken: host, areaRange }, cc);
                return { ...res, labelPt: host.center, elev: res.hostElev ?? 0, elevAware: cc.elevationAware };
            }
            const off = pixelToOffset(tx, ty);
            const centerPt = getHexCenter(off.col, off.row);
            const elev = cc.elevationAware ? (autoElevation() ? groundAt(centerPt) : 0) + pendingElevOffset : 0;
            const res = computeArea({ pattern, centerPt, areaRange, size, rotation: pendingRotation, areaElev: elev, tilt: pendingTilt }, cc);
            return { ...res, labelPt: centerPt, elev, elevAware: cc.elevationAware };
        };

        const drawCaught = (g, caught) => {
            g.lineStyle(4, 0x00ffff, 0.8);
            g.beginFill(0x00ffff, 0.2);
            for (const t of caught) {
                if (isHexGrid()) {
                    for (const o of getOccupiedOffsets(t))
                        drawHexAt(g, o.col, o.row);
                } else {
                    g.drawRect(t.document.x, t.document.y, t.document.width * canvas.grid.size, t.document.height * canvas.grid.size);
                }
            }
            g.endFill();
        };

        const drawAt = (tx, ty) => {
            cursorPreview.clear();
            selectHighlight.clear();
            clearCellLabels();
            const r = computeAt(tx, ty);
            if (!r) {
                // burst with no host: ring marker
                cursorPreview.lineStyle(2, 0xffaa00, 0.85);
                cursorPreview.beginFill(0xffaa00, 0.25);
                cursorPreview.drawCircle(tx, ty, Math.max(6, canvas.grid.size * 0.12));
                cursorPreview.endFill();
                elevLabel.visible = false;
                return;
            }
            cursorPreview.lineStyle(2, 0x0088ff, 0.6);
            cursorPreview.beginFill(0x0088ff, 0.12);
            _paintCells(cursorPreview, r.affected);
            cursorPreview.endFill();
            drawCaught(selectHighlight, r.caught);

            if (r.elevAware && isTiltedLine(r)) {
                // tilted line: an arrow label per cell
                elevLabel.visible = false;
                for (const [key, elev] of r.elevByCell) {
                    const [col, row] = key.split(',').map(Number);
                    cellLabelLayer.addChild(makeCellLabel(col, row, elev));
                }
            } else if (r.elevAware && r.labelPt) {
                // flat line -> single arrow; blast/cone/burst -> top/bottom band
                elevLabel.text = r.elevByCell ? elevText(r.elev) : bandLabel(r);
                elevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                elevLabel.x = r.labelPt.x;
                elevLabel.y = r.labelPt.y;
                elevLabel.visible = true;
            } else {
                elevLabel.visible = false;
            }
        };

        let lastCursor = null;
        const refresh = () => {
            if (lastCursor)
                drawAt(lastCursor.x, lastCursor.y);
        };

        // chooseToken's yellow; accumulate into one graphic so Shift stacks shapes, pulse on first draw.
        const addPersistShape = (r) => {
            if (!_persistG) {
                _persistG = new PIXI.Container();
                _persistGfx = new PIXI.Graphics();
                _persistG.addChild(_persistGfx);
                addGraphicsBelowTokens(_persistG);
                _persistPulse = () => {
                    // detach if torn down (scene change), don't write to a dead object
                    if (!_persistG || _persistG.destroyed) {
                        canvas.app.ticker.remove(_persistPulse);
                        _persistPulse = null;
                        _persistG = null;
                        _persistGfx = null;
                        return;
                    }
                    _persistG.alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
                };
                canvas.app.ticker.add(_persistPulse);
            }
            _persistGfx.lineStyle(2, 0xffd84a, 0.7);
            _persistGfx.beginFill(0xffd84a, 0.22);
            _paintCells(_persistGfx, r.affected);
            _persistGfx.endFill();
            if (r.elevAware && isTiltedLine(r)) {
                // tilted line: an arrow label per cell
                for (const [key, elev] of r.elevByCell) {
                    const [col, row] = key.split(',').map(Number);
                    _persistG.addChild(makeCellLabel(col, row, elev));
                }
            } else if (r.elevAware && r.labelPt) {
                // flat line -> single arrow; blast/cone/burst -> top/bottom band
                const label = new PIXI.Text(r.elevByCell ? elevText(r.elev) : bandLabel(r), {
                    fontFamily: 'Arial', fontSize: Math.max(14, canvas.grid.size * 0.22),
                    fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold', align: 'center',
                });
                label.anchor.set(0.5);
                label.x = r.labelPt.x;
                label.y = r.labelPt.y;
                _persistG.addChild(label);
            }
        };

        // caught -> targets (setTarget broadcasts); shape stays. Shift stacks and keeps open.
        const place = (r, keepOpen) => {
            for (const t of r.caught) {
                const already = Array.from(game.user.targets ?? []).some(x => x.id === t.id);
                if (!already)
                    t.setTarget(true, { releaseOthers: false });
                _persistTargetIds.add(t.id);
            }
            addPersistShape(r);
            if (keepOpen) {
                refresh();
                return;
            }
            doCleanup();
            resolve(r.caught);
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            lastCursor = { x: tx, y: ty };
            drawAt(tx, ty);
            const o = pixelToOffset(tx, ty);
            playTargetingMove(o.col, o.row);
        };

        const clickHandler = (event) => {
            const shift = !!event?.data?.originalEvent?.shiftKey;
            const { x: tx, y: ty } = pointerToWorld(event);
            const r = computeAt(tx, ty);
            if (!r)
                return; // burst with no host: ignore the click
            playUiSound('targetingConfirm');
            place(r, shift);
        };

        const bumpRotation = (step) => {
            pendingRotation = ((pendingRotation + step) % rotMod + rotMod) % rotMod;
            refresh();
            playUiSound('targeting');
        };
        const bumpElevation = (step) => {
            if (!ctx().elevationAware)
                return;
            pendingElevOffset += step;
            refresh();
            playUiSound('targeting');
        };

        // momentum: consecutive same-dir ticks accelerate; a pause or reversal resets to 1 step.
        const ROT_RESET_MS = 220;
        const rotMaxStep = Math.max(3, Math.round(rotMod / 6));
        let rotStreak = 0;
        let lastRotDir = 0;
        let lastRotTime = 0;
        const wheelHandler = (event) => {
            if (!isAimed || !event.ctrlKey)
                return;
            event.preventDefault();
            event.stopPropagation();
            const dir = event.deltaY > 0 ? 1 : -1;
            const now = event.timeStamp || 0;
            if (dir === lastRotDir && (now - lastRotTime) < ROT_RESET_MS)
                rotStreak += 1;
            else
                rotStreak = 0;
            lastRotDir = dir;
            lastRotTime = now;
            const step = Math.min(1 + Math.floor(rotStreak / 2), rotMaxStep);
            bumpRotation(dir * step);
        };

        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const tiltUpKeys = keyCodesFor('lineTiltUp');
        const tiltDownKeys = keyCodesFor('lineTiltDown');
        const keyHandler = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                doCleanup();
                resolve(null);
                return;
            }
            // W/S tilt the line's end elevation
            if (pattern === 'line' && (tiltUpKeys.has(event.code) || tiltDownKeys.has(event.code))) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (ctx().elevationAware) {
                    pendingTilt += tiltUpKeys.has(event.code) ? 1 : -1;
                    refresh();
                    playUiSound('targeting');
                }
                return;
            }
            let step = 0;
            if (ascendKeys.has(event.code)) step = 1;
            else if (descendKeys.has(event.code)) step = -1;
            if (step === 0)
                return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            bumpElevation(step);
        };

        const safe = makeSafe('pickAreaTargetToggle', () => {
            try { doCleanup(); } catch { /* */ }
            resolve(null);
        });
        _activeCancel = () => {
            doCleanup();
            resolve(null);
        };
        safeMove = safe(moveHandler);
        safeClick = safe(clickHandler);
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
        if (isAimed) {
            safeWheel = safe(wheelHandler);
            document.addEventListener('wheel', safeWheel, { capture: true, passive: false });
        }
    });
}
