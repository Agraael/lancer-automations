/* global canvas, game, Hooks */

import { getSpeedRanges } from '../combat/speed-provider.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { computeMovementRoute, computeStraightRoute } from './reachability.js';
import { pathfindDragEnabled, isForceDebugMovement } from './keybindings.js';
import { isStraightMove, straightStartState, straightStateAfter, bandEdges, actionSpan } from './straight-line.js';
import { parseAction, isRealStop } from './movement-actions.js';
import { landingElevationAt } from './elevation.js';

import { MODULE_ID } from '../tools/constants.js';
const SPLIT_AT_TRIGGER_BOUNDARIES = 'splitMovementAtTriggerBoundaries';
const SPLIT_AT_SPEED_TIERS = 'splitMovementAtSpeedTiers';
const PATHFIND_DRAG_MOVEMENT = 'pathfindDragMovement';

function _thtMatchKey(thtMatch)
{
    const bounds = thtMatch?.shape?.polygon?.boundingRect;
    return `tht::${thtMatch?.shape?.terrainTypeId}::${thtMatch?.shape?.bottom}::${thtMatch?.shape?.top}::${bounds?.x},${bounds?.y}`;
}

const _GAA_EFFECT_BOUNDARY = new Set(['APPLY_ON_ENTER', 'APPLY_ON_LEAVE', 'REMOVE_ON_ENTER', 'REMOVE_ON_LEAVE']);
const _GAA_MACRO_BOUNDARY = new Set(['ENTER_LEAVE', 'ENTER', 'LEAVE', 'PREVIEW_ENTER_LEAVE', 'PREVIEW_ENTER', 'PREVIEW_LEAVE']);
const _GAA_SEQ_BOUNDARY = new Set(['ON_ENTER', 'ON_LEAVE']);

function _gaaAuraHasBoundaryTrigger(auraCfg)
{
    if (!auraCfg)
        return false;

    if (Array.isArray(auraCfg.effects))
    {
        for (const effect of auraCfg.effects)
        {
            if (_GAA_EFFECT_BOUNDARY.has(effect?.mode))
                return true;
        }
    }

    if (Array.isArray(auraCfg.macros))
    {
        for (const macro of auraCfg.macros)
        {
            if (_GAA_MACRO_BOUNDARY.has(macro?.mode))
                return true;
        }
    }

    if (Array.isArray(auraCfg.sequencerEffects))
    {
        for (const seqEffect of auraCfg.sequencerEffects)
        {
            if (_GAA_SEQ_BOUNDARY.has(seqEffect?.trigger))
                return true;
        }
    }

    return false;
}

