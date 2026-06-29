/* global canvas, globalThis */

// Shared AoE geometry (blast / burst / cone / line) used by chooseToken's card picker and the
// cardless attack-HUD picker. `ctx` carries the runtime toggles; the rest are pure grid math.

import {
    isHexGrid, getHexCenter, pixelToOffset, getOccupiedOffsets, getInRangeOffsets,
} from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";

export const CONE_STEPS_PER_TURN = 12;
export const CONE_STEP_DEG = 360 / CONE_STEPS_PER_TURN; // 30°
export const CONE_HALF_SLOPE = 0.5; // tan(atan(1/2)); matches Foundry MeasuredTemplate cone

// Rotation tick count: cone snaps to 12 facings; a line steps around its endpoint ring.
export function rotationStepsFor(pattern, areaRange) {
    if (pattern === 'line') {
        const radius = Math.max(1, Math.round(Number(areaRange) || 1));
        return (isHexGrid() ? 6 : 8) * radius;
    }
    return CONE_STEPS_PER_TURN;
}

// Lancer vertical hex count: max of actor size + doc dims; 0.5 special-cased; else ceil to >= 1.
function tokenVerticalSize(t) {
    const actorSize = Number(t?.actor?.system?.size ?? 0);
    const docW = Number(t?.document?.width ?? t?.w ?? 0) || 0;
    const docH = Number(t?.document?.height ?? t?.h ?? 0) || 0;
    const raw = Math.max(actorSize, docW, docH, 0);
    if (!raw)
        return 1;
    if (raw <= 0.5)
        return 0.5;
    return Math.max(1, Math.ceil(raw));
}
const verticalOverlap = (a0, a1, b0, b1) => a0 < b1 && b0 < a1;

// --- Hex line drawing (Red Blob Games): cube lerp + cube_round → a clean 1-wide path. ---
function cubeRound(q, r, s) {
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
    if (dq > dr && dq > ds) rq = -rr - rs;
    else if (dr > ds) rr = -rq - rs;
    else rs = -rq - rr;
    return { q: rq, r: rr, s: rs };
}
const cubeDistance = (a, b) => (Math.abs(a.q - b.q) + Math.abs(a.r - b.r) + Math.abs(a.s - b.s)) / 2;
function cubeLineDraw(a, b) {
    const N = Math.max(1, cubeDistance(a, b));
    const out = [];
    for (let i = 0; i <= N; i++) {
        const t = i / N;
        out.push(cubeRound(
            a.q + (b.q - a.q) * t + 1e-6,
            a.r + (b.r - a.r) * t + 2e-6,
            a.s + (b.s - a.s) * t - 3e-6,
        ));
    }
    return out;
}
const LINE_CUBE_DIRS = [
    { q: 1, r: 0, s: -1 }, { q: 1, r: -1, s: 0 }, { q: 0, r: -1, s: 1 },
    { q: -1, r: 0, s: 1 }, { q: -1, r: 1, s: 0 }, { q: 0, r: 1, s: -1 },
];
function cubeRing(center, radius) {
    if (radius <= 0) return [{ ...center }];
    const out = [];
    let hex = {
        q: center.q + LINE_CUBE_DIRS[4].q * radius,
        r: center.r + LINE_CUBE_DIRS[4].r * radius,
        s: center.s + LINE_CUBE_DIRS[4].s * radius,
    };
    for (let i = 0; i < 6; i++)
        for (let j = 0; j < radius; j++) {
            out.push(hex);
            hex = { q: hex.q + LINE_CUBE_DIRS[i].q, r: hex.r + LINE_CUBE_DIRS[i].r, s: hex.s + LINE_CUBE_DIRS[i].s };
        }
    return out;
}
function squareRing(o, radius) {
    const out = [];
    for (let dc = -radius; dc < radius; dc++) out.push({ col: o.col + dc, row: o.row - radius });
    for (let dr = -radius; dr < radius; dr++) out.push({ col: o.col + radius, row: o.row + dr });
    for (let dc = radius; dc > -radius; dc--) out.push({ col: o.col + dc, row: o.row + radius });
    for (let dr = radius; dr > -radius; dr--) out.push({ col: o.col - radius, row: o.row + dr });
    return out;
}
function bresenham(x0, y0, x1, y1) {
    const pts = [];
    const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx - dy, x = x0, y = y0;
    for (;;) {
        pts.push({ col: x, row: y });
        if (x === x1 && y === y1) break;
        const e2 = 2 * err;
        if (e2 > -dy) { err -= dy; x += sx; }
        if (e2 < dx) { err += dx; y += sy; }
    }
    return pts;
}
// Whole-cell perpendicular offsets for a width-n line: 1→[0], 2→[0,1], 3→[-1,0,1].
function widthOffsets(n) {
    const lo = -Math.floor((n - 1) / 2);
    return Array.from({ length: n }, (_, i) => lo + i);
}
function lineRing(originOff, radius) {
    if (isHexGrid()) {
        /** @type {any} */
        const grid = canvas.grid;
        const a = grid.getCube({ i: originOff.row, j: originOff.col });
        return cubeRing(a, radius).map(c => { const o = grid.getOffset(c); return { col: o.j, row: o.i }; });
    }
    return squareRing(originOff, radius);
}
function lineCells(aOff, bOff, size) {
    /** @type {any} */
    const grid = canvas.grid;
    const out = new Set();
    const aPx = getHexCenter(aOff.col, aOff.row);
    const bPx = getHexCenter(bOff.col, bOff.row);
    const dux = bPx.x - aPx.x, duy = bPx.y - aPx.y;
    const dlen = Math.hypot(dux, duy) || 1;
    const px = -duy / dlen, py = dux / dlen; // perpendicular unit
    const pitch = grid.size;
    for (const k of widthOffsets(Math.max(1, Math.round(size)))) {
        const a2 = pixelToOffset(aPx.x + px * k * pitch, aPx.y + py * k * pitch);
        const b2 = pixelToOffset(bPx.x + px * k * pitch, bPx.y + py * k * pitch);
        if (isHexGrid()) {
            const ca = grid.getCube({ i: a2.row, j: a2.col });
            const cb = grid.getCube({ i: b2.row, j: b2.col });
            for (const c of cubeLineDraw(ca, cb)) { const o = grid.getOffset(c); out.add(`${o.j},${o.i}`); }
        } else {
            for (const p of bresenham(a2.col, a2.row, b2.col, b2.row)) out.add(`${p.col},${p.row}`);
        }
    }
    return out;
}

