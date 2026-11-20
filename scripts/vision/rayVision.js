import { MODULE_ID, LOS_TARGET_ABOVE } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlags } from '../tools/flag-utils.js';
import { getHexCenter, pixelToOffset } from '../combat/grid-helpers.js';
import { getHexGroundElevation } from '../combat/terrain-utils.js';
import { dragRefreshMs } from '../movement/vision-throttle.js';
import { lancerSightEdgeRecords } from './lancerDetectionModes.js';
import { edgeSourceId, getEdgeSamplePoints, getShapeSamplePoints, getTokenVisionLOS, isEdgeVisionEnabled, _isMovementAnimating } from './visionFromEdge.js';

const SETTING_SHADOWS = 'lancerLosTrigShadows';
const SETTING_QUALITY = 'lancerLosTrigShadowQuality';
const SETTING_ANIMATION_FPS = 'visionAnimationThrottleFps';
const EDGE_SOURCE_PART = '.la-edge.';
const RAYS = 480;
const REFINE_STEPS = 6;
const QUALITY_CELLS = { low: 10, medium: 7, high: 5, ultra: 3 };
const RASTER = 5;
const BLUR = 3;

let _workers = null;
let _workersFailed = false;
let _ground = null;
let _groundVersion = 0;
let _layer = null;
let _shadeTextures = [];
let _shadeDrawn = false;
let _jobCounter = 0;
let _lastRecords = null;
let _recordsVersion = 0;
const _entries = new Map();
const _parkedSources = new Map();
const _shade = { result: null, inFlight: null, sentState: null, lastSent: -Infinity, timer: null };

function _shadowsEnabled()
{
    return getModuleSetting(SETTING_SHADOWS) === true
        && getModuleSetting('lancerLos') === true
        && getModuleSetting('lancerLosHeightRule') === 'trig'
        && canvas?.grid?.type !== CONST.GRID_TYPES.GRIDLESS;
}

function _tokenEye(token)
{
    return token.losHeight ?? getTokenVisionLOS(token);
}

function _tokenKey(token)
{
    return token.isPreview ? `${token.document.id}:preview` : token.document.id;
}

function _ensureWorkers()
{
    if (_workers || _workersFailed)
        return _workers;

    try
    {
        const url = new URL('./rayVisionWorker.js', import.meta.url);
        _workers = { shade: new Worker(url, { type: 'module' }), vision: new Worker(url, { type: 'module' }) };
    }
    catch (err)
    {
        console.error(`${MODULE_ID} | ray vision workers failed to start`, err);
        _workersFailed = true;
        _workers = null;
        return null;
    }

    for (const worker of Object.values(_workers))
    {
        worker.onmessage = _handleResult;

        worker.onerror = (event) =>
        {
            console.error(`${MODULE_ID} | ray vision worker error`, event.message ?? event);
            _workersFailed = true;
            _reset();
            _refresh();
        };
    }

    _ground = null;
    return _workers;
}

