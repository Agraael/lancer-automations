import { MODULE_ID } from '../tools/constants.js';
import { localize } from '../tools/string-utils.js';
import { tfTeamsColorSides, tfGetTeams, tfGetTeam } from '../tools/token-factions-utils.js';
import { isWorldClockShownTo, worldClockFill } from '../tools/world-clocks.js';
import { HIT_LABEL_STYLE, dragResistancePx, drawDashedEdges, footprintPerimeterEdges, gridLineWidth, makeText, pointerToWorld, suppressEvent } from '../interactive/canvas-helpers.js';
import { _cellCorners } from '../interactive/pulse-los-filter.js';
import { getReinforcements, isPlanChange, reinforcementClock, updateReinforcements } from './reinforcements.js';
import { openEntryMenu } from './reinforcement-menu.js';
import { tickerToggle } from '../tools/canvas-utils.js';
import { playUiSound, playTokenSelectSound, playTokenDeselectSound } from '../tah/sound.js';

const BASE_GRID = 100;
const PULSE_MS = [550, 1000, 1600, 2400];
const RING_COUNT = 3;
const RING_START = 0.12;
const RING_ALPHA = 0.95;
const RING_REACH = 0.95;
const RING_WIDTH = 4.6;
const CELL_LINE = 2.2;
const CELL_DASH = 5.5;
const BADGE_RADIUS = 0.62;
const BADGE_LINE = 3.7;
const BADGE_FILL = 0x0a080c;
const COUNT_SIZE = 0.58;
const COUNT_STROKE = 7.4;
const HOVER_LINE = 4.8;
const GHOST_ALPHA = 0.28;
const DRAG_ALPHA = 0.75;
const VIS_RADIUS = 13;
const VIS_GAP = 9.3;
const VIS_LINE = 1.85;
const ICON_UNIT = 1.85;
const ICON_LINE = 2.2;
const VIS_FILL = { secret: 0x5b2a8a, full: 0x1f6b4a };
const SIGNAL_COLOR = 0xcf7b2a;
const UNKNOWN_TEAM_COLOR = 0x9aa0a8;
const PREVIEW_ALPHA = 0.85;
const CHIP_FONT = 18;
const CHIP_HEIGHT = 30;
const CHIP_PAD = 18.5;
const CHIP_RADIUS = 5.5;
const CHIP_OFFSET = 40.7;
const CLOCK_RADIUS = 0.55;
const CLOCK_WIDTH = 0.3;
const CLOCK_GAP = 0.22;
const CLOCK_GAP_MAX = Math.PI / 18;
const CLOCK_EMPTY_ALPHA = 0.22;
const FLASH_MS = 1200;
const FLASH_LINE = 5.55;
const FLASH_REACH = 0.35;
const FLASH_FROM = 0.3;
const FLASH_TO = 1.7;
const HEX_ICON = [[0, -4.4], [3.81, -2.2], [3.81, 2.2], [0, 4.4], [-3.81, 2.2], [-3.81, -2.2]];
const MOUNTAIN_ICON = [[-2.1, 1.7], [-0.5, -0.5], [0.5, 0.6], [1.1, 0], [2.1, 1.7]];
const CROSS_ICON = 1.7;
const FLAG_POLE = [[-3.42, -3.74], [-3.42, 3.85]];
const FLAG_ICON = [[-3.42, -3.74], [3.51, -3.74], [2.41, -1.16], [3.51, 1.43], [-3.42, 1.43]];
const FLAG_MARK = [-0.29, -1.6];
const FLAG_MARK_SIZE = 5.3;
const TEAM_BADGE_FILL = 0x5d636c;

/**
 * @typedef {object} Marker
 * @property {string} id
 * @property {object} entry
 * @property {Combat} combat
 * @property {TokenDocument} doc
 * @property {PIXI.Container} root
 * @property {PIXI.Graphics} rings
 * @property {PIXI.Graphics[]} hover
 * @property {{x: number, y: number}} center
 * @property {number} ringRadius
 * @property {number} cycle
 * @property {number} color
 * @property {PIXI.Texture|null} texture
 */

