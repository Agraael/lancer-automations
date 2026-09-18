/* global canvas, game, Hooks, foundry, jQuery, $, libWrapper, PIXI, CONFIG */
/*
   Lancer-style vision: see from the token's perimeter, not its center.
   Foundry's default polygon originates at the center, so a 4x4 mech can't
   peek around a corner that its body already pokes past. Fix: spawn extra
   PointVisionSource instances along the token's edges; Foundry unions all
   registered sources, so the rendered vision is "see from any sample".

       *----*----*       C  --->|--- *
       |         |              wall  ^ source nudged to here
       *    C    *
       |         |       Per sample, raycast C -> sample. If a sight wall
       *----*----*       blocks, the source goes 4 px past the hit toward
                         C, so it sits inside the same wall enclosure as
                         the token's center (no leak through flush walls).

*/

import { laSightEdgeOptions } from './laWallLos.js';

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { laTokenHeight } from '../tools/token-height.js';
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';
import { localize } from '../tools/string-utils.js';
const FLAG_KEY = 'visionFromEdge';
const SETTING_ENABLED = 'visionFromEdgeEnabled';
const SETTING_SAMPLE_MODE = 'visionFromEdgeSampleMode';
const SETTING_SAMPLE_OFFSET = 'visionFromEdgeSampleOffset';
const SETTING_DEFER_DRAG = 'visionFromEdgeDeferDrag';
const SETTING_THROTTLE_FPS = 'visionAnimationThrottleFps';
const SOURCE_ID_PART = 'la-edge';
const WALL_STEP_INSIDE = 4;
const REST_DELAY_MIN_MS = 50;
const ARRIVAL_DELAY_MS = 50;

function _getVisionSourceClass()
{
    return foundry?.canvas?.sources?.PointVisionSource
        ?? globalThis.PointVisionSource
        ?? null;
}

function _isEdgeVisionEnabled(tokenDoc)
{
    const flag = getLAFlag(tokenDoc,FLAG_KEY);
    if (flag === 'on')
        return true;
    if (flag === 'off')
        return false;
    return getModuleSetting(SETTING_ENABLED) === true;
}

function _getSampleCount(tokenDoc)
{
    const mode = getModuleSetting(SETTING_SAMPLE_MODE);
    if (mode === 'corners4')
        return 4;
    if (mode === 'perimeter8')
        return 8;
    if (mode === 'perimeter16')
        return 16;
    const tokenWidth = tokenDoc?.width ?? 1;
    const tokenHeight = tokenDoc?.height ?? 1;
    return (tokenWidth >= 3 || tokenHeight >= 3) ? 8 : 4;
}

export function getEdgeSamplePoints(token)
{
    return _getSamplePoints(token);
}

// Upper bound on what a position-keyed sweep cache could skip. Counts only, caches nothing.
let _sweepProbe = null;

