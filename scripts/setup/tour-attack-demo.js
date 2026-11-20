import { escapeHtml, localize } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { targetingPreview, aoeRanges, UNKNOWN_CHANCE } from '../activations/targeting-ui.js';
import { laLiveLine, liveLineHtml } from '../activations/roll-card-header.js';
import { fireStripPreview } from '../tools/fire-chain.js';
import { weaponTypeIcon } from '../tah/item-helpers.js';
import { getWeapons } from '../interactive/actor-items.js';
import { getMaxItemRanges_WithBonus } from '../tools/weapon-bonus-utils.js';
import { hitChanceColor } from '../interactive/canvas-helpers.js';
import { TG } from '../interactive/canvas-palette.js';
import { COLOR_CLEAR, COLOR_CLEAR_CORE, COLOR_BLOCKED } from '../vision/sightlines.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { FALLBACK_ART, artOf, cssColor, worldUnits, subjectToken, hexPoints } from './tour-samples.js';
import { vulnerableRowHtml, vulnerableBoxHtml, vulnerableTypeFor, vulnerableTypeChoicesFor, vulnerableDieLabel } from '../bonuses/vulnerable-consume.js';
import { variableRowHtml } from '../bonuses/variable-damage.js';
import { HEX_RADIUS, HEX_WIDTH, SCALE, lineWidth, hexDistance, point, dashedMark, haloShape, distanceLabel, unitSvg, terrainSvg, cellCorners, cursorSvg, boardElement } from './tour-board.js';

const HUD = 'svelte-13q4b2q';
const CHECK = 'svelte-14gn6zy';
const TOTAL = 'svelte-16bpf9g';
const ADJUST = 'svelte-1fyd22x';
const ZONE = 'svelte-imp4iy';
const DAMAGE_HUD = 'svelte-1nxk1l1';
const DAMAGE_CARD = 'svelte-5uy3s3';
const DAMAGE_INPUT = 'svelte-1u0z4l8';
const HIT_RADIO = 'svelte-x2k5tj';
const DAMAGE_TYPES = ['Kinetic', 'Energy', 'Explosive', 'Heat', 'Burn', 'Variable'];
const GRIT = 2;
const RANGE_TYPES = ['Range', 'Threat', 'Thrown'];
const SAMPLE_AREA = [{ type: 'Cone', val: 3 }];
const SAMPLE_RANGED_LINE = { ranges: [{ type: 'Range', val: 10 }], damage: [{ type: 'Kinetic', val: '1d6' }] };
const SAMPLE_AREA_LINE = { ranges: SAMPLE_AREA, damage: [{ type: 'Energy', val: '1d6' }] };
const SAMPLE_HIT = 0.72;

const HIT_FONT = Math.max(12, HEX_WIDTH * 0.18);
const CUT_HALF = 5;

const TARGET_CELLS = { attacker: [0, 2], targetA: [4, 0], targetB: [4, 2], other: [2, 3] };
const SEEN = { targetA: false, targetB: true, other: true };
const TERRAIN_CELL = [2, 1];
const RAY_OFFSETS = [-36, 0, 18];
const AREA_CELLS = { attacker: [1, 0], caughtA: [3, 1], caughtB: [2, 2], other: [5, 2], cursor: [3, 2] };
const CONE_CELLS = [[2, 0], [1, 1], [3, 0], [2, 1], [1, 2], [4, 0], [3, 1], [2, 2], [1, 3]];

function attacker()
{
    const token = subjectToken();
    const actor = token?.actor ?? game.actors.find(entry => entry.type === 'mech' && entry.isOwner && entry.hasPlayerOwner) ?? null;

    return {
        actor,
        name: token?.name ?? actor?.prototypeToken?.name ?? actor?.name ?? localize('LA.tour.demo.mech'),
        img: token?.document?.texture?.src ?? (actor ? artOf(actor) : FALLBACK_ART),
        weapons: getWeapons(actor),
    };
}

