import { getModuleSetting } from '../tools/settings-utils.js';
import { getOccupiedOffsets } from '../combat/grid-helpers.js';

const BASE_GRID = 100;
const CUE_SORT_LAYER = 690;

const CUE_STATUSES = [
    ['bulwark', 0x000000],
    ['guardian', 0x757575]
];

const BRACKET_REACH = 16;
const BRACKET_WIDTH = 6;
const HAIRLINE_WIDTH = 1;
const CIRCLE_POINTS = 48;
const CIRCLE_CORNER_STEP = 8;

/** @typedef {PIXI.Container & { elevation: number, sortLayer: number, sort: number }} CueLayer */

/** @type {Map<string, CueLayer>} */
const cues = new Map();
const cueKeys = new Map();

function cueMode()
{
    return getModuleSetting('guardianBulwarkAuraMode') || 'always';
}

function cueColor(token)
{
    const statuses = token?.actor?.statuses;
    if (!statuses)
        return null;
    for (const [statusId, color] of CUE_STATUSES)
    {
        if (statuses.has(statusId))
            return color;
    }
    return null;
}

function removeCue(id)
{
    const cue = cues.get(id);
    cueKeys.delete(id);
    if (!cue)
        return;
    cue.parent?.removeChild(cue);
    if (!cue.destroyed)
        cue.destroy({ children: true });
    cues.delete(id);
}

export function clearStatusCues()
{
    for (const id of [...cues.keys()])
        removeCue(id);
}

function pointKey(point)
{
    return `${Math.round(point.x * 100) / 100},${Math.round(point.y * 100) / 100}`;
}

function dropCollinear(points)
{
    return points.filter((point, index) =>
    {
        const before = points[(index - 1 + points.length) % points.length];
        const after = points[(index + 1) % points.length];
        const cross = (point.x - before.x) * (after.y - point.y) - (point.y - before.y) * (after.x - point.x);
        return Math.abs(cross) > 1;
    });
}

function circleOutline(token)
{
    const doc = token.document;
    const width = (doc.width ?? 1) * canvas.grid.sizeX;
    const height = (doc.height ?? 1) * canvas.grid.sizeY;
    const centerX = doc.x + (width / 2);
    const centerY = doc.y + (height / 2);
    const radius = Math.max(width, height) / 2;

    const points = [];
    const corners = [];
    for (let index = 0; index < CIRCLE_POINTS; index++)
    {
        const angle = (index / CIRCLE_POINTS) * Math.PI * 2;
        points.push({ x: centerX + (Math.cos(angle) * radius), y: centerY + (Math.sin(angle) * radius) });
        if (index % CIRCLE_CORNER_STEP === 0)
            corners.push(index);
    }
    return { points, corners };
}

function footprintOutline(token)
{
    const offsets = getOccupiedOffsets(token) ?? [];
    if (!offsets.length)
        return circleOutline(token);

    const edgeCount = new Map();
    const edges = [];
    for (const offset of offsets)
    {
        const vertices = canvas.grid.getVertices({ i: offset.row, j: offset.col });
        for (let index = 0; index < vertices.length; index++)
        {
            const from = vertices[index];
            const to = vertices[(index + 1) % vertices.length];
            const fromKey = pointKey(from);
            const toKey = pointKey(to);
            const key = fromKey < toKey ? `${fromKey}|${toKey}` : `${toKey}|${fromKey}`;
            edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
            edges.push({ from, to, key });
        }
    }

    const neighbours = new Map();
    for (const edge of edges)
    {
        if (edgeCount.get(edge.key) !== 1)
            continue;
        for (const [point, other] of [[edge.from, edge.to], [edge.to, edge.from]])
        {
            const key = pointKey(point);
            if (!neighbours.has(key))
                neighbours.set(key, []);
            neighbours.get(key).push(other);
        }
    }

    const start = neighbours.keys().next().value;
    if (!start)
        return { points: [], corners: [] };

    const walked = [];
    let current = start;
    let previous = null;
    while (current && walked.length <= neighbours.size)
    {
        const [x, y] = current.split(',').map(Number);
        walked.push({ x, y });
        const next = (neighbours.get(current) ?? []).find(point => pointKey(point) !== previous);
        if (!next)
            break;
        previous = current;
        current = pointKey(next);
        if (current === start)
            break;
    }

    const points = dropCollinear(walked);
    return { points, corners: points.map((_point, index) => index) };
}

