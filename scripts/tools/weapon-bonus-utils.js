import { flattenBonuses, isBonusApplicable, applyTagBonus, mutateRangeWithBonus, mutateDamageWithBonus, getConstantBonuses, getGlobalBonuses } from "../bonuses/genericBonuses.js";

const REACH_RANGE_TYPES = new Set(["Range", "Threat", "Line", "Burst", "Cone"]);

/** Returns the base { tags, range } for an item, handling mech_weapon profiles. Both arrays are shallow-cloned. */
function _getItemBaseData(item)
{
    let tags, range;
    if (item.type === "mech_weapon")
    {
        const profileIdx = item.system?.selected_profile_index ?? 0;
        const profile = item.system?.profiles?.[profileIdx];
        tags = profile?.all_tags ?? item.system?.tags ?? [];
        range = profile?.all_range ?? profile?.range ?? item.system?.range ?? [];
    }
    else
    {
        tags = item.system?.tags ?? [];
        range = item.system?.range ?? [];
    }
    return { tags: tags.map(tag => ({ ...tag })), range: range.map(rangeEntry => ({ ...rangeEntry })) };
}

/** Resolves input (Actor | Token | Item | mixed array) to { weapons, actor }. */
function _resolveWeaponsAndActor(input)
{
    const entries = Array.isArray(input) ? input.flat() : [input];
    const weapons = [];
    let actor = null;

    for (const entry of entries)
    {
        if (!entry)
            continue;
        if (entry.documentName === "Token" || entry.actor)
        {
            const entryActor = entry.actor;
            if (entryActor)
            {
                actor = actor ?? entryActor;
                weapons.push(..._getActorWeapons(entryActor));
            }
        }
        else if (entry.documentName === "Actor" || entry.items)
        {
            actor = actor ?? entry;
            weapons.push(..._getActorWeapons(entry));
        }
        else if (entry.system)
        {
            actor = actor ?? entry.parent ?? null;
            if (entry.type === "mech_weapon" || (entry.type === "npc_feature" && entry.system?.type === "Weapon"))
                weapons.push(entry);
        }
    }
    return { weapons, actor };
}

function _getActorWeapons(actor)
{
    return (actor?.items ?? []).filter(item =>
    {
        if (item.system?.destroyed)
            return false;
        return item.type === "mech_weapon" ||
            item.type === "pilot_weapon" ||
            (item.type === "npc_feature" && item.system?.type === "Weapon");
    });
}

/** Applies tag and range bonuses from actor onto the given arrays (mutates in-place). */
function _applyItemBonuses(item, actor, tags, range)
{
    if (!actor)
        return;
    const bonuses = flattenBonuses([
        ...getGlobalBonuses(actor),
        ...getConstantBonuses(actor)
    ]);
    const flowTags = new Set(["all", "attack"]);
    const state = { actor, item, data: { tags, range } };
    for (const bonus of bonuses)
    {
        if (!isBonusApplicable(bonus, flowTags, state))
            continue;
        if (bonus.type === "tag")
            applyTagBonus(state, bonus);
        if (bonus.type === "range")
            mutateRangeWithBonus(state, bonus);
    }
}

/** Weapon profiles with native Lancer + LA actor range bonuses merged; falls back for pilot weapons and profileless items.
 * @returns {any[]}
 */
