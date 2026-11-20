import { AutomationManager, stringToFunction, stringToAsyncFunction, ACTIVATION_TRIGGERS, BUILT_IN_TRIGGERS, declaredActionType } from "./automation-manager.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { getLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID, PILOT_LINKED_ITEM_TYPES, RUNS_ON_CHOICES } from "../tools/constants.js";
import { displayAutomationPopup, activateAutomation } from "./automation-ui.js";
import { runInFlowBody } from "./flow-queue.js";
import { getTokenOwnerUserId, startWaitCard, askCard } from "../interactive/index.js";
import { consumeEffectCharge, runInOnInitTriggerContext } from "../bonuses/flagged-effects.js";
import { deferResistanceEffectConsumption, linkedBonusOf, bonusFrequencyFree, burnBonusFrequency } from "../bonuses/genericBonuses.js";
import { getTokenDistance, getRelativeDisposition } from "../combat/overwatch.js";
import { getItemLID, isItemAvailable, hasReactionAvailable, consumeReaction, reserveReaction, executeSimpleActivation, debugActivation, isRangedAttack } from "../tools/misc-tools.js";
import { awaitPendingAck, cancelPendingAck } from "../socket.js";
import { isEnvironmentActor } from "../tools/template-actors.js";

import { localize, localizeFormat } from '../tools/string-utils.js';
import { trackerSnapshot } from '../combat/action-extras.js';
import { billingActor, fightsThroughOwner } from '../interactive/deployable-owner.js';
let automationDebounceTimer = null;
let automationQueue = [];
const AUTOMATION_DEBOUNCE_MS = 100;
let cachedFlatGeneralAutomations = null;
/** @type {Map<string, Array>} triggerType to filtered non-action reactions, cleared with cachedFlatGeneralAutomations */
const cachedNonActionAutomationsByTrigger = new Map();
/** @type {Map<string, Array>} triggerType to general reactions with sceneReactor on, evaluated once as the scene */
const cachedSceneAutomationsByTrigger = new Map();
const COMBAT_INHERENT_TRIGGERS = new Set(['onCombatStart', 'onCombatEnd', 'onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd', 'onRoundStart', 'onRoundEnd', 'onFullRepair']);
const TOKENLESS_TRIGGERS = new Set(['onCombatStart', 'onCombatEnd', 'onRoundStart', 'onRoundEnd']);
// Custom triggers are fired on purpose by their caller, who owns the combat gating.
const firesRegardlessOfCombat = triggerType => COMBAT_INHERENT_TRIGGERS.has(triggerType) || !BUILT_IN_TRIGGERS.has(triggerType);
const AUTOMATION_ITEM_TYPES = new Set(["frame", "mech_system", "mech_weapon", "weapon_mod", "npc_feature", "pilot_gear", "talent", "bond"]);
const PILOT_LINKED_TYPES = new Set(PILOT_LINKED_ITEM_TYPES);
const RUNS_ON_VALUES = new Set(RUNS_ON_CHOICES);
const sceneReactorMode = automation => automation.sceneReactor || 'off';

export function isPilotToken(tokenOrActor)
{
    return (/** @type {any} */ (tokenOrActor)?.actor ?? tokenOrActor)?.type === 'pilot';
}

export function automationRunsOnToken(automation, token, item)
{
    if (!PILOT_LINKED_TYPES.has(item?.type))
        return true;

    const runsOn = RUNS_ON_VALUES.has(automation?.runsOn) ? automation.runsOn : 'mech';
    if (runsOn === 'both')
        return true;
    return (runsOn === 'pilot') === isPilotToken(token);
}

const onViewedScene = automation => !automation.sceneId || automation.sceneId === canvas.scene?.id;

Hooks.on('lancer-automations.clearCaches', () =>
{
    cachedFlatGeneralAutomations = null;
    cachedNonActionAutomationsByTrigger.clear();
    cachedSceneAutomationsByTrigger.clear();
});

Hooks.on('createItem', (item, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (!item.parent)
        return;
    if (!AUTOMATION_ITEM_TYPES.has(item.type))
        return;

    let tokens;
    if (item.parent.isToken)
    {
        const tokenPlaceable = canvas.tokens?.placeables?.find(candidate => candidate.document === item.parent.token);
        tokens = tokenPlaceable ? [tokenPlaceable] : [];
    }
    else
        tokens = canvas.tokens?.placeables?.filter(token => token.actor?.id === item.parent.id) ?? [];
    for (const token of tokens)
        checkOnInitAutomations(token, item);
});

function checkDispositionFilter(reactorToken, triggeringToken, dispositionFilter)
{
    if (!dispositionFilter || dispositionFilter.length === 0)
        return true;
    if (!triggeringToken)
        return true;

    const disposition = getRelativeDisposition(reactorToken, triggeringToken);

    const FRIENDLY = CONST.TOKEN_DISPOSITIONS.FRIENDLY;
    const NEUTRAL = CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;

    if (disposition === FRIENDLY && dispositionFilter.includes('friendly'))
        return true;
    if (disposition === NEUTRAL && dispositionFilter.includes('neutral'))
        return true;
    if (disposition === HOSTILE && dispositionFilter.includes('hostile'))
        return true;
    if (disposition === SECRET && dispositionFilter.includes('secret'))
        return true;

    return false;
}

export function getAutomationItems(token)
{
    const actor = token.actor;
    if (!actor)
        return [];

    let items = actor.items.filter(item => AUTOMATION_ITEM_TYPES.has(item.type));

    if (actor.type === "mech")
    {
        let pilot = null;
        const pilotRef = actor.system.pilot;

        if (pilotRef)
        {
            if (typeof pilotRef === 'object' && pilotRef.id)
            {
                const idStr = pilotRef.id;
                pilot = idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr);
            }
            else if (typeof pilotRef === 'string')
                pilot = pilotRef.startsWith('Actor.') ? fromUuidSync(pilotRef) : game.actors.get(pilotRef);
        }

        if (pilot)
        {
            const pilotItems = pilot.items.filter(item => PILOT_LINKED_TYPES.has(item.type));
            items = items.concat(pilotItems);
        }
    }

    // Synthesize a deployable surrogate (no real items) so `dep_*` reactions resolve.
    if (actor.type === "deployable" && actor.system?.lid)
    {
        items = items.concat([{
            name: actor.name,
            type: "deployable_surrogate",
            system: {
                lid: actor.system.lid,
                tags: [],
                destroyed: actor.system.destroyed === true,
                disabled: actor.system.disabled === true,
                actions: actor.system.actions || []
            },
            getFlag: () => null,
            _deployableSurrogate: true,
            _deployableActor: actor
        }]);
    }

    // Surrogate for actor-UUID-keyed reactions (e.g. "Actor.qe5wEevLrMN6ki44").
    const actorSurrogate = (lid) => ({
        name: actor.name,
        type: "actor_surrogate",
        system: {
            lid,
            tags: [],
            destroyed: actor.system?.destroyed === true,
            disabled: actor.system?.disabled === true,
            actions: actor.system?.actions || []
        },
        getFlag: () => null,
        _actorSurrogate: true,
        _surrogateActor: actor
    });

    if (actor.uuid)
        items = items.concat([actorSurrogate(actor.uuid)]);

    // Unlinked tokens have a synthetic uuid, so the world actor's uuid needs its own surrogate.
    const baseActor = actor.isToken ? actor.token?.baseActor : null;
    if (baseActor?.uuid && baseActor.uuid !== actor.uuid)
        items = items.concat([actorSurrogate(baseActor.uuid)]);

    return items;
}

function getAllSceneTokens()
{
    return canvas.tokens.placeables.filter(token =>
    {
        if (!token.actor)
            return false;
        return true;
    });
}

export async function checkOnInitAutomations(token, filterItem = null)
{
    return runInOnInitTriggerContext(() => _checkOnInitAutomationsBody(token, filterItem));
}

// Scene reactor onInit runs on scene load, GM only, with the scene stand-in as the token.
export async function checkSceneOnInitAutomations(scene)
{
    if (!scene || !game.user.isGM)
        return;

    const candidates = getFlatGeneralAutomations().filter(([, automation]) =>
        automation.enabled !== false && automation.onInit && sceneReactorMode(automation) !== 'off' && onViewedScene(automation));

    if (candidates.length === 0)
        return;
    return runInOnInitTriggerContext(async () =>
    {
        const api = game.modules.get(MODULE_ID).api;
        const sceneReactor = makeSceneReactor(scene);

        for (const [reactionName, automation] of candidates)
        {
            try
            {
                if (typeof automation.onInit === 'function')
                    await automation.onInit(sceneReactor, null, api);
                else if (typeof automation.onInit === 'string' && automation.onInit.trim() !== '')
                {
                    const onInitFunc = stringToFunction(automation.onInit, ["token", "item", "api"], automation, `${reactionName}/onInit`);
                    await onInitFunc(sceneReactor, null, api);
                }
            }
            catch (error)
            {
                console.error(`lancer-automations | Error in scene onInit for "${reactionName}":`, error);
            }
        }
    });
}

