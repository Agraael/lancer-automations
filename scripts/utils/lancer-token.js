/* global game */
// Shared token/actor predicates used across the module. Centralised so call
// sites stop redefining the same helpers.

export const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];

const _MECH_STATS_TYPES = new Set(['mech', 'npc']);
const _NO_REACTION_TYPES = new Set(['deployable']);

export function isLancerActor(actor) {
    if (!actor) {
        return false;
    }
    return LANCER_ACTOR_TYPES.includes(actor.type);
}

export function hasMechStats(actor) {
    return _MECH_STATS_TYPES.has(actor?.type);
}

export function hasReaction(actor) {
    return actor && !_NO_REACTION_TYPES.has(actor.type);
}

// True when the token is part of an active (started) combat. Walks all combats
// because Foundry allows multiple parallel encounters.
export function isTokenInCombat(token) {
    const id = token?.id;
    if (!id) {
        return false;
    }
    for (const combat of game.combats ?? []) {
        if (!combat.started) {
            continue;
        }
        if (combat.combatants?.some?.(c => c.tokenId === id)) {
            return true;
        }
    }
    return false;
}

// Visibility for "do I render UI over this token". GM bypasses hidden flag.
export function isTokenVisible(token) {
    if (!token) {
        return false;
    }
    if (token.document?.hidden && !game.user.isGM) {
        return false;
    }
    return token.visible !== false;
}
