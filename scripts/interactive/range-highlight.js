import { isHexGrid, offsetToCube, cubeDistance, getHexCenter, pixelToOffset, getOccupiedOffsets, getInRangeOffsets } from "../combat/grid-helpers.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { mixColor } from "../tools/color-utils.js";
import { awaitMovementSettled } from "../movement/move-api.js";
import { RANGE_GLOW, RANGE_PULSE_STYLE } from "./canvas-palette.js";
import { destroyGraphics, addGraphicsBelowTokens, addGraphicsAboveTokens, _paintCells, drawDashedEdges } from "./canvas-primitives.js";
import { _cellCorners, _cellColRow, _cellOnMap, withPulseFilterScope, makePulseCellFilter, _effectiveOrigin } from "./pulse-los-filter.js";

// debug: outline-only range pulse, no fill/grid/wave.
const _OUTLINE_ONLY = false;

const INSET_TILE_SCALE = 0.8;
const BRACKET_TICK_FRACTION = 0.26;
const BLOOM_STEP_MS = 90;
const BLOOM_RISE_MS = 420;
// Crest shine: the resting core is pulled toward the source color, a wider white core fades in at peak.
const HOT_CORE_COOL_MIX = 0.55;
const HOT_CORE_WIDTH_MUL = 1.8;
const HOT_CORE_CURVE = 1.7;
const BLOOM_REST_LEVEL = 0.34;
const BLOOM_CREST = 0.55;
// The repeating motion waits this long after a bloom finishes before starting the next one.
const WAVE_REST_MS = 1000;
const FLASH_MAX_ALPHA = 1;

/** Standard range-pulse teardown: drop the wave ticker, destroy the highlight + pulse graphics. */
export function teardownRangePulse(wavePulse, rangeHighlight, pulseGraphic)
{
    if (wavePulse)
    {
        canvas.app.ticker.remove(wavePulse);
        wavePulse.dispose?.();
    }
    destroyGraphics(rangeHighlight);
    destroyGraphics(pulseGraphic);
}

