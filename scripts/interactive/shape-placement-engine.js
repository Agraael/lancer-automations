/* global canvas, PIXI, game, document, globalThis, performance */
// Shared cursor/geometry/elevation handlers for shape placement; callers inject targeting behavior. style:ignore

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets,
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import {
    pointerToWorld, suppressTokenLayerClick, createPickerSession, createCursorPreview,
    addGraphicsBelowTokens, addGraphicsAboveTokens, destroyGraphics, _paintCells, createMultiPlusIndicator,
    gridLineWidth, makeText, TG, paintWithHalo,
    suppressEvent, isShiftDown,
} from "./canvas-helpers.js";
import { computeArea, rotationStepsFor } from "./area-geometry.js";
import { playUiSound, playTargetingMove } from "../tah/sound.js";
import { keyCodesFor } from "./keybindings.js";

function elevText(elevation)
{
    const value = Math.round(elevation || 0);
    return value > 0 ? `↑ ${value}` : value < 0 ? `↓ ${-value}` : `↕ 0`;
}

function bandLabel(result)
{
    const top = Math.round(result.elevTop ?? result.elev ?? 0);
    const bottom = Math.round(result.elevBot ?? result.elev ?? 0);
    return `↑ ${top}\n↓ ${bottom}`;
}

// Symmetric vertical extent around center (used by blast/cone/burst). Empty string when flat.
function bandSuffix(result)
{
    const center = Math.round(result.elev ?? 0);
    const top = Math.round(result.elevTop ?? center);
    const extent = top - center;
    return extent > 0 ? `±${extent}` : '';
}

function isTiltedLine(result)
{
    if (!result.elevByCell)
        return false;
    const values = [...result.elevByCell.values()];
    return values.some(elevation => elevation !== values[0]);
}

// Single centered label for a non-tilted shape, shared by presence/placed/cursor so they can't diverge.
function flatLabelText(result)
{
    const isLine = result.elevByCell || result.pattern === 'line';
    return isLine
        ? (result.elevByCell ? elevText(result.elev) : bandLabel(result))
        : `${elevText(result.elev)}  ${bandSuffix(result)}`.trim();
}

export function buildAreaLabels(result)
{
    if (!result || !result.elevAware)
        return [];
    if (isTiltedLine(result))
    {
        const labels = [];
        for (const [key, elevation] of result.elevByCell)
        {
            const [col, row] = key.split(',').map(Number);
            const center = getHexCenter(col, row);
            labels.push({ x: center.x, y: center.y, text: elevText(elevation) });
        }
        return labels;
    }
    if (result.labelPt)
        return [{ x: result.labelPt.x, y: result.labelPt.y, text: flatLabelText(result) }];
    return [];
}

function makeCellLabel(col, row, elevation)
{
    const center = getHexCenter(col, row);
    const label = makeText(elevText(elevation), {
        fontFamily: 'Arial',
        fontSize: Math.max(11, canvas.grid.size * 0.18),
        fill: 0xffffff,
        stroke: 0x000000,
        strokeThickness: gridLineWidth(3),
        fontWeight: 'bold',
    });
    label.anchor.set(0.5);
    label.x = center.x;
    label.y = center.y;
    return label;
}

