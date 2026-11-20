import { CLIPS, FAMILY_FTS } from './clips.js';

const FT_MIN = { '05': 0, '15': 2, '30': 5, '60': 9, '90': 15 };
const OPACITY = { 'smoke-ring': 0.4 };
const CONE_APEX = { 'cone5e-orangeyellow': 100, 'cone5e-lightning': 100 };
const TEMPLATE_GRID = { 'piercing-line-orange': 200 };

export const IMPACT_CLIPS = new Set(['impact-orange', 'static-blue', 'impact-004-blue', 'impact-010-orange']);

export let gridSize = 100;

export function setGridSize(size)
{
    gridSize = size;
}

export function polar(origin, angleDeg, distance)
{
    const rad = angleDeg * Math.PI / 180;
    return { x: origin.x + Math.cos(rad) * distance, y: origin.y + Math.sin(rad) * distance };
}

export const dist = (from, to) => Math.hypot(to.x - from.x, to.y - from.y);
export const angleOf = (from, to) => Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
export const jitter = (point, amount, rng) => ({ x: point.x + (rng() - 0.5) * amount * gridSize, y: point.y + (rng() - 0.5) * amount * gridSize });

export function seeded(seed)
{
    let value = seed;

    return () =>
    {
        value = (value * 9301 + 49297) % 233280;
        return value / 233280;
    };
}

export function pickFt(family, length)
{
    const fts = FAMILY_FTS[family];
    let pick = fts[0];

    for (const ft of fts.slice(1))
    {
        if (length / gridSize >= FT_MIN[ft])
            pick = ft;
    }

    return pick;
}

export const place = (left, top, width, height, ox, oy, angle) => ({ left, top, width, height, ox, oy, angle });

export function linePlace(meta, from, to, thickness = gridSize)
{
    const [x0, y0, visX1, y1] = meta.vis;
    const x1 = meta.brightMax ?? visX1;
    const kx = dist(from, to) / (x1 - x0);
    const ky = thickness / meta.core;
    const cy = (y0 + y1) / 2;
    return place(from.x - x0 * kx, from.y - cy * ky, meta.w * kx, meta.h * ky, x0 * kx, cy * ky, angleOf(from, to));
}

export function conePlace(meta, apex, origin, angle, length)
{
    const scale = length / ((meta.brightMax ?? meta.vis[2]) - apex);
    return place(origin.x - apex * scale, origin.y - meta.h * scale / 2, meta.w * scale, meta.h * scale, apex * scale, meta.h * scale / 2, angle);
}

