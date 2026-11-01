import { applyEffectsToTokens } from "./flagged-effects.js";
import { normalizeDuration, ANY_TURN_LABELS } from "./duration-clock.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { getLAFlag, setLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { executeEffectManager } from "./effectManager.js";
import { stringToAsyncFunction } from "../activations/reaction-manager.js";
import { weaponClass, getWeaponType, checkGate, consumeGate, isItemAvailable, isExecutorGM } from "../tools/misc-tools.js";
import { v3ActorRows, v3BonusDurationOptions, isV3DataReplaced } from "../tools/v3-data.js";
import { v3ConditionMet } from "../tools/v3-condition.js";
import { isItemCascading } from "../setup/lancer-modif.js";
import { playBonusAddedFX } from "../fx/actionFX.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { linkTierGate } from "../interactive/deployables.js";
import { localizeFormat } from "../tools/string-utils.js";
import { EXTRA_ACTION_KINDS, setActionExtrasProvider } from "../combat/action-extras.js";
export { injectKnockbackCheckbox, injectNoBonusDmgCheckbox, injectThrottledCheckbox } from "./bonus-roll-hud.js";
export { genericAccuracyStepAttack, genericAccuracyStepTechAttack, genericAccuracyStepWeaponAttack, genericAccuracyStepStatRoll, genericBonusStepDamage, resolveDamageBonus } from "./bonus-flow-step.js";
export { initDamageCalcWrapper, receiveDeferredResistanceConsumption, deferResistanceEffectConsumption } from "./damage-calc-bridge.js";
export { initConstantStatHooks, resolveStatValue } from "./stat-bonus-resolver.js";

// Caches compiled @@fn: lambda sources to avoid recompiling on every evaluation.
const serializedConditionCache = new Map();

// Per-target gate cache for applyToCondition lambdas; same @@fn: pattern, must be synchronous.
const applyToConditionCache = new Map();

/**
 * Compile a `@@fn:` lambda source into a cached Function. Shared by `condition` and `applyToCondition`.
 * @param {string} src  the body after the `@@fn:` prefix
 * @param {Map<string, Function>} cache
 * @param {string[]} argNames
 * @param {string} preamble  JS source inserted before the return; typically defines `api` / `reactorToken`
 * @returns {Function}
 */
function compileCachedLambda(src, cache, argNames, preamble)
{
    let fn = cache.get(src);
    if (!fn)
    {
        fn = new Function(...argNames, `${preamble}return(${src})(${argNames.join(',')});`);
        cache.set(src, fn);
    }
    return fn;
}

/**
 * Serialize function-valued `condition` / `applyToCondition` into `@@fn:` source strings, including
 * on `multi` sub-bonuses. Bonus data is persisted in document flags as JSON, which drops functions.
 * Must be called by every entry point that writes bonusData to a flag.
 * @param {any} bonusData
 * @returns {any} the original object, or a copy with the lambdas serialized
 */
function serializeBonusLambdas(bonusData)
{
    if (!bonusData)
        return bonusData;
    const serializeOne = (bonus) =>
    {
        let out = bonus;
        if (typeof out?.condition === 'function')
            out = { ...out, condition: '@@fn:' + out.condition.toString() };
        if (typeof out?.applyToCondition === 'function')
            out = { ...out, applyToCondition: '@@fn:' + out.applyToCondition.toString() };
        return out;
    };
    let serialized = serializeOne(bonusData);
    if (serialized.type === 'multi' && Array.isArray(serialized.bonuses))
        serialized = { ...serialized, bonuses: serialized.bonuses.map(serializeOne) };
    return serialized;
}

/** Same gate against an already-resolved token, for callers with no accdiff entry. */
export function runApplyToCondition(mod, targetToken, state, reactorToken, entry = null)
{
    if (!mod.applyToCondition)
        return true;
    try
    {
        let fn;
        if (typeof mod.applyToCondition === 'function')
            fn = mod.applyToCondition;
        else if (typeof mod.applyToCondition === 'string' && mod.applyToCondition.startsWith('@@fn:'))
        {
            fn = compileCachedLambda(
                mod.applyToCondition.slice('@@fn:'.length),
                applyToConditionCache,
                ['target', 'state', 'reactorToken', 'entry'],
                `const api=game.modules.get('${MODULE_ID}')?.api;`
            );
        }
        else
            return true;
        const result = fn(targetToken, state, reactorToken, entry);
        if (result instanceof Promise)
        {
            console.error(`lancer-automations | applyToCondition for "${mod.name || mod.id}" is async. Must be synchronous.`);
            return false;
        }
        return !!result;
    }
    catch (e)
    {
        console.warn("lancer-automations | applyToCondition evaluation failed:", e);
        return false;
    }
}

// These use direct actor.update(), not AE changes (AE re-applies each refresh, breaking consumables like overshield).
export const CURRENT_RESOURCE_STATS = new Set([
    'system.hp.value', 'system.heat.value', 'system.overshield.value',
    'system.burn', 'system.repairs.value'
]);

export function flattenBonuses(bonuses)
{
    if (!bonuses)
        return [];
    const bonusArray = Array.isArray(bonuses) ? bonuses : [bonuses];
    const flattened = [];
    for (const bonus of bonusArray)
    {
        if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
        {
            bonus.bonuses.forEach((sub, idx) =>
            {
                const flatSub = { ...normalizeBonusShape(sub) };
                if (!flatSub.id)
                    flatSub.id = `${bonus.id || 'multi'}_sub_${idx}`;
                if (bonus.applyTo && !flatSub.applyTo)
                    flatSub.applyTo = bonus.applyTo;
                if (bonus.applyToCondition && !flatSub.applyToCondition)
                    flatSub.applyToCondition = bonus.applyToCondition;
                if (!flatSub.source && bonus.source)
                    flatSub.source = bonus.source;
                if (!flatSub.name && bonus.name)
                    flatSub.name = bonus.name;
                if (bonus.context && !flatSub.context)
                    flatSub.context = bonus.context;
                if (!flatSub.context && bonus.context)
                    flatSub.context = bonus.context;
                if (flatSub.consumeOnUsage === undefined && bonus.consumeOnUsage !== undefined)
                    flatSub.consumeOnUsage = bonus.consumeOnUsage;
                if (bonus.frequency && !flatSub.frequency)
                    Object.assign(flatSub, { frequency: bonus.frequency, frequencyCount: bonus.frequencyCount, frequencyKey: bonus.frequencyKey ?? bonus.id });
                flattened.push(flatSub);
            });
        }
        else
            flattened.push(normalizeBonusShape(bonus));
    }
    return flattened;
}

async function delegateSetActorFlag(actor, ns, key, value)
{
    if (game.user.isGM || actor.isOwner)
        await actor.setFlag(ns, key, value);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "setActorFlag",
            payload: { actorId: actor.id, ns, key, value }
        });
    }
}


/**
 * Mutates state.data.tags based on a tag bonus payload.
 */
export function applyTagBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!state.data.tags)
        state.data.tags = [];

    const tagName = bonus.tagName || bonus.name; // the effect manager stores the tag id and name
    const tagId = bonus.tagId;
    const isRemove = !!bonus.removeTag;

    if (isRemove)
    {
        state.data.tags = state.data.tags.filter(t => t.id !== tagId && t.lid !== tagId);
        return;
    }

    // Adding or Overriding
    const existingIdx = state.data.tags.findIndex(t => t.id === tagId || t.lid === tagId);
    if (existingIdx !== -1)
    {
        const tag = { ...state.data.tags[existingIdx] }; // Clone so we don't mutate the base definition
        const isOverride = bonus.tagMode === 'override';
        const val = Number.parseInt(bonus.val) || 0;

        if (isOverride)
            tag.val = String(val);
        else
        {
            const currentVal = Number.parseInt(tag.val) || Number.parseInt(tag.num_val) || 0;
            tag.val = String(bonus.tagMode === 'at_least' ? Math.max(currentVal, val) : currentVal + val);
        }
        state.data.tags[existingIdx] = tag;
    }
    else
    {
        // Tag does not exist. Push a stub.
        state.data.tags.push({
            id: tagId,
            lid: tagId,
            val: String(Number.parseInt(bonus.val) || 0),
            name: tagName,
            description: localizeFormat('LA.bonus.grantedBy', { name: bonus.name })
        });
    }
}

/**
 * Mutates state.data.range based on a range bonus payload.
 * Only used by getWeaponProfiles_WithBonus in misc-tools.js for offline range computation.
 * Range display in flows is handled by the libWrapper on currentProfile() / rangesFor().
 */
export function mutateRangeWithBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!state.data.range)
        state.data.range = [];

    const rangeType = bonus.rangeType;
    const rangeMode = bonus.rangeMode || 'add';
    const isOverride = rangeMode === 'override';
    const isChange = rangeMode === 'change';
    const val = Number.parseInt(bonus.val) || 0;

    if (isChange)
    {
        const RangeClass = state.data.range[0]?.constructor;
        state.data.range.length = 0;
        if (RangeClass && RangeClass !== Object)
            state.data.range.push(new RangeClass({ type: rangeType, val }));
        else
            state.data.range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
    }
    else
    {
        const existingIdx = state.data.range.findIndex(rangeEntry => rangeEntry.type === rangeType);
        if (existingIdx !== -1)
        {
            // Mutate in-place to preserve _Range prototype methods (icon getter, etc.)
            const entry = state.data.range[existingIdx];
            const current = Number.parseInt(entry.val) || 0;
            if (isOverride)
                entry.val = val;
            else
                entry.val = rangeMode === 'at_least' ? Math.max(current, val) : current + val;
        }
        else if (rangeMode !== 'at_least' || rangeType === 'Threat')
        {
            // Try to reuse the constructor from an existing range to preserve prototype methods
            const RangeClass = state.data.range[0]?.constructor;
            if (RangeClass && RangeClass !== Object)
                state.data.range.push(new RangeClass({ type: rangeType, val }));
            else
            {
                // Fallback: plain object with computed icon
                state.data.range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
            }
        }
    }

}

/**
 * Where a change_type bonus applies: 'base' (weapon damage, the default), 'bonus' (only the
 * bonus damage rows, global and per-target) or 'all'. Other modes always mean 'base'.
 * @param {any} bonus
 * @returns {'base' | 'bonus' | 'all'}
 */
export function damageBonusScope(bonus)
{
    return (bonus?.damageMode === 'change_type' && bonus.damageScope) ? bonus.damageScope : 'base';
}

/**
 * Whether a damage bonus rewrites the weapon's own damage before the HUD opens.
 * @param {any} bonus
 * @returns {boolean}
 */
export function mutatesBaseDamage(bonus)
{
    const mode = bonus?.damageMode || 'add';
    if (mode !== 'replace' && mode !== 'change_type' && mode !== 'add_base')
        return false;
    return damageBonusScope(bonus) !== 'bonus';
}

/**
 * Whether a damage bonus rewrites the bonus damage rows after the HUD closes.
 * @param {any} bonus
 * @returns {boolean}
 */
export function mutatesBonusDamage(bonus)
{
    if (bonus?.damageMode !== 'change_type')
        return false;
    const scope = damageBonusScope(bonus);
    return scope === 'bonus' || scope === 'all';
}

// 'add' goes through DOM injection in showDamageBonusNotification; only replace/add_base/change_type mutate here.
export function mutateDamageWithBonus(state, bonus)
{
    if (!state.data)
        state.data = {};
    if (!Array.isArray(state.data.damage))
        state.data.damage = [];

    const mode = bonus.damageMode || 'add';
    if (mode === 'add')
        return;

    const entries = bonus.damage || [];
    if (entries.length === 0)
        return;

    const DamageClass = state.data.damage[0]?.constructor;
    const makeDamage = (val, type) =>
    {
        if (DamageClass && DamageClass !== Object)
        {
            try
            {
                return new DamageClass({ type, val: String(val) });
            }
            catch (e)
            { /* fall through to plain object */ }
        }
        return { type, val: String(val) };
    };

    if (mode === 'replace')
    {
        state.data.damage.length = 0;
        for (const dmgEntry of entries)
            state.data.damage.push(makeDamage(dmgEntry.val ?? '1d6', dmgEntry.type ?? 'Kinetic'));
        return;
    }

    if (mode === 'add_base')
    {
        for (const dmgEntry of entries)
            state.data.damage.push(makeDamage(dmgEntry.val ?? '1d6', dmgEntry.type ?? 'Kinetic'));
        return;
    }

    if (mode === 'change_type')
    {
        // specific from-type wins over the 'all' fallback
        const specific = new Map();
        let allTarget = null;
        for (const dmgEntry of entries)
        {
            const from = dmgEntry.from || 'all';
            const to = dmgEntry.to || dmgEntry.type;
            if (!to)
                continue;
            if (from === 'all')
            {
                if (!allTarget)
                    allTarget = to;
            }
            else
                specific.set(from, to);
        }
        for (const dmg of state.data.damage)
        {
            const target = specific.get(dmg.type) || allTarget;
            if (target && target !== dmg.type)
                dmg.type = target;
        }
    }
}