function _ensureGround()
{
    const sceneKey = `${canvas.scene?.id}:${canvas.grid.size}:${_groundVersion}`;
    if (_ground?.sceneKey === sceneKey)
        return _ground;

    const rect = canvas.dimensions.sceneRect;
    const topLeft = pixelToOffset(rect.x, rect.y);
    const bottomRight = pixelToOffset(rect.x + rect.width, rect.y + rect.height);
    const groundByKey = new Map();

    for (let row = Math.min(topLeft.row, bottomRight.row) - 1; row <= Math.max(topLeft.row, bottomRight.row) + 1; row++)
    {
        for (let col = Math.min(topLeft.col, bottomRight.col) - 1; col <= Math.max(topLeft.col, bottomRight.col) + 1; col++)
        {
            const center = getHexCenter(col, row);
            if (center.x < rect.x || center.x > rect.x + rect.width || center.y < rect.y || center.y > rect.y + rect.height)
                continue;
            groundByKey.set(`${col},${row}`, getHexGroundElevation(col, row, undefined, { solidTokens: false }) ?? 0);
        }
    }

    let minGround = Infinity;
    for (const ground of groundByKey.values())
        minGround = Math.min(minGround, ground);
    if (minGround === Infinity)
        minGround = 0;

    const rasterColumns = Math.ceil(rect.width / RASTER);
    const rasterRows = Math.ceil(rect.height / RASTER);
    const cellGround = new Float64Array(rasterColumns * rasterRows);

    for (let row = 0; row < rasterRows; row++)
    {
        for (let column = 0; column < rasterColumns; column++)
        {
            const offset = pixelToOffset(rect.x + ((column + 0.5) * RASTER), rect.y + ((row + 0.5) * RASTER));
            cellGround[(row * rasterColumns) + column] = groundByKey.get(`${offset.col},${offset.row}`) ?? 0;
        }
    }

    const cell = QUALITY_CELLS[getModuleSetting(SETTING_QUALITY)] ?? QUALITY_CELLS.high;

    _workers.shade.postMessage({
        type: 'scene',
        rays: RAYS,
        refineSteps: REFINE_STEPS,
        cell,
        ramp: cell,
        limit: Math.max(canvas.grid.size / 2, cell),
        step: canvas.grid.size / 2,
        targetAbove: LOS_TARGET_ABOVE,
        minGround,
        rectX: rect.x,
        rectY: rect.y,
        rectWidth: rect.width,
        rectHeight: rect.height,
        rasterSize: RASTER,
        rasterColumns,
        rasterRows,
        ground: cellGround,
    }, [cellGround.buffer]);
    _ground = { sceneKey, minGround, rect };
    return _ground;
}

function _shadeViewer(token)
{
    const eyeHeight = _tokenEye(token);
    const skip = `la-block-los-${token.document.id}-`;

    const walls = lancerSightEdgeRecords().filter(record => !record.id.startsWith(skip) && Number.isFinite(record.top)
        && record.top < eyeHeight && record.top > _ground.minGround + LOS_TARGET_ABOVE - 1e-9);

    const packed = new Float64Array(walls.length * 6);
    walls.forEach((record, index) =>
    {
        packed.set([record.edge.a.x, record.edge.a.y, record.edge.b.x, record.edge.b.y, record.bottom, record.top], index * 6);
    });

    const size = token.document.getSize?.() ?? { width: token.w, height: token.h };
    const center = { x: token.document.x + (size.width / 2), y: token.document.y + (size.height / 2) };
    const points = [center, ...(getShapeSamplePoints(token) ?? [])];
    const origins = new Float64Array(points.length * 2);

    points.forEach((point, index) =>
    {
        origins[index * 2] = point.x;
        origins[(index * 2) + 1] = point.y;
    });
    
    const radius = token.vision?.radius ?? 0;
    return {
        eyeHeight,
        maxDistance: radius > 0 && radius < canvas.dimensions.maxR ? radius : Math.hypot(_ground.rect.width, _ground.rect.height),
        reachPad: Math.max(token.w ?? 0, token.h ?? 0),
        centerX: center.x,
        centerY: center.y,
        walls: packed,
        origins,
    };
}