function _countSweep(source)
{
    const data = source?.data;
    if (!data)
        return;
    const key = `${Math.round(data.x)},${Math.round(data.y)},${Math.round(data.radius ?? 0)}`
        + `,${Math.round(data.externalRadius ?? 0)},${data.angle ?? 360},${data.rotation ?? 0}`
        + `,${Math.round((data.elevation ?? 0) * 100)},${source.constructor?.name ?? '?'}`;
    _sweepProbe.requests++;
    const seen = _sweepProbe.keys.get(key);
    if (seen === undefined)
        _sweepProbe.keys.set(key, { count: 1, sourceId: source.sourceId ?? '?', walls: canvas?.edges?.size ?? 0 });
    else
    {
        _sweepProbe.hits++;
        seen.count++;
        if (seen.walls !== (canvas?.edges?.size ?? 0))
            seen.wallsChanged = true;
        if (!seen.via)
        {
            seen.via = (new Error().stack ?? '').split('\n').slice(2, 10)
                .map(line => line.trim().replace(/^at\s+/, '').replace(/\s*\(.*$/, ''))
                .filter(name => name && !name.startsWith('http'))
                .join(' < ');
        }
    }
};

globalThis.lancerSweepProbe = (on = true) =>
{
    _sweepProbe = on ? { requests: 0, hits: 0, keys: new Map() } : null;
    console.log(`${MODULE_ID} | sweep probe ${on ? 'armed, now drag and drop' : 'off'}`);
    return null;
};

globalThis.lancerSweepProbeDump = () =>
{
    if (!_sweepProbe)
    {
        console.warn(`${MODULE_ID} | run lancerSweepProbe() first`);
        return null;
    }
    const { requests, hits, keys } = _sweepProbe;
    const entries = [...keys.entries()].filter(([, info]) => info.count > 1)
        .sort((left, right) => right[1].count - left[1].count);
    console.log(`${MODULE_ID} | sweep probe | requests ${requests} | distinct geometries ${keys.size}`
        + ` | repeatable ${hits} (${requests ? (100 * hits / requests).toFixed(1) : 0}%)`
        + ` | geometries seen more than once ${entries.length}`);
    console.log(entries.slice(0, 8).map(([, info]) =>
        `${info.count}x  ${info.sourceId}${info.wallsChanged ? '  WALLS CHANGED' : ''}\n      via ${info.via ?? '?'}`).join('\n'));
    return { requests, distinct: keys.size, hits, top: entries.slice(0, 12).map(([, info]) => info) };
};

// Diagnostics: everything the edge sources are built from, so a preview and the real token can be diffed.
let _watchPreview = false;
let _lastPreviewSnapshot = null;

function _visionSnapshot(token)
{
    const doc = token.document;
    let samples = null;
    try
    {
        samples = _getSamplePoints(token).map(point => `${Math.round(point.x)},${Math.round(point.y)}`).join(' | ');
    }
    catch (err)
    {
        samples = `failed: ${err.message}`;
    }
    return {
        isPreview: !!token.isPreview,
        sourceId: token.sourceId,
        doc: `${Math.round(doc.x)},${Math.round(doc.y)} elev ${doc.elevation ?? 0} size ${doc.width}x${doc.height}`,
        placeable: `${Math.round(token.x)},${Math.round(token.y)}`,
        center: `${Math.round(token.center.x)},${Math.round(token.center.y)}`,
        eyeHeight: getTokenVisionLOS(token),
        edgeVisionEnabled: _isEdgeVisionEnabled(doc),
        sightEnabled: !!doc.sight?.enabled,
        visionDisabled: token.vision?.disabled ?? null,
        sampleMode: getModuleSetting(SETTING_SAMPLE_MODE),
        samples,
        edgeSourceCount: [...(canvas?.effects?.visionSources?.keys() ?? [])].filter(id => id.includes(SOURCE_ID_PART)).length,
        visionSourceIds: [...(canvas?.effects?.visionSources?.keys() ?? [])].join(' | ')
    };
}

globalThis.lancerVisionSnapshot = () =>
{
    const token = (canvas?.tokens?.preview?.children ?? [])[0] ?? canvas?.tokens?.controlled?.[0];
    if (!token)
    {
        console.warn(`${MODULE_ID} | drag or select a token first`);
        return null;
    }
    const snapshot = _visionSnapshot(token);
    console.log(`${MODULE_ID} | vision snapshot\n` + JSON.stringify(snapshot, null, 1));
    return snapshot;
};

globalThis.lancerVisionWatch = (on = true) =>
{
    _watchPreview = on;
    _lastPreviewSnapshot = null;
    console.log(`${MODULE_ID} | preview vision capture ${on ? 'armed, now drag and drop' : 'off'}`);
};

globalThis.lancerVisionCompare = () =>
{
    const token = canvas?.tokens?.controlled?.[0];
    if (!_lastPreviewSnapshot)
    {
        console.warn(`${MODULE_ID} | no preview captured; run lancerVisionWatch() then drag`);
        return null;
    }
    if (!token)
    {
        console.warn(`${MODULE_ID} | select the dropped token first`);
        return null;
    }
    const after = _visionSnapshot(token);
    const diff = {};
    for (const key of Object.keys(after))
    {
        if (String(_lastPreviewSnapshot[key]) !== String(after[key]))
            diff[key] = { preview: _lastPreviewSnapshot[key], real: after[key] };
    }
    console.log(`${MODULE_ID} | preview vs real | ${Object.keys(diff).length} field(s) differ\n` + JSON.stringify(diff, null, 1));
    return { preview: _lastPreviewSnapshot, real: after, diff };
};

// Convex token-shape corner samples, fixed 1px inside the outline, independent of the vision sample settings.
export function getShapeSamplePoints(token)
{
    const center = token.center;
    const hull = _convexShapeVertices(token, center, -1);
    if (!hull?.length)
        return null;
    return hull.map(point => _nudgePastWall(point, center, token));
}

function _withMidpoints(points)
{
    const doubled = [];
    for (let idx = 0; idx < points.length; idx++)
    {
        const current = points[idx];
        const next = points[(idx + 1) % points.length];
        doubled.push(current, { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 });
    }
    return doubled;
}

// Tangents touch a convex shape at a vertex, so reflex corners never shape the shadow.
function _convexShapeVertices(token, center, outset)
{
    const shapePoints = token.getShape?.()?.points;
    if (!shapePoints?.length)
        return null;
    const outline = [];
    // Document, not the placeable: a preview or animating token has not moved its PIXI position yet,
    // which would put the hull a cell behind the centre these samples are measured from.
    const shapeOriginX = token.document?.x ?? token.x;
    const shapeOriginY = token.document?.y ?? token.y;
    for (let idx = 0; idx < shapePoints.length; idx += 2)
    {
        const vertX = shapePoints[idx] + shapeOriginX;
        const vertY = shapePoints[idx + 1] + shapeOriginY;
        const lastPt = outline.at(-1);
        if (lastPt && Math.abs(lastPt.x - vertX) < 0.01 && Math.abs(lastPt.y - vertY) < 0.01)
            continue;
        outline.push({ x: vertX, y: vertY });
    }
    const firstPt = outline[0];
    const finalPt = outline.at(-1);
    if (outline.length > 1 && firstPt && finalPt
        && Math.abs(firstPt.x - finalPt.x) < 0.01 && Math.abs(firstPt.y - finalPt.y) < 0.01)
        outline.pop();
    if (outline.length < 3)
        return null;

    let signedArea = 0;
    for (let idx = 0; idx < outline.length; idx++)
    {
        const curPt = outline[idx];
        const nextPt = outline[(idx + 1) % outline.length];
        signedArea += (curPt.x * nextPt.y) - (nextPt.x * curPt.y);
    }
    const winding = Math.sign(signedArea);

    const samples = [];
    for (let idx = 0; idx < outline.length; idx++)
    {
        const prevPt = outline[(idx - 1 + outline.length) % outline.length];
        const curPt = outline[idx];
        const nextPt = outline[(idx + 1) % outline.length];
        const cross = ((curPt.x - prevPt.x) * (nextPt.y - curPt.y)) - ((curPt.y - prevPt.y) * (nextPt.x - curPt.x));
        if (cross === 0 || Math.sign(cross) !== winding)
            continue;
        const dirX = curPt.x - center.x;
        const dirY = curPt.y - center.y;
        const dist = Math.hypot(dirX, dirY) || 1;
        samples.push({ x: curPt.x + (dirX / dist) * outset, y: curPt.y + (dirY / dist) * outset });
    }
    return samples;
}

function _getSamplePoints(token)
{
    const tokenDoc = token.document;
    const count = _getSampleCount(tokenDoc);
    // v13 deprecated Token#getSize in favor of TokenDocument#getSize.
    const size = tokenDoc.getSize?.() ?? token.getSize?.() ?? { width: token.w, height: token.h };
    const boxLeft = tokenDoc.x;
    const boxTop = tokenDoc.y;
    const boxRight = boxLeft + size.width;
    const boxBottom = boxTop + size.height;
    const centerX = boxLeft + size.width / 2;
    const centerY = boxTop + size.height / 2;
    const offset = Number(getModuleSetting(SETTING_SAMPLE_OFFSET)) || 0;
    const left = boxLeft - offset;
    const top = boxTop - offset;
    const right = boxRight + offset;
    const bottom = boxBottom + offset;
    const center = { x: centerX, y: centerY };

    const mode = getModuleSetting(SETTING_SAMPLE_MODE);
    if (mode === 'silhouette' || mode === 'silhouette2')
    {
        const hull = _convexShapeVertices(token, center, offset - 2);
        if (hull?.length)
        {
            const points = mode === 'silhouette2' ? _withMidpoints(hull) : hull;
            return points.map(point => _nudgePastWall(point, center, token));
        }
    }

    const samples = [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom }
    ];
    if (count > 4)
    {
        samples.push(
            { x: centerX, y: top },
            { x: right, y: centerY },
            { x: centerX, y: bottom },
            { x: left, y: centerY }
        );
    }
    if (count > 8)
    {
        const quarterX = boxLeft + size.width * 0.25;
        const threeQuarterX = boxLeft + size.width * 0.75;
        const quarterY = boxTop + size.height * 0.25;
        const threeQuarterY = boxTop + size.height * 0.75;
        samples.push(
            { x: quarterX, y: top },
            { x: threeQuarterX, y: top },
            { x: right, y: quarterY },
            { x: right, y: threeQuarterY },
            { x: quarterX, y: bottom },
            { x: threeQuarterX, y: bottom },
            { x: left, y: quarterY },
            { x: left, y: threeQuarterY }
        );
    }
    return samples.map(point => _nudgePastWall(point, center, token));
}

