// B1 sightline renderer: cutoff rays with underlay traversal bands (THT terrain, GAA auras, templates).

import { computeSightlineRays } from './lancerDetectionModes.js';
import { getSettingEnabled } from '../setup/settings-register.js';
import { drawDashedEdges } from '../interactive/canvas-helpers.js';
import { canShareTools, canSeeToolsFrom } from '../interactive/presence.js';
import { thtApi } from '../movement/movement-utils.js';
import { getTerrainTypeMap } from '../movement/cost-rules.js';

import { MODULE_ID } from '../tools/constants.js';
const CHANNEL = 'module.lancer-automations';
const REMOTE_PREFIX = 'remote:';
const SETTING_ATTACK_HOVER = 'lancerLosAttackHover';

const COLOR_CLEAR = 0x2f9c56;
const COLOR_CLEAR_CORE = 0x8fe0ab;
const COLOR_BLOCKED = 0xad3833;
const COLOR_WITNESS = 0xbd9636;
const COLOR_WITNESS_CORE = 0xe6cf90;

const CUT_HALF = 5;
const CHIP_RADIUS = 9;
const CHIP_FILL = 0x141a20;
// Chips crowd on spans shorter than this, notches alone carry those.
const CHIP_MIN_SPAN = 20;
const NOTCH_HALF = 5;
// Vector glyphs stay sharp at any zoom where baked text blurs.
function _drawChipGlyph(gfx, x, y, lane, color)
{
    if (lane === 'terrain')
    {
        gfx.lineStyle(0);
        gfx.beginFill(color, 1);
        gfx.drawPolygon([x, y - 4.5, x + 4.5, y + 3.5, x - 4.5, y + 3.5]);
        gfx.endFill();
        return;
    }
    if (lane === 'aura')
    {
        gfx.lineStyle(1.5, color, 1);
        gfx.drawCircle(x, y, 4);
        gfx.lineStyle(0);
        gfx.beginFill(color, 1);
        gfx.drawCircle(x, y, 1.5);
        gfx.endFill();
        return;
    }
    gfx.lineStyle(1.8, color, 1);
    for (const angle of [0, Math.PI / 3, (2 * Math.PI) / 3])
    {
        const dx = Math.cos(angle) * 4.5;
        const dy = Math.sin(angle) * 4.5;
        gfx.moveTo(x - dx, y - dy);
        gfx.lineTo(x + dx, y + dy);
    }
}

let _layer = null;
const _groups = new Map();


function _ensureLayer()
{
    if (!_layer || _layer.destroyed)
    {
        _layer = new PIXI.Container();
        _layer.eventMode = 'none';
    }
    if (canvas?.stage && _layer.parent !== canvas.stage)
        canvas.stage.addChild(_layer);
    return _layer;
}

function _groupFor(key)
{
    let group = _groups.get(key);
    if (!group || group.destroyed)
    {
        group = new PIXI.Container();
        group._gfx = group.addChild(new PIXI.Graphics());
        group._pulse = group.addChild(new PIXI.Graphics());
        // Chips sit on their own layer so the beads pass under them.
        group._chips = group.addChild(new PIXI.Graphics());
        group._pulseSegs = [];
        _ensureLayer().addChild(group);
        _groups.set(key, group);
    }
    return group;
}

const PULSE_SPEED = 40;
const BEAD_SPACING = 60;
// Ends fade over this span so the loop stays seamless.
const BEAD_FADE = 15;

// Zone lanes ride beside the trace line, so the ray's own color is never overwritten.
const LANE_OFFSET = 7;
const LANE_WIDTH = 3;

/** Slot 0 goes right, 1 left, then further out in pairs. */
function _laneOffset(slot)
{
    return (slot % 2 === 0 ? 1 : -1) * LANE_OFFSET * (Math.floor(slot / 2) + 1);
}

// Overlapping zones take opposite sides. Zones that never overlap can share the near lane.
function _assignLaneSlots(zones)
{
    const sorted = [...zones].sort((left, right) => left.t0 - right.t0);
    const placed = [];
    for (const zone of sorted)
    {
        const used = new Set(placed
            .filter(other => other.t0 < zone.t1 && other.t1 > zone.t0)
            .map(other => other.slot));
        let slot = 0;
        while (used.has(slot))
            slot++;
        zone.slot = slot;
        placed.push(zone);
    }
    return sorted;
}

