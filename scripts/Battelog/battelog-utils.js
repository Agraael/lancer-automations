import { appendEvent, BUCKETS } from './telemetry-store.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { isExecutorGM } from '../tools/misc-tools.js';

export function numOr(value, fallback = 0)
{
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function battleLogEnabled()
{
    return getModuleSetting('battleLogEnabled');
}

function _combatantKey(combatant)
{
    return combatant.tokenId ?? combatant.actorId;
}

// Active telemetry-flagged combat containing this token, or null.
export function findActiveCombatForToken(tokenId)
{
    if (!game.combats || !tokenId)
        return null;
    const primary = game.combat;
    if (getLAFlag(primary,'telemetry')
        && primary.combatants?.some(combatant => _combatantKey(combatant) === tokenId))
        return primary;
    for (const combat of game.combats)
    {
        if (!getLAFlag(combat,'telemetry'))
            continue;
        if (combat.combatants?.some(combatant => _combatantKey(combatant) === tokenId))
            return combat;
    }
    return null;
}

// Entry-based lookup: still works after the wreck flow removed the combatant.
export function findTelemetryCombatForToken(tokenId)
{
    const active = findActiveCombatForToken(tokenId);
    if (active)
        return active;
    if (!game.combats || !tokenId)
        return null;
    for (const combat of game.combats)
    {
        const telemetry = getLAFlag(combat,'telemetry');
        if (!telemetry)
            continue;
        if (BUCKETS.some(bucket => telemetry[bucket]?.some(entry => entry.tokenId === tokenId)))
            return combat;
    }
    return null;
}

// Entry key for an actor. Linked actors with several tokens in combat resolve
// to the first combatant found.
export function resolveEntryTokenId(actor)
{
    if (!actor)
        return null;
    if (actor.isToken && actor.token?.id)
        return actor.token.id;
    for (const combat of game.combats ?? [])
    {
        if (!getLAFlag(combat,'telemetry'))
            continue;
        const combatant = combat.combatants?.find(entry => entry.actorId === actor.id);
        if (combatant)
            return _combatantKey(combatant);
    }
    return null;
}

// GM-side: append a remote battle-log event to the telemetry-flagged combat.
export async function handleRemoteBattlelogEvent({ combatId, entryId, event })
{
    if (!isExecutorGM())
        return;
    const combat = game.combats?.get(combatId);
    if (!combat)
        return;
    if (!getLAFlag(combat,'telemetry'))
        return;
    await appendEvent(combat, entryId ?? event.byId, event);
}
