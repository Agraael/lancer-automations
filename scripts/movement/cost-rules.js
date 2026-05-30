/* global game, Hooks, libWrapper, foundry, canvas, PIXI, CONST */

import { elevationForPreview, getDragElevationOffset } from './elevation.js';
import { getImmunityBonuses } from '../bonuses/genericBonuses.js';
import { isForceFreeMovement } from './keybindings.js';

const MODULE_ID = 'lancer-automations';
const THT_ID = 'terrain-height-tools';
const GAA_ID = 'grid-aware-auras';

let _debugGfx = null;
function debugOn() {
    try {
        return !!game.settings.get('lancer-automations', 'debugMovement');
    } catch {
        return false;
    }
}
function debugReset() {
    if (!debugOn()) {
        if (_debugGfx) {
            _debugGfx.removeChildren().forEach(c => c.destroy({ children: true }));
        }
        return;
    }
    if (!_debugGfx) {
        _debugGfx = new PIXI.Container();
        _debugGfx.eventMode = 'none';
        canvas.tokens?.addChild(_debugGfx);
    }
    _debugGfx.removeChildren().forEach(c => c.destroy({ children: true }));
}
function debugMark(curr, ctr, penalty, elev, climb) {
    if (!debugOn() || !_debugGfx)
        return;
    const g = new PIXI.Graphics();
    const color = penalty > 0 ? 0x00ff00 : (climb > 0 ? 0xff8800 : 0xffff00);
    g.lineStyle(2, color, 1).drawCircle(ctr.x, ctr.y, 14);
    g.beginFill(color, 0.2).drawCircle(ctr.x, ctr.y, 14).endFill();
    _debugGfx.addChild(g);
    const t = new PIXI.Text(`${curr.i},${curr.j}\ne=${elev} p=${penalty}\n+${climb}`,
        new PIXI.TextStyle({ fontSize: 11, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3, align: 'center' }));
    t.anchor.set(0.5, 0.5);
    t.position.set(ctr.x, ctr.y);
    _debugGfx.addChild(t);
}
function debugFootprint(off, ctr, isNew = false) {
    if (!debugOn() || !_debugGfx)
        return;
    const color = isNew ? 0xffaa00 : 0x00bbff;
    const g = new PIXI.Graphics();
    g.lineStyle(isNew ? 2 : 1, color, isNew ? 1 : 0.7).drawCircle(ctr.x, ctr.y, 10);
    _debugGfx.addChild(g);
    const t = new PIXI.Text(`${off.i},${off.j}${isNew ? '*' : ''}`,
        new PIXI.TextStyle({ fontSize: 9, fill: isNew ? 0xffcc66 : 0x88ddff, stroke: 0x000000, strokeThickness: 2 }));
    t.anchor.set(0.5, 0.5);
    t.position.set(ctr.x, ctr.y);
    _debugGfx.addChild(t);
}

const FLYING_STATUSES = ['flying', 'hover'];
const CLIMB_IMMUNE_STATUSES = ['climber'];
const TERRAIN_IMMUNE_STATUSES = ['terrain_immunity', 'surefoot'];

function hasAny(actor, ids) {
    const statuses = actor?.statuses;
    if (!statuses)
        return false;
    return ids.some(id => statuses.has(id));
}

