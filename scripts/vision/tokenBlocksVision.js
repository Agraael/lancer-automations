/* global Hooks, game, canvas, CONST, foundry, PIXI, $ */

import { laLosFlagOnly } from './laWallLos.js';
import { invalidateLosCaches } from './lancerDetectionModes.js';
import { losEdgeCacheCurrent, replaceTokenSightRecords } from './losEngine.js';
import { _isMovementAnimating } from './visionFromEdge.js';
import { dragRefreshMs } from '../movement/vision-throttle.js';

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { laTokenHeight } from '../tools/token-height.js';
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';
const FLAG_KEY = 'blocksLineOfSight';
const LA_ONLY_FLAG_KEY = 'blocksLaLosOnly';
const EDGE_PREFIX = 'la-block-los';
// Id segment that keeps LA-only edges out of the vanilla basic-sight veto.
const LA_ONLY_MARK = 'laonly-';
const SETTING_BULWARK_BLOCKS = 'bulwarkBlocksLineOfSight';
// Scanning every canvas.edges key to find 6 edges cost O(all walls) per animation frame.
const _edgeIdsByToken = new Map();
const SETTING_THROTTLE_FPS = 'visionAnimationThrottleFps';
// Capped even when the vision throttle is off: the apply re-sweeps every light and vision source.
const ANIMATION_FALLBACK_FPS = 10;
const _lastApplyAt = new Map();
const _trailingApply = new Map();

function shouldTokenBlock(token)
{
    const doc = token?.document ?? token;
    if (!doc)
        return false;
    if (getLAFlag(doc,FLAG_KEY))
        return true;

    const actor = (doc.actor) ?? token.actor;

    if (actor?.statuses?.has?.('bulwark'))
    {
        return getModuleSetting(SETTING_BULWARK_BLOCKS) !== false;
    }

    return false;
}

function shouldTokenBlockLaOnly(token)
{
    const doc = token?.document ?? token;
    if (!getLAFlag(doc,LA_ONLY_FLAG_KEY))
        return false;
    // The full blocker covers LA too, no second set of edges needed.
    return !shouldTokenBlock(token);
}

function _tokenKey(token)
{
    return token?.id ?? token?.document?.id;
}

function _edgePrefix(token)
{
    return `${EDGE_PREFIX}-${_tokenKey(token)}-`;
}

function _hasEdges(token)
{
    if (!canvas?.edges)
        return false;
    return _edgeIdsByToken.has(_tokenKey(token));
}

export function isLosBlockerToken(token)
{
    return shouldTokenBlock(token) || shouldTokenBlockLaOnly(token) || _hasEdges(token);
}

function _removeEdges(token)
{
    const key = _tokenKey(token);
    const ids = _edgeIdsByToken.get(key);

    if (!ids)
        return;
    _edgeIdsByToken.delete(key);
    if (!canvas?.edges)
        return;
    for (const id of ids)
        canvas.edges.delete(id);
}

function getTokenElevationBounds(token)
{
    const doc = token.document ?? token;
    const elevation = doc.elevation ?? 0;

    let losTotal = token.losHeight;
    if (typeof losTotal !== 'number')
        losTotal = elevation + laTokenHeight(doc);

    // Sit 0.1 below LOS height so same-height tokens peek above.
    const top = Math.max(elevation + 0.01, losTotal - 0.1);
    return { bottom: elevation, top };
}

function _getEdgeSegments(token)
{
    const bounds = token.bounds;
    if (!bounds)
        return [];

    const shape = token.shape;

    if (shape instanceof PIXI.Polygon && shape.points?.length >= 6)
    {
        const pts = shape.points;
        const ptCount = pts.length;
        const last = (pts[ptCount - 2] === pts[0] && pts[ptCount - 1] === pts[1]) ? ptCount - 2 : ptCount;
        const segments = [];

        for (let ptIdx = 0; ptIdx < last; ptIdx += 2)
        {
            const nextPtIdx = (ptIdx + 2) % last;
            segments.push([
                { x: bounds.x + pts[ptIdx],     y: bounds.y + pts[ptIdx + 1] },
                { x: bounds.x + pts[nextPtIdx], y: bounds.y + pts[nextPtIdx + 1] }
            ]);
        }

        return segments;
    }

    return [
        [{ x: bounds.x,     y: bounds.y      }, { x: bounds.right, y: bounds.y      }],
        [{ x: bounds.right, y: bounds.y      }, { x: bounds.right, y: bounds.bottom }],
        [{ x: bounds.right, y: bounds.bottom }, { x: bounds.x,     y: bounds.bottom }],
        [{ x: bounds.x,     y: bounds.bottom }, { x: bounds.x,     y: bounds.y      }]
    ];
}

