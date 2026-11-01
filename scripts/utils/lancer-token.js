/* global game */
// Shared token/actor predicates used across the module. Centralised so call
// sites stop redefining the same helpers.

export const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];

const _MECH_STATS_TYPES = new Set(['mech', 'npc']);
const _NO_REACTION_TYPES = new Set(['deployable']);
const _WEAPON_ITEM_TYPES = new Set(['mech_weapon', 'pilot_weapon']);

export function isLancerActor(actor)
{
    if (!actor)
        return false;
    return LANCER_ACTOR_TYPES.includes(actor.type);
}

export function hasMechStats(actor)
{
    return _MECH_STATS_TYPES.has(actor?.type);
}

export function hasReaction(actor)
{
    return actor && !_NO_REACTION_TYPES.has(actor.type);
}

export function isWeaponItem(item)
{
    return !!item && (_WEAPON_ITEM_TYPES.has(item.type) || (item.type === 'npc_feature' && item.system?.type === 'Weapon'));
}

export function resolvePilot(tokenOrActor)
{
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    if (!actor)
        return null;
    if (actor.type === 'pilot')
        return actor;
    if (actor.type === 'mech')
        return actor.system?.pilot?.value ?? null;
    return null;
}

export function rankParts(actor)
{
    if (!actor)
        return null;
    if (actor.type === 'npc')
        return { kind: 'T', value: Number(actor.system?.tier) || 1 };
    if (actor.type === 'pilot')
        return { kind: 'LL', value: Number(actor.system?.level) || 0 };
    if (actor.type === 'mech')
    {
        const pilot = actor.system?.pilot?.value;
        return pilot ? { kind: 'LL', value: Number(pilot.system?.level) || 0 } : null;
    }
    return null;
}

export function corePowerState(actor)
{
    const energy = actor?.system?.core_energy;
    return {
        hasCore: energy != null,
        charged: (energy ?? 0) > 0,
        active: !!actor?.statuses?.has('core_power_active'),
    };
}

export function corePowerDisplay(state)
{
    if (state.active)
        return { label: 'ON', color: '#a855f7' };
    if (state.charged)
        return { label: '✓', color: '#3a9e6e' };
    return { label: '✗', color: '#c33' };
}

export function isDangerZoneHeat(value, max)
{
    return max > 0 && value * 2 >= max;
}

export const VALUE_STATUS_PATHS = { burn: 'system.burn', overshield: 'system.overshield.value', infection: 'system.infection' };

export function shortOverchargeTerm(term)
{
    const match = /^\+?(\d+)d(\d+)(?:\+(\d+))?$/i.exec(String(term ?? '').trim());
    if (!match)
        return term;
    const [, count, faces, flat] = match;
    const dice = `${count === '1' ? '' : count}d${faces}`;
    return flat ? `${dice}+${flat}` : dice;
}

// True when the token is part of an active (started) combat. Walks all combats
// because Foundry allows multiple parallel encounters.
export function isTokenInCombat(token)
{
    const id = token?.id;
    if (!id)
        return false;
    for (const combat of game.combats ?? [])
    {
        if (!combat.started)
            continue;
        if (combat.combatants?.some?.(c => c.tokenId === id))
            return true;
    }
    return false;
}

function _findCombatant(tokenOrActor)
{
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    const tokenId = tokenOrActor?.actor ? tokenOrActor.id : actor?.token?.id;
    const combat = game.combat;
    if (!combat?.started)
        return null;
    return combat.combatants.find(combatant =>
        (tokenId && combatant.tokenId === tokenId) || (actor && combatant.actor?.id === actor.id)
    ) ?? null;
}

// True when the token has a combatant in the started active combat.
export function isCombatant(tokenOrActor)
{
    return !!_findCombatant(tokenOrActor);
}

// True while it is this token's turn in the active combat.
export function isCurrentTurnActive(tokenOrActor)
{
    const combatant = _findCombatant(tokenOrActor);
    return !!combatant && game.combat.combatant?.id === combatant.id;
}

// Activations left this round. 0 when not in a started combat.
export function hasTurnAvailable(tokenOrActor)
{
    const combatant = _findCombatant(tokenOrActor);
    return combatant?.activations?.value ?? 0;
}

// Visibility for "do I render UI over this token". GM bypasses hidden flag.
export function isTokenVisible(token)
{
    if (!token)
        return false;
    if (token.document?.hidden && !game.user.isGM)
        return false;
    return token.visible !== false;
}

export const STAT_PATHS = {
    HULL: "system.hull",
    AGI: "system.agi",
    SYS: "system.sys",
    ENG: "system.eng",
    GRIT: "system.grit"
};