function _computeTriggerKeys(tokenDoc, pos)
{
    const keys = new Set();
    const tht = /** @type {any} */ (globalThis).terrainHeightTools;

    if (tht?.getContainingTriggerMatches)
    {
        try
        {
            const matches = tht.getContainingTriggerMatches(tokenDoc, pos) ?? [];
            for (const thtMatch of matches)
                keys.add(_thtMatchKey(thtMatch));
        }
        catch
        {}
    }

    const tmApi = /** @type {any} */ (game.modules.get('templatemacro'))?.api;

    if (tmApi?.findContainers)
    {
        try
        {
            const ids = tmApi.findContainers(tokenDoc, pos) ?? [];

            for (const id of ids)
            {
                const templateDoc = tokenDoc.parent?.templates?.get(id);
                const templateMacroFlags = templateDoc?.flags?.templatemacro;

                if (!templateMacroFlags)
                    continue;

                // TM stores triggers either at when<X>.command (legacy) or in actions[] (UI).
                const hasLegacy = !!(templateMacroFlags.whenEntered?.command || templateMacroFlags.whenLeft?.command);

                const hasAction = Array.isArray(templateMacroFlags.actions) && templateMacroFlags.actions.some(
                    /** @type {any} */ (action) => action?.trigger === 'whenEntered' || action?.trigger === 'whenLeft'
                );

                if (!hasLegacy && !hasAction)
                    continue;
                keys.add(`tm::${id}`);
            }
        }
        catch
        {}
    }

    // Native Foundry regions: same cell-based pattern as THT/TM/GAA.
    const scene = tokenDoc.parent;

    if (scene?.regions?.size)
    {
        const src = tokenDoc._source;

        const probePoint = { x: pos.x,
            y: pos.y,
            elevation: pos.elevation ?? src.elevation ?? 0,
            width: src.width,
            height: src.height,
            shape: src.shape };

        for (const region of scene.regions)
        {
            let inside = false;

            try
            {
                inside = tokenDoc.testInsideRegion(region, probePoint);
            }
            catch
            {
                continue;
            }

            if (inside)
                keys.add(`region::${region.id}`);
        }
    }

    const gaaLayer = /** @type {any} */ (canvas)?.gaaAuraLayer;

    if (gaaLayer?._auraManager?.getAllAuras)
    {
        try
        {
            const centerPoint = tokenDoc.getCenterPoint?.({ x: pos.x, y: pos.y }) ?? {
                x: pos.x + (tokenDoc.width ?? 1) * (canvas.grid.sizeX ?? canvas.grid.size) / 2,
                y: pos.y + (tokenDoc.height ?? 1) * (canvas.grid.sizeY ?? canvas.grid.size) / 2
            };

            const inCombat = !!game.combat;
            const selfId = tokenDoc.id;

            for (const { parent, aura } of gaaLayer._auraManager.getAllAuras({ preview: false }))
            {
                const auraCfg = aura?.config;
                if (!auraCfg?.enabled)
                    continue;
                if (auraCfg.onlyEnabledInCombat && !inCombat)
                    continue;
                if (parent?.document?.id === selfId)
                    continue;
                if (!_gaaAuraHasBoundaryTrigger(auraCfg))
                    continue;
                if (!aura.isWorldPointInside?.(centerPoint.x, centerPoint.y))
                    continue;
                keys.add(`gaa::${parent.document?.id}::${auraCfg.id}`);
            }
        }
        catch
        {}
    }

    return keys;
}

// Every drag update re-walks the dense path from the origin, so the containers per point are
// memoized until a template, region, aura or the scene can change. Callers only read the sets.
let _triggerKeyCache = new Map();

function invalidateTriggerKeys()
{
    _triggerKeyCache = new Map();
}

for (const hook of ['canvasReady', 'updateScene', 'createToken', 'updateToken', 'deleteToken', 'updateActor', 'createItem', 'updateItem', 'deleteItem',
    'createMeasuredTemplate', 'updateMeasuredTemplate', 'deleteMeasuredTemplate', 'createRegion', 'updateRegion', 'deleteRegion', 'createCombat', 'deleteCombat'])
    Hooks.on(hook, invalidateTriggerKeys);

function _getTriggerKeys(tokenDoc, pos)
{
    const key = `${tokenDoc.id}|${Math.round(pos.x)},${Math.round(pos.y)},${pos.elevation ?? tokenDoc._source.elevation ?? 0}`;
    let keys = _triggerKeyCache.get(key);

    if (!keys)
    {
        keys = _computeTriggerKeys(tokenDoc, pos);
        _triggerKeyCache.set(key, keys);
    }

    return keys;
}

const _AUTO_ELEV_ACTIONS = new Set(['climb', 'fly']);
let _patchDetected = false;

