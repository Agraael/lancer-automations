import { flattenBonuses, isBonusApplicable, applyTagBonus, mutateRangeWithBonus } from "../bonuses/genericBonuses.js";

const REACH_RANGE_TYPES = new Set(["Range", "Threat", "Line", "Burst", "Cone"]);

/** Returns the base { tags, range } for an item, handling mech_weapon profiles. Both arrays are shallow-cloned. */
function _getItemBaseData(item) {
    let tags, range;
    if (item.type === "mech_weapon") {
        const profileIdx = item.system?.selected_profile_index ?? 0;
        const profile = item.system?.profiles?.[profileIdx];
        tags = profile?.all_tags ?? item.system?.tags ?? [];
        range = profile?.all_range ?? profile?.range ?? item.system?.range ?? [];
    } else {
        tags = item.system?.tags ?? [];
        range = item.system?.range ?? [];
    }
    return { tags: tags.map(tag => ({ ...tag })), range: range.map(rangeEntry => ({ ...rangeEntry })) };
}

/** Resolves input (Actor | Token | Item | mixed array) to { weapons, actor }. */
function _resolveWeaponsAndActor(input) {
    const entries = Array.isArray(input) ? input.flat() : [input];
    const weapons = [];
    let actor = null;

    for (const entry of entries) {
        if (!entry) {
            continue;
        }
        if (entry.documentName === "Token" || entry.actor) {
            const a = entry.actor;
            if (a) {
                actor = actor ?? a;
                weapons.push(..._getActorWeapons(a));
            }
        } else if (entry.documentName === "Actor" || entry.items) {
            actor = actor ?? entry;
            weapons.push(..._getActorWeapons(entry));
        } else if (entry.system) {
            actor = actor ?? entry.parent ?? null;
            if (entry.type === "mech_weapon" || (entry.type === "npc_feature" && entry.system?.type === "Weapon")) {
                weapons.push(entry);
            }
        }
    }
    return { weapons, actor };
}

function _getActorWeapons(actor) {
    return (actor?.items ?? []).filter(item => {
        if (item.system?.destroyed) return false;
        return item.type === "mech_weapon" ||
            item.type === "pilot_weapon" ||
            (item.type === "npc_feature" && item.system?.type === "Weapon");
    });
}

/** Applies tag and range bonuses from actor onto the given arrays (mutates in-place). */
function _applyItemBonuses(item, actor, tags, range) {
    if (!actor) {
        return;
    }
    const bonuses = flattenBonuses([
        ...(actor.getFlag("lancer-automations", "global_bonuses") || []),
        ...(actor.getFlag("lancer-automations", "constant_bonuses") || [])
    ]);
    const flowTags = new Set(["all", "attack"]);
    const state = { actor, item, data: { tags, range } };
    for (const bonus of bonuses) {
        if (!isBonusApplicable(bonus, flowTags, state)) {
            continue;
        }
        if (bonus.type === "tag") {
            applyTagBonus(state, bonus);
        }
        if (bonus.type === "range") {
            mutateRangeWithBonus(state, bonus);
        }
    }
}

/**
 * Returns the weapon's profiles with native Lancer bonuses + LA actor range bonuses merged.
 * Falls back gracefully for pilot weapons and items without profiles.
 */