function hasImmunityBonus(actor, subtype) {
    try {
        return (getImmunityBonuses(actor, subtype)?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

export function isFlying(tokenDoc) {
    return hasAny(tokenDoc?.actor, FLYING_STATUSES);
}
export function isClimbingImmune(tokenDoc) {
    const actor = tokenDoc?.actor;
    return hasAny(actor, CLIMB_IMMUNE_STATUSES) || hasImmunityBonus(actor, 'elevation');
}
export function isTerrainImmune(tokenDoc) {
    const actor = tokenDoc?.actor;
    return hasAny(actor, TERRAIN_IMMUNE_STATUSES) || hasImmunityBonus(actor, 'terrain');
}

function thtApi() {
    if (!game.modules.get(THT_ID)?.active)
        return null;
    return globalThis.terrainHeightTools ?? null;
}

function gaaApi() {
    if (!game.modules.get(GAA_ID)?.active)
        return null;
    return game.modules.get(GAA_ID)?.api ?? null;
}

/** MAX GAA movementPenalty across the given grid cell centers, excluding auras owned by tokenDoc. */
function gaaPenaltyAtCells(tokenDoc, offsets) {
    const api = gaaApi();
    if (!api?.getMovementPenaltyAt || !offsets?.length)
        return 0;
    let max = 0;
    for (const off of offsets) {
        const ctr = canvas.grid.getCenterPoint(off);
        const p = Number(api.getMovementPenaltyAt(ctr.x, ctr.y, { excludeToken: tokenDoc })) || 0;
        if (p > max)
            max = p;
    }
    return max;
}

// Native v13 Region penalty: difficulty=N from ModifyMovementCost behaviour, converted to LA's
// additive scale (difficulty - 1). Warns once per session on non-integer difficulties.
let _warnedNonIntegerRegionDifficulty = false;
function _warnNonIntegerRegionDifficulty(value, regionName) {
    if (_warnedNonIntegerRegionDifficulty)
        return;
    _warnedNonIntegerRegionDifficulty = true;
    try {
        ui.notifications?.warn(
            `Lancer Automations: Region "${regionName ?? "?"}" has a non-integer difficulty (${value}). Use whole numbers (2 = +1 penalty, 3 = +2, ...).`,
            { permanent: false }
        );
    } catch { /* notifications unavailable */ }
}

function regionPenaltyAtCells(tokenDoc, offsets, tokenElevSceneUnits) {
    const regions = canvas?.scene?.regions;
    if (!regions?.size || !offsets?.length)
        return 0;
    const actionKey = isFlying(tokenDoc) ? "fly" : "walk";
    const segment = { action: actionKey };
    let max = 0;
    for (const off of offsets) {
        const c = canvas.grid.getCenterPoint(off);
        const point = { x: c.x, y: c.y, elevation: tokenElevSceneUnits };
        for (const regionDoc of regions) {
            if (!regionDoc.testPoint?.(point))
                continue;
            for (const behavior of regionDoc.behaviors) {
                if (behavior.disabled)
                    continue;
                let effects = [];
                try {
                    effects = behavior.system?._getTerrainEffects?.(tokenDoc, segment) ?? [];
                } catch { /* behavior type without terrain effects */ }
                for (const eff of effects) {
                    const d = Number(eff?.difficulty);
                    if (!Number.isFinite(d) || d <= 1)
                        continue;
                    if (!Number.isInteger(d))
                        _warnNonIntegerRegionDifficulty(d, regionDoc.name);
                    const laPenalty = d - 1;
                    if (laPenalty > max)
                        max = laPenalty;
                }
            }
        }
    }
    return max;
}

// templatemacro Difficult Terrain: flags.templatemacro.{movementPenalty,flatMovementPenalty}.
// Only flat penalties; multiplicative skipped.
function templatePenaltyAtCells(offsets, tokenElev = 0) {
    try {
        if (!offsets?.length)
            return 0;
        const templates = canvas?.templates?.placeables;
        if (!Array.isArray(templates) || !templates.length)
            return 0;
        const tmApi = game.modules.get('templatemacro')?.api;
        const candidates = [];
        for (const tpl of templates) {
            try {
                const doc = tpl?.document;
                if (!doc)
                    continue;
                const tmFlags = doc.flags?.templatemacro ?? {};
                const penalty = Number(tmFlags.movementPenalty) || 0;
                if (penalty <= 0)
                    continue;
                const isFlat = tmFlags.flatMovementPenalty ?? true;
                if (!isFlat)
                    continue;
                if (!tpl.shape || typeof tpl.shape.contains !== 'function')
                    continue;
                if (tmFlags.elevationGated) {
                    const base = doc.elevation ?? 0;
                    const manual = !!tmFlags.elevationRangeManual;
                    const range = Math.floor(Number(manual ? (tmFlags.elevationRange ?? 0) : (doc.distance ?? 0)) || 0);
                    if (tokenElev < base || tokenElev > base + range)
                        continue;
                }
                // Use the cells Foundry actually highlights, not the raw shape. null = gridless -> shape test.
                const occupied = tmApi?.getTemplateOccupiedOffsets?.(doc) ?? null;
                candidates.push({ tpl, penalty, occupied });
            } catch { /* */ }
        }
        if (!candidates.length)
            return 0;
        let max = 0;
        for (const off of offsets) {
            for (const { tpl, penalty, occupied } of candidates) {
                try {
                    let inside;
                    if (occupied) {
                        inside = occupied.has(`${off.i},${off.j}`);
                    } else {
                        const ctr = canvas.grid.getCenterPoint(off);
                        inside = tpl.shape.contains(ctr.x - tpl.x, ctr.y - tpl.y);
                    }
                    if (inside && penalty > max)
                        max = penalty;
                } catch { /* */ }
            }
        }
        return max;
    } catch {
        return 0;
    }
}

/** Returns map of terrain types for lookup. */
function getTerrainTypeMap() {
    const tht = thtApi();
    if (!tht)
        return null;
    const types = tht.getTerrainTypes?.() ?? [];
    return new Map(types.map(t => [t.id, t]));
}

/** MAX-across-footprint movementPenalty (in grid units) of THT terrains under the token at the given x,y position. */
function terrainPenaltyAtPosition(tokenDoc, position, typeById = null) {
    const tht = thtApi();
    if (!tht)
        return 0;
    if (isTerrainImmune(tokenDoc))
        return 0;
    typeById ??= getTerrainTypeMap();
    if (!typeById)
        return 0;
    let offsets = [];
    try {
        offsets = tokenDoc.getOccupiedGridSpaceOffsets?.(position) ?? [];
    } catch { /* ignore */ }
    let max = 0;
    for (const off of offsets) {
        const shapes = tht.getCell?.(off.j, off.i) ?? [];
        for (const shape of shapes) {
            const tt = typeById.get(shape.terrainTypeId);
            const penalty = Number(tt?.movementPenalty) || 0;
            if (penalty > max)
                max = penalty;
        }
    }
    return max;
}

/**
 * MAX movementPenalty (grid units) at a specific cell, restricted to terrains that apply
 * at the token's current elevation. Matches v12 ER's `movementCostForGridSpace` elevation rules:
 *   solid (usesHeight=true): applies if tokenElev >= terrain.elevation && tokenElev < terrain.top
 *   zone  (usesHeight=false): applies if tokenElev >= 0 && tokenElev < zoneTop (= max solid top at this cell, default 1)
 */
function terrainPenaltyAtOffset(tokenDoc, offset, typeById, tokenElevGrid) {
    const tht = thtApi();
    if (!tht || isTerrainImmune(tokenDoc))
        return 0;
    if (!typeById)
        return 0;
    let shapes = [];
    try {
        const center = canvas.grid.getCenterPoint(offset);
        shapes = tht.getShapesAtPoint?.(center.x, center.y) ?? [];
    } catch { /* fall back */ }
    if (!shapes.length) {
        shapes = tht.getCell?.(offset.j, offset.i) ?? [];
    }
    if (!shapes.length)
        return 0;

    let solidMaxTop = 0;
    for (const shape of shapes) {
        const tt = typeById.get(shape.terrainTypeId);
        if (tt?.usesHeight && tt?.isSolid) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            if (top > solidMaxTop)
                solidMaxTop = top;
        }
    }

    let maxPenalty = 0;
    const dbg = [];
    for (const shape of shapes) {
        const tt = typeById.get(shape.terrainTypeId);
        const penalty = Number(tt?.movementPenalty) || 0;
        let applies;
        let reason;
        if (tt?.usesHeight) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            applies = tokenElevGrid >= (shape.elevation ?? 0) && tokenElevGrid < top;
            reason = `solid elev=[${shape.elevation ?? 0},${top}) tokenE=${tokenElevGrid}`;
        } else {
            const zoneTop = solidMaxTop > 0 ? solidMaxTop : 1;
            applies = tokenElevGrid >= 0 && tokenElevGrid < zoneTop;
            reason = `zone top=${zoneTop} tokenE=${tokenElevGrid}`;
        }
        if (debugOn())
            dbg.push(`{id=${shape.terrainTypeId} name=${tt?.name} mp=${penalty} usesH=${tt?.usesHeight} ${reason} applies=${applies}}`);
        if (applies && penalty > maxPenalty)
            maxPenalty = penalty;
    }
    if (debugOn())
        console.log('LA-COST-TERRAIN', { offset, shapes: dbg, maxPenalty });
    return maxPenalty;
}

/** Token's Lancer speed in grid units. */
function lancerSpeed(tokenDoc) {
    const speed = Number(tokenDoc?.actor?.system?.speed) || 0;
    return speed;
}

/**
 * Sample the token's full footprint when its center sits on the given path cell.
 * Returns the unique set of THT shapes across all occupied hexes and the MAX solid top.
 * Matches v12 ER's THTElevationAtPoint + _getTerrainHeightToolsAtTokenShape pattern.
 */
function footprintShapesAt(tokenDoc, pathOffset, typeById) {
    const tht = thtApi();
    if (!tht || !typeById)
        return { top: 0, shapes: [], footprint: [] };

    const center = canvas.grid.getCenterPoint(pathOffset);
    const gridSize = canvas.grid.size;
    const w = tokenDoc.width ?? 1;
    const h = tokenDoc.height ?? 1;
    const pos = {
        x: center.x - w * gridSize / 2,
        y: center.y - h * gridSize / 2,
        width: w,
        height: h
    };
    let footprint = [];
    try {
        footprint = tokenDoc.getOccupiedGridSpaceOffsets?.(pos) ?? [];
    } catch { /* ignore */ }
    if (!footprint.length)
        footprint = [pathOffset];

    const dedup = new Map();
    for (const off of footprint) {
        const ctr = canvas.grid.getCenterPoint(off);
        let shapes = tht.getShapesAtPoint?.(ctr.x, ctr.y) ?? [];
        if (!shapes.length)
            shapes = tht.getCell?.(off.j, off.i) ?? [];
        for (const s of shapes)
            dedup.set(`${s.terrainTypeId}|${s.elevation}|${s.height}`, s);
    }
    const shapes = [...dedup.values()];

    let top = 0;
    for (const shape of shapes) {
        const tt = typeById.get(shape.terrainTypeId);
        if (!tt?.usesHeight || !tt?.isSolid)
            continue;
        const t = (shape.elevation ?? 0) + (shape.height ?? 0);
        if (t > top)
            top = t;
    }
    return { top, shapes, footprint };
}

/** Collect deduplicated THT shapes across a set of grid offsets. */
function collectShapes(offsets, typeById) {
    const tht = thtApi();
    if (!tht || !typeById || !offsets?.length)
        return [];
    const dedup = new Map();
    for (const off of offsets) {
        const ctr = canvas.grid.getCenterPoint(off);
        let shapes = tht.getShapesAtPoint?.(ctr.x, ctr.y) ?? [];
        if (!shapes.length)
            shapes = tht.getCell?.(off.j, off.i) ?? [];
        for (const s of shapes)
            dedup.set(`${s.terrainTypeId}|${s.elevation}|${s.height}`, s);
    }
    return [...dedup.values()];
}

/** Applicability-checked MAX penalty across an already-collected shape set. */
function penaltyFromShapes(shapes, typeById, tokenElevGrid) {
    if (!shapes.length)
        return 0;
    let solidMaxTop = 0;
    for (const shape of shapes) {
        const tt = typeById.get(shape.terrainTypeId);
        if (tt?.usesHeight && tt?.isSolid) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            if (top > solidMaxTop)
                solidMaxTop = top;
        }
    }
    let maxPenalty = 0;
    for (const shape of shapes) {
        const tt = typeById.get(shape.terrainTypeId);
        const penalty = Number(tt?.movementPenalty) || 0;
        if (penalty <= 0)
            continue;
        let applies;
        if (tt?.usesHeight) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            applies = tokenElevGrid >= (shape.elevation ?? 0) && tokenElevGrid < top;
        } else {
            const zoneTop = solidMaxTop > 0 ? solidMaxTop : 1;
            applies = tokenElevGrid >= 0 && tokenElevGrid < zoneTop;
        }
        if (applies && penalty > maxPenalty)
            maxPenalty = penalty;
    }
    return maxPenalty;
}

