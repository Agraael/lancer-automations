/* global canvas, CONST, game, fromUuidSync */
import { getHexGroundElevation } from "./terrain-utils.js";

// Lancer v3 changed acc_diff targets from `{target: Token}` to `{targetUuid: string}`.
export function accDiffTargetToken(accDiffTarget)
{
    return accDiffTarget?.targetUuid ? (fromUuidSync(accDiffTarget.targetUuid)?.object ?? null) : null;
}

/** Dimensions clamped to min 1 grid unit: sub-1-size tokens (e.g. 0.5-size mechs) still occupy a full cell. */
export function getGameplayDimensions(token)
{
    const doc = token.document ?? token;
    return {
        width: Math.max(1, doc.width),
        height: Math.max(1, doc.height)
    };
}

export function isHexGrid()
{
    return canvas.grid.type === CONST.GRID_TYPES.HEXODDR ||
        canvas.grid.type === CONST.GRID_TYPES.HEXEVENR ||
        canvas.grid.type === CONST.GRID_TYPES.HEXODDQ ||
        canvas.grid.type === CONST.GRID_TYPES.HEXEVENQ;
}

export function isColumnarHex()
{
    const gridType = canvas.grid.type;
    return gridType === 4 || gridType === 5;
}

export function offsetToCube(col, row)
{
    const gridType = canvas.grid.type;
    let q, r, s;

    switch (gridType)
    {
        case 2:
            q = col - Math.floor((row - (row & 1)) / 2);
            r = row;
            s = -q - r;
            break;
        case 3:
            q = col - Math.floor((row + (row & 1)) / 2);
            r = row;
            s = -q - r;
            break;
        case 4:
            q = col;
            r = row - Math.floor((col - (col & 1)) / 2);
            s = -q - r;
            break;
        case 5:
            q = col;
            r = row - Math.floor((col + (col & 1)) / 2);
            s = -q - r;
            break;
        default:
            q = col;
            r = row;
            s = 0;
    }

    return { q, r, s };
}

export function cubeToOffset(cube)
{
    const gridType = canvas.grid.type;
    let col, row;

    switch (gridType)
    {
        case 2:
            col = cube.q + Math.floor((cube.r - (cube.r & 1)) / 2);
            row = cube.r;
            break;
        case 3:
            col = cube.q + Math.floor((cube.r + (cube.r & 1)) / 2);
            row = cube.r;
            break;
        case 4:
            col = cube.q;
            row = cube.r + Math.floor((cube.q - (cube.q & 1)) / 2);
            break;
        case 5:
            col = cube.q;
            row = cube.r + Math.floor((cube.q + (cube.q & 1)) / 2);
            break;
        default:
            col = cube.q;
            row = cube.r;
    }

    return { col, row };
}

export function cubeRound(q, r, s)
{
    let roundedQ = Math.round(q), roundedR = Math.round(r), roundedS = Math.round(s);
    const dq = Math.abs(roundedQ - q), dr = Math.abs(roundedR - r), ds = Math.abs(roundedS - s);
    if (dq > dr && dq > ds)
        roundedQ = -roundedR - roundedS;
    else if (dr > ds)
        roundedR = -roundedQ - roundedS;
    else
        roundedS = -roundedQ - roundedR;
    return { q: roundedQ, r: roundedR, s: roundedS };
}

export function cubeDistance(cube1, cube2)
{
    return Math.max(
        Math.abs(cube1.q - cube2.q),
        Math.abs(cube1.r - cube2.r),
        Math.abs(cube1.s - cube2.s)
    );
}

export function getHexesInRange(center, range)
{
    const results = [];
    for (let q = -range; q <= range; q++)
    {
        for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++)
        {
            const s = -q - r;
            results.push({
                q: center.q + q,
                r: center.r + r,
                s: center.s + s
            });
        }
    }
    return results;
}

// Adjacent cell keys ("col,row"): 6 hex neighbors, 8 on square grids.
export function neighborKeys(key)
{
    const [col, row] = key.split(',').map(Number);
    const keys = [];
    if (isHexGrid())
    {
        /** @type {any} */
        const grid = canvas.grid;
        const centerCube = grid.getCube({ i: row, j: col });
        const dirs = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];
        for (const [dq, dr, ds] of dirs)
        {
            const neighborOff = grid.getOffset({ q: centerCube.q + dq, r: centerCube.r + dr, s: centerCube.s + ds });
            keys.push(`${neighborOff.j},${neighborOff.i}`);
        }
    }
    else
    {
        for (let dc = -1; dc <= 1; dc++)
        {
            for (let dr = -1; dr <= 1; dr++)
            {
                if (dc || dr)
                    keys.push(`${col + dc},${row + dr}`);
            }
        }
    }
    return keys;
}