function _injectSilents(doc, context, { triggerOn = true, tierOn = false } = {})
{
    if (isForceDebugMovement())
        return;
    if (!Array.isArray(context?.foundPath) || context.foundPath.length < 2)
        return;
    if (context.foundPath.some(/** @type {any} */ (wp) => wp?._laSilent))
        return;
    if (canvas.grid?.isGridless)
        return;

    const tht = /** @type {any} */ (globalThis).terrainHeightTools;
    const tmApi = /** @type {any} */ (game.modules.get('templatemacro'))?.api;
    const gaaLayer = /** @type {any} */ (canvas)?.gaaAuraLayer;
    const hasRegions = (doc.parent?.regions?.size ?? 0) > 0;
    const hasTriggerSources = !!(tht?.getContainingTriggerMatches || tmApi?.findContainers || gaaLayer?._auraManager || hasRegions);
    const doTrigger = triggerOn && hasTriggerSources;
    const doTier = tierOn;

    if (!doTrigger && !doTier)
        return;

    // Hex _positionToGridOffset depends on (w,h,shape); silent must match _source.
    const src = doc._source;
    const refWidth = src.width, refHeight = src.height, refShape = src.shape;

    let densePath;

    try
    {
        densePath = doc.getCompleteMovementPath(context.foundPath);
    }
    catch
    {
        return;
    }

    if (!Array.isArray(densePath) || densePath.length < 2)
        return;

    // Cumulative Lancer cost per dense point (prior turn cost folded in) + the tier boundary thresholds.
    let tierCosts = null;
    let tierBoundaries = null;

    if (doTier)
    {
        const tierToken = /** @type {any} */ (doc).object ?? canvas.tokens.get(doc.id);
        const ranges = tierToken ? getSpeedRanges(tierToken) : [];

        if (ranges.length)
        {
            let prior = 0;

            try
            {
                const api = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
                prior = Number(api?.getMovementHistory?.(doc.id)?.intentional?.regular ?? 0);
            }
            catch
            {}

            try
            {
                const measurement = doc.measureMovementPath(densePath);
                const mwps = measurement?.waypoints ?? [];

                if (mwps.length === densePath.length)
                {
                    tierCosts = mwps.map(/** @type {any} */ (mw) => prior + (Number(mw?.cost) || 0));
                    tierBoundaries = ranges.map(/** @type {any} */ (range) => range.max);
                }
            }
            catch
            {}
        }
    }

    let prevKeys = doTrigger
        ? _getTriggerKeys(doc, { x: densePath[0].x, y: densePath[0].y, elevation: densePath[0].elevation })
        : null;

    // Two silents per transition (auto-elev pattern): last OUT then first IN, so the trigger
    // fires when the token visually reaches the boundary cell.
    const _mkSilent = (waypoint) => ({
        x: waypoint.x,
        y: waypoint.y,
        elevation: waypoint.elevation,
        width: refWidth,
        height: refHeight,
        shape: refShape,
        action: waypoint.action,
        snapped: true,
        explicit: false,
        checkpoint: true,
        intermediate: false,
        _laSilent: true
    });

    // Emit silents at their real path index; blanket-inserting after origin reorders later segments (zigzag).
    const inserts = new Map();
    let fpCursor = 1;

    const emit = (entry, denseIdx, beforeIdx) =>
    {
        if (!inserts.has(beforeIdx))
            inserts.set(beforeIdx, []);
        inserts.get(beforeIdx).push({ entry, dense: denseIdx });
    };
    let landingIdx = densePath.length - 1;

    while (landingIdx > 0
        && Math.round(densePath[landingIdx - 1].x) === Math.round(densePath[landingIdx].x)
        && Math.round(densePath[landingIdx - 1].y) === Math.round(densePath[landingIdx].y))
        landingIdx--;

    for (let idx = 1; idx < densePath.length; idx++)
    {
        const waypoint = densePath[idx];
        const prev = densePath[idx - 1];

        if (doTrigger)
        {
            const currentKeys = _getTriggerKeys(doc, {
                x: waypoint.x, y: waypoint.y, elevation: waypoint.elevation
            });

            let transition = false;

            for (const key of currentKeys)
            {
                if (!prevKeys.has(key))
                {
                    transition = true; break;
                }
            }

            if (!transition)
            {
                for (const key of prevKeys)
                {
                    if (!currentKeys.has(key))
                    {
                        transition = true; break;
                    }
                }
            }

            if (transition && !_AUTO_ELEV_ACTIONS.has(waypoint.action) && !_AUTO_ELEV_ACTIONS.has(prev?.action)
                && !waypoint._laClimbFlip && !prev?._laClimbFlip)
            {
                if (prev)
                    emit(_mkSilent(prev), idx - 1, idx);
                emit(_mkSilent(waypoint), idx, idx);
            }

            prevKeys = currentKeys;
        }

        const nextWaypoint = context.foundPath[fpCursor];
        const onWaypointHex = !!nextWaypoint && Math.round(nextWaypoint.x) === Math.round(waypoint.x) && Math.round(nextWaypoint.y) === Math.round(waypoint.y);

        if (tierCosts && tierBoundaries && idx < landingIdx && !onWaypointHex && !_AUTO_ELEV_ACTIONS.has(waypoint.action) && !waypoint._laClimbFlip)
        {
            const costBefore = tierCosts[idx - 1];
            const costAfter = tierCosts[idx];

            for (const boundary of tierBoundaries)
            {
                if (costBefore < boundary && costAfter >= boundary)
                {
                    emit(_mkSilent(waypoint), idx, idx);
                    break;
                }
            }
        }

        while (fpCursor < context.foundPath.length && _samePoint(waypoint, context.foundPath[fpCursor]))
            fpCursor++;
    }

    if (!inserts.size)
        return;

    const plan = _insertAtDense(context.foundPath, densePath, inserts);
    if (plan)
        context.foundPath = _pinSilentSpans(doc, plan.rebuilt, plan.denseIdx, densePath, { width: refWidth, height: refHeight, shape: refShape });
}

