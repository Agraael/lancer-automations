// Which bonuses carry a runtime gate. Leaf module so the token effect painter can use it too.
import { getLAFlag, getLAFlags } from '../tools/flag-utils.js';

const SUMMARY = 'Conditional: only applies while its condition passes.';

function lambdaSource(value)
{
    if (typeof value === 'function')
        return value.toString();
    if (typeof value !== 'string')
        return '';
    return (value.startsWith('@@fn:') ? value.slice('@@fn:'.length) : value).trim();
}

/**
 * One line per gate: own condition, per-target condition, then multi sub-bonus gates.
 * @param {object} bonus
 * @returns {string[]} Empty when the bonus always applies
 */
const FREQUENCY_LABELS = { round: 'Once per round', turn: 'Once per turn', combat: 'Once per combat' };

export function getBonusConditionLines(bonus)
{
    const lines = [];
    const collect = (entry, prefix) =>
    {
        const frequency = FREQUENCY_LABELS[entry?.frequency];
        if (frequency)
            lines.push(`${prefix}${frequency}`);
        const own = lambdaSource(entry?.condition);
        if (own)
            lines.push(`${prefix}Condition: ${own}`);
        const perTarget = lambdaSource(entry?.applyToCondition);
        if (perTarget)
            lines.push(`${prefix}Per target: ${perTarget}`);
    };
    collect(bonus, '');
    if (bonus?.type === 'multi' && Array.isArray(bonus.bonuses))
        bonus.bonuses.forEach((sub, idx) => collect(sub, `#${idx + 1} `));
    return lines;
}

/**
 * The frequency gate as a label, for display next to the opaque lambda gates.
 * @param {object} bonus
 * @returns {string} Empty when the bonus has no frequency
 */
export function getBonusFrequencyLabel(bonus)
{
    return FREQUENCY_LABELS[bonus?.frequency] ?? '';
}

/**
 * True when a gate can only be shown as source, so a generic "Conditional" badge is warranted.
 * @param {object} bonus
 * @returns {boolean}
 */
export function hasLambdaGate(bonus)
{
    const gated = (/** @type {any} */ entry) => !!lambdaSource(entry?.condition) || !!lambdaSource(entry?.applyToCondition);
    if (gated(bonus))
        return true;
    return bonus?.type === 'multi' && Array.isArray(bonus.bonuses) && bonus.bonuses.some(gated);
}

/**
 * Title text for a gated bonus.
 * @param {object} bonus
 * @returns {string} Empty when the bonus always applies
 */
export function getBonusConditionHint(bonus)
{
    const lines = getBonusConditionLines(bonus);
    return lines.length ? `${SUMMARY}\n${lines.join('\n')}` : '';
}

/**
 * Gate lines of the global bonus an effect is linked to.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {string[]} Empty when unlinked or unconditional
 */
export function linkedBonusConditionLines(actor, effect)
{
    const bonus = linkedBonus(actor, effect);
    return bonus ? getBonusConditionLines(bonus) : [];
}

function linkedBonus(/** @type {any} */ actor, /** @type {any} */ effect)
{
    const linkedBonusId = getLAFlags(effect)?.linkedBonusId;
    if (!linkedBonusId || !actor)
        return null;
    return (getLAFlag(actor, 'global_bonuses') || []).find((/** @type {any} */ entry) => entry.id === linkedBonusId) ?? null;
}

/**
 * Frequency label of the global bonus an effect is linked to.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {string} Empty when unlinked or unlimited
 */
export function linkedBonusFrequencyLabel(actor, effect)
{
    return getBonusFrequencyLabel(linkedBonus(actor, effect));
}

/**
 * True when the linked bonus carries a lambda gate.
 * @param {Actor} actor
 * @param {ActiveEffect} effect
 * @returns {boolean}
 */
export function linkedBonusHasLambdaGate(actor, effect)
{
    return hasLambdaGate(linkedBonus(actor, effect));
}
