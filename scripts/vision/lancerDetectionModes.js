/* global Hooks, CONFIG, DetectionMode, OutlineOverlayFilter, Token, game, canvas, ui */

import { getTokenDistance } from "../combat/overwatch.js";
import { getTokenVisionLOS } from "./visionFromEdge.js";

const MODULE_ID = 'lancer-automations';
const SETTING_AUTO_ADD = 'lancerVisionAutoAdd';
const SETTING_LOS = 'lancerLos';
const SETTING_LOS_DEBUG = 'lancerLosDebug';
const SETTING_SENSOR_COMBAT_ONLY = 'lancerSensorCombatOnly';
const SETTING_AWARENESS_COMBAT_ONLY = 'lancerAwarenessCombatOnly';
const SETTING_SENSOR_USE_MODE_RANGE = 'lancerSensorUseModeRange';
const SETTING_AWARENESS_USE_MODE_RANGE = 'lancerAwarenessUseModeRange';
const SETTING_BASIC_SIGHT_999 = 'basicSightTo999';
const SETTING_DRAG_VISION_MODE = 'dragVisionMode';

function _getSetting(key)
{
    try
    {
        return game.settings.get(MODULE_ID, key);
    }
    catch (e)
    {
        return undefined;
    }
}

function _isCombatActive()
{
    return !!game.combat?.started;
}

function _fovContains(visionSource, target)
{
    const fov = /** @type {any} */ (visionSource)?.fov;
    if (!fov?.contains)
        return false;
    const targetCenter = target?.center ?? { x: target?.x, y: target?.y };
    if (typeof targetCenter?.x !== 'number' || typeof targetCenter?.y !== 'number')
        return false;
    return fov.contains(targetCenter.x, targetCenter.y);
}

function _losVetoed(visionSource, target)
{
    if (!_getSetting(SETTING_LOS))
        return false;
    if (!(target instanceof Token))
        return false;
    const viewerToken = visionSource?.object;
    if (!viewerToken?.document)
        return false;
    return !lancerHasLineOfSight(viewerToken, target);
}

function _basicVisionSees(visionSource, target)
{
    return _fovContains(visionSource, target) && !_losVetoed(visionSource, target);
}

function _isBlockedByTokenEdge(visionSource, target)
{
    if (!canvas?.edges || !target)
        return false;
    const srcTokenId = visionSource?.object?.id;
    const src = { x: visionSource.x, y: visionSource.y };
    const dst = target.center ?? { x: target.x, y: target.y };
    for (const edge of canvas.edges.values())
    {
        const id = edge.id;
        if (typeof id !== 'string' || !id.startsWith('la-block-los-'))
            continue;
        if (srcTokenId && id.startsWith(`la-block-los-${srcTokenId}-`))
            continue;
        if (foundry.utils.lineSegmentIntersects(src, dst, edge.a, edge.b))
            return true;
    }
    return false;
}

// Wall-based Lancer line of sight: height-aware edge-to-edge rays. A line along a wall edge is not broken.
let _losEdgeCache = null;
let _losVertexMap = null;
let _losPolyMap = null;
const _losPairCache = new Map();

function _losInvalidate()
{
    _losEdgeCache = null;
    _losVertexMap = null;
    _losPolyMap = null;
    _losPairCache.clear();
}

function _losPosKey(doc)
{
    return `${doc.id}:${Math.round(doc.x)}:${Math.round(doc.y)}:${Math.round((doc.elevation ?? 0) * 100)}`;
}