function _samePoint(dense, want)
{
    return Math.round(dense.x) === Math.round(want.x)
        && Math.round(dense.y) === Math.round(want.y)
        && (want.intermediate === true || (dense.elevation ?? 0) === (want.elevation ?? 0));
}

function _hexGroups(path)
{
    const groups = [];

    path.forEach((waypoint, index) =>
    {
        const stop = isRealStop(waypoint);
        const last = groups.at(-1);

        if (last && Math.round(last.x) === Math.round(waypoint.x) && Math.round(last.y) === Math.round(waypoint.y))
        {
            last.end = index;
            last.stop ||= stop;
            return;
        }

        groups.push({ x: waypoint.x, y: waypoint.y, end: index, stop });
    });

    return groups;
}

function _insertAtDense(foundPath, densePath, inserts)
{
    const rebuilt = [foundPath[0]];
    const denseIdx = [0];
    let cursor = 1;

    for (let idx = 1; idx < densePath.length; idx++)
    {
        for (const { entry, dense } of inserts.get(idx) ?? [])
        {
            rebuilt.push(entry);
            denseIdx.push(dense);
        }

        while (cursor < foundPath.length && _samePoint(densePath[idx], foundPath[cursor]))
        {
            rebuilt.push(foundPath[cursor]);
            denseIdx.push(idx);
            cursor++;
        }
    }

    return cursor === foundPath.length ? { rebuilt, denseIdx } : null;
}