function drawCue(cue, shape, color, scale)
{
    const [mask, art] = cue.children;
    const flat = shape.points.flatMap(point => [point.x, point.y]);

    mask.clear();
    mask.beginFill(0xffffff);
    mask.drawPolygon(flat);
    mask.endFill();

    art.clear();
    art.lineStyle(HAIRLINE_WIDTH * scale * 2, color, 0.3);
    art.drawPolygon(flat);

    art.lineStyle({
        width: BRACKET_WIDTH * scale * 2,
        color,
        alpha: 0.9,
        join: PIXI.LINE_JOIN.MITER,
        cap: PIXI.LINE_CAP.BUTT,
        miterLimit: 12
    });

    const reach = BRACKET_REACH * scale;
    const points = shape.points;
    for (const index of shape.corners)
    {
        const vertex = points[index];
        const toward = (point) =>
        {
            const length = Math.hypot(point.x - vertex.x, point.y - vertex.y) || 1;
            const step = Math.min(reach, length * 0.45);
            return {
                x: vertex.x + ((point.x - vertex.x) / length * step),
                y: vertex.y + ((point.y - vertex.y) / length * step)
            };
        };
        const from = toward(points[(index - 1 + points.length) % points.length]);
        const to = toward(points[(index + 1) % points.length]);
        art.moveTo(from.x, from.y);
        art.lineTo(vertex.x, vertex.y);
        art.lineTo(to.x, to.y);
    }
}

export function refreshStatusCue(token)
{
    const id = token?.document?.id;
    if (!id || !canvas?.ready)
        return;

    const mode = cueMode();
    const shown = mode !== 'off' && (mode !== 'combat' || !!game.combat);
    const color = cueColor(token);
    if (!shown || color === null || token.document.hidden || !token.visible)
    {
        removeCue(id);
        return;
    }

    const doc = token.document;
    const key = [doc.x, doc.y, doc.width, doc.height, doc.shape, color, canvas.grid.size].join(':');

    let cue = cues.get(id);
    if (!cue)
    {
        cue = /** @type {CueLayer} */ (/** @type {any} */ (new PIXI.Container()));
        cue.eventMode = 'none';
        const mask = new PIXI.Graphics();
        const art = new PIXI.Graphics();
        art.mask = mask;
        cue.addChild(mask, art);

        cue.elevation = doc.elevation ?? 0;
        cue.sortLayer = CUE_SORT_LAYER;
        cue.sort = doc.sort ?? 0;

        canvas.primary.addChild(cue);
        cues.set(id, cue);
    }

    cue.elevation = doc.elevation ?? 0;
    cue.sort = doc.sort ?? 0;

    if (cueKeys.get(id) === key)
        return;
    cueKeys.set(id, key);

    const shape = footprintOutline(token);
    if (shape.points.length < 3)
    {
        removeCue(id);
        return;
    }
    drawCue(cue, shape, color, canvas.grid.size / BASE_GRID);
}

export function refreshAllStatusCues()
{
    for (const token of canvas.tokens?.placeables ?? [])
        refreshStatusCue(token);
}

function refreshActorCues(actor)
{
    if (!actor || !canvas?.ready)
        return;
    for (const token of canvas.tokens?.placeables ?? [])
    {
        if (token.actor === actor || token.actor?.id === actor.id)
            refreshStatusCue(token);
    }
}

Hooks.on('refreshToken', refreshStatusCue);
Hooks.on('destroyToken', token => removeCue(token?.document?.id));
Hooks.on('canvasTearDown', clearStatusCues);
Hooks.on('canvasReady', () => refreshAllStatusCues());
Hooks.on('createActiveEffect', effect => refreshActorCues(effect?.parent));
Hooks.on('deleteActiveEffect', effect => refreshActorCues(effect?.parent));
Hooks.on('createCombat', () => refreshAllStatusCues());
Hooks.on('deleteCombat', () => refreshAllStatusCues());