function gridlessPenaltyTemplates() {
    const templates = canvas?.templates?.placeables;
    if (!Array.isArray(templates))
        return [];
    return templates.filter(tpl => {
        const tm = tpl?.document?.flags?.templatemacro ?? {};
        return Number(tm.movementPenalty) > 0 && typeof tpl?.shape?.contains === 'function';
    });
}

// Per zone: boundary-crossing points (⚠ markers) and the distance the line runs inside it.
function gridlessPenaltyZones(a, b, templates, gridSize, sceneDistance) {
    const segPx = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(2, Math.ceil(segPx / 8));
    const stepSU = (segPx / steps / gridSize) * sceneDistance;
    const inAt = (tpl, t) => {
        try {
            return !!tpl.shape.contains(a.x + (b.x - a.x) * t - tpl.x, a.y + (b.y - a.y) * t - tpl.y);
        } catch {
            return false;
        }
    };
    const zones = [];
    for (const tpl of templates) {
        const penalty = Number(tpl.document?.flags?.templatemacro?.movementPenalty) || 0;
        const crossings = [];
        let hInside = 0;
        let prev = inAt(tpl, 0);
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inside = inAt(tpl, t);
            if (inside)
                hInside += stepSU;
            if (inside !== prev) {
                const tm = (t + (s - 1) / steps) / 2;
                crossings.push({ x: a.x + (b.x - a.x) * tm, y: a.y + (b.y - a.y) * tm });
                prev = inside;
            }
        }
        zones.push({ tpl, penalty, crossings, hInside, anyInside: hInside > 0 });
    }
    return zones;
}

