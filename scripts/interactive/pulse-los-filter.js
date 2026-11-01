import { isHexGrid, getHexCenter, pixelToOffset, getHexVertices, getOccupiedOffsets, getInRangeOffsets, neighborKeys } from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { MODULE_ID, LOS_TARGET_ABOVE } from "../tools/constants.js";
import { hasLineOfSight, makeSkimRayCaster, getEyeWallSegments, makeEyeSolidTester, lancerSightEdgeRecords, makeCellRayCaster } from "../vision/lancerDetectionModes.js";
import { laSightEdgeOptions } from "../vision/laWallLos.js";
import { getShapeSamplePoints, getTokenVisionLOS } from "../vision/visionFromEdge.js";
import { getSettingEnabled } from "../setup/settings-register.js";
import { blindedVisionEnabled } from "../vision/blindedVision.js";

export function _cellCorners(col, row)
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

export function _cellColRow(cell)
{
    if (typeof cell === 'string')
    {
        const parts = cell.split(',');
        return { col: Number(parts[0]), row: Number(parts[1]) };
    }
    return { col: cell.col, row: cell.row };
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
export function _cellOnMap(col, row, rect)
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
// Clipper rounds to 0.01 px, so the angular noise of a vertex is a few hundredths of a pixel over its distance.
const STAR_POSITION_SLACK = 0.05;

// A sweep is star-shaped around its origin, so "inside" is one edge lookup by angle instead of a walk of every
// vertex. Null when the vertices are not in angular order, and the caller falls back to the plain test.
function _starIndex(polygon, origin)
{
    const points = polygon?.points;
    if (!points || points.length < 6)
        return null;
    const count = points.length / 2;
    const angles = new Float64Array(count);
    const distances = new Float64Array(count);
    let start = 0;
    for (let index = 0; index < count; index++)
    {
        const dx = points[index * 2] - origin.x;
        const dy = points[(index * 2) + 1] - origin.y;
        angles[index] = Math.atan2(dy, dx);
        distances[index] = Math.max(1, Math.hypot(dx, dy));
        if (angles[index] < angles[start])
            start = index;
    }
    for (const direction of [1, -1])
    {
        const ordered = new Float64Array(count);
        const xs = new Float64Array(count);
        const ys = new Float64Array(count);
        let monotone = true;
        let previous = -1;
        for (let step = 0; step < count; step++)
        {
            const index = (((start + (step * direction)) % count) + count) % count;
            ordered[step] = angles[index];
            xs[step] = points[index * 2];
            ys[step] = points[(index * 2) + 1];
            // vertices on one ray come back from Clipper's rounding a hair out of order, they are equal
            if (step > 0 && ordered[step] < ordered[step - 1])
            {
                const slack = STAR_POSITION_SLACK / Math.min(distances[index], distances[previous]);
                if (ordered[step] < ordered[step - 1] - slack)
                {
                    monotone = false;
                    break;
                }
                ordered[step] = ordered[step - 1];
            }
            previous = index;
        }
        if (monotone)
            return { angles: ordered, xs, ys, count, ox: origin.x, oy: origin.y };
    }
    return null;
}

function _starContains(star, x, y)
{
    const theta = Math.atan2(y - star.oy, x - star.ox);
    let low = 0;
    let high = star.count - 1;
    if (theta < star.angles[0])
        low = high;
    else
    {
        while (low < high)
        {
            const mid = (low + high + 1) >> 1;
            if (star.angles[mid] <= theta)
                low = mid;
            else
                high = mid - 1;
        }
    }
    const next = (low + 1) % star.count;
    const edgeX = star.xs[next] - star.xs[low];
    const edgeY = star.ys[next] - star.ys[low];
    const sidePoint = (edgeX * (y - star.ys[low])) - (edgeY * (x - star.xs[low]));
    const sideOrigin = (edgeX * (star.oy - star.ys[low])) - (edgeY * (star.ox - star.xs[low]));
    return sidePoint * sideOrigin >= 0;
}

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
        // Always the bare carrier, never the live vision source: the peek hook only fires on Token-sourced
        // sweeps, so a selected pulse and a hovered one would build different sweeps. The band veto is the height rule here.
        const sourceOpt = { source: { object: { b: eyeElevation, t: eyeElevation } }, b: eyeElevation, t: eyeElevation };
        const built = origins.map(point =>
        {
            const sweep = CONFIG.Canvas.polygonBackends.sight.create({ x: point.x, y: point.y, elevation: eyeElevation }, { type: 'sight', edgeOptions: laSightEdgeOptions(), ...sourceOpt });
            return { origin: point, sweep, star: _starIndex(sweep, point) };
        });
        const tester = (x, y) => built.some(entry => (entry.star ? _starContains(entry.star, x, y) : entry.sweep.contains(x, y)));
        tester.built = built;
        return tester;
    }
    catch (err)
    {
        console.warn('lancer-automations | LOS tester failed:', err);
        return null;
    }
}

