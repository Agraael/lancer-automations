import { getLAFlag } from '../tools/flag-utils.js';
import { applyDamageImmunities, checkDamageResistances, checkDamageVulnerabilities } from './genericBonuses.js';

export const VARIABLE = 'Variable';
export const VARIABLE_PICKS = ['Kinetic', 'Energy', 'Explosive'];
export const VARIABLE_TYPE_FLAG = 'variableDamageType';

export function storedVariableType(item)
{
    const stored = getLAFlag(item, VARIABLE_TYPE_FLAG);
    return VARIABLE_PICKS.includes(stored) ? stored : null;
}

export function variableHudPick(state)
{
    return state?.la_extraData?._laVariable?.shown ?? null;
}

export function variableTypeFactor(actor, type)
{
    if (!actor)
        return 1;
    if (applyDamageImmunities(actor, [{ type, val: 1 }])?.[0]?.val === 0)
        return 0;

    const lower = type.toLowerCase();
    const resisted = !actor.system?.statuses?.shredded && (!!actor.system?.resistances?.[lower] || checkDamageResistances(actor, lower).length > 0);
    const vulnerable = checkDamageVulnerabilities(actor, lower).length > 0;
    return (resisted ? 0.5 : 1) * (vulnerable ? 2 : 1);
}

export function bestVariableType(actors)
{
    let best = VARIABLE_PICKS[0];
    let bestScore = -1;

    for (const type of VARIABLE_PICKS)
    {
        const score = actors.reduce((sum, actor) => sum + variableTypeFactor(actor, type), 0);
        if (score > bestScore + 1e-9)
        {
            best = type;
            bestScore = score;
        }
    }

    return best;
}

export function resolveLeftoverVariable(actor, damage)
{
    const amount = Number(damage?.[VARIABLE]) || 0;
    if (amount <= 0)
        return;

    const type = bestVariableType([actor]);
    damage[type] = (Number(damage[type]) || 0) + amount;
    damage[VARIABLE] = 0;
}
