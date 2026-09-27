/* global CONFIG, canvas, foundry, game, Hooks, PIXI */

import { getSpeedRanges } from '../combat/speed-provider.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { elevationForPreview } from './elevation.js';
import { isForceFreeMovement, isForceDebugMovement, pathfindDragEnabled, currentElevationMode } from './keybindings.js';
import { parseAction } from './movement-actions.js';
import { isHexUnderTerrain } from '../combat/terrain-utils.js';
import { snapElevationForDisplay } from './tactical-distance.js';
import { ISO_SETTINGS, isIsoPerspectiveFeatureEnabled, getIsoProvider } from '../setup/iso-settings.js';
import { playUiSound, WAYPOINT_ADD_SOUND, WAYPOINT_REMOVE_SOUND } from '../tah/sound.js';
import { drawSightlines, clearSightlines } from '../vision/sightlines.js';
import { tokenAtPoint } from '../combat/grid-helpers.js';
import { localize } from '../tools/string-utils.js';

import { MODULE_ID } from '../tools/constants.js';
const ENABLED = 'enableBuiltinSpeedProvider';
const PER_STEP_RENDER = 'rulerPerStepRender';
const MEASURE_SNAP_CENTER = 'measureRulerSnapToCenter';
const LABEL_TEMPLATE = `modules/${MODULE_ID}/templates/lancer-waypoint-label.hbs`;
const MEASURE_LABEL_TEMPLATE = `modules/${MODULE_ID}/templates/lancer-measure-label.hbs`;
// Path hexes running under an overhang fade, so the terrain above still reads
const UNDER_TERRAIN_ALPHA = 0.35;
const HATCH_SRC = `modules/${MODULE_ID}/assets/hatching.png`;
const HATCH_TILES = 4;

let _hatchTexture = null;
let _hatchRequested = false;

function hatchTexture()
{
    if (_hatchTexture)
        return _hatchTexture;
    const cached = /** @type {PIXI.Texture} */ (foundry.canvas.getTexture(HATCH_SRC));
    if (cached?.baseTexture)
    {
        cached.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
        _hatchTexture = cached;
        return cached;
    }
    if (!_hatchRequested)
    {
        _hatchRequested = true;
        foundry.canvas.loadTexture(HATCH_SRC);
    }
    return null;
}

function settingOn()
{
    return !!getModuleSetting(ENABLED);
}

function _isoActive()
{
    return !!getIsoProvider();
}
function _applyIsoCounter(displayObject)
{
    const provider = getIsoProvider();
    if (!provider)
        return;
    displayObject.rotation = provider.reverseRotation;
    displayObject.skew.set(provider.reverseSkewX, provider.reverseSkewY);
    displayObject.scale.set(provider.counterScale, 1 / provider.counterScale);
}

function _isoProjectLabelPos(pos)
{
    // Grape Juice wraps _getWaypointLabelContext and projects the label itself; projecting again doubles it.
    if (!isIsoPerspectiveFeatureEnabled(ISO_SETTINGS.waypointLabel))
        return pos;
    if (!_isoActive())
        return pos;
    const proj = canvas.stage.toGlobal({ x: pos.x, y: pos.y });
    const hud = document.getElementById('hud');
    if (!hud)
        return pos;
    const rect = hud.getBoundingClientRect();
    const zoom = canvas.stage.scale.x || 1;
    return { x: (proj.x - rect.left) / zoom, y: (proj.y - rect.top) / zoom };
}

function perStepRenderOn()
{
    return !!getModuleSetting(PER_STEP_RENDER);
}

function climbWaypointsOn()
{
    return !!getModuleSetting('enableClimbWaypoints');
}

function round(num)
{
    return Math.round((Number(num) || 0) * 100) / 100;
}

function freeMoveColor()
{
    try
    {
        const hex = getModuleSetting('speedProvider.colorFreeMovement') || '#ffffff';
        return parseInt(hex.replace('#', ''), 16);
    }
    catch
    {
        return 0xffffff;
    }
}

function forceMoveColor()
{
    try
    {
        const hex = getModuleSetting('speedProvider.colorForceMovement') || '#8B5CF6';
        return parseInt(hex.replace('#', ''), 16);
    }
    catch
    {
        return 0x8B5CF6;
    }
}

// Fly draws the short dash, blink a dot run, jump one hop per tier-color stretch, everything else solid.
function patternForAction(action)
{
    const base = parseAction(action).base;
    if (base === 'blink')
        return 'dots';
    if (base === 'fly')
        return 'dash';
    if (base === 'jump')
        return 'arc';
    return null;
}

// Illegal jumps bill as walk (cost-rules stamps them), so they render solid too.
function patternForWaypoint(waypoint)
{
    if (waypoint?.measurement?.lancerJumpIllegal)
        return null;
    return patternForAction(waypoint?.action);
}

// Live drag spend per token, for the movement-reach overlay: { dragDelta, end:{x,y,elevation} }.
export const liveDragState = new Map();

function publishLiveDragState(tokenId, next)
{
    const signature = `${Math.round(next.dragDelta * 100)}|${Math.round(next.end.x)}|${Math.round(next.end.y)}|${Math.round((next.end.elevation ?? 0) * 100)}`;
    const prev = liveDragState.get(tokenId);
    if (prev?.signature === signature)
        return;
    liveDragState.set(tokenId, { ...next, signature });
    Hooks.callAll('lancer-automations.dragMoveChanged', tokenId);
}

function clearLiveDragState(tokenId)
{
    if (tokenId && liveDragState.delete(tokenId))
        Hooks.callAll('lancer-automations.dragMoveChanged', tokenId);
}

class LancerTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler
{
    static get WAYPOINT_LABEL_TEMPLATE()
    {
        if (!settingOn())
            return foundry.canvas.placeables.tokens.TokenRuler.WAYPOINT_LABEL_TEMPLATE;
        return LABEL_TEMPLATE;
    }

    // Standalone ruler tool (Measure Distance) snaps to hex centers; token drags keep default snapping.
    static getSnappedPoint(point)
    {
        if (game.activeTool === 'ruler')
            return canvas.grid.getSnappedPoint({ x: point.x, y: point.y }, { mode: globalThis.CONST.GRID_SNAPPING_MODES.CENTER, resolution: 1 });
        return super.getSnappedPoint(point);
    }

    async draw()
    {
        const result = await super.draw();
        if (!settingOn())
            return result;
        this._ensureLineLayer();
        this._ensureTextLayer();
        return result;
    }

    clear()
    {
        if (settingOn())
        {
            this._clearLayer(this._climbLineLayer);
            this._clearLayer(this._climbTextLayer);
        }
        clearLiveDragState(this.token?.document?.id);
        return super.clear();
    }

    _onVisibleChange()
    {
        const result = super._onVisibleChange();
        if (!settingOn())
            return result;
        if (this._climbLineLayer && !this._climbLineLayer.destroyed)
            this._climbLineLayer.visible = this.visible;
        if (this._climbTextLayer && !this._climbTextLayer.destroyed)
            this._climbTextLayer.visible = this.visible;
        return result;
    }

    destroy()
    {
        this._destroyLayer('_climbLineLayer');
        this._destroyLayer('_climbTextLayer');
        clearLiveDragState(this.token?.document?.id);
        return super.destroy();
    }