export function getHexCenter(col, row)
{
    if (canvas.grid.getCenterPoint)
    {
        const centerPt = canvas.grid.getCenterPoint({ i: row, j: col });
        return { x: centerPt.x, y: centerPt.y };
    }
    else
    {
        const [cx, cy] = canvas.grid.grid.getCenter(row, col);
        return { x: cx, y: cy };
    }
}

export function pixelToOffset(x, y)
{
    if (canvas.grid.getOffset)
    {
        const offset = canvas.grid.getOffset({ x, y });
        return { col: offset.j, row: offset.i };
    }
    else
    {
        const pos = canvas.grid.grid.getGridPositionFromPixels(x, y);
        return { col: pos[1], row: pos[0] };
    }
}

export function getTokenCenterOffset(token)
{
    const doc = token.document;
    const gridSize = canvas.grid.size;
    const centerX = doc.x + (doc.width * gridSize / 2);
    const centerY = doc.y + (doc.height * gridSize / 2);
    return pixelToOffset(centerX, centerY);
}

// Snapped CENTER of the cell `steps` from `from` toward (or `away` from) `toward`, walking real grid neighbors. from/toward: a Token or {x, y}.
export function getCellToward(from, toward, { steps = 1, away = false } = {})
{
    const fromPoint = from?.center ?? from;
    const towardPoint = toward?.center ?? toward;
    const goal = away
        ? { x: (2 * fromPoint.x) - towardPoint.x, y: (2 * fromPoint.y) - towardPoint.y }
        : towardPoint;

    let current = pixelToOffset(fromPoint.x, fromPoint.y);
    for (let step = 0; step < steps; step++)
    {
        let best = null;
        let bestDist = Infinity;
        for (const key of neighborKeys(`${current.col},${current.row}`))
        {
            const [col, row] = key.split(',').map(Number);
            const center = getHexCenter(col, row);
            const dist = Math.hypot(center.x - goal.x, center.y - goal.y);
            if (dist < bestDist)
            {
                bestDist = dist;
                best = { col, row };
            }
        }
        if (!best)
            break;
        current = best;
    }
    return getHexCenter(current.col, current.row);
}

export function getHexVertices(col, row)
{
    const center = getHexCenter(col, row);
    const points = [];
    const gridSize = canvas.grid.size;

    if (canvas.grid.getShape)
    {
        const shape = /** @type {PIXI.Polygon} */ (/** @type {unknown} */ (canvas.grid.getShape()));
        if (shape && shape.points && shape.points.length > 0)
        {
            for (let i = 0; i < shape.points.length; i += 2)
                points.push({ x: shape.points[i] + center.x, y: shape.points[i + 1] + center.y });
            return points;
        }
    }

    const isFlat = (canvas.grid.type === 4 || canvas.grid.type === 5);
    const startAngle = isFlat ? 0 : 30;
    const radius = (gridSize / 2) * 1.1547;

    for (let i = 0; i < 6; i++)
    {
        const angle_deg = 60 * i + startAngle;
        const angle_rad = Math.PI / 180 * angle_deg;
        points.push({
            x: center.x + radius * Math.cos(angle_rad),
            y: center.y + radius * Math.sin(angle_rad)
        });
    }
    return points;
}

export function drawHexAt(graphics, col, row)
{
    if (isHexGrid())
    {
        const vertices = getHexVertices(col, row);
        const points = [];
        for (const v of vertices)
            points.push(v.x, v.y);
        graphics.drawPolygon(points);
    }
    else
    {
        const center = getHexCenter(col, row);
        const gridSize = canvas.grid.size;
        graphics.drawCircle(center.x, center.y, gridSize / 3);
    }
}

export function measureGridDistance(point1, point2)
{
    const distance = canvas.grid.measurePath
        ? canvas.grid.measurePath([point1, point2], {}).distance
        : canvas.grid.measureDistance(point1, point2, {});
    return Array.isArray(distance) ? distance.reduce((sum, segment) => sum + segment, 0) : distance;
}

