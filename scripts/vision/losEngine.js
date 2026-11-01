import { getTokenDistance } from "../combat/overwatch.js";
import { getTokenVisionLOS } from "./visionFromEdge.js";
import { blindedVisionEnabled } from "./blindedVision.js";
import { laLosFlagOnly } from "./laWallLos.js";
import { getModuleSetting } from '../tools/settings-utils.js';

export const SETTING_LOS_HEIGHT_RULE = 'lancerLosHeightRule';

// Wall-based Lancer line of sight: height-aware edge-to-edge rays. A line along a wall edge is not broken.
let _losEdgeCache = null;
let _losEdgeCount = 0;
let _losVertexMap = null;
let _losPolyMap = null;
let _losClosedPolys = null;
const _losPairCache = new Map();
let _losEdgeSignature = null;
let _lastOverlaySignature = null;
// Banded wall polygons per eye height, each with its bbox. Same lifetime as the edge cache.
let _eyeSolidCache = null;

/** Drops the cached sight edges and pair results so the next LOS query recollects them. */
export function invalidateLosCaches()
{
    _losInvalidateAll();
}

// Pair results outlive a sightRefresh: a drag preview fires one per cell and the walls rarely change.
function _losInvalidate()
{
    _losEdgeCache = null;
    _losVertexMap = null;
    _losPolyMap = null;
    _losClosedPolys = null;
    _eyeSolidCache = null;
    _lastOverlaySignature = null;
}

function _losPairsClear()
{
    _losPairCache.clear();
    _lastOverlaySignature = null;
}

function _losInvalidateAll()
{
    _losInvalidate();
    _losPairsClear();
}

function _losPosKey(doc)
{
    return `${doc.id}:${Math.round(doc.x)}:${Math.round(doc.y)}:${Math.round((doc.elevation ?? 0) * 100)}`;
}

// Sight-blocking edges (walls + the bulwark token blockers + wall-height terrain), cached per refresh.
function _collectSightEdges()
{
    // Size guard catches edges added or removed without a wall document.
    if (_losEdgeCache && canvas?.edges?.size === _losEdgeCount)
        return _losEdgeCache;
    _losInvalidate();
    _losEdgeCount = canvas?.edges?.size ?? 0;
    const records = [];
    // Flag-only mode: full token blockers carry laSight twins, so laSight edges alone cover everything.
    const flagOnly = laLosFlagOnly();
    for (const edge of canvas?.edges?.values?.() ?? [])
    {
        if ((edge.sight ?? 0) <= 0)
            continue;
        if (flagOnly && edge.type !== 'laSight')
            continue;
        const flags = edge.object?.document?.flags?.['wall-height']
            ?? edge.object?.flags?.['wall-height']
            ?? {};
        records.push({
            id: typeof edge.id === 'string' ? edge.id : '',
            edge,
            limited: edge.sight === CONST.WALL_SENSE_TYPES.LIMITED,
            bottom: flags.bottom ?? Number.NEGATIVE_INFINITY,
            top: flags.top ?? Number.POSITIVE_INFINITY,
            minX: Math.min(edge.a.x, edge.b.x),
            maxX: Math.max(edge.a.x, edge.b.x),
            minY: Math.min(edge.a.y, edge.b.y),
            maxY: Math.max(edge.a.y, edge.b.y),
        });
    }
    const signature = records.map(record => `${record.id}:${record.edge.a.x},${record.edge.a.y},${record.edge.b.x},${record.edge.b.y}:${record.edge.sight}:${record.bottom}:${record.top}`)
        .sort((left, right) => (left < right ? -1 : (left > right ? 1 : 0)))
        .join(';');
    if (signature !== _losEdgeSignature)
    {
        _losEdgeSignature = signature;
        _losPairsClear();
    }
    _losVertexMap = new Map();
    _losPolyMap = new Map();
    for (const record of records)
    {
        for (const end of [record.edge.a, record.edge.b])
        {
            const key = _vertexKey(end.x, end.y);
            const list = _losVertexMap.get(key);
            if (list)
                list.push(record);
            else
                _losVertexMap.set(key, [record]);
        }
        const polyId = record.id.replace(/-\d+$/, '');
        const polyList = _losPolyMap.get(polyId);
        if (polyList)
            polyList.push(record);
        else
            _losPolyMap.set(polyId, [record]);
    }
    _losClosedPolys = new Set();
    for (const [polyId, polyRecords] of _losPolyMap)
    {
        if (polyRecords.length < 3)
            continue;
        const degrees = new Map();
        for (const polyRecord of polyRecords)
        {
            for (const end of [polyRecord.edge.a, polyRecord.edge.b])
            {
                const key = _vertexKey(end.x, end.y);
                degrees.set(key, (degrees.get(key) ?? 0) + 1);
            }
        }
        if ([...degrees.values()].every(count => count === 2))
            _losClosedPolys.add(polyId);
    }
    _losEdgeCache = records;
    return records;
}

// Only closed rings support interior tests: parity over an open wall chain reads a half plane as inside.
function _isClosedPoly(record)
{
    return _losClosedPolys?.has(record.id.replace(/-\d+$/, '')) ?? false;
}

// Ray-cast point-in-polygon over every edge of the wall that `record` belongs to.
function _pointInWall(px, py, record)
{
    const polyRecords = _losPolyMap?.get(record.id.replace(/-\d+$/, ''));
    if (!polyRecords)
        return false;
    let inside = false;
    for (const polyRecord of polyRecords)
    {
        const ax = polyRecord.edge.a.x;
        const ay = polyRecord.edge.a.y;
        const bx = polyRecord.edge.b.x;
        const by = polyRecord.edge.b.y;
        if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax))
            inside = !inside;
    }
    return inside;
}

// Keyed on height alone: this test does not skip the origin's own la-block-los edges, so the token is not an input.
function _eyeSolidPolys(height)
{
    if (!_eyeSolidCache)
        _eyeSolidCache = new Map();
    const cached = _eyeSolidCache.get(height);
    if (cached)
        return cached;
    const polys = [];
    const seenPolys = new Set();
    for (const record of _collectSightEdges())
    {
        if (record.bottom > height || height > record.top)
            continue;
        const polyId = record.id.replace(/-\d+$/, '');
        if (seenPolys.has(polyId))
            continue;
        seenPolys.add(polyId);
        const polyRecords = _losPolyMap?.get(polyId);
        if (!polyRecords)
            continue;
        let minX = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const polyRecord of polyRecords)
        {
            if (polyRecord.minX < minX)
                minX = polyRecord.minX;
            if (polyRecord.maxX > maxX)
                maxX = polyRecord.maxX;
            if (polyRecord.minY < minY)
                minY = polyRecord.minY;
            if (polyRecord.maxY > maxY)
                maxY = polyRecord.maxY;
        }
        polys.push({ records: polyRecords, minX, maxX, minY, maxY });
    }
    _eyeSolidCache.set(height, polys);
    return polys;
}

