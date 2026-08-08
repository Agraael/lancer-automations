/* global game, Hooks, console */

import { appendEvent } from './telemetry-store.js';
import { findActiveCombatForToken as _findActiveCombatForToken } from "./battelog-utils.js";

const TRACKED = new Set(['onHit', 'onMiss', 'onTechHit', 'onTechMiss']);

let _registered = false;

function _targetTokenId(entry)
{
    return entry?.target?.id
        ?? entry?.target?.document?.id
        ?? null;
}

function _onTrigger(triggerType, data)
{
    if (!TRACKED.has(triggerType))
        return;
    const attackerId = data?.triggeringToken?.id ?? null;
    if (!attackerId)
        return;
    const combat = _findActiveCombatForToken(attackerId);
    if (!combat)
        return;

    const hit = triggerType === 'onHit' || triggerType === 'onTechHit';
    const category = (triggerType === 'onTechHit' || triggerType === 'onTechMiss')
        ? 'tech'
        : 'weapon';
    const isSmart = data?.flowState?.data?.is_smart === true;
    const defense = (category === 'tech' || isSmart) ? 'edef' : 'evasion';
    const targets = (data?.targets ?? [])
        .map(entry =>
        {
            const targetId = _targetTokenId(entry);
            if (!targetId)
                return null;
            const targetEntry = { targetId, hit, defense };
            if (hit && entry.crit)
                targetEntry.crit = true;
            if (entry.roll?.total != null)
                targetEntry.roll = entry.roll.total;
            return targetEntry;
        })
        .filter(Boolean);
    if (targets.length === 0)
        return;

    const weapon = data?.weapon ?? data?.techItem;
    const weaponName = String(weapon?.name ?? data?.actionName ?? '').toUpperCase();
    // Basic attack/tech = the manual apply tool, not a real weapon. Excluded from fav weapon.
    const basic = !weapon?.id || weaponName === 'BASIC ATTACK' || weaponName === 'BASIC TECH';
    const event = {
        type: 'attack',
        round: combat.round ?? 0,
        byId: attackerId,
        category,
        weaponName,
        attackType: data?.attackType ?? null,
        targets,
    };
    if (basic)
        event.basic = true;

    if (game.user?.isGM)
        appendEvent(combat, attackerId, event);
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: 'battleLogAttack',
            payload: { combatId: combat.id, entryId: attackerId, event },
        });
    }
}

export function registerAttackCapture()
{
    if (_registered)
        return;
    _registered = true;
    Hooks.on('lancer-automations.battelog.trigger', (triggerType, data) =>
    {
        try
        {
            _onTrigger(triggerType, data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log attack-capture failed:', err);
        }
    });
}

/** Called by the socket handler on the GM client. */
export { handleRemoteBattlelogEvent as handleRemoteAttackEvent } from "./battelog-utils.js";