// First load: canvasReady fires before the api exists, the ready hook covers that pass.
Hooks.on('canvasReady', () =>
{
    if (game.modules.get(MODULE_ID)?.api)
        checkSceneOnInitAutomations(canvas.scene);
});
Hooks.on('lancer-automations.ready', () => checkSceneOnInitAutomations(canvas.scene));

async function _checkOnInitAutomationsBody(token, filterItem = null)
{
    const api = game.modules.get(MODULE_ID).api;
    const items = filterItem ? [filterItem] : getAutomationItems(token);

    for (const item of items)
    {
        const lid = getItemLID(item);
        if (!lid)
            continue;

        const registryEntry = AutomationManager.getAutomations(lid);
        if (!registryEntry)
            continue;

        for (const automation of registryEntry.reactions)
        {
            if (automation.enabled === false)
                continue;
            if (!automation.onInit)
                continue;
            if (!automationRunsOnToken(automation, token, item))
                continue;

            const reactionPath = automation.reactionPath || "";
            if (!isItemAvailable(item, reactionPath))
                continue;

            try
            {
                if (typeof automation.onInit === 'function')
                    await automation.onInit(token, item, api);
                else if (typeof automation.onInit === 'string' && automation.onInit.trim() !== '')
                {
                    const onInitFunc = stringToFunction(automation.onInit, ["token", "item", "api"], automation, `${lid}/${registryEntry.reactions.indexOf(automation)}/onInit`);
                    await onInitFunc(token, item, api);
                }
            }
            catch (error)
            {
                console.error(`lancer-automations | Error executing onInit for ${item.name}:`, error);
            }
        }
    }

    const generalReactions = AutomationManager.getGeneralAutomations();

    for (const [name, automation] of Object.entries(generalReactions))
    {
        if (automation.enabled === false)
            continue;
        if (!automation.onInit)
            continue;

        try
        {
            if (typeof automation.onInit === 'function')
                await automation.onInit(token, null, api);
            else if (typeof automation.onInit === 'string' && automation.onInit.trim() !== '')
            {
                const onInitFunc = stringToFunction(automation.onInit, ["token", "item", "api"], automation, `${name}/onInit`);
                await onInitFunc(token, null, api);
            }
        }
        catch (error)
        {
            console.error(`lancer-automations | Error executing onInit for General Activation ${name}:`, error);
        }
    }
}

export async function checkOnMessageAutomations(token, itemLid, reactionPath, activationName, triggerType, data)
{
    const api = game.modules.get(MODULE_ID).api;

    if (itemLid)
    {
        const items = getAutomationItems(token);

        for (const item of items)
        {
            if (getItemLID(item) !== itemLid)
                continue;

            const registryEntry = AutomationManager.getAutomations(itemLid);
            if (!registryEntry)
                continue;

            for (const automation of registryEntry.reactions)
            {
                if (automation.enabled === false)
                    continue;
                if ((automation.reactionPath || "") !== (reactionPath || ""))
                    continue;
                if (!automation.onMessage)
                    continue;
                if (!automationRunsOnToken(automation, token, item))
                    continue;

                try
                {
                    let result;

                    if (typeof automation.onMessage === 'function')
                        result = await automation.onMessage(triggerType, data, token, item, activationName, api);
                    else if (typeof automation.onMessage === 'string' && automation.onMessage.trim())
                    {
                        const fn = stringToAsyncFunction(automation.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"], `${itemLid}/${registryEntry.reactions.indexOf(automation)}/onMessage`);
                        result = await fn(triggerType, data, token, item, activationName, api);
                    }

                    return result;
                }
                catch (error)
                {
                    console.error(`lancer-automations | Error in onMessage for ${item.name}:`, error);
                }
            }

            break;
        }
    }
    else
    {
        const generalReactions = AutomationManager.getGeneralAutomations();

        for (const [name, automation] of Object.entries(generalReactions))
        {
            if (automation.enabled === false)
                continue;
            if (name !== activationName)
                continue;
            if (!automation.onMessage)
                continue;

            try
            {
                let result;

                if (typeof automation.onMessage === 'function')
                    result = await automation.onMessage(triggerType, data, token, null, activationName, api);
                else if (typeof automation.onMessage === 'string' && automation.onMessage.trim())
                {
                    const fn = stringToAsyncFunction(automation.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"], `${name}/onMessage`);
                    result = await fn(triggerType, data, token, null, activationName, api);
                }

                return result;
            }
            catch (error)
            {
                console.error(`lancer-automations | Error in onMessage for general automation ${name}:`, error);
            }
        }
    }
}

Hooks.on('lancer-automations.runOnMessage', ({ token, itemLid, reactionPath, activationName, triggerType, data }) =>
{
    checkOnMessageAutomations(token, itemLid ?? null, reactionPath ?? null, activationName ?? null, triggerType, data)
        .catch(error => console.error('lancer-automations | onMessage error:', error));
});

/** The reactor's own entry of data.targets ({ target/token, roll, crit, ... }), or null. */
function findTargetEntry(data, token)
{
    if (!Array.isArray(data.targets))
        return null;
    return data.targets.find(entry => entry?.constructor === Object && (entry.target ?? entry.token)?.id === token.id) ?? null;
}

function evaluateGeneralAutomation(reactionName, automation, triggerType, data, token, isSelf, isTarget, isInCombat)
{
    const cancelledBy = data._cancelledBy;

    if (cancelledBy?.length > 0)
    {
        const isCancelled = cancelledBy.some(cancelRecord =>
            cancelRecord.tokenId === token.id && cancelRecord.reactionName === reactionName
        );

        if (isCancelled)
        {
            dbgAuto('skip:', token.name, reactionName, 'already cancelled this pass');
            return null;
        }
    }

    dbgAuto('candidate:', token.name, reactionName, '(general)', { triggers: automation.triggers });

    if (data.isEnvironment && !automation.triggerEnvironment)
    {
        dbgAuto('skip:', token.name, reactionName, 'environment source', { setting: 'triggerEnvironment', value: false });
        return null;
    }

    if (!isInCombat && !automation.outOfCombat && !firesRegardlessOfCombat(triggerType))
    {
        dbgAuto('skip:', token.name, reactionName, 'out of combat', { setting: 'outOfCombat', value: automation.outOfCombat });
        if ((token?.isOwner || game.user.isGM) && getModuleSetting('debugOutOfCombat'))
            ui.notifications.warn(localizeFormat('LA.notify.notTriggeredOutOfCombat', { reaction: reactionName, name: token?.name ?? '?' }));
        return null;
    }

    if (isSelf && !automation.triggerSelf)
    {
        dbgAuto('skip:', token.name, reactionName, 'reactor is the trigger source', { setting: 'triggerSelf', value: !!automation.triggerSelf });
        return null;
    }

    if (!isSelf && automation.triggerOther === false && !(automation.triggerTarget === true && isTarget))
    {
        dbgAuto('skip:', token.name, reactionName, 'reactor is not the trigger source or target', { setting: 'triggerOther', value: false });
        return null;
    }

    if (automation.checkReaction && !(isSelf && data.reactionJustConsumed) && !hasReactionAvailable(token))
    {
        dbgAuto('skip:', token.name, reactionName, 'no reaction available', { setting: 'checkReaction', value: true });
        return null;
    }

    if (!checkDispositionFilter(token, data.triggeringToken, automation.dispositionFilter))
    {
        dbgAuto('skip:', token.name, reactionName, 'disposition filter failed', { setting: 'dispositionFilter', value: automation.dispositionFilter });
        return null;
    }

    try
    {
        const api = game.modules.get(MODULE_ID).api;
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = (sourceToken && token) ? getTokenDistance(token, sourceToken) : null;
        const provokeReasons = [];
        const teleportedPast = !!data.moveInfo?.isTeleport && sourceToken?.id !== token?.id;
        const canTriggerReaction = !teleportedPast && api.canProvokeReaction(sourceToken, token, provokeReasons);

        if (automation.requireCanProvoke && (!canTriggerReaction || data._provokeImmunityBurned))
        {
            if (provokeReasons.includes('provoke_immunity') && !data._provokeImmunityBurned)
            {
                data._provokeImmunityBurned = true;
                api.consumeImmunityUse?.(sourceToken.actor, 'provoke');
            }

            dbgAuto('skip:', token.name, reactionName, 'cannot provoke', { setting: 'requireCanProvoke', value: true, reasons: provokeReasons });
            return null;
        }

        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction, isTarget, targetEntry: findTargetEntry(data, token) };

        enrichedData.debugActivation = function (label)
        {
            return debugActivation(triggerType, this ?? enrichedData, token, null, reactionName, label);
        };

        const shouldTrigger = runGeneralEvaluate(automation, reactionName, triggerType, enrichedData, token, api);
        dbgAuto(shouldTrigger ? 'fire:' : 'skip:', token.name, reactionName, 'evaluate →', shouldTrigger);
        return shouldTrigger ? enrichedData : null;
    }
    catch (error)
    {
        console.error(`lancer-automations | Error evaluating general automation ${reactionName}:`, error);
        return null;
    }
}

function runGeneralEvaluate(automation, reactionName, triggerType, enrichedData, reactorToken, api)
{
    if (typeof automation.evaluate === 'function')
    {
        const result = automation.evaluate(triggerType, enrichedData, reactorToken, null, reactionName, api);

        if (result instanceof Promise)
        {
            console.error(`lancer-automations | evaluate for "${reactionName}" is async. Evaluate functions must be synchronous.`);
            result.then(_ =>
            { /* fire-and-forget async evaluate */ });
            return false;
        }

        return result;
    }

    if (typeof automation.evaluate === 'string' && automation.evaluate.trim() !== '')
    {
        const evalFunc = stringToFunction(automation.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], automation, `${reactionName}/evaluate`);
        const result = evalFunc(triggerType, enrichedData, reactorToken, null, reactionName, api);

        if (result instanceof Promise)
        {
            console.error(`lancer-automations | String evaluate for "${reactionName}" returned a Promise. Evaluate functions must be synchronous.`);
            return false;
        }

        return result;
    }

    return true;
}