async function weaponInfo(weapon, actor, fallbackKey, fallbackLine)
{
    if (!weapon)
        return { name: localize(fallbackKey), icon: null, line: fallbackLine, ranges: {} };

    const ranges = await getMaxItemRanges_WithBonus(weapon, actor);
    return { name: weapon.name, icon: weaponTypeIcon(weapon), line: laLiveLine({ data: { lancerItem: weapon }, item: weapon }, 'accdiff', ranges), ranges };
}

function rangeLabel(ranges)
{
    const type = RANGE_TYPES.find(key => Number(ranges?.[key]) > 0);
    return type ? `${type} ${ranges[type]}` : 'Range 10';
}

function headerIcon(icon)
{
    if (!icon)
        return '<i class="cci cci-weapon i--4 i--light"></i>';

    const url = escapeHtml(foundry.utils.getRoute(icon));
    return `<i class="cci cci-weapon i--4 i--light" style="font-size:0;display:inline-block;width:26px;height:26px;vertical-align:middle;background-color:currentColor;-webkit-mask:url('${url}') center / contain no-repeat;mask:url('${url}') center / contain no-repeat"></i>`;
}

function checkbox(label, disabled = false)
{
    return `<label class="container ${CHECK}"><input type="checkbox" class="${CHECK}"${disabled ? ' disabled' : ''}> <span style="text-wrap: nowrap;" class="${CHECK}">${label}</span></label>`;
}

function windowHtml(info, who)
{
    const profile = info.line ? liveLineHtml(info.line.ranges, info.line.damage) : '';

    return `<form id="accdiff-hud" class="lancer lancer-hud accdiff window-content ${HUD}">
        <div class="lancer-header lancer-weapon medium ${HUD} b3-head">${headerIcon(info.icon)}<span class="b3-title">${escapeHtml(info.name)}</span><span class="b3-who"><img src="${escapeHtml(who.img)}" alt="">${escapeHtml(who.name)}</span></div>
        ${profile ? `<div class="b3-profile">${profile}</div>` : ''}
        <div class="lancer-hud-body ${HUD}">
            <label class="flexrow accdiff-weight lancer-border-primary">Flat Modifier</label>
            <div class="accdiff-grid accdiff-flat-bonus ${HUD}">
                <div class="accdiff-other-grid ${HUD}"><span><b>Grit:</b> +${GRIT}</span></div>
                <div class="accdiff-other-grid accdiff-flat-mod ${HUD}" style="position: relative"><input class="accdiff-flat-mod__input ${HUD}" type="number" value="0" readonly> <button class="accdiff-flat-mod__plus ${HUD}" type="button"><i class="fas fa-plus ${HUD}"></i></button> <button class="accdiff-flat-mod__minus ${HUD}" type="button"><i class="fas fa-minus ${HUD}"></i></button></div>
                <div class="accdiff-other-grid ${HUD}"><span><b>Total:</b> +${GRIT}</span></div>
            </div>
            <div class="accdiff-grid accdiff-grid__section ${HUD}">
                <div class="accdiff-grid__column ${HUD}"><h4 class="lancer-border-primary ${HUD}"><i class="cci cci-accuracy i--4" style="vertical-align: middle; border: none"></i> <span>Accuracy</span></h4></div>
                <div class="accdiff-grid__column ${HUD}"><h4 class="lancer-border-primary ${HUD}"><i class="cci cci-difficulty i--4" style="vertical-align: middle; border: none"></i> <span>Difficulty</span></h4></div>
            </div>
            <div class="accdiff-grid accdiff-grid__section ${HUD}">
                <div class="accdiff-grid__column ${HUD}">${checkbox('Accurate (+1)')}${checkbox('Smart (*)')}${checkbox('Seeking (*)')}</div>
                <div class="accdiff-grid__column ${HUD}">${checkbox('Inaccurate (-1)')}${checkbox('Impaired (-1)', true)}${checkbox('Engaged (-1)')}</div>
            </div>
            <div class="flexcol accdiff-grid ${HUD} la-ts-adjust">
                <div class="flexrow accdiff-grid__section ${HUD}" style="justify-content: space-evenly"><button class="lancer-button dec-set ${ADJUST}" type="button"><i class="cci cci-accuracy i--3"></i></button> <label class="flexcol ${ADJUST}"><strong style="text-wrap: nowrap">Manual Adjust</strong> <strong class="accdiff-value ${ADJUST}"><span>0</span> <i class="i--3 cci cci-accuracy"></i></strong></label> <button class="lancer-button dec-set ${ADJUST}" type="button"><i class="cci cci-difficulty i--3"></i></button></div>
            </div>
            <div class="flexcol accdiff-footer lancer-border-primary ${HUD}">
                <div class="accdiff-total ${HUD}">
                    <div class="flexrow flex-center"><label class="accdiff-weight total-label lancer-mini-header ${HUD}">🞂 <span class="${HUD}">Total</span> 🞀</label></div>
                    <div class="grid-enforcement"><div class="flexrow flex-center accdiff-total ${HUD}"><div class="accdiff-grid accdiff-weight ${TOTAL}"><div class="grid-enforcement total-container ${TOTAL}"><div class="card clipped total ${TOTAL}"><span class="${TOTAL}">0</span> <i class="cci i--4 i--dark white--text middle ${TOTAL} cci-accuracy"></i></div></div></div></div></div>
                </div>
            </div>
        </div>
        <div class="lancer-hud-buttons flexrow"><button class="lancer-button lancer-secondary dialog-button submit default ${HUD}" type="button"><i class="fas fa-check"></i> Roll</button> <button class="dialog-button cancel ${HUD}" type="button"><i class="fas fa-times"></i> Cancel</button></div>
    </form>`;
}

