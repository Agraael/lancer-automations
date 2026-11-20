import { LOS_TARGET_ABOVE } from '../tools/constants.js';
import { _segmentBlocked, _blocksAlone } from './losCore.js';

const PAIR_CLEAR = 0;
const PAIR_BLOCKED = 1;
const PAIR_GRAZED = 2;
const RECENT_BLOCKER_LIMIT = 4;
const SEGMENT_BOX_SLACK = 1e-6;
const WALL_PARAM_SLACK = 1 + 1e-9;

function hexTestPointsFrom(center, corners)
{
    const points = [center];
    for (const corner of corners)
        points.push({ x: center.x + (corner.x - center.x) * 0.9, y: center.y + (corner.y - center.y) * 0.9 });
    return points;
}

function _edgeMinDistance(record, point)
{
    const closest = foundry.utils.closestPointToSegment(point, record.edge.a, record.edge.b);
    return Math.hypot(closest.x - point.x, closest.y - point.y);
}

function _recentToFront(list, value)
{
    let at = list.indexOf(value);

    if (at < 0)
    {
        if (list.length < RECENT_BLOCKER_LIMIT)
            list.push(value);
        at = list.length - 1;
    }

    for (let idx = at; idx > 0; idx--)
        list[idx] = list[idx - 1];
    list[0] = value;
}

function _pointsBox(points, seed = null)
{
    const box = seed
        ? { minX: seed.minX, minY: seed.minY, maxX: seed.maxX, maxY: seed.maxY }
        : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (const point of points)
    {
        box.minX = Math.min(box.minX, point.x);
        box.minY = Math.min(box.minY, point.y);
        box.maxX = Math.max(box.maxX, point.x);
        box.maxY = Math.max(box.maxY, point.y);
    }

    return box;
}

