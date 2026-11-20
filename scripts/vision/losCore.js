let _losVertexMap = null;
let _losPolyMap = null;
let _losClosedPolys = null;
let _losUniformPolys = null;
let _losPolyBoxes = null;
let _readTrigHeightRule = () => false;

function setTrigHeightRuleReader(reader)
{
    _readTrigHeightRule = reader;
}

function sightRecord(edge, bottom, top)
{
    const id = typeof edge.id === 'string' ? edge.id : '';
    return {
        id,
        polyId: id.replace(/-\d+$/, ''),
        edge,
        limited: edge.sight === CONST.WALL_SENSE_TYPES.LIMITED,
        bottom,
        top,
        minX: Math.min(edge.a.x, edge.b.x),
        maxX: Math.max(edge.a.x, edge.b.x),
        minY: Math.min(edge.a.y, edge.b.y),
        maxY: Math.max(edge.a.y, edge.b.y),
    };
}

function clearWallSet()
{
    _losVertexMap = null;
    _losPolyMap = null;
    _losClosedPolys = null;
    _losUniformPolys = null;
    _losPolyBoxes = null;
}

function _addRecordToMaps(record)
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

    const polyId = record.polyId;
    const polyList = _losPolyMap.get(polyId);

    if (polyList)
        polyList.push(record);
    else
        _losPolyMap.set(polyId, [record]);
}

function _isClosedRing(polyRecords)
{
    if (polyRecords.length < 3)
        return false;

    const degrees = new Map();

    for (const polyRecord of polyRecords)
    {
        for (const end of [polyRecord.edge.a, polyRecord.edge.b])
        {
            const key = _vertexKey(end.x, end.y);
            degrees.set(key, (degrees.get(key) ?? 0) + 1);
        }
    }

    return [...degrees.values()].every(count => count === 2);
}

function _addPolyFacts(polyId, polyRecords)
{
    const firstRecord = polyRecords[0];
    let uniform = true;
    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const polyRecord of polyRecords)
    {
        if (polyRecord.bottom !== firstRecord.bottom || polyRecord.top !== firstRecord.top)
            uniform = false;
        if (polyRecord.minX < minX)
            minX = polyRecord.minX;
        if (polyRecord.maxX > maxX)
            maxX = polyRecord.maxX;
        if (polyRecord.minY < minY)
            minY = polyRecord.minY;
        if (polyRecord.maxY > maxY)
            maxY = polyRecord.maxY;
    }

    if (uniform)
        _losUniformPolys.add(polyId);

    const slabH = Math.max(1, canvas.grid.size / 2);
    const slabCount = Math.max(1, Math.floor((maxY - minY) / slabH) + 1);
    const slabs = Array.from({ length: slabCount }, () => []);

    for (const polyRecord of polyRecords)
    {
        const first = Math.floor((polyRecord.minY - minY) / slabH);
        const last = Math.min(slabCount - 1, Math.floor((polyRecord.maxY - minY) / slabH));
        for (let slab = first; slab <= last; slab++)
            slabs[slab].push(polyRecord);
    }

    _losPolyBoxes.set(polyId, { minX, maxX, minY, maxY, slabH, slabs });
}

function buildWallSet(records)
{
    _losVertexMap = new Map();
    _losPolyMap = new Map();
    for (const record of records)
        _addRecordToMaps(record);
    _losClosedPolys = new Set();

    for (const [polyId, polyRecords] of _losPolyMap)
    {
        if (_isClosedRing(polyRecords))
            _losClosedPolys.add(polyId);
    }

    _losUniformPolys = new Set();
    _losPolyBoxes = new Map();
    for (const [polyId, polyRecords] of _losPolyMap)
        _addPolyFacts(polyId, polyRecords);
}

function swapWallSetRecords(removed, added)
{
    if (!_losVertexMap)
        return false;

    const removedSet = new Set(removed);
    const polyIds = new Set();

    for (const record of removed)
    {
        polyIds.add(record.polyId);

        for (const end of [record.edge.a, record.edge.b])
        {
            const key = _vertexKey(end.x, end.y);
            const list = _losVertexMap.get(key);

            if (!list)
                continue;

            const kept = list.filter(item => !removedSet.has(item));
            if (kept.length)
                _losVertexMap.set(key, kept);
            else
                _losVertexMap.delete(key);
        }
    }

    for (const record of added)
        polyIds.add(record.polyId);

    for (const polyId of polyIds)
    {
        _losPolyMap.delete(polyId);
        _losClosedPolys.delete(polyId);
        _losUniformPolys.delete(polyId);
        _losPolyBoxes.delete(polyId);
    }

    for (const record of added)
        _addRecordToMaps(record);

    const addedPolyIds = [...new Set(added.map(record => record.polyId))];

    for (const polyId of addedPolyIds)
    {
        if (_isClosedRing(_losPolyMap.get(polyId)))
            _losClosedPolys.add(polyId);
    }

    for (const polyId of addedPolyIds)
        _addPolyFacts(polyId, _losPolyMap.get(polyId));
    return true;
}