    refresh(options)
    {
        if (!settingOn())
            return super.refresh(options);
        this._clearLayer(this._climbLineLayer);
        this._clearLayer(this._climbTextLayer);
        this._pendingClimbCells = [];
        this._pendingTerrainCells = [];
        this._pendingSegmentLines = [];
        // super.refresh() repopulates this via _getGridHighlightStyle.
        const anyGlobal = /** @type {any} */ (globalThis);
        anyGlobal._laHexPaintCellsOrdered = [];
        const result = super.refresh(options);
        try
        {
            this._flushClimbArrows();
        }
        catch (e)
        {
            console.warn('lancer-automations | climb arrow render failed', e);
        }
        try
        {
            this._publishDragState(options);
        }
        catch
        { /* reach overlay is best-effort */ }
        return result;
    }

    // Anchor the movement-reach on the last placed waypoint (not the live cursor) with the Lancer cost to reach it; none placed = clear.
    _publishDragState({ plannedMovement } = {})
    {
        const tokenId = this.token?.document?.id;
        if (!tokenId)
            return;
        const foundPath = plannedMovement?.[game.user.id]?.foundPath ?? [];
        let anchor = null;
        let costThroughAnchor = 0;
        let cumCost = 0;
        for (let idx = 0; idx < foundPath.length; idx++)
        {
            const waypoint = foundPath[idx];
            cumCost += Number(waypoint.cost ?? 0);
            const isPlaced = idx > 0 && idx < foundPath.length - 1
                && waypoint.explicit && waypoint.checkpoint && !waypoint.intermediate
                && !waypoint._laClimbFlip;
            if (isPlaced)
            {
                anchor = waypoint;
                costThroughAnchor = cumCost;
            }
        }
        if (!anchor)
        {
            clearLiveDragState(tokenId);
            return;
        }
        const zeroed = anchor.action === 'forced' || parseAction(anchor.action).free || isForceFreeMovement() || isForceDebugMovement();
        publishLiveDragState(tokenId, {
            dragDelta: zeroed ? 0 : costThroughAnchor,
            end: { x: anchor.x, y: anchor.y, elevation: anchor.elevation },
        });
    }

    _clearLayer(layer)
    {
        if (layer && !layer.destroyed)
            layer.removeChildren().forEach(c => c.destroy({ children: true }));
    }

    _destroyLayer(key)
    {
        const layer = this[key];
        if (layer && !layer.destroyed)
        {
            layer.parent?.removeChild(layer);
            layer.destroy({ children: true });
        }
        this[key] = null;
    }

    _ensureLineLayer()
    {
        if (this._climbLineLayer && !this._climbLineLayer.destroyed)
            return this._climbLineLayer;
        const parent = this.token?.layer?._rulerPaths;
        if (!parent)
            return null;
        this._climbLineLayer = new PIXI.Container();
        this._climbLineLayer.eventMode = 'none';
        this._climbLineLayer.visible = !!this.visible;
        parent.addChild(this._climbLineLayer);
        return this._climbLineLayer;
    }

    _ensureTextLayer()
    {
        if (this._climbTextLayer && !this._climbTextLayer.destroyed)
            return this._climbTextLayer;
        const parent = canvas.controls;
        if (!parent)
            return null;
        this._climbTextLayer = new PIXI.Container();
        this._climbTextLayer.eventMode = 'none';
        this._climbTextLayer.visible = !!this.visible;
        parent.addChild(this._climbTextLayer);
        return this._climbTextLayer;
    }

