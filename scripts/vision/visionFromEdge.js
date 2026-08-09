/* global canvas, game, Hooks, foundry, jQuery, $, libWrapper, PIXI */

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

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'visionFromEdge';
const SETTING_ENABLED = 'visionFromEdgeEnabled';
const SETTING_SAMPLE_MODE = 'visionFromEdgeSampleMode';
const SETTING_SAMPLE_OFFSET = 'visionFromEdgeSampleOffset';
const SOURCE_ID_PART = 'la-edge';

function _getVisionSourceClass()
{
    return foundry?.canvas?.sources?.PointVisionSource
        ?? globalThis.PointVisionSource
        ?? null;
}

function _isEdgeVisionEnabled(tokenDoc)
{
    const flag = tokenDoc?.getFlag?.(MODULE_ID, FLAG_KEY);
    if (flag === 'on')
        return true;
    if (flag === 'off')
        return false;
    return game.settings.get(MODULE_ID, SETTING_ENABLED) === true;
}

function _getSampleCount(tokenDoc)
{
    const mode = game.settings.get(MODULE_ID, SETTING_SAMPLE_MODE);
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

// Tangents touch a convex shape at a vertex, so reflex corners never shape the shadow.
function _convexShapeVertices(token, center, outset)
{
    const shapePoints = token.getShape?.()?.points;
    if (!shapePoints?.length)
        return null;
    const outline = [];
    for (let idx = 0; idx < shapePoints.length; idx += 2)
    {
        const vertX = shapePoints[idx] + token.x;
        const vertY = shapePoints[idx + 1] + token.y;
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
    let offset = 0;
    try
    {
        offset = Number(game.settings.get(MODULE_ID, SETTING_SAMPLE_OFFSET)) || 0;
    }
    catch
    {
        offset = 0;
    }
    const left = boxLeft - offset;
    const top = boxTop - offset;
    const right = boxRight + offset;
    const bottom = boxBottom + offset;
    const center = { x: centerX, y: centerY };

    if (game.settings.get(MODULE_ID, SETTING_SAMPLE_MODE) === 'silhouette')
    {
        const hull = _convexShapeVertices(token, center, offset - 2);
        if (hull?.length)
            return hull.map(point => _nudgePastWall(point, center, token));
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
    const elevation = tokenDoc.elevation ?? 0;
    const tokenHeight = tokenDoc.flags?.['wall-height']?.tokenHeight
        ?? tokenDoc.flags?.elevatedvision?.tokenHeight
        ?? 1;
    return elevation + tokenHeight;
}

function _edgeBlocksAtLOS(edge, losHeight)
{
    if ((edge.sight ?? 0) <= 0)
        return false;
    const flags = edge.object?.document?.flags?.['wall-height']
        ?? edge.object?.flags?.['wall-height']
        ?? {};
    const wallBottom = flags.bottom ?? Number.NEGATIVE_INFINITY;
    const wallTop = flags.top ?? Number.POSITIVE_INFINITY;
    return wallBottom <= losHeight && losHeight <= wallTop;
}

function _rayGrazesEnd(sample, edge, dirX, dirY, lenSq)
{
    const cornerTol = 1.5;
    for (const endPoint of [edge.a, edge.b])
    {
        const along = (((endPoint.x - sample.x) * dirX) + ((endPoint.y - sample.y) * dirY)) / lenSq;
        if (along <= 0 || along >= 1)
            continue;
        const projX = sample.x + (dirX * along);
        const projY = sample.y + (dirY * along);
        if (Math.hypot(endPoint.x - projX, endPoint.y - projY) <= cornerTol)
            return { x: endPoint.x, y: endPoint.y };
    }
    return null;
}

function _nudgePastWall(sample, center, token)
{
    if (!canvas?.edges || !token)
        return sample;
    const losHeight = getTokenVisionLOS(token);
    const dirX = center.x - sample.x;
    const dirY = center.y - sample.y;
    const lenSq = dirX * dirX + dirY * dirY;
    if (lenSq === 0)
        return sample;

    const ownPrefix = `la-block-los-${token.id}-`;
    let lastHit = null;
    let lastAlong = -Infinity;
    for (const edge of canvas.edges.values())
    {
        if (edge.type !== 'wall')
            continue;
        if (edge.id?.startsWith(ownPrefix))
            continue;
        if (!_edgeBlocksAtLOS(edge, losHeight))
            continue;
        let hit = foundry.utils.lineSegmentIntersects(sample, center, edge.a, edge.b)
            ? foundry.utils.lineLineIntersection(sample, center, edge.a, edge.b)
            : null;
        if (!hit)
            hit = _rayGrazesEnd(sample, edge, dirX, dirY, lenSq);
        if (!hit)
            continue;
        const along = ((hit.x - sample.x) * dirX + (hit.y - sample.y) * dirY) / lenSq;
        if (along > lastAlong)
        {
            lastAlong = along;
            lastHit = hit;
        }
    }
    if (!lastHit)
        return sample;
    const dist = Math.sqrt(lenSq);
    const stepInside = 4;
    return {
        x: lastHit.x + (dirX / dist) * stepInside,
        y: lastHit.y + (dirY / dist) * stepInside
    };
}

function _edgeSourceId(token, idx)
{
    return `${token.sourceId}.${SOURCE_ID_PART}.${idx}`;
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

function _buildEdgeSources(token)
{
    if (!canvas?.effects?.visionSources || !token?.document)
        return false;
    _destroyEdgeSources(token);

    if (!token.document.sight?.enabled)
        return false;
    if (!token.vision || token.vision.disabled)
        return false;
    if (!_isEdgeVisionEnabled(token.document))
        return false;

    const SourceClass = _getVisionSourceClass();
    if (!SourceClass)
        return false;

    let primaryData;
    try
    {
        primaryData = token._getVisionSourceData();
    }
    catch (err)
    {
        return false;
    }
    if (!primaryData)
        return false;

    const samples = _getSamplePoints(token);
    let added = false;
    samples.forEach((point, idx) =>
    {
        const sourceId = _edgeSourceId(token, idx);
        try
        {
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
            const source = new SourceClass({ sourceId, object: objectStandIn });
            const halfSize = primaryData.externalRadius ?? 0;
            const clipRadius = primaryData.radius ?? 0;
            if (clipRadius > 0)
                source._laEdgeClipCircle = new PIXI.Circle(primaryData.x, primaryData.y, clipRadius);
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
                canvas.effects.visionSources.set(sourceId, source);
            added = true;
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | edge vision source ${idx} for token ${token.id} failed to initialize:`, err);
        }
    });
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
    if (change?.flags?.[MODULE_ID]?.[FLAG_KEY] !== undefined)
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
    if (game.settings.get(MODULE_ID, 'visionFromEdgeDebug'))
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
    const current = tokenDoc?.getFlag?.(MODULE_ID, FLAG_KEY);
    const selected = current === 'on' ? 'on' : current === 'off' ? 'off' : 'default';

    const block = `
        <hr/>
        <div class="form-group">
            <label data-tooltip="Vision computed from the token's perimeter (Lancer LOS-style) so larger tokens can peek around corners. 'Default' follows the world setting.">Vision From Edge</label>
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
        name: 'Vision From Edge',
        hint: 'Compute vision from the token perimeter so large tokens can peek around corners.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, 'visionFromEdgeDebug', {
        name: 'Vision From Edge: Debug Overlay',
        hint: 'Draw the perimeter sample points on the canvas.',
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
        name: 'Vision From Edge: Sample Offset (px)',
        hint: 'Distance of the sample points from the token edge. Positive outsets, negative insets.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: -50, max: 50, step: 1 },
        default: 0,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, SETTING_SAMPLE_MODE, {
        name: 'Vision From Edge: Sample Density',
        hint: 'Vision sample points per token, one sweep each. Token shape corners follows the real outline. Adaptive uses 8 for size 3+, else 4.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            corners4: '4 (corners only)',
            perimeter8: '8 (corners + edge midpoints)',
            perimeter16: '16 (dense perimeter)',
            silhouette: 'Token shape corners',
            adaptive: 'Adaptive (recommended)'
        },
        default: 'adaptive',
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
