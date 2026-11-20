import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { clockPanelPreview } from '../clocks/panel.js';
import { reinforcementBarPreview } from '../combat/reinforcement-bar.js';
import { cardTexts } from '../combat/reinforcements.js';
import { LEAVING_ICON } from '../combat/leave-battlefield.js';
import { uplinkPanelPreview } from '../uplink/panel.js';
import { startPickCard, pickRowsText } from '../interactive/pick-card.js';
import { startChoiceCard, cancelChoiceCardByKey } from '../interactive/network.js';
import { mountPickChoices } from '../interactive/combat.js';
import { getActivationIcon, weaponSkirmishable, getInvadeOptions } from '../tools/misc-tools.js';
import { chooseInvadePerTarget } from '../interactive/invade-card.js';
import { getCornerStack } from '../tools/corner-stack.js';
import { MODULE_ID } from '../tools/constants.js';
import { carouselPreview, fitCarouselPreview } from '../carousel/carousel.js';
import { automationLanePreview } from '../activations/automation-ui.js';
import { pickPrepared } from '../activations/prepare-flow.js';
import { FALLBACK_ART, cssColor, unitOf, worldUnits, sampleUnits, ownUnit, subjectToken, corners, hexPoints, wait } from './tour-samples.js';
import { artSvg } from './tour-board.js';
import { attackWindowDemo, attackBoardDemo, damageWindowDemo } from './tour-attack-demo.js';
import { visionBoardDemo } from './tour-vision-demo.js';

const FRAME_ID = 'la-tour-frame';
const CARD_CLASS = 'la-tour-card';
const FRAME_PAD = 4;
const SHEET_WAIT_MS = 2000;
const SETTLE_MS = 600;
const CARD_IN_MS = 260;
const PIN_FILL = '#3a9e6e';
const ROUND_NOW = 1;
const ROUND_PLANNED = 3;
const TARGET_UUID = 'la-tour-target';
const PREPARE_ICON = `modules/${MODULE_ID}/icons/light-bulb.svg`;
const BOOST_ICON = `modules/${MODULE_ID}/icons/speedometer.svg`;
const SAMPLE_SPEED = 4;
const SAMPLE_OVERSHOOT = 2;

const SQ3 = Math.sqrt(3);
const HEX = 44;
const SIZE = HEX * SQ3;
const HALF = SIZE / 2;
const UNIT = SIZE / 100;
const BOARD = { width: 470, height: 230, x: 60, y: 75 };
const MARKER_CELL = [1, 0];
const LEAVER_CELL = [3, 1];
const HIT_PAD = 10;

const RING_COUNT = 3;
const RING_RADIUS = HALF * 0.95;
const RING_WIDTH = Math.max(1, 4.6 * UNIT);
const MARKER_RING = { start: 0.12, alpha: 0.95, cycle: 1600 };
const LEAVE_RING = { end: 0.22, alpha: 0.9, fadeIn: 0.2, cycle: 1800 };

const roots = new Map();

let shown = null;
let card = null;
let generation = 0;

function mountTop(host)
{
    const carousel = document.getElementById('la-carousel');
    const top = document.getElementById('ui-top');
    if (carousel?.isConnected)
        carousel.after(host);
    else if (top)
        top.prepend(host);
    else
        document.body.appendChild(host);
}

const PLACES = {
    void: { id: 'la-tour-stage', mount: host => document.body.appendChild(host) },
    carousel: { id: 'la-tour-carousel', mount: host => (document.getElementById('ui-top') ?? document.body).prepend(host) },
    corner: { id: 'la-tour-corner', mount: host => getCornerStack().append(host) },
    cornerTop: { id: 'la-tour-corner-top', mount: host => getCornerStack().prepend(host) },
    top: { id: 'la-tour-top', mount: mountTop },
    hud: { id: 'la-tour-hud', mount: host => document.body.appendChild(host) },
};