    _flushClimbArrows()
    {
        const cells = this._pendingClimbCells;
        const terrainCells = this._pendingTerrainCells;
        const segLines = this._pendingSegmentLines;
        this._pendingClimbCells = null;
        this._pendingTerrainCells = null;
        this._pendingSegmentLines = null;

        const lineLayer = this._ensureLineLayer();
        const textLayer = this._ensureTextLayer();
        if (!lineLayer || !textLayer)
            return;

        const outline = this._configureOutline?.() ?? { thickness: 1, color: 0x000000 };
        const outlineThickness = outline.thickness ?? 1;
        const outlineColor = outline.color ?? 0x000000;

        const lerpColor = (fromColor, toColor, t) =>
        {
            const fromR = (fromColor >> 16) & 0xff, fromG = (fromColor >> 8) & 0xff, fromB = fromColor & 0xff;
            const toR = (toColor >> 16) & 0xff, toG = (toColor >> 8) & 0xff, toB = toColor & 0xff;
            return ((Math.round(fromR + (toR - fromR) * t) << 16) | (Math.round(fromG + (toG - fromG) * t) << 8) | Math.round(fromB + (toB - fromB) * t));
        };


        const validSegs = (segLines ?? []).filter(segLine => (Array.isArray(segLine.centroids) && segLine.centroids.length >= 2) || segLine.isBlink);
        if (validSegs.length > 0)
        {
            const firstSeg = validSegs[0];
            const widthRef = firstSeg.style?.width ?? 4;
            const fallback = PIXI.Color.shared.setValue(firstSeg.style?.color ?? 0xffffff).toNumber();
            const patternByKey = new Map(validSegs.filter(seg => seg.pattern).map(seg => [seg.waypointKey, seg.pattern]));

            // One point per waypoint, using Foundry's black-dot center calc + tier color.
            // Hex paint iterates reverse so we reverse first.
            const anyGlobal = /** @type {any} */ (globalThis);
            const hexOrdered = (anyGlobal._laHexPaintCellsOrdered ?? []).slice().reverse();
            // Core paints each cell once, so loop revisits are rebuilt from the waypoint chain below.
            const entryColor = (entry) =>
            {
                const raw = entry.isForce
                    ? forceMoveColor()
                    : (entry.isFree
                        ? freeMoveColor()
                        : (entry.tierColor ?? fallback));
                return PIXI.Color.shared.setValue(raw).toNumber();
            };
            const cellColorByKey = new Map();
            for (const entry of hexOrdered)
            {
                if (!cellColorByKey.has(entry.cellKey))
                    cellColorByKey.set(entry.cellKey, entryColor(entry));
            }

            const neverPainted = (chainWp) => !!(chainWp._laSilent || chainWp.unreachable
                || (chainWp.actionConfig?.teleport && chainWp.intermediate)
                || (chainWp.stage === 'planned' && chainWp.previous?.stage === 'passed' && !chainWp.actionConfig?.teleport));

            const renderPts = [];
            const pushSynthesized = (chainWp, nextPt) =>
            {
                if (neverPainted(chainWp))
                    return;
                let centerPt = chainWp.center;
                if (!centerPt)
                {
                    try
                    {
                        centerPt = this.token.document.getCenterPoint(chainWp);
                    }
                    catch
                    {
                        return;
                    }
                }
                const lastPt = renderPts.at(-1);
                if (lastPt && lastPt.x === centerPt.x && lastPt.y === centerPt.y)
                    return;
                if (nextPt && nextPt.x === centerPt.x && nextPt.y === centerPt.y)
                    return;
                const centerCell = canvas.grid.getOffset(centerPt);
                let color = cellColorByKey.get(`(${centerCell.i},${centerCell.j})`);
                if (color === undefined)
                {
                    try
                    {
                        for (const cellOffset of this.token.document.getOccupiedGridSpaceOffsets(chainWp))
                        {
                            const cellColor = cellColorByKey.get(`(${cellOffset.i},${cellOffset.j})`);
                            if (cellColor !== undefined)
                            {
                                color = cellColor;
                                break;
                            }
                        }
                    }
                    catch
                    { /* keep fallback */ }
                }
                const waypointKey = `${Math.round(chainWp.x ?? 0)}|${Math.round(chainWp.y ?? 0)}|${Math.round((chainWp.elevation ?? 0) * 1000)}`;
                renderPts.push({ x: centerPt.x, y: centerPt.y, color: color ?? fallback, waypointKey, isForce: false, isFree: false, pattern: patternForWaypoint(chainWp) });
            };
            const walkForward = (fromWp, toWp) =>
            {
                const between = [];
                let cursorWp = fromWp.next ?? null;
                while (cursorWp && cursorWp !== toWp)
                {
                    between.push(cursorWp);
                    cursorWp = cursorWp.next ?? null;
                }
                return { between, reached: !!toWp && cursorWp === toWp };
            };
            const walkBack = (toWp) =>
            {
                const before = [];
                let cursorWp = toWp.previous ?? null;
                while (cursorWp && !(cursorWp.stage === 'passed' && cursorWp.next?.stage === 'planned'))
                {
                    before.push(cursorWp);
                    cursorWp = cursorWp.previous ?? null;
                }
                return before.reverse();
            };

            let lastCapturedWp = null;
            for (const entry of hexOrdered)
            {
                const entryWp = entry.waypoint ?? null;
                if (entryWp && entryWp === lastCapturedWp)
                    continue;
                let px, py;
                if (entry.waypointCenter)
                {
                    px = entry.waypointCenter.x;
                    py = entry.waypointCenter.y;
                }
                else
                {
                    const center = canvas.grid.getCenterPoint(entry.offset);
                    px = center.x; py = center.y;
                }
                if (entryWp)
                {
                    const entryPt = { x: px, y: py };
                    if (!lastCapturedWp)
                    {
                        for (const chainWp of walkBack(entryWp))
                            pushSynthesized(chainWp, entryPt);
                    }
                    else
                    {
                        const { between, reached } = walkForward(lastCapturedWp, entryWp);
                        for (const chainWp of between)
                            pushSynthesized(chainWp, entryPt);
                        if (!reached)
                        {
                            for (const chainWp of walkBack(entryWp))
                                pushSynthesized(chainWp, entryPt);
                        }
                    }
                }
                renderPts.push({ x: px, y: py, color: entryColor(entry), waypointKey: entry.waypointKey, isForce: !!entry.isForce, isFree: !!entry.isFree, pattern: entry.pattern ?? null });
                if (entryWp)
                    lastCapturedWp = entryWp;
            }
            if (lastCapturedWp)
            {
                for (const chainWp of walkForward(lastCapturedWp, null).between)
                    pushSynthesized(chainWp, null);
            }

            if (renderPts.length >= 2 && widthRef > 0)
            {
                const alpha = 1;
                const dashLen = Math.max(8, Math.round(canvas.grid.size * 0.25));
                const dashGapLen = Math.max(6, Math.round(canvas.grid.size * 0.18));
                const dotSpacing = Math.max(8, Math.round(canvas.grid.size * 0.18));
                const dotRadius = widthRef * 0.9;
                const segByKey = new Map(validSegs.map(seg => [seg.waypointKey, seg]));
                const patternOf = (pt) =>
                {
                    // hop samples are final, never re-resolved through the segment map
                    if (pt.pattern === 'lifted')
                        return null;
                    return pt.pattern ?? patternByKey.get(pt.waypointKey) ?? null;
                };

                // Jump: one hop per tier-color stretch; lifted samples draw as a plain solid polyline.
                const hopLift = (sourcePts) =>
                {
                    const liftedPts = [];
                    // Hops fly the straight chord; colors follow the underlying path by fraction.
                    const liftHop = (hopPts) =>
                    {
                        const cumLens = [0];
                        let totalLen = 0;
                        for (let segIdx = 1; segIdx < hopPts.length; segIdx++)
                        {
                            totalLen += Math.hypot(hopPts[segIdx].x - hopPts[segIdx - 1].x, hopPts[segIdx].y - hopPts[segIdx - 1].y);
                            cumLens.push(totalLen);
                        }
                        const takeoff = hopPts[0];
                        const landing = hopPts[hopPts.length - 1];
                        const chordLen = Math.hypot(landing.x - takeoff.x, landing.y - takeoff.y);
                        if (chordLen <= 0 || totalLen <= 0)
                            return;
                        const colorAtPathLen = (pathDist) =>
                        {
                            for (let segIdx = 1; segIdx < hopPts.length; segIdx++)
                            {
                                if (pathDist <= cumLens[segIdx] || segIdx === hopPts.length - 1)
                                {
                                    const spanLen = cumLens[segIdx] - cumLens[segIdx - 1];
                                    const localFrac = spanLen > 0 ? Math.max(0, Math.min(1, (pathDist - cumLens[segIdx - 1]) / spanLen)) : 1;
                                    return lerpColor(hopPts[segIdx - 1].color, hopPts[segIdx].color, localFrac);
                                }
                            }
                            return landing.color;
                        };
                        const hopHeight = Math.min(canvas.grid.size * 0.5, chordLen * 0.3);
                        const steps = Math.max(2, Math.ceil(chordLen / 8));
                        for (let stepIdx = 1; stepIdx <= steps; stepIdx++)
                        {
                            const frac = stepIdx / steps;
                            liftedPts.push({
                                x: takeoff.x + (landing.x - takeoff.x) * frac,
                                y: takeoff.y + (landing.y - takeoff.y) * frac - Math.sin(Math.PI * frac) * hopHeight,
                                color: colorAtPathLen(totalLen * frac),
                                waypointKey: landing.waypointKey,
                                isForce: landing.isForce,
                                isFree: landing.isFree,
                                pattern: 'lifted'
                            });
                        }
                    };
                    let ptIdx = 0;
                    while (ptIdx < sourcePts.length)
                    {
                        if (ptIdx === 0 || patternOf(sourcePts[ptIdx]) !== 'arc')
                        {
                            liftedPts.push(sourcePts[ptIdx]);
                            ptIdx++;
                            continue;
                        }
                        let runEnd = ptIdx;
                        while (runEnd + 1 < sourcePts.length && patternOf(sourcePts[runEnd + 1]) === 'arc')
                            runEnd++;
                        const arcRun = sourcePts.slice(ptIdx - 1, runEnd + 1);
                        let hopStartPos = 0;
                        for (let ptPos = 1; ptPos < arcRun.length; ptPos++)
                        {
                            const colorEnds = ptPos === arcRun.length - 1 || arcRun[ptPos].color !== arcRun[ptPos + 1].color;
                            if (!colorEnds)
                                continue;
                            liftHop(arcRun.slice(hopStartPos, ptPos + 1));
                            hopStartPos = ptPos;
                        }
                        ptIdx = runEnd + 1;
                    }
                    return liftedPts;
                };
                const drawPts = hopLift(renderPts);

                if (outlineThickness > 0)
                {
                    const outlineG = new PIXI.Graphics();
                    const outlineOpts = {
                        width: widthRef + outlineThickness * 2,
                        color: outlineColor,
                        alpha,
                        join: PIXI.LINE_JOIN.ROUND,
                        cap: PIXI.LINE_CAP.ROUND
                    };
                    outlineG.lineStyle(outlineOpts);
                    let cursor = { x: drawPts[0].x, y: drawPts[0].y };
                    outlineG.moveTo(cursor.x, cursor.y);
                    let drawing = true;
                    let remaining = dashLen;
                    let sinceDot = dotSpacing;
                    for (let ptIdx = 1; ptIdx < drawPts.length; ptIdx++)
                    {
                        const segStart = drawPts[ptIdx - 1];
                        const segEnd = drawPts[ptIdx];
                        const pattern = patternOf(segEnd);
                        if (!pattern)
                        {
                            outlineG.lineTo(segEnd.x, segEnd.y);
                            cursor = { x: segEnd.x, y: segEnd.y };
                            drawing = true;
                            remaining = dashLen;
                            sinceDot = dotSpacing;
                            continue;
                        }
                        const deltaX = segEnd.x - segStart.x;
                        const deltaY = segEnd.y - segStart.y;
                        const segDist = Math.hypot(deltaX, deltaY);
                        if (segDist === 0)
                            continue;
                        const dirX = deltaX / segDist;
                        const dirY = deltaY / segDist;
                        if (pattern === 'dots')
                        {
                            let walked = 0;
                            for (;;)
                            {
                                if (sinceDot >= dotSpacing - 1e-6)
                                {
                                    outlineG.lineStyle({ width: 0 });
                                    outlineG.beginFill(outlineColor, alpha);
                                    outlineG.drawCircle(segStart.x + dirX * walked, segStart.y + dirY * walked, dotRadius + outlineThickness);
                                    outlineG.endFill();
                                    outlineG.lineStyle(outlineOpts);
                                    sinceDot = 0;
                                }
                                if (walked >= segDist)
                                    break;
                                const step = Math.min(segDist - walked, dotSpacing - sinceDot);
                                walked += step;
                                sinceDot += step;
                            }
                            cursor = { x: segEnd.x, y: segEnd.y };
                            outlineG.moveTo(cursor.x, cursor.y);
                            drawing = true;
                            remaining = dashLen;
                            continue;
                        }
                        let walked = 0;
                        while (walked < segDist)
                        {
                            const step = Math.min(segDist - walked, remaining);
                            const next = { x: cursor.x + dirX * step, y: cursor.y + dirY * step };
                            if (drawing)
                                outlineG.lineTo(next.x, next.y);
                            else
                                outlineG.moveTo(next.x, next.y);
                            cursor = next;
                            walked += step;
                            remaining -= step;
                            if (remaining <= 0)
                            {
                                drawing = !drawing;
                                remaining = drawing ? dashLen : dashGapLen;
                            }
                        }
                        sinceDot = dotSpacing;
                    }
                    lineLayer.addChild(outlineG);
                }

                const innerG = new PIXI.Graphics();
                const lineOpts = { width: widthRef, alpha, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND };
                const patternColorAtFrac = (segInfo, frac) =>
                {
                    if (segInfo?.isForce)
                        return PIXI.Color.shared.setValue(forceMoveColor()).toNumber();
                    if (segInfo?.isFree)
                        return PIXI.Color.shared.setValue(freeMoveColor()).toNumber();
                    const baseCum = Number(segInfo?.baseCum ?? 0);
                    const cost = baseCum + Math.max(0, Math.min(1, frac)) * Number(segInfo?.segCost ?? 0);
                    const tc = this._tierColorAtDistance(cost);
                    return PIXI.Color.shared.setValue(tc ?? fallback).toNumber();
                };

                let cursor = { x: drawPts[0].x, y: drawPts[0].y };
                innerG.moveTo(cursor.x, cursor.y);
                let drawing = true;
                let remaining = dashLen;
                let sinceDot = dotSpacing;
                let currentColor = drawPts[0].color;
                innerG.lineStyle({ ...lineOpts, color: currentColor });
                for (let ptIdx = 1; ptIdx < drawPts.length; ptIdx++)
                {
                    const segStart = drawPts[ptIdx - 1];
                    const segEnd = drawPts[ptIdx];
                    const deltaX = segEnd.x - segStart.x;
                    const deltaY = segEnd.y - segStart.y;
                    const segDist = Math.hypot(deltaX, deltaY);
                    if (segDist === 0)
                        continue;
                    const pattern = patternOf(segEnd);
                    if (!pattern)
                    {
                        if (segStart.color === segEnd.color)
                        {
                            if (segStart.color !== currentColor)
                            {
                                innerG.lineStyle({ ...lineOpts, color: segStart.color });
                                currentColor = segStart.color;
                            }
                            innerG.lineTo(segEnd.x, segEnd.y);
                        }
                        else
                        {
                            const lerpSteps = 8;
                            for (let k = 1; k <= lerpSteps; k++)
                            {
                                const t = k / lerpSteps;
                                const x = segStart.x + (segEnd.x - segStart.x) * t;
                                const y = segStart.y + (segEnd.y - segStart.y) * t;
                                const col = lerpColor(segStart.color, segEnd.color, (k - 0.5) / lerpSteps);
                                if (col !== currentColor)
                                {
                                    innerG.lineStyle({ ...lineOpts, color: col });
                                    currentColor = col;
                                }
                                innerG.lineTo(x, y);
                            }
                        }
                        cursor = { x: segEnd.x, y: segEnd.y };
                        drawing = true;
                        remaining = dashLen;
                        sinceDot = dotSpacing;
                        continue;
                    }
                    const segInfo = segByKey.get(segEnd.waypointKey);
                    // Cost-ramp color only when the pair is the whole segment (blink); per-hex points carry the tiers.
                    const rampInfo = segInfo && (segInfo.centroids?.length ?? 0) < 2 ? segInfo : null;
                    const colorAtFrac = (frac) => rampInfo
                        ? patternColorAtFrac(rampInfo, frac)
                        : lerpColor(segStart.color, segEnd.color, frac);
                    const dirX = deltaX / segDist;
                    const dirY = deltaY / segDist;
                    if (pattern === 'dots')
                    {
                        let walked = 0;
                        for (;;)
                        {
                            if (sinceDot >= dotSpacing - 1e-6)
                            {
                                const col = colorAtFrac(walked / segDist);
                                innerG.lineStyle({ width: 0 });
                                innerG.beginFill(col, alpha);
                                innerG.drawCircle(segStart.x + dirX * walked, segStart.y + dirY * walked, dotRadius);
                                innerG.endFill();
                                innerG.lineStyle({ ...lineOpts, color: currentColor });
                                sinceDot = 0;
                            }
                            if (walked >= segDist)
                                break;
                            const step = Math.min(segDist - walked, dotSpacing - sinceDot);
                            walked += step;
                            sinceDot += step;
                        }
                        cursor = { x: segEnd.x, y: segEnd.y };
                        innerG.moveTo(cursor.x, cursor.y);
                        drawing = true;
                        remaining = dashLen;
                        continue;
                    }
                    let walked = 0;
                    while (walked < segDist)
                    {
                        const step = Math.min(segDist - walked, remaining);
                        const next = { x: cursor.x + dirX * step, y: cursor.y + dirY * step };
                        if (drawing)
                        {
                            const frac = (walked + step / 2) / segDist;
                            const col = colorAtFrac(frac);
                            if (col !== currentColor)
                            {
                                innerG.lineStyle({ ...lineOpts, color: col });
                                currentColor = col;
                            }
                            innerG.lineTo(next.x, next.y);
                        }
                        else
                            innerG.moveTo(next.x, next.y);
                        cursor = next;
                        walked += step;
                        remaining -= step;
                        if (remaining <= 0)
                        {
                            drawing = !drawing;
                            remaining = drawing ? dashLen : dashGapLen;
                        }
                    }
                    sinceDot = dotSpacing;
                }
                lineLayer.addChild(innerG);
            }
        }

        if (Array.isArray(cells) && cells.length)
        {
            const fontSize = Math.max(10, Math.round(canvas.grid.size * 0.15));
            const textStyle = foundry.canvas.containers.PreciseText.getTextStyle({
                fontFamily: 'Signika',
                fontSize,
                fontWeight: '700',
                fill: '#ffffff',
                stroke: '#000000',
                strokeThickness: Math.max(3, Math.round(fontSize * 0.2)),
                align: 'center'
            });
            for (const cell of cells)
            {
                const label = `${cell.delta > 0 ? '↑' : '↓'}${Math.abs(cell.delta)}`;
                const text = new foundry.canvas.containers.PreciseText(label, textStyle);
                text.anchor.set(0.5, 0.5);
                text.position.set(cell.x, cell.y);
                _applyIsoCounter(text);
                textLayer.addChild(text);
            }
        }

        if (Array.isArray(terrainCells) && terrainCells.length)
        {
            const fontSize = Math.max(10, Math.round(canvas.grid.size * 0.15));
            const warnStyle = foundry.canvas.containers.PreciseText.getTextStyle({
                fontFamily: 'Signika',
                fontSize,
                fontWeight: '700',
                fill: '#ff6d33ff',
                stroke: '#000000',
                strokeThickness: Math.max(3, Math.round(fontSize * 0.2)),
                align: 'center'
            });
            for (const c of terrainCells)
            {
                const text = new foundry.canvas.containers.PreciseText('⚠', warnStyle);
                text.anchor.set(0.5, 0.5);
                text.position.set(c.x, c.y);
                _applyIsoCounter(text);
                textLayer.addChild(text);
            }
        }
    }