function _visionJob(token)
{
    const source = token.vision;
    const baseConfig = source._getPolygonConfiguration();
    const PolygonClass = /** @type {any} */ (CONFIG.Canvas.polygonBackends.sight);
    const directionModes = foundry.canvas.geometry.PointSourcePolygon.WALL_DIRECTION_MODES;

    const [lead, second] = [{ x: 0, y: 0 }, { x: 1, y: 1 }].map((shift) =>
    {
        const polygon = new PolygonClass();
        polygon.initialize({ x: source.data.x + shift.x, y: source.data.y + shift.y }, { ...baseConfig, wallDirectionMode: directionModes.BOTH, useThreshold: false, boundaryShapes: [] });
        return polygon;
    });

    const edges = canvas.edges.getEdges(lead.config.boundingBox, {
        includeOuterBounds: !lead.useInnerBounds,
        includeInnerBounds: lead.useInnerBounds,
        collisionTest: (/** @type {any} */ edge) => lead._testEdgeInclusion(edge, lead.config.edgeTypes)
            || (edge.orientPoint(lead.origin) === CONST.WALL_DIRECTIONS.BOTH && second._testEdgeInclusion(edge, second.config.edgeTypes)),
    });

    const packed = new Float64Array(edges.size * 8);
    const crossings = [];
    let index = 0;

    for (const edge of edges)
    {
        packed.set([edge.a.x, edge.a.y, edge.b.x, edge.b.y, edge.sight === CONST.WALL_SENSE_TYPES.LIMITED ? 1 : 0, edge.direction ?? 0, edge.sight ?? 0, edge.threshold?.sight ?? 0], index * 8);
        index++;

        for (const crossing of edge.intersections ?? [])
        {
            if (edges.has(crossing.edge) && String(edge.id) < String(crossing.edge.id))
                crossings.push(crossing.intersection.x, crossing.intersection.y);
        }
    }

    const samples = (getEdgeSamplePoints(token) ?? []).map(point => ({ x: point.x, y: point.y }));
    const viewpoints = new Float64Array(samples.length * 2);
    samples.forEach((point, sampleIndex) =>
    {
        viewpoints[sampleIndex * 2] = point.x;
        viewpoints[(sampleIndex * 2) + 1] = point.y;
    });

    const data = source.data;
    const halfSize = data.externalRadius ?? 0;
    return {
        job: {
            edges: packed,
            points: new Float64Array(crossings),
            viewpoints,
            wallDirectionMode: baseConfig.wallDirectionMode ?? directionModes.NORMAL,
            centerX: data.x,
            centerY: data.y,
            sightRadius: data.radius ?? 0,
            lightRadius: Math.max(0, (data.lightRadius ?? 0) - halfSize),
            fullLightRadius: data.lightRadius ?? 0,
            maxR: canvas.dimensions.maxR,
            grid: canvas.grid.size,
            fillGaps: (data.angle ?? 360) >= 360,
        },
        samples,
    };
}

function _attachLayer()
{
    const vision = canvas.visibility?.vision;
    if (!vision)
        return null;
    if (_layer?.parent === vision)
        return _layer;
    _layer = new PIXI.Container();
    const blur = canvas.createBlurFilter(BLUR);
    blur.blendMode = PIXI.BLEND_MODES.ERASE;
    _layer.filters = [blur];
    vision.addChild(_layer);
    return _layer;
}

function _clearShade()
{
    if (_layer && !_layer.destroyed)
    {
        for (const child of _layer.removeChildren())
            child.destroy();
    }

    for (const texture of _shadeTextures)
        texture.destroy(true);
    _shadeTextures = [];
}

function _drawShade()
{
    _clearShade();
    const result = _shade.result;
    _shadeDrawn = !!result?.shaded;
    const layer = _shadeDrawn ? _attachLayer() : null;

    if (layer)
    {
        const texture = PIXI.Texture.fromBuffer(result.alphaData, result.columns, result.rows, { scaleMode: PIXI.SCALE_MODES.LINEAR });
        _shadeTextures.push(texture);
        const sprite = new PIXI.Sprite(texture);
        sprite.position.set(result.originX, result.originY);
        sprite.scale.set(result.cell);
        layer.addChild(sprite);
    }

    const visionMask = /** @type {any} */ (canvas.masks)?.vision;
    if (visionMask)
        visionMask.renderDirty = true;
}

function _polygonFrom(source, points)
{
    const PolygonClass = /** @type {any} */ (CONFIG.Canvas.polygonBackends.sight);
    const polygon = new PolygonClass();
    polygon.initialize(source.origin, source._getPolygonConfiguration());
    polygon.points = Array.from(points);
    polygon.bounds = polygon.getBounds();
    return polygon;
}