let _trigVeto = true;
// Off: the seven test points already catch every straight-edged band above 3.5%, the area pass only adds
// light that bends around a wall end inside the hex, rare, for 20-30 ms a pulse.
let _areaPass = false;
let _pulseBuilds = [];
globalThis.laPulseArea = (on = true) =>
{
    _areaPass = !!on;
    return _areaPass;
};
globalThis.laPulseTrig = (on) =>
{
    if (on === undefined)
    {
        console.log(`${MODULE_ID} | pulse trig veto ${_trigVeto ? 'on' : 'off'} | last builds, newest last\n`
            + _pulseBuilds.map(build => JSON.stringify(build)).join('\n'));
        return _pulseBuilds;
    }
    _trigVeto = !!on;
    _pulseBuilds = [];
    return _trigVeto;
};

function _crossingParam(from, to, edgeA, edgeB)
{
    const rayX = to.x - from.x;
    const rayY = to.y - from.y;
    const wallX = edgeB.x - edgeA.x;
    const wallY = edgeB.y - edgeA.y;
    const denom = (rayX * wallY) - (rayY * wallX);
    if (Math.abs(denom) <= 1e-9)
        return null;
    const toWallX = edgeA.x - from.x;
    const toWallY = edgeA.y - from.y;
    const alongRay = ((toWallX * wallY) - (toWallY * wallX)) / denom;
    const alongWall = ((toWallX * rayY) - (toWallY * rayX)) / denom;
    if (alongRay <= 0 || alongRay >= 1 || alongWall < 0 || alongWall > 1)
        return null;
    return alongRay;
}

function _edgeMinDistance(record, point)
{
    const closest = foundry.utils.closestPointToSegment(point, record.edge.a, record.edge.b);
    return Math.hypot(closest.x - point.x, closest.y - point.y);
}

const PAIR_CLEAR = 0;
const PAIR_BLOCKED = 1;
const PAIR_GRAZED = 2;