    /** LA move-data for a PASSED waypoint by movementId; null for live drag (no movementId) or no LA entry (pre-LA or debug move). */
    _passedMoveData(waypoint)
    {
        if (waypoint?.stage !== 'passed' || !waypoint.movementId)
            return null;
        const laApi = game.modules.get(MODULE_ID)?.api;
        const moves = laApi?.getMoveDataList?.(this.token.document.id) ?? [];
        return moves.find(m => m.movementId === waypoint.movementId) || null;
    }

    // Sums regular move costs up to this waypoint; free moves contribute 0, matching the cap exclusion.
    _cumulativeRegularCostThrough(waypoint)
    {
        const sourceHistory = this.token.document._source?._movementHistory ?? [];
        if (!sourceHistory.length)
            return 0;
        const laApi = game.modules.get(MODULE_ID)?.api;
        const moves = laApi?.getMoveDataList?.(this.token.document.id) ?? [];
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        const regularMoves = new Map(
            moves.filter(moveEntry => moveEntry.isDrag && !moveEntry.isFreeMovement && moveEntry.movementId).map(moveEntry => [moveEntry.movementId, moveEntry])
        );
        let total = 0;
        const countedOverrides = new Set();
        let inWaypointMove = false;
        for (const entry of sourceHistory)
        {
            if (entry.movementId === waypoint.movementId)
                inWaypointMove = true;
            else if (inWaypointMove)
                break;
            const laMove = regularMoves.get(entry.movementId);
            if (laMove?.costOverridden)
            {
                // Billed once per movement, not per measured segment.
                if (!countedOverrides.has(entry.movementId))
                {
                    countedOverrides.add(entry.movementId);
                    total += (laMove.movementCost ?? 0) * sceneDistance;
                }
            }
            else if (laMove)
            {
                const cost = entry.cost;
                if (cost !== null && cost !== undefined && cost !== Infinity)
                    total += cost;
            }
            // hex centers are irrational, so snapped vs recorded coords drift by float hairs
            if (entry.movementId === waypoint.movementId
                && Math.abs(entry.x - waypoint.x) < 1 && Math.abs(entry.y - waypoint.y) < 1
                && Math.abs((entry.elevation ?? 0) - (waypoint.elevation ?? 0)) < 0.001)
                break;
        }
        return total;
    }

