import { getModuleSetting } from './settings-utils.js';
import { isFriendly } from '../combat/overwatch.js';

import { MODULE_ID } from './constants.js';
const SCAN_NAME_RE = /^SCAN:\s/i;

function _observes(entry, user, allowGm)
{
    if (allowGm && user?.isGM)
        return true;
    return !!entry.testUserPermission?.(user, 'OBSERVER');
}

export function getScanJournalsForActor(actor, options = {})
{
    const out = [];
    if (!actor)
        return out;
    const user = options.user ?? globalThis.game?.user;
    const allowGm = options.allowGm ?? false;
    const uuid = actor.uuid;
    const name = (actor.name ?? '').toLowerCase();
    for (const entry of globalThis.game?.journal ?? [])
    {
        let matched = entry.getFlag?.(MODULE_ID, 'scan')?.actorUuid === uuid;
        if (!matched && name && SCAN_NAME_RE.test(entry.name ?? ''))
            matched = (entry.name ?? '').toLowerCase().includes(name);
        if (!matched)
            continue;
        if (!_observes(entry, user, allowGm))
            continue;
        out.push(entry);
    }
    return out;
}

// World override: treat everything as scanned, for tables that don't play with hidden stats.
function _revealWithoutScan()
{
    try
    {
        return !!game.settings.get('lancer-automations', 'revealStatsWithoutScan');
    }
    catch
    {
        return false;
    }
}

// Ally: friendly (token-factions aware) to a token `user` owns on the scene.
export function isActorAllyOfUser(actor, user)
{
    if (!actor || !user)
        return false;
    const tokens = actor.getActiveTokens?.() ?? [];
    if (!tokens.length)
        return false;
    const owned = (globalThis.canvas?.tokens?.placeables ?? [])
        .filter(own => own.actor?.testUserPermission?.(user, 'OWNER'));
    return tokens.some(token => owned.some(own => own.id !== token.id && isFriendly(own, token)));
}

// World rules: everyone, player-owned tokens, or allies count as scanned without a scan.
export function isActorScannedForUser(actor, user)
{
    if (!actor || !user)
        return false;
    if (_revealWithoutScan())
        return true;
    if (actor.hasPlayerOwner && getModuleSetting('scanRevealPlayers'))
        return true;
    if (getScanJournalsForActor(actor, { user }).length > 0)
        return true;
    return getModuleSetting('scanRevealAllies') && isActorAllyOfUser(actor, user);
}
