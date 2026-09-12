// Shared status tooltip. The canvas icon hover and the status wheel render the same markup so an
// effect reads identically wherever it is hovered.
import { getGlobalBonuses, getBonusDetailString, getBonusUsesInfo } from './genericBonuses.js';
import { linkedBonusConditionLines } from './bonus-condition.js';
import { getLAFlags } from '../tools/flag-utils.js';

/**
 * @typedef {Object} StatusTooltipData
 * @property {string} name
 * @property {number} [count]
 * @property {string} [duration]
 * @property {string} [bonus]
 * @property {string[]} [conditional] - Gate lines of the linked bonus, non-empty means gated.
 * @property {string} [description] - Trusted HTML, comes from effect/status config.
 */

/** Shortest turn-based entry, null when the effect has none. */
function bestTurnEntry(effect)
{
    const flags = getLAFlags(effect);
    const entries = [flags?.duration, ...(flags?.durationEntries ?? [])].filter(Boolean);
    let best = null;
    for (const entry of entries)
    {
        if ((entry.label === 'end' || entry.label === 'start') && Number(entry.turns) > 0)
        {
            if (!best || Number(entry.turns) < best.turns)
                best = { label: entry.label, turns: Number(entry.turns) };
        }
    }
    return best;
}

/** Turns left, 0 when the effect has no turn-based duration. Same value the gold token badge draws. */
export function remainingTurns(effect)
{
    return bestTurnEntry(effect)?.turns ?? 0;
}

/**
 * Same value the cyan token badge draws: stacked total where statuscounter is in play,
 * otherwise how many effects share the name.
 */
export function instanceCount(actor, effect)
{
    const name = effect?.name;
    if (!actor || !name)
        return 0;
    const matches = [...actor.effects].filter(entry => !entry.disabled && entry.name === name);
    if (game.modules.get('statuscounter')?.active)
        return matches.reduce((sum, entry) => sum + (entry.getFlag?.('statuscounter', 'value') ?? 1), 0);
    return matches.length;
}

/** Shortest turn-based entry wins, otherwise the first entry decides the wording. */
export function durationText(effect)
{
    const flags = getLAFlags(effect);
    const entries = [flags?.duration, ...(flags?.durationEntries ?? [])].filter(Boolean);
    const best = bestTurnEntry(effect);
    if (best)
        return `${best.turns} turn${best.turns > 1 ? 's' : ''} (${best.label} of turn)`;
    const first = entries[0];
    if (first?.label === 'permanent')
        return 'Permanent';
    if (first?.label === 'indefinite')
        return 'Indefinite';
    if (first?.label === 'round')
    {
        const rounds = Number(first.rounds ?? first.turns);
        if (rounds > 0)
            return `${rounds} round${rounds > 1 ? 's' : ''}`;
    }
    return '';
}

/** Detail line for the global bonus an effect is linked to, empty when it is not linked to one. */
export function linkedBonusText(actor, effect)
{
    const linkedBonusId = getLAFlags(effect)?.linkedBonusId;
    if (!linkedBonusId || !actor)
        return '';
    const bonus = getGlobalBonuses(actor).find(entry => entry.id === linkedBonusId);
    return bonus ? bonusText(bonus, actor) : '';
}

/** Detail line for a bonus object, with its uses when it has a count. */
export function bonusText(bonus, actor = null)
{
    if (!bonus)
        return '';
    const detail = bonus.type === 'multi' && Array.isArray(bonus.bonuses)
        ? bonus.bonuses.map(getBonusDetailString).join(' | ')
        : getBonusDetailString(bonus);
    const uses = getBonusUsesInfo(actor, bonus);
    if (!uses)
        return detail;
    return `${detail} [${uses.label}]${uses.onUse ? ' [on-use]' : ''}`;
}

/** Effect description, falling back to the status config it carries. */
export function descriptionHtml(effect)
{
    if (effect?.description)
        return effect.description;
    for (const id of effect?.statuses ?? [])
    {
        const config = CONFIG.statusEffects.find(entry => entry.id === id);
        if (config?.description)
            return game.i18n.localize(config.description);
    }
    return '';
}

/**
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {StatusTooltipData}
 */
export function effectTooltipData(actor, effect)
{
    return {
        name: effect?.name ?? '',
        count: instanceCount(actor, effect),
        duration: durationText(effect),
        bonus: linkedBonusText(actor, effect),
        conditional: linkedBonusConditionLines(actor, effect),
        description: descriptionHtml(effect)
    };
}

/**
 * Appends the tooltip to the body. Caller owns removal.
 * @param {StatusTooltipData} data
 * @returns {HTMLElement}
 */
export function showStatusTooltip(data)
{
    const el = document.createElement('div');
    el.classList.add('la-status-tooltip');
    const count = data.count > 1 ? ` <span class="la-status-tooltip-count">&times;${data.count}</span>` : '';
    const parts = [`<div class="la-status-tooltip-name">${data.name ?? ''}${count}</div>`];
    if (data.duration)
        parts.push(`<div class="la-status-tooltip-duration">${data.duration}</div>`);
    if (data.bonus)
        parts.push(`<div class="la-status-tooltip-bonus">${data.bonus}</div>`);
    if (data.conditional?.length)
        parts.push('<div class="la-status-tooltip-cond"><i class="fas fa-code-branch"></i> Conditional</div>');
    if (data.description)
        parts.push(`<div class="la-status-tooltip-desc">${data.description}</div>`);
    el.innerHTML = parts.join('');
    document.body.appendChild(el);
    return el;
}

/** Places the tooltip below-right of the point, flipping when it would leave the viewport. */
export function moveStatusTooltip(el, clientX, clientY, gap = 14)
{
    if (!el)
        return;
    const rect = el.getBoundingClientRect();
    let left = clientX + gap;
    let top = clientY + gap;
    if (left + rect.width > window.innerWidth - 4)
        left = clientX - rect.width - gap;
    if (top + rect.height > window.innerHeight - 4)
        top = clientY - rect.height - gap;
    el.style.left = `${Math.max(4, left)}px`;
    el.style.top = `${Math.max(4, top)}px`;
}