    _tierForWaypoint(waypoint)
    {
        if (!settingOn())
            return undefined;
        const ranges = getSpeedRanges(this.token);
        if (!ranges.length)
            return undefined;
        let total;
        const mCost = Number(waypoint.measurement?.cost);
        if (waypoint.stage === 'passed' && this._passedMoveData(waypoint))
            total = this._cumulativeRegularCostThrough(waypoint);
        else if (Number.isFinite(mCost))
            total = mCost;
        else if (waypoint.stage === 'passed')
            total = this._cumulativeRegularCostThrough(waypoint);
        else
        {
            const laApi = game.modules.get(MODULE_ID)?.api;
            const prior = Number(laApi?.getMovementHistory?.(this.token.document.id)?.intentional?.regular ?? 0);
            let lastPassed = waypoint.previous;
            while (lastPassed && lastPassed.stage !== 'passed')
                lastPassed = lastPassed.previous;
            const passedCost = Number(lastPassed?.measurement?.cost ?? 0);
            const dragDelta = Math.max(0, Number(waypoint.measurement?.cost ?? 0) - passedCost);
            total = prior + dragDelta;
        }
        for (const r of ranges)
        {
            if (total <= r.max + 1e-9)
                return r;
        }
        return null; // over max
    }

    _computeSegmentStyle(waypoint)
    {
        const base = super._getSegmentStyle(waypoint);
        if (!settingOn())
            return base;
        if (!base.width)
            return base;
        if (waypoint.action === 'forced')
            return { ...base, color: forceMoveColor() };
        if (parseAction(waypoint.action).free)
            return { ...base, color: freeMoveColor() };
        if (waypoint.stage !== 'passed')
        {
            if (isForceDebugMovement())
                return { ...base, alpha: 0 };
            if (isForceFreeMovement())
                return { ...base, color: freeMoveColor() };
        }
        else
        {
            const moveData = this._passedMoveData(waypoint);
            if (moveData && moveData.isForceMovement)
                return { ...base, color: forceMoveColor() };
            if (moveData && (moveData.isFreeMovement || !moveData.isDrag))
                return { ...base, color: freeMoveColor() };
            // No LA entry but a real movementId = debug-mode move; skip drawing it.
            if (waypoint.movementId && moveData === null
                && (game.modules.get(MODULE_ID)?.api?.getMoveDataList?.(this.token.document.id)?.length ?? 0) > 0)

                return { ...base, alpha: 0 };

        }
        const tier = this._tierForWaypoint(waypoint);
        if (tier === undefined)
            return base;
        if (tier === null)
            return { ...base, color: 0x000000, alpha: 0.6 };
        return { ...base, color: tier.color };
    }

    _getWaypointStyle(waypoint)
    {
        if (waypoint?._laSilent)
            return { radius: 0 };
        return super._getWaypointStyle(waypoint);
    }