// Points where elevation steps along the line, for the on-segment ↑/↓ markers.
function gridlessElevationCrossings(fromWp, toWp, tokenDoc, gridSize) {
    const w = fromWp.width ?? tokenDoc.width ?? 1;
    const h = fromWp.height ?? tokenDoc.height ?? 1;
    const dx = toWp.x - fromWp.x, dy = toWp.y - fromWp.y;
    const steps = Math.min(60, Math.max(2, Math.ceil(Math.hypot(dx, dy) / Math.max(8, gridSize / 3))));
    const elevAt = t => elevationForPreview(tokenDoc, { x: fromWp.x + dx * t, y: fromWp.y + dy * t, width: w, height: h });
    const markers = [];
    let prev = elevAt(0);
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const elev = elevAt(t);
        const d = Math.round(elev - prev);
        if (d !== 0) {
            const tm = (t + (s - 1) / steps) / 2;
            markers.push({ x: fromWp.x + dx * tm + w * gridSize / 2, y: fromWp.y + dy * tm + h * gridSize / 2, delta: d });
        }
        prev = elev;
    }
    return markers;
}

// Points along the segment with linear cost, for the per-step gradient renderer.
function gridlessLineCentroids(fc, tc, segCost) {
    const steps = Math.max(2, Math.min(60, Math.ceil(Math.hypot(tc.x - fc.x, tc.y - fc.y) / 16)));
    const pts = [];
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        pts.push({ x: fc.x + (tc.x - fc.x) * t, y: fc.y + (tc.y - fc.y) * t, cost: segCost * t });
    }
    return pts;
}