function hudZone(form)
{
    const zone = document.createElement('div');
    zone.id = 'hudzone';
    zone.className = `lancer-hud-zone ${ZONE}`;
    zone.style.bottom = '0';
    zone.style.right = `${document.getElementById('sidebar')?.offsetWidth ?? 0}px`;

    const component = document.createElement('div');
    component.className = `component grid-enforcement ${ZONE}`;
    component.append(form);
    zone.append(component);
    return zone;
}

function chainShots(weapons)
{
    const names = weapons.length >= 2
        ? weapons.slice(0, 3).map(weapon => weapon.name)
        : [localize('LA.tour.demo.weaponB'), localize('LA.tour.demo.weapon'), localize('LA.tour.demo.weaponC')];

    return names.map((name, index) => ({ weapon: { name }, hasBonus: index !== 1, state: index === 0 ? 'done' : '' }));
}

export async function attackWindowDemo(kind)
{
    const who = attacker();
    const area = kind === 'area' || kind === 'strip';
    const ranged = who.weapons.find(weapon => !aoeRanges(weapon).length) ?? null;
    const areaWeapon = who.weapons.find(weapon => aoeRanges(weapon).length) ?? null;
    const chainWeapon = kind === 'chain' && who.weapons.length >= 2 ? who.weapons[1] : null;

    let info;
    if (area)
        info = await weaponInfo(areaWeapon, who.actor, 'LA.tour.demo.areaWeapon', SAMPLE_AREA_LINE);
    else
        info = await weaponInfo(chainWeapon ?? ranged, who.actor, 'LA.tour.demo.weapon', SAMPLE_RANGED_LINE);

    const form = htmlToElement(windowHtml(info, who));
    form.addEventListener('submit', event => event.preventDefault());

    if (area)
    {
        const aoe = areaWeapon ? aoeRanges(areaWeapon) : SAMPLE_AREA;
        const shape = { pattern: String(aoe[0].type).toLowerCase(), size: Number(aoe[0].val) || 1, range: 0 };
        form.querySelector('.la-ts-adjust').append(targetingPreview({ aoe, shape, stripOpen: kind === 'strip', active: kind === 'area' }));
    }
    else
        form.querySelector('.accdiff-footer').before(targetingPreview({ label: rangeLabel(info.ranges), active: kind === 'target' }));

    if (kind === 'chain')
    {
        const shots = chainShots(who.weapons);
        form.prepend(fireStripPreview({ action: shots.length > 2 ? 'BARRAGE' : 'SKIRMISH', shots, index: 1, phase: 'attack' }));
    }

    return hudZone(form);
}