    _getSegmentStyle(waypoint)
    {
        if (waypoint?._laSilent)
            return { width: 0 };
        // Debug moves draw no cost decorations.
        if (waypoint?.stage !== 'passed' && isForceDebugMovement())
            return this._computeSegmentStyle(waypoint);
        // auto-climb sub-segment: the group's polyline handles it, hide the native line.
        if (waypoint?.measurement?.lancerSkipNativeSegment === true)
            return { width: 0 };
        const cells = waypoint?.measurement?.lancerClimbCells;
        if (!climbWaypointsOn() && waypoint?.stage !== 'passed' && Array.isArray(cells) && cells.length && Array.isArray(this._pendingClimbCells))
            this._pendingClimbCells.push(...cells);
        const tCells = waypoint?.measurement?.lancerTerrainCells;
        if (waypoint?.stage !== 'passed' && Array.isArray(tCells) && tCells.length && Array.isArray(this._pendingTerrainCells))
            this._pendingTerrainCells.push(...tCells);
        const style = this._computeSegmentStyle(waypoint);
        if (!perStepRenderOn())
            return style;
        if (style.alpha === 0)
            return style;
        const centroids = waypoint?.measurement?.lancerStepCentroids;
        const hasCentroids = Array.isArray(centroids) && centroids.length >= 2;
        const isBlink = parseAction(waypoint.action).base === 'blink';
        const blinkWithoutCentroids = isBlink && !hasCentroids && !canvas.grid?.isGridless;
        if ((hasCentroids || blinkWithoutCentroids) && Array.isArray(this._pendingSegmentLines))
        {
            const baseCum = this._segmentBaseCumulative(waypoint);
            const isFree = style.color === freeMoveColor();
            const isForce = waypoint.action === 'forced' || style.color === forceMoveColor();
            const moveData = waypoint.stage === 'passed' ? this._passedMoveData(waypoint) : null;
            const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
            // Overridden legs color by billed cost, not the measured dogleg.
            const segCost = moveData?.costOverridden
                ? (moveData.movementCost ?? 0) * sceneDistance
                : Number(waypoint?.measurement?.backward?.cost ?? 0);
            const waypointKey = `${Math.round(waypoint.x ?? 0)}|${Math.round(waypoint.y ?? 0)}|${Math.round((waypoint.elevation ?? 0) * 1000)}`;
            this._pendingSegmentLines.push({ centroids: hasCentroids ? centroids : [], style, baseCum, segCost, isFree, isForce, isBlink, pattern: patternForWaypoint(waypoint), waypointKey });
            return { ...style, width: 0 };
        }
        // No polyline to draw (e.g. gridless), so keep the native line.
        return style;
    }

    _segmentBaseCumulative(waypoint)
    {
        if (waypoint?.stage === 'passed')
            return this._cumulativeRegularCostThrough(waypoint?.previous ?? waypoint);
        const laApi = game.modules.get(MODULE_ID)?.api;
        const prior = Number(laApi?.getMovementHistory?.(this.token.document.id)?.intentional?.regular ?? 0);
        let lastPassed = waypoint.previous;
        while (lastPassed && lastPassed.stage !== 'passed')
            lastPassed = lastPassed.previous;
        const passedCost = Number(lastPassed?.measurement?.cost ?? 0);
        const segStart = Number(waypoint.previous?.measurement?.cost ?? passedCost);
        return prior + Math.max(0, segStart - passedCost);
    }

    _tierColorAtDistance(totalDist)
    {
        if (!settingOn())
            return null;
        const ranges = getSpeedRanges(this.token);
        if (!ranges.length)
            return null;
        for (const r of ranges)
        {
            if (totalDist <= r.max + 1e-9)
                return r.color;
        }
        return 0x000000;
    }

    _getGridHighlightStyle(waypoint, offset)
    {
        let style = this._laGridHighlightStyle(waypoint, offset);
        if (!(style?.alpha > 0))
            return style;
        if (waypoint._laBrushed || parseAction(waypoint.action).base === 'ignore')
        {
            const texture = hatchTexture();
            if (texture)
            {
                const scale = canvas.grid.size / (texture.width * HATCH_TILES);
                style = { ...style, texture, matrix: new PIXI.Matrix().scale(scale, scale) };
            }
        }
        if (isHexUnderTerrain(offset.j, offset.i, waypoint.elevation ?? 0))
            style = { ...style, alpha: style.alpha * UNDER_TERRAIN_ALPHA };
        return style;
    }

    _laGridHighlightStyle(waypoint, offset)
    {
        // Silent region-boundary waypoint (animation slowdown only).
        if (waypoint._laSilent)
            return { alpha: 0 };
        const base = super._getGridHighlightStyle(waypoint, offset);
        // Tag each cell with its waypoint key + Foundry's shape center so _flushClimbArrows draws the polyline through the black-dot center.
        if (base?.alpha > 0 && settingOn())
        {
            const anyGlobal = /** @type {any} */ (globalThis);
            anyGlobal._laHexPaintCellsOrdered = anyGlobal._laHexPaintCellsOrdered || [];
            let centerPt = waypoint.center;
            if (!centerPt)
            {
                try
                {
                    centerPt = this.token.document.getCenterPoint(waypoint);
                }
                catch
                {
                    centerPt = null;
                }
            }
            const waypointKey = `${Math.round(waypoint.x ?? 0)}|${Math.round(waypoint.y ?? 0)}|${Math.round((waypoint.elevation ?? 0) * 1000)}`;
            // Capture the tier color now so the polyline matches the hex paint (same cumulative cost).
            const isForcedHere = waypoint.action === 'forced';
            const isFreeHere = parseAction(waypoint.action).free || (waypoint.stage !== 'passed' && isForceFreeMovement());
            let tierColor = null;
            if (settingOn() && !isForcedHere
                && !(waypoint.stage !== 'passed' && isForceDebugMovement())
                && !isFreeHere)
            {
                const tier = this._tierForWaypoint(waypoint);
                if (tier === null)
                    tierColor = 0x000000;
                else if (tier !== undefined)
                    tierColor = tier.color;
            }
            anyGlobal._laHexPaintCellsOrdered.push({
                cellKey: `(${offset.i},${offset.j})`,
                offset: { i: offset.i, j: offset.j },
                waypoint,
                waypointKey,
                waypointCenter: centerPt ? { x: centerPt.x, y: centerPt.y } : null,
                tierColor,
                isForce: isForcedHere,
                isFree: isFreeHere,
                pattern: patternForWaypoint(waypoint)
            });
        }
        if (!settingOn())
            return base;
        if (!(base.alpha > 0))
            return base;
        if (waypoint.action === 'forced')
            return { ...base, color: forceMoveColor(), alpha: 0.35 };
        if (parseAction(waypoint.action).free)
            return { ...base, color: freeMoveColor(), alpha: 0.35 };
        if (waypoint.stage !== 'passed')
        {
            if (isForceDebugMovement())
                return { ...base, alpha: 0 };
            if (isForceFreeMovement())
                return { ...base, color: freeMoveColor(), alpha: 0.35 };
        }
        else
        {
            const moveData = this._passedMoveData(waypoint);
            if (moveData && moveData.isForceMovement)
                return { ...base, color: forceMoveColor(), alpha: 0.35 };
            if (moveData && (moveData.isFreeMovement || !moveData.isDrag))
                return { ...base, color: freeMoveColor(), alpha: 0.35 };
            if (waypoint.movementId && moveData === null
                && (game.modules.get(MODULE_ID)?.api?.getMoveDataList?.(this.token.document.id)?.length ?? 0) > 0)

                return { ...base, alpha: 0 };

        }
        const tier = this._tierForWaypoint(waypoint);
        if (tier === undefined)
            return base;
        if (tier === null)
            return { ...base, color: 0x000000, alpha: 0.35 };
        return { ...base, color: tier.color, alpha: 0.35 };
    }