/**
 * One-line display string for an LA bonus struct (Effect Manager, status panel).
 * Multi bonuses are the caller's job; this formats a single entry.
 * @param {any} bonus
 * @returns {string}
 */
export const STAT_BONUS_GROUPS = [
    { label: 'Resources (Max)', stats: { 'system.hp.max': 'HP (Max)', 'system.heat.max': 'Heat Cap (Max)', 'system.repairs.max': 'Repair Cap (Max)', 'system.structure.max': 'Structure (Max)', 'system.stress.max': 'Stress (Max)' } },
    { label: 'Resources (Current)', stats: { 'system.hp.value': 'HP (Current)', 'system.heat.value': 'Heat (Current)', 'system.overshield.value': 'Overshield', 'system.burn': 'Burn', 'system.repairs.value': 'Repairs (Current)' } },
    { label: 'Stats', stats: { 'system.speed': 'Speed', 'system.evasion': 'Evasion', 'system.edef': 'E-Defense', 'system.save': 'Save Target', 'system.sensor_range': 'Sensor Range', 'system.tech_attack': 'Tech Attack', 'system.armor': 'Armor', 'system.size': 'Size', 'system.activations': 'Activations' } }
];

function statBonusLabel(stat)
{
    for (const group of STAT_BONUS_GROUPS)
    {
        if (stat in group.stats)
            return group.stats[stat];
    }
    return stat?.split('.').pop() || stat;
}

function signedValueText(value)
{
    const text = String(value ?? '').trim();
    return text.startsWith('-') || text.startsWith('+') ? text : `+${text}`;
}

const ACTION_EXTRA_LABELS = { reaction: 'Reaction', quick: 'Quick Action', full: 'Full Action' };

export function statBonusValueText(bonus)
{
    const mode = bonus.statMode || 'add';
    if (mode === 'replace')
        return `= ${bonus.val}`;
    if (mode === 'replace_base')
        return `base = ${bonus.val}`;
    const signed = signedValueText(bonus.val);
    return mode === 'overwrite' ? `${signed} (highest)` : signed;
}

export function getBonusDetailString(bonus)
{
    if (bonus.type === 'accuracy')
        return `Accuracy +${bonus.val}`;
    if (bonus.type === 'difficulty')
        return `Difficulty +${bonus.val}`;
    if (bonus.type === 'flat')
        return `Flat ${signedValueText(bonus.val)}`;
    if (bonus.type === 'stat')
        return `${statBonusLabel(bonus.stat)} ${statBonusValueText(bonus)}`;
    if (bonus.type === 'damage')
    {
        const mode = bonus.damageMode || 'add';
        const entries = bonus.damage || [];
        if (mode === 'change_type')
        {
            const parts = entries.map(dmg =>
            {
                const from = (dmg.from && dmg.from !== 'all') ? dmg.from : 'All';
                return `${from} → ${dmg.to}`;
            });
            const scope = damageBonusScope(bonus);
            const scopeLabel = scope === 'base' ? '' : ` (${scope})`;
            return `Change Type${scopeLabel}: ${parts.join(', ')}`;
        }
        const body = entries.map(dmg => (dmg.type ? `${dmg.val} ${dmg.type}` : `${dmg.val}`)).join(' + ');
        if (mode === 'replace')
            return `Replace: ${body}`;
        if (mode === 'add_base')
            return `Add: ${body}`;
        return bonus.critOnly ? `${body} on crit` : body;
    }
    if (bonus.type === 'tag')
    {
        if (bonus.removeTag)
            return `Remove Tag: ${bonus.tagName}`;
        const action = bonus.tagMode === 'override' ? 'Set' : bonus.tagMode === 'at_least' ? 'At least' : 'Add';
        return `${action} ${bonus.tagName} ${bonus.val}`;
    }
    if (bonus.type === 'range')
    {
        const rangeLabel = bonus.rangeMode === 'override' ? 'Set' : bonus.rangeMode === 'change' ? 'Change All →' : bonus.rangeMode === 'at_least' ? 'At least' : 'Add';
        return `${rangeLabel} ${bonus.rangeType} ${bonus.val}`;
    }
    if (bonus.type === 'action_extra')
        return `Extra ${ACTION_EXTRA_LABELS[bonus.subtype] ?? bonus.subtype} +${bonus.val ?? 1}`;
    if (bonus.type === 'movement_extra' || bonus.type === 'speed_boost_extra')
    {
        const leg = bonus.type === 'movement_extra' && bonus.subtype === 'standard' ? 'Standard Move' : 'Boost';
        return `${leg} ${signedValueText(bonus.val)} ${Math.abs(Number(bonus.val)) === 1 ? 'space' : 'spaces'}`;
    }
    const defense = normalizeBonusShape(bonus);
    if (defense.type === 'resistance' || defense.type === 'vulnerability')
        return `${defense.type === 'resistance' ? 'Resistance' : 'Vulnerability'}: ${(defense.damageTypes || []).join(', ')}`;
    if (bonus.type === 'immunity')
    {
        if (bonus.subtype === 'effect' && bonus.effects)
            return `Immunity: ${bonus.effects.join(', ')}`;
        if (bonus.subtype === 'damage' && bonus.damageTypes)
            return `${bonus.subtype}: ${bonus.damageTypes.join(', ')}`;
        if (bonus.subtype === 'crit')
            return 'Immunity: Critical Hit';
        if (bonus.subtype === 'hit')
            return 'Immunity: Hit';
        if (bonus.subtype === 'miss')
            return 'Immunity: Miss';
        if (bonus.subtype === 'elevation')
            return 'Immunity: Elevation';
        if (bonus.subtype === 'terrain')
            return 'Immunity: Terrain';
        if (bonus.subtype === 'obstacle')
            return 'Immunity: Obstacle (Phasing)';
        if (bonus.subtype === 'provoke')
            return 'Immunity: Provoke (Engagement & Reactions)';
        return bonus.subtype;
    }
    if (bonus.type === 'target_modifier')
    {
        const labels = {
            invisible: 'Invisible (50% miss)',
            no_invisible: 'Not Invisible',
            no_cover: 'No Cover',
            soft_cover: 'Soft Cover',
            hard_cover: 'Hard Cover',
            ap: 'Armor Piercing',
            half_damage: 'Half Damage',
            paracausal: 'Cannot be Reduced',
            crit: 'Force Crit',
            hit: 'Force Hit',
            miss: 'Force Miss'
        };
        return `Target: ${labels[bonus.subtype] || bonus.subtype}`;
    }
    if (bonus.type === 'reroll')
    {
        const rerollTypes = Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0 ? bonus.rollTypes.join(', ') : 'any';
        const subtype = String(bonus.subtype ?? 'retry');
        return `Reroll [${subtype}]: ${rerollTypes}`;
    }
    return bonus.type || 'Unknown';
}

/**
 * Uses left on a bonus, read from its linked effect's counter.
 * @param {Actor|null} actor
 * @param {object} bonus
 * @returns {{ label: string, onUse: boolean } | null} null when the bonus has no use count
 */
export function getBonusUsesInfo(actor, bonus)
{
    if (bonus?.uses === undefined)
        return null;
    const linkedEffect = actor?.effects?.find(effect => getLAFlag(effect, 'linkedBonusId') === bonus.id);
    const remaining = linkedEffect ? (linkedEffect.flags?.statuscounter?.value ?? null) : null;
    const label = remaining === null ? `uses: ${bonus.uses}` : `${remaining}/${bonus.uses}`;
    const onUse = DEFENSE_TYPES.has(bonus.type) ? bonus.consumeOnUsage === true : bonus.consumeOnUsage !== false;
    return { label, onUse: supportsConsumeOnUsage(bonus.type, bonus.subtype ?? null) && onUse };
}

// Same movement glyph the combat bar, stats bar and stat hint use. It is an mdi font class,
// so anything needing a real image goes through getBonusIconImage.
const MOVEMENT_ICON = "mdi mdi-arrow-right-bold-hexagon-outline";
const MOVEMENT_IMG = "modules/lancer-automations/icons/move-hexagon.svg";

/** Icon for an ActiveEffect img, which cannot be a font class. */
export function getBonusIconImage(bonus, override = null)
{
    const icon = override || getBonusIcon(bonus);
    if (typeof icon === 'string' && icon.includes('/'))
        return icon;
    return bonus?.type === 'movement_extra' ? MOVEMENT_IMG : "modules/lancer-automations/icons/pill.svg";
}

/**
 * Determines the appropriate icon for a bonus based on its type and value.
 * @param {object} bonus
 * @returns {string} An SVG path, or an mdi font class for movement
 */
export function getBonusIcon(bonus)
{
    const ACC = "systems/lancer/assets/icons/white/accuracy.svg";
    const DIFF = "systems/lancer/assets/icons/white/difficulty.svg";
    const RANGE = "systems/lancer/assets/icons/white/range.svg";
    const MELEE = "systems/lancer/assets/icons/white/melee.svg";
    const GENERIC = "modules/lancer-automations/icons/pill.svg";
    const IMMUNITY = "modules/lancer-automations/icons/dice-shield.svg";
    const VULNERABILITY = "modules/lancer-automations/icons/achilles-heel.svg";

    if (bonus.type === 'movement_extra')
        return MOVEMENT_ICON;
    if (bonus.type === 'difficulty')
        return DIFF;
    if (bonus.type === 'range')
        return RANGE;
    if (bonus.type === 'damage')
        return MELEE;
    if (bonus.type === 'stat')
        return GENERIC;
    if (normalizeBonusShape(bonus).type === 'vulnerability')
        return VULNERABILITY;
    if (bonus.type === 'immunity' || bonus.type === 'resistance')
        return IMMUNITY;

    if (bonus.type === 'multi' && Array.isArray(bonus.bonuses))
    {
        const counts = {};
        let maxCount = 0, maxType = null;
        for (const sub of bonus.bonuses)
        {
            counts[sub.type] = (counts[sub.type] || 0) + 1;
            if (counts[sub.type] > maxCount)
            {
                maxCount = counts[sub.type];
                maxType = sub.type;
            }
        }
        return getBonusIcon({ type: maxType });
    }

    const val = Number.parseInt(bonus.val) || 0;
    return val >= 0 ? ACC : DIFF;
}

const ATTACK_TYPE_CLASSES = { Melee: 'melee', Ranged: 'ranged' };

export function getFlowTags(flowType, state)
{
    const tags = new Set(["all"]);
    for (const rollType of state.la_extraData?.rollTypes ?? [])
        tags.add(String(rollType).toLowerCase());
    const itemType = state.item?.system?.type?.toLowerCase();

    const addWeaponClassTags = () =>
    {
        const weaponClassTag = weaponClass(state.item) || ATTACK_TYPE_CLASSES[state.data?.attack_type];
        if (weaponClassTag)
            tags.add(weaponClassTag);
        if (state.item?.system?.type === "Tech")
            tags.add("tech");
    };

    if (["attack", "basic_attack", "weapon_attack"].includes(flowType))
    {
        tags.add("attack");
        if (itemType)
            tags.add(itemType);
        addWeaponClassTags();
    }
    else if (flowType === "tech_attack")
    {
        tags.add("attack");
        tags.add("tech_attack");
        tags.add("tech");
    }
    else if (flowType === "stat_roll")
    {
        tags.add("check");
        const kind = tags.has("save") ? "save" : "check";
        const path = state.data?.path?.toLowerCase() || "";
        ["hull", "agility", "systems", "engineering", "grit"].forEach(statName =>
        {
            if (path.includes(statName) || path.includes(statName.slice(0, 3)))
            {
                tags.add(statName);
                tags.add(`${statName}_${kind}`);
            }
        });
        if (state.actor?.is_npc && path.includes("tier"))
            tags.add("tier");
    }
    else if (["structure", "overheat", "damage"].includes(flowType))
    {
        tags.add(flowType);
        if (flowType === "damage")
        {
            if (itemType)
                tags.add(itemType);
            addWeaponClassTags();
        }
    }
    return tags;
}

