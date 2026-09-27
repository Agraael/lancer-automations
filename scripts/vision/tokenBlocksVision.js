/* global Hooks, game, canvas, CONST, foundry, PIXI, $ */

import { laLosFlagOnly } from './laWallLos.js';
import { invalidateLosCaches } from './lancerDetectionModes.js';
import { _isMovementAnimating } from './visionFromEdge.js';

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { laTokenHeight } from '../tools/token-height.js';
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';
import { localize } from '../tools/string-utils.js';
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

// refreshLighting/refreshVision only re-render; the polygons re-sweep on the initialize flags.
function _applyToken(token)
{
    _removeEdges(token);
    _installEdges(token);
    invalidateLosCaches();
    canvas.perception?.update?.({ refreshEdges: true, initializeLighting: true, initializeVision: true });
}

function _throttleMs()
{
    const fps = Number(getModuleSetting(SETTING_THROTTLE_FPS)) || 0;
    return 1000 / (fps > 0 ? fps : ANIMATION_FALLBACK_FPS);
}

function _refreshToken(token)
{
    if (!token)
        return;
    const key = _tokenKey(token);
    if (!_isMovementAnimating(token))
    {
        _clearTrailing(key);
        _lastApplyAt.delete(key);
        _applyToken(token);
        return;
    }
    const throttleMs = _throttleMs();
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

function _onRenderTokenConfig(app, html)
{
    const $html = html instanceof jQuery ? html : $(html);
    const $visionTab = $html.find('.tab[data-tab="vision"]');
    if (!$visionTab.length)
        return;
    const tokenDoc = app.token ?? app.object ?? app.document;
    const checked = !!getLAFlag(tokenDoc,FLAG_KEY);
    const laOnlyChecked = !!getLAFlag(tokenDoc,LA_ONLY_FLAG_KEY);
    const block = `
        <hr/>
        <div class="form-group">
            <label data-tooltip="${localize('LA.vision.blocksLosTip')}">${localize('LA.vision.blocksLos')}</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_KEY}" ${checked ? 'checked' : ''}>
            </div>
        </div>
        <div class="form-group">
            <label data-tooltip="${localize('LA.vision.blocksLaLosOnlyTip')}">${localize('LA.vision.blocksLaLosOnly')}</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.${LA_ONLY_FLAG_KEY}" ${laOnlyChecked ? 'checked' : ''}>
            </div>
        </div>
    `;
    $visionTab.append(block);
    app.setPosition?.({ height: 'auto' });
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
        if (!shouldTokenBlock(token) && !shouldTokenBlockLaOnly(token) && !_hasEdges(token))
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

    Hooks.on('renderTokenConfig', _onRenderTokenConfig);
    Hooks.on('renderPrototypeTokenConfig', _onRenderTokenConfig);
}