// Sweeps and skim walks both run at eye height, so a low wall's shadow band is re-checked per hex at terrain top
// plus a target height. Plain crossings decide, a crossing at a wall corner goes back to the rule engine's skim rules.
function _makeBandVeto(origin, visible, build)
{
    // the band is the trig rule's, discrete has none
    if (!_trigVeto || !visible?.built?.length || getModuleSetting('lancerLosHeightRule') !== 'trig')
        return null;
    const eye = origin.losHeight ?? getTokenVisionLOS(origin);
    const center = origin.center;
    const distanceTo = point => Math.hypot(point.x - center.x, point.y - center.y);
    // nearest first, so a hex only scans the walls that can sit between it and the viewer
    const walls = lancerSightEdgeRecords()
        .map(record => ({ record, reach: _edgeMinDistance(record, center) }))
        .sort((left, right) => left.reach - right.reach);
    if (!walls.some(entry => entry.record.top < eye))
        return null;
    // centre first: on open ground the first pair clears and the hex costs one test
    const origins = visible.built.map(entry => entry.origin).sort((left, right) => distanceTo(left) - distanceTo(right));
    const originBox = _pointsBox(origins);
    const cellCaster = makeCellRayCaster(origin, canvas.grid.size / 2);
    const vertexTol = canvas.grid.size * 0.05;
    const hexReach = canvas.grid.size;

    const pairState = (from, to, hex) =>
    {
        let state = PAIR_CLEAR;
        for (const record of hex.lowWalls)
        {
            const alongRay = _crossingParam(from, to, record.edge.a, record.edge.b);
            if (alongRay === null)
                continue;
            const edge = record.edge;
            if (edge.direction && (edge.orientPoint?.(from) ?? 1) === edge.direction)
                continue;
            // the terrain lookup waits for the first ray that actually crosses a wall
            hex.targetHeight ??= getHexGroundElevation(hex.col, hex.row) + LOS_TARGET_ABOVE;
            const height = eye + ((hex.targetHeight - eye) * alongRay);
            if (height > record.top || height < record.bottom)
                continue;
            const hitX = from.x + ((to.x - from.x) * alongRay);
            const hitY = from.y + ((to.y - from.y) * alongRay);
            const grazed = Math.hypot(hitX - edge.a.x, hitY - edge.a.y) <= vertexTol
                || Math.hypot(hitX - edge.b.x, hitY - edge.b.y) <= vertexTol;
            if (!grazed)
                return PAIR_BLOCKED;
            state = PAIR_GRAZED;
        }
        return state;
    };

    const vetoHex = (col, row) =>
    {
        const targets = _hexTestPoints(col, row);
        const box = _pointsBox(targets, originBox);
        const hex = { col, row, center: getHexCenter(col, row), targetHeight: null, walls: [], lowWalls: [] };
        const limit = distanceTo(hex.center) + hexReach;
        for (const entry of walls)
        {
            if (entry.reach > limit)
                break;
            const record = entry.record;
            if (record.maxX < box.minX || record.minX > box.maxX || record.maxY < box.minY || record.minY > box.maxY)
                continue;
            hex.walls.push(record);
            if (record.top < eye)
                hex.lowWalls.push(record);
        }
        if (!hex.lowWalls.length)
            return false;
        build.tested++;
        const grazedPairs = [];
        for (const from of origins)
        {
            for (const to of targets)
            {
                const state = pairState(from, to, hex);
                if (state === PAIR_CLEAR)
                    return false;
                if (state === PAIR_GRAZED)
                    grazedPairs.push([from, to]);
            }
        }
        if (!cellCaster)
            return true;
        for (const [from, to] of grazedPairs)
        {
            build.casterRays += 2;
            if (cellCaster.forward(from, to, hex.center, hex.targetHeight, hex.walls)
                || cellCaster.reverse(to, hex.center, hex.targetHeight, from, hex.walls))
                return false;
        }
        return true;
    };

    return (col, row) =>
    {
        const started = performance.now();
        const vetoed = vetoHex(col, row);
        build.hexes++;
        build.vetoMs = Math.round((build.vetoMs + performance.now() - started) * 10) / 10;
        if (vetoed)
            build.vetoed++;
        return vetoed;
    };
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
    const step = canvas.grid.size / 2;
    const maxDist = canvas.grid.size * 25;
    // Only walls the walks can reach are scanned per side point, the rest of the map cannot cross them.
    const center = origin.center;
    const reach = maxDist + (Math.max(origin.w ?? 0, origin.h ?? 0) / 2) + canvas.grid.size;
    const eyeEdges = getEyeWallSegments(origin)
        .map(seg => ({
            a: seg.a,
            b: seg.b,
            minX: Math.min(seg.a.x, seg.b.x),
            maxX: Math.max(seg.a.x, seg.b.x),
            minY: Math.min(seg.a.y, seg.b.y),
            maxY: Math.max(seg.a.y, seg.b.y)
        }))
        .filter(seg =>
        {
            const closest = foundry.utils.closestPointToSegment(center, seg.a, seg.b);
            return Math.hypot(closest.x - center.x, closest.y - center.y) <= reach;
        });
    const inEyeSolid = makeEyeSolidTester(origin) ?? (() => false);
    const centerReachable = (fromPoint, centerPoint) =>
    {
        if (inEyeSolid(centerPoint))
            return false;
        const minX = Math.min(fromPoint.x, centerPoint.x);
        const maxX = Math.max(fromPoint.x, centerPoint.x);
        const minY = Math.min(fromPoint.y, centerPoint.y);
        const maxY = Math.max(fromPoint.y, centerPoint.y);
        for (const seg of eyeEdges)
        {
            if (seg.maxX < minX || seg.minX > maxX || seg.maxY < minY || seg.minY > maxY)
                continue;
            if (foundry.utils.lineSegmentIntersects(fromPoint, centerPoint, seg.a, seg.b))
                return false;
        }
        return true;
    };
    const cells = new Set();
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
        console.warn('lancer-automations | laSkimDraw | select a token');
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
    console.log(`lancer-automations | laSkimDraw | ${litCells.size} cells lit by skim lines`);
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
        console.warn('lancer-automations | laAreaDraw | select a token');
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
    console.log(`lancer-automations | laAreaDraw | ${rows.length} cells,${grantedCount} granted (green), ${mismatches} refused but inside Foundry's own vision (blue outline), ${Math.round(performance.now() - started)} ms`);
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
function _hexLitFraction(col, row, clipPaths, scale, stopAt = Infinity)
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
        // one eye past the bar is the whole claim, the other eyes cannot lower it
        if (bestLit / hexArea >= stopAt)
            break;
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
    // Test only: one record per build, so a pulse that builds several filters lists each of them.
    const build = { los, freeRange, useLos, sweepsMs: 0, tokenMs: 0, skimMs: 0, hexes: 0, tested: 0, vetoed: 0, vetoMs: 0, casterRays: 0, calls: 0, filterMs: 0 };
    _pulseBuilds.push(build);
    if (_pulseBuilds.length > 8)
        _pulseBuilds.shift();
    let stageStart = performance.now();
    const visible = useLos && !blindedCells ? _visibilityTester(origin) : null;
    build.sweepsMs = Math.round((performance.now() - stageStart) * 10) / 10;
    stageStart = performance.now();
    const tokenCells = useLos && visible ? _tokenCellKeys(origin) : null;
    build.tokenMs = Math.round((performance.now() - stageStart) * 10) / 10;
    stageStart = performance.now();
    const skimCells = useLos && visible ? _skimLineCells(origin) : null;
    build.skimMs = Math.round((performance.now() - stageStart) * 10) / 10;
    const bandVeto = useLos && visible ? _makeBandVeto(origin, visible, build) : null;
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
            fraction = _hexLitFraction(col, row, clipPaths, CONST.CLIPPER_SCALING_FACTOR, AREA_GRANT_FRACTION);
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
        const filterStart = performance.now();
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
            if (_hexTestPoints(col, row).some(point => visible(point.x, point.y)) || skimCells?.has(key))
            {
                // the skim walks run at eye height, so the target height is applied here, and never in the area pass
                if (bandVeto?.(col, row))
                {
                    verdicts.set(key, 0);
                    continue;
                }
                verdicts.set(key, 1);
                kept.push(cell);
                litKeys.add(key);
                continue;
            }
            if (clipPaths && _areaPass)
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
                if (bandVeto?.(pending.col, pending.row))
                {
                    verdicts.set(pending.key, 0);
                    deferred.splice(index, 1);
                    continue;
                }
                verdicts.set(pending.key, 1);
                kept.push(pending.cell);
                litKeys.add(pending.key);
                deferred.splice(index, 1);
                grew = true;
            }
        }
        build.calls++;
        build.filterMs = Math.round((build.filterMs + performance.now() - filterStart) * 10) / 10;
        return kept;
    };
    freeMap?.set(freeRange, cellFilter);
    return cellFilter;
}

// The drag-preview clone while the origin is being dragged, else the origin itself.
export function _effectiveOrigin(origin)
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