function _addEdges(token, laOnly = false)
{
    if (!canvas?.edges || !token)
        return;

    const segments = _getEdgeSegments(token);
    if (!segments.length)
        return;

    const prefix = _edgePrefix(token);
    const { top, bottom } = getTokenElevationBounds(token);
    // Wall Height's _testEdgeInclusion reads edge.object.document.flags['wall-height']; give it a stub.
    const wallStub = { document: { flags: { 'wall-height': { top, bottom } } } };
    const key = _tokenKey(token);
    const installed = _edgeIdsByToken.get(key) ?? [];

    for (let segIdx = 0; segIdx < segments.length; segIdx++)
    {
        const id = laOnly ? `${prefix}${LA_ONLY_MARK}${segIdx}` : `${prefix}${segIdx}`;

        const edge = new foundry.canvas.geometry.edges.Edge(segments[segIdx][0], segments[segIdx][1], {
            id,
            object: /** @type {any} */(wallStub),
            type: laOnly ? 'laSight' : 'wall',
            light: laOnly ? CONST.WALL_SENSE_TYPES.NONE : CONST.WALL_SENSE_TYPES.LIMITED,
            sight: CONST.WALL_SENSE_TYPES.LIMITED,
            sound: CONST.WALL_SENSE_TYPES.NONE,
            move: CONST.WALL_SENSE_TYPES.NONE
        });

        canvas.edges.set(id, edge);
        installed.push(id);
    }

    _edgeIdsByToken.set(key, installed);
}

function _installEdges(token)
{
    if (shouldTokenBlock(token))
    {
        _addEdges(token);
        // Flag-only mode drops plain walls from LA sweeps, so full blockers need a laSight twin.
        if (laLosFlagOnly())
            _addEdges(token, true);
    }
    else if (shouldTokenBlockLaOnly(token))
        _addEdges(token, true);
}

function _clearTrailing(key)
{
    const timer = _trailingApply.get(key);
    if (timer === undefined)
        return;
    globalThis.clearTimeout(timer);
    _trailingApply.delete(key);
}

function _tokenEdges(token)
{
    const ids = _edgeIdsByToken.get(_tokenKey(token)) ?? [];
    return ids.map(id => canvas.edges?.get(id)).filter(Boolean);
}

function _edgeBox(edges)
{
    if (!edges.length)
        return null;

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const edge of edges)
    {
        minX = Math.min(minX, edge.a.x, edge.b.x);
        minY = Math.min(minY, edge.a.y, edge.b.y);
        maxX = Math.max(maxX, edge.a.x, edge.b.x);
        maxY = Math.max(maxY, edge.a.y, edge.b.y);
    }

    return { minX: minX - 1, minY: minY - 1, maxX: maxX + 1, maxY: maxY + 1 };
}

function _recordEdgeIntersections(edges)
{
    if (!edges.length || !canvas?.edges)
        return;

    const order = new Map();
    let index = 0;
    for (const edge of canvas.edges.values())
        order.set(edge, index++);

    const before = (left, right) => ((left.nw.x - right.nw.x) || (left.se.x - right.se.x) || (order.get(left) - order.get(right))) < 0;
    const touched = new Set(edges);
    const done = new Set();

    for (const edge of edges)
    {
        for (const other of canvas.edges.values())
        {
            if (other === edge || done.has(other))
                continue;
            if (other.nw.x > edge.se.x || edge.nw.x > other.se.x)
                continue;

            const count = other.intersections.length;
            if (before(other, edge))
                other.recordIntersections(edge);
            else
                edge.recordIntersections(other);
            if (other.intersections.length !== count)
                touched.add(other);
        }

        done.add(edge);
    }

    const byOrder = (left, right) => (left.edge.nw.x - right.edge.nw.x) || (left.edge.se.x - right.edge.se.x) || (order.get(left.edge) - order.get(right.edge));

    for (const edge of touched)
    {
        if (edge.intersections.length > 1)
            edge.intersections.sort(byOrder);
    }
}

function _lightsNear(boxes)
{
    const effects = canvas.effects;
    const near = [];

    if (!boxes.length)
        return near;

    for (const source of [...(effects?.darknessSources ?? []), ...(effects?.lightSources ?? [])])
    {
        const radius = source.radius ?? source.data?.radius ?? 0;
        if (!Number.isFinite(radius) || radius <= 0)
            continue;

        const centerX = source.data?.x ?? 0;
        const centerY = source.data?.y ?? 0;

        if (boxes.some(box => centerX + radius >= box.minX && centerX - radius <= box.maxX && centerY + radius >= box.minY && centerY - radius <= box.maxY))
            near.push(source);
    }

    return near;
}