export function isBonusApplicable(bonus, flowTags, state, { ignoreFrequency = false } = {})
{
    if (bonus.rollTypes && Array.isArray(bonus.rollTypes) && bonus.rollTypes.length > 0)
    {
        const hasMatch = bonus.rollTypes.some(rollType => flowTags.has(rollType.toLowerCase()));
        if (!hasMatch)
            return false;
    }

    if (!ignoreFrequency && !bonusFrequencyFree(bonus, state))
        return false;

    if (bonus.condition)
    {
        try
        {
            const context = bonus.context || {};
            let result;
            if (typeof bonus.condition === 'function')
                result = bonus.condition(state, state.actor, state.data, context);
            else if (typeof bonus.condition === 'string' && bonus.condition.trim() !== '')
            {
                if (bonus.condition.startsWith('@@fn:'))
                {
                    const fn = compileCachedLambda(
                        bonus.condition.slice('@@fn:'.length),
                        serializedConditionCache,
                        ['state', 'actor', 'data', 'context'],
                        `const api=game.modules.get('${MODULE_ID}')?.api;` +
                        `const ownerTokenId=context?.ownerTokenId;` +
                        `const reactorToken=ownerTokenId?canvas.tokens.get(ownerTokenId)??null:null;`
                    );
                    result = fn(state, state.actor, state.data, context);
                }
                else
                {
                    const fn = stringToAsyncFunction(bonus.condition, ['state', 'actor', 'data', 'context']);
                    result = fn(state, state.actor, state.data, context);
                }
            }
            if (result instanceof Promise)
            {
                console.error(`lancer-automations | evaluate for "${bonus.name}" is async. Bonus condition must be synchronous.`);
                return false;
            }
            if (!result)
                return false;
        }
        catch (e)
        {
            console.warn("lancer-automations | Condition evaluation failed:", e);
            return false;
        }
    }

    if (bonus.itemLids && Array.isArray(bonus.itemLids) && bonus.itemLids.length > 0)
    {
        if (!state.item)
            return false;
        const itemLid = state.item.system?.lid;
        if (!itemLid || !bonus.itemLids.includes(itemLid))
            return false;
    }

    if (bonus.itemId)
    {
        if (!state.item)
            return false;
        if (state.item.id !== bonus.itemId && state.item._id !== bonus.itemId)
            return false;
    }

    return bonusMatchesWeapon(bonus, state.item, flowTags);
}

const WEAPON_SIZES = new Set(['auxiliary', 'main', 'heavy', 'superheavy']);
const WEAPON_FILTER_FIELDS = ['weaponTypes', 'weaponSizes', 'weaponRangeTypes', 'weaponDamageTypes'];

function lowerList(values)
{
    return (Array.isArray(values) ? values : [values]).map(value => String(value ?? '').toLowerCase()).filter(Boolean);
}

function weaponProfile(item)
{
    const system = item?.system;
    return system?.active_profile ?? system?.profiles?.[system?.selected_profile_index ?? 0] ?? system;
}

function weaponFilterValues(item)
{
    const words = lowerList(String(getWeaponType(item) || '').split(/\s+/));
    const profile = weaponProfile(item);
    return {
        weaponTypes: words,
        weaponSizes: lowerList(item?.system?.size || words.find(word => WEAPON_SIZES.has(word)) || ''),
        weaponRangeTypes: lowerList((profile?.range ?? []).flat().map(range => range?.type)),
        weaponDamageTypes: lowerList((profile?.damage ?? []).flat().map(damage => damage?.type))
    };
}

const IMPROVISED_FILTER_VALUES = { weaponTypes: ['improvised'], weaponSizes: [], weaponRangeTypes: ['threat'], weaponDamageTypes: ['kinetic'] };

function bonusMatchesWeapon(bonus, item, flowTags = null)
{
    const filters = WEAPON_FILTER_FIELDS.filter(field => Array.isArray(bonus[field]) && bonus[field].length);
    if (!filters.length)
        return true;
    const improvised = !item && !!flowTags?.has?.('improvised');
    if (!improvised && !getWeaponType(item))
        return false;
    const values = improvised ? IMPROVISED_FILTER_VALUES : weaponFilterValues(item);
    return filters.every(field => lowerList(bonus[field]).some(wanted => values[field].includes(wanted)));
}

const EFFECT_FLAG_RESERVED = new Set([
    'linkedBonusId', 'stack', 'consumption', 'statDirect', 'changes', 'refresh',
    'targetID', 'effect', 'duration', 'note', 'originID', 'appliedRound', 'appliedStack', 'durationEntries'
]);

function _effectFlagsFrom(options)
{
    const flags = options?.effectFlags;
    if (!flags || typeof flags !== 'object')
        return {};
    /** @type {Record<string, any>} */
    const out = {};
    for (const [key, value] of Object.entries(flags))
    {
        if (EFFECT_FLAG_RESERVED.has(key))
        {
            console.warn(`lancer-automations | addGlobalBonus: effectFlags key '${key}' is reserved, skipped.`);
            continue;
        }
        out[key] = value;
    }
    return out;
}

function _bonusDuration(options, originId)
{
    const normalized = normalizeDuration({ label: options.duration || 'indefinite', rounds: options.durationRounds });
    const label = normalized.label;
    if (label === 'roundEnd' || label === 'roundStart')
        return { label, rounds: Math.max(1, Number(normalized.rounds) || 1), turns: null };
    if ((label === 'start' || label === 'end') && game.combat && originId)
    {
        const turnsVal = Number.isFinite(options.durationTurns) ? Math.max(0, options.durationTurns) : 1;
        const isOriginTurn = game.combat?.current?.tokenId === originId;
        const turns = label === 'end' && isOriginTurn ? turnsVal + 1 : (turnsVal === 0 ? 1 : turnsVal);
        return { label, turns, rounds: 0, _preAdjusted: true };
    }
    if (ANY_TURN_LABELS.has(label) && game.combat)
    {
        const turnsVal = Number.isFinite(options.durationTurns) ? Math.max(0, options.durationTurns) : 1;
        return { label, turns: turnsVal === 0 ? 1 : turnsVal, rounds: 0, _preAdjusted: true };
    }
    if (label === 'encounter' || label === 'permanent')
        return { label, turns: null, rounds: null };
    return { label: 'indefinite', turns: null, rounds: null };
}

/** @returns {Promise<string|undefined>} bonus ID, or undefined if no actor */
export async function addGlobalBonus(actor, bonusData, options = {})
{
    if (!actor)
        return;
    bonusData = _acceptBonusInput(bonusData);
    if (options.duration === 'constant')
    {
        await addConstantBonus(actor, bonusData);
        return bonusData.id;
    }
    if (options.effectFlags && bonusData.id && (getLAFlag(actor,"global_bonuses") || []).some(existing => existing.id === bonusData.id))
        await removeGlobalBonus(actor, bonusData.id);
    const bonuses = duplicate(getLAFlag(actor,"global_bonuses") || []);

    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();
    if (!bonusData.name)
        bonusData.name = "Unnamed Bonus";

    bonusData = serializeBonusLambdas(bonusData);

    const existingIdx = bonuses.findIndex(b => b.id === bonusData.id);
    if (existingIdx !== -1)
        bonuses[existingIdx] = bonusData;
    else
        bonuses.push(bonusData);

    await delegateSetActorFlag(actor, MODULE_ID,"global_bonuses", bonuses);

    options.duration = options.duration || 'indefinite';
    if (options.duration)
    {
        const token = options.forcePrototype
            ? null
            : (actor.token?.object || canvas.tokens.placeables.find(t => t.actor?.id === actor.id));

        if (!token)
        {
            // Prototype / no scene token: write the AE straight to the actor so spawns inherit it.
            const icon = getBonusIconImage(bonusData, options.icon);
            const changes = [];
            let statDirect = null;

            if (bonusData.type === 'stat' && bonusData.stat)
            {
                const statMode = bonusData.statMode || 'add';
                const raw = Number.parseInt(bonusData.val) || 0;
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat))
                {
                    const preBonusValue = foundry.utils.getProperty(actor, bonusData.stat) || 0;
                    const delta = statMode === 'replace' ? raw - preBonusValue : raw;
                    statDirect = { key: bonusData.stat, value: delta, preBonusValue };
                }
                else
                {
                    changes.push({
                        key: bonusData.stat,
                        value: String(raw),
                        mode: statMode === 'replace' ? CONST.ACTIVE_EFFECT_MODES.OVERRIDE : CONST.ACTIVE_EFFECT_MODES.ADD
                    });
                }
            }

            // A filtered resistance is decided per attack, so it must not be baked on permanently.
            if (bonusData.type === 'resistance' && bonusData.damageTypes && !hasBonusFilters(bonusData))
            {
                for (const lcType of expandDamageTypes(bonusData.damageTypes))
                    changes.push({ key: `system.resistances.${lcType}`, mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" });
            }

            const laFlags = /** @type {any} */ ({ linkedBonusId: bonusData.id, ..._effectFlagsFrom(options) });
            const protoDuration = _bonusDuration(options, null);
            if (protoDuration.label !== 'indefinite')
                laFlags.duration = protoDuration;
            if (statDirect)
                laFlags.statDirect = statDirect;
            if (options.consumption?.trigger)
            {
                // No originId: reactions-engine falls back to each prototype-spawned token at trigger time, so each consumes independently.
                laFlags.consumption = {
                    trigger: options.consumption.trigger,
                    role: options.consumption.role || null,
                    groupId: options.consumption.groupId || null,
                    evaluate: options.consumption.evaluate || null,
                    itemLid: options.consumption.itemLid || null,
                    itemId: options.consumption.itemId || null,
                    actionName: options.consumption.actionName || null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null,
                };
            }
            const effectData = { name: bonusData.name, img: icon, changes, flags: { [MODULE_ID]: laFlags } };
            if (bonusData.uses && bonusData.uses > 0)
            {
                foundry.utils.setProperty(effectData, 'flags.statuscounter.value', bonusData.uses);
                foundry.utils.setProperty(effectData, 'flags.statuscounter.visible', bonusData.uses > 1);
            }
            if (options.refresh && actor.effects.some(effect => getLAFlags(effect)?.linkedBonusId === bonusData.id))
                return;
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

            if (statDirect)
            {
                let newVal = Math.max(0, statDirect.preBonusValue + statDirect.value);
                const maxPath = statDirect.key.replace('.value', '.max');
                if (maxPath !== statDirect.key)
                {
                    const maxVal = foundry.utils.getProperty(actor, maxPath);
                    if (maxVal !== undefined)
                        newVal = Math.min(newVal, maxVal);
                }
                await actor.update({ [statDirect.key]: newVal });
            }
        }
        else if (token)
        {
            const durationObj = _bonusDuration(options, options.origin?.id || options.origin || token.id);

            const icon = getBonusIconImage(bonusData, options.icon);

            const extraOptions = /** @type {any} */ ({ linkedBonusId: bonusData.id, ..._effectFlagsFrom(options) });

            // Stack = uses count (statuscounter.value is the single counter)
            if (bonusData.uses)
                extraOptions.stack = bonusData.uses;

            // If consumption trigger is configured, attach it (no 'uses'; stack handles that)
            if (options.consumption?.trigger)
            {
                extraOptions.consumption = {
                    trigger: options.consumption.trigger,
                    originId: options.consumption.originId || token.id,
                    role: options.consumption.role || null,
                    groupId: options.consumption.groupId || null,
                    evaluate: options.consumption.evaluate || null,
                    itemLid: options.consumption.itemLid || null,
                    itemId: options.consumption.itemId || null,
                    actionName: options.consumption.actionName || null,
                    minDistance: options.consumption.minDistance ?? null,
                    checkType: options.consumption.checkType || null,
                    checkAbove: options.consumption.checkAbove ?? null,
                    checkBelow: options.consumption.checkBelow ?? null
                };
            }

            if (bonusData.type === 'stat' && bonusData.stat)
            {
                const statMode = bonusData.statMode || 'add';
                const raw = Number.parseInt(bonusData.val) || 0;
                if (CURRENT_RESOURCE_STATS.has(bonusData.stat))
                {
                    const preBonusValue = foundry.utils.getProperty(token.actor, bonusData.stat) || 0;
                    // Store value as the delta so removal reverses just that delta (same as add mode).
                    const delta = statMode === 'replace' ? raw - preBonusValue : raw;
                    extraOptions.statDirect = { key: bonusData.stat, value: delta, preBonusValue };
                }
                else
                {
                    extraOptions.changes = [{
                        key: bonusData.stat,
                        value: String(raw),
                        mode: statMode === 'replace' ? CONST.ACTIVE_EFFECT_MODES.OVERRIDE : CONST.ACTIVE_EFFECT_MODES.ADD
                    }];
                }
            }

            if (bonusData.type === 'resistance' && bonusData.damageTypes && !hasBonusFilters(bonusData))
            {
                if (!extraOptions.changes)
                    extraOptions.changes = [];
                for (const lcType of expandDamageTypes(bonusData.damageTypes))
                {
                    extraOptions.changes.push({
                        key: `system.resistances.${lcType}`,
                        mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE,
                        value: "true"
                    });
                }
            }

            await applyEffectsToTokens(
                {
                    tokens: [token],
                    effectNames: [{
                        name: bonusData.name,
                        icon: icon,
                        isCustom: true,
                        stack: bonusData.uses || 1
                    }],
                    note: `Linked to Global Bonus: ${bonusData.name}`,
                    duration: { ...durationObj, overrideTurnOriginId: options.origin?.id || options.origin || token.id },
                    refresh: !!options.refresh
                },
                extraOptions
            );

            // Apply direct stat modification for current resources (after effect is created)
            if (extraOptions.statDirect)
            {
                let newVal = extraOptions.statDirect.preBonusValue + extraOptions.statDirect.value;
                newVal = Math.max(0, newVal);
                // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
                const maxPath = extraOptions.statDirect.key.replace('.value', '.max');
                if (maxPath !== extraOptions.statDirect.key)
                {
                    const maxVal = foundry.utils.getProperty(token.actor, maxPath);
                    if (maxVal !== undefined)
                        newVal = Math.min(newVal, maxVal);
                }
                await token.actor.update({ [extraOptions.statDirect.key]: newVal });
            }
            const originRaw = options.origin;
            const originId = originRaw?.id ?? originRaw;
            const originToken = typeof originId === 'string'
                ? canvas.tokens?.get?.(originId) ?? null
                : (originRaw && originRaw.document ? originRaw : null);
            playBonusAddedFX(token, originToken);
        }
    }

    return bonusData.id;
}