// Token-shaped stand-in so cards, popups and cancel plumbing work for scene reactions.
export function makeSceneReactor(scene)
{
    return {
        isSceneReactor: true,
        scene,
        id: `scene:${scene.id}`,
        name: scene.name,
        actor: null,
        inCombat: false,
        control: () => undefined,
        document: {
            id: scene.id,
            name: scene.name,
            hidden: false,
            texture: { src: scene.thumb ?? scene.background?.src ?? '' },
            testUserPermission: (user) => !!user?.isGM
        }
    };
}

// Entries with a "reactions" array expand into sub-reactions.
function getFlatGeneralAutomations()
{
    if (cachedFlatGeneralAutomations)
        return cachedFlatGeneralAutomations;
    cachedFlatGeneralAutomations = [];

    for (const [reactionName, entry] of Object.entries(AutomationManager.getGeneralAutomations()))
    {
        if (Array.isArray(entry.reactions))
        {
            entry.reactions.forEach((subAutomation, subIndex) =>
                cachedFlatGeneralAutomations.push([reactionName, { ...subAutomation, enabled: subAutomation.enabled ?? entry.enabled, _subIndex: subIndex }]));
        }
        else
            cachedFlatGeneralAutomations.push([reactionName, entry]);
    }

    return cachedFlatGeneralAutomations;
}

function evaluateSceneAutomation(reactionName, automation, triggerType, data, sceneReactor, identity)
{
    const sceneName = sceneReactor.name;
    const cancelledBy = data._cancelledBy;

    if (cancelledBy?.length > 0)
    {
        const identityKeys = Object.keys(identity);

        const isCancelled = cancelledBy.some(cancelRecord =>
            Object.keys(cancelRecord).length === identityKeys.length && identityKeys.every(key => cancelRecord[key] === identity[key]));

        if (isCancelled)
        {
            dbgAuto('skip:', sceneName, reactionName, 'already cancelled this pass');
            return null;
        }
    }

    dbgAuto('candidate:', sceneName, reactionName, '(scene)', { triggers: automation.triggers });

    if (data.isEnvironment && !automation.triggerEnvironment)
    {
        dbgAuto('skip:', sceneName, reactionName, 'environment source', { setting: 'triggerEnvironment', value: false });
        return null;
    }

    const isInCombat = !!game.combat?.started;

    if (!isInCombat && !automation.outOfCombat && !firesRegardlessOfCombat(triggerType))
    {
        dbgAuto('skip:', sceneName, reactionName, 'out of combat', { setting: 'outOfCombat', value: automation.outOfCombat });
        if (getModuleSetting('debugOutOfCombat'))
            ui.notifications.warn(localizeFormat('LA.notify.notTriggeredOutOfCombat', { reaction: reactionName, name: sceneName }));
        return null;
    }

    try
    {
        const api = game.modules.get(MODULE_ID).api;
        const enrichedData = { ...data, isSceneReactor: true, scene: sceneReactor.scene, distanceToTrigger: null, canTriggerReaction: true, isTarget: false, targetEntry: null };

        enrichedData.debugActivation = function (label)
        {
            return debugActivation(triggerType, this ?? enrichedData, sceneReactor, null, reactionName, label);
        };

        const shouldTrigger = runGeneralEvaluate(automation, reactionName, triggerType, enrichedData, sceneReactor, api);
        dbgAuto(shouldTrigger ? 'fire:' : 'skip:', sceneName, reactionName, 'evaluate →', shouldTrigger);
        return shouldTrigger ? enrichedData : null;
    }
    catch (error)
    {
        console.error(`lancer-automations | Error evaluating scene automation ${reactionName}:`, error);
        return null;
    }
}

// Generic flow launcher: injects extraData into flow.state.la_extraData before begin().
async function _beginFlow(flowName, target, options = {}, extraData = {})
{
    const FlowClass = game.lancer.flows.get(flowName);

    if (!FlowClass)
    {
        ui.notifications.warn(localizeFormat('LA.notify.flowNotFoundPrefixed', { name: flowName }));
        return null;
    }

    const flow = new FlowClass(target, options);
    if (extraData && typeof extraData === 'object' && Object.keys(extraData).length > 0)
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    return flow.begin();
}

function _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType)
{
    const itemLid = item ? getItemLID(item) : null;

    return async (data, userId = null, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) =>
    {
        let targetUserId = userId;

        if (!targetUserId)
        {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id))
                return await checkOnMessageAutomations(token, itemLid, reactionPath, activationName, triggerType, data);
            targetUserId = ownerIds.at(0) ?? null;
            console.warn(`lancer-automations | sendMessageToReactor: no userId provided, falling back to token owner "${targetUserId}" for ${token.name}.`);
        }

        if (!targetUserId || targetUserId === game.user.id || !game.users.get(targetUserId)?.active)
            return await checkOnMessageAutomations(token, itemLid, reactionPath, activationName, triggerType, data);

        const requestId = wait ? `omsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'onMessage',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, triggerType, data: serializeTriggerData(data), requestId }
        });

        if (wait && requestId)
        {
            const reply = awaitPendingAck(requestId, { userId: targetUserId, fallback: null });

            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: localizeFormat('LA.reaction.waitingForUser', { name: game.users.get(targetUserId)?.name ?? localize('LA.reaction.remoteUser') }),
                    item: waitItem,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken,
                    onCancel: () => cancelPendingAck(requestId)
                })
                : null;

            try
            {
                return await reply;
            }
            finally
            {
                waitCard?.remove();
            }
        }
    };
}

function _spendsReactionOnStart(automation)
{
    return getModuleSetting('consumeReaction')
        && declaredActionType(automation) === 'Reaction'
        && automation?.checkReaction !== false;
}

export function _buildStartRelatedFlow(token, item, automation, activationName, extraData = {})
{
    return async () =>
    {
        if (_spendsReactionOnStart(automation) && !extraData?.reactionConsumed)
        {
            const before = trackerSnapshot(billingActor(token));

            if (!(await consumeReaction(token)))
            {
                ui.notifications.warn(localizeFormat('LA.notify.noReactionAvailable', { name: token?.name ?? '?' }));
                return false;
            }

            const after = trackerSnapshot(billingActor(token));
            extraData = { ...extraData, asReaction: true, reactionConsumed: true, reactionTracker: { before, after } };
        }

        if (item)
        {
            const reactionPath = automation?.reactionPath;

            if (reactionPath)
            {
                if (/^(?:system\.)?profiles\[\d+\]$/.test(reactionPath))
                {
                    console.warn(`lancer-automations | activation type "flow" cannot start a profile path (${reactionPath}), use code or none`);
                    return false;
                }

                const activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
                return _beginFlow("ActivationFlow", item, { action_path: activationPath }, extraData);
            }

            if (item.is_weapon?.())
                return _beginFlow("WeaponAttackFlow", item, {}, extraData);

            if (item.system?.actions?.length > 0)
            {
                const actionIndex = item.system.actions.findIndex(action => action.activation === 'Reaction');
                const path = actionIndex >= 0 ? `system.actions.${actionIndex}` : 'system.actions.0';
                return _beginFlow("ActivationFlow", item, { action_path: path }, extraData);
            }

            if (item.beginSystemFlow)
                return _beginFlow("SystemFlow", item, {}, extraData);
            return executeSimpleActivation(token.actor, { title: item.name, action: { name: item.name } }, { item, ...extraData });
        }

        const actor = token?.actor;

        if (!actor)
        {
            ui.notifications.warn(localize('LA.notify.startRelatedFlowNoActor'));
            return;
        }

        const actionType = declaredActionType(automation);
        if (['Automatic', 'Other'].includes(actionType))
            ui.notifications.warn(localizeFormat('LA.notify.startRelatedFlowMayMisbehave', { type: actionType }));

        const name = activationName || 'Unknown';
        return executeSimpleActivation(actor, {
            title: name,
            action: { name, activation: actionType },
            detail: automation?.effectDescription || ''
        }, extraData);
    };
}

function _buildStartRelatedFlowToReactor(token, item, automation, activationName)
{
    const itemLid = item ? getItemLID(item) : null;
    const reactionPath = automation?.reactionPath || "";
    const actionType = declaredActionType(automation);
    const effectDescription = automation?.effectDescription || '';

    return async (userId = null, extraData = {}, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) =>
    {
        let targetUserId = userId;

        if (!targetUserId)
        {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id))
                return _buildStartRelatedFlow(token, item, automation, activationName, extraData)();
            targetUserId = ownerIds.at(0) ?? null;
        }

        if (!targetUserId || targetUserId === game.user.id || !game.users.get(targetUserId)?.active)
            return _buildStartRelatedFlow(token, item, automation, activationName, extraData)();

        const requestId = wait ? `srf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        if (_spendsReactionOnStart(automation))
            reserveReaction(token);
        game.socket.emit('module.lancer-automations', {
            action: 'startRelatedFlow',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, actionType, checkReaction: automation?.checkReaction, effectDescription, extraData: extraData ?? {}, requestId }
        });

        if (wait && requestId)
        {
            const reply = awaitPendingAck(requestId, { userId: targetUserId });

            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: localizeFormat('LA.reaction.waitingForUser', { name: game.users.get(targetUserId)?.name ?? localize('LA.reaction.remoteUser') }),
                    item: waitItem ?? item,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken,
                    onCancel: () => cancelPendingAck(requestId)
                })
                : null;

            try
            {
                await reply;
            }
            finally
            {
                waitCard?.remove();
            }
        }
    };
}

