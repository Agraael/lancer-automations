/* global canvas, PIXI, game, ui, Hooks, document */

import {
    isHexGrid, offsetToCube, cubeDistance,
    getHexCenter, pixelToOffset, getHexVertices,
    drawHexAt, getOccupiedOffsets,
    getInRangeOffsets, isPositionInRange
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import { _rulerMove } from "../main.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "./presence.js";
import { movePathLegs } from "./move-waypoints.js";
import { awaitMovementSettled } from "../movement/move-api.js";

// Fully stop a DOM/Foundry event (default + both propagations).
export function suppressEvent(event)
{
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

// Targeting palette.
export const TG = {
    inRange: 0x0088ff,
    target: 0x00ffff,
    reference: 0xffffff,
    outOfRange: 0xff2c21,
    placed: 0xffd84a,
    noHost: 0xffaa00,
    selected: 0x00ff00,
    crit: 0xffd700,
    rangeFill: 0x888888,
    traceStart: 0xffff00,
    traceEnd: 0xff6400,
    traceLine: 0xffffff,
    markAdd: 0x33ff66,
    markRemove: 0xff3b30,
};

// Range-pulse glow per range kind.
export const RANGE_GLOW = {
    manual: 0xffffff,
    threat: 0xad5cff,
    sensor: 0x7ce4fe,
    weapon: 0xfe9e43,
    reach: 0xff4747,
    mark: 0xffffff,
};

// temporary: show only the boundary outline (no fill, no per-cell grid, no wave). Set false to restore.
const _OUTLINE_ONLY = false;

// Shared range-pulse styling. Tune here; used by every range-pulse builder + the picker.
export const RANGE_PULSE_STYLE = {
    baseColor: 0x888888,
    lineColor: 0xFFFFFF,
    staticFillAlpha: 0.0125,
    staticLineAlpha: 0.0125,
    perimeterAlpha: 0.3,
    pulseSpeed: 1.25,
};

// Client color settings backing the palettes above. [settingKey, object, prop, menuLabel]
const _PALETTE_DEFS = [
    ['color.inRange', TG, 'inRange', 'In Range'],
    ['color.target', TG, 'target', 'Target'],
    ['color.reference', TG, 'reference', 'Reference Token'],
    ['color.outOfRange', TG, 'outOfRange', 'Out of Range'],
    ['color.placed', TG, 'placed', 'Placed Shape'],
    ['color.noHost', TG, 'noHost', 'No Host'],
    ['color.selected', TG, 'selected', 'Selected'],
    ['color.crit', TG, 'crit', 'Critical'],
    ['color.rangeFill', TG, 'rangeFill', 'Range Fill'],
    ['color.traceStart', TG, 'traceStart', 'Trace Start'],
    ['color.traceEnd', TG, 'traceEnd', 'Trace End'],
    ['color.traceLine', TG, 'traceLine', 'Trace Line'],
    ['color.glowManual', RANGE_GLOW, 'manual', 'Default'],
    ['color.glowThreat', RANGE_GLOW, 'threat', 'Threat'],
    ['color.glowSensor', RANGE_GLOW, 'sensor', 'Sensor'],
    ['color.glowWeapon', RANGE_GLOW, 'weapon', 'Weapon'],
    ['color.glowReach', RANGE_GLOW, 'reach', 'Max Reach'],
    ['color.glowMark', RANGE_GLOW, 'mark', 'Mark'],
];

// Ruler speed-tier colors (registered in speed-provider.js). Listed here only so the
// Colors-tab reset button restores them alongside the palette above.
const RULER_COLOR_KEYS = [
    'speedProvider.colorStandard',
    'speedProvider.colorBoost',
    'speedProvider.colorOverBoost',
    'speedProvider.colorFreeMovement',
    'speedProvider.colorForceMovement',
];

const _toHex = (value) => '#' + (value & 0xffffff).toString(16).padStart(6, '0');
const _fromHex = (hex) =>
{
    const parsed = Number.parseInt(String(hex).replace(/^#/, ''), 16);
    return Number.isFinite(parsed) ? parsed : null;
};

// Overwrite the live palette objects in place so every importer picks up the change.
function applyPaletteColorSettings()
{
    for (const [key, obj, prop] of _PALETTE_DEFS)
    {
        const value = _fromHex(game.settings.get('lancer-automations', key));
        if (value !== null)
            obj[prop] = value;
    }
}

// Restore every palette color (and the ruler colors) to its registered default, mirroring onto any open color inputs.
export async function resetPaletteColorSettings()
{
    const keys = [..._PALETTE_DEFS.map(([key]) => key), ...RULER_COLOR_KEYS];
    for (const key of keys)
    {
        const registered = game.settings.settings.get(`lancer-automations.${key}`);
        const defaultHex = registered?.default;
        if (defaultHex == null)
            continue;
        await game.settings.set('lancer-automations', key, defaultHex);
        const input = /** @type {HTMLInputElement|null} */ (document.querySelector(`input[type="color"][name="${key}"]`));
        if (input)
            input.value = defaultHex;
    }
}

Hooks.once('init', () =>
{
    for (const [key, obj, prop, label] of _PALETTE_DEFS)
    {
        game.settings.register('lancer-automations', key, {
            name: label,
            scope: 'client',
            config: false,
            type: String,
            default: _toHex(obj[prop]),
            onChange: applyPaletteColorSettings,
        });
    }
});
Hooks.once('ready', applyPaletteColorSettings);

/**
 * Convert a PixiJS pointer event's global screen position to canvas world coordinates.
 * Uses the full inverse world transform so it works correctly with isometric-perspective,
 * which adds skew components that the manual (tx/scale) decomposition ignores.
 * @param {PIXI.FederatedPointerEvent} event
 * @returns {{x: number, y: number}}
 */
export function pointerToWorld(event)
{
    return canvas.stage.worldTransform.applyInverse(event.global);
}

const _LA_PICKER_OVERRIDE = Symbol('la-picker-override');

/** Suppress TokenLayer's release-on-click. Returns a restorer that only undoes our override. */
export function suppressTokenLayerClick()
{
    const layer = canvas.tokens;
    if (!layer)
    {
        return () =>
        {};
    }
    const prev = layer._onClickLeft;
    const stub = () =>
    {};
    stub[_LA_PICKER_OVERRIDE] = true;
    layer._onClickLeft = stub;
    return () =>
    {
        if (canvas.tokens?._onClickLeft === stub)
            canvas.tokens._onClickLeft = prev;
    };
}

// Scene change wipes any orphan picker stub left behind by a crashed handler.
Hooks.on('canvasTearDown', () =>
{
    const layer = canvas.tokens;
    if (layer?._onClickLeft?.[_LA_PICKER_OVERRIDE])
        delete layer._onClickLeft;
});

/** Unparent + destroy a PIXI display object (containers destroy their children too). Safe with null/undefined. */
export function destroyGraphics(graphic)
{
    if (!graphic)
        return;
    if (graphic.labelLayer)
        destroyGraphics(graphic.labelLayer);
    if (graphic.parent)
        graphic.parent.removeChild(graphic);
    graphic.destroy({ children: true });
}

/** Insert a graphic below the tokens layer (so tokens overlay it), or fall back to canvas.stage. */
export function addGraphicsBelowTokens(graphic)
{
    graphic.eventMode = 'none';
    if (canvas.tokens?.parent)
        canvas.tokens.parent.addChildAt(graphic, canvas.tokens.parent.getChildIndex(canvas.tokens));
    else
        canvas.stage.addChild(graphic);
    return graphic;
}

/** Insert a graphic above the tokens (canvas.stage, same layer the cursor labels use). */
export function addGraphicsAboveTokens(graphic)
{
    graphic.eventMode = 'none';
    canvas.stage.addChild(graphic);
    return graphic;
}

/** Build the safe(fn) wrapper used by every interactive tool. Logs context + invokes onError. */
export function makeSafe(label, onError)
{
    return (fn) => function safeHandler(...args)
    {
        try
        {
            return fn.apply(this, args);
        }
        catch (e)
        {
            console.error(`${label} handler crash, cleaning up:`, e);
            try
            {
                onError?.();
            }
            catch
            { /* */ }
        }
    };
}

/** Pulsing cursor-preview graphics + tick. Returns { graphics, dispose }. */
export function createCursorPreview()
{
    const cursorPreview = new PIXI.Graphics();
    canvas.stage.addChild(cursorPreview).eventMode = 'none';
    const cursorPulse = () =>
    {
        cursorPreview.alpha = 0.75 + 0.25 * Math.sin(performance.now() / 250);
    };
    canvas.app.ticker.add(cursorPulse);
    return {
        graphics: cursorPreview,
        dispose()
        {
            canvas.app.ticker.remove(cursorPulse);
            destroyGraphics(cursorPreview);
        },
    };
}

// A small green "+" near the cursor while Shift is held, signalling multi add/select mode.
// Call move(shiftHeld, x, y) from the picker's pointermove; it also tracks Shift keydown/keyup.
export function createMultiPlusIndicator()
{
    const label = makeText('+', {
        fontFamily: 'Arial',
        fontSize: Math.max(18, canvas.grid.size * 0.32),
        fill: TG.markAdd,
        stroke: 0x000000,
        strokeThickness: gridLineWidth(4),
        fontWeight: 'bold',
    });
    label.anchor.set(0.5);
    label.visible = false;
    canvas.stage.addChild(label).eventMode = 'none';
    let lastCursorPos = null;
    const place = (shiftHeld) =>
    {
        if (shiftHeld && lastCursorPos)
        {
            label.x = lastCursorPos.x + canvas.grid.size * 0.4;
            label.y = lastCursorPos.y - canvas.grid.size * 0.4;
            label.visible = true;
        }
        else
            label.visible = false;
    };
    const onKey = (event) =>
    {
        if (event.key === 'Shift')
            place(event.type === 'keydown');
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    return {
        move(shiftHeld, x, y)
        {
            lastCursorPos = { x, y };
            place(shiftHeld);
        },
        dispose()
        {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKey, true);
            destroyGraphics(label);
        },
    };
}

// Cursor "+"/"-" while Shift is held: green "+" to add a mark, red "-" over an existing one.
// queryMarked(x, y) returns true (marked), false (unmarked), or null to hide the glyph.
// alwaysOn: show without holding Shift (the glyph is gated only by queryMarked).
export function createCtrlMarkIndicator({ queryMarked, alwaysOn = false })
{
    const label = makeText('+', {
        fontFamily: 'Arial',
        fontSize: Math.max(18, canvas.grid.size * 0.32),
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: gridLineWidth(4),
        fontWeight: 'bold',
    });
    label.anchor.set(0.5);
    label.visible = false;
    canvas.stage.addChild(label).eventMode = 'none';
    let held = alwaysOn || (game.keyboard?.isModifierActive?.('Shift') ?? false);
    let lastPos = null;
    const place = () =>
    {
        const marked = (held && lastPos) ? queryMarked(lastPos.x, lastPos.y) : null;
        if (marked === null || marked === undefined)
        {
            label.visible = false;
            return;
        }
        label.text = marked ? '-' : '+';
        label.tint = marked ? TG.markRemove : TG.markAdd;
        label.x = lastPos.x + canvas.grid.size * 0.4;
        label.y = lastPos.y - canvas.grid.size * 0.4;
        label.visible = true;
    };
    const onKey = (event) =>
    {
        if (!alwaysOn && event.key === 'Shift')
        {
            held = event.type === 'keydown';
            place();
        }
    };
    const onBlur = () =>
    {
        if (alwaysOn)
            return;
        held = false;
        place();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    window.addEventListener('blur', onBlur);
    return {
        move(x, y)
        {
            lastPos = { x, y };
            place();
        },
        dispose()
        {
            document.removeEventListener('keydown', onKey, true);
            document.removeEventListener('keyup', onKey, true);
            window.removeEventListener('blur', onBlur);
            destroyGraphics(label);
        },
    };
}

/** Paint a list of cells (hex or square) onto a PIXI.Graphics. Caller sets fill/stroke. */
export function _paintCells(graphics, cells, { gridSize = canvas.grid.size } = {})
{
    const hex = isHexGrid();
    for (const cell of cells)
    {
        const col = typeof cell === 'string' ? Number(cell.split(',')[0]) : cell.col;
        const row = typeof cell === 'string' ? Number(cell.split(',')[1]) : cell.row;
        if (hex)
            drawHexAt(graphics, col, row);
        else
        {
            const cellCenter = getHexCenter(col, row);
            graphics.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
        }
    }
}

/** World-space stroke width scaled to the grid (calibrated on a 100px grid), min 1px. */
export function gridLineWidth(base = 2)
{
    return Math.max(1, base * canvas.grid.size / 100);
}

export function drawDashedEdges(gfx, edges, dash, gap, phase)
{
    const step = dash + gap;
    const offset = ((phase % step) + step) % step;
    for (const [from, to] of edges)
    {
        const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
        const ux = (to.x - from.x) / len;
        const uy = (to.y - from.y) / len;
        for (let pos = -offset; pos < len; pos += step)
        {
            const start = Math.max(0, pos);
            const end = Math.min(pos + dash, len);
            if (end <= start)
                continue;
            gfx.moveTo(from.x + ux * start, from.y + uy * start);
            gfx.lineTo(from.x + ux * end, from.y + uy * end);
        }
    }
}

function footprintCellPoints(col, row)
{
    if (isHexGrid())
        return getHexVertices(col, row);
    const center = getHexCenter(col, row);
    const half = canvas.grid.size / 2;
    return [
        { x: center.x - half, y: center.y - half },
        { x: center.x + half, y: center.y - half },
        { x: center.x + half, y: center.y + half },
        { x: center.x - half, y: center.y + half },
    ];
}

function footprintPerimeterEdges(cells)
{
    const counts = new Map();
    const segs = new Map();
    const roundKey = (point) => `${Math.round(point.x)},${Math.round(point.y)}`;
    for (const [col, row] of cells)
    {
        const pts = footprintCellPoints(col, row);
        for (let idx = 0; idx < pts.length; idx++)
        {
            const from = pts[idx];
            const to = pts[(idx + 1) % pts.length];
            const ends = [roundKey(from), roundKey(to)].sort((keyA, keyB) => keyA.localeCompare(keyB));
            const key = `${ends[0]}|${ends[1]}`;
            counts.set(key, (counts.get(key) ?? 0) + 1);
            if (!segs.has(key))
                segs.set(key, [from, to]);
        }
    }
    const out = [];
    for (const [key, count] of counts)
    {
        if (count === 1)
            out.push(segs.get(key));
    }
    return out;
}

// Light fill + marching dashed stroke on the outer perimeter only; cells = [[col,row], ...].
export function paintDashedFootprint(graphic, cells, color, { halo = false } = {})
{
    if (!cells.length)
        return;
    const dash = canvas.grid.size * 0.16;
    const gap = canvas.grid.size * 0.11;
    const phase = performance.now() * 0.013;
    graphic.lineStyle(0);
    graphic.beginFill(color, 0.12);
    for (const [col, row] of cells)
    {
        const flat = [];
        for (const pt of footprintCellPoints(col, row))
            flat.push(pt.x, pt.y);
        graphic.drawPolygon(flat);
    }
    graphic.endFill();
    const edges = footprintPerimeterEdges(cells);
    if (halo)
    {
        graphic.lineStyle(gridLineWidth(6), 0x000000, 0.55);
        drawDashedEdges(graphic, edges, dash, gap, phase);
    }
    graphic.lineStyle(gridLineWidth(3), color, 0.95);
    drawDashedEdges(graphic, edges, dash, gap, phase);
}

export function paintWithHalo(graphic, drawGeometry, { color = 0xffffff, lineWidth = 2, lineAlpha = 0.8, fillColor = null, fillAlpha = 0 } = {})
{
    const stroke = gridLineWidth(lineWidth);
    const halo = stroke + Math.max(1, 2 * canvas.grid.size / 100);
    if (lineAlpha > 0)
    {
        graphic.lineStyle(halo, 0x000000, lineAlpha);
        drawGeometry(graphic);
        graphic.lineStyle(stroke, color, lineAlpha);
    }
    if (fillAlpha > 0)
        graphic.beginFill(fillColor ?? color, fillAlpha);
    drawGeometry(graphic);
    if (fillAlpha > 0)
        graphic.endFill();
}

/** Text rasterisation resolution that keeps labels crisp when zoomed in (small grids upscale more). */
export function gridTextResolution()
{
    const dpr = canvas.app?.renderer?.resolution ?? 1;
    const zoom = canvas.stage?.scale?.x ?? 1;
    const factor = Math.max(1, zoom, 100 / canvas.grid.size);
    return Math.min(10, dpr * factor * 1.5);
}

/** PIXI.Text with zoom-aware resolution (crisp when zoomed in on small grids). */
export function makeText(text, style)
{
    const pixiText = new PIXI.Text(text, style);
    pixiText.resolution = gridTextResolution();
    return pixiText;
}

// Lancer-tech hit-% label style (Orbitron, spaced, faint glow). fill + fontSize set per-label.
export const HIT_LABEL_STYLE = {
    fontFamily: 'Orbitron, Helvetica, Arial, sans-serif',
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3,
    letterSpacing: 1.5,
    dropShadow: true,
    dropShadowColor: 0x000000,
    dropShadowBlur: 4,
    dropShadowAngle: 0,
    dropShadowDistance: 0,
    dropShadowAlpha: 0.7,
};

// Hit-% font size, scaled to the grid (calibrated on a 100px grid).
export function hitLabelFontSize()
{
    return Math.max(12, canvas.grid.size * 0.18);
}

// P(hit) and P(crit) for a Lancer attack: total = d20 + bonus + accDice, hit if total >= defense, crit if total >= 20.
// accDice = +max(|netAcc| d6) when netAcc > 0, -max(...) when < 0, 0 when netAcc is 0.
export function rollHitCritChance(bonus, netAcc, defense)
{
    const accDiceOutcomes = [];
    if (netAcc === 0)
        accDiceOutcomes.push({ value: 0, probability: 1 });
    else
    {
        const diceCount = Math.abs(netAcc);
        const sign = netAcc > 0 ? 1 : -1;
        const denominator = 6 ** diceCount;
        for (let faceValue = 1; faceValue <= 6; faceValue++)
            accDiceOutcomes.push({ value: sign * faceValue, probability: (faceValue ** diceCount - (faceValue - 1) ** diceCount) / denominator });
    }
    let hit = 0;
    let crit = 0;
    for (let d20 = 1; d20 <= 20; d20++)
    {
        for (const outcome of accDiceOutcomes)
        {
            const total = d20 + bonus + outcome.value;
            const probability = outcome.probability / 20;
            if (total >= defense)
                hit += probability;
            if (total >= 20)
                crit += probability;
        }
    }
    return { hit, crit };
}

// Colour ramp red -> orange -> yellow -> green -> blue across 0..1.
export function hitChanceColor(pct)
{
    const stops = [[0xff, 0x3b, 0x30], [0xff, 0x8c, 0x00], [0xf2, 0xc7, 0x00], [0x3f, 0xb9, 0x50], [0x33, 0x99, 0xff]];
    const position = Math.max(0, Math.min(1, pct)) * (stops.length - 1);
    const index = Math.min(stops.length - 2, Math.floor(position));
    const fraction = position - index;
    const interpolate = (from, to) => Math.round(from + (to - from) * fraction);
    const red = interpolate(stops[index][0], stops[index + 1][0]);
    const green = interpolate(stops[index][1], stops[index + 1][1]);
    const blue = interpolate(stops[index][2], stops[index + 1][2]);
    return (red << 16) | (green << 8) | blue;
}

// Target-info label content: {hit, crit} renders as hit-% / CRIT; {label, fill?} renders verbatim.
export function applyTargetInfoLabel(label, labelData)
{
    if (labelData.label !== undefined)
    {
        label.text = String(labelData.label);
        label.style.fill = labelData.fill ?? 0xffffff;
        return;
    }
    const isCrit = labelData.crit >= 0.999;
    label.text = isCrit ? 'CRIT' : `${Math.round(labelData.hit * 100)}%`;
    label.style.fill = isCrit ? TG.crit : hitChanceColor(labelData.hit);
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

/** Wave-pulse tick for canvas.app.ticker.add(...). */
export function _makeRangePulseTick(pulseGraphic, hexesByDist, range, opts = {})
{
    const {
        color = 0x929292,
        lineColor = 0xFFFFFF,
        peakAlpha = 0.1,
        baseAlpha = 0.00,
        baseLineAlpha = 0.00,
        msPerCell = 300,
        slowRangeThreshold = 5,
        slowFloorMs = 2400,
        ringWidth = 2,     // rings ahead of the wave that pre-fade in
        trailWidth = 2,    // rings behind the wave that fade out (the tail)
        lineWidth = 1.2,
        lineAlphaMul = 6,
        originToken = null,
        glowColor = RANGE_GLOW.manual,
    } = opts;
    // keep the bands narrower than the range, else they cover every ring at once and it all lights together
    const leadWidth = Math.min(ringWidth, Math.max(1, range === 2 ? 2 : range - 1));
    const tailWidth = Math.min(trailWidth, Math.max(1, range === 2 ? 2 : range - 1));
    const basePeriod = msPerCell * (range + 1 + tailWidth);
    const rawPeriod = opts.periodMs ?? (range < slowRangeThreshold ? Math.max(slowFloorMs, basePeriod) : basePeriod);
    const periodMs = rawPeriod / Math.max(0.01, RANGE_PULSE_STYLE.pulseSpeed);
    const gridScale = canvas.grid.size / 100; // line widths are calibrated on a 100px grid
    const lineW = Math.max(1, lineWidth * gridScale);
    const glowW = lineW + Math.max(1, 1.5 * gridScale);
    const haloW = glowColor === null ? lineW + Math.max(1, gridScale) : glowW + Math.max(1, gridScale);
    let rings = hexesByDist;
    let lastKey = _originPosKey(originToken);
    return () =>
    {
        if (pulseGraphic.destroyed)
            return;
        pulseGraphic.clear();
        if (_OUTLINE_ONLY)
            return;
        if (lastKey !== null)
        {
            const key = _originPosKey(originToken);
            if (key !== lastKey)
            {
                lastKey = key;
                const effectiveOrigin = _effectiveOrigin(originToken);
                rings = _groupCellsByDistance(
                    getOccupiedOffsets(effectiveOrigin),
                    getInRangeOffsets(effectiveOrigin, range, { includeSelf: true })
                );
            }
        }
        const paintRing = (ringCells, waveAlpha) =>
        {
            const fillAlpha = Math.min(1, baseAlpha + waveAlpha);
            const lineAlpha = Math.min(1, baseLineAlpha + waveAlpha * lineAlphaMul);
            if (lineAlpha > 0)
            {
                // dark halo under the bright pulse line so the wave reads on light + dark maps
                pulseGraphic.lineStyle(haloW, 0x000000, lineAlpha);
                _paintCells(pulseGraphic, ringCells);
                if (glowColor !== null)
                {
                    pulseGraphic.lineStyle(glowW, glowColor, lineAlpha);
                    _paintCells(pulseGraphic, ringCells);
                }
            }
            pulseGraphic.lineStyle(lineW, lineColor, lineAlpha);
            pulseGraphic.beginFill(color, fillAlpha);
            _paintCells(pulseGraphic, ringCells);
            pulseGraphic.endFill();
        };
        const now = performance.now();
        const phase = (now % periodMs) / periodMs;
        // range 1 has no distance to travel: breathe the whole adjacent ring as one heartbeat
        if (range <= 1)
        {
            const beat = 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
            const ringCells = [];
            for (const cells of rings.values())
                ringCells.push(...cells);
            paintRing(ringCells, peakAlpha * beat);
            return;
        }
        // cell-ring wave for every pulse (single + merged), same as the advanced measuring tool.
        // equal-power cosine crossfade between rings; fade in at the origin, fade out at the edge.
        // continuous ripple: wavefronts repeat every `wavelength`, so as one reaches the edge
        // the next is already emerging at the origin. modulo wrap => seamless loop, no reset.
        const wavelength = range + tailWidth;
        const wavePos = phase * wavelength;
        for (const [ringDist, ringCells] of rings)
        {
            const local = (((ringDist - wavePos) % wavelength) + wavelength) % wavelength;
            let norm;
            if (local <= leadWidth)
                norm = local / leadWidth;              // ahead of a front, pre-fading in
            else if (local >= wavelength - tailWidth)
                norm = (wavelength - local) / tailWidth; // behind the front, in the tail
            else
                continue;
            const falloff = 0.5 * (1 + Math.cos(norm * Math.PI));
            paintRing(ringCells, peakAlpha * falloff);
        }
    };
}

// The drag-preview clone while the origin is being dragged, else the origin itself.
function _effectiveOrigin(origin)
{
    const id = origin?.document?.id;
    if (!id)
        return origin;
    for (const previewToken of canvas.tokens?.preview?.children ?? [])
    {
        if (previewToken?.document?.id === id)
            return previewToken;
    }
    return origin;
}

// Position key (drag preview if dragging); null for a point origin.
function _originPosKey(origin)
{
    const effectiveOrigin = _effectiveOrigin(origin);
    return effectiveOrigin?.document ? `${effectiveOrigin.document.x},${effectiveOrigin.document.y}` : null;
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

// Outer-boundary segments of a cell set: polygon edges belonging to exactly one cell
// (shared edges cancel out). Grid-agnostic; follows irregular boundaries (terrain, holes).
export function _perimeterEdges(cells)
{
    const hex = isHexGrid();
    const half = canvas.grid.size / 2;
    const round = (value) => Math.round(value * 10) / 10;
    const cornersOf = (col, row) =>
    {
        if (hex)
            return getHexVertices(col, row);
        const center = getHexCenter(col, row);
        return [
            { x: center.x - half, y: center.y - half },
            { x: center.x + half, y: center.y - half },
            { x: center.x + half, y: center.y + half },
            { x: center.x - half, y: center.y + half },
        ];
    };
    const edges = new Map();
    for (const cell of cells)
    {
        const col = typeof cell === 'string' ? Number(cell.split(',')[0]) : cell.col;
        const row = typeof cell === 'string' ? Number(cell.split(',')[1]) : cell.row;
        const corners = cornersOf(col, row);
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
export function paintPerimeterGlow(graphic, cells, { lineColor = RANGE_PULSE_STYLE.lineColor, lineAlpha = RANGE_PULSE_STYLE.perimeterAlpha, glowColor = RANGE_GLOW.manual, lineWidth = 1.2 } = {})
{
    const boundary = _perimeterEdges(cells);
    if (!boundary.length)
        return;
    const gridScale = canvas.grid.size / 100;
    const lineW = Math.max(1, lineWidth * gridScale);
    const glowW = lineW + Math.max(1, 1.5 * gridScale);
    const haloW = glowColor === null ? lineW + Math.max(1, gridScale) : glowW + Math.max(1, gridScale);
    const strokeBoundary = (width, colorInt, alpha) =>
    {
        graphic.lineStyle(width, colorInt, alpha);
        for (const edge of boundary)
        {
            graphic.moveTo(edge.ax, edge.ay);
            graphic.lineTo(edge.bx, edge.by);
        }
    };
    strokeBoundary(haloW, 0x000000, lineAlpha);
    if (glowColor !== null)
        strokeBoundary(glowW, glowColor, lineAlpha);
    if (!_OUTLINE_ONLY)
        strokeBoundary(lineW, lineColor, lineAlpha);
}

export function paintRangeHighlight(highlight, casterToken, range, color = 0x00ff00, alpha = 0.2, includeSelf = false, opts = {})
{
    highlight.clear();
    const inRange = getInRangeOffsets(casterToken, range, { includeSelf });
    if (!_OUTLINE_ONLY)
        paintCellRegion(highlight, inRange, { color, alpha, lineAlpha: opts.lineAlpha, lineColor: opts.lineColor, lineWidth: opts.lineWidth });
    if (opts.glowColor != null)
    {
        // boundary from the includeSelf set so the origin never leaves an inner hole in the outline
        const boundaryCells = getInRangeOffsets(casterToken, range, { includeSelf: true });
        paintPerimeterGlow(highlight, boundaryCells, { glowColor: opts.glowColor, lineColor: opts.lineColor ?? 0xFFFFFF });
    }
}

// Single-mark cursor: highlight the hovered token footprint (cyan) or the cursor cell (blue),
// red when out of range. Returns the hovered token so callers can drive presence / hit labels.
export function paintSingleMarkCursor(graphic, worldX, worldY, { caster = null, range = null, tokens = null } = {})
{
    graphic.clear();
    const candidates = tokens ?? canvas.tokens.placeables;
    const hoveredToken = candidates.find(token =>
    {
        const bounds = token.bounds;
        return worldX >= bounds.left && worldX <= bounds.right && worldY >= bounds.top && worldY <= bounds.bottom;
    }) || null;
    const cursorCell = pixelToOffset(worldX, worldY);
    const rangeTarget = hoveredToken ?? getHexCenter(cursorCell.col, cursorCell.row);
    const outOfRange = range !== null && caster && !isPositionInRange(caster, rangeTarget, range);
    const color = outOfRange ? TG.outOfRange : (hoveredToken ? TG.target : TG.inRange);
    const gridSize = canvas.grid.size;
    const drawGeometry = (target) =>
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
    };
    paintWithHalo(graphic, drawGeometry, { color, lineWidth: hoveredToken ? 4 : 2, lineAlpha: 0.8, fillAlpha: hoveredToken ? 0.2 : 0.4 });
    return { hoveredToken, outOfRange };
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
        const followTick = () =>
        {
            if (!highlight || highlight.destroyed)
            {
                canvas.app.ticker.remove(followTick);
                return;
            }
            const key = _originPosKey(casterToken);
            if (key !== lastKey)
            {
                lastKey = key;
                paintRangeHighlight(highlight, _effectiveOrigin(casterToken), range, color, alpha, includeSelf, opts);
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
    const fadeTick = () =>
    {
        if (graphics.some(graphic => graphic.destroyed))
        {
            canvas.app.ticker.remove(fadeTick);
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
            const doneCallback = onFadeDone;
            onFadeDone = null;
            if (doneCallback)
                doneCallback();
        }
    };
    canvas.app.ticker.add(fadeTick);
    return () =>
    {
        if (fadeOutMs <= 0)
        {
            onDestroyed();
            return;
        }
        fadeStart = performance.now();
        fadeFrom = graphics[0]?.alpha ?? 1;
        fadeTo = 0;
        fadeDur = Math.max(1, fadeOutMs);
        onFadeDone = onDestroyed;
        canvas.app.ticker.add(fadeTick);
    };
}

// Gray range highlight with an animated wave pulse from one origin. Returns a destroy() fn.
export function createPulsingRangeHighlight(casterToken, range, { includeSelf = false, staticFillAlpha = RANGE_PULSE_STYLE.staticFillAlpha, staticLineAlpha = RANGE_PULSE_STYLE.staticLineAlpha, fadeInMs = 180, fadeOutMs = 180, glowColor = RANGE_GLOW.manual } = {})
{
    const rangeHighlight = drawRangeHighlight(casterToken, range, RANGE_PULSE_STYLE.baseColor, staticFillAlpha, includeSelf, { lineAlpha: staticLineAlpha, lineColor: RANGE_PULSE_STYLE.lineColor, glowColor });
    const pulseGraphic = new PIXI.Graphics();
    addGraphicsBelowTokens(pulseGraphic);
    const hexesByDist = _groupCellsByDistance(
        getOccupiedOffsets(casterToken),
        getInRangeOffsets(casterToken, range, { includeSelf: true })
    );
    const wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, range, { originToken: casterToken, glowColor });
    canvas.app.ticker.add(wavePulse);
    return createFadeInOut([rangeHighlight, pulseGraphic], { fadeInMs, fadeOutMs }, () =>
    {
        canvas.app.ticker.remove(wavePulse);
        destroyGraphics(rangeHighlight);
        destroyGraphics(pulseGraphic);
    });
}

// Merged range pulse from several origin tokens: the union of their in-range cells drawn once,
// with the wave emanating from the nearest origin. entries: [{token, range}]. Returns a destroy() fn.
export function createMergedRangeHighlight(entries, { includeSelf = false, staticFillAlpha = RANGE_PULSE_STYLE.staticFillAlpha, staticLineAlpha = RANGE_PULSE_STYLE.staticLineAlpha, fadeInMs = 180, fadeOutMs = 180, glowColor = RANGE_GLOW.manual } = {})
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
        for (const entry of entries)
        {
            const origin = entry.point ?? _effectiveOrigin(entry.token);
            const range = entry.range;
            for (const offset of originOffsetsFor(entry))
            {
                const key = `${offset.col},${offset.row}`;
                if (!seen.has(key))
                {
                    seen.add(key);
                    unionOrigins.push(offset);
                }
            }
            for (const key of getInRangeOffsets(origin, range, { includeSelf }))
                unionStatic.add(key);
            for (const key of getInRangeOffsets(origin, range, { includeSelf: true }))
                unionWave.add(key);
        }
        return { unionOrigins, unionStatic, unionWave };
    };

    const rangeHighlight = new PIXI.Graphics();
    addGraphicsBelowTokens(rangeHighlight);
    const pulseGraphic = new PIXI.Graphics();
    addGraphicsBelowTokens(pulseGraphic);

    let wavePulse = null;
    const rebuild = () =>
    {
        const { unionOrigins, unionStatic, unionWave } = buildUnions();
        rangeHighlight.clear();
        if (!_OUTLINE_ONLY)
            paintCellRegion(rangeHighlight, unionStatic, { color: RANGE_PULSE_STYLE.baseColor, alpha: staticFillAlpha, lineAlpha: staticLineAlpha, lineColor: RANGE_PULSE_STYLE.lineColor });
        paintPerimeterGlow(rangeHighlight, unionWave, { glowColor });
        const hexesByDist = _groupCellsByDistance(unionOrigins, unionWave);
        if (wavePulse)
            canvas.app.ticker.remove(wavePulse);
        wavePulse = _makeRangePulseTick(pulseGraphic, hexesByDist, waveRange, { originToken: null, glowColor });
        canvas.app.ticker.add(wavePulse);
    };
    rebuild();

    const posKey = () => entries.map(entry => entry.point ? `pt:${entry.point.x},${entry.point.y}` : (_originPosKey(entry.token) ?? 'pt')).join('|');
    let lastKey = posKey();
    const followTick = () =>
    {
        if (rangeHighlight.destroyed)
        {
            canvas.app.ticker.remove(followTick);
            return;
        }
        const key = posKey();
        if (key !== lastKey)
        {
            lastKey = key;
            rebuild();
        }
    };
    canvas.app.ticker.add(followTick);

    return createFadeInOut([rangeHighlight, pulseGraphic], { fadeInMs, fadeOutMs }, () =>
    {
        canvas.app.ticker.remove(followTick);
        if (wavePulse)
            canvas.app.ticker.remove(wavePulse);
        destroyGraphics(rangeHighlight);
        destroyGraphics(pulseGraphic);
    });
}

// Draw a move trace (start footprint, original end, optional corrected end) with connecting lines;
// broadcasts to other clients unless suppressed.
let _moveTraceSeq = 0;
export function drawMovementTrace(token, originalEndPos, newEndPos = null, { suppressBroadcast = false, path = null, newPath = null } = {})
{
    const trace = new PIXI.Graphics();
    const centerStart = token.center;
    const gridSize = canvas.grid.size;

    // Line follows the real move path when the caller has one; beeline otherwise.
    const polyline = (targetCenter, pathWps) =>
    {
        const points = [{ x: centerStart.x, y: centerStart.y }];
        for (const pathWp of Array.isArray(pathWps) ? pathWps : [])
            points.push({ x: pathWp.x + token.w / 2, y: pathWp.y + token.h / 2 });
        const last = points.at(-1);
        if (Math.round(last.x) !== Math.round(targetCenter.x) || Math.round(last.y) !== Math.round(targetCenter.y))
            points.push(targetCenter);
        return points;
    };
    const drawPolyline = (points) =>
    {
        trace.moveTo(points[0].x, points[0].y);
        for (let pointIdx = 1; pointIdx < points.length; pointIdx++)
            trace.lineTo(points[pointIdx].x, points[pointIdx].y);
    };

    const drawFootprint = (targetX, targetY, lineColor, fillColor) =>
    {
        trace.lineStyle(gridLineWidth(3), lineColor, 0.8);
        trace.beginFill(fillColor, 0.3);
        const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
        for (const cellOffset of offsets)
        {
            if (isHexGrid())
                drawHexAt(trace, cellOffset.col, cellOffset.row);
            else
            {
                const cellCenter = getHexCenter(cellOffset.col, cellOffset.row);
                trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
            }
        }
        trace.endFill();
    };

    drawFootprint(token.document.x, token.document.y, TG.traceStart, TG.traceStart);

    const originalColor = newEndPos ? 0xff0000 : TG.traceEnd;
    const centerOriginal = { x: originalEndPos.x + token.w/2, y: originalEndPos.y + token.h/2 };
    drawFootprint(originalEndPos.x, originalEndPos.y, originalColor, originalColor);

    const originalPoints = polyline(centerOriginal, path);
    trace.lineStyle(gridLineWidth(4), TG.traceLine, 0.5);
    drawPolyline(originalPoints);

    let newPoints = null;
    if (newEndPos)
    {
        const centerNew = { x: newEndPos.x + token.w/2, y: newEndPos.y + token.h/2 };
        drawFootprint(newEndPos.x, newEndPos.y, TG.traceEnd, TG.traceEnd);

        newPoints = polyline(centerNew, newPath);
        trace.lineStyle(gridLineWidth(4), TG.traceLine, 1);
        drawPolyline(newPoints);
    }

    addGraphicsBelowTokens(trace);

    // Mirror the trace to other clients (relay sites pass suppressBroadcast so only the origin broadcasts).
    if (!suppressBroadcast)
    {
        const kind = `moveTrace:${token.id}:${++_moveTraceSeq}`;
        const startCells = getOccupiedOffsets(token).map(offset => `${offset.col},${offset.row}`);
        const origCells = getOccupiedOffsets(token, { x: originalEndPos.x, y: originalEndPos.y }).map(offset => `${offset.col},${offset.row}`);
        const newCells = newEndPos ? getOccupiedOffsets(token, { x: newEndPos.x, y: newEndPos.y }).map(offset => `${offset.col},${offset.row}`) : [];
        const traceLines = [];
        for (let pointIdx = 1; pointIdx < originalPoints.length; pointIdx++)
            traceLines.push({ x1: originalPoints[pointIdx - 1].x, y1: originalPoints[pointIdx - 1].y, x2: originalPoints[pointIdx].x, y2: originalPoints[pointIdx].y });
        for (let pointIdx = 1; pointIdx < (newPoints?.length ?? 0); pointIdx++)
            traceLines.push({ x1: newPoints[pointIdx - 1].x, y1: newPoints[pointIdx - 1].y, x2: newPoints[pointIdx].x, y2: newPoints[pointIdx].y });
        const tracePresence = {
            originCells: startCells,
            cells: origCells,
            cellColor: originalColor,
            placedCells: newCells,
            placedColor: TG.traceEnd,
            originColor: TG.traceStart,
            lines: traceLines,
            lineColor: TG.traceLine,
            relatedToken: token,
        };
        broadcastToolPresence(kind, tracePresence);
        let destroyed = false; // guard a heartbeat tick that fires after destroy
        const stopTraceBeat = startToolHeartbeat(kind, () => destroyed ? null : tracePresence);
        const origDestroy = trace.destroy.bind(trace);
        trace.destroy = (...args) =>
        {
            destroyed = true;
            stopTraceBeat();
            clearToolPresence(kind);
            return origDestroy(...args);
        };
    }

    return trace;
}

export function getGridDistance(pos1, pos2)
{
    if (isHexGrid())
    {
        const offset1 = pixelToOffset(pos1.x, pos1.y);
        const offset2 = pixelToOffset(pos2.x, pos2.y);
        const cube1 = offsetToCube(offset1.col, offset1.row);
        const cube2 = offsetToCube(offset2.col, offset2.row);
        return cubeDistance(cube1, cube2);
    }
    else
    {
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
export function showOverlapStackPicker(tokens, screenX, screenY, { isSelected = () => false, onPick = () =>
{} } = {})
{
    let popupEl = null;
    let outsideHandler = null;
    let escHandler = null;
    const close = () =>
    {
        if (popupEl)
        {
            popupEl.remove(); popupEl = null;
        }
        if (outsideHandler)
        {
            document.removeEventListener('pointerdown', outsideHandler, true);
            outsideHandler = null;
        }
        if (escHandler)
        {
            document.removeEventListener('keydown', escHandler, true);
            escHandler = null;
        }
    };
    const el = document.createElement('div');
    el.className = 'la-stack-picker';
    el.style.cssText = `position:fixed;left:${screenX}px;top:${screenY}px;z-index:10000;background:#1c1c1c;border:2px solid #ff6400;border-radius:4px;padding:4px;min-width:160px;max-height:300px;overflow-y:auto;box-shadow:0 4px 12px rgba(0,0,0,0.5);font-family:Signika,sans-serif;`;
    for (const token of tokens)
    {
        const selected = !!isSelected(token);
        const row = document.createElement('div');
        row.style.cssText = `display:flex;align-items:center;gap:6px;padding:4px 6px;cursor:pointer;border-radius:3px;${selected ? 'background:rgba(255,100,0,0.25);' : ''}`;
        row.innerHTML = `
            <img src="${token.document.texture.src}" style="width:24px;height:24px;object-fit:contain;border:1px solid #555;border-radius:2px;background:#000;">
            <span style="color:#fff;font-size:0.9em;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${token.name}</span>
            ${selected ? '<i class="fas fa-check" style="color:#5cff5c;"></i>' : ''}`;
        row.addEventListener('mouseenter', () =>
        {
            row.style.background = 'rgba(255,100,0,0.4)';
        });
        row.addEventListener('mouseleave', () =>
        {
            row.style.background = selected ? 'rgba(255,100,0,0.25)' : 'transparent';
        });
        row.addEventListener('click', (event) =>
        {
            event.stopPropagation();
            onPick(token);
            close();
        });
        el.appendChild(row);
    }
    document.body.appendChild(el);
    popupEl = el;
    const rect = el.getBoundingClientRect();
    if (rect.right > window.innerWidth)
        el.style.left = `${Math.max(0, window.innerWidth - rect.width - 4)}px`;
    if (rect.bottom > window.innerHeight)
        el.style.top = `${Math.max(0, window.innerHeight - rect.height - 4)}px`;
    outsideHandler = (event) =>
    {
        if (popupEl && !popupEl.contains(/** @type {Node} */ (event.target)))
            close();
    };
    escHandler = (event) =>
    {
        if (event.key === 'Escape')
        {
            event.preventDefault(); close();
        }
    };
    setTimeout(() =>
    {
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
export function cancelRulerDrag(token, _moveInfo = null)
{
    const doc = token?.document;
    const history = doc?._source?._movementHistory;
    if (!Array.isArray(history) || history.length === 0)
        return;
    const currentX = doc.x, currentY = doc.y;
    let lastValidIdx = -1;
    for (let idx = history.length - 1; idx >= 0; idx--)
    {
        const waypoint = history[idx];
        if (Math.abs((waypoint.x ?? 0) - currentX) < 2 && Math.abs((waypoint.y ?? 0) - currentY) < 2)
        {
            lastValidIdx = idx; break;
        }
    }
    if (lastValidIdx === history.length - 1)
        return;
    const trimmed = history.slice(0, lastValidIdx + 1);
    try
    {
        doc.update({ _movementHistory: trimmed }, { diff: false });
    }
    catch (e)
    {
        console.warn('lancer-automations | cancelRulerDrag trim failed', e);
    }
}

/**
 * Apply pre-resolved knockback moves.
 * Used by knockBackToken (after the destination picker resolves) and the socket handler.
 * @param {Array<{tokenId: string, updateData: {x: number, y: number, elevation?: number, waypoints?: Array<object>}}>} moveList - Per-token resolved destinations.
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
export async function applyKnockbackMoves(moveList, triggeringToken, distance, actionName = "", item = null, options = {})
{
    if (!triggeringToken)
        console.warn("lancer-automations | applyKnockbackMoves called without a triggeringToken. Reactions using triggerSelf will not work correctly.");

    const asVoluntary = !!options.asVoluntary;
    const setElevation = !!options.setElevation;
    const api = game.modules.get('lancer-automations').api;

    const extraOpts = {
        ignoreMovementCap: true,
        _skipBoostOffer: true,
        useRuler: true,
        constrainOptions: { ignoreWalls: true, ignoreCost: true }
    };

    const terrainAPI = globalThis.terrainHeightTools;

    // Sequential: ER.moveTokenTo uses the singleton canvas.controls.ruler; parallel runs corrupt it.
    for (const { tokenId, updateData } of moveList)
    {
        const token = canvas.tokens.get(tokenId);
        if (!token)
            continue;

        if (!asVoluntary)
        {
            let cancelled = false;
            const cancel = (reason) =>
            {
                cancelled = true;
                if (reason)
                    ui.notifications.info(reason);
            };
            await api.handleTrigger('onInvoluntaryMove', {
                triggeringToken,
                token,
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
        if (typeof updateData.elevation === 'number')
            dest.elevation = updateData.elevation; // chosen in the picker (auto-ground + Q/E offset)
        else if (setElevation && terrainAPI)
        {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(token, dest))
            {
                const cellHeight = getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI);
                if (cellHeight > maxHeight)
                    maxHeight = cellHeight;
            }
            dest.elevation = maxHeight;
        }
        const legs = movePathLegs(updateData.waypoints, dest).map(leg => ({
            snapped: true,
            explicit: true,
            checkpoint: true,
            ...leg,
            ...((!asVoluntary && !leg.action) ? { action: 'forced' } : {})
        }));
        if (!asVoluntary)
            Hooks.callAll('lancer-automations.battelog.knockbackSource', { tokenId: token.id, sourceId: triggeringToken?.id });
        await _rulerMove(token, legs.length === 1 ? legs[0] : legs, extraOpts);
        await awaitMovementSettled(token.document);
    }
}