/**
 * DC of a save forced by `targetActor`. A save is rolled against the aggressor's SAVE stat, which
 * the system derives for every actor type (10 + GRIT on mechs and pilots, statblock value on NPCs).
 * @param {any} targetActor
 * @param {string|null} [statOverride] - Read this HASE stat raw instead, for contest-style checks.
 * @returns {number}
 */
export function deriveSaveDc(targetActor, statOverride = null)
{
    if (!targetActor)
        return 10;
    if (statOverride)
    {
        const lookupStat = String(statOverride).toUpperCase();
        return foundry.utils.getProperty(targetActor, STAT_PATHS[lookupStat] || lookupStat.toLowerCase()) || 10;
    }
    return targetActor.system?.save || 10;
}

// isGM is true for assistants too, so gating shared work on it runs it on every GM client.
/** @returns {boolean} */
export function isExecutorGM()
{
    return game.users?.activeGM?.isSelf === true;
}

/**
 * Whether any GM client is online to service a relayed socket request.
 * @returns {boolean}
 */
export function hasExecutorGM()
{
    return !!game.users?.activeGM;
}

export function getItemLID(item)
{
    return item.system?.lid || null;
}

export function isItemAvailable(item, reactionPath)
{
    if (!item || item.system?.destroyed || item.system?.disabled)
        return false;

    if (item.type === "talent" && reactionPath)
    {
        const rankMatch = reactionPath.match(/ranks\[(\d+)\]/);
        if (rankMatch)
        {
            const requiredRank = Number.parseInt(rankMatch[1]) + 1;
            if ((item.system?.curr_rank || 0) < requiredRank)
                return false;
        }
    }

    if (item.type === "mech_weapon" && reactionPath)
    {
        const profileMatch = reactionPath.match(/profiles\[(\d+)\]/);
        if (profileMatch)
        {
            const requiredProfile = Number.parseInt(profileMatch[1]);
            const currentProfile = item.system?.selected_profile_index ?? 0;
            if (currentProfile !== requiredProfile)
                return false;
        }
    }

    return true;
}

/**
 * Danger Zone: heat at or above half the heat cap.
 * @param {any} tokenOrActor
 * @returns {boolean}
 */
export function inDangerZone(tokenOrActor)
{
    const heat = (tokenOrActor?.actor ?? tokenOrActor)?.system?.heat;
    if (!heat)
        return false;
    return isDangerZoneHeat(heat.value ?? 0, heat.max ?? 0);
}

/**
 * Actor tier clamped to 1-3. Accepts a token or actor.
 * @returns {number} 1, 2 or 3
 */
export function getTier(tokenOrActor)
{
    const actor = tokenOrActor?.actor ?? tokenOrActor;
    const tier = Number(actor?.system?.tier) || 1;
    return Math.max(1, Math.min(3, tier));
}

/**
 * Value matching the actor's tier.
 * @param {any} tokenOrActor
 * @param {any[]} values  [tier1, tier2, tier3]
 * @returns {any} The entry matching the actor's tier
 */
export function tierValue(tokenOrActor, values)
{
    return values?.[getTier(tokenOrActor) - 1];
}

/**
 * Returns the weapon subtype string (e.g. "Superheavy Rifle", "Melee").
 * Synchronous: no bonus application.
 * @param {Item} item
 * @returns {string}
 */
export function getWeaponType(item)
{
    const sys = item?.system;
    if (!sys)
        return "";
    // Weapon profiles carry it as `type`; only npc_feature has a `weapon_type` field.
    return sys.active_profile?.type
        || sys.profiles?.[sys.selected_profile_index ?? 0]?.type
        || sys.weapon_type
        || "";
}

/**
 * Coarse weapon class: "melee", "nexus", "ranged", or "" when unknown.
 * Substring match because NPC features fold the size in ("Heavy Melee", "Main Nexus").
 * @param {Item} item
 * @returns {string}
 */
export function weaponClass(item)
{
    const type = String(getWeaponType(item) || "").toLowerCase();
    if (!type)
        return "";
    if (type.includes("melee"))
        return "melee";
    if (type.includes("nexus"))
        return "nexus";
    return "ranged";
}

/**
 * Returns the Lancer item type string (e.g. "Weapon", "System", "mech_weapon").
 * Prefers item.system.type (Lancer type) over item.type (Foundry type).
 * Synchronous: no bonus application.
 * @param {Item} item
 * @returns {string}
 */
export function getItemType(item)
{
    if (!item)
        return "";
    return item.system?.type || item.type || "";
}
