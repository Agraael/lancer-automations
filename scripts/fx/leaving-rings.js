import { gridLineWidth } from '../interactive/canvas-primitives.js';
import { isLeaving } from '../combat/leave-battlefield.js';
import { markerColor } from '../combat/reinforcement-markers.js';
import { tickerToggle } from '../tools/canvas-utils.js';

const RING_COUNT = 3;
const RING_WIDTH = 4.6;
const RING_REACH = 0.95;
const RING_END = 0.22;
const RING_ALPHA = 0.9;
const RING_FADE_IN = 0.2;
const PULSE_MS = 1800;
const RING_SORT_LAYER = 695;

/** @typedef {PIXI.Graphics & { elevation: number, sortLayer: number, sort: number }} RingGraphics */

/** @type {Map<string, { token: any, graphics: RingGraphics, radius: number, cycle: number, color: number }>} */
const rings = new Map();
const toggleRings = tickerToggle(tickRings);

function ringRadius(doc)
{
    const half = canvas.grid.size / 2;
    const center = doc.getCenterPoint();
    const offsets = doc.getOccupiedGridSpaceOffsets();
    const reach = offsets.length
        ? Math.max(...offsets.map((offset) =>
        {
            const mid = canvas.grid.getCenterPoint(offset);
            return Math.hypot(mid.x - center.x, mid.y - center.y);
        }))
        : Math.max(doc.width * canvas.grid.sizeX, doc.height * canvas.grid.sizeY) / 2 - half;
    return reach + half * RING_REACH;
}

function tickRings()
{
    const now = performance.now();

    for (const entry of rings.values())
    {
        const { token, graphics } = entry;
        graphics.clear();
        if (token.destroyed || !token.renderable)
            continue;

        const { x, y } = token.center;
        for (let index = 0; index < RING_COUNT; index++)
        {
            const phase = ((now / entry.cycle) + index / RING_COUNT) % 1;
            const scale = 1 - (1 - RING_END) * phase ** 2;
            const alpha = phase < RING_FADE_IN
                ? RING_ALPHA * phase / RING_FADE_IN
                : RING_ALPHA * (1 - (phase - RING_FADE_IN) / (1 - RING_FADE_IN));
            graphics.lineStyle(gridLineWidth(RING_WIDTH) * scale, entry.color, alpha);
            graphics.drawCircle(x, y, entry.radius * scale);
        }
    }
}

function syncTicker()
{
    toggleRings(rings.size > 0);
}

function removeRings(id)
{
    const entry = rings.get(id);
    if (!entry)
        return;

    rings.delete(id);
    if (!entry.graphics.destroyed)
    {
        entry.graphics.parent?.removeChild(entry.graphics);
        entry.graphics.destroy();
    }
    syncTicker();
}

function clearRings()
{
    for (const id of [...rings.keys()])
        removeRings(id);
}

function syncRings(token)
{
    const doc = token?.document;
    if (!doc?.id || !canvas.ready)
        return;

    if (token.destroyed || !token.visible || !isLeaving(token.actor))
    {
        removeRings(doc.id);
        return;
    }

    let entry = rings.get(doc.id);
    if (!entry)
    {
        const graphics = /** @type {RingGraphics} */ (new PIXI.Graphics());
        graphics.eventMode = 'none';
        graphics.elevation = doc.elevation ?? 0;
        graphics.sortLayer = RING_SORT_LAYER;
        graphics.sort = doc.sort ?? 0;
        canvas.primary.addChild(graphics);
        entry = { token, graphics, radius: 0, cycle: PULSE_MS, color: 0 };
        rings.set(doc.id, entry);
    }
    else if (entry.graphics.elevation !== (doc.elevation ?? 0) || entry.graphics.sort !== (doc.sort ?? 0))
    {
        entry.graphics.elevation = doc.elevation ?? 0;
        entry.graphics.sort = doc.sort ?? 0;
        canvas.primary.sortDirty = true;
    }

    entry.token = token;
    entry.radius = ringRadius(doc);
    entry.cycle = PULSE_MS * entry.radius / (canvas.grid.size / 2 * RING_REACH);
    entry.color = markerColor(doc);
    syncTicker();
}

function syncActorRings(actor)
{
    if (!actor || !canvas.ready)
        return;
    for (const token of actor.getActiveTokens())
        syncRings(token);
}

export function initLeavingRings()
{
    Hooks.on('refreshToken', syncRings);
    Hooks.on('destroyToken', token => removeRings(token?.document?.id));
    Hooks.on('canvasTearDown', clearRings);
    Hooks.on('canvasReady', () =>
    {
        for (const token of canvas.tokens.placeables)
            syncRings(token);
    });

    for (const hook of /** @type {const} */ (['createActiveEffect', 'deleteActiveEffect']))
        Hooks.on(hook, effect => syncActorRings(effect?.parent));

    if (canvas.ready)
    {
        for (const token of canvas.tokens.placeables)
            syncRings(token);
    }
}
