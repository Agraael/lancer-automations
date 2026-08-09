/* global canvas, PIXI, game, ui, document, window */

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    getMinGridDistance,
    getInRangeOffsets, isPositionInRange, neighborKeys,
    cubeRound,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";

import {
    _queueCard, _queueCardUrgent, _createInfoCard, _updateInfoCard, _removeInfoCard,
} from "../cards.js";

import {
    pointerToWorld, addGraphicsBelowTokens, addGraphicsAboveTokens, suppressTokenLayerClick, destroyGraphics,
    makeSafe, createCursorPreview, drawRangeHighlight,
    _paintCells, _groupCellsByDistance, _makeRangePulseTick, gridLineWidth, makeText, TG, paintWithHalo, RANGE_GLOW, RANGE_PULSE_STYLE,
    suppressEvent,
} from "../canvas-helpers.js";
import { computeArea } from "../area-geometry.js";
import { keyCodesFor } from "../keybindings.js";
import { broadcastToolPresence, clearToolPresence } from "../presence.js";
import { playUiSound, playTargetingMove } from "../../tah/sound.js";
import { rangePulse, RANGE_PULSE_PRIORITY } from "../range-pulse-manager.js";

/**
 * Prompts the user to select one or more tokens on the canvas.
 * @param {Token} [casterToken] - The token from which to measure range
 * @returns {Promise<Token[]|null>} Array of selected tokens or null if cancelled
 */
