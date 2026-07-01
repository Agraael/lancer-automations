/* global game, Hooks, libWrapper, foundry, canvas, PIXI, CONST */

import { elevationForPreview, getDragElevationOffset } from './elevation.js';
import { getImmunityBonuses } from '../bonuses/genericBonuses.js';
import { isForceFreeMovement, getCurrentMovementType } from './keybindings.js';

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
    if (debugOn()) {
        if (!_debugGfx) {
            _debugGfx = new PIXI.Container();
            _debugGfx.eventMode = 'none';
            canvas.tokens?.addChild(_debugGfx);
        }
        _debugGfx.removeChildren().forEach(child => child.destroy({ children: true }));
    } else if (_debugGfx) {
        _debugGfx.removeChildren().forEach(child => child.destroy({ children: true }));
    }
}
function debugMark(cellOffset, cellCenter, penalty, tokenElev, climbCells) {
    if (!debugOn() || !_debugGfx)
        return;
    const circle = new PIXI.Graphics();
    const color = penalty > 0 ? 0x00ff00 : (climbCells > 0 ? 0xff8800 : 0xffff00);
    circle.lineStyle(2, color, 1).drawCircle(cellCenter.x, cellCenter.y, 14);
    circle.beginFill(color, 0.2).drawCircle(cellCenter.x, cellCenter.y, 14).endFill();
    _debugGfx.addChild(circle);
    const label = new PIXI.Text(`${cellOffset.i},${cellOffset.j}\ne=${tokenElev} p=${penalty}\n+${climbCells}`,
        new PIXI.TextStyle({ fontSize: 11, fill: 0xffffff, stroke: 0x000000, strokeThickness: 3, align: 'center' }));
    label.anchor.set(0.5, 0.5);
    label.position.set(cellCenter.x, cellCenter.y);
    _debugGfx.addChild(label);
}
function debugFootprint(cellOffset, cellCenter, isNew = false) {
    if (!debugOn() || !_debugGfx)
        return;
    const color = isNew ? 0xffaa00 : 0x00bbff;
    const circle = new PIXI.Graphics();
    circle.lineStyle(isNew ? 2 : 1, color, isNew ? 1 : 0.7).drawCircle(cellCenter.x, cellCenter.y, 10);
    _debugGfx.addChild(circle);
    const label = new PIXI.Text(`${cellOffset.i},${cellOffset.j}${isNew ? '*' : ''}`,
        new PIXI.TextStyle({ fontSize: 9, fill: isNew ? 0xffcc66 : 0x88ddff, stroke: 0x000000, strokeThickness: 2 }));
    label.anchor.set(0.5, 0.5);
    label.position.set(cellCenter.x, cellCenter.y);
    _debugGfx.addChild(label);
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
    let maxPenalty = 0;
    for (const cellOffset of offsets) {
        const cellCenter = canvas.grid.getCenterPoint(cellOffset);
        const penalty = Number(api.getMovementPenaltyAt(cellCenter.x, cellCenter.y, { excludeToken: tokenDoc })) || 0;
        if (penalty > maxPenalty)
            maxPenalty = penalty;
    }
    return maxPenalty;
}