let _tickerFn = null;

function _ensureTicker()
{
    if (_tickerFn || !canvas?.app?.ticker)
        return;
    _tickerFn = _drawPulses;
    canvas.app.ticker.add(_tickerFn);
}

function _stopTicker()
{
    if (_tickerFn && canvas?.app?.ticker)
        canvas.app.ticker.remove(_tickerFn);
    _tickerFn = null;
}

// Direction pulse: a gentle glow streak in the ray's own color drifting origin to end. Stops itself when no groups remain.
function _drawPulses()
{
    if (!_groups.size)
    {
        _stopTicker();
        return;
    }
    const now = performance.now() / 1000;
    for (const group of _groups.values())
    {
        const pulse = group._pulse;
        const segs = group._pulseSegs;
        if (!pulse || pulse.destroyed || !segs?.length)
            continue;
        pulse.clear();
        for (const seg of segs)
        {
            if (seg.len < 24)
                continue;
            const shift = (now * PULSE_SPEED) % BEAD_SPACING;
            for (let dist = shift; dist < seg.len; dist += BEAD_SPACING)
            {
                const fade = Math.min(1, dist / BEAD_FADE, (seg.len - dist) / BEAD_FADE);
                if (fade <= 0)
                    continue;
                const tPos = dist / seg.len;
                pulse.beginFill(seg.color, 0.5 * fade);
                pulse.drawCircle(seg.a.x + (seg.b.x - seg.a.x) * tPos, seg.a.y + (seg.b.y - seg.a.y) * tPos, 1.8);
                pulse.endFill();
            }
        }
    }
}

/** Removes the sightlines drawn under the given key. */
export function clearSightlines(key)
{
    const group = _groups.get(key);
    if (group)
    {
        group.destroy({ children: true });
        _groups.delete(key);
    }
}

function _lerp(pointA, pointB, tPos)
{
    return { x: pointA.x + (pointB.x - pointA.x) * tPos, y: pointA.y + (pointB.y - pointA.y) * tPos };
}

function _rayT(pointA, pointB, point)
{
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0)
        return 0;
    return Math.max(0, Math.min(1, ((point.x - pointA.x) * dx + (point.y - pointA.y) * dy) / lenSq));
}

// Whichever of the source's fill or line is most opaque, so a faint fill never hides the lane.
function _maxOpacity(source)
{
    const fill = Number(source?.fillOpacity);
    const line = Number(source?.lineOpacity);
    return Math.max(Number.isFinite(fill) ? fill : 0, Number.isFinite(line) ? line : 0) || 1;
}

function _colorOf(value, fallback)
{
    try
    {
        return Color.from(value ?? fallback).valueOf();
    }
    catch
    {
        return fallback;
    }
}

// Bisects between an inside and an outside sample so interval edges land on the zone boundary.
function _refineEdge(pointA, pointB, tInside, tOutside, testFn)
{
    for (let step = 0; step < 6; step++)
    {
        const mid = (tInside + tOutside) / 2;
        if (testFn(_lerp(pointA, pointB, mid), mid))
            tInside = mid;
        else
            tOutside = mid;
    }
    return (tInside + tOutside) / 2;
}

// Merges consecutive positive samples into [t0, t1] intervals with refined boundaries. testFn gets (point, t).
function _sampleIntervals(pointA, pointB, count, testFn)
{
    const intervals = [];
    let start = null;
    for (let index = 0; index <= count; index++)
    {
        const tPos = index / count;
        if (testFn(_lerp(pointA, pointB, tPos), tPos))
        {
            start ??= (index === 0 ? 0 : _refineEdge(pointA, pointB, tPos, (index - 1) / count, testFn));
        }
        else if (start !== null)
        {
            intervals.push([start, _refineEdge(pointA, pointB, (index - 1) / count, tPos, testFn)]);
            start = null;
        }
    }
    if (start !== null)
        intervals.push([start, 1]);
    return intervals;
}