export function getWeaponProfiles_WithBonus(weapon, actor)
{
    if (!weapon?.system)
        return [];
    const resolvedActor = actor ?? weapon.parent ?? null;
    const rawProfiles = weapon.system.profiles;

    if (rawProfiles?.length > 0)
    {
        return rawProfiles.map(profile =>
        {
            const base = (profile.all_range ?? profile.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
            const base_range = (profile.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
            const tags = (profile.all_tags ?? profile.tags ?? []).map(tag => ({ ...tag }));
            const workingDamage = (profile.all_damage ?? profile.damage ?? []).map(damageEntry => ({ ...damageEntry }));
            const base_damage = workingDamage.map(damageEntry => ({ ...damageEntry })); // snapshot for popup diff
            const bonusState = { actor: resolvedActor, item: weapon, data: { tags, range: base, damage: workingDamage } };
            const bonuses = flattenBonuses([
                ...getGlobalBonuses(resolvedActor),
                ...getConstantBonuses(resolvedActor)
            ]);
            const flowTags = new Set(["all", "attack"]);
            for (const bonus of bonuses)
            {
                if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, bonusState))
                    mutateRangeWithBonus(bonusState, bonus);
                else if (bonus.type === 'damage' && (bonus.damageMode === 'replace' || bonus.damageMode === 'change_type' || bonus.damageMode === 'add_base') && isBonusApplicable(bonus, flowTags, bonusState))
                    mutateDamageWithBonus(bonusState, bonus);
            }
            return { ...profile, range: base, all_range: base, base_range, damage: workingDamage, base_damage };
        });
    }

    // pilot weapon / simple item: single synthetic profile
    const base = (weapon.system.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
    const base_range = base.map(rangeEntry => ({ ...rangeEntry }));
    const tags = (weapon.system.tags ?? []).map(tag => ({ ...tag }));
    // NPC features store damage/attack_bonus/accuracy as tier arrays
    let damage = weapon.system.damage;
    let attack_bonus = weapon.system.attack_bonus;
    let accuracy = weapon.system.accuracy;
    if (weapon.type === 'npc_feature')
    {
        const tierOverride = weapon.system.tier_override ?? 0;
        const tier = tierOverride > 0 ? tierOverride : (resolvedActor?.system?.tier ?? 1);
        const tierIdx = Math.max(0, Math.min(2, tier - 1));
        if (Array.isArray(damage?.[0]))
            damage = damage[tierIdx] ?? [];
        if (Array.isArray(attack_bonus))
            attack_bonus = attack_bonus[tierIdx] ?? 0;
        if (Array.isArray(accuracy))
            accuracy = accuracy[tierIdx] ?? 0;
    }
    const workingDamage = Array.isArray(damage) ? damage.map(damageEntry => ({ ...damageEntry })) : [];
    const base_damage = workingDamage.map(damageEntry => ({ ...damageEntry }));
    const bonusState = { actor: resolvedActor, item: weapon, data: { tags, range: base, damage: workingDamage } };
    const bonuses = flattenBonuses([
        ...getGlobalBonuses(resolvedActor),
        ...getConstantBonuses(resolvedActor)
    ]);
    const flowTags = new Set(["all", "attack"]);
    for (const bonus of bonuses)
    {
        if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, bonusState))
            mutateRangeWithBonus(bonusState, bonus);
        else if (bonus.type === 'damage' && (bonus.damageMode === 'replace' || bonus.damageMode === 'change_type' || bonus.damageMode === 'add_base') && isBonusApplicable(bonus, flowTags, bonusState))
            mutateDamageWithBonus(bonusState, bonus);
    }
    return [{ ...weapon.system, damage: workingDamage.length > 0 ? workingDamage : damage, attack_bonus, accuracy, range: base, base_range, base_damage }];
}

/** Returns the effective tag list for an item with actor bonuses applied.
 * @returns {Promise<any[]>}
 */
export async function getItemTags_WithBonus(item, actor)
{
    if (!item)
        return [];
    const resolvedActor = actor ?? item.parent ?? null;
    const { tags, range } = _getItemBaseData(item);
    await _applyItemBonuses(item, resolvedActor, tags, range);
    return tags;
}

/** Returns the maximum range value per range type across all weapons of the input.
 * @returns {Record<string, number>}
 */
