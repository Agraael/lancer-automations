import { MODULE_ID } from '../tools/constants.js';
import { hexPoints, wait } from './tour-samples.js';

const LABEL_TEMPLATE = `modules/${MODULE_ID}/templates/lancer-waypoint-label.hbs`;
const STRAIGHT_BADGE_ICON = `modules/${MODULE_ID}/icons/rail-road.svg`;
const ELEVATION_COST_BADGE_ICON = `modules/${MODULE_ID}/icons/mountain-climbing.svg`;
const BOOST_ICON = `modules/${MODULE_ID}/icons/speedometer.svg`;
const BADGE_SCALE = 1.35;
const DEMO_ID = 'la-tour-ruler-demo';
const FRAME_ID = 'la-tour-frame';
const SQ3 = Math.sqrt(3);
const HEX = 30;
const ORIGIN = { x: 74, y: 170 };
const WIDTH = 560;
const HEIGHT = 250;
const BLUE = '#1e88e5';
const GOLD = '#ffc107';
const FREE = '#ffffff';
const FORCE = '#8b5cf6';
const FRIENDLY = '#2ec27e';
const ROUGH_CELL = [8, -1];
const ROCK_CELL = [8, 0];
const TOKEN_CELL = [8, -2];

let generation = 0;

const PATH = [
    { cell: [0, 0] },
    { cell: [1, 0], color: BLUE },
    { cell: [2, 0], color: BLUE },
    { cell: [3, 0], color: BLUE },
    { cell: [4, -1], color: FREE },
    { cell: [5, -2], color: FREE },
    { cell: [6, -2], color: FORCE },
    { cell: [7, -2], color: FORCE },
    { cell: [8, -2], color: BLUE },
    { cell: [8, -1], color: GOLD },
    { cell: [8, 0], color: GOLD },
];

const LABELS = [
    { cell: [3, 0], className: 'la-demo-walk', action: 'walk', totalCost: 3, notch: 3, ring: BLUE },
    { cell: [5, -2], className: 'la-demo-free', action: 'free_walk', cssClass: 'free', totalCost: 3, notch: 2, ring: FREE },
    { cell: [7, -2], className: 'la-demo-force', action: 'forced', cssClass: 'force', totalCost: 3, notch: 2, ring: FORCE },
    { cell: [8, 0], className: 'la-demo-last', action: 'walk', cssClass: 'last', totalCost: 6, notch: 3, ring: GOLD, elev: 1, penalty: 1, saved: 1 },
];

function cellPoint(cell)
{
    return { x: ORIGIN.x + HEX * SQ3 * (cell[0] + cell[1] / 2), y: ORIGIN.y + HEX * 1.5 * cell[1] };
}

function boostStart()
{
    const index = PATH.findIndex((step, stepIndex) => stepIndex > 0 && PATH[stepIndex - 1].color === BLUE && step.color === GOLD);

    if (index < 1)
        return null;

    const from = cellPoint(PATH[index - 1].cell);
    const to = cellPoint(PATH[index].cell);
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
}