function damageBox({ icon = '', label = '', style = '', checked = false } = {})
{
    return `<label class="container ${CHECK}"${style ? ` style="${style}"` : ''}><input type="checkbox" class="${CHECK}"${checked ? ' checked' : ''}> ${icon ? `<i class="${icon} i--2 ${CHECK}"></i>` : ''} <span style="text-wrap: nowrap;" class="${CHECK}">${label}</span></label>`;
}

function reliableHtml(reliableType)
{
    const style = 'grid-area: reliable; max-width: fit-content; padding-right: 0.5em';
    if (!reliableType)
        return `<div class="flexrow" style="grid-area: reliable; align-items: center">${damageBox({ label: 'Reliable', style })}</div>`;

    const lower = escapeHtml(reliableType.toLowerCase());
    return `<div class="flexrow la-tour-reliable" style="grid-area: reliable; align-items: center">${damageBox({ label: 'Reliable', style, checked: true })} <i class="cci i--2 cci-${lower} damage--${lower} la-cycles ${DAMAGE_HUD}"></i> <input class="lancer-input reliable-value ${DAMAGE_HUD}" type="text" value="2" readonly></div>`;
}

function damageInputHtml(entry)
{
    const lower = escapeHtml(String(entry.type).toLowerCase());
    const options = DAMAGE_TYPES.map(type => `<option class="${DAMAGE_INPUT}" value="${type}"${type === entry.type ? ' selected' : ''}>${type}</option>`).join('');
    return `<div><div class="damage-input-container ${DAMAGE_INPUT}"><i class="i--3 cci cci-${lower} damage--${lower} ${DAMAGE_INPUT}"></i> <select class="damage-input-type ${DAMAGE_INPUT}">${options}</select> <input class="lancer-input damage-input-val ${DAMAGE_INPUT}" type="text" value="${escapeHtml(entry.val)}" readonly> <button class="lancer-button damage-delete ${DAMAGE_INPUT}" type="button"><i class="fas fa-trash ${DAMAGE_INPUT}"></i></button></div></div>`;
}

function hitRadioHtml(layout)
{
    const options = [['crit', 'Crit', 'fas fa-explosion'], ['hit', 'Hit', 'fas fa-crosshairs'], ['miss', 'Miss', 'mdi mdi-call-missed']];
    const radios = options.map(([slug, label, icon]) => `<input type="radio" class="no-grow ${slug}-cover ${HIT_RADIO}"${slug === 'hit' ? ' checked' : ''}> <label class="lancer-hit-quality-radio-label  ${HIT_RADIO}"><i class="${icon} i--2 ${HIT_RADIO}"></i> <span class="no-grow">${label}</span> ${slug === 'hit' ? `<div class="hit-quality-arrow ${HIT_RADIO}"></div>` : ''}</label>`);
    return `<div class="lancer-hit-quality-radio damage-target-quality ${layout} ${HIT_RADIO}">${radios.join(' ')}</div>`;
}