function pilotName()
{
    return game.actors.find(actor => actor.type === 'pilot' && actor.isOwner && actor.hasPlayerOwner)?.name ?? localize('LA.tour.demo.pilot');
}

function sheetsLoaded(root)
{
    const pending = [...root.querySelectorAll('link')].filter(link => !link.sheet).map(link => new Promise((resolve) =>
    {
        link.addEventListener('load', resolve, { once: true });
        link.addEventListener('error', resolve, { once: true });
    }));
    return Promise.race([Promise.all(pending), wait(SHEET_WAIT_MS)]);
}

function stageRoot(place)
{
    const { id, mount } = PLACES[place];
    if (roots.has(place) && document.getElementById(id))
        return roots.get(place);

    document.getElementById(id)?.remove();
    const host = document.createElement('div');
    host.id = id;
    const root = host.attachShadow({ mode: 'open' });
    root.adoptedStyleSheets = [...document.adoptedStyleSheets];
    for (const sheet of document.querySelectorAll('link[rel="stylesheet"], style'))
        root.appendChild(sheet.cloneNode(true));
    mount(host);
    const ready = sheetsLoaded(root).then(() => root);
    roots.set(place, ready);
    return ready;
}

async function settle(root)
{
    const running = root.getAnimations().filter(animation => Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)));
    await Promise.race([Promise.all(running.map(animation => animation.finished.catch(() => undefined))), wait(SETTLE_MS)]);
}

function removeFrame()
{
    document.getElementById(FRAME_ID)?.remove();
}

function frame(part)
{
    if (!part?.isConnected)
        return;

    const box = part.getBoundingClientRect();
    const element = document.createElement('div');
    element.id = FRAME_ID;
    Object.assign(element.style, { left: `${box.left - FRAME_PAD}px`, top: `${box.top - FRAME_PAD}px`, width: `${box.width + FRAME_PAD * 2}px`, height: `${box.height + FRAME_PAD * 2}px` });
    document.body.appendChild(element);
}

function clocksDemo(size)
{
    const clocks = [
        { lid: 'la-tour-clock-a', name: localize('LA.tour.demo.clockA'), max: 6, value: 4, tone: 'threat', visibility: 'all', users: [] },
        { lid: 'la-tour-clock-b', name: localize('LA.tour.demo.clockB'), max: 4, value: 1, tone: 'progress', visibility: 'gm', users: [] },
    ];
    const pins = [{ key: 'la-tour-pin', kind: 'clocks', pilot: { isOwner: true, name: pilotName() }, name: localize('LA.tour.demo.pinA'), max: 4, value: 2, fill: PIN_FILL, setValue: () => undefined }];
    return clockPanelPreview({ clocks, pins, size, hidden: 1 });
}

function barDemo()
{
    return reinforcementBarPreview({ round: ROUND_PLANNED, visibility: 'exact', teamHidden: false, mode: 'round', clock: null, form: null }, ROUND_NOW);
}

/** @param {number[]} cell */
function cellPoint([col, row])
{
    return { x: BOARD.x + SIZE * (col + row / 2), y: BOARD.y + HEX * 1.5 * row };
}

function hitBox(center)
{
    return `<rect x="${(center.x - HALF - HIT_PAD).toFixed(1)}" y="${(center.y - HEX - HIT_PAD).toFixed(1)}" width="${(SIZE + HIT_PAD * 2).toFixed(1)}" height="${(HEX * 2 + HIT_PAD * 2).toFixed(1)}" fill="none"/>`;
}

function ringsSvg(className, center, color)
{
    return Array.from({ length: RING_COUNT }, () => `<circle class="${className}" cx="${center.x.toFixed(1)}" cy="${center.y.toFixed(1)}" r="0" fill="none" stroke="${color}"/>`).join('');
}

