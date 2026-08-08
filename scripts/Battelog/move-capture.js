import { appendEvent } from './telemetry-store.js';
import { findActiveCombatForToken, findTelemetryCombatForToken } from './battelog-utils.js';
import { getIntentionalMoveData } from '../movement/move-tracking.js';

let _registered = false;
const _knockbackSource = new Map();

function _round1(value)
{
    return Math.round((Number(value) || 0) * 10) / 10;
}

// At turn end the ending token's move history is still intact (it clears at its
// next turn start), so this reads the revert-safe net distance for the turn.
function _onTurnEnd(combat, prior)
{
    if (!game.users?.activeGM?.isSelf)
        return;
    let tokenId = prior?.tokenId;
    if (!tokenId && prior?.combatantId)
        tokenId = combat.combatants?.get(prior.combatantId)?.token?.id;
    if (!tokenId)
        return;
    const telemetryCombat = findActiveCombatForToken(tokenId) ?? findTelemetryCombatForToken(tokenId);
    if (!telemetryCombat)
        return;
    const moved = _round1(getIntentionalMoveData(tokenId)?.moved);
    if (moved <= 0)
        return;
    appendEvent(telemetryCombat, tokenId, { type: 'move', round: telemetryCombat.round ?? 0, byId: tokenId, distance: moved, knockback: false });
}

function _onKnockbackSource(data)
{
    if (data?.tokenId && data?.sourceId)
        _knockbackSource.set(data.tokenId, data.sourceId);
}

function _onInvoluntaryMove(data)
{
    const tokenId = data?.token?.id ?? data?.token?.document?.id;
    if (!tokenId)
        return;
    const telemetryCombat = findActiveCombatForToken(tokenId) ?? findTelemetryCombatForToken(tokenId);
    if (!telemetryCombat)
    {
        _knockbackSource.delete(tokenId);
        return;
    }
    const distance = _round1(data?.distance);
    const sourceId = _knockbackSource.get(tokenId);
    _knockbackSource.delete(tokenId);
    if (distance <= 0)
        return;
    const event = { type: 'move', round: telemetryCombat.round ?? 0, byId: tokenId, distance, knockback: true };
    if (sourceId)
        event.sourceId = sourceId;
    if (game.user?.isGM)
        appendEvent(telemetryCombat, tokenId, event);
    else
        game.socket.emit('module.lancer-automations', { action: 'battleLogEvent', payload: { combatId: telemetryCombat.id, entryId: tokenId, event } });
}

export function registerMoveCapture()
{
    if (_registered)
        return;
    _registered = true;
    Hooks.on('combatTurnChange', (combat, prior) =>
    {
        try
        {
            _onTurnEnd(combat, prior);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log move-capture failed:', err);
        }
    });
    Hooks.on('lancer-automations.battelog.knockbackSource', (data) =>
    {
        try
        {
            _onKnockbackSource(data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log knockback-source failed:', err);
        }
    });
    Hooks.on('lancer-automations.battelog.involuntaryMove', (data) =>
    {
        try
        {
            _onInvoluntaryMove(data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log involuntary-move failed:', err);
        }
    });
}