function _terrainZones(pointA, pointB, heightA, heightB)
{
    const tht = thtApi();
    if (!tht?.calculateLineOfSight)
        return [];
    let regions;
    try
    {
        regions = tht.calculateLineOfSight({ x: pointA.x, y: pointA.y, h: heightA }, { x: pointB.x, y: pointB.y, h: heightB });
    }
    catch
    {
        return [];
    }
    const types = getTerrainTypeMap() ?? new Map();
    return (regions ?? []).map(region =>
    {
        const type = types.get(region.shapes?.[0]?.terrainTypeId);
        return {
            lane: 'terrain',
            color: _colorOf(type?.fillColor ?? type?.lineColor, 0xff4444),
            alpha: _maxOpacity(type),
            t0: _rayT(pointA, pointB, region.start),
            t1: _rayT(pointA, pointB, region.end),
        };
    }).filter(zone => zone.t1 > zone.t0);
}

// Membership test matching the template's occupied cells, so marks cover the exact cells, not the vanilla shape.
function _templateCellTest(template)
{
    if (canvas.grid.type === CONST.GRID_TYPES.GRIDLESS)
        return null;
    let covered = null;
    try
    {
        covered = game.modules.get('templatemacro')?.api?.getTemplateOccupiedOffsets?.(template.document) ?? null;
        if (!covered?.size)
        {
            const positions = template._getGridHighlightPositions?.() ?? [];
            covered = new Set();
            for (const position of positions)
            {
                const offset = canvas.grid.getOffset({ x: position.x + canvas.grid.sizeX / 2, y: position.y + canvas.grid.sizeY / 2 });
                covered.add(`${offset.i},${offset.j}`);
            }
        }
    }
    catch
    {
        return null;
    }
    if (!covered?.size)
        return null;
    return (point) =>
    {
        const offset = canvas.grid.getOffset(point);
        return covered.has(`${offset.i},${offset.j}`);
    };
}

// Same vertical rule as movement penalties: elevationGated templates span elevation to elevation + range.
function _templateBand(doc)
{
    const flags = doc.flags?.templatemacro ?? {};
    if (!flags.elevationGated)
        return null;
    const bottom = doc.elevation ?? 0;
    const range = Math.floor(Number(flags.elevationRangeManual ? (flags.elevationRange ?? 0) : (doc.distance ?? 0)) || 0);
    return { bottom, top: bottom + range };
}

function _templateZones(pointA, pointB, sampleCount, heightA, heightB)
{
    const zones = [];
    const heightAt = (tPos) => heightA + (heightB - heightA) * tPos;
    for (const template of canvas?.templates?.placeables ?? [])
    {
        const shape = template.shape;
        const doc = template.document;
        if (!shape || !doc)
            continue;
        const cellTest = _templateCellTest(template)
            ?? ((point) => shape.contains(point.x - doc.x, point.y - doc.y));
        const band = _templateBand(doc);
        const testFn = (point, tPos) =>
        {
            if (band)
            {
                const rayHeight = heightAt(tPos);
                if (rayHeight < band.bottom || rayHeight > band.top)
                    return false;
            }
            return cellTest(point);
        };
        const intervals = _sampleIntervals(pointA, pointB, sampleCount, testFn);
        const color = _colorOf(doc.fillColor ?? doc.borderColor, 0xff8c3a);
        for (const [t0, t1] of intervals)
            zones.push({ lane: 'template', color, alpha: 0.5, t0, t1 });
    }
    return zones;
}

function _auraZones(pointA, pointB, sampleCount, viewer, heightA, heightB)
{
    const api = game.modules.get('grid-aware-auras')?.api;
    if (typeof api?.getAurasContainingPoint !== 'function')
        return [];
    const viewerId = viewer?.document?.id;
    const heightAt = (tPos) => heightA + (heightB - heightA) * tPos;
    const keyOf = (hit) => `${hit.parent?.document?.id ?? '?'}:${hit.aura?.id ?? '?'}`;
    // Coarse pass discovers which auras the ray meets, then each gets refined intervals.
    const candidates = new Map();
    try
    {
        for (let index = 0; index <= sampleCount; index++)
        {
            const tPos = index / sampleCount;
            const point = _lerp(pointA, pointB, tPos);
            for (const hit of api.getAurasContainingPoint(point.x, point.y, { elevation: heightAt(tPos) }) ?? [])
            {
                if (hit.parent?.document?.id !== viewerId)
                {
                    candidates.set(keyOf(hit), {
                        color: _colorOf(hit.aura?.lineColor, 0x58c7f3),
                        alpha: _maxOpacity(hit.aura),
                    });
                }
            }
        }
        const zones = [];
        for (const [key, style] of candidates)
        {
            const testFn = (point, tPos) => (api.getAurasContainingPoint(point.x, point.y, { elevation: heightAt(tPos) }) ?? []).some(hit => keyOf(hit) === key);
            for (const [t0, t1] of _sampleIntervals(pointA, pointB, sampleCount, testFn))
                zones.push({ lane: 'aura', color: style.color, alpha: style.alpha, t0, t1 });
        }
        return zones;
    }
    catch
    {
        return [];
    }
}