function boardSvg()
{
    const parts = ['<defs><pattern id="la-tour-rough" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><rect width="7" height="7" fill="#5b4330"/><line x1="0" y1="0" x2="0" y2="7" stroke="#2f2117" stroke-width="3"/></pattern>'
        + `<clipPath id="la-tour-token-clip"><circle cx="0" cy="0" r="${HEX * 0.78}"/></clipPath></defs>`];

    for (let row = -4; row <= 2; row++)
    {
        for (let col = -3; col <= 11; col++)
        {
            const point = cellPoint([col, row]);
            if (point.x < -HEX || point.x > WIDTH + HEX || point.y < -HEX || point.y > HEIGHT + HEX)
                continue;
            parts.push(`<polygon points="${hexPoints(point, HEX)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
        }
    }

    parts.push(`<polygon points="${hexPoints(cellPoint(ROUGH_CELL), HEX - 1.5)}" fill="url(#la-tour-rough)" opacity="0.9"/>`);
    parts.push(`<polygon points="${hexPoints(cellPoint(ROCK_CELL), HEX - 1.5)}" fill="#5f5b55" stroke="#2c2824" stroke-width="2"/>`);

    for (const step of PATH)
    {
        if (step.color)
            parts.push(`<polygon points="${hexPoints(cellPoint(step.cell), HEX)}" fill="${step.color}" fill-opacity="0.3"/>`);
    }

    const points = PATH.map((step) => cellPoint(step.cell));
    parts.push(`<polyline points="${points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}" fill="none" stroke="#000" stroke-opacity="0.85" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`);

    for (let index = 1; index < PATH.length; index++)
    {
        const from = points[index - 1];
        const to = points[index];
        parts.push(`<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${PATH[index].color}" stroke-width="3.5" stroke-linecap="round"/>`);
    }

    const token = cellPoint(TOKEN_CELL);
    const radius = HEX * 0.78;
    const art = canvas.tokens?.controlled?.[0]?.document?.texture?.src || 'icons/svg/mystery-man.svg';
    parts.push(`<g transform="translate(${token.x.toFixed(1)},${token.y.toFixed(1)})"><circle r="${radius}" fill="#1b1f26"/>`
        + `<image href="${art}" x="${-radius}" y="${-radius}" width="${radius * 2}" height="${radius * 2}" clip-path="url(#la-tour-token-clip)" preserveAspectRatio="xMidYMid slice"/>`
        + `<circle r="${radius}" fill="none" stroke="${FRIENDLY}" stroke-width="2.5"/></g>`);

    const boost = boostStart();

    if (boost)
    {
        parts.push(`<g class="la-demo-boost" transform="translate(${boost.x.toFixed(1)},${boost.y.toFixed(1)})">`
            + `<circle r="${10 * BADGE_SCALE}" fill="rgba(0,0,0,0.8)"/>`
            + `<image href="${BOOST_ICON}" x="${-5.5 * BADGE_SCALE}" y="${-5.5 * BADGE_SCALE}" width="${11 * BADGE_SCALE}" height="${11 * BADGE_SCALE}"/></g>`);
    }

    return `<svg width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">${parts.join('')}</svg>`;
}

function labelContext(entry)
{
    const actions = /** @type {any} */ (CONFIG).Token?.movement?.actions ?? {};
    const last = entry.cssClass === 'last';

    return {
        cssClass: entry.cssClass ?? '',
        ringColor: entry.ring,
        action: actions[entry.action] ?? actions.walk,
        totalCost: entry.totalCost,
        showNotch: true,
        notch: entry.notch,
        elevArrow: entry.elev ? 'fa-solid fa-arrow-up' : '',
        elevAbs: entry.elev ?? 0,
        penalty: entry.penalty ?? 0,
        penaltyZone: false,
        saved: entry.saved ?? 0,
        lost: 0,
        showSecondLine: !!(entry.elev || entry.penalty || entry.saved),
        showPathfind: last,
        pathfindOn: true,
        showElevMode: last,
        elevMode: 'ground',
        elevIcon: 'fa-arrow-down-to-line',
        showStraight: last,
        straightOn: false,
        straightIcon: STRAIGHT_BADGE_ICON,
        showElevationCost: last,
        elevationCostOff: false,
        elevationCostIcon: ELEVATION_COST_BADGE_ICON,
    };
}

async function renderLabel(entry)
{
    const anyGlobal = /** @type {any} */ (globalThis);
    const render = anyGlobal.foundry?.applications?.handlebars?.renderTemplate ?? anyGlobal.renderTemplate;
    const holder = document.createElement('div');
    holder.innerHTML = String(await render(LABEL_TEMPLATE, labelContext(entry))).trim();
    const label = /** @type {HTMLElement} */ (holder.firstElementChild);
    const point = cellPoint(entry.cell);
    label.classList.add(entry.className);
    label.style.setProperty('--position-x', `${point.x.toFixed(1)}px`);
    label.style.setProperty('--position-y', `${point.y.toFixed(1)}px`);
    return label;
}

export async function ensureRulerDemo()
{
    const current = ++generation;
    hideWheelPreview();
    if (document.getElementById(DEMO_ID))
        return;

    const demo = document.createElement('div');
    demo.id = DEMO_ID;
    demo.style.width = `${WIDTH}px`;
    demo.style.height = `${HEIGHT}px`;
    demo.innerHTML = boardSvg();

    for (const entry of LABELS)
        demo.appendChild(await renderLabel(entry));

    if (current === generation && !document.getElementById(DEMO_ID))
        document.body.appendChild(demo);
}

export function hideRulerDemo()
{
    document.getElementById(DEMO_ID)?.remove();
}

function frameWheel()
{
    const buttons = [...document.querySelectorAll('.lancer-movement-wheel .lancer-mw-btn')];
    if (!buttons.length)
        return;

    const boxes = buttons.map((button) => button.getBoundingClientRect());
    const left = Math.min(...boxes.map((box) => box.left)) - 6;
    const top = Math.min(...boxes.map((box) => box.top)) - 6;
    const right = Math.max(...boxes.map((box) => box.right)) + 6;
    const bottom = Math.max(...boxes.map((box) => box.bottom)) + 6;
    let frame = document.getElementById(FRAME_ID);

    if (!frame)
    {
        frame = document.createElement('div');
        frame.id = FRAME_ID;
        document.body.appendChild(frame);
    }

    Object.assign(frame.style, { left: `${left}px`, top: `${top}px`, width: `${right - left}px`, height: `${bottom - top}px` });
}

export async function showWheelPreview()
{
    const current = ++generation;
    hideRulerDemo();

    if (!document.querySelector('.lancer-movement-wheel'))
    {
        const { openMovementWheelPreview } = await import('../movement/movement-wheel.js');
        if (current !== generation)
            return;
        openMovementWheelPreview({ x: window.innerWidth / 2, y: window.innerHeight * 0.42 });
    }

    await wait(240);
    if (current === generation)
        frameWheel();
}

export function hideWheelPreview()
{
    document.getElementById(FRAME_ID)?.remove();
    if (!document.querySelector('.lancer-movement-wheel'))
        return;

    import('../tools/radial-wheel.js').then(({ closeRadialWheel }) => closeRadialWheel({ silent: true }));
}

export function hideTourDemos()
{
    generation++;
    hideWheelPreview();
    hideRulerDemo();
}
