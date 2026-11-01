import { flattenBonuses, isBonusApplicable, applyTagBonus, mutateRangeWithBonus, mutateDamageWithBonus, mutatesBaseDamage, getConstantBonuses, getGlobalBonuses, getV3DataBonuses } from "../bonuses/genericBonuses.js";
import { getLAFlag } from "./flag-utils.js";
import { isWeaponItem } from "../utils/lancer-token.js";

const AREA_RANGE_TYPES = ["Blast", "Burst", "Cone", "Line"];

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
    return (actor?.items ?? []).filter(item => !item.system?.destroyed && isWeaponItem(item));
}

/** Applies tag and range bonuses from actor onto the given arrays (mutates in-place). */
function _applyItemBonuses(item, actor, tags, range)
{
    if (!actor)
        return;
    const bonuses = flattenBonuses([
        ...getGlobalBonuses(actor),
        ...getConstantBonuses(actor),
        ...getV3DataBonuses(actor, ['tag', 'range']).map(row => row.bonus)
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
                ...getConstantBonuses(resolvedActor),
                ...getV3DataBonuses(resolvedActor, ['range']).map(row => row.bonus)
            ]);
            const flowTags = new Set(["all", "attack"]);
            for (const bonus of bonuses)
            {
                if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, bonusState))
                    mutateRangeWithBonus(bonusState, bonus);
                else if (bonus.type === 'damage' && mutatesBaseDamage(bonus) && isBonusApplicable(bonus, flowTags, bonusState))
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
        ...getConstantBonuses(resolvedActor),
        ...getV3DataBonuses(resolvedActor, ['range']).map(row => row.bonus)
    ]);
    const flowTags = new Set(["all", "attack"]);
    for (const bonus of bonuses)
    {
        if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, bonusState))
            mutateRangeWithBonus(bonusState, bonus);
        else if (bonus.type === 'damage' && mutatesBaseDamage(bonus) && isBonusApplicable(bonus, flowTags, bonusState))
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

export function getItemAreaRanges_WithBonus(item, actor = null)
{
    if (!item?.system)
        return [];
    const { tags, range } = _getItemBaseData(item);
    _applyItemBonuses(item, actor ?? item.parent ?? null, tags, range);
    return range
        .map(rangeEntry => ({ type: String(rangeEntry?.type ?? ''), val: Number.parseInt(rangeEntry?.val) || 0 }))
        .filter(rangeEntry => rangeEntry.val > 0 && AREA_RANGE_TYPES.includes(rangeEntry.type));
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

/** Max reach across all weapons of the input, same rule as getActorMaxReach_WithBonus.
 * @returns {Promise<number>}
 */
export async function getMaxWeaponReach_WithBonus(input)
{
    return getActorMaxReach_WithBonus(input);
}

export function thrownValue(tags)
{
    const thrownTag = (tags ?? []).find(tag => tag?.lid === "tg_thrown" || tag?.id === "tg_thrown");
    return thrownTag ? (Number.parseInt(thrownTag.val || thrownTag.num_val) || 0) : 0;
}

function _itemRangeMap(item, actor)
{
    const { tags, range: baseRange } = _getItemBaseData(item);
    const actionRanges = (item.system?.actions ?? []).flatMap(action => (action.range ?? []).map(rangeEntry => ({ ...rangeEntry })));
    const allRanges = [...baseRange, ...actionRanges];
    _applyItemBonuses(item, actor, tags, allRanges);
    const throwVal = thrownValue(tags);
    if (throwVal > 0)
        allRanges.push({ type: "Thrown", val: throwVal });
    const maxPerType = {};
    for (const rangeEntry of allRanges)
    {
        const rangeValue = Number.parseInt(rangeEntry.val) || 0;
        if (rangeValue > 0 && (maxPerType[rangeEntry.type] === undefined || rangeValue > maxPerType[rangeEntry.type]))
            maxPerType[rangeEntry.type] = rangeValue;
    }
    return maxPerType;
}

/** Max range per type for any item: base range, per-action ranges, tg_thrown ("Thrown"), deployRange flag ("Deploy").
 * @returns {Promise<Record<string, number>>}
 */
export async function getMaxItemRanges_WithBonus(item, actor)
{
    if (!item)
        return {};
    const maxPerType = _itemRangeMap(item, actor ?? item.parent ?? null);
    const deployRange = Number.parseInt(getLAFlag(item,"deployRange")) || 0;
    if (deployRange > (maxPerType.Deploy ?? 0))
        maxPerType.Deploy = deployRange;
    return maxPerType;
}

/** Furthest a weapon reaches on activation, by weaponPulseRange's rule. */
export function getWeaponReachRange(item, actor)
{
    if (!item)
        return 0;
    return weaponPulseRange(_itemRangeMap(item, actor ?? item.parent ?? null));
}

// Reach from a { type: maxVal } map: only Range moves a shape's origin, so only Range adds the shape size.
export function weaponPulseRange(ranges)
{
    const range = ranges.Range ?? 0;
    const shape = Math.max(0, ranges.Blast ?? 0, ranges.Cone ?? 0, ranges.Line ?? 0, ranges.Burst ?? 0);
    return Math.max(range > 0 && shape > 0 ? range + shape : 0, range, ranges.Threat ?? 0, ranges.Thrown ?? 0, ranges.Sensor ?? 0, shape);
}

export function shapeSpecFromRanges(ranges)
{
    const entries = (ranges ?? [])
        .map(/** @type {any} */ (entry) => ({ type: String(entry?.type ?? ''), val: Number(entry?.val) || 0 }))
        .filter(entry => entry.val > 0);
    const maxOf = (...types) => Math.max(0, ...entries.filter(entry => types.includes(entry.type)).map(entry => entry.val));
    const area = entries.find(entry => AREA_RANGE_TYPES.includes(entry.type));
    if (area)
        return { pattern: area.type.toLowerCase(), size: area.val, range: maxOf('Range') };
    const reach = maxOf('Range', 'Threat');
    return reach > 0 ? { pattern: 'target', size: 1, range: reach } : null;
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