const _bonusFlagQueues = new Map();
const _pendingBonusRemovals = new Map();

function _actorKey(actor)
{
    return actor.uuid ?? actor.id;
}

// read-modify-write of the bonus flag must not interleave: a batch delete fires the hook once per effect
function _queueBonusFlagWrite(actor, task)
{
    const key = _actorKey(actor);
    const previous = _bonusFlagQueues.get(key) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(task);
    _bonusFlagQueues.set(key, run);
    run.finally(() =>
    {
        if (_bonusFlagQueues.get(key) === run)
            _bonusFlagQueues.delete(key);
    }).catch(() => undefined);
    return run;
}

/** True while a removal of that bonus is in flight, so lists can drop it before the flag catches up. */
export function isBonusRemovalPending(actor, bonusId)
{
    return !!actor && !!_pendingBonusRemovals.get(_actorKey(actor))?.has(bonusId);
}

/**
 * @param {string|function(any): boolean} bonusIdOrPredicate - Bonus ID string, or a predicate
 *   to remove all matching bonuses in a single flag update.
 * @returns {Promise<boolean>} true if at least one bonus was removed
 */
export async function removeGlobalBonus(actor, bonusIdOrPredicate, skipEffectRemoval = false)
{
    if (!actor)
        return;
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : bonus => bonus.id === bonusIdOrPredicate;

    const key = _actorKey(actor);
    const pendingIds = (getLAFlag(actor,"global_bonuses") || []).filter(predicate).map(bonus => bonus.id);
    const pending = _pendingBonusRemovals.get(key) ?? new Set();
    for (const id of pendingIds)
        pending.add(id);
    _pendingBonusRemovals.set(key, pending);
    try
    {
        return await _queueBonusFlagWrite(actor, async () =>
        {
            let bonuses = duplicate(getLAFlag(actor,"global_bonuses") || []);
            const initialLength = bonuses.length;
            const bonusesToRemove = bonuses.filter(predicate);
            bonuses = bonuses.filter(bonus => !predicate(bonus));
            if (bonuses.length === initialLength)
                return false;

            await delegateSetActorFlag(actor, MODULE_ID,"global_bonuses", bonuses);

            if (!skipEffectRemoval && bonusesToRemove.length > 0)
            {
                const removedIds = new Set(bonusesToRemove.map(bonus => bonus.id));
                const linkedEffects = actor.effects.filter(linkedEffect =>
                    removedIds.has(getLAFlag(linkedEffect,'linkedBonusId'))
                );
                for (const linkedEffect of linkedEffects)
                    await linkedEffect.delete();
            }
            return true;
        });
    }
    finally
    {
        for (const id of pendingIds)
            pending.delete(id);
        if (!pending.size && _pendingBonusRemovals.get(key) === pending)
            _pendingBonusRemovals.delete(key);
    }
}

