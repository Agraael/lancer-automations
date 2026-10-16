import { appendEvent } from './telemetry-store.js';
import { findActiveCombatForToken, findTelemetryCombatForToken, resolveEntryTokenId, resolveCreditTokenId, pilotTokenOf, numOr } from './battelog-utils.js';
import { SAVE_KINDS } from './combat-telemetry.js';
import { isExecutorGM } from '../tools/misc-tools.js';

let _registered = false;

const REAL_ACTIVATIONS = new Set(['Quick', 'Full', 'Free', 'Protocol', 'Reaction', 'Quick Tech', 'Full Tech', 'Invade']);

function _emit(combat, byId, event)
{
    if (isExecutorGM())
        appendEvent(combat, byId, event);
    else
        game.socket.emit('module.lancer-automations', { action: 'battleLogEvent', payload: { combatId: combat.id, entryId: byId, event } });
}

// HASE saves and skill checks. A save forced by another token records forcedBy
// (that token attacked the roller, for kill attribution).
function _onCheck(data)
{
    const byId = data?.triggeringToken?.id;
    if (!byId)
        return;
    if (numOr(data?.targetVal, 10) <= 0)
        return;
    const entryId = pilotTokenOf(byId) ? resolveCreditTokenId(byId) : byId;
    const combat = findActiveCombatForToken(byId)
        ?? (entryId !== byId ? findTelemetryCombatForToken(entryId) : null);
    if (!combat)
        return;
    const path = String(data?.flowState?.data?.path ?? '');
    const last = path.split('.').pop()?.toLowerCase() ?? '';
    const forcedBy = resolveCreditTokenId(data?.checkAgainstToken?.id);
    const forced = !!forcedBy && forcedBy !== byId;
    let category = 'check';
    let name = String(data?.statName ?? '').toUpperCase();
    if (SAVE_KINDS.includes(last))
    {
        category = forced ? 'save' : 'check';
        name = last;
    }
    else if (path.includes('curr_rank'))
    {
        category = 'skill';
        name = String(data?.flowState?.item?.name ?? data?.statName ?? '').toUpperCase();
    }
    const event = { type: 'action', round: combat.round ?? 0, byId, category, name, success: !!data?.success };
    if (category === 'save')
        event.forcedBy = forcedBy;
    _emit(combat, entryId, event);
}

function _flowIds(flow)
{
    const sourceTokenId = flow?.state?.la_extraData?.sourceTokenId;
    if (sourceTokenId)
        return { tokenId: sourceTokenId, pilotTokenId: null };
    const actor = flow?.state?.actor;
    if (!actor)
        return { tokenId: null, pilotTokenId: null };
    const tokenId = resolveCreditTokenId(resolveEntryTokenId(actor), actor);
    const pilotToken = actor.type === 'pilot' ? actor.getActiveTokens?.()?.[0]?.id ?? null : null;
    return { tokenId, pilotTokenId: pilotToken && pilotToken !== tokenId ? pilotToken : null };
}

function _flowName(flow)
{
    return String(flow?.state?.data?.title ?? flow?.state?.data?.action?.name ?? flow?.state?.item?.name ?? '').toUpperCase();
}

// Activation type of the flow: from the action, from an NPC feature, or state type.
function _flowActivation(flow)
{
    const activation = flow?.state?.data?.action?.activation;
    if (activation)
        return activation;
    const item = flow?.state?.item;
    if (item?.type === 'npc_feature')
    {
        if (item.system?.type === 'Tech')
            return item.system?.tech_type === 'Full' ? 'Full Tech' : 'Quick Tech';
        if (REAL_ACTIVATIONS.has(item.system?.type))
            return item.system.type;
    }
    return flow?.state?.data?.type;
}

// One completed Lancer flow -> one gameplay action, if it's a real action type.
function _onFlow(flow, success, opts)
{
    if (success !== true)
        return;
    const { tokenId, pilotTokenId } = _flowIds(flow);
    if (!tokenId)
        return;
    const combat = findActiveCombatForToken(tokenId)
        ?? (pilotTokenId ? findTelemetryCombatForToken(tokenId) : null);
    if (!combat)
        return;
    let name;
    let activation;
    if (opts?.tech)
    {
        if (flow?.state?.data?.invade !== true)
            return;
        name = _flowName(flow) || 'INVADE';
        activation = 'Invade';
    }
    else if (opts?.name)
    {
        name = opts.name;
        activation = _flowActivation(flow) ?? opts.activation ?? null;
    }
    else
    {
        activation = _flowActivation(flow);
        if (!REAL_ACTIVATIONS.has(activation))
            return;
        name = _flowName(flow);
    }
    if (!name)
        return;
    const event = { type: 'action', round: combat.round ?? 0, byId: tokenId, name, activation, success: true };
    if (pilotTokenId)
        event.pilotTokenId = pilotTokenId;
    _emit(combat, tokenId, event);
}

// Named verbs that don't run a self-identifying flow (Skirmish/Barrage/Fight/Stand Up/Teleport).
function _onNamedAction(data)
{
    const rawId = data?.token?.id ?? data?.token?.document?.id;
    const byId = resolveCreditTokenId(rawId);
    if (!byId)
        return;
    const pilotTokenId = byId !== rawId ? pilotTokenOf(rawId) : null;
    const combat = findActiveCombatForToken(byId)
        ?? (pilotTokenId ? findTelemetryCombatForToken(byId) : null);
    if (!combat)
        return;
    const name = String(data?.name ?? '').toUpperCase();
    if (!name)
        return;
    const event = { type: 'action', round: combat.round ?? 0, byId, name, activation: data?.actionType ?? null, success: true };
    if (pilotTokenId)
        event.pilotTokenId = pilotTokenId;
    _emit(combat, byId, event);
}

function _onFlowHook(flow, success, opts)
{
    try
    {
        _onFlow(flow, success, opts);
    }
    catch (err)
    {
        console.error('lancer-automations | battle-log flow-capture failed:', err);
    }
}

export function registerActionCapture()
{
    if (_registered)
        return;
    _registered = true;
    Hooks.on('lancer-automations.battelog.trigger', (triggerType, data) =>
    {
        try
        {
            if (triggerType === 'onCheck')
                _onCheck(data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log check-capture failed:', err);
        }
    });
    Hooks.on('lancer-automations.battelog.action', (data) =>
    {
        try
        {
            _onNamedAction(data);
        }
        catch (err)
        {
            console.error('lancer-automations | battle-log named-action failed:', err);
        }
    });
    Hooks.on('lancer.postFlow.ActivationFlow', (flow, success) => _onFlowHook(flow, success));
    Hooks.on('lancer.postFlow.SimpleActivationFlow', (flow, success) => _onFlowHook(flow, success));
    Hooks.on('lancer.postFlow.SystemFlow', (flow, success) => _onFlowHook(flow, success));
    Hooks.on('lancer.postFlow.CoreActiveFlow', (flow, success) => _onFlowHook(flow, success, { name: 'CORE POWER' }));
    Hooks.on('lancer.postFlow.StabilizeFlow', (flow, success) => _onFlowHook(flow, success, { name: 'STABILIZE' }));
    Hooks.on('lancer.postFlow.OverchargeFlow', (flow, success) => _onFlowHook(flow, success, { name: 'OVERCHARGE' }));
    Hooks.on('lancer.postFlow.TechAttackFlow', (flow, success) => _onFlowHook(flow, success, { tech: true }));
}