// Margin covers the x-intersect overshoot past maxX (measured 1.16e-10 at 1e6 coords); 0 flips verdicts.
const _EYE_SOLID_X_MARGIN = 1e-6;

// The crossing ray points in -X, so a poly off the y-span or entirely right of the point counts zero.
function _pointInEyePolys(polys, px, py)
{
    for (const poly of polys)
    {
        if (py < poly.minY || py > poly.maxY || px > poly.maxX + _EYE_SOLID_X_MARGIN)
            continue;
        let inside = false;
        for (const record of poly.records)
        {
            const ax = record.edge.a.x;
            const ay = record.edge.a.y;
            const bx = record.edge.b.x;
            const by = record.edge.b.y;
            if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax))
                inside = !inside;
        }
        if (inside)
            return true;
    }
    return false;
}

function _vertexKey(x, y)
{
    return `${Math.round(x)},${Math.round(y)}`;
}

// Vertex graze: false = real crossing, ±1 = which side the solid is on (0 unknown).
function _skimsVertex(origin, dest, edge, vx, vy, record)
{
    const neighbors = _losVertexMap?.get(_vertexKey(vx, vy));
    if (!neighbors)
        return 0;
    const thisFar = Math.hypot(edge.a.x - vx, edge.a.y - vy) <= Math.hypot(edge.b.x - vx, edge.b.y - vy) ? edge.b : edge.a;
    let otherFar = null;
    for (const neighbor of neighbors)
    {
        if (neighbor.edge === edge)
            continue;
        otherFar = Math.hypot(neighbor.edge.a.x - vx, neighbor.edge.a.y - vy) <= Math.hypot(neighbor.edge.b.x - vx, neighbor.edge.b.y - vy) ? neighbor.edge.b : neighbor.edge.a;
        break;
    }
    if (!otherFar)
        return 0;
    const dirX = dest.x - origin.x;
    const dirY = dest.y - origin.y;
    const sideThis = Math.sign(dirX * (thisFar.y - vy) - dirY * (thisFar.x - vx));
    const sideOther = Math.sign(dirX * (otherFar.y - vy) - dirY * (otherFar.x - vx));
    if (sideThis === 0 || sideOther === 0)
    {
        // a side of 0 means the ray is collinear with one of the two faces, so this is not a corner peek
        const ridesFace = (sideThis === 0 && ((((thisFar.x - vx) * dirX) + ((thisFar.y - vy) * dirY)) > 0))
            || (sideOther === 0 && ((((otherFar.x - vx) * dirX) + ((otherFar.y - vy) * dirY)) > 0));
        if (ridesFace || ((((dest.x - vx) * dirX) + ((dest.y - vy) * dirY)) <= 0) || !record || !_isClosedPoly(record))
            return 0;
        const step = canvas.grid.size * 0.02 / (Math.hypot(dirX, dirY) || 1);
        return _pointInWall(vx + (dirX * step), vy + (dirY * step), record) ? false : 0;
    }
    return sideThis === sideOther ? sideThis : false;
}

// A ray collinear with a wall face must be judged like a crossing, not slip along the lattice line.
function _runsAlongWall(originX, originY, eax, eay, ebx, eby, rayDirX, rayDirY, rayLenSq, tol, rayLen)
{
    const tolLen = tol * rayLen;
    const crossA = Math.abs(((eax - originX) * rayDirY) - ((eay - originY) * rayDirX));
    if (crossA > tolLen)
        return false;
    const crossB = Math.abs(((ebx - originX) * rayDirY) - ((eby - originY) * rayDirX));
    if (crossB > tolLen)
        return false;
    const alongA = (((eax - originX) * rayDirX) + ((eay - originY) * rayDirY)) / rayLenSq;
    const alongB = (((ebx - originX) * rayDirX) + ((eby - originY) * rayDirY)) / rayLenSq;
    return Math.min(alongA, alongB) < 1 && Math.max(alongA, alongB) > 0;
}

// Squared form for tolerance tests: d <= t is d*d <= t*t for non-negative values, and skips Math.hypot.
function _pointToSegmentDistSq(px, py, ax, ay, bx, by)
{
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let proj = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    proj = Math.max(0, Math.min(1, proj));
    const offX = px - (ax + proj * dx);
    const offY = py - (ay + proj * dy);
    return (offX * offX) + (offY * offY);
}

function _pointToSegmentDist(px, py, ax, ay, bx, by)
{
    return Math.sqrt(_pointToSegmentDistSq(px, py, ax, ay, bx, by));
}

// Renderer path only: collect every blocking hit so the nearest one along the ray wins.
function _noteBlock(state, origin, rayDirX, rayDirY, rayLenSq, px, py, reason, tAlong)
{
    const along = tAlong ?? ((((px - origin.x) * rayDirX) + ((py - origin.y) * rayDirY)) / rayLenSq);
    if (!state.near || along < state.near.along)
        state.near = { along, x: px, y: py, reason };
    if (!state.far || along > state.far.along)
        state.far = { along, x: px, y: py, reason };
}

// Opt-in ray counters (lancerLosProfile()); null costs one branch per edge and nothing else.
let _losProfile = null;
globalThis.lancerLosProfile = (on = true) =>
{
    _losProfile = on ? { calls: 0, edgeVisits: 0, passedCull: 0, denseCalls: 0 } : null;
    console.log(`lancer-automations | LOS profiling ${on ? 'on' : 'off'}`);
    return _losProfile;
};
globalThis.lancerLosProfileDump = () =>
{
    if (!_losProfile)
    {
        console.warn('lancer-automations | run lancerLosProfile() first');
        return null;
    }
    const { calls, edgeVisits, passedCull, denseCalls } = _losProfile;
    console.log(`lancer-automations | LOS profile | dense passes ${denseCalls} | _segmentBlocked calls ${calls}`
        + ` | edge visits ${edgeVisits} (${calls ? (edgeVisits / calls).toFixed(1) : 0} per call)`
        + ` | survived cull ${passedCull} (${edgeVisits ? (100 * passedCull / edgeVisits).toFixed(1) : 0}%)`);
    return _losProfile;
};