export function getOccupiedOffsets(token, overridePos = null)
{
    // v13: getOccupiedGridSpaceOffsets returns {i,j} grid offsets directly.
    const doc = token.document ?? token;
    if (typeof doc.getOccupiedGridSpaceOffsets === 'function')
    {
        const pos = overridePos
            ? { x: overridePos.x, y: overridePos.y, width: doc.width, height: doc.height }
            : { x: doc.x, y: doc.y, width: doc.width, height: doc.height };
        return doc.getOccupiedGridSpaceOffsets(pos).map(gridOffset => ({ col: gridOffset.j, row: gridOffset.i }));
    }
    // v12 fallback (Lancer system extension on the Token class).
    if (typeof token.getOccupiedSpaces === 'function')
    {
        const dx = overridePos ? (overridePos.x - token.x) : 0;
        const dy = overridePos ? (overridePos.y - token.y) : 0;
        return token.getOccupiedSpaces().map(spacePoint =>
        {
            const offset = canvas.grid.getOffset({ x: spacePoint.x + dx, y: spacePoint.y + dy });
            return { col: offset.j, row: offset.i };
        });
    }

    const x = overridePos ? overridePos.x : doc.x;
    const y = overridePos ? overridePos.y : doc.y;
    const gridSize = canvas.grid.size;

    const centerX = x + (doc.width * gridSize / 2);
    const centerY = y + (doc.height * gridSize / 2);
    const centerOffset = pixelToOffset(centerX, centerY);

    if (doc.width <= 1 && doc.height <= 1)
        return [centerOffset];

    const offsets = [];
    const scanRadius = Math.ceil(Math.max(doc.width, doc.height));

    for (let di = -scanRadius; di <= scanRadius; di++)
    {
        for (let dj = -scanRadius; dj <= scanRadius; dj++)
        {
            const col = centerOffset.col + di;
            const row = centerOffset.row + dj;

            const center = getHexCenter(col, row);

            const localX = center.x - x;
            const localY = center.y - y;

            if (token.shape && token.shape.contains(localX, localY))
                offsets.push({ col, row });
        }
    }

    if (offsets.length === 0)
        offsets.push(centerOffset);

    return offsets;
}

export function getOccupiedCenters(token, overridePos = null)
{
    const offsets = getOccupiedOffsets(token, overridePos);
    return offsets.map(offset => getHexCenter(offset.col, offset.row));
}

/** @returns {number} */
export function getMinGridDistance(token1, token2, overridePos1 = null, includeElevation = undefined)
{
    if (includeElevation === undefined)
    {
        try
        {
            includeElevation = !!game.settings.get('lancer-automations', 'count3DDistance');
        }
        catch
        {
            includeElevation = false;
        }
    }
    let planarDist;
    if (!isHexGrid())
    {
        const centers1 = getOccupiedCenters(token1, overridePos1);
        const centers2 = getOccupiedCenters(token2);

        let minDist = Infinity;
        for (const center1 of centers1)
        {
            for (const center2 of centers2)
            {
                const rawDist = measureGridDistance(center1, center2);
                if (rawDist < minDist)
                    minDist = rawDist;
            }
        }
        planarDist = Math.round(minDist / canvas.scene.grid.distance);
    }
    else
    {
        const offsets1 = getOccupiedOffsets(token1, overridePos1);
        const offsets2 = getOccupiedOffsets(token2);

        let minDist = Infinity;
        for (const offset1 of offsets1)
        {
            const cube1 = offsetToCube(offset1.col, offset1.row);
            for (const offset2 of offsets2)
            {
                const cube2 = offsetToCube(offset2.col, offset2.row);
                const dist = cubeDistance(cube1, cube2);
                if (dist < minDist)
                    minDist = dist;
            }
        }
        planarDist = minDist;
    }

    if (!includeElevation)
        return planarDist;

    const elev1 = token1?.document?.elevation ?? 0;
    const elev2 = token2?.document?.elevation ?? 0;
    const elevDist = Math.round(Math.abs(elev1 - elev2) / canvas.scene.grid.distance);
    // Max: 5 horizontal + 3 vertical = 5 (dominant axis wins).
    return Math.max(planarDist, elevDist);
}

/** Combat-elevation flag: setting on AND THT active. */
export function isElevationCheckActive()
{
    if (!globalThis.terrainHeightTools)
        return false;
    try
    {
        return !!game.settings.get('lancer-automations', 'count3DDistance');
    }
    catch
    {
        return false;
    }
}

