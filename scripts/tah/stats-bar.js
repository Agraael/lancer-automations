/**
 * TAH Stats Bar
 * Pure function — no class coupling, no jQuery dependencies.
 * Generates the inline HTML for the HP / heat / structure / pips display.
 */

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
    const strVal    = sys.structure?.value ?? 4;
    const strMax    = sys.structure?.max  ?? 4;
    const stressVal = sys.stress?.value   ?? 4;
    const stressMax = sys.stress?.max     ?? 4;
    const hp          = sys.hp     ?? { value: 0, max: 0 };
    const heat        = sys.heat   ?? { value: 0, max: 0 };
    const overshield  = sys.overshield?.value ?? 0;
    const repairs     = sys.repairs?.value ?? 0;
    const burn        = sys.burn ?? 0;
    const oc          = sys.overcharge ?? 0;
    const reaction    = sys.action_tracker?.reaction ?? false;

    const hpRatio    = hp.max > 0 ? hp.value / hp.max : 1;
    const heatRatio  = heat.max > 0 ? heat.value / heat.max : 0;
    const hpColor    = lerpColor(244, 67, 54,  76, 175, 80,  hpRatio);   // red→green
    const heatColor  = lerpColor(136, 136, 136, 244, 67, 54, heatRatio); // grey→red

    const strPips    = Array.from({ length: strMax },    (_, i) => `<span style="color:${i >= strMax    - strVal    ? '#e8d060' : '#3a3a3a'};">◆</span>`).join('');
    const stressPips = Array.from({ length: stressMax }, (_, i) => `<span style="color:${i >= stressMax - stressVal ? '#e07830' : '#3a3a3a'};">●</span>`).join('');

    const ocLabels = ['—', '1d3', '1d6', '1d6+4'];
    const ocColor    = oc > 0 ? '#f88040' : '#555';
    const SEP = `<span style="color:#444;">│</span>`;
    const repairImg   = `<img src="systems/lancer/assets/icons/white/repair.svg" title="Repairs" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${repairs > 0 ? 1 : 0.3};">`;
    const reactionNum = `<span title="Reaction" style="color:${reaction ? '#a855f7' : '#aaa'};font-weight:bold;">${reaction ? '1' : '0'}</span>`;
    const reactionImg = `<img src="systems/lancer/assets/icons/white/reaction.svg" title="Reaction" style="width:1.47em;height:1.47em;vertical-align:middle;background:none;border:none;opacity:${reaction ? 1 : 0.3};">`;
    const overshieldHtml = overshield > 0 ? `${SEP}<span title="Overshield" style="color:#60a5fa;">${overshield}🛡</span>` : '';

    // Movement display
    const tokenId = token?.document?.id ?? token?.id ?? null;
    const inCombat = !!game.combat?.active &&
        !!(/** @type {any} */ (game.combat)?.combatants?.find((/** @type {{ tokenId: string }} */ c) => c.tokenId === tokenId));
    const movIcon = `<i class="mdi mdi-arrow-right-bold-hexagon-outline" title="Movement" style="font-size:1.12em;color:#fff;line-height:0;transform:translateY(1px);display:inline-block;"></i>`;
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
        movHtml = `${SEP}${movIcon}<span title="Movement" style="color:#aaa;">∞</span>`;
    }

    return `<div id="la-hud-stats" style="background:#111;border-bottom:2px solid var(--primary-color);padding:2px 8px 2px;font-size:0.97em;color:#888;width:max-content;">` +
        `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;">` +
        `${strPips}${SEP}<span title="HP" style="color:${hpColor};">${hp.value}/${hp.max} ♥</span>${overshieldHtml}${SEP}${repairImg}<span style="color:${repairs > 0 ? '#66cc66' : '#aaa'};">${repairs}</span>${movHtml}` +
        `</div>` +
        `<div style="display:flex;align-items:center;gap:3px;white-space:nowrap;margin-top:2px;">` +
        `${stressPips}${SEP}<span title="Heat" style="color:${heatColor};">${heat.value}/${heat.max}🌡</span>${burn > 0 ? `${SEP}<span title="Burn" style="color:#ff6600;">🔥${burn}</span>` : ''}${SEP}<span title="Overcharge" style="color:${ocColor};">⚡${ocLabels[Math.min(oc, 3)]}</span>${SEP}${reactionImg}${reactionNum}` +
        `</div>` +
        `</div>`;
}