export function getTokenVisionLOS(token)
{
    const tokenDoc = token.document;
    return (tokenDoc.elevation ?? 0) + laTokenHeight(tokenDoc);
}

// Collide up to the offset: cast center -> sample, land at the sample or just short of the first wall.
function _nudgePastWall(sample, center, token)
{
    if (!canvas?.edges || !token)
        return sample;
    const losHeight = getTokenVisionLOS(token);
    let hit = null;
    try
    {
        hit = CONFIG.Canvas.polygonBackends.sight.testCollision(
            { x: center.x, y: center.y, elevation: losHeight },
            { x: sample.x, y: sample.y, elevation: losHeight },
            {
                type: 'sight',
                mode: 'closest',
                edgeOptions: laSightEdgeOptions(),
                source: { object: { b: losHeight, t: losHeight } },
                b: losHeight,
                t: losHeight
            }
        );
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | sample collision test failed:`, err);
        return sample;
    }
    if (!hit)
        return sample;
    const spanX = hit.x - center.x;
    const spanY = hit.y - center.y;
    const dist = Math.hypot(spanX, spanY);
    if (!dist)
        return sample;
    const stopAt = Math.max(0, dist - WALL_STEP_INSIDE) / dist;
    return { x: center.x + (spanX * stopAt), y: center.y + (spanY * stopAt) };
}
function _edgeSourceId(token, idx)
{
    return `${token.sourceId}.${SOURCE_ID_PART}.${idx}`;
}

/**
 * The token's own vision source plus the per-edge sources this module spawns for it.
 * Together they cover the Lancer rule of seeing from any point of your own space.
 * @param {any} token
 * @returns {any[]} live vision sources, empty when the token has no vision
 */
export function getTokenVisionSources(token)
{
    const sources = [];
    if (token?.vision && !token.vision.disabled)
        sources.push(token.vision);
    if (!canvas?.effects?.visionSources || !token?.sourceId)
        return sources;
    const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
    for (const [id, source] of canvas.effects.visionSources.entries())
    {
        if (id.startsWith(prefix) && source && !source.disabled)
            sources.push(source);
    }
    return sources;
}

function _destroyEdgeSources(token)
{
    if (!canvas?.effects?.visionSources)
        return false;
    const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
    let removed = false;
    for (const id of [...canvas.effects.visionSources.keys()])
    {
        if (id.startsWith(prefix))
        {
            const source = canvas.effects.visionSources.get(id);
            try
            {
                source?.destroy?.();
            }
            catch (err)
            {
                // ignore
            }
            canvas.effects.visionSources.delete(id);
            removed = true;
        }
    }
    return removed;
}

let _restBuildRunning = false;
const _restTimersBySource = new Map();

function _restDelay(token)
{
    if (!token.isPreview)
        return ARRIVAL_DELAY_MS;
    const fps = Number(getModuleSetting(SETTING_THROTTLE_FPS)) || 0;
    return fps > 0 ? Math.max(REST_DELAY_MIN_MS, (1000 / fps) * 1.5) : REST_DELAY_MIN_MS;
}

function _isMovementAnimating(token)
{
    return token.animationContexts?.has(token.movementAnimationName) === true;
}

/**
 * Whether any token is mid drag or mid movement animation.
 * @returns {boolean} true while a drag preview exists or a token animates its movement
 */
export function isAnyTokenMoving()
{
    if (canvas?.tokens?.preview?.children?.length)
        return true;
    for (const token of canvas?.tokens?.placeables ?? [])
    {
        if (_isMovementAnimating(token))
            return true;
    }
    return false;
}

function _armRestBuild(token)
{
    const sourceId = token.sourceId;
    const pendingTimer = _restTimersBySource.get(sourceId);
    if (pendingTimer !== undefined)
        globalThis.clearTimeout(pendingTimer);
    _restTimersBySource.set(sourceId, globalThis.setTimeout(() =>
    {
        _restTimersBySource.delete(sourceId);
        if (token.destroyed)
            return;
        // The last animation frame still holds its context, so wait the move out instead of building into it.
        if (_isMovementAnimating(token))
        {
            _armRestBuild(token);
            return;
        }
        _restBuildRunning = true;
        try
        {
            if (_buildEdgeSources(token))
                canvas?.perception?.update({ refreshVision: true, refreshLighting: true });
        }
        finally
        {
            _restBuildRunning = false;
        }
    }, _restDelay(token)));
}

// A preview reruns one sweep per sample on every cell and the move animation does the same per frame,
// so hold them until the token stops.
function _deferWhileMoving(token)
{
    if (_restBuildRunning)
        return false;
    if (!token.isPreview && !_isMovementAnimating(token))
        return false;
    if (getModuleSetting(SETTING_DEFER_DRAG) !== true)
        return false;
    _armRestBuild(token);
    return true;
}

function _buildEdgeSources(token)
{
    if (!canvas?.effects?.visionSources || !token?.document)
        return false;
    if (_deferWhileMoving(token))
        return _destroyEdgeSources(token);

    const SourceClass = _getVisionSourceClass();
    let primaryData = null;
    if (token.document.sight?.enabled && token.vision && !token.vision.disabled && _isEdgeVisionEnabled(token.document) && SourceClass)
    {
        try
        {
            primaryData = token._getVisionSourceData();
        }
        catch (err)
        {
            primaryData = null;
        }
    }
    if (!primaryData)
    {
        _destroyEdgeSources(token);
        return false;
    }

    const samples = _getSamplePoints(token);
    const sources = canvas.effects.visionSources;
    const keep = new Set();
    let added = false;
    samples.forEach((point, idx) =>
    {
        const sourceId = _edgeSourceId(token, idx);
        try
        {
            let source = sources.get(sourceId);
            // A reused source keeps its shaders and meshes, only the sweep reruns. A redrawn token gets new ones.
            if (source?._laEdgeToken !== token)
            {
                source?.destroy?.();
                sources.delete(sourceId);
                // Lie about shape/bounds so Foundry's sweep filters don't
                // claim the whole token footprint as "self area".
                const tinyBounds = new PIXI.Rectangle(point.x - 1, point.y - 1, 2, 2);
                const objectStandIn = new Proxy(token, {
                    get(target, prop)
                    {
                        if (prop === 'shape')
                            return null;
                        if (prop === 'bounds')
                            return tinyBounds;
                        return Reflect.get(target, prop, target);
                    }
                });
                source = new SourceClass({ sourceId, object: objectStandIn });
                source._laEdgeToken = token;
                source._laEdgeBounds = tinyBounds;
            }
            else
            {
                source._laEdgeBounds.x = point.x - 1;
                source._laEdgeBounds.y = point.y - 1;
            }
            const halfSize = primaryData.externalRadius ?? 0;
            const clipRadius = primaryData.radius ?? 0;
            source._laEdgeClipCircle = clipRadius > 0 ? new PIXI.Circle(primaryData.x, primaryData.y, clipRadius) : null;
            source.initialize({
                ...primaryData,
                x: point.x,
                y: point.y,
                disabled: false,
                externalRadius: 1,
                radius: Math.max(0, (primaryData.radius ?? 0) - halfSize),
                lightRadius: Math.max(0, (primaryData.lightRadius ?? 0) - halfSize)
            });
            if (typeof source.add === 'function')
                source.add();
            else
                sources.set(sourceId, source);
            keep.add(sourceId);
            added = true;
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | edge vision source ${idx} for token ${token.id} failed to initialize:`, err);
        }
    });
    // The sample count can shrink on a mode change.
    const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
    for (const id of sources.keys())
    {
        if (!id.startsWith(prefix) || keep.has(id))
            continue;
        try
        {
            sources.get(id)?.destroy?.();
        }
        catch (err)
        {
            // ignore
        }
        sources.delete(id);
    }
    if (_watchPreview && token.isPreview)
        _lastPreviewSnapshot = _visionSnapshot(token);
    return added;
}