// Accumulated placed shapes with a breathing alpha; the caller owns the instance + lifetime.
export function createPlacedShapeStore()
{
    let container = null;
    let labelContainer = null;
    let pulseTick = null;
    const shapes = [];
    const cells = [];
    const labels = [];

    const ensureContainer = () =>
    {
        if (container)
            return;
        container = new PIXI.Container();
        addGraphicsBelowTokens(container);
        labelContainer = new PIXI.Container();
        addGraphicsAboveTokens(labelContainer);
        pulseTick = () =>
        {
            if (!container || container.destroyed)
            {
                canvas.app.ticker.remove(pulseTick);
                pulseTick = null;
                container = null;
                return;
            }
            const alpha = 0.65 + 0.35 * Math.sin(performance.now() / 280);
            container.alpha = alpha;
            if (labelContainer && !labelContainer.destroyed)
                labelContainer.alpha = alpha;
        };
        canvas.app.ticker.add(pulseTick);
    };

    const rebuildMirrors = () =>
    {
        cells.length = 0;
        labels.length = 0;
        for (const shape of shapes)
        {
            cells.push(...shape.cells);
            labels.push(...shape.labels);
        }
    };

    const drawShapeNodes = (result) =>
    {
        const nodes = [];
        const gfx = new PIXI.Graphics();
        paintWithHalo(gfx, target => _paintCells(target, result.affected), { color: TG.placed, lineWidth: 2, lineAlpha: 0.7, fillAlpha: 0.22 });
        container.addChild(gfx);
        nodes.push(gfx);
        if (result.elevAware && isTiltedLine(result))
        {
            for (const [key, elevation] of result.elevByCell)
            {
                const [col, row] = key.split(',').map(Number);
                const node = makeCellLabel(col, row, elevation);
                labelContainer.addChild(node);
                nodes.push(node);
            }
        }
        else if (result.elevAware && result.labelPt)
        {
            const node = makeText(flatLabelText(result), {
                fontFamily: 'Arial',
                fontSize: Math.max(14, canvas.grid.size * 0.22),
                fill: 0xffffff,
                stroke: 0x000000,
                strokeThickness: gridLineWidth(4),
                fontWeight: 'bold',
                align: 'center',
            });
            node.anchor.set(0.5);
            node.x = result.labelPt.x;
            node.y = result.labelPt.y;
            labelContainer.addChild(node);
            nodes.push(node);
        }
        return nodes;
    };

    return {
        cells,
        labels,
        isEmpty()
        {
            return cells.length === 0;
        },
        setVisible(visible)
        {
            if (container)
                container.visible = visible;
            if (labelContainer)
                labelContainer.visible = visible;
        },
        addShape(result)
        {
            ensureContainer();
            const nodes = drawShapeNodes(result);
            const shapeLabels = buildAreaLabels(result);
            shapes.push({ cells: [...result.affected], labels: shapeLabels, nodes });
            rebuildMirrors();
            return shapeLabels;
        },
        // Remove the most-recent placed shape whose footprint includes cellKey ("col,row").
        removeAt(cellKey)
        {
            for (let index = shapes.length - 1; index >= 0; index--)
            {
                if (!shapes[index].cells.includes(cellKey))
                    continue;
                const [removed] = shapes.splice(index, 1);
                for (const node of removed.nodes)
                {
                    if (node.parent)
                        node.parent.removeChild(node);
                    node.destroy();
                }
                rebuildMirrors();
                return true;
            }
            return false;
        },
        destroy()
        {
            if (pulseTick)
            {
                canvas.app.ticker.remove(pulseTick);
                pulseTick = null;
            }
            if (container)
            {
                if (container.parent)
                    container.parent.removeChild(container);
                container.destroy({ children: true });
                container = null;
            }
            if (labelContainer)
            {
                if (labelContainer.parent)
                    labelContainer.parent.removeChild(labelContainer);
                labelContainer.destroy({ children: true });
                labelContainer = null;
            }
            shapes.length = 0;
            cells.length = 0;
            labels.length = 0;
        },
    };
}

