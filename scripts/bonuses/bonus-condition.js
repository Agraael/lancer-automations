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
export function getBonusConditionLines(bonus)
{
    const lines = [];
    const collect = (entry, prefix) =>
    {
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
    const linkedBonusId = getLAFlags(effect)?.linkedBonusId;
    if (!linkedBonusId || !actor)
        return [];
    const bonus = (getLAFlag(actor, 'global_bonuses') || []).find(entry => entry.id === linkedBonusId);
    return bonus ? getBonusConditionLines(bonus) : [];
}