function singleTargetHtml(unit)
{
    return `<div role="radiogroup" class="single-target-container target-hit ${DAMAGE_HUD}"><span class="target-name flexrow lancer-mini-header ${DAMAGE_HUD}">🞂<b class="${DAMAGE_HUD}">${escapeHtml(unit.name)}</b>🞀</span> <div class="target-body flexrow ${DAMAGE_HUD}"><img class="lancer-hit-thumb ${DAMAGE_HUD}" src="${escapeHtml(unit.img)}" alt=""> ${hitRadioHtml('flexcol')}</div></div>`;
}

function targetCardHtml(unit, vulnerableBox)
{
    const boxes = [damageBox({ icon: 'mdi mdi-shield-off-outline' }), damageBox({ icon: 'cci cci-large-beam', style: 'margin: 0 0.3em' }), damageBox({ icon: 'mdi mdi-fraction-one-half' }), vulnerableBox].join(' ');
    const add = `<button class="lancer-button add-damage-type ${DAMAGE_CARD}" type="button"><i class="mdi mdi-plus-thick ${DAMAGE_CARD}"></i></button>`;
    return `<div role="radiogroup" class="target-container ${DAMAGE_HUD}"><div class="damage-hud-target-card card target-hit ${DAMAGE_CARD}"><span class="target-name flexrow lancer-mini-header ${DAMAGE_CARD}">🞂<b>${escapeHtml(unit.name)}</b>🞀</span> <div class="flexrow"><img class="lancer-hit-thumb ${DAMAGE_CARD}" src="${escapeHtml(unit.img)}" alt=""> <div class="card clipped target-bonus-damage ${DAMAGE_CARD}"><span class="flexrow" style="width: 100%"><b class="target-bonus-damage-title ${DAMAGE_CARD}">Bonus</b> </span> ${add}</div></div> <div class="hit-quality ${DAMAGE_CARD}">${hitRadioHtml('flexrow')}</div> <div class="flexrow damage-target-config ${DAMAGE_CARD}${vulnerableBox ? ' la-four' : ''}">${boxes}</div></div></div>`;
}

function damageConfigHtml(extraRow, reliableType, extraArea)
{
    const knockback = !!getModuleSetting('enableKnockbackFlow');
    const areas = ['"title title"', '"ap overkill"', '"paracausal reliable"', `"halfdamage ${knockback ? 'knockback' : 'empty'}"`, '"nobonusdmg throttled"', extraArea];
    const laRow = (area, label, icon = '') => `<div style="grid-area: ${area}; display: flex; align-items: center; margin-top: 4px;"><label class="container ${CHECK}" style="max-width: fit-content; padding-right: 0.5em;"><input type="checkbox" class="${CHECK}">${icon ? `<i class="${icon} i--s ${CHECK}"></i>` : ''}<span style="text-wrap: nowrap;">${label}</span></label></div>`;

    return `<div class="damage-hud-options-grid ${DAMAGE_HUD}" style='grid-template-areas: ${areas.join(' ')};'>`
        + `<h4 class="damage-hud-section lancer-border-primary ${DAMAGE_HUD}" style="justify-content: center; grid-area: title">Configuration</h4>`
        + damageBox({ icon: 'mdi mdi-shield-off-outline', label: 'Armor Piercing (AP)', style: 'grid-area: ap' })
        + damageBox({ label: 'Overkill', style: 'grid-area: overkill' })
        + damageBox({ icon: 'cci cci-large-beam', label: 'Cannot be Reduced', style: 'grid-area: paracausal' })
        + damageBox({ icon: 'mdi mdi-fraction-one-half', label: 'Half Damage', style: 'grid-area: halfdamage' })
        + reliableHtml(reliableType)
        + (knockback ? laRow('knockback', 'Knockback') : '')
        + laRow('nobonusdmg', 'No Bonus Dmg', 'mdi mdi-cancel')
        + laRow('throttled', 'Throttled (Half Dmg)')
        + extraRow
        + '</div>';
}