function _polyIdOf(record)
{
    return record.polyId ?? record.id.replace(/-\d+$/, '');
}

// Only closed rings support interior tests: parity over an open wall chain reads a half plane as inside.
function _isClosedPoly(record)
{
    return _losClosedPolys?.has(_polyIdOf(record)) ?? false;
}

// Ray-cast point-in-polygon over the edges of the wall that `record` belongs to, only those in the point's y slab.
function _pointInWall(px, py, record)
{
    const polyId = _polyIdOf(record);
    const polyRecords = _losPolyMap?.get(polyId);

    if (!polyRecords)
        return false;

    const box = _losPolyBoxes?.get(polyId);
    if (box && (py < box.minY || py > box.maxY || px > box.maxX + _EYE_SOLID_X_MARGIN))
        return false;

    let inside = false;
    const slabRecords = box ? box.slabs[Math.min(box.slabs.length - 1, Math.floor((py - box.minY) / box.slabH))] : polyRecords;

    for (const polyRecord of slabRecords)
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

// Margin covers the x-intersect overshoot past maxX (measured 1.16e-10 at 1e6 coords); 0 flips verdicts.
const _EYE_SOLID_X_MARGIN = 1e-6;

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
    ctx.blockRecord = null;
    const checkOwn = !ctx.ownEdgesRemoved;
    const nearest = ctx.nearestBlock ? { near: null, far: null } : null;
    // One read per LOS context instead of one per ray; ctx lives for a single pair test.
    ctx.trigHeightRule ??= _readTrigHeightRule();
    const trigHeightRule = ctx.trigHeightRule;
    const originX = origin.x;
    const originY = origin.y;
    const destX = dest.x;
    const destY = dest.y;
    const rayDirX = destX - originX;
    const rayDirY = destY - originY;
    const rayLenSq = ((rayDirX * rayDirX) + (rayDirY * rayDirY)) || 1;
    const rayLen = Math.sqrt(rayLenSq);

    const takeBlock = (blocker, reason, px, py, tAlong) =>
    {
        if (!nearest)
        {
            ctx.lastReason = reason;
            ctx.blockPoint = { x: px, y: py };
            ctx.blockRecord = blocker;
            return true;
        }

        _noteBlock(nearest, origin, rayDirX, rayDirY, rayLenSq, px, py, reason, tAlong);
        return false;
    };

    const endpointTol = canvas.grid.size * 0.02;
    const endpointTolSq = endpointTol * endpointTol;
    const vertexTol = canvas.grid.size * 0.05;
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
        if (checkOwn && record.id && (record.id.startsWith(skipPrefixA) || record.id.startsWith(skipPrefixB)))
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
            const polyId = _polyIdOf(record);

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
                            if (takeBlock(record, 'dive', probeX, probeY, along))
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
            const grazeDistA = Math.hypot(hit.x - edge.a.x, hit.y - edge.a.y);
            const grazeDistB = Math.hypot(hit.x - edge.b.x, hit.y - edge.b.y);
            let grazedVertex = null;

            if (grazeDistA <= vertexTol && grazeDistA <= grazeDistB)
                grazedVertex = edge.a;
            else if (grazeDistB <= vertexTol)
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
                        if (takeBlock(record, 'pinch', hit.x, hit.y, hit.t0))
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
                if (takeBlock(record, 'adj', hit.x, hit.y, hit.t0))
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
            const touchTol = (ctx.noPinch && !originOn) ? -1 : vertexTol;
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
                        if (takeBlock(record, 'pinch', startPt.x, startPt.y))
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
                if (takeBlock(record, 'through-touch', startPt.x, startPt.y))
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
                        if (takeBlock(record, 'pinch', hit.x, hit.y, hit.t0))
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
                if (takeBlock(record, 'band', hit.x, hit.y, hit.t0))
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

function _blocksAlone(reason, record)
{
    if (reason === 'band' || reason === 'adj' || reason === 'through-touch')
        return true;
    return reason === 'dive' && (_losUniformPolys?.has(_polyIdOf(record)) ?? false);
}

export {
    _losProfile, _losPolyMap, _EYE_SOLID_X_MARGIN, _polyIdOf, _pointToSegmentDistSq, _segmentBlocked, _blocksAlone,
    buildWallSet, clearWallSet, sightRecord, setTrigHeightRuleReader, swapWallSetRecords,
};