function markerSvg(unit, color)
{
    const center = cellPoint(MARKER_CELL);
    const points = corners(center, HEX);
    const dash = (5.5 * UNIT).toFixed(2);
    const edges = points.map((from, index) =>
    {
        const to = points[(index + 1) % points.length];
        return `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${color}" stroke-opacity="0.55" stroke-width="${Math.max(1, 2.2 * UNIT).toFixed(2)}" stroke-dasharray="${dash} ${dash}"/>`;
    }).join('');

    return '<g class="la-ts-marker">'
        + hitBox(center)
        + `<polygon points="${hexPoints(center, HEX)}" fill="${color}" fill-opacity="0.08"/>`
        + edges
        + artSvg(unit.img, center, ' opacity="0.28" style="clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)"')
        + ringsSvg('la-ts-marker-ring', center, color)
        + `<polygon points="${hexPoints(center, HALF * 0.62)}" fill="#0a080c" fill-opacity="0.88" stroke="${color}" stroke-width="${Math.max(1, 3.7 * UNIT).toFixed(2)}"/>`
        + `<text x="${center.x.toFixed(1)}" y="${center.y.toFixed(1)}" font-family="Orbitron, Helvetica, Arial, sans-serif" font-weight="700" font-size="${(HALF * 0.58).toFixed(1)}" fill="#fff" stroke="#000" stroke-width="${Math.max(1, 7.4 * UNIT).toFixed(2)}" stroke-linejoin="round" paint-order="stroke" text-anchor="middle" dominant-baseline="central">${ROUND_PLANNED - ROUND_NOW}</text>`
        + '</g>';
}

function leaverSvg(unit, color)
{
    const center = cellPoint(LEAVER_CELL);
    const icon = 20 * UNIT;
    const left = center.x - HALF;
    const top = center.y - HEX;

    return '<g class="la-ts-leaver">'
        + hitBox(center)
        + ringsSvg('la-ts-leave-ring', center, color)
        + artSvg(unit.img, center)
        + `<rect x="${(left + UNIT).toFixed(1)}" y="${(top + UNIT).toFixed(1)}" width="${(icon - 2 * UNIT).toFixed(1)}" height="${(icon - 2 * UNIT).toFixed(1)}" rx="${(2 * UNIT).toFixed(1)}" fill="#000" fill-opacity="0.4" stroke="#000" stroke-width="${UNIT.toFixed(2)}"/>`
        + `<image href="${LEAVING_ICON}" x="${left.toFixed(1)}" y="${top.toFixed(1)}" width="${icon.toFixed(1)}" height="${icon.toFixed(1)}"/>`
        + '</g>';
}

function gridSvg()
{
    const parts = [];
    for (let row = -2; row <= 3; row++)
    {
        for (let col = -2; col <= 7; col++)
        {
            const point = cellPoint([col, row]);
            if (point.x < -HEX || point.x > BOARD.width + HEX || point.y < -HEX || point.y > BOARD.height + HEX)
                continue;
            parts.push(`<polygon points="${hexPoints(point, HEX)}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="1"/>`);
        }
    }
    return parts.join('');
}

