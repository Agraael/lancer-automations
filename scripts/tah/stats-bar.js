// TAH stats bar: the inline HP / heat / structure / pips display.

import { playUiSound } from './sound.js';

/** Whether the secondary stats panel is expanded. Persists across in-place updates. */
let _statsExpanded = false;

/** Collapse the stats detail panel (call when the HUD closes). */
export function resetStatsExpanded()
{
    _statsExpanded = false;
}

/** Linear interpolation between two RGB colours. t=0→colour1, t=1→colour2. */
function lerpColor(r1, g1, b1, r2, g2, b2, t)
{
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
}

/**
 * Build the stats-bar HTML for the given actor.
 * Returns a raw HTML string; wrap in `$(...)` to get a jQuery element.
 * @param {any} actor
 * @param {any} [token]
 * @returns {string}
 */
export function buildStatsHtml(actor, token = null)
{
    const sys = actor.system;
    const strVal    = sys.structure?.value ?? 0;
    const strMax    = sys.structure?.max  ?? 0;
    const stressVal = sys.stress?.value   ?? 0;
    const stressMax = sys.stress?.max     ?? 0;
    const hasStructure = strMax > 0;
    const hasStress    = stressMax > 0;
    const hasHeat      = (sys.heat?.max ?? 0) > 0;
    // Pilot bond stress (different mechanic from mech stress above).
    const pilotStressVal = sys.bond_state?.stress?.value ?? 0;
    const pilotStressMax = sys.bond_state?.stress?.max ?? 0;
    const hasPilotStress = actor.type === 'pilot' && pilotStressMax > 0;
    const bondXpVal = sys.bond_state?.xp?.value ?? 0;
    const bondXpMax = sys.bond_state?.xp?.max ?? 0;
    const hasBondXp = actor.type === 'pilot' && bondXpMax > 0 && !!actor.items?.find?.((/** @type {any} */ ownedItem) => ownedItem.type === 'bond');
    const pilotStressRatio = pilotStressMax > 0 ? pilotStressVal / pilotStressMax : 0;
    // grey at 0 -> #d9b800 at max
    const pilotStressColor = lerpColor(136, 136, 136, 217, 184, 0, pilotStressRatio);
    const hp          = sys.hp     ?? { value: 0, max: 0 };
    const heat        = sys.heat   ?? { value: 0, max: 0 };
    const overshield  = sys.overshield?.value ?? 0;
    const hasRepairs  = sys.repairs != null;
    const repairs     = sys.repairs?.value ?? 0;
    const burn        = sys.burn ?? 0;
    const infection   = sys.infection ?? 0;
    const oc          = sys.overcharge ?? 0;
    const reaction    = sys.action_tracker?.reaction ?? false;

    const hpRatio    = hp.max > 0 ? hp.value / hp.max : 1;
    const heatRatio  = heat.max > 0 ? heat.value / heat.max : 0;
    // HP: red → yellow → green (two-stop, avoids brown midpoint). Over max (OS boost) → cyan/teal.
    const hpColor = hpRatio > 1
        ? '#5ec0c5'
        : hpRatio < 0.5
            ? lerpColor(244, 67, 54, 255, 215, 0,  hpRatio * 2)
            : lerpColor(255, 215, 0, 76, 175, 80, (hpRatio - 0.5) * 2);
    // Heat: grey → yellow → orange → red (3-segment)
    let heatColor;
    if (heatRatio < 1 / 3)
        heatColor = lerpColor(136, 136, 136, 255, 215, 0,  heatRatio * 3);
    else if (heatRatio < 2 / 3)
        heatColor = lerpColor(255, 215, 0, 255, 140, 0, (heatRatio - 1 / 3) * 3);
    else
        heatColor = lerpColor(255, 140, 0, 244, 67, 54, (heatRatio - 2 / 3) * 3);

    const strPips    = Array.from({ length: strMax },    (_, i) => `<i class="cci cci-structure" style="font-size:1.1em;color:${i >= strMax    - strVal    ? '#e8d060' : '#3a3a3a'};vertical-align:middle;transform:translateY(2px);display:inline-block;"></i>`).join('');
    const stressPips = Array.from({ length: stressMax }, (_, i) => `<i class="cci cci-reactor" style="font-size:1.1em;color:${i >= stressMax - stressVal ? '#e07830' : '#3a3a3a'};vertical-align:middle;transform:translateY(2px);display:inline-block;"></i>`).join('');

    const hasOvercharge = !!sys.overcharge_sequence;
    const ocSeq    = hasOvercharge ? sys.overcharge_sequence.split(',').map(/** @type {(s:string)=>string} */ s => s.trim()) : [];
    const ocLabel  = hasOvercharge ? (ocSeq[Math.min(oc, ocSeq.length - 1)] ?? '—') : null;
    const ocMax    = ocSeq.length - 1;
    const ocColor  = !hasOvercharge ? '#555' : ocMax > 0 ? lerpColor(204, 170, 50, 244, 67, 54, Math.min(oc / ocMax, 1)) : '#eb4034';
    const SEP = `<span style="color:#444;">│</span>`;
    const EMPTY = '<span></span>';
    const cellWrap = (/** @type {string} */ inner) => `<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">${inner}</span>`;
    const repairImg   = `<img src="systems/lancer/assets/icons/white/repair.svg" title="Repairs" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${repairs > 0 ? 1 : 0.3};">`;
    const reactionNum = `<span title="Reaction" style="color:${reaction ? '#a855f7' : '#aaa'};font-weight:bold;">${reaction ? '1' : '0'}</span>`;
    const reactionImg = `<img src="systems/lancer/assets/icons/white/reaction.svg" title="Reaction" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${reaction ? 1 : 0.3};">`;
    const overshieldHtml = overshield > 0 ? `${SEP}<span title="Overshield" style="color:#60a5fa;">${overshield}<i class="mdi mdi-hexagon-multiple-outline" style="font-size:1.05em;vertical-align:-1px;margin-left:1px;"></i></span>` : '';

    // Movement display
    const tokenId = token?.document?.id ?? token?.id ?? null;
    const inCombat = !!game.combat?.active &&
        !!(/** @type {any} */ (game.combat)?.combatants?.find((/** @type {{ tokenId: string }} */ c) => c.tokenId === tokenId));
    const movIcon = `<i class="mdi mdi-arrow-right-bold-hexagon-outline" title="Movement" style="font-size:1.12em;color:#fff;line-height:0;transform:translateY(2px);display:inline-block;"></i>`;
    let movCell;
    if (inCombat && token)
    {
        const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
        const mh = api?.getMovementHistory?.(token);
        const regularCost = mh?.intentional?.regularCost ?? 0;
        const cap = api?.getMovementCap?.(token);
        let movColor;
        if (cap <= 0)
            movColor = '#aaa';
        else if (regularCost <= cap)
            movColor = lerpColor(76, 175, 80, 255, 235, 59, regularCost / cap);   // green→yellow
        else
            movColor = lerpColor(255, 235, 59, 244, 67, 54, Math.min(1, (regularCost - cap) / cap));   // yellow→red
        movCell = cellWrap(`${movIcon}<span title="Movement used / cap" style="color:${movColor};">${regularCost}/${cap}</span>`);
    }
    else
        movCell = cellWrap(`${movIcon}<span title="Speed" style="color:#aaa;">${sys.speed ?? 0}</span>`);

    // Secondary stats row
    const armor       = sys.armor ?? 0;
    const evasion     = sys.evasion ?? 0;
    const edef        = sys.edef ?? 0;
    const techAttack  = sys.tech_attack ?? 0;
    const save        = sys.save ?? 0;
    const sensorRange = sys.sensor_range ?? 0;
    const coreEnergy  = sys.core_energy ?? 0;
    const coreActive  = sys.core_active ?? false;
    const hasCoreSystem = sys.core_energy != null;
    const S_STAT = 'font-size:0.95em;';
    const S_ICON = 'width:1.3em;height:1.3em;vertical-align:middle;background:none;border:none;';
    const statIcon = (/** @type {string} */ src, /** @type {string} */ title) => `<img src="${src}" title="${title}" style="${S_ICON}">`;
    const statCell = (/** @type {string} */ iconSrc, /** @type {string} */ title, /** @type {string} */ valueHtml) =>
        `<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">${statIcon(iconSrc, title)}${valueHtml}</span>`;
    const coreCell = hasCoreSystem
        ? `<span title="Core Power" style="display:inline-flex;align-items:center;gap:2px;color:${coreEnergy > 0 ? (coreActive ? '#a855f7' : '#3a9e6e') : '#c33'};">${statIcon('systems/lancer/assets/icons/white/corepower.svg', 'Core Power')}${coreEnergy > 0 ? (coreActive ? 'ON' : '✓') : '✗'}</span>`
        : '';

    const haseCell = (/** @type {string} */ letter, /** @type {string} */ title, /** @type {number|null|undefined} */ value) =>
        `<span title="${title}" style="white-space:nowrap;"><span style="color:#fff;font-weight:bold;">${letter}</span> <span style="color:#aaa;">${(value ?? 0) >= 0 ? '+' : ''}${value ?? 0}</span></span>`;
    const hasHase = [sys.hull, sys.agi, sys.sys, sys.eng].some(value => value != null);
    const haseHtml = hasHase
        ? `<div style="width:1px;background:#444;align-self:stretch;margin:0 6px;flex-shrink:0;"></div>` +
          `<div style="display:grid;grid-template-columns:repeat(2,auto);column-gap:8px;row-gap:2px;align-items:center;justify-items:start;align-self:center;${S_STAT}">` +
          `${haseCell('H', 'Hull', sys.hull)}${haseCell('A', 'Agility', sys.agi)}` +
          `${haseCell('S', 'Systems', sys.sys)}${haseCell('E', 'Engineering', sys.eng)}` +
          `</div>`
        : '';

    const expanded = _statsExpanded ? 'display:flex' : 'display:none';
    const arrow = _statsExpanded ? '◀' : '▶';

    // Two rows sharing grid columns so values align; │ separators are their own cells.
    const topRow = [];
    const bottomRow = [];
    if (hasStructure || hasStress)
    {
        topRow.push(hasStructure ? cellWrap(strPips) : EMPTY, hasStructure ? SEP : EMPTY);
        bottomRow.push(hasStress ? cellWrap(stressPips) : EMPTY, hasStress ? SEP : EMPTY);
    }
    topRow.push(cellWrap(`<span title="HP" style="color:${hpColor};">${hp.value}/${hp.max} ♥</span>${overshieldHtml}`));
    bottomRow.push(hasHeat
        ? cellWrap(`<span title="Heat" style="color:${heatColor};">${heat.value}/${heat.max}🌡</span>`)
        : (hasPilotStress
            ? cellWrap(`<span title="Stress" style="color:${pilotStressColor};">${pilotStressVal}/${pilotStressMax}<i class="mdi mdi-brain" style="font-size:1.1em;vertical-align:middle;margin-left:1px;"></i></span>`)
            : EMPTY));
    const topExtras = [];
    if (hasRepairs)
        topExtras.push(cellWrap(`${repairImg}<span style="color:${repairs > 0 ? '#66cc66' : '#aaa'};">${repairs}</span>`));
    const bottomExtras = [];
    if (hasBondXp)
        bottomExtras.push(cellWrap(`<span title="Bond XP" style="color:${bondXpVal > 0 ? '#00b8d4' : '#888'};">${bondXpVal}/${bondXpMax}<i class="mdi mdi-head-cog-outline" style="font-size:1.1em;vertical-align:middle;margin-left:1px;"></i></span>`));
    if (burn > 0)
        bottomExtras.push(cellWrap(`<span title="Burn" style="color:#d74242;"><i class="cci cci-burn" style="font-size:1.1em;vertical-align:middle;"></i>${burn}</span>`));
    if (infection > 0)
        bottomExtras.push(cellWrap(`<span title="Infection" style="color:#1a8a3a;">☣${infection}</span>`));
    if (hasOvercharge)
        bottomExtras.push(cellWrap(`<span title="Overcharge" style="color:${ocColor};"><i class="cci cci-overcharge" style="font-size:1.1em;vertical-align:middle;"></i>${ocLabel}</span>`));
    while (topExtras.length < bottomExtras.length)
        topExtras.push(null);
    while (bottomExtras.length < topExtras.length)
        bottomExtras.push(null);
    topExtras.forEach((cell, index) =>
    {
        topRow.push(cell ? SEP : EMPTY, cell ?? EMPTY);
        bottomRow.push(bottomExtras[index] ? SEP : EMPTY, bottomExtras[index] ?? EMPTY);
    });
    topRow.push(SEP, movCell);
    bottomRow.push(SEP, cellWrap(`${reactionImg}${reactionNum}`));

    return `<div id="la-hud-stats" style="background:#111;border-bottom:2px solid var(--primary-color);padding:2px 0 2px 8px;font-size:0.97em;color:#888;width:max-content;display:flex;align-items:stretch;position:relative;z-index:2;">` +
        `<div style="display:grid;grid-template-columns:repeat(${topRow.length},auto);column-gap:3px;row-gap:2px;align-items:center;justify-items:start;align-self:center;">` +
        `${topRow.join('')}${bottomRow.join('')}` +
        `</div>` +
        `<div class="la-stats-toggle" title="Toggle Stats" style="cursor:pointer;user-select:none;width:10px;background:var(--primary-color);display:flex;align-items:center;justify-content:center;margin-left:6px;flex-shrink:0;">` +
        `<span style="font-size:0.55em;color:#111;font-weight:bold;line-height:1;">${arrow}</span>` +
        `</div>` +
        `<div class="la-stats-detail" style="${expanded};padding:0 8px 0 6px;justify-content:center;align-items:stretch;">` +
        `<div style="display:grid;grid-template-columns:repeat(${hasCoreSystem ? 4 : 3},auto);column-gap:10px;row-gap:2px;align-items:center;justify-items:start;align-self:center;${S_STAT}">` +
        `${statCell('systems/lancer/assets/icons/white/shield_outline.svg', 'Armor', `<span title="Armor" style="color:#aaa;">${armor}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/evasion.svg', 'Evasion', `<span title="Evasion" style="color:#aaa;">${evasion}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/edef.svg', 'E-Defense', `<span title="E-Defense" style="color:#aaa;">${edef}</span>`)}` +
        `${hasCoreSystem ? (sys.grit != null
            ? `<span title="Grit" style="white-space:nowrap;"><span style="color:#ffaa55;font-weight:bold;">G</span> <span style="color:#aaa;">+${sys.grit}</span></span>`
            : '<span></span>') : ''}` +
        `${statCell('systems/lancer/assets/icons/white/tech_quick.svg', 'Tech Attack', `<span title="Tech Attack" style="color:#aaa;">${techAttack >= 0 ? '+' : ''}${techAttack}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/save.svg', 'Save', `<span title="Save" style="color:#aaa;">${save}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/sensor.svg', 'Sensors', `<span title="Sensors" style="color:#aaa;">${sensorRange}</span>`)}` +
        `${coreCell}` +
        `</div>` +
        `${haseHtml}` +
        `</div>` +
        `</div>`;
}

/**
 * Build the stats bar as a jQuery element with toggle wired up.
 * @param {any} actor
 * @param {any} [token]
 * @returns {JQuery}
 */
export function buildStatsEl(actor, token = null)
{
    const el = $(buildStatsHtml(actor, token));
    const detail = el.find('.la-stats-detail');
    const toggle = el.find('.la-stats-toggle');
    if (_statsExpanded)
        detail.css({ display: 'flex', overflow: 'hidden' });
    else
        detail.css({ display: 'none', overflow: 'hidden' });
    // duration follows content width, so a wider panel still finishes its slide
    const slideMs = (/** @type {number} */ targetWidth) => Math.min(320, Math.max(150, Math.round(targetWidth * 0.9)));
    const openDetail = () =>
    {
        if (_statsExpanded)
            return;
        _statsExpanded = true;
        detail.stop(true).css({ display: 'flex', width: 0, opacity: 0 });
        const targetWidth = detail.prop('scrollWidth');
        detail.animate({ width: targetWidth, opacity: 1 }, slideMs(targetWidth), function ()
        {
            $(this).css('width', '');
        });
        toggle.find('span').text('◀');
    };
    const closeDetail = () =>
    {
        if (!_statsExpanded)
            return;
        _statsExpanded = false;
        detail.stop(true).animate({ width: 0, opacity: 0 }, slideMs(detail.prop('scrollWidth')) * 0.8, function ()
        {
            $(this).css({ display: 'none', width: '', opacity: '' });
        });
        toggle.find('span').text('▶');
    };
    el.on('mouseenter', () =>
    {
        playUiSound('details'); openDetail();
    });
    el.on('mouseleave', closeDetail);
    toggle.on('click', (ev) =>
    {
        ev.stopPropagation();
        if (_statsExpanded)
            closeDetail();
        else
            openDetail();
    });
    return el;
}