function _buildRoutedStartRelatedFlow(token, item, automation, activationName)
{
    const local = _buildStartRelatedFlow(token, item, automation, activationName);
    const toReactor = _buildStartRelatedFlowToReactor(token, item, automation, activationName);
    return () => (token?.actor?.isOwner ? local() : toReactor(null, {}, { wait: true }));
}

/**
 * Trigger data for a popup shown on another client: the reactor functions dropped by serialization, rebuilt.
 * "Reactor" is a LEGACY NAME for the token the automation runs for. See the note on AutomationManager.
 * @returns {object}
 */
export function withReactorFunctions(triggerData, token, item, automation, activationName, triggerType)
{
    return {
        ...triggerData,
        startRelatedFlow: _buildRoutedStartRelatedFlow(token, item, automation, activationName),
        startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, automation, activationName),
        sendMessageToReactor: _buildSendMessageToReactor(token, item, item ? (automation?.reactionPath || "") : null, activationName, triggerType),
        askToActivate: _buildAskToActivate(token, item, automation, activationName, triggerData.triggeringToken)
    };
}

/**
 * Yes/no card to the reactor's owner, then the reaction's own flow on the responder's client.
 * Card defaults: title, item, reactor as owner and origin, triggering token as related.
 * @returns {(card?: object, opts?: { extraData?: object, wait?: boolean, background?: boolean }) => Promise<{ confirmed: boolean, responderIds: string[] }>}
 */
function _buildAskToActivate(token, item, automation, activationName, triggeringToken)
{
    const toReactor = _buildStartRelatedFlowToReactor(token, item, automation, activationName);

    return async (card = {}, { extraData = {}, wait = true, background = false } = {}) =>
    {
        const ask = await askCard({
            title: String(item?.name ?? activationName ?? '').toUpperCase(),
            item,
            originToken: token,
            relatedToken: triggeringToken ?? null,
            owner: token,
            ...card
        });

        if (!ask.confirmed)
            return ask;

        const start = toReactor(ask.responderIds[0] ?? null, extraData, { wait });
        if (background)
            start.catch(error => console.error('lancer-automations | askToActivate flow failed:', error));
        else
            await start;
        return ask;
    };
}

// Cancellable: autoActivate fires sequentially, the first cancel triggers a redo with _cancelledBy set.
const CANCELLABLE_TRIGGERS = new Set([
    'onPreMove', 'onPreInvoluntaryMove', 'onPreStructure', 'onPreStress',
    'onPreStatusApplied', 'onPreStatusRemoved',
    'onPreHpChange', 'onPreHeatChange',
]);

function debugAutomationOn()
{
    return !!getModuleSetting('debugAutomation');
}

function dbgAuto(...args)
{
    if (debugAutomationOn())
        console.log('lancer-automations | debug |', ...args);
}

const _laConfigWarnedSet = new Set();

function _warnAutomationConfigOnce(key, message)
{
    if (_laConfigWarnedSet.has(key))
        return;
    _laConfigWarnedSet.add(key);
    ui.notifications.warn(localizeFormat('LA.notify.prefixedWarning', { message }));
    console.warn(`lancer-automations | ${message}`);
}