// Wall LOS height rule: both eyes over the top => clear; neither => blocked; one over => the shorter is hidden only if adjacent.
function _segmentBlocked(origin, originHeight, dest, destHeight, edges, ctx)
{
    if (_losProfile)
        _losProfile.calls++;
    const { skipPrefixA, skipPrefixB, centerA, centerB, radiusA, radiusB } = ctx;
    const adjacentSlack = canvas.grid.size * 0.75;
    ctx.lastReason = 'open';
    ctx.blockPoint = null;
    ctx.blockPointFar = null;
    ctx.skimPos = false;
    ctx.skimNeg = false;
    const nearest = ctx.nearestBlock ? { near: null, far: null } : null;
    // One read per LOS context instead of one per ray; ctx lives for a single pair test.
    ctx.trigHeightRule ??= getModuleSetting(SETTING_LOS_HEIGHT_RULE) === 'trig';
    const trigHeightRule = ctx.trigHeightRule;
    const originX = origin.x;
    const originY = origin.y;
    const destX = dest.x;
    const destY = dest.y;
    const rayDirX = destX - originX;
    const rayDirY = destY - originY;
    const rayLenSq = ((rayDirX * rayDirX) + (rayDirY * rayDirY)) || 1;
    const rayLen = Math.sqrt(rayLenSq);
    const takeBlock = (reason, px, py, tAlong) =>
    {
        if (!nearest)
        {
            ctx.lastReason = reason;
            ctx.blockPoint = { x: px, y: py };
            return true;
        }
        _noteBlock(nearest, origin, rayDirX, rayDirY, rayLenSq, px, py, reason, tAlong);
        return false;
    };
    const endpointTol = canvas.grid.size * 0.02;
    const endpointTolSq = endpointTol * endpointTol;
    const segMinX = Math.min(originX, destX);
    const segMaxX = Math.max(originX, destX);
    const segMinY = Math.min(originY, destY);
    const segMaxY = Math.max(originY, destY);
    let divedPolys = null;
    for (const record of edges)
    {
        if (_losProfile)
            _losProfile.edgeVisits++;
        if (record.maxX < segMinX || record.minX > segMaxX || record.maxY < segMinY || record.minY > segMaxY)
            continue;
        if (record.id && (record.id.startsWith(skipPrefixA) || record.id.startsWith(skipPrefixB)))
            continue;
        if (_losProfile)
            _losProfile.passedCull++;
        const edge = record.edge;
        const edgeA = edge.a;
        const edgeB = edge.b;
        const eax = edgeA.x;
        const eay = edgeA.y;
        const ebx = edgeB.x;
        const eby = edgeB.y;
        // Inlined lineSegmentIntersects: its four orient2dFast calls each resolve through a frozen namespace.
        const orientA = ((originY - eay) * (destX - eax)) - ((originX - eax) * (destY - eay));
        const orientB = ((originY - eby) * (destX - ebx)) - ((originX - ebx) * (destY - eby));
        let crosses = false;
        if (orientA || orientB)
        {
            const orientOrigin = ((eay - originY) * (ebx - originX)) - ((eax - originX) * (eby - originY));
            const orientDest = ((eay - destY) * (ebx - destX)) - ((eax - destX) * (eby - destY));
            crosses = ((orientA * orientB) <= 0) && ((orientOrigin * orientDest) <= 0);
        }
        // A ray endpoint sitting exactly on a wall vertex is a real touch that lineSegmentIntersects misses.
        const originOn = originX >= record.minX - endpointTol && originX <= record.maxX + endpointTol
            && originY >= record.minY - endpointTol && originY <= record.maxY + endpointTol
            && _pointToSegmentDistSq(originX, originY, eax, eay, ebx, eby) <= endpointTolSq;
        const destOn = destX >= record.minX - endpointTol && destX <= record.maxX + endpointTol
            && destY >= record.minY - endpointTol && destY <= record.maxY + endpointTol
            && _pointToSegmentDistSq(destX, destY, eax, eay, ebx, eby) <= endpointTolSq;
        const touchesEnd = originOn || destOn;
        let alongWall = false;
        if (!crosses && !touchesEnd)
        {
            alongWall = _runsAlongWall(originX, originY, eax, eay, ebx, eby, rayDirX, rayDirY, rayLenSq, endpointTol, rayLen);
            if (!alongWall)
                continue;
        }
        const side = edge.orientPoint?.(origin) ?? 1;
        if (!side && !touchesEnd && !alongWall
            && !_runsAlongWall(originX, originY, eax, eay, ebx, eby, rayDirX, rayDirY, rayLenSq, endpointTol, rayLen))
            continue;
        if (edge.direction && side === edge.direction)
            continue;
        if (edge.applyThreshold?.('sight', origin))
            continue;
        const hit = foundry.utils.lineLineIntersection(origin, dest, edge.a, edge.b) ?? { x: origin.x, y: origin.y, t0: 0 };
        const originOver = originHeight > record.top;
        const destOver = destHeight > record.top;
        if (originOver && destOver)
        {
            ctx.lastReason = 'over2';
            continue;
        }
        // trig sightline diving below the surface inside the footprint is buried even when no edge crossing says so
        if (originOver !== destOver && trigHeightRule && _isClosedPoly(record))
        {
            const polyId = record.id.replace(/-\d+$/, '');
            if (!divedPolys?.has(polyId))
            {
                (divedPolys ??= new Set()).add(polyId);
                const heightDelta = destHeight - originHeight;
                const tTop = (record.top - originHeight) / heightDelta;
                const tBottom = Number.isFinite(record.bottom)
                    ? (record.bottom - originHeight) / heightDelta
                    : (heightDelta > 0 ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY);
                const spanLo = Math.max(Math.min(tTop, tBottom), 0);
                const spanHi = Math.min(Math.max(tTop, tBottom), 1);
                if (spanLo < spanHi)
                {
                    for (const fraction of [0.25, 0.5, 0.75])
                    {
                        const along = spanLo + ((spanHi - spanLo) * fraction);
                        const probeX = origin.x + (rayDirX * along);
                        const probeY = origin.y + (rayDirY * along);
                        if (_pointInWall(probeX, probeY, record))
                        {
                            if (takeBlock('dive', probeX, probeY, along))
                                return true;
                            break;
                        }
                    }
                }
            }
        }
        if (originOver !== destOver && !trigHeightRule)
        {
            // the corner peek is height-independent: a vertex graze skims here exactly as at ground level
            const grazeTol = canvas.grid.size * 0.05;
            const grazeDistA = Math.hypot(hit.x - edge.a.x, hit.y - edge.a.y);
            const grazeDistB = Math.hypot(hit.x - edge.b.x, hit.y - edge.b.y);
            let grazedVertex = null;
            if (grazeDistA <= grazeTol && grazeDistA <= grazeDistB)
                grazedVertex = edge.a;
            else if (grazeDistB <= grazeTol)
                grazedVertex = edge.b;
            if (grazedVertex)
            {
                const skimSide = _skimsVertex(origin, dest, edge, grazedVertex.x, grazedVertex.y, record);
                if (skimSide !== false)
                {
                    if (skimSide < 0)
                        ctx.skimNeg = true;
                    else if (skimSide > 0)
                        ctx.skimPos = true;
                    if (ctx.skimNeg && ctx.skimPos)
                    {
                        if (takeBlock('pinch', hit.x, hit.y, hit.t0))
                            return true;
                        continue;
                    }
                    ctx.lastReason = 'skim';
                    continue;
                }
            }
            const shorterCenter = originOver ? centerB : centerA;
            const shorterRadius = originOver ? radiusB : radiusA;
            const dist = _pointToSegmentDist(shorterCenter.x, shorterCenter.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
            const shorterAdj = (dist - shorterRadius) <= adjacentSlack;
            // hiding flush behind a taller wall is absolute: no viewer height exemption
            if (shorterAdj)
            {
                if (takeBlock('adj', hit.x, hit.y, hit.t0))
                    return true;
                continue;
            }
            ctx.lastReason = 'over1';
            continue;
        }
        if (touchesEnd)
        {
            const startPt = originOn ? origin : dest;
            const otherPt = originOn ? dest : origin;
            // vertex-touch corner peek; skim casters only get it at their own origin corner, or walk steps slip through foreign wall corners
            const touchTol = (ctx.noPinch && !originOn) ? -1 : canvas.grid.size * 0.05;
            const touchDistA = Math.hypot(startPt.x - edge.a.x, startPt.y - edge.a.y);
            const touchDistB = Math.hypot(startPt.x - edge.b.x, startPt.y - edge.b.y);
            let touchedVertex = null;
            if (touchDistA <= touchTol && touchDistA <= touchDistB)
                touchedVertex = edge.a;
            else if (touchDistB <= touchTol)
                touchedVertex = edge.b;
            if (touchedVertex)
            {
                const skimSide = _skimsVertex(origin, dest, edge, touchedVertex.x, touchedVertex.y, record);
                if (skimSide !== false)
                {
                    if (skimSide < 0)
                        ctx.skimNeg = true;
                    else if (skimSide > 0)
                        ctx.skimPos = true;
                    if (ctx.skimNeg && ctx.skimPos && !ctx.noPinch)
                    {
                        if (takeBlock('pinch', startPt.x, startPt.y))
                            return true;
                        continue;
                    }
                    ctx.lastReason = 'skim';
                    continue;
                }
            }
            // touching a wall never grants shots through it: block when the far end is across it
            const anchor = originOn ? centerA : centerB;
            const toucherHeight = originOn ? originHeight : destHeight;
            const sideOther = Math.sign(edge.orientPoint?.(otherPt) ?? 0);
            const sideAnchor = Math.sign(edge.orientPoint?.(anchor) ?? 0);
            if (sideOther && sideAnchor && sideOther !== sideAnchor
                && toucherHeight >= record.bottom && toucherHeight <= record.top)
            {
                if (takeBlock('through-touch', startPt.x, startPt.y))
                    return true;
                continue;
            }
            const stepLen = Math.hypot(otherPt.x - startPt.x, otherPt.y - startPt.y) || 1;
            const sampleX = startPt.x + ((otherPt.x - startPt.x) / stepLen) * 2;
            const sampleY = startPt.y + ((otherPt.y - startPt.y) / stepLen) * 2;
            if (!_pointInWall(sampleX, sampleY, record))
                continue;
        }
        if (hit)
        {
            const vertexTol = canvas.grid.size * 0.05;
            const distA = Math.hypot(hit.x - edge.a.x, hit.y - edge.a.y);
            const distB = Math.hypot(hit.x - edge.b.x, hit.y - edge.b.y);
            let grazed = null;
            if (distA <= vertexTol && distA <= distB)
                grazed = edge.a;
            else if (distB <= vertexTol)
                grazed = edge.b;
            if (grazed)
            {
                const skimSide = _skimsVertex(origin, dest, edge, grazed.x, grazed.y, record);
                if (skimSide !== false)
                {
                    if (skimSide < 0)
                        ctx.skimNeg = true;
                    else if (skimSide > 0)
                        ctx.skimPos = true;
                    // opposite-side skims pinch the line: tilting off one corner lands on the other
                    if (ctx.skimNeg && ctx.skimPos && !ctx.noPinch)
                    {
                        if (takeBlock('pinch', hit.x, hit.y, hit.t0))
                            return true;
                        continue;
                    }
                    ctx.lastReason = 'skim';
                    continue;
                }
            }
        }
        if (hit)
        {
            const heightAtHit = originHeight + (destHeight - originHeight) * (hit.t0 ?? 0);
            if (heightAtHit >= record.bottom && heightAtHit <= record.top)
            {
                if (takeBlock('band', hit.x, hit.y, hit.t0))
                    return true;
                continue;
            }
        }
    }
    if (nearest?.near)
    {
        ctx.lastReason = nearest.near.reason;
        ctx.blockPoint = { x: nearest.near.x, y: nearest.near.y };
        if (nearest.far.along > nearest.near.along)
            ctx.blockPointFar = { x: nearest.far.x, y: nearest.far.y };
        return true;
    }
    return false;
}

// Centre + the outermost left/right silhouette vertices relative to the a->b ray (as THT's calculateRaysBetweenTokensOrPoints).
function _tokenLosPoints(token, aCenter, bCenter)
{
    // Plain literal: a PIXI.Point here gives the ray loops two hidden classes and megamorphic reads.
    const center = { x: token.center.x, y: token.center.y };
    const dx = bCenter.x - aCenter.x;
    const dy = bCenter.y - aCenter.y;
    // Gridless equal-size tokens are circles: offset perpendicular to the ray by the radius.
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS && token.document.width === token.document.height)
    {
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const radius = token.w / 2;
        return [center, { x: center.x - px * radius, y: center.y - py * radius }, { x: center.x + px * radius, y: center.y + py * radius }];
    }
    let verts;
    if (canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS)
    {
        const pts = token.getShape().points;
        // Document, not the placeable, so it stays put during animation.
        const shapeOriginX = token.document?.x ?? token.x;
        const shapeOriginY = token.document?.y ?? token.y;
        verts = [];
        for (let idx = 0; idx < pts.length; idx += 2)
            verts.push({ x: Math.round(pts[idx] + shapeOriginX), y: Math.round(pts[idx + 1] + shapeOriginY) });
    }
    else
    {
        const shape = token.getShape();
        const originX = token.document.x;
        const originY = token.document.y;
        verts = [
            { x: originX, y: originY },
            { x: originX + shape.width, y: originY },
            { x: originX + shape.width, y: originY + shape.height },
            { x: originX, y: originY + shape.height },
        ];
    }
    return _extremeLosPoints(center, verts, aCenter, dx, dy);
}

