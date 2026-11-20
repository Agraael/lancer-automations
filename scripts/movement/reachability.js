/* global canvas, game, CONST */
// Weighted movement reach: Dijkstra flood over grid cells using the ruler's own
// per-cell cost core (evalCellStep), so the frontier matches what a drag would bill. style:ignore

import { evalCellStep, getTerrainTypeMap, footprintShapesAt, tokenCenterAtCell, isClimbingImmune, isTerrainImmune, isPhasing, autoElevDisabled } from "./cost-rules.js";
import { elevationModeFor } from "./keybindings.js";
import { getLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { canPassObstructions } from "./movement-utils.js";
import { isSolidToken, blocksBody } from "./ground.js";
import { laTokenGameplayHeight } from "../tools/token-height.js";
import { makeWallBlocker } from "./wall-block.js";
import { getOccupiedOffsets, isHexGrid } from "../combat/grid-helpers.js";
import { _isMovementAnimating } from "../vision/visionFromEdge.js";
import { straightRing, lineStateKey, freshLine, continuesLine, extendLine, actionSpan, bandEdges } from "./straight-line.js";
import { parseAction } from "./movement-actions.js";
import { makeJumpReach, makePairCache } from "./jump-reach.js";

const _routeMemo = new Map();
const ROUTE_MEMO_CAP = 500;
const TELEMETRY_FLAG = 'telemetry';
for (const hook of ['canvasReady', 'canvasTearDown', 'updateScene', 'createToken', 'updateToken', 'deleteToken', 'updateActor',
    'createItem', 'updateItem', 'deleteItem', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect',
    'createWall', 'updateWall', 'deleteWall', 'createMeasuredTemplate', 'updateMeasuredTemplate', 'deleteMeasuredTemplate',
    'createRegion', 'updateRegion', 'deleteRegion', 'createCombat', 'deleteCombat', 'updateSetting', 'clientSettingChanged'])
    Hooks.on(hook, () => _routeMemo.clear());

Hooks.on('updateCombat', (_combat, changed) =>
{
    if (!onlyTelemetryChanged(changed))
        _routeMemo.clear();
});

function onlyTelemetryChanged(changed)
{
    if (Object.keys(changed ?? {}).some((key) => key !== '_id' && key !== '_stats' && key !== 'flags'))
        return false;

    const scopes = Object.keys(changed?.flags ?? {});
    if (scopes.length !== 1 || scopes[0] !== MODULE_ID)
        return false;

    const flagKeys = Object.keys(getLAFlags(changed) ?? {});
    return flagKeys.length === 1 && flagKeys[0] === TELEMETRY_FLAG;
}

// A cell counts as off-map (a wall) when its center falls outside the scene rectangle.
function cellInSceneBounds(offset)
{
    const rect = canvas.dimensions?.sceneRect;
    if (!rect?.contains)
        return true;

    const center = canvas.grid.getCenterPoint(offset);
    return rect.contains(center.x, center.y);
}

function facingAfterStep(facing, fromCell, toCell)
{
    return {
        x: Math.sign(toCell.j - fromCell.j) || facing.x,
        y: Math.sign(toCell.i - fromCell.i) || facing.y
    };
}

function startFacing(token, startCell)
{
    const center = tokenCenterAtCell(token.document, startCell);
    const adjusted = token.getMovementAdjustedPoint(center);
    return { x: Math.round(center.x) - adjusted.x, y: Math.round(center.y) - adjusted.y };
}

function makeStepWallTest(token, action)
{
    const wallBlocked = makeWallBlocker(action);
    if (!wallBlocked)
        return null;

    const tokenDoc = token.document;
    const onVertex = canvas.grid.isSquare && ((tokenDoc.width ?? 1) % 2 === 0 || (tokenDoc.height ?? 1) % 2 === 0);

    if (!onVertex)
        return (fromCell, toCell, facing, elevation) => wallBlocked(canvas.grid.getCenterPoint(fromCell), canvas.grid.getCenterPoint(toCell), elevation);

    const adjustedCenter = (cell, facing) => token.getMovementAdjustedPoint(tokenCenterAtCell(tokenDoc, cell), { offsetX: facing.x, offsetY: facing.y });

    return (fromCell, toCell, facing, elevation) =>
        wallBlocked(adjustedCenter(fromCell, facing), adjustedCenter(toCell, facingAfterStep(facing, fromCell, toCell)), elevation);
}

// Min-heap on cost; small (a few thousand nodes), no need for anything fancier.
function makeHeap()
{
    const items = [];

    const swap = (indexA, indexB) =>
    {
        const held = items[indexA];
        items[indexA] = items[indexB];
        items[indexB] = held;
    };

    return {
        get size()
        {
            return items.length;
        },
        push(node)
        {
            items.push(node);
            let child = items.length - 1;

            while (child > 0)
            {
                const parent = (child - 1) >> 1;
                if (items[parent].cost <= items[child].cost)
                    break;
                swap(parent, child);
                child = parent;
            }
        },
        pop()
        {
            const top = items[0];
            const tail = items.pop();

            if (items.length && tail !== undefined)
            {
                items[0] = tail;
                let parent = 0;

                for (;;)
                {
                    const left = parent * 2 + 1;
                    const right = left + 1;
                    let smallest = parent;

                    if (left < items.length && items[left].cost < items[smallest].cost)
                        smallest = left;
                    if (right < items.length && items[right].cost < items[smallest].cost)
                        smallest = right;
                    if (smallest === parent)
                        break;
                    swap(parent, smallest);
                    parent = smallest;
                }
            }

            return top;
        },
    };
}

const HEX_DIRECTIONS = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];

function _neighborOffsets(offset)
{
    if (isHexGrid())
    {
        const grid = /** @type {any} */ (canvas.grid);
        const cube = grid.getCube(offset);
        return HEX_DIRECTIONS.map(([dq, dr, ds]) => grid.getOffset({ q: cube.q + dq, r: cube.r + dr, s: cube.s + ds }));
    }

    const offsets = [];

    for (let dc = -1; dc <= 1; dc++)
    {
        for (let dr = -1; dr <= 1; dr++)
        {
            if (dc || dr)
                offsets.push({ i: offset.i + dr, j: offset.j + dc });
        }
    }

    return offsets;
}