    _getWaypointLabelContext(waypoint, _state)
    {
        if (!settingOn())
        {
            const base = super._getWaypointLabelContext(waypoint, _state);
            if (base?.position)
                base.position = _isoProjectLabelPos(base.position);
            return base;
        }
        if (!waypoint.previous)
            return null;
        if (!waypoint.explicit && waypoint.next
            && waypoint.actionConfig?.visualize && waypoint.next.actionConfig?.visualize
            && waypoint.action === waypoint.next.action)
            return null;
        if (waypoint.stage === 'passed' && waypoint.next?.stage === 'pending')
            return null;

        const measurement = waypoint.measurement;
        if (!measurement)
            return null;

        const ray = waypoint.ray;
        if (!ray)
            return null;

        const isForceLabel = waypoint.action === 'forced';
        const isFreeLabel = parseAction(waypoint.action).free;
        const isDistanceLabel = isForceLabel || isFreeLabel;
        const totalCost = isDistanceLabel ? round(measurement.distance) : round(measurement.cost);
        let deltaCost = isDistanceLabel ? round(measurement.backward?.distance ?? 0) : round(measurement.backward?.cost ?? 0);
        // Measure delta against the last user-clicked waypoint, skipping silents and intermediates.
        const skip = (wp) => wp && (!wp.explicit || wp.intermediate);
        if (skip(waypoint.previous))
        {
            let prev = waypoint.previous;
            while (skip(prev))
                prev = prev.previous;
            const prevTotal = isDistanceLabel ? round(prev?.measurement?.distance ?? 0) : round(prev?.measurement?.cost ?? 0);
            deltaCost = totalCost - prevTotal;
        }

        // Endpoint shows the landing elevation; mid-path waypoints show their planned (held) altitude.
        const destElev = waypoint.next
            ? (waypoint.elevation ?? this.token.document.elevation ?? 0)
            : elevationForPreview(this.token.document, waypoint);
        const prevElev = waypoint.previous?.elevation ?? this.token.document.elevation ?? 0;
        const elevDelta = snapElevationForDisplay(destElev - prevElev);
        const elevArrow = elevDelta > 0 ? 'fa-solid fa-arrow-up'
            : elevDelta < 0 ? 'fa-solid fa-arrow-down'
                : '';

        // Vertical cost goes through the elevation arrow, not this number.
        // Penalty stamps sit on group-end waypoints (silents split cost groups), so sum the whole leg.
        const debugMove = isForceDebugMovement();
        let penaltyRaw = (measurement.lancerClimbMalus ?? 0) + (measurement.lancerTerrainPenalty ?? 0);
        let zoneRaw = !!measurement.lancerPenaltyZone;
        for (let prevWp = waypoint.previous; prevWp && skip(prevWp) && prevWp.stage !== 'passed'; prevWp = prevWp.previous)
        {
            penaltyRaw += (prevWp.measurement?.lancerClimbMalus ?? 0) + (prevWp.measurement?.lancerTerrainPenalty ?? 0);
            zoneRaw = zoneRaw || !!prevWp.measurement?.lancerPenaltyZone;
        }
        const penalty = debugMove ? 0 : round(penaltyRaw);
        const penaltyZone = !debugMove && zoneRaw;

        const deltaShown = deltaCost && deltaCost !== totalCost ? deltaCost : 0;
        const showSecondLine = !debugMove && !!(deltaShown || elevArrow || penalty || penaltyZone);
        const units = canvas.scene?.grid?.units ?? '';
        const isLast = !waypoint.next;
        const uiScale = canvas.dimensions.uiScale;

        let ringColor = '';
        try
        {
            const tier = this._tierForWaypoint(waypoint);
            if (tier && tier.color !== undefined)
                ringColor = PIXI.Color.shared.setValue(tier.color).toHex();
        }
        catch
        { /* neutral ring */ }

        const labelPos = _isoProjectLabelPos({ x: ray.B.x, y: ray.B.y });

        return {
            cssClass: [isLast ? 'last' : '', isForceLabel ? 'force' : '', isFreeLabel ? 'free' : ''].filter(Boolean).join(' '),
            position: labelPos,
            uiScale,
            action: waypoint.actionConfig,
            totalCost,
            deltaCost: deltaShown,
            elevArrow,
            elevAbs: Math.abs(elevDelta),
            penalty,
            penaltyZone,
            showSecondLine,
            ringColor,
            showPathfind: isLast && !!getModuleSetting('pathfindDragMovement'),
            pathfindOn: pathfindDragEnabled(),
            showElevMode: isLast && !!currentElevationMode(),
            elevMode: currentElevationMode(),
            elevIcon: currentElevationMode() === 'hold' ? 'fa-arrow-up-to-line' : 'fa-arrow-down-to-line',
            units
        };
    }
}

import { thtGroundAt as _thtGroundAt } from './movement-utils.js';

function _measureTerrainElevDisabled()
{
    return !!getModuleSetting('disableAutoElevationOnMeasure')
        || !!getModuleSetting('disableAutoTerrainElevation');
}

const LOS_KEY = 'ruler-los';
const EMPTY_SPACE_HEIGHT = 1;

let _sightlineMode = false;
let _sightlineVerdict = null;

export function sightlineModeActive()
{
    return _sightlineMode;
}

function toggleSightlineMode()
{
    _sightlineMode = !_sightlineMode;
    _sightlineVerdict = null;
    clearSightlines(LOS_KEY);
    const ruler = canvas.controls?.ruler;
    ruler?._refreshSightlines?.();
    Hooks.callAll('lancer-automations.sightlineModeChanged', _sightlineMode);
    ruler?.refresh();
}

function _sightlineRef(point)
{
    const token = tokenAtPoint(point.x, point.y);
    if (token)
        return token;
    const center = canvas.grid.getCenterPoint(point);
    const ground = _thtGroundAt(center);
    return {
        x: center.x,
        y: center.y,
        h: ground + (point.elevation || 0) + EMPTY_SPACE_HEIGHT,
        cells: [center]
    };
}

function _sightlineVerdictFor(result)
{
    if (!result)
        return null;
    if (result.rays.some(ray => ray.clear))
        return 'clear';
    return result.witness ? 'peek' : 'blocked';
}

// Recasts the core measure-label context into the token-ruler badge shape.
function _measureBadgeContext(ctx, waypoint)
{
    const isLast = !waypoint.next;
    // The arrow carries the direction, so the row shows how far this step climbed or dropped, never the absolute height.
    const step = Number(ctx.elevation?.step ?? 0) || 0;
    const elevIcon = step > 0 ? 'fa-solid fa-arrow-up' : step < 0 ? 'fa-solid fa-arrow-down' : '';
    const delta = ctx.distance?.delta ?? '';
    const total = ctx.distance?.total ?? '';
    const horizontal = ctx.distance?.flatHidden === false ? ctx.distance.flat : '';
    const los = isLast ? _sightlineVerdict : null;
    const deltaDistance = los ? '' : delta;
    // Core lifts every label 16px; the endpoint needs it because the cursor sits there, the rest read better centred.
    const position = isLast
        ? ctx.position
        : { x: ctx.position.x, y: ctx.position.y + (16 * ctx.uiScale) };
    return {
        ...ctx,
        cssClass: [isLast ? 'last' : '', ctx.secret ? 'secret' : '', los ? `los-${los}` : ''].filter(Boolean).join(' '),
        position,
        iconClass: _sightlineMode ? 'fa-solid fa-eye' : (ctx.action?.icon ?? 'fa-solid fa-ruler'),
        totalDistance: total,
        horizontal,
        deltaDistance,
        los,
        losIcon: los === 'blocked' ? 'fa-solid fa-eye-slash' : 'fa-solid fa-eye',
        losLabel: los ? localize(`LA.ruler.los.${los}`) : '',
        elevIcon,
        elevAbs: Math.abs(step),
        showSecondLine: !!(deltaDistance || horizontal !== '' || elevIcon)
    };
}

