import { appendEvent, appendEventComputed, getTelemetry, findEntry, pushEvent } from './telemetry-store.js';
import { findActiveCombatForToken, findTelemetryCombatForToken, resolveEntryTokenId } from './battelog-utils.js';
import { attributeKill } from './kill-attribution.js';

let _registered = false;
const _gearEmitted = new Set();

const GEAR_KIND = {
    mech_weapon: 'weapon',
    pilot_weapon: 'weapon',
    npc_weapon: 'weapon',
    mech_system: 'system',
    pilot_gear: 'system',
    npc_system: 'system',
};

function _num(value)
{
    return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function _vitals(sys)
{
    return {
        hp: _num(sys?.hp?.value),
        heat: _num(sys?.heat?.value),
        structure: _num(sys?.structure?.value),
        stress: _num(sys?.stress?.value),
        burn: _num(sys?.burn),
        infection: _num(sys?.infection),
        overshield: _num(sys?.overshield?.value),
        repairs: _num(sys?.repairs?.value),
    };
}

// One vitals snapshot. Sync, no write; caller persists.
export function reconcileCombatant(telemetry, combatant, round)
{
    const tokenId = combatant?.tokenId ?? combatant?.actorId;
    const entry = findEntry(telemetry, tokenId);
    if (!entry || entry.events.some(ev => ev.type === 'destroyed'))
        return;
    const sys = combatant.actor?.system;
    if (!sys)
        return;
    pushEvent(telemetry, entry, { type: 'stat-tick', round, tokenId, ..._vitals(sys) });
}

function _tokenActor(combat, tokenId)
{
    const combatant = combat.combatants?.find(entry => (entry.tokenId ?? entry.actorId) === tokenId);
    return combatant?.actor ?? canvas.tokens?.get(tokenId)?.actor ?? null;
}

// A death snapshot the scheduled tick can't take: the token is about to be
// wrecked or deleted, so capture its final vitals, then the destroyed event.
const _destroyedInFlight = new Set();

async function _gmEmitDestroyed(combat, tokenId, actor, round)
{
    const key = `${combat.id}:${tokenId}`;
    if (_destroyedInFlight.has(key))
        return;
    const telemetry = getTelemetry(combat);
    const entry = telemetry ? findEntry(telemetry, tokenId) : null;
    if (!entry || entry.events.some(ev => ev.type === 'destroyed'))
        return;
    _destroyedInFlight.add(key);
    const useRound = round ?? combat.round ?? 0;
    const sys = (actor ?? _tokenActor(combat, tokenId))?.system;
    if (sys)
        await appendEvent(combat, tokenId, { type: 'stat-tick', round: useRound, tokenId, ..._vitals(sys) });
    await appendEventComputed(combat, tokenId, (currentTelemetry, currentEntry) =>
    {
        if (currentEntry.events.some(ev => ev.type === 'destroyed'))
            return null;
        const { killerId, assistIds } = attributeKill(currentTelemetry, tokenId, useRound);
        return { type: 'destroyed', round: useRound, tokenId, killerId, assistIds };
    });
}

function _emitLoss(combat, tokenId, event)
{
    if (game.user?.isGM)
        appendEvent(combat, tokenId, event);
    else
        game.socket.emit('module.lancer-automations', { action: 'battleLogEvent', payload: { combatId: combat.id, entryId: tokenId, event } });
}

function _die(combat, tokenId, actor)
{
    const round = combat.round ?? 0;
    if (game.user?.isGM)
        _gmEmitDestroyed(combat, tokenId, actor, round);
    else
        game.socket.emit('module.lancer-automations', { action: 'battleLogEvent', payload: { combatId: combat.id, entryId: tokenId, event: { type: 'destroyed', round, tokenId } } });
}

// GM sink for relayed state events; deaths get the final-tick treatment.
export function handleRemoteStateEvent(payload)
{
    if (!game.user?.isGM)
        return;
    const combat = game.combats?.get(payload?.combatId);
    if (!combat?.getFlag?.('lancer-automations', 'telemetry'))
        return;
    const event = payload.event;
    if (event?.type === 'destroyed')
        _gmEmitDestroyed(combat, payload.entryId ?? event.tokenId, null, event.round);
    else
        appendEvent(combat, payload.entryId ?? event.byId, event);
}

// Structure / stress / destruction ride the module's own automation triggers.
function _onStateTrigger(triggerType, data)
{
    const tokenId = data?.triggeringToken?.id;
    if (!tokenId)
        return;
    const combat = findActiveCombatForToken(tokenId) ?? findTelemetryCombatForToken(tokenId);
    if (!combat)
        return;
    const round = combat.round ?? 0;
    const actor = data?.triggeringToken?.actor;
    if (triggerType === 'onStructure')
    {
        _emitLoss(combat, tokenId, { type: 'structure-loss', round, tokenId });
        if (_num(data.remainingStructure) <= 0)
            _die(combat, tokenId, actor);
    }
    else if (triggerType === 'onStress')
    {
        _emitLoss(combat, tokenId, { type: 'stress-loss', round, tokenId });
        if (_num(data.remainingStress) <= 0)
            _die(combat, tokenId, actor);
    }
    else if (triggerType === 'onDestroyed')
        _die(combat, tokenId, actor);
}

async function _onUpdateItem(item, change)
{
    if (!game.users?.activeGM?.isSelf)
        return;
    if (change?.system?.destroyed !== true && change?.system?.cascading !== true)
        return;
    let kind = GEAR_KIND[item?.type];
    if (!kind && item?.type === 'npc_feature')
        kind = item.system?.type === 'Weapon' ? 'weapon' : 'system';
    if (!kind)
        return;
    const tokenId = resolveEntryTokenId(item?.parent);
    if (!tokenId)
        return;
    const combat = findActiveCombatForToken(tokenId) ?? findTelemetryCombatForToken(tokenId);
    if (!combat)
        return;
    const key = `${combat.id}:${item.uuid}`;
    if (_gearEmitted.has(key))
        return;
    _gearEmitted.add(key);
    await appendEvent(combat, tokenId, {
        type: 'gear-lost',
        round: combat.round ?? 0,
        tokenId,
        kind,
        name: String(item.name ?? '').toUpperCase(),
    });
}

export function forgetCombatState(combatId)
{
    const prefix = `${combatId}:`;
    for (const key of _destroyedInFlight)
    {
        if (key.startsWith(prefix))
            _destroyedInFlight.delete(key);
    }
    for (const key of _gearEmitted)
    {
        if (key.startsWith(prefix))
            _gearEmitted.delete(key);
    }
}

export function registerStateCapture()
{
    if (_registered)
        return;
    _registered = true;
    Hooks.on('lancer-automations.battelog.trigger', (triggerType, data) =>
    {
        try
        {
            _onStateTrigger(triggerType, data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log state-capture failed:', err);
        }
    });
    Hooks.on('updateItem', (item, change) =>
    {
        try
        {
            _onUpdateItem(item, change);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log gear-capture failed:', err);
        }
    });
}