export function chooseToken(casterToken, options = {})
{
    const _title = options.title || 'SELECT TARGETS';
    const _queue = options.urgent ? _queueCardUrgent : _queueCard;
    return _queue(() => new Promise((resolve) =>
    {
        const {
            range = null,
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
            allowEmptyConfirm = false,
            autoConfirm = false,
        } = /** @type {any} */ (options);

        const isBlastMode = pattern === 'blast';
        const isBurstMode = pattern === 'burst';
        const isConeMode = pattern === 'cone';
        const isLineMode = pattern === 'line';
        const isAreaMode = isBlastMode || isBurstMode || isConeMode || isLineMode;
        // Cone rotation is an int step count (1 wheel tick = 1 step); 12 steps per turn covers every hex-aligned + off-axis facing.
        const CONE_STEPS_PER_TURN = 12;
        const CONE_STEP_DEG = 360 / CONE_STEPS_PER_TURN;
        // Lateral max = 0.5 * forward, matching Foundry's MeasuredTemplate 53.13° cone.
        const CONE_HALF_SLOPE = 0.5;
        if (isAreaMode && (!areaRange || areaRange < 1))
        {
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
        const selectedTokens = new Set();
        const selectionHighlights = [];

        /** @type {Array<{id:number, center:{x:number,y:number}, graphics:any, candidates:Token[], included:Set<string>, ignoreFilter:boolean, elevation:number, elevationOffset:number, hostToken?:any, rotation?:number, tilt?:number}>} */
        const placements = [];
        let placementSeq = 0;
        // Live offset for cursor preview + the most-recent placement. Frozen on each previously-placed area.
        let pendingElevationOffset = 0;
        // Live rotation for the cone/line preview + the most-recent placement. Frozen on older ones.
        let pendingRotation = 0;
        // Live line tilt (W/S): end-elevation delta. Frozen per placement like rotation.
        let pendingTilt = 0;
        // Cone: 12 angular steps; line: endpoint ring (6×length hex, 8×length sq), a distinct facing per tick, finer than cone.
        const lineRadius = Math.max(1, Math.round(Number(areaRange) || 1));
        const rotationModulus = isLineMode ? (isHexGrid() ? 6 : 8) * lineRadius : CONE_STEPS_PER_TURN;

        // Lancer vertical hex count: max of actor.system.size + doc dims; 0.5 special-cased; else ceil to integer → 1.
        const tokenVerticalSize = (token) =>
        {
            const actorSize = Number(token?.actor?.system?.size ?? 0);
            const docW = Number(token?.document?.width ?? token?.w ?? 0) || 0;
            const docH = Number(token?.document?.height ?? token?.h ?? 0) || 0;
            const raw = Math.max(actorSize, docW, docH, 0);
            if (!raw)
                return 1;
            if (raw <= 0.5)
                return 0.5;
            return Math.max(1, Math.ceil(raw));
        };
        const verticalOverlap = (aBot, aTop, bBot, bTop) => aBot < bTop && bBot < aTop;
        const groundAtCenter = (centerPt) =>
        {
            const terrainAPI = globalThis.terrainHeightTools;
            if (!terrainAPI)
                return 0;
            const offset = pixelToOffset(centerPt.x, centerPt.y);
            return Number(getHexGroundElevation(offset.col, offset.row, terrainAPI)) || 0;
        };
        const resolvePlacementElevation = (placement) =>
            (autoElevation ? groundAtCenter(placement.center) : 0) + (Number(placement?.elevationOffset) || 0);

        // Flood-fill through `affected` from seeds; terrain-dropped (tall) cells wall off the spread (seeds expand regardless).
        const keepConnected = (affected, seedKeys) =>
        {
            const result = new Set();
            const visited = new Set(seedKeys);
            const queue = [...visited];
            for (const seedKey of visited)
            {
                if (affected.has(seedKey))
                    result.add(seedKey);
            }
            while (queue.length)
            {
                for (const neighborKey of neighborKeys(queue.shift()))
                {
                    if (visited.has(neighborKey) || !affected.has(neighborKey))
                        continue;
                    visited.add(neighborKey);
                    result.add(neighborKey);
                    queue.push(neighborKey);
                }
            }
            return result;
        };

        // Gate keepConnected on the runtime toggles; seeds default to the area's origin cell.
        const propagate = (affected, seeds) =>
            (elevationAware && propagation) ? keepConnected(affected, seeds) : affected;
        const originSeed = (pt) =>
        {
            const offset = pixelToOffset(pt.x, pt.y);
            return [`${offset.col},${offset.row}`];
        };

        if (range !== null && casterToken)
        {
            rangePulse.set('interactive:chooseToken', {
                priority: RANGE_PULSE_PRIORITY.INTERACTIVE,
                build: () =>
                {
                    const rangeHighlight = drawRangeHighlight(casterToken, range, RANGE_PULSE_STYLE.baseColor, RANGE_PULSE_STYLE.staticFillAlpha, includeSelf, { glowColor: RANGE_GLOW.manual });
                    const pulseGraphic = new PIXI.Graphics();
                    addGraphicsBelowTokens(pulseGraphic);
                    const hexesByDist = _groupCellsByDistance(
                        getOccupiedOffsets(casterToken),
                        getInRangeOffsets(casterToken, range, { includeSelf: true })
                    );
                    const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range, { originToken: casterToken });
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

        const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();

        const hoverPulseGraphic = new PIXI.Graphics();
        canvas.stage.addChild(hoverPulseGraphic).eventMode = 'none';
        let hoverPulseToken = null;
        const footprintPath = (target, token) =>
        {
            if (isHexGrid())
            {
                for (const offset of getOccupiedOffsets(token))
                    drawHexAt(target, offset.col, offset.row);
            }
            else
                target.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
        };
        const caughtFootprints = (target, caught) =>
        {
            for (const token of caught)
            {
                if (!filter || filter(token))
                    footprintPath(target, token);
            }
        };

        const hoverPulseTick = () =>
        {
            hoverPulseGraphic.clear();
            if (!hoverPulseToken)
                return;
            const alpha = 0.35 + 0.55 * Math.abs(Math.sin(performance.now() / 220));
            paintWithHalo(hoverPulseGraphic, target => footprintPath(target, hoverPulseToken),
                { color: TG.inRange, lineWidth: 4, lineAlpha: alpha, fillAlpha: alpha * 0.25 });
        };
        canvas.app.ticker.add(hoverPulseTick);

        // repaint at the token's current cells each tick so the mark follows it
        const paintSelectionHighlight = (token, highlight) =>
        {
            highlight.clear();
            paintWithHalo(highlight, target => footprintPath(target, token),
                { color: TG.placed, lineWidth: 4, lineAlpha: 0.85, fillAlpha: 0.22 });
        };

        // Pulse the alpha of placed area graphics so the yellow highlight breathes.
        const areaPulseTick = () =>
        {
            if (placements.length === 0 && selectionHighlights.length === 0)
                return;
            const alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
            for (const placement of placements)
            {
                if (placement.graphics)
                {
                    placement.graphics.alpha = alpha;
                    if (placement.graphics.labelLayer)
                        placement.graphics.labelLayer.alpha = alpha;
                }
            }
            for (const entry of selectionHighlights)
            {
                if (!entry.graphics)
                    continue;
                entry.graphics.alpha = alpha;
                const token = canvas.tokens.get(entry.tokenId);
                if (token)
                    paintSelectionHighlight(token, entry.graphics);
            }
        };
        canvas.app.ticker.add(areaPulseTick);
        const setHoverPulseTokenId = (tokenId) =>
        {
            hoverPulseToken = tokenId ? (canvas.tokens.get(tokenId) ?? null) : null;
        };

        const cursorElevLabel = makeText('', {
            fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, stroke: 0x000000, strokeThickness: gridLineWidth(4), fontWeight: 'bold', align: 'center',
        });
        cursorElevLabel.anchor.set(0.5);
        cursorElevLabel.visible = false;
        canvas.stage.addChild(cursorElevLabel).eventMode = 'none';
        // live per-cell elevation numbers (tilted lines)
        const cellLabelLayer = new PIXI.Container();
        canvas.stage.addChild(cellLabelLayer).eventMode = 'none';
        const clearCellLabels = () =>
        {
            for (const child of cellLabelLayer.removeChildren())
                child.destroy();
        };

        const previewSelectHighlight = new PIXI.Graphics();
        canvas.stage.addChild(previewSelectHighlight).eventMode = 'none';

        const selectionIds = selection ? new Set(selection.map(token => token.id)) : null;
        const selectionHighlightGraphics = [];
        if (selection)
        {
            for (const token of selection)
            {
                const highlight = new PIXI.Graphics();
                paintWithHalo(highlight, target =>
                {
                    for (const offset of getOccupiedOffsets(token))
                    {
                        if (isHexGrid())
                            drawHexAt(target, offset.col, offset.row);
                        else
                        {
                            const cellCenter = getHexCenter(offset.col, offset.row);
                            target.drawRect(cellCenter.x - canvas.grid.size / 2, cellCenter.y - canvas.grid.size / 2, canvas.grid.size, canvas.grid.size);
                        }
                    }
                }, { color: TG.selected, lineWidth: 4, lineAlpha: 0.8, fillAlpha: 0.2 });
                canvas.stage.addChild(highlight).eventMode = 'none';
                selectionHighlightGraphics.push(highlight);
            }
        }

        const baseTokens = canvas.tokens.placeables.filter(token =>
        {
            if (!includeSelf && token.id === casterToken?.id)
                return false;
            if (token.document.hidden && !game.user.isGM) // hidden tokens: GM-only
                return false;
            if (!soft && filter && !filter(token))
                return false;
            return true;
        });
        const getActiveTokens = () =>
        {
            if (selectionOnly && selectionIds)
                return baseTokens.filter(token => selectionIds.has(token.id));
            return baseTokens;
        };
        let allTokens = getActiveTokens();

        const prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        const restoreLayerClick = suppressTokenLayerClick();

        let safeMove, safeClick, safeAbort, safeKey, safeWheel;
        const doCleanup = () =>
        {
            clearToolPresence('chooseToken');
            disposeCursorPreview();
            canvas.app.ticker.remove(hoverPulseTick);
            canvas.app.ticker.remove(areaPulseTick);
            destroyGraphics(hoverPulseGraphic);
            destroyGraphics(cursorElevLabel);
            clearCellLabels();
            destroyGraphics(cellLabelLayer);
            destroyGraphics(previewSelectHighlight);
            rangePulse.clear('interactive:chooseToken');
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
            selectionHighlightGraphics.forEach(destroyGraphics);
            selectionHighlights.forEach(entry => destroyGraphics(entry.graphics));
            for (const placement of placements)
                destroyGraphics(placement.graphics);
            placements.length = 0;

            canvas.tokens.interactiveChildren = prevInteractive;
            restoreLayerClick();
            _removeInfoCard(cardEl);
            closeStackPopup();
        };

        const doConfirm = () =>
        {
            doCleanup();
            if (selectedTokens.size > 0)
                resolve(Array.from(selectedTokens));
            else
                resolve(allowEmptyConfirm ? [] : null);
        };

        const doCancel = () =>
        {
            doCleanup();
            resolve(null);
        };

        const computeWarnings = (token) =>
        {
            const msgs = [];
            if (!isAreaMode && range !== null && casterToken && !isPositionInRange(casterToken, token, range))
            {
                const dist = getMinGridDistance(casterToken, token);
                msgs.push(`Out of range (${dist} > ${range})`);
            }
            if (filter && !filter(token))
                msgs.push(filterWarning ?? 'Invalid target');
            return msgs;
        };

        // Recompute selectedTokens (union of per-placement included) + redraw selection highlights.
        const recomputeBlastSelection = () =>
        {
            selectionHighlights.splice(0).forEach(entry => destroyGraphics(entry.graphics));
            selectedTokens.clear();
            for (const placement of placements)
            {
                for (const id of placement.included)
                {
                    const token = canvas.tokens.get(id);
                    if (token)
                        selectedTokens.add(token);
                }
            }
            for (const token of selectedTokens)
                drawSelectionHighlight(token);
        };

        const enforceCountCap = () =>
        {
            if (count === -1)
                return;
            let total = 0;
            for (const placement of placements)
                total += placement.included.size;
            if (total <= count)
                return;
            for (let i = placements.length - 1; i >= 0 && total > count; i--)
            {
                const placement = placements[i];
                const ids = Array.from(placement.included);
                for (const id of ids)
                {
                    if (total <= count)
                        break;
                    placement.included.delete(id);
                    total--;
                }
            }
        };

        // True when terrain at this cell rises to/above `top`, so the area can't occupy it.
        const terrainBlocks = (col, row, top) =>
        {
            if (!elevationAware)
                return false;
            const terrainAPI = globalThis.terrainHeightTools;
            const ground = terrainAPI ? (Number(getHexGroundElevation(col, row, terrainAPI)) || 0) : 0;
            return ground >= top;
        };
        // Drop cells the area can't reach vertically (terrain flush with / above its top).
        const trimByTerrain = (affected, top) =>
        {
            if (!elevationAware)
                return affected;
            const out = new Set();
            for (const key of affected)
            {
                const [col, row] = key.split(',').map(Number);
                if (!terrainBlocks(col, row, top))
                    out.add(key);
            }
            return out;
        };
        // Tokens whose footprint hits `affected` and whose height span overlaps [lo, hi].
        const catchTokens = (affected, lo, hi, skipId = null) =>
        {
            const caught = [];
            for (const token of canvas.tokens.placeables)
            {
                if (skipId && token.id === skipId)
                    continue;
                if (token.document.hidden && !game.user.isGM) // hidden tokens: GM-only
                    continue;
                if (!includeSelf && casterToken && token.id === casterToken.id)
                    continue;
                if (!getOccupiedOffsets(token).some(offset => affected.has(`${offset.col},${offset.row}`)))
                    continue;
                if (elevationAware)
                {
                    const tokenElev = Number(token.document?.elevation) || 0;
                    if (!verticalOverlap(lo, hi, tokenElev, tokenElev + tokenVerticalSize(token)))
                        continue;
                }
                caught.push(token);
            }
            return caught;
        };

        // Shared geometry (area-geometry.js). ctx carries the runtime toggles + token filters.
        const aoeCtx = () => ({ elevationAware, propagation, includeHidden: game.user.isGM, includeSelf, casterToken });
        const tokensInBlast = (centerPt, radius, areaElev = 0) =>
            computeArea({ pattern: 'blast', centerPt, areaRange: radius, areaElev }, aoeCtx());

        // Burst: centered on a HOST token, symmetric [tokenElev - radius, tokenElev + radius].
        const tokensInBurst = (hostToken, radius) =>
            computeArea({ pattern: 'burst', hostToken, areaRange: radius }, aoeCtx());

        // Hex cone (matches Foundry MeasuredTemplate): forward > 0, cubeDist <= range, |lateral| <= 0.5*forward; square = 60° wedge.
        const tokensInCone = (centerPt, radius, areaElev, rotation) =>
        {
            const areaTop = areaElev + radius;
            let affected = new Set();

            if (isHexGrid())
            {
                /** @type {any} */
                const grid = canvas.grid;
                const srcOff = pixelToOffset(centerPt.x, centerPt.y);
                const cursorCube = grid.getCube({ i: srcOff.row, j: srcOff.col });
                const dirDeg = (Number(rotation) || 0) * CONE_STEP_DEG;

                // Off-axis (aim not a multiple of 60°): first cone cell sits at distance 2, so add 1 to effRadius.
                const offAxis = (((dirDeg % 60) + 60) % 60) > 1e-9;
                const effRadius = offAxis ? radius + 1 : radius;

                const angleRad = dirDeg * Math.PI / 180;
                const forwardX = Math.cos(angleRad), forwardY = Math.sin(angleRad);
                const lateralX = -Math.sin(angleRad), lateralY = Math.cos(angleRad);
                const searchRadius = Math.ceil(effRadius) + 1;

                // Cone offsets relative to origin (0,0,0).
                const coneOffsets = [];
                for (let q = -searchRadius; q <= searchRadius; q++)
                {
                    for (let r = -searchRadius; r <= searchRadius; r++)
                    {
                        const s = -q - r;
                        if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > searchRadius)
                            continue;
                        const x = q + 0.5 * r;
                        const y = (Math.sqrt(3) / 2) * r;
                        const forward = x * forwardX + y * forwardY;
                        const lateral = x * lateralX + y * lateralY;
                        const cubeDist = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
                        if (forward <= 1e-9 || cubeDist > effRadius + 1e-9)
                            continue;
                        if (Math.abs(lateral) > CONE_HALF_SLOPE * forward + 1e-9)
                            continue;
                        coneOffsets.push({ q, r, s, cubeDist, forward });
                    }
                }

                if (coneOffsets.length)
                {
                    // Nearest cell (tie-break: most forward) is the one that lands on the cursor.
                    let nearest = coneOffsets[0];
                    for (const coneOffset of coneOffsets)
                    {
                        if (coneOffset.cubeDist < nearest.cubeDist || (coneOffset.cubeDist === nearest.cubeDist && coneOffset.forward > nearest.forward))
                            nearest = coneOffset;
                    }
                    // Shift the whole cone so `nearest` sits on the cursor cell.
                    for (const coneOffset of coneOffsets)
                    {
                        const cellOffset = grid.getOffset({
                            q: cursorCube.q + (coneOffset.q - nearest.q),
                            r: cursorCube.r + (coneOffset.r - nearest.r),
                            s: cursorCube.s + (coneOffset.s - nearest.s),
                        });
                        const cellCol = cellOffset.j, cellRow = cellOffset.i;
                        if (terrainBlocks(cellCol, cellRow, areaTop))
                            continue;
                        affected.add(`${cellCol},${cellRow}`);
                    }
                }
            }
            else
            {
                // Square grid: 60° angular wedge with discrete 30° snap rotation.
                const TAU = 2 * Math.PI;
                const HALF_ANGLE = Math.PI / 6;
                const rotRad = (Number(rotation) || 0) * (CONE_STEP_DEG * Math.PI / 180);
                const raw = elevationAware
                    ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: false, elevationAware: true })
                    : getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, radius, { includeSelf: false, elevationAware: false });
                for (const key of raw)
                {
                    const [col, row] = key.split(',').map(Number);
                    if (terrainBlocks(col, row, areaTop))
                        continue;
                    const cellCenter = getHexCenter(col, row);
                    const ang = Math.atan2(cellCenter.y - centerPt.y, cellCenter.x - centerPt.x);
                    let d = (ang - rotRad) % TAU;
                    if (d > Math.PI)
                        d -= TAU;
                    else if (d < -Math.PI)
                        d += TAU;
                    if (Math.abs(d) > HALF_ANGLE)
                        continue;
                    affected.add(key);
                }
            }

            affected = propagate(affected, originSeed(centerPt));
            return { caught: catchTokens(affected, areaElev, areaTop), affected };
        };

        // Hex line drawing (Red Blob Games): cube lerp + cube_round → a clean 1-wide path.
        const cubeDistance = (fromCube, toCube) => (Math.abs(fromCube.q - toCube.q) + Math.abs(fromCube.r - toCube.r) + Math.abs(fromCube.s - toCube.s)) / 2;
        const cubeLineDraw = (fromCube, toCube) =>
        {
            const steps = Math.max(1, cubeDistance(fromCube, toCube));
            const out = [];
            for (let stepIndex = 0; stepIndex <= steps; stepIndex++)
            {
                const frac = stepIndex / steps;
                // epsilon nudge keeps samples off cell boundaries so rounding stays consistent
                out.push(cubeRound(
                    fromCube.q + (toCube.q - fromCube.q) * frac + 1e-6,
                    fromCube.r + (toCube.r - fromCube.r) * frac + 2e-6,
                    fromCube.s + (toCube.s - fromCube.s) * frac - 3e-6,
                ));
            }
            return out;
        };
        const LINE_CUBE_DIRS = [
            { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
            { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
        ];
        const cubeRing = (center, radius) =>
        {
            if (radius <= 0)
                return [{ ...center }];
            const out = [];
            let hex = {
                q: center.q + LINE_CUBE_DIRS[4].q * radius,
                r: center.r + LINE_CUBE_DIRS[4].r * radius,
                s: center.s + LINE_CUBE_DIRS[4].s * radius,
            };
            for (let i = 0; i < 6; i++)
            {
                for (let j = 0; j < radius; j++)
                {
                    out.push(hex);
                    hex = { q: hex.q + LINE_CUBE_DIRS[i].q, r: hex.r + LINE_CUBE_DIRS[i].r, s: hex.s + LINE_CUBE_DIRS[i].s };
                }
            }
            return out;
        };
        const squareRing = (origin, radius) =>
        {
            const out = [];
            for (let dc = -radius; dc < radius; dc++)
                out.push({ col: origin.col + dc, row: origin.row - radius });
            for (let dr = -radius; dr < radius; dr++)
                out.push({ col: origin.col + radius, row: origin.row + dr });
            for (let dc = radius; dc > -radius; dc--)
                out.push({ col: origin.col + dc, row: origin.row + radius });
            for (let dr = radius; dr > -radius; dr--)
                out.push({ col: origin.col - radius, row: origin.row + dr });
            return out;
        };
        const bresenham = (x0, y0, x1, y1) =>
        {
            const pts = [];
            const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
            const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
            let err = dx - dy, x = x0, y = y0;
            for (;;)
            {
                pts.push({ col: x, row: y });
                if (x === x1 && y === y1)
                    break;
                const e2 = 2 * err;
                if (e2 > -dy)
                {
                    err -= dy; x += sx;
                }
                if (e2 < dx)
                {
                    err += dx; y += sy;
                }
            }
            return pts;
        };
        // Whole-cell perpendicular offsets for width-n (1→[0], 2→[0,1], 3→[-1,0,1]); half-cell offsets don't round reliably.
        const widthOffsets = (width) =>
        {
            const lo = -Math.floor((width - 1) / 2);
            return Array.from({ length: width }, (_, i) => lo + i);
        };

        // Endpoint candidates around the origin at `radius` cells: one per rotation tick.
        const lineRing = (originOff, radius) =>
        {
            if (isHexGrid())
            {
                /** @type {any} */
                const grid = canvas.grid;
                const originCube = grid.getCube({ i: originOff.row, j: originOff.col });
                return cubeRing(originCube, radius).map(cube =>
                {
                    const cellOffset = grid.getOffset(cube); return { col: cellOffset.j, row: cellOffset.i };
                });
            }
            return squareRing(originOff, radius);
        };

        // "col,row" keys for a clean line A→B, widened to `size` cells perpendicular.
        const lineCells = (fromOffset, toOffset, size) =>
        {
            /** @type {any} */
            const grid = canvas.grid;
            const out = new Set();
            const fromPx = getHexCenter(fromOffset.col, fromOffset.row);
            const toPx = getHexCenter(toOffset.col, toOffset.row);
            const dirX = toPx.x - fromPx.x, dirY = toPx.y - fromPx.y;
            const dirLen = Math.hypot(dirX, dirY) || 1;
            const perpX = -dirY / dirLen, perpY = dirX / dirLen;
            const pitch = grid.size;
            for (const widthStep of widthOffsets(Math.max(1, Math.round(size))))
            {
                const fromShifted = pixelToOffset(fromPx.x + perpX * widthStep * pitch, fromPx.y + perpY * widthStep * pitch);
                const toShifted = pixelToOffset(toPx.x + perpX * widthStep * pitch, toPx.y + perpY * widthStep * pitch);
                if (isHexGrid())
                {
                    const fromCube = grid.getCube({ i: fromShifted.row, j: fromShifted.col });
                    const toCube = grid.getCube({ i: toShifted.row, j: toShifted.col });
                    for (const cube of cubeLineDraw(fromCube, toCube))
                    {
                        const cellOffset = grid.getOffset(cube); out.add(`${cellOffset.j},${cellOffset.i}`);
                    }
                }
                else
                {
                    for (const point of bresenham(fromShifted.col, fromShifted.row, toShifted.col, toShifted.row))
                        out.add(`${point.col},${point.row}`);
                }
            }
            return out;
        };

        // `size` is both the line's perpendicular width and (with elevationAware) its vertical height.
        const tokensInLine = (centerPt, length, areaElev, rotation, size) =>
        {
            const areaTop = areaElev + size;
            let affected = new Set();

            const radius = Math.max(1, Math.round(length));
            const srcOff = pixelToOffset(centerPt.x, centerPt.y);
            const ring = lineRing(srcOff, radius);
            const endOff = ring[((Math.round(rotation) % ring.length) + ring.length) % ring.length];
            for (const key of lineCells(srcOff, endOff, size))
            {
                const [col, row] = key.split(',').map(Number);
                if (!terrainBlocks(col, row, areaTop))
                    affected.add(key);
            }

            affected = propagate(affected, originSeed(centerPt));
            return { caught: catchTokens(affected, areaElev, areaTop), affected };
        };

        // caught/affected for a placement. tilt only matters for line; frozen placements pass theirs.
        const computeAreaFor = (center, elevation, rotation, tilt = pendingTilt) => computeArea({
            pattern: isLineMode ? 'line' : isConeMode ? 'cone' : 'blast',
            centerPt: center,
            areaRange,
            size,
            rotation,
            areaElev: elevation,
            tilt,
        }, aoeCtx());

        // One elevation: ↑ positive / ↓ negative / ↕ for 0.
        const elevArrow = (elevation) =>
        {
            const value = Math.round(Number(elevation) || 0);
            return value > 0 ? `↑ ${value}` : value < 0 ? `↓ ${-value}` : `↕ 0`;
        };
        // Center elevation arrow + ±areaRange band suffix (blast/cone/burst reach).
        const bandStr = (elevation) =>
        {
            const arrow = elevArrow(elevation);
            const extent = Math.round(areaRange);
            return extent > 0 ? `${arrow}  ±${extent}` : arrow;
        };
        const makeElevationLabel = (elev, center, gridSize) =>
        {
            const label = makeText(elevArrow(elev), {
                fontFamily: 'Arial',
                fontSize: Math.max(14, gridSize * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: gridLineWidth(4),
                fontWeight: 'bold',
            });
            label.anchor.set(0.5);
            label.x = center.x;
            label.y = center.y;
            return label;
        };
        // Single centered arrow + ±extent band (blast/cone/burst), matching the cursor's bandStr.
        const makeBandLabel = (elevation, center) =>
        {
            const label = makeText(bandStr(elevation), {
                fontFamily: 'Arial',
                fontSize: Math.max(14, canvas.grid.size * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: gridLineWidth(4),
                fontWeight: 'bold',
                align: 'center',
            });
            label.anchor.set(0.5);
            label.x = center.x;
            label.y = center.y;
            return label;
        };
        // Arrow label on one cell (tilted line).
        const makeCellNumber = (elevation, col, row) =>
        {
            const cellCenter = getHexCenter(col, row);
            const label = makeText(elevArrow(elevation), {
                fontFamily: 'Arial',
                fontSize: Math.max(11, canvas.grid.size * 0.18),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: gridLineWidth(3),
                fontWeight: 'bold',
            });
            label.anchor.set(0.5);
            label.x = cellCenter.x;
            label.y = cellCenter.y;
            return label;
        };
        // A line is "tilted" only when its cells span more than one elevation.
        const cellsAreTilted = (elevByCell) =>
        {
            if (!elevByCell)
                return false;
            const elevations = [...elevByCell.values()];
            return elevations.some(elevation => elevation !== elevations[0]);
        };

        const drawBlastHighlight = (affected, { color = TG.placed, fillAlpha = 0.22, lineAlpha = 0.7, elevation = null, center = null, elevByCell = null } = {}) =>
        {
            const container = new PIXI.Container();
            const gfx = new PIXI.Graphics();
            paintWithHalo(gfx, target => _paintCells(target, affected), { color, lineWidth: 2, lineAlpha, fillAlpha });
            container.addChild(gfx);
            const labelLayer = new PIXI.Container();
            if (elevationAware && cellsAreTilted(elevByCell))
            {
                for (const [key, cellElev] of elevByCell)
                {
                    const [col, row] = key.split(',').map(Number);
                    labelLayer.addChild(makeCellNumber(cellElev, col, row));
                }
            }
            else if (elevationAware && center)
            {
                labelLayer.addChild(elevByCell
                    ? makeElevationLabel(elevation, center, canvas.grid.size)
                    : makeBandLabel(elevation, center));
            }
            addGraphicsBelowTokens(container);
            if (labelLayer.children.length)
            {
                addGraphicsAboveTokens(labelLayer);
                container.labelLayer = labelLayer;
            }
            else
                labelLayer.destroy();
            return container;
        };

        const placeBlast = (worldX, worldY) =>
        {
            const off = pixelToOffset(worldX, worldY);
            const centerPt = getHexCenter(off.col, off.row);
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range))
            {
                if (!soft)
                {
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
                affectedKeys: [...affected],
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation,
                elevationOffset,
            };
            for (const token of caught)
            {
                if (!filter || filter(token))
                    placement.included.add(token.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const placeBurst = (hostToken) =>
        {
            if (!hostToken)
                return;
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, hostToken, range))
            {
                if (!soft)
                {
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
                affectedKeys: [...affected],
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation: hostElev,
                elevationOffset: 0,
            };
            for (const token of caught)
            {
                if (!filter || filter(token))
                    placement.included.add(token.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const placeCone = (worldX, worldY) =>
        {
            const off = pixelToOffset(worldX, worldY);
            const centerPt = getHexCenter(off.col, off.row);
            if (range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range))
            {
                if (!soft)
                {
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
            const tilt = pendingTilt;
            const { caught, affected, elevByCell } = computeAreaFor(center, elevation, rotation, tilt);
            const placement = {
                id: ++placementSeq,
                center,
                graphics: drawBlastHighlight(affected, { elevation, center, elevByCell }),
                affectedKeys: [...affected],
                candidates: caught,
                included: new Set(),
                ignoreFilter: false,
                elevation,
                elevationOffset,
                rotation,
                tilt,
            };
            for (const token of caught)
            {
                if (!filter || filter(token))
                    placement.included.add(token.id);
            }
            placements.push(placement);
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        // Re-derive every placement from scratch (used when toggles change or Q/E is pressed).
        const recomputeAllPlacements = () =>
        {
            for (const placement of placements)
            {
                let caught, affected, elevByCell;
                if (placement.hostToken)
                {
                    placement.elevation = Number(placement.hostToken.document?.elevation) || 0;
                    ({ caught, affected } = tokensInBurst(placement.hostToken, areaRange));
                }
                else
                {
                    placement.elevation = resolvePlacementElevation(placement);
                    ({ caught, affected, elevByCell } = computeAreaFor(placement.center, placement.elevation, placement.rotation, placement.tilt));
                }
                destroyGraphics(placement.graphics);
                placement.graphics = drawBlastHighlight(affected, { elevation: placement.elevation, center: placement.center, elevByCell });
                placement.affectedKeys = [...affected];
                const oldIncluded = placement.included;
                placement.candidates = caught;
                // Preserve manual inclusions for tokens still in candidates; default-include new ones that pass filter.
                placement.included = new Set();
                for (const token of caught)
                {
                    if (oldIncluded.has(token.id))
                        placement.included.add(token.id);
                    else if (!filter || filter(token) || placement.ignoreFilter)
                        placement.included.add(token.id);
                }
            }
            enforceCountCap();
            recomputeBlastSelection();
            refreshCard();
        };

        const removeBlast = (placementId) =>
        {
            const idx = placements.findIndex(placement => placement.id === placementId);
            if (idx === -1)
                return;
            destroyGraphics(placements[idx].graphics);
            placements.splice(idx, 1);
            recomputeBlastSelection();
            refreshCard();
        };

        const toggleAreaToken = (placementId, tokenId) =>
        {
            const placement = placements.find(candidate => candidate.id === placementId);
            if (!placement)
                return;
            if (placement.included.has(tokenId))
            {
                placement.included.delete(tokenId);
                recomputeBlastSelection();
                refreshCard();
                return;
            }
            const projected = new Set();
            for (const otherPlacement of placements)
            {
                for (const id of otherPlacement.included)
                    projected.add(id);
            }
            projected.add(tokenId);
            if (count !== -1 && projected.size > count)
            {
                ui.notifications.warn(`Maximum of ${count} target(s) already selected.`);
                return;
            }
            placement.included.add(tokenId);
            recomputeBlastSelection();
            refreshCard();
        };

        const toggleAreaFilter = (placementId) =>
        {
            const placement = placements.find(candidate => candidate.id === placementId);
            if (!placement)
                return;
            placement.ignoreFilter = !placement.ignoreFilter;
            refreshCard();
        };

        const blastPlacementData = () => placements.map((placement, idx) =>
        {
            const candidates = placement.candidates.map(candidateToken =>
            {
                const filterPass = !filter || filter(candidateToken);
                return {
                    id: candidateToken.id,
                    name: candidateToken.name,
                    img: candidateToken.document.texture.src,
                    included: placement.included.has(candidateToken.id),
                    filtered: !filterPass,
                    eligible: filterPass || placement.ignoreFilter,
                };
            });
            const hasFiltered = !!filter && candidates.some(candidate => candidate.filtered);
            const centerOutOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, placement.center, range);
            return {
                id: placement.id,
                index: idx,
                label: `Area ${idx + 1}`,
                count: placement.included.size,
                ignoreFilter: placement.ignoreFilter,
                hasFilter: !!filter,
                hasFiltered,
                centerOutOfRange,
                elevation: Number(placement.elevation) || 0,
                elevationOffset: Number(placement.elevationOffset) || 0,
                candidates,
            };
        });

        const refreshCard = () =>
        {
            const warnings = {};
            for (const token of selectedTokens)
            {
                const msgs = computeWarnings(token);
                if (msgs.length > 0)
                    warnings[token.id] = msgs;
            }
            _updateInfoCard(cardEl, "chooseToken", {
                selectedTokens,
                warnings,
                pattern,
                placements: isAreaMode ? blastPlacementData() : null,
                areaCount: effectiveAreaCount,
                onDeselect: (tokenId) =>
                {
                    if (isBlastMode)
                    {
                        let changed = false;
                        for (const placement of placements)
                        {
                            if (placement.included.delete(tokenId))
                                changed = true;
                        }
                        if (changed)
                        {
                            recomputeBlastSelection();
                            refreshCard();
                        }
                        return;
                    }
                    const token = allTokens.find(candidate => candidate.id === tokenId);
                    if (token && selectedTokens.has(token))
                    {
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
                onToggleElevationAware: () =>
                {
                    elevationAware = !elevationAware;
                    recomputeAllPlacements();
                },
                onToggleAutoElevation: () =>
                {
                    autoElevation = !autoElevation;
                    recomputeAllPlacements();
                },
                propagation,
                onTogglePropagation: () =>
                {
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

        if (selection)
        {
            cardEl.find('[data-role="selection-toggle"]').on('change', function ()
            {
                selectionOnly = /** @type {HTMLInputElement} */ (this).checked;
                allTokens = getActiveTokens();
            });
        }

        const drawSelectionHighlight = (token) =>
        {
            const highlight = new PIXI.Graphics();
            paintSelectionHighlight(token, highlight);
            canvas.stage.addChild(highlight).eventMode = 'none';
            selectionHighlights.push({ tokenId: token.id, graphics: highlight });
        };

        const removeSelectionHighlight = (token) =>
        {
            const idx = selectionHighlights.findIndex(entry => entry.tokenId === token.id);
            if (idx !== -1)
            {
                destroyGraphics(selectionHighlights[idx].graphics);
                selectionHighlights.splice(idx, 1);
            }
        };

        const drawCursorHighlight = (tx, ty) =>
        {
            cursorPreview.clear();

            // Check for a token under cursor first: supports tokens partially overlapping the range
            let hoveredToken = allTokens.find(token =>
            {
                const bounds = token.bounds;
                if (tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom)
                {
                    if (!soft && range !== null && casterToken)
                        return isPositionInRange(casterToken, token, range);
                    return true;
                }
                return false;
            }) || null;

            const cursorCell = pixelToOffset(tx, ty);
            const rangeTarget = hoveredToken ?? getHexCenter(cursorCell.col, cursorCell.row);
            const outOfRange = range !== null && casterToken && !isPositionInRange(casterToken, rangeTarget, range);
            const color = outOfRange ? TG.outOfRange : (hoveredToken ? TG.target : TG.inRange);
            const gridSize = canvas.grid.size;

            paintWithHalo(cursorPreview, target =>
            {
                if (hoveredToken)
                {
                    if (isHexGrid())
                    {
                        for (const offset of getOccupiedOffsets(hoveredToken))
                            drawHexAt(target, offset.col, offset.row);
                    }
                    else
                        target.drawRect(hoveredToken.document.x, hoveredToken.document.y, hoveredToken.document.width * gridSize, hoveredToken.document.height * gridSize);
                }
                else if (isHexGrid())
                    drawHexAt(target, cursorCell.col, cursorCell.row);
                else
                {
                    const center = getHexCenter(cursorCell.col, cursorCell.row);
                    target.drawRect(center.x - gridSize / 2, center.y - gridSize / 2, gridSize, gridSize);
                }
            }, { color, lineWidth: hoveredToken ? 4 : 2, lineAlpha: 0.8, fillAlpha: hoveredToken ? 0.2 : 0.4 });
            const selectedCells = [];
            for (const token of selectedTokens)
            {
                for (const offset of getOccupiedOffsets(token))
                    selectedCells.push(`${offset.col},${offset.row}`);
            }
            broadcastToolPresence('chooseToken', {
                tokens: hoveredToken ? [hoveredToken.id] : [],
                cells: hoveredToken ? [] : [`${cursorCell.col},${cursorCell.row}`],
                placedCells: selectedCells,
                relatedToken: casterToken,
            });
        };

        const moveHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawCursorHighlight(tx, ty);
        };

        // Presence: placed shapes' cells + their elevation labels, read from the rendered graphics.
        const placedPresenceCells = () => placements.flatMap(placement => placement.affectedKeys ?? []);
        const placedPresenceLabels = () =>
        {
            const out = [];
            for (const placement of placements)
            {
                for (const child of placement.graphics?.labelLayer?.children ?? [])
                {
                    if (child instanceof PIXI.Text)
                        out.push({ x: child.x, y: child.y, text: child.text });
                }
            }
            return out;
        };
        // Live cursor's elevation labels (band / per-cell), read after they are set.
        const livePresenceLabels = () =>
        {
            const out = [];
            if (cursorElevLabel.visible)
                out.push({ x: cursorElevLabel.x, y: cursorElevLabel.y, text: cursorElevLabel.text });
            for (const child of cellLabelLayer.children)
                out.push({ x: child.x, y: child.y, text: child.text });
            return out;
        };
        const broadcastChoose = (cells, tokens) => broadcastToolPresence('chooseToken', {
            cells,
            tokens,
            placedCells: placedPresenceCells(),
            labels: [...placedPresenceLabels(), ...livePresenceLabels()],
            relatedToken: casterToken,
        });

        const drawBlastCursor = (tx, ty) =>
        {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            const off = pixelToOffset(tx, ty);
            const centerPt = getHexCenter(off.col, off.row);
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range);
            const color = outOfRange ? TG.outOfRange : TG.inRange;
            let affected, previewElev = null;
            if (elevationAware)
            {
                previewElev = (autoElevation ? groundAtCenter({ x: centerPt.x, y: centerPt.y }) : 0) + pendingElevationOffset;
                affected = getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: previewElev }, areaRange, { includeSelf: true, elevationAware: true });
                affected = trimByTerrain(affected, previewElev + areaRange);
            }
            else
                affected = getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, areaRange, { includeSelf: true, elevationAware: false });
            affected = propagate(affected, [`${off.col},${off.row}`]);
            paintWithHalo(cursorPreview, target => _paintCells(target, affected), { color, lineWidth: 2, lineAlpha: 0.6, fillAlpha: 0.12 });

            // Cyan outline on tokens that would be caught (mirrors point-mode selection visual).
            const { caught: previewCaught } = tokensInBlast({ x: centerPt.x, y: centerPt.y }, areaRange, previewElev || 0);
            paintWithHalo(previewSelectHighlight, target => caughtFootprints(target, previewCaught), { color: TG.target, lineWidth: 4, lineAlpha: 0.8, fillAlpha: 0.2 });
            if (elevationAware)
            {
                cursorElevLabel.text = bandStr(previewElev);
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = centerPt.x;
                cursorElevLabel.y = centerPt.y;
                cursorElevLabel.visible = true;
            }
            else
                cursorElevLabel.visible = false;
            broadcastChoose([...affected], previewCaught.map(token => token.id));
        };

        let lastBlastCursor = null;
        const blastMoveHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            lastBlastCursor = { x: tx, y: ty };
            drawBlastCursor(tx, ty);
        };
        const refreshBlastCursor = () =>
        {
            if (lastBlastCursor)
                drawBlastCursor(lastBlastCursor.x, lastBlastCursor.y);
        };

        const blastClickHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            placeBlast(tx, ty);
        };

        // Burst cursor: when over a token, preview burst centered on that token; else show a small marker.
        const tokenUnderCursor = (tx, ty) => canvas.tokens.placeables.find(token =>
        {
            if (token.document.hidden && !game.user.isGM) // hidden tokens: GM-only
                return false;
            if (!includeSelf && casterToken && token.id === casterToken.id)
                return false;
            const bounds = token.bounds;
            return tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom;
        }) || null;

        const drawBurstCursor = (tx, ty) =>
        {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            const hovered = tokenUnderCursor(tx, ty);
            if (!hovered)
            {
                // Small ring at cursor: distinct from point-mode hex highlight, but visible enough.
                paintWithHalo(cursorPreview, target => target.drawCircle(tx, ty, Math.max(6, canvas.grid.size * 0.12)),
                    { color: TG.noHost, lineWidth: 2, lineAlpha: 0.85, fillAlpha: 0.25 });
                cursorElevLabel.visible = false;
                broadcastChoose([], []);
                return;
            }
            const tokenElev = Number(hovered.document?.elevation) || 0;
            const burstTop = tokenElev + areaRange;
            let affected = getInRangeOffsets(hovered, areaRange, { includeSelf: false, elevationAware });
            affected = trimByTerrain(affected, burstTop);
            affected = propagate(affected, getOccupiedOffsets(hovered).map(offset => `${offset.col},${offset.row}`));
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, hovered, range);
            const color = outOfRange ? TG.outOfRange : TG.inRange;
            paintWithHalo(cursorPreview, target => _paintCells(target, affected), { color, lineWidth: 2, lineAlpha: 0.6, fillAlpha: 0.12 });

            const { caught } = tokensInBurst(hovered, areaRange);
            paintWithHalo(previewSelectHighlight, target => caughtFootprints(target, caught), { color: TG.target, lineWidth: 4, lineAlpha: 0.8, fillAlpha: 0.2 });

            if (elevationAware)
            {
                cursorElevLabel.text = bandStr(tokenElev);
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = hovered.center.x;
                cursorElevLabel.y = hovered.center.y;
                cursorElevLabel.visible = true;
            }
            else
                cursorElevLabel.visible = false;
            broadcastChoose([...affected], caught.map(token => token.id));
        };

        const burstMoveHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            drawBurstCursor(tx, ty);
        };

        const burstClickHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            const hovered = tokenUnderCursor(tx, ty);
            if (hovered)
                placeBurst(hovered);
        };

        const drawConeCursor = (tx, ty) =>
        {
            cursorPreview.clear();
            previewSelectHighlight.clear();
            clearCellLabels();
            const off = pixelToOffset(tx, ty);
            const centerPt = getHexCenter(off.col, off.row);
            const outOfRange = range !== null && casterToken
                && !isPositionInRange(casterToken, { x: centerPt.x, y: centerPt.y }, range);
            const color = outOfRange ? TG.outOfRange : TG.inRange;
            const previewElev = elevationAware
                ? (autoElevation ? groundAtCenter({ x: centerPt.x, y: centerPt.y }) : 0) + pendingElevationOffset
                : 0;
            const { caught: previewCaught, affected, elevByCell } = computeAreaFor(
                { x: centerPt.x, y: centerPt.y }, previewElev, pendingRotation
            );
            paintWithHalo(cursorPreview, target => _paintCells(target, affected), { color, lineWidth: 2, lineAlpha: 0.6, fillAlpha: 0.12 });
            paintWithHalo(previewSelectHighlight, target => caughtFootprints(target, previewCaught), { color: TG.target, lineWidth: 4, lineAlpha: 0.8, fillAlpha: 0.2 });

            if (elevationAware && cellsAreTilted(elevByCell))
            {
                // tilted line: an arrow label per cell
                cursorElevLabel.visible = false;
                for (const [key, elevation] of elevByCell)
                {
                    const [col, row] = key.split(',').map(Number);
                    cellLabelLayer.addChild(makeCellNumber(elevation, col, row));
                }
            }
            else if (elevationAware)
            {
                // flat line -> single arrow; cone -> top/bottom band
                cursorElevLabel.text = elevByCell ? elevArrow(previewElev) : bandStr(previewElev);
                cursorElevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
                cursorElevLabel.x = centerPt.x;
                cursorElevLabel.y = centerPt.y;
                cursorElevLabel.visible = true;
            }
            else
                cursorElevLabel.visible = false;
            broadcastChoose([...affected], previewCaught.map(token => token.id));
        };

        let lastConeCursor = null;
        const coneMoveHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            lastConeCursor = { x: tx, y: ty };
            drawConeCursor(tx, ty);
        };
        const refreshConeCursor = () =>
        {
            if (lastConeCursor)
                drawConeCursor(lastConeCursor.x, lastConeCursor.y);
        };
        const coneClickHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            placeCone(tx, ty);
        };

        let stackPopupEl = null;
        let stackOutsideHandler = null;
        const closeStackPopup = () =>
        {
            if (stackPopupEl)
            {
                stackPopupEl.remove();
                stackPopupEl = null;
            }
            if (stackOutsideHandler)
            {
                document.removeEventListener('pointerdown', stackOutsideHandler, true);
                stackOutsideHandler = null;
            }
        };

        const toggleTokenSelection = (token) =>
        {
            if (!soft && range !== null && casterToken && !isPositionInRange(casterToken, token, range))
                return;
            if (selectedTokens.has(token))
            {
                selectedTokens.delete(token);
                removeSelectionHighlight(token);
                refreshCard();
                return;
            }
            if (count !== -1 && selectedTokens.size >= count)
            {
                if (count === 1)
                {
                    const oldToken = selectedTokens.values().next().value;
                    selectedTokens.delete(oldToken);
                    removeSelectionHighlight(oldToken);
                }
                else
                {
                    ui.notifications.warn(`Maximum of ${count} targets already selected.`);
                    return;
                }
            }
            selectedTokens.add(token);
            drawSelectionHighlight(token);
            refreshCard();
            if (autoConfirm && count !== -1 && selectedTokens.size >= count)
                doConfirm();
        };

        const showStackPicker = (tokens, screenX, screenY) =>
        {
            closeStackPopup();
            const el = document.createElement('div');
            el.className = 'la-stack-picker';
            el.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:10000;background:#1c1c1c;border:2px solid #ff6400;border-radius:4px;padding:4px;min-width:160px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Signika,sans-serif;`;
            for (const token of tokens)
            {
                const isSelected = selectedTokens.has(token);
                const row = document.createElement('div');
                row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:3px;${isSelected ? 'background:rgba(255,100,0,0.25);' : ''}`;
                row.innerHTML = `
                    <img src="${token.document.texture.src}" style="width:24px;height:24px;object-fit:contain;border:1px solid #555;border-radius:2px;background:#000;">
                    <span style="color:#fff;font-size:0.9em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${token.name}</span>
                    ${isSelected ? '<i class="fas fa-check" style="color:#5cff5c;"></i>' : ''}`;
                row.addEventListener('mouseenter', () =>
                {
                    row.style.background = 'rgba(255,100,0,0.4)';
                });
                row.addEventListener('mouseleave', () =>
                {
                    row.style.background = isSelected ? 'rgba(255,100,0,0.25)' : 'transparent';
                });
                row.addEventListener('click', (e) =>
                {
                    e.stopPropagation();
                    toggleTokenSelection(token);
                    closeStackPopup();
                });
                el.appendChild(row);
            }
            document.body.appendChild(el);
            stackPopupEl = el;
            const rect = el.getBoundingClientRect();
            if (rect.right > window.innerWidth)
                el.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`;
            if (rect.bottom > window.innerHeight)
                el.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`;
            stackOutsideHandler = (event) =>
            {
                if (stackPopupEl && !stackPopupEl.contains(/** @type {Node} */ (event.target)))
                    closeStackPopup();
            };
            setTimeout(() => document.addEventListener('pointerdown', stackOutsideHandler, true), 0);
        };

        const clickHandler = (event) =>
        {
            const { x: tx, y: ty } = pointerToWorld(event);
            const tokensHere = allTokens.filter(token =>
            {
                const bounds = token.bounds;
                return tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom;
            });
            if (tokensHere.length === 0)
                return;
            if (tokensHere.length === 1)
            {
                toggleTokenSelection(tokensHere[0]);
                return;
            }
            const originalEvent = event?.data?.originalEvent;
            const sx = originalEvent?.clientX ?? 0;
            const sy = originalEvent?.clientY ?? 0;
            showStackPicker(tokensHere, sx + 10, sy + 10);
        };

        // Rebindable elevation (Q/E) + line tilt (W/S) shortcuts.
        const ascendKeys = keyCodesFor('elevationUp');
        const descendKeys = keyCodesFor('elevationDown');
        const tiltUpKeys = keyCodesFor('lineTiltUp');
        const tiltDownKeys = keyCodesFor('lineTiltDown');
        const resetKeys = keyCodesFor('resetShape');

        const refreshCurrentCursor = () =>
        {
            if (isConeMode || isLineMode)
                refreshConeCursor();
            else if (isBlastMode)
                refreshBlastCursor();
        };

        // Q/E shifts elevation on the cursor preview only; placed areas stay frozen at their placement-time offset.
        const bumpElevationOffset = (step) =>
        {
            if (!elevationAware)
                return;
            pendingElevationOffset += step;
            refreshCurrentCursor();
            playUiSound('targeting');
        };

        // Ctrl+wheel snaps the cursor preview to the next facing (frozen once placed).
        const bumpConeRotation = (step) =>
        {
            const modulus = rotationModulus;
            pendingRotation = ((pendingRotation + step) % modulus + modulus) % modulus;
            refreshConeCursor();
            playUiSound('targeting');
        };

        // W/S tilt the line's end elevation on the cursor preview only (frozen once placed).
        const bumpTilt = (step) =>
        {
            if (!elevationAware)
                return;
            pendingTilt += step;
            refreshConeCursor();
            playUiSound('targeting');
        };

        const wheelHandler = (event) =>
        {
            if ((!isConeMode && !isLineMode) || !event.ctrlKey)
                return;
            event.preventDefault();
            event.stopPropagation();
            const step = event.deltaY > 0 ? 1 : -1;
            bumpConeRotation(step);
        };

        const keyHandler = (event) =>
        {
            if (event.key === "Escape")
            {
                suppressEvent(event);
                if (stackPopupEl)
                {
                    closeStackPopup();
                    return;
                }
                doCancel();
                return;
            }
            if (!isBlastMode && !isConeMode && !isLineMode)
                return;
            // Z resets shape offsets (elevation, rotation, line tilt) - keeps range.
            if (resetKeys.has(event.code))
            {
                suppressEvent(event);
                pendingElevationOffset = 0;
                pendingRotation = 0;
                pendingTilt = 0;
                if (isConeMode || isLineMode)
                    refreshConeCursor();
                else
                    refreshCurrentCursor();
                playUiSound('targeting');
                return;
            }
            // W/S tilt the line's end elevation.
            if (isLineMode && (tiltUpKeys.has(event.code) || tiltDownKeys.has(event.code)))
            {
                suppressEvent(event);
                bumpTilt(tiltUpKeys.has(event.code) ? 1 : -1);
                return;
            }
            let step = 0;
            if (ascendKeys.has(event.code))
                step = 1;
            else if (descendKeys.has(event.code))
                step = -1;
            if (step === 0)
                return;
            // Always swallow Q/E in area mode so Foundry's zoom / token-elevation bindings can't fire.
            suppressEvent(event);
            bumpElevationOffset(step);
        };

        // Apply pre-selected tokens (capped to count). Skipped in blast mode (no placement to attach them to).
        if (!isBlastMode && preSelected.length > 0)
        {
            if (preSelected.length > count)
                ui.notifications.warn(`chooseToken: ${preSelected.length} pre-selected tokens but count is ${count}; only the first ${count} will be used.`);
            for (const token of preSelected.slice(0, count))
            {
                if (!selectedTokens.has(token))
                {
                    selectedTokens.add(token);
                    drawSelectionHighlight(token);
                }
            }
            refreshCard();
        }

        // Bind the mode-toggle handlers up front so the first toggle click isn't a no-op.
        if (isAreaMode)
            refreshCard();

        const safe = makeSafe('chooseToken', doCancel);
        const isAimed = isConeMode || isLineMode;
        const _move = isAimed ? coneMoveHandler : isBurstMode ? burstMoveHandler : isBlastMode ? blastMoveHandler : moveHandler;
        safeMove = safe((e) =>
        {
            const { x, y } = pointerToWorld(e);
            const offset = pixelToOffset(x, y);
            playTargetingMove(offset.col, offset.row);
            _move(e);
        });
        const _click = isAimed ? coneClickHandler : isBurstMode ? burstClickHandler : isBlastMode ? blastClickHandler : clickHandler;
        safeClick = safe((e) =>
        {
            playUiSound('targetingConfirm');
            _click(e);
        });
        safeKey = safe(keyHandler);
        canvas.stage.on('pointermove', safeMove);
        canvas.stage.on('click', safeClick);
        document.addEventListener('keydown', safeKey, true);
        if (isAimed)
        {
            safeWheel = safe(wheelHandler);
            // Capture phase + non-passive so we can preventDefault before Foundry's canvas zoom listener.
            document.addEventListener('wheel', safeWheel, { capture: true, passive: false });
        }
    }), _title);
}