// Region difficulty N -> LA additive penalty (N - 1). Warns once on non-integer difficulties.
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
    const actionKey = getCurrentMovementType() === 'fly' ? "fly" : "walk";
    const segment = { action: actionKey };
    let maxPenalty = 0;
    for (const cellOffset of offsets) {
        const cellCenter = canvas.grid.getCenterPoint(cellOffset);
        const point = { x: cellCenter.x, y: cellCenter.y, elevation: tokenElevSceneUnits };
        for (const regionDoc of regions) {
            if (!regionDoc.testPoint?.(point))
                continue;
            for (const behavior of regionDoc.behaviors) {
                if (behavior.disabled)
                    continue;
                let effects = [];
                // _getTerrainEffects is wrapped to return [], so read difficulties[action] directly.
                // Other behavior types still go through _getTerrainEffects.
                const behaviorSystem = behavior.system;
                if (behaviorSystem?.constructor?.name === 'ModifyMovementCostRegionBehaviorType') {
                    const difficulty = behaviorSystem.difficulties?.[actionKey];
                    if (difficulty != null && difficulty !== 1) effects = [{ difficulty }];
                } else {
                    try {
                        effects = behaviorSystem?._getTerrainEffects?.(tokenDoc, segment) ?? [];
                    } catch { /* behavior type without terrain effects */ }
                }
                for (const effect of effects) {
                    const difficulty = Number(effect?.difficulty);
                    if (!Number.isFinite(difficulty) || difficulty <= 1)
                        continue;
                    if (!Number.isInteger(difficulty))
                        _warnNonIntegerRegionDifficulty(difficulty, regionDoc.name);
                    const laPenalty = difficulty - 1;
                    if (laPenalty > maxPenalty)
                        maxPenalty = laPenalty;
                }
            }
        }
    }
    return maxPenalty;
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
        for (const template of templates) {
            try {
                const templateDoc = template?.document;
                if (!templateDoc)
                    continue;
                const tmacFlags = templateDoc.flags?.templatemacro ?? {};
                const penalty = Number(tmacFlags.movementPenalty) || 0;
                if (penalty <= 0)
                    continue;
                const isFlat = tmacFlags.flatMovementPenalty ?? true;
                if (!isFlat)
                    continue;
                if (!template.shape || typeof template.shape.contains !== 'function')
                    continue;
                if (tmacFlags.elevationGated) {
                    const base = templateDoc.elevation ?? 0;
                    const manual = !!tmacFlags.elevationRangeManual;
                    const range = Math.floor(Number(manual ? (tmacFlags.elevationRange ?? 0) : (templateDoc.distance ?? 0)) || 0);
                    if (tokenElev < base || tokenElev > base + range)
                        continue;
                }
                // Use the cells Foundry actually highlights, not the raw shape. null = gridless -> shape test.
                const occupiedCells = tmApi?.getTemplateOccupiedOffsets?.(templateDoc) ?? null;
                candidates.push({ template, penalty, occupiedCells });
            } catch { /* */ }
        }
        if (!candidates.length)
            return 0;
        let maxPenalty = 0;
        for (const cellOffset of offsets) {
            for (const { template, penalty, occupiedCells } of candidates) {
                try {
                    let inside;
                    if (occupiedCells) {
                        inside = occupiedCells.has(`${cellOffset.i},${cellOffset.j}`);
                    } else {
                        const cellCenter = canvas.grid.getCenterPoint(cellOffset);
                        inside = template.shape.contains(cellCenter.x - template.x, cellCenter.y - template.y);
                    }
                    if (inside && penalty > maxPenalty)
                        maxPenalty = penalty;
                } catch { /* */ }
            }
        }
        return maxPenalty;
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
    return new Map(types.map(terrainType => [terrainType.id, terrainType]));
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
    let maxPenalty = 0;
    for (const cellOffset of offsets) {
        const shapes = tht.getCell?.(cellOffset.j, cellOffset.i) ?? [];
        for (const shape of shapes) {
            const terrainType = typeById.get(shape.terrainTypeId);
            const penalty = Number(terrainType?.movementPenalty) || 0;
            if (penalty > maxPenalty)
                maxPenalty = penalty;
        }
    }
    return maxPenalty;
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
        const terrainType = typeById.get(shape.terrainTypeId);
        if (terrainType?.usesHeight && terrainType?.isSolid) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            if (top > solidMaxTop)
                solidMaxTop = top;
        }
    }

    let maxPenalty = 0;
    const debugLines = [];
    for (const shape of shapes) {
        const terrainType = typeById.get(shape.terrainTypeId);
        const penalty = Number(terrainType?.movementPenalty) || 0;
        let applies;
        let reason;
        if (terrainType?.usesHeight) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            applies = tokenElevGrid >= (shape.elevation ?? 0) && tokenElevGrid < top;
            reason = `solid elev=[${shape.elevation ?? 0},${top}) tokenE=${tokenElevGrid}`;
        } else {
            const zoneTop = solidMaxTop > 0 ? solidMaxTop : 1;
            applies = tokenElevGrid >= 0 && tokenElevGrid < zoneTop;
            reason = `zone top=${zoneTop} tokenE=${tokenElevGrid}`;
        }
        if (debugOn())
            debugLines.push(`{id=${shape.terrainTypeId} name=${terrainType?.name} mp=${penalty} usesH=${terrainType?.usesHeight} ${reason} applies=${applies}}`);
        if (applies && penalty > maxPenalty)
            maxPenalty = penalty;
    }
    if (debugOn())
        console.log('LA-COST-TERRAIN', { offset, shapes: debugLines, maxPenalty });
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
    const tokenWidthCells = tokenDoc.width ?? 1;
    const tokenHeightCells = tokenDoc.height ?? 1;
    const topLeftPos = {
        x: center.x - tokenWidthCells * gridSize / 2,
        y: center.y - tokenHeightCells * gridSize / 2,
        width: tokenWidthCells,
        height: tokenHeightCells
    };
    let footprint = [];
    try {
        footprint = tokenDoc.getOccupiedGridSpaceOffsets?.(topLeftPos) ?? [];
    } catch { /* ignore */ }
    if (!footprint.length)
        footprint = [pathOffset];

    const dedup = new Map();
    for (const cellOffset of footprint) {
        const cellCenter = canvas.grid.getCenterPoint(cellOffset);
        let shapes = tht.getShapesAtPoint?.(cellCenter.x, cellCenter.y) ?? [];
        if (!shapes.length)
            shapes = tht.getCell?.(cellOffset.j, cellOffset.i) ?? [];
        for (const shape of shapes)
            dedup.set(`${shape.terrainTypeId}|${shape.elevation}|${shape.height}`, shape);
    }
    const shapes = [...dedup.values()];

    let top = 0;
    for (const shape of shapes) {
        const terrainType = typeById.get(shape.terrainTypeId);
        if (!terrainType?.usesHeight || !terrainType?.isSolid)
            continue;
        const shapeTop = (shape.elevation ?? 0) + (shape.height ?? 0);
        if (shapeTop > top)
            top = shapeTop;
    }
    return { top, shapes, footprint };
}

