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
function tokenVerticalSize(token) {
    const actorSize = Number(token?.actor?.system?.size ?? 0);
    const docW = Number(token?.document?.width ?? token?.w ?? 0) || 0;
    const docH = Number(token?.document?.height ?? token?.h ?? 0) || 0;
    const rawSize = Math.max(actorSize, docW, docH, 0);
    if (!rawSize)
        return 1;
    if (rawSize <= 0.5)
        return 0.5;
    return Math.max(1, Math.ceil(rawSize));
}
const verticalOverlap = (aBot, aTop, bBot, bTop) => aBot < bTop && bBot < aTop;

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
    let cursor = {
        q: center.q + LINE_CUBE_DIRS[4].q * radius,
        r: center.r + LINE_CUBE_DIRS[4].r * radius,
        s: center.s + LINE_CUBE_DIRS[4].s * radius,
    };
    for (let i = 0; i < 6; i++)
        for (let j = 0; j < radius; j++) {
            out.push(cursor);
            cursor = { q: cursor.q + LINE_CUBE_DIRS[i].q, r: cursor.r + LINE_CUBE_DIRS[i].r, s: cursor.s + LINE_CUBE_DIRS[i].s };
        }
    return out;
}
function squareRing(originOff, radius) {
    const out = [];
    for (let dc = -radius; dc < radius; dc++) out.push({ col: originOff.col + dc, row: originOff.row - radius });
    for (let dr = -radius; dr < radius; dr++) out.push({ col: originOff.col + radius, row: originOff.row + dr });
    for (let dc = radius; dc > -radius; dc--) out.push({ col: originOff.col + dc, row: originOff.row + radius });
    for (let dr = radius; dr > -radius; dr--) out.push({ col: originOff.col - radius, row: originOff.row + dr });
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
        const originCube = grid.getCube({ i: originOff.row, j: originOff.col });
        return cubeRing(originCube, radius).map(cube => { const cellOff = grid.getOffset(cube); return { col: cellOff.j, row: cellOff.i }; });
    }
    return squareRing(originOff, radius);
}
function lineCells(aOff, bOff, size) {
    /** @type {any} */
    const grid = canvas.grid;
    const out = new Set();
    const fromPx = getHexCenter(aOff.col, aOff.row);
    const toPx = getHexCenter(bOff.col, bOff.row);
    const dirX = toPx.x - fromPx.x, dirY = toPx.y - fromPx.y;
    const segLengthPx = Math.hypot(dirX, dirY) || 1;
    const perpX = -dirY / segLengthPx, perpY = dirX / segLengthPx; // perpendicular unit
    const pitch = grid.size;
    for (const widthIdx of widthOffsets(Math.max(1, Math.round(size)))) {
        const offsetFrom = pixelToOffset(fromPx.x + perpX * widthIdx * pitch, fromPx.y + perpY * widthIdx * pitch);
        const offsetTo = pixelToOffset(toPx.x + perpX * widthIdx * pitch, toPx.y + perpY * widthIdx * pitch);
        if (isHexGrid()) {
            const fromCube = grid.getCube({ i: offsetFrom.row, j: offsetFrom.col });
            const toCube = grid.getCube({ i: offsetTo.row, j: offsetTo.col });
            for (const cube of cubeLineDraw(fromCube, toCube)) { const cellOff = grid.getOffset(cube); out.add(`${cellOff.j},${cellOff.i}`); }
        } else {
            for (const cell of bresenham(offsetFrom.col, offsetFrom.row, offsetTo.col, offsetTo.row)) out.add(`${cell.col},${cell.row}`);
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
            const centerCube = grid.getCube({ i: row, j: col });
            const dirs = [[1, 0, -1], [0, 1, -1], [-1, 1, 0], [-1, 0, 1], [0, -1, 1], [1, -1, 0]];
            for (const [dq, dr, ds] of dirs) {
                const neighborOff = grid.getOffset({ q: centerCube.q + dq, r: centerCube.r + dr, s: centerCube.s + ds });
                out.push(`${neighborOff.j},${neighborOff.i}`);
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
        for (const seedKey of visited)
            if (affected.has(seedKey))
                result.add(seedKey);
        while (queue.length) {
            for (const neighborKey of neighborKeys(queue.shift())) {
                if (visited.has(neighborKey) || !affected.has(neighborKey))
                    continue;
                visited.add(neighborKey);
                result.add(neighborKey);
                queue.push(neighborKey);
            }
        }
        return result;
    };
    const propagate = (affected, seeds) =>
        (elevationAware && propagation) ? keepConnected(affected, seeds) : affected;
    const originSeed = (originPt) => {
        const originOff = pixelToOffset(originPt.x, originPt.y);
        return [`${originOff.col},${originOff.row}`];
    };
    const terrainBlocks = (col, row, top) => {
        if (!elevationAware)
            return false;
        const terrainAPI = globalThis.terrainHeightTools;
        const ground = terrainAPI ? (Number(getHexGroundElevation(col, row, terrainAPI)) || 0) : 0;
        return ground >= top;
    };
    const trimByTerrain = (affected, top) => {
        if (!elevationAware)
            return affected;
        const out = new Set();
        for (const key of affected) {
            const [col, row] = key.split(',').map(Number);
            if (!terrainBlocks(col, row, top))
                out.add(key);
        }
        return out;
    };
    const catchTokens = (affected, bandBot, bandTop, skipId = null) => {
        const caught = [];
        for (const token of canvas.tokens.placeables) {
            if (skipId && token.id === skipId)
                continue;
            if (!includeHidden && token.document.hidden)
                continue;
            if (!includeSelf && casterToken && token.id === casterToken.id)
                continue;
            if (!getOccupiedOffsets(token).some(occOff => affected.has(`${occOff.col},${occOff.row}`)))
                continue;
            if (elevationAware) {
                const tokenElev = Number(token.document?.elevation) || 0;
                if (!verticalOverlap(bandBot, bandTop, tokenElev, tokenElev + tokenVerticalSize(token)))
                    continue;
            }
            caught.push(token);
        }
        return caught;
    };
    // catchTokens with a per-cell 1-tall band (tilted lines).
    const catchTokensPerCell = (elevByCell, skipId = null) => {
        const caught = [];
        for (const token of canvas.tokens.placeables) {
            if (skipId && token.id === skipId)
                continue;
            if (!includeHidden && token.document.hidden)
                continue;
            if (!includeSelf && casterToken && token.id === casterToken.id)
                continue;
            const tokenElev = Number(token.document?.elevation) || 0;
            const tokenTop = tokenElev + tokenVerticalSize(token);
            let hit = false;
            for (const occOff of getOccupiedOffsets(token)) {
                const cellElev = elevByCell.get(`${occOff.col},${occOff.row}`);
                if (cellElev === undefined)
                    continue;
                if (!elevationAware || verticalOverlap(cellElev, cellElev + 1, tokenElev, tokenTop)) {
                    hit = true;
                    break;
                }
            }
            if (hit)
                caught.push(token);
        }
        return caught;
    };
    return { elevationAware, propagate, originSeed, terrainBlocks, trimByTerrain, catchTokens, catchTokensPerCell };
}

function blast(centerPt, radius, areaElev, ctxHelpers) {
    const areaTop = areaElev + radius;
    const areaBot = areaElev - radius; // reach radius above and below, like burst
    let affected = ctxHelpers.elevationAware
        ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: true, elevationAware: true })
        : getInRangeOffsets(centerPt, radius, { includeSelf: true, elevationAware: false });
    affected = ctxHelpers.trimByTerrain(affected, areaTop);
    affected = ctxHelpers.propagate(affected, ctxHelpers.originSeed(centerPt));
    return { caught: ctxHelpers.catchTokens(affected, areaBot, areaTop), affected, elevBot: areaBot, elevTop: areaTop };
}