function _walkContext(token, action)
{
    const tokenDoc = token.document;
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const base = parseAction(action).base;
    const flying = base === 'fly';
    const noTerrainClimb = base === 'ignore' || autoElevDisabled();
    const typeById = getTerrainTypeMap();
    const footprintCache = new Map();
    const moverSize = Number(token.actor?.system?.size) || 0;

    const ctx = {
        typeById,
        sceneDistance,
        flying,
        noTerrainClimb,
        elevationMode: noTerrainClimb ? null : elevationModeFor(base),
        zHeight: laTokenGameplayHeight(tokenDoc),
        climbImmune: isClimbingImmune(tokenDoc),
        freeMode: false,
        terrainImmune: isTerrainImmune(tokenDoc),
        actionKey: action,
        footprintCache,
        penaltyCache: new Map(),
        moverSize,
        standingRule: moverSize > 1 && canPassObstructions(tokenDoc)
    };

    const cellIndex = (offset) => (offset.i + 4096) * 8192 + offset.j + 4096;
    const footprintSets = new Map();

    const footprintKeysOf = (offset) =>
    {
        const index = cellIndex(offset);
        let keys = footprintSets.get(index);

        if (!keys)
        {
            let fpResult = footprintCache.get(`${offset.i},${offset.j}`);

            if (!fpResult)
            {
                fpResult = footprintShapesAt(tokenDoc, offset, typeById, { flyerBodies: flying });
                footprintCache.set(`${offset.i},${offset.j}`, fpResult);
            }

            // footprint can come back empty (e.g. THT absent); the node's own cell is always occupied
            keys = new Set((fpResult.footprint.length ? fpResult.footprint : [offset]).map(cellOffset => `${cellOffset.i},${cellOffset.j}`));
            footprintSets.set(index, keys);
        }

        return keys;
    };

    // Lancer body blocking: bodyCells "i,j" (can't enter same/larger hostile).
    const bodyCells = isPhasing(tokenDoc) ? new Set() : _bodyCellsFor(token);
    const bodyTouches = new Map();

    const touchesBody = (offset) =>
    {
        const index = cellIndex(offset);
        let touching = bodyTouches.get(index);

        if (touching === undefined)
        {
            touching = [...footprintKeysOf(offset)].some(cellKey => bodyCells.has(cellKey));
            bodyTouches.set(index, touching);
        }

        return touching;
    };

    const stepCache = makePairCache(cellIndex);

    const stepTo = (fromOffset, toOffset, tokenElev, floor) => stepCache(fromOffset, toOffset, tokenElev, floor, 0, 0, () =>
    {
        try
        {
            return evalCellStep(tokenDoc, toOffset, { prevFootprintKeys: footprintKeysOf(fromOffset), tokenElev, floor, manualDelta: 0 }, ctx);
        }
        catch
        {
            return null;
        }
    });

    return { sceneDistance, flying, jumping: base === 'jump', typeById, footprintCache, footprintKeysOf, cellIndex, bodyCells, touchesBody, wallBlocked: makeStepWallTest(token, action), stepTo, ctx };
}

// Flood from the token's center cell up to `budget` movement units; returns Map<"col,row", cost>.
// Walk matches the ruler's cheapest route exactly; fly bills climb free (exact within the free-climb cap).
export function computeMovementReach(token, budget, { action = 'walk', origin = null, footprintsOut = null, occupiedOut = null, flat = false } = {})
{
    const reach = new Map();
    const tokenDoc = token?.document;

    if (!tokenDoc || !(budget > 0))
        return reach;
    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
        return reach;

    const walk = _walkContext(token, action);
    const { sceneDistance, flying, jumping, typeById, footprintCache, footprintKeysOf, touchesBody, wallBlocked, stepTo, ctx } = walk;

    // Seed state mirrors applyLancerCost's path start; `origin` overrides it (drag preview endpoint).
    const gridSize = canvas.grid.size;

    const centerPoint = {
        x: (origin?.x ?? tokenDoc.x ?? 0) + (tokenDoc.width ?? 1) * gridSize / 2,
        y: (origin?.y ?? tokenDoc.y ?? 0) + (tokenDoc.height ?? 1) * gridSize / 2,
    };

    const startOffset = canvas.grid.getOffset(centerPoint);
    const startKey = `${startOffset.j},${startOffset.i}`;
    let startShapes;

    try
    {
        startShapes = footprintShapesAt(tokenDoc, startOffset, typeById, { flyerBodies: flying });
    }
    catch
    {
        return reach;
    }

    footprintCache.set(`${startOffset.i},${startOffset.j}`, startShapes);
    const startTokenElev = (origin?.elevation ?? tokenDoc.elevation ?? 0) / sceneDistance;

    _occupiedCellsInto(token, occupiedOut ?? new Set());
    const bodiesBlock = !flying && walk.bodyCells.size > 0;

    const teleport = flat && !!/** @type {any} */ (globalThis).CONFIG?.Token?.movement?.actions?.[action]?.teleport;

    const teleportCost = (offset, across) =>
    {
        try
        {
            const step = evalCellStep(tokenDoc, offset,
                { prevFootprintKeys: new Set(), tokenElev: startTokenElev, floor: startTokenElev, manualDelta: 0, landing: true }, ctx);
            return Math.max(across, Math.abs(step.nextTokenElev - startTokenElev) * sceneDistance) * (1 + step.penalty);
        }
        catch
        {
            return across;
        }
    };

    const heap = makeHeap();
    const best = new Map();
    const { cellIndex } = walk;

    best.set(cellIndex(startOffset), 0);
    heap.push({ offset: startOffset, cost: 0, tokenElev: startTokenElev, floor: startTokenElev, facing: startFacing(token, startOffset) });

    while (heap.size)
    {
        const node = heap.pop();
        const nodeOffset = node.offset;

        if (node.cost > (best.get(cellIndex(nodeOffset)) ?? Infinity))
            continue;

        const nodeKey = `${nodeOffset.j},${nodeOffset.i}`;
        const prevFootprintKeys = footprintKeysOf(nodeOffset);
        const landingCost = teleport && nodeKey !== startKey ? teleportCost(nodeOffset, node.cost) : node.cost;

        if (landingCost <= budget + 1e-9)
        {
            reach.set(nodeKey, landingCost);

            if (footprintsOut)
            {
                footprintsOut.set(nodeKey, [...prevFootprintKeys].map(cellKey =>
                {
                    const [cellRow, cellCol] = cellKey.split(',').map(Number);
                    return `${cellCol},${cellRow}`;
                }));
            }
        }

        for (const nextOffset of _neighborOffsets(nodeOffset))
        {
            if (!cellInSceneBounds(nextOffset))
                continue;

            const nextIndex = cellIndex(nextOffset);

            // teleport/forced: straight-line distance, ignore terrain cost, climb and walls
            if (flat)
            {
                const nextCost = node.cost + sceneDistance;
                if (nextCost > budget + 1e-9)
                    continue;
                if (nextCost >= (best.get(nextIndex) ?? Infinity))
                    continue;
                best.set(nextIndex, nextCost);
                heap.push({ offset: nextOffset, cost: nextCost, tokenElev: node.tokenElev, floor: node.floor });
                continue;
            }

            if (bodiesBlock && touchesBody(nextOffset))
                continue;
            if (wallBlocked?.(nodeOffset, nextOffset, node.facing, node.tokenElev * sceneDistance))
                continue;

            const step = stepTo(nodeOffset, nextOffset, node.tokenElev, node.floor);

            if (!step)
                continue;

            const walkEdgeCost = sceneDistance + step.stepClimbCost + step.stepMalus + step.penalty * sceneDistance;

            const edgeCost = jumping
                ? (step.rawClimb > 1e-9 ? walkEdgeCost : 2 * sceneDistance)
                : walkEdgeCost;

            const nextCost = node.cost + edgeCost;
            if (nextCost > budget + 1e-9)
                continue;
            if (nextCost >= (best.get(nextIndex) ?? Infinity))
                continue;
            best.set(nextIndex, nextCost);
            heap.push({ offset: nextOffset, cost: nextCost, tokenElev: step.nextTokenElev, floor: step.nextFloor, facing: facingAfterStep(node.facing, nodeOffset, nextOffset) });
        }
    }

    return reach;
}