// Gridless cost: horizontal + vertical, plus penalties billed by distance traversed inside zones.
function applyGridlessCost(tokenDoc, inputWaypoints, result) {
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 1;
    const penaltyTemplates = gridlessPenaltyTemplates();
    const noClimbMalus = isFlying(tokenDoc) || isClimbingImmune(tokenDoc) || isForceFreeMovement();
    const half = (wp, dim) => ((wp[dim] ?? tokenDoc[dim] ?? 1) * gridSize) / 2;
    const center = wp => ({ x: wp.x + half(wp, 'width'), y: wp.y + half(wp, 'height') });

    let cumDistance = 0, cumCost = 0, totalVertical = 0, totalTerrain = 0, totalMalus = 0, penaltyZone = false;
    for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i];
        const fromWp = inputWaypoints[i], toWp = inputWaypoints[i + 1];
        if (!fromWp || !toWp)
            continue;

        const fc = center(fromWp), tc = center(toWp);
        const horizontal = (Math.hypot(tc.x - fc.x, tc.y - fc.y) / gridSize) * sceneDistance;
        const vertical = Math.abs((toWp.elevation ?? 0) - (fromWp.elevation ?? 0));
        const climbMarkers = gridlessElevationCrossings(fromWp, toWp, tokenDoc, gridSize);

        const zones = penaltyTemplates.length ? gridlessPenaltyZones(fc, tc, penaltyTemplates, gridSize, sceneDistance) : [];
        const penaltyMarkers = [];
        let penaltyCost = 0;
        for (const z of zones) {
            penaltyMarkers.push(...z.crossings);
            if (z.anyInside)
                penaltyZone = true;
            let vInside = 0;
            for (const m of climbMarkers)
                if (z.tpl.shape?.contains?.(m.x - z.tpl.x, m.y - z.tpl.y))
                    vInside += Math.abs(m.delta);
            penaltyCost += z.penalty * (z.hInside + vInside);
        }

        // First grid-unit of climb is free, the rest 1:1.
        const climbMalus = noClimbMalus ? 0 : Math.max(0, vertical - sceneDistance);

        const segCost = horizontal + vertical + penaltyCost + climbMalus;
        seg.cost = segCost;
        seg.lancerVerticalCost = vertical;
        seg.lancerTerrainPenalty = penaltyCost;
        seg.lancerClimbMalus = climbMalus;
        cumDistance += horizontal;
        cumCost += seg.cost;
        totalVertical += vertical;
        totalTerrain += penaltyCost;
        totalMalus += climbMalus;

        if (seg.to) {
            seg.to.distance = cumDistance;
            seg.to.cost = cumCost;
            seg.to.lancerTerrainPenalty = totalTerrain;
            seg.to.lancerClimbMalus = totalMalus;
            seg.to.lancerVerticalCost = totalVertical;
            seg.to.lancerClimbCells = climbMarkers;
            seg.to.lancerTerrainCells = penaltyMarkers;
            seg.to.lancerStepCentroids = gridlessLineCentroids(fc, tc, segCost);
            seg.to.lancerPenaltyZone = penaltyZone;
        }
    }

    result.lancerTerrainPenalty = totalTerrain;
    result.lancerClimbMalus = totalMalus;
    result.lancerVerticalCost = totalVertical;
    result.lancerPenaltyZone = penaltyZone;
    result.distance = cumDistance;
    result.cost = cumCost;
    return result;
}