function _perp(pointA, pointB)
{
    const dx = pointB.x - pointA.x;
    const dy = pointB.y - pointA.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: -dy / len, y: dx / len };
}

function _zoneSpan(pointA, pointB, zone, tMax)
{
    const t0 = Math.min(zone.t0, tMax);
    const t1 = Math.min(zone.t1, tMax);
    if (t1 <= t0)
        return null;
    return {
        t0, t1,
        start: _lerp(pointA, pointB, t0),
        end: _lerp(pointA, pointB, t1),
        offset: _laneOffset(zone.slot ?? 0)
    };
}

// Each zone gets its own lane beside the trace line, at the alpha of its own source.
function _drawZoneSegments(gfx, pointA, pointB, zones, tMax)
{
    const perp = _perp(pointA, pointB);
    for (const zone of zones)
    {
        const span = _zoneSpan(pointA, pointB, zone, tMax);
        if (!span)
            continue;
        gfx.lineStyle(LANE_WIDTH, zone.color, zone.alpha ?? 1);
        gfx.moveTo(span.start.x + perp.x * span.offset, span.start.y + perp.y * span.offset);
        gfx.lineTo(span.end.x + perp.x * span.offset, span.end.y + perp.y * span.offset);
    }
}

// T5 zone chips: hairline notches at the interval edges, a glyph chip at its midpoint.
function _drawZoneMarks(gfx, chipGfx, pointA, pointB, zones, tMax)
{
    const slotted = _assignLaneSlots(zones);
    _drawZoneSegments(gfx, pointA, pointB, slotted, tMax);
    const perp = _perp(pointA, pointB);
    for (const zone of slotted)
    {
        const span = _zoneSpan(pointA, pointB, zone, tMax);
        if (!span)
            continue;
        const { start, end, offset } = span;
        // Notch reaches from the far side of the trace line out past this zone's own lane.
        const side = offset >= 0 ? 1 : -1;
        const notchNear = -side * NOTCH_HALF;
        const notchFar = offset + side * (LANE_WIDTH / 2 + 2);
        gfx.lineStyle(1.5, zone.color, 0.9);
        for (const point of [start, end])
        {
            gfx.moveTo(point.x + perp.x * notchNear, point.y + perp.y * notchNear);
            gfx.lineTo(point.x + perp.x * notchFar, point.y + perp.y * notchFar);
        }
        if (Math.hypot(end.x - start.x, end.y - start.y) < CHIP_MIN_SPAN)
            continue;
        const mid = _lerp(pointA, pointB, (span.t0 + span.t1) / 2);
        const chipX = mid.x + perp.x * offset;
        const chipY = mid.y + perp.y * offset;
        chipGfx.lineStyle(2, zone.color, 1);
        chipGfx.beginFill(CHIP_FILL, 1);
        chipGfx.drawCircle(chipX, chipY, CHIP_RADIUS);
        chipGfx.endFill();
        _drawChipGlyph(chipGfx, chipX, chipY, zone.lane, zone.color);
    }
}

function _drawGlowRay(gfx, pointA, pointB, color, coreColor)
{
    gfx.lineStyle(7, color, 0.16);
    gfx.moveTo(pointA.x, pointA.y);
    gfx.lineTo(pointB.x, pointB.y);
    gfx.lineStyle(2.5, color, 1);
    gfx.moveTo(pointA.x, pointA.y);
    gfx.lineTo(pointB.x, pointB.y);
    gfx.lineStyle(1, coreColor, 0.8);
    gfx.moveTo(pointA.x, pointA.y);
    gfx.lineTo(pointB.x, pointB.y);
}