/**
 * Elevation in scene grid units. Token → its document.elevation. Point → highest terrain at the point's hex.
 * @param {Token|TokenDocument|{x:number,y:number}} originOrToken
 * @returns {number}
 */
export function getOriginElevation(originOrToken)
{
    if (!originOrToken)
        return 0;
    const doc = originOrToken.document ?? (typeof originOrToken.elevation === 'number' ? originOrToken : null);
    if (doc)
        return doc.elevation ?? 0;
    if (typeof originOrToken.x === 'number' && typeof originOrToken.y === 'number')
    {
        const hexOffset = pixelToOffset(originOrToken.x, originOrToken.y);
        return getHexGroundElevation(hexOffset.col, hexOffset.row);
    }
    return 0;
}

/**
 * Set of "col,row" keys reachable from `origin` within `range`. With combat elevation on,
 * filters out hexes where |hex_terrain_elev - origin_elev| > range.
 * @param {Token|TokenDocument|{x:number,y:number}} origin
 * @param {number} range
 * @param {{ includeSelf?: boolean, elevationAware?: boolean }} [opts]
 * @returns {Set<string>}
 */
export function getInRangeOffsets(origin, range, opts = {})
{
    const elevAware = opts.elevationAware ?? isElevationCheckActive();
    const includeSelf = opts.includeSelf ?? false;
    const isPoint = origin && !origin.document && typeof origin.x === 'number' && typeof origin.y === 'number';
    const originOffsets = isPoint ? [pixelToOffset(origin.x, origin.y)] : getOccupiedOffsets(origin);
    const originElev = getOriginElevation(origin);
    const selfKeys = new Set(originOffsets.map(offset => `${offset.col},${offset.row}`));

    const candidates = new Set();
    if (isHexGrid())
    {
        for (const originOffset of originOffsets)
        {
            const cube = offsetToCube(originOffset.col, originOffset.row);
            for (const hexCube of getHexesInRange(cube, range))
            {
                const candidateOffset = cubeToOffset(hexCube);
                candidates.add(`${candidateOffset.col},${candidateOffset.row}`);
            }
        }
    }
    else
    {
        for (const originOffset of originOffsets)
        {
            for (let dx = -range; dx <= range; dx++)
            {
                for (let dy = -range; dy <= range; dy++)
                {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) <= range)
                        candidates.add(`${originOffset.col + dx},${originOffset.row + dy}`);
                }
            }
        }
    }

    if (!elevAware)
    {
        if (!includeSelf)
        {
            for (const k of selfKeys)
                candidates.delete(k);
        }
        return candidates;
    }

    const sceneDist = canvas.scene.grid.distance || 1;
    const inRangeKeys = new Set();
    for (const key of candidates)
    {
        if (!includeSelf && selfKeys.has(key))
            continue;
        const [col, row] = key.split(',').map(Number);
        const hexElev = getHexGroundElevation(col, row);
        const elevAbove = Math.round((hexElev - originElev) / sceneDist);
        if (elevAbove > range)
            continue;
        inRangeKeys.add(key);
    }
    return inRangeKeys;
}

/**
 * True iff any of `target`'s occupied hexes lies within `range` of `origin` (elevation-aware when active).
 * @param {Token|TokenDocument|{x:number,y:number}} origin
 * @param {Token|TokenDocument|{x:number,y:number}} target
 * @param {number} range
 * @returns {boolean}
 */
export function isPositionInRange(origin, target, range)
{
    const inRange = getInRangeOffsets(origin, range, { includeSelf: true });
    const isPoint = target && !target.document && typeof target.x === 'number' && typeof target.y === 'number';
    const targetOffsets = isPoint ? [pixelToOffset(target.x, target.y)] : getOccupiedOffsets(target);
    let horizontalOk = false;
    for (const offset of targetOffsets)
    {
        if (inRange.has(`${offset.col},${offset.row}`))
        {
            horizontalOk = true;
            break;
        }
    }
    if (!horizontalOk)
        return false;
    // vertical: |Δelev| must be within range too
    const sceneDist = canvas.scene.grid.distance || 1;
    const vertDist = Math.round(Math.abs(getOriginElevation(target) - getOriginElevation(origin)) / sceneDist);
    return vertDist <= range;
}

