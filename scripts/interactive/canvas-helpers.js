/* global canvas, PIXI, game, ui, Hooks, document, performance */

import { TG } from "./canvas-palette.js";
export { TG, RANGE_GLOW, resolveRangeGlow, RANGE_PULSE_STYLE, resetPaletteColorSettings } from "./canvas-palette.js";
import {
    isHexGrid, offsetToCube, cubeDistance,
    getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
    isPositionInRange
} from "../combat/grid-helpers.js";
import { _cellCorners } from "./pulse-los-filter.js";
export { isPulseLosEnabled, withPulseFilterScope, makePulseCellFilter } from "./pulse-los-filter.js";
import { getIsoProvider } from "../setup/iso-settings.js";
export { drawMovementTrace, cancelRulerDrag, applyKnockbackMoves } from "./move-helpers.js";
import { destroyGraphics, gridLineWidth, drawDashedEdges, paintWithHalo, makeText } from "./canvas-primitives.js";
export {
    destroyGraphics, addGraphicsBelowTokens, addGraphicsAboveTokens, _paintCells, gridLineWidth,
    drawDashedEdges, paintWithHalo, gridTextResolution, makeText,
} from "./canvas-primitives.js";
export {
    teardownRangePulse, _groupCellsByDistance, _staticGridAlpha, _makeRangePulseTick,
    paintCellRegion, _perimeterEdges, paintPerimeterGlow, paintBlockedRangeContour, paintRangeHighlight,
    drawRangeHighlight, createFadeInOut, createPulsingRangeHighlight, createMergedRangeHighlight,
} from "./range-highlight.js";

// Fully stop a DOM/Foundry event (default + both propagations).
export function suppressEvent(event)
{
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
}

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
            console.error(`lancer-automations | ${label} handler crash, cleaning up:`, e);
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

function footprintPerimeterEdges(cells)
{
    const counts = new Map();
    const segs = new Map();
    const roundKey = (point) => `${Math.round(point.x)},${Math.round(point.y)}`;
    for (const [col, row] of cells)
    {
        const pts = _cellCorners(col, row);
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
    const edges = [];
    for (const [key, count] of counts)
    {
        if (count === 1)
            edges.push(segs.get(key));
    }
    return edges;
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
        for (const pt of _cellCorners(col, row))
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