// A* route around hostile bodies + terrain for drag pathfinding. Corners {x,y} (top-left); [] straight; null unreachable.
export function computeMovementRoute(token, origin, destination, { action = 'walk' } = {})
{
    const tokenDoc = token?.document;
    if (!tokenDoc || !origin || !destination)
        return null;

    const originX = origin.x ?? tokenDoc.x ?? 0;
    const originY = origin.y ?? tokenDoc.y ?? 0;

    const key = [tokenDoc.id, originX, originY, origin.elevation ?? tokenDoc.elevation ?? 0, destination.x ?? originX, destination.y ?? originY,
        action, tokenDoc.width, tokenDoc.height, tokenDoc.shape, elevationModeFor(parseAction(action).base), isClimbingImmune(tokenDoc)].join('|');

    if (_routeMemo.has(key))
        return _routeMemo.get(key);

    const route = _searchMovementRoute(token, origin, destination, action);

    if (!(canvas.tokens?.placeables ?? []).some(_isMovementAnimating))
    {
        if (_routeMemo.size >= ROUTE_MEMO_CAP)
            _routeMemo.clear();
        _routeMemo.set(key, route);
    }

    return route;
}

function _searchMovementRoute(token, origin, destination, action)
{
    const tokenDoc = token.document;
    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
        return null;

    const actionCfg = globalThis.CONFIG?.Token?.movement?.actions?.[action];
    if (actionCfg?.teleport || action === 'forced')
        return [];

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const gridSize = canvas.grid.size;
    const halfX = (tokenDoc.width ?? 1) * gridSize / 2;
    const halfY = (tokenDoc.height ?? 1) * gridSize / 2;
    const originX = origin.x ?? tokenDoc.x ?? 0;
    const originY = origin.y ?? tokenDoc.y ?? 0;
    const startOffset = canvas.grid.getOffset({ x: originX + halfX, y: originY + halfY });
    const goalOffset = canvas.grid.getOffset({ x: (destination.x ?? originX) + halfX, y: (destination.y ?? originY) + halfY });
    const startKey = `${startOffset.j},${startOffset.i}`;
    const goalKey = `${goalOffset.j},${goalOffset.i}`;

    if (startKey === goalKey)
        return [];
    if (!cellInSceneBounds(goalOffset))
        return null;

    const walk = _walkContext(token, action);
    const { flying, jumping, typeById, footprintCache, touchesBody, wallBlocked, stepTo } = walk;
    let startShapes;

    try
    {
        startShapes = footprintShapesAt(tokenDoc, startOffset, typeById, { flyerBodies: flying });
    }
    catch
    {
        return null;
    }

    footprintCache.set(`${startOffset.i},${startOffset.j}`, startShapes);

    if (walk.bodyCells.size && touchesBody(goalOffset))
        return null;

    const bodiesBlock = !flying && walk.bodyCells.size > 0;

    const isHex = isHexGrid();
    const grid = /** @type {any} */ (canvas.grid);
    const goalCube = isHex ? grid.getCube({ i: goalOffset.i, j: goalOffset.j }) : null;
    // diagonal-and-back detours cost the same as the straight line, so bias equal-cost ties
    // toward the direct corridor with a deviation term far below any real step cost
    const lineDirCol = goalOffset.j - startOffset.j;
    const lineDirRow = goalOffset.i - startOffset.i;
    const lineLen = Math.hypot(lineDirCol, lineDirRow) || 1;

    const tieBias = (col, row) =>
        Math.abs(((col - startOffset.j) * lineDirRow) - ((row - startOffset.i) * lineDirCol)) / lineLen * (sceneDistance / 65536);

    const heuristic = (col, row) =>
    {
        if (isHex)
        {
            const cube = grid.getCube({ i: row, j: col });
            return Math.max(Math.abs(cube.q - goalCube.q), Math.abs(cube.r - goalCube.r), Math.abs(cube.s - goalCube.s)) * sceneDistance + tieBias(col, row);
        }

        return Math.max(Math.abs(col - goalOffset.j), Math.abs(row - goalOffset.i)) * sceneDistance + tieBias(col, row);
    };

    const startTokenElev = (origin.elevation ?? tokenDoc.elevation ?? 0) / sceneDistance;

    const heap = makeHeap();
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    heap.push({ key: startKey, offset: startOffset, cost: heuristic(startOffset.j, startOffset.i), g: 0, tokenElev: startTokenElev, floor: startTokenElev, facing: startFacing(token, startOffset) });

    const NODE_CAP = 20000;
    let expansions = 0;
    let reached = false;

    while (heap.size)
    {
        const node = heap.pop();
        if (node.g > (gScore.get(node.key) ?? Infinity))
            continue;

        if (node.key === goalKey)
        {
            reached = true; break;
        }

        if (++expansions > NODE_CAP)
            return null;

        const nodeOffset = node.offset;

        for (const nextOffset of _neighborOffsets(nodeOffset))
        {
            if (!cellInSceneBounds(nextOffset))
                continue;
            if (bodiesBlock && touchesBody(nextOffset))
                continue;
            if (wallBlocked?.(nodeOffset, nextOffset, node.facing, node.tokenElev * sceneDistance))
                continue;

            const step = stepTo(nodeOffset, nextOffset, node.tokenElev, node.floor);

            if (!step)
                continue;

            const walkEdgeCost = sceneDistance + step.stepClimbCost + step.stepMalus + step.penalty * sceneDistance;

            const edgeCost = jumping
                ? (step.rawClimb > 1e-9 ? walkEdgeCost : 2 * sceneDistance)
                : walkEdgeCost;

            const nextKey = `${nextOffset.j},${nextOffset.i}`;
            const tentativeG = node.g + edgeCost;

            if (tentativeG >= (gScore.get(nextKey) ?? Infinity))
                continue;
            gScore.set(nextKey, tentativeG);
            cameFrom.set(nextKey, node.key);
            heap.push({ key: nextKey, offset: nextOffset, cost: tentativeG + heuristic(nextOffset.j, nextOffset.i), g: tentativeG, tokenElev: step.nextTokenElev, floor: step.nextFloor, facing: facingAfterStep(node.facing, nodeOffset, nextOffset) });
        }
    }

    if (!reached)
        return null;

    const cellPath = [];
    let cursor = goalKey;
    let guard = 0;

    while (cursor !== undefined)
    {
        cellPath.push(cursor);
        if (cursor === startKey)
            break;
        cursor = cameFrom.get(cursor);
        if (++guard > NODE_CAP)
            return null;
    }

    cellPath.reverse();

    const startCenterPt = canvas.grid.getCenterPoint(startOffset);

    const toPt = (key) =>
    {
        const [keyCol, keyRow] = key.split(',').map(Number);
        const centerPt = canvas.grid.getCenterPoint({ i: keyRow, j: keyCol });
        return { x: originX + (centerPt.x - startCenterPt.x), y: originY + (centerPt.y - startCenterPt.y) };
    };

    const corners = [];

    const stepDir = (fromKey, toKey) =>
    {
        const [fromCol, fromRow] = fromKey.split(',').map(Number);
        const [toCol, toRow] = toKey.split(',').map(Number);

        if (isHex)
        {
            const fromCube = grid.getCube({ i: fromRow, j: fromCol });
            const toCube = grid.getCube({ i: toRow, j: toCol });
            return `${toCube.q - fromCube.q},${toCube.r - fromCube.r}`;
        }

        return `${toCol - fromCol},${toRow - fromRow}`;
    };

    for (let idx = 1; idx < cellPath.length - 1; idx++)
    {
        if (stepDir(cellPath[idx - 1], cellPath[idx]) !== stepDir(cellPath[idx], cellPath[idx + 1]))
            corners.push(toPt(cellPath[idx]));
    }

    return corners;
}