/**
 * Snaps a token's center to the grid, accounting for its size and grid type.
 * @param {Token} token
 * @param {Object} centerPoint - The desired center point {x, y}
 * @returns {Object} The snapped top-left position {x, y}
 */
export function snapTokenCenter(token, centerPoint)
{
    const doc = token.document ?? token;
    if (doc.width < 1 || doc.height < 1)
    {
        const offset = pixelToOffset(centerPoint.x, centerPoint.y);
        const cellCenter = getHexCenter(offset.col, offset.row);
        return {
            x: cellCenter.x - (token.w / 2),
            y: cellCenter.y - (token.h / 2)
        };
    }
    const topLeftX = centerPoint.x - (token.w / 2);
    const topLeftY = centerPoint.y - (token.h / 2);
    return token.getSnappedPosition({ x: topLeftX, y: topLeftY });
}

// Set of occupied "col,row" references for all tokens on the canvas, minus the excluded IDs.
export function getOccupiedGridSpaces(excludeIds = [])
{
    const occupied = new Set();
    const excludeSet = new Set(excludeIds);

    for (const token of canvas.tokens.placeables)
    {
        if (excludeSet.has(token.id))
            continue;
        if (!token.actor)
            continue;
        if (token.document.hidden)
            continue;

        const tokenOffsets = getOccupiedOffsets(token);
        for (const offset of tokenOffsets)
            occupied.add(`${offset.col},${offset.row}`);
    }
    return occupied;
}

/**
 * Extracts the full, continuous sequence of hex centers a Token passes through during a movement.
 * Uses native getDirectPath and accounts for even-sized token alignment.
 * @param {Token} token
 * @param {Object} change - The proposed coordinate change {x, y}
 * @returns {PathHexArray} Array of steps, each containing an array of {x, y} hex centers occupied.
 */