function _shapesFromWorker()
{
    const source = /** @type {any} */ (this);
    if (source.data.angle < 360)
        return /** @type {any} */ (foundry.canvas.sources.PointVisionSource.prototype)._createShapes.call(source);
    source._updateVisionMode();
    const shapes = source._laRayShapes;
    const { x, y, radius, lightRadius, externalRadius } = source.data;
    source.los = _polygonFrom(source, shapes.sight);
    const sightRadius = source.radius || externalRadius;
    source.shape = sightRadius === radius ? source.los : source.los.applyConstraint(new PIXI.Circle(x, y, sightRadius));
    if (lightRadius > 0 && source.lightRadius === lightRadius)
        source.light = shapes.light ? _polygonFrom(source, shapes.light) : source.los;
    else
        source.light = source.los.applyConstraint(new PIXI.Circle(x, y, source.lightRadius));
}

function _withoutSoftEdges()
{
    this._flags.renderSoftEdges = false;
}

function _parkEdgeSources(entry, fromIndex = 0)
{
    const sources = canvas.effects?.visionSources;
    let parked = false;

    for (let index = fromIndex; index < entry.sourceCount; index++)
    {
        const sourceId = edgeSourceId(entry.token, index);
        const source = sources?.get(sourceId);

        if (!source)
            continue;
        sources.delete(sourceId);
        _parkedSources.set(sourceId, source);
        parked = true;
    }

    entry.sourceCount = Math.min(entry.sourceCount, fromIndex);
    return parked;
}

function _applyEdgeSources(entry, polygons)
{
    const token = entry.token;
    if (!token || token.destroyed || !token.vision)
        return;

    const sources = canvas.effects.visionSources;
    const primaryData = token._getVisionSourceData();
    const halfSize = primaryData.externalRadius ?? 0;
    polygons.forEach((polygon, index) =>
    {
        const point = polygon.pivot ?? entry.pendingSamples[index];
        const sourceId = edgeSourceId(token, index);
        let source = sources.get(sourceId) ?? _parkedSources.get(sourceId);
        _parkedSources.delete(sourceId);

        if (!source)
        {
            const holder = { token, bounds: new PIXI.Rectangle(point.x - 1, point.y - 1, 2, 2) };

            const standIn = new Proxy(token, {
                get(target, prop)
                {
                    if (prop === 'shape')
                        return null;
                    if (prop === 'bounds')
                        return holder.bounds;
                    return Reflect.get(holder.token, prop, holder.token);
                },
            });

            source = new foundry.canvas.sources.PointVisionSource({ sourceId, object: standIn });
            source._laRayHolder = holder;
            source._createShapes = _shapesFromWorker;
            source._initializeSoftEdges = _withoutSoftEdges;
        }

        source._laRayHolder.token = token;
        source._laRayHolder.bounds.x = point.x - 1;
        source._laRayHolder.bounds.y = point.y - 1;
        source._laRayShapes = polygon;
        source.initialize({
            ...primaryData,
            x: point.x,
            y: point.y,
            disabled: false,
            externalRadius: 1,
            radius: polygon.seesSight === false ? 0 : Math.max(0, (primaryData.radius ?? 0) - halfSize),
            lightRadius: polygon.seesLight === false ? 0 : Math.max(0, (primaryData.lightRadius ?? 0) - halfSize),
        });
        source.add();
    });

    const previousCount = entry.sourceCount;
    entry.sourceCount = Math.max(previousCount, polygons.length);
    if (previousCount > polygons.length)
        _parkEdgeSources(entry, polygons.length);
}

function _destroyEdgeSources()
{
    const sources = canvas.effects?.visionSources;

    for (const [sourceId, source] of [...(sources?.entries() ?? [])])
    {
        if (!sourceId.includes(EDGE_SOURCE_PART))
            continue;
        sources.delete(sourceId);
        source.destroy?.();
    }

    for (const source of _parkedSources.values())
        source.destroy?.();
    _parkedSources.clear();
}

function _visionTokens()
{
    const tokens = [];

    for (const source of canvas.effects?.visionSources ?? [])
    {
        if (!source.active || String(source.sourceId).includes(EDGE_SOURCE_PART))
            continue;

        const token = source.object;
        if (!(token instanceof foundry.canvas.placeables.Token) || !token.document || token.destroyed || token.vision !== source)
            continue;
        tokens.push(token);
    }

    return tokens;
}