const STRAIGHT_NODE_CAP = 20000;
const STRAIGHT_EPS = 1e-9;

function _bodyCellsFor(token)
{
    const cells = new Set();

    for (const other of canvas.tokens?.placeables ?? [])
    {
        try
        {
            if (!blocksBody(token, other))
                continue;
            for (const off of getOccupiedOffsets(other))
                cells.add(`${off.row},${off.col}`);
        }
        catch
        {
            continue;
        }
    }

    return cells;
}

function _centerLine(fromOffset, toOffset)
{
    return canvas.grid.getDirectPath([canvas.grid.getCenterPoint(fromOffset), canvas.grid.getCenterPoint(toOffset)]);
}

function _mergesExactly(merged, previous, vertex, next, keyOf, lineOf = _centerLine)
{
    if (!merged)
        return false;

    const first = lineOf(previous, vertex);
    const second = lineOf(vertex, next);
    if (merged.length !== first.length + second.length - 1)
        return false;

    return merged.every((cellKey, index) => cellKey === keyOf(index < first.length ? first[index] : second[index - first.length + 1]));
}

function _straightFallback(token, origin, destination, action)
{
    const corners = computeMovementRoute(token, origin, destination, { action });
    if (!corners)
        return null;
    if (!corners.length)
        return { corners, end: null };

    const tokenDoc = token.document;
    const gridSize = canvas.grid.size;
    const halfX = (tokenDoc.width ?? 1) * gridSize / 2;
    const halfY = (tokenDoc.height ?? 1) * gridSize / 2;
    const keyOf = (offset) => `${offset.i},${offset.j}`;
    const offsetOf = (point) => canvas.grid.getOffset({ x: (point.x ?? tokenDoc.x ?? 0) + halfX, y: (point.y ?? tokenDoc.y ?? 0) + halfY });
    const flying = parseAction(action).base === 'fly';
    const wallBlocked = makeStepWallTest(token, action);
    const bodyCells = flying || isPhasing(tokenDoc) ? new Set() : _bodyCellsFor(token);
    const typeById = getTerrainTypeMap();
    const elevation = origin.elevation ?? tokenDoc.elevation ?? 0;

    const blocked = (offset) =>
    {
        if (!cellInSceneBounds(offset))
            return true;
        if (!bodyCells.size)
            return false;

        const footprint = footprintShapesAt(tokenDoc, offset, typeById, { flyerBodies: flying }).footprint;
        return (footprint.length ? footprint : [offset]).some(cell => bodyCells.has(keyOf(cell)));
    };

    const clearPath = (from, to) =>
    {
        const path = canvas.grid.getDirectPath([canvas.grid.getCenterPoint(from), canvas.grid.getCenterPoint(to)]);
        let facing = startFacing(token, from);

        for (let index = 1; index < path.length; index++)
        {
            if (blocked(path[index]) || wallBlocked?.(path[index - 1], path[index], facing, elevation))
                return null;
            facing = facingAfterStep(facing, path[index - 1], path[index]);
        }

        return path.map(keyOf);
    };

    const vertices = [origin, ...corners, destination].map(offsetOf);
    const kept = [...corners];

    for (let index = 1; index < vertices.length - 1;)
    {
        if (_mergesExactly(clearPath(vertices[index - 1], vertices[index + 1]), vertices[index - 1], vertices[index], vertices[index + 1], keyOf))
        {
            vertices.splice(index, 1);
            kept.splice(index - 1, 1);
        }
        else
            index++;
    }

    return { corners: kept, end: null };
}

export function computeStraightRoute(token, origin, destination, { action = 'fly', start = null } = {})
{
    const tokenDoc = token?.document;
    if (!tokenDoc || !origin || !destination)
        return null;

    const state = start ?? { spent: 0, line: null };
    const originX = origin.x ?? tokenDoc.x ?? 0;
    const originY = origin.y ?? tokenDoc.y ?? 0;

    const key = ['straight', tokenDoc.id, originX, originY, origin.elevation ?? tokenDoc.elevation ?? 0, destination.x ?? originX, destination.y ?? originY,
        action, tokenDoc.width, tokenDoc.height, tokenDoc.shape, elevationModeFor(parseAction(action).base), isClimbingImmune(tokenDoc), state.spent, lineStateKey(state.line), state.airborne ? 1 : 0, state.landed ? 1 : 0].join('|');

    if (_routeMemo.has(key))
        return _routeMemo.get(key);

    const jumping = parseAction(action).base === 'jump';
    const search = jumping ? _searchJumpRoute : _searchStraightRoute;
    const route = search(token, origin, destination, action, state) ?? (jumping ? { corners: [], end: null } : _straightFallback(token, origin, destination, action));

    if (!(canvas.tokens?.placeables ?? []).some(_isMovementAnimating))
    {
        if (_routeMemo.size >= ROUTE_MEMO_CAP)
            _routeMemo.clear();
        _routeMemo.set(key, route);
    }

    return route;
}

