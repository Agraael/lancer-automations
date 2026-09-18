// Trig height rule for the rendered sweep. Wall Height drops every wall the eye clears, so a sweep can only
// block a low wall whole or not at all: it is put back when its shadow on a target runs past the peek range or the map edge.

import { getTokenVisionLOS } from './visionFromEdge.js';
import { lancerSightEdgeRecords } from './lancerDetectionModes.js';

import { MODULE_ID, LOS_TARGET_ABOVE } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';

const SETTING_LOS = 'lancerLos';
const SETTING_HEIGHT_RULE = 'lancerLosHeightRule';
const SETTING_PEEK_RANGE = 'lancerLosPeekRange';

function _peekConfig(poly)
{
    const type = poly.config?.type;
    if (type !== 'sight' && type !== 'light')
        return null;
    if (getModuleSetting(SETTING_LOS) !== true || getModuleSetting(SETTING_HEIGHT_RULE) !== 'trig')
        return null;
    const range = Number(getModuleSetting(SETTING_PEEK_RANGE)) || 0;
    if (range <= 0)
        return null;
    const sourceObject = poly.config?.source?.object;
    if (!(sourceObject instanceof foundry.canvas.placeables.Token) || !sourceObject.document)
        return null;
    const eye = sourceObject.losHeight ?? getTokenVisionLOS(sourceObject);
    if (!Number.isFinite(eye))
        return null;
    // Fog only: a wall above the waist is leaned over, no band. The pulse keeps the exact rule.
    const elevation = sourceObject.document.elevation ?? 0;
    const waist = elevation + ((eye - elevation) / 2);
    return { sourceObject, eye, waist, rangePixels: range * canvas.grid.size };
}

// Ask the real pipeline with the eye dropped into the wall's own band, so the height filter is the only
// rule that changes answer and every other exclusion still counts.
function _includedAtWallHeight(poly, edge, edgeTypes, peek, wallTop)
{
    const object = peek.sourceObject;
    const savedBottom = object.b;
    const savedTop = object.t;
    object.b = object.t = wallTop;
    try
    {
        return poly._testEdgeInclusion(edge, edgeTypes);
    }
    finally
    {
        object.b = savedBottom;
        object.t = savedTop;
    }
}

function _mapEdgeDistance(origin, dirX, dirY)
{
    const rect = canvas.dimensions.sceneRect;
    let nearest = Infinity;
    if (dirX > 0)
        nearest = Math.min(nearest, (rect.x + rect.width - origin.x) / dirX);
    else if (dirX < 0)
        nearest = Math.min(nearest, (rect.x - origin.x) / dirX);
    if (dirY > 0)
        nearest = Math.min(nearest, (rect.y + rect.height - origin.y) / dirY);
    else if (dirY < 0)
        nearest = Math.min(nearest, (rect.y - origin.y) / dirY);
    return nearest;
}

function _blocksBeyondPeek(poly, record, edgeTypes, peek)
{
    const top = record.top;
    if (!Number.isFinite(top) || top > peek.waist)
        return false;
    // the wall's foot is the ground a target behind it stands on
    const target = (Number.isFinite(record.bottom) ? Math.max(0, record.bottom) : 0) + LOS_TARGET_ABOVE;
    if (target >= top)
        return false;
    const closest = foundry.utils.closestPointToSegment(poly.origin, record.edge.a, record.edge.b);
    const dx = closest.x - poly.origin.x;
    const dy = closest.y - poly.origin.y;
    const distance = Math.hypot(dx, dy);
    if (!distance)
        return false;
    // the sightline to the target dips under the top at the wall and lands at this distance
    const bandEnd = distance * (peek.eye - target) / (peek.eye - top);
    const limit = Math.min(peek.rangePixels, _mapEdgeDistance(poly.origin, dx / distance, dy / distance));
    if (bandEnd < limit)
        return false;
    return _includedAtWallHeight(poly, record.edge, edgeTypes, peek, top);
}

function _initialize(wrapped, ...args)
{
    const result = wrapped(...args);
    this._laPeek = _peekConfig(this);
    return result;
}

// Runs after the whole inclusion pipeline so the re-added walls cannot be dropped again by another wrapper.
function _identifyEdges(wrapped, ...args)
{
    const result = wrapped(...args);
    const peek = this._laPeek;
    if (!peek)
        return result;
    const present = new Set();
    for (const edge of this.edges)
        present.add(edge.id);
    const edgeTypes = this.config.edgeTypes;
    for (const record of lancerSightEdgeRecords())
    {
        if (present.has(record.id) || !(record.top <= peek.waist))
            continue;
        if (_blocksBeyondPeek(this, record, edgeTypes, peek))
            this.edges.add(record.edge.clone());
    }
    return result;
}

function _refreshSweeps()
{
    canvas?.perception?.update?.({ initializeVision: true, initializeLighting: true });
}

export function initTrigVisionSweep()
{
    game.settings.register(MODULE_ID, SETTING_PEEK_RANGE, {
        name: 'LA.settings.lancerLosPeekRange.name',
        hint: 'LA.settings.lancerLosPeekRange.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 30, step: 1 },
        default: 0,
        onChange: _refreshSweeps
    });

    Hooks.once('ready', () =>
    {
        if (typeof libWrapper === 'undefined')
            return;
        libWrapper.register(MODULE_ID, 'foundry.canvas.geometry.ClockwiseSweepPolygon.prototype.initialize',
            _initialize, 'WRAPPER');
        libWrapper.register(MODULE_ID, 'foundry.canvas.geometry.ClockwiseSweepPolygon.prototype._identifyEdges',
            _identifyEdges, 'WRAPPER', { perf_mode: 'FAST' });
    });
}