function _intervalFor(token)
{
    if (token.isPreview)
        return dragRefreshMs();

    if (_isMovementAnimating(token))
    {
        const fps = Number(getModuleSetting(SETTING_ANIMATION_FPS)) || 0;
        return fps > 0 ? 1000 / fps : 0;
    }

    return 0;
}

function _sendJob(entry, state)
{
    const workers = _ensureWorkers();
    if (!workers)
        return;

    const id = ++_jobCounter;
    const built = _visionJob(entry.token);
    entry.pendingSamples = built.samples;
    workers.vision.postMessage({ type: 'job', id, viewer: entry.key, part: 'vision', vision: built.job }, [built.job.edges.buffer, built.job.points.buffer, built.job.viewpoints.buffer]);
    entry.inFlight = id;
    entry.sentState = state;
    entry.lastSent = performance.now();
}

function _sendShade(viewers, state)
{
    const workers = _ensureWorkers();
    if (!workers)
        return;

    _ensureGround();
    const id = ++_jobCounter;
    const jobs = viewers.map(token => _shadeViewer(token));
    workers.shade.postMessage({ type: 'job', id, viewer: 'shade', part: 'shade', shade: { viewers: jobs } }, jobs.flatMap(job => [job.walls.buffer, job.origins.buffer]));
    _shade.inFlight = id;
    _shade.sentState = state;
    _shade.lastSent = performance.now();
}

function _syncShade(viewers)
{
    if (!viewers.length)
    {
        if (_shade.timer)
            clearTimeout(_shade.timer);
        _shade.timer = null;
        _shade.inFlight = null;
        _shade.sentState = null;

        if (_shade.result)
        {
            _shade.result = null;
            _drawShade();
        }

        return;
    }

    const state = viewers.map(token => `${Math.round(token.document.x)}:${Math.round(token.document.y)}:${_tokenEye(token)}:${token.vision?.radius ?? 0}`).join('|')
        + `:${_recordsVersion}:${canvas.edges.size}:${_groundVersion}`;

    if (_shade.inFlight || _shade.sentState === state)
        return;

    const wait = _shade.lastSent + Math.max(...viewers.map(token => _intervalFor(token))) - performance.now();

    if (wait > 0)
    {
        _shade.timer ??= setTimeout(() =>
        {
            _shade.timer = null;
            _sync();
        }, wait);
        return;
    }

    _sendShade(viewers, state);
}

function _sync()
{
    if (!canvas?.ready || _workersFailed)
        return;

    const records = lancerSightEdgeRecords();

    if (records !== _lastRecords)
    {
        _lastRecords = records;
        _recordsVersion++;
    }

    const tokens = _visionTokens();
    const previewIds = new Set(tokens.filter(token => token.isPreview).map(token => token.document.id));
    const shadeViewers = _shadowsEnabled() ? tokens.filter(token => token.isPreview || !previewIds.has(token.document.id)) : [];
    const sampleSettings = `${getModuleSetting('visionFromEdgeSampleOffset')}`;
    const live = new Set();
    let edgesRemoved = false;

    for (const token of tokens)
    {
        const key = _tokenKey(token);
        live.add(key);
        let entry = _entries.get(key);

        if (!entry)
        {
            entry = { key, token, wantsEdges: false, sourceCount: 0, pendingSamples: [], inFlight: null, sentState: null, lastSent: -Infinity, timer: null };
            _entries.set(key, entry);
        }

        entry.token = token;
        entry.wantsEdges = isEdgeVisionEnabled(token.document);

        if (!entry.wantsEdges && entry.sourceCount)
            edgesRemoved = _parkEdgeSources(entry) || edgesRemoved;

        if (!entry.wantsEdges)
        {
            entry.sentState = null;
            continue;
        }

        const data = token.vision.data;
        const visionKey = [data.radius, data.lightRadius, data.angle, data.angle < 360 ? data.rotation : 0, data.visionMode, data.color, data.contrast, data.saturation, data.brightness, data.attenuation].join(':');

        const state = `${Math.round(token.document.x)}:${Math.round(token.document.y)}:${_tokenEye(token)}:${visionKey}`
            + `:${_recordsVersion}:${canvas.edges.size}:${sampleSettings}`;

        if (entry.inFlight || entry.sentState === state)
            continue;

        const wait = entry.lastSent + _intervalFor(token) - performance.now();

        if (wait > 0)
        {
            entry.timer ??= setTimeout(() =>
            {
                entry.timer = null;
                _sync();
            }, wait);
            continue;
        }

        _sendJob(entry, state);
    }

    for (const [key, entry] of _entries.entries())
    {
        if (live.has(key))
            continue;
        if (entry.timer)
            clearTimeout(entry.timer);
        edgesRemoved = _parkEdgeSources(entry) || edgesRemoved;
        _entries.delete(key);
    }

    _syncShade(shadeViewers);

    if (edgesRemoved)
        canvas.perception.update({ refreshVision: true, refreshLighting: true });
}