function _straightRank(first, second)
{
    return (first.spent - second.spent) || (first.steps - second.steps) || (first.burned - second.burned) || (first.bias - second.bias);
}

function _straightContext(token, origin, action)
{
    const tokenDoc = token.document;
    const ring = straightRing();
    const edges = bandEdges(token);

    if (!ring || !edges.maxima.length)
        return null;

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const gridSize = canvas.grid.size;
    const halfX = (tokenDoc.width ?? 1) * gridSize / 2;
    const halfY = (tokenDoc.height ?? 1) * gridSize / 2;
    const originX = origin.x ?? tokenDoc.x ?? 0;
    const originY = origin.y ?? tokenDoc.y ?? 0;
    const startOffset = canvas.grid.getOffset({ x: originX + halfX, y: originY + halfY });
    const keyOf = (offset) => `${offset.i},${offset.j}`;
    const base = parseAction(action).base;
    const flying = base === 'fly';
    const jumping = base === 'jump';
    const noTerrainClimb = base === 'ignore' || autoElevDisabled();
    const typeById = getTerrainTypeMap();
    const footprintCache = new Map();
    const wallBlocked = makeStepWallTest(token, action);

    const ctx = {
        typeById,
        sceneDistance,
        flying,
        noTerrainClimb,
        elevationMode: noTerrainClimb ? null : elevationModeFor(base),
        zHeight: laTokenGameplayHeight(tokenDoc),
        climbImmune: isClimbingImmune(tokenDoc),
        freeMode: false,
        terrainImmune: isTerrainImmune(tokenDoc),
        actionKey: action,
        footprintCache,
        penaltyCache: new Map(),
        moverSize: Number(token.actor?.system?.size) || 0,
    };

    ctx.standingRule = ctx.moverSize > 1 && canPassObstructions(tokenDoc);

    const cellIndex = (offset) => (offset.i + 4096) * 8192 + offset.j + 4096;
    const facingMatters = canvas.grid.isSquare && ((tokenDoc.width ?? 1) % 2 === 0 || (tokenDoc.height ?? 1) % 2 === 0);
    const footprintKeySets = new Map();

    const footprintKeysOf = (offset) =>
    {
        const index = cellIndex(offset);
        let keys = footprintKeySets.get(index);

        if (!keys)
        {
            let fpResult = footprintCache.get(keyOf(offset));

            if (!fpResult)
            {
                fpResult = footprintShapesAt(tokenDoc, offset, typeById, { flyerBodies: flying });
                footprintCache.set(keyOf(offset), fpResult);
            }

            keys = new Set((fpResult.footprint.length ? fpResult.footprint : [offset]).map(keyOf));
            footprintKeySets.set(index, keys);
        }

        return keys;
    };

    const bodyCells = isPhasing(tokenDoc) ? new Set() : _bodyCellsFor(token);
    const bodyTouches = new Map();

    const touchesBody = (offset) =>
    {
        const index = cellIndex(offset);
        let touching = bodyTouches.get(index);

        if (touching === undefined)
        {
            touching = false;

            for (const cellKey of footprintKeysOf(offset))
            {
                if (bodyCells.has(cellKey))
                {
                    touching = true;
                    break;
                }
            }

            bodyTouches.set(index, touching);
        }

        return touching;
    };

    const bodiesBlock = bodyCells.size > 0 && !flying;
    const blockedCells = new Map();

    const cellBlocked = (offset) =>
    {
        const index = cellIndex(offset);
        let blocked = blockedCells.get(index);

        if (blocked === undefined)
        {
            blocked = !cellInSceneBounds(offset) || (bodiesBlock && touchesBody(offset));
            blockedCells.set(index, blocked);
        }

        return blocked;
    };

    const stepCache = makePairCache(cellIndex);
    const segmentCache = makePairCache(cellIndex);
    const lineCache = makePairCache(cellIndex);
    const startCenter = canvas.grid.getCenterPoint(startOffset);
    const lineDims = { width: tokenDoc.width, height: tokenDoc.height, shape: tokenDoc.shape };

    const anchorOf = (offset) =>
    {
        const center = canvas.grid.getCenterPoint(offset);
        return tokenDoc._positionToGridOffset({ x: originX + center.x - startCenter.x, y: originY + center.y - startCenter.y, ...lineDims });
    };

    const cellOfAnchor = (anchor) =>
    {
        const position = tokenDoc._gridOffsetToPosition(anchor, lineDims);
        return canvas.grid.getOffset({ x: position.x + halfX, y: position.y + halfY });
    };

    const tokenLine = (fromOffset, toOffset) => lineCache(fromOffset, toOffset, 0, 0, 0, 0, () =>
    {
        try
        {
            return canvas.grid.getDirectPath([anchorOf(fromOffset), anchorOf(toOffset)]).map(cellOfAnchor);
        }
        catch
        {
            return canvas.grid.getDirectPath([canvas.grid.getCenterPoint(fromOffset), canvas.grid.getCenterPoint(toOffset)]);
        }
    });

    const stepInto = (fromOffset, toOffset, elevation, floor, facing) =>
    {
        if (cellBlocked(toOffset))
            return null;

        return stepCache(fromOffset, toOffset, elevation, floor, facingMatters ? facing?.x : 0, facingMatters ? facing?.y : 0, () =>
        {
            if (wallBlocked?.(fromOffset, toOffset, facing, elevation * sceneDistance))
                return null;

            try
            {
                const result = evalCellStep(tokenDoc, toOffset, { prevFootprintKeys: footprintKeysOf(fromOffset), tokenElev: elevation, floor, manualDelta: 0 }, ctx);
                return { cost: 1 + (result.stepClimbCost + result.stepMalus) / sceneDistance + result.penalty, elevation: result.nextTokenElev, floor: result.nextFloor };
            }
            catch
            {
                return null;
            }
        });
    };

    const traceSegment = (node, target) =>
    {
        const path = tokenLine(node.offset, target);
        let cost = 0;
        let costBeforeLast = 0;
        let elevation = node.elevation;
        let floor = node.floor;
        let facing = node.facing;
        let previous = node.offset;

        for (let index = 1; index < path.length; index++)
        {
            const step = stepInto(previous, path[index], elevation, floor, facing);
            if (!step)
                return null;

            costBeforeLast = cost;
            cost += step.cost;
            elevation = step.elevation;
            floor = step.floor;
            facing = facingAfterStep(facing, previous, path[index]);
            previous = path[index];
        }

        return { cost, costBeforeLast, elevation, floor, facing, steps: path.length - 1 };
    };

    const walkSegment = (node, target, room) =>
    {
        const segment = segmentCache(node.offset, target, node.elevation, node.floor, facingMatters ? node.facing?.x : 0, facingMatters ? node.facing?.y : 0, () => traceSegment(node, target));
        if (!segment)
            return null;
        return segment.costBeforeLast < room - STRAIGHT_EPS ? segment : false;
    };

    const startElevation = (origin.elevation ?? tokenDoc.elevation ?? 0) / sceneDistance;

    const segmentClear = (fromOffset, toOffset) =>
    {
        const path = tokenLine(fromOffset, toOffset);
        let facing = startFacing(token, fromOffset);

        for (let index = 1; index < path.length; index++)
        {
            if (!cellInSceneBounds(path[index]) || (bodiesBlock && touchesBody(path[index])))
                return null;
            if (wallBlocked?.(path[index - 1], path[index], facing, startElevation * sceneDistance))
                return null;
            facing = facingAfterStep(facing, path[index - 1], path[index]);
        }

        return path.map(keyOf);
    };

    const jump = jumping ? makeJumpReach({ tokenDoc, ring, edges, ctx, typeById, flying, footprintCache, cellIndex, keyOf, footprintKeysOf, cellBlocked, wallBlocked, facingMatters, facingAfterStep, startOffset, originX, originY, sceneDistance }) : null;

    return { token, ring, edges, gridSize, halfX, halfY, originX, originY, startOffset, keyOf, cellIndex, footprintKeysOf, bodyCells, touchesBody, walkSegment, segmentClear, tokenLine, startElevation, jumping, jumpLeg: jump?.jumpLeg, legStart: jump?.legStart, jumpBounds: jump?.jumpBounds };
}

