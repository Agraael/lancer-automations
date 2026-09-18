/* global game, canvas, Hooks, libWrapper, foundry, CONST */

import { getCurrentMovementType, currentElevationMode, elevationModeFor } from './keybindings.js';
import { playUiSound } from '../tah/sound.js';
import { initHexDragStabilizer } from './hex-drag-stabilizer.js';
import { initTerrainTriggerSplits, injectTriggerSilentsAtDrop } from './terrain-trigger-waypoints.js';
import { getModuleSetting } from "../tools/settings-utils.js";
import { getLAFlag } from "../tools/flag-utils.js";
import { thtApi, canPassObstructions, thtCellShapes, thtShapesAtPoint, solidBands, restingSurface, footprintSurface } from './movement-utils.js';
import { laTokenGameplayHeight } from '../tools/token-height.js';

import { MODULE_ID } from '../tools/constants.js';
const RULER_ENABLED = 'enableBuiltinSpeedProvider';
const CLIMB_WAYPOINTS_ENABLED = 'enableClimbWaypoints';
const SPLIT_AT_TRIGGER_BOUNDARIES = 'splitMovementAtTriggerBoundaries';
const DISABLE_AUTO_TERRAIN_ELEVATION = 'disableAutoTerrainElevation';
const THT_ID = 'terrain-height-tools';
const THT_IGNORE_FLAG = 'ignoreAutoElevation';
const LA_DISABLE_AUTO_TERRAIN_FLAG = 'disableAutoTerrainElevation';

const AUTO_MOVEMENT_TYPES = new Set(['walk', 'crawl', 'climb', 'jump', 'fly']);
const PER_STEP_RENDER = 'rulerPerStepRender';
// Actions whose animation stays a straight line to the waypoint.
const STRAIGHT_ANIMATION_ACTIONS = new Set(['forced', 'displace']);

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

/**
 * Surface the token rests on at a position, grid units. Null without THT.
 * @param {TokenDocument} tokenDoc
 * @param {object} position
 * @param {'ground'|'hold'} mode
 * @param {number} height current elevation in grid units
 * @param {boolean} [landing] the token stops here, so it rests on top of anything it would otherwise step over
 * @returns {{surface: number, brushed: boolean, landingSurface: number}|null}
 */
function surfaceUnder(tokenDoc, position, mode, height, landing = false)
{
    const tht = thtApi();
    if (!tht)
        return null;
    const typeById = terrainTypeById(tht);
    const zHeight = laTokenGameplayHeight(tokenDoc);

    const cellSurfaces = [];
    const consider = (shapes) => cellSurfaces.push(restingSurface(solidBands(shapes, typeById), zHeight, height, mode));

    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
    {
        // Gridless: sample the footprint by world point.
        for (const [px, py] of gridlessFootprintPoints(tokenDoc, position))
        {
            try
            {
                consider(thtShapesAtPoint(tht, px, py));
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
            consider(thtCellShapes(tht, gridOffset.j, gridOffset.i));
    }
    if (!cellSurfaces.length)
        return null;
    // Stepping over sub-SIZE obstructions is a walker's rule.
    const moverSize = Number(tokenDoc?.actor?.system?.size) || 0;
    const standing = !landing && mode === 'ground' && moverSize > 1 && cellSurfaces.length > 1 && canPassObstructions(tokenDoc);
    return footprintSurface(cellSurfaces, moverSize, standing);
}

function shouldAutoElevate(tokenDoc, { ruler: _ruler = true } = {})
{
    if (!isEnabled())
        return false;
    if (getModuleSetting(DISABLE_AUTO_TERRAIN_ELEVATION))
        return false;
    // getFlag throws on a scope whose module isn't active; gate the THT lookup.
    if (game.modules.get(THT_ID)?.active && tokenDoc.getFlag?.(THT_ID, THT_IGNORE_FLAG))
        return false;
    if (getLAFlag(tokenDoc,LA_DISABLE_AUTO_TERRAIN_FLAG))
        return false;
    return true;
}

function newElevationFor(tokenDoc, position, landing = false)
{
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const current = tokenDoc.elevation ?? 0;
    const userDelta = _dragElevationOffset * sceneDistance;
    const mode = currentElevationMode();
    if (!mode)
        return current + userDelta;
    // Ground snaps to the surface and adds Q/E on top; Hold folds Q/E into its floor.
    const reference = mode === 'hold' ? current + userDelta : current;
    const rest = surfaceUnder(tokenDoc, position, mode, reference / sceneDistance, landing);
    if (!rest)
        return current + userDelta;
    return rest.surface * sceneDistance + (mode === 'ground' ? userDelta : 0);
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

function applyAutoElevationToWaypoint(tokenDoc, waypoint, landing = false)
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
    }, landing);
    if (waypoint.elevation === newElev)
        return false;
    waypoint.elevation = newElev;
    return true;
}