let _pendingRefresh = false;
function _refreshVision()
{
    if (!canvas?.perception)
        return;
    if (_pendingRefresh)
        return;
    _pendingRefresh = true;
    requestAnimationFrame(() =>
    {
        _pendingRefresh = false;
        if (canvas?.perception)
            canvas.perception.update({ refreshVision: true });
    });
}

function _isVisionRelevantChange(change)
{
    if (!change)
        return false;
    if (['x', 'y', 'width', 'height', 'shape', 'rotation', 'elevation', 'sight'].some(key => key in change))
        return true;
    if (getLAFlags(change)?.[FLAG_KEY] !== undefined)
        return true;
    return false;
}

function _rebuildAll()
{
    if (!canvas?.tokens)
        return;
    let changed = false;
    for (const token of canvas.tokens.placeables)
    {
        if (_buildEdgeSources(token))
            changed = true;
        else if (_destroyEdgeSources(token))
            changed = true;
    }
    if (changed)
        _refreshVision();
}

function _onUpdateToken(tokenDoc, change)
{
    if (!_isVisionRelevantChange(change))
        return;
    const token = tokenDoc.object;
    if (!token)
        return;
    _buildEdgeSources(token);
    _refreshVision();
}

function _onCreateToken(tokenDoc)
{
    const token = tokenDoc.object;
    if (!token)
        return;
    if (_buildEdgeSources(token))
        _refreshVision();
}

