/* global canvas, game, Hooks */

import { getSpeedRanges } from '../combat/speed-provider.js';
import { computeMovementRoute } from './reachability.js';

const MODULE_ID = 'lancer-automations';
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

function _getTriggerKeys(tokenDoc, pos)
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

const _AUTO_ELEV_ACTIONS = new Set(['climb', 'fly']);
let _patchDetected = false;

function _injectSilents(doc, context, { triggerOn = true, tierOn = false } = {})
{
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
    const _posEq = (dense, want) =>
        Math.round(dense.x) === Math.round(want.x)
        && Math.round(dense.y) === Math.round(want.y)
        && (dense.elevation ?? 0) === (want.elevation ?? 0);
    // Emit silents at their real path index; blanket-inserting after origin reorders later segments (zigzag).
    const rebuilt = [context.foundPath[0]];
    let fpCursor = 1;
    let anyInserted = false;
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
            if (transition && !_AUTO_ELEV_ACTIONS.has(waypoint.action) && !_AUTO_ELEV_ACTIONS.has(prev?.action))
            {
                if (prev)
                    rebuilt.push(_mkSilent(prev));
                rebuilt.push(_mkSilent(waypoint));
                anyInserted = true;
            }
            prevKeys = currentKeys;
        }
        if (tierCosts && tierBoundaries && idx < densePath.length - 1 && !_AUTO_ELEV_ACTIONS.has(waypoint.action))
        {
            const costBefore = tierCosts[idx - 1];
            const costAfter = tierCosts[idx];
            for (const boundary of tierBoundaries)
            {
                if (costBefore < boundary && costAfter >= boundary)
                {
                    rebuilt.push(_mkSilent(waypoint));
                    anyInserted = true;
                    break;
                }
            }
        }
        while (fpCursor < context.foundPath.length && _posEq(waypoint, context.foundPath[fpCursor]))
        {
            rebuilt.push(context.foundPath[fpCursor]);
            fpCursor++;
        }
    }
    if (!anyInserted)
        return;
    if (fpCursor !== context.foundPath.length)
        return;
    context.foundPath = rebuilt;
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
    if (!Array.isArray(fp) || fp.length < 2)
        return;
    if (canvas.grid?.isGridless)
        return;
    if (fp.some(/** @type {any} */ (wp) => wp?._laRouted || wp?._laSilent))
        return;

    const doc = token.document;
    const src = doc._source;
    const refWidth = src.width, refHeight = src.height, refShape = src.shape;
    const fallbackAction = fp.at(-1)?.action ?? fp[0]?.action ?? 'walk';

    const routed = [fp[0]];
    let changed = false;
    for (let segIdx = 1; segIdx < fp.length; segIdx++)
    {
        const segStart = fp[segIdx - 1];
        const segEnd = fp[segIdx];
        const segAction = segEnd.action ?? fallbackAction;
        let corners = null;
        try
        {
            corners = computeMovementRoute(token, segStart, segEnd, { action: segAction });
        }
        catch
        {
            corners = null;
        }
        if (corners && corners.length)
        {
            const refs = { refWidth, refHeight, refShape, action: segAction, baseElev: segStart.elevation ?? doc.elevation ?? 0 };
            for (const corner of corners)
                routed.push(_mkRoute(corner, refs));
            changed = true;
        }
        routed.push(segEnd);
    }
    if (changed)
        context.foundPath = routed;
}

function _settingOn(key)
{
    try
    {
        return !!game.settings.get(MODULE_ID, key);
    }
    catch
    {
        return false;
    }
}

function _onModifyPlannedMovement(token, context)
{
    _patchDetected = true;
    const pathfindOn = _settingOn(PATHFIND_DRAG_MOVEMENT);
    const triggerOn = _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES);
    const tierOn = _settingOn(SPLIT_AT_SPEED_TIERS);
    if (!pathfindOn && !triggerOn && !tierOn)
        return;
    if (pathfindOn)
        _injectRoute(token, context);
    if (triggerOn || tierOn)
        _injectSilents(token.document, context, { triggerOn, tierOn });
}

export function injectTriggerSilentsAtDrop(event)
{
    if (_patchDetected)
        return;
    const pathfindOn = _settingOn(PATHFIND_DRAG_MOVEMENT);
    const triggerOn = _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES);
    const tierOn = _settingOn(SPLIT_AT_SPEED_TIERS);
    if (!pathfindOn && !triggerOn && !tierOn)
        return;
    const contexts = event?.interactionData?.contexts ?? {};
    for (const [tokenId, ctx] of Object.entries(contexts))
    {
        const token = canvas.tokens.get(tokenId);
        if (!token)
            continue;
        try
        {
            if (pathfindOn)
                _injectRoute(token, /** @type {any} */ (ctx));
            if (triggerOn || tierOn)
                _injectSilents(token.document, /** @type {any} */ (ctx), { triggerOn, tierOn });
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | drop injection failed for ${tokenId}`, err);
        }
    }
}

function _transformFoundPath(token, path)
{
    if (!Array.isArray(path) || path.length < 2)
        return path;
    const pathfindOn = _settingOn(PATHFIND_DRAG_MOVEMENT);
    const triggerOn = _settingOn(SPLIT_AT_TRIGGER_BOUNDARIES);
    const tierOn = _settingOn(SPLIT_AT_SPEED_TIERS);
    if (!pathfindOn && !triggerOn && !tierOn)
        return path;
    const ctx = { foundPath: path };
    if (pathfindOn)
        _injectRoute(token, ctx);
    if (triggerOn || tierOn)
        _injectSilents(token.document, ctx, { triggerOn, tierOn });
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
        default: false,
        config: false
    });
});