function _handleResult(event)
{
    const message = event.data;

    if (message.part === 'shade')
    {
        if (_shade.inFlight !== message.id)
            return;
        _shade.inFlight = null;

        if (message.type === 'failed')
            console.error(`${MODULE_ID} | ray vision shade job failed`, message.error);
        else
        {
            _shade.result = message.shade;
            _drawShade();
        }

        _sync();
        return;
    }

    const entry = _entries.get(message.viewer);

    if (!entry || entry.inFlight !== message.id)
        return;
    entry.inFlight = null;

    if (message.type === 'failed')
        console.error(`${MODULE_ID} | ray vision ${message.part} job failed`, message.error);
    else if (message.vision && entry.wantsEdges)
    {
        _applyEdgeSources(entry, message.vision.polygons);

        if (canvas.visibility?.tokenVision)
        {
            canvas.effects.refreshLighting();
            canvas.visibility.refresh();
        }
    }

    _sync();
}

function _reset()
{
    for (const entry of _entries.values())
    {
        if (entry.timer)
            clearTimeout(entry.timer);
    }

    if (_shade.timer)
        clearTimeout(_shade.timer);

    Object.assign(_shade, { result: null, inFlight: null, sentState: null, lastSent: -Infinity, timer: null });
    _entries.clear();
    _clearShade();
    _destroyEdgeSources();
    _layer = null;
    _shadeDrawn = false;
    _ground = null;
    _lastRecords = null;
}

function _refresh()
{
    canvas?.perception?.update({ refreshVision: true, refreshLighting: true });
}

export function initRayVision()
{
    game.settings.register(MODULE_ID, SETTING_SHADOWS, {
        name: 'LA.settings.lancerLosTrigShadows.name',
        hint: 'LA.settings.lancerLosTrigShadows.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: _refresh
    });

    game.settings.register(MODULE_ID, SETTING_QUALITY, {
        name: 'LA.settings.lancerLosTrigShadowQuality.name',
        hint: 'LA.settings.lancerLosTrigShadowQuality.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            low: 'LA.settings.lancerLosTrigShadowQuality.choices.low',
            medium: 'LA.settings.lancerLosTrigShadowQuality.choices.medium',
            high: 'LA.settings.lancerLosTrigShadowQuality.choices.high',
            ultra: 'LA.settings.lancerLosTrigShadowQuality.choices.ultra'
        },
        default: 'high',
        onChange: () =>
        {
            _groundVersion++;
            _refresh();
        }
    });

    Hooks.on('visibilityRefresh', _sync);
    Hooks.on('canvasTearDown', _reset);
    Hooks.on('terrain-height-tools.updateTerrain', () =>
    {
        _groundVersion++;
        if (_shadowsEnabled())
            _refresh();
    });
    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        if (getLAFlags(change)?.visionFromEdge !== undefined)
            _refresh();
    });

    Hooks.once('setup', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;
        libWrapper.register(MODULE_ID, 'foundry.canvas.groups.CanvasVisibility.prototype.needsContainment', function (wrapped)
        {
            return wrapped() || _shadeDrawn;
        }, 'WRAPPER');
    });
}