async function checkAutomations(triggerType, data)
{
    const allTokens = getAllSceneTokens();
    const automationsPromises = [];
    const deferredFactories = [];
    const isCancellable = CANCELLABLE_TRIGGERS.has(triggerType);

    // Re-stamp reactor identity on shared fns right before activation fires, otherwise the last eval-loop assignment wins.
    const applyReactorIdentity = (automationTriggerData, identity, context) =>
    {
        for (const key of Object.keys(automationTriggerData))
        {
            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof automationTriggerData[key] === 'function')
            {
                automationTriggerData[key]._reactorIdentity = identity;
                automationTriggerData[key]._defaultContext = context;
            }
        }
    };

    const api = game.modules.get(MODULE_ID).api;

    const flatGeneralAutomations = getFlatGeneralAutomations();

    const actionBasedAutomations = data.actionName
        ? flatGeneralAutomations.filter(([name, automation]) =>
            name === data.actionName && automation.onlyOnSourceMatch && automation.triggers?.includes(triggerType)
            && automation.enabled !== false && onViewedScene(automation))
        : [];

    if (!cachedNonActionAutomationsByTrigger.has(triggerType))
    {
        const filtered = [];
        const sceneFiltered = [];

        for (const [reactionName, automation] of flatGeneralAutomations)
        {
            if (!automation.triggers?.includes(triggerType))
                continue;
            if (automation.enabled === false)
                continue;

            const sceneMode = sceneReactorMode(automation);
            // onlyOnSourceMatch entries reach the scene pass through actionBasedAutomations.
            if (sceneMode !== 'off' && !automation.onlyOnSourceMatch)
                sceneFiltered.push([reactionName, automation]);
            if (automation.onlyOnSourceMatch || sceneMode === 'only')
                continue;
            filtered.push([reactionName, automation]);
        }

        cachedNonActionAutomationsByTrigger.set(triggerType, filtered);
        cachedSceneAutomationsByTrigger.set(triggerType, sceneFiltered);
    }

    const nonActionBasedAutomations = cachedNonActionAutomationsByTrigger.get(triggerType);

    const triggeringTokenHidden = !!data.triggeringToken?.document?.hidden;

    // Process mover first so reroute-style reactions (Engagement) run before path reactors (Overwatch).
    const orderedTokens = isCancellable && data.triggeringToken
        ? [...allTokens].sort((left, right) =>
        {
            const leftSelf = left.id === data.triggeringToken.id ? 1 : 0;
            const rightSelf = right.id === data.triggeringToken.id ? 1 : 0;
            return rightSelf - leftSelf;
        })
        : allTokens;

    // Scene pass first: on cancellable triggers the scene's deferred factory wins the cancel race.
    const sceneCandidates = [];

    if (canvas.scene)
    {
        sceneCandidates.push(...cachedSceneAutomationsByTrigger.get(triggerType).filter(([, automation]) => onViewedScene(automation)));
        sceneCandidates.push(...actionBasedAutomations.filter(([, automation]) => sceneReactorMode(automation) !== 'off'));
    }

    const sceneReactor = sceneCandidates.length > 0 ? makeSceneReactor(canvas.scene) : null;

    for (const [reactionName, automation] of sceneCandidates)
    {
        const reactorIdentity = { sceneId: sceneReactor.scene.id, reactionName };
        const enrichedData = evaluateSceneAutomation(reactionName, automation, triggerType, data, sceneReactor, reactorIdentity);

        if (!enrichedData)
            continue;

        const automationTriggerData = { ...enrichedData,
            startRelatedFlow: _buildStartRelatedFlow(sceneReactor, null, automation, reactionName),
            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(sceneReactor, null, automation, reactionName),
            sendMessageToReactor: _buildSendMessageToReactor(sceneReactor, null, null, reactionName, triggerType)
        };

        const defaultCancelContext = { item: null, originToken: null, relatedToken: enrichedData.triggeringToken ?? null };
        applyReactorIdentity(automationTriggerData, reactorIdentity, defaultCancelContext);

        if (!automation.autoActivate)
        {
            automationQueue.push({
                triggerType,
                token: sceneReactor,
                item: null,
                reaction: automation,
                itemName: reactionName,
                reactionName,
                isGeneral: true,
                triggerData: automationTriggerData
            });
            continue;
        }

        if (isCancellable)
        {
            deferredFactories.push(() =>
            {
                applyReactorIdentity(automationTriggerData, reactorIdentity, defaultCancelContext);
                return activateAutomation(triggerType, automationTriggerData, sceneReactor, null, reactionName, automation, true);
            });
            continue;
        }

        try
        {
            const activation = activateAutomation(triggerType, automationTriggerData, sceneReactor, null, reactionName, automation, true);

            if (activation instanceof Promise)
            {
                activation.catch(error => console.error(`lancer-automations | Error auto-activating scene automation:`, error));
                if (automation.awaitActivationCompletion !== false)
                    automationsPromises.push({ name: reactionName, promise: activation });
            }
        }
        catch (error)
        {
            console.error(`lancer-automations | Error auto-activating scene automation:`, error);
        }
    }

    for (const token of orderedTokens)
    {
        const isSelf = data.triggeringToken?.id === token.id;
        const isTarget = (data.hitTokens ?? []).some(hitToken => hitToken.id === token.id);

        // Hidden triggering tokens: only self- and target-reactions fire (being attacked is knowable).
        if (triggeringTokenHidden && !isSelf && !isTarget)
            continue;

        const isInCombat = (token.inCombat && !!game.combat?.started) || fightsThroughOwner(token);

        const sourceToken = data.isEnvironment ? null : data.triggeringToken;
        let tokenContext = null;

        const contextOf = () =>
        {
            if (!tokenContext)
            {
                const distanceToTrigger = sourceToken ? getTokenDistance(token, sourceToken) : null;
                const provokeReasons = [];
                const canTriggerReaction = !(data.moveInfo?.isTeleport && !isSelf) && api.canProvokeReaction(sourceToken, token, provokeReasons);
                tokenContext = { provokeReasons, canTriggerReaction, enrichedData: { ...data, distanceToTrigger, canTriggerReaction, isTarget, targetEntry: findTargetEntry(data, token) } };
            }

            return tokenContext;
        };

        const items = getAutomationItems(token);

        for (const item of items)
        {
            const lid = getItemLID(item);
            if (!lid)
                continue;

            const registryEntry = AutomationManager.getAutomations(lid);
            if (!registryEntry)
                continue;

            for (const automation of registryEntry.reactions)
            {
                if (!automation.triggers?.includes(triggerType))
                    continue;

                if (automation.enabled === false)
                {
                    dbgAuto('skip:', token.name, item.name, lid, 'automation disabled');
                    continue;
                }

                if (!automationRunsOnToken(automation, token, item))
                {
                    dbgAuto('skip:', token.name, item.name, lid, 'runs on', automation.runsOn ?? 'mech');
                    continue;
                }

                const { canTriggerReaction, provokeReasons, enrichedData } = contextOf();

                dbgAuto('candidate:', token.name, item.name, lid, { triggers: automation.triggers, reactionPath: automation.reactionPath || null });

                if (data.isEnvironment && !automation.triggerEnvironment)
                {
                    dbgAuto('skip:', token.name, item.name, 'environment source', { setting: 'triggerEnvironment', value: false });
                    continue;
                }

                if (automation.onlyOnSourceMatch)
                {
                    const triggeringItem = data.weapon || data.techItem || data.item;
                    const triggeringItemLid = triggeringItem?.system?.lid ?? null;
                    const triggeringDepLid = data.deployable?.lid ?? null;
                    const triggeringActorUuid = data.triggeringToken?.actor?.uuid ?? null;
                    const triggeringBaseActorUuid = data.triggeringToken?.document?.baseActor?.uuid ?? null;

                    if (triggeringItemLid !== lid && triggeringDepLid !== lid && triggeringActorUuid !== lid && triggeringBaseActorUuid !== lid)
                    {
                        dbgAuto('skip:', token.name, item.name, 'onlyOnSourceMatch failed', { triggeringItemLid, triggeringDepLid, triggeringActorUuid, triggeringBaseActorUuid, lid });
                        continue;
                    }

                    // Same-LID dedupe: when reactor owns multiple items sharing this LID, only the exact triggering doc fires.
                    if (triggeringItem && triggeringItemLid === lid && triggeringItem.id !== item.id)
                    {
                        dbgAuto('skip:', token.name, item.name, 'onlyOnSourceMatch: not the triggering doc');
                        continue;
                    }
                }

                if (!isInCombat && !automation.outOfCombat && !firesRegardlessOfCombat(triggerType))
                {
                    if ((token.isOwner || game.user.isGM) && getModuleSetting('debugOutOfCombat'))
                        ui.notifications.warn(localizeFormat('LA.notify.notTriggeredOutOfCombat', { reaction: item.name, name: token.name }));
                    if (triggerType === 'onActivation' && (token.isOwner || game.user.isGM))
                        _warnAutomationConfigOnce(`ooc|${lid}|${automation.reactionPath || ''}`, `"${item.name}" only triggers in combat. Enable "Out of Combat" to allow it outside.`);
                    dbgAuto('skip:', token.name, item.name, 'out of combat', { setting: 'outOfCombat', value: automation.outOfCombat });
                    continue;
                }

                if (isSelf)
                {
                    if (!automation.triggerSelf)
                    {
                        dbgAuto('skip:', token.name, item.name, 'reactor is the trigger source', { setting: 'triggerSelf', value: !!automation.triggerSelf });
                        continue;
                    }
                }
                else
                {
                    if (automation.triggerOther === false && !(automation.triggerTarget === true && isTarget))
                    {
                        dbgAuto('skip:', token.name, item.name, 'reactor is not the trigger source or target', { setting: 'triggerOther', value: !!automation.triggerOther });
                        continue;
                    }
                }

                if (automation.checkReaction && !(isSelf && data.reactionJustConsumed) && !hasReactionAvailable(token))
                {
                    dbgAuto('skip:', token.name, item.name, 'no reaction available', { setting: 'checkReaction', value: true });
                    continue;
                }

                if (automation.requireCanProvoke && (!canTriggerReaction || data._provokeImmunityBurned))
                {
                    if (provokeReasons.includes('provoke_immunity') && !data._provokeImmunityBurned)
                    {
                        data._provokeImmunityBurned = true;
                        api.consumeImmunityUse?.(sourceToken.actor, 'provoke');
                    }

                    dbgAuto('skip:', token.name, item.name, 'cannot provoke', { setting: 'requireCanProvoke', value: true, reasons: provokeReasons });
                    continue;
                }

                const reactionPath = automation.reactionPath || "";

                if (!isItemAvailable(item, reactionPath))
                {
                    dbgAuto('skip:', token.name, item.name, 'item not available', { destroyed: item.system?.destroyed, disabled: item.system?.disabled, reactionPath: automation.reactionPath || null });
                    continue;
                }

                if (automation.checkUsage)
                {
                    const sys = item.system;
                    const tags = sys?.tags ?? [];
                    const hasTag = tagLid => tags.some(tag => tag?.lid === tagLid);
                    const tagVal = tagLid => Number(tags.find(tag => tag?.lid === tagLid)?.val ?? 0);
                    const hasLoading = hasTag('tg_loading');
                    const hasRecharge = hasTag('tg_recharge');
                    const hasUses = sys?.uses?.max > 0;
                    const perRoundLimit = game.combat?.started && getModuleSetting('enablePerRoundTurnTags') ? tagVal('tg_round') : 0;
                    const perTurnLimit = game.combat?.started && getModuleSetting('enablePerRoundTurnTags') ? tagVal('tg_turn') : 0;

                    if (!hasLoading && !hasRecharge && !hasUses && !perRoundLimit && !perTurnLimit && (token.isOwner || game.user.isGM))
                        _warnAutomationConfigOnce(`usage|${lid}|${automation.reactionPath || ''}`, `"${item.name}" has Check Usage enabled but no loading, recharge, limited uses, or per-round/turn tag. The check has no effect.`);

                    if (hasLoading && sys?.loaded === false)
                    {
                        dbgAuto('skip:', token.name, item.name, 'not loaded', { setting: 'checkUsage', value: automation.checkUsage, tag: 'tg_loading' });
                        continue;
                    }

                    if (hasUses && sys.uses.value <= 0)
                    {
                        dbgAuto('skip:', token.name, item.name, 'no uses left', { setting: 'checkUsage', value: automation.checkUsage, uses: sys.uses });
                        continue;
                    }

                    if (hasRecharge && sys?.charged === false)
                    {
                        dbgAuto('skip:', token.name, item.name, 'not charged', { setting: 'checkUsage', value: automation.checkUsage, tag: 'tg_recharge' });
                        continue;
                    }

                    if (perRoundLimit > 0 && Number(sys?.uses_per_round?.value ?? 0) >= perRoundLimit)
                    {
                        dbgAuto('skip:', token.name, item.name, 'per-round limit reached', { setting: 'checkUsage', value: automation.checkUsage, limit: perRoundLimit, used: sys?.uses_per_round?.value });
                        continue;
                    }

                    if (perTurnLimit > 0 && Number(sys?.uses_per_turn?.value ?? 0) >= perTurnLimit)
                    {
                        dbgAuto('skip:', token.name, item.name, 'per-turn limit reached', { setting: 'checkUsage', value: automation.checkUsage, limit: perTurnLimit, used: sys?.uses_per_turn?.value });
                        continue;
                    }
                }

                if (!checkDispositionFilter(token, data.triggeringToken, automation.dispositionFilter))
                {
                    dbgAuto('skip:', token.name, item.name, 'disposition filter failed', { setting: 'dispositionFilter', value: automation.dispositionFilter });
                    continue;
                }

                try
                {
                    let activationName = item.name;
                    const reactionPath = automation.reactionPath || "";
                    // actionName only identifies a sub-action on activation triggers, elsewhere it's a flow title
                    const actionNameIsSubAction = ACTIVATION_TRIGGERS.has(triggerType);

                    if (reactionPath && reactionPath !== "" && reactionPath !== "system" && reactionPath !== "system.trigger")
                    {
                        let actionData = null;

                        if (reactionPath.startsWith("extraActions."))
                        {
                            const actionName = reactionPath.slice("extraActions.".length);
                            const extraActions = getLAFlag(item,'extraActions') || [];
                            actionData = extraActions.find(action => action.name === actionName) ?? null;
                        }
                        else if (reactionPath.startsWith("actions."))
                        {
                            // Lookup-by-name for deployables whose action LIDs are empty strings (name is the only key).
                            const actionName = reactionPath.slice("actions.".length);
                            const list = item.system?.actions ?? [];
                            actionData = list.find(action => action.name === actionName) ?? null;
                        }
                        else
                        {
                            const pathParts = reactionPath.split(/\.|\[|\]/).filter(part => part !== "");
                            actionData = item.system;

                            for (const part of pathParts)
                            {
                                if (actionData && (typeof actionData === 'object' || Array.isArray(actionData)))
                                    actionData = actionData[part];
                                else
                                {
                                    actionData = null;
                                    break;
                                }
                            }

                            // Frame core_system: `name` is the system title, `active_name` is the activation that fires.
                            if (actionData && reactionPath === 'core_system' && actionData.active_name)
                                actionData = { ...actionData, name: actionData.active_name };
                        }

                        if (actionData?.name)
                        {
                            activationName = actionData.name;

                            if (actionNameIsSubAction && data.actionName && data.actionName !== activationName)
                            {
                                dbgAuto('skip:', token.name, item.name, 'action name mismatch', { actionName: data.actionName, expected: activationName, reactionPath });
                                continue;
                            }
                        }
                    }
                    else if (actionNameIsSubAction && automation.onlyOnSourceMatch && data.actionName && data.actionName !== item.name)
                    {
                        // No reactionPath: skip when a specific sub-action was triggered (not the base item)
                        dbgAuto('skip:', token.name, item.name, 'action name mismatch', { setting: 'onlyOnSourceMatch', actionName: data.actionName, expected: item.name });
                        continue;
                    }

                    // Skip if this reaction already triggered a cancel on a previous pass
                    const cancelledBy = enrichedData._cancelledBy;

                    if (cancelledBy?.length > 0)
                    {
                        const isCancelled = cancelledBy.some(cancelRecord =>
                            cancelRecord.tokenId === token.id && cancelRecord.lid === lid && cancelRecord.reactionPath === (automation.reactionPath || "")
                        );

                        if (isCancelled)
                        {
                            dbgAuto('skip:', token.name, item.name, 'already cancelled this pass');
                            continue;
                        }
                    }

                    enrichedData.debugActivation = function (label)
                    {
                        return debugActivation(triggerType, this ?? enrichedData, token, item, activationName, label);
                    };

                    let shouldTrigger = false;

                    if (typeof automation.evaluate === 'function')
                    {
                        const result = automation.evaluate(triggerType, enrichedData, token, item, activationName, api);
                        if (result instanceof Promise)
                        {
                            console.error(`lancer-automations | evaluate for "${item.name}" is async. Evaluate functions must be synchronous.`);
                            result.then(_ =>
                            { /* fire-and-forget */ });
                            shouldTrigger = false;
                        }
                        else
                            shouldTrigger = result;
                        dbgAuto('evaluate(fn):', token.name, item.name, '→', shouldTrigger);
                    }
                    else if (typeof automation.evaluate === 'string' && automation.evaluate.trim() !== '')
                    {
                        try
                        {
                            const evalFunc = stringToFunction(automation.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], automation, `${lid}/${registryEntry.reactions.indexOf(automation)}/evaluate`);
                            const result = evalFunc(triggerType, enrichedData, token, item, activationName, api);

                            if (result instanceof Promise)
                            {
                                console.error(`lancer-automations | String evaluate for "${item.name}" returned a Promise. Evaluate functions must be synchronous.`);
                                shouldTrigger = false;
                            }
                            else
                                shouldTrigger = result;
                        }
                        catch (error)
                        {
                            console.error(`lancer-automations | Error parsing custom evaluate for ${item.name}:`, error);
                        }
                    }
                    else
                    {
                        shouldTrigger = true;
                        dbgAuto('evaluate(none):', token.name, item.name, '→ default true');
                    }

                    if (shouldTrigger)
                    {
                        dbgAuto('fire:', token.name, item.name, 'autoActivate:', !!automation.autoActivate);

                        const automationTriggerData = { ...enrichedData,
                            startRelatedFlow: _buildRoutedStartRelatedFlow(token, item, automation, activationName),
                            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, automation, activationName),
                            sendMessageToReactor: _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType),
                            askToActivate: _buildAskToActivate(token, item, automation, activationName, enrichedData.triggeringToken)
                        };

                        const reactorIdentity = { tokenId: token.id, lid, reactionPath: automation.reactionPath || "" };
                        const defaultCancelContext = { item, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                        for (const key of Object.keys(automationTriggerData))
                        {
                            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof automationTriggerData[key] === 'function')
                            {
                                automationTriggerData[key]._reactorIdentity = reactorIdentity;
                                automationTriggerData[key]._defaultContext = defaultCancelContext;
                            }
                        }

                        if (automation.autoActivate)
                        {
                            if (isCancellable)
                            {
                                deferredFactories.push(() =>
                                {
                                    applyReactorIdentity(automationTriggerData, reactorIdentity, defaultCancelContext);
                                    return activateAutomation(triggerType, automationTriggerData, token, item, activationName, automation, false);
                                });
                            }
                            else
                            {
                                try
                                {
                                    const activation = activateAutomation(triggerType, automationTriggerData, token, item, activationName, automation, false);

                                    if (activation instanceof Promise)
                                    {
                                        activation.catch(error => console.error(`lancer-automations | Error auto-activating automation:`, error));
                                        if (automation.awaitActivationCompletion !== false)
                                            automationsPromises.push({ name: activationName, promise: activation });
                                    }
                                }
                                catch (error)
                                {
                                    console.error(`lancer-automations | Error auto-activating automation:`, error);
                                }
                            }
                        }
                        else
                        {
                            automationQueue.push({
                                triggerType,
                                token,
                                item,
                                reaction: automation,
                                itemName: item.name,
                                reactionName: activationName,
                                triggerData: automationTriggerData
                            });
                        }
                    }
                }
                catch (error)
                {
                    console.error(`lancer-automations | Error evaluating automation ${item.name}:`, error);
                }
            }
        }

        for (const [reactionName, automation] of actionBasedAutomations)
        {
            if (sceneReactorMode(automation) === 'only')
                continue;

            const enrichedData = evaluateGeneralAutomation(reactionName, automation, triggerType, data, token, isSelf, isTarget, isInCombat);

            if (enrichedData)
            {
                const automationTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildRoutedStartRelatedFlow(token, null, automation, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, automation, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType),
                    askToActivate: _buildAskToActivate(token, null, automation, reactionName, enrichedData.triggeringToken)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                for (const key of Object.keys(automationTriggerData))
                {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof automationTriggerData[key] === 'function')
                    {
                        automationTriggerData[key]._reactorIdentity = reactorIdentity;
                        automationTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (automation.autoActivate)
                {
                    if (isCancellable)
                    {
                        deferredFactories.push(() =>
                        {
                            applyReactorIdentity(automationTriggerData, reactorIdentity, defaultCancelContext);
                            return activateAutomation(triggerType, automationTriggerData, token, null, reactionName, automation, true);
                        });
                    }
                    else
                    {
                        try
                        {
                            const activation = activateAutomation(triggerType, automationTriggerData, token, null, reactionName, automation, true);

                            if (activation instanceof Promise)
                            {
                                activation.catch(error => console.error(`lancer-automations | Error auto-activating general automation:`, error));
                                if (automation.awaitActivationCompletion !== false)
                                    automationsPromises.push({ name: reactionName, promise: activation });
                            }
                        }
                        catch (error)
                        {
                            console.error(`lancer-automations | Error auto-activating general automation:`, error);
                        }
                    }
                }
                else
                {
                    automationQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction: automation,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: automationTriggerData
                    });
                }
            }
        }

        for (const [reactionName, automation] of nonActionBasedAutomations)
        {
            if (!onViewedScene(automation))
                continue;

            const enrichedData = evaluateGeneralAutomation(reactionName, automation, triggerType, data, token, isSelf, isTarget, isInCombat);

            if (enrichedData)
            {
                const automationTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildRoutedStartRelatedFlow(token, null, automation, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, automation, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType),
                    askToActivate: _buildAskToActivate(token, null, automation, reactionName, enrichedData.triggeringToken)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                for (const key of Object.keys(automationTriggerData))
                {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof automationTriggerData[key] === 'function')
                    {
                        automationTriggerData[key]._reactorIdentity = reactorIdentity;
                        automationTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (automation.autoActivate)
                {
                    if (isCancellable)
                    {
                        deferredFactories.push(() =>
                        {
                            applyReactorIdentity(automationTriggerData, reactorIdentity, defaultCancelContext);
                            return activateAutomation(triggerType, automationTriggerData, token, null, reactionName, automation, true);
                        });
                    }
                    else
                    {
                        try
                        {
                            const activation = activateAutomation(triggerType, automationTriggerData, token, null, reactionName, automation, true);

                            if (activation instanceof Promise)
                            {
                                activation.catch(error => console.error(`lancer-automations | Error auto-activating general automation:`, error));
                                if (automation.awaitActivationCompletion !== false)
                                    automationsPromises.push({ name: reactionName, promise: activation });
                            }
                        }
                        catch (error)
                        {
                            console.error(`lancer-automations | Error auto-activating general automation:`, error);
                        }
                    }
                }
                else
                {
                    automationQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction: automation,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: automationTriggerData
                    });
                }
            }
        }
    }

    // Run before awaiting automationsPromises so synchronous cancel fires same tick as caller (preUpdateToken).
    if (isCancellable && deferredFactories.length > 0)
    {
        const startLen = data._cancelledBy?.length ?? 0;
        const cancelRaised = () => (data._cancelledBy?.length ?? 0) > startLen;

        for (const factory of deferredFactories)
        {
            try
            {
                const activation = factory();
                if (activation instanceof Promise)
                    activation.catch(error => console.error('lancer-automations | async automation error:', error));
                if (cancelRaised())
                    break;
            }
            catch (error)
            {
                console.error('lancer-automations | automation error:', error);
            }
        }
    }

    const collected = new Map();

    if (automationsPromises.length > 0)
    {
        const settled = await Promise.allSettled(automationsPromises.map(entry => entry.promise));
        settled.forEach((outcome, index) =>
        {
            const value = outcome.status === 'fulfilled' ? outcome.value : undefined;
            if (value === undefined)
                return;

            const name = automationsPromises[index].name;
            if (!collected.has(name))
                collected.set(name, []);
            collected.get(name).push(value);
        });
    }

    const results = {};
    for (const [name, values] of collected)
        results[name] = values.length === 1 ? values[0] : values;

    if (automationDebounceTimer)
        clearTimeout(automationDebounceTimer);

    automationDebounceTimer = setTimeout(async () =>
    {
        if (automationQueue.length > 0)
        {
            const manualAutomations = [...automationQueue];
            automationQueue.length = 0;

            if (manualAutomations.length > 0)
            {
                const mode = getModuleSetting('reactionNotificationMode');
                const distribution = new Map();

                const allGMs = game.users.filter(user => user.active && user.isGM);

                for (const automation of manualAutomations)
                {
                    const recipients = new Set();

                    if (mode === 'owner' || mode === 'both')
                    {
                        const owners = game.users.filter(user => user.active && !user.isGM && automation.token.document.testUserPermission(user, "OWNER"));
                        owners.forEach(user => recipients.add(user));
                        if (mode === 'owner' && owners.length === 0)
                            allGMs.forEach(user => recipients.add(user));
                    }

                    if (mode === 'gm' || mode === 'both')
                        allGMs.forEach(user => recipients.add(user));

                    for (const user of recipients)
                    {
                        if (!distribution.has(user.id))
                            distribution.set(user.id, []);
                        distribution.get(user.id).push(automation);
                    }
                }

                const mainTrigger = manualAutomations[0].triggerType;

                for (const [userId, automations] of distribution)
                {
                    if (userId === game.userId)
                        displayAutomationPopup(mainTrigger, automations);
                    else
                    {
                        const payload = {
                            targetUserId: userId,
                            triggerType: mainTrigger,
                            reactions: automations.map(entry => ({
                                tokenId: entry.token.id,
                                itemId: entry.item?.id,
                                itemLid: entry.item ? getItemLID(entry.item) : undefined,
                                reactionName: entry.reactionName,
                                itemName: entry.itemName,
                                isGeneral: entry.isGeneral,
                                subIndex: entry.isGeneral ? entry.reaction?._subIndex : undefined,
                                itemAutomationIndex: entry.isGeneral ? undefined : AutomationManager.getAutomations(getItemLID(entry.item))?.reactions?.indexOf(entry.reaction),
                                triggerData: serializeTriggerData(entry.triggerData)
                            }))
                        };

                        game.socket.emit('module.lancer-automations', {
                            action: 'showAutomationPopup',
                            payload: payload
                        });
                    }
                }
            }

            automationQueue = [];
            automationDebounceTimer = null;
        }
    }, AUTOMATION_DEBOUNCE_MS);
    return results;
}