function _drawCutRay(gfx, pointA, pointB, blockPoint)
{
    const cut = blockPoint ?? _lerp(pointA, pointB, 0.5);
    gfx.lineStyle(2, COLOR_BLOCKED, 0.75);
    gfx.moveTo(pointA.x, pointA.y);
    gfx.lineTo(cut.x, cut.y);
    // Faint dashed continuation past the cut, purely to show where the ray was headed.
    const restLen = Math.hypot(pointB.x - cut.x, pointB.y - cut.y);
    if (restLen > 1)
    {
        gfx.lineStyle(1.5, COLOR_BLOCKED, 0.18);
        drawDashedEdges(gfx, [[cut, pointB]], 4, 7, 7);
    }
    gfx.lineStyle(2, COLOR_BLOCKED, 1);
    gfx.moveTo(cut.x - CUT_HALF, cut.y - CUT_HALF);
    gfx.lineTo(cut.x + CUT_HALF, cut.y + CUT_HALF);
    gfx.moveTo(cut.x + CUT_HALF, cut.y - CUT_HALF);
    gfx.lineTo(cut.x - CUT_HALF, cut.y + CUT_HALF);
}

// Gameplay height for zone traversal, without the +0.1 wall-peek margin LA bakes into eye heights.
function _zoneHeight(ref, eyeHeight)
{
    if (ref instanceof foundry.canvas.placeables.Token)
    {
        const doc = ref.document;
        const size = Number(ref.actor?.system?.size);
        const vertical = (Number.isFinite(size) && size > 0) ? size : (Number(doc?.width) || 1);
        return (doc?.elevation ?? 0) + vertical;
    }
    return eyeHeight - 0.1;
}

function _drawPair(group, viewer, target)
{
    const result = computeSightlineRays(viewer, target);
    if (!result)
        return;
    const gfx = group._gfx;
    const addSeg = (from, to, color) =>
    {
        const len = Math.hypot(to.x - from.x, to.y - from.y);
        group._pulseSegs.push({ a: from, b: to, len, color });
    };
    for (const ray of result.rays)
    {
        if (ray.clear)
        {
            _drawGlowRay(gfx, ray.a, ray.b, COLOR_CLEAR, COLOR_CLEAR_CORE);
            addSeg(ray.a, ray.b, COLOR_CLEAR);
        }
        else
        {
            _drawCutRay(gfx, ray.a, ray.b, ray.blockPoint);
            addSeg(ray.a, ray.blockPoint ?? _lerp(ray.a, ray.b, 0.5), COLOR_BLOCKED);
        }
    }
    if (result.witness)
    {
        _drawGlowRay(gfx, result.witness.a, result.witness.b, COLOR_WITNESS, COLOR_WITNESS_CORE);
        addSeg(result.witness.a, result.witness.b, COLOR_WITNESS);
    }
    const gridSize = canvas?.grid?.size ?? 100;
    const zoneHeightV = _zoneHeight(viewer, result.heightV);
    const zoneHeightT = _zoneHeight(target, result.heightT);
    const traversed = result.witness
        ? [...result.rays, { a: result.witness.a, b: result.witness.b, clear: true, blockPoint: null }]
        : result.rays;
    for (const ray of traversed)
    {
        const tMax = ray.clear ? 1 : _rayT(ray.a, ray.b, ray.blockPoint ?? _lerp(ray.a, ray.b, 0.5));
        const sampleCount = Math.max(4, Math.ceil(Math.hypot(ray.b.x - ray.a.x, ray.b.y - ray.a.y) / (gridSize / 4)));
        const zones = [
            ..._terrainZones(ray.a, ray.b, zoneHeightV, zoneHeightT),
            ..._auraZones(ray.a, ray.b, sampleCount, viewer, zoneHeightV, zoneHeightT),
            ..._templateZones(ray.a, ray.b, sampleCount, zoneHeightV, zoneHeightT),
        ];
        _drawZoneMarks(gfx, group._chips, ray.a, ray.b, zones, tMax);
    }
}