// Build the ctx-bound helpers (terrain / propagation / token-catch) from the runtime toggles.
function makeCtxHelpers(ctx) {
    const {
        elevationAware = false, propagation = false,
        includeHidden = false, includeSelf = false, casterToken = null,
    } = ctx || {};

    const neighborKeys = (key) => {
        const [col, row] = key.split(',').map(Number);
        const out = [];
        if (isHexGrid()) {
            /** @type {any} */
            const grid = canvas.grid;
            const c = grid.getCube({ i: row, j: col });
            const dirs = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];
            for (const [dq, dr, ds] of dirs) {
                const o = grid.getOffset({ q: c.q + dq, r: c.r + dr, s: c.s + ds });
                out.push(`${o.j},${o.i}`);
            }
        } else {
            for (let dc = -1; dc <= 1; dc++)
                for (let dr = -1; dr <= 1; dr++)
                    if (dc || dr)
                        out.push(`${col + dc},${row + dr}`);
        }
        return out;
    };
    const keepConnected = (affected, seedKeys) => {
        const result = new Set();
        const visited = new Set(seedKeys);
        const queue = [...visited];
        for (const k of visited)
            if (affected.has(k))
                result.add(k);
        while (queue.length) {
            for (const nb of neighborKeys(queue.shift())) {
                if (visited.has(nb) || !affected.has(nb))
                    continue;
                visited.add(nb);
                result.add(nb);
                queue.push(nb);
            }
        }
        return result;
    };
    const propagate = (affected, seeds) =>
        (elevationAware && propagation) ? keepConnected(affected, seeds) : affected;
    const originSeed = (pt) => {
        const o = pixelToOffset(pt.x, pt.y);
        return [`${o.col},${o.row}`];
    };
    const terrainBlocks = (col, row, top) => {
        if (!elevationAware)
            return false;
        const tAPI = globalThis.terrainHeightTools;
        const ground = tAPI ? (Number(getHexGroundElevation(col, row, tAPI)) || 0) : 0;
        return ground >= top;
    };
    const trimByTerrain = (affected, top) => {
        if (!elevationAware)
            return affected;
        const out = new Set();
        for (const key of affected) {
            const [c, r] = key.split(',').map(Number);
            if (!terrainBlocks(c, r, top))
                out.add(key);
        }
        return out;
    };
    const catchTokens = (affected, lo, hi, skipId = null) => {
        const caught = [];
        for (const t of canvas.tokens.placeables) {
            if (skipId && t.id === skipId)
                continue;
            if (!includeHidden && t.document.hidden)
                continue;
            if (!includeSelf && casterToken && t.id === casterToken.id)
                continue;
            if (!getOccupiedOffsets(t).some(o => affected.has(`${o.col},${o.row}`)))
                continue;
            if (elevationAware) {
                const tElev = Number(t.document?.elevation) || 0;
                if (!verticalOverlap(lo, hi, tElev, tElev + tokenVerticalSize(t)))
                    continue;
            }
            caught.push(t);
        }
        return caught;
    };
    // catchTokens with a per-cell 1-tall band (tilted lines).
    const catchTokensPerCell = (elevByCell, skipId = null) => {
        const caught = [];
        for (const t of canvas.tokens.placeables) {
            if (skipId && t.id === skipId)
                continue;
            if (!includeHidden && t.document.hidden)
                continue;
            if (!includeSelf && casterToken && t.id === casterToken.id)
                continue;
            const tElev = Number(t.document?.elevation) || 0;
            const tTop = tElev + tokenVerticalSize(t);
            let hit = false;
            for (const o of getOccupiedOffsets(t)) {
                const lo = elevByCell.get(`${o.col},${o.row}`);
                if (lo === undefined)
                    continue;
                if (!elevationAware || verticalOverlap(lo, lo + 1, tElev, tTop)) {
                    hit = true;
                    break;
                }
            }
            if (hit)
                caught.push(t);
        }
        return caught;
    };
    return { elevationAware, propagate, originSeed, terrainBlocks, trimByTerrain, catchTokens, catchTokensPerCell };
}

