// TAH stats bar: the inline HP / heat / structure / pips display.

import { playUiSound } from './sound.js';
import { MODULE_ID } from '../tools/constants.js';
import { combatantFor } from './action-tape.js';
import { corePowerState, corePowerDisplay, isDangerZoneHeat, shortOverchargeTerm } from '../utils/lancer-token.js';
import { REPAIR_COLOR_CSS, haseValueColor, overchargeColor, mixColor, cssHex, hpColorCss, heatColorCss, dangerHeatColorCss, pilotStressColorCss } from '../tools/color-utils.js';
import { ensureHaseChipStyle, statPipsHtml } from '../tools/hase-chip.js';
import { reactionCounts } from '../combat/action-extras.js';

/** Whether the secondary stats panel is expanded. Persists across in-place updates. */
let _statsExpanded = false;
let _statsOpenTimer = null;

/** Collapse the stats detail panel (call when the HUD closes). */
export function resetStatsExpanded()
{
    clearTimeout(_statsOpenTimer);
    _statsExpanded = false;
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
    ensureHaseChipStyle();
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
    const pilotStressColor = pilotStressColorCss(pilotStressVal, pilotStressMax);
    const hp          = sys.hp     ?? { value: 0, max: 0 };
    const heat        = sys.heat   ?? { value: 0, max: 0 };
    const overshield  = sys.overshield?.value ?? 0;
    const hasRepairs  = sys.repairs != null;
    const repairs     = sys.repairs?.value ?? 0;
    const repairsMax  = sys.repairs?.max ?? 0;
    const burn        = sys.burn ?? 0;
    const infection   = sys.infection ?? 0;
    const oc          = sys.overcharge ?? 0;
    const reactions   = reactionCounts(actor);

    const hpColor = hpColorCss(hp.value, hp.max);
    const heatColor = heatColorCss(heat.value, heat.max);

    const hasOvercharge = !!sys.overcharge_sequence;
    const ocSeq    = hasOvercharge ? sys.overcharge_sequence.split(',').map(/** @type {(s:string)=>string} */ s => s.trim()) : [];
    const ocLabel  = hasOvercharge ? shortOverchargeTerm(ocSeq[Math.min(oc, ocSeq.length - 1)] ?? '') : null;
    const ocMax    = ocSeq.length - 1;
    const ocColor  = !hasOvercharge ? '#555' : ocMax > 0 ? cssHex(overchargeColor(oc, ocMax)) : '#eb4034';
    const SEP = `<span class="la-stats-sep">│</span>`;
    const EMPTY = '<span></span>';
    const glyph = (/** @type {string} */ cls) => `<i class="${cls}"></i>`;
    const cell = (/** @type {string} */ title, /** @type {string} */ color, /** @type {string} */ glyphHtml, /** @type {string|number} */ value, { extra = '', ghost = '' } = {}) =>
    {
        const val = `<span class="la-stats-val">${value}</span>`;
        const slot = ghost ? `<span class="la-stats-slot" data-ghost="${ghost}">${val}</span>` : val;
        return `<span class="la-stats-cell${extra ? ` ${extra}` : ''}" title="${title}" style="color:${color};"><span class="la-stats-glyph">${glyphHtml}</span>${slot}</span>`;
    };
    const group = (/** @type {string} */ inner) => `<span class="la-stats-group">${inner}</span>`;
    const overshieldHtml = overshield > 0 ? `${SEP}${cell('Overshield', '#60a5fa', glyph('mdi mdi-hexagon-multiple-outline'), overshield)}` : '';
    const heatCell = () =>
    {
        const text = `${heat.value}/${heat.max}`;
        const ghost = `${heat.max}/${heat.max}`;
        if (!isDangerZoneHeat(heat.value, heat.max))
            return cell('Heat', heatColor, glyph('cci cci-heat'), text, { extra: 'la-stats-heat', ghost });
        if (heat.value >= heat.max)
            return cell('Heat', '#ff5a4e', glyph('cci cci-status-danger-zone'), text, { extra: 'la-stats-heat la-stats-critical', ghost });
        return cell('Heat', dangerHeatColorCss(heat.value, heat.max), glyph('cci cci-status-danger-zone'), text, { extra: 'la-stats-heat la-stats-heat--danger', ghost });
    };

    // Movement display
    const inCombat = !!combatantFor(token);
    const movGlyph = glyph('mdi mdi-arrow-right-bold-hexagon-outline');
    let movCell;
    if (inCombat && token)
    {
        const api = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
        const mh = api?.getMovementHistory?.(token);
        const regularCost = mh?.intentional?.regularCost ?? 0;
        const cap = api?.getMovementCap?.(token);
        let movColor;
        if (cap <= 0)
            movColor = '#aaa';
        else if (regularCost <= cap)
            movColor = cssHex(mixColor(0x4caf50, 0xffeb3b, regularCost / cap));   // green→yellow
        else
            movColor = cssHex(mixColor(0xffeb3b, 0xf44336, (regularCost - cap) / cap));   // yellow→red
        movCell = cell('Movement used / cap', movColor, movGlyph, `${regularCost}/${cap}`, { extra: 'la-stats-move', ghost: `${cap}/${cap}` });
    }
    else
        movCell = cell('Speed', '#aaa', movGlyph, sys.speed ?? 0, { extra: 'la-stats-move' });

    // Secondary stats row
    const armor       = sys.armor ?? 0;
    const evasion     = sys.evasion ?? 0;
    const edef        = sys.edef ?? 0;
    const techAttack  = sys.tech_attack ?? 0;
    const save        = sys.save ?? 0;
    const sensorRange = sys.sensor_range ?? 0;
    const core        = corePowerState(actor);
    const coreShown   = corePowerDisplay(core);
    const S_STAT = 'font-size:0.95em;';
    const S_ICON = 'width:1.3em;height:1.3em;vertical-align:middle;background:none;border:none;';
    const statIcon = (/** @type {string} */ src, /** @type {string} */ title) => `<img src="${src}" title="${title}" style="${S_ICON}">`;
    const statCell = (/** @type {string} */ iconSrc, /** @type {string} */ title, /** @type {string} */ valueHtml) =>
        `<span style="display:inline-flex;align-items:center;gap:3px;white-space:nowrap;">${statIcon(iconSrc, title)}${valueHtml}</span>`;
    const coreCell = core.hasCore
        ? `<span title="Core Power" style="display:inline-flex;align-items:center;gap:2px;color:${coreShown.color};">${statIcon('systems/lancer/assets/icons/white/corepower.svg', 'Core Power')}${coreShown.label}</span>`
        : '';

    const haseCell = (/** @type {string} */ letter, /** @type {string} */ title, /** @type {number|null|undefined} */ value, chipClass = '') =>
        `<span title="${title}" style="white-space:nowrap;display:inline-flex;align-items:center;gap:4px;"><i class="la-hase-chip${chipClass}">${letter}</i><span style="color:${haseValueColor(value ?? 0)};">${(value ?? 0) >= 0 ? '+' : ''}${value ?? 0}</span></span>`;
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
        topRow.push(hasStructure ? statPipsHtml('cci-structure', strVal, strMax, '#e8d060') : EMPTY, hasStructure ? SEP : EMPTY);
        bottomRow.push(hasStress ? statPipsHtml('cci-reactor', stressVal, stressMax, '#e07830') : EMPTY, hasStress ? SEP : EMPTY);
    }
    const hpCritical = hp.max > 0 && hp.value * 10 <= hp.max;
    topRow.push(group(`${cell('HP', hpColor, glyph('mdi mdi-heart'), `${hp.value}/${hp.max}`, { extra: hpCritical ? 'la-stats-critical' : '', ghost: `${hp.max}/${hp.max}` })}${overshieldHtml}`));
    bottomRow.push(hasHeat
        ? heatCell()
        : (hasPilotStress ? cell('Stress', pilotStressColor, glyph('mdi mdi-brain'), `${pilotStressVal}/${pilotStressMax}`) : EMPTY));
    const topExtras = [];
    if (hasRepairs)
        topExtras.push(cell('Repairs', repairs > 0 ? REPAIR_COLOR_CSS : '#aaa', glyph('cci cci-repair'), repairsMax > 0 ? `${repairs}/${repairsMax}` : repairs, repairsMax > 0 ? { ghost: `${repairsMax}/${repairsMax}` } : {}));
    const bottomExtras = [];
    if (hasBondXp)
        bottomExtras.push(cell('Bond XP', bondXpVal > 0 ? '#00b8d4' : '#888', glyph('mdi mdi-head-cog-outline'), `${bondXpVal}/${bondXpMax}`));
    if (hasOvercharge)
        bottomExtras.push(cell('Overcharge', ocColor, glyph('cci cci-overcharge'), ocLabel));
    while (topExtras.length < bottomExtras.length)
        topExtras.push(null);
    while (bottomExtras.length < topExtras.length)
        bottomExtras.push(null);
    topExtras.forEach((topCell, index) =>
    {
        topRow.push(topCell ? SEP : EMPTY, topCell ?? EMPTY);
        bottomRow.push(bottomExtras[index] ? SEP : EMPTY, bottomExtras[index] ?? EMPTY);
    });
    topRow.push(SEP, movCell);
    bottomRow.push(SEP, cell('Reaction', reactions.left ? '#a855f7' : '#aaa', glyph('cci cci-reaction'), reactions.text, { extra: 'la-stats-reaction', ghost: reactions.total > 1 ? `${reactions.total}/${reactions.total}` : '' }));
    if (burn > 0 || infection > 0)
    {
        topRow.push(burn > 0 ? SEP : EMPTY, burn > 0 ? cell('Burn', '#d74242', glyph('cci cci-burn'), burn) : EMPTY);
        bottomRow.push(infection > 0 ? SEP : EMPTY, infection > 0 ? cell('Infection', '#1a8a3a', glyph('mdi mdi-biohazard'), infection) : EMPTY);
    }

    return `<div id="la-hud-stats">` +
        `<div class="la-stats-grid" style="grid-template-columns:repeat(${topRow.length},auto);">` +
        `${topRow.join('')}${bottomRow.join('')}` +
        `</div>` +
        `<div class="la-stats-toggle" title="Toggle Stats">` +
        `<span>${arrow}</span>` +
        `</div>` +
        `<div class="la-stats-detail" style="${expanded};padding:0 8px 0 6px;justify-content:center;align-items:stretch;">` +
        `<div style="display:grid;grid-template-columns:repeat(${core.hasCore ? 4 : 3},auto);column-gap:10px;row-gap:2px;align-items:center;justify-items:start;align-self:center;${S_STAT}">` +
        `${statCell('systems/lancer/assets/icons/white/shield_outline.svg', 'Armor', `<span title="Armor" style="color:#aaa;">${armor}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/evasion.svg', 'Evasion', `<span title="Evasion" style="color:#aaa;">${evasion}</span>`)}` +
        `${statCell('systems/lancer/assets/icons/white/edef.svg', 'E-Defense', `<span title="E-Defense" style="color:#aaa;">${edef}</span>`)}` +
        `${core.hasCore ? (sys.grit != null
            ? haseCell('G', 'Grit', sys.grit, ' la-grit')
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
    clearTimeout(_statsOpenTimer);
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
        playUiSound('details');
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
        clearTimeout(_statsOpenTimer);
        _statsOpenTimer = setTimeout(openDetail, 250);
    });
    el.on('mouseleave', () =>
    {
        clearTimeout(_statsOpenTimer);
        closeDetail();
    });
    toggle.on('click', (ev) =>
    {
        ev.stopPropagation();
        clearTimeout(_statsOpenTimer);
        if (_statsExpanded)
            closeDetail();
        else
            openDetail();
    });
    return el;
}