function damageWindowHtml(info, who, damage, extraRow, targetsHtml, reliableType, extraArea)
{
    const profile = info.line ? liveLineHtml(info.line.ranges, info.line.damage) : '';
    const add = `<button class="add-damage-type ${DAMAGE_HUD}" type="button"><i class="mdi mdi-plus-thick ${DAMAGE_HUD}"></i></button>`;

    return `<form id="damage-hud" class="lancer lancer-hud damage-hud window-content ${DAMAGE_HUD}">
        <div class="lancer-header lancer-weapon medium b3-head">${headerIcon(info.icon)}<span class="b3-title">${escapeHtml(info.name)}</span><span class="b3-who"><img src="${escapeHtml(who.img)}" alt="">${escapeHtml(who.name)}</span></div>
        ${profile ? `<div class="b3-profile">${profile}</div>` : ''}
        <div class="lancer-hud-body">
            <div class="damage-grid ${DAMAGE_HUD}">
                <div class="base-damage lancer-border-primary ${DAMAGE_HUD}"><h4 class="damage-hud-section lancer-border-primary flexrow ${DAMAGE_HUD}">Base Damage ${add}</h4>${damage.map(damageInputHtml).join('')}</div>
                <div class="bonus-damage ${DAMAGE_HUD}"><h4 class="damage-hud-section lancer-border-primary flexrow ${DAMAGE_HUD}">Bonus Damage ${add}</h4></div>
            </div>
            ${damageConfigHtml(extraRow, reliableType, extraArea)}
            <div class="damage-hud-targets ${DAMAGE_HUD}">${targetsHtml}</div>
        </div>
        <div class="lancer-hud-buttons flexrow"><button class="lancer-button lancer-secondary dialog-button submit default" type="button"><i class="fas fa-check"></i> Roll</button> <button class="dialog-button cancel" type="button"><i class="fas fa-times"></i> Cancel</button></div>
    </form>`;
}

export async function damageWindowDemo(kind)
{
    const who = attacker();
    const ranged = who.weapons.find(weapon => !aoeRanges(weapon).length) ?? null;
    const info = await weaponInfo(ranged, who.actor, 'LA.tour.demo.weapon', SAMPLE_RANGED_LINE);
    const weaponDamage = info.line?.damage?.length ? info.line.damage : SAMPLE_RANGED_LINE.damage;
    const addedType = ['Energy', 'Kinetic', 'Explosive'].find(type => !weaponDamage.some(entry => entry.type === type)) ?? null;
    const reliable = kind === 'reliable';
    const variable = kind === 'variable';
    let damage = reliable && addedType ? [...weaponDamage, { type: addedType, val: '2' }] : weaponDamage;
    if (variable)
        damage = [{ type: 'Energy', val: weaponDamage[0]?.val ?? '1d6' }];
    const reliableType = reliable ? (addedType ?? weaponDamage[0].type) : null;
    const [unitA, unitB] = worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB']);
    const multi = kind === 'multi';
    const type = vulnerableTypeFor(damage);
    const die = vulnerableDieLabel(multi);

    const extraRow = variable
        ? variableRowHtml({ pick: 'Energy', hudScope: DAMAGE_HUD })
        : vulnerableRowHtml({ checked: true, partial: false, type, die, cycles: vulnerableTypeChoicesFor(damage).length > 1, scope: CHECK, hudScope: DAMAGE_HUD });
    const targetsHtml = multi
        ? targetCardHtml(unitA, vulnerableBoxHtml({ checked: true, name: unitA.name, type, die, scope: CHECK })) + targetCardHtml(unitB, '')
        : singleTargetHtml(unitA);

    const form = htmlToElement(damageWindowHtml(info, who, damage, extraRow, targetsHtml, reliableType, variable ? '"variable variable"' : '"vulnerable ."'));
    form.addEventListener('submit', event => event.preventDefault());
    return hudZone(form);
}