export function bumpDragElevationFromKey(delta)
{
    bumpDragElevation(delta);
}

// Foundry animates only through the waypoints it is handed, never the dense cells it fills in
// between them, so with the per-step ruler path on we hand it every cell of that path.
function expandPerCell(tokenDoc, waypoints)
{
    if (!Array.isArray(waypoints) || !waypoints.length)
        return waypoints;
    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS || !getModuleSetting(PER_STEP_RENDER))
        return waypoints;
    const actions = CONFIG.Token?.movement?.actions ?? {};
    const source = tokenDoc._source;
    let previous = { x: source.x, y: source.y, elevation: source.elevation, width: source.width, height: source.height, shape: source.shape };
    const expanded = [];
    for (const waypoint of waypoints)
    {
        const width = waypoint.width ?? previous.width;
        const height = waypoint.height ?? previous.height;
        const shape = waypoint.shape ?? previous.shape;
        const elevation = waypoint.elevation ?? previous.elevation;
        const action = waypoint.action ?? tokenDoc.movementAction;
        const resized = width !== previous.width || height !== previous.height || shape !== previous.shape;
        const straight = resized || !!actions[action]?.teleport || STRAIGHT_ANIMATION_ACTIONS.has(action);
        if (!straight && waypoint.x != null && waypoint.y != null)
        {
            try
            {
                const dimensions = { width, height, shape };
                const from = tokenDoc._positionToGridOffset(previous);
                const to = tokenDoc._positionToGridOffset({ x: waypoint.x, y: waypoint.y, elevation, width, height, shape });
                const steps = canvas.grid.getDirectPath([from, to]);
                for (let step = 1; step < steps.length - 1; step++)
                {
                    const position = tokenDoc._gridOffsetToPosition(steps[step], dimensions);
                    expanded.push({ x: Math.round(position.x), y: Math.round(position.y), elevation, width, height, shape, action, snapped: true, explicit: false, checkpoint: false });
                }
            }
            catch
            { /* keep the straight segment */ }
        }
        expanded.push(waypoint);
        previous = { x: waypoint.x ?? previous.x, y: waypoint.y ?? previous.y, elevation, width, height, shape };
    }
    return expanded;
}

Hooks.on('preCreateToken', (tokenDoc, _data, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (!shouldAutoElevate(tokenDoc, { ruler: false }))
        return;
    // A new token rests on the highest surface under it.
    const rest = surfaceUnder(tokenDoc, {}, 'ground', Infinity, true);
    if (rest && rest.surface > 0)
    {
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        tokenDoc.updateSource({ elevation: rest.surface * sceneDistance });
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
    }, true);
}