function _extremeLosPoints(center, verts, aCenter, dx, dy)
{
    let leftPt = center;
    let rightPt = center;
    let leftBest = -1;
    let rightBest = -1;
    for (const vert of verts)
    {
        const cross = (vert.x - aCenter.x) * dy - (vert.y - aCenter.y) * dx;
        const distSq = cross * cross;
        if (cross > 0 && distSq > leftBest)
        {
            leftBest = distSq;
            leftPt = vert;
        }
        else if (cross < 0 && distSq > rightBest)
        {
            rightBest = distSq;
            rightPt = vert;
        }
    }
    return [center, leftPt, rightPt];
}

function _cellVerts(centers)
{
    const verts = [];
    for (const center of centers)
        verts.push(...(canvas.grid.getVertices(canvas.grid.getOffset(center)) ?? []));
    return verts;
}

// A bare point gets its cell footprint's silhouette so it rays like a token of that size.
function _pointLosPoints(point, aCenter, bCenter, cellCenters = null)
{
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS)
        return [point, point, point];
    let verts = null;
    try
    {
        verts = _cellVerts(cellCenters?.length ? cellCenters : [point]);
    }
    catch
    {
        verts = null;
    }
    if (!verts?.length)
        return [point, point, point];
    return _extremeLosPoints(point, verts, aCenter, bCenter.x - aCenter.x, bCenter.y - aCenter.y);
}

