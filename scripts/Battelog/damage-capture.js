/* global game, fromUuid, Hooks, console, document */

import { appendEvent } from './telemetry-store.js';
import {
    findActiveCombatForToken as _findActiveCombatForToken,
    findTelemetryCombatForToken as _findTelemetryCombatForToken,
    resolveEntryTokenId,
} from "./battelog-utils.js";

let _registered = false;

function _attackerTokenId(msg)
{
    const speakerToken = msg?.speaker?.token;
    if (speakerToken)
        return speakerToken;
    const actorId = msg?.speaker?.actor;
    if (!actorId)
        return null;
    const actor = game.actors?.get(actorId);
    return resolveEntryTokenId(actor) ?? actor?.getActiveTokens?.()?.[0]?.id ?? null;
}

/** Token id from a UUID (TokenDocument uuid, or Actor uuid as fallback). */
async function _tokenIdFromUuid(uuid)
{
    if (!uuid)
        return null;
    try
    {
        const doc = await fromUuid(uuid);
        if (!doc)
            return null;
        if (doc.documentName === 'Token')
            return doc.id;
        if (doc.documentName === 'Actor')
            return resolveEntryTokenId(doc);
        return null;
    }
    catch
    {
        return null;
    }
}

async function _onDamageApplyClick(ev)
{
    const btn = ev.target?.closest?.('.lancer-damage-apply');
    if (!btn)
        return;
    const msgEl = btn.closest('.chat-message.message');
    const msgId = msgEl?.dataset?.messageId;
    const msg = game.messages?.get(msgId);
    if (!msg)
        return;
    const group = btn.closest('.lancer-damage-button-group');
    const targetUuid = group?.dataset?.target;
    if (!targetUuid)
        return;
    const damageData = msg.getFlag?.('lancer', 'damageData')
        ?? msg.flags?.lancer?.damageData
        ?? null;
    const targetResult = damageData?.targetDamageResults?.find(result => result.target === targetUuid);
    const damages = (targetResult?.damage ?? [])
        .filter(damage => Number(damage.amount ?? damage.val ?? 0) > 0)
        .map(damage => ({
            type: String(damage.type ?? '').toLowerCase(),
            amount: Number(damage.amount ?? damage.val ?? 0),
        }));
    const targetDoc = await fromUuid(targetUuid);
    const targetActor = targetDoc?.actor;
    if (!targetActor)
        return;
    /** @type {any} */ (targetActor).__laPendingDamageSrc = {
        attackerTokenId: _attackerTokenId(msg),
        damages,
        preOvershield: Number(targetActor.system?.overshield?.value ?? 0),
    };
}

function _onDamageApplied(targetActor, hpLanded)
{
    try
    {
        _emitDamageEvent(targetActor, hpLanded);
    }
    catch (err)
    {
        console.error('lancer-automations | battle-log damage-capture emit failed:', err);
    }
}

function _emitDamageEvent(targetActor, hpLanded)
{
    const targetTokenId = resolveEntryTokenId(targetActor);
    if (!targetTokenId)
        return;
    const combat = _findActiveCombatForToken(targetTokenId);
    if (!combat)
        return;
    const stash = /** @type {any} */ (targetActor).__laPendingDamageSrc;
    delete /** @type {any} */ (targetActor).__laPendingDamageSrc;
    const landed = Number(hpLanded ?? 0);
    const postOvershield = Number(targetActor.system?.overshield?.value ?? 0);
    const overshieldAbsorbed = Math.max(0, (stash?.preOvershield ?? postOvershield) - postOvershield);
    // Non-heat rolled damage; heat doesn't hit HP (goes to heat.value only).
    const nonHeatRolled = (stash?.damages ?? []).reduce((sum, damage) =>
        damage.type === 'heat' ? sum : sum + (damage.amount ?? 0), 0);
    const armorAbsorbed = Math.max(0, nonHeatRolled - landed - overshieldAbsorbed);
    const attackerId = stash?.attackerTokenId ?? null;
    const event = {
        type: 'damage',
        round: combat.round ?? 0,
        turn: combat.turn ?? null,
        byId: attackerId,
        targetId: targetTokenId,
        damages: stash?.damages ?? [],
        hpLanded: landed,
        overshieldAbsorbed,
        armorAbsorbed,
    };
    const entryId = attackerId ?? targetTokenId;
    if (game.user?.isGM)
        appendEvent(combat, entryId, event);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: 'battleLogDamage',
            payload: { combatId: combat.id, entryId, event },
        });
    }
}

async function _onDamageUndoClick(ev)
{
    const btn = ev.target?.closest?.('.lancer-damage-undo');
    if (!btn)
        return;
    const msgEl = btn.closest('.chat-message.message');
    const msg = game.messages?.get(msgEl?.dataset?.messageId);
    if (!msg)
        return;
    const targetUuid = btn.dataset?.uuid;
    if (!targetUuid)
        return;
    const attackerTokenId = _attackerTokenId(msg);
    const targetTokenId = await _tokenIdFromUuid(targetUuid);
    if (!targetTokenId)
        return;
    // Undo can land after the wreck flow removed the combatant.
    const combat = _findActiveCombatForToken(targetTokenId)
        ?? _findTelemetryCombatForToken(targetTokenId);
    if (!combat)
        return;
    const event = {
        type: 'damage-undo',
        round: combat.round ?? 0,
        byId: attackerTokenId ?? targetTokenId,
        targetId: targetTokenId,
        hpRestored: Number(btn.dataset?.hpDelta ?? 0),
        overshieldRestored: Number(btn.dataset?.overshieldDelta ?? 0),
    };
    if (game.user?.isGM)
        appendEvent(combat, event.byId, event);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: 'battleLogDamageUndo',
            payload: { combatId: combat.id, entryId: event.byId, event },
        });
    }
}

export function registerDamageCapture()
{
    if (_registered)
        return;
    _registered = true;
    document.addEventListener('click', _onDamageApplyClick, true);
    document.addEventListener('click', _onDamageUndoClick, true);
    Hooks.on('lancer-automations.battelog.damageApplied', _onDamageApplied);
}

/** Called by the socket handler on the GM client. */
export { handleRemoteBattlelogEvent as handleRemoteDamageEvent } from "./battelog-utils.js";

/** Called by the socket handler on the GM client. */
export { handleRemoteBattlelogEvent as handleRemoteDamageUndoEvent } from "./battelog-utils.js";