export function getMaxWeaponRanges_WithBonus(input)
{
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    const maxPerType = {};
    for (const weapon of weapons)
    {
        const { tags, range } = _getItemBaseData(weapon);
        _applyItemBonuses(weapon, actor, tags, range);
        for (const rangeEntry of range)
        {
            const rangeValue = Number.parseInt(rangeEntry.val) || 0;
            if (maxPerType[rangeEntry.type] === undefined || rangeValue > maxPerType[rangeEntry.type])
                maxPerType[rangeEntry.type] = rangeValue;
        }
    }
    return maxPerType;
}

/** Returns the maximum threat range for an actor, accounting for active bonuses.
 * @returns {number} Longest threat range on the actor
 */
export function getActorMaxThreat(actor)
{
    if (!actor || actor.type === 'deployable')
        return 0;
    if (_getActorWeapons(actor).length === 0)
        return 0;
    const ranges = getMaxWeaponRanges_WithBonus(actor);
    return Math.max(1, ranges.Threat ?? 0);
}

// Effective sensor range for an actor/token, folding in any Sensor-type LA range bonuses.
/** @returns {number} */
export function getSensorRange_WithBonus(input)
{
    const actor = input?.actor ?? input;
    const base = Number(actor?.system?.sensor_range) || 10;
    if (!actor?.system)
        return base;
    const range = [{ type: "Sensor", val: base }];
    const state = { actor, item: null, data: { tags: [], range } };
    const bonuses = flattenBonuses([
        ...getGlobalBonuses(actor),
        ...getConstantBonuses(actor)
    ]);
    const flowTags = new Set(["all"]);
    for (const bonus of bonuses)
    {
        if (bonus.type !== "range" || (bonus.rangeType ?? "") !== "Sensor")
            continue;
        if (!isBonusApplicable(bonus, flowTags, state))
            continue;
        mutateRangeWithBonus(state, bonus);
    }
    return Number(range.find(entry => entry.type === "Sensor")?.val) || base;
}

/** Max reach across all weapons of the input; counts Range/Threat/Line/Burst/Cone (not Blast) plus tg_thrown.
 * @returns {Promise<number>}
 */
export async function getMaxWeaponReach_WithBonus(input)
{
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    let max = 0;
    for (const weapon of weapons)
    {
        const { tags, range } = _getItemBaseData(weapon);
        await _applyItemBonuses(weapon, actor, tags, range);
        for (const rangeEntry of range)
        {
            if (REACH_RANGE_TYPES.has(rangeEntry.type))
            {
                const rangeValue = Number.parseInt(rangeEntry.val) || 0;
                if (rangeValue > max)
                    max = rangeValue;
            }
        }
        const thrownTag = tags.find(tag => tag.lid === "tg_thrown" || tag.id === "tg_thrown");
        if (thrownTag)
        {
            const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
            if (throwVal > max)
                max = throwVal;
        }
    }
    return max;
}

/** Max range per type for any item: base range, per-action ranges, tg_thrown ("Thrown"), deployRange flag ("Deploy").
 * @returns {Promise<Record<string, number>>}
 */
export async function getMaxItemRanges_WithBonus(item, actor)
{
    if (!item)
        return {};
    const resolvedActor = actor ?? item.parent ?? null;

    const { tags, range: baseRange } = _getItemBaseData(item);
    const actionRanges = (item.system?.actions ?? []).flatMap(action => (action.range ?? []).map(rangeEntry => ({ ...rangeEntry })));
    const allRanges = [...baseRange, ...actionRanges];

    await _applyItemBonuses(item, resolvedActor, tags, allRanges);

    const thrownTag = tags.find(tag => tag.lid === "tg_thrown" || tag.id === "tg_thrown");
    if (thrownTag)
    {
        const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
        if (throwVal > 0)
            allRanges.push({ type: "Thrown", val: throwVal });
    }

    const deployRange = item.getFlag?.("lancer-automations", "deployRange");
    if (deployRange)
        allRanges.push({ type: "Deploy", val: deployRange });

    const maxPerType = {};
    for (const rangeEntry of allRanges)
    {
        const rangeValue = Number.parseInt(rangeEntry.val) || 0;
        if (rangeValue > 0 && (maxPerType[rangeEntry.type] === undefined || rangeValue > maxPerType[rangeEntry.type]))
            maxPerType[rangeEntry.type] = rangeValue;
    }
    return maxPerType;
}