// originId may be the triggering token, a single target, or inside targets[]; role 'source' = caused it, 'target' = was hit by it, else either side.
function isOriginInvolved(originId, role, data)
{
    const isSource = data.triggeringToken?.id === originId;
    const isTarget = (data.hitTokens ?? []).some(hitToken => hitToken.id === originId) || data.target?.id === originId;

    if (role === 'source')
        return isSource;
    if (role === 'target')
        return isTarget;
    return isSource || isTarget;
}

function passesBuiltInFilters(consumption, triggerType, data)
{
    if (consumption.itemLid)
    {
        const triggeringItem = data.weapon || data.techItem || data.item;
        const currentLid = triggeringItem?.system?.lid;

        if (!currentLid)
            return false;

        const validLids = consumption.itemLid.split(',').map(lid => lid.trim()).filter(Boolean);
        if (!validLids.includes(currentLid))
            return false;
    }

    if (consumption.itemId)
    {
        const triggeringItem = data.weapon || data.techItem || data.item;
        if (!triggeringItem)
            return false;

        const id = triggeringItem.id || triggeringItem._id;
        if (id !== consumption.itemId)
            return false;
    }

    if (consumption.actionName)
    {
        if (data.actionName !== consumption.actionName)
            return false;
    }

    if (consumption.minDistance !== undefined && consumption.minDistance !== null)
    {
        if ((data.distanceMoved || 0) < consumption.minDistance)
            return false;
    }

    if (consumption.checkType)
    {
        if (data.statName !== consumption.checkType)
            return false;
    }

    if (consumption.checkAbove !== undefined && consumption.checkAbove !== null)
    {
        if ((data.total || 0) < consumption.checkAbove)
            return false;
    }

    if (consumption.checkBelow !== undefined && consumption.checkBelow !== null)
    {
        if ((data.total || 0) > consumption.checkBelow)
            return false;
    }

    if (consumption.statusId)
    {
        const triggerStatusId = data.statusId || data.effect?.statuses?.first() || data.effect?.name;
        const allowedIds = consumption.statusId.split(',').map(statusId => statusId.trim()).filter(Boolean);

        if (!allowedIds.includes(triggerStatusId))
            return false;
    }

    return true;
}