function hitLabel(center, text, color)
{
    return `<text class="la-ts-hit" x="${center.x.toFixed(1)}" y="${(center.y - HEX_RADIUS - lineWidth(3)).toFixed(1)}" fill="${color}" font-size="${HIT_FONT.toFixed(1)}" text-anchor="middle">${escapeHtml(text)}</text>`;
}

function glowRay(from, to)
{
    const segment = `x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}"`;
    return `<line ${segment} stroke="${cssColor(COLOR_CLEAR)}" stroke-opacity="0.16" stroke-width="7"/>`
        + `<line ${segment} stroke="${cssColor(COLOR_CLEAR)}" stroke-width="2.5"/>`
        + `<line ${segment} stroke="${cssColor(COLOR_CLEAR_CORE)}" stroke-opacity="0.8" stroke-width="1"/>`;
}

function cutRay(from, to, cut)
{
    const blocked = cssColor(COLOR_BLOCKED);
    return `<line x1="${from.x.toFixed(1)}" y1="${from.y.toFixed(1)}" x2="${cut.x.toFixed(1)}" y2="${cut.y.toFixed(1)}" stroke="${blocked}" stroke-opacity="0.75" stroke-width="2"/>`
        + `<line x1="${cut.x.toFixed(1)}" y1="${cut.y.toFixed(1)}" x2="${to.x.toFixed(1)}" y2="${to.y.toFixed(1)}" stroke="${blocked}" stroke-opacity="0.18" stroke-width="1.5" stroke-dasharray="4 7"/>`
        + `<path d="M${cut.x - CUT_HALF} ${cut.y - CUT_HALF}L${cut.x + CUT_HALF} ${cut.y + CUT_HALF}M${cut.x + CUT_HALF} ${cut.y - CUT_HALF}L${cut.x - CUT_HALF} ${cut.y + CUT_HALF}" stroke="${blocked}" stroke-width="2"/>`;
}

function firstHit(from, to, polygon)
{
    const rayX = to.x - from.x;
    const rayY = to.y - from.y;
    let best = null;

    for (let index = 0; index < polygon.length; index++)
    {
        const start = polygon[index];
        const end = polygon[(index + 1) % polygon.length];
        const edgeX = end.x - start.x;
        const edgeY = end.y - start.y;
        const denominator = rayX * edgeY - rayY * edgeX;
        if (Math.abs(denominator) < 1e-9)
            continue;

        const along = ((start.x - from.x) * edgeY - (start.y - from.y) * edgeX) / denominator;
        const across = ((start.x - from.x) * rayY - (start.y - from.y) * rayX) / denominator;
        if (along > 0 && along < 1 && across >= 0 && across <= 1 && (best === null || along < best))
            best = along;
    }

    return best === null ? null : { x: from.x + rayX * best, y: from.y + rayY * best };
}

function raysSvg()
{
    const from = point(TARGET_CELLS.attacker);
    const to = point(TARGET_CELLS.targetB);
    const [terrain] = cellCorners([TERRAIN_CELL]);
    const rays = RAY_OFFSETS.map(offset => ({ from: { x: from.x + HEX_WIDTH * 0.3, y: from.y + offset }, to: { x: to.x - HEX_WIDTH * 0.3, y: to.y + offset * 0.7 } }));

    return `<g class="la-ts-rays">${rays.map((ray) =>
    {
        const cut = firstHit(ray.from, ray.to, terrain);
        return cut ? cutRay(ray.from, ray.to, cut) : glowRay(ray.from, ray.to);
    }).join('')}</g>`;
}

