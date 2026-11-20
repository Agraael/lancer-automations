import { executeSimpleActivation, executeItemActivation, executeInvade, getInvadeOptions, executeExtraActionCombat } from '../tools/misc-tools.js';
import { consumeExtraAction } from '../interactive/extra-actions.js';

const ITEM_FLOW_TYPES = ['mech_system', 'npc_feature', 'pilot_gear', 'pilot_armor', 'pilot_weapon'];
const NATIVE_PATH_TYPES = ['mech_weapon', 'weapon_mod'];

export function nativeActionPath(item, action)
{
    const matches = candidate => candidate.name === action?.name && candidate.activation === action?.activation;
    const actionIdx = (item?.system?.actions ?? []).findIndex(matches);
    if (actionIdx >= 0)
        return `system.actions.${actionIdx}`;

    const profileIdx = item?.system?.selected_profile_index ?? 0;
    const profileActionIdx = (item?.system?.profiles?.[profileIdx]?.actions ?? []).findIndex(matches);
    return profileActionIdx >= 0 ? `system.profiles.${profileIdx}.actions.${profileActionIdx}` : null;
}

function startFlow(item, flowName, extra, start)
{
    if (!extra)
        return start();

    const hook = /** @type {any} */ (`lancer.preFlow.${flowName}`);
    const hookId = Hooks.on(hook, flow =>
    {
        if (flow?.state?.item?.uuid !== item.uuid)
            return;
        Hooks.off(hook, hookId);
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extra);
    });

    return Promise.resolve(start()).finally(() => Hooks.off(hook, hookId));
}

async function spendExtraAction(actor, action, item = null)
{
    if (!action._addedViaExtrasUI || !Array.isArray(action.tags) || !action.tags.length)
        return true;
    return consumeExtraAction(item ?? actor, action.name);
}

export async function runExtraAction(actor, action, item = null)
{
    if (!(await spendExtraAction(actor, action, item)))
        return;
    await executeSimpleActivation(actor, { title: action.name, action, detail: action.detail || '' }, item ? { item } : {});
    if (action.laCombat)
        await executeExtraActionCombat(actor, action, item);
}

export async function runActorAction(actor, token, action, item, { sourceType = item?.type, rankIdx = null, coreActive = false, extra = null, wait = false } = {})
{
    if (action.laCombat)
        return runExtraAction(actor, action, item);

    const itemFlow = ITEM_FLOW_TYPES.includes(sourceType);
    if (!item && (coreActive || itemFlow || sourceType === 'talent'))
        return;
    if (!(await spendExtraAction(actor, action, item)))
        return;

    const simpleOptions = { title: action.name, action, detail: action.detail || '' };
    const simpleExtra = { ...extra, ...(item ? { item } : {}) };
    const nativePath = NATIVE_PATH_TYPES.includes(item?.type) ? nativeActionPath(item, action) : null;
    let started;

    if (coreActive)
        started = startFlow(item, 'CoreActiveFlow', extra, () => item.beginCoreActiveFlow('system.core_system'));
    else if (itemFlow)
    {
        if (item.type === 'npc_feature' && item.system?.tech_attack && item.beginTechAttackFlow)
            started = startFlow(item, 'TechAttackFlow', extra, () => item.beginTechAttackFlow());
        else
        {
            const actionIdx = (item.system?.actions ?? []).findIndex(candidate => candidate === action || candidate.name === action.name);
            if (actionIdx >= 0)
                started = startFlow(item, 'ActivationFlow', extra, () => item.beginActivationFlow(`system.actions.${actionIdx}`));
            else if (action._sourceItemId || action.recharge !== undefined || !item.beginSystemFlow)
                started = executeSimpleActivation(actor, simpleOptions, simpleExtra);
            else
                started = startFlow(item, 'SystemFlow', extra, () => item.beginSystemFlow());
        }
    }
    else if (sourceType === 'talent')
    {
        if (action.activation === 'Invade')
        {
            const opt = getInvadeOptions(actor).find(option => option.item?.id === item.id && option.name === action.name);
            if (opt)
                started = executeInvade(actor, opt);
        }
        else
        {
            const rank = rankIdx ?? 0;
            const actionIdx = (item.system?.ranks?.[rank]?.actions ?? []).findIndex(candidate => candidate.name === action.name);
            started = executeItemActivation(item, { path: `ranks.${rank}.actions.${Math.max(actionIdx, 0)}` }, { sourceTokenId: token?.id, ...extra });
        }
    }
    else if (nativePath)
        started = startFlow(item, 'ActivationFlow', extra, () => item.beginActivationFlow(nativePath));
    else
        started = executeSimpleActivation(actor, simpleOptions, simpleExtra);

    if (wait)
        await started;
}