function _injectBandLandings(token, context)
{
    const doc = token.document;
    const fp = context?.foundPath;
    if (!Array.isArray(fp) || fp.length < 2 || canvas.grid?.isGridless || isForceDebugMovement())
        return;

    const straightJump = (action) =>
    {
        const { base, free } = parseAction(action ?? doc.movementAction);
        return base === 'jump' && !free && isStraightMove(doc, action ?? doc.movementAction);
    };

    if (!fp.slice(1).some(waypoint => straightJump(waypoint.action)) || fp.some(waypoint => waypoint?._laBandLanding || waypoint?._laSilent))
        return;

    const edges = bandEdges(token);
    if (!edges.maxima.length)
        return;

    let prior = 0;

    try
    {
        prior = Number(/** @type {any} */ (game.modules.get(MODULE_ID))?.api?.getMovementHistory?.(doc.id)?.intentional?.regular ?? 0);
    }
    catch
    {}

    const dims = { width: doc._source.width, height: doc._source.height, shape: doc._source.shape };

    const landings = [];
    let current = fp;
    let lastLanding = null;

    for (let guard = 0; guard < 16; guard++)
    {
        let workPath;
        let measured;

        try
        {
            workPath = doc.getCompleteMovementPath(current);
            measured = doc.measureMovementPath(workPath)?.waypoints ?? [];
        }
        catch
        {
            return;
        }

        const located = _insertAtDense(current, workPath, new Map());
        if (!located || measured.length !== workPath.length)
            return;

        const groups = _hexGroups(workPath);
        const from = lastLanding ? located.denseIdx[current.indexOf(lastLanding)] : 0;
        let found = null;

        for (let group = 1; group < groups.length - 1; group++)
        {
            const here = groups[group];
            if (here.end <= from || here.stop || !straightJump(workPath[here.end].action) || measured[here.end]?.lancerJumpIllegal)
                continue;

            let burned = 0;
            for (let idx = groups[group - 1].end + 1; idx <= here.end; idx++)
                burned += Number(measured[idx]?.lancerStraightBurn) || 0;

            const before = prior + (Number(measured[groups[group - 1].end]?.cost) || 0) + burned;
            const after = prior + (Number(measured[here.end]?.cost) || 0);

            if (after >= actionSpan(edges, before).end - 1e-9)
            {
                found = here;
                break;
            }
        }

        if (!found)
            break;

        const at = workPath[found.end];
        const landing = {
            x: at.x, y: at.y, elevation: landingElevationAt(doc, at, at.elevation ?? 0),
            width: dims.width, height: dims.height, shape: dims.shape, action: at.action,
            snapped: true, explicit: true, checkpoint: true, intermediate: false, _laBandLanding: true
        };
        const inserted = _insertAtDense(current, workPath, new Map([[found.end, [{ entry: landing, dense: found.end }]]]));
        if (!inserted)
            return;

        current = inserted.rebuilt;
        lastLanding = landing;
        landings.push(landing);
    }

    if (!landings.length)
        return;

    context.foundPath = current;
    token._laRoutedLandings ??= new Set();
    for (const landing of landings)
        token._laRoutedLandings.add(`${Math.round(landing.x)}|${Math.round(landing.y)}`);
}

function _pinSilentSpans(doc, rebuilt, denseIndices, densePath, dims)
{
    const cellOf = (waypoint) => doc._positionToGridOffset({ x: Math.round(waypoint.x), y: Math.round(waypoint.y), elevation: waypoint.elevation, width: waypoint.width ?? dims.width, height: waypoint.height ?? dims.height, shape: waypoint.shape ?? dims.shape });
    const flatKeys = (offsets) => offsets.map(offset => `${offset.i},${offset.j}`).filter((key, index, keys) => index === 0 || key !== keys[index - 1]).join('|');
    const samePlace = (first, second) => Math.round(first.x) === Math.round(second.x) && Math.round(first.y) === Math.round(second.y);
    const pinned = [rebuilt[0]];

    for (let index = 1; index < rebuilt.length; index++)
    {
        const from = denseIndices[index - 1];
        const to = denseIndices[index];

        if ((rebuilt[index]._laSilent || rebuilt[index - 1]._laSilent) && to - from > 1)
        {
            try
            {
                const direct = canvas.grid.getDirectPath([cellOf(densePath[from]), cellOf(densePath[to])]);

                if (flatKeys(direct) !== flatKeys(densePath.slice(from, to + 1).map(cellOf)))
                {
                    const hexes = [];
                    let previous = densePath[from];

                    for (let denseIdx = from + 1; denseIdx < to; denseIdx++)
                    {
                        const step = densePath[denseIdx];
                        if (samePlace(step, previous) || samePlace(step, densePath[to]))
                            continue;
                        hexes.push(step);
                        previous = step;
                    }

                    const startElevation = rebuilt[index - 1].elevation ?? densePath[from].elevation ?? 0;
                    const endElevation = rebuilt[index].elevation ?? densePath[to].elevation ?? 0;

                    hexes.forEach((step, order) =>
                    {
                        const elevation = startElevation + (endElevation - startElevation) * (order + 1) / (hexes.length + 1);
                        pinned.push({ x: step.x, y: step.y, elevation, width: dims.width, height: dims.height, shape: dims.shape, action: step.action, snapped: true, explicit: false, checkpoint: false, intermediate: true });
                    });
                }
            }
            catch
            {}
        }

        pinned.push(rebuilt[index]);
    }

    return pinned;
}