export function createShapePlacement(options = {})
{
    const {
        casterToken = null,
        includeSelf = true,
        includeHidden = true,
        getToggles = () => ({ elevationAware: true, autoElevation: true, propagation: true }),
        multiStack = true,
        highlightCaught = true,
        sound = true,
        resolveOnClick = true,
        placedStore = null,
        colorFor = () => TG.inRange,
        onHover = () =>
        {},
        onPlace = () =>
        {},
        onResolve = () =>
        {},
        onCancel = () =>
        {},
        onDispose = () =>
        {},
        onClickCapture = () => false,
        shouldIgnoreKey = () => false,
        onResize = null,
    } = options;

    let pattern = options.pattern ?? 'blast';
    let areaRange = options.areaRange ?? 1;
    let size = options.size ?? 1;
    let isBurst = pattern === 'burst';
    let isAimed = pattern === 'cone' || pattern === 'line';
    let rotMod = rotationStepsFor(pattern, areaRange);
    let pendingRotation = 0;
    // World-angle source-of-truth (radians). Line ring modulus scales with length; storing an
    // angle instead of an integer step index keeps grow/shrink round-trips exact.
    let pendingAngleRad = 0;
    let pendingElevOffset = 0;
    let pendingTilt = 0;
    let lastCursor = null;
    let lastResult = null;
    let disposed = false;
    let prevInteractive = true;
    let restoreLayerClick = null;
    const session = createPickerSession('shapePlacement', () =>
    {
        try
        {
            dispose();
        }
        catch
        { /* */ }
        onCancel();
    });

    const { graphics: cursorPreview, dispose: disposeCursorPreview } = createCursorPreview();
    const plus = createMultiPlusIndicator();
    const selectHighlight = new PIXI.Graphics();
    canvas.stage.addChild(selectHighlight).eventMode = 'none';
    const elevLabel = makeText('', {
        fontFamily: 'Arial', fontSize: 16, fill: 0xffffff, stroke: 0x000000, strokeThickness: gridLineWidth(4), fontWeight: 'bold', align: 'center',
    });
    elevLabel.anchor.set(0.5);
    elevLabel.visible = false;
    canvas.stage.addChild(elevLabel).eventMode = 'none';
    const cellLabelLayer = new PIXI.Container();
    canvas.stage.addChild(cellLabelLayer).eventMode = 'none';
    const clearCellLabels = () =>
    {
        for (const child of cellLabelLayer.removeChildren())
            child.destroy();
    };

    const soundOn = () => (typeof sound === 'function' ? !!sound() : !!sound);
    const playSound = (name) =>
    {
        if (soundOn())
            playUiSound(name);
    };

    const ctx = () =>
    {
        const toggles = getToggles() || {};
        return {
            elevationAware: !!toggles.elevationAware,
            propagation: !!toggles.propagation,
            includeHidden: includeHidden && game.user.isGM,
            includeSelf,
            casterToken,
        };
    };
    const autoElevation = () => !!(getToggles() || {}).autoElevation;
    const groundAt = (point) =>
    {
        const terrainApi = globalThis.terrainHeightTools;
        if (!terrainApi)
            return 0;
        const offset = pixelToOffset(point.x, point.y);
        return Number(getHexGroundElevation(offset.col, offset.row, terrainApi)) || 0;
    };

    const tokenUnderCursor = (tx, ty) => canvas.tokens.placeables.find(placeable =>
    {
        if (placeable.document.hidden && !(includeHidden && game.user.isGM))
            return false;
        if (!includeSelf && casterToken && placeable.id === casterToken.id)
            return false;
        const bounds = placeable.bounds;
        return tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom;
    }) || null;

    // null when a burst has no token under the cursor.
    const computeAt = (tx, ty) =>
    {
        const areaCtx = ctx();
        if (isBurst)
        {
            const host = tokenUnderCursor(tx, ty);
            if (!host)
                return null;
            const result = computeArea({ pattern: 'burst', hostToken: host, areaRange }, areaCtx);
            return { ...result, labelPt: host.center, elev: result.hostElev ?? 0, elevAware: areaCtx.elevationAware };
        }
        const offset = pixelToOffset(tx, ty);
        const centerPt = getHexCenter(offset.col, offset.row);
        const elevation = areaCtx.elevationAware ? (autoElevation() ? groundAt(centerPt) : 0) + pendingElevOffset : 0;
        const result = computeArea({ pattern, centerPt, areaRange, size, rotation: pendingRotation, areaElev: elevation, tilt: pendingTilt }, areaCtx);
        return { ...result, labelPt: centerPt, elev: elevation, elevAware: areaCtx.elevationAware };
    };

    const drawCaught = (graphic, caught) =>
    {
        paintWithHalo(graphic, target =>
        {
            for (const token of caught)
            {
                if (isHexGrid())
                {
                    for (const offset of getOccupiedOffsets(token))
                        drawHexAt(target, offset.col, offset.row);
                }
                else
                    target.drawRect(token.document.x, token.document.y, token.document.width * canvas.grid.size, token.document.height * canvas.grid.size);
            }
        }, { color: TG.target, lineWidth: 4, lineAlpha: 0.8, fillAlpha: 0.2 });
    };

    const drawAt = (tx, ty) =>
    {
        cursorPreview.clear();
        selectHighlight.clear();
        clearCellLabels();
        const result = computeAt(tx, ty);
        lastResult = result;
        if (!result)
        {
            paintWithHalo(cursorPreview, target => target.drawCircle(tx, ty, Math.max(6, canvas.grid.size * 0.12)),
                { color: TG.noHost, lineWidth: 2, lineAlpha: 0.85, fillAlpha: 0.25 });
            elevLabel.visible = false;
            onHover(null);
            return;
        }
        const shapeColor = colorFor(result);
        paintWithHalo(cursorPreview, target => _paintCells(target, result.affected),
            { color: shapeColor, lineWidth: 2, lineAlpha: 0.6, fillAlpha: 0.12 });
        if (highlightCaught)
            drawCaught(selectHighlight, result.caught);
        onHover(result);
        if (result.elevAware && isTiltedLine(result))
        {
            elevLabel.visible = false;
            for (const [key, elevation] of result.elevByCell)
            {
                const [col, row] = key.split(',').map(Number);
                cellLabelLayer.addChild(makeCellLabel(col, row, elevation));
            }
        }
        else if (result.elevAware && result.labelPt)
        {
            elevLabel.style.fontSize = Math.max(14, canvas.grid.size * 0.22);
            elevLabel.text = flatLabelText(result);
            elevLabel.x = result.labelPt.x;
            elevLabel.y = result.labelPt.y;
            elevLabel.visible = true;
        }
        else
            elevLabel.visible = false;
    };

    const refresh = () =>
    {
        if (lastCursor)
            drawAt(lastCursor.x, lastCursor.y);
    };

    const dispose = () =>
    {
        if (disposed)
            return;
        disposed = true;
        disposeCursorPreview();
        plus.dispose();
        destroyGraphics(selectHighlight);
        destroyGraphics(elevLabel);
        clearCellLabels();
        destroyGraphics(cellLabelLayer);
        session.unbind();
        canvas.tokens.interactiveChildren = prevInteractive;
        if (restoreLayerClick)
            restoreLayerClick();
        onDispose();
    };

    const place = (result, keepOpen) =>
    {
        onPlace(result, keepOpen);
        placedStore?.addShape(result);
        if (keepOpen)
        {
            refresh();
            return;
        }
        dispose();
        onResolve(result);
    };

    const moveHandler = (event) =>
    {
        const { x: tx, y: ty } = pointerToWorld(event);
        lastCursor = { x: tx, y: ty };
        drawAt(tx, ty);
        plus.move(multiStack && isShiftDown(event), tx, ty);
        if (soundOn())
        {
            const offset = pixelToOffset(tx, ty);
            playTargetingMove(offset.col, offset.row);
        }
    };

    const clickHandler = (event) =>
    {
        if (onClickCapture(event))
            return;
        const shift = isShiftDown(event);
        const { x: tx, y: ty } = pointerToWorld(event);
        const result = computeAt(tx, ty);
        if (!result)
            return;
        playSound('targetingConfirm');
        place(result, (multiStack && shift) || !resolveOnClick);
    };

    const bumpRotation = (step) =>
    {
        if (rotMod <= 0)
            return; // e.g. line size 1 = point, no ring to rotate around
        const stepRad = (2 * Math.PI) / rotMod;
        pendingAngleRad = ((pendingAngleRad + step * stepRad) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        pendingRotation = Math.round(pendingAngleRad / stepRad) % rotMod;
        pendingRotation = (pendingRotation + rotMod) % rotMod;
        refresh();
        playSound('targeting');
    };
    const bumpElevation = (step) =>
    {
        if (!ctx().elevationAware)
            return;
        pendingElevOffset += step;
        refresh();
        playSound('targeting');
    };

    // momentum: consecutive same-dir ticks accelerate; a pause or reversal resets.
    const ROT_RESET_MS = 220;
    let rotStreak = 0;
    let lastRotDir = 0;
    let lastRotTime = 0;
    const wheelHandler = (event) =>
    {
        if (onResize && event.shiftKey)
        {
            event.preventDefault();
            event.stopPropagation();
            onResize(event.deltaY < 0 ? 1 : -1);
            playSound('targeting');
            return;
        }
        if (!isAimed || !event.ctrlKey)
            return;
        event.preventDefault();
        event.stopPropagation();
        const direction = event.deltaY > 0 ? 1 : -1;
        const now = event.timeStamp || 0;
        if (direction === lastRotDir && (now - lastRotTime) < ROT_RESET_MS)
            rotStreak += 1;
        else
            rotStreak = 0;
        lastRotDir = direction;
        lastRotTime = now;
        const rotMaxStep = Math.max(3, Math.round(rotMod / 6));
        const step = Math.min(1 + Math.floor(rotStreak / 2), rotMaxStep);
        bumpRotation(direction * step);
    };

    const ascendKeys = keyCodesFor('elevationUp');
    const descendKeys = keyCodesFor('elevationDown');
    const tiltUpKeys = keyCodesFor('lineTiltUp');
    const tiltDownKeys = keyCodesFor('lineTiltDown');
    const resetKeys = keyCodesFor('resetShape');
    const keyHandler = (event) =>
    {
        if (shouldIgnoreKey(event))
            return;
        if (event.key === 'Escape')
        {
            suppressEvent(event);
            dispose();
            onCancel();
            return;
        }
        if (resetKeys.has(event.code))
        {
            suppressEvent(event);
            pendingElevOffset = 0;
            pendingRotation = 0;
            pendingAngleRad = 0;
            pendingTilt = 0;
            refresh();
            playSound('targeting');
            return;
        }
        if (pattern === 'line' && (tiltUpKeys.has(event.code) || tiltDownKeys.has(event.code)))
        {
            suppressEvent(event);
            if (ctx().elevationAware)
            {
                pendingTilt += tiltUpKeys.has(event.code) ? 1 : -1;
                refresh();
                playSound('targeting');
            }
            return;
        }
        let step = 0;
        if (ascendKeys.has(event.code))
            step = 1;
        else if (descendKeys.has(event.code))
            step = -1;
        if (step === 0)
            return;
        suppressEvent(event);
        bumpElevation(step);
    };

    const start = () =>
    {
        prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        restoreLayerClick = suppressTokenLayerClick();
        session.bind({ move: moveHandler, click: clickHandler, key: keyHandler, wheel: wheelHandler });
    };

    const setPattern = (nextPattern) =>
    {
        pattern = nextPattern;
        isBurst = pattern === 'burst';
        isAimed = pattern === 'cone' || pattern === 'line';
        rotMod = rotationStepsFor(pattern, areaRange);
        pendingRotation = 0;
        pendingAngleRad = 0;
        pendingTilt = 0;
        refresh();
    };
    const setAreaRange = (nextRange) =>
    {
        areaRange = nextRange;
        rotMod = rotationStepsFor(pattern, areaRange);
        // Line ring modulus scales with length; recompute pendingRotation from the world-angle
        // source-of-truth so grow/shrink round-trips are exact. Cone/blast/burst have a fixed modulus.
        if (pattern === 'line' && rotMod > 0)
        {
            const stepRad = (2 * Math.PI) / rotMod;
            pendingRotation = Math.round(pendingAngleRad / stepRad) % rotMod;
            pendingRotation = (pendingRotation + rotMod) % rotMod;
        }
        refresh();
    };
    const setSize = (nextSize) =>
    {
        size = nextSize;
        refresh();
    };

    return {
        start,
        dispose,
        redraw: refresh,
        setPattern,
        setAreaRange,
        setSize,
        getResult: () => lastResult,
        getState: () => ({ pattern, areaRange, size, rotation: pendingRotation, elevOffset: pendingElevOffset, tilt: pendingTilt }),
    };
}
