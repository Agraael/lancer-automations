import { ReactionManager, stringToFunction, stringToAsyncFunction } from "./reaction-manager.js";
import { displayReactionPopup, activateReaction } from "./reactions-ui.js";
import { runInFlowBody } from "./flow-queue.js";
import { getTokenOwnerUserId, startWaitCard } from "../interactive/index.js";
import { consumeEffectCharge, runInOnInitTriggerContext } from "../bonuses/flagged-effects.js";
import { getTokenDistance } from "../combat/overwatch.js";
import { getItemLID, isItemAvailable, hasReactionAvailable, executeSimpleActivation, debugActivation, isRangedAttack } from "../tools/misc-tools.js";
import { awaitPendingAck } from "../socket.js";

let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;
let cachedFlatGeneralReactions = null;
/** @type {Map<string, Array>} triggerType to filtered non-action reactions, cleared with cachedFlatGeneralReactions */
const cachedNonActionReactionsByTrigger = new Map();
/** @type {Map<string, Array>} triggerType to general reactions with sceneReactor on, evaluated once as the scene */
const cachedSceneReactionsByTrigger = new Map();
const COMBAT_INHERENT_TRIGGERS = new Set(['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd', 'onRoundStart']);
const REACTION_ITEM_TYPES = new Set(["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent", "bond"]);
const sceneReactorMode = reaction => reaction.sceneReactor || 'off';
const onViewedScene = reaction => !reaction.sceneId || reaction.sceneId === canvas.scene?.id;

Hooks.on('lancer-automations.clearCaches', () =>
{
    cachedFlatGeneralReactions = null;
    cachedNonActionReactionsByTrigger.clear();
    cachedSceneReactionsByTrigger.clear();
});

Hooks.on('createItem', (item) =>
{
    if (!item.parent)
        return;
    if (!REACTION_ITEM_TYPES.has(item.type))
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
        checkOnInitReactions(token, item);
});