// Centre plus every silhouette vertex, for the dense LOS fallback.
function _tokenSamplePoints(token)
{
    // Plain literal: a PIXI.Point here gives the ray loops two hidden classes and megamorphic reads.
    const center = { x: token.center.x, y: token.center.y };
    const points = [center];
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS && token.document.width === token.document.height)
    {
        const radius = token.w / 2;
        for (let step = 0; step < 8; step++)
        {
            const angle = (step / 8) * Math.PI * 2;
            points.push({ x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius });
        }
        return points;
    }
    if (canvas.grid.type !== CONST.GRID_TYPES.GRIDLESS)
    {
        const pts = token.getShape().points;
        // Document, not the placeable, so it stays put during animation.
        const shapeOriginX = token.document?.x ?? token.x;
        const shapeOriginY = token.document?.y ?? token.y;
        for (let idx = 0; idx < pts.length; idx += 2)
            points.push({ x: Math.round(pts[idx] + shapeOriginX), y: Math.round(pts[idx + 1] + shapeOriginY) });
        return points;
    }
    const shape = token.getShape();
    const originX = token.document.x;
    const originY = token.document.y;
    points.push(
        { x: originX, y: originY },
        { x: originX + shape.width, y: originY },
        { x: originX + shape.width, y: originY + shape.height },
        { x: originX, y: originY + shape.height },
    );
    return points;
}

/**
 * True once the placeable's PIXI object is gone. `transform` is nulled on destroy, and every
 * position getter dereferences it.
 * @param {any} token
 * @returns {boolean}
 */
function _isDestroyed(token)
{
    return !token || token.destroyed === true || !token.transform;
}

export function lancerHasLineOfSight(tokenA, tokenB)
{
    const docA = tokenA?.document;
    const docB = tokenB?.document;
    // fail open on missing data so occlusion never hides a token by accident
    if (!docA || !docB || docA.id === docB.id)
        return true;
    // A destroyed placeable still reachable from a ticker: reading .x throws inside PIXI.
    if (_isDestroyed(tokenA) || _isDestroyed(tokenB))
        return true;
    // key on position + elevation so a move automatically misses the stale entry
    const keyA = _losPosKey(docA);
    const keyB = _losPosKey(docB);
    const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const cached = _losPairCache.get(pairKey);
    if (cached !== undefined)
        return cached;
    const heightA = getTokenVisionLOS(tokenA);
    const heightB = getTokenVisionLOS(tokenB);
    const centerA = tokenA.center;
    const centerB = tokenB.center;
    const pointsA = _tokenLosPoints(tokenA, centerA, centerB);
    const pointsB = _tokenLosPoints(tokenB, centerA, centerB);
    // cull walls to the pair's corridor once; every ray below scans only those
    const pad = canvas.grid.size * 0.1;
    const pairMinX = Math.min(tokenA.x, tokenB.x) - pad;
    const pairMaxX = Math.max(tokenA.x + tokenA.w, tokenB.x + tokenB.w) + pad;
    const pairMinY = Math.min(tokenA.y, tokenB.y) - pad;
    const pairMaxY = Math.max(tokenA.y + tokenA.h, tokenB.y + tokenB.h) + pad;
    const edges = _collectSightEdges().filter(record =>
        record.maxX >= pairMinX && record.minX <= pairMaxX && record.maxY >= pairMinY && record.minY <= pairMaxY);
    const ctx = {
        skipPrefixA: `la-block-los-${docA.id}-`,
        skipPrefixB: `la-block-los-${docB.id}-`,
        centerA,
        centerB,
        radiusA: Math.max(tokenA.w ?? 0, tokenA.h ?? 0) / 2,
        radiusB: Math.max(tokenB.w ?? 0, tokenB.h ?? 0) / 2,
    };
    let result = false;
    for (let index = 0; index < pointsA.length; index++)
    {
        if (!_segmentBlocked(pointsA[index], heightA, pointsB[index], heightB, edges, ctx))
        {
            result = true;
            break;
        }
    }
    // The 3 sampled rays can miss a clear line threading a gap; only on failure, test every vertex pair.
    if (!result)
        result = _denseLosClear(tokenA, tokenB, heightA, heightB, edges, ctx);
    // LOS is reciprocal: some per-segment rules read the origin end, so a pair sees together or not at all.
    if (!result)
    {
        const ctxReverse = {
            skipPrefixA: ctx.skipPrefixB,
            skipPrefixB: ctx.skipPrefixA,
            centerA: centerB,
            centerB: centerA,
            radiusA: ctx.radiusB,
            radiusB: ctx.radiusA,
            trigHeightRule: ctx.trigHeightRule,
        };
        result = _denseLosClear(tokenB, tokenA, heightB, heightA, edges, ctxReverse);
    }
    if (_losPairCache.size > 20000)
        _losPairsClear();
    _losPairCache.set(pairKey, result);
    return result;
}