/** @returns {object[]} */
export function getGlobalBonuses(actor)
{
    if (!actor)
        return [];
    return withoutSwitchedOff(actor, getLAFlag(actor,"global_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor))
        .map(normalizeBonusShape);
}

/** @returns {object|null} The bonus with that id, or null */
export function getGlobalBonus(actor, bonusId)
{
    if (!actor)
        return null;
    const bonuses = actor ? (getLAFlag(actor,"global_bonuses") || []) : [];
    return bonuses.find(b => b.id === bonusId) || null;
}

Hooks.on("deleteActiveEffect", (effect) =>
{
    if (getLAFlag(effect,'repairKeep'))
        return;
    // Item-source AEs: reversal runs when the transferred copy leaves the actor; removeGlobalBonus on an item no-ops via the flag branch.
    const isItemParent = effect.parent?.documentName === 'Item';

    const linkedBonusId = getLAFlag(effect,"linkedBonusId");
    if (linkedBonusId && effect.parent)
        removeGlobalBonus(effect.parent, linkedBonusId, true);

    if (isItemParent)
        return;

    const statDirect = getLAFlag(effect,'statDirect');
    if (statDirect && effect.parent)
    {
        setTimeout(async () =>
        {
            const actor = effect.parent;
            if (!actor)
                return;
            const currentVal = foundry.utils.getProperty(actor, statDirect.key) || 0;
            let newVal;

            if (statDirect.value > 0)
            {
                // Positive bonus: only remove what's still present above the pre-bonus baseline (damage may have consumed part).
                const remainingBonus = Math.max(0, Math.min(statDirect.value, currentVal - (statDirect.preBonusValue || 0)));
                newVal = currentVal - remainingBonus;
            }
            else
            {
                // Negative bonus: give back full amount, clamp to max
                newVal = currentVal - statDirect.value;
            }

            newVal = Math.max(0, newVal);
            // Clamp to max if applicable (e.g., hp.value can't exceed hp.max)
            const maxPath = statDirect.key.replace('.value', '.max');
            if (maxPath !== statDirect.key)
            {
                const maxVal = foundry.utils.getProperty(actor, maxPath);
                if (maxVal !== undefined)
                    newVal = Math.min(newVal, maxVal);
            }
            await actor.update({ [statDirect.key]: newVal });
        }, 200);
    }

    // Clamp .value when a .max stat bonus is reversed by Foundry
    const maxChanges = (/** @type {any[]} */ (effect.changes) || []).filter(entry =>
        entry.key?.endsWith('.max') && (entry.mode === CONST.ACTIVE_EFFECT_MODES.ADD || entry.mode === CONST.ACTIVE_EFFECT_MODES.OVERRIDE)
    );
    if (maxChanges.length > 0 && effect.parent)
    {
        setTimeout(async () =>
        {
            const actor = effect.parent;
            if (!actor)
                return;
            const updates = {};
            for (const change of maxChanges)
            {
                const valuePath = change.key.replace('.max', '.value');
                const newMax = foundry.utils.getProperty(actor, change.key);
                const currentValue = foundry.utils.getProperty(actor, valuePath);
                if (currentValue !== undefined && newMax !== undefined && currentValue > newMax)
                    updates[valuePath] = newMax;
            }
            if (Object.keys(updates).length > 0)
                await actor.update(updates);
        }, 200);
    }
});


/** @returns {Promise<void>} */
export async function injectBonusToFlowState(state, bonus)
{
    if (!state)
        return;

    if (!bonus.id)
        bonus.id = foundry.utils.randomID();

    if (!state.la_extraData)
        state.la_extraData = {};
    if (!state.la_extraData.flow_bonus)
        state.la_extraData.flow_bonus = [];

    state.la_extraData.flow_bonus.push(_acceptBonusInput(bonus));
}

/** @returns {Promise<void>} */
export async function addConstantBonus(target, bonusData)
{
    if (!target)
        return;
    bonusData = _acceptBonusInput(bonusData);
    const bonuses = duplicate(getLAFlag(target,"constant_bonuses") || []);
    if (!bonusData.id)
        bonusData.id = foundry.utils.randomID();

    bonusData = serializeBonusLambdas(bonusData);

    if (target.documentName === 'Item')
    {
        console.warn('lancer-automations | addConstantBonus on Item is not supported - use linkBonusToItem instead.');
        return;
    }
    const existingIndex = bonuses.findIndex(bonus => bonus.id === bonusData.id);
    if (existingIndex >= 0)
        bonuses[existingIndex] = bonusData;
    else
        bonuses.push(bonusData);
    await delegateSetActorFlag(target, MODULE_ID,"constant_bonuses", bonuses);
}

/** @returns {object[]} */
export function getConstantBonuses(actor)
{
    if (!actor)
        return [];
    return withoutSwitchedOff(actor, getLAFlag(actor,"constant_bonuses") || [])
        .filter(bonus => linkTierGate(bonus, actor))
        .map(normalizeBonusShape);
}

/**
 * Remove constant bonus(es) from an actor.
 * @param {Actor} target
 * @param {string|function(bonuses): boolean} bonusIdOrPredicate - Bonus ID string to remove one,
 *   or a predicate function to remove all matching bonuses in a single flag update.
 * @returns {Promise<void>}
 */
export async function removeConstantBonus(target, bonusIdOrPredicate)
{
    if (!target)
        return;
    const bonuses = duplicate(getLAFlag(target,"constant_bonuses") || []);
    const predicate = typeof bonusIdOrPredicate === 'function'
        ? bonusIdOrPredicate
        : bonus => bonus.id === bonusIdOrPredicate;
    const filtered = bonuses.filter(bonus => !predicate(bonus));
    if (filtered.length !== bonuses.length)
    {
        if (target.documentName === 'Item')
            await setLAFlag(target,"constant_bonuses", filtered);
        else
            await delegateSetActorFlag(target, MODULE_ID,"constant_bonuses", filtered);
    }
}

function _bonusTemplateRuntimeId(sourceDoc, templateId)
{
    return `${sourceDoc.uuid}::${templateId}`;
}

async function _materializeBonusTemplatesToTokens(sourceDoc, sourceKey, tokens)
{
    if (!sourceDoc || !tokens?.length)
        return;
    const templates = getLAFlag(sourceDoc,'bonusTemplates') || [];
    if (!templates.length)
        return;
    for (const template of templates)
    {
        const runtimeId = _bonusTemplateRuntimeId(sourceDoc, template.id);
        const persistedUses = Number.isFinite(template.lastRuntimeUses) ? Number(template.lastRuntimeUses) : undefined;
        const templateUses = template.bonusData?.uses;
        const uses = persistedUses !== undefined ? persistedUses : templateUses;
        // Exhausted templates (persistedUses === 0) do not re-materialize until user resets uses.
        if (persistedUses === 0 && templateUses !== undefined)
            continue;
        const rawDuration = template.addOptions?.duration;
        const durationLabel = typeof rawDuration === 'string' ? rawDuration : rawDuration?.label;
        const isConstant = durationLabel === 'constant';
        for (const token of tokens)
        {
            const actor = token?.actor;
            if (!actor)
                continue;
            if (!linkTierGate(template.bonusData, actor, sourceKey === 'sourceItemUuid' ? sourceDoc : null))
                continue;
            const markers = { [sourceKey]: sourceDoc.uuid, sourceTemplateId: template.id, sourceBonusId: template.bonusData?.id };
            if (isConstant)
            {
                const existing = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);
                if (existing.some(bonus => bonus.id === runtimeId))
                    continue;
                const bonusDataOut = { ...normalizeBonusShape(template.bonusData || {}), id: runtimeId, ...markers };
                if (uses !== undefined)
                    bonusDataOut.uses = uses;
                try
                {
                    await delegateSetActorFlag(actor, MODULE_ID,'constant_bonuses', [...existing, bonusDataOut]);
                }
                catch (err)
                {
                    console.warn('lancer-automations | bonus template constant write failed:', err);
                }
                continue;
            }
            const already = (getLAFlag(actor,'global_bonuses') || []).some(bonus => bonus.id === runtimeId);
            if (already)
                continue;
            const bonusDataOut = { ...normalizeBonusShape(template.bonusData || {}), id: runtimeId, ...markers };
            if (uses !== undefined)
                bonusDataOut.uses = uses;
            const optsOut = { ...(template.addOptions || {}), ...markers };
            try
            {
                await addGlobalBonus(actor, bonusDataOut, optsOut);
            }
            catch (err)
            {
                console.warn('lancer-automations | bonus template materialize failed:', err);
            }
        }
    }
}

/**
 * Materialize all bonus templates on `item` to the given tokens via addGlobalBonus.
 * Idempotent - skips tokens whose actor already carries the runtime bonus for that template.
 * @param {any} item
 * @param {any[]} tokens
 * @returns {Promise<void>}
 */
export async function applyItemBonusTemplatesToTokens(item, tokens)
{
    if (!item || item.system?.destroyed || item.system?.disabled)
        return;
    await _materializeBonusTemplatesToTokens(item, 'sourceItemUuid', tokens);
}

/**
 * Materialize all bonus templates on prototype `actor` to the given tokens via addGlobalBonus.
 * @param {any} actor
 * @param {any[]} tokens
 * @returns {Promise<void>}
 */
export async function applyActorBonusTemplatesToTokens(actor, tokens)
{
    await _materializeBonusTemplatesToTokens(actor, 'sourceActorUuid', tokens);
}

async function _persistBonusUsesToTemplate(actor, runtimeBonus, explicitUses = undefined)
{
    const sourceUuid = runtimeBonus?.sourceItemUuid ?? runtimeBonus?.sourceActorUuid;
    const sourceTemplateId = runtimeBonus?.sourceTemplateId;
    if (!sourceUuid || !sourceTemplateId)
        return;
    try
    {
        const source = /** @type {any} */ (await fromUuid(sourceUuid));
        if (!source)
            return;
        const templates = getLAFlag(source,'bonusTemplates') || [];
        const template = templates.find(candidate => candidate.id === sourceTemplateId);
        if (!template)
            return;
        const rawDuration = template?.addOptions?.duration;
        const durationLabel = typeof rawDuration === 'string' ? rawDuration : rawDuration?.label;
        let currentUses;
        if (explicitUses !== undefined)
            currentUses = explicitUses;
        else
        {
            // Constant templates have no linked AE and no statuscounter to persist; skip.
            if (durationLabel === 'constant')
                return;
            const linkedAE = /** @type {any[]} */ (Array.from(actor?.effects ?? [])).find(effect =>
                getLAFlags(effect)?.linkedBonusId === runtimeBonus.id);
            const rawUses = linkedAE?.flags?.statuscounter?.value;
            currentUses = Number.isFinite(Number(rawUses)) ? Number(rawUses) : (linkedAE ? undefined : 0);
            if (currentUses === undefined)
                return;
        }
        const updated = templates.map(candidate => candidate.id === sourceTemplateId ? { ...candidate, lastRuntimeUses: currentUses } : candidate);
        await setLAFlag(source,'bonusTemplates', updated);
    }
    catch (err)
    {
        console.warn('lancer-automations | persistBonusUsesToTemplate failed:', err);
    }
}

/** @returns {boolean} */
export function supportsConsumeOnUsage(type, subtype = null)
{
    if (['accuracy', 'difficulty', 'flat', 'damage', 'target_modifier', 'reroll', 'resistance', 'vulnerability'].includes(type))
        return true;
    if (type === 'immunity')
        return ['effect', 'crit', 'hit', 'miss', 'damage', 'provoke', 'terrain'].includes(subtype);
    return false;
}

function _findStoredBonus(actor, bonusId)
{
    const search = (list, source) =>
    {
        for (const stored of list)
        {
            if (stored.id === bonusId)
                return { stored, source };
            if (stored.type === 'multi' && typeof bonusId === 'string' && bonusId.startsWith(`${stored.id}_sub_`))
                return { stored, source };
        }
        return null;
    };
    return search(getLAFlag(actor,'global_bonuses') || [], 'global')
        ?? search(getLAFlag(actor,'constant_bonuses') || [], 'constant');
}

// Burn one use of a bonus (dual-write uses + linked AE); removes it when exhausted. Auto-consume-triggered bonuses are skipped (their charges belong to the trigger engine).
/** @returns {Promise<string|false>} The consumed bonus id, or false if nothing was spent */
export async function consumeBonusUse(actor, bonus, { removeWhenNoUses = false } = {})
{
    if (!actor || !bonus?.id)
        return false;
    const found = _findStoredBonus(actor, bonus.id);
    if (!found)
        return false;
    const { stored, source } = found;
    const linkedEffect = /** @type {any} */ (Array.from(actor.effects ?? []).find(effect =>
        getLAFlags(effect)?.linkedBonusId === stored.id));
    if (getLAFlags(linkedEffect)?.consumption?.trigger)
        return false;
    const currentUses = typeof stored.uses === 'number' ? stored.uses : null;
    if (currentUses === null && !removeWhenNoUses)
        return false;
    if (currentUses !== null && currentUses > 1)
    {
        const newUses = currentUses - 1;
        if (source === 'constant')
            await addConstantBonus(actor, { ...stored, uses: newUses });
        else
        {
            const bonuses = getLAFlag(actor,'global_bonuses') || [];
            const updated = bonuses.map(existing => existing.id === stored.id ? { ...existing, uses: newUses } : existing);
            await setLAFlag(actor,'global_bonuses', updated);
            if (linkedEffect)
                await linkedEffect.update({ 'flags.statuscounter.value': newUses });
        }
        await _persistBonusUsesToTemplate(actor, stored, newUses);
        return stored.id;
    }
    await _persistBonusUsesToTemplate(actor, stored, 0);
    if (source === 'global')
        await removeGlobalBonus(actor, stored.id, false);
    else
        await removeConstantBonus(actor, stored.id);
    return stored.id;
}

/**
 * @param {any} actor
 * @param {string} subtype
 * @param {any} [state]
 * @param {object} [options]
 * @param {string[]|null} [options.damageTypes] Only consider bonuses covering one of these damage types
 * @param {object[]|null} [options.bonuses] Prefiltered candidates, skips the flag re-read
 * @param {boolean} [options.aoe] Area damage, so "AoE" entries match
 * @returns {Promise<boolean>} True if a charge was spent
 */
export async function consumeImmunityUse(actor, subtype, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    if (DAMAGE_DEFENSE_TYPES.has(subtype))
    {
        warnDeprecated(_legacyDefenseMessage(subtype));
        return _consumeDefenseUse(actor, bonuses ?? _getTypedBonuses(actor, subtype, state), state, { damageTypes, aoe });
    }
    return _consumeDefenseUse(actor, bonuses ?? getImmunityBonuses(actor, subtype, state), state, { damageTypes, aoe });
}

export async function consumeResistanceUse(actor, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    return _consumeDefenseUse(actor, bonuses ?? getResistanceBonuses(actor, state), state, { damageTypes, aoe });
}

export async function consumeVulnerabilityUse(actor, state = null, { damageTypes = null, bonuses = null, aoe = false } = {})
{
    if (!actor)
        return false;
    return _consumeDefenseUse(actor, bonuses ?? getVulnerabilityBonuses(actor, state), state, { damageTypes, aoe });
}

async function _consumeDefenseUse(actor, candidates, state, { damageTypes, aoe })
{
    const wanted = damageTypes?.map(type => String(type).toLowerCase());
    const matchesType = (bonus) => !wanted || !bonus.damageTypes || bonus.damageTypes.some(type =>
    {
        const lower = String(type).toLowerCase();
        return lower === 'all' || lower === 'variable' || wanted.includes(lower) || (aoe && lower === 'aoe');
    });

    const pool = candidates.filter(matchesType);
    let spent = false;
    const burnedKeys = new Set();
    for (const bonus of pool)
    {
        const key = bonus.frequencyKey ?? bonus.id;
        if (burnedKeys.has(key) || bonusHasAutoConsume(actor, key))
            continue;
        if (await burnBonusFrequency(bonus, state))
        {
            spent = true;
            burnedKeys.add(key);
        }
    }
    for (const bonus of pool.filter(bonus => bonus.consumeOnUsage === true))
    {
        if (await consumeBonusUse(actor, bonus, { removeWhenNoUses: true }))
            return true;
    }
    return spent;
}

// Post-roll pass: burn "consume on usage" bonuses that actually applied in this flow.
export async function burnBonusUsageForFlow(state)
{
    const usage = state?.la_extraData?.bonusUsage;
    const actor = state?.actor;
    if (!usage || !actor)
        return;
    const burnedFrequencyKeys = new Set();
    for (const candidate of Object.values(usage.candidates))
    {
        if (!supportsConsumeOnUsage(candidate.type, candidate.subtype))
            continue;
        // Immunities burn where they are consulted, not on the bearer's own roll.
        if (DEFENSE_TYPES.has(candidate.type))
            continue;
        const consumesUses = candidate.consumeOnUsage !== false;
        if (!candidate.frequency && (!consumesUses || typeof candidate.uses !== 'number'))
            continue;
        if ([...usage.burned].some(id => candidate.id === id || String(candidate.id).startsWith(`${id}_sub_`)))
            continue;
        let used = false;
        if (candidate.bucket === 'acc')
            used = usage.enabledById.get(candidate.id) !== false;
        else if (candidate.bucket === 'targeted')
        {
            const mode = usage.appliedMode?.get(candidate.id);
            if (mode === 'base')
                used = usage.enabledById.get(candidate.id) !== false;
            else if (mode === 'target')
            {
                const targets = state.data?.acc_diff?.targets ?? [];
                const matchedIds = usage.appliedTargetIds?.get(candidate.id) ?? candidate.applyTo ?? [];
                used = targets.some(entry =>
                {
                    const tokenId = accDiffTargetToken(entry)?.id;
                    return tokenId && matchedIds.includes(tokenId) && !usage.disabledByUser?.has(`${candidate.id}:${tokenId}`);
                });
            }
        }
        else if (candidate.bucket === 'tmod')
            used = (usage.modEnabled?.get(candidate.id || candidate.subtype)) !== false;
        else
            used = usage.dmgEnabled.get(candidate.id) !== false;
        if (!used)
            continue;
        const frequencyKey = candidate.frequencyKey ?? candidate.id;
        if (candidate.frequency && !burnedFrequencyKeys.has(frequencyKey) && !bonusHasAutoConsume(actor, frequencyKey))
        {
            burnedFrequencyKeys.add(frequencyKey);
            await burnBonusFrequency(candidate, state);
        }
        if (!consumesUses)
            continue;
        const storedId = await consumeBonusUse(actor, candidate, { removeWhenNoUses: candidate.consumeOnUsage === true });
        if (storedId)
            usage.burned.add(storedId);
    }
}

async function _cleanupBonusRuntimes(actor, predicate)
{
    if (!actor)
        return;
    const globals = /** @type {any[]} */ (getLAFlag(actor,'global_bonuses') || [])
        .filter(predicate);
    for (const runtime of globals)
    {
        try
        {
            await _persistBonusUsesToTemplate(actor, runtime);
        }
        catch (err)
        {
            console.warn('lancer-automations | bonus cleanup persist:', err);
        }
        try
        {
            await removeGlobalBonus(actor, runtime.id, false);
        }
        catch (err)
        {
            console.warn('lancer-automations | bonus cleanup remove:', err);
        }
    }
    const constants = /** @type {any[]} */ (getLAFlag(actor,'constant_bonuses') || []);
    if (constants.some(predicate))
    {
        const remaining = constants.filter(bonus => !predicate(bonus));
        try
        {
            await delegateSetActorFlag(actor, MODULE_ID,'constant_bonuses', remaining);
        }
        catch (err)
        {
            console.warn('lancer-automations | constant cleanup failed:', err);
        }
    }
}

/**
 * Cleanup runtime bonuses on `actor` that originated from a foreign source.
 * @param {Actor} actor
 * @param {Function} isForeignSource
 */
// Duplicated tokens copy runtime bonuses stamped with the ORIGINAL token's uuids; purge those.
export async function cleanupForeignBonusRuntimes(actor, isForeignSource)
{
    await _cleanupBonusRuntimes(actor, bonus =>
    {
        const source = bonus.sourceItemUuid ?? bonus.sourceActorUuid;
        return source ? isForeignSource(source) : false;
    });
}

/** @returns {Promise<void>} */
export async function cleanupItemBonusesFromActor(item, actor)
{
    await _cleanupBonusRuntimes(actor, bonus => bonus.sourceItemUuid === item.uuid);
}

/**
 * Cleanup runtime bonuses on all active-token actors originating from an actor template on `actor`.
 * @param {any} actor
 * @returns {Promise<void>}
 */
export async function cleanupActorBonusesFromTokens(actor)
{
    const tokens = actor?.getActiveTokens?.() ?? [];
    for (const token of tokens)
    {
        if (token?.actor)
            await _cleanupBonusRuntimes(token.actor, bonus => bonus.sourceActorUuid === actor.uuid);
    }
}

async function _cleanupItemBonusTemplateFromActor(item, actor, templateId)
{
    if (!actor)
        return;
    const runtimeId = _bonusTemplateRuntimeId(item, templateId);
    await _cleanupBonusRuntimes(actor, bonus => bonus.id === runtimeId);
}

async function _cleanupActorBonusTemplateFromTokens(actor, templateId)
{
    const runtimeId = _bonusTemplateRuntimeId(actor, templateId);
    const tokens = actor?.getActiveTokens?.() ?? [];
    for (const token of tokens)
    {
        const target = token?.actor;
        if (!target)
            continue;
        await _cleanupBonusRuntimes(target, bonus => bonus.id === runtimeId);
    }
}

/**
 * Stamp a bonus template on each item and immediately materialize on parent-actor tokens.
 * @param {Object} options
 * @param {any[]} options.items
 * @param {Object} options.bonusData
 * @param {Object} [options.addOptions]
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped { item, templateId } pairs
 */
export async function linkBonusToItem(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { items = [], bonusData, addOptions = {} } = /** @type {any} */ (options);
    if (!bonusData)
        return [];
    const serialized = serializeBonusLambdas(_acceptBonusInput(bonusData));
    const stamped = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { addedViaUI: false, ...addOptions, ...extraOptions } };
        const existing = getLAFlag(item,'bonusTemplates') || [];
        await setLAFlag(item,'bonusTemplates', [...existing, template]);
        stamped.push({ item, templateId });
        const parent = item.parent;
        if (parent?.documentName === 'Actor')
            await applyItemBonusTemplatesToTokens(item, parent.getActiveTokens?.() ?? []);
    }
    return stamped;
}