function checkDispositionFilter(reactorToken, triggeringToken, dispositionFilter)
{
    if (!dispositionFilter || dispositionFilter.length === 0)
        return true;
    if (!triggeringToken)
        return true;

    const tokenFactions = game.modules.get("token-factions")?.api;
    let disposition;

    if (tokenFactions && typeof tokenFactions.getDisposition === 'function')
        disposition = tokenFactions.getDisposition(reactorToken, triggeringToken);
    else
        disposition = triggeringToken.document.disposition;

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

export function getReactionItems(token)
{
    const actor = token.actor;
    if (!actor)
        return [];

    let items = actor.items.filter(item => REACTION_ITEM_TYPES.has(item.type));

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
            const pilotItems = pilot.items.filter(item => REACTION_ITEM_TYPES.has(item.type));
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

function getCombatTokens()
{
    if (!game.combat)
        return [];

    return canvas.tokens.placeables.filter(token =>
    {
        if (!token.inCombat)
            return false;
        if (!token.actor)
            return false;
        return true;
    });
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

export async function checkOnInitReactions(token, filterItem = null)
{
    return runInOnInitTriggerContext(() => _checkOnInitReactionsBody(token, filterItem));
}

// Scene reactor onInit runs on scene load, GM only, with the scene stand-in as the token.
export async function checkSceneOnInitReactions(scene)
{
    if (!scene || !game.user.isGM)
        return;
    const candidates = getFlatGeneralReactions().filter(([, reaction]) =>
        reaction.enabled !== false && reaction.onInit && sceneReactorMode(reaction) !== 'off' && onViewedScene(reaction));
    if (candidates.length === 0)
        return;
    return runInOnInitTriggerContext(async () =>
    {
        const api = game.modules.get('lancer-automations').api;
        const sceneReactor = makeSceneReactor(scene);
        for (const [reactionName, reaction] of candidates)
        {
            try
            {
                if (typeof reaction.onInit === 'function')
                    await reaction.onInit(sceneReactor, null, api);
                else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '')
                {
                    const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"], reaction, `${reactionName}/onInit`);
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
    if (game.modules.get('lancer-automations')?.api)
        checkSceneOnInitReactions(canvas.scene);
});
Hooks.on('lancer-automations.ready', () => checkSceneOnInitReactions(canvas.scene));

async function _checkOnInitReactionsBody(token, filterItem = null)
{
    const api = game.modules.get('lancer-automations').api;
    const items = filterItem ? [filterItem] : getReactionItems(token);

    for (const item of items)
    {
        const lid = getItemLID(item);
        if (!lid)
            continue;

        const registryEntry = ReactionManager.getReactions(lid);
        if (!registryEntry)
            continue;

        for (const reaction of registryEntry.reactions)
        {
            if (reaction.enabled === false)
                continue;
            if (!reaction.onInit)
                continue;

            const reactionPath = reaction.reactionPath || "";
            if (!isItemAvailable(item, reactionPath))
                continue;

            try
            {
                if (typeof reaction.onInit === 'function')
                    await reaction.onInit(token, item, api);
                else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '')
                {
                    const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"], reaction, `${lid}/${registryEntry.reactions.indexOf(reaction)}/onInit`);
                    await onInitFunc(token, item, api);
                }
            }
            catch (error)
            {
                console.error(`lancer-automations | Error executing onInit for ${item.name}:`, error);
            }
        }
    }

    const generalReactions = ReactionManager.getGeneralReactions();
    for (const [name, reaction] of Object.entries(generalReactions))
    {
        if (reaction.enabled === false)
            continue;
        if (!reaction.onInit)
            continue;

        try
        {
            if (typeof reaction.onInit === 'function')
                await reaction.onInit(token, null, api);
            else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '')
            {
                const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"], reaction, `${name}/onInit`);
                await onInitFunc(token, null, api);
            }
        }
        catch (error)
        {
            console.error(`lancer-automations | Error executing onInit for General Activation ${name}:`, error);
        }
    }
}

export async function checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data)
{
    const api = game.modules.get('lancer-automations').api;
    if (itemLid)
    {
        const items = getReactionItems(token);
        for (const item of items)
        {
            if (getItemLID(item) !== itemLid)
                continue;
            const registryEntry = ReactionManager.getReactions(itemLid);
            if (!registryEntry)
                continue;
            for (const reaction of registryEntry.reactions)
            {
                if (reaction.enabled === false)
                    continue;
                if ((reaction.reactionPath || "") !== (reactionPath || ""))
                    continue;
                if (!reaction.onMessage)
                    continue;
                try
                {
                    let result;
                    if (typeof reaction.onMessage === 'function')
                        result = await reaction.onMessage(triggerType, data, token, item, activationName, api);
                    else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim())
                    {
                        const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"], `${itemLid}/${registryEntry.reactions.indexOf(reaction)}/onMessage`);
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
        const generalReactions = ReactionManager.getGeneralReactions();
        for (const [name, reaction] of Object.entries(generalReactions))
        {
            if (reaction.enabled === false)
                continue;
            if (name !== activationName)
                continue;
            if (!reaction.onMessage)
                continue;
            try
            {
                if (typeof reaction.onMessage === 'function')
                    await reaction.onMessage(triggerType, data, token, null, activationName, api);
                else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim())
                {
                    const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"], `${name}/onMessage`);
                    await fn(triggerType, data, token, null, activationName, api);
                }
            }
            catch (error)
            {
                console.error(`lancer-automations | Error in onMessage for general reaction ${name}:`, error);
            }
        }
    }
}

Hooks.on('lancer-automations.runOnMessage', ({ token, itemLid, reactionPath, activationName, triggerType, data }) =>
{
    checkOnMessageReactions(token, itemLid ?? null, reactionPath ?? null, activationName ?? null, triggerType, data)
        .catch(error => console.error('lancer-automations | onMessage error:', error));
});

/** The reactor's own entry of data.targets ({ target/token, roll, crit, ... }), or null. */
function findTargetEntry(data, token)
{
    if (!Array.isArray(data.targets))
        return null;
    return data.targets.find(entry => entry?.constructor === Object && (entry.target ?? entry.token)?.id === token.id) ?? null;
}

function evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isTarget, isInCombat)
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
    dbgAuto('candidate:', token.name, reactionName, '(general)', { triggers: reaction.triggers });
    if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType))
    {
        dbgAuto('skip:', token.name, reactionName, 'out of combat', { setting: 'outOfCombat', value: reaction.outOfCombat });
        if ((token?.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
            ui.notifications.warn(`${reactionName} (${token?.name ?? '?'}): not triggered, out of combat.`);
        return null;
    }
    if (isSelf && !reaction.triggerSelf)
    {
        dbgAuto('skip:', token.name, reactionName, 'reactor is the trigger source', { setting: 'triggerSelf', value: !!reaction.triggerSelf });
        return null;
    }
    if (!isSelf && reaction.triggerOther === false && !(reaction.triggerTarget === true && isTarget))
    {
        dbgAuto('skip:', token.name, reactionName, 'reactor is not the trigger source or target', { setting: 'triggerOther', value: false });
        return null;
    }
    if (reaction.checkReaction && !(isSelf && data.reactionJustConsumed) && !hasReactionAvailable(token))
    {
        dbgAuto('skip:', token.name, reactionName, 'no reaction available', { setting: 'checkReaction', value: true });
        return null;
    }
    if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
    {
        dbgAuto('skip:', token.name, reactionName, 'disposition filter failed', { setting: 'dispositionFilter', value: reaction.dispositionFilter });
        return null;
    }

    try
    {
        const api = game.modules.get('lancer-automations').api;
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = (sourceToken && token) ? getTokenDistance(token, sourceToken) : null;
        const provokeReasons = [];
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token, provokeReasons);
        if (reaction.requireCanProvoke && (!canTriggerReaction || data._provokeImmunityBurned))
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

        const shouldTrigger = runGeneralEvaluate(reaction, reactionName, triggerType, enrichedData, token, api);
        dbgAuto(shouldTrigger ? 'fire:' : 'skip:', token.name, reactionName, 'evaluate →', shouldTrigger);
        return shouldTrigger ? enrichedData : null;
    }
    catch (error)
    {
        console.error(`lancer-automations | Error evaluating general reaction ${reactionName}:`, error);
        return null;
    }
}

function runGeneralEvaluate(reaction, reactionName, triggerType, enrichedData, reactorToken, api)
{
    if (typeof reaction.evaluate === 'function')
    {
        const result = reaction.evaluate(triggerType, enrichedData, reactorToken, null, reactionName, api);
        if (result instanceof Promise)
        {
            console.error(`lancer-automations | evaluate for "${reactionName}" is async. Evaluate functions must be synchronous.`);
            result.then(_ =>
            { /* fire-and-forget async evaluate */ });
            return false;
        }
        return result;
    }
    if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '')
    {
        const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction, `${reactionName}/evaluate`);
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
function getFlatGeneralReactions()
{
    if (cachedFlatGeneralReactions)
        return cachedFlatGeneralReactions;
    cachedFlatGeneralReactions = [];
    for (const [reactionName, entry] of Object.entries(ReactionManager.getGeneralReactions()))
    {
        if (Array.isArray(entry.reactions))
        {
            for (const subReaction of entry.reactions)
                cachedFlatGeneralReactions.push([reactionName, { ...subReaction, enabled: subReaction.enabled ?? entry.enabled }]);
        }
        else
            cachedFlatGeneralReactions.push([reactionName, entry]);
    }
    return cachedFlatGeneralReactions;
}

function evaluateSceneReaction(reactionName, reaction, triggerType, data, sceneReactor, identity)
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
    dbgAuto('candidate:', sceneName, reactionName, '(scene)', { triggers: reaction.triggers });
    const isInCombat = !!game.combat?.started;
    if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType))
    {
        dbgAuto('skip:', sceneName, reactionName, 'out of combat', { setting: 'outOfCombat', value: reaction.outOfCombat });
        if (game.settings.get('lancer-automations', 'debugOutOfCombat'))
            ui.notifications.warn(`${reactionName} (${sceneName}): not triggered, out of combat.`);
        return null;
    }

    try
    {
        const api = game.modules.get('lancer-automations').api;
        const enrichedData = { ...data, isSceneReactor: true, scene: sceneReactor.scene, distanceToTrigger: null, canTriggerReaction: true, isTarget: false, targetEntry: null };
        enrichedData.debugActivation = function (label)
        {
            return debugActivation(triggerType, this ?? enrichedData, sceneReactor, null, reactionName, label);
        };

        const shouldTrigger = runGeneralEvaluate(reaction, reactionName, triggerType, enrichedData, sceneReactor, api);
        dbgAuto(shouldTrigger ? 'fire:' : 'skip:', sceneName, reactionName, 'evaluate →', shouldTrigger);
        return shouldTrigger ? enrichedData : null;
    }
    catch (error)
    {
        console.error(`lancer-automations | Error evaluating scene reaction ${reactionName}:`, error);
        return null;
    }
}