/**
 * Ray caster for the pulse's skim lines: tests one segment from a point of the origin token
 * under the full Lancer rules (skim, graze, heights), both ends at the origin's LOS height.
 * @param {any} originToken
 * @returns {((from: {x: number, y: number}, to: {x: number, y: number}) => boolean)|null} true = clear
 */
export function makeSkimRayCaster(originToken)
{
    const doc = originToken?.document;
    if (!doc || _isDestroyed(originToken))
        return null;
    const height = getTokenVisionLOS(originToken);
    const center = originToken.center;
    const edges = _collectSightEdges();
    const ctx = {
        skipPrefixA: `la-block-los-${doc.id}-`,
        skipPrefixB: `la-block-los-${doc.id}-`,
        centerA: center,
        centerB: center,
        radiusA: Math.max(originToken.w ?? 0, originToken.h ?? 0) / 2,
        radiusB: 0,
        // the skim line rides corners on both sides; the perpendicular casts decide what lights
        noPinch: true,
    };
    const test = (from, to) =>
    {
        ctx.centerB = to;
        return !_segmentBlocked(from, height, to, height, edges, ctx);
    };
    test.ctx = ctx;
    return test;
}

/**
 * Ray casters between a token's eye and a virtual token standing on a cell, with the token LOS rules intact.
 * Both directions exist because the per-segment rules read the origin end, as hasLineOfSight does.
 * @param {any} originToken
 * @param {number} targetRadius half size of the virtual target, pixels
 * @returns {{eye: number,
 *   forward: (from: {x: number, y: number}, to: {x: number, y: number}, cellCenter: {x: number, y: number}, toHeight: number, edgeSubset?: any[]) => boolean,
 *   reverse: (from: {x: number, y: number}, cellCenter: {x: number, y: number}, fromHeight: number, to: {x: number, y: number}, edgeSubset?: any[]) => boolean}|null}
 *   each returns true when the ray is clear, edgeSubset narrows the edge records scanned
 */
export function makeCellRayCaster(originToken, targetRadius)
{
    const doc = originToken?.document;
    if (!doc || _isDestroyed(originToken))
        return null;
    const eye = getTokenVisionLOS(originToken);
    const center = originToken.center;
    const edges = _collectSightEdges();
    const skipPrefix = `la-block-los-${doc.id}-`;
    const radius = Math.max(originToken.w ?? 0, originToken.h ?? 0) / 2;
    const forwardCtx = { skipPrefixA: skipPrefix, skipPrefixB: skipPrefix, centerA: center, centerB: center, radiusA: radius, radiusB: targetRadius };
    const reverseCtx = { skipPrefixA: skipPrefix, skipPrefixB: skipPrefix, centerA: center, centerB: center, radiusA: targetRadius, radiusB: radius };
    return {
        eye,
        forward: (from, to, cellCenter, toHeight, edgeSubset = edges) =>
        {
            forwardCtx.centerB = cellCenter;
            return !_segmentBlocked(from, eye, to, toHeight, edgeSubset, forwardCtx);
        },
        reverse: (from, cellCenter, fromHeight, to, edgeSubset = edges) =>
        {
            reverseCtx.centerA = cellCenter;
            return !_segmentBlocked(from, fromHeight, to, eye, edgeSubset, reverseCtx);
        }
    };
}

/**
 * The cached sight edge records, with their height band and bounding box.
 * @returns {any[]}
 */
export function lancerSightEdgeRecords()
{
    return _collectSightEdges();
}

/**
 * Wall segments that block at the origin's eye height, for the pulse's skim lines.
 * @param {any} originToken
 * @returns {{a: {x: number, y: number}, b: {x: number, y: number}}[]}
 */
export function getEyeWallSegments(originToken)
{
    const doc = originToken?.document;
    if (!doc || _isDestroyed(originToken))
        return [];
    const height = getTokenVisionLOS(originToken);
    return _collectSightEdges()
        .filter(record => record.bottom <= height && height <= record.top)
        .map(record => ({
            a: { x: record.edge.a.x, y: record.edge.a.y },
            b: { x: record.edge.b.x, y: record.edge.b.y },
        }));
}

/** True when the point sits inside a wall polygon whose height band contains the token's eye. */
export function isPointInEyeSolid(originToken, point)
{
    const doc = originToken?.document;
    if (!doc || _isDestroyed(originToken))
        return false;
    return _pointInEyePolys(_eyeSolidPolys(getTokenVisionLOS(originToken)), point.x, point.y);
}

/**
 * Same test with the origin's banded polygons resolved once, for per-point loops.
 * @param {any} originToken
 * @returns {((point: {x: number, y: number}) => boolean)|null}
 */
export function makeEyeSolidTester(originToken)
{
    const doc = originToken?.document;
    if (!doc || _isDestroyed(originToken))
        return null;
    const polys = _eyeSolidPolys(getTokenVisionLOS(originToken));
    return (point) => _pointInEyePolys(polys, point.x, point.y);
}

function _denseLosClear(tokenA, tokenB, heightA, heightB, edges, ctx)
{
    return _densePointsClear(_tokenSamplePoints(tokenA), _tokenSamplePoints(tokenB), heightA, heightB, edges, ctx);
}

// Cell sample set for a bare point: the footprint's centers plus their cells' vertices.
function _pointSamplePoints(point, cellCenters = null)
{
    const centers = cellCenters?.length ? cellCenters : [point];
    const points = centers.map(center => ({ x: center.x, y: center.y }));
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS)
        return points;
    try
    {
        points.push(..._cellVerts(centers));
    }
    catch
    {
        return points;
    }
    return points;
}