export function getWeaponProfiles_WithBonus(weapon, actor) {
    if (!weapon?.system)
        return [];
    const resolvedActor = actor ?? weapon.parent ?? null;
    const rawProfiles = weapon.system.profiles;

    if (rawProfiles?.length > 0) {
        return rawProfiles.map(profile => {
            const base = (profile.all_range ?? profile.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
            const base_range = (profile.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
            const tags = (profile.all_tags ?? profile.tags ?? []).map(tag => ({ ...tag }));
            const mockState = { actor: resolvedActor, item: weapon, data: { tags, range: base } };
            const bonuses = flattenBonuses([
                ...(resolvedActor?.getFlag("lancer-automations", "global_bonuses") || []),
                ...(resolvedActor?.getFlag("lancer-automations", "constant_bonuses") || [])
            ]);
            const flowTags = new Set(["all", "attack"]);
            for (const bonus of bonuses) {
                if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, mockState))
                    mutateRangeWithBonus(mockState, bonus);
            }
            return { ...profile, range: base, all_range: base, base_range };
        });
    }

    // pilot weapon / simple item: single synthetic profile
    const base = (weapon.system.range ?? []).map(rangeEntry => ({ ...rangeEntry }));
    const base_range = base.map(rangeEntry => ({ ...rangeEntry }));
    const tags = (weapon.system.tags ?? []).map(tag => ({ ...tag }));
    const mockState = { actor: resolvedActor, item: weapon, data: { tags, range: base } };
    const bonuses = flattenBonuses([
        ...(resolvedActor?.getFlag("lancer-automations", "global_bonuses") || []),
        ...(resolvedActor?.getFlag("lancer-automations", "constant_bonuses") || [])
    ]);
    const flowTags = new Set(["all", "attack"]);
    for (const bonus of bonuses) {
        if (bonus.type === 'range' && isBonusApplicable(bonus, flowTags, mockState))
            mutateRangeWithBonus(mockState, bonus);
    }
    // NPC features store damage/attack_bonus/accuracy as tier arrays
    let damage = weapon.system.damage;
    let attack_bonus = weapon.system.attack_bonus;
    let accuracy = weapon.system.accuracy;
    if (weapon.type === 'npc_feature') {
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
    return [{ ...weapon.system, damage, attack_bonus, accuracy, range: base, base_range }];
}

/** Returns the effective tag list for an item with actor bonuses applied. */
export async function getItemTags_WithBonus(item, actor) {
    if (!item) {
        return [];
    }
    const resolvedActor = actor ?? item.parent ?? null;
    const { tags, range } = _getItemBaseData(item);
    await _applyItemBonuses(item, resolvedActor, tags, range);
    return tags;
}

/** Returns the maximum range value per range type across all weapons of the input. */
export function getMaxWeaponRanges_WithBonus(input) {
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    const maxPerType = {};
    for (const weapon of weapons) {
        const { tags, range } = _getItemBaseData(weapon);
        _applyItemBonuses(weapon, actor, tags, range);
        for (const r of range) {
            const val = Number.parseInt(r.val) || 0;
            if (maxPerType[r.type] === undefined || val > maxPerType[r.type]) {
                maxPerType[r.type] = val;
            }
        }
    }
    return maxPerType;
}

/** Returns the maximum threat range for an actor, accounting for active bonuses. */
export function getActorMaxThreat(actor) {
    if (!actor)
        return 0;
    if (actor.type === 'deployable')
        return 0;
    const ranges = getMaxWeaponRanges_WithBonus(actor);
    return ranges.Threat || 1;
}

/**
 * Single maximum reach across all weapons of the input.
 * Counts Range/Threat/Line/Burst/Cone (not Blast). Also checks tg_thrown.
 */
export async function getMaxWeaponReach_WithBonus(input) {
    const { weapons, actor } = _resolveWeaponsAndActor(input);
    let max = 0;
    for (const weapon of weapons) {
        const { tags, range } = _getItemBaseData(weapon);
        await _applyItemBonuses(weapon, actor, tags, range);
        for (const r of range) {
            if (REACH_RANGE_TYPES.has(r.type)) {
                const val = Number.parseInt(r.val) || 0;
                if (val > max) {
                    max = val;
                }
            }
        }
        const thrownTag = tags.find(tag => tag.lid === "tg_thrown" || tag.id === "tg_thrown");
        if (thrownTag) {
            const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
            if (throwVal > max) {
                max = throwVal;
            }
        }
    }
    return max;
}

/**
 * Maximum range value per range type for any item.
 * Covers item.system.range, per-action ranges, tg_thrown ("Thrown"), deployRange flag ("Deploy").
 */
export async function getMaxItemRanges_WithBonus(item, actor) {
    if (!item)
        return {};
    const resolvedActor = actor ?? item.parent ?? null;

    const { tags, range: baseRange } = _getItemBaseData(item);
    const actionRanges = (item.system?.actions ?? []).flatMap(action => (action.range ?? []).map(rangeEntry => ({ ...rangeEntry })));
    const allRanges = [...baseRange, ...actionRanges];

    await _applyItemBonuses(item, resolvedActor, tags, allRanges);

    const thrownTag = tags.find(tag => tag.lid === "tg_thrown" || tag.id === "tg_thrown");
    if (thrownTag) {
        const throwVal = Number.parseInt(thrownTag.val || thrownTag.num_val) || 0;
        if (throwVal > 0)
            allRanges.push({ type: "Thrown", val: throwVal });
    }

    const deployRange = item.getFlag?.("lancer-automations", "deployRange");
    if (deployRange)
        allRanges.push({ type: "Deploy", val: deployRange });

    const maxPerType = {};
    for (const r of allRanges) {
        const val = Number.parseInt(r.val) || 0;
        if (val > 0 && (maxPerType[r.type] === undefined || val > maxPerType[r.type]))
            maxPerType[r.type] = val;
    }
    return maxPerType;
}