/**
 * Draws B1 sightlines from viewer to each target under the given key, replacing that key's previous draw.
 * @param {string} key
 * @param {Token} viewer
 * @param {(Token|{x: number, y: number, h?: number})[]} targets
 */
export function drawSightlines(key, viewer, targets)
{
    clearSightlines(key);
    if (!viewer || !targets?.length || !canvas?.ready)
        return;
    const group = _groupFor(key);
    for (const target of targets)
        _drawPair(group, viewer, target);
    if (group._pulseSegs.length)
        _ensureTicker();
}

// Token ids travel, not geometry: every client already has the walls and terrain to redraw it.
function _broadcastSightlines(viewer, targets)
{
    if (!canShareTools() || !canvas.scene || viewer?.document?.hidden)
        return;
    const targetIds = targets
        .filter(target => target instanceof foundry.canvas.placeables.Token && !target.document?.hidden)
        .map(target => target.document.id);
    if (!targetIds.length)
        return;
    game.socket.emit(CHANNEL, {
        action: 'sightlines',
        payload: { userId: game.user.id, sceneId: canvas.scene.id, viewerId: viewer.document.id, targetIds },
    });
}

function _clearBroadcastSightlines()
{
    if (!game.user || !getSettingEnabled('displayToolsToOthers'))
        return;
    game.socket.emit(CHANNEL, { action: 'sightlinesClear', payload: { userId: game.user.id } });
}

/** Target-hover sightlines shared by the roll dialogs and the uplink, same gates as the attack hover. */
export function hoverSightlines(viewer, target)
{
    if (!viewer || !target)
        return;
    if (!getSettingEnabled('lancerLos') || !getSettingEnabled(SETTING_ATTACK_HOVER))
        return;
    drawSightlines('attack-hover', viewer, [target]);
    _broadcastSightlines(viewer, [target]);
}

export function clearHoverSightlines()
{
    clearSightlines('attack-hover');
    _clearBroadcastSightlines();
}

/** Draws another client's hovered sightlines locally, under their own key. */
export function onRemoteSightlines(payload)
{
    if (!payload || payload.userId === game.user.id || !canSeeToolsFrom(payload.userId))
        return;
    if (payload.sceneId !== canvas.scene?.id)
        return;
    const viewer = canvas.tokens.get(payload.viewerId);
    const targets = (payload.targetIds ?? []).map(id => canvas.tokens.get(id)).filter(Boolean);
    if (!viewer || !targets.length)
    {
        clearSightlines(REMOTE_PREFIX + payload.userId);
        return;
    }
    drawSightlines(REMOTE_PREFIX + payload.userId, viewer, targets);
}

export function onRemoteSightlinesClear(payload)
{
    if (payload?.userId)
        clearSightlines(REMOTE_PREFIX + payload.userId);
}

// The system's AccDiffHUD drives THT's api on target hover. Reroute it to LA rays while Lancer LOS is on.
function _wrapThtHover()
{
    const tht = globalThis.terrainHeightTools;
    if (!tht?.drawLineOfSightRaysBetweenTokens || tht._laSightlinesWrapped)
        return;
    const originalDraw = tht.drawLineOfSightRaysBetweenTokens;
    const originalClear = tht.clearLineOfSightRays;
    tht.drawLineOfSightRaysBetweenTokens = function (token1, token2, options)
    {
        if (getSettingEnabled('lancerLos') && getSettingEnabled(SETTING_ATTACK_HOVER))
        {
            drawSightlines('attack-hover', token1, [token2]);
            _broadcastSightlines(token1, [token2]);
            return;
        }
        return originalDraw.call(this, token1, token2, options);
    };
    tht.clearLineOfSightRays = function (options)
    {
        clearSightlines('attack-hover');
        _clearBroadcastSightlines();
        return originalClear.call(this, options);
    };
    tht._laSightlinesWrapped = true;
}

export function initSightlines()
{
    game.settings.register(MODULE_ID, SETTING_ATTACK_HOVER, {
        name: 'Replace the THT ruler on attack hover',
        hint: 'Hovering a target on an attack card draws Lancer line of sight instead of THT\'s ruler.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    Hooks.once('ready', _wrapThtHover);
    Hooks.on('canvasTearDown', () =>
    {
        _stopTicker();
        _groups.clear();
        _layer = null;
    });
}