function _straightRoot(context, state)
{
    const { token, ring, edges, startOffset, startElevation } = context;
    const startSpan = actionSpan(edges, state.spent);
    const continuingStart = state.line?.steps > 0 && state.spent - startSpan.start > STRAIGHT_EPS;

    return {
        kind: continuingStart ? 'line' : 'fresh',
        offset: startOffset,
        cell: ring.fromOffset(startOffset),
        spent: state.spent,
        steps: 0,
        burned: 0,
        bias: 0,
        elevation: startElevation,
        floor: startElevation,
        facing: startFacing(token, startOffset),
        line: continuingStart ? state.line : null,
        shadow: undefined,
        landed: !!(state.airborne && state.landed),
        parent: null
    };
}

function _straightStateKey(context, node)
{
    return node.kind === 'line' ? `${context.keyOf(node.offset)}|${lineStateKey(node.line)}` : context.keyOf(node.offset);
}

function _expandStraight(context, node, { pushState, offLine, onArrive = null })
{
    const { ring, edges, walkSegment } = context;
    const span = actionSpan(edges, node.spent);
    const room = span.end - node.spent;
    const continuing = node.kind === 'line';

    if (continuing)
        pushState({ ...node, kind: 'fresh', spent: span.end, burned: node.burned + room, line: null, parent: node });

    for (const { offset: target, cell: targetCell } of ring.around(node.offset, Math.ceil(room - STRAIGHT_EPS)))
    {
        if (continuing && !continuesLine(ring, node.line, node.cell, targetCell))
            continue;

        const segment = walkSegment(node, target, room);
        if (!segment)
            continue;

        const spent = node.spent + segment.cost;
        const reached = { offset: target, cell: targetCell, steps: node.steps + segment.steps, bias: node.bias + offLine(target), elevation: segment.elevation, floor: segment.floor, facing: segment.facing, parent: node, burned: node.burned, spent };

        const arrival = spent >= span.end - STRAIGHT_EPS
            ? { ...reached, kind: 'fresh', line: null }
            : { ...reached, kind: 'line', line: extendLine(ring, continuing ? node.line : freshLine(node.cell), targetCell) };

        onArrive?.(arrival);
        pushState(arrival);
    }
}

function _expandReach(context, node, { pushState, onArrive, prune })
{
    const { ring, edges, walkSegment } = context;
    const span = actionSpan(edges, node.spent);
    const room = span.end - node.spent;
    const continuing = node.kind === 'line';

    if (continuing)
    {
        pushState({ ...node, kind: 'fresh', spent: span.end, burned: node.burned + room, line: null, shadow: undefined });
        if (node.shadow?.every(entry => prune(node, entry.offset, entry.cell, span.end)))
            return;
    }

    const candidates = node.shadow ?? ring.around(node.offset, Math.ceil(room - STRAIGHT_EPS));
    const arrivals = [];
    const shadow = [];
    const deferred = [];

    const visit = (entry) =>
    {
        const segment = walkSegment(node, entry.offset, room);

        if (!continuing && (!segment || segment.cost > segment.steps + STRAIGHT_EPS))
            shadow.push(entry);
        if (!segment)
            return;

        const spent = node.spent + segment.cost;
        const ends = spent >= span.end - STRAIGHT_EPS;

        arrivals.push({
            kind: ends ? 'fresh' : 'line', offset: entry.offset, cell: entry.cell, steps: node.steps + segment.steps, bias: 0,
            elevation: segment.elevation, floor: segment.floor, facing: segment.facing, burned: node.burned, spent, shadow: undefined,
            line: ends ? null : extendLine(ring, continuing ? node.line : freshLine(node.cell), entry.cell)
        });
    };

    for (const entry of candidates)
    {
        if (continuing && !node.shadow && !continuesLine(ring, node.line, node.cell, entry.cell))
            continue;

        if (!continuing && prune(node, entry.offset, entry.cell, span.end))
            deferred.push(entry);
        else
            visit(entry);
    }

    if (shadow.length)
    {
        const open = shadow.slice();

        for (const entry of deferred)
        {
            const line = extendLine(ring, freshLine(node.cell), entry.cell);
            if (open.some(member => continuesLine(ring, line, entry.cell, member.cell)))
                visit(entry);
        }
    }

    const lineShadow = continuing ? node.shadow : shadow;

    for (const arrival of arrivals)
    {
        onArrive(arrival);

        const ahead = arrival.kind === 'line' && lineShadow
            ? lineShadow.filter(entry => continuesLine(ring, arrival.line, arrival.cell, entry.cell))
            : undefined;
        const onward = ahead?.some(entry => walkSegment(arrival, entry.offset, span.end - arrival.spent))
            && !ahead.every(entry => prune(arrival, entry.offset, entry.cell, span.end));

        if (ahead && !onward)
            Object.assign(arrival, { kind: 'fresh', burned: arrival.burned + span.end - arrival.spent, spent: span.end, line: null });
        else
            arrival.shadow = ahead;

        pushState(arrival);
    }
}