function _densePointsClear(pointsA, pointsB, heightA, heightB, edges, ctx)
{
    if (_losProfile)
        _losProfile.denseCalls++;
    ctx.denseWitness = null;
    for (const pointA of pointsA)
    {
        for (const pointB of pointsB)
        {
            if (!_segmentBlocked(pointA, heightA, pointB, heightB, edges, ctx))
            {
                ctx.denseWitness = { from: { x: Math.round(pointA.x), y: Math.round(pointA.y) }, to: { x: Math.round(pointB.x), y: Math.round(pointB.y) }, reason: ctx.lastReason };
                return true;
            }
        }
    }
    return false;
}

function _resolveToken(ref)
{
    if (!ref)
        return null;
    if (ref instanceof foundry.canvas.placeables.Token)
        return ref;
    if (ref.object instanceof foundry.canvas.placeables.Token)
        return ref.object;
    if (typeof ref === 'string')
        return canvas?.tokens?.get(ref) ?? null;
    return null;
}

/**
 * Blinded draws line of sight to adjacent spaces only. Unlike the wall check this is directional:
 * the blinded token loses sight, the one opposite it does not.
 * @param {Token} viewerToken
 * @param {Token} targetToken
 * @returns {boolean}
 */
function _blindedBlocksSight(viewerToken, targetToken)
{
    if (!blindedVisionEnabled() || !viewerToken?.actor?.statuses?.has?.('blinded'))
        return false;
    return getTokenDistance(viewerToken, targetToken) > 1;
}

/**
 * Beta. Does A have a clear Lancer line of sight to B? Wall-based, height-aware, reciprocal,
 * except that A being Blinded only blinds A.
 * @param {Token|TokenDocument|string} refA
 * @param {Token|TokenDocument|string} refB
 * @returns {boolean}
 */
export function hasLineOfSight(refA, refB)
{
    const tokenA = _resolveToken(refA);
    const tokenB = _resolveToken(refB);
    if (!tokenA || !tokenB)
        return false;
    if (_blindedBlocksSight(tokenA, tokenB))
        return false;
    return lancerHasLineOfSight(tokenA, tokenB);
}

function _roundPoint(point)
{
    return { x: Math.round(point.x), y: Math.round(point.y) };
}

/**
 * Forward ray set for sightline rendering: the 3 primary rays with block points,
 * plus the dense-pass witness when no primary connects.
 * @param {Token|{x: number, y: number, h?: number, cells?: {x: number, y: number}[]}} viewer
 * @param {Token|{x: number, y: number, h?: number, cells?: {x: number, y: number}[]}} target
 * @returns {{rays: {a: any, b: any, clear: boolean, blockPoint: any}[], witness: {a: any, b: any}|null, heightV: number, heightT: number}|null}
 */
export function computeSightlineRays(viewer, target)
{
    if (!viewer || !target)
        return null;
    const isTokenV = viewer instanceof foundry.canvas.placeables.Token;
    const isToken = target instanceof foundry.canvas.placeables.Token;
    if ((isTokenV && !viewer.document) || (isToken && !target.document))
        return null;
    const edges = _collectSightEdges();
    const heightV = isTokenV ? getTokenVisionLOS(viewer) : (viewer.h ?? 0);
    const heightT = isToken ? getTokenVisionLOS(target) : (target.h ?? heightV);
    const centerV = isTokenV ? viewer.center : { x: viewer.x, y: viewer.y };
    const centerT = isToken ? target.center : { x: target.x, y: target.y };
    const viewerCells = (!isTokenV && Array.isArray(viewer.cells) && viewer.cells.length) ? viewer.cells : null;
    const cellCenters = (!isToken && Array.isArray(target.cells) && target.cells.length) ? target.cells : null;
    const pointsV = isTokenV ? _tokenLosPoints(viewer, centerV, centerT) : _pointLosPoints(centerV, centerV, centerT, viewerCells);
    const pointsT = isToken ? _tokenLosPoints(target, centerV, centerT) : _pointLosPoints(centerT, centerV, centerT, cellCenters);
    const ctx = {
        skipPrefixA: isTokenV ? `la-block-los-${viewer.document.id}-` : 'la-block-los-<none>-',
        skipPrefixB: isToken ? `la-block-los-${target.document.id}-` : 'la-block-los-<none>-',
        centerA: centerV,
        centerB: centerT,
        radiusA: isTokenV ? Math.max(viewer.w, viewer.h) / 2 : 0,
        radiusB: isToken ? Math.max(target.w, target.h) / 2 : 0,
        nearestBlock: true,
    };
    const rays = pointsV.map((origin, index) =>
    {
        ctx.blockPoint = null;
        const clear = !_segmentBlocked(origin, heightV, pointsT[index], heightT, edges, ctx);
        return {
            a: { ...origin },
            b: { ...pointsT[index] },
            clear,
            blockPoint: clear ? null : (ctx.blockPoint ? { ...ctx.blockPoint } : null),
        };
    });
    let witness = null;
    if (!rays.some(ray => ray.clear))
    {
        const denseClear = (isTokenV && isToken)
            ? _denseLosClear(viewer, target, heightV, heightT, edges, ctx)
            : _densePointsClear(
                isTokenV ? _tokenSamplePoints(viewer) : _pointSamplePoints(centerV, viewerCells),
                isToken ? _tokenSamplePoints(target) : _pointSamplePoints(centerT, cellCenters),
                heightV, heightT, edges, ctx);
        if (denseClear && ctx.denseWitness)
            witness = { a: { ...ctx.denseWitness.from }, b: { ...ctx.denseWitness.to } };
    }
    return { rays, witness, heightV, heightT };
}