export async function processEffectConsumption(triggerType, data)
{
    const allTokens = getAllSceneTokens();

    const consumptionPromises = [];

    for (const token of allTokens)
    {
        const actor = token.actor;
        if (!actor)
            continue;

        const consumableEffects = actor.effects.filter(effect =>
        {
            const consumption = getLAFlags(effect)?.consumption;
            const trigger = consumption?.trigger;

            if (!trigger || effect.disabled)
                return false;
            return Array.isArray(trigger) ? trigger.includes(triggerType) : trigger === triggerType;
        });

        if (consumableEffects.length === 0)
            continue;

        const consumedGroups = new Set();

        for (const effect of consumableEffects)
        {
            const consumption = getLAFlag(effect,'consumption');
            if (!consumption)
                continue;

            if (consumption.groupId && consumedGroups.has(consumption.groupId))
                continue;

            const originId = consumption.originId || token.id;
            if (!TOKENLESS_TRIGGERS.has(triggerType) && !isOriginInvolved(originId, consumption.role, data))
                continue;

            if (!passesBuiltInFilters(consumption, triggerType, data))
                continue;

            const processConsumption = async () =>
            {
                const linkedBonus = linkedBonusOf(token.actor, effect);
                const limitState = { actor: token.actor };

                if (linkedBonus?.frequency && !bonusFrequencyFree(linkedBonus, limitState))
                    return;

                if (consumption.evaluate)
                {
                    try
                    {
                        let shouldConsume = false;

                        if (typeof consumption.evaluate === 'function')
                            shouldConsume = await consumption.evaluate(triggerType, data, token, effect);
                        else if (typeof consumption.evaluate === 'string' && consumption.evaluate.trim() !== '')
                        {
                            const evalFunc = stringToFunction(consumption.evaluate, ["triggerType", "triggerData", "effectBearerToken", "effect"]);
                            shouldConsume = await evalFunc(triggerType, data, token, effect);
                        }

                        if (!shouldConsume)
                            return;
                    }
                    catch (error)
                    {
                        console.error(`lancer-automations | Error evaluating consumption for ${effect.name}:`, error);
                        return;
                    }
                }

                if (linkedBonus?.frequency)
                    await burnBonusFrequency(linkedBonus, limitState);

                if (triggerType === 'onDamage' && effect.changes?.some(change => change.key?.startsWith('system.resistances.')))
                {
                    deferResistanceEffectConsumption(token.actor, effect);
                    return;
                }

                console.log(`lancer-automations | Consuming charge on ${effect.name} (trigger: ${triggerType})`);
                if (consumption.groupId)
                    consumedGroups.add(consumption.groupId);
                await consumeEffectCharge(effect);
            };

            consumptionPromises.push(processConsumption());
        }
    }

    await Promise.all(consumptionPromises);
}