function _expandJumps(context, node, { pushState, onArrive, limit, settled = null })
{
    const { ring, edges, jumpLeg, legStart, jumpBounds } = context;
    const { radius, floorAt, crossesBand } = jumpBounds(node, limit);

    for (const { offset: target, cell: targetCell } of ring.around(node.offset, radius))
    {
        const hexes = ring.distance(node.cell, targetCell);
        const floor = floorAt(hexes, target);
        if (node.spent + floor > limit + STRAIGHT_EPS)
            continue;

        const startSpent = legStart(node, targetCell);
        if (settled?.(target, startSpent + floor) || crossesBand(hexes, target, startSpent))
            continue;

        const leg = jumpLeg(node, target, startSpent);
        if (!leg || leg.spent > limit + STRAIGHT_EPS)
            continue;

        const burned = node.burned + startSpent - node.spent;
        const arrival = { kind: 'line', offset: target, cell: targetCell, steps: node.steps + leg.steps, bias: 0, elevation: leg.elevation, floor: leg.elevation, facing: leg.facing, burned, spent: leg.spent, line: null, shadow: undefined, landed: true, parent: node };
        onArrive(arrival);

        const span = actionSpan(edges, leg.spent);
        const next = leg.spent - span.start > STRAIGHT_EPS ? span.end : leg.spent;
        pushState({ ...arrival, kind: 'fresh', spent: next, burned: burned + next - leg.spent, landed: false, parent: arrival });
    }
}

function _searchJumpRoute(token, origin, destination, action, state)
{
    const context = _straightContext(token, origin, action);
    if (!context)
        return null;

    const { ring, edges, halfX, halfY, originX, originY, startOffset, keyOf, cellIndex, segmentClear, tokenLine } = context;
    const goalOffset = canvas.grid.getOffset({ x: (destination.x ?? originX) + halfX, y: (destination.y ?? originY) + halfY });

    if (keyOf(startOffset) === keyOf(goalOffset))
        return { corners: [], end: state };
    if (!cellInSceneBounds(goalOffset))
        return null;

    const budget = (edges.maxima.at(-1) ?? 0) - state.spent;
    if (ring.distance(ring.fromOffset(startOffset), ring.fromOffset(goalOffset)) > budget + STRAIGHT_EPS)
        return null;

    const best = _straightReachEntry(token, budget, { action, origin, start: state }).nodes.get(cellIndex(goalOffset));
    if (!best)
        return null;

    const route = _finishStraightRoute(best, { ring, startCenter: canvas.grid.getCenterPoint(startOffset), originX, originY, keyOf, segmentClear, tokenLine });
    return { corners: route.corners, end: { spent: best.spent, line: null, airborne: true, landed: true } };
}

function _searchStraightRoute(token, origin, destination, action, state)
{
    const context = _straightContext(token, origin, action);
    if (!context)
        return null;

    const { ring, edges, gridSize, halfX, halfY, originX, originY, startOffset, keyOf, bodyCells, touchesBody, segmentClear, tokenLine } = context;
    const goalOffset = canvas.grid.getOffset({ x: (destination.x ?? originX) + halfX, y: (destination.y ?? originY) + halfY });
    const goalKey = keyOf(goalOffset);

    if (keyOf(startOffset) === goalKey)
        return { corners: [], end: state };
    if (!cellInSceneBounds(goalOffset))
        return null;
    if (bodyCells.size && touchesBody(goalOffset))
        return null;

    const startCenter = canvas.grid.getCenterPoint(startOffset);
    const goalCenter = canvas.grid.getCenterPoint(goalOffset);
    const lineLength = Math.hypot(goalCenter.x - startCenter.x, goalCenter.y - startCenter.y) || 1;

    const offLine = (offset) =>
    {
        const point = canvas.grid.getCenterPoint(offset);
        return Math.abs((goalCenter.x - startCenter.x) * (startCenter.y - point.y) - (startCenter.x - point.x) * (goalCenter.y - startCenter.y)) / lineLength / gridSize;
    };

    const goalCell = ring.fromOffset(goalOffset);
    const heuristic = (offset) => ring.distance(ring.fromOffset(offset), goalCell);
    const limit = Math.max(edges.maxima.at(-1) ?? 0, heuristic(startOffset)) + 2 * (edges.size || 1);
    const heap = makeHeap();
    const bestFresh = new Map();

    const push = (node) =>
    {
        node.cost = node.spent + (node.kind === 'goal' ? 0 : heuristic(node.offset)) + node.steps * 1e-4 + node.burned * 1e-7 + node.bias * 1e-10;
        heap.push(node);
    };

    const pushState = (node) =>
    {
        if (node.spent > limit + STRAIGHT_EPS)
            return;

        const known = bestFresh.get(_straightStateKey(context, node));
        if (known && _straightRank(known, node) <= 0)
            return;
        bestFresh.set(_straightStateKey(context, node), node);
        push(node);
    };

    const onArrive = (arrival) =>
    {
        if (arrival.kind === 'line' && keyOf(arrival.offset) === goalKey)
            push({ ...arrival, kind: 'goal' });
    };

    const root = _straightRoot(context, state);
    bestFresh.set(_straightStateKey(context, root), root);
    push(root);

    let expansions = 0;

    while (heap.size)
    {
        const node = heap.pop();

        if (node.kind === 'goal' || (node.kind === 'fresh' && keyOf(node.offset) === goalKey))
            return _finishStraightRoute(node, { ring, startCenter, originX, originY, keyOf, segmentClear, tokenLine });

        if (bestFresh.get(_straightStateKey(context, node)) !== node)
            continue;
        if (++expansions > STRAIGHT_NODE_CAP)
            return null;

        _expandStraight(context, node, { pushState, offLine, onArrive });
    }

    return null;
}

function _occupiedCellsInto(token, cells)
{
    for (const other of canvas.tokens?.placeables ?? [])
    {
        try
        {
            if (other.id === token.id)
                continue;

            const otherDoc = other.document;
            if (otherDoc?.hidden || getLAFlag(otherDoc, 'isWreck') || isSolidToken(otherDoc))
                continue;

            const otherActor = other.actor;
            if (!otherActor)
                continue;
            if (otherActor.system?.structure?.value === 0 || otherActor.system?.stress?.value === 0)
                continue;
            if ((otherActor.type === 'pilot' || otherActor.type === 'deployable') && (otherActor.system?.hp?.value ?? 1) <= 0)
                continue;

            for (const off of getOccupiedOffsets(other))
                cells.add(`${off.col},${off.row}`);
        }
        catch
        {
            continue;
        }
    }
}