// Hidden route bend: checkpoint:false keeps the route one movement; intermediate:true = elevation-resolved geometry.
const _mkRoute = (pt, refs) => ({
    x: pt.x,
    y: pt.y,
    elevation: refs.baseElev,
    width: refs.refWidth,
    height: refs.refHeight,
    shape: refs.refShape,
    action: refs.action,
    snapped: true,
    explicit: false,
    intermediate: true,
    checkpoint: false,
    _laRouted: true
});

function _injectRoute(token, context)
{
    const fp = context?.foundPath;
    if (!Array.isArray(fp) || !fp.length)
        return;
    if (canvas.grid?.isGridless)
        return;
    if (fp.some(/** @type {any} */ (wp) => wp?._laRouted || wp?._laSilent))
        return;

    const unreachable = Array.isArray(context?.unreachableWaypoints) ? context.unreachableWaypoints : [];
    const clipped = unreachable.length > 0 && fp.length > 1 && !fp.at(-1).explicit;

    if (fp.length + unreachable.length < 2)
        return;

    const doc = token.document;
    const src = doc._source;
    const refWidth = src.width, refHeight = src.height, refShape = src.shape;
    const fallbackAction = fp.at(-1)?.action ?? fp[0]?.action ?? 'walk';

    let straightState;

    const straightStateAt = (segStart) =>
    {
        if (straightState === undefined)
        {
            const prefix = routed.slice(0, routed.lastIndexOf(segStart) + 1);
            straightState = prefix.length > 1 ? straightStateAfter(doc, prefix) : straightStartState(doc, segStart);
        }

        return straightState;
    };

    const routeBetween = (segStart, segEnd) =>
    {
        const segAction = segEnd.action ?? fallbackAction;

        try
        {
            if (!isForceDebugMovement() && isStraightMove(doc, segAction))
            {
                const straightRoute = computeStraightRoute(token, segStart, segEnd, { action: segAction, start: straightStateAt(segStart) });
                straightState = straightRoute?.end ?? undefined;
                return straightRoute ? { corners: straightRoute.corners, straight: true } : null;
            }

            straightState = undefined;
            const corners = computeMovementRoute(token, segStart, segEnd, { action: segAction });
            return corners ? { corners, straight: false } : null;
        }
        catch (err)
        {
            straightState = undefined;
            console.warn(`${MODULE_ID} | route search failed for ${token.name}`, err);
            return null;
        }
    };

    const pushCorners = (segStart, segEnd, route) =>
    {
        const refs = { refWidth, refHeight, refShape, action: segEnd.action ?? fallbackAction, baseElev: segStart.elevation ?? doc.elevation ?? 0 };
        const bends = parseAction(refs.action).base === 'jump' ? null : bendKeys;

        for (const corner of route.corners)
        {
            if (route.straight && corner.elevation !== undefined)
            {
                const key = `${Math.round(corner.x)}|${Math.round(corner.y)}`;
                routed.push({ ..._mkRoute(corner, refs), elevation: corner.elevation, intermediate: false, checkpoint: true, explicit: true });
                landingKeys.add(key);
                bends?.add(key);
            }
            else
                routed.push(route.straight ? { ..._mkRoute(corner, refs), intermediate: false, checkpoint: true } : _mkRoute(corner, refs));
        }
    };

    const routed = [fp[0]];
    const landingKeys = new Set();
    const bendKeys = new Set();
    let changed = false;

    for (let segIdx = 1; segIdx < fp.length; segIdx++)
    {
        const segStart = fp[segIdx - 1];
        const segEnd = fp[segIdx];
        const route = routeBetween(segStart, segEnd);

        if (route?.corners.length)
        {
            pushCorners(segStart, segEnd, route);
            changed = true;
        }

        routed.push(segEnd);
    }

    const remaining = [];
    let stuck = false;

    for (const target of unreachable)
    {
        if (stuck)
        {
            remaining.push(target);
            continue;
        }

        const clipPending = clipped && routed.at(-1) === fp.at(-1);
        const segStart = clipPending ? routed.at(-2) : routed.at(-1);

        if (clipPending)
            straightState = undefined;

        const route = routeBetween(segStart, target);

        if (route === null)
        {
            stuck = true;
            remaining.push(target);
            continue;
        }

        if (clipPending)
            routed.pop();
        if (route.corners.length)
            pushCorners(segStart, target, route);
        routed.push(target);
        changed = true;
    }

    if (unreachable.length)
        context.unreachableWaypoints = remaining;
    if (changed)
        context.foundPath = routed;
    token._laRoutedLandings ??= new Set();
    for (const key of landingKeys)
        token._laRoutedLandings.add(key);
    token._laRouteBends ??= new Set();
    for (const key of bendKeys)
        token._laRouteBends.add(key);
}

