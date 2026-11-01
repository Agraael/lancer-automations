import { getLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { isExecutorGM } from "../tools/misc-tools.js";
import { v3ConditionMet, evaluateV3Expression } from "../tools/v3-condition.js";
import { linkTierGate } from "../interactive/deployables.js";
import { CURRENT_RESOURCE_STATS, getV3DataBonuses, withoutSwitchedOff } from "./genericBonuses.js";

// Constant and token stat bonuses are resolved once per stat in derived data, with the spec's replace and overwrite rules.
// Current resources are excluded: rewriting them each prepare would undo damage.
const STAT_MODES = new Set(['add', 'replace', 'replace_base', 'overwrite']);
const STAT_TIER_VALUE = /^[^/]+\/[^/]+\/[^/]+$/;

function statBonusValue(bonus, actor)
{
    let value = bonus.val;
    if (Array.isArray(value) || (typeof value === 'string' && STAT_TIER_VALUE.test(value.trim())))
    {
        const tiers = Array.isArray(value) ? value : value.split('/');
        const tier = actor?.type === 'npc' ? (Number(actor.system?.tier) || 1) : 1;
        value = tiers[Math.min(tiers.length, Math.max(1, tier)) - 1];
    }
    return evaluateV3Expression(typeof value === 'number' ? value : String(value ?? ''), actor);
}

export function resolveStatValue(base, entries)
{
    const valuesOf = (/** @type {string} */ mode) => entries.filter((/** @type {any} */ entry) => entry.mode === mode).map((/** @type {any} */ entry) => entry.value);
    const finals = valuesOf('replace');
    if (finals.length)
        return Math.max(...finals);
    const bases = valuesOf('replace_base');
    const start = bases.length ? bases.reduce((sum, value) => sum + value, 0) : base;
    const overwrites = valuesOf('overwrite');
    if (overwrites.length)
        return start + Math.max(...overwrites);
    return start + valuesOf('add').reduce((sum, value) => sum + value, 0);
}

function linkedEffectActive(actor, bonusId)
{
    for (const effect of actor.allApplicableEffects?.() ?? [])
    {
        if (getLAFlag(effect, 'linkedBonusId') === bonusId)
            return effect.active;
    }
    return false;
}

function resolvedStatBonuses(actor)
{
    const flags = getLAFlags(actor);
    const globals = withoutSwitchedOff(actor, flags?.global_bonuses ?? []).filter((/** @type {any} */ bonus) => bonus?.type === 'stat' && linkedEffectActive(actor, bonus.id));
    return [...withoutSwitchedOff(actor, flags?.constant_bonuses ?? []), ...globals, ...getV3DataBonuses(actor, ['stat']).map(row => row.bonus)]
        .filter((/** @type {any} */ bonus) => bonus?.type === 'stat' && bonus.stat && !CURRENT_RESOURCE_STATS.has(bonus.stat)
            && linkTierGate(bonus, actor) && (!bonus.dataCondition || v3ConditionMet(bonus.dataCondition, actor)));
}

function isResolvedStatChange(effect, actor, change)
{
    const bonusId = getLAFlag(effect, 'linkedBonusId');
    if (!bonusId || CURRENT_RESOURCE_STATS.has(change?.key))
        return false;
    const bonus = (getLAFlag(actor, 'global_bonuses') || []).find((/** @type {any} */ entry) => entry?.id === bonusId);
    return bonus?.type === 'stat' && bonus.stat === change.key;
}

const _combatantActivations = new Map();

function ownerActor(document)
{
    let current = document;
    while (current && current.documentName !== 'Actor')
        current = current.parent;
    return current ?? null;
}

function syncCombatantActivations(actor)
{
    if (!actor || !isExecutorGM())
        return;
    for (const combat of game.combats ?? [])
    {
        if (!combat.started)
            continue;
        for (const combatant of /** @type {any} */ (combat).combatants)
        {
            if (combatant.actor?.uuid !== actor.uuid || combatant._source?.system?.activations?.max != null)
                continue;
            const previous = _combatantActivations.get(combatant.uuid) ?? Number(combatant.system?.activations?.max);
            combatant.reset();
            const max = Number(combatant.system?.activations?.max) || 0;
            _combatantActivations.set(combatant.uuid, max);
            const value = Number(combatant.system?.activations?.value) || 0;
            const next = Math.min(max, Math.max(0, value + max - (Number.isFinite(previous) ? previous : max)));
            if (next !== value)
                combatant.update({ 'system.activations.value': next });
            else if (max !== previous)
                ui.combat?.render?.();
        }
    }
}

export function initConstantStatHooks()
{
    if (typeof libWrapper === 'undefined')
        return;
    for (const hook of ['updateActor', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect', 'createItem', 'updateItem', 'deleteItem'])
        Hooks.on(/** @type {any} */ (hook), (/** @type {any} */ document) => syncCombatantActivations(ownerActor(document)));
    libWrapper.register(MODULE_ID, 'CONFIG.ActiveEffect.documentClass.prototype.apply',
        function (wrapped, actor, change)
        {
            if (isResolvedStatChange(this, actor, change))
                return {};
            return wrapped(actor, change);
        }, 'MIXED');
    libWrapper.register(MODULE_ID,'CONFIG.Actor.documentClass.prototype.prepareDerivedData',
        function (wrapped)
        {
            wrapped();
            const bonuses = resolvedStatBonuses(this);
            if (!bonuses.length)
                return;
            const byStat = new Map();
            for (const bonus of bonuses)
            {
                const entries = byStat.get(bonus.stat) ?? [];
                entries.push({ mode: STAT_MODES.has(bonus.statMode) ? bonus.statMode : 'add', value: statBonusValue(bonus, this) });
                byStat.set(bonus.stat, entries);
            }
            for (const [stat, entries] of byStat)
                foundry.utils.setProperty(this, stat, resolveStatValue(Number(foundry.utils.getProperty(this, stat)) || 0, entries));
        }, 'WRAPPER');
}