/** Collect deduplicated THT shapes across a set of grid offsets. */
function collectShapes(offsets, typeById) {
    const tht = thtApi();
    if (!tht || !typeById || !offsets?.length)
        return [];
    const dedup = new Map();
    for (const cellOffset of offsets) {
        const cellCenter = canvas.grid.getCenterPoint(cellOffset);
        let shapes = tht.getShapesAtPoint?.(cellCenter.x, cellCenter.y) ?? [];
        if (!shapes.length)
            shapes = tht.getCell?.(cellOffset.j, cellOffset.i) ?? [];
        for (const shape of shapes)
            dedup.set(`${shape.terrainTypeId}|${shape.elevation}|${shape.height}`, shape);
    }
    return [...dedup.values()];
}

/** Applicability-checked MAX penalty across an already-collected shape set. */
function penaltyFromShapes(shapes, typeById, tokenElevGrid) {
    if (!shapes.length)
        return 0;
    let solidMaxTop = 0;
    for (const shape of shapes) {
        const terrainType = typeById.get(shape.terrainTypeId);
        if (terrainType?.usesHeight && terrainType?.isSolid) {
            const top = (shape.elevation ?? 0) + (shape.height ?? 0);
            if (top > solidMaxTop)
                solidMaxTop = top;
        }
    }
    let maxPenalty = 0;
    for (const shape of shapes) {
        const terrainType = typeById.get(shape.terrainTypeId);
        const penalty = Number(terrainType?.movementPenalty) || 0;
        if (penalty <= 0)
            continue;
        let applies;
        if (terrainType?.usesHeight) {
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
    return templates.filter(template => {
        const tmacFlags = template?.document?.flags?.templatemacro ?? {};
        return Number(tmacFlags.movementPenalty) > 0 && typeof template?.shape?.contains === 'function';
    });
}

// Per zone: boundary-crossing points (⚠ markers) and the distance the line runs inside it.
function gridlessPenaltyZones(segStart, segEnd, templates, gridSize, sceneDistance) {
    const segLengthPx = Math.hypot(segEnd.x - segStart.x, segEnd.y - segStart.y);
    const steps = Math.max(2, Math.ceil(segLengthPx / 8));
    const stepSceneUnits = (segLengthPx / steps / gridSize) * sceneDistance;
    const isInsideTemplateAt = (template, t) => {
        try {
            return !!template.shape.contains(segStart.x + (segEnd.x - segStart.x) * t - template.x, segStart.y + (segEnd.y - segStart.y) * t - template.y);
        } catch {
            return false;
        }
    };
    const zones = [];
    for (const template of templates) {
        const penalty = Number(template.document?.flags?.templatemacro?.movementPenalty) || 0;
        const crossings = [];
        let horizontalInside = 0;
        let wasInsidePrev = isInsideTemplateAt(template, 0);
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            const inside = isInsideTemplateAt(template, t);
            if (inside)
                horizontalInside += stepSceneUnits;
            if (inside !== wasInsidePrev) {
                const tMid = (t + (s - 1) / steps) / 2;
                crossings.push({ x: segStart.x + (segEnd.x - segStart.x) * tMid, y: segStart.y + (segEnd.y - segStart.y) * tMid });
                wasInsidePrev = inside;
            }
        }
        zones.push({ template, penalty, crossings, horizontalInside, anyInside: horizontalInside > 0 });
    }
    return zones;
}

// Points where elevation steps along the line, for the on-segment ↑/↓ markers.
function gridlessElevationCrossings(fromWp, toWp, tokenDoc, gridSize) {
    const tokenWidthCells = fromWp.width ?? tokenDoc.width ?? 1;
    const tokenHeightCells = fromWp.height ?? tokenDoc.height ?? 1;
    const deltaX = toWp.x - fromWp.x, deltaY = toWp.y - fromWp.y;
    const steps = Math.min(60, Math.max(2, Math.ceil(Math.hypot(deltaX, deltaY) / Math.max(8, gridSize / 3))));
    const elevAt = t => elevationForPreview(tokenDoc, { x: fromWp.x + deltaX * t, y: fromWp.y + deltaY * t, width: tokenWidthCells, height: tokenHeightCells });
    const markers = [];
    let prevElev = elevAt(0);
    for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const elev = elevAt(t);
        const elevStep = Math.round(elev - prevElev);
        if (elevStep !== 0) {
            const tMid = (t + (s - 1) / steps) / 2;
            markers.push({ x: fromWp.x + deltaX * tMid + tokenWidthCells * gridSize / 2, y: fromWp.y + deltaY * tMid + tokenHeightCells * gridSize / 2, delta: elevStep });
        }
        prevElev = elev;
    }
    return markers;
}