/**
 * linkBonusToItem, but idempotent: skips items already carrying a template with the same bonusData.id.
 * Requires bonusData.id.
 * @param {Object} options  Same shape as linkBonusToItem
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped {item, templateId} pairs; empty when every item already had it
 */
export async function ensureLinkedBonus(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { items = [], bonusData } = /** @type {any} */ (options);
    if (!bonusData?.id)
    {
        console.warn("lancer-automations | ensureLinkedBonus: bonusData.id is required for dedupe.");
        return linkBonusToItem(options, extraOptions);
    }
    const missing = items.filter(item => item?.documentName === 'Item'
        && !(getLAFlag(item,'bonusTemplates') || []).some(template => template.bonusData?.id === bonusData.id));
    if (!missing.length)
        return [];
    return linkBonusToItem({ ...options, items: missing }, extraOptions);
}

/**
 * Stamp a bonus template on each actor (prototype) and immediately materialize on active tokens.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {Object} options.bonusData
 * @param {Object} [options.addOptions]
 * @param {Object} [extraOptions]
 * @returns {Promise<any[]>} Stamped { actor, templateId } pairs
 */
export async function linkBonusToActor(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { actors = [], bonusData, addOptions = {} } = /** @type {any} */ (options);
    if (!bonusData)
        return [];
    const serialized = serializeBonusLambdas(_acceptBonusInput(bonusData));
    const stamped = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const templateId = foundry.utils.randomID();
        const template = { id: templateId, bonusData: /** @type {any} */ ({ ...serialized }), addOptions: { ...addOptions, ...extraOptions } };
        const existing = getLAFlag(actor,'bonusTemplates') || [];
        await setLAFlag(actor,'bonusTemplates', [...existing, template]);
        stamped.push({ actor, templateId });
        await applyActorBonusTemplatesToTokens(actor, actor.getActiveTokens?.() ?? []);
    }
    return stamped;
}

/**
 * Pop templates matching `templateId` from each item's bonusTemplates; cascade cleanup on parent actor.
 * @param {Object} options
 * @param {any[]} options.items
 * @param {string} options.templateId
 * @returns {Promise<any[]>} The removed bonus templates
 */
export async function unlinkBonusFromItem(options = /** @type {any} */ ({}))
{
    const { items = [], templateId } = /** @type {any} */ (options);
    if (!templateId)
        return [];
    const removed = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const existing = getLAFlag(item,'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await setLAFlag(item,'bonusTemplates', filtered);
        const parent = item.parent;
        if (parent?.documentName === 'Actor')
            await _cleanupItemBonusTemplateFromActor(item, parent, templateId);
        removed.push({ item, templateId });
    }
    return removed;
}

/**
 * Pop templates matching `templateId` from each actor's bonusTemplates; cascade cleanup on all tokens.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {string} options.templateId
 * @returns {Promise<any[]>} The removed bonus templates
 */
export async function unlinkBonusFromActor(options = /** @type {any} */ ({}))
{
    const { actors = [], templateId } = /** @type {any} */ (options);
    if (!templateId)
        return [];
    const removed = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const existing = getLAFlag(actor,'bonusTemplates') || [];
        const filtered = existing.filter(template => template.id !== templateId);
        if (filtered.length === existing.length)
            continue;
        await setLAFlag(actor,'bonusTemplates', filtered);
        await _cleanupActorBonusTemplateFromTokens(actor, templateId);
        removed.push({ actor, templateId });
    }
    return removed;
}

/** @returns {void} */
export function executeGenericBonusMenu(actor = null)
{
    executeEffectManager({ initialTab: 'bonus', actor });
}

const IMMUNITY_SUBTYPES = new Set(['effect', 'damage', 'crit', 'hit', 'miss', 'elevation', 'terrain', 'obstacle', 'provoke']);
const DAMAGE_DEFENSE_TYPES = new Set(['resistance', 'vulnerability']);
const DEFENSE_TYPES = new Set(['immunity', 'resistance', 'vulnerability']);
let _deprecationNotified = false;

function warnDeprecated(message)
{
    console.warn(`lancer-automations | ${message}`);
    if (_deprecationNotified)
        return;
    _deprecationNotified = true;
    ui.notifications?.warn(localizeFormat('LA.notify.deprecatedApi', { message }));
}

function _isLegacyDefense(bonus)
{
    return bonus?.type === 'immunity' && DAMAGE_DEFENSE_TYPES.has(bonus.subtype);
}

function _legacyDefenseMessage(subtype)
{
    const getter = subtype === 'resistance' ? 'getResistanceBonuses' : 'getVulnerabilityBonuses';
    return `Immunity subtype "${subtype}" is deprecated. Use the "${subtype}" bonus type ({ type: '${subtype}' }) and ${getter}.`;
}

export function normalizeBonusShape(bonus)
{
    if (_isLegacyDefense(bonus))
    {
        const { subtype, ...rest } = bonus;
        return { ...rest, type: subtype };
    }
    if (bonus?.type === 'multi' && Array.isArray(bonus.bonuses) && bonus.bonuses.some(_isLegacyDefense))
        return { ...bonus, bonuses: bonus.bonuses.map(normalizeBonusShape) };
    return bonus;
}

function _acceptBonusInput(bonusData)
{
    const legacy = _isLegacyDefense(bonusData)
        ? bonusData
        : (bonusData?.type === 'multi' && Array.isArray(bonusData.bonuses) ? bonusData.bonuses.find(_isLegacyDefense) : null);
    if (!legacy)
        return bonusData;
    warnDeprecated(_legacyDefenseMessage(legacy.subtype));
    return normalizeBonusShape(bonusData);
}

const BONUS_FREQUENCY_GATES = { round: { ownTurn: true }, turn: { turn: true }, combat: { rounds: null } };
const BONUS_MISSION_FLAG = 'bonusMissionUses';

function bonusGateOwner(bonus, state)
{
    const tokenId = bonus?.context?.ownerTokenId;
    if (tokenId)
        return canvas.tokens?.get(tokenId) ?? null;
    return state?.actor ?? null;
}

function bonusFrequencyCount(bonus)
{
    return Math.max(1, Number.parseInt(bonus?.frequencyCount) || 1);
}

function bonusFrequencySlots(bonus)
{
    return Array.from({ length: bonusFrequencyCount(bonus) }, (_unused, index) => (index === 0 ? null : `use${index + 1}`));
}

function bonusFrequencyKey(bonus)
{
    return bonus?.frequencyKey ?? bonus?.id;
}

function bonusMissionUsed(owner, bonus)
{
    const actor = owner?.actor ?? owner;
    return Number(getLAFlag(actor, BONUS_MISSION_FLAG)?.[bonusFrequencyKey(bonus)] ?? 0);
}

/** False when the bonus has a frequency and its gate is already taken. */
export function bonusFrequencyFree(bonus, state = null)
{
    if (bonus?.frequency === 'mission')
    {
        const owner = bonusGateOwner(bonus, state);
        return !owner || bonusMissionUsed(owner, bonus) < bonusFrequencyCount(bonus);
    }
    if (!bonus?.frequency || !BONUS_FREQUENCY_GATES[bonus.frequency])
        return true;
    const owner = bonusGateOwner(bonus, state);
    return !owner || bonusFrequencySlots(bonus).some(slot => checkGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, slot));
}

function bonusFrequencyUsed(bonus, owner)
{
    if (bonus?.frequency === 'mission')
        return Math.min(bonusMissionUsed(owner, bonus), bonusFrequencyCount(bonus));
    return bonusFrequencySlots(bonus).filter(slot => !checkGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, slot)).length;
}

const LIMIT_PERIOD_SHORT = { round: 'round', turn: 'turn', combat: 'encounter', mission: 'mission' };

export function bonusUsageParts(bonus, state, limitReached = false)
{
    const parts = [];
    if (bonus.uses !== undefined)
        parts.push({ text: `${bonus.uses} left` });
    const period = LIMIT_PERIOD_SHORT[bonus.frequency];
    const owner = period ? bonusGateOwner(bonus, state) : null;
    if (owner)
        parts.push({ text: `${Math.max(0, bonusFrequencyCount(bonus) - bonusFrequencyUsed(bonus, owner))}/${bonusFrequencyCount(bonus)} ${period}`, limit: limitReached });
    return parts;
}