function targetsSvg(los)
{
    const [unitA, unitB, unitC] = worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB', 'LA.tour.demo.unitC']);
    const who = attacker();
    const placed = cssColor(TG.placed);
    const eyes = los || getModuleSetting('lancerLos') === true;
    const distance = key => distanceLabel(point(TARGET_CELLS[key]), hexDistance(TARGET_CELLS.attacker, TARGET_CELLS[key]), eyes ? SEEN[key] : null);
    const hovered = los ? '' : haloShape([hexPoints(point(TARGET_CELLS.other), HEX_RADIUS)], cssColor(TG.target), 4, 0.8, 0.2);

    return terrainSvg([TERRAIN_CELL])
        + unitSvg('la-ts-attacker', TARGET_CELLS.attacker, who, dashedMark(point(TARGET_CELLS.attacker), cssColor(TG.reference), true))
        + unitSvg('la-ts-target-a', TARGET_CELLS.targetA, unitA, dashedMark(point(TARGET_CELLS.targetA), placed) + hitLabel(point(TARGET_CELLS.targetA), `${Math.round(SAMPLE_HIT * 100)}%`, cssColor(hitChanceColor(SAMPLE_HIT))) + distance('targetA'))
        + unitSvg('la-ts-target-b', TARGET_CELLS.targetB, unitB, dashedMark(point(TARGET_CELLS.targetB), placed) + hitLabel(point(TARGET_CELLS.targetB), UNKNOWN_CHANCE.label, cssColor(UNKNOWN_CHANCE.fill)) + distance('targetB'))
        + unitSvg('la-ts-other', TARGET_CELLS.other, unitC, hovered + distance('other'))
        + (los ? raysSvg() : '');
}

function areaSvg()
{
    const [unitA, unitB, unitC] = worldUnits(actor => actor.type === 'npc', ['LA.tour.demo.unitA', 'LA.tour.demo.unitB', 'LA.tour.demo.unitC']);
    const who = attacker();
    const origin = point(AREA_CELLS.attacker);
    const cursor = point(AREA_CELLS.cursor);
    const cone = haloShape(CONE_CELLS.map(cell => hexPoints(point(cell), HEX_RADIUS)), cssColor(TG.inRange), 2, 0.6, 0.12);
    const caught = haloShape([AREA_CELLS.caughtA, AREA_CELLS.caughtB].map(cell => hexPoints(point(cell), HEX_RADIUS)), cssColor(TG.target), 4, 0.8, 0.2);
    const traceStroke = lineWidth(1.5);
    const traceHalo = traceStroke + Math.max(1, 2 * SCALE);
    const trace = `M${origin.x.toFixed(1)} ${origin.y.toFixed(1)}L${cursor.x.toFixed(1)} ${cursor.y.toFixed(1)}`;
    const dot = Math.max(4, HEX_WIDTH * 0.14);
    const circle = `cx="${origin.x.toFixed(1)}" cy="${origin.y.toFixed(1)}" r="${dot.toFixed(1)}" fill="none"`;

    return unitSvg('la-ts-attacker', AREA_CELLS.attacker, who, dashedMark(origin, cssColor(TG.reference), true))
        + unitSvg('la-ts-caught-a', AREA_CELLS.caughtA, unitA)
        + unitSvg('la-ts-caught-b', AREA_CELLS.caughtB, unitB)
        + unitSvg('la-ts-other', AREA_CELLS.other, unitC)
        + `<g class="la-ts-cone">${cone}${caught}`
        + `<path d="${trace}" stroke="#000" stroke-opacity="0.8" stroke-width="${traceHalo.toFixed(2)}" fill="none"/><circle ${circle} stroke="#000" stroke-opacity="0.8" stroke-width="${traceHalo.toFixed(2)}"/>`
        + `<path d="${trace}" stroke="${cssColor(TG.traceLine)}" stroke-opacity="0.8" stroke-width="${traceStroke.toFixed(2)}" fill="none"/><circle ${circle} stroke="${cssColor(TG.traceLine)}" stroke-opacity="0.8" stroke-width="${traceStroke.toFixed(2)}"/>`
        + `${cursorSvg(cursor)}</g>`;
}

export function attackBoardDemo(kind)
{
    return boardElement(kind === 'area' ? areaSvg() : targetsSvg(kind === 'los'));
}