/** Furthest a weapon reaches on activation: additive when Range co-exists with a shape (Blast full, Cone/Line minus 1), else max of range entries. */
export function getWeaponReachRange(item, actor)
{
    if (!item)
        return 0;
    const resolvedActor = actor ?? item.parent ?? null;
    const { tags, range: baseRange } = _getItemBaseData(item);
    const actionRanges = (item.system?.actions ?? []).flatMap(action => (action.range ?? []).map(rangeEntry => ({ ...rangeEntry })));
    const allRanges = [...baseRange, ...actionRanges];
    _applyItemBonuses(item, resolvedActor, tags, allRanges);
    const thrownTag = tags.find(tag => tag.lid === "tg_thrown" || tag.id === "tg_thrown");
    if (thrownTag)
    {
        const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
        if (throwVal > 0)
            allRanges.push({ type: "Thrown", val: throwVal });
    }
    const maxPerType = {};
    for (const rangeEntry of allRanges)
    {
        const rangeValue = Number.parseInt(rangeEntry.val) || 0;
        if (rangeValue > 0 && (maxPerType[rangeEntry.type] === undefined || rangeValue > maxPerType[rangeEntry.type]))
            maxPerType[rangeEntry.type] = rangeValue;
    }
    const range  = maxPerType.Range  ?? 0;
    const threat = maxPerType.Threat ?? 0;
    const blast  = maxPerType.Blast  ?? 0;
    const cone   = maxPerType.Cone   ?? 0;
    const line   = maxPerType.Line   ?? 0;
    const burst  = maxPerType.Burst  ?? 0;
    const thrown = maxPerType.Thrown ?? 0;
    if (range > 0 && blast > 0)
        return range + blast;
    if (range > 0 && cone  > 0)
        return range + cone  - 1;
    if (range > 0 && line  > 0)
        return range + line  - 1;
    return Math.max(range, threat, blast, cone, line, burst, thrown);
}

// Pulse reach: base (Range/Threat) + AoE shape it can drop. `ranges` is a { type: maxVal } map.
export function weaponPulseRange(ranges)
{
    const base = Math.max(0, ranges.Range ?? 0, ranges.Threat ?? 0);
    const shape = Math.max(0, ranges.Blast ?? 0, ranges.Cone ?? 0, ranges.Line ?? 0, ranges.Burst ?? 0);
    return base + shape;
}

/** Actor-wide max reach across all weapons. */
export function getActorMaxReach_WithBonus(input)
{
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    let max = 0;
    for (const weapon of weapons)
    {
        const reach = getWeaponReachRange(weapon, actor);
        if (reach > max)
            max = reach;
    }
    return max;
}

/** @returns {boolean} true when the weapon's active profile carries Arcing or Seeking */
export function weaponIgnoresLineOfSight(item)
{
    if (!item)
        return false;
    const { tags } = _getItemBaseData(item);
    return tags.some(tag => (tag.lid ?? tag.id) === 'tg_arcing' || (tag.lid ?? tag.id) === 'tg_seeking');
}

/** @returns {{ max: number, freeMax: number }} total reach and the reach not bound by line of sight */
export function getActorReachBands_WithBonus(input)
{
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    let max = 0;
    let freeMax = 0;
    for (const weapon of weapons)
    {
        const reach = getWeaponReachRange(weapon, actor);
        if (reach > max)
            max = reach;
        if (reach > freeMax && weaponIgnoresLineOfSight(weapon))
            freeMax = reach;
    }
    return { max, freeMax };
}