function bonusHasAutoConsume(actor, bonusId)
{
    return !!actor?.effects?.some(effect => getLAFlag(effect, 'linkedBonusId') === bonusId && getLAFlags(effect)?.consumption?.trigger);
}

export function linkedBonusOf(actor, effect)
{
    const bonusId = getLAFlags(effect)?.linkedBonusId;
    return bonusId ? (getLAFlag(actor, 'global_bonuses') || []).find((/** @type {any} */ bonus) => bonus.id === bonusId) ?? null : null;
}

export function attachmentOrigin(addedViaUI)
{
    if (addedViaUI === true)
        return 'hand';
    return addedViaUI === false ? 'automation' : 'unknown';
}

export function itemAttachmentOrigin(record)
{
    if (record?.documentName === 'ActiveEffect')
    {
        const bonus = linkedBonusOf(record.parent, record);
        if (bonus)
            return itemAttachmentOrigin(bonus);
        const flags = getLAFlags(record);
        if (!flags?.sourceItemUuid)
            return null;
        const template = /** @type {any} */ (fromUuidSync(flags.sourceItemUuid))?.effects?.get?.(flags.sourceTemplateId);
        return attachmentOrigin(getLAFlags(template)?.addedViaUI);
    }
    if (!record?.sourceItemUuid)
        return null;
    const templates = getLAFlag(/** @type {any} */ (fromUuidSync(record.sourceItemUuid)), 'bonusTemplates') || [];
    return attachmentOrigin(templates.find((/** @type {any} */ template) => template.id === record.sourceTemplateId)?.addOptions?.addedViaUI);
}

async function takeBonusFrequency(bonus, owner)
{
    if (bonus?.frequency === 'mission')
    {
        const actor = owner?.actor ?? owner;
        const used = bonusMissionUsed(actor, bonus);
        if (used >= bonusFrequencyCount(bonus))
            return false;
        await delegateSetActorFlag(actor, MODULE_ID, BONUS_MISSION_FLAG, { ...(getLAFlag(actor, BONUS_MISSION_FLAG) ?? {}), [bonusFrequencyKey(bonus)]: used + 1 });
        return true;
    }
    const options = BONUS_FREQUENCY_GATES[bonus?.frequency];
    if (!options)
        return false;
    for (const slot of bonusFrequencySlots(bonus))
    {
        if (await consumeGate(owner, `bonus:${bonusFrequencyKey(bonus)}`, { ...options, subject: slot }))
            return true;
    }
    return false;
}

/** Take the bonus's frequency gate, recording it on the flow so reactions can see it fired. */
export async function burnBonusFrequency(bonus, state = null)
{
    if (bonus?.frequency !== 'mission' && !BONUS_FREQUENCY_GATES[bonus?.frequency])
        return false;
    const owner = bonusGateOwner(bonus, state);
    if (!owner)
        return false;
    const taken = await takeBonusFrequency(bonus, owner);
    if (taken && state)
    {
        state.la_extraData = state.la_extraData || {};
        const ids = [bonus.id, bonus.sourceBonusId].filter(Boolean);
        state.la_extraData.burnedFrequency = [...new Set([...(state.la_extraData.burnedFrequency ?? []), ...ids])];
    }
    return taken;
}

async function resetBonusMissionUsesStep(state)
{
    const actor = state?.actor;
    const used = actor ? getLAFlag(actor, BONUS_MISSION_FLAG) : null;
    if (used && Object.values(used).some(count => Number(count) > 0))
        await delegateSetActorFlag(actor, MODULE_ID, BONUS_MISSION_FLAG, Object.fromEntries(Object.keys(used).map(key => [key, 0])));
    return true;
}

export function registerBonusFrequencyFlowSteps(flowSteps, flows)
{
    const step = 'lancer-automations:resetBonusMissionUses';
    flowSteps.set(step, resetBonusMissionUsesStep);
    const flow = flows.get('FullRepairFlow');
    if (flow?.steps?.includes('executeFullRepair') && !flow.steps.includes(step))
        flow.insertStepAfter('executeFullRepair', step);
}

const DAMAGE_TYPE_WILDCARDS = new Set(['all', 'variable']);
const CONCRETE_DAMAGE_TYPES = ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat'];

/** Lower-cased damage types a bonus covers, wildcards expanded. */
function expandDamageTypes(damageTypes, aoe = false)
{
    const out = new Set();
    for (const entry of damageTypes ?? [])
    {
        const lower = String(entry).toLowerCase().trim();
        if (!lower || (lower === 'aoe' && !aoe))
            continue;
        if (!DAMAGE_TYPE_WILDCARDS.has(lower) && lower !== 'aoe')
        {
            out.add(lower);
            continue;
        }
        CONCRETE_DAMAGE_TYPES.forEach(type => out.add(type));
        if (getModuleSetting('enableInfectionDamageIntegration'))
            out.add('infection');
    }
    return [...out];
}

/**
 * @param {any} actor Actor, Token or TokenDocument
 * @param {string|null} [subtype] omit for every immunity bonus
 * @returns {object[]}
 */
export function getImmunityBonuses(actor, subtype = null, state = null)
{
    if (DAMAGE_DEFENSE_TYPES.has(subtype))
    {
        warnDeprecated(_legacyDefenseMessage(subtype));
        return _getTypedBonuses(actor, subtype, state);
    }
    actor = actor?.actor ?? actor;
    if (!actor?.getFlag)
        return [];
    if (subtype && !IMMUNITY_SUBTYPES.has(subtype))
        console.warn(`lancer-automations | getImmunityBonuses: unknown subtype "${subtype}"`);

    return _bonusPool(actor, state, !subtype || subtype === 'damage' || subtype === 'effect')
        .filter(bonus => bonus.type === "immunity" && (!subtype || bonus.subtype === subtype) && linkTierGate(bonus, actor));
}

function _bonusPool(actor, state, withData = false)
{
    const constants = withoutSwitchedOff(actor, getLAFlag(actor,"constant_bonuses") || []);
    const globals = withoutSwitchedOff(actor, getLAFlag(actor,"global_bonuses") || []);
    const ephemerals = getLAFlag(actor,"ephemeral_bonuses") || [];
    const flowBonuses = state?.la_extraData?.flow_bonus || [];
    const dataBonuses = withData ? _v3DefenseRows(actor).filter(row => !row.off && !row.inactive && !row.replaced).map(row => row.bonus) : [];
    return flattenBonuses([...constants, ...globals, ...ephemerals, ...flowBonuses, ...dataBonuses])
        .filter(bonus => !bonus.dataCondition || v3ConditionMet(bonus.dataCondition, actor));
}

function _getTypedBonuses(actor, type, state)
{
    actor = actor?.actor ?? actor;
    if (!actor?.getFlag)
        return [];
    return _bonusPool(actor, state, true).filter(bonus => bonus.type === type && linkTierGate(bonus, actor));
}

function _v3SourceActive(item, path, actor)
{
    const segments = String(path ?? '').split('.');
    if (segments[0] === 'core_system' && segments.some(segment => segment.startsWith('active_')) && !actor?.system?.core_active)
        return false;
    if (item.type === 'reserve' && item.system?.used)
        return false;
    return !isItemCascading(item);
}

function _v3DefenseRows(actor)
{
    const off = itemBonusOffIds(actor);
    const rows = [];
    for (const { item, row: { bonus, path, reactionPath, condition, duration } } of v3ActorRows(actor))
    {
        if (!duration && isItemAvailable(item, reactionPath) && _v3SourceActive(item, path, actor))
            rows.push({ bonus, item, off: off.has(bonus.id), inactive: !v3ConditionMet(condition, actor), replaced: isV3DataReplaced(item, path) });
    }
    return rows;
}

export function getV3DataBonuses(actor, types = null)
{
    actor = actor?.actor ?? actor;
    if (!actor?.items)
        return [];
    const wanted = types ? new Set(types) : null;
    return _v3DefenseRows(actor).filter(row => !row.off && !row.inactive && !row.replaced && (!wanted || wanted.has(row.bonus.type)));
}

function grantedActionExtras(actor)
{
    const totals = Object.fromEntries(EXTRA_ACTION_KINDS.map(kind => [kind, 0]));
    const dataBonuses = getV3DataBonuses(actor, ['action_extra']).map(row => row.bonus);
    for (const bonus of flattenBonuses([...getGlobalBonuses(actor), ...getConstantBonuses(actor), ...dataBonuses]))
    {
        if (bonus.type !== 'action_extra' || !EXTRA_ACTION_KINDS.includes(bonus.subtype) || (bonus.dataCondition && !v3ConditionMet(bonus.dataCondition, actor)))
            continue;
        totals[bonus.subtype] += Math.max(0, Number(bonus.val ?? 1) || 0);
    }
    return totals;
}

setActionExtrasProvider(grantedActionExtras);

async function _applyV3TimedDefenses(actor, token)
{
    for (const { item, row: { bonus, path, reactionPath, duration } } of v3ActorRows(actor))
    {
        if (!duration || !isItemAvailable(item, reactionPath) || !_v3SourceActive(item, path, actor) || isV3DataReplaced(item, path))
            continue;
        const timedId = `${bonus.id}_timed`;
        if ((getLAFlag(actor, 'global_bonuses') || []).some((/** @type {any} */ existing) => existing.id === timedId))
            continue;
        await addGlobalBonus(actor, { ...foundry.utils.deepClone(bonus), id: timedId }, v3BonusDurationOptions(duration, token));
    }
}

export function initV3TimedDefenses()
{
    Hooks.on('combatStart', async (/** @type {any} */ combat) =>
    {
        if (!isExecutorGM())
            return;
        for (const combatant of combat.combatants)
            await _applyV3TimedDefenses(combatant.actor, combatant.token?.object ?? null);
    });
    Hooks.on('createCombatant', async (combatant) =>
    {
        if (isExecutorGM() && combatant.combat?.started)
            await _applyV3TimedDefenses(combatant.actor, combatant.token?.object ?? null);
    });
}

export function getV3DefenseRows(actor)
{
    if (actor?.documentName === 'Item')
        return [];
    actor = actor?.actor ?? actor;
    return actor?.items ? _v3DefenseRows(actor) : [];
}

const ITEM_BONUS_OFF_FLAG = 'v3Off';

function itemBonusOffIds(actor)
{
    return new Set(getLAFlag(actor, ITEM_BONUS_OFF_FLAG) || []);
}

export function withoutSwitchedOff(actor, bonuses)
{
    const off = itemBonusOffIds(actor);
    return off.size ? bonuses.filter((/** @type {any} */ bonus) => !(bonus?.sourceItemUuid && off.has(bonus.id))) : bonuses;
}

export function isItemBonusOff(actor, bonus)
{
    return !!bonus?.sourceItemUuid && itemBonusOffIds(actor?.actor ?? actor).has(bonus.id);
}

export async function setItemBonusOff(actor, bonusId, off)
{
    actor = actor?.actor ?? actor;
    if (!actor || !bonusId)
        return;
    const current = itemBonusOffIds(actor);
    if (off)
        current.add(bonusId);
    else
        current.delete(bonusId);
    await delegateSetActorFlag(actor, MODULE_ID, ITEM_BONUS_OFF_FLAG, [...current]);
    const linked = /** @type {any[]} */ ([...(actor.effects ?? [])]).filter(effect => getLAFlag(effect, 'linkedBonusId') === bonusId && effect.disabled !== off);
    if (linked.length)
        await actor.updateEmbeddedDocuments('ActiveEffect', linked.map(effect => ({ _id: effect.id, disabled: off })));
}

export function getResistanceBonuses(actor, state = null)
{
    return _getTypedBonuses(actor, 'resistance', state);
}

export function getVulnerabilityBonuses(actor, state = null)
{
    return _getTypedBonuses(actor, 'vulnerability', state);
}

// Only source for reactorToken in condition lambdas.
function withOwnerContext(bonus, ownerTokenId)
{
    if (!ownerTokenId || bonus.context?.ownerTokenId)
        return bonus;
    return { ...bonus, context: { ...bonus.context, ownerTokenId } };
}