/** @type {Map<string, Marker>} */
const markers = new Map();

/** @type {PIXI.Container|null} */
let layer = null;
let generation = 0;
const toggleRings = tickerToggle(tickRings);
let drag = null;
let rightStart = null;

/** @type {{ key: string, marker: Marker }|null} */
let preview = null;
let cardHoverId = null;
let hoveredId = null;

/** @type {Set<string>} */
const selected = new Set();

const scaled = value => value * canvas.grid.size / BASE_GRID;

const clientToWorld = event => canvas.stage.worldTransform.applyInverse(new PIXI.Point(event.clientX, event.clientY));

function roundsLeft(entry, combat)
{
    if (!entry.clock)
        return entry.round - (combat.round ?? 0);
    const clock = reinforcementClock(entry);
    return clock ? clock.max - clock.value : 0;
}

const pulseMs = left => PULSE_MS[Math.max(0, Math.min(PULSE_MS.length - 1, left))];

const showsArt = entry => game.user.isGM || entry.visibility === 'full';

function plannedHere(skipCombatId)
{
    const sceneId = canvas.scene?.id;
    return [...game.combats]
        .filter(combat => combat.id !== skipCombatId)
        .flatMap(combat => getReinforcements(combat)
            .filter(entry => entry.sceneId === sceneId && (game.user.isGM || entry.visibility !== 'secret'))
            .map(entry => ({ entry, combat })));
}

export function markerColor(doc)
{
    if (tfTeamsColorSides())
    {
        const teamId = tfGetTeam(doc);
        const team = tfGetTeams().find(other => other.id === teamId);
        if (team?.color)
            return Number(foundry.utils.Color.from(team.color));
    }

    const colors = CONFIG.Canvas.dispositionColors;
    if (doc.actor?.hasPlayerOwner)
        return colors.PARTY;
    const key = Object.keys(CONST.TOKEN_DISPOSITIONS).find(name => CONST.TOKEN_DISPOSITIONS[name] === doc.disposition);
    return colors[key] ?? colors.NEUTRAL;
}

function layout(doc, position)
{
    const data = { x: position.x, y: position.y, width: doc.width, height: doc.height };
    const cells = doc.getOccupiedGridSpaceOffsets(data).map(offset => [offset.j, offset.i]);
    const center = doc.getCenterPoint(data);
    const half = canvas.grid.size / 2;
    const bounds = Math.max(doc.width * canvas.grid.sizeX, doc.height * canvas.grid.sizeY) / 2;
    const reach = cells.length
        ? Math.max(...cells.map(([col, row]) =>
        {
            const mid = canvas.grid.getCenterPoint({ i: row, j: col });
            return Math.hypot(mid.x - center.x, mid.y - center.y);
        }))
        : bounds - half;
    const shapes = cells.length
        ? cells.map(([col, row]) => new PIXI.Polygon(_cellCorners(col, row).flatMap(point => [point.x, point.y])))
        : [new PIXI.Circle(center.x, center.y, bounds)];
    const bottom = cells.length
        ? Math.max(...shapes.flatMap(shape => /** @type {PIXI.Polygon} */ (shape).points.filter((_value, index) => index % 2 === 1)))
        : center.y + bounds;

    return { cells, center, half, shapes, bottom, ringRadius: reach + half * RING_REACH };
}

function cellEdges(cells)
{
    const edges = new Map();
    const pointKey = point => `${Math.round(point.x)},${Math.round(point.y)}`;

    for (const [col, row] of cells)
    {
        const corners = _cellCorners(col, row);
        corners.forEach((from, index) =>
        {
            const to = corners[(index + 1) % corners.length];
            edges.set([pointKey(from), pointKey(to)].sort((keyA, keyB) => keyA.localeCompare(keyB)).join('|'), [from, to]);
        });
    }

    return [...edges.values()];
}

