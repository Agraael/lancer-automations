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
import { getLAFlag } from '../tools/flag-utils.js';
const FLAG_KEY = 'visionFromEdge';
const SETTING_ENABLED = 'visionFromEdgeEnabled';
const SETTING_SAMPLE_OFFSET = 'visionFromEdgeSampleOffset';
const SOURCE_ID_PART = 'la-edge';
const WALL_STEP_INSIDE = 4;

export function isEdgeVisionEnabled(tokenDoc)
{
    const flag = getLAFlag(tokenDoc,FLAG_KEY);
    if (flag === 'on')
        return true;
    if (flag === 'off')
        return false;
    return getModuleSetting(SETTING_ENABLED) === true;
}

export function getEdgeSamplePoints(token)
{
    return _getSamplePoints(token);
}

// Convex token-shape corner samples, fixed 1px inside the outline, independent of the vision sample settings.
export function getShapeSamplePoints(token)
{
    const center = token.center;
    const hull = _convexShapeVertices(token, center, -1);

    if (!hull?.length)
        return null;
    return hull.map(point => _nudgePastWall(point, center, token));
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

    const hull = _convexShapeVertices(token, center, offset - 2);

    const samples = hull?.length ? hull : [
        { x: left, y: top },
        { x: right, y: top },
        { x: right, y: bottom },
        { x: left, y: bottom }
    ];

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

export function edgeSourceId(token, idx)
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

/**
 * Whether this token is mid movement animation.
 * @param {any} token
 * @returns {boolean} true while the token's movement animation context is live
 */
export function _isMovementAnimating(token)
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

function _onCanvasReady()
{
    if (getModuleSetting('visionFromEdgeDebug'))
    {
        /** @type {any} */ (globalThis).lancerVisionDebug?.show?.();
    }
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
        onChange: () => _refreshVision()
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

    game.settings.register(MODULE_ID, SETTING_SAMPLE_OFFSET, {
        name: 'LA.settings.visionFromEdgeSampleOffset.name',
        hint: 'LA.settings.visionFromEdgeSampleOffset.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: -50, max: 50, step: 1 },
        default: 0,
        onChange: () => _refreshVision()
    });

    Hooks.on('canvasReady', _onCanvasReady);
}
