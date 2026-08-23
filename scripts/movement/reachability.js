/* global canvas, game, CONST */
// Weighted movement reach: Dijkstra flood over grid cells using the ruler's own
// per-cell cost core (evalCellStep), so the frontier matches what a drag would bill. style:ignore

import { evalCellStep, getTerrainTypeMap, footprintShapesAt, isClimbingImmune, isTerrainImmune, isPhasing } from "./cost-rules.js";
import { neighborKeys, getOccupiedOffsets, isHexGrid } from "../combat/grid-helpers.js";
import { isHostile } from "../combat/overwatch.js";

const MODULE_ID = 'lancer-automations';

function autoElevDisabled()
{
    try
    {
        return !!game.settings.get(MODULE_ID, 'disableAutoTerrainElevation');
    }
    catch
    {
        return false;
    }
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

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const flying = action === 'fly';
    // Jump: flat steps cost double and clear terrain; height changes price as climb segments like walk.
    const jumping = action === 'jump';
    const noTerrainClimb = action === 'ignore' || autoElevDisabled();
    const typeById = getTerrainTypeMap();
    const footprintCache = new Map();
    const penaltyCache = new Map();
    const ctx = {
        typeById,
        sceneDistance,
        flying,
        noTerrainClimb,
        climbImmune: isClimbingImmune(tokenDoc),
        freeMode: false,
        terrainImmune: isTerrainImmune(tokenDoc),
        actionKey: action,
        footprintCache,
        penaltyCache,
    };

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
        startShapes = footprintShapesAt(tokenDoc, startOffset, typeById);
    }
    catch
    {
        return reach;
    }
    footprintCache.set(`${startOffset.i},${startOffset.j}`, startShapes);
    const storedElevGrid = (origin?.elevation ?? tokenDoc.elevation ?? 0) / sceneDistance;
    const groundElevGrid = startShapes.top;
    const startTokenElev = noTerrainClimb ? storedElevGrid : Math.max(storedElevGrid, groundElevGrid);

    const footprintKeysOf = (offset) =>
    {
        let fpResult = footprintCache.get(`${offset.i},${offset.j}`);
        if (!fpResult)
        {
            fpResult = footprintShapesAt(tokenDoc, offset, typeById);
            footprintCache.set(`${offset.i},${offset.j}`, fpResult);
        }
        // footprint can come back empty (e.g. THT absent); the node's own cell is always occupied
        const cells = fpResult.footprint.length ? fpResult.footprint : [offset];
        return new Set(cells.map(cellOffset => `${cellOffset.i},${cellOffset.j}`));
    };

    // Lancer body blocking: blockCells "i,j" (can't enter same/larger hostile), occupiedCells "col,row" (can't end).
    const isBlockingCandidate = (cand) =>
    {
        const otherDoc = cand.document;
        if (otherDoc?.hidden)
            return false;
        if (otherDoc?.getFlag?.(MODULE_ID, 'isWreck'))
            return false;
        const otherActor = cand.actor;
        if (!otherActor || otherActor.type === 'deployable')
            return false;
        if (otherActor.system?.structure?.value === 0 || otherActor.system?.stress?.value === 0)
            return false;
        if (otherActor.type === 'pilot' && (otherActor.system?.hp?.value ?? 1) <= 0)
            return false;
        return true;
    };
    const blockCells = new Set();
    const occupiedCells = occupiedOut ?? new Set();
    const moverSize = Number(token.actor?.system?.size ?? 1) || 1;
    const moverIntangible = !!token.actor?.statuses?.has('intangible');
    const moverPhasing = isPhasing(tokenDoc);
    for (const other of (canvas.tokens?.placeables ?? []))
    {
        try
        {
            if (other.id === tokenDoc.id)
                continue;
            if (!isBlockingCandidate(other))
                continue;
            const otherSize = Number(other.actor?.system?.size ?? 1) || 1;
            const otherIntangible = !!other.actor?.statuses?.has('intangible');
            const hostileWall = !moverPhasing && otherSize >= moverSize && isHostile(other, token) && otherIntangible === moverIntangible;
            for (const off of getOccupiedOffsets(other))
            {
                occupiedCells.add(`${off.col},${off.row}`);
                if (hostileWall)
                    blockCells.add(`${off.row},${off.col}`);
            }
        }
        catch
        {
            continue;
        }
    }

    const heap = makeHeap();
    const best = new Map();
    best.set(startKey, 0);
    heap.push({ key: startKey, cost: 0, tokenElev: startTokenElev, terrainTop: groundElevGrid });

    while (heap.size)
    {
        const node = heap.pop();
        if (node.cost > (best.get(node.key) ?? Infinity))
            continue;
        reach.set(node.key, node.cost);
        const [nodeCol, nodeRow] = node.key.split(',').map(Number);
        const prevFootprintKeys = footprintKeysOf({ i: nodeRow, j: nodeCol });
        if (footprintsOut)
        {
            footprintsOut.set(node.key, [...prevFootprintKeys].map(cellKey =>
            {
                const [cellRow, cellCol] = cellKey.split(',').map(Number);
                return `${cellCol},${cellRow}`;
            }));
        }
        for (const nextKey of neighborKeys(node.key))
        {
            const [nextCol, nextRow] = nextKey.split(',').map(Number);
            const nextOffset = { i: nextRow, j: nextCol };
            if (!cellInSceneBounds(nextOffset))
                continue;
            // teleport/forced: straight-line distance, ignore terrain cost, climb and walls
            if (flat)
            {
                const nextCost = node.cost + sceneDistance;
                if (nextCost > budget + 1e-9)
                    continue;
                if (nextCost >= (best.get(nextKey) ?? Infinity))
                    continue;
                best.set(nextKey, nextCost);
                heap.push({ key: nextKey, cost: nextCost, tokenElev: node.tokenElev, terrainTop: node.terrainTop });
                continue;
            }
            if (blockCells.size)
            {
                let blocked = false;
                for (const fpKey of footprintKeysOf(nextOffset))
                {
                    if (blockCells.has(fpKey))
                    {
                        blocked = true; break;
                    }
                }
                if (blocked)
                    continue;
            }
            let step;
            try
            {
                step = evalCellStep(tokenDoc, nextOffset,
                    { prevFootprintKeys, prevTerrainTop: node.terrainTop, tokenElev: node.tokenElev, manualDelta: 0 }, ctx);
            }
            catch
            {
                continue;
            }
            const walkEdgeCost = sceneDistance + step.stepClimbCost + step.stepMalus + step.penalty * sceneDistance;
            const edgeCost = jumping
                ? (step.rawClimb > 1e-9 ? walkEdgeCost : 2 * sceneDistance)
                : walkEdgeCost;
            const nextCost = node.cost + edgeCost;
            if (nextCost > budget + 1e-9)
                continue;
            if (nextCost >= (best.get(nextKey) ?? Infinity))
                continue;
            best.set(nextKey, nextCost);
            heap.push({ key: nextKey, cost: nextCost, tokenElev: step.nextTokenElev, terrainTop: step.newTerrainTop });
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

    const flying = action === 'fly';
    const jumping = action === 'jump';
    const noTerrainClimb = action === 'ignore' || autoElevDisabled();
    const typeById = getTerrainTypeMap();
    const footprintCache = new Map();
    const ctx = {
        typeById,
        sceneDistance,
        flying,
        noTerrainClimb,
        climbImmune: isClimbingImmune(tokenDoc),
        freeMode: false,
        terrainImmune: isTerrainImmune(tokenDoc),
        actionKey: action,
        footprintCache,
        penaltyCache: new Map(),
    };

    let startShapes;
    try
    {
        startShapes = footprintShapesAt(tokenDoc, startOffset, typeById);
    }
    catch
    {
        return null;
    }
    footprintCache.set(`${startOffset.i},${startOffset.j}`, startShapes);

    const footprintKeysOf = (offset) =>
    {
        let fpResult = footprintCache.get(`${offset.i},${offset.j}`);
        if (!fpResult)
        {
            fpResult = footprintShapesAt(tokenDoc, offset, typeById);
            footprintCache.set(`${offset.i},${offset.j}`, fpResult);
        }
        const cells = fpResult.footprint.length ? fpResult.footprint : [offset];
        return new Set(cells.map(cellOffset => `${cellOffset.i},${cellOffset.j}`));
    };

    const isBlockingCandidate = (cand) =>
    {
        const otherDoc = cand.document;
        if (otherDoc?.hidden)
            return false;
        if (otherDoc?.getFlag?.(MODULE_ID, 'isWreck'))
            return false;
        const otherActor = cand.actor;
        if (!otherActor || otherActor.type === 'deployable')
            return false;
        if (otherActor.system?.structure?.value === 0 || otherActor.system?.stress?.value === 0)
            return false;
        if (otherActor.type === 'pilot' && (otherActor.system?.hp?.value ?? 1) <= 0)
            return false;
        return true;
    };
    const blockCells = new Set();
    const moverSize = Number(token.actor?.system?.size ?? 1) || 1;
    const moverIntangible = !!token.actor?.statuses?.has('intangible');
    const moverPhasing = isPhasing(tokenDoc);
    for (const other of (canvas.tokens?.placeables ?? []))
    {
        try
        {
            if (moverPhasing)
                break;
            if (other.id === tokenDoc.id)
                continue;
            if (!isBlockingCandidate(other))
                continue;
            const otherSize = Number(other.actor?.system?.size ?? 1) || 1;
            const otherIntangible = !!other.actor?.statuses?.has('intangible');
            if (!(otherSize >= moverSize && isHostile(other, token) && otherIntangible === moverIntangible))
                continue;
            for (const off of getOccupiedOffsets(other))
                blockCells.add(`${off.row},${off.col}`);
        }
        catch
        {
            continue;
        }
    }

    if (blockCells.size)
    {
        for (const fpKey of footprintKeysOf(goalOffset))
        {
            if (blockCells.has(fpKey))
                return null;
        }
    }

    const isHex = isHexGrid();
    const grid = /** @type {any} */ (canvas.grid);
    const goalCube = isHex ? grid.getCube({ i: goalOffset.i, j: goalOffset.j }) : null;
    const heuristic = (col, row) =>
    {
        if (isHex)
        {
            const cube = grid.getCube({ i: row, j: col });
            return Math.max(Math.abs(cube.q - goalCube.q), Math.abs(cube.r - goalCube.r), Math.abs(cube.s - goalCube.s)) * sceneDistance;
        }
        return Math.max(Math.abs(col - goalOffset.j), Math.abs(row - goalOffset.i)) * sceneDistance;
    };

    const storedElevGrid = (origin.elevation ?? tokenDoc.elevation ?? 0) / sceneDistance;
    const startTokenElev = noTerrainClimb ? storedElevGrid : Math.max(storedElevGrid, startShapes.top);

    const heap = makeHeap();
    const gScore = new Map([[startKey, 0]]);
    const cameFrom = new Map();
    heap.push({ key: startKey, cost: heuristic(startOffset.j, startOffset.i), g: 0, tokenElev: startTokenElev, terrainTop: startShapes.top });

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

        const [nodeCol, nodeRow] = node.key.split(',').map(Number);
        const prevFootprintKeys = footprintKeysOf({ i: nodeRow, j: nodeCol });

        for (const nextKey of neighborKeys(node.key))
        {
            const [nextCol, nextRow] = nextKey.split(',').map(Number);
            const nextOffset = { i: nextRow, j: nextCol };

            if (!cellInSceneBounds(nextOffset))
                continue;

            if (blockCells.size)
            {
                let blocked = false;
                for (const fpKey of footprintKeysOf(nextOffset))
                {
                    if (blockCells.has(fpKey))
                    {
                        blocked = true; break;
                    }
                }
                if (blocked)
                    continue;
            }

            let step;
            try
            {
                step = evalCellStep(tokenDoc, nextOffset,
                    { prevFootprintKeys, prevTerrainTop: node.terrainTop, tokenElev: node.tokenElev, manualDelta: 0 }, ctx);
            }
            catch
            {
                continue;
            }

            const walkEdgeCost = sceneDistance + step.stepClimbCost + step.stepMalus + step.penalty * sceneDistance;
            const edgeCost = jumping
                ? (step.rawClimb > 1e-9 ? walkEdgeCost : 2 * sceneDistance)
                : walkEdgeCost;
            const tentativeG = node.g + edgeCost;
            if (tentativeG >= (gScore.get(nextKey) ?? Infinity))
                continue;
            gScore.set(nextKey, tentativeG);
            cameFrom.set(nextKey, node.key);
            heap.push({ key: nextKey, cost: tentativeG + heuristic(nextCol, nextRow), g: tentativeG, tokenElev: step.nextTokenElev, terrainTop: step.newTerrainTop });
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