function blast(centerPt, radius, areaElev, h) {
    const areaTop = areaElev + radius;
    const areaBot = areaElev - radius; // reach radius above and below, like burst
    let affected = h.elevationAware
        ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: true, elevationAware: true })
        : getInRangeOffsets(centerPt, radius, { includeSelf: true, elevationAware: false });
    affected = h.trimByTerrain(affected, areaTop);
    affected = h.propagate(affected, h.originSeed(centerPt));
    return { caught: h.catchTokens(affected, areaBot, areaTop), affected, elevBot: areaBot, elevTop: areaTop };
}

function burst(hostToken, radius, h) {
    const tokenElev = Number(hostToken?.document?.elevation) || 0;
    const burstTop = tokenElev + radius;
    const burstBot = tokenElev - radius;
    let affected = getInRangeOffsets(hostToken, radius, { includeSelf: false, elevationAware: h.elevationAware });
    affected = h.trimByTerrain(affected, burstTop);
    affected = h.propagate(affected, getOccupiedOffsets(hostToken).map(o => `${o.col},${o.row}`));
    return { caught: h.catchTokens(affected, burstBot, burstTop, hostToken.id), affected, hostElev: tokenElev, elevBot: burstBot, elevTop: burstTop };
}

function cone(centerPt, radius, areaElev, rotation, h) {
    const areaTop = areaElev + radius;
    const areaBot = areaElev - radius; // reach radius above and below, like burst
    let affected = new Set();

    if (isHexGrid()) {
        /** @type {any} */
        const grid = canvas.grid;
        const srcOff = pixelToOffset(centerPt.x, centerPt.y);
        const cursorCube = grid.getCube({ i: srcOff.row, j: srcOff.col });
        const dirDeg = (Number(rotation) || 0) * CONE_STEP_DEG;
        const offAxis = (((dirDeg % 60) + 60) % 60) > 1e-9;
        const effRadius = offAxis ? radius + 1 : radius;
        const th = dirDeg * Math.PI / 180;
        const fx = Math.cos(th), fy = Math.sin(th);
        const lx = -Math.sin(th), ly = Math.cos(th);
        const R = Math.ceil(effRadius) + 1;
        const offs = [];
        for (let q = -R; q <= R; q++) {
            for (let r = -R; r <= R; r++) {
                const s = -q - r;
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > R)
                    continue;
                const x = q + 0.5 * r;
                const y = (Math.sqrt(3) / 2) * r;
                const fwd = x * fx + y * fy;
                const lat = x * lx + y * ly;
                const cd = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
                if (fwd <= 1e-9 || cd > effRadius + 1e-9)
                    continue;
                if (Math.abs(lat) > CONE_HALF_SLOPE * fwd + 1e-9)
                    continue;
                offs.push({ q, r, s, cd, fwd });
            }
        }
        if (offs.length) {
            let firstOff = offs[0];
            for (const o of offs) {
                if (o.cd < firstOff.cd || (o.cd === firstOff.cd && o.fwd > firstOff.fwd))
                    firstOff = o;
            }
            for (const o of offs) {
                const off = grid.getOffset({
                    q: cursorCube.q + (o.q - firstOff.q),
                    r: cursorCube.r + (o.r - firstOff.r),
                    s: cursorCube.s + (o.s - firstOff.s),
                });
                const cellCol = off.j, cellRow = off.i;
                if (h.terrainBlocks(cellCol, cellRow, areaTop))
                    continue;
                affected.add(`${cellCol},${cellRow}`);
            }
        }
    } else {
        const TAU = 2 * Math.PI;
        const HALF_ANGLE = Math.PI / 6;
        const rotRad = (Number(rotation) || 0) * (CONE_STEP_DEG * Math.PI / 180);
        const raw = h.elevationAware
            ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: false, elevationAware: true })
            : getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, radius, { includeSelf: false, elevationAware: false });
        for (const key of raw) {
            const [c, r] = key.split(',').map(Number);
            if (h.terrainBlocks(c, r, areaTop))
                continue;
            const cell = getHexCenter(c, r);
            const ang = Math.atan2(cell.y - centerPt.y, cell.x - centerPt.x);
            let d = (ang - rotRad) % TAU;
            if (d > Math.PI) d -= TAU;
            else if (d < -Math.PI) d += TAU;
            if (Math.abs(d) > HALF_ANGLE)
                continue;
            affected.add(key);
        }
    }

    affected = h.propagate(affected, h.originSeed(centerPt));
    return { caught: h.catchTokens(affected, areaBot, areaTop), affected, elevBot: areaBot, elevTop: areaTop };
}