function _straightReachEntry(token, budget, { action, origin, start })
{
    const tokenDoc = token.document;
    const at = origin ?? { x: tokenDoc.x, y: tokenDoc.y, elevation: tokenDoc.elevation };
    const state = start ?? { spent: 0, line: null };
    const key = ['straightReach', tokenDoc.id, at.x, at.y, at.elevation ?? tokenDoc.elevation ?? 0, action, tokenDoc.width, tokenDoc.height, tokenDoc.shape,
        elevationModeFor(parseAction(action).base), isClimbingImmune(tokenDoc), state.spent, lineStateKey(state.line), state.airborne ? 1 : 0, state.landed ? 1 : 0, budget].join('|');

    let entry = _routeMemo.get(key);

    if (!entry)
    {
        entry = _searchStraightReach(token, at, action, state, budget);

        if (!(canvas.tokens?.placeables ?? []).some(_isMovementAnimating))
        {
            if (_routeMemo.size >= ROUTE_MEMO_CAP)
                _routeMemo.clear();
            _routeMemo.set(key, entry);
        }
    }

    return entry;
}

export function computeStraightReach(token, budget, { action = 'fly', origin = null, start = null, footprintsOut = null, occupiedOut = null } = {})
{
    const tokenDoc = token?.document;
    if (!tokenDoc || !(budget > 0))
        return new Map();

    const entry = _straightReachEntry(token, budget, { action, origin, start });

    for (const [cellKey, footprint] of entry.footprints)
        footprintsOut?.set(cellKey, footprint);
    for (const cellKey of entry.occupied)
        occupiedOut?.add(cellKey);
    return new Map(entry.reach);
}

function _searchStraightReach(token, origin, action, state, budget)
{
    const entry = { reach: new Map(), footprints: new Map(), occupied: new Set(), nodes: new Map() };
    const context = _straightContext(token, origin, action);
    if (!context)
        return entry;

    const { ring, edges, cellIndex, footprintKeysOf } = context;
    const limit = state.spent + budget;
    const heap = makeHeap();
    const best = new Map();
    const fronts = new Map();
    const reached = new Map();
    const freshAt = new Map();

    const covers = (first, second) => first.spent <= second.spent + STRAIGHT_EPS
        && first.line.lo <= second.line.lo + STRAIGHT_EPS && first.line.hi >= second.line.hi - STRAIGHT_EPS;

    const record = (node) =>
    {
        const index = cellIndex(node.offset);
        const cost = node.spent - state.spent;
        const known = reached.get(index);

        if (cost <= budget + STRAIGHT_EPS && (known === undefined || cost < known.cost))
            reached.set(index, { offset: node.offset, cost, node });

        const fresh = node.kind === 'fresh' ? node.spent : actionSpan(edges, node.spent).end;
        if (fresh < (freshAt.get(index) ?? Infinity))
            freshAt.set(index, fresh);
    };

    const prune = (node, target, targetCell, spanEnd) =>
    {
        const index = cellIndex(target);
        const known = reached.get(index);
        return known !== undefined && known.cost <= node.spent - state.spent + ring.distance(node.cell, targetCell) + STRAIGHT_EPS
            && (freshAt.get(index) ?? Infinity) <= spanEnd + STRAIGHT_EPS;
    };

    const pushState = (node) =>
    {
        if (node.spent + 1 > limit + STRAIGHT_EPS)
            return;

        if (node.kind === 'line')
        {
            const frontKey = `${context.keyOf(node.offset)}|${Object.values(node.line.origin).join(',')}|${actionSpan(edges, node.spent).end}|${node.shadow ? 1 : 0}`;
            const front = fronts.get(frontKey) ?? [];
            if (front.some(other => covers(other, node)))
                return;

            for (const other of front)
                other.covered ||= covers(node, other);
            fronts.set(frontKey, [...front.filter(other => !other.covered), node]);
        }
        else
        {
            const known = best.get(cellIndex(node.offset));
            if (known && _straightRank(known, node) <= 0)
                return;
            best.set(cellIndex(node.offset), node);
        }

        node.cost = node.spent - node.steps * 1e-4 + node.burned * 1e-7;
        heap.push(node);
    };

    const root = _straightRoot(context, state);
    record(root);
    pushState(root);

    let expansions = 0;

    while (heap.size)
    {
        const node = heap.pop();
        if (node.covered || (node.kind !== 'line' && best.get(cellIndex(node.offset)) !== node))
            continue;
        if (++expansions > STRAIGHT_NODE_CAP)
            break;

        if (context.jumping)
            _expandJumps(context, node, { pushState, onArrive: record, limit, settled: (target, floor) => (reached.get(cellIndex(target))?.cost ?? Infinity) <= floor - state.spent + STRAIGHT_EPS });
        else
            _expandReach(context, node, { pushState, onArrive: record, prune });
    }

    for (const [index, { offset, cost, node }] of reached)
    {
        const reachKey = `${offset.j},${offset.i}`;
        entry.nodes.set(index, node);
        entry.reach.set(reachKey, cost);
        entry.footprints.set(reachKey, [...footprintKeysOf(offset)].map(cellKey =>
        {
            const [cellRow, cellCol] = cellKey.split(',').map(Number);
            return `${cellCol},${cellRow}`;
        }));
    }

    _occupiedCellsInto(token, entry.occupied);
    return entry;
}

function _finishStraightRoute(node, { ring, startCenter, originX, originY, keyOf, segmentClear, tokenLine })
{
    const chain = [];

    for (let cursor = node; cursor; cursor = cursor.parent)
        chain.push(cursor);

    chain.reverse();
    const vertices = [{ offset: chain[0].offset, cell: chain[0].cell, line: chain[0].line ?? null, turn: false, elevation: chain[0].elevation }];

    for (let index = 1; index < chain.length; index++)
    {
        const step = chain[index];

        if (keyOf(step.offset) === keyOf(chain[index - 1].offset))
        {
            vertices.at(-1).turn = true;
            vertices.at(-1).line = null;
            continue;
        }

        vertices.push({ offset: step.offset, cell: step.cell, line: step.line ?? null, turn: false, elevation: step.elevation });
    }

    for (let index = 1; index < vertices.length - 1;)
    {
        const previous = vertices[index - 1];
        const next = vertices[index + 1];
        const keepsLine = !(previous.line?.steps > 0) || continuesLine(ring, previous.line, previous.cell, next.cell);
        const merged = vertices[index].turn || !keepsLine ? null : segmentClear(previous.offset, next.offset);

        if (_mergesExactly(merged, previous.offset, vertices[index].offset, next.offset, keyOf, tokenLine))
            vertices.splice(index, 1);
        else
            index++;
    }

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;

    const corners = vertices.slice(1, -1).map(({ offset, elevation }) =>
    {
        const center = canvas.grid.getCenterPoint(offset);
        return { x: originX + (center.x - startCenter.x), y: originY + (center.y - startCenter.y), elevation: elevation * sceneDistance };
    });

    return { corners, end: { spent: node.spent, line: node.kind === 'goal' ? node.line : null } };
}
