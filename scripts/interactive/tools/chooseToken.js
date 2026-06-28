/* global canvas, PIXI, game, ui, document, window */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    getMinGridDistance,
    getInRangeOffsets, isPositionInRange,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    pointerToWorld, addGraphicsBelowTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight,
    _paintCells, _groupCellsByDistance, _makeRangePulseTick,
} from "../canvas-helpers.js";

/**
 * Prompts the user to select one or more tokens on the canvas.
 * @param {Token} [casterToken] - The token from which to measure range
 * @param {Object} options - Configuration options
 * @returns {Promise<Token[]|null>} Array of selected tokens or null if cancelled
 */
export function chooseToken(casterToken, options = {}) {
    const _title = options.title || 'SELECT TARGETS';
    return _queueCard(() => new Promise((resolve) => {
        const {
            range = null,
            includeHidden = false,
            includeSelf = false,
            filter = null,
            filterWarning = null,
            soft = true,
            selection = null,
            preSelected = [],
            count = 1,
            title,
            description = "",
            icon,
            headerClass = "",
            pattern = 'token',
            areaRange = null,
            areaCount = 1,
            elevationAware: optElevationAware = null,
            autoElevation: optAutoElevation = null,
            propagation: optPropagation = null,
            size = 1,
        } = /** @type {any} */ (options);

        const isBlastMode = pattern === 'blast';
        const isBurstMode = pattern === 'burst';
        const isConeMode = pattern === 'cone';
        const isLineMode = pattern === 'line';
        const isAreaMode = isBlastMode || isBurstMode || isConeMode || isLineMode;
        // Cone rotation is an INT step count. 1 wheel tick = ±1 step.
        // 12 steps per full turn (30° each) → covers all 6 hex-aligned + 6 off-axis facings.
        const CONE_STEPS_PER_TURN = 12;
        const CONE_STEP_DEG = 360 / CONE_STEPS_PER_TURN; // 30°
        // Half-angle slope: tan(atan(1/2)) = 0.5. Lateral max = 0.5 * forward.
        // Matches Foundry MeasuredTemplate cone (53.13° full angle) — verified vs in-game template dump.
        const CONE_HALF_SLOPE = 0.5;
        if (isAreaMode && (!areaRange || areaRange < 1)) {
            console.error(`chooseToken: pattern="${pattern}" requires areaRange >= 1`);
            resolve(null);
            return;
        }
        const effectiveAreaCount = isAreaMode ? (areaCount === 0 ? 1 : areaCount) : 0;

        let elevationAware = (optElevationAware === null || optElevationAware === undefined)
            ? !!game.settings.get('lancer-automations', 'tah.areaElevationAware')
            : !!optElevationAware;
        let autoElevation = (optAutoElevation === null || optAutoElevation === undefined)
            ? true
            : !!optAutoElevation;
        // Spread the area cell-to-cell from its origin; tall terrain blocks it. Needs elevationAware.
        let propagation = !!optPropagation;

        let selectionOnly = !!selection;

        let rangeHighlight = null;
        const selectedTokens = new Set();
        const selectionHighlights = [];

        /** @type {Array<{id:number, center:{x:number,y:number}, graphics:any, candidates:Token[], included:Set<string>, ignoreFilter:boolean, elevation:number, elevationOffset:number, hostToken?:any, rotation?:number}>} */
        const placements = [];
        let placementSeq = 0;
        // Live offset for cursor preview + the most-recent placement. Frozen on each previously-placed area.
        let pendingElevationOffset = 0;
        // Live rotation for the cone/line preview + the most-recent placement. Frozen on older ones.
        let pendingRotation = 0;
        // Cone rotates in 12 angular steps; a line steps around its endpoint ring (6×length on hex,
        // 8×length on square) so every tick is a distinct facing — far finer than the cone.
        const lineRadius = Math.max(1, Math.round(Number(areaRange) || 1));
        const rotationModulus = isLineMode ? (isHexGrid() ? 6 : 8) * lineRadius : CONE_STEPS_PER_TURN;

        // Lancer vertical hex count: max of actor.system.size + doc dims; 0.5 special-cased; else ceil to integer ≥ 1.
        const tokenVerticalSize = (t) => {
            const actorSize = Number(t?.actor?.system?.size ?? 0);
            const docW = Number(t?.document?.width ?? t?.w ?? 0) || 0;
            const docH = Number(t?.document?.height ?? t?.h ?? 0) || 0;
            const raw = Math.max(actorSize, docW, docH, 0);
            if (!raw)
                return 1;
            if (raw <= 0.5)
                return 0.5;
            return Math.max(1, Math.ceil(raw));
        };
        const verticalOverlap = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;
        const groundAtCenter = (centerPt) => {
            const terrainAPI = globalThis.terrainHeightTools;
            if (!terrainAPI)
                return 0;
            const off = pixelToOffset(centerPt.x, centerPt.y);
            return Number(getHexGroundElevation(off.col, off.row, terrainAPI)) || 0;
        };
        const resolvePlacementElevation = (p) =>
            (autoElevation ? groundAtCenter(p.center) : 0) + (Number(p?.elevationOffset) || 0);

        // Adjacent "col,row" keys: 6 hex neighbours, or 8 on a square grid.
        const neighborKeys = (key) => {
            const [col, row] = key.split(',').map(Number);
            const out = [];
            if (isHexGrid()) {
                /** @type {any} */
                const grid = canvas.grid;
                const c = grid.getCube({ i: row, j: col });
                const dirs = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];
                for (const [dq, dr, ds] of dirs) {
                    const o = grid.getOffset({ q: c.q + dq, r: c.r + dr, s: c.s + ds });
                    out.push(`${o.j},${o.i}`);
                }
            } else {
                for (let dc = -1; dc <= 1; dc++)
                    for (let dr = -1; dr <= 1; dr++)
                        if (dc || dr)
                            out.push(`${col + dc},${row + dr}`);
            }
            return out;
        };

        // Flood-fill from seeds, keeping only reachable cells of `affected`. Cells the elevation
        // filter dropped (tall terrain) aren't in `affected`, so they wall off the spread. Seeds
        // expand even when not in `affected` (a burst's host cells never are).
        const keepConnected = (affected, seedKeys) => {
            const result = new Set();
            const visited = new Set(seedKeys);
            const queue = [...visited];
            for (const k of visited)
                if (affected.has(k))
                    result.add(k);
            while (queue.length) {
                for (const nb of neighborKeys(queue.shift())) {
                    if (visited.has(nb) || !affected.has(nb))
                        continue;
                    visited.add(nb);
                    result.add(nb);
                    queue.push(nb);
                }
            }
            return result;
        };

        // Gate keepConnected on the runtime toggles; seeds default to the area's origin cell.
        const propagate = (affected, seeds) =>
            (elevationAware && propagation) ? keepConnected(affected, seeds) : affected;
        const originSeed = (pt) => {
            const o = pixelToOffset(pt.x, pt.y);
            return [`${o.col},${o.row}`];
        };

        const pulseGraphic = new PIXI.Graphics();
        addGraphicsBelowTokens(pulseGraphic);
        let wavePulse = null;
        if (range !== null && casterToken) {
            rangeHighlight = drawRangeHighlight(casterToken, range, 0x888888, 0.1, includeSelf);
            const hexesByDist = _groupCellsByDistance(
                getOccupiedOffsets(casterToken),
                getInRangeOffsets(casterToken, range, { includeSelf: true })
            );
            wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range);
            canvas.app.ticker.add(wavePulse);
        }

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        const hoverPulseGraphic = new PIXI.Graphics();
        canvas.stage.addChild(hoverPulseGraphic);
        let hoverPulseToken = null;
        const hoverPulseTick = () => {
            hoverPulseGraphic.clear();
            if (!hoverPulseToken)
                return;
            const alpha = 0.35 + 0.55 * Math.abs(Math.sin(performance.now() / 220));
            hoverPulseGraphic.lineStyle(4, 0xff9900, alpha);
            hoverPulseGraphic.beginFill(0xff9900, alpha * 0.25);
            if (isHexGrid()) {
                const occ = getOccupiedOffsets(hoverPulseToken);
                for (const o of occ)
                    drawHexAt(hoverPulseGraphic, o.col, o.row);
            } else {
                hoverPulseGraphic.drawRect(
                    hoverPulseToken.document.x, hoverPulseToken.document.y,
                    hoverPulseToken.document.width * canvas.grid.size,
                    hoverPulseToken.document.height * canvas.grid.size
                );
            }
            hoverPulseGraphic.endFill();
        };
        canvas.app.ticker.add(hoverPulseTick);

        // Pulse the alpha of placed area graphics so the yellow highlight breathes.
        const areaPulseTick = () => {
            if (placements.length === 0)
                return;
            const a = 0.65 + 0.35 * Math.sin(performance.now() / 280);
            for (const p of placements) {
                if (p.graphics)
                    p.graphics.alpha = a;
            }
        };
        canvas.app.ticker.add(areaPulseTick);
        const setHoverPulseTokenId = (tokenId) => {
            hoverPulseToken = tokenId ? (canvas.tokens.get(tokenId) ?? null) : null;
        };

        const cursorElevLabel = new PIXI.Text('', {
            fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, stroke: 0x000000, strokeThickness: 4, fontWeight: 'bold',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        canvas.stage.addChild(cursorElevLabel);

        const previewSelectHighlight = new PIXI.Graphics();
        canvas.stage.addChild(previewSelectHighlight);

        const selectionIds = selection ? new Set(selection.map(t => t.id)) : null;
        const selectionHighlightGraphics = [];
        if (selection) {
            for (const t of selection) {
                const hl = new PIXI.Graphics();
                hl.lineStyle(4, 0x00ff00, 0.8);
                hl.beginFill(0x00ff00, 0.2);
                const offsets = getOccupiedOffsets(t);
                for (const off of offsets) {
                    if (isHexGrid()) {
                        drawHexAt(hl, off.col, off.row);
                    } else {
                        const c = getHexCenter(off.col, off.row);
                        hl.drawRect(c.x - canvas.grid.size / 2, c.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
                    }
                }
                hl.endFill();
                canvas.stage.addChild(hl);
                selectionHighlightGraphics.push(hl);
            }
        }

        const baseTokens = canvas.tokens.placeables.filter(t => {
            if (!includeSelf && t.id === casterToken?.id)
                return false;
            if (!includeHidden && t.document.hidden)
                return false;
            if (!soft && filter && !filter(t))
                return false;
            return true;
        });
        const passesAdvisory = (token) => {
            if (filter && !filter(token))
                return false;
            if (range !== null && casterToken && !isPositionInRange(casterToken, token, range))
                return false;
            return true;
        };

        const getActiveTokens = () => {
            if (selectionOnly && selectionIds)
                return baseTokens.filter(t => selectionIds.has(t.id));
            return baseTokens;
        };
        let allTokens = getActiveTokens();

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        const restoreLayerClick = suppressTokenLayerClick();

        let safeMove, safeClick, safeAbort, safeKey, safeWheel;
        const doCleanup = () => {
            disposeCursorPreview();
            canvas.app.ticker.remove(hoverPulseTick);
            canvas.app.ticker.remove(areaPulseTick);
            destroyGraphics(hoverPulseGraphic);
            destroyGraphics(cursorElevLabel);
            destroyGraphics(previewSelectHighlight);
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
            if (safeWheel)
                document.removeEventListener('wheel', safeWheel, { capture: true });
            destroyGraphics(rangeHighlight);
            destroyGraphics(pulseGraphic);
            selectionHighlightGraphics.forEach(destroyGraphics);
            selectionHighlights.forEach(h => destroyGraphics(h.graphics));
            for (const p of placements)
                destroyGraphics(p.graphics);
            placements.length = 0;

            canvas.tokens.interactiveChildren = prevInteractive;
            restoreLayerClick();
            _removeInfoCard(cardEl);
            closeStackPopup();
        };

        const doConfirm = () => {
            doCleanup();
            if (selectedTokens.size > 0) {
                resolve(Array.from(selectedTokens));
            } else {
                resolve(null);
            }
        };

        const doCancel = () => {
            doCleanup();
            resolve(null);
        };

        const computeWarnings = (token) => {
            const msgs = [];
            if (!isAreaMode && range !== null && casterToken && !isPositionInRange(casterToken, token, range)) {
                const dist = getMinGridDistance(casterToken, token);
                msgs.push(`Out of range (${dist} > ${range})`);
            }
            if (filter && !filter(token))
                msgs.push(filterWarning ?? 'Invalid target');
            return msgs;
        };

        // Recompute selectedTokens (union of per-placement included) + redraw selection highlights.
        const recomputeBlastSelection = () => {
            selectionHighlights.splice(0).forEach(h => destroyGraphics(h.graphics));
            selectedTokens.clear();
            for (const p of placements) {
                for (const id of p.included) {
                    const t = canvas.tokens.get(id);
                    if (t)
                        selectedTokens.add(t);
                }
            }
            for (const t of selectedTokens)
                drawSelectionHighlight(t);
        };

        const enforceCountCap = () => {
            if (count === -1)
                return;
            let total = 0;
            for (const p of placements)
                total += p.included.size;
            if (total <= count)
                return;
            for (let i = placements.length - 1; i >= 0 && total > count; i--) {
                const p = placements[i];
                const ids = Array.from(p.included);
                for (const id of ids) {
                    if (total <= count)
                        break;
                    p.included.delete(id);
                    total--;
                }
            }
        };

        // True when terrain at this cell rises to/above `top`, so the area can't occupy it.
        const terrainBlocks = (col, row, top) => {
            if (!elevationAware)
                return false;
            const tAPI = globalThis.terrainHeightTools;
            const ground = tAPI ? (Number(getHexGroundElevation(col, row, tAPI)) || 0) : 0;
            return ground >= top;
        };
        // Drop cells the area can't reach vertically (terrain flush with / above its top).
        const trimByTerrain = (affected, top) => {
            if (!elevationAware)
                return affected;
            const out = new Set();
            for (const key of affected) {
                const [c, r] = key.split(',').map(Number);
                if (!terrainBlocks(c, r, top))
                    out.add(key);
            }
            return out;
        };
        // Tokens whose footprint hits `affected` and whose height span overlaps [lo, hi].
        const catchTokens = (affected, lo, hi, skipId = null) => {
            const caught = [];
            for (const t of canvas.tokens.placeables) {
                if (skipId && t.id === skipId)
                    continue;
                if (!includeHidden && t.document.hidden)
                    continue;
                if (!includeSelf && casterToken && t.id === casterToken.id)
                    continue;
                if (!getOccupiedOffsets(t).some(o => affected.has(`${o.col},${o.row}`)))
                    continue;
                if (elevationAware) {
                    const tElev = Number(t.document?.elevation) || 0;
                    if (!verticalOverlap(lo, hi, tElev, tElev + tokenVerticalSize(t)))
                        continue;
                }
                caught.push(t);
            }
            return caught;
        };

        const tokensInBlast = (centerPt, radius, areaElev = 0) => {
            const areaTop = areaElev + radius;
            let affected = elevationAware
                ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: true, elevationAware: true })
                : getInRangeOffsets(centerPt, radius, { includeSelf: true, elevationAware: false });
            affected = trimByTerrain(affected, areaTop);
            affected = propagate(affected, originSeed(centerPt));
            return { caught: catchTokens(affected, areaElev, areaTop), affected };
        };

        // Burst: centered on a HOST token. Vertical extent symmetric: [tokenElev - radius, tokenElev + radius].
        // Host elevation drives everything; no offset, no Q/E.
        const tokensInBurst = (hostToken, radius) => {
            const tokenElev = Number(hostToken?.document?.elevation) || 0;
            const burstTop = tokenElev + radius;
            const burstBot = tokenElev - radius;
            let affected = getInRangeOffsets(hostToken, radius, { includeSelf: false, elevationAware });
            affected = trimByTerrain(affected, burstTop);
            affected = propagate(affected, getOccupiedOffsets(hostToken).map(o => `${o.col},${o.row}`));
            return { caught: catchTokens(affected, burstBot, burstTop, hostToken.id), affected, hostElev: tokenElev };
        };

        // Cone: hex grid uses generative cube-coord algorithm (matches Foundry MeasuredTemplate cone exactly).
        //   - Aim direction in degrees, range in hex distance.
        //   - At each cube offset (q,r,s) with q+r+s=0: include if forward > 0,
        //     cube distance <= range, and |lateral| <= 0.5 * forward.
        //   - Symmetric shape on hex-aligned aim (multiples of 60°), lopsided in between.
        // Square grid falls back to a 60° angular wedge.
        // `rotation` is an INT step count (each step = CONE_STEP_DEG = 30°).
        const tokensInCone = (centerPt, radius, areaElev, rotation) => {
            const areaTop = areaElev + radius;
            let affected = new Set();

            if (isHexGrid()) {
                /** @type {any} */
                const grid = canvas.grid;
                const srcOff = pixelToOffset(centerPt.x, centerPt.y);
                const cursorCube = grid.getCube({ i: srcOff.row, j: srcOff.col });
                const dirDeg = (Number(rotation) || 0) * CONE_STEP_DEG;

                // Off-axis (aim not a multiple of 60°): the cone's first cell is at distance 2.
                // Re-anchoring it on the cursor costs one range, so compensate +1.
                const offAxis = (((dirDeg % 60) + 60) % 60) > 1e-9;
                const effRadius = offAxis ? radius + 1 : radius;

                const th = dirDeg * Math.PI / 180;
                const fx = Math.cos(th), fy = Math.sin(th);
                const lx = -Math.sin(th), ly = Math.cos(th);
                const R = Math.ceil(effRadius) + 1;

                // Cone offsets relative to origin (0,0,0).
                const offs = [];
                for (let q = -R; q <= R; q++) {
                    for (let r = -R; r <= R; r++) {
                        const s = -q - r;
                        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > R)
                            continue;
                        const x = q + 0.5 * r;
                        const y = (Math.sqrt(3) / 2) * r;
                        const fwd = x * fx + y * fy;
                        const lat = x * lx + y * ly;
                        const cd = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
                        if (fwd <= 1e-9 || cd > effRadius + 1e-9)
                            continue;
                        if (Math.abs(lat) > CONE_HALF_SLOPE * fwd + 1e-9)
                            continue;
                        offs.push({ q, r, s, cd, fwd });
                    }
                }

                if (offs.length) {
                    // Nearest cell (tie-break: most forward) is the one that lands on the cursor.
                    let first = offs[0];
                    for (const o of offs) {
                        if (o.cd < first.cd || (o.cd === first.cd && o.fwd > first.fwd))
                            first = o;
                    }
                    // Shift the whole cone so `first` sits on the cursor cell.
                    for (const o of offs) {
                        const off = grid.getOffset({
                            q: cursorCube.q + (o.q - first.q),
                            r: cursorCube.r + (o.r - first.r),
                            s: cursorCube.s + (o.s - first.s),
                        });
                        const cellCol = off.j, cellRow = off.i;
                        if (terrainBlocks(cellCol, cellRow, areaTop))
                            continue;
                        affected.add(`${cellCol},${cellRow}`);
                    }
                }
            } else {
                // Square grid: 60° angular wedge with discrete 30° snap rotation.
                const TAU = 2 * Math.PI;
                const HALF_ANGLE = Math.PI / 6; // 60° wedge
                const rotRad = (Number(rotation) || 0) * (CONE_STEP_DEG * Math.PI / 180);
                const raw = elevationAware
                    ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: false, elevationAware: true })
                    : getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, radius, { includeSelf: false, elevationAware: false });
                for (const key of raw) {
                    const [c, r] = key.split(',').map(Number);
                    if (terrainBlocks(c, r, areaTop))
                        continue;
                    const cell = getHexCenter(c, r);
                    const ang = Math.atan2(cell.y - centerPt.y, cell.x - centerPt.x);
                    let d = (ang - rotRad) % TAU;
                    if (d > Math.PI) d -= TAU;
                    else if (d < -Math.PI) d += TAU;
                    if (Math.abs(d) > HALF_ANGLE)
                        continue;
                    affected.add(key);
                }
            }

            affected = propagate(affected, originSeed(centerPt));
            return { caught: catchTokens(affected, areaElev, areaTop), affected };
        };

        // --- Hex line drawing (Red Blob Games): cube lerp + cube_round → a clean 1-wide path. ---
        const cubeRound = (q, r, s) => {
            let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
            const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
            if (dq > dr && dq > ds) rq = -rr - rs;
            else if (dr > ds) rr = -rq - rs;
            else rs = -rq - rr;
            return { q: rq, r: rr, s: rs };
        };
        const cubeDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
        const cubeLineDraw = (a, b) => {
            const N = Math.max(1, cubeDistance(a, b));
            const out = [];
            for (let i = 0; i <= N; i++) {
                const t = i / N;
                // epsilon nudge keeps samples off cell boundaries so rounding is consistent
                out.push(cubeRound(
                    a.q + (b.q - a.q) * t + 1e-6,
                    a.r + (b.r - a.r) * t + 2e-6,
                    a.s + (b.s - a.s) * t - 3e-6,
                ));
            }
            return out;
        };
        const LINE_CUBE_DIRS = [
            { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
            { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
        ];
        const cubeRing = (center, radius) => {
            if (radius <= 0) return [{ ...center }];
            const out = [];
            let hex = {
                q: center.q + LINE_CUBE_DIRS[4].q * radius,
                r: center.r + LINE_CUBE_DIRS[4].r * radius,
                s: center.s + LINE_CUBE_DIRS[4].s * radius,
            };
            for (let i = 0; i < 6; i++)
                for (let j = 0; j < radius; j++) {
                    out.push(hex);
                    hex = { q: hex.q + LINE_CUBE_DIRS[i].q, r: hex.r + LINE_CUBE_DIRS[i].r, s: hex.s + LINE_CUBE_DIRS[i].s };
                }
            return out;
        };
        const squareRing = (o, radius) => {
            const out = [];
            for (let dc = -radius; dc < radius; dc++) out.push({ col: o.col + dc, row: o.row - radius });
            for (let dr = -radius; dr < radius; dr++) out.push({ col: o.col + radius, row: o.row + dr });
            for (let dc = radius; dc > -radius; dc--) out.push({ col: o.col + dc, row: o.row + radius });
            for (let dr = radius; dr > -radius; dr--) out.push({ col: o.col - radius, row: o.row + dr });
            return out;
        };
        const bresenham = (x0, y0, x1, y1) => {
            const pts = [];
            const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
            let err = dx - dy, x = x0, y = y0;
            for (;;) {
                pts.push({ col: x, row: y });
                if (x === x1 && y === y1) break;
                const e2 = 2 * err;
                if (e2 > -dy) { err -= dy; x += sx; }
                if (e2 < dx) { err += dx; y += sy; }
            }
            return pts;
        };
        // Whole-cell perpendicular offsets for a width-n line: 1→[0], 2→[0,1], 3→[-1,0,1], 4→[-1,0,1,2].
        // Integer steps round reliably (half-cell offsets don't); even widths get the extra cell on one side.
        const widthOffsets = (n) => {
            const lo = -Math.floor((n - 1) / 2);
            return Array.from({ length: n }, (_, i) => lo + i);
        };

        // Endpoint candidates around the origin at `radius` cells — one per rotation tick.
        const lineRing = (originOff, radius) => {
            if (isHexGrid()) {
                /** @type {any} */
                const grid = canvas.grid;
                const a = grid.getCube({ i: originOff.row, j: originOff.col });
                return cubeRing(a, radius).map(c => { const o = grid.getOffset(c); return { col: o.j, row: o.i }; });
            }
            return squareRing(originOff, radius);
        };

        // "col,row" keys for a clean line A→B, widened to `size` cells perpendicular.
        const lineCells = (aOff, bOff, size) => {
            /** @type {any} */
            const grid = canvas.grid;
            const out = new Set();
            const aPx = getHexCenter(aOff.col, aOff.row);
            const bPx = getHexCenter(bOff.col, bOff.row);
            const dux = bPx.x - aPx.x, duy = bPx.y - aPx.y;
            const dlen = Math.hypot(dux, duy) || 1;
            const px = -duy / dlen, py = dux / dlen; // perpendicular unit
            const pitch = grid.size;
            for (const k of widthOffsets(Math.max(1, Math.round(size)))) {
                const a2 = pixelToOffset(aPx.x + px * k * pitch, aPx.y + py * k * pitch);
                const b2 = pixelToOffset(bPx.x + px * k * pitch, bPx.y + py * k * pitch);
                if (isHexGrid()) {
                    const ca = grid.getCube({ i: a2.row, j: a2.col });
                    const cb = grid.getCube({ i: b2.row, j: b2.col });
                    for (const c of cubeLineDraw(ca, cb)) { const o = grid.getOffset(c); out.add(`${o.j},${o.i}`); }
                } else {
                    for (const p of bresenham(a2.col, a2.row, b2.col, b2.row)) out.add(`${p.col},${p.row}`);
                }
            }
            return out;
        };

        // Line: a clean 1-cell-wide path from the cursor along the aim, `length` cells long,
        // widened to `size` cells; with elevationAware, `size` is also the line's vertical height.
        // `rotation` indexes the endpoint ring (6×length facings on hex), far finer than the cone.
        const tokensInLine = (centerPt, length, areaElev, rotation, size) => {
            const areaTop = areaElev + size;
            let affected = new Set();

            const radius = Math.max(1, Math.round(length));
            const srcOff = pixelToOffset(centerPt.x, centerPt.y);
            const ring = lineRing(srcOff, radius);
            const endOff = ring[((Math.round(rotation) % ring.length) + ring.length) % ring.length];
            for (const key of lineCells(srcOff, endOff, size)) {
                const [col, row] = key.split(',').map(Number);
                if (!terrainBlocks(col, row, areaTop))
                    affected.add(key);
            }

            affected = propagate(affected, originSeed(centerPt));
            return { caught: catchTokens(affected, areaElev, areaTop), affected };
        };

        // caught/affected for an aimed placement (cone or line); blast falls through, rotation unused.
        const computeAreaFor = (center, elevation, rotation) =>
            isLineMode ? tokensInLine(center, areaRange, elevation, rotation, size)
                : isConeMode ? tokensInCone(center, areaRange, elevation, rotation)
                    : tokensInBlast(center, areaRange, elevation);

        const makeElevationLabel = (elev, center, gridSize) => {
            const e = Math.round(Number(elev) || 0);
            const txt = e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
            const label = new PIXI.Text(txt, {
                fontFamily: 'Arial',
                fontSize: Math.max(14, gridSize * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: 4,
                fontWeight: 'bold',
            });
            label.anchor.set(0.5);
            label.x = center.x;
            label.y = center.y;
            return label;
        };

        const drawBlastHighlight = (affected, { color = 0xffd84a, fillAlpha = 0.22, lineAlpha = 0.7, elevation = null, center = null } = {}) => {
            const container = new PIXI.Container();
            const g = new PIXI.Graphics();
            if (lineAlpha > 0)
                g.lineStyle(2, color, lineAlpha);
            if (fillAlpha > 0)
                g.beginFill(color, fillAlpha);
            _paintCells(g, affected);
            if (fillAlpha > 0)
                g.endFill();
            container.addChild(g);
            if (elevationAware && center)
                container.addChild(makeElevationLabel(elevation, center, canvas.grid.size));
            addGraphicsBelowTokens(container);
            return container;
        };

        const placeBlast = (worldX, worldY) => {
            const off = pixelToOffset(worldX, worldY);
            const centerPt = getHexCenter(off.col, off.row);
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range)) {
                if (!soft) {
                    ui.notifications.warn('Blast center out of range.');
                    return;
                }
            }
            if (effectiveAreaCount !== -1 && placements.length >= effectiveAreaCount)
                destroyGraphics(placements.shift()?.graphics);
            const center = { x: centerPt.x, y: centerPt.y };
            const elevationOffset = pendingElevationOffset;
            const elevation = (autoElevation ? groundAtCenter(center) : 0) + elevationOffset;
            const { caught, affected } = tokensInBlast(center, areaRange, elevation);
            const placement = {
                id: ++placementSeq,
                center,
                graphics: drawBlastHighlight(affected, { elevation, center }),
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation,
                elevationOffset,
            };
            for (const t of caught) {
                if (!filter || filter(t))
                    placement.included.add(t.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const placeBurst = (hostToken) => {
            if (!hostToken)
                return;
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, hostToken, range)) {
                if (!soft) {
                    ui.notifications.warn('Burst target out of range.');
                    return;
                }
            }
            if (effectiveAreaCount !== -1 && placements.length >= effectiveAreaCount)
                destroyGraphics(placements.shift()?.graphics);
            const center = { x: hostToken.center.x, y: hostToken.center.y };
            const { caught, affected, hostElev } = tokensInBurst(hostToken, areaRange);
            const placement = {
                id: ++placementSeq,
                center,
                hostToken,
                graphics: drawBlastHighlight(affected, { elevation: hostElev, center }),
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation: hostElev,
                elevationOffset: 0,
            };
            for (const t of caught) {
                if (!filter || filter(t))
                    placement.included.add(t.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const placeCone = (worldX, worldY) => {
            const off = pixelToOffset(worldX, worldY);
            const centerPt = getHexCenter(off.col, off.row);
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range)) {
                if (!soft) {
                    ui.notifications.warn('Area center out of range.');
                    return;
                }
            }
            if (effectiveAreaCount !== -1 && placements.length >= effectiveAreaCount)
                destroyGraphics(placements.shift()?.graphics);
            const center = { x: centerPt.x, y: centerPt.y };
            const elevationOffset = pendingElevationOffset;
            const elevation = (autoElevation ? groundAtCenter(center) : 0) + elevationOffset;
            const rotation = pendingRotation;
            const { caught, affected } = computeAreaFor(center, elevation, rotation);
            const placement = {
                id: ++placementSeq,
                center,
                graphics: drawBlastHighlight(affected, { elevation, center }),
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation,
                elevationOffset,
                rotation,
            };
            for (const t of caught) {
                if (!filter || filter(t))
                    placement.included.add(t.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        // Re-derive every placement from scratch (used when toggles change or Q/E is pressed).
        const recomputeAllPlacements = () => {
            for (const p of placements) {
                let caught, affected;
                if (p.hostToken) {
                    p.elevation = Number(p.hostToken.document?.elevation) || 0;
                    ({ caught, affected } = tokensInBurst(p.hostToken, areaRange));
                } else {
                    p.elevation = resolvePlacementElevation(p);
                    ({ caught, affected } = computeAreaFor(p.center, p.elevation, p.rotation));
                }
                destroyGraphics(p.graphics);
                p.graphics = drawBlastHighlight(affected, { elevation: p.elevation, center: p.center });
                const oldIncluded = p.included;
                p.candidates = caught;
                // Preserve manual inclusions for tokens still in candidates; default-include new ones that pass filter.
                p.included = new Set();
                for (const t of caught) {
                    if (oldIncluded.has(t.id))
                        p.included.add(t.id);
                    else if (!filter || filter(t) || p.ignoreFilter)
                        p.included.add(t.id);
                }
            }
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const removeBlast = (placementId) => {
            const idx = placements.findIndex(p => p.id === placementId);
            if (idx === -1)
                return;
            destroyGraphics(placements[idx].graphics);
            placements.splice(idx, 1);
            recomputeBlastSelection();
            refreshCard();
        };

        const toggleAreaToken = (placementId, tokenId) => {
            const p = placements.find(x => x.id === placementId);
            if (!p)
                return;
            if (p.included.has(tokenId)) {
                p.included.delete(tokenId);
                recomputeBlastSelection();
                refreshCard();
                return;
            }
            const projected = new Set();
            for (const pl of placements)
                for (const id of pl.included)
                    projected.add(id);
            projected.add(tokenId);
            if (count !== -1 && projected.size > count) {
                ui.notifications.warn(`Maximum of ${count} target(s) already selected.`);
                return;
            }
            p.included.add(tokenId);
            recomputeBlastSelection();
            refreshCard();
        };

        const toggleAreaFilter = (placementId) => {
            const p = placements.find(x => x.id === placementId);
            if (!p)
                return;
            p.ignoreFilter = !p.ignoreFilter;
            refreshCard();
        };

        const blastPlacementData = () => placements.map((p, idx) => {
            const candidates = p.candidates.map(t => {
                const filterPass = !filter || filter(t);
                return {
                    id: t.id,
                    name: t.name,
                    img: t.document.texture.src,
                    included: p.included.has(t.id),
                    filtered: !filterPass,
                    eligible: filterPass || p.ignoreFilter,
                };
            });
            const hasFiltered = !!filter && candidates.some(c => c.filtered);
            const centerOutOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, p.center, range);
            return {
                id: p.id,
                index: idx,
                label: `Area ${idx + 1}`,
                count: p.included.size,
                ignoreFilter: p.ignoreFilter,
                hasFilter: !!filter,
                hasFiltered,
                centerOutOfRange,
                elevation: Number(p.elevation) || 0,
                elevationOffset: Number(p.elevationOffset) || 0,
                candidates,
            };
        });

        const refreshCard = () => {
            const warnings = {};
            for (const t of selectedTokens) {
                const msgs = computeWarnings(t);
                if (msgs.length > 0)
                    warnings[t.id] = msgs;
            }
            _updateInfoCard(cardEl, "chooseToken", {
                selectedTokens,
                warnings,
                pattern,
                placements: isAreaMode ? blastPlacementData() : null,
                areaCount: effectiveAreaCount,
                onDeselect: (tokenId) => {
                    if (isBlastMode) {
                        let changed = false;
                        for (const p of placements) {
                            if (p.included.delete(tokenId))
                                changed = true;
                        }
                        if (changed) {
                            recomputeBlastSelection();
                            refreshCard();
                        }
                        return;
                    }
                    const token = allTokens.find(t => t.id === tokenId);
                    if (token && selectedTokens.has(token)) {
                        selectedTokens.delete(token);
                        removeSelectionHighlight(token);
                        refreshCard();
                    }
                },
                onRemoveArea: removeBlast,
                onToggleAreaToken: toggleAreaToken,
                onToggleAreaFilter: toggleAreaFilter,
                onHoverToken: setHoverPulseTokenId,
                onUnhoverToken: () => setHoverPulseTokenId(null),
                elevationAware,
                autoElevation,
                onToggleElevationAware: () => {
                    elevationAware = !elevationAware;
                    recomputeAllPlacements();
                },
                onToggleAutoElevation: () => {
                    autoElevation = !autoElevation;
                    recomputeAllPlacements();
                },
                propagation,
                onTogglePropagation: () => {
                    propagation = !propagation;
                    recomputeAllPlacements();
                },
            });
        };

        const cardEl = _createInfoCard("chooseToken", {
            title,
            icon: icon ?? (isBurstMode ? 'systems/lancer/assets/icons/aoe_burst.svg'
                : isConeMode ? 'systems/lancer/assets/icons/aoe_cone.svg'
                : isLineMode ? 'systems/lancer/assets/icons/aoe_line.svg'
                : isBlastMode ? 'systems/lancer/assets/icons/aoe_blast.svg'
                : undefined),
            iconInvert: !icon && isAreaMode,
            headerClass,
            description,
            range,
            count,
            hasSelection: !!selection,
            pattern,
            areaRange,
            areaCount: effectiveAreaCount,
            onConfirm: doConfirm,
            onCancel: doCancel
        });

        if (selection) {
            cardEl.find('[data-role="selection-toggle"]').on('change', function () {
                selectionOnly = /** @type {HTMLInputElement} */ (this).checked;
                allTokens = getActiveTokens();
            });
        }

        const drawSelectionHighlight = (token) => {
            const highlight = new PIXI.Graphics();
            highlight.lineStyle(4, 0x00ffff, 0.8);
            highlight.beginFill(0x00ffff, 0.2);

            if (isHexGrid()) {
                const offsets = getOccupiedOffsets(token);
                for (const off of offsets) {
                    drawHexAt(highlight, off.col, off.row);
                }
            } else {
                highlight.drawRect(
                    token.document.x,
                    token.document.y,
                    token.document.width * canvas.grid.size,
                    token.document.height * canvas.grid.size
                );
            }

            highlight.endFill();
            canvas.stage.addChild(highlight);
            selectionHighlights.push({ tokenI: token.id, graphics: highlight });
        };

        const removeSelectionHighlight = (token) => {
            const idx = selectionHighlights.findIndex(h => h.tokenI === token.id);
            if (idx !== -1) {
                destroyGraphics(selectionHighlights[idx].graphics);
                selectionHighlights.splice(idx, 1);
            }
        };

        const drawCursorHighlight = (tx, ty) => {
            cursorPreview.clear();

            // Check for a token under cursor first — supports tokens partially overlapping the range
            let hoveredToken = allTokens.find(token => {
                const bounds = token.bounds;
                if (tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom) {
                    if (!soft && range !== null && casterToken)
                        return isPositionInRange(casterToken, token, range);
                    return true;
                }
                return false;
            }) || null;

            const hoveringValid = hoveredToken !== null;
            const hoveringAdvisory = hoveredToken !== null && passesAdvisory(hoveredToken);
            const color = hoveringValid ? (hoveringAdvisory ? 0x0088ff : 0xffaa00) : 0xff0000;
            const alpha = 0.4;
            const gridSize = canvas.grid.size;

            cursorPreview.lineStyle(2, color, 0.8);
            cursorPreview.beginFill(color, alpha);

            if (hoveredToken) {

                if (isHexGrid()) {
                    const offsets = getOccupiedOffsets(hoveredToken);
                    for (const off of offsets) {
                        drawHexAt(cursorPreview, off.col, off.row);
                    }
                } else {
                    cursorPreview.drawRect(
                        hoveredToken.document.x,
                        hoveredToken.document.y,
                        hoveredToken.document.width * gridSize,
                        hoveredToken.document.height * gridSize
                    );
                }
            } else {
                const cursorOffset = pixelToOffset(tx, ty);
                if (isHexGrid()) {
                    drawHexAt(cursorPreview, cursorOffset.col, cursorOffset.row);
                } else {
                    const center = getHexCenter(cursorOffset.col, cursorOffset.row);
                    cursorPreview.drawRect(
                        center.x - gridSize / 2,
                        center.y - gridSize / 2,
                        gridSize,
                        gridSize
                    );
                }
            }

            cursorPreview.endFill();
        };

        const moveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawCursorHighlight(tx, ty);
        };

        const drawBlastCursor = (tx, ty) => {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            const off = pixelToOffset(tx, ty);
            const centerPt = getHexCenter(off.col, off.row);
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range);
            const color = outOfRange ? 0xff0000 : 0x0088ff;
            let affected, previewElev = null;
            if (elevationAware) {
                previewElev = (autoElevation ? groundAtCenter({ x: centerPt.x, y: centerPt.y }) : 0) + pendingElevationOffset;
                affected = getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: previewElev }, areaRange, { includeSelf: true, elevationAware: true });
                affected = trimByTerrain(affected, previewElev + areaRange);
            } else {
                affected = getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, areaRange, { includeSelf: true, elevationAware: false });
            }
            affected = propagate(affected, [`${off.col},${off.row}`]);
            cursorPreview.lineStyle(2, color, 0.6);
            cursorPreview.beginFill(color, 0.12);
            _paintCells(cursorPreview, affected);
            cursorPreview.endFill();

            // Cyan outline on tokens that would be caught (mirrors point-mode selection visual).
            const { caught: previewCaught } = tokensInBlast({ x: centerPt.x, y: centerPt.y }, areaRange, previewElev || 0);
            previewSelectHighlight.lineStyle(4, 0x00ffff, 0.8);
            previewSelectHighlight.beginFill(0x00ffff, 0.2);
            for (const t of previewCaught) {
                if (filter && !filter(t))
                    continue;
                if (isHexGrid()) {
                    for (const o of getOccupiedOffsets(t))
                        drawHexAt(previewSelectHighlight, o.col, o.row);
                } else {
                    previewSelectHighlight.drawRect(
                        t.document.x, t.document.y,
                        t.document.width * canvas.grid.size,
                        t.document.height * canvas.grid.size
                    );
                }
            }
            previewSelectHighlight.endFill();
            if (elevationAware) {
                const e = Math.round(previewElev || 0);
                cursorElevLabel.text = e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = centerPt.x;
                cursorElevLabel.y = centerPt.y;
                cursorElevLabel.visible = true;
            } else {
                cursorElevLabel.visible = false;
            }
        };

        let lastBlastCursor = null;
        const blastMoveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            lastBlastCursor = { x: tx, y: ty };
            drawBlastCursor(tx, ty);
        };
        const refreshBlastCursor = () => {
            if (lastBlastCursor)
                drawBlastCursor(lastBlastCursor.x, lastBlastCursor.y);
        };

        const blastClickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            placeBlast(tx, ty);
        };

        // Burst cursor: when over a token, preview burst centered on that token; else show a small marker.
        const tokenUnderCursor = (tx, ty) => canvas.tokens.placeables.find(t => {
            if (!includeHidden && t.document.hidden)
                return false;
            if (!includeSelf && casterToken && t.id === casterToken.id)
                return false;
            const b = t.bounds;
            return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
        }) || null;

        const drawBurstCursor = (tx, ty) => {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            const hovered = tokenUnderCursor(tx, ty);
            if (!hovered) {
                // Small ring at cursor — distinct from point-mode hex highlight, but visible enough.
                cursorPreview.lineStyle(2, 0xffaa00, 0.85);
                cursorPreview.beginFill(0xffaa00, 0.25);
                cursorPreview.drawCircle(tx, ty, Math.max(6, canvas.grid.size * 0.12));
                cursorPreview.endFill();
                cursorElevLabel.visible = false;
                return;
            }
            const tokenElev = Number(hovered.document?.elevation) || 0;
            const burstTop = tokenElev + areaRange;
            let affected = getInRangeOffsets(hovered, areaRange, { includeSelf: false, elevationAware });
            affected = trimByTerrain(affected, burstTop);
            affected = propagate(affected, getOccupiedOffsets(hovered).map(o => `${o.col},${o.row}`));
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, hovered, range);
            const color = outOfRange ? 0xff0000 : 0x0088ff;
            cursorPreview.lineStyle(2, color, 0.6);
            cursorPreview.beginFill(color, 0.12);
            _paintCells(cursorPreview, affected);
            cursorPreview.endFill();

            const { caught } = tokensInBurst(hovered, areaRange);
            previewSelectHighlight.lineStyle(4, 0x00ffff, 0.8);
            previewSelectHighlight.beginFill(0x00ffff, 0.2);
            for (const t of caught) {
                if (filter && !filter(t))
                    continue;
                if (isHexGrid()) {
                    for (const o of getOccupiedOffsets(t))
                        drawHexAt(previewSelectHighlight, o.col, o.row);
                } else {
                    previewSelectHighlight.drawRect(
                        t.document.x, t.document.y,
                        t.document.width * canvas.grid.size,
                        t.document.height * canvas.grid.size
                    );
                }
            }
            previewSelectHighlight.endFill();

            if (elevationAware) {
                const e = Math.round(tokenElev);
                cursorElevLabel.text = e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = hovered.center.x;
                cursorElevLabel.y = hovered.center.y;
                cursorElevLabel.visible = true;
            } else {
                cursorElevLabel.visible = false;
            }
        };

        const burstMoveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawBurstCursor(tx, ty);
        };

        const burstClickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            const hovered = tokenUnderCursor(tx, ty);
            if (hovered)
                placeBurst(hovered);
        };

        const drawConeCursor = (tx, ty) => {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            const off = pixelToOffset(tx, ty);
            const centerPt = getHexCenter(off.col, off.row);
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range);
            const color = outOfRange ? 0xff0000 : 0x0088ff;
            const previewElev = elevationAware
                ? (autoElevation ? groundAtCenter({ x: centerPt.x, y: centerPt.y }) : 0) + pendingElevationOffset
                : 0;
            const { caught: previewCaught, affected } = computeAreaFor(
                { x: centerPt.x, y: centerPt.y }, previewElev, pendingRotation
            );
            cursorPreview.lineStyle(2, color, 0.6);
            cursorPreview.beginFill(color, 0.12);
            _paintCells(cursorPreview, affected);
            cursorPreview.endFill();

            previewSelectHighlight.lineStyle(4, 0x00ffff, 0.8);
            previewSelectHighlight.beginFill(0x00ffff, 0.2);
            for (const t of previewCaught) {
                if (filter && !filter(t))
                    continue;
                if (isHexGrid()) {
                    for (const o of getOccupiedOffsets(t))
                        drawHexAt(previewSelectHighlight, o.col, o.row);
                } else {
                    previewSelectHighlight.drawRect(
                        t.document.x, t.document.y,
                        t.document.width * canvas.grid.size,
                        t.document.height * canvas.grid.size
                    );
                }
            }
            previewSelectHighlight.endFill();

            if (elevationAware) {
                const e = Math.round(previewElev || 0);
                cursorElevLabel.text = e > 0 ? `↑ ${e}` : e < 0 ? `↓ ${-e}` : `↕ 0`;
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = centerPt.x;
                cursorElevLabel.y = centerPt.y;
                cursorElevLabel.visible = true;
            } else {
                cursorElevLabel.visible = false;
            }
        };

        let lastConeCursor = null;
        const coneMoveHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            lastConeCursor = { x: tx, y: ty };
            drawConeCursor(tx, ty);
        };
        const refreshConeCursor = () => {
            if (lastConeCursor)
                drawConeCursor(lastConeCursor.x, lastConeCursor.y);
        };
        const coneClickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            placeCone(tx, ty);
        };

        let stackPopupEl = null;
        let stackOutsideHandler = null;
        const closeStackPopup = () => {
            if (stackPopupEl) {
                stackPopupEl.remove();
                stackPopupEl = null;
            }
            if (stackOutsideHandler) {
                document.removeEventListener('pointerdown', stackOutsideHandler, true);
                stackOutsideHandler = null;
            }
        };

        const toggleTokenSelection = (token) => {
            if (!soft && range !== null && casterToken && !isPositionInRange(casterToken, token, range))
                return;
            if (selectedTokens.has(token)) {
                selectedTokens.delete(token);
                removeSelectionHighlight(token);
                refreshCard();
                return;
            }
            if (count !== -1 && selectedTokens.size >= count) {
                if (count === 1) {
                    const oldToken = selectedTokens.values().next().value;
                    selectedTokens.delete(oldToken);
                    removeSelectionHighlight(oldToken);
                } else {
                    ui.notifications.warn(`Maximum of ${count} targets already selected.`);
                    return;
                }
            }
            selectedTokens.add(token);
            drawSelectionHighlight(token);
            refreshCard();
        };

        const showStackPicker = (tokens, screenX, screenY) => {
            closeStackPopup();
            const el = document.createElement('div');
            el.className = 'la-stack-picker';
            el.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:10000;background:#1c1c1c;border:2px solid #ff6400;border-radius:4px;padding:4px;min-width:160px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Signika,sans-serif;`;
            for (const token of tokens) {
                const isSelected = selectedTokens.has(token);
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:3px;${isSelected ? 'background:rgba(255,100,0,0.25);' : ''}`;
                row.innerHTML = `
                    <img src="${token.document.texture.src}" style="width:24px;height:24px;object-fit:contain;border:1px solid #555;border-radius:2px;background:#000;">
                    <span style="color:#fff;font-size:0.9em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${token.name}</span>
                    ${isSelected ? '<i class="fas fa-check" style="color:#5cff5c;"></i>' : ''}`;
                row.addEventListener('mouseenter', () => {
                    row.style.background = 'rgba(255,100,0,0.4)';
                });
                row.addEventListener('mouseleave', () => {
                    row.style.background = isSelected ? 'rgba(255,100,0,0.25)' : 'transparent';
                });
                row.addEventListener('click', (e) => {
                    e.stopPropagation();
                    toggleTokenSelection(token);
                    closeStackPopup();
                });
                el.appendChild(row);
            }
            document.body.appendChild(el);
            stackPopupEl = el;
            // Clamp on-screen
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth)
                el.style.left = `${Math.max(0, window.innerWidth - r.width - 4)}px`;
            if (r.bottom > window.innerHeight)
                el.style.top = `${Math.max(0, window.innerHeight - r.height - 4)}px`;
            // Outside-click closes
            stackOutsideHandler = (e) => {
                if (stackPopupEl && !stackPopupEl.contains(/** @type {Node} */ (e.target)))
                    closeStackPopup();
            };
            setTimeout(() => document.addEventListener('pointerdown', stackOutsideHandler, true), 0);
        };

        const clickHandler = (event) => {
            const { x: tx, y: ty } = pointerToWorld(event);
            const tokensHere = allTokens.filter(token => {
                const b = token.bounds;
                return tx >= b.left && tx <= b.right && ty >= b.top && ty <= b.bottom;
            });
            if (tokensHere.length === 0)
                return;
            if (tokensHere.length === 1) {
                toggleTokenSelection(tokensHere[0]);
                return;
            }
            const oe = event?.data?.originalEvent;
            const sx = oe?.clientX ?? 0;
            const sy = oe?.clientY ?? 0;
            showStackPicker(tokensHere, sx + 10, sy + 10);
        };

        // Q/E elevation-offset keys (mirrors placeToken.js).
        const ascendKeys = new Set([
            ...(game.keybindings.get('core', 'zoomIn') ?? []).map(b => b.key),
            'NumpadAdd', 'KeyE',
        ]);
        const descendKeys = new Set([
            ...(game.keybindings.get('core', 'zoomOut') ?? []).map(b => b.key),
            'NumpadSubtract', 'KeyQ',
        ]);

        const refreshCurrentCursor = () => {
            if (isConeMode || isLineMode)
                refreshConeCursor();
            else if (isBlastMode)
                refreshBlastCursor();
        };

        // Q/E shifts elevation on the cursor preview only. Placed areas are frozen at their
        // placement-time offset; the next placement picks up the new value.
        const bumpElevationOffset = (step) => {
            if (!elevationAware)
                return;
            pendingElevationOffset += step;
            refreshCurrentCursor();
        };

        // Ctrl+wheel rotates the cursor preview only (frozen once placed).
        // `step` is ±1 — snaps to the next facing (12 for a cone, 6×length around a line's ring).
        const bumpConeRotation = (step) => {
            const N = rotationModulus;
            pendingRotation = ((pendingRotation + step) % N + N) % N;
            refreshConeCursor();
        };

        const wheelHandler = (event) => {
            if ((!isConeMode && !isLineMode) || !event.ctrlKey)
                return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.deltaY > 0 ? 1 : -1;
            bumpConeRotation(step);
        };

        const keyHandler = (event) => {
            if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                if (stackPopupEl) {
                    closeStackPopup();
                    return;
                }
                doCancel();
                return;
            }
            if (!isBlastMode && !isConeMode && !isLineMode)
                return;
            let step = 0;
            if (ascendKeys.has(event.code))
                step = 1;
            else if (descendKeys.has(event.code))
                step = -1;
            if (step === 0)
                return;
            // Always swallow Q/E in area mode so Foundry's zoom / token-elevation bindings can't fire.
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            bumpElevationOffset(step);
        };

        // Apply pre-selected tokens (capped to count). Skipped in blast mode (no placement to attach them to).
        if (!isBlastMode && preSelected.length > 0) {
            if (preSelected.length > count) {
                ui.notifications.warn(`chooseToken: ${preSelected.length} pre-selected tokens but count is ${count} — only the first ${count} will be used.`);
            }
            for (const t of preSelected.slice(0, count)) {
                if (!selectedTokens.has(t)) {
                    selectedTokens.add(t);
                    drawSelectionHighlight(t);
                }
            }
            refreshCard();
        }

        // Initial card refresh in area modes — binds the global mode-toggle handlers (elevation aware / auto elevation)
        // and syncs their checked/disabled state with the runtime defaults. Without this the user's first toggle click
        // hits an unbound handler and does nothing.
        if (isAreaMode)
            refreshCard();

        const safe = makeSafe('chooseToken', doCancel);
        const isAimed = isConeMode || isLineMode;
        safeMove = safe(isAimed ? coneMoveHandler : isBurstMode ? burstMoveHandler : isBlastMode ? blastMoveHandler : moveHandler);
        safeClick = safe(isAimed ? coneClickHandler : isBurstMode ? burstClickHandler : isBlastMode ? blastClickHandler : clickHandler);
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
        if (isAimed) {
            safeWheel = safe(wheelHandler);
            // Capture phase + non-passive so we can preventDefault before Foundry's canvas zoom listener.
            document.addEventListener('wheel', safeWheel, { capture: true, passive: false });
        }
    }), _title);
}