function line(centerPt, length, areaElev, rotation, size, h, tilt = 0) {
    const radius = Math.max(1, Math.round(length));
    const srcOff = pixelToOffset(centerPt.x, centerPt.y);
    const ring = lineRing(srcOff, radius);
    const endOff = ring[((Math.round(rotation) % ring.length) + ring.length) % ring.length];
    // Each cell's elevation = areaElev..areaElev+tilt by its fraction along the origin->end axis.
    const aPx = getHexCenter(srcOff.col, srcOff.row);
    const bPx = getHexCenter(endOff.col, endOff.row);
    const dx = bPx.x - aPx.x, dy = bPx.y - aPx.y;
    const len2 = (dx * dx + dy * dy) || 1;
    const elevByCell = new Map();
    let affected = new Set();
    for (const key of lineCells(srcOff, endOff, size)) {
        const [col, row] = key.split(',').map(Number);
        const c = getHexCenter(col, row);
        const f = Math.min(1, Math.max(0, ((c.x - aPx.x) * dx + (c.y - aPx.y) * dy) / len2));
        const elev = Math.round(areaElev + tilt * f);
        if (h.terrainBlocks(col, row, elev + 1))
            continue;
        affected.add(key);
        elevByCell.set(key, elev);
    }
    affected = h.propagate(affected, h.originSeed(centerPt));
    for (const k of [...elevByCell.keys()])
        if (!affected.has(k))
            elevByCell.delete(k);
    return {
        caught: h.catchTokensPerCell(elevByCell), affected, elevByCell,
        elevBot: Math.min(areaElev, areaElev + tilt), elevTop: Math.max(areaElev, areaElev + tilt),
    };
}

/**
 * Compute an AoE's affected cells + caught tokens. elevBot/elevTop are the vertical band it covers.
 * @param {{pattern:string, centerPt?:{x:number,y:number}, hostToken?:any, areaRange:number, size?:number, rotation?:number, areaElev?:number, tilt?:number}} opts
 * @param {{elevationAware?:boolean, propagation?:boolean, includeHidden?:boolean, includeSelf?:boolean, casterToken?:any}} [ctx]
 * @returns {{caught:any[], affected:Set<string>, hostElev?:number, elevBot:number, elevTop:number, elevByCell?:Map<string,number>}}
 */
export function computeArea(opts, ctx = {}) {
    const { pattern, centerPt, hostToken = null, areaRange, size = 1, rotation = 0, areaElev = 0, tilt = 0 } = opts;
    const h = makeCtxHelpers(ctx);
    switch (pattern) {
        case 'burst': return burst(hostToken, areaRange, h);
        case 'cone':  return cone(centerPt, areaRange, areaElev, rotation, h);
        case 'line':  return line(centerPt, areaRange, areaElev, rotation, size, h, tilt);
        case 'blast':
        default:      return blast(centerPt, areaRange, areaElev, h);
    }
}