// Sweeps and skim walks both run at eye height, so a low wall's shadow band is re-checked per hex at terrain top
// plus a target height. Plain crossings decide, a crossing at a wall corner goes back to the rule engine's skim rules.
function createTrigShadowTester({ eye, center, originPoints, records: wallRecords, hasCaster, casterEye, tokenId, tokenRadius, hexTestPoints, groundAt })
{
    const distanceTo = point => Math.hypot(point.x - center.x, point.y - center.y);
    const skipPrefix = `la-block-los-${tokenId}-`;

    // nearest first, so a hex only scans the walls that can sit between it and the viewer
    const walls = wallRecords
        .filter(record => !record.id.startsWith(skipPrefix))
        .map(record => ({ record, reach: _edgeMinDistance(record, center) }))
        .sort((left, right) => left.reach - right.reach);

    if (!walls.some(entry => entry.record.top < eye))
        return null;

    // centre first: on open ground the first pair clears and the hex costs one test
    const origins = [...originPoints].sort((left, right) => distanceTo(left) - distanceTo(right));
    const originBox = _pointsBox(origins);
    const originReach = Math.max(0, ...origins.map(distanceTo));
    const vertexTol = canvas.grid.size * 0.05;
    const hexReach = canvas.grid.size;
    const corridorPad = canvas.grid.size * 0.1;
    const targetRadius = canvas.grid.size / 2;

    const count = walls.length;
    const records = walls.map(entry => entry.record);
    const indexOf = new Map(records.map((record, index) => [record, index]));
    const ax = new Float64Array(count);
    const ay = new Float64Array(count);
    const bx = new Float64Array(count);
    const by = new Float64Array(count);
    const bottom = new Float64Array(count);
    const top = new Float64Array(count);
    const direction = new Int8Array(count);
    const minX = new Float64Array(count);
    const maxX = new Float64Array(count);
    const minY = new Float64Array(count);
    const maxY = new Float64Array(count);
    const reach = new Float64Array(count);

    for (let index = 0; index < count; index++)
    {
        const record = records[index];
        ax[index] = record.edge.a.x;
        ay[index] = record.edge.a.y;
        bx[index] = record.edge.b.x;
        by[index] = record.edge.b.y;
        bottom[index] = record.bottom;
        top[index] = record.top;
        direction[index] = record.edge.direction || 0;
        minX[index] = record.minX;
        maxX[index] = record.maxX;
        minY[index] = record.minY;
        maxY[index] = record.maxY;
        reach[index] = walls[index].reach;
    }

    const recentLow = [];
    const recentEngine = [];
    const single = [null];
    const stats = { tested: 0, casterRays: 0 };

    const isHidden = (col, row) =>
    {
        stats.tested++;
        const targets = hexTestPoints(col, row);
        const hexCenter = targets[0];
        const box = _pointsBox(targets, originBox);
        const limit = distanceTo(hexCenter) + hexReach;

        const inHexList = index => reach[index] <= limit
            && !(maxX[index] < box.minX || minX[index] > box.maxX || maxY[index] < box.minY || minY[index] > box.maxY);

        const hex = { col, row, targetHeight: null, wallIdx: null, lowIdx: null, walls: null };

        const collect = () =>
        {
            const lineX = hexCenter.x - center.x;
            const lineY = hexCenter.y - center.y;
            const lineLen = Math.hypot(lineX, lineY) || 1;
            const unitX = lineX / lineLen;
            const unitY = lineY / lineLen;
            let targetReach = 0;
            for (const target of targets)
                targetReach = Math.max(targetReach, Math.hypot(target.x - hexCenter.x, target.y - hexCenter.y));

            const band = Math.max(originReach, targetReach) + corridorPad;
            hex.wallIdx = [];
            hex.lowIdx = [];

            for (let index = 0; index < count; index++)
            {
                if (reach[index] > limit)
                    break;
                if (maxX[index] < box.minX || minX[index] > box.maxX || maxY[index] < box.minY || minY[index] > box.maxY)
                    continue;

                const sideA = ((ax[index] - center.x) * unitY) - ((ay[index] - center.y) * unitX);
                const sideB = ((bx[index] - center.x) * unitY) - ((by[index] - center.y) * unitX);

                if ((sideA > band && sideB > band) || (sideA < -band && sideB < -band))
                    continue;

                const alongA = ((ax[index] - center.x) * unitX) + ((ay[index] - center.y) * unitY);
                const alongB = ((bx[index] - center.x) * unitX) + ((by[index] - center.y) * unitY);

                if ((alongA < -band && alongB < -band) || (alongA > lineLen + band && alongB > lineLen + band))
                    continue;
                hex.wallIdx.push(index);
                if (top[index] < eye)
                    hex.lowIdx.push(index);
            }
        };

        let from = null;
        let fromX = 0;
        let fromY = 0;
        let rayX = 0;
        let rayY = 0;

        const crossState = (index) =>
        {
            const aX = ax[index];
            const aY = ay[index];
            const wallX = bx[index] - aX;
            const wallY = by[index] - aY;
            const denom = (rayX * wallY) - (rayY * wallX);

            if (Math.abs(denom) <= 1e-9)
                return PAIR_CLEAR;

            const toWallX = aX - fromX;
            const toWallY = aY - fromY;
            const numRay = (toWallX * wallY) - (toWallY * wallX);

            if (denom > 0 ? (numRay <= 0 || numRay >= denom) : (numRay >= 0 || numRay <= denom))
                return PAIR_CLEAR;

            const numWall = (toWallX * rayY) - (toWallY * rayX);
            if (denom > 0 ? (numWall < 0 || numWall > denom * WALL_PARAM_SLACK) : (numWall > 0 || numWall < denom * WALL_PARAM_SLACK))
                return PAIR_CLEAR;

            const alongRay = numRay / denom;
            const alongWall = numWall / denom;

            if (alongRay <= 0 || alongRay >= 1 || alongWall < 0 || alongWall > 1)
                return PAIR_CLEAR;

            const wallDirection = direction[index];
            if (wallDirection && (records[index].edge.orientPoint?.(from) ?? 1) === wallDirection)
                return PAIR_CLEAR;
            // the terrain lookup waits for the first ray that actually crosses a wall
            hex.targetHeight ??= groundAt(col, row) + LOS_TARGET_ABOVE;
            const height = eye + ((hex.targetHeight - eye) * alongRay);
            if (height > top[index] || height < bottom[index])
                return PAIR_CLEAR;

            const hitX = fromX + (rayX * alongRay);
            const hitY = fromY + (rayY * alongRay);

            const grazed = Math.hypot(hitX - aX, hitY - aY) <= vertexTol
                || Math.hypot(hitX - bx[index], hitY - by[index]) <= vertexTol;

            return grazed ? PAIR_GRAZED : PAIR_BLOCKED;
        };

        const engineBlocked = (start, startHeight, end, endHeight, ctx) =>
        {
            stats.casterRays++;

            for (const index of recentEngine)
            {
                if (!inHexList(index))
                    continue;
                single[0] = records[index];

                if (_segmentBlocked(start, startHeight, end, endHeight, single, ctx) && _blocksAlone(ctx.lastReason, records[index]))
                {
                    _recentToFront(recentEngine, index);
                    return true;
                }
            }

            hex.walls ??= hex.wallIdx.map(index => records[index]);
            const blocked = _segmentBlocked(start, startHeight, end, endHeight, hex.walls, ctx);

            if (blocked && ctx.blockRecord && _blocksAlone(ctx.lastReason, ctx.blockRecord))
            {
                const index = indexOf.get(ctx.blockRecord);
                if (index !== undefined)
                    _recentToFront(recentEngine, index);
            }

            return blocked;
        };

        const grazedPairs = [];

        for (const sample of origins)
        {
            from = sample;
            fromX = sample.x;
            fromY = sample.y;

            for (const to of targets)
            {
                rayX = to.x - fromX;
                rayY = to.y - fromY;
                const segMinX = Math.min(fromX, to.x) - SEGMENT_BOX_SLACK;
                const segMaxX = Math.max(fromX, to.x) + SEGMENT_BOX_SLACK;
                const segMinY = Math.min(fromY, to.y) - SEGMENT_BOX_SLACK;
                const segMaxY = Math.max(fromY, to.y) + SEGMENT_BOX_SLACK;
                let quick = false;

                for (let slot = 0; slot < recentLow.length; slot++)
                {
                    const index = recentLow[slot];
                    if (maxX[index] < segMinX || minX[index] > segMaxX || maxY[index] < segMinY || minY[index] > segMaxY)
                        continue;

                    if (inHexList(index) && crossState(index) === PAIR_BLOCKED)
                    {
                        quick = true;
                        _recentToFront(recentLow, index);
                        break;
                    }
                }

                if (quick)
                    continue;
                if (!hex.lowIdx)
                    collect();
                if (!hex.lowIdx.length)
                    return false;

                let state = PAIR_CLEAR;

                for (const index of hex.lowIdx)
                {
                    if (maxX[index] < segMinX || minX[index] > segMaxX || maxY[index] < segMinY || minY[index] > segMaxY)
                        continue;

                    const cross = crossState(index);

                    if (cross === PAIR_BLOCKED)
                    {
                        state = PAIR_BLOCKED;
                        _recentToFront(recentLow, index);
                        break;
                    }

                    if (cross === PAIR_GRAZED)
                        state = PAIR_GRAZED;
                }

                if (state === PAIR_CLEAR)
                    return false;
                if (state === PAIR_GRAZED)
                    grazedPairs.push([from, to]);
            }
        }

        if (!grazedPairs.length || !hasCaster)
            return true;
        if (!hex.wallIdx)
            collect();

        const forwardCtx = { skipPrefixA: skipPrefix, skipPrefixB: skipPrefix, centerA: center, centerB: hexCenter, radiusA: tokenRadius, radiusB: targetRadius };
        const reverseCtx = { skipPrefixA: skipPrefix, skipPrefixB: skipPrefix, centerA: hexCenter, centerB: center, radiusA: targetRadius, radiusB: tokenRadius };

        for (const [start, end] of grazedPairs)
        {
            if (!engineBlocked(start, casterEye, end, hex.targetHeight, forwardCtx))
                return false;
            if (!engineBlocked(end, hex.targetHeight, start, casterEye, reverseCtx))
                return false;
        }

        return true;
    };

    return { eye, center, walls, isHidden, stats };
}

export { createTrigShadowTester, hexTestPointsFrom };