function drawCells(graphics, geometry, color)
{
    graphics.beginFill(color, 0.08);
    for (const shape of geometry.shapes)
        graphics.drawShape(shape);
    graphics.endFill();

    graphics.lineStyle(gridLineWidth(CELL_LINE), color, 0.55);
    if (geometry.cells.length)
        drawDashedEdges(graphics, cellEdges(geometry.cells), scaled(CELL_DASH), scaled(CELL_DASH), 0);
    else
        graphics.drawShape(geometry.shapes[0]);
}

function drawHover(fill, line, geometry)
{
    const orange = CONFIG.Canvas.dispositionColors.CONTROLLED;

    fill.beginFill(orange, 0.12);
    for (const shape of geometry.shapes)
        fill.drawShape(shape);
    fill.endFill();

    line.lineStyle({ width: gridLineWidth(HOVER_LINE), color: orange, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    if (!geometry.cells.length)
    {
        line.drawShape(geometry.shapes[0]);
        return;
    }

    for (const [from, to] of footprintPerimeterEdges(geometry.cells))
    {
        line.moveTo(from.x, from.y);
        line.lineTo(to.x, to.y);
    }
}

function ghostArt(doc, geometry, texture)
{
    const width = doc.width * canvas.grid.sizeX * Math.abs(doc.texture.scaleX ?? 1);
    const height = doc.height * canvas.grid.sizeY * Math.abs(doc.texture.scaleY ?? 1);
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(doc.texture.anchorX ?? 0.5, doc.texture.anchorY ?? 0.5);
    sprite.scale.set(Math.min(width / texture.width, height / texture.height));
    sprite.position.set(geometry.center.x, geometry.center.y);
    sprite.alpha = GHOST_ALPHA;

    const mask = new PIXI.Graphics();
    mask.beginFill(0xffffff);
    for (const shape of geometry.shapes)
        mask.drawShape(shape);
    mask.endFill();
    sprite.mask = mask;

    return [mask, sprite];
}

function drawBadge(graphics, center, radius, color)
{
    const points = [];
    for (let index = 0; index < 6; index++)
    {
        const angle = Math.PI / 180 * (60 * index - 30);
        points.push(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    }

    graphics.lineStyle(gridLineWidth(BADGE_LINE), color, 1);
    graphics.beginFill(BADGE_FILL, 0.88);
    graphics.drawPolygon(points);
    graphics.endFill();
}

function countText(label, center, half)
{
    const size = half * COUNT_SIZE;
    const text = makeText(label, {
        ...HIT_LABEL_STYLE,
        fontSize: label.length > 2 ? size * 0.62 : size,
        strokeThickness: gridLineWidth(COUNT_STROKE),
        letterSpacing: 0,
        dropShadow: false,
    });
    text.anchor.set(0.5);
    text.position.set(center.x, center.y);
    return text;
}

function clockArcs(clock, center, badgeRadius)
{
    const arcs = new PIXI.Graphics();
    const radius = badgeRadius * CLOCK_RADIUS;
    const width = badgeRadius * CLOCK_WIDTH;
    const step = (Math.PI * 2) / clock.max;
    const gap = Math.min(CLOCK_GAP_MAX, step * CLOCK_GAP);
    const fill = Number(foundry.utils.Color.from(worldClockFill(clock)));

    for (let segment = 0; segment < clock.max; segment++)
    {
        const start = -Math.PI / 2 + segment * step + gap / 2;
        const end = start + step - gap;
        const filled = segment < clock.value;
        arcs.lineStyle(width, filled ? fill : 0xffffff, filled ? 1 : CLOCK_EMPTY_ALPHA);
        arcs.moveTo(center.x + radius * Math.cos(start), center.y + radius * Math.sin(start));
        arcs.arc(center.x, center.y, radius, start, end);
    }
    return arcs;
}

function badgeContent(entry, left, center, half)
{
    const clock = entry.clock ? reinforcementClock(entry) : null;
    if (clock && left > 0)
        return game.user.isGM || isWorldClockShownTo(clock, game.user) ? clockArcs(clock, center, half * BADGE_RADIUS) : countText('?', center, half);
    return countText(left > 0 ? String(left) : localize('LA.reinforcement.now'), center, half);
}

function drawVisBadge(graphics, visibility, at)
{
    const unit = scaled(ICON_UNIT);
    const flat = list => list.flatMap(([x, y]) => [at.x + x * unit, at.y + y * unit]);

    graphics.lineStyle(gridLineWidth(VIS_LINE), 0x000000, 0.7);
    graphics.beginFill(VIS_FILL[visibility]);
    graphics.drawCircle(at.x, at.y, scaled(VIS_RADIUS));
    graphics.endFill();

    graphics.lineStyle({ width: gridLineWidth(ICON_LINE), color: 0xffffff, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND });
    graphics.drawPolygon(flat(HEX_ICON));

    if (visibility === 'secret')
    {
        const arm = CROSS_ICON * unit;
        graphics.moveTo(at.x - arm, at.y - arm);
        graphics.lineTo(at.x + arm, at.y + arm);
        graphics.moveTo(at.x + arm, at.y - arm);
        graphics.lineTo(at.x - arm, at.y + arm);
        return;
    }

    graphics.lineStyle(0);
    graphics.beginFill(0xffffff);
    graphics.drawPolygon(flat(MOUNTAIN_ICON));
    graphics.endFill();
}

function teamBadge(at)
{
    const unit = scaled(ICON_UNIT);
    const flat = list => list.flatMap(([x, y]) => [at.x + x * unit, at.y + y * unit]);
    const graphics = new PIXI.Graphics();

    graphics.lineStyle(gridLineWidth(VIS_LINE), 0x000000, 0.7);
    graphics.beginFill(TEAM_BADGE_FILL);
    graphics.drawCircle(at.x, at.y, scaled(VIS_RADIUS));
    graphics.endFill();

    graphics.lineStyle(/** @type {any} */ ({ width: gridLineWidth(ICON_LINE), color: 0xffffff, cap: PIXI.LINE_CAP.ROUND, join: PIXI.LINE_JOIN.ROUND }));
    graphics.moveTo(at.x + FLAG_POLE[0][0] * unit, at.y + FLAG_POLE[0][1] * unit);
    graphics.lineTo(at.x + FLAG_POLE[1][0] * unit, at.y + FLAG_POLE[1][1] * unit);

    graphics.lineStyle(0);
    graphics.beginFill(0xffffff);
    graphics.drawPolygon(flat(FLAG_ICON));
    graphics.endFill();

    const mark = makeText('?', {
        ...HIT_LABEL_STYLE,
        fontFamily: 'Arial Black, Arial, sans-serif',
        fontWeight: '900',
        fontSize: FLAG_MARK_SIZE * unit,
        fill: TEAM_BADGE_FILL,
        strokeThickness: 0,
        letterSpacing: 0,
        dropShadow: false,
    });
    mark.anchor.set(0.5);
    mark.position.set(at.x + FLAG_MARK[0] * unit, at.y + FLAG_MARK[1] * unit);

    const badge = new PIXI.Container();
    badge.addChild(graphics, mark);
    return badge;
}

function previewChip(text, geometry)
{
    const label = makeText(text, {
        ...HIT_LABEL_STYLE,
        fontSize: scaled(CHIP_FONT),
        fill: 0x111111,
        strokeThickness: 0,
        letterSpacing: 0,
        dropShadow: false,
    });
    const middle = geometry.bottom + scaled(CHIP_OFFSET);
    label.anchor.set(0.5);
    label.position.set(geometry.center.x, middle);

    const width = label.width + scaled(CHIP_PAD);
    const height = scaled(CHIP_HEIGHT);
    const chip = new PIXI.Graphics();
    chip.beginFill(SIGNAL_COLOR);
    chip.drawRoundedRect(geometry.center.x - width / 2, middle - height / 2, width, height, scaled(CHIP_RADIUS));
    chip.endFill();

    return [chip, label];
}

function ensureLayer()
{
    if (layer && !layer.destroyed && layer.parent === canvas.tokens)
        return layer;

    layer = new PIXI.Container();
    layer.eventMode = game.user.isGM ? 'passive' : 'none';
    canvas.tokens.addChildAt(layer, 0);
    return layer;
}

function destroyMarker(marker)
{
    markers.delete(marker.id);
    if (marker.root.destroyed)
        return;
    marker.root.parent?.removeChild(marker.root);
    marker.root.destroy({ children: true });
}

function clearMarkers()
{
    for (const marker of markers.values())
        destroyMarker(marker);
}

function setHover(marker, shown)
{
    for (const part of marker.hover)
        part.visible = shown;
}

function refreshCue(marker)
{
    const id = marker.id;
    setHover(marker, selected.has(id) || hoveredId === id || cardHoverId === id || !!drag?.positions.has(id));
}

function refreshCues()
{
    for (const marker of markers.values())
        refreshCue(marker);
}

function createMarker({ entry, combat, doc, texture, position, isPreview = false })
{
    const geometry = layout(doc, position);
    const color = isPreview ? SIGNAL_COLOR : (entry.teamHidden && !game.user.isGM ? UNKNOWN_TEAM_COLOR : markerColor(doc));
    const left = roundsLeft(entry, combat);
    const badgeRadius = geometry.half * BADGE_RADIUS;

    const root = new PIXI.Container();

    const hoverFill = new PIXI.Graphics();
    const hoverLine = new PIXI.Graphics();
    drawHover(hoverFill, hoverLine, geometry);

    const cells = new PIXI.Graphics();
    drawCells(cells, geometry, color);

    const rings = new PIXI.Graphics();
    const badge = new PIXI.Graphics();
    drawBadge(badge, geometry.center, badgeRadius, color);

    root.addChild(hoverFill, cells);
    if (texture?.width && showsArt(entry))
        root.addChild(...ghostArt(doc, geometry, texture));
    root.addChild(rings, badge, badgeContent(entry, left, geometry.center, geometry.half));

    if (game.user.isGM && entry.visibility !== 'exact')
    {
        const vis = new PIXI.Graphics();
        drawVisBadge(vis, entry.visibility, { x: geometry.center.x + badgeRadius + scaled(VIS_GAP), y: geometry.center.y - badgeRadius * 0.55 });
        root.addChild(vis);
    }
    if (game.user.isGM && entry.teamHidden && !isPreview)
        root.addChild(teamBadge({ x: geometry.center.x + badgeRadius + scaled(VIS_GAP), y: geometry.center.y + badgeRadius * 0.55 }));
    if (isPreview)
        root.addChild(...previewChip(`${doc.name.toUpperCase()} · ${reinforcementClock(entry)?.name || `R${entry.round}`}`, geometry));
    root.addChild(hoverLine);

    /** @type {Marker} */
    const marker = {
        id: entry.id,
        entry,
        combat,
        doc,
        root,
        rings,
        hover: [hoverFill, hoverLine],
        center: geometry.center,
        ringRadius: geometry.ringRadius,
        cycle: pulseMs(left) * geometry.ringRadius / (geometry.half * RING_REACH),
        color,
        texture,
    };

    setHover(marker, false);
    return { marker, shapes: geometry.shapes };
}

function buildMarker({ entry, combat, doc: draft = null }, texture)
{
    const doc = draft ?? new CONFIG.Token.documentClass(entry.tokenData, { parent: canvas.scene });
    const dragged = drag?.positions.get(entry.id) ?? null;
    const { marker, shapes } = createMarker({ entry, combat, doc, texture, position: dragged ?? doc });

    marker.root.alpha = dragged ? DRAG_ALPHA : 1;
    refreshCue(marker);
    if (game.user.isGM)
        bindMarker(marker, shapes);

    ensureLayer().addChild(marker.root);
    markers.set(entry.id, marker);
}

export function showDropPreview({ doc, texture, position, round, clock = null, visibility, combat })
{
    const key = `${position.x},${position.y},${round},${clock},${visibility}`;
    if (preview?.key === key && !preview.marker.root.destroyed)
        return;

    clearDropPreview();
    if (!canvas.ready)
        return;

    const entry = { id: 'preview', tokenData: doc.toObject(), round, clock, visibility };
    const { marker } = createMarker({ entry, combat, doc, texture, position, isPreview: true });
    marker.root.alpha = PREVIEW_ALPHA;
    marker.root.eventMode = 'none';
    ensureLayer().addChild(marker.root);
    preview = { key, marker };
    syncTicker();
}

function flashMarker({ center, ringRadius })
{
    const ring = new PIXI.Graphics();
    ring.eventMode = 'none';
    ensureLayer().addChild(ring);

    const color = CONFIG.Canvas.dispositionColors.CONTROLLED;
    const radius = ringRadius + canvas.grid.size / 2 * FLASH_REACH;
    const { x, y } = center;
    const began = performance.now();

    const tick = () =>
    {
        const progress = Math.min(1, (performance.now() - began) / FLASH_MS);
        if (ring.destroyed || progress >= 1)
        {
            canvas.app.ticker.remove(tick);
            if (!ring.destroyed)
                ring.destroy();
            return;
        }

        const eased = 1 - (1 - progress) ** 2;
        const scale = FLASH_FROM + (FLASH_TO - FLASH_FROM) * eased;
        ring.clear();
        ring.lineStyle(gridLineWidth(FLASH_LINE) * scale, color, 1 - eased);
        ring.drawCircle(x, y, radius * scale);
    };

    canvas.app.ticker.add(tick);
}

export function flashToken(token)
{
    if (canvas.ready && token?.document)
        flashMarker(layout(token.document, token.document));
}

export function hoverMarker(id)
{
    if (!game.user.isGM || cardHoverId === id)
        return;

    const previous = cardHoverId ? markers.get(cardHoverId) : null;
    cardHoverId = id;
    if (previous)
        refreshCue(previous);

    const marker = id ? markers.get(id) : null;
    if (marker)
        refreshCue(marker);
}

export function selectedMarkers()
{
    return [...selected].map(id => markers.get(id)).filter(Boolean).map(marker => ({ entry: marker.entry, combat: marker.combat }));
}

export function markerGroup(entryId, combatId)
{
    if (!selected.has(entryId))
        return [entryId];
    return [...selected].filter(id => markers.get(id)?.combat.id === combatId);
}

function selectionSound(before)
{
    if ([...selected].some(id => !before.has(id)))
        playTokenSelectSound();
    else if ([...before].some(id => !selected.has(id)))
        playTokenDeselectSound();
}

export function clearMarkerSelection({ silent = false } = {})
{
    if (!selected.size)
        return;
    selected.clear();
    if (!silent)
        playTokenDeselectSound();
    refreshCues();
}

export function selectMarkersIn(rect, releaseOthers)
{
    if (!game.user.isGM)
        return false;

    const before = new Set(selected);
    const inside = [...markers.values()].filter(marker => rect.contains(marker.center.x, marker.center.y));
    if (releaseOthers)
        selected.clear();
    inside.forEach(marker => selected.add(marker.id));
    selectionSound(before);
    refreshCues();
    return inside.length > 0;
}

function selectOnly(id)
{
    const before = new Set(selected);
    selected.clear();
    canvas.tokens.releaseAll();
    selected.add(id);
    selectionSound(before);
    refreshCues();
}

export function focusMarker(id)
{
    const marker = markers.get(id);
    if (!marker || !canvas.ready)
        return;

    canvas.animatePan({ x: marker.center.x, y: marker.center.y, scale: Math.max(canvas.stage.scale.x, /** @type {any} */ (canvas.dimensions).scale.default) });
    flashMarker(marker);
}

export function clearDropPreview()
{
    if (!preview)
        return;

    if (!preview.marker.root.destroyed)
    {
        preview.marker.root.parent?.removeChild(preview.marker.root);
        preview.marker.root.destroy({ children: true });
    }
    preview = null;
    syncTicker();
}

function redrawMarker(id)
{
    const marker = markers.get(id);
    if (!marker)
        return;
    destroyMarker(marker);
    buildMarker(marker, marker.texture);
}

function drawRings(marker, now)
{
    const rings = marker.rings;
    rings.clear();

    for (let index = 0; index < RING_COUNT; index++)
    {
        const phase = ((now / marker.cycle) + index / RING_COUNT) % 1;
        const eased = 1 - (1 - phase) ** 2;
        const scale = RING_START + (1 - RING_START) * eased;
        rings.lineStyle(gridLineWidth(RING_WIDTH) * scale, marker.color, RING_ALPHA * (1 - eased));
        rings.drawCircle(marker.center.x, marker.center.y, marker.ringRadius * scale);
    }
}

function tickRings()
{
    const now = performance.now();

    for (const marker of markers.values())
        drawRings(marker, now);
    if (preview && !preview.marker.root.destroyed)
        drawRings(preview.marker, now);
}

function syncTicker()
{
    toggleRings(markers.size > 0 || !!preview);
}

async function refreshMarkers(skipCombatId = null)
{
    const run = ++generation;
    if (!canvas.ready || !canvas.scene)
        return;

    const planned = plannedHere(skipCombatId);
    const textures = await Promise.all(planned.map(({ entry }) =>
    {
        const src = entry.tokenData.texture?.src;
        return showsArt(entry) && src ? foundry.canvas.loadTexture(src).catch(() => null) : null;
    }));

    if (run !== generation || !canvas.ready)
        return;

    clearMarkers();
    planned.forEach((item, index) => buildMarker(item, textures[index]));
    for (const id of selected)
    {
        if (!markers.has(id))
            selected.delete(id);
    }
    syncTicker();
}

function gridCellKey(point)
{
    const offset = canvas.grid.getOffset({ x: point.x, y: point.y });
    return `${offset.i},${offset.j}`;
}

function stopDrag()
{
    document.removeEventListener('pointermove', onDragMove, true);
    document.removeEventListener('pointerup', onDragEnd, true);
    document.removeEventListener('keydown', onDragKey, true);
    drag = null;
}

function onPress(marker, event)
{
    if (event.button !== 0)
        return;

    event.stopPropagation();
    const shift = !!event.shiftKey;
    const wasSelected = selected.has(marker.id);
    if (shift && !wasSelected)
    {
        selected.add(marker.id);
        playTokenSelectSound();
        refreshCue(marker);
    }
    else if (!shift && !wasSelected)
        selectOnly(marker.id);

    const world = pointerToWorld(event);
    drag = {
        id: marker.id,
        ids: selected.has(marker.id) ? [...selected].filter(id => markers.has(id)) : [marker.id],
        doc: marker.doc,
        startX: event.clientX,
        startY: event.clientY,
        grab: { x: world.x - marker.center.x, y: world.y - marker.center.y },
        cell: gridCellKey(marker.doc),
        moved: false,
        shift,
        wasSelected,
        position: null,
        positions: new Map(),
    };
    marker.root.cursor = 'grabbing';

    document.addEventListener('pointermove', onDragMove, true);
    document.addEventListener('pointerup', onDragEnd, true);
    document.addEventListener('keydown', onDragKey, true);
}

function onDragMove(event)
{
    if (!drag)
        return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < dragResistancePx())
        return;

    drag.moved = true;
    const world = clientToWorld(event);
    const position = /** @type {any} */ (CONFIG.Token.objectClass)._getDropActorPosition(drag.doc, { x: world.x - drag.grab.x, y: world.y - drag.grab.y }, { snap: !event.shiftKey });
    if (drag.position?.x === position.x && drag.position?.y === position.y)
        return;

    drag.position = { x: position.x, y: position.y };
    const cell = gridCellKey(position);
    if (cell !== drag.cell)
    {
        drag.cell = cell;
        playUiSound('tokenDrag');
    }

    const dx = position.x - drag.doc.x;
    const dy = position.y - drag.doc.y;
    for (const id of drag.ids)
    {
        const other = markers.get(id);
        if (other)
            drag.positions.set(id, { x: other.doc.x + dx, y: other.doc.y + dy });
    }
    drag.ids.forEach(redrawMarker);
}

function clickMarker({ id, shift, wasSelected })
{
    if (shift && wasSelected)
    {
        selected.delete(id);
        playTokenDeselectSound();
    }
    else if (!shift && wasSelected)
    {
        selectOnly(id);
        return;
    }
    refreshCues();
}

async function onDragEnd(event)
{
    if (!drag || event.button !== 0)
        return;

    const finished = drag;
    stopDrag();

    const marker = markers.get(finished.id);
    if (marker)
        marker.root.cursor = 'grab';
    if (!finished.moved)
    {
        clickMarker(finished);
        return;
    }

    const byCombat = new Map();
    for (const [id, position] of finished.positions)
    {
        const moved = markers.get(id);
        if (!moved || (position.x === moved.doc.x && position.y === moved.doc.y))
            continue;
        moved.root.alpha = 1;
        const updates = byCombat.get(moved.combat) ?? [];
        updates.push({ id, changes: { tokenData: { x: position.x, y: position.y } } });
        byCombat.set(moved.combat, updates);
    }

    for (const [combat, updates] of byCombat)
        await updateReinforcements(updates, combat);
}

function onDragKey(event)
{
    if (!drag || event.key !== 'Escape')
        return;

    suppressEvent(event);
    const ids = drag.ids;
    stopDrag();
    ids.forEach(redrawMarker);
}

function onRightUp(marker, event)
{
    const start = rightStart;
    rightStart = null;
    if (start?.id !== marker.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) >= dragResistancePx())
        return;
    openEntryMenu(marker.entry, marker.combat, event.nativeEvent, markerGroup(marker.id, marker.combat.id));
}

function bindMarker(marker, shapes)
{
    const root = marker.root;
    root.eventMode = 'static';
    root.interactiveChildren = false;
    root.cursor = drag?.id === marker.id ? 'grabbing' : 'grab';
    root.hitArea = /** @type {PIXI.IHitArea} */ ({ contains: (x, y) => shapes.some(shape => shape.contains(x, y)) });

    root.on('pointerover', () =>
    {
        if (hoveredId !== marker.id && !drag && !selected.has(marker.id))
            playUiSound('battleLogHover');
        hoveredId = marker.id;
        refreshCue(marker);
    });
    root.on('pointerout', () =>
    {
        if (hoveredId === marker.id)
            hoveredId = null;
        refreshCue(marker);
    });
    root.on('pointerdown', event => onPress(marker, event));
    root.on('rightdown', (event) =>
    {
        rightStart = { id: marker.id, x: event.clientX, y: event.clientY };
    });
    root.on('rightup', event => onRightUp(marker, event));
}

export function initReinforcementMarkers()
{
    Hooks.on('canvasReady', () =>
    {
        refreshMarkers();
    });

    Hooks.on('canvasTearDown', () =>
    {
        generation++;
        stopDrag();
        selected.clear();
        hoveredId = null;
        clearMarkers();
        clearDropPreview();
        syncTicker();
        layer = null;
    });

    Hooks.on('updateCombat', (combat, changed) =>
    {
        if (isPlanChange(changed) || 'round' in changed)
            refreshMarkers();
    });

    Hooks.on('deleteCombat', combat => refreshMarkers(combat.id));

    Hooks.on(`${MODULE_ID}.worldClocksChanged`, () =>
    {
        if ([...markers.values()].some(marker => marker.entry.clock))
            refreshMarkers();
    });

    if (canvas.ready)
        refreshMarkers();
}
