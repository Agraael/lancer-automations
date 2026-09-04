/* global canvas, PIXI, game, ui, Hooks, document, CONST, ClipperLib, performance */

import {
    isHexGrid, offsetToCube, cubeDistance,
    getHexCenter, pixelToOffset, getHexVertices,
    drawHexAt, getOccupiedOffsets,
    getInRangeOffsets, isPositionInRange, neighborKeys
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import { hasLineOfSight, makeSkimRayCaster, getEyeWallSegments, makeEyeSolidTester } from "../vision/lancerDetectionModes.js";
import { getShapeSamplePoints, getTokenVisionLOS } from "../vision/visionFromEdge.js";
import { getSettingEnabled } from "../setup/settings-register.js";
import { blindedVisionEnabled } from "../vision/blindedVision.js";
import { getIsoProvider } from "../setup/iso-settings.js";
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
    deploy: 0x74e08a,
};

/** Resolves a glow key ('sensor') or a raw color to a RANGE_GLOW value. */
export function resolveRangeGlow(glow, fallback = RANGE_GLOW.manual)
{
    if (typeof glow === 'number')
        return glow;
    if (typeof glow === 'string' && glow in RANGE_GLOW)
        return RANGE_GLOW[glow];
    return fallback;
}

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

// Shared range-pulse styling. Tune here; used by every range-pulse builder + the picker.
export const RANGE_PULSE_STYLE = {
    baseColor: 0x888888,
    lineColor: 0xFFFFFF,
    staticFillAlpha: 0.0125,
    staticLineAlpha: 0.0125,
    perimeterAlpha: 0.6,
    pulseSpeed: 1,
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
    ['color.glowDeploy', RANGE_GLOW, 'deploy', 'Deploy'],
    ['color.pulseLine', RANGE_PULSE_STYLE, 'lineColor', 'Pulse Line'],
];

// Ruler speed-tier color keys; listed here so Colors-tab reset covers them too.
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

/**
 * Restore the palette colors, the ruler colors and any extra keys to their registered defaults,
 * mirroring onto whatever inputs the settings menu currently has open.
 * @param {string[]} [extraKeys] Additional setting keys on the same tab (sliders, selects).
 */