/**
 * Immunity bonuses that also pass their rollTypes / itemLids / condition / applyToCondition filters.
 * Unfiltered when no state is given. `state.actor` is the other party.
 * @param {any} actor Actor, Token or TokenDocument holding the immunity
 * @param {string} subtype
 * @param {any} [state] flow state
 * @param {object} [options]
 * @param {string} [options.flowType] tag set to build
 * @param {string|null} [options.ownerTokenId] bearer token, the `reactorToken` of applyToCondition
 * @param {any} [options.otherToken] other party, the `target` of applyToCondition
 * @returns {object[]}
 */
export function getApplicableImmunityBonuses(actor, subtype, state = null, { flowType = 'damage', ownerTokenId = null, otherToken = null } = {})
{
    return _applicableBonuses(getImmunityBonuses(actor, subtype, state), state, { flowType, ownerTokenId, otherToken });
}

export function getApplicableDefenseBonuses(actor, type, state = null, { flowType = 'damage', ownerTokenId = null, otherToken = null } = {})
{
    return _applicableBonuses(_getTypedBonuses(actor, type, state), state, { flowType, ownerTokenId, otherToken });
}

function _applicableBonuses(bonuses, state, { flowType, ownerTokenId, otherToken })
{
    if (!state || bonuses.length === 0)
        return bonuses;
    const tags = getFlowTags(flowType, state);
    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    // No other party means nothing for applyToCondition to judge, so the immunity stands.
    return bonuses.map(bonus => withOwnerContext(bonus, ownerTokenId)).filter(bonus =>
        isBonusApplicable(bonus, tags, state)
        && (!otherToken || runApplyToCondition(bonus, otherToken, state, ownerToken)));
}

/** @returns {string[]} array of immunity source names; empty if not immune */
// These gates are not flows, so the item and roll-type filters are dropped rather than failed.
function passesGateFilters(bonus, state, ownerTokenId, otherToken)
{
    const gateState = state ?? { actor: otherToken?.actor ?? null, data: {} };
    const gated = withOwnerContext({ ...bonus, rollTypes: null, itemLids: null, itemId: null }, ownerTokenId);
    if (!isBonusApplicable(gated, new Set(['all']), gateState))
        return false;
    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    return !otherToken || runApplyToCondition(bonus, otherToken, gateState, ownerToken);
}

/**
 * Immunity bonuses passing their condition / applyToCondition gates outside a flow.
 * Unfiltered when no context is supplied, so liveness checks keep the fast path.
 * @param {any} actor bearer
 * @param {string} subtype
 * @param {object} [context]
 * @param {any} [context.ownerToken] bearer token, the `reactorToken` of applyToCondition
 * @param {any} [context.otherToken] other party, the `target` of applyToCondition
 * @param {any} [context.state]
 * @returns {object[]}
 */
export function getGateImmunityBonuses(actor, subtype, { ownerToken = null, otherToken = null, state = null } = {})
{
    const bonuses = getImmunityBonuses(actor, subtype, state);
    if (bonuses.length === 0 || !(state || ownerToken || otherToken))
        return bonuses;
    return bonuses.filter(bonus => passesGateFilters(bonus, state, ownerToken?.id ?? null, otherToken));
}

/**
 * Effect-immunity bonuses matching that status, after their condition / applyToCondition gates.
 * @param {any} actor bearer
 * @param {string} effectIdOrName
 * @param {any} [effect] the ActiveEffect being applied, widens the match
 * @param {any} [state] flow state, when one exists
 * @param {object} [tokens]
 * @param {string|null} [tokens.ownerTokenId] bearer token id
 * @param {any} [tokens.otherToken] whoever applied the status, when known
 * @returns {object[]}
 */
export function getEffectImmunityBonuses(actor, effectIdOrName, effect = null, state = null, { ownerTokenId = null, otherToken = null } = {})
{
    if (!actor || !effectIdOrName)
        return [];

    const ownerToken = ownerTokenId ? canvas.tokens.get(ownerTokenId) ?? null : null;
    const effectImmunities = getGateImmunityBonuses(actor, "effect", { ownerToken, otherToken, state });
    const matched = [];

    const incomingLower = effectIdOrName.toLowerCase();
    const incomingTail = incomingLower.split('.').pop();

    for (const immunity of effectImmunities)
    {
        if (!immunity.effects || !Array.isArray(immunity.effects))
            continue;

        const isImmune = immunity.effects.some(immuneName =>
        {
            const immuneLower = immuneName.toLowerCase();
            const immuneTail = immuneLower.split('.').pop();

            // 1. Exact string matches
            if (immuneLower === incomingLower || immuneTail === incomingTail)
                return true;

            // 2. Inclusion checks (handles path-based vs simple names)
            if (immuneLower.includes(incomingTail) || incomingLower.includes(immuneTail))
                return true;

            // 3. If ActiveEffect is provided, check its native statuses and flags
            if (effect)
            {
                if (effect.statuses?.has(immuneTail) || effect.statuses?.has(immuneLower))
                    return true;

                const flagName = getLAFlag(effect,'effect') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'effect') : null);
                if (flagName)
                {
                    const flagLower = flagName.toLowerCase();
                    if (flagLower === immuneLower || flagLower.includes(immuneTail))
                        return true;
                }
            }

            return false;
        });

        if (isImmune)
            matched.push(immunity);
    }

    return matched;
}

/** @returns {string[]} array of immunity source names; empty if not immune */
export function checkEffectImmunities(actor, effectIdOrName, effect = null, state = null, tokens = {})
{
    return getEffectImmunityBonuses(actor, effectIdOrName, effect, state, tokens)
        .map(bonus => bonus.source || bonus.name || "Unknown Immunity");
}

/** @returns {boolean} true when the bonus is gated on something only a flow can answer */
export function hasBonusFilters(bonus)
{
    return !!(bonus?.rollTypes?.length || bonus?.itemLids?.length || bonus?.itemId || bonus?.condition || bonus?.applyToCondition);
}

function _damageBonusesCovering(actor, type, damageType, allowedIds, aoe)
{
    if (!actor || !damageType)
        return [];
    const incomingLower = damageType.toLowerCase();
    return _getTypedBonuses(actor, type, null)
        .filter(bonus => !allowedIds || !hasBonusFilters(bonus) || !bonus.id || allowedIds.includes(bonus.id))
        .filter(bonus => bonus.damageTypes && bonus.damageTypes.some(type => type.toLowerCase() === incomingLower || type.toLowerCase() === "variable" || type.toLowerCase() === "all" || (aoe && type.toLowerCase() === "aoe")));
}

/**
 * @param {any} actor
 * @param {string} damageType
 * @param {string[]|null} [allowedIds] ids that passed their filters in the damage flow; null skips the check
 * @param {boolean} [aoe] the damage came from an area attack
 * @returns {any[]} Resistance bonus source names matching that damage type
 */
export function checkDamageResistances(actor, damageType, allowedIds = null, aoe = false)
{
    return _damageBonusesCovering(actor, "resistance", damageType, allowedIds, aoe)
        .map(bonus => bonus.source || bonus.name || "Unknown Resistance");
}

export function checkDamageVulnerabilities(actor, damageType, allowedIds = null, aoe = false)
{
    return _damageBonusesCovering(actor, "vulnerability", damageType, allowedIds, aoe)
        .map(bonus => bonus.source || bonus.name || "Unknown Vulnerability");
}

export function bonusCoversDamage(bonus, aoe = false)
{
    return expandDamageTypes(bonus?.damageTypes, aoe).length > 0;
}

/** @returns {object[]} damages with immune types zeroed */
export function applyDamageImmunities(actor, damages, state = null, bonuses = null, aoe = false)
{
    if (!actor || !damages)
        return damages;

    const damageImmunities = bonuses ?? getImmunityBonuses(actor, "damage", state);
    if (damageImmunities.length === 0)
        return damages;

    const immuneTypes = new Set();
    for (const immunity of damageImmunities)
        expandDamageTypes(immunity.damageTypes, aoe).forEach(type => immuneTypes.add(type));

    return damages.map(dmg =>
    {
        if (immuneTypes.has(String(dmg.type).toLowerCase()))
        {
            const cloned = { ...dmg };
            if (cloned.val !== undefined)
                cloned.val = 0;
            if (cloned.amount !== undefined)
                cloned.amount = 0;
            return cloned;
        }
        return dmg;
    });
}

// Heat has no target on a heatless actor (pilot / bio NPC); Lancer's damageCalc does the same for pilots.
export function convertHeatToEnergyIfHeatless(actor, damages)
{
    if (!actor || !Array.isArray(damages))
        return damages;
    try
    {
        if (!getModuleSetting('convertHeatToEnergyOnHeatless'))
            return damages;
    }
    catch (_)
    {
        return damages;
    }
    const heatMax = actor.system?.heat?.max;
    const heatless = heatMax === undefined || heatMax === null || heatMax === 0;
    if (!heatless)
        return damages;
    return damages.map(dmg => (dmg?.type === 'Heat' ? { ...dmg, type: 'Energy' } : dmg));
}

/**
 * Applicable crit / hit / miss immunity bonuses held by the defender.
 * Unfiltered when the attacker is unknown, matching the old "no attacker means immune" rule.
 * @param {any} actor defender
 * @param {string} subtype crit, hit or miss
 * @param {any} [attackerActor]
 * @param {any} [state] the attack flow state
 * @param {object} [tokens]
 * @param {any} [tokens.defenderToken] bearer, the `reactorToken` of applyToCondition
 * @param {any} [tokens.attackerToken] the `target` of applyToCondition
 * @returns {object[]}
 */
export function getAttackImmunityBonuses(actor, subtype, attackerActor = null, state = null, { defenderToken = null, attackerToken = null } = {})
{
    if (!actor)
        return [];
    const raw = getImmunityBonuses(actor, subtype, state);
    if (raw.length === 0 || !attackerActor)
        return raw;
    const attackerState = state ? { ...state, actor: attackerActor } : { actor: attackerActor };
    return getApplicableImmunityBonuses(actor, subtype, attackerState, {
        flowType: 'attack',
        ownerTokenId: defenderToken?.id ?? null,
        otherToken: attackerToken
    });
}

/** @returns {Promise<boolean>} */
export async function hasCritImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "crit", attackerActor, state, tokens).length > 0;
}

/** @returns {Promise<boolean>} */
export async function hasHitImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "hit", attackerActor, state, tokens).length > 0;
}

/** @returns {Promise<boolean>} */
export async function hasMissImmunity(actor, attackerActor = null, state = null, tokens = {})
{
    return getAttackImmunityBonuses(actor, "miss", attackerActor, state, tokens).length > 0;
}


/**
 * Read bonus templates attached to an item or a prototype actor
 * (from `flags['lancer-automations'].bonusTemplates`).
 * @param {any} source  Item or Actor
 * @returns {any[]}
 */
export function getLinkedBonuses(source)
{
    if (!source)
        return [];
    return /** @type {any[]} */ (getLAFlag(source,'bonusTemplates') || []);
}

export const BonusesAPI = {
    addGlobalBonus,
    removeGlobalBonus,
    getGlobalBonuses,
    getGlobalBonus,
    consumeBonusUse,
    consumeImmunityUse,
    supportsConsumeOnUsage,
    addConstantBonus,
    removeConstantBonus,
    getConstantBonuses,
    linkBonusToItem,
    ensureLinkedBonus,
    linkBonusToActor,
    unlinkBonusFromItem,
    unlinkBonusFromActor,
    getLinkedBonuses,
    applyItemBonusTemplatesToTokens,
    applyActorBonusTemplatesToTokens,
    cleanupItemBonusesFromActor,
    cleanupActorBonusesFromTokens,
    executeGenericBonusMenu,
    getImmunityBonuses,
    getResistanceBonuses,
    getVulnerabilityBonuses,
    consumeResistanceUse,
    consumeVulnerabilityUse,
    getApplicableImmunityBonuses,
    getAttackImmunityBonuses,
    getGateImmunityBonuses,
    getEffectImmunityBonuses,
    checkEffectImmunities,
    applyDamageImmunities,
    checkDamageResistances,
    checkDamageVulnerabilities,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity,
    injectBonusToFlowState
};