// Generic flow launcher: injects extraData into flow.state.la_extraData before begin().
async function _beginFlow(flowName, target, options = {}, extraData = {})
{
    const FlowClass = game.lancer.flows.get(flowName);
    if (!FlowClass)
    {
        ui.notifications.warn(`lancer-automations | Flow "${flowName}" not found.`);
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
            {
                await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
                return;
            }
            targetUserId = ownerIds.at(0) ?? null;
            console.warn(`lancer-automations | sendMessageToReactor: no userId provided, falling back to token owner "${targetUserId}" for ${token.name}.`);
        }
        if (!targetUserId || targetUserId === game.user.id || !game.users.get(targetUserId)?.active)
            return await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
        const requestId = wait ? `omsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'onMessage',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, triggerType, data, requestId }
        });
        if (wait && requestId)
        {
            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: `Waiting for ${game.users.get(targetUserId)?.name ?? 'remote user'}…`,
                    item: waitItem,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken
                })
                : null;
            try
            {
                return await awaitPendingAck(requestId);
            }
            finally
            {
                waitCard?.remove();
            }
        }
    };
}

export function _buildStartRelatedFlow(token, item, reaction, activationName, extraData = {})
{
    return async () =>
    {
        if (item)
        {
            const reactionPath = reaction?.reactionPath;
            if (reactionPath)
            {
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
            ui.notifications.warn('lancer-automations | startRelatedFlow: no actor found.');
            return;
        }
        const actionType = reaction?.actionType || 'Reaction';
        if (['Automatic', 'Other'].includes(actionType))
            ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" will be launched but may not behave as expected.`);
        const name = activationName || 'Unknown';
        return executeSimpleActivation(actor, {
            title: name,
            action: { name, activation: actionType },
            detail: reaction?.effectDescription || ''
        }, extraData);
    };
}