export async function resetPaletteColorSettings(extraKeys = [])
{
    const keys = [...new Set([..._PALETTE_DEFS.map(([key]) => key), ...RULER_COLOR_KEYS, ...extraKeys])];
    for (const key of keys)
    {
        const registered = game.settings.settings.get(`lancer-automations.${key}`);
        const defaultValue = registered?.default;
        if (defaultValue == null)
            continue;
        await game.settings.set('lancer-automations', key, defaultValue);
        const input = /** @type {HTMLInputElement|null} */ (document.querySelector(`[name="${key}"]`));
        if (!input)
            continue;
        input.value = String(defaultValue);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
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

/** Disable token interactivity + layer left-click for a canvas tool; returns the restore fn. */
export function suppressTokenInteraction()
{
    const prevInteractive = canvas.tokens.interactiveChildren;
    canvas.tokens.interactiveChildren = false;
    const restoreLayerClick = suppressTokenLayerClick();
    return () =>
    {
        canvas.tokens.interactiveChildren = prevInteractive;
        restoreLayerClick();
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
    if (!graphic || graphic.destroyed)
        return;
    if (graphic.labelLayer)
        destroyGraphics(graphic.labelLayer);
    if (graphic.parent)
        graphic.parent.removeChild(graphic);
    graphic.destroy({ children: true });
}

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

/** Shared picker-session scaffold: safe()-wrapped stage/document handlers, one-call bind, canonical-order unbind. */
export function createPickerSession(label, onCrash)
{
    const safe = makeSafe(label, onCrash);
    let handlers = null;
    return {
        safe,
        // clickFirst preserves moveToken's click-before-pointermove attach order.
        bind({ move, click, key, wheel = null, rightClick = null, clickFirst = false })
        {
            handlers = { move: safe(move), click: safe(click), key: safe(key), wheel: wheel ? safe(wheel) : null, rightClick: rightClick ? safe(rightClick) : null };
            if (clickFirst)
            {
                canvas.stage.on('click', handlers.click);
                canvas.stage.on('pointermove', handlers.move);
            }
            else
            {
                canvas.stage.on('pointermove', handlers.move);
                canvas.stage.on('click', handlers.click);
            }
            if (handlers.rightClick)
                canvas.stage.on('rightdown', handlers.rightClick);
            document.addEventListener('keydown', handlers.key, true);
            // Capture phase + non-passive so wheel handlers can preventDefault before Foundry's canvas zoom listener.
            if (handlers.wheel)
                document.addEventListener('wheel', handlers.wheel, { capture: true, passive: false });
        },
        unbind()
        {
            if (!handlers)
                return;
            canvas.stage.off('click', handlers.click);
            canvas.stage.off('pointermove', handlers.move);
            if (handlers.rightClick)
                canvas.stage.off('rightdown', handlers.rightClick);
            document.removeEventListener('keydown', handlers.key, true);
            if (handlers.wheel)
                document.removeEventListener('wheel', handlers.wheel, { capture: true });
            handlers = null;
        },
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

export function isShiftDown(event = null)
{
    if (event?.shiftKey ?? event?.data?.originalEvent?.shiftKey)
        return true;
    return !!(game.keyboard?.downKeys?.has('ShiftLeft') || game.keyboard?.downKeys?.has('ShiftRight'));
}

export function isCtrlDown(event = null)
{
    if (event?.ctrlKey ?? event?.data?.originalEvent?.ctrlKey)
        return true;
    return !!(game.keyboard?.downKeys?.has('ControlLeft') || game.keyboard?.downKeys?.has('ControlRight'));
}

// A small green "+" near the cursor while the modifier is held, signalling multi add/select mode.
// Call move(modifierHeld, x, y) from the picker's pointermove; it also tracks the modifier's keydown/keyup.
export function createMultiPlusIndicator({ modifier = 'Shift' } = {})
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
    const place = (modifierHeld) =>
    {
        if (modifierHeld && lastCursorPos)
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
        if (event.key === modifier)
            place(event.type === 'keydown');
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('keyup', onKey, true);
    return {
        move(modifierHeld, x, y)
        {
            lastCursorPos = { x, y };
            place(modifierHeld);
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

export function drawDashedEdges(graphic, edges, dash, gap, phase)
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
            graphic.moveTo(from.x + ux * start, from.y + uy * start);
            graphic.lineTo(from.x + ux * end, from.y + uy * end);
        }
    }
}

/**
 * Marching-dash tether between token pairs, drawn in the token layer. Same look as the deployable link.
 * @param {{color?: number, alpha?: number}} options
 * @returns {{setPairs: (pairs: any[][]) => void, destroy: () => void}}
 */
export function createTokenTether({ color = TG.reference, alpha = 0.7 } = {})
{
    const graphic = new PIXI.Graphics();
    graphic.eventMode = 'none';
    canvas.tokens.addChild(graphic);
    let pairs = [];
    const redraw = () =>
    {
        if (graphic.destroyed)
            return;
        graphic.clear();
        if (!pairs.length)
            return;
        const edges = [];
        for (const [from, to] of pairs)
        {
            if (from?.center && to?.center && from.id !== to.id)
                edges.push([from.center, to.center]);
        }
        if (!edges.length)
            return;
        const dash = canvas.grid.size * 0.16;
        const gap = canvas.grid.size * 0.14;
        const phase = -performance.now() * 0.02;
        paintWithHalo(graphic, () => drawDashedEdges(graphic, edges, dash, gap, phase), {
            color,
            lineWidth: 2,
            lineAlpha: alpha,
        });
    };
    canvas.app.ticker.add(redraw);
    return {
        setPairs(next)
        {
            pairs = next ?? [];
        },
        destroy()
        {
            canvas.app.ticker.remove(redraw);
            destroyGraphics(graphic);
        },
    };
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
    const iso = getIsoProvider();
    if (iso)
    {
        pixiText.rotation = iso.reverseRotation;
        pixiText.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        pixiText.scale.set(iso.counterScale, 1 / iso.counterScale);
    }
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

const ISO_HIT_LABEL_LIFT = 0.8;

/** Hit-% label anchor: above the projected sprite on iso scenes, cell top otherwise. */
export function hitLabelAnchor(token)
{
    const gap = gridLineWidth(3);
    const iso = getIsoProvider();
    const mesh = token?.mesh;
    if (iso && mesh && !mesh.destroyed)
    {
        const zoom = canvas.stage.scale.x || 1;
        const screen = canvas.stage.worldTransform.apply(new PIXI.Point(mesh.position.x, mesh.position.y));
        screen.y -= ((token.h ?? canvas.grid.size) * ISO_HIT_LABEL_LIFT + gap) * zoom;
        return canvas.stage.worldTransform.applyInverse(screen);
    }
    return { x: token.center.x, y: token.bounds.top - gap };
}

/** Hit-% text label, bottom-center anchored and non-interactive, added to the given container. */
export function makeHitLabel(container)
{
    const label = makeText('', HIT_LABEL_STYLE);
    label.style.fontSize = hitLabelFontSize();
    label.anchor.set(0.5, 1);
    label.eventMode = 'none';
    container.addChild(label);
    return label;
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

// Client-tunable thickness multiplier for the wave line + its black outline (Colors tab).
function _rangePulseWidthMul()
{
    try
    {
        return Number(game.settings.get('lancer-automations', 'rangePulseLineWidth')) || 1;
    }
    catch
    {
        return 1;
    }
}

function _rangePulseSetting(settingKey, fallback)
{
    try
    {
        return String(game.settings.get('lancer-automations', settingKey) || fallback);
    }
    catch
    {
        return fallback;
    }
}

function _cellCorners(col, row)
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

function _cellColRow(cell)
{
    if (typeof cell === 'string')
    {
        const parts = cell.split(',');
        return { col: Number(parts[0]), row: Number(parts[1]) };
    }
    return { col: cell.col, row: cell.row };
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

// The baked static alpha is near zero, so the slider is the grid line alpha itself.
export function _staticGridAlpha(baseAlpha)
{
    return baseAlpha ? _rangePulseOpacity('rangePulseLineOpacity') : 0;
}

function _pulseLosEnabled()
{
    return getSettingEnabled('rangePulseLos');
}

export function isPulseLosEnabled()
{
    return _pulseLosEnabled();
}

// A cell counts while its center is on the map, so hexes at least half inside stay valid.
function _cellOnMap(col, row, rect)
{
    if (!rect)
        return true;
    const center = getHexCenter(col, row);
    return center.x >= rect.x && center.x <= rect.x + rect.width
        && center.y >= rect.y && center.y <= rect.y + rect.height;
}

// Centre plus slightly inset corners, so a hex partially peeking past a wall still counts.
function _hexTestPoints(col, row)
{
    const center = getHexCenter(col, row);
    const points = [center];
    for (const corner of _cellCorners(col, row))
        points.push({ x: center.x + (corner.x - center.x) * 0.9, y: center.y + (corner.y - center.y) * 0.9 });
    return points;
}

/** Foundry sweeps from the token's shape corner samples plus its center, one sweep per origin. */
function _visibilityTester(originToken)
{
    try
    {
        let origins;
        try
        {
            origins = getShapeSamplePoints(originToken);
        }
        catch
        {
            origins = null;
        }
        origins = [...(origins ?? []), originToken.center];
        const eyeElevation = originToken.losHeight ?? getTokenVisionLOS(originToken);
        // without a vision source (uncontrolled token), wall-height's edge filter needs an object carrying b/t
        const sourceOpt = originToken.vision
            ? { source: originToken.vision }
            : { source: { object: { b: eyeElevation, t: eyeElevation } }, b: eyeElevation, t: eyeElevation };
        const built = origins.map(point => ({
            origin: point,
            sweep: CONFIG.Canvas.polygonBackends.sight.create({ x: point.x, y: point.y, elevation: eyeElevation }, { type: 'sight', ...sourceOpt }),
        }));
        const tester = (x, y) => built.some(entry => entry.sweep.contains(x, y));
        tester.built = built;
        return tester;
    }
    catch (err)
    {
        console.warn('lancer-automations | LOS tester failed:', err);
        return null;
    }
}

function _isBlinded(token)
{
    try
    {
        return blindedVisionEnabled() && token?.actor?.statuses?.has?.('blinded') === true;
    }
    catch
    {
        return false;
    }
}

// Each shape corner traces its tangent skim line: perpendicular to the center-to-corner axis, through the corner, extended both ways.
function _skimWalks(origin)
{
    const shapePoints = origin.getShape?.()?.points;
    if (!shapePoints?.length)
        return [];
    const center = origin.center;
    const walks = [];
    for (let idx = 0; idx < shapePoints.length; idx += 2)
    {
        const vertex = { x: shapePoints[idx] + origin.x, y: shapePoints[idx + 1] + origin.y };
        const radX = vertex.x - center.x;
        const radY = vertex.y - center.y;
        const len = Math.hypot(radX, radY);
        if (!len)
            continue;
        walks.push({ vertex, dirX: -radY / len, dirY: radX / len });
        walks.push({ vertex, dirX: radY / len, dirY: -radX / len });
    }
    return walks;
}

const _SKIM_PERP = 5;

// The card's green line: tangent walks from the corners while the ray stays clear, each step's side points nominating hexes granted only when their centers pass the same rules.
function _skimLineCells(origin)
{
    const caster = makeSkimRayCaster(origin);
    if (!caster)
        return null;
    const eyeEdges = getEyeWallSegments(origin);
    const inEyeSolid = makeEyeSolidTester(origin) ?? (() => false);
    const centerReachable = (fromPoint, centerPoint) =>
        !inEyeSolid(centerPoint)
        && !eyeEdges.some(seg => foundry.utils.lineSegmentIntersects(fromPoint, centerPoint, seg.a, seg.b));
    const cells = new Set();
    const step = canvas.grid.size / 2;
    const maxDist = canvas.grid.size * 25;
    const sceneRect = canvas.dimensions?.sceneRect ?? null;
    for (const walk of _skimWalks(origin))
    {
        // a single blocked step is a graze artifact of the sampling; a real crossing blocks every step after it
        let misses = 0;
        for (let dist = 0; dist <= maxDist; dist += step)
        {
            const to = { x: walk.vertex.x + walk.dirX * dist, y: walk.vertex.y + walk.dirY * dist };
            if (sceneRect && (to.x < sceneRect.x || to.x > sceneRect.x + sceneRect.width || to.y < sceneRect.y || to.y > sceneRect.y + sceneRect.height))
                break;
            if (dist > 0 && !caster(walk.vertex, to))
            {
                misses += 1;
                if (misses >= 2)
                    break;
                continue;
            }
            misses = 0;
            const sideA = { x: to.x - walk.dirY * _SKIM_PERP, y: to.y + walk.dirX * _SKIM_PERP };
            const sideB = { x: to.x + walk.dirY * _SKIM_PERP, y: to.y - walk.dirX * _SKIM_PERP };
            // the walk earns the cell; the raw crossing test only refuses centers behind a wall (the corner loophole)
            for (const sidePoint of [sideA, sideB])
            {
                const cell = pixelToOffset(sidePoint.x, sidePoint.y);
                const cellCenter = getHexCenter(cell.col, cell.row);
                if (centerReachable(sidePoint, cellCenter))
                    cells.add(`${cell.col},${cell.row}`);
            }
        }
    }
    return cells;
}

// Debug: laSkimDraw() overlays the skim walks for the controlled token; green = clear walk, ticks = perpendicular casts (green grants, red blocked), red dot = stop.
globalThis.laSkimDraw = () =>
{
    const existing = /** @type {any} */ (globalThis)._laSkimGfx;
    if (existing && !existing.destroyed)
    {
        existing.destroy({ children: true });
        /** @type {any} */ (globalThis)._laSkimGfx = null;
        return 'skim debug off';
    }
    const origin = canvas.tokens.controlled[0] ?? null;
    if (!origin)
    {
        console.warn('laSkimDraw: select a token');
        return null;
    }
    const caster = makeSkimRayCaster(origin);
    if (!caster)
        return null;
    const eyeEdges = getEyeWallSegments(origin);
    const inEyeSolid = makeEyeSolidTester(origin) ?? (() => false);
    const centerReachable = (fromPoint, centerPoint) =>
        !inEyeSolid(centerPoint)
        && !eyeEdges.some(seg => foundry.utils.lineSegmentIntersects(fromPoint, centerPoint, seg.a, seg.b));
    const gfx = new PIXI.Graphics();
    canvas.stage.addChild(gfx).eventMode = 'none';
    /** @type {any} */ (globalThis)._laSkimGfx = gfx;
    const step = canvas.grid.size / 2;
    const maxDist = canvas.grid.size * 25;
    const sceneRect = canvas.dimensions?.sceneRect ?? null;
    const litCells = new Set();
    const tickRows = [];
    for (const walk of _skimWalks(origin))
    {
        let prev = walk.vertex;
        let misses = 0;
        for (let dist = 0; dist <= maxDist; dist += step)
        {
            const to = { x: walk.vertex.x + walk.dirX * dist, y: walk.vertex.y + walk.dirY * dist };
            if (sceneRect && (to.x < sceneRect.x || to.x > sceneRect.x + sceneRect.width || to.y < sceneRect.y || to.y > sceneRect.y + sceneRect.height))
                break;
            if (dist > 0)
            {
                if (!caster(walk.vertex, to))
                {
                    misses += 1;
                    if (misses >= 2)
                    {
                        gfx.lineStyle(2, 0xff3333, 0.9);
                        gfx.moveTo(prev.x, prev.y);
                        gfx.lineTo(to.x, to.y);
                        gfx.beginFill(0xff3333, 1).drawCircle(to.x, to.y, 4).endFill();
                        const reasonText = new PIXI.Text(/** @type {any} */ (caster).ctx?.lastReason ?? '?', {
                            fontFamily: 'monospace', fontSize: 11, fill: 0xff5555, stroke: 0x000000, strokeThickness: 3,
                        });
                        reasonText.anchor.set(0.5, 1.2);
                        reasonText.position.set(to.x, to.y);
                        gfx.addChild(reasonText);
                        break;
                    }
                    continue;
                }
                misses = 0;
                gfx.lineStyle(2, 0x33ff66, 0.9);
                gfx.moveTo(prev.x, prev.y);
                gfx.lineTo(to.x, to.y);
            }
            for (const side of [
                { x: to.x - walk.dirY * _SKIM_PERP, y: to.y + walk.dirX * _SKIM_PERP },
                { x: to.x + walk.dirY * _SKIM_PERP, y: to.y - walk.dirX * _SKIM_PERP },
            ])
            {
                const cell = pixelToOffset(side.x, side.y);
                const cellCenter = getHexCenter(cell.col, cell.row);
                const open = centerReachable(side, cellCenter);
                gfx.lineStyle(1, open ? 0x33ff66 : 0xff3333, 0.9);
                gfx.moveTo(to.x, to.y);
                gfx.lineTo(side.x, side.y);
                if (open)
                    litCells.add(`${cell.col},${cell.row}`);
                else
                {
                    tickRows.push({
                        x: Math.round(to.x), y: Math.round(to.y),
                        reason: 'crossed',
                    });
                }
            }
            prev = to;
        }
    }
    gfx.lineStyle(0);
    gfx.beginFill(0x33ff66, 0.15);
    for (const keyStr of litCells)
    {
        const [col, row] = keyStr.split(',').map(Number);
        gfx.drawPolygon(_cellCorners(col, row).flatMap(corner => [corner.x, corner.y]));
    }
    gfx.endFill();
    console.log(`laSkimDraw: ${litCells.size} cells lit by skim lines`);
    if (tickRows.length)
        console.table(tickRows);
    return litCells;
};

// Debug: laAreaDraw(range) measures how much of each refused hex is really lit, per eye, via Clipper.
// Amber = a real band the pulse is missing, red = a sliver it is right to refuse. Grants nothing.
globalThis.laAreaDraw = (range = 10) =>
{
    const existing = /** @type {any} */ (globalThis)._laAreaGfx;
    if (existing && !existing.destroyed)
    {
        existing.destroy({ children: true });
        /** @type {any} */ (globalThis)._laAreaGfx = null;
        return 'area debug off';
    }
    const origin = canvas.tokens.controlled[0] ?? null;
    if (!origin)
    {
        console.warn('laAreaDraw: select a token');
        return null;
    }
    const visible = _visibilityTester(origin);
    const built = /** @type {any} */ (visible)?.built ?? [];
    if (!built.length)
        return null;
    const scale = CONST.CLIPPER_SCALING_FACTOR;
    const clipPaths = built.map(entry => entry.sweep.toClipperPoints({ scalingFactor: scale }));
    const gfx = new PIXI.Graphics();
    canvas.stage.addChild(gfx).eventMode = 'none';
    /** @type {any} */ (globalThis)._laAreaGfx = gfx;
    const started = performance.now();
    const rows = [];
    // Foundry's own polygon, to separate coarse sampling from actually seeing less
    const foundryLos = /** @type {any} */ (origin).vision?.los ?? null;
    let mismatches = 0;
    // the real filter, so the overlay can never disagree with the pulse
    const inRange = getInRangeOffsets(origin, range, { includeSelf: true });
    const pulseKeys = new Set(makePulseCellFilter(origin, { los: true })(inRange).map(cell =>
    {
        const offset = _cellColRow(cell);
        return `${offset.col},${offset.row}`;
    }));
    for (const cell of inRange)
    {
        const { col, row } = _cellColRow(cell);
        const granted = pulseKeys.has(`${col},${row}`);
        const hexPoints = _cellCorners(col, row).flatMap(corner => [corner.x, corner.y]);
        const hexPolygon = new PIXI.Polygon(hexPoints);
        const hexArea = Math.abs(hexPolygon.signedArea());
        if (!hexArea)
            continue;
        // per eye, never the union
        let bestLit = 0;
        let bestEye = -1;
        for (let index = 0; index < clipPaths.length; index++)
        {
            const solution = hexPolygon.intersectClipper(clipPaths[index], { scalingFactor: scale });
            const litArea = Math.abs(ClipperLib.JS.AreaOfPolygons(solution, scale));
            if (litArea > bestLit)
            {
                bestLit = litArea;
                bestEye = index;
            }
        }
        const percent = Math.round((bestLit / hexArea) * 1000) / 10;
        const center = getHexCenter(col, row);
        const foundrySees = foundryLos ? foundryLos.contains(center.x, center.y) : false;
        const band = percent >= 20;
        gfx.lineStyle(0).beginFill(granted ? 0x33ff66 : (band ? 0xffaa22 : 0xff3333), granted ? 0.13 : 0.22);
        gfx.drawPolygon(hexPoints);
        gfx.endFill();
        if (foundrySees && !granted)
        {
            mismatches++;
            gfx.lineStyle(3, 0x33aaff, 0.9);
            gfx.drawPolygon(hexPoints);
            gfx.lineStyle(0);
        }
        const label = new PIXI.Text(`${percent}%`, {
            fontFamily: 'monospace', fontSize: 12,
            fill: granted ? 0x99ffbb : (band ? 0xffcc55 : 0xff6666), stroke: 0x000000, strokeThickness: 3,
        });
        label.anchor.set(0.5);
        label.position.copyFrom(center);
        gfx.addChild(label);
        rows.push({ col, row, percent, granted, foundrySees, eye: bestEye });
    }
    rows.sort((first, second) => second.percent - first.percent);
    const grantedCount = rows.filter(entry => entry.granted).length;
    console.log(`laAreaDraw: ${rows.length} cells, ${grantedCount} granted (green), ${mismatches} refused but inside Foundry's own vision (blue outline), ${Math.round(performance.now() - started)} ms`);
    if (rows.length)
        console.table(rows);
    return rows;
};

// The Lancer token test wins both ways: a seen token keeps its cells, an unseen one voids them.
function _tokenCellKeys(originToken)
{
    const seen = new Set();
    const blocked = new Set();
    for (const token of canvas.tokens?.placeables ?? [])
    {
        if (token === originToken || token.document?.id === originToken.document?.id)
            continue;
        let visible;
        try
        {
            visible = hasLineOfSight(originToken, token);
        }
        catch
        {
            continue;
        }
        const target = visible ? seen : blocked;
        for (const offset of getOccupiedOffsets(token))
            target.add(`${offset.col},${offset.row}`);
    }
    return { seen, blocked };
}

// Below 3.5% a shadow line would have touched one of the 7 test points, so above it is a real band.
const AREA_GRANT_FRACTION = 0.10;

// Per eye, never the union: one eye seeing a band is the claim, several eyes grazing a sliver is not.
function _hexLitFraction(col, row, clipPaths, scale)
{
    const hexPoints = _cellCorners(col, row).flatMap(corner => [corner.x, corner.y]);
    const hexPolygon = new PIXI.Polygon(hexPoints);
    const hexArea = Math.abs(hexPolygon.signedArea());
    if (!hexArea)
        return 0;
    let bestLit = 0;
    for (const clipPath of clipPaths)
    {
        const solution = hexPolygon.intersectClipper(clipPath, { scalingFactor: scale });
        const litArea = Math.abs(ClipperLib.JS.AreaOfPolygons(solution, scale));
        if (litArea > bestLit)
            bestLit = litArea;
    }
    return bestLit / hexArea;
}

// The highlight and the wave rings ask for the same origin and options, so one build shares the filter.
let _pulseFilterScope = null;

/**
 * Shares cell filters across one build. Must stay synchronous: _visibilityTester reads origin.vision,
 * which flips on control with no invalidation.
 * @template T
 * @param {() => T} build
 * @returns {T}
 */
export function withPulseFilterScope(build)
{
    const previousScope = _pulseFilterScope;
    _pulseFilterScope = previousScope ?? new Map();
    try
    {
        return build();
    }
    finally
    {
        _pulseFilterScope = previousScope;
    }
}

/**
 * Cell gate for every range pulse. Off-map cells always drop. Line of sight only applies
 * when the caller asked for it and the experimental setting is on.
 * `freeRange` is the reach of the best weapon that needs no line of sight (Arcing / Seeking):
 * cells inside it always pass, so a merged reach only tests the hexes beyond it.
 * @param {any} originToken
 * @param {{ los?: boolean, freeRange?: number }} [options]
 * @returns {(cells: any[]) => any[]}
 */
export function makePulseCellFilter(originToken, { los = false, freeRange = 0 } = {})
{
    const origin = _effectiveOrigin(originToken);
    const scope = _pulseFilterScope;
    let freeMap = null;
    if (scope)
    {
        let losMap = scope.get(origin);
        if (!losMap)
        {
            losMap = new Map();
            scope.set(origin, losMap);
        }
        freeMap = losMap.get(los);
        if (!freeMap)
        {
            freeMap = new Map();
            losMap.set(los, freeMap);
        }
        const shared = freeMap.get(freeRange);
        if (shared)
            return shared;
    }
    const rect = canvas.dimensions?.sceneRect ?? null;
    const useLos = los && _pulseLosEnabled() && !!origin?.document;
    const freeCells = useLos && freeRange > 0
        ? new Set(getInRangeOffsets(origin, freeRange, { includeSelf: true }))
        : null;
    // Blinded cuts line of sight to 1, so nothing beyond the adjacent ring is reachable at all.
    const blindedCells = useLos && _isBlinded(origin)
        ? new Set(getInRangeOffsets(origin, 1, { includeSelf: true }))
        : null;
    const visible = useLos && !blindedCells ? _visibilityTester(origin) : null;
    const tokenCells = useLos && visible ? _tokenCellKeys(origin) : null;
    const skimCells = useLos && visible ? _skimLineCells(origin) : null;
    const clipPaths = visible?.built
        ? visible.built.map(entry => entry.sweep.toClipperPoints({ scalingFactor: CONST.CLIPPER_SCALING_FACTOR }))
        : null;
    const areaCache = new Map();
    // a band always touches what it comes from, so measure only next to a lit cell
    const areaGrants = (col, row, key, litKeys) =>
    {
        let nextToLit = false;
        for (const neighborKey of neighborKeys(key))
        {
            if (litKeys.has(neighborKey))
            {
                nextToLit = true;
                break;
            }
        }
        if (!nextToLit)
            return false;
        // cache the measurement only: the frontier check above changes as cells light up
        let fraction = areaCache.get(key);
        if (fraction === undefined)
        {
            fraction = _hexLitFraction(col, row, clipPaths, CONST.CLIPPER_SCALING_FACTOR);
            areaCache.set(key, fraction);
        }
        return fraction >= AREA_GRANT_FRACTION;
    };
    // cells arrive as {col,row} objects from the ring builder and as "col,row" strings from getInRangeOffsets
    // the glow pass re-filters the same disc; 1 = kept, 0 = dropped, 2 = waiting on the area pass
    const verdicts = new Map();
    const litKeys = new Set();
    const cellFilter = (cells) =>
    {
        const kept = [];
        const deferred = [];
        for (const cell of cells)
        {
            const { col, row } = _cellColRow(cell);
            if (!Number.isFinite(col) || !Number.isFinite(row))
                continue;
            if (!_cellOnMap(col, row, rect))
                continue;
            const key = `${col},${row}`;
            const cachedVerdict = verdicts.get(key);
            if (cachedVerdict !== undefined)
            {
                if (cachedVerdict === 1)
                    kept.push(cell);
                else if (cachedVerdict === 2)
                    deferred.push({ cell, col, row, key });
                continue;
            }
            if (freeCells?.has(key))
            {
                verdicts.set(key, 1);
                kept.push(cell);
                continue;
            }
            if (blindedCells)
            {
                const inRing = blindedCells.has(key);
                verdicts.set(key, inRing ? 1 : 0);
                if (inRing)
                    kept.push(cell);
                continue;
            }
            if (!visible)
            {
                verdicts.set(key, 1);
                kept.push(cell);
                continue;
            }
            if (tokenCells?.seen.has(key))
            {
                verdicts.set(key, 1);
                kept.push(cell);
                continue;
            }
            if (tokenCells?.blocked.has(key))
            {
                verdicts.set(key, 0);
                continue;
            }
            if (_hexTestPoints(col, row).some(point => visible(point.x, point.y)))
            {
                verdicts.set(key, 1);
                kept.push(cell);
                litKeys.add(key);
                continue;
            }
            if (skimCells?.has(key))
            {
                verdicts.set(key, 1);
                kept.push(cell);
                litKeys.add(key);
                continue;
            }
            if (clipPaths)
            {
                verdicts.set(key, 2);
                deferred.push({ cell, col, row, key });
                continue;
            }
            verdicts.set(key, 0);
        }
        // sweep the frontier until it stops growing
        let grew = deferred.length > 0;
        while (grew)
        {
            grew = false;
            for (let index = deferred.length - 1; index >= 0; index--)
            {
                const pending = deferred[index];
                if (!areaGrants(pending.col, pending.row, pending.key, litKeys))
                    continue;
                verdicts.set(pending.key, 1);
                kept.push(pending.cell);
                litKeys.add(pending.key);
                deferred.splice(index, 1);
                grew = true;
            }
        }
        return kept;
    };
    freeMap?.set(freeRange, cellFilter);
    return cellFilter;
}

/** Blend two packed hex colors, k = 0 keeps `from`, k = 1 gives `to`. */
function _mixColor(from, to, k)
{
    const red = Math.round(((from >> 16) & 0xff) + ((((to >> 16) & 0xff)) - ((from >> 16) & 0xff)) * k);
    const green = Math.round(((from >> 8) & 0xff) + ((((to >> 8) & 0xff)) - ((from >> 8) & 0xff)) * k);
    const blue = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * k);
    return (red << 16) | (green << 8) | blue;
}

/** Speed multiplier shared by the continuous wave and the one shot bloom. */
function _rangePulseSpeed()
{
    try
    {
        const speed = Number(game.settings.get('lancer-automations', 'rangePulseSpeed'));
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
        const opacity = Number(game.settings.get('lancer-automations', settingKey));
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
        msPerCell = 300,
        slowRangeThreshold = 5,
        slowFloorMs = 2400,
        ringWidth = 2,     // rings ahead of the wave that pre-fade in
        trailWidth = 2,    // rings behind the wave that fade out (the tail)
        lineWidth = 1.2,
        lineAlphaMul = 6,
        originToken = null,
        glowColor = RANGE_GLOW.manual,
        los = false,
        freeRange = 0,
    } = opts;
    // keep the bands narrower than the range, else they cover every ring at once and it all lights together
    const leadWidth = Math.min(ringWidth, Math.max(1, range === 2 ? 2 : range - 1));
    const tailWidth = Math.min(trailWidth, Math.max(1, range === 2 ? 2 : range - 1));
    const basePeriod = msPerCell * (range + 1 + tailWidth);
    const rawPeriod = opts.periodMs ?? (range < slowRangeThreshold ? Math.max(slowFloorMs, basePeriod) : basePeriod);
    const speedMul = _rangePulseSpeed();
    const periodMs = rawPeriod / Math.max(0.01, RANGE_PULSE_STYLE.pulseSpeed * speedMul);
    const gridScale = canvas.grid.size / 100; // line widths are calibrated on a 100px grid
    const widthMul = _rangePulseWidthMul();
    const opacityMul = _rangePulseOpacity('rangePulseWaveOpacity');
    const pulseStyle = _rangePulseSetting('rangePulseStyle', 'inset');
    const pulseMotion = _rangePulseSetting('rangePulseMotion', 'bloom');
    const bloomStagger = BLOOM_STEP_MS / speedMul;
    const bloomRise = BLOOM_RISE_MS / speedMul;
    const coolCoreColor = glowColor === null ? lineColor : _mixColor(lineColor, glowColor, HOT_CORE_COOL_MIX);
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

const BLOCKED_CONTOUR_ALPHA = 0.35;

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

// Highlights hovered token (cyan/red if OOR) or cursor cell (blue); returns hovered token.
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

// Footprint + polyline trace for a move; broadcasts to other clients unless suppressed.
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
            onPick(token, event);
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
 *   `action: 'forced'` move flag (treat the displacement as a voluntary move).
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

        if (token.actor?.statuses?.has?.('immovable'))
            ui.notifications.warn(`${token.name} is IMMOVABLE and is being moved anyway.`);

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