/** Group cells by min distance from any origin offset. Skips dist 0. */
export function _groupCellsByDistance(originOffsets, cellKeys)
{
    const hex = isHexGrid();
    const byDist = new Map();
    for (const key of cellKeys)
    {
        const [col, row] = key.split(',').map(Number);
        let minDist = Infinity;
        for (const originOffset of originOffsets)
        {
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

// Client-tunable thickness multiplier for the wave line + its black outline (Colors tab).
function _rangePulseWidthMul()
{
    return Number(getModuleSetting('rangePulseLineWidth')) || 1;
}

function _rangePulseSetting(settingKey, fallback)
{
    return String(getModuleSetting(settingKey) || fallback);
}

// Cells shrunk toward their own center, so neighbours stop sharing edges.
function _paintCellsInset(graphic, cells, scale)
{
    for (const cell of cells)
    {
        const { col, row } = _cellColRow(cell);
        const center = getHexCenter(col, row);
        const points = [];
        for (const vertex of _cellCorners(col, row))
            points.push(center.x + (vertex.x - center.x) * scale, center.y + (vertex.y - center.y) * scale);
        graphic.drawPolygon(points);
    }
}

// Short ticks at each cell corner, the honeycomb read on a fraction of the ink.
function _paintCellBrackets(graphic, cells, frac)
{
    for (const cell of cells)
    {
        const { col, row } = _cellColRow(cell);
        const corners = _cellCorners(col, row);
        for (let index = 0; index < corners.length; index++)
        {
            const start = corners[index];
            const end = corners[(index + 1) % corners.length];
            const dx = end.x - start.x;
            const dy = end.y - start.y;
            graphic.moveTo(start.x, start.y);
            graphic.lineTo(start.x + dx * frac, start.y + dy * frac);
            graphic.moveTo(end.x, end.y);
            graphic.lineTo(end.x - dx * frac, end.y - dy * frac);
        }
    }
}

// Grid Line Opacity retired 2026-09-12, static grid lines stay off.
// Restore: return baseAlpha ? _rangePulseOpacity('rangePulseLineOpacity') : 0;
export function _staticGridAlpha(baseAlpha)
{
    return 0;
}

/** Speed multiplier shared by the continuous wave and the one shot bloom. */
function _rangePulseSpeed()
{
    try
    {
        const speed = Number(getModuleSetting('rangePulseSpeed'));
        return Number.isFinite(speed) && speed > 0 ? speed : 1;
    }
    catch
    {
        return 1;
    }
}

// Colors tab opacity sliders.
function _rangePulseOpacity(settingKey)
{
    try
    {
        const opacity = Number(getModuleSetting(settingKey));
        return Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    }
    catch
    {
        return 1;
    }
}

/** Wave-pulse tick for canvas.app.ticker.add(...). */
export function _makeRangePulseTick(pulseGraphic, hexesByDist, range, opts = {})
{
    const {
        color = 0x929292,
        lineColor = 0xFFFFFF,
        peakAlpha = 0.1,
        baseAlpha = 0.00,
        baseLineAlpha = 0.00,
        lineWidth = 1.2,
        lineAlphaMul = 6,
        originToken = null,
        glowColor = RANGE_GLOW.manual,
        los = false,
        freeRange = 0,
    } = opts;
    const speedMul = _rangePulseSpeed();
    const gridScale = canvas.grid.size / 100; // line widths are calibrated on a 100px grid
    const widthMul = _rangePulseWidthMul();
    const opacityMul = _rangePulseOpacity('rangePulseWaveOpacity');
    const pulseStyle = _rangePulseSetting('rangePulseStyle', 'inset');
    const pulseMotion = _rangePulseSetting('rangePulseMotion', 'bloom');
    const bloomStagger = BLOOM_STEP_MS / speedMul;
    const bloomRise = BLOOM_RISE_MS / speedMul;
    const coolCoreColor = glowColor === null ? lineColor : mixColor(lineColor, glowColor, HOT_CORE_COOL_MIX);
    let bloomStart = performance.now();
    let maxRingDist = 0;
    // Additive copy of the token art: tint only multiplies, so brightening to white needs its own sprite.
    const flashLayer = new PIXI.Container();
    addGraphicsAboveTokens(flashLayer);
    const flashes = [];
    const clearFlashes = () =>
    {
        for (const flash of flashes)
            destroyGraphics(flash.sprite);
        flashes.length = 0;
    };
    const buildFlashes = (ringOfCell) =>
    {
        clearFlashes();
        for (const token of canvas.tokens?.placeables ?? [])
        {
            const texture = token.mesh?.texture;
            if (!texture || !token.visible)
                continue;
            let ringDist = null;
            for (const offset of getOccupiedOffsets(token))
            {
                const cellRing = ringOfCell.get(`${offset.col},${offset.row}`);
                if (cellRing !== undefined && (ringDist === null || cellRing < ringDist))
                    ringDist = cellRing;
            }
            if (ringDist === null)
                continue;
            const sprite = new PIXI.Sprite(texture);
            sprite.eventMode = 'none';
            sprite.blendMode = PIXI.BLEND_MODES.ADD;
            sprite.alpha = 0;
            sprite.visible = false;
            flashLayer.addChild(sprite);
            flashes.push({ token, sprite, ringDist });
        }
    };
    const lineW = Math.max(1, lineWidth * gridScale * widthMul);
    const glowW = lineW + Math.max(1, 1.5 * gridScale * widthMul);
    const haloW = glowColor === null ? lineW + Math.max(1, gridScale * widthMul) : glowW + Math.max(1, gridScale * widthMul);
    // Rings prepainted once into child Graphics; per-frame work is alpha-only (no re-tessellation).
    const ringGraphics = new Map();
    // Brackets are open paths, so they can't be filled.
    const closedShape = pulseStyle !== 'bracket';
    const paintShape = (ringG, ringCells) =>
    {
        if (pulseStyle === 'bracket')
            _paintCellBrackets(ringG, ringCells, BRACKET_TICK_FRACTION);
        else
            _paintCellsInset(ringG, ringCells, INSET_TILE_SCALE);
    };
    const paintRingGraphic = (ringCells) =>
    {
        const ringG = new PIXI.Graphics();
        // dark halo under the bright pulse line so the wave reads on light + dark maps
        ringG.lineStyle(haloW, 0x000000, 1);
        paintShape(ringG, ringCells);
        if (glowColor !== null)
        {
            ringG.lineStyle(glowW, glowColor, 1);
            paintShape(ringG, ringCells);
        }
        ringG.lineStyle(lineW, coolCoreColor, 1);
        if (closedShape)
            ringG.beginFill(color, 1 / Math.max(1, lineAlphaMul));
        paintShape(ringG, ringCells);
        if (closedShape)
            ringG.endFill();
        // Second core, cross-faded in at the crest, so the line runs white hot without a repaint.
        const hotG = new PIXI.Graphics();
        hotG.lineStyle(lineW * HOT_CORE_WIDTH_MUL, lineColor, 1);
        paintShape(hotG, ringCells);
        hotG.alpha = 0;
        ringG.addChild(hotG);
        ringG.laHotCore = hotG;
        ringG.alpha = 0;
        ringG.visible = false;
        pulseGraphic.addChild(ringG);
        return ringG;
    };
    const buildRings = (rings) =>
    {
        for (const child of pulseGraphic.removeChildren())
            child.destroy({ children: true });
        ringGraphics.clear();
        clearFlashes();
        bloomStart = performance.now();
        maxRingDist = 0;
        if (_OUTLINE_ONLY)
            return;
        // rebuilt per pass so a moved origin re-tests against fresh vision
        const cellFilter = makePulseCellFilter(originToken, { los, freeRange });
        const ringOfCell = new Map();
        const recordCells = (cells, ringDist) =>
        {
            for (const cell of cells)
            {
                const { col, row } = _cellColRow(cell);
                ringOfCell.set(`${col},${row}`, ringDist);
            }
        };
        if (range <= 1)
        {
            const ringCells = [];
            for (const cells of rings.values())
                ringCells.push(...cells);
            const kept = cellFilter(ringCells);
            if (kept.length)
            {
                ringGraphics.set(0, paintRingGraphic(kept));
                recordCells(kept, 0);
            }
            buildFlashes(ringOfCell);
            return;
        }
        for (const [ringDist, ringCells] of rings)
        {
            const kept = cellFilter(ringCells);
            if (kept.length)
            {
                ringGraphics.set(ringDist, paintRingGraphic(kept));
                recordCells(kept, ringDist);
                if (ringDist > maxRingDist)
                    maxRingDist = ringDist;
            }
        }
        buildFlashes(ringOfCell);
    };
    const setRingAlpha = (ringG, waveAlpha, heat = 0) =>
    {
        const alpha = Math.min(1, baseAlpha + baseLineAlpha + waveAlpha * lineAlphaMul) * opacityMul;
        ringG.alpha = alpha;
        ringG.visible = alpha > 0.001;
        if (ringG.laHotCore && !ringG.laHotCore.destroyed)
            ringG.laHotCore.alpha = Math.pow(Math.max(0, Math.min(1, heat)), HOT_CORE_CURVE);
    };
    buildRings(hexesByDist);
    let lastKey = _originPosKey(originToken);
    const motionGate = _makeMotionGate();
    const tick = () =>
    {
        if (pulseGraphic.destroyed)
        {
            clearFlashes();
            destroyGraphics(flashLayer);
            return;
        }
        if (_OUTLINE_ONLY)
            return;
        if (lastKey !== null)
        {
            const key = _originPosKey(originToken);
            if (key !== lastKey && motionGate.ready())
            {
                lastKey = key;
                const effectiveOrigin = _effectiveOrigin(originToken);
                buildRings(_groupCellsByDistance(
                    getOccupiedOffsets(effectiveOrigin),
                    getInRangeOffsets(effectiveOrigin, range, { includeSelf: true })
                ));
                _scheduleSettledRebuild(originToken, () =>
                {
                    lastKey = '__resettle__';
                    motionGate.forceNext();
                });
            }
        }
        const now = performance.now();
        // rings rise from the origin outward and stay up; 'bloom' crests once, the repeat mode crests again after a rest
        const elapsed = now - bloomStart;
        const sweepMs = maxRingDist * bloomStagger + bloomRise;
        const crestElapsed = pulseMotion === 'bloom'
            ? elapsed
            : elapsed % (sweepMs + WAVE_REST_MS / speedMul);
        for (const [ringDist, ringG] of ringGraphics)
        {
            if (ringG.destroyed)
                continue;
            const ringStart = ringDist * bloomStagger;
            const risen = Math.max(0, Math.min(1, (elapsed - ringStart) / bloomRise));
            const eased = risen * risen * (3 - 2 * risen);
            const crestPhase = Math.max(0, Math.min(1, (crestElapsed - ringStart) / bloomRise));
            const crest = Math.sin(crestPhase * Math.PI) * BLOOM_CREST;
            setRingAlpha(ringG, peakAlpha * (eased * BLOOM_REST_LEVEL + crest), crest / BLOOM_CREST);
        }
        for (const { token, sprite, ringDist } of flashes)
        {
            if (sprite.destroyed)
                continue;
            const mesh = token.mesh;
            if (!mesh || token.destroyed || !token.visible)
            {
                sprite.visible = false;
                continue;
            }
            const crestPhase = Math.max(0, Math.min(1, (crestElapsed - ringDist * bloomStagger) / bloomRise));
            const strength = Math.sin(crestPhase * Math.PI) * FLASH_MAX_ALPHA;
            sprite.alpha = strength;
            sprite.visible = strength > 0.001;
            if (!sprite.visible)
                continue;
            // copy the mesh transform verbatim: same texture, so anchor and signed scale line it up exactly
            sprite.position.set(mesh.position.x, mesh.position.y);
            sprite.anchor.set(mesh.anchor?.x ?? 0.5, mesh.anchor?.y ?? 0.5);
            sprite.rotation = mesh.rotation ?? 0;
            sprite.scale.set(mesh.scale?.x ?? 1, mesh.scale?.y ?? 1);
        }
    };
    // the ticker is removed before the graphic is destroyed, so the flashes need their own teardown
    tick.dispose = () =>
    {
        clearFlashes();
        destroyGraphics(flashLayer);
    };
    return tick;
}

// End-of-move caches settle after the last animation frame; force one rebuild past that point.
function _scheduleSettledRebuild(origin, forceRebuild)
{
    const doc = _effectiveOrigin(origin)?.document;
    if (!doc)
        return;
    if (!doc.object?.movementAnimationPromise && doc.movement?.state !== 'pending')
        return;
    awaitMovementSettled(doc).then(forceRebuild);
}

const MOTION_REBUILD_FRAMES = 15;

// A rebuild mid-drag costs a full LOS pass, so gate them; the settled rebuild still lands the final position.
function _makeMotionGate()
{
    let frames = MOTION_REBUILD_FRAMES;
    return {
        ready()
        {
            frames++;
            if (frames < MOTION_REBUILD_FRAMES)
                return false;
            frames = 0;
            return true;
        },
        forceNext()
        {
            frames = MOTION_REBUILD_FRAMES;
        },
    };
}

// Center position key (drag preview if dragging); null for a point origin. Any movement rebuilds.
function _originPosKey(origin)
{
    const effectiveOrigin = _effectiveOrigin(origin);
    if (!effectiveOrigin?.document)
        return null;
    const center = effectiveOrigin.center ?? { x: effectiveOrigin.document.x, y: effectiveOrigin.document.y };
    return `${Math.round(center.x)},${Math.round(center.y)}`;
}

// Dark halo + bright line + fill over a set/array of "col,row" cells. Line width calibrated on a 100px grid.
export function paintCellRegion(graphic, cells, { color = 0x00ff00, alpha = 0.2, lineAlpha = undefined, lineColor = 0xFFFFFF, lineWidth: rawLineWidth = 2 } = {})
{
    const gridScale = canvas.grid.size / 100;
    const resolvedLineAlpha = lineAlpha ?? (isHexGrid() ? 0.4 : 0.7);
    const lineWidth = rawLineWidth > 0 ? Math.max(1, rawLineWidth * gridScale) : 0;
    const haloWidth = lineWidth > 0 ? lineWidth + Math.max(1, 2 * gridScale) : 0;
    if (lineWidth > 0 && resolvedLineAlpha > 0)
    {
        graphic.lineStyle(haloWidth, 0x000000, Math.min(1, resolvedLineAlpha + 0.25));
        _paintCells(graphic, cells);
        graphic.lineStyle(lineWidth, lineColor, Math.min(1, resolvedLineAlpha + 0.2));
    }
    if (alpha > 0)
        graphic.beginFill(color, alpha);
    _paintCells(graphic, cells);
    if (alpha > 0)
        graphic.endFill();
}

// Outer boundary: edges belonging to exactly one cell (shared edges cancel).
export function _perimeterEdges(cells)
{
    const round = (value) => Math.round(value * 10) / 10;
    const edges = new Map();
    for (const cell of cells)
    {
        const col = typeof cell === 'string' ? Number(cell.split(',')[0]) : cell.col;
        const row = typeof cell === 'string' ? Number(cell.split(',')[1]) : cell.row;
        const corners = _cellCorners(col, row);
        for (let index = 0; index < corners.length; index++)
        {
            const start = corners[index];
            const end = corners[(index + 1) % corners.length];
            const startKey = `${round(start.x)},${round(start.y)}`;
            const endKey = `${round(end.x)},${round(end.y)}`;
            const edgeKey = startKey < endKey ? `${startKey}|${endKey}` : `${endKey}|${startKey}`;
            const existing = edges.get(edgeKey);
            if (existing)
                existing.count += 1;
            else
                edges.set(edgeKey, { count: 1, ax: start.x, ay: start.y, bx: end.x, by: end.y });
        }
    }
    const boundary = [];
    for (const edge of edges.values())
    {
        if (edge.count === 1)
            boundary.push(edge);
    }
    return boundary;
}

// Halo + colored glow + white core along a cell set's outer boundary (matches the pulse glow).
export function paintPerimeterGlow(graphic, cells, { lineColor = RANGE_PULSE_STYLE.lineColor, lineAlpha = RANGE_PULSE_STYLE.perimeterAlpha, glowColor = RANGE_GLOW.manual, lineWidth = 1.2, halo = true } = {})
{
    const boundary = _perimeterEdges(cells);
    if (!boundary.length)
        return;
    const gridScale = canvas.grid.size / 100;
    const widthMul = _rangePulseWidthMul();
    lineAlpha *= _rangePulseOpacity('rangePulseWaveOpacity');
    const lineW = Math.max(1, lineWidth * gridScale * widthMul);
    const glowW = lineW + Math.max(1, 1.5 * gridScale * widthMul);
    const haloW = glowColor === null ? lineW + Math.max(1, gridScale * widthMul) : glowW + Math.max(1, gridScale * widthMul);
    const strokeBoundary = (width, colorInt, alpha) =>
    {
        graphic.lineStyle(width, colorInt, alpha);
        for (const edge of boundary)
        {
            graphic.moveTo(edge.ax, edge.ay);
            graphic.lineTo(edge.bx, edge.by);
        }
    };
    if (halo)
        strokeBoundary(haloW, 0x000000, lineAlpha);
    if (glowColor !== null)
        strokeBoundary(glowW, glowColor, lineAlpha);
    if (!_OUTLINE_ONLY)
        strokeBoundary(lineW, lineColor, lineAlpha);
}

const BLOCKED_CONTOUR_ALPHA = 0.25;

// Dashed ghost of the true flat reach over whatever the filter dropped; edges shared with the lit contour are skipped.
export function paintBlockedRangeContour(graphic, fullCells, litCells, { glowColor = RANGE_GLOW.manual, lineAlpha = BLOCKED_CONTOUR_ALPHA } = {})
{
    const round = (value) => Math.round(value * 10) / 10;
    const edgeKeyOf = (edge) =>
    {
        const aKey = `${round(edge.ax)},${round(edge.ay)}`;
        const bKey = `${round(edge.bx)},${round(edge.by)}`;
        return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
    };
    // tied to the canvas: the ghost stops at the scene edge like the lit reach does
    const rect = canvas.dimensions?.sceneRect ?? null;
    const onMapCells = [];
    for (const cell of fullCells)
    {
        const { col, row } = _cellColRow(cell);
        if (_cellOnMap(col, row, rect))
            onMapCells.push(cell);
    }
    const litEdgeKeys = new Set(_perimeterEdges(litCells).map(edgeKeyOf));
    const edges = [];
    for (const edge of _perimeterEdges(onMapCells))
    {
        if (!litEdgeKeys.has(edgeKeyOf(edge)))
            edges.push([{ x: edge.ax, y: edge.ay }, { x: edge.bx, y: edge.by }]);
    }
    if (!edges.length)
        return;
    const gridScale = canvas.grid.size / 100;
    const widthMul = _rangePulseWidthMul();
    const alpha = lineAlpha * _rangePulseOpacity('rangePulseWaveOpacity');
    const dashLen = canvas.grid.size * 0.16;
    const gapLen = dashLen * 0.75;
    // same halo + glow + core stack as paintPerimeterGlow, dashed and dimmer
    const lineW = Math.max(1, 1.2 * gridScale * widthMul);
    const glowW = lineW + Math.max(1, 1.5 * gridScale * widthMul);
    const haloW = glowColor === null ? lineW + Math.max(1, gridScale * widthMul) : glowW + Math.max(1, gridScale * widthMul);
    graphic.lineStyle(haloW, 0x000000, alpha);
    drawDashedEdges(graphic, edges, dashLen, gapLen, 0);
    if (glowColor !== null)
    {
        graphic.lineStyle(glowW, glowColor, alpha);
        drawDashedEdges(graphic, edges, dashLen, gapLen, 0);
    }
    graphic.lineStyle(lineW, RANGE_PULSE_STYLE.lineColor, alpha);
    drawDashedEdges(graphic, edges, dashLen, gapLen, 0);
}

export function paintRangeHighlight(highlight, casterToken, range, color = 0x00ff00, alpha = 0.2, includeSelf = false, opts = {})
{
    highlight.clear();
    const cellFilter = makePulseCellFilter(casterToken, { los: opts.los === true, freeRange: opts.freeRange ?? 0 });
    const inRange = cellFilter(getInRangeOffsets(casterToken, range, { includeSelf }));
    if (!_OUTLINE_ONLY)
        paintCellRegion(highlight, inRange, { color, alpha, lineAlpha: opts.lineAlpha, lineColor: opts.lineColor, lineWidth: opts.lineWidth });
    if (opts.glowColor != null)
    {
        // boundary from the includeSelf set so the origin never leaves an inner hole in the outline
        const boundaryCells = cellFilter(getInRangeOffsets(casterToken, range, { includeSelf: true }));
        paintPerimeterGlow(highlight, boundaryCells, { glowColor: opts.glowColor, lineColor: opts.lineColor ?? 0xFFFFFF, ...(opts.perimeterAlpha !== undefined ? { lineAlpha: opts.perimeterAlpha } : {}) });
        // ghost measured against the flat reach, so elevation cuts read like wall cuts
        const trueReach = getInRangeOffsets(casterToken, range, { includeSelf: true, elevationAware: false });
        if (boundaryCells.length !== trueReach.size)
            paintBlockedRangeContour(highlight, trueReach, boundaryCells, { glowColor: opts.glowColor });
    }
}

export function drawRangeHighlight(casterToken, range, color = 0x00ff00, alpha = 0.2, includeSelf = false, opts = {})
{
    const highlight = new PIXI.Graphics();
    paintRangeHighlight(highlight, casterToken, range, color, alpha, includeSelf, opts);
    addGraphicsBelowTokens(highlight);

    // follow the origin as it moves
    let lastKey = _originPosKey(casterToken);
    if (lastKey !== null)
    {
        const motionGate = _makeMotionGate();
        const followTick = () =>
        {
            if (!highlight || highlight.destroyed)
            {
                canvas.app.ticker.remove(followTick);
                return;
            }
            const key = _originPosKey(casterToken);
            if (key !== lastKey && motionGate.ready())
            {
                lastKey = key;
                paintRangeHighlight(highlight, _effectiveOrigin(casterToken), range, color, alpha, includeSelf, opts);
                _scheduleSettledRebuild(casterToken, () =>
                {
                    lastKey = '__resettle__';
                    motionGate.forceNext();
                });
            }
        };
        canvas.app.ticker.add(followTick);
    }
    return highlight;
}

// Fade the given graphics in on create; returns a destroy() that fades them out then runs onDestroyed.
export function createFadeInOut(graphics, { fadeInMs = 180, fadeOutMs = 180 }, onDestroyed)
{
    for (const graphic of graphics)
        graphic.alpha = 0;
    let fadeStart = performance.now();
    let fadeFrom = 0;
    let fadeTo = 1;
    let fadeDur = Math.max(1, fadeInMs);
    let onFadeDone = null;
    let finished = false;
    const finish = () =>
    {
        if (finished)
            return;
        finished = true;
        canvas.app.ticker.remove(fadeTick);
        onFadeDone = null;
        onDestroyed();
    };
    const fadeTick = () =>
    {
        if (graphics.some(graphic => graphic.destroyed))
        {
            finish();
            return;
        }
        const elapsed = performance.now() - fadeStart;
        const fadeProgress = Math.min(1, elapsed / fadeDur);
        const alpha = fadeFrom + (fadeTo - fadeFrom) * fadeProgress;
        for (const graphic of graphics)
            graphic.alpha = alpha;
        if (fadeProgress >= 1)
        {
            canvas.app.ticker.remove(fadeTick);
            if (onFadeDone)
                finish();
        }
    };
    canvas.app.ticker.add(fadeTick);
    return () =>
    {
        if (finished)
            return;
        if (fadeOutMs <= 0)
        {
            finish();
            return;
        }
        fadeStart = performance.now();
        fadeFrom = graphics[0]?.alpha ?? 1;
        fadeTo = 0;
        fadeDur = Math.max(1, fadeOutMs);
        onFadeDone = onDestroyed;
        canvas.app.ticker.remove(fadeTick);
        canvas.app.ticker.add(fadeTick);
    };
}

// Gray range highlight with an animated wave pulse from one origin. Returns a destroy() fn.
export function createPulsingRangeHighlight(casterToken, range, { includeSelf = false, staticFillAlpha = RANGE_PULSE_STYLE.staticFillAlpha, staticLineAlpha = RANGE_PULSE_STYLE.staticLineAlpha, fadeInMs = 180, fadeOutMs = 180, glowColor = RANGE_GLOW.manual, los = false, freeRange = 0 } = {})
{
    // the static highlight and the wave rings filter the same reach, so they build the filter once
    return withPulseFilterScope(() =>
    {
        const rangeHighlight = drawRangeHighlight(casterToken, range, RANGE_PULSE_STYLE.baseColor, staticFillAlpha, includeSelf, { lineAlpha: _staticGridAlpha(staticLineAlpha), lineColor: RANGE_PULSE_STYLE.lineColor, glowColor, los, freeRange });
        const pulseGraphic = new PIXI.Graphics();
        addGraphicsBelowTokens(pulseGraphic);
        const hexesByDist = _groupCellsByDistance(
            getOccupiedOffsets(casterToken),
            getInRangeOffsets(casterToken, range, { includeSelf: true })
        );
        const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range, { originToken: casterToken, glowColor, los, freeRange });
        canvas.app.ticker.add(wavePulse);
        return createFadeInOut([rangeHighlight, pulseGraphic], { fadeInMs, fadeOutMs },
            () => teardownRangePulse(wavePulse, rangeHighlight, pulseGraphic));
    });
}

// Union of all-entry in-range cells, wave from nearest origin; returns destroy().
export function createMergedRangeHighlight(entries, {
    includeSelf = false, staticFillAlpha = RANGE_PULSE_STYLE.staticFillAlpha, staticLineAlpha = RANGE_PULSE_STYLE.staticLineAlpha,
    fadeInMs = 180, fadeOutMs = 180, glowColor = RANGE_GLOW.manual, wave = true,
    perimeterAlpha, perimeterHalo = true, perimeter = true,
} = {})
{
    const waveRange = Math.max(1, ...entries.map(entry => entry.range));
    const originOffsetsFor = (entry) => entry.point
        ? [pixelToOffset(entry.point.x, entry.point.y)]
        : getOccupiedOffsets(_effectiveOrigin(entry.token));

    const buildUnions = () =>
    {
        const seen = new Set();
        const unionOrigins = [];
        const unionStatic = new Set();
        const unionWave = new Set();
        const unionFullWave = new Set();
        for (const entry of entries)
        {
            const origin = entry.point ?? _effectiveOrigin(entry.token);
            const range = entry.range;
            const cellFilter = makePulseCellFilter(entry.token ?? null, { los: entry.los === true, freeRange: entry.freeRange ?? 0 });
            for (const offset of originOffsetsFor(entry))
            {
                const key = `${offset.col},${offset.row}`;
                if (!seen.has(key))
                {
                    seen.add(key);
                    unionOrigins.push(offset);
                }
            }
            for (const key of cellFilter(getInRangeOffsets(origin, range, { includeSelf })))
                unionStatic.add(key);
            for (const key of cellFilter(getInRangeOffsets(origin, range, { includeSelf: true })))
                unionWave.add(key);
            for (const key of getInRangeOffsets(origin, range, { includeSelf: true, elevationAware: false }))
                unionFullWave.add(key);
        }
        return { unionOrigins, unionStatic, unionWave, unionFullWave };
    };

    const rangeHighlight = new PIXI.Graphics();
    addGraphicsBelowTokens(rangeHighlight);
    const pulseGraphic = wave ? new PIXI.Graphics() : null;
    if (pulseGraphic)
        addGraphicsBelowTokens(pulseGraphic);

    let wavePulse = null;
    const rebuild = () =>
    {
        const { unionOrigins, unionStatic, unionWave, unionFullWave } = buildUnions();
        rangeHighlight.clear();
        if (!_OUTLINE_ONLY)
            paintCellRegion(rangeHighlight, unionStatic, { color: RANGE_PULSE_STYLE.baseColor, alpha: staticFillAlpha, lineAlpha: _staticGridAlpha(staticLineAlpha), lineColor: RANGE_PULSE_STYLE.lineColor });
        if (perimeter)
        {
            paintPerimeterGlow(rangeHighlight, unionWave, {
                glowColor,
                halo: perimeterHalo,
                ...(perimeterAlpha !== undefined ? { lineAlpha: perimeterAlpha } : {}),
            });
            if (unionFullWave.size !== unionWave.size)
                paintBlockedRangeContour(rangeHighlight, unionFullWave, unionWave, { glowColor });
        }
        if (!pulseGraphic)
            return;
        const hexesByDist = _groupCellsByDistance(unionOrigins, unionWave);
        if (wavePulse)
        {
            canvas.app.ticker.remove(wavePulse);
            wavePulse.dispose?.();
        }
        wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, waveRange, { originToken: null, glowColor });
        canvas.app.ticker.add(wavePulse);
    };
    rebuild();

    const posKey = () => entries.map(entry => entry.point ? `pt:${entry.point.x},${entry.point.y}` : (_originPosKey(entry.token) ?? 'pt')).join('|');
    let lastKey = posKey();
    const motionGate = _makeMotionGate();
    const followTick = () =>
    {
        if (rangeHighlight.destroyed)
        {
            canvas.app.ticker.remove(followTick);
            return;
        }
        const key = posKey();
        if (key !== lastKey && motionGate.ready())
        {
            lastKey = key;
            rebuild();
            for (const entry of entries)
            {
                if (entry.token)
                {
                    _scheduleSettledRebuild(entry.token, () =>
                    {
                        lastKey = '__resettle__';
                        motionGate.forceNext();
                    });
                }
            }
        }
    };
    canvas.app.ticker.add(followTick);

    const fadeTargets = pulseGraphic ? [rangeHighlight, pulseGraphic] : [rangeHighlight];
    const destroy = createFadeInOut(fadeTargets, { fadeInMs, fadeOutMs }, () =>
    {
        canvas.app.ticker.remove(followTick);
        teardownRangePulse(wavePulse, rangeHighlight, pulseGraphic);
    });
    destroy.graphics = fadeTargets;
    return destroy;
}