function _onDeleteToken(tokenDoc)
{
    const token = tokenDoc.object;
    if (!token)
        return;
    if (_destroyEdgeSources(token))
        _refreshVision();
}

function _onCanvasReady()
{
    _rebuildAll();
    if (getModuleSetting('visionFromEdgeDebug'))
    {
        /** @type {any} */ (globalThis).lancerVisionDebug?.show?.();
    }
}

function _cleanOrphanEdgeSources()
{
    if (!canvas?.effects?.visionSources)
        return;
    const validSourceIds = new Set((canvas.tokens?.placeables ?? []).map(token => token.sourceId));
    const marker = `.${SOURCE_ID_PART}.`;
    let changed = false;
    for (const id of [...canvas.effects.visionSources.keys()])
    {
        const markerIdx = id.indexOf(marker);
        if (markerIdx === -1)
            continue;
        const baseSourceId = id.slice(0, markerIdx);
        if (validSourceIds.has(baseSourceId))
            continue;
        const source = canvas.effects.visionSources.get(id);
        try
        {
            source?.destroy?.();
        }
        catch (err)
        {
            // ignore
        }
        canvas.effects.visionSources.delete(id);
        changed = true;
    }
    if (changed)
        _refreshVision();
}

function _onControlToken(token)
{
    try
    {
        _buildEdgeSources(token);
        _refreshVision();
    }
    catch (err)
    {
        // ignore
    }
}