function applyLancerCost(tokenDoc, inputWaypoints, result) {
    if (!result || !Array.isArray(result.segments))
        return result;
    if (!Array.isArray(inputWaypoints) || inputWaypoints.length < 2)
        return result;
    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
        return applyGridlessCost(tokenDoc, inputWaypoints, result);

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const flying = isFlying(tokenDoc);
    const climbImmune = isClimbingImmune(tokenDoc);
    const freeMode = isForceFreeMovement();
    const terrainImmune = isTerrainImmune(tokenDoc) || freeMode;
    const noTerrainClimb = !!tokenDoc.getFlag?.('lancer-automations', 'ignoreRulerAutoElevation');

    let cumDistance = 0;
    let cumCost = 0;
    let totalTerrain = 0;
    let totalMalus = 0;
    let totalVertical = 0;

    const typeById = getTerrainTypeMap();
    debugReset();

    // Climb cost is driven by terrain-top changes, not absolute token elev (v12 ER model).
    const storedElevGrid = (tokenDoc.elevation ?? 0) / sceneDistance;
    let groundElevGrid = 0;
    try {
        const gridSize0 = canvas.grid.size;
        const tCenter = {
            x: (tokenDoc.x ?? 0) + (tokenDoc.width ?? 1) * gridSize0 / 2,
            y: (tokenDoc.y ?? 0) + (tokenDoc.height ?? 1) * gridSize0 / 2
        };
        const startOff = canvas.grid.getOffset(tCenter);
        groundElevGrid = footprintShapesAt(tokenDoc, startOff, typeById).top;
    } catch { /* ignore */ }
    let prevTerrainTop = groundElevGrid;
    let tokenElev = noTerrainClimb ? storedElevGrid : Math.max(storedElevGrid, groundElevGrid);
    const dragOffsetGrid = getDragElevationOffset?.() ?? 0;
    let userOffsetApplied = false;

    for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i];
        const fromWp = inputWaypoints[i];
        const toWp = inputWaypoints[i + 1];
        if (!fromWp || !toWp)
            continue;

        const isLastSegment = (i === result.segments.length - 1);
        let horizontalCost = 0;
        let terrainCost = 0;
        let verticalCost = 0;
        let malus = 0;
        let segClimbVU = 0;
        const climbCells = [];
        const terrainCells = [];
        let stepCentroids = [];
        const debug = [];
        try {
            const gridSize = canvas.grid.size;
            const fromCenter = {
                x: fromWp.x + (fromWp.width ?? tokenDoc.width) * gridSize / 2,
                y: fromWp.y + (fromWp.height ?? tokenDoc.height) * gridSize / 2
            };
            const toCenter = {
                x: toWp.x + (toWp.width ?? tokenDoc.width) * gridSize / 2,
                y: toWp.y + (toWp.height ?? tokenDoc.height) * gridSize / 2
            };
            const path = canvas.grid.getDirectPath([fromCenter, toCenter]);
            debug.push(`path cells: ${(path ?? []).map(c => `(${c.i},${c.j})`).join(' -> ')}`);

            let lastRealJ = -1;
            for (let k = 1; k < (path?.length ?? 0); k++) {
                if (path[k - 1].i !== path[k].i || path[k - 1].j !== path[k].j)
                    lastRealJ = k;
            }

            let prev = path?.[0];
            const startFootprint = footprintShapesAt(tokenDoc, prev, typeById).footprint;
            let prevFootprintKeys = new Set(startFootprint.map(o => `${o.i},${o.j}`));
            // Even tokens center on a cell corner, half a cell off getCenterPoint. Carry that offset.
            const firstCell = canvas.grid.getCenterPoint(prev);
            const offX = fromCenter.x - firstCell.x;
            const offY = fromCenter.y - firstCell.y;
            // Visual shift so the polyline lands on Foundry's waypoint dot (ruler.mjs:271).
            // Bbox centre drives the cost/path math; the dot is at tokenDoc.getCenterPoint, which
            // can differ from bbox centre on multi-hex tokens. Apply only to the rendered points.
            const dotFrom = tokenDoc.getCenterPoint?.(fromWp) ?? fromCenter;
            const dotOffX = dotFrom.x - fromCenter.x;
            const dotOffY = dotFrom.y - fromCenter.y;
            const startC = { x: fromCenter.x + dotOffX, y: fromCenter.y + dotOffY };
            stepCentroids = [{ x: startC.x, y: startC.y, cost: 0 }];
            let prevCtr = startC;
            let segCumCost = 0;

            for (let j = 1; j < (path?.length ?? 0); j++) {
                const curr = path[j];
                if (!prev || (curr.i === prev.i && curr.j === prev.j)) {
                    prev = curr; continue;
                }
                horizontalCost += sceneDistance;

                const { top: cellTop, footprint } = footprintShapesAt(tokenDoc, curr, typeById);
                const newCells = footprint.filter(o => !prevFootprintKeys.has(`${o.i},${o.j}`));
                const newShapes = collectShapes(newCells, typeById);

                // Flying gets cumulative-max terrain (up-only).
                const newTerrainTop = flying ? Math.max(prevTerrainTop, cellTop) : cellTop;
                const terrainDelta = noTerrainClimb ? 0 : (newTerrainTop - prevTerrainTop);

                let manualDelta = 0;
                if (isLastSegment && j === lastRealJ && dragOffsetGrid !== 0) {
                    manualDelta = dragOffsetGrid;
                    userOffsetApplied = true;
                }

                const stepDelta = terrainDelta + manualDelta;
                const rawClimb = Math.abs(stepDelta);
                const climbCellsBilled = Math.ceil(rawClimb - 0.5);
                segClimbVU += rawClimb;
                if (!flying) {
                    verticalCost += climbCellsBilled * sceneDistance;
                    if (!climbImmune && !freeMode && climbCellsBilled > 0) {
                        malus += Math.max(0, climbCellsBilled - 1) * sceneDistance;
                    }
                }

                tokenElev += stepDelta;

                const cellsForOverlay = newCells.length ? newCells : [curr];
                const thtPen = terrainImmune ? 0 : penaltyFromShapes(newShapes, typeById, tokenElev);
                const gaaPen = terrainImmune ? 0 : gaaPenaltyAtCells(tokenDoc, cellsForOverlay);
                let tmacPen = 0;
                if (!terrainImmune) {
                    try {
                        tmacPen = templatePenaltyAtCells(cellsForOverlay, tokenElev);
                    } catch {
                        tmacPen = 0;
                    }
                }
                const regionPen = terrainImmune ? 0 : regionPenaltyAtCells(tokenDoc, cellsForOverlay, tokenElev * sceneDistance);
                const penalty = Math.max(thtPen, gaaPen, tmacPen, regionPen);
                terrainCost += penalty * sceneDistance;

                const cell = canvas.grid.getCenterPoint(curr);
                const ctr = { x: cell.x + offX + dotOffX, y: cell.y + offY + dotOffY };
                const stepMalus = (!flying && !climbImmune && !freeMode && climbCellsBilled > 0)
                    ? Math.max(0, climbCellsBilled - 1) * sceneDistance
                    : 0;
                const stepClimbCost = flying ? 0 : climbCellsBilled * sceneDistance;
                segCumCost += sceneDistance + stepClimbCost + stepMalus + penalty * sceneDistance;
                stepCentroids.push({ x: ctr.x, y: ctr.y, cost: segCumCost });
                if (stepDelta !== 0) {
                    climbCells.push({
                        x: (prevCtr.x + ctr.x) / 2,
                        y: (prevCtr.y + ctr.y) / 2,
                        delta: stepDelta
                    });
                }
                if (penalty > 0) {
                    terrainCells.push({
                        x: (prevCtr.x + ctr.x) / 2,
                        y: (prevCtr.y + ctr.y) / 2,
                        penalty
                    });
                }
                debug.push(`cell(${curr.i},${curr.j}) fp=${footprint.length} new=${newCells.length} cellTop=${cellTop} terrain=${prevTerrainTop}->${newTerrainTop} tokenE=${tokenElev} delta=${stepDelta} billed=${climbCellsBilled} penalty=${penalty}`);
                debugMark(curr, ctr, penalty, tokenElev, climbCellsBilled);
                for (const off of footprint) {
                    if (off.i === curr.i && off.j === curr.j)
                        continue;
                    const isNew = !prevFootprintKeys.has(`${off.i},${off.j}`);
                    const fctr = canvas.grid.getCenterPoint(off);
                    debugFootprint(off, fctr, isNew);
                }

                prevFootprintKeys = new Set(footprint.map(o => `${o.i},${o.j}`));
                prevTerrainTop = newTerrainTop;
                prevCtr = ctr;
                prev = curr;
            }
        } catch (e) {
            debug.push(`ERROR: ${e.message}`);
        }
        if (debugOn())
            console.log('LA-COST', { fromWp, toWp, horizontalCost, verticalCost, terrainCost, malus, debug });
        if (horizontalCost === 0)
            horizontalCost = Number(seg.distance) || 0;

        // v12 Lancer flying rule: V is free within ceil(H/SPEED)*SPEED per segment;
        // over the cap (strict >), segment cost = max(H, V). Terrain still adds on top.
        let segCost;
        if (flying) {
            const speed = lancerSpeed(tokenDoc);
            const segHGrid = horizontalCost / sceneDistance;
            const flyVCapVU = speed > 0 ? Math.ceil(segHGrid / speed) * speed : 0;
            if (segClimbVU > flyVCapVU) {
                const moveCost = Math.max(segHGrid, segClimbVU) * sceneDistance;
                verticalCost = moveCost - horizontalCost;
                segCost = moveCost + terrainCost;
            } else {
                verticalCost = 0;
                segCost = horizontalCost + terrainCost;
            }
            if (stepCentroids.length)
                stepCentroids[stepCentroids.length - 1].cost = segCost;
        } else {
            segCost = horizontalCost + verticalCost + terrainCost + malus;
        }
        seg.cost = segCost;
        seg.lancerVerticalCost = verticalCost;
        seg.lancerTerrainPenalty = terrainCost;
        seg.lancerClimbMalus = malus;

        cumDistance += horizontalCost;
        cumCost += segCost;
        totalTerrain += terrainCost;
        totalMalus += malus;
        totalVertical += verticalCost;

        if (seg.to) {
            seg.to.distance = cumDistance;
            seg.to.cost = cumCost;
            seg.to.lancerTerrainPenalty = totalTerrain;
            seg.to.lancerClimbMalus = totalMalus;
            seg.to.lancerVerticalCost = totalVertical;
            seg.to.lancerClimbCells = climbCells;
            seg.to.lancerTerrainCells = terrainCells;
            seg.to.lancerStepCentroids = stepCentroids;
        }
    }

    // Pure-vertical drag: no horizontal step to fold userDelta into.
    if (!userOffsetApplied && dragOffsetGrid !== 0) {
        const rawClimb = Math.abs(dragOffsetGrid);
        const climbCellsBilled = Math.ceil(rawClimb - 0.5);
        const climbCost = climbCellsBilled * sceneDistance;
        const climbMalus = (flying || climbImmune || freeMode || climbCellsBilled === 0) ? 0
            : Math.max(0, climbCellsBilled - 1) * sceneDistance;
        cumCost = climbCost + climbMalus;
        totalVertical = climbCost;
        totalMalus = climbMalus;
        const lastSeg = result.segments.at(-1);
        if (lastSeg) {
            lastSeg.cost = climbCost + climbMalus;
            lastSeg.lancerVerticalCost = climbCost;
            lastSeg.lancerClimbMalus = climbMalus;
            if (lastSeg.to) {
                lastSeg.to.cost = cumCost;
                lastSeg.to.lancerVerticalCost = totalVertical;
                lastSeg.to.lancerClimbMalus = totalMalus;
            }
        }
    }

    result.lancerTerrainPenalty = totalTerrain;
    result.lancerClimbMalus = totalMalus;
    result.lancerVerticalCost = totalVertical;

    result.distance = cumDistance;
    result.cost = cumCost;

    return result;
}

Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active)
        return;

    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype._inferMovementAction', function(wrapped) {
        if (isFlying(this))
            return 'fly';
        return wrapped.call(this);
    }, 'MIXED');

    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.measureMovementPath', function(wrapped, waypoints, options) {
        const result = wrapped.call(this, waypoints, options);
        return applyLancerCost(this, waypoints, result);
    }, 'WRAPPER');
});