function getCompleteMovementPathWrapper(wrapped, waypoints)
{
    const movementPath = wrapped(waypoints);
    _injectMovementPenaltyBoundaries(this, movementPath);
    if (movementPath.length <= 1)
        return movementPath;
    if (!shouldAutoElevate(this))
        return movementPath;
    const movedHorizontally = movementPath.some(waypoint => waypoint.x !== movementPath[0].x || waypoint.y !== movementPath[0].y);
    if (!movedHorizontally)
        return movementPath;
    try
    {
        if (!getModuleSetting(CLIMB_WAYPOINTS_ENABLED))
            return movementPath;
    }
    catch
    {
        return movementPath;
    }
    const dragType = getCurrentMovementType();
    const flying = dragType === 'fly';
    const jumping = dragType === 'jump';

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const originFeet = (movementPath[0].elevation ?? 0) / sceneDistance;
    // Ground snaps to the surface and adds Q/E on top; Hold folds Q/E into its floor.
    const offset = _dragElevationOffset;
    const floor = originFeet + offset;

    // Pass 1: the surface under each auto-elevating waypoint, Ground chained from the one before.
    const rests = [];
    let lastSurface = originFeet;
    for (let idx = 1; idx < movementPath.length; idx++)
    {
        const action = movementPath[idx].action;
        if (!AUTO_MOVEMENT_TYPES.has(action))
            continue;
        const mode = elevationModeFor(action);
        const reference = mode === 'hold' ? floor : lastSurface;
        const rest = surfaceUnder(this, movementPath[idx], mode, reference, idx === movementPath.length - 1) ?? { surface: reference, brushed: false };
        const height = mode === 'hold' ? rest.surface : rest.surface + offset;
        rests.push({ idx, mode, surface: rest.surface, height, brushed: rest.brushed });
        lastSurface = rest.surface;
    }

    // A legal vertical hop (at most 1 cell over, up to SIZE up) stays a whole jump; any other
    // jump transition splits into a climb segment exactly like walking.
    let jumpHop = false;
    if (jumping && rests.length)
    {
        let cellsMoved = 0;
        for (let step = 1; step < movementPath.length; step++)
        {
            if (movementPath[step].x !== movementPath[step - 1].x || movementPath[step].y !== movementPath[step - 1].y)
                cellsMoved++;
        }
        const rise = (rests.at(-1)?.surface ?? originFeet) - originFeet;
        const sizeAllowance = Math.max(1, Number(this.actor?.system?.size) || 1);
        jumpHop = cellsMoved <= 1 && rise <= sizeAllowance + 1e-9;
    }

    // Climb stamps follow the terrain surface, so Q/E alone never splits the path.
    let prevSurface = null;
    let prevBrushing = false;
    for (const { idx, mode, surface, height, brushed } of rests)
    {
        prevSurface ??= mode === 'hold' ? floor : originFeet;
        // Corners and silents arrive intermediate:false but follow the profile like dense cells.
        if (!movementPath[idx].explicit && !movementPath[idx]._laElevResolved)
            movementPath[idx].elevation = height * sceneDistance;
        if (brushed)
            movementPath[idx]._laBrushed = true;

        // Brushed obstructions get a visible ignore-elevation waypoint, like climbs get a ladder.
        if (brushed && !prevBrushing && !jumping)
        {
            if (movementPath[idx - 1])
            {
                if (!movementPath[idx - 1].explicit)
                    movementPath[idx - 1]._laClimbFlip = true;
                movementPath[idx - 1].intermediate = false;
                movementPath[idx - 1].explicit = true;
                for (let back = idx - 2; back >= 1 && movementPath[back].intermediate; back--)
                    movementPath[back].intermediate = false;
            }
            if (!movementPath[idx].explicit)
                movementPath[idx]._laClimbFlip = true;
            Object.assign(movementPath[idx], {
                action: 'ignore',
                intermediate: false,
                explicit: true
            });
        }

        if (surface !== prevSurface && !(jumping && jumpHop))
        {
            if (movementPath[idx - 1])
            {
                if (!movementPath[idx - 1].explicit)
                    movementPath[idx - 1]._laClimbFlip = true;
                movementPath[idx - 1].intermediate = false;
                movementPath[idx - 1].explicit = true;
                for (let back = idx - 2; back >= 1 && movementPath[back].intermediate; back--)
                    movementPath[back].intermediate = false;
            }
            if (!movementPath[idx].explicit)
                movementPath[idx]._laClimbFlip = true;
            Object.assign(movementPath[idx], {
                action: flying ? 'fly' : 'climb',
                intermediate: false,
                explicit: true
            });
        }

        prevSurface = surface;
        prevBrushing = brushed;
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
        for (const id of Object.keys(options?.movement ?? {}))
        {
            const doc = canvas.scene.tokens.get(id);
            const movement = options.movement[id];
            if (doc && Array.isArray(movement?.waypoints))
                movement.waypoints = expandPerCell(doc, movement.waypoints);
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
            for (let idx = 0; idx < waypoints.length; idx++)
            {
                applyAutoElevationToWaypoint(doc, waypoints[idx], idx === waypoints.length - 1);
                waypoints[idx]._laElevResolved = true;
            }
        }
        return result;
    }, 'WRAPPER');

    // Only drag-moves get auto-elevated; config edits, api calls, paste, undo, keyboard pass through.
    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.move', function(wrapped, waypoints, options = {})
    {
        if (options.method !== 'dragging')
            return wrapped.call(this, waypoints, options);
        const isContinuation = options?._movementArguments?.movementId != null;
        let waypointList = Array.isArray(waypoints) ? waypoints : [waypoints];
        if (!isContinuation)
            waypointList = expandPerCell(this, waypointList);
        if (!shouldAutoElevate(this))
            return wrapped.call(this, waypointList, options);
        for (let idx = 0; idx < waypointList.length; idx++)
        {
            const waypoint = waypointList[idx];
            if (!isContinuation && !waypoint._laElevResolved)
                applyAutoElevationToWaypoint(this, waypoint, idx === waypointList.length - 1);
            waypoint._laElevResolved = true;
        }
        return wrapped.call(this, waypointList, options);
    }, 'WRAPPER');
});