function animateRings(board)
{
    const markerRings = [...board.querySelectorAll('.la-ts-marker-ring')];
    const leaveRings = [...board.querySelectorAll('.la-ts-leave-ring')];
    const paint = (ring, scale, alpha) =>
    {
        ring.setAttribute('r', (RING_RADIUS * scale).toFixed(2));
        ring.setAttribute('stroke-width', (RING_WIDTH * scale).toFixed(2));
        ring.setAttribute('stroke-opacity', alpha.toFixed(3));
    };

    const tick = (now) =>
    {
        if (!board.isConnected)
            return;

        markerRings.forEach((ring, index) =>
        {
            const phase = ((now / MARKER_RING.cycle) + index / RING_COUNT) % 1;
            const eased = 1 - (1 - phase) ** 2;
            paint(ring, MARKER_RING.start + (1 - MARKER_RING.start) * eased, MARKER_RING.alpha * (1 - eased));
        });

        leaveRings.forEach((ring, index) =>
        {
            const phase = ((now / LEAVE_RING.cycle) + index / RING_COUNT) % 1;
            const alpha = phase < LEAVE_RING.fadeIn
                ? LEAVE_RING.alpha * phase / LEAVE_RING.fadeIn
                : LEAVE_RING.alpha * (1 - (phase - LEAVE_RING.fadeIn) / (1 - LEAVE_RING.fadeIn));
            paint(ring, 1 - (1 - LEAVE_RING.end) * phase ** 2, alpha);
        });

        requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
}

function boardDemo()
{
    const colors = CONFIG.Canvas.dispositionColors;
    const [unit] = sampleUnits();
    const board = document.createElement('div');
    board.className = 'la-ts-board';
    board.innerHTML = `<svg width="${BOARD.width}" height="${BOARD.height}" viewBox="0 0 ${BOARD.width} ${BOARD.height}">`
        + gridSvg()
        + markerSvg(unit, cssColor(colors.HOSTILE))
        + leaverSvg(ownUnit(), cssColor(colors.PARTY))
        + '</svg>';
    animateRings(board);
    return board;
}

function uplinkDemo()
{
    const [target] = sampleUnits();
    const roller = ownUnit();
    const player = game.users.find(user => !user.isGM)?.name ?? localize('LA.tour.demo.player');
    const snapshot = {
        kind: 'attack',
        title: localize('LA.tour.demo.weapon'),
        user: player,
        actorName: roller.name,
        actorImg: roller.img,
        liveLine: { ranges: [{ type: 'Range', val: 10 }], damage: [{ type: 'Kinetic', val: '1d6' }] },
        raw: {
            weapon: { accurate: true, smart: false, seeking: false, inaccurate: false, impaired: false, engaged: false, melee: false, tech: false, thrown: false },
            base: { grit: 2, flatBonus: 0, accuracy: 1, difficulty: 0 },
            targets: [{ targetUuid: TARGET_UUID, cover: 1, invisible: false, lockOn: true, accuracy: 0, difficulty: 0 }],
        },
        totals: { base: 1, targets: [{ uuid: TARGET_UUID, total: 1 }] },
        targets: [{ uuid: TARGET_UUID, name: target.name, img: target.img }],
        laRows: {},
    };
    const rolls = [
        { id: 'la-tour-roll-a', kind: 'attack', actorName: roller.name, userName: player, snapshot },
        { id: 'la-tour-roll-b', kind: 'hase', checkLabel: 'AGI', actorName: localize('LA.tour.demo.mechB'), userName: player, snapshot: null },
    ];
    return uplinkPanelPreview(rolls, rolls[0].id);
}

function slotCard(id, unit, extra = {})
{
    return {
        id, tokenId: null, img: unit.img, needsThumb: false, name: { text: unit.name, unknown: false }, type: 'mech',
        active: false, defeated: false, hidden: false, owner: true, actsValue: 1, actsMax: 1, actsLeft: 1,
        statuses: [], bar: null, values: null, flashOnly: false, reaction: true, roundsLeft: null,
        event: false, leaving: false, canPing: false, deps: [], ...extra,
    };
}

function carouselLane(key, name, color, cards, incoming = [])
{
    const standing = cards.filter(card => !card.defeated);
    return {
        key, name, color, rank: 0, order: 0, events: false, cards, incoming,
        actsMax: standing.reduce((sum, card) => sum + card.actsMax, 0),
        actsLeft: standing.reduce((sum, card) => sum + card.actsValue, 0),
    };
}

function carouselDemo()
{
    const colors = CONFIG.Canvas.dispositionColors;
    const [mechA, mechB] = worldUnits(actor => actor.type === 'mech' && actor.hasPlayerOwner, ['LA.tour.demo.mech', 'LA.tour.demo.mechB']);
    const [npcA, npcB, npcC, npcD] = worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB', 'LA.tour.demo.unitC', 'LA.tour.demo.unitD']);
    const status = name => ({ img: `systems/lancer/assets/icons/white/${name}.svg`, badge: null });
    const drone = { name: localize('LA.tour.demo.drone'), state: 'ready', kind: 0, art: FALLBACK_ART, hidden: false, tokenIds: ['la-tour-drone'], hp: 5, hpMax: 5, hpShown: false };

    const party = carouselLane('party', localize('LA.carousel.side.player'), cssColor(colors.PARTY), [
        slotCard('la-tour-a', mechA, { active: true, actsValue: 0, actsLeft: 0, statuses: [status('condition_lockon')], deps: [drone] }),
        slotCard('la-tour-b', mechB),
    ]);
    const hostile = carouselLane('hostile', localize('TOKEN.DISPOSITION.HOSTILE'), cssColor(colors.HOSTILE), [
        slotCard('la-tour-c', npcA, { type: 'npc', actsValue: 2, actsMax: 2, actsLeft: 2, statuses: [status('status_exposed')] }),
        slotCard('la-tour-d', npcB, { type: 'npc', leaving: true }),
        slotCard('la-tour-e', npcC, { type: 'npc', actsValue: 0, actsLeft: 0, reaction: false, statuses: [status('condition_shredded')] }),
    ], [{ id: 'la-tour-in', img: npcD.img, known: true, name: { text: npcD.name, unknown: false }, round: ROUND_PLANNED, roundsLeft: ROUND_PLANNED - ROUND_NOW, byClock: false, clock: null, canSooner: true, visibility: 'exact', edited: false, teamHidden: false }]);

    return carouselPreview({ started: true, currentId: 'la-tour-a', lanes: [party, hostile] }, 1);
}

const DEMOS = {
    'carousel': { place: 'carousel', hides: 'la-tour-hide-carousel', build: carouselDemo, after: fitCarouselPreview },
    'clocks': { place: 'corner', hides: 'la-tour-hide-clocks', build: () => clocksDemo('open') },
    'clock-rings': { place: 'corner', hides: 'la-tour-hide-clocks', build: () => clocksDemo('rings') },
    'bar': { place: 'top', hides: 'la-tour-hide-bar', build: barDemo },
    'board': { place: 'void', build: boardDemo },
    'uplink': { place: 'cornerTop', hides: 'la-tour-hide-uplink', build: uplinkDemo },
    'lane': { place: 'cornerTop', hides: 'la-tour-hide-lane', build: () => laneDemo() },
    'attack': { place: 'hud', hides: 'la-tour-hide-hud', build: () => attackWindowDemo('target') },
    'attack-area': { place: 'hud', hides: 'la-tour-hide-hud', build: () => attackWindowDemo('area') },
    'attack-strip': { place: 'hud', hides: 'la-tour-hide-hud', build: () => attackWindowDemo('strip') },
    'attack-chain': { place: 'hud', hides: 'la-tour-hide-hud', build: () => attackWindowDemo('chain') },
    'damage-vulnerable': { place: 'hud', hides: 'la-tour-hide-hud', build: () => damageWindowDemo('single') },
    'damage-vulnerable-multi': { place: 'hud', hides: 'la-tour-hide-hud', build: () => damageWindowDemo('multi') },
    'damage-reliable': { place: 'hud', hides: 'la-tour-hide-hud', build: () => damageWindowDemo('reliable') },
    'damage-variable': { place: 'hud', hides: 'la-tour-hide-hud', build: () => damageWindowDemo('variable') },
    'attack-board': { place: 'void', build: () => attackBoardDemo('targets') },
    'los-board': { place: 'void', build: () => attackBoardDemo('los') },
    'area-board': { place: 'void', build: () => attackBoardDemo('area') },
    'vision-board': { place: 'void', build: visionBoardDemo },
};

const HIDE_CLASSES = [...new Set(Object.values(DEMOS).map(demo => demo.hides).filter(Boolean))];

function clearStages()
{
    for (const { id } of Object.values(PLACES))
        document.getElementById(id)?.shadowRoot?.querySelector('.la-ts-wrap')?.remove();
    document.body.classList.remove(...HIDE_CLASSES);
    shown = null;
}

function closeCard()
{
    card?.close();
    card = null;
}

function forget(handle)
{
    if (card === handle)
        card = null;
}

function arrivalCard()
{
    const [first, second] = sampleUnits();
    const leaver = ownUnit();
    const due = [
        { id: 'la-tour-due-a', icon: first.img, name: escapeHtml(first.name), sub: `${localize('LA.reinforcement.visibility.exact')} · ${localize('LA.reinforcement.landsAtSpot')}`, picked: true, badge: localize('LA.reinforcement.land'), section: localize('LA.reinforcement.arriving') },
        { id: 'la-tour-due-b', icon: second.img, name: escapeHtml(second.name), sub: `${localize('LA.reinforcement.visibility.secret')} · ${localize('LA.reinforcement.landsAtSpot')}`, picked: false, badge: localize('LA.reinforcement.wait'), section: '' },
    ];
    const departures = [
        { id: 'la-tour-leave', icon: leaver.img, name: escapeHtml(leaver.name), sub: localize('LA.leave.edge.north'), picked: true, badge: localize('LA.leave.leave'), section: localize('LA.reinforcement.leaving') },
    ];
    const rows = [...due, ...departures];
    const texts = cardTexts(due, departures);

    return {
        title: localize(texts.title),
        icon: texts.icon,
        origin: localizeFormat('LA.reinforcement.round', { round: ROUND_PLANNED }),
        description: texts.description,
        hint: localize(texts.hint),
        confirmText: `${localizeFormat('LA.reinforcement.landCount', { count: 1 })} · ${localizeFormat('LA.leave.leaveCount', { count: 1 })}`,
        confirmIcon: texts.icon,
        cancelText: localize(texts.cancel),
        cancelIcon: texts.cancelIcon,
        getRows: () => rows,
    };
}

function skirmishCard()
{
    const mech = game.actors.find(actor => actor.type === 'mech' && actor.isOwner && actor.hasPlayerOwner);
    const owned = (mech?.items?.filter(item => item.type === 'mech_weapon') ?? []).slice(0, 2);
    const names = owned.length === 2 ? owned.map(weapon => weapon.name) : [localize('LA.tour.demo.weapon'), localize('LA.tour.demo.weaponB')];
    const rows = [
        { id: 'la-tour-weapon-a', icon: 'cci cci-weapon', name: escapeHtml(names[0]), sub: localize('LA.tour.demo.weaponSub') },
        { id: 'la-tour-weapon-b', icon: 'cci cci-weapon', name: escapeHtml(names[1]), sub: localize('LA.tour.demo.weaponSubB'), tags: [{ text: localize('LA.fireChain.followNoBonus'), corner: true }] },
    ];

    return {
        title: localize('LA.tour.demo.skirmish'),
        origin: mech?.name ?? localize('LA.tour.demo.mech'),
        description: localize('LA.fireChain.skirmishPick'),
        hint: localize('LA.tour.demo.weaponDetailsHint'),
        fitRows: true,
        getRows: () => rows,
    };
}

function sampleShots()
{
    return [
        { icon: 'cci cci-weapon', name: escapeHtml(localize('LA.tour.demo.weapon')), sub: localize('LA.tour.demo.weaponSub') },
        { icon: 'cci cci-weapon', name: escapeHtml(localize('LA.tour.demo.weaponB')), sub: localize('LA.tour.demo.weaponSubB') },
    ].map(row => ({ text: pickRowsText(null, [row]) }));
}

function overwatchCard()
{
    const token = subjectToken();
    const actor = token?.actor ?? game.actors.find(entry => entry.type === 'mech' && entry.isOwner && entry.hasPlayerOwner);
    const reactor = token?.name ?? unitOf(actor, 'LA.tour.demo.mech').name;
    const [mover] = sampleUnits();
    const mounts = actor ? mountPickChoices(actor, weaponSkirmishable, null, () => localize('LA.choiceCard.barrageOnly')) : [];
    const shots = mounts.flatMap(mount => mount.pickRows.map(row => ({ text: pickRowsText(row.section, [row]), disabled: mount.disabled })));

    return {
        title: localize('LA.dialogTitle.overwatchCaps'),
        icon: getActivationIcon('reaction'),
        description: localizeFormat('LA.reaction.overwatchPrompt', { mover: escapeHtml(mover.name), reactor: escapeHtml(reactor) }),
        choices: [...(shots.length ? shots : sampleShots()), { text: localize('LA.prepare.letPass'), icon: 'fas fa-times' }],
    };
}

function askCard()
{
    const [mover] = sampleUnits();

    return {
        title: localizeFormat('LA.prepare.askTitle', { name: localize('LA.tour.demo.skirmish') }),
        icon: PREPARE_ICON,
        description: `${escapeHtml(`${mover.name} ${localize('LA.prepare.when.attacks.text')}`)}. ${localize('LA.prepare.ask')}`,
        choices: [
            { text: localize('LA.prepare.use'), icon: 'fas fa-check' },
            { text: localize('LA.prepare.letPass'), icon: 'fas fa-times' },
        ],
    };
}

function boostCard()
{
    const speed = Number(subjectToken()?.actor?.system?.speed) || SAMPLE_SPEED;

    return {
        title: localize('LA.dialogTitle.boostAndMove'),
        icon: BOOST_ICON,
        description: localizeFormat('LA.movement.exceedsCapBoost', { need: speed + SAMPLE_OVERSHOOT, cap: speed, boost: speed }),
        choices: [
            { text: 'Boost & Move', icon: BOOST_ICON },
            { text: 'Ignore', icon: 'fas fa-forward' },
        ],
    };
}

function openPick(handle, options)
{
    startPickCard({
        ...options,
        urgent: true,
        onPick: () => undefined,
        onReady: (pick) =>
        {
            pick.element.addClass(CARD_CLASS);
            handle.close = () => pick.finish(null);
        },
    }).then(() => forget(handle));
}

function openChoice(handle, options)
{
    const cancelKey = `${CARD_CLASS}-${handle.kind}`;
    const before = new Set(document.querySelectorAll('.la-info-card'));

    startChoiceCard({ ...options, urgent: true, cancelKey }).then(() => forget(handle));
    [...document.querySelectorAll('.la-info-card')].find(element => !before.has(element))?.classList.add(CARD_CLASS);
    handle.close = () => cancelChoiceCardByKey(cancelKey);
}

function prepareStage(element, stage)
{
    const building = element.find('.la-prep-sentence').length > 0;
    if (stage === 'trigger' && !building)
        element.find('[data-role="pick-list"] [data-pick-index]:not(.la-pick-row--off)').first().trigger('click');
    else if (stage === 'pick' && building)
        element.find('[data-head="action"]').trigger('click');
}

function openPrepare(handle)
{
    const subject = subjectToken();
    if (!subject)
        return;

    handle.ready = new Promise((resolve) =>
    {
        pickPrepared(subject, {
            preview: true,
            onPreview: (pick) =>
            {
                if (card !== handle)
                {
                    pick.finish(null);
                    resolve();
                    return;
                }

                pick.element.addClass(CARD_CLASS);
                handle.close = () => pick.finish(null);
                handle.stage = stage => prepareStage(pick.element, stage);
                resolve();
            },
        }).finally(() =>
        {
            forget(handle);
            resolve();
        });
    });
}

function openInvade(handle)
{
    const actor = subjectToken()?.actor ?? game.actors.find(entry => entry.type === 'mech' && entry.isOwner && entry.hasPlayerOwner);
    if (!actor)
        return;

    const units = worldUnits(entry => entry.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB', 'LA.tour.demo.unitC']);
    const targets = units.map((unit, index) => ({ token: { name: unit.name, document: { uuid: `la-tour-invade-${index}`, texture: { src: unit.img } } }, hit: index < 2 }));

    handle.ready = new Promise((resolve) =>
    {
        chooseInvadePerTarget(actor, {
            targets,
            options: getInvadeOptions(actor),
            preview: true,
            onPreview: (pick) =>
            {
                if (card !== handle)
                {
                    pick.finish(null);
                    resolve();
                    return;
                }

                pick.element.addClass(CARD_CLASS);
                handle.close = () => pick.finish(null);
                resolve();
            },
        }).finally(() =>
        {
            forget(handle);
            resolve();
        });
    });
}

const CARD_KINDS = {
    arrival: { open: handle => openPick(handle, arrivalCard()) },
    skirmish: { open: handle => openPick(handle, skirmishCard()) },
    overwatch: { open: handle => openChoice(handle, overwatchCard()) },
    prepare: { open: openPrepare, stage: 'pick' },
    'prepare-trigger': { open: openPrepare, stage: 'trigger' },
    ask: { open: handle => openChoice(handle, askCard()) },
    invade: { open: openInvade },
    boost: { open: handle => openChoice(handle, boostCard()) },
};

function laneDemo()
{
    const [mechA, mechB] = worldUnits(actor => actor.type === 'mech' && actor.hasPlayerOwner, ['LA.tour.demo.mech', 'LA.tour.demo.mechB']);
    const row = (key, unit, reactionName, triggerType) => ({
        key,
        triggerType,
        entry: { isGeneral: true, reaction: {}, reactionName, itemName: reactionName, token: { id: key, name: unit.name, document: { texture: { src: unit.img } } } },
    });

    return automationLanePreview([
        row('la-tour-rx-a', mechA, localize('LA.tour.demo.overwatch'), 'onMove'),
        row('la-tour-rx-b', mechB, localize('LA.tour.demo.brace'), 'onPreDamage'),
    ]);
}

export async function showEncounterDemo(kind, part)
{
    const current = ++generation;
    closeCard();
    removeFrame();
    const demo = DEMOS[kind];
    const root = await stageRoot(demo.place);
    if (current !== generation)
        return;

    if (shown !== kind || !root.querySelector('.la-ts-wrap'))
    {
        clearStages();
        const element = await demo.build();
        if (current !== generation)
            return;

        const wrap = document.createElement('div');
        wrap.className = demo.place === 'void' ? 'la-ts-wrap' : 'la-ts-wrap la-ts-flow';
        wrap.dataset.demo = kind;
        wrap.appendChild(element);
        if (demo.hides)
            document.body.classList.add(demo.hides);
        root.appendChild(wrap);
        demo.after?.(element);
        shown = kind;
        await settle(root);
        if (current !== generation)
            return;
    }

    removeFrame();
    if (root.host.isConnected)
        frame(root.querySelector(`.la-ts-wrap ${part}`));
}

export async function showCardDemo(kind)
{
    const current = ++generation;
    clearStages();
    removeFrame();
    const { open, stage } = CARD_KINDS[kind];

    if (card?.open !== open)
    {
        closeCard();
        const handle = { kind, open, ready: null, close: () => undefined, stage: () => undefined };
        card = handle;
        open(handle);
        await handle.ready;
        await wait(CARD_IN_MS);
        if (current !== generation)
            return;
    }

    if (card?.open === open)
        card.stage(stage);
}

export function hideEncounterDemos()
{
    generation++;
    closeCard();
    removeFrame();
    clearStages();
    for (const { id } of Object.values(PLACES))
        document.getElementById(id)?.remove();
    roots.clear();
}
