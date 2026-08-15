/* global game, canvas, Hooks, libWrapper, foundry, CONST */

import { getCurrentMovementType } from './keybindings.js';
import { playUiSound } from '../tah/sound.js';
import { initHexDragStabilizer } from './hex-drag-stabilizer.js';
import { initTerrainTriggerSplits, injectTriggerSilentsAtDrop } from './terrain-trigger-waypoints.js';
import { getModuleSetting } from "../tools/settings-utils.js";
import { thtApi } from './movement-utils.js';

const MODULE_ID = 'lancer-automations';
const RULER_ENABLED = 'enableBuiltinSpeedProvider';
const CLIMB_WAYPOINTS_ENABLED = 'enableClimbWaypoints';
const SPLIT_AT_TRIGGER_BOUNDARIES = 'splitMovementAtTriggerBoundaries';
const DISABLE_AUTO_TERRAIN_ELEVATION = 'disableAutoTerrainElevation';
const THT_ID = 'terrain-height-tools';
const THT_IGNORE_FLAG = 'ignoreAutoElevation';
const LA_DISABLE_AUTO_TERRAIN_FLAG = 'disableAutoTerrainElevation';

const AUTO_MOVEMENT_TYPES = new Set(['walk', 'crawl', 'climb', 'jump', 'fly']);

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, CLIMB_WAYPOINTS_ENABLED, {
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
    game.settings.register(MODULE_ID, SPLIT_AT_TRIGGER_BOUNDARIES, {
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
    game.settings.register(MODULE_ID, DISABLE_AUTO_TERRAIN_ELEVATION, {
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
    game.settings.register(MODULE_ID, 'disableAutoElevationOnMeasure', {
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
});

// Per-drag offset bumped by [/]/[\]; resets on drag start/cancel.
let _dragElevationOffset = 0;
export function getDragElevationOffset()
{
    return _dragElevationOffset;
}
function resetDragElevation()
{
    _dragElevationOffset = 0;
}

function isEnabled()
{
    return getModuleSetting(RULER_ENABLED);
}

// Footprint sample points (world space) for gridless terrain lookups.
function gridlessFootprintPoints(tokenDoc, position)
{
    const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 1;
    const x = position?.x ?? tokenDoc.x ?? 0;
    const y = position?.y ?? tokenDoc.y ?? 0;
    const widthPx = (position?.width ?? tokenDoc.width ?? 1) * gridSize;
    const heightPx = (position?.height ?? tokenDoc.height ?? 1) * gridSize;
    const cols = Math.max(1, Math.round(widthPx / gridSize));
    const rows = Math.max(1, Math.round(heightPx / gridSize));
    const pts = [];
    for (let c = 0; c < cols; c++)
    {
        for (let r = 0; r < rows; r++)
            pts.push([x + (c + 0.5) * (widthPx / cols), y + (r + 0.5) * (heightPx / rows)]);
    }
    return pts;
}

let _typeByIdSrc = null;
let _typeByIdCache = null;
// id->type map, rebuilt only when THT swaps its terrain-types array (stable ref between reads).
function terrainTypeById(tht)
{
    const terrainTypes = tht.getTerrainTypes?.() ?? [];
    if (terrainTypes !== _typeByIdSrc)
    {
        _typeByIdSrc = terrainTypes;
        _typeByIdCache = new Map(terrainTypes.map(terrainType => [terrainType.id, terrainType]));
    }
    return _typeByIdCache;
}

function terrainTopUnder(tokenDoc, position)
{
    const tht = thtApi();
    if (!tht)
        return null;
    const typeById = terrainTypeById(tht);

    let highest = null;
    const consider = (shapes) =>
    {
        for (const shape of shapes)
        {
            const terrainType = typeById.get(shape.terrainTypeId);
            if (!terrainType?.usesHeight || !terrainType?.isSolid)
                continue;
            const top = shape.top ?? (shape.elevation + shape.height);
            if (highest == null || top > highest)
                highest = top;
        }
    };

    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
    {
        // Gridless: sample the footprint by world point.
        for (const [px, py] of gridlessFootprintPoints(tokenDoc, position))
        {
            try
            {
                consider(tht.getShapesAtPoint?.(px, py) ?? []);
            }
            catch
            { /* ignore */ }
        }
    }
    else
    {
        let offsets = [];
        try
        {
            offsets = tokenDoc.getOccupiedGridSpaceOffsets?.(position ?? {}) ?? [];
        }
        catch
        { /* invalid */ }
        for (const gridOffset of offsets)
            consider(tht.getCell?.(gridOffset.j, gridOffset.i) ?? []);
    }
    return highest;
}

function shouldAutoElevate(tokenDoc, { ruler: _ruler = true } = {})
{
    if (!isEnabled())
        return false;
    try
    {
        if (game.settings.get(MODULE_ID, DISABLE_AUTO_TERRAIN_ELEVATION))
            return false;
    }
    catch
    { /* ignore */ }
    // getFlag throws on a scope whose module isn't active; gate the THT lookup.
    if (game.modules.get(THT_ID)?.active && tokenDoc.getFlag?.(THT_ID, THT_IGNORE_FLAG))
        return false;
    if (tokenDoc.getFlag?.(MODULE_ID, LA_DISABLE_AUTO_TERRAIN_FLAG))
        return false;
    return true;
}

function newElevationFor(tokenDoc, position)
{
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const userDelta = _dragElevationOffset * sceneDistance;
    if (getCurrentMovementType() === 'ignore')
        return (tokenDoc.elevation ?? 0) + userDelta;
    const originTop = terrainTopUnder(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y }) ?? 0;
    const destTop = terrainTopUnder(tokenDoc, position) ?? 0;
    const terrainDelta = (destTop - originTop) * sceneDistance;
    return (tokenDoc.elevation ?? 0) + terrainDelta + userDelta;
}

function bumpDragElevation(delta)
{
    _dragElevationOffset += delta;
    for (const token of canvas.tokens?.placeables ?? [])
    {
        const interactionData = token.mouseInteractionManager?.interactionData;
        const contexts = interactionData?.contexts;
        if (!contexts)
            continue;
        for (const context of Object.values(contexts))
        {
            if (!context?.destination || !context.token?.document || !context.clonedToken?.document)
                continue;
            const newElev = elevationForPreview(context.token.document, context.destination);
            context.clonedToken.document.elevation = newElev;
            context.clonedToken.renderFlags?.set?.({ refresh: true });
            // Dirty the destination so _updateDragDestination re-plans (it skips unchanged x/y and ignores elevation).
            context.destination = { ...context.destination, elevation: newElev, _laElevReplan: Math.random() };
        }
        try
        {
            token._updateDragDestination?.(interactionData.destination, { snap: false });
        }
        catch
        { /* ignore */ }
    }
}

function applyAutoElevationToWaypoint(tokenDoc, waypoint)
{
    if (!waypoint || typeof waypoint !== 'object')
        return false;
    if (waypoint.x == null || waypoint.y == null)
        return false;
    const newElev = newElevationFor(tokenDoc, {
        x: waypoint.x,
        y: waypoint.y,
        width: waypoint.width ?? tokenDoc.width,
        height: waypoint.height ?? tokenDoc.height
    });
    if (waypoint.elevation === newElev)
        return false;
    waypoint.elevation = newElev;
    return true;
}

export function bumpDragElevationFromKey(delta)
{
    bumpDragElevation(delta);
}

Hooks.on('preCreateToken', (tokenDoc, _data, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (!shouldAutoElevate(tokenDoc, { ruler: false }))
        return;
    const top = terrainTopUnder(tokenDoc, {});
    if (top != null && top > 0)
    {
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        tokenDoc.updateSource({ elevation: top * sceneDistance });
    }
});

export function elevationForPreview(tokenDoc, waypoint)
{
    if (!shouldAutoElevate(tokenDoc))
        return tokenDoc.elevation;
    return newElevationFor(tokenDoc, {
        x: waypoint.x,
        y: waypoint.y,
        width: waypoint.width ?? tokenDoc.width,
        height: waypoint.height ?? tokenDoc.height
    });
}

function _tokenZHeight(tokenDoc)
{
    return tokenDoc?.flags?.['wall-height']?.tokenHeight
        ?? tokenDoc?.flags?.elevatedvision?.tokenHeight
        ?? 1;
}

function _terrainTopMost(tokenDoc, position, { terrainFilter, gapSearch } = {})
{
    const tht = thtApi();
    if (!tht)
        return 0;
    const typeById = terrainTypeById(tht);
    const gridType = canvas.grid?.type;

    const ranges = [{ bottom: -Infinity, top: 0 }];
    let highest = 0;

    const consider = (shapes) =>
    {
        for (const shape of shapes ?? [])
        {
            const terrainType = typeById.get(shape.terrainTypeId);
            if (!terrainType?.usesHeight || !terrainType?.isSolid)
                continue;
            if (typeof terrainFilter === 'function' && !terrainFilter(shape))
                continue;
            const top = shape.top ?? ((shape.elevation ?? 0) + (shape.height ?? 0));
            const bottom = shape.bottom ?? (shape.elevation ?? 0);
            if (top > highest)
                highest = top;
            ranges.push({ bottom, top });
        }
    };

    if (gridType === CONST.GRID_TYPES.GRIDLESS)
    {
        for (const [px, py] of gridlessFootprintPoints(tokenDoc, position))
        {
            try
            {
                consider(tht.getShapesAtPoint?.(px, py));
            }
            catch
            { /* ignore */ }
        }
    }
    else
    {
        let offsets = [];
        try
        {
            offsets = tokenDoc.getOccupiedGridSpaceOffsets?.(position ?? {}) ?? [];
        }
        catch
        { /* ignore */ }
        for (const gridOffset of offsets)
            consider(tht.getCell?.(gridOffset.j, gridOffset.i));
    }

    if (!gapSearch)
        return highest;

    ranges.sort((a, b) => a.bottom - b.bottom || a.top - b.top);
    const required = gapSearch.currentElevationAboveTerrain + gapSearch.tokenZHeight;
    for (let i = 0; i < ranges.length - 1; i++)
    {
        const gap = ranges[i + 1].bottom - ranges[i].top;
        if (gap < required)
            continue;
        if (ranges[i + 1].bottom < gapSearch.currentTerrainTop + gapSearch.tokenZHeight)
            continue;
        return ranges[i].top;
    }
    return ranges.at(-1).top;
}

function getCompleteMovementPathWrapper(wrapped, waypoints)
{
    const movementPath = wrapped(waypoints);
    _injectMovementPenaltyBoundaries(this, movementPath);
    if (movementPath.length <= 1)
        return movementPath;
    if (!shouldAutoElevate(this))
        return movementPath;
    try
    {
        if (!game.settings.get(MODULE_ID, CLIMB_WAYPOINTS_ENABLED))
            return movementPath;
    }
    catch
    {
        return movementPath;
    }
    const flying = getCurrentMovementType() === 'fly';

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const tokenZHeight = _tokenZHeight(this);
    const userDelta = _dragElevationOffset * sceneDistance;
    const originElev = this.elevation ?? 0;

    let prevTop = _terrainTopMost(this, movementPath[0], {
        terrainFilter: shape => (shape.bottom ?? shape.elevation ?? 0) <= (movementPath[0].elevation ?? 0) + tokenZHeight
    });
    const originTop = prevTop;

    for (let i = 1; i < movementPath.length; i++)
    {
        if (!AUTO_MOVEMENT_TYPES.has(movementPath[i].action))
            continue;

        const thisTop = _terrainTopMost(this, movementPath[i], {
            gapSearch: {
                currentTerrainTop: prevTop,
                currentElevationAboveTerrain: (movementPath[i].elevation ?? 0) - prevTop,
                tokenZHeight
            }
        });

        if (movementPath[i].intermediate === true && !movementPath[i]._laElevResolved)
            movementPath[i].elevation = originElev + (thisTop - originTop) * sceneDistance + userDelta;

        if (thisTop !== prevTop)
        {
            if (movementPath[i - 1])
            {
                if (!movementPath[i - 1].explicit)
                    movementPath[i - 1]._laClimbFlip = true;
                movementPath[i - 1].intermediate = false;
                movementPath[i - 1].explicit = true;
            }
            if (!movementPath[i].explicit)
                movementPath[i]._laClimbFlip = true;
            Object.assign(movementPath[i], {
                action: flying ? 'fly' : 'climb',
                intermediate: false,
                explicit: true
            });
        }

        prevTop = thisTop;
    }

    return movementPath;
}

// Silent entry/exit waypoints restore ModifyMovementCost slowdown without Foundry's boundary insertion (which pollutes hex paint).
function _injectMovementPenaltyBoundaries(tokenDoc, movementPath)
{
    if (movementPath.length < 2)
        return;
    const scene = tokenDoc.parent;
    if (!scene?.regions?.size)
        return;
    const ModifyCostBehavior = foundry.data.regionBehaviors.ModifyMovementCostRegionBehaviorType;
    const TerrainData = CONFIG.Token.movement.TerrainData;
    if (!ModifyCostBehavior || !TerrainData)
        return;

    const states = [];
    for (const region of scene.regions)
    {
        for (const behavior of region.behaviors)
        {
            if (behavior.disabled)
                continue;
            if (!(behavior.system instanceof ModifyCostBehavior))
                continue;
            states.push({ region, behavior, active: false });
            break;
        }
    }
    if (!states.length)
        return;

    const startCenter = tokenDoc.getCenterPoint(movementPath[0]);
    for (const regionState of states)
        regionState.active = regionState.region.testPoint(startCenter);

    const newPath = [movementPath[0]];
    for (let i = 1; i < movementPath.length; i++)
    {
        const waypoint = movementPath[i];
        const center = tokenDoc.getCenterPoint(waypoint);
        for (const regionState of states)
        {
            const nowActive = regionState.region.testPoint(center);
            if (nowActive === regionState.active)
                continue;
            // Terrain = state before crossing (Foundry's convention): null when entering, difficulty when leaving.
            let terrain = null;
            if (!nowActive)
            {
                const difficulty = regionState.behavior.system.difficulties?.[waypoint.action] ?? 1;
                if (difficulty > 1)
                    terrain = TerrainData.resolveTerrainEffects([{ name: 'difficulty', difficulty }]);
            }
            newPath.push({
                x: waypoint.x,
                y: waypoint.y,
                elevation: waypoint.elevation,
                width: waypoint.width,
                height: waypoint.height,
                shape: waypoint.shape,
                action: waypoint.action,
                terrain,
                intermediate: true,
                explicit: true,
                snapped: true,
                checkpoint: false,
                _laSilent: true
            });
            regionState.active = nowActive;
        }
        newPath.push(waypoint);
    }

    movementPath.length = 0;
    movementPath.push(...newPath);
}

Hooks.once('ready', () =>
{
    if (!game.modules.get('lib-wrapper')?.active)
        return;

    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.getCompleteMovementPath', getCompleteMovementPathWrapper, 'WRAPPER');
    initHexDragStabilizer();
    initTerrainTriggerSplits();

    // Native Ctrl+wheel and Q/E elevation would add to pathfinder cost; we route to our offset.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onDragMouseWheel', function()
    {}, 'OVERRIDE');

    // Native Q/E during drag also adds to pathfinder cost. Route to our offset mechanism.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._changeDragElevation', function(delta)
    {
        bumpDragElevation(Math.sign(delta));
        playUiSound('tokenDrag');
    }, 'OVERRIDE');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onDragLeftStart', function(wrapped, event)
    {
        resetDragElevation();
        return wrapped.call(this, event);
    }, 'WRAPPER');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._updateDragDestination', function(wrapped, point, options)
    {
        const result = wrapped.call(this, point, options);
        const contexts = Object.values(this.mouseInteractionManager?.interactionData?.contexts ?? {});
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        for (const context of contexts)
        {
            if (!context?.destination || !context.token?.document)
                continue;
            // Stamp the destination elevation so Foundry's path planner treats a pure-vertical drag as a real waypoint.
            const newElev = shouldAutoElevate(context.token.document)
                ? elevationForPreview(context.token.document, context.destination)
                : (context.token.document.elevation ?? 0) + _dragElevationOffset * sceneDistance;
            context.destination.elevation = newElev;
            if (context.clonedToken?.document && context.clonedToken.document.elevation !== newElev)
            {
                context.clonedToken.document.elevation = newElev;
                context.clonedToken.renderFlags?.set?.({ refresh: true });
            }
        }
        return result;
    }, 'WRAPPER');

    // Only place we change stored elevation, keeping the path to one segment.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._prepareDragLeftDropUpdates', function(wrapped, event)
    {
        injectTriggerSilentsAtDrop(event);
        const result = wrapped.call(this, event);
        const [updates, options] = result;
        // Synthesize an elevation-only waypoint so pure-Q/E drag commits (native drop skips origin-only paths).
        if (_dragElevationOffset !== 0)
        {
            const contexts = event?.interactionData?.contexts ?? {};
            for (const [id, dragContext] of Object.entries(contexts))
            {
                if ((dragContext?.foundPath?.length ?? 0) > 1)
                    continue;
                const doc = canvas.scene.tokens.get(id);
                if (!doc)
                    continue;
                const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
                const elev = (doc.elevation ?? 0) + _dragElevationOffset * sceneDistance;
                if (!updates.some(update => update._id === id))
                    updates.push({ _id: id });
                options.movement ??= {};
                options.movement[id] = {
                    waypoints: [{ x: doc.x, y: doc.y, elevation: elev, action: undefined, snapped: true, explicit: true }],
                    method: "dragging",
                    constrainOptions: this._getDragConstrainOptions()
                };
            }
        }
        if (!shouldAutoElevate(this.document))
            return result;
        for (const id of Object.keys(options?.movement ?? {}))
        {
            const doc = canvas.scene.tokens.get(id);
            if (!doc)
                continue;
            const waypoints = options.movement[id].waypoints;
            if (!Array.isArray(waypoints))
                continue;
            for (const waypoint of waypoints)
            {
                applyAutoElevationToWaypoint(doc, waypoint);
                waypoint._laElevResolved = true;
            }
        }
        return result;
    }, 'WRAPPER');

    // Only drag-moves get auto-elevated; config edits, api calls, paste, undo, keyboard pass through.
    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.move', function(wrapped, waypoints, options = {})
    {
        if (options.method !== 'dragging')
            return wrapped.call(this, waypoints, options);
        if (!shouldAutoElevate(this))
            return wrapped.call(this, waypoints, options);
        const waypointList = Array.isArray(waypoints) ? waypoints : [waypoints];
        const isContinuation = options?._movementArguments?.movementId != null;
        for (const waypoint of waypointList)
        {
            if (!isContinuation && !waypoint._laElevResolved)
                applyAutoElevationToWaypoint(this, waypoint);
            waypoint._laElevResolved = true;
        }
        return wrapped.call(this, waypointList, options);
    }, 'WRAPPER');
});