export function circlePlace(meta, center, diameter, angle = 0)
{
    const [x0, y0, x1, y1] = meta.vis;
    const scale = diameter / Math.max(x1 - x0, y1 - y0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return place(center.x - cx * scale, center.y - cy * scale, meta.w * scale, meta.h * scale, cx * scale, cy * scale, angle);
}

export function muzzlePlace(meta, origin, angle, length)
{
    const [x0, y0, x1, y1] = meta.vis;
    const scale = length / (x1 - x0);
    const cy = (y0 + y1) / 2;
    return place(origin.x - x0 * scale, origin.y - cy * scale, meta.w * scale, meta.h * scale, x0 * scale, cy * scale, angle);
}

export function nativePlace(src, center, scale, angle = 0, gridBase = 100, scaleY = scale)
{
    const width = CLIPS[src].w / gridBase * gridSize * scale;
    const height = CLIPS[src].h / gridBase * gridSize * scaleY;
    return place(center.x - width / 2, center.y - height / 2, width, height, width / 2, height / 2, angle);
}

export function meleePlace(meta, from, to)
{
    const scale = dist(from, to) / (meta.w - 600);
    return place(from.x - 300 * scale, from.y - meta.h * scale / 2, meta.w * scale, meta.h * scale, 300 * scale, meta.h * scale / 2, angleOf(from, to));
}

export function framePlace(center, size)
{
    return place(center.x - size / 2, center.y - size / 2, size, size, size / 2, size / 2, 0);
}

export const visEnd = src => CLIPS[src].brightMax ?? CLIPS[src].vis[2];

export function reachTime(src, fileX, skip = 0, rate = 1)
{
    const front = CLIPS[src].front?.filter(([time]) => time >= skip);

    if (front?.length)
    {
        const hit = front.find(([, value]) => value >= fileX);
        return ((hit ? hit[0] : front[front.length - 1][0]) - skip) / rate;
    }

    const reach = CLIPS[src].reach;
    if (!reach)
        return CLIPS[src].arrive ?? Math.min(CLIPS[src].peak, 1000);

    const index = reach.findIndex(value => value >= fileX);
    return (index < 0 ? reach.length - 1 : index) * 50;
}

export class Recipe
{
    constructor()
    {
        this.steps = [];
        this.sounds = [];
        this.hit = 0;
        this.hitTimes = null;
        this.impact = null;
        this.t0 = 0;
    }

    get last()
    {
        return this.steps[this.steps.length - 1];
    }

    add(src, at, placement, layer = 'fx')
    {
        this.steps.push({ src, at: Math.round(at), ms: CLIPS[src].ms, place: placement, layer, opacity: OPACITY[src] ?? 1 });
        return this;
    }

    startTime(ms)
    {
        this.last.skip = ms;
        this.last.ms -= ms;
        return this;
    }

    filter(css)
    {
        this.last.filter = css;
        return this;
    }

    playbackRate(rate)
    {
        this.last.rate = rate;
        this.last.ms = Math.round(this.last.ms / rate);
        return this;
    }

    duration(ms, fade)
    {
        this.last.ms = Math.min(this.last.ms, Math.round(ms));
        this.last.fade = fade;
        return this;
    }

    proj(family, from, to, at, scale = 1)
    {
        const src = `${family}-${pickFt(family, dist(from, to) / scale)}`;
        this.steps.push({ src, at: Math.round(at), ms: CLIPS[src].ms, from: { ...from }, to: { ...to }, scale, layer: 'fx', opacity: 1 });
        return at + CLIPS[src].arrive;
    }

    circle(src, center, diameter, at, layer = 'fx', angle = 0)
    {
        return this.add(src, at, circlePlace(CLIPS[src], center, diameter, angle), layer);
    }

    sound(file, at)
    {
        this.sounds.push({ file, at: Math.round(at) });
        return this;
    }
}

export function timeHits(recipe, scene, src, at, fileXOf, skip = 0, rate = 1)
{
    recipe.hitTimes = scene.hits.map(target => at + reachTime(src, fileXOf(dist(scene.shape.origin, target)), skip, rate));
    recipe.hit = recipe.hitTimes.length ? Math.min(...recipe.hitTimes) : 0;
}

export function coneArt(recipe, scene, src, skip = 0, rate = 1)
{
    const apex = CONE_APEX[src];
    recipe.add(src, 0, conePlace(CLIPS[src], apex, scene.shape.origin, scene.shape.angle, scene.shape.length)).startTime(skip).playbackRate(rate);
    const scale = scene.shape.length / (visEnd(src) - apex);
    timeHits(recipe, scene, src, 0, reach => apex + reach / scale, skip, rate);
}

const lineThickness = natural => Math.min(natural, Math.max(1.6 * gridSize, natural / 1.5));

export function stackLine(recipe, scene, src, at = 0, pace = 1, skip = 0)
{
    const meta = CLIPS[src];
    const x0 = meta.vis[0];
    const x1 = visEnd(src);
    const natural = (x1 - x0) * gridSize / (TEMPLATE_GRID[src] ?? 100);
    const count = Math.max(1, Math.ceil(scene.shape.length / natural - 0.15));
    const seg = scene.shape.length / count;
    const overlap = 0.15 * seg;
    const fullTime = reachTime(src, x0 + 0.92 * (x1 - x0), skip);
    const full = meta.front.filter(([time, value]) => time >= skip && value >= x0 + 0.92 * (x1 - x0));
    const retract = full.length && full[full.length - 1][0] - full[0][0] > 500 ? full[full.length - 1][0] - skip : null;
    const travel = (retract != null && count > 1 ? Math.min(fullTime, (retract - fullTime) / (count - 1)) : fullTime) * pace;
    const end = retract != null ? Math.max(retract, (count - 1) * travel + fullTime) + 400 : null;
    const parts = [];

    for (let index = 0; index < count; index++)
    {
        const start = Math.max(0, index * seg - overlap);
        const part = { start, scale: ((index + 1) * seg - start) / (x1 - x0), at: at + index * travel };
        parts.push(part);
        recipe.add(src, part.at, linePlace(meta, polar(scene.shape.origin, scene.shape.angle, start), polar(scene.shape.origin, scene.shape.angle, (index + 1) * seg), lineThickness(meta.core * part.scale))).startTime(skip);
        if (end != null && index > 0)
            recipe.duration(end - index * travel, 400);
    }

    recipe.hitTimes = scene.hits.map(target =>
    {
        const reach = dist(scene.shape.origin, target);
        const part = parts[Math.min(count - 1, Math.floor(reach / seg))];
        return part.at + reachTime(src, x0 + (reach - part.start) / part.scale, skip);
    });
    recipe.hit = recipe.hitTimes.length ? Math.min(...recipe.hitTimes) : 0;
    return count;
}

export function fan(scene, count, seed)
{
    const out = [];
    const next = seeded(seed);

    for (let index = 0; index < count; index++)
    {
        const offset = (index / (count - 1) - 0.5) * 0.9 + (next() - 0.5) * 0.12;
        out.push(polar(scene.shape.origin, scene.shape.angle + offset * scene.shape.spread, scene.shape.length * (0.62 + next() * 0.38)));
    }

    return out;
}