// Console diagnostic (lancerLosDump()): prints ray endpoints, per-ray reason, and nearby wall edges to copy.
function _dumpLos()
{
    const viewer = canvas?.tokens?.controlled?.[0];
    if (!viewer)
    {
        console.warn('lancer-automations | lancerLosDump | select a viewer token first');
        return null;
    }
    const targeted = Array.from(game.user?.targets ?? []);
    const targets = targeted.length ? targeted : canvas.tokens.placeables.filter(token => token !== viewer);
    const edges = _collectSightEdges();
    const dump = [];
    for (const target of targets)
    {
        const heightV = getTokenVisionLOS(viewer);
        const heightT = getTokenVisionLOS(target);
        const centerV = viewer.center;
        const centerT = target.center;
        const pointsV = _tokenLosPoints(viewer, centerV, centerT);
        const pointsT = _tokenLosPoints(target, centerV, centerT);
        const ctx = {
            skipPrefixA: `la-block-los-${viewer.document.id}-`,
            skipPrefixB: `la-block-los-${target.document.id}-`,
            centerA: centerV,
            centerB: centerT,
            radiusA: Math.max(viewer.w, viewer.h) / 2,
            radiusB: Math.max(target.w, target.h) / 2,
        };
        const allX = [...pointsV, ...pointsT].map(point => point.x);
        const allY = [...pointsV, ...pointsT].map(point => point.y);
        const minX = Math.min(...allX);
        const maxX = Math.max(...allX);
        const minY = Math.min(...allY);
        const maxY = Math.max(...allY);
        const rays = pointsV.map((origin, index) =>
        {
            const clear = !_segmentBlocked(origin, heightV, pointsT[index], heightT, edges, ctx);
            return { name: ['centre', 'left', 'right'][index] ?? index, origin: _roundPoint(origin), dest: _roundPoint(pointsT[index]), clear, reason: ctx.lastReason };
        });
        const denseForward = _denseLosClear(viewer, target, heightV, heightT, edges, ctx);
        const denseForwardWitness = ctx.denseWitness;
        const ctxReverse = {
            skipPrefixA: ctx.skipPrefixB,
            skipPrefixB: ctx.skipPrefixA,
            centerA: centerT,
            centerB: centerV,
            radiusA: ctx.radiusB,
            radiusB: ctx.radiusA,
        };
        const pointsTRev = _tokenLosPoints(target, centerT, centerV);
        const pointsVRev = _tokenLosPoints(viewer, centerT, centerV);
        const raysReverse = pointsTRev.map((origin, index) =>
        {
            const clear = !_segmentBlocked(origin, heightT, pointsVRev[index], heightV, edges, ctxReverse);
            return { name: ['centre', 'left', 'right'][index] ?? index, origin: _roundPoint(origin), dest: _roundPoint(pointsVRev[index]), clear, reason: ctxReverse.lastReason };
        });
        const denseReverse = _denseLosClear(target, viewer, heightT, heightV, edges, ctxReverse);
        const denseReverseWitness = ctxReverse.denseWitness;
        const keyV = _losPosKey(viewer.document);
        const keyT = _losPosKey(target.document);
        const pairKey = keyV < keyT ? `${keyV}|${keyT}` : `${keyT}|${keyV}`;
        const cached = _losPairCache.get(pairKey);
        const nearEdges = edges
            .filter(record => !(record.maxX < minX || record.minX > maxX || record.maxY < minY || record.minY > maxY))
            .map(record => ({ id: record.id, a: _roundPoint(record.edge.a), b: _roundPoint(record.edge.b), top: record.top }));
        dump.push({ viewer: viewer.document.name, viewerEye: heightV, target: target.document.name, targetEye: heightT, grid: canvas.grid.size,
            forward: { rays, dense: denseForward, denseWitness: denseForwardWitness }, reverse: { rays: raysReverse, dense: denseReverse, denseWitness: denseReverseWitness }, cachedRenderValue: cached, nearEdges });
    }
    console.log('lancer-automations | LANCER_LOS_DUMP\n' + JSON.stringify(dump, null, 1));
    return dump;
}
globalThis.lancerLosDump = _dumpLos;

// Regression signature (lancerLosSignature()): every ordered token pair's verdict, uncached, for before/after diffs.
function _losSignature()
{
    const tokens = canvas?.tokens?.placeables ?? [];
    _losInvalidateAll();
    const lines = [];
    for (const viewer of tokens)
    {
        for (const target of tokens)
        {
            if (viewer === target)
                continue;
            lines.push(`${viewer.document.id}>${target.document.id}:${lancerHasLineOfSight(viewer, target) ? 1 : 0}`);
        }
    }
    lines.sort((left, right) => (left < right ? -1 : (left > right ? 1 : 0)));
    const text = lines.join(';');
    let hash = 0;
    for (let idx = 0; idx < text.length; idx++)
        hash = ((hash * 31) + text.charCodeAt(idx)) | 0;
    console.log(`lancer-automations | LOS signature | ${lines.length} pairs | hash ${hash}`);
    console.log(text);
    return { pairs: lines.length, hash, text };
}
globalThis.lancerLosSignature = _losSignature;

// Stale check (lancerLosStaleCheck()): compares what the caches currently answer against a fresh recompute.
function _losStaleCheck()
{
    const tokens = canvas?.tokens?.placeables ?? [];
    const cachedVerdicts = new Map();
    for (const viewer of tokens)
    {
        for (const target of tokens)
        {
            if (viewer === target)
                continue;
            const keyA = _losPosKey(viewer.document);
            const keyB = _losPosKey(target.document);
            const pairKey = keyA < keyB ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
            if (_losPairCache.has(pairKey))
                cachedVerdicts.set(`${viewer.document.id}>${target.document.id}`, _losPairCache.get(pairKey));
        }
    }
    const cachedEdgeCount = _losEdgeCount;
    const liveEdgeCount = canvas?.edges?.size ?? 0;
    _losInvalidateAll();
    const mismatches = [];
    for (const viewer of tokens)
    {
        for (const target of tokens)
        {
            if (viewer === target)
                continue;
            const id = `${viewer.document.id}>${target.document.id}`;
            if (!cachedVerdicts.has(id))
                continue;
            const fresh = lancerHasLineOfSight(viewer, target);
            if (fresh !== cachedVerdicts.get(id))
                mismatches.push(`${id}: cached ${cachedVerdicts.get(id) ? 1 : 0}, fresh ${fresh ? 1 : 0}`);
        }
    }
    console.log(`lancer-automations | stale check | edges cached ${cachedEdgeCount} live ${liveEdgeCount}`
        + ` | cached pairs ${cachedVerdicts.size} | mismatches ${mismatches.length}`);
    if (mismatches.length)
        console.log(mismatches.join('\n'));
    return { cachedEdgeCount, liveEdgeCount, checked: cachedVerdicts.size, mismatches };
}
globalThis.lancerLosStaleCheck = _losStaleCheck;

export function setLastOverlaySignature(value)
{
    _lastOverlaySignature = value;
}

export { _lastOverlaySignature, _losPairsClear, _losInvalidateAll, _collectSightEdges, _segmentBlocked, _tokenLosPoints, _tokenSamplePoints, _blindedBlocksSight };