function burst(hostToken, radius, ctxHelpers) {
    const tokenElev = Number(hostToken?.document?.elevation) || 0;
    const burstTop = tokenElev + radius;
    const burstBot = tokenElev - radius;
    let affected = getInRangeOffsets(hostToken, radius, { includeSelf: false, elevationAware: ctxHelpers.elevationAware });
    affected = ctxHelpers.trimByTerrain(affected, burstTop);
    affected = ctxHelpers.propagate(affected, getOccupiedOffsets(hostToken).map(occOff => `${occOff.col},${occOff.row}`));
    return { caught: ctxHelpers.catchTokens(affected, burstBot, burstTop, hostToken.id), affected, hostElev: tokenElev, elevBot: burstBot, elevTop: burstTop };
}

function cone(centerPt, radius, areaElev, rotation, ctxHelpers) {
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
        const angleRad = dirDeg * Math.PI / 180;
        const forwardX = Math.cos(angleRad), forwardY = Math.sin(angleRad);
        const lateralX = -Math.sin(angleRad), lateralY = Math.cos(angleRad);
        const searchRadius = Math.ceil(effRadius) + 1;
        const candidateCells = [];
        for (let q = -searchRadius; q <= searchRadius; q++) {
            for (let r = -searchRadius; r <= searchRadius; r++) {
                const s = -q - r;
                if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) > searchRadius)
                    continue;
                const axialX = q + 0.5 * r;
                const axialY = (Math.sqrt(3) / 2) * r;
                const forward = axialX * forwardX + axialY * forwardY;
                const lateral = axialX * lateralX + axialY * lateralY;
                const cubeDist = (Math.abs(q) + Math.abs(r) + Math.abs(s)) / 2;
                if (forward <= 1e-9 || cubeDist > effRadius + 1e-9)
                    continue;
                if (Math.abs(lateral) > CONE_HALF_SLOPE * forward + 1e-9)
                    continue;
                candidateCells.push({ q, r, s, cubeDist, forward });
            }
        }
        if (candidateCells.length) {
            let originCell = candidateCells[0];
            for (const cand of candidateCells) {
                if (cand.cubeDist < originCell.cubeDist || (cand.cubeDist === originCell.cubeDist && cand.forward > originCell.forward))
                    originCell = cand;
            }
            for (const cand of candidateCells) {
                const cellOff = grid.getOffset({
                    q: cursorCube.q + (cand.q - originCell.q),
                    r: cursorCube.r + (cand.r - originCell.r),
                    s: cursorCube.s + (cand.s - originCell.s),
                });
                const cellCol = cellOff.j, cellRow = cellOff.i;
                if (ctxHelpers.terrainBlocks(cellCol, cellRow, areaTop))
                    continue;
                affected.add(`${cellCol},${cellRow}`);
            }
        }
    } else {
        const TAU = 2 * Math.PI;
        const HALF_ANGLE = Math.PI / 6;
        const rotRad = (Number(rotation) || 0) * (CONE_STEP_DEG * Math.PI / 180);
        const inRange = ctxHelpers.elevationAware
            ? getInRangeOffsets({ x: centerPt.x, y: centerPt.y, elevation: areaElev }, radius, { includeSelf: false, elevationAware: true })
            : getInRangeOffsets({ x: centerPt.x, y: centerPt.y }, radius, { includeSelf: false, elevationAware: false });
        for (const key of inRange) {
            const [col, row] = key.split(',').map(Number);
            if (ctxHelpers.terrainBlocks(col, row, areaTop))
                continue;
            const cellCenter = getHexCenter(col, row);
            const cellAngle = Math.atan2(cellCenter.y - centerPt.y, cellCenter.x - centerPt.x);
            let deltaAngle = (cellAngle - rotRad) % TAU;
            if (deltaAngle > Math.PI) deltaAngle -= TAU;
            else if (deltaAngle < -Math.PI) deltaAngle += TAU;
            if (Math.abs(deltaAngle) > HALF_ANGLE)
                continue;
            affected.add(key);
        }
    }

    affected = ctxHelpers.propagate(affected, ctxHelpers.originSeed(centerPt));
    return { caught: ctxHelpers.catchTokens(affected, areaBot, areaTop), affected, elevBot: areaBot, elevTop: areaTop };
}