function _onRenderTokenConfig(app, html)
{
    const $html = (typeof jQuery !== 'undefined' && html instanceof jQuery) ? html : $(html);
    const $visionTab = $html.find('.tab[data-tab="vision"]');
    if (!$visionTab.length)
        return;

    const tokenDoc = app.token ?? app.object ?? app.document;
    const current = getLAFlag(tokenDoc,FLAG_KEY);
    const selected = current === 'on' ? 'on' : current === 'off' ? 'off' : 'default';

    const block = `
        <hr/>
        <div class="form-group">
            <label data-tooltip="${localize('LA.vision.fromEdgeTip')}">${localize('LA.vision.fromEdge')}</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.${FLAG_KEY}">
                    <option value="default" ${selected === 'default' ? 'selected' : ''}>Default (world setting)</option>
                    <option value="on" ${selected === 'on' ? 'selected' : ''}>On</option>
                    <option value="off" ${selected === 'off' ? 'selected' : ''}>Off</option>
                </select>
            </div>
        </div>
    `;
    $visionTab.append(block);
    app.setPosition?.({ height: 'auto' });
}

let _debugContainer = null;
let _debugHookIds = [];

function _drawDebugMarkers()
{
    if (!_debugContainer)
        return;
    for (const child of _debugContainer.removeChildren())
        child.destroy();
    const colors = [0xff0000, 0x00ff00, 0x3366ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8000, 0x8000ff];
    for (const token of canvas.tokens?.controlled ?? [])
    {
        const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
        const center = token.center;
        let idx = 0;
        for (const [id, source] of canvas.effects.visionSources.entries())
        {
            if (!id.startsWith(prefix))
                continue;
            const color = colors[idx % colors.length];
            const marker = new PIXI.Graphics();
            marker.lineStyle(2, color, 0.6).moveTo(center.x, center.y).lineTo(source.data.x, source.data.y);
            marker.beginFill(color, 0.9).lineStyle(0).drawCircle(source.data.x, source.data.y, 8).endFill();
            _debugContainer.addChild(marker);
            idx++;
        }
    }
}