// refreshLighting/refreshVision only re-render: vision re-sweeps on initializeVision, lights near the walls re-sweep here.
function _applyToken(token)
{
    const cacheCurrent = losEdgeCacheCurrent();
    const oldEdges = _tokenEdges(token);
    for (const edge of oldEdges)
        edge.removeIntersections();
    _removeEdges(token);
    _installEdges(token);
    const newEdges = _tokenEdges(token);
    _recordEdgeIntersections(newEdges);
    if (!cacheCurrent || !replaceTokenSightRecords(_edgePrefix(token)))
        invalidateLosCaches();

    const lights = _lightsNear([_edgeBox(oldEdges), _edgeBox(newEdges)].filter(Boolean));

    if (lights.some(source => source.requiresEdges))
    {
        canvas.perception?.update?.({ refreshEdges: true, initializeLighting: true, initializeVision: true });
        return;
    }

    for (const source of lights)
        source.initialize();
    canvas.perception?.update?.({ initializeVision: true, refreshLighting: true, refreshVision: true });
}

function _throttleMs()
{
    const fps = Number(getModuleSetting(SETTING_THROTTLE_FPS)) || 0;
    return 1000 / (fps > 0 ? fps : ANIMATION_FALLBACK_FPS);
}

function _refreshToken(token)
{
    if (!token || !isLosBlockerToken(token))
        return;

    const key = _tokenKey(token);
    const throttleMs = token.isPreview ? dragRefreshMs() : (_isMovementAnimating(token) ? _throttleMs() : 0);

    if (throttleMs <= 0)
    {
        _clearTrailing(key);
        _lastApplyAt.delete(key);
        _applyToken(token);
        return;
    }

    const now = globalThis.performance.now();

    if ((now - (_lastApplyAt.get(key) ?? 0)) >= throttleMs)
    {
        _clearTrailing(key);
        _lastApplyAt.set(key, now);
        _applyToken(token);
        return;
    }

    // The last frame usually lands inside the window; without this the edges freeze a step behind.
    _clearTrailing(key);
    _trailingApply.set(key, globalThis.setTimeout(() =>
    {
        _trailingApply.delete(key);
        if (token.destroyed)
            return;
        _lastApplyAt.set(key, globalThis.performance.now());
        _applyToken(token);
    }, throttleMs * 1.5));
}

function _refreshAll()
{
    if (!canvas?.tokens)
        return;
    for (const key of [..._trailingApply.keys()])
        _clearTrailing(key);
    _lastApplyAt.clear();
    // Purge by bookkeeping, not by placeable: a token that left the scene still owns edges.
    for (const key of [..._edgeIdsByToken.keys()])
        _removeEdges({ id: key });
    for (const token of canvas.tokens.placeables)
        _installEdges(token);
    invalidateLosCaches();
    canvas.perception?.update?.({ refreshEdges: true, initializeLighting: true, initializeVision: true });
}

/** Rebuild every token's blocker edges, for LA LOS mode changes. */
export function refreshTokenBlockEdges()
{
    _refreshAll();
}

export function initTokenBlocksVision()
{
    game.settings.register(MODULE_ID, SETTING_BULWARK_BLOCKS, {
        name: 'LA.settings.bulwarkBlocksLineOfSight.name',
        hint: 'LA.settings.bulwarkBlocksLineOfSight.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => _refreshAll()
    });

    Hooks.on('canvasReady', () => _refreshAll());

    Hooks.on('createToken', (tokenDoc) =>
    {
        const token = canvas.tokens?.get(tokenDoc.id);
        if (token)
            _refreshToken(token);
    });

    Hooks.on('deleteToken', (tokenDoc) =>
    {
        _clearTrailing(tokenDoc.id);
        _lastApplyAt.delete(tokenDoc.id);
        if (!_edgeIdsByToken.has(tokenDoc.id))
            return;
        _removeEdges({ id: tokenDoc.id });
        invalidateLosCaches();
        canvas.perception?.update?.({ refreshEdges: true, initializeLighting: true, initializeVision: true });
    });

    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        const token = canvas.tokens?.get(tokenDoc.id);
        if (!token)
            return;

        const flagChanged = getLAFlags(change)?.[FLAG_KEY] !== undefined
            || getLAFlags(change)?.[LA_ONLY_FLAG_KEY] !== undefined;

        const heightFlagChanged = change?.flags?.['wall-height']?.tokenHeight !== undefined;
        const moved = ['x', 'y', 'width', 'height', 'elevation'].some(k => k in change);

        if (flagChanged || heightFlagChanged || moved)
            _refreshToken(token);
    });

    Hooks.on('refreshToken', (token, opts) =>
    {
        if (!opts?.refreshPosition && !opts?.refreshSize)
            return;
        _refreshToken(token);
    });

    // Bulwark status apply / remove
    Hooks.on('createActiveEffect', (effect) =>
    {
        if (!effect.statuses?.has?.('bulwark'))
            return;

        const actor = effect.parent;
        const token = actor?.getActiveTokens?.()?.[0];

        if (token)
            _refreshToken(token);
    });

    Hooks.on('deleteActiveEffect', (effect) =>
    {
        if (!effect.statuses?.has?.('bulwark'))
            return;

        const actor = effect.parent;
        const token = actor?.getActiveTokens?.()?.[0];

        if (token)
            _refreshToken(token);
    });
}