function _buildStartRelatedFlowToReactor(token, item, reaction, activationName)
{
    const itemLid = item ? getItemLID(item) : null;
    const reactionPath = reaction?.reactionPath || "";
    const actionType = reaction?.actionType || 'Reaction';
    const effectDescription = reaction?.effectDescription || '';
    return async (userId = null, extraData = {}, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) =>
    {
        let targetUserId = userId;
        if (!targetUserId)
        {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id))
                return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
            targetUserId = ownerIds.at(0) ?? null;
        }
        if (!targetUserId || targetUserId === game.user.id)
            return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
        const requestId = wait ? `srf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'startRelatedFlow',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, actionType, effectDescription, extraData: extraData ?? {}, requestId }
        });
        if (wait && requestId)
        {
            const waitCard = (waitTitle || waitDescription)
                ? startWaitCard({
                    title: waitTitle ?? 'WAITING',
                    description: waitDescription ?? '',
                    waitMessage: `Waiting for ${game.users.get(targetUserId)?.name ?? 'remote user'}…`,
                    item: waitItem ?? item,
                    originToken: waitOriginToken ?? token,
                    relatedToken: waitRelatedToken
                })
                : null;
            try
            {
                await awaitPendingAck(requestId);
            }
            finally
            {
                waitCard?.remove();
            }
        }
    };
}

// Cancellable: autoActivate fires sequentially, the first cancel triggers a redo with _cancelledBy set.
const CANCELLABLE_TRIGGERS = new Set([
    'onPreMove', 'onPreStructure', 'onPreStress',
    'onPreStatusApplied', 'onPreStatusRemoved',
    'onPreHpChange', 'onPreHeatChange',
]);

function debugAutomationOn()
{
    try
    {
        return !!game.settings.get('lancer-automations', 'debugAutomation');
    }
    catch
    {
        return false;
    }
}

function dbgAuto(...args)
{
    if (debugAutomationOn())
        console.log('[LA debug]', ...args);
}

const _laConfigWarnedSet = new Set();
function _warnReactionConfigOnce(key, message)
{
    if (_laConfigWarnedSet.has(key))
        return;
    _laConfigWarnedSet.add(key);
    ui.notifications.warn(`lancer-automations | ${message}`);
    console.warn(`lancer-automations | ${message}`);
}

async function checkReactions(triggerType, data)
{
    const allTokens = getAllSceneTokens();
    const reactionsPromises = [];
    const deferredFactories = [];
    const isCancellable = CANCELLABLE_TRIGGERS.has(triggerType);
    // Re-stamp reactor identity on shared fns right before activation fires, otherwise the last eval-loop assignment wins.
    const applyReactorIdentity = (reactionTriggerData, identity, context) =>
    {
        for (const key of Object.keys(reactionTriggerData))
        {
            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof reactionTriggerData[key] === 'function')
            {
                reactionTriggerData[key]._reactorIdentity = identity;
                reactionTriggerData[key]._defaultContext = context;
            }
        }
    };
    const api = game.modules.get('lancer-automations').api;

    const flatGeneralReactions = getFlatGeneralReactions();

    let actionBasedReaction = null;
    if (data.actionName)
    {
        const found = flatGeneralReactions.find(([name, reaction]) =>
            name === data.actionName && reaction.onlyOnSourceMatch && reaction.triggers?.includes(triggerType));
        if (found)
            actionBasedReaction = { name: found[0], reaction: found[1] };
    }

    if (!cachedNonActionReactionsByTrigger.has(triggerType))
    {
        const filtered = [];
        const sceneFiltered = [];
        for (const [reactionName, reaction] of flatGeneralReactions)
        {
            if (!reaction.triggers?.includes(triggerType))
                continue;
            if (reaction.enabled === false)
                continue;
            const sceneMode = sceneReactorMode(reaction);
            // onlyOnSourceMatch entries reach the scene pass through actionBasedReaction.
            if (sceneMode !== 'off' && !reaction.onlyOnSourceMatch)
                sceneFiltered.push([reactionName, reaction]);
            if (reaction.onlyOnSourceMatch || sceneMode === 'only')
                continue;
            filtered.push([reactionName, reaction]);
        }
        cachedNonActionReactionsByTrigger.set(triggerType, filtered);
        cachedSceneReactionsByTrigger.set(triggerType, sceneFiltered);
    }
    const nonActionBasedReactions = cachedNonActionReactionsByTrigger.get(triggerType);

    const hasValidActionBasedReaction = actionBasedReaction &&
        actionBasedReaction.reaction.enabled !== false && onViewedScene(actionBasedReaction.reaction);

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
    if (game.user.isGM && canvas.scene)
    {
        sceneCandidates.push(...cachedSceneReactionsByTrigger.get(triggerType).filter(([, reaction]) => onViewedScene(reaction)));
        if (hasValidActionBasedReaction && sceneReactorMode(actionBasedReaction.reaction) !== 'off')
            sceneCandidates.push([actionBasedReaction.name, actionBasedReaction.reaction]);
    }
    const sceneReactor = sceneCandidates.length > 0 ? makeSceneReactor(canvas.scene) : null;
    for (const [reactionName, reaction] of sceneCandidates)
    {
        const reactorIdentity = { sceneId: sceneReactor.scene.id, reactionName };
        const enrichedData = evaluateSceneReaction(reactionName, reaction, triggerType, data, sceneReactor, reactorIdentity);
        if (!enrichedData)
            continue;
        const reactionTriggerData = { ...enrichedData,
            startRelatedFlow: _buildStartRelatedFlow(sceneReactor, null, reaction, reactionName),
            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(sceneReactor, null, reaction, reactionName),
            sendMessageToReactor: _buildSendMessageToReactor(sceneReactor, null, null, reactionName, triggerType)
        };
        const defaultCancelContext = { item: null, originToken: null, relatedToken: enrichedData.triggeringToken ?? null };
        applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);

        if (!reaction.autoActivate)
        {
            reactionQueue.push({
                triggerType,
                token: sceneReactor,
                item: null,
                reaction,
                itemName: reactionName,
                reactionName,
                isGeneral: true,
                triggerData: reactionTriggerData
            });
            continue;
        }
        if (isCancellable)
        {
            deferredFactories.push(() =>
            {
                applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                return activateReaction(triggerType, reactionTriggerData, sceneReactor, null, reactionName, reaction, true);
            });
            continue;
        }
        try
        {
            const activation = activateReaction(triggerType, reactionTriggerData, sceneReactor, null, reactionName, reaction, true);
            if (activation instanceof Promise)
            {
                activation.catch(error => console.error(`lancer-automations | Error auto-activating scene reaction:`, error));
                if (reaction.awaitActivationCompletion !== false)
                    reactionsPromises.push(activation);
            }
        }
        catch (error)
        {
            console.error(`lancer-automations | Error auto-activating scene reaction:`, error);
        }
    }

    for (const token of orderedTokens)
    {
        const isSelf = data.triggeringToken?.id === token.id;
        const isTarget = (data.hitTokens ?? []).some(hitToken => hitToken.id === token.id);
        // Hidden triggering tokens: only self- and target-reactions fire (being attacked is knowable).
        if (triggeringTokenHidden && !isSelf && !isTarget)
            continue;
        const isInCombat = token.inCombat && !!game.combat?.started;

        const sourceToken = data.triggeringToken;
        const distanceToTrigger = sourceToken ? getTokenDistance(token, sourceToken) : null;
        const provokeReasons = [];
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token, provokeReasons);
        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction, isTarget, targetEntry: findTargetEntry(data, token) };

        const items = getReactionItems(token);
        for (const item of items)
        {
            const lid = getItemLID(item);
            if (!lid)
                continue;

            const registryEntry = ReactionManager.getReactions(lid);
            if (!registryEntry)
                continue;

            for (const reaction of registryEntry.reactions)
            {
                if (!reaction.triggers?.includes(triggerType))
                    continue;
                if (reaction.enabled === false)
                {
                    dbgAuto('skip:', token.name, item.name, lid, 'reaction disabled');
                    continue;
                }

                dbgAuto('candidate:', token.name, item.name, lid, { triggers: reaction.triggers, reactionPath: reaction.reactionPath || null });

                if (reaction.onlyOnSourceMatch)
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

                if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType))
                {
                    if ((token.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
                        ui.notifications.warn(`${item.name} (${token.name}): not triggered, out of combat.`);
                    if (triggerType === 'onActivation' && (token.isOwner || game.user.isGM))
                        _warnReactionConfigOnce(`ooc|${lid}|${reaction.reactionPath || ''}`, `"${item.name}" only triggers in combat. Enable "Out of Combat" to allow it outside.`);
                    dbgAuto('skip:', token.name, item.name, 'out of combat', { setting: 'outOfCombat', value: reaction.outOfCombat });
                    continue;
                }

                if (isSelf)
                {
                    if (!reaction.triggerSelf)
                    {
                        dbgAuto('skip:', token.name, item.name, 'reactor is the trigger source', { setting: 'triggerSelf', value: !!reaction.triggerSelf });
                        continue;
                    }
                }
                else
                {
                    if (reaction.triggerOther === false && !(reaction.triggerTarget === true && isTarget))
                    {
                        dbgAuto('skip:', token.name, item.name, 'reactor is not the trigger source or target', { setting: 'triggerOther', value: !!reaction.triggerOther });
                        continue;
                    }
                }

                if (reaction.checkReaction && !(isSelf && data.reactionJustConsumed) && !hasReactionAvailable(token))
                {
                    dbgAuto('skip:', token.name, item.name, 'no reaction available', { setting: 'checkReaction', value: true });
                    continue;
                }

                if (reaction.requireCanProvoke && (!canTriggerReaction || data._provokeImmunityBurned))
                {
                    if (provokeReasons.includes('provoke_immunity') && !data._provokeImmunityBurned)
                    {
                        data._provokeImmunityBurned = true;
                        api.consumeImmunityUse?.(sourceToken.actor, 'provoke');
                    }
                    dbgAuto('skip:', token.name, item.name, 'cannot provoke', { setting: 'requireCanProvoke', value: true, reasons: provokeReasons });
                    continue;
                }

                const reactionPath = reaction.reactionPath || "";
                if (!isItemAvailable(item, reactionPath))
                {
                    dbgAuto('skip:', token.name, item.name, 'item not available', { destroyed: item.system?.destroyed, disabled: item.system?.disabled, reactionPath: reaction.reactionPath || null });
                    continue;
                }

                if (reaction.checkUsage)
                {
                    const sys = item.system;
                    const tags = sys?.tags ?? [];
                    const hasTag = tagLid => tags.some(tag => tag?.lid === tagLid);
                    const tagVal = tagLid => Number(tags.find(tag => tag?.lid === tagLid)?.val ?? 0);
                    const hasLoading = hasTag('tg_loading');
                    const hasRecharge = hasTag('tg_recharge');
                    const hasUses = sys?.uses?.max > 0;
                    const perRoundLimit = game.combat?.started && game.settings.get('lancer-automations', 'enablePerRoundTurnTags') ? tagVal('tg_round') : 0;
                    const perTurnLimit = game.combat?.started && game.settings.get('lancer-automations', 'enablePerRoundTurnTags') ? tagVal('tg_turn') : 0;
                    if (!hasLoading && !hasRecharge && !hasUses && !perRoundLimit && !perTurnLimit && (token.isOwner || game.user.isGM))
                        _warnReactionConfigOnce(`usage|${lid}|${reaction.reactionPath || ''}`, `"${item.name}" has Check Usage enabled but no loading, recharge, limited uses, or per-round/turn tag. The check has no effect.`);
                    if (hasLoading && sys?.loaded === false)
                    {
                        dbgAuto('skip:', token.name, item.name, 'not loaded', { setting: 'checkUsage', value: reaction.checkUsage, tag: 'tg_loading' });
                        continue;
                    }
                    if (hasUses && sys.uses.value <= 0)
                    {
                        dbgAuto('skip:', token.name, item.name, 'no uses left', { setting: 'checkUsage', value: reaction.checkUsage, uses: sys.uses });
                        continue;
                    }
                    if (hasRecharge && sys?.charged === false)
                    {
                        dbgAuto('skip:', token.name, item.name, 'not charged', { setting: 'checkUsage', value: reaction.checkUsage, tag: 'tg_recharge' });
                        continue;
                    }
                    if (perRoundLimit > 0 && Number(sys?.uses_per_round?.value ?? 0) >= perRoundLimit)
                    {
                        dbgAuto('skip:', token.name, item.name, 'per-round limit reached', { setting: 'checkUsage', value: reaction.checkUsage, limit: perRoundLimit, used: sys?.uses_per_round?.value });
                        continue;
                    }
                    if (perTurnLimit > 0 && Number(sys?.uses_per_turn?.value ?? 0) >= perTurnLimit)
                    {
                        dbgAuto('skip:', token.name, item.name, 'per-turn limit reached', { setting: 'checkUsage', value: reaction.checkUsage, limit: perTurnLimit, used: sys?.uses_per_turn?.value });
                        continue;
                    }
                }

                if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
                {
                    dbgAuto('skip:', token.name, item.name, 'disposition filter failed', { setting: 'dispositionFilter', value: reaction.dispositionFilter });
                    continue;
                }

                try
                {
                    let activationName = item.name;
                    const reactionPath = reaction.reactionPath || "";
                    // actionName only identifies a sub-action on activation triggers, elsewhere it's a flow title
                    const actionNameIsSubAction = triggerType === 'onActivation' || triggerType === 'onInitActivation';

                    if (reactionPath && reactionPath !== "" && reactionPath !== "system" && reactionPath !== "system.trigger")
                    {
                        let actionData = null;

                        if (reactionPath.startsWith("extraActions."))
                        {
                            const actionName = reactionPath.slice("extraActions.".length);
                            const extraActions = item.getFlag?.('lancer-automations', 'extraActions') || [];
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
                    else if (actionNameIsSubAction && reaction.onlyOnSourceMatch && data.actionName && data.actionName !== item.name)
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
                            cancelRecord.tokenId === token.id && cancelRecord.lid === lid && cancelRecord.reactionPath === (reaction.reactionPath || "")
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

                    if (typeof reaction.evaluate === 'function')
                    {
                        const result = reaction.evaluate(triggerType, enrichedData, token, item, activationName, api);
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
                    else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '')
                    {
                        try
                        {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction, `${lid}/${registryEntry.reactions.indexOf(reaction)}/evaluate`);
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
                        dbgAuto('fire:', token.name, item.name, 'autoActivate:', !!reaction.autoActivate);
                        const reactionTriggerData = { ...enrichedData,
                            startRelatedFlow: _buildStartRelatedFlow(token, item, reaction, activationName),
                            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, reaction, activationName),
                            sendMessageToReactor: _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType)
                        };
                        const reactorIdentity = { tokenId: token.id, lid, reactionPath: reaction.reactionPath || "" };
                        const defaultCancelContext = { item, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                        for (const key of Object.keys(reactionTriggerData))
                        {
                            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof reactionTriggerData[key] === 'function')
                            {
                                reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                                reactionTriggerData[key]._defaultContext = defaultCancelContext;
                            }
                        }

                        if (reaction.autoActivate)
                        {
                            if (isCancellable)
                            {
                                deferredFactories.push(() =>
                                {
                                    applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                                    return activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                });
                            }
                            else
                            {
                                try
                                {
                                    const activation = activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                    if (activation instanceof Promise)
                                    {
                                        activation.catch(error => console.error(`lancer-automations | Error auto-activating reaction:`, error));
                                        if (reaction.awaitActivationCompletion !== false)
                                            reactionsPromises.push(activation);
                                    }
                                }
                                catch (error)
                                {
                                    console.error(`lancer-automations | Error auto-activating reaction:`, error);
                                }
                            }
                        }
                        else
                        {
                            reactionQueue.push({
                                triggerType,
                                token,
                                item,
                                reaction,
                                itemName: item.name,
                                reactionName: activationName,
                                triggerData: reactionTriggerData
                            });
                        }
                    }
                }
                catch (error)
                {
                    console.error(`lancer-automations | Error evaluating reaction ${item.name}:`, error);
                }
            }
        }

        if (hasValidActionBasedReaction && sceneReactorMode(actionBasedReaction.reaction) !== 'only')
        {
            const reactionName = actionBasedReaction.name;
            const reaction = actionBasedReaction.reaction;
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isTarget, isInCombat);
            if (enrichedData)
            {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData))
                {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function')
                    {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate)
                {
                    if (isCancellable)
                    {
                        deferredFactories.push(() =>
                        {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    }
                    else
                    {
                        try
                        {
                            const activation = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (activation instanceof Promise)
                            {
                                activation.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false)
                                    reactionsPromises.push(activation);
                            }
                        }
                        catch (error)
                        {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                }
                else
                {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: reactionTriggerData
                    });
                }
            }
        }

        for (const [reactionName, reaction] of nonActionBasedReactions)
        {
            if (!onViewedScene(reaction))
                continue;
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isTarget, isInCombat);
            if (enrichedData)
            {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData))
                {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function')
                    {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate)
                {
                    if (isCancellable)
                    {
                        deferredFactories.push(() =>
                        {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    }
                    else
                    {
                        try
                        {
                            const activation = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (activation instanceof Promise)
                            {
                                activation.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false)
                                    reactionsPromises.push(activation);
                            }
                        }
                        catch (error)
                        {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                }
                else
                {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName,
                        isGeneral: true,
                        triggerData: reactionTriggerData
                    });
                }
            }
        }
    }

    // Run before awaiting reactionsPromises so synchronous cancel fires same tick as caller (preUpdateToken).
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
                    activation.catch(error => console.error('lancer-automations | async reaction error:', error));
                if (cancelRaised())
                    break;
            }
            catch (error)
            {
                console.error('lancer-automations | reaction error:', error);
            }
        }
    }

    if (reactionsPromises.length > 0)
        await Promise.all(reactionsPromises);

    if (reactionDebounceTimer)
        clearTimeout(reactionDebounceTimer);

    reactionDebounceTimer = setTimeout(async () =>
    {
        if (reactionQueue.length > 0)
        {
            const manualReactions = [...reactionQueue];
            reactionQueue.length = 0;

            if (manualReactions.length > 0)
            {
                const mode = game.settings.get('lancer-automations', 'reactionNotificationMode');
                const distribution = new Map();

                const allGMs = game.users.filter(user => user.active && user.isGM);

                for (const reaction of manualReactions)
                {
                    const recipients = new Set();

                    if (mode === 'owner' || mode === 'both')
                    {
                        const owners = game.users.filter(user => user.active && !user.isGM && reaction.token.document.testUserPermission(user, "OWNER"));
                        owners.forEach(user => recipients.add(user));
                    }

                    if (mode === 'gm' || mode === 'both')
                        allGMs.forEach(user => recipients.add(user));

                    for (const user of recipients)
                    {
                        if (!distribution.has(user.id))
                            distribution.set(user.id, []);
                        distribution.get(user.id).push(reaction);
                    }
                }

                const mainTrigger = manualReactions[0].triggerType;

                for (const [userId, reactions] of distribution)
                {
                    if (userId === game.userId)
                        displayReactionPopup(mainTrigger, reactions);
                    else
                    {
                        const payload = {
                            targetUserId: userId,
                            triggerType: mainTrigger,
                            reactions: reactions.map(entry => ({
                                tokenId: entry.token.id,
                                itemId: entry.item?.id,
                                reactionName: entry.reactionName,
                                itemName: entry.itemName,
                                isGeneral: entry.isGeneral,
                                triggerData: serializeTriggerData(entry.triggerData)
                            }))
                        };
                        game.socket.emit('module.lancer-automations', {
                            action: 'showReactionPopup',
                            payload: payload
                        });
                    }
                }
            }

            reactionQueue = [];
            reactionDebounceTimer = null;
        }
    }, REACTION_DEBOUNCE_MS);
}

// Origin can appear as triggering token, single target, or in targets array.
// role: 'source' = origin caused the event, 'target' = origin is one of its targets, else either side.
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
    if (consumption.isBoost !== undefined && consumption.isBoost !== null)
    {
        if (data.moveInfo?.isBoost !== consumption.isBoost)
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
            const consumption = effect.flags?.['lancer-automations']?.consumption;
            const trigger = consumption?.trigger;
            if (!trigger)
                return false;
            return Array.isArray(trigger) ? trigger.includes(triggerType) : trigger === triggerType;
        });

        if (consumableEffects.length === 0)
            continue;

        const consumedGroups = new Set();

        for (const effect of consumableEffects)
        {
            const consumption = effect.getFlag('lancer-automations', 'consumption');
            if (!consumption)
                continue;

            if (consumption.groupId && consumedGroups.has(consumption.groupId))
                continue;

            const originId = consumption.originId || token.id;
            if (!isOriginInvolved(originId, consumption.role, data))
                continue;

            if (!passesBuiltInFilters(consumption, triggerType, data))
                continue;

            const processConsumption = async () =>
            {
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

const _BATTLELOG_TELEMETRY_TRIGGERS = new Set(['onHit', 'onMiss', 'onTechHit', 'onTechMiss', 'onStructure', 'onStress', 'onDestroyed', 'onCheck', 'onActivation']);

export async function handleTrigger(triggerType, data)
{
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
                    ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" cannot be re-launched as a flow.`);
                    return;
                }
                if (!actor)
                {
                    ui.notifications.warn('lancer-automations | startRelatedFlow: no actor found.');
                    return;
                }
                return executeSimpleActivation(actor, {
                    title: actionData.title,
                    action: actionData.action,
                    detail: actionData.detail,
                    tags: actionData.tags
                });
            }

            ui.notifications.warn('lancer-automations | startRelatedFlow: no item or action data available for this trigger.');
        };

        const reactionsPromise = checkReactions(triggerType, data);
        const consumptionPromise = processEffectConsumption(triggerType, data);
        await reactionsPromise;
        await consumptionPromise;
    });
}

function serializeTriggerData(data, depth = 0)
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
            return { __type: 'actor', id: value.id };
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
            return game.actors.get(value.id) ?? null;
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