function line(centerPt, length, areaElev, rotation, size, ctxHelpers, tilt = 0) {
    const radius = Math.max(1, Math.round(length));
    const srcOff = pixelToOffset(centerPt.x, centerPt.y);
    const ring = lineRing(srcOff, radius);
    const endOff = ring[((Math.round(rotation) % ring.length) + ring.length) % ring.length];
    // Each cell's elevation = areaElev..areaElev+tilt by its fraction along the origin->end axis.
    const fromPx = getHexCenter(srcOff.col, srcOff.row);
    const toPx = getHexCenter(endOff.col, endOff.row);
    const axisDx = toPx.x - fromPx.x, axisDy = toPx.y - fromPx.y;
    const axisLenSqPx = (axisDx * axisDx + axisDy * axisDy) || 1;
    const elevByCell = new Map();
    let affected = new Set();
    for (const key of lineCells(srcOff, endOff, size)) {
        const [col, row] = key.split(',').map(Number);
        const cellCenter = getHexCenter(col, row);
        const axisFrac = Math.min(1, Math.max(0, ((cellCenter.x - fromPx.x) * axisDx + (cellCenter.y - fromPx.y) * axisDy) / axisLenSqPx));
        const elev = Math.round(areaElev + tilt * axisFrac);
        if (ctxHelpers.terrainBlocks(col, row, elev + 1))
            continue;
        affected.add(key);
        elevByCell.set(key, elev);
    }
    affected = ctxHelpers.propagate(affected, ctxHelpers.originSeed(centerPt));
    for (const key of [...elevByCell.keys()])
        if (!affected.has(key))
            elevByCell.delete(key);
    return {
        caught: ctxHelpers.catchTokensPerCell(elevByCell), affected, elevByCell,
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
    const ctxHelpers = makeCtxHelpers(ctx);
    switch (pattern) {
        case 'burst': return burst(hostToken, areaRange, ctxHelpers);
        case 'cone':  return cone(centerPt, areaRange, areaElev, rotation, ctxHelpers);
        case 'line':  return line(centerPt, areaRange, areaElev, rotation, size, ctxHelpers, tilt);
        case 'blast':
        default:      return blast(centerPt, areaRange, areaElev, ctxHelpers);
    }
}