window.lancerVisionDebug = {
    show()
    {
        if (_debugContainer)
        {
            _drawDebugMarkers();
            return;
        }
        _debugContainer = new PIXI.Container();
        canvas.controls.addChild(_debugContainer);
        const events = ['controlToken', 'updateToken', 'refreshToken', 'sightRefresh', 'canvasReady'];
        _debugHookIds = events.map(name => ({ name, id: Hooks.on(name, _drawDebugMarkers) }));
        _drawDebugMarkers();
    },
    hide()
    {
        if (!_debugContainer)
            return;
        for (const hook of _debugHookIds)
            Hooks.off(hook.name, hook.id);
        _debugHookIds = [];
        _debugContainer.destroy({ children: true });
        _debugContainer = null;
    },
    refresh: _drawDebugMarkers
};

export function initVisionFromEdge()
{
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: 'LA.settings.visionFromEdgeEnabled.name',
        hint: 'LA.settings.visionFromEdgeEnabled.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, 'visionFromEdgeDebug', {
        name: 'LA.settings.visionFromEdgeDebug.name',
        hint: 'LA.settings.visionFromEdgeDebug.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: (enabled) =>
        {
            const debugApi = /** @type {any} */ (globalThis).lancerVisionDebug;
            if (enabled)
                debugApi?.show?.();
            else
                debugApi?.hide?.();
        }
    });

    game.settings.register(MODULE_ID, SETTING_DEFER_DRAG, {
        name: 'LA.settings.visionFromEdgeDeferDrag.name',
        hint: 'LA.settings.visionFromEdgeDeferDrag.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, SETTING_SAMPLE_OFFSET, {
        name: 'LA.settings.visionFromEdgeSampleOffset.name',
        hint: 'LA.settings.visionFromEdgeSampleOffset.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: -50, max: 50, step: 1 },
        default: 0,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, SETTING_SAMPLE_MODE, {
        name: 'LA.settings.visionFromEdgeSampleMode.name',
        hint: 'LA.settings.visionFromEdgeSampleMode.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            corners4: 'LA.settings.visionFromEdgeSampleMode.choices.corners4',
            perimeter8: 'LA.settings.visionFromEdgeSampleMode.choices.perimeter8',
            perimeter16: 'LA.settings.visionFromEdgeSampleMode.choices.perimeter16',
            silhouette: 'LA.settings.visionFromEdgeSampleMode.choices.silhouette',
            silhouette2: 'LA.settings.visionFromEdgeSampleMode.choices.silhouette2',
            adaptive: 'LA.settings.visionFromEdgeSampleMode.choices.adaptive'
        },
        default: 'silhouette',
        onChange: () => _rebuildAll()
    });

    Hooks.on('canvasReady', _onCanvasReady);
    Hooks.on('createToken', _onCreateToken);
    Hooks.on('updateToken', _onUpdateToken);
    Hooks.on('deleteToken', _onDeleteToken);
    Hooks.on('controlToken', _onControlToken);
    Hooks.on('renderTokenConfig', _onRenderTokenConfig);
    Hooks.on('closeTokenConfig', _cleanOrphanEdgeSources);

    // Wraps the per-token vision init so edges resync during animation,
    // control changes, and document updates.
    Hooks.once('ready', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;
        libWrapper.register(MODULE_ID, 'Token.prototype.initializeVisionSource', function (wrapped, ...args)
        {
            const result = wrapped(...args);
            try
            {
                const opts = args[0] ?? {};
                if (opts.deleted)
                    _destroyEdgeSources(this);
                else
                    _buildEdgeSources(this);
            }
            catch (err)
            {
                // ignore
            }
            return result;
        }, 'WRAPPER');

        const VisionSourceClass = _getVisionSourceClass();
        if (VisionSourceClass?.prototype?._createShapes)
        {
            libWrapper.register(MODULE_ID, 'foundry.canvas.sources.PointVisionSource.prototype._createShapes', function (wrapped, ...args)
            {
                if (_sweepProbe)
                    _countSweep(this);
                wrapped(...args);
                const clip = this._laEdgeClipCircle;
                if (!clip || !this.los?.applyConstraint)
                    return;
                try
                {
                    const clipped = this.los.applyConstraint(clip);
                    this.shape = clipped;
                    this.los = clipped;
                }
                catch (err)
                {
                    // ignore
                }
            }, 'WRAPPER');
        }
    });
}
