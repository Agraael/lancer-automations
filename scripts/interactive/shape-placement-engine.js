/* global canvas, PIXI, game, document, globalThis, performance, foundry */
// Shared cursor/geometry/elevation handlers for shape placement; callers inject targeting behavior. style:ignore

import {
    isHexGrid, getHexCenter, pixelToOffset,
    drawHexAt, getOccupiedOffsets, neighborKeys,
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import {
    pointerToWorld, suppressTokenLayerClick, createPickerSession, createCursorPreview,
    addGraphicsBelowTokens, addGraphicsAboveTokens, destroyGraphics, _paintCells, createMultiPlusIndicator,
    gridLineWidth, makeText, TG, paintWithHalo,
    suppressEvent, isShiftDown, dragResistancePx,
} from "./canvas-helpers.js";
import { computeArea, facingToward, facingsToward, angleGap } from "./area-geometry.js";
import { playUiSound, playTargetingMove } from "../tah/sound.js";
import { eventMatchesKeybind, isTypingTarget } from "./keybindings.js";
import { isTokenVisible } from "../utils/lancer-token.js";

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

const PAN_ACTIONS = ['panUp', 'panDown', 'panLeft', 'panRight', 'panUpLeft', 'panUpRight', 'panDownLeft', 'panDownRight'];

function coreBindings(action)
{
    try
    {
        return game.keybindings.get('core', action) ?? [];
    }
    catch
    {
        return [];
    }
}

const cellKey = (offset) => `${offset.col},${offset.row}`;

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
            const originOffset = result.labelPt ? pixelToOffset(result.labelPt.x, result.labelPt.y) : null;
            const origin = originOffset ? `${originOffset.col},${originOffset.row}` : null;
            shapes.push({ cells: [...result.affected], origin, labels: shapeLabels, nodes });
            rebuildMirrors();
            return shapeLabels;
        },
        // Remove the most-recent placed shape whose footprint or origin is cellKey ("col,row").
        removeAt(cellKey)
        {
            for (let index = shapes.length - 1; index >= 0; index--)
            {
                if (!shapes[index].cells.includes(cellKey) && shapes[index].origin !== cellKey)
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
        visibleOnly = false,
        getToggles = () => ({ elevationAware: true, autoElevation: true, propagation: true }),
        multiStack = true,
        highlightCaught = true,
        caughtFilter = null,
        sound = true,
        resolveOnClick = true,
        cancelOnRightClick = false,
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
    let pendingRotation = 0;
    // World-angle source-of-truth (radians). Line ring modulus scales with length; storing an
    // angle instead of an integer step index keeps grow/shrink round-trips exact.
    let pendingAngleRad = null;
    let pendingElevOffset = 0;
    let pendingTilt = 0;
    let lastCursor = null;
    let lastResult = null;
    let press = null;
    let lastAimKey = null;
    const panCodes = new Set(PAN_ACTIONS.flatMap(action => coreBindings(action).map(binding => binding.key)));
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
    const plus = multiStack && resolveOnClick ? createMultiPlusIndicator() : null;
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
            visibleOnly,
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
        if (visibleOnly && !isTokenVisible(placeable))
            return false;
        if (!includeSelf && casterToken && placeable.id === casterToken.id)
            return false;

        const bounds = placeable.bounds;
        return tx >= bounds.left && tx <= bounds.right && ty >= bounds.top && ty <= bounds.bottom;
    }) || null;

    const computeShape = (centerPt, rotation) =>
    {
        const areaCtx = ctx();
        const elevation = areaCtx.elevationAware ? (autoElevation() ? groundAt(centerPt) : 0) + pendingElevOffset : 0;
        const result = computeArea({ pattern, centerPt, areaRange, size, rotation, areaElev: elevation, tilt: pendingTilt }, areaCtx);
        return { ...result, labelPt: centerPt, elev: elevation, elevAware: areaCtx.elevationAware };
    };

    // null when a burst has no token under the cursor.
    const computeAt = (tx, ty) =>
    {
        if (isBurst)
        {
            const areaCtx = ctx();
            const host = tokenUnderCursor(tx, ty);
            if (!host)
                return null;

            const result = computeArea({ pattern: 'burst', hostToken: host, areaRange }, areaCtx);
            return { ...result, labelPt: host.center, hostToken: host, elev: result.hostElev ?? 0, elevAware: areaCtx.elevationAware };
        }

        const offset = pixelToOffset(tx, ty);
        return computeShape(getHexCenter(offset.col, offset.row), pendingRotation);
    };

    const canAim = () => isAimed && (pattern !== 'line' || Math.round(areaRange) > 1);

    const tokenOnCell = (point) =>
    {
        const key = cellKey(pixelToOffset(point.x, point.y));

        return canvas.tokens.placeables.find(placeable =>
        {
            if (placeable.document.hidden && !(includeHidden && game.user.isGM))
                return false;
            if (visibleOnly && !isTokenVisible(placeable))
                return false;
            return getOccupiedOffsets(placeable).some(offset => cellKey(offset) === key);
        }) ?? null;
    };

    const besideToken = (token, target) =>
    {
        const footprint = new Set(getOccupiedOffsets(token).map(cellKey));
        const starts = new Set(pattern === 'cone' && !isHexGrid() ? footprint : []);

        if (!starts.size)
        {
            for (const key of footprint)
            {
                for (const neighbor of neighborKeys(key))
                {
                    if (!footprint.has(neighbor))
                        starts.add(neighbor);
                }
            }
        }

        const aim = Math.atan2(target.y - token.center.y, target.x - token.center.x);
        let originPt = null;
        let bestGap = Infinity;

        for (const key of starts)
        {
            const [col, row] = key.split(',').map(Number);
            const center = getHexCenter(col, row);
            const gap = angleGap(Math.atan2(center.y - token.center.y, center.x - token.center.x), aim);

            if (gap < bestGap)
            {
                bestGap = gap;
                originPt = center;
            }
        }

        const tooClose = footprint.has(cellKey(pixelToOffset(target.x, target.y)))
            || Math.hypot(target.x - originPt.x, target.y - originPt.y) < canvas.grid.size * 0.45;

        const aimAt = tooClose
            ? { x: originPt.x + Math.cos(aim) * canvas.grid.size * 10, y: originPt.y + Math.sin(aim) * canvas.grid.size * 10 }
            : target;

        const facings = facingsToward(pattern, areaRange, originPt, aimAt);
        const clear = facings.find(facing => ![...computeArea({ pattern, centerPt: originPt, areaRange, size, rotation: facing }).affected].some(key => footprint.has(key)));
        return { originPt, rotation: clear ?? facings[0], from: token.center };
    };

    const aimedPlacement = (pressed, target) =>
    {
        if (pressed.token)
            return besideToken(pressed.token, target);

        const near = Math.hypot(target.x - pressed.originPt.x, target.y - pressed.originPt.y) < canvas.grid.size * 0.45;
        return { originPt: pressed.originPt, rotation: near ? pendingRotation : facingToward(pattern, areaRange, pressed.originPt, target), from: pressed.originPt };
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

    const drawAimLine = (aimed, cursor) =>
    {
        paintWithHalo(cursorPreview, target =>
        {
            target.drawCircle(aimed.originPt.x, aimed.originPt.y, Math.max(4, canvas.grid.size * 0.14));
            target.moveTo(aimed.from.x, aimed.from.y);
            target.lineTo(cursor.x, cursor.y);
        }, { color: TG.traceLine, lineWidth: 1.5, lineAlpha: 0.8 });
    };

    const drawAt = (tx, ty) =>
    {
        cursorPreview.clear();
        selectHighlight.clear();
        clearCellLabels();
        const aimed = press?.aiming ? aimedPlacement(press, { x: tx, y: ty }) : null;
        const result = aimed ? computeShape(aimed.originPt, aimed.rotation) : computeAt(tx, ty);
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

        if (aimed)
        {
            drawAimLine(aimed, { x: tx, y: ty });
            const aimKey = `${cellKey(pixelToOffset(aimed.originPt.x, aimed.originPt.y))}:${aimed.rotation}`;

            if (aimKey !== lastAimKey)
            {
                lastAimKey = aimKey;
                playSound('targeting');
            }
        }

        if (highlightCaught)
            drawCaught(selectHighlight, caughtFilter ? result.caught.filter(token => caughtFilter(token)) : result.caught);
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
        plus?.dispose();
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
        if (press && !press.aiming && canAim() && Math.hypot(event.clientX - press.clientX, event.clientY - press.clientY) >= dragResistancePx())
            press.aiming = true;
        drawAt(tx, ty);
        plus?.move(isShiftDown(event), tx, ty);

        if (soundOn() && !press?.aiming)
        {
            const offset = pixelToOffset(tx, ty);
            playTargetingMove(offset.col, offset.row);
        }
    };

    const pressHandler = (event) =>
    {
        if (event.button !== 0 || event.target?.id !== 'board')
            return;
        suppressEvent(event);
        const world = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
        const offset = pixelToOffset(world.x, world.y);

        press = {
            clientX: event.clientX,
            clientY: event.clientY,
            world,
            originPt: getHexCenter(offset.col, offset.row),
            token: canAim() ? tokenOnCell(world) : null,
            aiming: false,
            rotation: pendingRotation,
            angle: pendingAngleRad,
        };
    };

    const dropAim = () =>
    {
        pendingRotation = press.rotation;
        pendingAngleRad = press.angle;
        press = null;
        lastAimKey = null;
        refresh();
    };

    const releaseHandler = (event) =>
    {
        if (event.button !== 0 || !press)
            return;
        suppressEvent(event);
        const pressed = press;
        press = null;
        lastAimKey = null;
        if (onClickCapture(event))
            return;

        let result;

        if (pressed.aiming)
        {
            const cursor = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
            const aimed = aimedPlacement(pressed, cursor);
            pendingRotation = aimed.rotation;
            pendingAngleRad = Math.atan2(cursor.y - aimed.originPt.y, cursor.x - aimed.originPt.x);
            result = { ...computeShape(aimed.originPt, aimed.rotation), aimed: true };
        }
        else
            result = computeAt(pressed.world.x, pressed.world.y);

        if (!result)
        {
            refresh();
            return;
        }

        playSound('targetingConfirm');
        place(result, (multiStack && isShiftDown(event)) || !resolveOnClick);
    };

    const bumpElevation = (step) =>
    {
        if (!ctx().elevationAware)
            return;
        pendingElevOffset += step;
        refresh();
        playSound('targeting');
    };

    const wheelHandler = (event) =>
    {
        if (event.target?.id !== 'board')
            return;

        if (onResize && event.shiftKey)
        {
            event.preventDefault();
            event.stopPropagation();
            onResize(event.deltaY < 0 ? 1 : -1);
            playSound('targeting');
            return;
        }

        if (!event.shiftKey && !(game.keyboard?.isModifierActive?.('CONTROL') ?? event.ctrlKey))
            return;
        event.preventDefault();
        event.stopPropagation();
    };

    const keyHandler = (event) =>
    {
        if (shouldIgnoreKey(event) || isTypingTarget(event.target))
            return;

        if (event.key === 'Escape')
        {
            suppressEvent(event);

            if (press)
            {
                dropAim();
                return;
            }

            dispose();
            onCancel();
            return;
        }

        if (eventMatchesKeybind(event, 'resetShape'))
        {
            suppressEvent(event);
            pendingElevOffset = 0;
            pendingRotation = 0;
            pendingAngleRad = null;
            pendingTilt = 0;
            refresh();
            playSound('targeting');
            return;
        }

        const tiltUp = eventMatchesKeybind(event, 'lineTiltUp');

        if (pattern === 'line' && (tiltUp || eventMatchesKeybind(event, 'lineTiltDown')))
        {
            suppressEvent(event);

            if (ctx().elevationAware)
            {
                pendingTilt += tiltUp ? 1 : -1;
                refresh();
                playSound('targeting');
            }

            return;
        }

        let step = 0;
        if (eventMatchesKeybind(event, 'elevationUp'))
            step = 1;
        else if (eventMatchesKeybind(event, 'elevationDown'))
            step = -1;

        if (step === 0)
        {
            if (!event.ctrlKey && panCodes.has(event.code))
                suppressEvent(event);
            return;
        }

        suppressEvent(event);
        bumpElevation(step);
    };

    const rightClickHandler = () =>
    {
        if (press)
        {
            dropAim();
            return;
        }

        dispose();
        onCancel();
    };

    const start = () =>
    {
        prevInteractive = canvas.tokens.interactiveChildren;
        canvas.tokens.interactiveChildren = false;
        restoreLayerClick = suppressTokenLayerClick();
        session.bind({
            move: moveHandler, key: keyHandler, wheel: wheelHandler, rightClick: cancelOnRightClick ? rightClickHandler : null,
            press: pressHandler, release: releaseHandler,
        });
    };

    const setPattern = (nextPattern) =>
    {
        pattern = nextPattern;
        isBurst = pattern === 'burst';
        isAimed = pattern === 'cone' || pattern === 'line';
        pendingRotation = 0;
        pendingAngleRad = null;
        pendingTilt = 0;
        refresh();
    };

    const setAreaRange = (nextRange) =>
    {
        areaRange = nextRange;

        // Line ring modulus scales with length; recompute pendingRotation from the world-angle
        // source-of-truth so grow/shrink round-trips are exact. Cone/blast/burst have a fixed modulus.
        if (pattern === 'line' && pendingAngleRad !== null)
        {
            const reference = getHexCenter(0, 0);
            pendingRotation = facingToward('line', areaRange, reference, { x: reference.x + Math.cos(pendingAngleRad), y: reference.y + Math.sin(pendingAngleRad) });
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