export function getMovementPathHexes(token, change, dragWaypoints = null)
{
    let rawPoints = [];

    const getCenterFromTopLeft = (x, y) => ({
        x: x + (token.document.width * canvas.grid.size / 2),
        y: y + (token.document.height * canvas.grid.size / 2)
    });

    if (Array.isArray(dragWaypoints) && dragWaypoints.length)
    {
        rawPoints.push(getCenterFromTopLeft(token.document.x, token.document.y));
        for (const waypoint of dragWaypoints)
            rawPoints.push(getCenterFromTopLeft(waypoint.x, waypoint.y));
    }

    let newMoveStartRayIndex = 0;
    if (rawPoints.length === 0 && token._movement && token._movement.points)
    {
        const movePoints = token._movement.points;
        rawPoints.push(getCenterFromTopLeft(token.document.x, token.document.y));
        for (let i = 0; i < movePoints.length; i+=2)
            rawPoints.push(getCenterFromTopLeft(movePoints[i], movePoints[i+1]));
    }

    // Fallback 2: just A to B
    if (rawPoints.length === 0)
    {
        rawPoints.push(getCenterFromTopLeft(token.document.x, token.document.y));
        rawPoints.push(getCenterFromTopLeft(change.x ?? token.document.x, change.y ?? token.document.y));
    }

    let pathHexes = /** @type {PathHexArray} */ (/** @type {unknown} */ ([]));
    let seenHexes = new Set();

    const getOffsetFromPx = (px, py) =>
    {
        if (canvas.grid.getOffset)
        {
            const offset = canvas.grid.getOffset({ x: px, y: py });
            return { col: offset.j, row: offset.i };
        }
        else
        {
            const pos = canvas.grid.grid.getGridPositionFromPixels(px, py);
            return { col: pos[1], row: pos[0] };
        }
    };

    for (let i = 0; i < rawPoints.length - 1; i++)
    {
        const p1 = rawPoints[i];
        const p2 = rawPoints[i + 1];

        const alignOffset = { x: 0, y: 0 };
        if (canvas.grid.isHexagonal && token.document.width % 2 === 0)
        {
            if (/** @type {any} */ (canvas.grid).columns)
                alignOffset.x = canvas.grid.sizeX / 2;
            else
                alignOffset.y = canvas.grid.sizeY / 2;
        }

        const adjustedP1 = { x: p1.x + alignOffset.x, y: p1.y + alignOffset.y };
        const adjustedP2 = { x: p2.x + alignOffset.x, y: p2.y + alignOffset.y };

        const pathOffsets = canvas.grid.getDirectPath([adjustedP1, adjustedP2]);

        for (const step of pathOffsets)
        {
            const stepHexCenter = getHexCenter(step.j, step.i);
            const trueTokenCenter = { x: stepHexCenter.x - alignOffset.x, y: stepHexCenter.y - alignOffset.y };

            const topLeft = {
                x: trueTokenCenter.x - (token.document.width * canvas.grid.size / 2),
                y: trueTokenCenter.y - (token.document.height * canvas.grid.size / 2)
            };

            const occupiedHexCenters = getOccupiedCenters(token, topLeft);

            let newHexesInThisStep = [];
            for (const center of occupiedHexCenters)
            {
                const offset = getOffsetFromPx(center.x, center.y);
                const hexKey = `${offset.row},${offset.col}`;

                if (!seenHexes.has(hexKey))
                {
                    seenHexes.add(hexKey);
                    newHexesInThisStep.push({ x: center.x, y: center.y });
                }
            }

            if (newHexesInThisStep.length > 0)
            {
                pathHexes.push({
                    x: topLeft.x,
                    y: topLeft.y,
                    cx: trueTokenCenter.x,
                    cy: trueTokenCenter.y,
                    hexes: newHexesInThisStep,
                    isHistory: i < newMoveStartRayIndex
                });
            }
        }
    }

    // Identify true historyStartIndex by matching the token's current center to pathHexes
    const startCenter = {
        x: token.document.x + (token.document.width * canvas.grid.size / 2),
        y: token.document.y + (token.document.height * canvas.grid.size / 2)
    };

    let matchIndex = -1;
    for (let i = 0; i < pathHexes.length; i++)
    {
        // Skip steps already natively flagged as history from previous rounds
        if (pathHexes[i].isHistory)
            continue;

        const dist = Math.hypot(pathHexes[i].cx - startCenter.x, pathHexes[i].cy - startCenter.y);
        // Take the FIRST match within half a grid square to avoid jumping ahead on looping paths
        if (dist <= canvas.grid.size / 2)
        {
            matchIndex = i;
            break;
        }
    }

    if (matchIndex !== -1)
        pathHexes.historyStartIndex = matchIndex;
    else
    {
        // Fallback
        pathHexes.historyStartIndex = pathHexes.findIndex(step => !step.isHistory);
        if (pathHexes.historyStartIndex === -1)
            pathHexes.historyStartIndex = 0;
    }

    for (let i = 0; i < pathHexes.length; i++)
        pathHexes[i].isHistory = i < pathHexes.historyStartIndex;

    pathHexes.getPathPositionAt = (index) =>
    {
        if (index < 0 || index >= pathHexes.length)
            return null;
        const step = pathHexes[index];
        return snapTokenCenter(token, { x: step.cx, y: step.cy });
    };

    return pathHexes;
}

/**
 * @param {PathHexArray} pathHexes
 */
export function drawDebugPath(pathHexes)
{
    if (!canvas.lancerDebugPath)
    {
        canvas.lancerDebugPath = new PIXI.Graphics();
        canvas.stage.addChild(canvas.lancerDebugPath);
    }
    else
        canvas.lancerDebugPath.clear();

    const graphics = canvas.lancerDebugPath;

    for (let i = 0; i < pathHexes.length; i++)
    {
        const step = pathHexes[i];
        const stepColor = Math.floor(Math.random() * 0xFFFFFF);

        graphics.lineStyle(4, stepColor);

        for (let center of step.hexes)
        {
            let fillAlpha = step.isHistory ? 0.2 : 0.4;
            let radius = step.isHistory ? canvas.grid.size / 6 : canvas.grid.size / 3;

            graphics.beginFill(stepColor, fillAlpha);
            graphics.drawCircle(center.x, center.y, radius);
            graphics.endFill();
        }
    }
}

export function getDistanceTokenToPoint(point, token)
{
    const tokenCenterOffset = getTokenCenterOffset(token);

    if (isHexGrid())
    {
        const tokenCenterCube = offsetToCube(tokenCenterOffset.col, tokenCenterOffset.row);
        const pointOffset = pixelToOffset(point.x, point.y);
        const pointCube = offsetToCube(pointOffset.col, pointOffset.row);

        return cubeDistance(tokenCenterCube, pointCube);
    }
    else
    {
        const tokenCenter = getHexCenter(tokenCenterOffset.col, tokenCenterOffset.row);
        return Math.round(measureGridDistance(tokenCenter, point) / canvas.scene.grid.distance);
    }
}