// Points along the segment with linear cost, for the per-step gradient renderer.
function gridlessLineCentroids(fromCenter, toCenter, segCost) {
    const steps = Math.max(2, Math.min(60, Math.ceil(Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y) / 16)));
    const points = [];
    for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        points.push({ x: fromCenter.x + (toCenter.x - fromCenter.x) * t, y: fromCenter.y + (toCenter.y - fromCenter.y) * t, cost: segCost * t });
    }
    return points;
}

// Gridless cost: horizontal + vertical, plus penalties billed by distance traversed inside zones.
function applyGridlessCost(tokenDoc, inputWaypoints, result) {
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 1;
    const penaltyTemplates = gridlessPenaltyTemplates();
    const dragType = getCurrentMovementType();
    const noClimbMalus = dragType === 'fly' || isClimbingImmune(tokenDoc) || isForceFreeMovement();
    const half = (wp, dim) => ((wp[dim] ?? tokenDoc[dim] ?? 1) * gridSize) / 2;
    const center = wp => ({ x: wp.x + half(wp, 'width'), y: wp.y + half(wp, 'height') });

    let cumDistance = 0, cumCost = 0, totalVertical = 0, totalTerrain = 0, totalMalus = 0, penaltyZone = false;
    for (let i = 0; i < result.segments.length; i++) {
        const seg = result.segments[i];
        const fromWp = inputWaypoints[i], toWp = inputWaypoints[i + 1];
        if (!fromWp || !toWp)
            continue;

        const fromCenter = center(fromWp), toCenter = center(toWp);
        const horizontal = (Math.hypot(toCenter.x - fromCenter.x, toCenter.y - fromCenter.y) / gridSize) * sceneDistance;
        const vertical = Math.abs((toWp.elevation ?? 0) - (fromWp.elevation ?? 0));
        const climbMarkers = gridlessElevationCrossings(fromWp, toWp, tokenDoc, gridSize);

        const zones = penaltyTemplates.length ? gridlessPenaltyZones(fromCenter, toCenter, penaltyTemplates, gridSize, sceneDistance) : [];
        const penaltyMarkers = [];
        let penaltyCost = 0;
        for (const zone of zones) {
            penaltyMarkers.push(...zone.crossings);
            if (zone.anyInside)
                penaltyZone = true;
            let verticalInside = 0;
            for (const climbMarker of climbMarkers)
                if (zone.template.shape?.contains?.(climbMarker.x - zone.template.x, climbMarker.y - zone.template.y))
                    verticalInside += Math.abs(climbMarker.delta);
            penaltyCost += zone.penalty * (zone.horizontalInside + verticalInside);
        }

        // First grid-unit of climb is free, the rest 1:1.
        let climbMalus = noClimbMalus ? 0 : Math.max(0, vertical - sceneDistance);

        let segCost = horizontal + vertical + penaltyCost + climbMalus;
        const forcedSeg = toWp.action === 'forced';
        let segVertical = vertical;
        let segPenalty = penaltyCost;
        if (forcedSeg || isForceFreeMovement()) {
            segCost = 0;
            climbMalus = 0;
            segVertical = 0;
            segPenalty = 0;
            climbMarkers.length = 0;
            penaltyMarkers.length = 0;
        }
        seg.cost = segCost;
        seg.lancerVerticalCost = segVertical;
        seg.lancerTerrainPenalty = segPenalty;
        seg.lancerClimbMalus = climbMalus;
        cumDistance += horizontal;
        cumCost += seg.cost;
        totalVertical += segVertical;
        totalTerrain += segPenalty;
        totalMalus += climbMalus;

        if (seg.to) {
            seg.to.distance = cumDistance;
            seg.to.cost = cumCost;
            seg.to.lancerTerrainPenalty = penaltyCost;
            seg.to.lancerClimbMalus = climbMalus;
            seg.to.lancerVerticalCost = totalVertical;
            seg.to.lancerClimbCells = climbMarkers;
            seg.to.lancerTerrainCells = penaltyMarkers;
            seg.to.lancerStepCentroids = gridlessLineCentroids(fromCenter, toCenter, segCost);
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
    const dragType = getCurrentMovementType();
    const defaultFlying = dragType === 'fly';
    const defaultIgnoreElev = dragType === 'ignore';
    // Global "no auto-elevation": terrain contributes zero elevation to the drag, whatever the action.
    const ignoreTerrainElev = _autoElevDisabled();
    const climbImmune = isClimbingImmune(tokenDoc);
    const freeMode = isForceFreeMovement();
    const terrainImmune = isTerrainImmune(tokenDoc) || freeMode;

    let cumDistance = 0;
    let cumCost = 0;
    let totalTerrain = 0;
    let totalMalus = 0;
    let totalVertical = 0;

    const typeById = getTerrainTypeMap();
    debugReset();

    // Climb cost is driven by terrain-top changes, not absolute token elev (v12 ER model).
    // Use the PATH'S first waypoint (origin of history), not tokenDoc.x/y (which is the
    // current position - post-move that's the destination and would skew the climb start).
    const startWp = inputWaypoints[0];
    const startElev = startWp?.elevation ?? tokenDoc.elevation ?? 0;
    const startX = startWp?.x ?? tokenDoc.x ?? 0;
    const startY = startWp?.y ?? tokenDoc.y ?? 0;
    const startWidth = startWp?.width ?? tokenDoc.width ?? 1;
    const startHeight = startWp?.height ?? tokenDoc.height ?? 1;
    const storedElevGrid = startElev / sceneDistance;
    let groundElevGrid = 0;
    try {
        const startGridSize = canvas.grid.size;
        const tokenCenter = {
            x: startX + startWidth * startGridSize / 2,
            y: startY + startHeight * startGridSize / 2
        };
        const startOffset = canvas.grid.getOffset(tokenCenter);
        groundElevGrid = footprintShapesAt(tokenDoc, startOffset, typeById).top;
    } catch { /* ignore */ }
    let prevTerrainTop = groundElevGrid;
    let prevCellTop = groundElevGrid;
    let tokenElev = (defaultIgnoreElev || ignoreTerrainElev) ? storedElevGrid : Math.max(storedElevGrid, groundElevGrid);
    const dragOffsetGrid = getDragElevationOffset?.() ?? 0;
    let userOffsetApplied = false;

    // Keep first, last, F-key checkpoints, and auto-elevation explicit kinks; drop planner corners.
    const keepIdx = [];
    for (let k = 0; k < inputWaypoints.length; k++) {
        const wp = inputWaypoints[k];
        const isFirst = k === 0;
        const isLast = k === inputWaypoints.length - 1;
        const isCheckpoint = wp?.checkpoint === true;
        const isExplicitKink = wp?.explicit === true && wp?.intermediate !== true;
        if (isFirst || isLast || isCheckpoint || isExplicitKink)
            keepIdx.push(k);
    }

    for (let keepIdxPos = 0; keepIdxPos < keepIdx.length - 1; keepIdxPos++) {
        const fromIdx = keepIdx[keepIdxPos];
        const toIdx = keepIdx[keepIdxPos + 1];
        const i = toIdx - 1; // store data on the LAST sub-segment of this filtered group
        const seg = result.segments[i];
        const fromWp = inputWaypoints[fromIdx];
        const toWp = inputWaypoints[toIdx];
        if (!fromWp || !toWp)
            continue;

        const segAction = toWp.action;
        const flying = segAction === 'fly' || (segAction == null && defaultFlying);
        const noTerrainClimb = ignoreTerrainElev || segAction === 'ignore' || (segAction == null && defaultIgnoreElev);

        const isLastSegment = (keepIdxPos === keepIdx.length - 2);
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
            // Concatenate sub-segment cells so the polyline follows the planner route (matches hex paint).
            const path = [];
            for (let subIdx = fromIdx; subIdx < toIdx; subIdx++) {
                const subFrom = inputWaypoints[subIdx];
                const subTo = inputWaypoints[subIdx + 1];
                if (!subFrom || !subTo) continue;
                const subSizeFrom = tokenDoc.getSize?.(subFrom) ?? { width: (subFrom.width ?? tokenDoc.width) * gridSize, height: (subFrom.height ?? tokenDoc.height) * gridSize };
                const subSizeTo = tokenDoc.getSize?.(subTo) ?? { width: (subTo.width ?? tokenDoc.width) * gridSize, height: (subTo.height ?? tokenDoc.height) * gridSize };
                const subFromCenter = { x: subFrom.x + subSizeFrom.width / 2, y: subFrom.y + subSizeFrom.height / 2 };
                const subToCenter = { x: subTo.x + subSizeTo.width / 2, y: subTo.y + subSizeTo.height / 2 };
                let subPath;
                try {
                    subPath = canvas.grid.getDirectPath([subFromCenter, subToCenter]);
                } catch { subPath = []; }
                for (let k = 0; k < (subPath?.length ?? 0); k++) {
                    const cell = subPath[k];
                    const last = path.at(-1);
                    if (last && last.i === cell.i && last.j === cell.j) continue;
                    path.push(cell);
                }
            }
            debug.push(`path cells: ${(path ?? []).map(cell => `(${cell.i},${cell.j})`).join(' -> ')}`);

            let lastRealJ = -1;
            for (let k = 1; k < (path?.length ?? 0); k++) {
                if (path[k - 1].i !== path[k].i || path[k - 1].j !== path[k].j)
                    lastRealJ = k;
            }

            let prev = path?.[0];
            const startFootprint = footprintShapesAt(tokenDoc, prev, typeById).footprint;
            let prevFootprintKeys = new Set(startFootprint.map(cellOffset => `${cellOffset.i},${cellOffset.j}`));
            // Average of footprint cell centers; matches the geometric center of the cells Foundry highlights.
            const footprintCentroid = (cells) => {
                if (!cells?.length) return null;
                let sumX = 0, sumY = 0;
                for (const cellOffset of cells) {
                    const cellCenter = canvas.grid.getCenterPoint(cellOffset);
                    sumX += cellCenter.x;
                    sumY += cellCenter.y;
                }
                return { x: sumX / cells.length, y: sumY / cells.length };
            };
            const startCentroid = footprintCentroid(startFootprint) ?? canvas.grid.getCenterPoint(prev);
            stepCentroids = [{ x: startCentroid.x, y: startCentroid.y, cost: 0 }];
            let prevCentroid = startCentroid;
            let segCumCost = 0;

            for (let j = 1; j < (path?.length ?? 0); j++) {
                const curr = path[j];
                if (!prev || (curr.i === prev.i && curr.j === prev.j)) {
                    prev = curr; continue;
                }
                horizontalCost += sceneDistance;

                const { top: cellTop, footprint } = footprintShapesAt(tokenDoc, curr, typeById);
                const newCells = footprint.filter(cellOffset => !prevFootprintKeys.has(`${cellOffset.i},${cellOffset.j}`));
                const newShapes = collectShapes(newCells, typeById);

                // Step is free of climb cost if the destination terrain has noClimbingCost (e.g. stairs).
                const noClimbStep = newShapes.some(shape => typeById.get(shape.terrainTypeId)?.noClimbingCost);

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
                if (!flying && !noClimbStep) {
                    verticalCost += climbCellsBilled * sceneDistance;
                    if (!climbImmune && !freeMode && climbCellsBilled > 0) {
                        malus += Math.max(0, climbCellsBilled - 1) * sceneDistance;
                    }
                }

                tokenElev += stepDelta;

                const cellsForOverlay = newCells.length ? newCells : [curr];
                const thtPenalty = terrainImmune ? 0 : penaltyFromShapes(newShapes, typeById, tokenElev);
                const gaaPenalty = terrainImmune ? 0 : gaaPenaltyAtCells(tokenDoc, cellsForOverlay);
                let tmacPenalty = 0;
                if (!terrainImmune) {
                    try {
                        tmacPenalty = templatePenaltyAtCells(cellsForOverlay, tokenElev);
                    } catch {
                        tmacPenalty = 0;
                    }
                }
                const regionPenalty = terrainImmune ? 0 : regionPenaltyAtCells(tokenDoc, cellsForOverlay, tokenElev * sceneDistance);
                const penalty = Math.max(thtPenalty, gaaPenalty, tmacPenalty, regionPenalty);
                terrainCost += penalty * sceneDistance;

                const cellCenter = canvas.grid.getCenterPoint(curr);
                const currCentroid = footprintCentroid(footprint) ?? cellCenter;
                const stepMalus = (!flying && !climbImmune && !freeMode && !noClimbStep && climbCellsBilled > 0)
                    ? Math.max(0, climbCellsBilled - 1) * sceneDistance
                    : 0;
                const stepClimbCost = (flying || noClimbStep) ? 0 : climbCellsBilled * sceneDistance;
                if (flying) {
                    const tokenSpeed = lancerSpeed(tokenDoc);
                    const horizontalCells = horizontalCost / sceneDistance;
                    const flyCellCap = tokenSpeed > 0 ? Math.max(1, Math.ceil(horizontalCells / tokenSpeed)) * tokenSpeed : 0;
                    const billedMoveCells = segClimbVU > flyCellCap ? Math.max(horizontalCells, segClimbVU) : horizontalCells;
                    segCumCost = billedMoveCells * sceneDistance + terrainCost;
                } else {
                    segCumCost += sceneDistance + stepClimbCost + stepMalus + penalty * sceneDistance;
                }
                stepCentroids.push({ x: currCentroid.x, y: currCentroid.y, cost: segCumCost });
                const visualTerrainDelta = noTerrainClimb ? 0 : (cellTop - prevCellTop);
                const visualStepDelta = visualTerrainDelta + manualDelta;
                if (visualStepDelta !== 0) {
                    climbCells.push({
                        x: (prevCentroid.x + currCentroid.x) / 2,
                        y: (prevCentroid.y + currCentroid.y) / 2,
                        delta: visualStepDelta
                    });
                }
                if (penalty > 0) {
                    terrainCells.push({
                        x: (prevCentroid.x + currCentroid.x) / 2,
                        y: (prevCentroid.y + currCentroid.y) / 2,
                        penalty
                    });
                }
                debug.push(`cell(${curr.i},${curr.j}) fp=${footprint.length} new=${newCells.length} cellTop=${cellTop} terrain=${prevTerrainTop}->${newTerrainTop} tokenE=${tokenElev} delta=${stepDelta} billed=${climbCellsBilled} penalty=${penalty}`);
                debugMark(curr, cellCenter, penalty, tokenElev, climbCellsBilled);
                for (const cellOffset of footprint) {
                    if (cellOffset.i === curr.i && cellOffset.j === curr.j)
                        continue;
                    const isNew = !prevFootprintKeys.has(`${cellOffset.i},${cellOffset.j}`);
                    const footprintCellCenter = canvas.grid.getCenterPoint(cellOffset);
                    debugFootprint(cellOffset, footprintCellCenter, isNew);
                }

                prevFootprintKeys = new Set(footprint.map(cellOffset => `${cellOffset.i},${cellOffset.j}`));
                prevTerrainTop = newTerrainTop;
                prevCellTop = cellTop;
                prevCentroid = currCentroid;
                prev = curr;
            }
        } catch (e) {
            debug.push(`ERROR: ${e.message}`);
        }
        if (debugOn())
            console.log('LA-COST', { fromWp, toWp, horizontalCost, verticalCost, terrainCost, malus, debug });
        if (horizontalCost === 0)
            horizontalCost = Number(seg.distance) || 0;

        let segCost;
        if (flying) {
            const tokenSpeed = lancerSpeed(tokenDoc);
            const segHorizontalCells = horizontalCost / sceneDistance;
            const flyClimbCapCells = tokenSpeed > 0 ? Math.max(1, Math.ceil(segHorizontalCells / tokenSpeed)) * tokenSpeed : 0;
            if (segClimbVU > flyClimbCapCells) {
                const moveCost = Math.max(segHorizontalCells, segClimbVU) * sceneDistance;
                verticalCost = moveCost - horizontalCost;
                segCost = moveCost + terrainCost;
            } else {
                verticalCost = 0;
                segCost = horizontalCost + terrainCost;
            }
        } else {
            segCost = horizontalCost + verticalCost + terrainCost + malus;
        }

        const forcedSeg = segAction === 'forced';
        if (forcedSeg || freeMode) {
            segCost = 0;
            verticalCost = 0;
            terrainCost = 0;
            malus = 0;
            climbCells.length = 0;
            terrainCells.length = 0;
            for (const centroid of stepCentroids) centroid.cost = 0;
        }

        if (segAction === 'blink') {
            verticalCost = Math.abs((toWp.elevation ?? 0) - (fromWp.elevation ?? 0));
            const baseCost = Math.max(horizontalCost, verticalCost);
            let destPenalty = 0;
            if (!terrainImmune) {
                try {
                    const gridSize = canvas.grid.size;
                    const destSize = tokenDoc.getSize?.(toWp) ?? { width: (toWp.width ?? tokenDoc.width) * gridSize, height: (toWp.height ?? tokenDoc.height) * gridSize };
                    const destCenter = { x: toWp.x + destSize.width / 2, y: toWp.y + destSize.height / 2 };
                    const destCell = canvas.grid.getOffset(destCenter);
                    const { footprint: destFootprint } = footprintShapesAt(tokenDoc, destCell, typeById);
                    const destShapes = collectShapes(destFootprint, typeById);
                    const destElev = toWp.elevation ?? 0;
                    const thtPenalty = penaltyFromShapes(destShapes, typeById, destElev);
                    const gaaPenalty = gaaPenaltyAtCells(tokenDoc, destFootprint);
                    let tmacPenalty = 0;
                    try { tmacPenalty = templatePenaltyAtCells(destFootprint, destElev); } catch { tmacPenalty = 0; }
                    const regionPenalty = regionPenaltyAtCells(tokenDoc, destFootprint, destElev * sceneDistance);
                    destPenalty = Math.max(thtPenalty, gaaPenalty, tmacPenalty, regionPenalty);
                } catch {
                    destPenalty = 0;
                }
            }
            segCost = baseCost * (1 + destPenalty);
            terrainCost = baseCost * destPenalty;
            malus = 0;
            climbCells.length = 0;
            terrainCells.length = 0;
            for (const centroid of stepCentroids) centroid.cost = segCost;
        }

        seg.lancerVerticalCost = verticalCost;
        seg.lancerTerrainPenalty = terrainCost;
        seg.lancerClimbMalus = malus;

        const groupStartCum = cumCost;
        const subCount = toIdx - fromIdx;
        const equalShare = subCount > 0 ? segCost / subCount : segCost;
        let groupAccCost = 0;
        for (let subIdx = fromIdx; subIdx < toIdx; subIdx++) {
            const subSeg = result.segments[subIdx];
            if (!subSeg) continue;
            const portion = (subIdx === toIdx - 1) ? (segCost - groupAccCost) : equalShare;
            subSeg.cost = portion;
            groupAccCost += portion;
            if (subSeg.to) subSeg.to.cost = groupStartCum + groupAccCost;
        }

        cumDistance += horizontalCost;
        cumCost = groupStartCum + segCost;
        totalTerrain += terrainCost;
        totalMalus += malus;
        totalVertical += verticalCost;

        if (seg.to) {
            seg.to.distance = cumDistance;
            seg.to.lancerTerrainPenalty = terrainCost;
            seg.to.lancerClimbMalus = malus;
            seg.to.lancerVerticalCost = totalVertical;
            seg.to.lancerClimbCells = climbCells;
            seg.to.lancerTerrainCells = terrainCells;
            seg.to.lancerStepCentroids = stepCentroids;
        }

        // Sub-segments between fromIdx and toIdx-1 must hide their native line to avoid the double-line
        // effect; the polyline on the last sub-segment covers the whole group.
        for (let subIdx = fromIdx; subIdx < toIdx - 1; subIdx++) {
            const subSeg = result.segments[subIdx];
            if (subSeg?.to) subSeg.to.lancerSkipNativeSegment = true;
        }
    }

    // Pure-vertical drag: no horizontal step to fold userDelta into.
    if (!userOffsetApplied && dragOffsetGrid !== 0) {
        const rawClimb = Math.abs(dragOffsetGrid);
        const climbCellsBilled = Math.ceil(rawClimb - 0.5);
        const climbCost = climbCellsBilled * sceneDistance;
        const climbMalus = (defaultFlying || climbImmune || freeMode || climbCellsBilled === 0) ? 0
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

function _autoElevDisabled() {
    try { return !!game.settings.get(MODULE_ID, 'disableAutoTerrainElevation'); }
    catch { return false; }
}

// Gate: Lancer ruler (cost + per-cell render) on. Auto-elevation is handled
// separately via defaultIgnoreElev, so disabling it keeps the cost pass alive.
function _isLancerCostActive() {
    try {
        if (!game.settings.get(MODULE_ID, 'enableBuiltinSpeedProvider')) return false;
    } catch { return false; }
    return true;
}

Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active)
        return;

    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype._inferMovementAction', function(wrapped) {
        if (!_isLancerCostActive()) return wrapped.call(this);
        if (isFlying(this))
            return 'fly';
        return wrapped.call(this);
    }, 'MIXED');

    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.measureMovementPath', function(wrapped, waypoints, options) {
        const result = wrapped.call(this, waypoints, options);
        if (!_isLancerCostActive()) return result;
        return applyLancerCost(this, waypoints, result);
    }, 'WRAPPER');

    // MIXED so the gate can fall back to native region behavior when off.
    libWrapper.register(MODULE_ID, 'foundry.data.regionBehaviors.ModifyMovementCostRegionBehaviorType.prototype._getTerrainEffects', function(wrapped, ...args) {
        if (!_isLancerCostActive()) return wrapped.call(this, ...args);
        return [];
    }, 'MIXED');
});