class LancerCanvasRuler extends foundry.canvas.interaction.Ruler
{
    static get WAYPOINT_LABEL_TEMPLATE()
    {
        if (!settingOn())
            return foundry.canvas.interaction.Ruler.WAYPOINT_LABEL_TEMPLATE;
        return MEASURE_LABEL_TEMPLATE;
    }

    static getSnappedPoint(point)
    {
        if (!getModuleSetting(MEASURE_SNAP_CENTER))
            return super.getSnappedPoint(point);
        return canvas.grid.getSnappedPoint({ x: point.x, y: point.y }, { mode: globalThis.CONST.GRID_SNAPPING_MODES.CENTER, resolution: 1 });
    }

    _onDragStart(event)
    {
        super._onDragStart(event);
        this._laLastCell = undefined;
    }

    _onPathChange()
    {
        this._laLegs = null;
        this._refreshSightlines();
        super._onPathChange();
    }

    _refreshSightlines()
    {
        if (!this.user?.isSelf)
            return;
        _sightlineVerdict = null;
        if (!_sightlineMode || !this.active || !getModuleSetting('lancerLos'))
        {
            clearSightlines(LOS_KEY);
            return;
        }
        const path = this.path;
        const from = path?.[0];
        const to = path?.at?.(-1);
        if (!from || from === to)
        {
            clearSightlines(LOS_KEY);
            return;
        }
        const viewer = _sightlineRef(from);
        const target = _sightlineRef(to);
        if (viewer === target)
        {
            clearSightlines(LOS_KEY);
            return;
        }
        const [result] = drawSightlines(LOS_KEY, viewer, [target]);
        _sightlineVerdict = _sightlineVerdictFor(result);
    }

    destroy()
    {
        clearSightlines(LOS_KEY);
        return super.destroy();
    }

    _onMouseMove(event)
    {
        super._onMouseMove(event);
        if (!this.active)
            return;
        const end = this.path?.at?.(-1);
        if (!end)
            return;
        const off = canvas.grid.getOffset(end);
        const key = `${off.i},${off.j}`;
        if (key === this._laLastCell)
            return;
        if (this._laLastCell !== undefined)
            playUiSound('tokenDrag');
        this._laLastCell = key;
    }

    _addDragWaypoint(point, options)
    {
        const before = this.path?.length ?? 0;
        const result = super._addDragWaypoint(point, options);
        if ((this.path?.length ?? 0) > before)
            playUiSound(WAYPOINT_ADD_SOUND);
        return result;
    }

    _removeDragWaypoint()
    {
        const hadWaypoint = (this.path?.length ?? 0) > 2;
        const result = super._removeDragWaypoint();
        if (hadWaypoint)
            playUiSound(WAYPOINT_REMOVE_SOUND);
        return result;
    }

    _getWaypointLabelContext(waypoint, state)
    {
        const ctx = this._coreLabelContext(waypoint, state);
        if (!ctx || !settingOn())
            return ctx;
        return _measureBadgeContext(ctx, waypoint);
    }

    _measureLegs()
    {
        const path = this.path ?? [];
        if (path.length < 2)
        {
            this._laLegs = null;
            return null;
        }
        const ignoreGround = _measureTerrainElevDisabled();
        const full = path.map(point => ({
            x: point.x,
            y: point.y,
            elevation: (ignoreGround ? 0 : _thtGroundAt(point)) + (point.elevation || 0)
        }));
        const flat = path.map(point => ({ x: point.x, y: point.y, elevation: 0 }));
        this._laLegs = {
            length: path.length,
            total: canvas.grid.measurePath(full).waypoints.map(entry => entry.distance),
            flat: canvas.grid.measurePath(flat).waypoints.map(entry => entry.distance)
        };
        return this._laLegs;
    }

    _legsFor(waypoint)
    {
        let legs = this._laLegs;
        if (!legs || legs.length !== (this.path?.length ?? 0))
            legs = this._measureLegs();
        if (!legs)
            return null;
        const total = legs.total[waypoint.index];
        const flat = legs.flat[waypoint.index];
        if (!Number.isFinite(total) || !Number.isFinite(flat))
            return null;
        return { total, flat, back: total - (legs.total[waypoint.index - 1] ?? total) };
    }

    _coreLabelContext(waypoint, state)
    {
        const ctx = super._getWaypointLabelContext(waypoint, state);
        if (ctx?.position)
            ctx.position = _isoProjectLabelPos(ctx.position);
        if (!settingOn())
            return ctx;
        const legs = ctx?.distance ? this._legsFor(waypoint) : null;
        if (legs)
        {
            const total = round(legs.total);
            const flat = round(legs.flat);
            ctx.distance.total = total.toLocaleString(game.i18n.lang);
            ctx.distance.flat = flat.toLocaleString(game.i18n.lang);
            ctx.distance.flatHidden = total === flat;
            const back = round(legs.back);
            if (waypoint.index >= 2 && back)
                ctx.distance.delta = back > 0 ? `+${back}` : `${back}`;
        }
        if (!ctx?.elevation || !waypoint.previous)
            return ctx;
        const groundHere = _measureTerrainElevDisabled() ? 0 : _thtGroundAt(waypoint);
        const groundPrev = _measureTerrainElevDisabled() ? 0 : _thtGroundAt(waypoint.previous);
        const here = groundHere + (waypoint.elevation || 0);
        const prev = groundPrev + (waypoint.previous.elevation || 0);
        const delta = here - prev;
        ctx.elevation.total = here;
        ctx.elevation.step = delta;
        ctx.elevation.hidden = here === 0 && delta === 0;
        if (delta > 0)
        {
            ctx.elevation.icon = 'fa-solid fa-arrow-up';
            ctx.elevation.delta = `+${delta}`;
        }
        else if (delta < 0)
        {
            ctx.elevation.icon = 'fa-solid fa-arrow-down';
            ctx.elevation.delta = `${delta}`;
        }
        else
            delete ctx.elevation.delta;
        return ctx;
    }
}

Hooks.once('init', () =>
{
    CONFIG.Token.rulerClass = LancerTokenRuler;
    CONFIG.Canvas.rulerClass = LancerCanvasRuler;
    game.settings.register(MODULE_ID, PER_STEP_RENDER, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });
    game.settings.register(MODULE_ID, MEASURE_SNAP_CENTER, {
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });
    game.keybindings.register(MODULE_ID, 'sightlineRuler', {
        name: 'LA.keybindings.sightlineRuler.name',
        hint: 'LA.keybindings.sightlineRuler.hint',
        editable: [{ key: 'Tab' }],
        onDown: () =>
        {
            if (game.activeTool !== 'ruler')
                return false;
            if (!getModuleSetting('lancerLos'))
                return false;
            toggleSightlineMode();
            return true;
        },
        repeat: false,
        precedence: globalThis.CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
});

// HUD only realigns on canvas.pan(); without this kick, waypoint labels stay at the previous scene's offsets after a swap.
Hooks.on('canvasReady', () =>
{
    try
    {
        canvas.hud?.align();
    }
    catch
    {
        /* hud may not be rendered yet */
    }
});
