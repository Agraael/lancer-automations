import { getModuleSetting } from '../tools/settings-utils.js';
import { cssColor, worldUnits, ownUnit, hexPoints } from './tour-samples.js';
import { HEX_RADIUS, HEX_WIDTH, point, hexDistance, haloShape, distanceLabel, unitSvg, terrainSvg, boardElement } from './tour-board.js';

const CELLS = { viewer: [0, 2], seen: [1, 3], sensor: [3, 1], aware: [5, 0] };
const TERRAIN_CELLS = [[2, 1], [2, 2]];
const SENSOR_RGB = [84, 158, 255];
const AWARE_RGB = [255, 217, 38];
const DIM = 0.4;
const BRIGHT = 1.2;
const BODY_ALPHA = { veil: 0.35, silhouette: 1, outline: 0 };
const RIM_STEPS = 16;
const RIM_WIDTH = 1.5;
const RIM_PAD = 4;
const ART_SCALE = 2;

const shade = (rgb, factor) => `rgb(${rgb.map(channel => Math.min(255, Math.round(channel * factor))).join(',')})`;

function loadImage(src)
{
    return new Promise((resolve) =>
    {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = src;
    });
}

function fitBox(image, width, height, pad)
{
    const naturalWidth = image.naturalWidth || width;
    const naturalHeight = image.naturalHeight || height;
    const scale = Math.min(width / naturalWidth, height / naturalHeight);
    return { x: pad + (width - naturalWidth * scale) / 2, y: pad + (height - naturalHeight * scale) / 2, width: naturalWidth * scale, height: naturalHeight * scale };
}

/**
 * @param {number[]} size
 * @param {(context: CanvasRenderingContext2D) => void} paint
 */
function layer([width, height], paint)
{
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'));
    return canvas.toDataURL();
}

async function overlayArt(src, rgb)
{
    const image = await loadImage(src);
    if (!image)
        return null;

    const pad = RIM_PAD * ART_SCALE;
    const width = HEX_WIDTH * ART_SCALE;
    const height = HEX_RADIUS * 2 * ART_SCALE;
    const size = [Math.ceil(width + pad * 2), Math.ceil(height + pad * 2)];
    const box = fitBox(image, width, height, pad);
    const thickness = RIM_WIDTH * ART_SCALE;
    const drawArt = (context, offsetX = 0, offsetY = 0) => context.drawImage(image, box.x + offsetX, box.y + offsetY, box.width, box.height);

    const rim = color => layer(size, (context) =>
    {
        for (let step = 0; step < RIM_STEPS; step++)
        {
            const angle = Math.PI * 2 * step / RIM_STEPS;
            drawArt(context, Math.cos(angle) * thickness, Math.sin(angle) * thickness);
        }

        context.globalCompositeOperation = 'source-in';
        context.fillStyle = color;
        context.fillRect(0, 0, size[0], size[1]);
        context.globalCompositeOperation = 'destination-out';
        drawArt(context);
    });

    try
    {
        const body = layer(size, (context) =>
        {
            drawArt(context);
            context.globalCompositeOperation = 'source-in';
            context.fillStyle = '#000';
            context.fillRect(0, 0, size[0], size[1]);
        });

        return { dim: rim(shade(rgb, DIM)), bright: rim(shade(rgb, BRIGHT)), body };
    }
    catch
    {
        return null;
    }
}

function overlaySvg(art, cell, rgb, bodyAlpha, scanClass)
{
    const center = point(cell);
    if (!art)
        return `<polygon points="${hexPoints(center, HEX_RADIUS * 0.8)}" fill="#000" fill-opacity="${bodyAlpha}" stroke="${shade(rgb, BRIGHT)}" stroke-width="2"/>`;

    const box = `x="${(center.x - HEX_WIDTH / 2 - RIM_PAD).toFixed(1)}" y="${(center.y - HEX_RADIUS - RIM_PAD).toFixed(1)}" width="${(HEX_WIDTH + RIM_PAD * 2).toFixed(1)}" height="${(HEX_RADIUS * 2 + RIM_PAD * 2).toFixed(1)}" preserveAspectRatio="none"`;
    const body = bodyAlpha > 0 ? `<image href="${art.body}" ${box} opacity="${bodyAlpha}"/>` : '';
    return `${body}<image href="${art.dim}" ${box}/><image class="${scanClass}" href="${art.bright}" ${box}/>`;
}

export async function visionBoardDemo()
{
    const [seen, sensed, aware] = worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB', 'LA.tour.demo.unitC']);
    const bodyAlpha = BODY_ALPHA[getModuleSetting('lancerAwarenessStyle')] ?? BODY_ALPHA.veil;
    const [sensorArt, awareArt] = await Promise.all([overlayArt(sensed.img, SENSOR_RGB), overlayArt(aware.img, AWARE_RGB)]);
    const label = key => distanceLabel(point(CELLS[key]), hexDistance(CELLS.viewer, CELLS[key]), key === 'seen');
    const border = haloShape([hexPoints(point(CELLS.viewer), HEX_RADIUS)], cssColor(CONFIG.Canvas.dispositionColors.CONTROLLED), 2, 1, 0);

    return boardElement(terrainSvg(TERRAIN_CELLS)
        + unitSvg('la-ts-viewer', CELLS.viewer, ownUnit(), border)
        + unitSvg('la-ts-seen', CELLS.seen, seen, label('seen'))
        + `<g class="la-ts-sensor">${overlaySvg(sensorArt, CELLS.sensor, SENSOR_RGB, 0, 'la-ts-scan')}${label('sensor')}</g>`
        + `<g class="la-ts-aware">${overlaySvg(awareArt, CELLS.aware, AWARE_RGB, bodyAlpha, 'la-ts-scan la-ts-scan-thin')}${label('aware')}</g>`);
}
