/**
 * TAH Stats Bar
 * Pure function — no class coupling, no jQuery dependencies.
 * Generates the inline HTML for the HP / heat / structure / pips display.
 */

/** Whether the secondary stats panel is expanded. Persists across in-place updates. */
let _statsExpanded = false;

/** Collapse the stats detail panel (call when the HUD closes). */
export function resetStatsExpanded() { _statsExpanded = false; }

/** Linear interpolation between two RGB colours. t=0→colour1, t=1→colour2. */
function lerpColor(r1, g1, b1, r2, g2, b2, t) {
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r},${g},${b})`;
}

/**
 * Build the stats-bar HTML for the given actor.
 * Returns a raw HTML string — wrap in `$(...)` to get a jQuery element.
 * @param {any} actor
 * @param {any} [token]
 * @returns {string}
 */
export function buildStatsHtml(actor, token = null) {
    const sys = actor.system;
    const strVal    = sys.structure?.value ?? 0;
    const strMax    = sys.structure?.max  ?? 0;
    const stressVal = sys.stress?.value   ?? 0;
    const stressMax = sys.stress?.max     ?? 0;
    const hasStructure = strMax > 0;
    const hasStress    = stressMax > 0;
    const hasHeat      = (sys.heat?.max ?? 0) > 0;
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
    // HP: red → yellow → green (two-stop, avoids brown midpoint)
    const hpColor = hpRatio < 0.5
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
    const repairImg   = `<img src="systems/lancer/assets/icons/white/repair.svg" title="Repairs" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${repairs > 0 ? 1 : 0.3};">`;
    const reactionNum = `<span title="Reaction" style="color:${reaction ? '#a855f7' : '#aaa'};font-weight:bold;">${reaction ? '1' : '0'}</span>`;
    const reactionImg = `<img src="systems/lancer/assets/icons/white/reaction.svg" title="Reaction" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${reaction ? 1 : 0.3};">`;
    const overshieldHtml = overshield > 0 ? `${SEP}<span title="Overshield" style="color:#60a5fa;">${overshield}🛡</span>` : '';

    // Movement display
    const tokenId = token?.document?.id ?? token?.id ?? null;
    const inCombat = !!game.combat?.active &&
        !!(/** @type {any} */ (game.combat)?.combatants?.find((/** @type {{ tokenId: string }} */ c) => c.tokenId === tokenId));
    const movIcon = `<i class="mdi mdi-arrow-right-bold-hexagon-outline" title="Movement" style="font-size:1.12em;color:#fff;line-height:0;transform:translateY(2px);display:inline-block;"></i>`;
    let movHtml;
    if (inCombat && token) {
        const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
        const mh = api?.getMovementHistory?.(token);
        const regularCost = mh?.intentional?.regularCost ?? 0;
        const cap = api?.getMovementCap?.(token);
        let movColor;
        if (cap <= 0) {
            movColor = '#aaa';
        } else if (regularCost <= cap) {
            movColor = lerpColor(76, 175, 80, 255, 235, 59, regularCost / cap);   // green→yellow
        } else {
            movColor = lerpColor(255, 235, 59, 244, 67, 54, Math.min(1, (regularCost - cap) / cap));   // yellow→red
        }
        movHtml = `${SEP}${movIcon}<span title="Movement used / cap" style="color:${movColor};">${regularCost}/${cap}</span>`;
    } else {
        movHtml = `${SEP}${movIcon}<span title="Speed" style="color:#aaa;">${sys.speed ?? 0}</span>`;
    }

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
    const coreHtml = hasCoreSystem
        ? `${SEP}<span title="Core Power" style="color:${coreEnergy > 0 ? (coreActive ? '#a855f7' : '#3a9e6e') : '#555'};">${statIcon('systems/lancer/assets/icons/white/corepower.svg', 'Core Power')}${coreEnergy > 0 ? (coreActive ? 'ON' : '✓') : '✗'}</span>`
        : '';

    const expanded = _statsExpanded ? 'display:flex;flex-direction:column' : 'display:none';
    const arrow = _statsExpanded ? '◀' : '▶';

    return `<div id="la-hud-stats" style="background:#111;border-bottom:2px solid var(--primary-color);padding:2px 0 2px 8px;font-size:0.97em;color:#888;width:max-content;display:flex;align-items:stretch;position:relative;z-index:2;">` +
        `<div>` +
        `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;">` +
        `${hasStructure ? `${strPips}${SEP}` : ''}<span title="HP" style="color:${hpColor};">${hp.value}/${hp.max} ♥</span>${overshieldHtml}${hasRepairs ? `${SEP}${repairImg}<span style="color:${repairs > 0 ? '#66cc66' : '#aaa'};">${repairs}</span>` : ''}${movHtml}` +
        `</div>` +
        `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;margin-top:2px;">` +
        `${hasStress ? `${stressPips}${SEP}` : ''}${hasHeat ? `<span title="Heat" style="color:${heatColor};">${heat.value}/${heat.max}🌡</span>` : ''}${burn > 0 ? `${SEP}<span title="Burn" style="color:#d74242;"><i class="cci cci-burn" style="font-size:1.1em;vertical-align:middle;"></i>${burn}</span>` : ''}${infection > 0 ? `${SEP}<span title="Infection" style="color:#1a8a3a;">☣${infection}</span>` : ''}${hasOvercharge ? `${SEP}<span title="Overcharge" style="color:${ocColor};"><i class="cci cci-overcharge" style="font-size:1.1em;vertical-align:middle;"></i>${ocLabel}</span>` : ''}${SEP}${reactionImg}${reactionNum}` +
        `</div>` +
        `</div>` +
        `<div class="la-stats-toggle" title="Toggle Stats" style="cursor:pointer;user-select:none;width:10px;background:var(--primary-color);display:flex;align-items:center;justify-content:center;margin-left:6px;flex-shrink:0;">` +
        `<span style="font-size:0.55em;color:#111;font-weight:bold;line-height:1;">${arrow}</span>` +
        `</div>` +
        `<div class="la-stats-detail" style="${expanded};padding:0 8px 0 6px;justify-content:center;">` +
        `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;${S_STAT}">` +
        `${statIcon('systems/lancer/assets/icons/white/shield_outline.svg', 'Armor')}<span title="Armor" style="color:#aaa;">${armor}</span>` +
        `${SEP}${statIcon('systems/lancer/assets/icons/white/evasion.svg', 'Evasion')}<span title="Evasion" style="color:#aaa;">${evasion}</span>` +
        `${SEP}${statIcon('systems/lancer/assets/icons/white/edef.svg', 'E-Defense')}<span title="E-Defense" style="color:#aaa;">${edef}</span>` +
        `</div>` +
        `<div style="display:flex;align-items:center;gap:4px;white-space:nowrap;margin-top:2px;${S_STAT}">` +
        `${statIcon('systems/lancer/assets/icons/white/tech_quick.svg', 'Tech Attack')}<span title="Tech Attack" style="color:#aaa;">${techAttack >= 0 ? '+' : ''}${techAttack}</span>` +
        `${SEP}${statIcon('systems/lancer/assets/icons/white/save.svg', 'Save')}<span title="Save" style="color:#aaa;">${save}</span>` +
        `${SEP}${statIcon('systems/lancer/assets/icons/white/sensor.svg', 'Sensors')}<span title="Sensors" style="color:#aaa;">${sensorRange}</span>` +
        `${coreHtml}` +
        `</div>` +
        `</div>` +
        `</div>`;
}