const _BATTLELOG_TELEMETRY_TRIGGERS = new Set(['onHit', 'onMiss', 'onTechHit', 'onTechMiss', 'onStructure', 'onStress', 'onDestroyed', 'onCheck', 'onActivation', 'onEndActivation', 'onStatusApplied', 'onDeploy']);

export async function handleTrigger(triggerType, data)
{
    if (isEnvironmentActor(data?.flowState?.actor) && canvas.scene)
    {
        data.triggeringToken = makeSceneReactor(canvas.scene);
        data.isEnvironment = true;
    }

    dbgAuto('handleTrigger', triggerType, {
        triggeringToken: data?.triggeringToken?.name,
        statusId: data?.statusId,
        effectName: data?.effect?.name,
        actionName: data?.actionName,
        itemName: (data?.item ?? data?.weapon ?? data?.techItem)?.name,
        payload: Object.keys(data ?? {}).sort().join(', '),
    });
    if (_BATTLELOG_TELEMETRY_TRIGGERS.has(triggerType))
        Hooks.callAll('lancer-automations.battelog.trigger', triggerType, data);
    // onInit* triggers fire from system events (token creation, etc.) and shouldn't leak hidden state in chat.
    if (triggerType?.startsWith('onInit'))
        return runInOnInitTriggerContext(() => _handleTriggerBody(triggerType, data));
    return _handleTriggerBody(triggerType, data);
}

/**
 * Fire a user-defined trigger. Automations listing `name` in their triggers react to it, in or out of combat.
 * Built-in names and the onInit prefix are refused.
 * @param {string} name
 * @param {object} [data] trigger payload, `triggeringToken` enables the self/other, disposition and distance filters
 * @returns {Promise<void>}
 */
export async function dispatchCustomTrigger(name, data = {})
{
    const triggerType = typeof name === 'string' ? name.trim() : '';

    if (!triggerType || BUILT_IN_TRIGGERS.has(triggerType) || triggerType.startsWith('onInit'))
    {
        ui.notifications.warn(localizeFormat('LA.notify.invalidCustomTrigger', { name }));
        return;
    }

    return handleTrigger(triggerType, (data && typeof data === 'object') ? data : {});
}

async function _handleTriggerBody(triggerType, data)
{
    // runInFlowBody: child flow.begin() from reactions routes to innerChain, avoids parent-await deadlock.
    return runInFlowBody(async () =>
    {
        // Normalized target list: entries may be raw tokens or { target }/{ token } wrappers, single target included.
        if (!('hitTokens' in data))
        {
            const unwrap = entry => (entry?.constructor === Object ? (entry.target ?? entry.token) : entry);
            const single = data.target ?? data.token ?? data.checkAgainstToken;
            const raw = Array.isArray(data.targets) ? data.targets.map(unwrap) : (single ? [unwrap(single)] : []);
            data.hitTokens = raw.filter(candidate => candidate?.actor);
        }

        data.isRangedAttack = () => isRangedAttack(data);

        data.startRelatedFlow = async () =>
        {
            const item = data.item ?? data.weapon ?? data.techItem;
            const actor = data.triggeringToken?.actor;
            const actionData = data.actionData;

            if (item)
            {
                const actionPath = actionData?.flowState?.data?.action_path ?? null;
                return item.beginActivationFlow(actionPath);
            }

            if (actionData)
            {
                const actionType = actionData.action?.activation ?? actionData.type;

                if (!actionType || ['Automatic', 'Other'].includes(actionType))
                {
                    ui.notifications.warn(localizeFormat('LA.notify.startRelatedFlowCannotRelaunch', { type: actionType }));
                    return;
                }

                if (!actor)
                {
                    ui.notifications.warn(localize('LA.notify.startRelatedFlowNoActor'));
                    return;
                }

                return executeSimpleActivation(actor, {
                    title: actionData.title,
                    action: actionData.action,
                    detail: actionData.detail,
                    tags: actionData.tags
                });
            }

            ui.notifications.warn(localize('LA.notify.startRelatedFlowNoData'));
        };

        const automationsPromise = checkAutomations(triggerType, data);
        const consumptionPromise = processEffectConsumption(triggerType, data);
        const results = await automationsPromise;
        await consumptionPromise;
        return results;
    });
}

export function serializeTriggerData(data, depth = 0)
{
    if (!data || depth > 8)
        return null;

    const serialize = (value, currentDepth) =>
    {
        if (currentDepth > 8 || value === null || value === undefined)
            return value;
        if (typeof value === 'function')
            return undefined;
        if (value?.document?.documentName === 'Token')
            return { __type: 'token', id: value.id };
        if (value?.documentName === 'Token')
            return { __type: 'tokenDoc', id: value.id };
        if (value?.documentName === 'Actor')
            return { __type: 'actor', id: value.id, uuid: value.uuid };
        if (value?.documentName === 'Item')
            return { __type: 'item', uuid: value.uuid };
        if (value instanceof Roll)
            return { __type: 'roll', data: value.toJSON() };
        if (Array.isArray(value))
            return value.map(item => serialize(item, currentDepth + 1)).filter(item => item !== undefined);

        if (typeof value === 'object')
        {
            try
            {
                const result = {};

                for (const [entryKey, entryValue] of Object.entries(value))
                {
                    const serialized = serialize(entryValue, currentDepth + 1);
                    if (serialized !== undefined)
                        result[entryKey] = serialized;
                }

                return result;
            }
            catch (error)
            {
                return undefined;
            }
        }

        return value;
    };

    const result = {};

    for (const [key, value] of Object.entries(data))
    {
        const serialized = serialize(value, depth + 1);
        if (serialized !== undefined)
            result[key] = serialized;
    }

    return result;
}

export function deserializeTriggerData(data)
{
    if (!data)
        return null;

    const deserialize = (value) =>
    {
        if (value === null || value === undefined)
            return value;
        if (typeof value === 'object' && value.__type === 'token')
            return canvas.tokens.get(value.id) ?? null;
        if (typeof value === 'object' && value.__type === 'tokenDoc')
            return canvas.tokens.get(value.id)?.document ?? null;
        if (typeof value === 'object' && value.__type === 'actor')
            return (value.uuid ? fromUuidSync(value.uuid) : null) ?? game.actors.get(value.id) ?? null;
        if (typeof value === 'object' && value.__type === 'item')
            return fromUuidSync(value.uuid) ?? null;
        if (typeof value === 'object' && value.__type === 'roll')
            return Roll.fromData(value.data);
        if (Array.isArray(value))
            return value.map(deserialize);

        if (typeof value === 'object')
        {
            const result = {};
            for (const [key, entryValue] of Object.entries(value))
                result[key] = deserialize(entryValue);
            return result;
        }

        return value;
    };

    return deserialize(data);
}
