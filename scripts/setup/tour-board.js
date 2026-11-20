import { escapeHtml } from '../tools/string-utils.js';
import { EYE_ON, EYE_OFF, EYE_SEEN, EYE_BLOCKED } from '../movement/tactical-distance.js';
import { corners, hexPoints } from './tour-samples.js';

export const HEX_RADIUS = 44;
export const HEX_WIDTH = HEX_RADIUS * Math.sqrt(3);
export const SCALE = HEX_WIDTH / 100;
export const BOARD = { width: 560, height: 350 };

const ORIGIN = { x: 60, y: 70 };
const DISTANCE_FONT = Math.max(12, 14 * SCALE);
const DASH = HEX_WIDTH * 0.16;
const GAP = HEX_WIDTH * 0.11;
const TERRAIN = { color: '#ff0000', fill: 0.2, line: 0.8, width: 4 };

export const lineWidth = width => Math.max(1, width * SCALE);
/** @type {(cellA: number[], cellB: number[]) => number} */
export const hexDistance = ([colA, rowA], [colB, rowB]) => (Math.abs(colB - colA) + Math.abs(rowB - rowA) + Math.abs((colB - colA) + (rowB - rowA))) / 2;

/** @param {number[]} cell */
export function point([col, row])
{
    return { x: ORIGIN.x + HEX_WIDTH * (col + row / 2), y: ORIGIN.y + HEX_RADIUS * 1.5 * row };
}

export function gridSvg()
{
    const parts = [];

    for (let row = -1; row <= 4; row++)
    {
        for (let col = -3; col <= 8; col++)
        {
            const center = point([col, row]);
            if (center.x < -HEX_WIDTH || center.x > BOARD.width + HEX_WIDTH || center.y < -HEX_RADIUS || center.y > BOARD.height + HEX_RADIUS)
                continue;
            parts.push(`<polygon points="${hexPoints(center, HEX_RADIUS)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
        }
    }

    return parts.join('');
}

export function artSvg(src, center, extra = '')
{
    return `<image href="${escapeHtml(src)}" x="${(center.x - HEX_WIDTH / 2).toFixed(1)}" y="${(center.y - HEX_RADIUS).toFixed(1)}" width="${HEX_WIDTH.toFixed(1)}" height="${(HEX_RADIUS * 2).toFixed(1)}" preserveAspectRatio="xMidYMid meet"${extra}/>`;
}

export function dashedMark(center, color, halo = false)
{
    const points = hexPoints(center, HEX_RADIUS);
    const dashes = `stroke-dasharray="${DASH.toFixed(1)} ${GAP.toFixed(1)}"`;
    const under = halo ? `<polygon class="la-ts-march" points="${points}" fill="none" stroke="#000" stroke-opacity="0.55" stroke-width="${lineWidth(6).toFixed(2)}" ${dashes}/>` : '';

    return `<polygon points="${points}" fill="${color}" fill-opacity="0.12"/>`
        + under
        + `<polygon class="la-ts-march" points="${points}" fill="none" stroke="${color}" stroke-opacity="0.95" stroke-width="${lineWidth(3).toFixed(2)}" ${dashes}/>`;
}

export function haloShape(shapes, color, width, alpha, fill)
{
    const stroke = lineWidth(width);
    const halo = stroke + Math.max(1, 2 * SCALE);
    const draw = attributes => shapes.map(points => `<polygon points="${points}" ${attributes}/>`).join('');

    return draw(`fill="none" stroke="#000" stroke-opacity="${alpha}" stroke-width="${halo.toFixed(2)}" stroke-linejoin="round"`)
        + draw(`fill="${color}" fill-opacity="${fill}" stroke="${color}" stroke-opacity="${alpha}" stroke-width="${stroke.toFixed(2)}" stroke-linejoin="round"`);
}

export function distanceLabel(center, distance, seen = null)
{
    const top = center.y + HEX_RADIUS + 2;
    const glyph = seen === null ? '' : `<tspan class="la-ts-eye" fill="${seen ? EYE_SEEN : EYE_BLOCKED}">${seen ? EYE_ON : EYE_OFF}</tspan> `;
    return `<text class="la-ts-distance" x="${center.x.toFixed(1)}" y="${top.toFixed(1)}" font-size="${DISTANCE_FONT.toFixed(1)}" text-anchor="middle" dominant-baseline="hanging">${glyph}↔ ${distance}</text>`;
}

export function unitSvg(className, cell, unit, extra = '')
{
    return `<g class="${className}">${artSvg(unit.img, point(cell))}${extra}</g>`;
}

export function cellCorners(cells)
{
    return cells.map(cell => corners(point(cell), HEX_RADIUS));
}

function perimeterPath(cells)
{
    const edgeKey = (from, to) => [from, to].map(corner => `${corner.x.toFixed(1)},${corner.y.toFixed(1)}`).sort().join('|');
    const counts = new Map();
    const edges = [];

    for (const hex of cellCorners(cells))
    {
        hex.forEach((from, index) =>
        {
            const to = hex[(index + 1) % hex.length];
            const key = edgeKey(from, to);
            counts.set(key, (counts.get(key) ?? 0) + 1);
            edges.push({ key, from, to });
        });
    }

    return edges.filter(edge => counts.get(edge.key) === 1)
        .map(edge => `M${edge.from.x.toFixed(1)} ${edge.from.y.toFixed(1)}L${edge.to.x.toFixed(1)} ${edge.to.y.toFixed(1)}`).join('');
}

export function terrainSvg(cells)
{
    const fills = cells.map(cell => `<polygon points="${hexPoints(point(cell), HEX_RADIUS)}" fill="${TERRAIN.color}" fill-opacity="${TERRAIN.fill}"/>`).join('');
    return `<g class="la-ts-terrain">${fills}<path d="${perimeterPath(cells)}" fill="none" stroke="${TERRAIN.color}" stroke-opacity="${TERRAIN.line}" stroke-width="${(TERRAIN.width * SCALE).toFixed(2)}" stroke-linecap="round"/></g>`;
}

export function cursorSvg(at)
{
    return `<path d="M${at.x.toFixed(1)} ${at.y.toFixed(1)}l0 16l4.5 -4.2l3.2 7l2.6 -1.2l-3.2 -6.8l6.2 -0.2z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>`;
}

export function boardElement(content)
{
    const board = document.createElement('div');
    board.className = 'la-ts-board';
    board.innerHTML = `<svg width="${BOARD.width}" height="${BOARD.height}" viewBox="0 0 ${BOARD.width} ${BOARD.height}">${gridSvg()}${content}</svg>`;
    return board;
}