function _transformContext(token, context, { pathfindOn, triggerOn, tierOn })
{
    token._laRoutedLandings = new Set();
    token._laRouteBends = new Set();
    if (pathfindOn)
        _injectRoute(token, context);
    _injectBandLandings(token, context);
    if (triggerOn || tierOn)
        _injectSilents(token.document, context, { triggerOn, tierOn });
}

function _settingOn(key)
{
    return !!getModuleSetting(key);
}

function _onModifyPlannedMovement(token, context)
{
    _patchDetected = true;
    _transformContext(token, context, { pathfindOn: pathfindDragEnabled(), triggerOn: _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES), tierOn: _settingOn(SPLIT_AT_SPEED_TIERS) });
}

export function injectTriggerSilentsAtDrop(event)
{
    if (_patchDetected)
        return;

    const settings = { pathfindOn: pathfindDragEnabled(), triggerOn: _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES), tierOn: _settingOn(SPLIT_AT_SPEED_TIERS) };
    const contexts = event?.interactionData?.contexts ?? {};

    for (const [tokenId, ctx] of Object.entries(contexts))
    {
        const token = canvas.tokens.get(tokenId);
        if (!token)
            continue;

        try
        {
            _transformContext(token, /** @type {any} */ (ctx), settings);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | drop injection failed for ${tokenId}`, err);
        }
    }
}

export function _transformFoundPath(token, path)
{
    if (!Array.isArray(path) || path.length < 2)
        return path;

    const ctx = { foundPath: path };
    _transformContext(token, ctx, { pathfindOn: pathfindDragEnabled(), triggerOn: _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES), tierOn: _settingOn(SPLIT_AT_SPEED_TIERS) });
    return ctx.foundPath;
}

export function initTerrainTriggerSplits()
{
    Hooks.on('modifyPlannedMovement', _onModifyPlannedMovement);

    // Fallback seam when the modifyPlannedMovement core patch is absent.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype.createTerrainMovementPath', function(wrapped, waypoints, options)
    {
        if (!_patchDetected)
        {
            const dragCtx = this.layer?._draggedToken?.mouseInteractionManager?.interactionData?.contexts?.[this.document.id];

            if (dragCtx && waypoints === dragCtx.foundPath)
            {
                dragCtx.foundPath = _transformFoundPath(this, dragCtx.foundPath);
                waypoints = dragCtx.foundPath;
            }
        }

        return wrapped.call(this, waypoints, options);
    }, 'WRAPPER');
}

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SPLIT_AT_SPEED_TIERS, {
        scope: 'world',
        type: Boolean,
        default: true,
        config: false
    });
    game.settings.register(MODULE_ID, PATHFIND_DRAG_MOVEMENT, {
        scope: 'world',
        type: Boolean,
        default: true,
        config: false
    });
});