// Sight-blocking edges (walls + the bulwark token blockers + wall-height terrain), cached per refresh.
function _collectSightEdges()
{
    if (_losEdgeCache)
        return _losEdgeCache;
    const records = [];
    for (const edge of canvas?.edges?.values?.() ?? [])
    {
        if ((edge.sight ?? 0) <= 0)
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
    _losEdgeCache = records;
    return records;
}

// Ray-cast point-in-polygon over every edge of the wall that `record` belongs to.
function _pointInWall(px, py, record)
{
    const polyRecords = _losPolyMap?.get(record.id.replace(/-\d+$/, ''));
    if (!polyRecords)
        return false;
    let inside = false;
    for (const rec of polyRecords)
    {
        const ax = rec.edge.a.x;
        const ay = rec.edge.a.y;
        const bx = rec.edge.b.x;
        const by = rec.edge.b.y;
        if ((ay > py) !== (by > py) && px < ax + ((py - ay) / (by - ay)) * (bx - ax))
            inside = !inside;
    }
    return inside;
}

function _vertexKey(x, y)
{
    return `${Math.round(x)},${Math.round(y)}`;
}

// At a shared wall vertex the ray blocks only if it passes between the two edges into the solid; a tip graze is a skim.
function _skimsVertex(origin, dest, edge, vx, vy)
{
    const neighbors = _losVertexMap?.get(_vertexKey(vx, vy));
    if (!neighbors)
        return true;
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
        return true;
    const dirX = dest.x - origin.x;
    const dirY = dest.y - origin.y;
    const sideThis = Math.sign(dirX * (thisFar.y - vy) - dirY * (thisFar.x - vx));
    const sideOther = Math.sign(dirX * (otherFar.y - vy) - dirY * (otherFar.x - vx));
    if (sideThis === 0 || sideOther === 0)
        return true;
    return sideThis === sideOther;
}

function _pointToSegmentDist(px, py, ax, ay, bx, by)
{
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let proj = lenSq > 0 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
    proj = Math.max(0, Math.min(1, proj));
    return Math.hypot(px - (ax + proj * dx), py - (ay + proj * dy));
}

// Wall LOS height rule: both eyes over the top => clear; neither => blocked; one over => the shorter is hidden only if adjacent.
function _segmentBlocked(origin, originHeight, dest, destHeight, edges, ctx)
{
    const { skipPrefixA, skipPrefixB, centerA, centerB, radiusA, radiusB } = ctx;
    const adjacentSlack = canvas.grid.size * 0.75;
    ctx.lastReason = 'open';
    ctx.blockPoint = null;
    const segMinX = Math.min(origin.x, dest.x);
    const segMaxX = Math.max(origin.x, dest.x);
    const segMinY = Math.min(origin.y, dest.y);
    const segMaxY = Math.max(origin.y, dest.y);
    for (const record of edges)
    {
        if (record.maxX < segMinX || record.minX > segMaxX || record.maxY < segMinY || record.minY > segMaxY)
            continue;
        if (record.id && (record.id.startsWith(skipPrefixA) || record.id.startsWith(skipPrefixB)))
            continue;
        const edge = record.edge;
        // A ray endpoint sitting exactly on a wall vertex is a real touch that lineSegmentIntersects misses.
        const endpointTol = canvas.grid.size * 0.02;
        const originOn = _pointToSegmentDist(origin.x, origin.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y) <= endpointTol;
        const destOn = _pointToSegmentDist(dest.x, dest.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y) <= endpointTol;
        const touchesEnd = originOn || destOn;
        const side = edge.orientPoint?.(origin) ?? 1;
        if (!side && !touchesEnd)
            continue;
        if (edge.direction && side === edge.direction)
            continue;
        if (edge.applyThreshold?.('sight', origin))
            continue;
        const crosses = foundry.utils.lineSegmentIntersects(origin, dest, edge.a, edge.b);
        if (!crosses && !touchesEnd)
            continue;
        // Touching a wall only at an endpoint (lineSegmentIntersects counts it) blocks only if the ray heads into the wall.
        if (touchesEnd)
        {
            const startPt = originOn ? origin : dest;
            const otherPt = originOn ? dest : origin;
            const stepLen = Math.hypot(otherPt.x - startPt.x, otherPt.y - startPt.y) || 1;
            const sampleX = startPt.x + ((otherPt.x - startPt.x) / stepLen) * 2;
            const sampleY = startPt.y + ((otherPt.y - startPt.y) / stepLen) * 2;
            if (!_pointInWall(sampleX, sampleY, record))
                continue;
        }
        const hit = foundry.utils.lineLineIntersection(origin, dest, edge.a, edge.b) ?? { x: origin.x, y: origin.y, t0: 0 };
        // Grazing a wall's tip (line of sight along the edge) does not block.
        if (hit)
        {
            const vertexTol = canvas.grid.size * 0.05;
            const distA = Math.hypot(hit.x - edge.a.x, hit.y - edge.a.y);
            const distB = Math.hypot(hit.x - edge.b.x, hit.y - edge.b.y);
            if (distA <= vertexTol && distA <= distB && _skimsVertex(origin, dest, edge, edge.a.x, edge.a.y))
            {
                ctx.lastReason = 'skim';
                continue;
            }
            if (distB <= vertexTol && distB < distA && _skimsVertex(origin, dest, edge, edge.b.x, edge.b.y))
            {
                ctx.lastReason = 'skim';
                continue;
            }
        }
        const originOver = originHeight > record.top;
        const destOver = destHeight > record.top;
        if (originOver && destOver)
        {
            ctx.lastReason = 'over2';
            continue;
        }
        if (originOver !== destOver)
        {
            const shorterCenter = originOver ? centerB : centerA;
            const shorterRadius = originOver ? radiusB : radiusA;
            const viewerEye = originOver ? originHeight : destHeight;
            const dist = _pointToSegmentDist(shorterCenter.x, shorterCenter.y, edge.a.x, edge.a.y, edge.b.x, edge.b.y);
            const shorterAdj = (dist - shorterRadius) <= adjacentSlack;
            // adjacent shadow hides it, unless the viewer stands a full level above the wall
            if (shorterAdj && viewerEye < record.top + 1)
            {
                ctx.lastReason = 'adj';
                ctx.blockPoint = { x: hit.x, y: hit.y };
                return true;
            }
            ctx.lastReason = 'over1';
            continue;
        }
        if (hit)
        {
            const heightAtHit = originHeight + (destHeight - originHeight) * (hit.t0 ?? 0);
            if (heightAtHit >= record.bottom && heightAtHit <= record.top)
            {
                ctx.lastReason = 'band';
                ctx.blockPoint = { x: hit.x, y: hit.y };
                return true;
            }
        }
    }
    return false;
}

// Centre + the outermost left/right silhouette vertices relative to the a->b ray (as THT's calculateRaysBetweenTokensOrPoints).
function _tokenLosPoints(token, aCenter, bCenter)
{
    const center = token.center;
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
    if (canvas.grid.isHexagonal)
    {
        const pts = token.getShape().points;
        verts = [];
        for (let idx = 0; idx < pts.length; idx += 2)
            verts.push({ x: Math.round(pts[idx] + token.x), y: Math.round(pts[idx + 1] + token.y) });
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

export function lancerHasLineOfSight(tokenA, tokenB)
{
    const docA = tokenA?.document;
    const docB = tokenB?.document;
    // fail open on missing data so occlusion never hides a token by accident
    if (!docA || !docB || docA.id === docB.id)
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
    const edges = _collectSightEdges();
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
    _losPairCache.set(pairKey, result);
    return result;
}

function _resolveToken(ref)
{
    if (!ref)
        return null;
    if (ref instanceof Token)
        return ref;
    if (ref.object instanceof Token)
        return ref.object;
    if (typeof ref === 'string')
        return canvas?.tokens?.get(ref) ?? null;
    return null;
}

/**
 * Beta. Does A have a clear Lancer line of sight to B? Wall-based, height-aware, reciprocal.
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
    return lancerHasLineOfSight(tokenA, tokenB);
}

function _roundPoint(point)
{
    return { x: Math.round(point.x), y: Math.round(point.y) };
}

// Console diagnostic (lancerLosDump()): prints ray endpoints, per-ray reason, and nearby wall edges to copy.
function _dumpLos()
{
    const viewer = canvas?.tokens?.controlled?.[0];
    if (!viewer)
    {
        console.warn('lancerLosDump: select a viewer token first');
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
        const nearEdges = edges
            .filter(record => !(record.maxX < minX || record.minX > maxX || record.maxY < minY || record.minY > maxY))
            .map(record => ({ id: record.id, a: _roundPoint(record.edge.a), b: _roundPoint(record.edge.b), top: record.top }));
        dump.push({ viewer: viewer.document.name, viewerEye: heightV, target: target.document.name, targetEye: heightT, grid: canvas.grid.size, rays, nearEdges });
    }
    console.log('LANCER_LOS_DUMP\n' + JSON.stringify(dump, null, 1));
    return dump;
}
globalThis.lancerLosDump = _dumpLos;

// Debug overlay: rays from controlled tokens; green = clear, red = blocked.
let _losDebugLayer = null;

// While a token is dragged the visible token is a preview clone; use it so debug lines track the drag.
function _laDragPreview(token)
{
    const id = token?.document?.id;
    if (!id)
        return token;
    for (const preview of canvas?.tokens?.preview?.children ?? [])
    {
        if (preview?.document?.id === id)
            return preview;
    }
    return token;
}

function _drawLosDebug()
{
    if (!_losDebugLayer || _losDebugLayer.destroyed)
        return;
    for (const child of _losDebugLayer.removeChildren())
        child.destroy();
    if (!_getSetting(SETTING_LOS_DEBUG))
        return;
    const edges = _collectSightEdges();
    const gfx = new PIXI.Graphics();
    _losDebugLayer.addChild(gfx);
    // Every sight edge the LOS test sees: cyan = height-limited (top shown), magenta = full-height wall.
    for (const record of edges)
    {
        const finite = Number.isFinite(record.top);
        const color = finite ? 0x33bbff : 0xff33ff;
        gfx.lineStyle(3, color, 0.85);
        gfx.moveTo(record.edge.a.x, record.edge.a.y);
        gfx.lineTo(record.edge.b.x, record.edge.b.y);
        const heightText = new PIXI.Text(finite ? record.top.toFixed(1) : 'inf', {
            fontFamily: 'monospace', fontSize: 11, fill: color, stroke: 0x000000, strokeThickness: 3,
        });
        heightText.anchor.set(0.5, 0.5);
        heightText.position.set((record.edge.a.x + record.edge.b.x) / 2, (record.edge.a.y + record.edge.b.y) / 2);
        _losDebugLayer.addChild(heightText);
    }
    const viewers = canvas?.tokens?.controlled ?? [];
    const targets = canvas?.tokens?.placeables ?? [];
    if (!viewers.length)
        return;
    for (const viewer of viewers)
    {
        if (!viewer.document)
            continue;
        const effectiveViewer = _laDragPreview(viewer);
        const eyeViewer = getTokenVisionLOS(effectiveViewer);
        const skipViewer = `la-block-los-${viewer.document.id}-`;
        for (const target of targets)
        {
            if (target === viewer || !target.document)
                continue;
            const effectiveTarget = _laDragPreview(target);
            const eyeTarget = getTokenVisionLOS(effectiveTarget);
            const viewerCenter = effectiveViewer.center;
            const targetCenter = effectiveTarget.center;
            const viewerPoints = _tokenLosPoints(effectiveViewer, viewerCenter, targetCenter);
            const targetPoints = _tokenLosPoints(effectiveTarget, viewerCenter, targetCenter);
            const ctx = {
                skipPrefixA: skipViewer,
                skipPrefixB: `la-block-los-${target.document.id}-`,
                centerA: viewerCenter,
                centerB: targetCenter,
                radiusA: Math.max(effectiveViewer.w ?? 0, effectiveViewer.h ?? 0) / 2,
                radiusB: Math.max(effectiveTarget.w ?? 0, effectiveTarget.h ?? 0) / 2,
            };
            let anyClear = false;
            for (let index = 0; index < viewerPoints.length; index++)
            {
                const clear = !_segmentBlocked(viewerPoints[index], eyeViewer, targetPoints[index], eyeTarget, edges, ctx);
                if (clear)
                    anyClear = true;
                gfx.lineStyle(2, clear ? 0x22ff44 : 0xff2222, clear ? 0.7 : 0.4);
                gfx.moveTo(viewerPoints[index].x, viewerPoints[index].y);
                gfx.lineTo(targetPoints[index].x, targetPoints[index].y);
                const reasonText = new PIXI.Text(ctx.lastReason ?? '', {
                    fontFamily: 'monospace', fontSize: 10, fill: clear ? 0x22ff44 : 0xff2222, stroke: 0x000000, strokeThickness: 3,
                });
                reasonText.anchor.set(0.5, 0.5);
                const labelPoint = (!clear && ctx.blockPoint) ? ctx.blockPoint : { x: (viewerPoints[index].x + targetPoints[index].x) / 2, y: (viewerPoints[index].y + targetPoints[index].y) / 2 };
                reasonText.position.set(labelPoint.x, labelPoint.y);
                _losDebugLayer.addChild(reasonText);
            }
            const center = effectiveTarget.center;
            const label = new PIXI.Text(`${anyClear ? 'LOS' : 'NO LOS'}  eye ${eyeViewer.toFixed(1)} -> ${eyeTarget.toFixed(1)}`, {
                fontFamily: 'monospace',
                fontSize: 13,
                fill: anyClear ? 0x33ff66 : 0xff5555,
                stroke: 0x000000,
                strokeThickness: 3,
            });
            label.anchor.set(0.5, 1);
            label.position.set(center.x, center.y - effectiveTarget.h / 2 - 4);
            _losDebugLayer.addChild(label);
        }
    }
}

function _installLosDebug()
{
    if (!_losDebugLayer || _losDebugLayer.destroyed)
    {
        _losDebugLayer = new PIXI.Container();
        _losDebugLayer.eventMode = 'none';
    }
    if (canvas?.stage && _losDebugLayer.parent !== canvas.stage)
        canvas.stage.addChild(_losDebugLayer);
    _drawLosDebug();
}

function _applyScaledThickness(filter, input)
{
    const width = input?.filterFrame?.width ?? input?.width ?? 100;
    const height = input?.filterFrame?.height ?? input?.height ?? 100;
    const maxDim = Math.max(width, height);
    filter.thickness = Math.max(1, maxDim * 0.001);
}

class SilhouetteOutlineFilter extends OutlineOverlayFilter
{
    apply(filterManager, input, output, clear, currentState)
    {
        super.apply(filterManager, input, output, clear, currentState);
    }

    static createFragmentShader()
    {
        return `
        varying vec2 vTextureCoord;
        varying vec2 vFilterCoord;
        uniform sampler2D uSampler;

        uniform vec2 thickness;
        uniform vec4 outlineColor;
        uniform vec4 filterClamp;
        uniform float alphaThreshold;
        uniform float time;

        ${this.CONSTANTS}

        void main(void) {
            vec4 ownColor = texture2D(uSampler, clamp(vTextureCoord, filterClamp.xy, filterClamp.zw));
            float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
            float maxAlpha = 0.0;
            vec2 displaced;
            vec4 curColor;
            for ( float angle = 0.0; angle <= TWOPI; angle += ${(Math.PI * 2 / 30).toFixed(7)} ) {
                displaced.x = vTextureCoord.x + thickness.x * cos(angle);
                displaced.y = vTextureCoord.y + thickness.y * sin(angle);
                curColor = texture2D(uSampler, clamp(displaced, filterClamp.xy, filterClamp.zw));
                curColor.a = clamp((curColor.a - 0.6) * 2.5, 0.0, 1.0);
                maxAlpha = max(maxAlpha, curColor.a);
            }
            float resultAlpha = max(maxAlpha, texAlpha);

            float scanY = mod(time * 0.0008, 1.0);
            float lineDist = abs(vFilterCoord.y - scanY);
            float lineWidth = 0.015;
            float scan = pow(smoothstep(lineWidth, 0.0, lineDist), 4.0);

            vec3 fill = outlineColor.rgb * scan * texAlpha;
            vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
            gl_FragColor = vec4((fill + outline) * resultAlpha, resultAlpha);
        }
        `;
    }
}

class ScanlineOutlineFilter extends OutlineOverlayFilter
{
    apply(filterManager, input, output, clear, currentState)
    {
        super.apply(filterManager, input, output, clear, currentState);
    }

    static createFragmentShader()
    {
        return `
        varying vec2 vTextureCoord;
        varying vec2 vFilterCoord;
        uniform sampler2D uSampler;

        uniform vec2 thickness;
        uniform vec4 outlineColor;
        uniform vec4 filterClamp;
        uniform float alphaThreshold;
        uniform float time;

        ${this.CONSTANTS}

        void main(void) {
            vec4 ownColor = texture2D(uSampler, clamp(vTextureCoord, filterClamp.xy, filterClamp.zw));
            float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
            float maxAlpha = 0.0;
            vec2 displaced;
            vec4 curColor;
            for ( float angle = 0.0; angle <= TWOPI; angle += ${(Math.PI * 2 / 30).toFixed(7)} ) {
                displaced.x = vTextureCoord.x + thickness.x * cos(angle);
                displaced.y = vTextureCoord.y + thickness.y * sin(angle);
                curColor = texture2D(uSampler, clamp(displaced, filterClamp.xy, filterClamp.zw));
                curColor.a = clamp((curColor.a - 0.6) * 2.5, 0.0, 1.0);
                maxAlpha = max(maxAlpha, curColor.a);
            }
            float resultAlpha = max(maxAlpha, texAlpha);

            float scanY = mod(time * 0.0008, 1.0);
            float lineDist = abs(vFilterCoord.y - scanY);
            float lineWidth = 0.04;
            float scan = pow(smoothstep(lineWidth, 0.0, lineDist), 3.0);

            vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
            vec4 outlineColor4 = vec4(outline * resultAlpha, resultAlpha);
            gl_FragColor = mix(outlineColor4, vec4(0.0), texAlpha);
        }
        `;
    }
}

// Identity passthrough; a null filter would hide detected tokens under unexplored fog.
class PlainVisionFilter extends PIXI.Filter
{
}

class DetectionModeLancerLineOfSight extends DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        this._detectionFilter = new PlainVisionFilter();
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof Token))
            return false;
        if (!_getSetting(SETTING_LOS))
            return false;
        // plain-sight semantics: blind viewers and invisible targets stay hidden
        if (!super._canDetect(visionSource, target))
            return false;
        if (target.document?.getFlag?.(MODULE_ID, 'awarenessMode') === 'ignore')
            return false;
        const viewerToken = visionSource?.object;
        if (!viewerToken?.document)
            return false;
        return lancerHasLineOfSight(target, viewerToken);
    }

    _testRange(visionSource, mode, target, test)
    {
        return true;
    }
}

// Marker so the overlay ticker paints a gray desaturated fill (see _tickSilhouetteOverlays).
class ShadowVisionFilter extends PIXI.Filter
{
}

// 2D-visible but 3D-occluded: renders a gray fill instead of hiding or fully showing.
class DetectionModeLancerLosShadow extends DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        this._detectionFilter = new ShadowVisionFilter();
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof Token))
            return false;
        if (target.document?.getFlag?.(MODULE_ID, 'awarenessMode') === 'ignore')
            return false;
        if (!_fovContains(visionSource, target))
            return false;
        return _losVetoed(visionSource, target);
    }

    _testRange(visionSource, mode, target, test)
    {
        return true;
    }
}

class DetectionModeLancerAwareness extends DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        const filter = SilhouetteOutlineFilter.create({ outlineColor: [1, 0.85, 0.15, 1] });
        filter.thickness = 1.25;
        this._detectionFilter = filter;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof Token))
            return false;
        if (_getSetting(SETTING_AWARENESS_COMBAT_ONLY) && !_isCombatActive())
            return false;
        if (_basicVisionSees(visionSource, target))
            return false;
        if (target.document?.getFlag?.(MODULE_ID, 'awarenessMode') === 'ignore')
            return false;
        // Sensor wins: if the same observer's sensor mode would detect this target, suppress awareness.
        if (_sensorCanDetect(visionSource, target))
            return false;
        return true;
    }

    _testRange(visionSource, mode, target, test)
    {
        if (_getSetting(SETTING_AWARENESS_USE_MODE_RANGE))
            return super._testRange(visionSource, mode, target, test);
        return true;
    }
}

function _sensorCanDetect(visionSource, target)
{
    const sourceToken = visionSource?.object;
    if (!sourceToken?.document)
        return false;
    const sensorMode = sourceToken.document.detectionModes?.find(modeEntry => modeEntry.id === 'lancerSensor');
    if (!sensorMode?.enabled)
        return false;
    if (_getSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive())
        return false;
    const targetMode = target.document?.getFlag?.(MODULE_ID, 'awarenessMode');
    if (targetMode && targetMode !== 'default')
        return false;
    const sensorRange = sourceToken.actor?.system?.sensor_range;
    if ((sensorRange ?? 0) <= 0)
        return false;
    const candidates = _sourceWithPreview(sourceToken);
    const targets = _sourceWithPreview(target);
    for (const src of candidates)
    {
        for (const targetPreview of targets)
        {
            try
            {
                if (getTokenDistance(src, targetPreview) <= sensorRange)
                    return true;
            }
            catch (e)
            {
                // ignore
            }
        }
    }
    return false;
}

class DetectionModeLancerSensor extends DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        const filter = ScanlineOutlineFilter.create({ outlineColor: [0.329, 0.620, 1.0, 1.0] });
        filter.thickness = 1.25;
        this._detectionFilter = filter;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof Token))
            return false;
        if (_getSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive())
            return false;
        if (_basicVisionSees(visionSource, target))
            return false;
        const mode = target.document?.getFlag?.(MODULE_ID, 'awarenessMode');
        if (mode && mode !== 'default')
            return false;
        return true;
    }

    _testRange(visionSource, mode, target, test)
    {
        if (_getSetting(SETTING_SENSOR_USE_MODE_RANGE))
            return super._testRange(visionSource, mode, target, test);
        const sourceToken = visionSource.object;
        const sensorRange = sourceToken?.actor?.system?.sensor_range;
        if ((sensorRange ?? 0) <= 0)
            return false;
        if (!sourceToken?.document || !target?.document)
            return super._testRange(visionSource, mode, target, test);
        const candidates = _sourceWithPreview(sourceToken);
        const targets = _sourceWithPreview(target);
        for (const src of candidates)
        {
            for (const targetPreview of targets)
            {
                try
                {
                    if (getTokenDistance(src, targetPreview) <= sensorRange)
                        return true;
                }
                catch (e)
                {
                    // ignore
                }
            }
        }
        return false;
    }
}

function _sourceWithPreview(token)
{
    if (!token)
        return [];
    const list = [token];
    if (token._original?.document)
        list.push(token._original);
    const previews = canvas?.tokens?.preview?.children ?? [];
    for (const preview of previews)
    {
        if (preview instanceof Token && preview._original === token)
            list.push(preview);
    }
    return list;
}

function _registerVisionSettings()
{
    const refreshPerception = () =>
    {
        if (canvas?.perception)
            canvas.perception.update({ refreshVision: true });
    };
    game.settings.register(MODULE_ID, SETTING_AUTO_ADD, {
        name: 'Auto-add Lancer detection modes on token creation',
        hint: 'Add Lancer Sensors and Battlefield Awareness to newly placed tokens.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_COMBAT_ONLY, {
        name: 'Lancer Sensors: combat only',
        hint: 'Only render sensor highlights during active combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_COMBAT_ONLY, {
        name: 'Battlefield Awareness: combat only',
        hint: 'Only render awareness highlights during active combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_USE_MODE_RANGE, {
        name: 'Lancer Sensors: use detection-mode range',
        hint: 'Use the per-token detection-mode range instead of the actor sensor range.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_USE_MODE_RANGE, {
        name: 'Battlefield Awareness: use detection-mode range',
        hint: 'Use the per-token detection-mode range instead of infinite.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_LOS, {
        name: 'Lancer Line of Sight',
        hint: 'Wall-based reciprocal line of sight: reveals tokens that can see you, dims those you have no clear line to.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_LOS_DEBUG, {
        name: 'Lancer Line of Sight: debug overlay',
        hint: 'Draw the tested sightlines from controlled tokens; green clear, red blocked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _drawLosDebug()
    });
    game.settings.register(MODULE_ID, SETTING_BASIC_SIGHT_999, {
        name: 'Basic vision range = 999',
        hint: 'Override basicSight and lightPerception detection range to 999 on auto-created tokens.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });
    game.settings.register(MODULE_ID, SETTING_DRAG_VISION_MODE, {
        name: 'Drag-vision mode',
        hint: 'How the Drag Vision Multiplier applies during a drag.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            ratio: 'Ratio (multiply current radius)',
            flat: 'Flat (range in scene units)'
        },
        default: 'ratio'
    });
}

// v13 first-hit order: sensor+awareness precede shadow so they fire on no-LOS tokens; shadow is last.
const _CANONICAL_ORDER = ['basicSight', 'lightPerception', 'lancerLineOfSight', 'lancerSensor', 'lancerAwareness', 'lancerLosShadow'];

// Pass through; forcing 0 broke infinite semantics in the UI (Foundry reduces on write).
function _sanitizeMode(mode)
{
    if (!mode)
        return null;
    return { ...mode };
}

function _augmentDetectionModes(existing)
{
    const original = [...(existing ?? [])];
    const byId = new Map(original.filter(mode => mode?.id).map(mode => [mode.id, _sanitizeMode(mode)]));
    // range null = unlimited (Foundry preps it to Infinity); 0 would mean "detects nothing"
    if (!byId.has('lancerLineOfSight'))
        byId.set('lancerLineOfSight', { id: 'lancerLineOfSight', enabled: true, range: null });
    if (!byId.has('lancerLosShadow'))
        byId.set('lancerLosShadow', { id: 'lancerLosShadow', enabled: true, range: null });
    if (!byId.has('lancerSensor'))
        byId.set('lancerSensor', { id: 'lancerSensor', enabled: true, range: null });
    if (!byId.has('lancerAwareness'))
        byId.set('lancerAwareness', { id: 'lancerAwareness', enabled: true, range: null });
    const ordered = [];
    for (const id of _CANONICAL_ORDER)
    {
        if (byId.has(id))
        {
            ordered.push(byId.get(id));
            byId.delete(id);
        }
    }
    for (const mode of byId.values())
        ordered.push(mode);
    const orderChanged = ordered.length !== original.length
        || ordered.some((mode, i) => original[i]?.id !== mode?.id);
    const rangesSanitized = ordered.some(mode =>
    {
        const orig = original.find(origMode => origMode?.id === mode?.id);
        return orig && orig.range !== mode.range;
    });
    return { updates: ordered, changed: orderChanged || rangesSanitized };
}

function _onCreateToken(tokenDoc, _options, userId)
{
    if (game.user.id !== userId)
        return;
    if (!_getSetting(SETTING_AUTO_ADD))
        return;
    const update = {};
    const { updates, changed } = _augmentDetectionModes(tokenDoc._source?.detectionModes ?? tokenDoc.detectionModes);
    if (changed)
        update.detectionModes = updates;
    if (_getSetting(SETTING_BASIC_SIGHT_999) && tokenDoc.sight?.range !== 999)
        update["sight.range"] = 999;
    if (Object.keys(update).length > 0)
        tokenDoc.update(update);
}

window.lancerAutoVisionSetup = async function (activeSceneOnly = false)
{
    if (!game.user.isGM)
        return;
    const overrideSightRange = _getSetting(SETTING_BASIC_SIGHT_999);

    ui.notifications.info("Updating prototype token vision...");
    await Promise.all(game.actors.map(actor =>
    {
        const proto = actor.prototypeToken;
        const { updates, changed } = _augmentDetectionModes(proto?._source?.detectionModes ?? proto?.detectionModes);
        const update = {};
        if (changed)
            update["prototypeToken.detectionModes"] = updates;
        if (overrideSightRange && proto?.sight?.range !== 999)
            update["prototypeToken.sight.range"] = 999;
        if (Object.keys(update).length === 0)
            return null;
        return actor.update(update);
    }));

    ui.notifications.info("Updating placed token vision...");
    for (const scene of game.scenes)
    {
        if (activeSceneOnly && scene !== game.canvas.scene)
            continue;
        const updates = [];
        for (const tokenDoc of scene.tokens)
        {
            if (!tokenDoc.actor)
                continue;
            const { updates: detectionModeUpdates, changed } = _augmentDetectionModes(tokenDoc._source?.detectionModes ?? tokenDoc.detectionModes);
            const tokenUpdate = { _id: tokenDoc.id };
            let hasUpdates = false;
            if (changed)
            {
                tokenUpdate.detectionModes = detectionModeUpdates;
                hasUpdates = true;
            }
            if (overrideSightRange && tokenDoc.sight?.range !== 999)
            {
                tokenUpdate["sight.range"] = 999;
                hasUpdates = true;
            }
            if (hasUpdates)
                updates.push(tokenUpdate);
        }
        if (updates.length === 0)
            continue;
        try
        {
            await scene.updateEmbeddedDocuments("Token", updates);
        }
        catch (err)
        {
            console.warn(`lancer-automations | vision update failed in scene ${scene.name}`, err);
        }
    }
    ui.notifications.info("Token vision updated.");
};

export function initLancerDetectionModes()
{
    Hooks.once('init', () =>
    {
        _registerVisionSettings();
        CONFIG.Canvas.detectionModes.lancerAwareness = new DetectionModeLancerAwareness({
            id: 'lancerAwareness',
            label: 'Lancer: Battlefield Awareness',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerSensor = new DetectionModeLancerSensor({
            id: 'lancerSensor',
            label: 'Lancer: Sensors',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerLineOfSight = new DetectionModeLancerLineOfSight({
            id: 'lancerLineOfSight',
            label: 'Lancer: Line of Sight',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerLosShadow = new DetectionModeLancerLosShadow({
            id: 'lancerLosShadow',
            label: 'Lancer: Line of Sight (shadow)',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        _wrapPlainSightVeto(CONFIG.Canvas.detectionModes.basicSight);
        _wrapPlainSightVeto(CONFIG.Canvas.detectionModes.lightPerception);
    });
    Hooks.on('sightRefresh', () =>
    {
        _losInvalidate();
        _markOverlayDirty();
        _drawLosDebug();
    });
    Hooks.on('canvasTearDown', _losInvalidate);
    Hooks.on('createToken', _onCreateToken);
    Hooks.on('canvasReady', _installSilhouetteOverlayTicker);
    Hooks.on('canvasReady', _installLosDebug);
    Hooks.on('controlToken', _drawLosDebug);
    Hooks.on('refreshToken', _drawLosDebug);
    Hooks.on('controlToken', _markOverlayDirty);
    Hooks.on('updateToken', _markOverlayDirty);
    _patchRenderDetectionFilter();
}

// 3D occlusion gate on plain sight only; sensors/awareness intentionally detect without LOS.
function _wrapPlainSightVeto(mode)
{
    if (!mode || mode._laLosVeto)
        return;
    mode._laLosVeto = true;
    const original = mode._canDetect.bind(mode);
    mode._canDetect = (visionSource, target) =>
    {
        const result = original(visionSource, target);
        if (!result)
            return result;
        // The Lancer LOS and shadow modes own token detection, so basic vision never clips a token at a wall.
        if (_getSetting(SETTING_LOS) && target instanceof Token && target.document?.getFlag?.(MODULE_ID, 'awarenessMode') !== 'ignore')
            return false;
        return result;
    };
}

// Stock SilhouetteOutlineFilter breaks at scale<=1 and conflicts with our overlay; skip it.
function _patchRenderDetectionFilter()
{
    const proto = /** @type {any} */ (Token.prototype);
    const orig = proto._renderDetectionFilter;
    proto._renderDetectionFilter = function(renderer)
    {
        const filterName = this.detectionFilter?.constructor?.name;
        if (filterName === 'SilhouetteOutlineFilter')
            return;
        return orig.call(this, renderer);
    };
}

// Sprite-based silhouette overlay (bypasses PIXI filter pipeline FBO bug for scale<=1)

const _OVERLAY_NAME = 'lancer-silhouette-overlay';

const _SILH_VERT = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main() {
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`;

const _SILH_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 outlineColor;
uniform float time;
uniform vec2 thickness;
uniform float alphaThreshold;
uniform float simpleMode;
#define TWOPI 6.28318530718

void main(void) {
    vec4 ownColor = texture2D(uSampler, vTextureCoord);
    float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
    float maxAlpha = 0.0;
    for (float angle = 0.0; angle <= TWOPI; angle += 0.105) {
        vec2 displaced = vTextureCoord + vec2(thickness.x * cos(angle), thickness.y * sin(angle));
        vec4 c = texture2D(uSampler, clamp(displaced, vec2(0.001), vec2(0.999)));
        c.a = smoothstep(0.45, 0.8, c.a);
        maxAlpha = max(maxAlpha, c.a);
    }
    float resultAlpha = max(maxAlpha, texAlpha);
    if (simpleMode > 0.5) {
        vec2 toCenter = vTextureCoord - vec2(0.5);
        float pixelAngle = atan(toCenter.y, toCenter.x);
        float rotA = mod(time * 0.0015, TWOPI) - 3.14159;
        float rotB = mod(time * 0.0015 + 3.14159, TWOPI) - 3.14159;
        float dA = abs(pixelAngle - rotA); dA = min(dA, TWOPI - dA);
        float dB = abs(pixelAngle - rotB); dB = min(dB, TWOPI - dB);
        float rot = max(pow(smoothstep(1.2, 0.0, dA), 2.0), pow(smoothstep(1.2, 0.0, dB), 2.0));
        vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.35 + 0.85 * rot);
        gl_FragColor = vec4(outline * resultAlpha, (1.0 - texAlpha) * resultAlpha);
    } else {
        float scanY = mod(time * 0.0008, 1.0);
        float lineDist = abs(vTextureCoord.y - scanY);
        float scan = pow(smoothstep(0.005, 0.0, lineDist), 4.0);
        vec3 fill = outlineColor.rgb * scan * texAlpha;
        vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
        gl_FragColor = vec4((fill + outline) * resultAlpha, resultAlpha);
    }
}
`;

function _makeSilhouetteMesh(token, color)
{
    const tex = token.mesh?.texture;
    if (!tex)
        return null;
    const geometry = new PIXI.Geometry()
        .addAttribute('aVertexPosition', [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2)
        .addAttribute('aTextureCoord', [0, 0, 1, 0, 1, 1, 0, 1], 2)
        .addIndex([0, 1, 2, 0, 2, 3]);
    const program = PIXI.Program.from(_SILH_VERT, _SILH_FRAG);
    const shader = new PIXI.Shader(program, {
        uSampler: tex,
        outlineColor: color,
        time: 0,
        thickness: [0.04, 0.04],
        alphaThreshold: 0.6,
        simpleMode: 0
    });
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.name = _OVERLAY_NAME;
    mesh.zIndex = 500;
    return mesh;
}

function _syncOverlayTransform(mesh, token, simple)
{
    const tokenMesh = token.mesh;
    if (!tokenMesh)
        return;
    const meshWidth = tokenMesh.width || token.w;
    const meshHeight = tokenMesh.height || token.h;
    // mirror: tokenMesh.width/height are abs(); use the signed scale to mirror the overlay quad
    const mirrorX = Math.sign(tokenMesh.scale?.x ?? 1) || 1;
    const mirrorY = Math.sign(tokenMesh.scale?.y ?? 1) || 1;
    const anchorX = tokenMesh.anchor?.x ?? 0.5;
    const anchorY = tokenMesh.anchor?.y ?? 0.5;
    const localX = tokenMesh.position.x - token.position.x;
    const localY = tokenMesh.position.y - token.position.y;
    // anchor offset is in mesh-local space, so it flips with the sprite before rotation
    const anchorOffsetX = mirrorX * meshWidth * (0.5 - anchorX);
    const anchorOffsetY = mirrorY * meshHeight * (0.5 - anchorY);
    const rot = tokenMesh.rotation || 0;
    const cosRot = Math.cos(rot);
    const sinRot = Math.sin(rot);
    mesh.position.set(localX + cosRot * anchorOffsetX - sinRot * anchorOffsetY, localY + sinRot * anchorOffsetX + cosRot * anchorOffsetY);
    mesh.scale.set(mirrorX * meshWidth, mirrorY * meshHeight);
    mesh.rotation = rot;
    if (mesh.skew && tokenMesh.skew)
        mesh.skew.set(tokenMesh.skew.x ?? 0, tokenMesh.skew.y ?? 0);
    const stageScale = canvas.stage?.scale?.x ?? 1;
    const thicknessFactor = simple ? 0.1 : 0.35;
    const pulse = simple ? 1 : 0.75 + 0.5 * (Math.cos(performance.now() / 1500 * Math.PI * 2) * 0.5 + 0.5);
    mesh.shader.uniforms.thickness[0] = thicknessFactor * pulse * stageScale / meshWidth;
    mesh.shader.uniforms.thickness[1] = thicknessFactor * pulse * stageScale / meshHeight;
}

const _OVERLAY_COLOR = [1, 0.85, 0.15, 1];
const _OVERLAY_COLOR_SIMPLE = [1.0, 0.55, 0.15, 1.0];

function _getOverlayConfig(token)
{
    const filterName = token.detectionFilter?.constructor?.name;
    if (filterName !== 'SilhouetteOutlineFilter')
        return null;
    const mode = token.document?.getFlag?.(MODULE_ID, 'awarenessMode') ?? 'default';
    if (mode === 'ignore' || mode === 'visible')
        return null;
    const simple = mode === 'simple';
    return { color: simple ? _OVERLAY_COLOR_SIMPLE : _OVERLAY_COLOR, simple };
}

// Multiply tint that dims a token to a Foundry-shadow look while keeping its colours.
const _DIM_TINT = 0x999999;

// Dim rather than hide occluded tokens so sensor/awareness overlays still show.
function _isOccludedFromUser(token)
{
    if (!_getSetting(SETTING_LOS) || !token?.document)
        return false;
    const sources = canvas?.effects?.visionSources;
    if (!sources || !sources.size)
        return false;
    for (const source of sources.values())
    {
        const viewer = source.object;
        if (!viewer?.document || viewer === token)
            return false;
        if (lancerHasLineOfSight(viewer, token))
            return false;
    }
    return true;
}

function _applyOcclusionDim(token)
{
    if (!token.mesh)
        return;
    const dim = token.visible && _isOccludedFromUser(token);
    if (dim)
    {
        token._laDimmed = true;
        token.mesh.tint = _DIM_TINT;
    }
    else if (token._laDimmed)
    {
        token._laDimmed = false;
        token.mesh.tint = 0xffffff;
    }
}

// Occlusion + overlay set only change on vision changes: recompute on the dirty signal (plus a 500ms fallback) instead of running a per-token LOS raycast every frame.
const _overlayTokens = new Map();
let _overlayDirty = true;
let _lastOverlayRefresh = 0;

function _markOverlayDirty()
{
    _overlayDirty = true;
}

function _refreshOverlayState()
{
    _overlayDirty = false;
    _overlayTokens.clear();
    if (!canvas?.tokens?.placeables)
        return;
    for (const token of canvas.tokens.placeables)
    {
        _applyOcclusionDim(token);
        const overlayConfig = _getOverlayConfig(token);
        const existing = token.children.find(child => child.name === _OVERLAY_NAME);
        if (!overlayConfig)
        {
            if (existing)
                existing.destroy({ children: true });
            continue;
        }
        let mesh = existing;
        if (!mesh)
        {
            mesh = _makeSilhouetteMesh(token, overlayConfig.color);
            if (!mesh)
                continue;
            token.addChild(mesh);
            token.sortableChildren = true;
        }
        mesh.shader.uniforms.outlineColor = overlayConfig.color;
        mesh.shader.uniforms.simpleMode = overlayConfig.simple ? 1 : 0;
        if (mesh.shader.uniforms.uSampler !== token.mesh?.texture && token.mesh?.texture)
            mesh.shader.uniforms.uSampler = token.mesh.texture;
        _overlayTokens.set(token, overlayConfig.simple);
    }
}

function _tickSilhouetteOverlays()
{
    const now = performance.now();
    if (_overlayDirty || now - _lastOverlayRefresh > 500)
    {
        _refreshOverlayState();
        _lastOverlayRefresh = now;
    }
    if (!_overlayTokens.size)
        return;
    for (const [token, simple] of _overlayTokens)
    {
        const mesh = token.children?.find(child => child.name === _OVERLAY_NAME);
        if (!mesh || mesh.destroyed)
        {
            _overlayTokens.delete(token);
            continue;
        }
        if (token.targetArrows && token.targetArrows.zIndex < 600)
            token.targetArrows.zIndex = 600;
        if (token.targetPips && token.targetPips.zIndex < 600)
            token.targetPips.zIndex = 600;
        mesh.shader.uniforms.time = now;
        if (mesh.shader.uniforms.uSampler !== token.mesh?.texture && token.mesh?.texture)
            mesh.shader.uniforms.uSampler = token.mesh.texture;
        _syncOverlayTransform(mesh, token, simple);
    }
}

let _silhouetteTickerInstalled = false;
function _installSilhouetteOverlayTicker()
{
    _markOverlayDirty();
    if (_silhouetteTickerInstalled)
        return;
    canvas.app.ticker.add(_tickSilhouetteOverlays);
    _silhouetteTickerInstalled = true;
}