/**
 * Build the stats bar as a jQuery element with toggle wired up.
 * @param {any} actor
 * @param {any} [token]
 * @returns {JQuery}
 */
export function buildStatsEl(actor, token = null) {
    const el = $(buildStatsHtml(actor, token));
    const detail = el.find('.la-stats-detail');
    const toggle = el.find('.la-stats-toggle');
    // Set initial width for animation
    if (_statsExpanded) {
        detail.css({ display: 'flex', 'flex-direction': 'column', overflow: 'hidden' });
    } else {
        detail.css({ display: 'none', overflow: 'hidden' });
    }
    const openDetail = () => {
        if (_statsExpanded) return;
        _statsExpanded = true;
        detail.stop(true).css({ display: 'flex', 'flex-direction': 'column', width: 0, opacity: 0 })
            .animate({ width: detail.prop('scrollWidth'), opacity: 1 }, 150, function () {
                $(this).css('width', '');
            });
        toggle.find('span').text('◀');
    };
    const closeDetail = () => {
        if (!_statsExpanded) return;
        _statsExpanded = false;
        detail.stop(true).animate({ width: 0, opacity: 0 }, 120, function () {
            $(this).css({ display: 'none', width: '', opacity: '' });
        });
        toggle.find('span').text('▶');
    };
    el.on('mouseenter', openDetail);
    el.on('mouseleave', closeDetail);
    toggle.on('click', (ev) => {
        ev.stopPropagation();
        if (_statsExpanded) closeDetail();
        else openDetail();
    });
    return el;
}
