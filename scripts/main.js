/*global PIXI, libWrapper */

import { OverwatchAPI, getTokenDistance } from "./combat/overwatch.js";
import { ReactionManager, stringToFunction, stringToAsyncFunction, ReactionConfig } from "./activations/reaction-manager.js";
import { CompendiumToolsAPI } from "./tools/compendium-tools.js";
import { displayReactionPopup, activateReaction } from "./activations/reactions-ui.js";
import { ReactionsAPI } from "./activations/reactions-registry.js";
import { cancelRulerDrag ,
    InteractiveAPI,
    chooseToken, knockBackToken,
    startChoiceCard, deployWeaponToken,
    revertMovement, clearMovementHistory,
    drawMovementTrace,
    getActiveGMId, getTokenOwnerUserId,
    handleManualDeployLink, startWaitCard,
    resolveDeployableSourceItem,
    rechargeExtraActionsForActor
} from './interactive/index.js';
import {
    EffectsAPI,
    consumeEffectCharge,
    processDurationEffects,
    initCollapseHook,
    findEffectOnToken,
} from "./bonuses/flagged-effects.js";
import {
    getMovementPathHexes, drawDebugPath
} from "./combat/grid-helpers.js";
import {
    genericBonusStepDamage,
    injectKnockbackCheckbox,
    injectNoBonusDmgCheckbox,
    getImmunityBonuses,
    checkEffectImmunities,
    checkDamageResistances,
    applyDamageImmunities,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity,
    executeGenericBonusMenu,

    flattenBonuses,
    isBonusApplicable,
    genericAccuracyStepAttack,
    genericAccuracyStepTechAttack,
    genericAccuracyStepWeaponAttack,
    genericAccuracyStepStatRoll,
    BonusesAPI
} from "./bonuses/genericBonuses.js";
import { EffectManagerAPI } from "./bonuses/effectManager.js";
import { TerrainAPI } from "./combat/terrain-utils.js";

import { MiscAPI, getItemLID, isItemAvailable, hasReactionAvailable, getWeaponProfiles_WithBonus, executeSimpleActivation, consumeAction } from "./tools/misc-tools.js";
import { checkModuleUpdate } from "./setup/version-check.js";
import { registerModuleFlows, registerFlowStatePersistence, injectExtraDataUtility,
    bindChatMessageStateInterceptor,
    ActiveFlowState,
    forceTechHUDStep
} from "./activations/flows.js";
import { DowntimeAPI } from "./tools/downtime.js";
import { RestAPI } from "./tools/rest.js";
import { ScanAPI } from "./tools/scan.js";
import { LAAuras, AurasAPI } from "./tools/aura.js";
import { initDelayedAppearanceHook, delayedTokenAppearance } from "./combat/reinforcement.js";
import { CardStackTests } from "../tests/card-stack.js";
import { FlowQueueTests } from "../tests/flow-queue.js";
import { registerAltStructFlowSteps, initAltStructReady } from "./alt-struct/index.js";
import { injectDisabledSchemaField, registerDisabledFlowSteps, registerPermanentStatusFlowSteps, onRenderActorSheet, onRenderItemSheet, injectDisabledCSS, ItemDisabledAPI, registerExtraTrackableAttributes, registerMeleeCoverFix, patchStatRollCardTemplate, initCustomFlowDispatch, registerUseAmmoFlow, repairLCPData, TriggerUseAmmoFlow, wrapInitTechAttackData, wrapInitAttackData } from "./setup/lancer-modif.js";
import { registerStatusFXSettings, initStatusFX } from "./fx/statusFX.js";
import { registerRerollFlowSteps } from "./activations/reroll.js";
import { initFlowQueue, runInFlowBody } from "./activations/flow-queue.js";
import { LA_INLINE_ATTACK_FX, playDefaultThrowFX, _flowResolveActivationLabel, _flowSourceToken } from "./fx/actionFX.js";
import * as actionFX from "./fx/actionFX.js";
import { initSocket, setTokenFlag, unsetTokenFlag, awaitPendingAck } from "./socket.js";
export { socketRequestWithAck, setTokenFlag, unsetTokenFlag } from "./socket.js";
import { registerSettingsMenus, LancerAutomationsConfig } from "./setup/settingsMenus.js";
import { installJb2aHooks } from "./fx/jb2a-fallback.js";
import { registerTourBootstrap, startConfigTour, startActivationManagerTour } from "./setup/tour.js";
import { registerTokenStatBarSettings, initTokenStatBar } from "./tah/tokenStatBar.js";
import { updateStructure, preWreck, canvasReadyWreck, tileHUDButton, initWreckTokenConfig } from "./tools/wreck.js";
import './filters/customFilters.js';
import { checkCompatibility } from "./setup/checkCompatibility.js";
import { injectInfectionSchemaField, injectInfectionDamageType, injectInfectionCSS, registerInfectionFlows, initInfectionHooks, applyInfection, onRenderActorSheetInfection } from "./bonuses/infection.js";
import { initVisionFromEdge } from "./vision/visionFromEdge.js";
import { initTokenBlocksVision } from "./vision/tokenBlocksVision.js";
import { initLancerDetectionModes } from "./vision/lancerDetectionModes.js";

initLancerDetectionModes();

let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;
let cachedFlatGeneralReactions = null;
/** @type {Map<string, Array>} triggerType → filtered non-action reactions; cleared with cachedFlatGeneralReactions */
const cachedNonActionReactionsByTrigger = new Map();
const COMBAT_INHERENT_TRIGGERS = new Set(['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd']);
let deployableConnectionsGraphic = null;
let _hoverConnectionToken = null;
let _hoverConnectionTicker = null;
let _dashOffset = 0;

function _drawDashedLine(g, x1, y1, x2, y2, dashLength = 8, spaceLength = 14, offset = 0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0)
        return;
    const ux = dx / dist;
    const uy = dy / dist;
    const period = dashLength + spaceLength;
    const norm = ((offset % period) + period) % period;
    let traveled = -norm;
    while (traveled < dist) {
        const a = Math.max(0, traveled);
        const b = Math.min(dist, traveled + dashLength);
        if (b > a) {
            g.moveTo(x1 + ux * a, y1 + uy * a);
            g.lineTo(x1 + ux * b, y1 + uy * b);
        }
        traveled += period;
    }
}

// Cache reaction items per actor; invalidated on actor/item changes
Hooks.on('lancer-automations.clearCaches', () => {
    cachedFlatGeneralReactions = null;
    cachedNonActionReactionsByTrigger.clear();
});

Hooks.on('createItem', (item) => {
    if (!item.parent)
        return;
    const itemTypes = new Set(["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent"]);
    if (!itemTypes.has(item.type))
        return;
    let tokens;
    if (item.parent.isToken) {
        const t = canvas.tokens?.placeables?.find(t => t.document === item.parent.token);
        tokens = t ? [t] : [];
    } else {
        tokens = canvas.tokens?.placeables?.filter(t => t.actor?.id === item.parent.id) ?? [];
    }
    for (const token of tokens)
        checkOnInitReactions(token, item);
});

function checkDispositionFilter(reactorToken, triggeringToken, dispositionFilter) {
    if (!dispositionFilter || dispositionFilter.length === 0)
        return true;
    if (!triggeringToken)
        return true;

    const tokenFactions = game.modules.get("token-factions")?.api;
    let disposition;

    if (tokenFactions && typeof tokenFactions.getDisposition === 'function') {
        disposition = tokenFactions.getDisposition(reactorToken, triggeringToken);
    } else {
        disposition = triggeringToken.document.disposition;
    }

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

export function getReactionItems(token) {
    const actor = token.actor;
    if (!actor)
        return [];

    const itemTypes = new Set(["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent"]);
    let items = actor.items.filter(item => itemTypes.has(item.type));

    if (actor.type === "mech") {
        let pilot = null;
        const pilotRef = actor.system.pilot;

        if (pilotRef) {
            if (typeof pilotRef === 'object' && pilotRef.id) {
                const idStr = pilotRef.id;
                pilot = idStr.startsWith('Actor.') ? fromUuidSync(idStr) : game.actors.get(idStr);
            } else if (typeof pilotRef === 'string') {
                pilot = pilotRef.startsWith('Actor.') ? fromUuidSync(pilotRef) : game.actors.get(pilotRef);
            }
        }

        if (pilot) {
            const pilotItems = pilot.items.filter(item => itemTypes.has(item.type));
            items = items.concat(pilotItems);
        }
    }

    // Deployable actors have no items. Surface a synthetic surrogate keyed by the
    // deployable's actor LID so reactions registered against `dep_*` LIDs resolve.
    if (actor.type === "deployable" && actor.system?.lid) {
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

    // Actor-UUID surrogate: reactions registered against an actor's UUID
    // (e.g. "Actor.qe5wEevLrMN6ki44") resolve via this. Applies to every actor type.
    if (actor.uuid) {
        items = items.concat([{
            name: actor.name,
            type: "actor_surrogate",
            system: {
                lid: actor.uuid,
                tags: [],
                destroyed: actor.system?.destroyed === true,
                disabled: actor.system?.disabled === true,
                actions: actor.system?.actions || []
            },
            getFlag: () => null,
            _actorSurrogate: true,
            _surrogateActor: actor
        }]);
    }

    return items;
}



function getCombatTokens() {
    if (!game.combat)
        return [];

    return canvas.tokens.placeables.filter(token => {
        if (!token.inCombat)
            return false;
        if (!token.actor)
            return false;
        return true;
    });
}

function getAllSceneTokens() {
    return canvas.tokens.placeables.filter(token => {
        if (!token.actor)
            return false;
        return true;
    });
}

async function checkOnInitReactions(token, filterItem = null) {
    const api = game.modules.get('lancer-automations').api;
    // 1. Check Item-based onInit
    const items = filterItem ? [filterItem] : getReactionItems(token);

    for (const item of items) {
        const lid = getItemLID(item);
        if (!lid)
            continue;

        const registryEntry = ReactionManager.getReactions(lid);
        if (!registryEntry)
            continue;

        for (const reaction of registryEntry.reactions) {
            if (reaction.enabled === false)
                continue;
            if (!reaction.onInit)
                continue;

            const reactionPath = reaction.reactionPath || "";
            if (!isItemAvailable(item, reactionPath))
                continue;

            try {
                if (typeof reaction.onInit === 'function') {
                    await reaction.onInit(token, item, api);
                } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                    const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"]);
                    await onInitFunc(token, item, api);
                }
            } catch (error) {
                console.error(`lancer-automations | Error executing onInit for ${item.name}:`, error);
            }
        }
    }

    // 2. Check General onInit
    const generalReactions = ReactionManager.getGeneralReactions();
    for (const [name, reaction] of Object.entries(generalReactions)) {
        if (reaction.enabled === false)
            continue;
        if (!reaction.onInit)
            continue;

        try {
            if (typeof reaction.onInit === 'function') {
                await reaction.onInit(token, null, api);
            } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                const onInitFunc = stringToFunction(reaction.onInit, ["token", "item", "api"]);
                await onInitFunc(token, null, api);
            }
        } catch (error) {
            console.error(`lancer-automations | Error executing onInit for General Activation ${name}:`, error);
        }
    }
}


export async function checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data) {
    const api = game.modules.get('lancer-automations').api;
    if (itemLid) {
        // Item-based: find the item on the token, then the reaction by reactionPath
        const items = getReactionItems(token);
        for (const item of items) {
            if (getItemLID(item) !== itemLid)
                continue;
            const registryEntry = ReactionManager.getReactions(itemLid);
            if (!registryEntry)
                continue;
            for (const reaction of registryEntry.reactions) {
                if (reaction.enabled === false)
                    continue;
                if ((reaction.reactionPath || "") !== (reactionPath || ""))
                    continue;
                if (!reaction.onMessage)
                    continue;
                try {
                    let result;
                    if (typeof reaction.onMessage === 'function') {
                        result = await reaction.onMessage(triggerType, data, token, item, activationName, api);
                    } else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim()) {
                        const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"]);
                        result = await fn(triggerType, data, token, item, activationName, api);
                    }
                    return result;
                } catch (e) {
                    console.error(`lancer-automations | Error in onMessage for ${item.name}:`, e);
                }
            }
            break; // found the item, no need to keep searching
        }
    } else {
        // General reaction: find by activationName key
        const generalReactions = ReactionManager.getGeneralReactions();
        for (const [name, reaction] of Object.entries(generalReactions)) {
            if (reaction.enabled === false)
                continue;
            if (name !== activationName)
                continue;
            if (!reaction.onMessage)
                continue;
            try {
                if (typeof reaction.onMessage === 'function') {
                    await reaction.onMessage(triggerType, data, token, null, activationName, api);
                } else if (typeof reaction.onMessage === 'string' && reaction.onMessage.trim()) {
                    const fn = stringToAsyncFunction(reaction.onMessage, ["triggerType", "data", "reactorToken", "item", "activationName", "api"]);
                    await fn(triggerType, data, token, null, activationName, api);
                }
            } catch (e) {
                console.error(`lancer-automations | Error in onMessage for general reaction ${name}:`, e);
            }
        }
    }
}

Hooks.on('lancer-automations.runOnMessage', ({ token, itemLid, reactionPath, activationName, triggerType, data }) => {
    checkOnMessageReactions(token, itemLid ?? null, reactionPath ?? null, activationName ?? null, triggerType, data)
        .catch(e => console.error('lancer-automations | onMessage error:', e));
});

function evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat) {
    // Skip if this general reaction already triggered a cancel on a previous pass
    const cancelledBy = data._cancelledBy;
    if (cancelledBy?.length > 0) {
        const isCancelled = cancelledBy.some(c =>
            c.tokenId === token.id && c.reactionName === reactionName
        );
        if (isCancelled)
            return null;
    }
    const combatInherentTriggers = ['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd'];
    if (!isInCombat && !reaction.outOfCombat && !combatInherentTriggers.includes(triggerType)) {
        if ((token?.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
            ui.notifications.warn(`${reactionName} (${token?.name ?? '?'}): not triggered, out of combat.`);
        return null;
    }
    if (isSelf && !reaction.triggerSelf)
        return null;
    if (!isSelf && reaction.triggerOther === false)
        return null;
    if (reaction.checkReaction && !hasReactionAvailable(token))
        return null;
    if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
        return null;

    try {
        const api = game.modules.get('lancer-automations').api;
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = (sourceToken && token) ? getTokenDistance(token, sourceToken) : null;
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token);
        if (reaction.requireCanProvoke && !canTriggerReaction)
            return null;
        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction };

        let shouldTrigger = false;
        if (typeof reaction.evaluate === 'function') {
            const result = reaction.evaluate(triggerType, enrichedData, token, null, reactionName, api);
            if (result instanceof Promise) {
                console.error(`lancer-automations | evaluate for "${reactionName}" is async. Evaluate functions must be synchronous.`);
                result.then(val => { /* fire-and-forget async evaluate */ });
                shouldTrigger = false;
            } else {
                shouldTrigger = result;
            }
        } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction);
            const result = evalFunc(triggerType, enrichedData, token, null, reactionName, api);
            if (result instanceof Promise) {
                console.error(`lancer-automations | String evaluate for "${reactionName}" returned a Promise. Evaluate functions must be synchronous.`);
                shouldTrigger = false;
            } else {
                shouldTrigger = result;
            }
        } else {
            shouldTrigger = true;
        }

        return shouldTrigger ? enrichedData : null;
    } catch (error) {
        console.error(`lancer-automations | Error evaluating general reaction ${reactionName}:`, error);
        return null;
    }
}

/**
 * Generic flow launcher that injects extraData into flow.state.la_extraData before begin().
 * Falls back to null (with warning) if the flow class is not registered.
 * @param {string} flowName
 * @param {any} target
 * @param {object} [options]
 * @param {object} [extraData]
 */
async function _beginFlow(flowName, target, options = {}, extraData = {}) {
    const FlowClass = game.lancer.flows.get(flowName);
    if (!FlowClass) {
        ui.notifications.warn(`lancer-automations | Flow "${flowName}" not found.`);
        return null;
    }
    const flow = new FlowClass(target, options);
    if (extraData && typeof extraData === 'object' && Object.keys(extraData).length > 0)
        flow.state.la_extraData = foundry.utils.mergeObject(flow.state.la_extraData || {}, extraData);
    return flow.begin();
}

/**
 * Builds a no-arg `startRelatedFlow` function for a specific reaction context.
 * Closes over token, item, reaction config, and activationName, no arguments needed at call time.
 * @param {object} [extraData] - Extra data to inject into the triggered flow's la_extraData / triggerData.extraData.
 */
/**
 * Builds a `sendMessageToReactor(data)` function for a specific reaction context.
 * Sends a message to the reactor token's owner client; calls onMessage there.
 */
function _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType) {
    const itemLid = item ? getItemLID(item) : null;
    return async (data, userId = null, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) => {
        let targetUserId = userId;
        if (!targetUserId) {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id)) {
                await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
                return;
            }
            targetUserId = ownerIds.at(0) ?? null;
            console.warn(`lancer-automations | sendMessageToReactor: no userId provided, falling back to token owner "${targetUserId}" for ${token.name}.`);
        }
        if (!targetUserId || targetUserId === game.user.id) {
            return await checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data);
        }
        const requestId = wait ? `omsg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'onMessage',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, triggerType, data, requestId }
        });
        if (wait && requestId) {
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
            try {
                return await awaitPendingAck(requestId);
            } finally {
                waitCard?.remove();
            }
        }
    };
}

export function _buildStartRelatedFlow(token, item, reaction, activationName, extraData = {}) {
    return async () => {
        if (item) {
            const reactionPath = reaction?.reactionPath;
            if (reactionPath) {
                const activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
                return _beginFlow("ActivationFlow", item, { action_path: activationPath }, extraData);
            }
            if (item.is_weapon?.()) {
                return _beginFlow("WeaponAttackFlow", item, {}, extraData);
            }
            if (item.system?.actions?.length > 0) {
                const actionIndex = item.system.actions.findIndex(a => a.activation === 'Reaction');
                const path = actionIndex >= 0 ? `system.actions.${actionIndex}` : 'system.actions.0';
                return _beginFlow("ActivationFlow", item, { action_path: path }, extraData);
            }
            if (item.beginSystemFlow) {
                return _beginFlow("SystemFlow", item, {}, extraData);
            }
            return executeSimpleActivation(token.actor, { title: item.name, action: { name: item.name } }, { item, ...extraData });
        }

        // General reaction (no item)
        const actor = token?.actor;
        if (!actor) {
            ui.notifications.warn('lancer-automations | startRelatedFlow: no actor found.');
            return;
        }
        const actionType = reaction?.actionType || 'Reaction';
        if (['Automatic', 'Other'].includes(actionType)) {
            ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" will be launched but may not behave as expected.`);
        }
        const name = activationName || 'Unknown';
        return executeSimpleActivation(actor, {
            title: name,
            action: { name, activation: actionType },
            detail: reaction?.effectDescription || ''
        }, extraData);
    };
}

function _buildStartRelatedFlowToReactor(token, item, reaction, activationName) {
    const itemLid = item ? getItemLID(item) : null;
    const reactionPath = reaction?.reactionPath || "";
    const actionType = reaction?.actionType || 'Reaction';
    const effectDescription = reaction?.effectDescription || '';
    return async (userId = null, extraData = {}, { wait = false, waitTitle = null, waitDescription = null, waitItem = null, waitOriginToken = null, waitRelatedToken = null } = {}) => {
        let targetUserId = userId;
        if (!targetUserId) {
            const ownerIds = getTokenOwnerUserId(token);
            if (ownerIds.includes(game.user.id)) {
                return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
            }
            targetUserId = ownerIds.at(0) ?? null;
        }
        if (!targetUserId || targetUserId === game.user.id) {
            return _buildStartRelatedFlow(token, item, reaction, activationName, extraData)();
        }
        const requestId = wait ? `srf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : null;
        game.socket.emit('module.lancer-automations', {
            action: 'startRelatedFlow',
            payload: { userId: targetUserId, reactorTokenId: token.id, itemLid, reactionPath, activationName, actionType, effectDescription, extraData: extraData ?? {}, requestId }
        });
        if (wait && requestId) {
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
            try {
                await awaitPendingAck(requestId);
            } finally {
                waitCard?.remove();
            }
        }
    };
}

// Triggers where a reactor's cancel leads to a redo. On these we fire autoActivate
// reactions sequentially and stop as soon as one cancels: the redo re-runs the rest
// with _cancelledBy populated, so no reactor is lost.
const CANCELLABLE_TRIGGERS = new Set([
    'onPreMove', 'onPreStructure', 'onPreStress',
    'onPreStatusApplied', 'onPreStatusRemoved',
    'onPreHpChange', 'onPreHeatChange',
]);

async function checkReactions(triggerType, data) {
    const allTokens = getAllSceneTokens();
    const reactionsPromises = [];
    // For cancellable triggers, queue activation factories; they run sequentially
    // after the eval loop so we can stop as soon as one reactor raises a cancel.
    const deferredFactories = [];
    const isCancellable = CANCELLABLE_TRIGGERS.has(triggerType);
    // Re-stamps reactor identity on the shared cancel/change/reroll/modify fns right before
    // an activation fires. Needed because those fns are shared across reactors and the last
    // eval-loop assignment would otherwise win.
    const applyReactorIdentity = (rtd, identity, context) => {
        for (const key of Object.keys(rtd)) {
            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof rtd[key] === 'function') {
                rtd[key]._reactorIdentity = identity;
                rtd[key]._defaultContext = context;
            }
        }
    };
    const api = game.modules.get('lancer-automations').api;

    // Flatten general reactions: entries with a "reactions" array are expanded into individual sub-reactions
    if (!cachedFlatGeneralReactions) {
        const generalReactions = ReactionManager.getGeneralReactions();
        cachedFlatGeneralReactions = [];
        for (const [reactionName, entry] of Object.entries(generalReactions)) {
            if (Array.isArray(entry.reactions)) {
                for (const subReaction of entry.reactions) {
                    cachedFlatGeneralReactions.push([reactionName, { ...subReaction, enabled: subReaction.enabled ?? entry.enabled }]);
                }
            } else {
                cachedFlatGeneralReactions.push([reactionName, entry]);
            }
        }
    }
    const flatGeneralReactions = cachedFlatGeneralReactions;

    let actionBasedReaction = null;
    if (data.actionName) {
        const found = flatGeneralReactions.find(([name, r]) =>
            name === data.actionName && r.onlyOnSourceMatch && r.triggers?.includes(triggerType));
        if (found)
            actionBasedReaction = { name: found[0], reaction: found[1] };
    }

    if (!cachedNonActionReactionsByTrigger.has(triggerType)) {
        const filtered = [];
        for (const [reactionName, reaction] of flatGeneralReactions) {
            if (reaction.onlyOnSourceMatch)
                continue;
            if (!reaction.triggers?.includes(triggerType))
                continue;
            if (reaction.enabled === false)
                continue;
            filtered.push([reactionName, reaction]);
        }
        cachedNonActionReactionsByTrigger.set(triggerType, filtered);
    }
    const nonActionBasedReactions = cachedNonActionReactionsByTrigger.get(triggerType);

    const hasValidActionBasedReaction = actionBasedReaction &&
        actionBasedReaction.reaction.enabled !== false;

    const triggeringTokenHidden = !!data.triggeringToken?.document?.hidden;

    // For cancellable triggers, process the mover (self-reactions) first so reroute-style
    // reactions (Engagement) run before reactors on the original path (Overwatch).
    const orderedTokens = isCancellable && data.triggeringToken
        ? [...allTokens].sort((a, b) => {
            const aSelf = a.id === data.triggeringToken.id ? 1 : 0;
            const bSelf = b.id === data.triggeringToken.id ? 1 : 0;
            return bSelf - aSelf;
        })
        : allTokens;

    for (const token of orderedTokens) {
        const isSelf = data.triggeringToken?.id === token.id;
        // Hidden triggering tokens don't provoke reactions from others; only self-reactions fire.
        if (triggeringTokenHidden && !isSelf)
            continue;
        const isInCombat = token.inCombat;

        const sourceToken = data.triggeringToken;
        const distanceToTrigger = sourceToken ? getTokenDistance(token, sourceToken) : null;
        const canTriggerReaction = api.canProvokeReaction(sourceToken, token);
        const enrichedData = { ...data, distanceToTrigger, canTriggerReaction };

        const items = getReactionItems(token);
        for (const item of items) {
            const lid = getItemLID(item);
            if (!lid)
                continue;

            const registryEntry = ReactionManager.getReactions(lid);
            if (!registryEntry)
                continue;

            for (const reaction of registryEntry.reactions) {
                if (!reaction.triggers?.includes(triggerType))
                    continue;
                if (reaction.enabled === false)
                    continue;

                if (reaction.onlyOnSourceMatch) {
                    const triggeringItem = data.weapon || data.techItem || data.item;
                    const triggeringItemLid = triggeringItem?.system?.lid ?? null;
                    const triggeringDepLid = data.deployable?.lid ?? null;
                    const triggeringActorUuid = data.triggeringToken?.actor?.uuid ?? null;
                    if (triggeringItemLid !== lid && triggeringDepLid !== lid && triggeringActorUuid !== lid)
                        continue;
                }

                if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType)) {
                    if ((token.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
                        ui.notifications.warn(`${item.name} (${token.name}): not triggered, out of combat.`);
                    continue;
                }

                if (isSelf) {
                    if (!reaction.triggerSelf)
                        continue;
                } else {
                    if (reaction.triggerOther === false)
                        continue;
                }

                if (reaction.checkReaction && !hasReactionAvailable(token))
                    continue;

                if (reaction.requireCanProvoke && !canTriggerReaction)
                    continue;

                const reactionPath = reaction.reactionPath || "";
                if (!isItemAvailable(item, reactionPath))
                    continue;

                if (reaction.checkUsage) {
                    const sys = item.system;
                    if (sys?.loaded === false)
                        continue;
                    if (sys?.uses?.max > 0 && sys.uses.value <= 0)
                        continue;
                    if (sys?.charged !== undefined && sys.charged === false)
                        continue;
                }

                if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
                    continue;

                try {
                    let activationName = item.name;
                    const reactionPath = reaction.reactionPath || "";

                    if (reactionPath && reactionPath !== "" && reactionPath !== "system" && reactionPath !== "system.trigger") {
                        let actionData = null;

                        // Extra-action path: "extraActions.ActionName"
                        if (reactionPath.startsWith("extraActions.")) {
                            const actionName = reactionPath.slice("extraActions.".length);
                            const extraActions = item.getFlag?.('lancer-automations', 'extraActions') || [];
                            actionData = extraActions.find(a => a.name === actionName) ?? null;
                        } else if (reactionPath.startsWith("actions.")) {
                            // Lookup-by-name in system.actions[]. Useful for deployables
                            // whose action LIDs are empty strings (action.name is the only key).
                            const actionName = reactionPath.slice("actions.".length);
                            const list = item.system?.actions ?? [];
                            actionData = list.find(a => a.name === actionName) ?? null;
                        } else {
                            // Standard path navigation into item.system
                            const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
                            actionData = item.system;
                            for (const part of pathParts) {
                                if (actionData && (typeof actionData === 'object' || Array.isArray(actionData))) {
                                    actionData = actionData[part];
                                } else {
                                    actionData = null;
                                    break;
                                }
                            }
                        }

                        if (actionData?.name) {
                            activationName = actionData.name;
                            // Skip if the triggering action name doesn't match this reaction's path
                            if (data.actionName && data.actionName !== activationName)
                                continue;
                        }
                    } else if (reaction.onlyOnSourceMatch && data.actionName && data.actionName !== item.name) {
                        // No reactionPath: skip when a specific sub-action was triggered (not the base item)
                        continue;
                    }

                    // Skip if this reaction already triggered a cancel on a previous pass
                    const cancelledBy = enrichedData._cancelledBy;
                    if (cancelledBy?.length > 0) {
                        const isCancelled = cancelledBy.some(c =>
                            c.tokenId === token.id && c.lid === lid && c.reactionPath === (reaction.reactionPath || "")
                        );
                        if (isCancelled)
                            continue;
                    }

                    let shouldTrigger = false;

                    if (typeof reaction.evaluate === 'function') {
                        const result = reaction.evaluate(triggerType, enrichedData, token, item, activationName, api);
                        if (result instanceof Promise) {
                            console.error(`lancer-automations | evaluate for "${item.name}" is async. Evaluate functions must be synchronous.`);
                            result.then(val => { /* fire-and-forget */ });
                            shouldTrigger = false;
                        } else {
                            shouldTrigger = result;
                        }
                    } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                        try {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], reaction);
                            const result = evalFunc(triggerType, enrichedData, token, item, activationName, api);
                            if (result instanceof Promise) {
                                console.error(`lancer-automations | String evaluate for "${item.name}" returned a Promise. Evaluate functions must be synchronous.`);
                                shouldTrigger = false;
                            } else {
                                shouldTrigger = result;
                            }
                        } catch (e) {
                            console.error(`lancer-automations | Error parsing custom evaluate for ${item.name}:`, e);
                        }
                    } else {
                        shouldTrigger = true;
                    }

                    if (shouldTrigger) {
                        const reactionTriggerData = { ...enrichedData,
                            startRelatedFlow: _buildStartRelatedFlow(token, item, reaction, activationName),
                            startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, reaction, activationName),
                            sendMessageToReactor: _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType)
                        };
                        // Inject reactor identity on all cancel functions so _buildCancelFn can record who cancelled
                        const reactorIdentity = { tokenId: token.id, lid, reactionPath: reaction.reactionPath || "" };
                        const defaultCancelContext = { item, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };

                        for (const key of Object.keys(reactionTriggerData)) {
                            if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll') || key.startsWith('modify')) && typeof reactionTriggerData[key] === 'function') {
                                reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                                reactionTriggerData[key]._defaultContext = defaultCancelContext;
                            }
                        }

                        if (reaction.autoActivate) {
                            if (isCancellable) {
                                deferredFactories.push(() => {
                                    applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                                    return activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                });
                            } else {
                                try {
                                    const p = activateReaction(triggerType, reactionTriggerData, token, item, activationName, reaction, false);
                                    if (p instanceof Promise) {
                                        p.catch(error => console.error(`lancer-automations | Error auto-activating reaction:`, error));
                                        if (reaction.awaitActivationCompletion !== false) {
                                            reactionsPromises.push(p);
                                        }
                                    }
                                } catch (error) {
                                    console.error(`lancer-automations | Error auto-activating reaction:`, error);
                                }
                            }
                        } else {
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
                } catch (error) {
                    console.error(`lancer-automations | Error evaluating reaction ${item.name}:`, error);
                }
            }
        }

        if (hasValidActionBasedReaction) {
            const reactionName = actionBasedReaction.name;
            const reaction = actionBasedReaction.reaction;
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate) {
                    if (isCancellable) {
                        deferredFactories.push(() => {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    } else {
                        try {
                            const p = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (p instanceof Promise) {
                                p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false) {
                                    reactionsPromises.push(p);
                                }
                            }
                        } catch (error) {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                } else {
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

        for (const [reactionName, reaction] of nonActionBasedReactions) {
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
                const reactionTriggerData = { ...enrichedData,
                    startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName),
                    startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName),
                    sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType)
                };

                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change') || key.startsWith('reroll')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }

                if (reaction.autoActivate) {
                    if (isCancellable) {
                        deferredFactories.push(() => {
                            applyReactorIdentity(reactionTriggerData, reactorIdentity, defaultCancelContext);
                            return activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                        });
                    } else {
                        try {
                            const p = activateReaction(triggerType, reactionTriggerData, token, null, reactionName, reaction, true);
                            if (p instanceof Promise) {
                                p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                                if (reaction.awaitActivationCompletion !== false) {
                                    reactionsPromises.push(p);
                                }
                            }
                        } catch (error) {
                            console.error(`lancer-automations | Error auto-activating general reaction:`, error);
                        }
                    }
                } else {
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

    // Cancellable triggers must run BEFORE awaiting other reactionsPromises so the
    // first factory's synchronous setFlag() fires in the same tick as the caller
    // (e.g. preUpdateToken's `if (cancelUpdate) return false` check).
    if (isCancellable && deferredFactories.length > 0) {
        // Sequential sync dispatch; do not await. First sync-cancel wins, remaining
        // reactors fire on the redo pass via _cancelledBy.
        const startLen = data._cancelledBy?.length ?? 0;
        const cancelRaised = () => (data._cancelledBy?.length ?? 0) > startLen;
        for (const factory of deferredFactories) {
            try {
                const p = factory();
                if (p instanceof Promise)
                    p.catch(e => console.error('lancer-automations | async reaction error:', e));
                if (cancelRaised())
                    break;
            } catch (e) {
                console.error('lancer-automations | reaction error:', e);
            }
        }
    }

    if (reactionsPromises.length > 0) {
        await Promise.all(reactionsPromises);
    }

    if (reactionDebounceTimer) {
        clearTimeout(reactionDebounceTimer);
    }

    reactionDebounceTimer = setTimeout(async () => {
        if (reactionQueue.length > 0) {
            const manualReactions = [...reactionQueue];
            reactionQueue.length = 0; // Clear the queue

            if (manualReactions.length > 0) {
                const mode = game.settings.get('lancer-automations', 'reactionNotificationMode');
                const distribution = new Map();

                const allGMs = game.users.filter(u => u.active && u.isGM);

                for (const r of manualReactions) {
                    const recipients = new Set();

                    if (mode === 'owner' || mode === 'both') {
                        const owners = game.users.filter(u => u.active && r.token.document.testUserPermission(u, "OWNER"));
                        owners.forEach(u => recipients.add(u));
                    }

                    if (mode === 'gm' || mode === 'both') {
                        allGMs.forEach(u => recipients.add(u));
                    }

                    for (const user of recipients) {
                        if (!distribution.has(user.id))
                            distribution.set(user.id, []);
                        distribution.get(user.id).push(r);
                    }
                }

                const mainTrigger = manualReactions[0].triggerType;

                for (const [userId, reactions] of distribution) {
                    if (userId === game.userId) {
                        displayReactionPopup(mainTrigger, reactions);
                    } else {
                        const payload = {
                            targetUserId: userId,
                            triggerType: mainTrigger,
                            reactions: reactions.map(r => ({
                                tokenId: r.token.id,
                                itemId: r.item?.id,
                                reactionName: r.reactionName,
                                itemName: r.itemName,
                                isGeneral: r.isGeneral,
                                triggerData: serializeTriggerData(r.triggerData)
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

/**
 * Check if the origin token is involved in this trigger event.
 * The origin can appear as the triggering token, a single target, or in a targets array.
 */
function isOriginInvolved(originId, triggerType, data) {
    if (data.triggeringToken?.id === originId)
        return true;
    if (data.target?.id === originId)
        return true;
    if (data.targets && Array.isArray(data.targets)) {
        if (data.targets.some(t => t.id === originId))
            return true;
    }
    return false;
}

/**
 * Apply built-in filters from a consumption config against trigger data.
 * Returns true if all set filters pass.
 */
function passesBuiltInFilters(consumption, triggerType, data) {
    if (consumption.itemLid) {
        const triggeringItem = data.weapon || data.techItem || data.item;
        const currentLid = triggeringItem?.system?.lid;
        if (!currentLid)
            return false;

        const validLids = consumption.itemLid.split(',').map(s => s.trim()).filter(Boolean);
        if (!validLids.includes(currentLid))
            return false;
    }
    if (consumption.itemId) {
        const triggeringItem = data.weapon || data.techItem || data.item;
        if (!triggeringItem)
            return false;
        const id = triggeringItem.id || triggeringItem._id;
        if (id !== consumption.itemId)
            return false;
    }
    if (consumption.actionName) {
        if (data.actionName !== consumption.actionName)
            return false;
    }
    if (consumption.isBoost !== undefined && consumption.isBoost !== null) {
        if (data.moveInfo?.isBoost !== consumption.isBoost)
            return false;
    }
    if (consumption.minDistance !== undefined && consumption.minDistance !== null) {
        if ((data.distanceMoved || 0) < consumption.minDistance)
            return false;
    }
    if (consumption.checkType) {
        if (data.statName !== consumption.checkType)
            return false;
    }
    if (consumption.checkAbove !== undefined && consumption.checkAbove !== null) {
        if ((data.total || 0) < consumption.checkAbove)
            return false;
    }
    if (consumption.checkBelow !== undefined && consumption.checkBelow !== null) {
        if ((data.total || 0) > consumption.checkBelow)
            return false;
    }
    if (consumption.statusId) {
        const triggerStatusId = data.statusId || data.effect?.statuses?.first() || data.effect?.name;
        const allowedIds = consumption.statusId.split(',').map(s => s.trim()).filter(Boolean);
        if (!allowedIds.includes(triggerStatusId))
            return false;
    }
    return true;
}

/**
 * Process consumption-based flagged effects for a given trigger.
 * Scans all scene tokens for effects with matching consumption triggers,
 * checks origin involvement and filters, then decrements charges.
 */
async function processEffectConsumption(triggerType, data) {
    const allTokens = getAllSceneTokens();

    const consumptionPromises = [];

    for (const token of allTokens) {
        const actor = token.actor;
        if (!actor)
            continue;

        const consumableEffects = actor.effects.filter(e => {
            const consumption = e.flags?.['lancer-automations']?.consumption;
            const t = consumption?.trigger;
            if (!t)
                return false;
            return Array.isArray(t) ? t.includes(triggerType) : t === triggerType;
        });

        if (consumableEffects.length === 0)
            continue;

        const consumedGroups = new Set();

        for (const effect of consumableEffects) {
            const consumption = effect.getFlag('lancer-automations', 'consumption');
            if (!consumption)
                continue;

            if (consumption.groupId && consumedGroups.has(consumption.groupId))
                continue;

            const originId = consumption.originId || token.id;
            if (!isOriginInvolved(originId, triggerType, data))
                continue;

            if (!passesBuiltInFilters(consumption, triggerType, data))
                continue;

            const processConsumption = async () => {
                if (consumption.evaluate) {
                    try {
                        let shouldConsume = false;
                        if (typeof consumption.evaluate === 'function') {
                            shouldConsume = await consumption.evaluate(triggerType, data, token, effect);
                        } else if (typeof consumption.evaluate === 'string' && consumption.evaluate.trim() !== '') {
                            const evalFunc = stringToFunction(consumption.evaluate, ["triggerType", "triggerData", "effectBearerToken", "effect"]);
                            shouldConsume = await evalFunc(triggerType, data, token, effect);
                        }
                        if (!shouldConsume)
                            return;
                    } catch (e) {
                        console.error(`lancer-automations | Error evaluating consumption for ${effect.name}:`, e);
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

async function handleTrigger(triggerType, data) {
    // runInFlowBody: child flow.begin() from reactions routes to innerChain, avoids parent-await deadlock.
    return runInFlowBody(async () => {
        data.startRelatedFlow = async () => {
            const item = data.item ?? data.weapon ?? data.techItem;
            const actor = data.triggeringToken?.actor;
            const actionData = data.actionData;

            if (item) {
                const actionPath = actionData?.flowState?.data?.action_path ?? null;
                return item.beginActivationFlow(actionPath);
            }

            if (actionData) {
                const actionType = actionData.action?.activation ?? actionData.type;
                if (!actionType || ['Automatic', 'Other'].includes(actionType)) {
                    ui.notifications.warn(`lancer-automations | startRelatedFlow: action type "${actionType}" cannot be re-launched as a flow.`);
                    return;
                }
                if (!actor) {
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


function registerSettings() {
    // ── Core ──
    game.settings.register('lancer-automations', 'reactionNotificationMode', {
        name: 'Activation Notification Mode',
        hint: 'Who sees the activation popup.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            "both": "GM and Owner",
            "gm": "GM Only",
            "owner": "Owner Only"
        },
        default: "both"
    });

    game.settings.register('lancer-automations', 'consumeReaction', {
        name: 'Consume Reaction on Activation',
        hint: 'Auto-spend the token\'s reaction when a Reaction activation fires.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'consumeAction', {
        name: 'Consume Action on Activation',
        hint: 'Auto-spend the token\'s Quick / Full action when an activation flow succeeds.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Adds a button on the Token HUD to open the Effect Manager.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showStatusEffectsHudButton', {
        name: 'Token HUD Status Effects Button',
        hint: 'Foundry\'s default "Assign Status Effects" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showRevertMovementHudButton', {
        name: 'Revert Movement Button',
        hint: 'The Revert Last Movement / Reset Movement History button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // ── Features ──
    // Surfaced in the StatusFX config menu instead of the main settings panel
    game.settings.register('lancer-automations', 'additionalStatuses', {
        name: 'LaSossis Additional statuses and effects',
        hint: 'Extra statuses (Resist All, Disengage, Grappling, etc.) in the status effects list.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'enableInfectionDamageIntegration', {
        name: 'Infection Damage Integration',
        hint: 'Adds Infection as a fully integrated Lancer damage type. Requires reload.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register('lancer-automations', 'enableKnockbackFlow', {
        name: 'Automate Knockback on Hit',
        hint: 'Auto-trigger the Knockback tool on hits with Knockback-tagged weapons.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableThrowFlow', {
        name: 'Automate Throw Choice for Thrown Weapons',
        hint: 'Thrown-tagged weapons prompt Attack or Throw at the start of the flow.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'statRollTargeting', {
        name: 'Enable Stat Roll Target Selection',
        hint: 'Stat rolls prompt for a target to auto-calculate difficulty.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'treatGenericPrintAsActivation', {
        name: 'Treat Generic Prints as Activations',
        hint: 'Items printed via the generic method also trigger onActivation events.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enablePathHexCalculation', {
        name: 'Enable Path Hex Calculation',
        hint: 'Tracks exact path hexes during movement. Needed for movement interception.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'experimentalBoostDetection', {
        name: 'Experimental Boost Detection (WIP)',
        hint: 'Detects Boost when cumulative drag exceeds base speed. Requires Elevation Ruler.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableMovementCapDetection', {
        name: 'Movement Cap Detection [beta]',
        hint: 'Cancel drag movement exceeding the token\'s movement cap. Works best with Elevation Ruler.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableBoostOffer', {
        name: 'Boost & Move Offer [beta]',
        hint: 'When a move exceeds the cap, offer to split it with Boost (and Overcharge for mechs or NPCs with the Overcharge action).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'showDeployableLines', {
        name: 'Show Deployable Lines',
        hint: 'Draw lines between owned tokens and their deployables on hover.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // ── Alt Structure ──
    game.settings.register('lancer-automations', 'enableAltStruct', {
        name: "Maria's Alternate Structure & Stress Rules",
        hint: "Integrated implementation of Maria's Alternate Structure & Stress rules. Disable if using the standalone lancer-alt-structure module.",
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    // ── One-Structure NPC Auto-Destroy ──
    game.settings.register('lancer-automations', 'enableOneStructNpc', {
        name: 'One-Structure NPC Auto-Destroy',
        hint: 'NPCs with max structure 1 skip the structure table and are destroyed on the first structure hit.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    // ── Vision ──
    game.settings.register('lancer-automations', 'dragVisionMultiplier', {
        name: 'Drag Vision Radius Multiplier',
        hint: '1 = full vision while dragging, 0.5 = half, 0 = none.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 1
    });

    // ── Wreck system ──
    game.settings.register('lancer-automations', 'enableWrecks', {
        name: 'Wreck Automation',
        hint: 'Automate wrecking on structure reaching 0.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    // Per-category wreck mode + terrain.
    const wreckModeChoices = { token: 'Token', tile: 'Tile' };
    for (const cat of ['mech', 'human', 'monstrosity', 'biological']) {
        const label = cat.charAt(0).toUpperCase() + cat.slice(1);
        game.settings.register('lancer-automations', `wreckMode_${cat}`, {
            name: `${label}: Wreck Mode`,
            hint: `How ${label} wrecks are placed.`,
            scope: 'world',
            config: false,
            type: String,
            default: 'token',
            choices: wreckModeChoices,
        });
        game.settings.register('lancer-automations', `wreckTerrain_${cat}`, {
            name: `${label}: Spawn Terrain`,
            hint: `Spawn difficult terrain when a ${label} is wrecked.`,
            scope: 'world',
            config: false,
            type: Boolean,
            default: cat === 'mech' || cat === 'monstrosity',
        });
    }
    game.settings.register('lancer-automations', 'wreckAssetsPath', {
        name: 'Wreck Assets Folder',
        hint: 'Custom folder for wreck images/effects/audio. Leave blank for built-in.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register('lancer-automations', 'enableRemoveFromCombat', {
        name: 'Remove Wrecks from Combat',
        hint: 'Remove wrecked tokens from the combat tracker.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'enableWreckAnimation', {
        name: 'Wreck Explosion Effects',
        hint: 'Play explosion effects when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'enableWreckAudio', {
        name: 'Wreck Explosion Audio',
        hint: 'Play explosion sounds when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'squadLostOnDeath', {
        name: 'Squad MIA on Death',
        hint: 'Apply MIA status to dead squads.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'wreckTerrainType', {
        name: 'Wreck Terrain Type',
        hint: 'Terrain Height Tools terrain type ID for wreck difficult terrain.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register('lancer-automations', 'wreckMasterVolume', {
        name: 'Wreck Master Volume',
        hint: 'Volume of wreck explosion sounds (0 = mute, 1 = full).',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1.5, step: 0.1 },
    });
    game.settings.register('lancer-automations', 'disableHumanDeathSound', {
        name: 'Disable Human Death Sound',
        hint: 'Mute wreck sounds for human/pilot/squad deaths.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'allowHalfSizeTokens', {
        name: 'Allow Half-Size Tokens',
        hint: 'Size 0.5 actors get 0.5 grid token dimensions instead of being forced to 1.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'autoTokenHeight', {
        name: 'Auto Token Height (Wall Height)',
        hint: 'If Wall Height is active, auto-set tokenHeight to actor size + 0.1 so tokens can peek above walls of their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'autoTokenHeightVehicleSquad', {
        name: 'Vehicle & Squad Height Adjustments',
        hint: 'Vehicles get reduced height (size-1, capped at 4). Squads get 0.5.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    // ── Debug ──
    game.settings.register('lancer-automations', 'debugBoostDetection', {
        name: 'Debug: Boost Detection',
        hint: 'Show UI notifications when boost detection triggers.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugPathHexCalculation', {
        name: 'Debug: Path Hex Calculation',
        hint: 'Draw temporary circles on the map highlighting the calculated path hex steps.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugOutOfCombat', {
        name: 'Debug: Out of Combat Warnings',
        hint: 'Show UI warnings when an activation is skipped because the token is not in combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugForceJb2aFree', {
        name: 'Debug: Force JB2A Free Fallbacks',
        hint: 'Pretend the JB2A Patreon module is not installed; route all premium assets through the free-version fallback registry. For testing only.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'lastNotifiedVersion', {
        name: 'Last Notified Version',
        scope: 'world',
        config: false,
        type: String,
        default: ""
    });

    game.settings.register('lancer-automations', 'linkManualDeploy', {
        name: 'Link Manually Placed Deployables',
        hint: 'Auto-link dragged deployable tokens to their owner and fire onDeploy.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'count3DDistance', {
        name: 'Count Elevation in Combat Distance',
        hint: 'Distance = max(horizontal, elevation). Off = 2D only. Affects overwatch, engagement, range checks.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });
}

function serializeTriggerData(data, depth = 0) {
    if (!data || depth > 8)
        return null;
    const serialize = (value, d) => {
        if (d > 8 || value === null || value === undefined)
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
            return value.map(v => serialize(v, d + 1)).filter(v => v !== undefined);
        if (typeof value === 'object') {
            try {
                const result = {};
                for (const [k, v] of Object.entries(value)) {
                    const s = serialize(v, d + 1);
                    if (s !== undefined)
                        result[k] = s;
                }
                return result;
            } catch (e) {
                return undefined;
            }
        }
        return value;
    };
    const result = {};
    for (const [key, value] of Object.entries(data)) {
        const s = serialize(value, depth + 1);
        if (s !== undefined)
            result[key] = s;
    }
    return result;
}

export function deserializeTriggerData(data) {
    if (!data)
        return null;
    const deserialize = (value) => {
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
        if (typeof value === 'object') {
            const result = {};
            for (const [k, v] of Object.entries(value))
                result[k] = deserialize(v);
            return result;
        }
        return value;
    };
    return deserialize(data);
}


// Move history flags on token document:
//   lancer-automations.moveHistory  = { moves: Array<{ distanceMoved, isDrag, isFreeMovement, boostSet, startPos }> }
//   lancer-automations.movementCap  = number

// In-memory cache for move history (survives between preUpdateToken calls in multi-segment moves)
const _moveHistoryCache = new Map();

// Per-mover action stack for chained move/activation sequences (e.g. Boost & Move).
// Only one stack exists at a time. A new push wipes the previous one.
/**
 * @typedef {Object} MoveStackFrame
 * @property {'awaitMove'|'awaitActivation'} kind
 * @property {string} [matchActionName]
 * @property {() => Promise<void>} [onSatisfy]
 */
/**
 * @typedef {Object} MoveStack
 * @property {string} tokenId
 * @property {number} cursor
 * @property {MoveStackFrame[]} frames
 * @property {ReturnType<typeof setTimeout>} [_timer]
 */
/** @type {MoveStack | null} */
let _activeMoveStack = null;
const _MOVE_STACK_TIMEOUT_MS = 5000;
const _MOVE_STACK_INTER_DELAY_MS = 1000;

function _wipeMoveStack() {
    if (!_activeMoveStack)
        return;
    if (_activeMoveStack._timer)
        clearTimeout(_activeMoveStack._timer);
    _activeMoveStack = null;
}

function _pushMoveStack(tokenId, frames) {
    _wipeMoveStack();
    _activeMoveStack = { tokenId, cursor: 0, frames };
    _activeMoveStack._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
}

async function _advanceMoveStack(kind, tokenId, cancelled, ctx = {}) {
    const s = _activeMoveStack;
    if (!s || s.tokenId !== tokenId)
        return;
    const frame = s.frames[s.cursor];
    if (!frame || frame.kind !== kind)
        return;
    if (frame.matchActionName && ctx.actionName !== frame.matchActionName)
        return;
    if (cancelled) {
        _wipeMoveStack(); return;
    }
    const onSatisfy = frame.onSatisfy;
    s.cursor++;
    // Reset the wall-clock safety timer: this frame matched, so the chain is making progress.
    if (s._timer)
        clearTimeout(s._timer);
    s._timer = setTimeout(() => _wipeMoveStack(), _MOVE_STACK_TIMEOUT_MS);
    if (s.cursor >= s.frames.length)
        _wipeMoveStack();
    if (onSatisfy) {
        try {
            // Inter-action grace period: lets async side-effects (cap bumps, action-tracker
            // updates) from the just-completed frame propagate before the next one fires.
            await new Promise(r => setTimeout(r, _MOVE_STACK_INTER_DELAY_MS));
            await onSatisfy();
        } catch (err) {
            console.error('lancer-automations | move stack onSatisfy failed', err); _wipeMoveStack();
        }
    }
}

function _getMoveHistoryDoc(tokenOrId) {
    if (typeof tokenOrId === 'string')
        return canvas.tokens.get(tokenOrId)?.document ?? null;
    return tokenOrId?.document ?? tokenOrId ?? null;
}

function _getMoveHistoryData(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
}

function _writeMoveHistory(tokenDoc, data) {
    if (!tokenDoc)
        return;
    const tid = tokenDoc.id ?? tokenDoc._id;
    if (tid) {
        _moveHistoryCache.set(tid, data);
    }
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', data);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.moveHistory': data });
}

function _writeMovementCap(tokenDoc, value) {
    if (!tokenDoc)
        return;
    foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.movementCap', value);
    if (tokenDoc.isOwner)
        tokenDoc.update({ 'flags.lancer-automations.movementCap': value });
}

function clearMoveData(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const tid = doc.id ?? doc._id;
    if (tid) {
        _moveHistoryCache.delete(tid);
    }
    foundry.utils.setProperty(doc.flags, 'lancer-automations.moveHistory', null);
    if (doc.isOwner)
        doc.update({ 'flags.lancer-automations.-=moveHistory': null });
    initMovementCap(doc);
}

function undoMoveData(tokenOrId, _distance) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    const data = doc.getFlag('lancer-automations', 'moveHistory') ?? { moves: [] };
    const moves = (data.moves || []).slice(0, -1);
    _writeMoveHistory(doc, { ...data, moves });
}

function getCumulativeMoveData(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(m => !m.isFreeMovement).reduce(
        (acc, m) => ({ moved: acc.moved + m.distanceMoved, cost: acc.cost + (m.movementCost ?? m.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

function getIntentionalMoveData(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    return (data.moves || []).filter(m => m.isDrag && !m.isFreeMovement).reduce(
        (acc, m) => ({ moved: acc.moved + m.distanceMoved, cost: acc.cost + (m.movementCost ?? m.distanceMoved) }),
        { moved: 0, cost: 0 }
    );
}

function getMovementCap(tokenOrId) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    return doc?.getFlag('lancer-automations', 'movementCap') ?? 0;
}

function getMovementHistory(tokenOrId) {
    const data = _getMoveHistoryData(tokenOrId);
    const moves = data.moves || [];
    if (moves.length === 0)
        return { exists: false };
    let totalMoved = 0;
    let totalCost = 0;
    let intentionalRegularMoved = 0;
    let intentionalRegularCost = 0;
    let intentionalFreeMoved = 0;
    let intentionalFreeCost = 0;
    let unintentionalMoved = 0;
    let unintentionalCost = 0;
    let nbBoostUsed = 0;
    const startPosition = moves[0].startPos;

    for (const move of moves) {
        const moved = move.distanceMoved;
        const cost = move.movementCost ?? move.distanceMoved;
        totalMoved += moved;
        totalCost += cost;
        if (move.isDrag) {
            if (move.isFreeMovement) {
                intentionalFreeMoved += moved;
                intentionalFreeCost += cost;
            } else {
                intentionalRegularMoved += moved;
                intentionalRegularCost += cost;
            }
            if (move.boostSet && move.boostSet.length > 0) {
                nbBoostUsed += move.boostSet.length;
            }
        } else {
            unintentionalMoved += moved;
            unintentionalCost += cost;
        }
    }

    return {
        exists: true,
        totalMoved,
        totalCost,
        intentional: {
            total: intentionalRegularMoved + intentionalFreeMoved,
            totalCost: intentionalRegularCost + intentionalFreeCost,
            regular: intentionalRegularMoved,
            regularCost: intentionalRegularCost,
            free: intentionalFreeMoved,
            freeCost: intentionalFreeCost
        },
        unintentional: unintentionalMoved,
        unintentionalCost,
        nbBoostUsed,
        startPosition,
        movementCap: getMovementCap(tokenOrId)
    };
}

function initMovementCap(token) {
    const doc = _getMoveHistoryDoc(token);
    if (!doc)
        return;
    const tokenId = doc.id ?? doc._id;
    const isInCombat = !!game.combat?.combatants.find(c => c.token?.id === tokenId);
    if (!isInCombat)
        return;
    const isImmobilized = !!findEffectOnToken(token, 'immobilized');
    const speed = isImmobilized ? 0 : (token.actor?.system?.speed ?? 0);
    _writeMovementCap(doc, speed);
}

function increaseMovementCap(tokenOrId, value) {
    const doc = _getMoveHistoryDoc(tokenOrId);
    if (!doc)
        return;
    _writeMovementCap(doc, getMovementCap(tokenOrId) + value);
}

/**
 * Cap-overflow handler invoked from `preUpdateToken` when the requested move would exceed the
 * remaining movement allowance. Cancels the original update, then offers Boost & Move (any actor)
 * or Overcharge & Boost & Move (mech-only 3-leg path). Each accepted offer pushes a move stack.
 *
 * @param {Token} token
 * @param {{
 *   options: any,
 *   change: any,
 *   startPos: { x: number, y: number },
 *   endPos: { x: number, y: number },
 *   moveInfo: any,
 *   moveToMovementCost: number,
 *   moveIsFreeMovement: boolean,
 *   triggerData: any
 * }} ctx
 */
function _handleMovementCapExceeded(token, ctx) {
    const { options, change, startPos, endPos, moveInfo, moveToMovementCost, moveIsFreeMovement, triggerData } = ctx;
    const capDetect = game.settings.get('lancer-automations', 'enableMovementCapDetection');
    const boostOffer = game.settings.get('lancer-automations', 'enableBoostOffer');
    const isTokenInCombat = !!game.combat?.combatants.find(c => c.token?.id === token.id);
    if (options.ignoreMovementCap
        || (!capDetect && !boostOffer)
        || !isTokenInCombat || moveIsFreeMovement || moveToMovementCost <= 0) {
        return;
    }

    const cap = getMovementCap(token);
    const history = getMovementHistory(token);
    const spent = history.exists ? history.intentional.regularCost : 0;
    if (!(spent <= cap && spent + moveToMovementCost > cap)) {
        return;
    }

    const freeKey = game.keybindings.get('elevationruler', 'freeMovement')?.[0]?.key ?? '[free movement key]';
    const speed = token.actor?.system?.speed ?? 0;
    const isMech = token.actor?.type === 'mech';
    const npcOvercharge = !isMech && token.actor?.type === 'npc'
        ? (token.actor.getFlag('lancer-automations', 'extraActions') || []).find(a => a.name === 'Overcharge (NPC)')
        : null;
    const need = spent + moveToMovementCost;
    const canBoost = speed > 0 && need <= (cap + speed);
    const canOvercharge = (isMech || !!npcOvercharge) && speed > 0 && need > (cap + speed) && need <= (cap + speed * 2);
    const overchargeActionName = isMech ? 'Overcharge' : 'Overcharge (NPC)';
    options.ignoreMovementCap = true;
    triggerData.cancelTriggeredMove._engineCancel = true;

    triggerData.cancel();
    cancelRulerDrag(token, moveInfo);

    const finalX = change.x ?? endPos.x;
    const finalY = change.y ?? endPos.y;
    const finalElev = change.elevation;
    const finalDest = { x: finalX, y: finalY, elevation: finalElev };

    const fireBoost = () => executeSimpleActivation(token.actor, {
        title: 'Boost',
        action: { name: 'Boost', activation: 'Quick' },
        detail: 'Move your speed.',
    });
    const fireOvercharge = async () => {
        if (isMech) {
            const OverchargeFlow = game.lancer?.flows?.get?.('OverchargeFlow');
            if (OverchargeFlow) {
                const flow = new OverchargeFlow(token.actor.uuid);
                await flow.begin();
            }
            return;
        }
        // NPC path: fire the registered "Overcharge (NPC)" extra action so its built-in
        // reaction (heat roll + FX) handles it.
        await executeSimpleActivation(token.actor, {
            title: 'Overcharge (NPC)',
            action: { name: 'Overcharge (NPC)', activation: 'Protocol' },
            detail: npcOvercharge?.detail || '',
        });
    };
    const computeMid = (/** @type {number} */ cost) => {
        const ratio = moveToMovementCost > 0 ? Math.max(0, cost / moveToMovementCost) : 0;
        return token.getSnappedPosition({
            x: startPos.x + (endPos.x - startPos.x) * ratio,
            y: startPos.y + (endPos.y - startPos.y) * ratio,
        });
    };

    if (canBoost && boostOffer && !options._skipBoostOffer) {
        const remaining = cap - spent;
        const snapMid = remaining > 0 ? computeMid(remaining) : null;
        (async () => {
            const result = await startChoiceCard({
                title: 'BOOST & MOVE',
                icon: 'modules/lancer-automations/icons/black/speedometer.svg',
                description: `Movement exceeds cap (${need}/${cap}). Boost adds +${speed}.`,
                originToken: token,
                userIdControl: getTokenOwnerUserId(token),
                choices: [
                    { text: 'Boost & Move', icon: 'modules/lancer-automations/icons/black/speedometer.svg' },
                    { text: 'Ignore', icon: 'fas fa-forward' },
                ]
            });
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1) {
                // Ignore: do the move anyway, bypassing the cap (and any further offer).
                await _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, useElevationRuler: true });
                return;
            }
            if (choiceIdx !== 0)
                return; // Card cancelled: do nothing.
            const fireFinalLeg = () => _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, useElevationRuler: true });
            if (snapMid) {
                // Cap not yet exhausted: leg1 -> Boost -> leg2.
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await _rulerMove(token, snapMid, { _skipBoostOffer: true, useElevationRuler: true });
            } else {
                // Cap already exhausted: skip leg1, fire Boost immediately.
                _pushMoveStack(token.id, [
                    { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: fireFinalLeg },
                    { kind: 'awaitMove' }
                ]);
                await fireBoost();
            }
        })();
    } else if (canOvercharge && boostOffer && !options._skipBoostOffer) {
        // 3-leg path: leg1 -> Boost -> leg2 -> Overcharge -> Boost -> leg3.
        // If cap already exhausted, skip leg1 and start at the Boost.
        const remaining = cap - spent;
        const mid1 = remaining > 0 ? computeMid(remaining) : null;
        const mid2 = computeMid(remaining + speed);
        (async () => {
            const result = await startChoiceCard({
                title: 'OVERCHARGE & BOOST & MOVE',
                icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg',
                description: `Movement exceeds cap+boost (${need}/${cap + speed}). Overcharge grants an extra Boost (+${speed}).`,
                originToken: token,
                userIdControl: getTokenOwnerUserId(token),
                choices: [
                    { text: 'Overcharge & Boost & Move', icon: 'systems/lancer/assets/icons/macro-icons/overcharge.svg' },
                    { text: 'Ignore', icon: 'fas fa-forward' },
                ]
            });
            const choiceIdx = /** @type {any} */ (result)?.choiceIdx;
            if (choiceIdx === 1) {
                await _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, useElevationRuler: true });
                return;
            }
            if (choiceIdx !== 0)
                return; // Card cancelled: do nothing.
            const mid2Move = () => _rulerMove(token, mid2, { _skipBoostOffer: true, ignoreMovementCap: true, useElevationRuler: true });
            const finalMove = () => _rulerMove(token, finalDest, { _skipBoostOffer: true, ignoreMovementCap: true, useElevationRuler: true });
            const tailFrames = [
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: mid2Move },
                { kind: 'awaitMove', onSatisfy: fireOvercharge },
                { kind: 'awaitActivation', matchActionName: overchargeActionName, onSatisfy: fireBoost },
                { kind: 'awaitActivation', matchActionName: 'Boost', onSatisfy: finalMove },
                { kind: 'awaitMove' }
            ];
            if (mid1) {
                _pushMoveStack(token.id, [
                    { kind: 'awaitMove', onSatisfy: fireBoost },
                    ...tailFrames
                ]);
                await _rulerMove(token, mid1, { _skipBoostOffer: true, useElevationRuler: true });
            } else {
                _pushMoveStack(token.id, tailFrames);
                await fireBoost();
            }
        })();
    } else if (capDetect) {
        triggerData.cancelTriggeredMove(
            `Not enough movement points (${need} > ${cap}). ` +
            `Hold <b>${freeKey}</b> for free movement.`
        );
    }
}

// Move a token from code. Plain `tokenDoc.update` by default so the destination
// lands exactly where asked (ER's moveTokenTo simulates a drag and mis-snaps
// non-size-1 tokens). Pass `useElevationRuler: true` to go through ER's pipeline
// (only safe for size-1 tokens that need cost tracking).
/**
 * @param {any} token
 * @param {{x: number, y: number, elevation?: number}} destination
 * @param {Record<string, any>} [extraOpts]
 */
export async function _rulerMove(token, destination, extraOpts = {}) {
    const { useElevationRuler, ...passthroughOpts } = extraOpts;
    const erApi = useElevationRuler && game.modules.get('elevationruler')?.active
        ? game.modules.get('elevationruler')?.api
        : null;
    if (erApi?.moveTokenTo) {
        const Settings = erApi.Settings;
        const prevForceFree = Settings?.FORCE_FREE_MOVEMENT;
        const wantFree = !!passthroughOpts.lancerFreeMovement;
        const previouslyControlled = canvas.tokens.controlled.map(t => t.id);
        const needsTempControl = !token.controlled;
        try {
            if (wantFree && Settings)
                Settings.FORCE_FREE_MOVEMENT = true;
            if (needsTempControl)
                token.control({ releaseOthers: true });
            await erApi.moveTokenTo(token, destination, passthroughOpts);
        } finally {
            if (wantFree && Settings)
                Settings.FORCE_FREE_MOVEMENT = prevForceFree;
            if (needsTempControl) {
                canvas.tokens.releaseAll();
                for (const id of previouslyControlled) {
                    canvas.tokens.get(id)?.control({ releaseOthers: false });
                }
            }
        }
    } else {
        const update = { x: destination.x, y: destination.y };
        if (destination.elevation !== undefined) {
            update.elevation = destination.elevation;
        }
        await token.document.update(update, { isDrag: true, ...passthroughOpts });
    }
}

/**
 * Compute move distances from preUpdateToken options.
 * Uses ElevationRuler segment data when available, falls back to 2D grid measurement.
 * @param {Record<string, any>} options
 * @param {{x: number, y: number}} startPos
 * @param {{x: number, y: number}} endPos
 * @param {number} [elevationFallback]
 * @returns {{ distanceMoved: number, movementCost: number, isFreeMovement: boolean }}
 *   distanceMoved: physical squares traveled (no terrain penalty overhead)
 *   movementCost:  squares consumed from movement cap (includes terrain penalty)
 */
function _computeMoveData(options, startPos, endPos, elevationFallback = 0) {
    const isFreeMovement = options.lancerFreeMovement
        ?? (game.modules.get('elevationruler')?.api?.Settings?.FORCE_FREE_MOVEMENT || false);

    if (options.lancerSegmentDistance !== undefined) {
        const distanceMoved = Math.max(0, Math.round(options.lancerSegmentCost - (options.lancerTerrainPenalty ?? 0)));
        const movementCost = Math.round(options.lancerSegmentCost);
        return { distanceMoved, movementCost, isFreeMovement };
    }

    // Fallback: no ElevationRuler data available
    const dist2D = Math.round(canvas.grid.measurePath([startPos, endPos], {}).distance / canvas.scene.grid.distance);
    const distanceMoved = dist2D + Math.floor(elevationFallback);
    return { distanceMoved, movementCost: distanceMoved, isFreeMovement };
}

async function handleTokenMove(document, change, options, userId) {
    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return true;
    if (options.isUndo)
        return true;

    const token = canvas.tokens.get(document.id);
    if (!token)
        return;

    const startPos = { x: document.x, y: document.y };
    const endPos = { x: change.x ?? document.x, y: change.y ?? document.y };
    const elevationMoved = change.elevation ?? document.elevation;

    const isDrag = !options.forceUnintentional && ('rulerSegment' in options || options.isDrag);
    const isTeleport = !!options.teleport;

    const { distanceMoved, movementCost, isFreeMovement } = _computeMoveData(options, startPos, endPos, elevationMoved);

    const moveInfo = {
        isInvoluntary: !isDrag,
        isTeleport,
        pathHexes: options.lancerPathHexes || [],
        isModified: options.isModified || false,
        extraData: Object.keys(options).reduce((acc, key) => {
            if (!['isDrag', 'isUndo', 'isModified', 'rulerSegment', 'teleport', 'animation'].includes(key)) {
                acc[key] = options[key];
            }
            return acc;
        }, {})
    };

    // Read existing history from flag (synchronous in-memory read)
    // Outside of combat, always start fresh so history reflects only the current movement.
    const tokenDoc = document.document;
    const inCombat = !!game.combat?.active;
    const tokenId = tokenDoc.id ?? tokenDoc._id;
    const existingData = (inCombat ? (_moveHistoryCache.get(tokenId) ?? tokenDoc.getFlag('lancer-automations', 'moveHistory')) : null) ?? { moves: [] };
    const existingMoves = existingData.moves || [];

    // Compute prior intentional cost for boost detection (uses movementCost to count terrain correctly)
    const prevIntentional = existingMoves
        .filter(m => m.isDrag && !m.isFreeMovement)
        .reduce((acc, m) => acc + (m.movementCost ?? m.distanceMoved), 0);

    // Boost detection only when enabled
    if (game.settings.get('lancer-automations', 'experimentalBoostDetection') && isDrag && !isFreeMovement) {
        const speed = token.actor?.system?.speed || 0;
        const currentIntentional = prevIntentional + movementCost;

        const boostSet = [];
        if (speed > 0) {
            // Standard move is 1-speed, boost 1 is speed+1 to 2*speed, boost 2 is 2*speed+1 to 3*speed, etc.
            // Boost N is used when intentional > N * speed
            const prevBoostCount = prevIntentional > 0 ? Math.floor((prevIntentional - 1) / speed) : 0;
            const newBoostCount = currentIntentional > 0 ? Math.floor((currentIntentional - 1) / speed) : 0;
            for (let n = prevBoostCount + 1; n <= newBoostCount; n++) {
                boostSet.push(n);
            }
        }
        moveInfo.boostSet = boostSet;
        moveInfo.isBoost = boostSet.length > 0;

        // Debug notification for boost detection testing
        if (game.settings.get('lancer-automations', 'debugBoostDetection')) {
            ui.notifications.info(`${token.name}: moved ${distanceMoved} (cost ${movementCost}), intentional ${prevIntentional + movementCost}/${speed} | isBoost: ${moveInfo.isBoost}, boostSet: [${boostSet.join(',')}]`);
        }
    }

    // Build updated move history and persist (only in combat; outside combat, keep in-memory only for the trigger call)
    const newData = {
        ...existingData,
        moves: [...existingMoves, {
            distanceMoved,
            movementCost,
            isDrag,
            isFreeMovement,
            boostSet: moveInfo.boostSet || [],
            startPos
        }]
    };
    if (inCombat) {
        _moveHistoryCache.set(tokenId, newData);
        foundry.utils.setProperty(tokenDoc.flags, 'lancer-automations.moveHistory', newData);
        const isLastSegment = !options.rulerSegment || options.lastRulerSegment === true;
        if (tokenDoc.isOwner && isLastSegment) {
            tokenDoc.update({ 'flags.lancer-automations.moveHistory': newData });
        }
        // First regular intentional move of the turn consumes the move action.
        if (isDrag && !isFreeMovement && !isTeleport && prevIntentional === 0)
            consumeAction(token, 'move');
    }

    if (!isDrag || options.IgnoreOnMove)
        return;

    await handleTrigger('onMove', { triggeringToken: token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });

    // Move leg complete: advance the action stack if this token is the awaited mover.
    // Fire-and-forget so this hook returns promptly.
    _advanceMoveStack('awaitMove', token.id, false);
}

async function onAttackStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(t => t.target).filter(Boolean);

    const actionData = {
        type: state.data?.type || "attack",
        title: state.data?.title || weapon?.name || "Attack",
        action: {
            name: state.data?.title || weapon?.name || "Attack"
        },
        detail: state.data?.effect || weapon?.system?.effect || "",
        attack_type: state.data?.attack_type || "Ranged",
        tags: state.data?.tags || weapon?.system?.tags || [],
        flowState: state
    };

    await handleTrigger('onAttack', {
        triggeringToken: token,
        weapon,
        targets,
        attackType: actionData.attack_type,
        actionName: actionData.title,
        tags: actionData.tags,
        actionData,
        flowState: state
    });
    return true;
}

async function onHitMissStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const hitResults = state.data?.hit_results || [];

    const actionData = {
        type: state.data?.type || "attack",
        title: state.data?.title || weapon?.name || "Attack",
        action: {
            name: state.data?.title || weapon?.name || "Attack"
        },
        detail: state.data?.effect || weapon?.system?.effect || "",
        attack_type: state.data?.attack_type || "Ranged",
        tags: state.data?.tags || weapon?.system?.tags || [],
        flowState: state
    };

    const hitTargets = [];
    const missTargets = [];

    for (let i = 0; i < hitResults.length; i++) {
        const hitResult = hitResults[i];
        const targetToken = targetInfos[i]?.target;
        const roll = hitResult?.roll || state.data?.attack_results?.[i]?.roll;

        if (!targetToken)
            continue;

        if (await hasCritImmunity(targetToken.actor, state.actor, state) && (hitResult?.crit || state.data?.attack_results?.[i]?.crit)) {
            if (hitResult)
                hitResult.crit = false;
            if (state.data?.attack_results?.[i])
                state.data.attack_results[i].crit = false;
            ui.notifications.info(`${targetToken.name} is immune to Critical Hits!`);
        }

        const missImmunity = await hasMissImmunity(targetToken.actor, state.actor, state);
        const hitImmunity = await hasHitImmunity(targetToken.actor, state.actor, state);
        if (missImmunity && hitImmunity)
            ui.notifications.info(`${targetToken.name} is immune to miss and hit - these effects cancel each other`);
        else {
            if (missImmunity && (hitResult?.miss || state.data?.attack_results?.[i]?.miss)) {
                if (hitResult)
                    hitResult.hit = true;
                if (state.data?.attack_results?.[i])
                    state.data.attack_results[i].hit = true;
                ui.notifications.info(`${targetToken.name} is immune to miss - attack hits!`);
            }

            if (hitImmunity && (hitResult?.hit || state.data?.attack_results?.[i]?.hit)) {
                if (hitResult) {
                    hitResult.hit = false;
                    hitResult.crit = false;
                }
                if (state.data?.attack_results?.[i]) {
                    state.data.attack_results[i].hit = false;
                    state.data.attack_results[i].crit = false;
                }
                ui.notifications.info(`${targetToken.name} is immune to Hits: attack misses!`);
            }
        }
        if (hitResult?.hit) {
            hitTargets.push({
                target: targetToken,
                roll: roll,
                crit: hitResult?.crit || false
            });
        } else {
            missTargets.push({
                target: targetToken,
                roll: roll
            });
        }
    }

    if (hitTargets.length > 0) {
        await handleTrigger('onHit', {
            triggeringToken: token,
            weapon,
            targets: hitTargets,
            attackType: actionData.attack_type,
            actionName: actionData.title,
            tags: actionData.tags,
            actionData,
            flowState: state
        });
    }
    if (missTargets.length > 0) {
        await handleTrigger('onMiss', {
            triggeringToken: token,
            weapon,
            targets: missTargets,
            attackType: actionData.attack_type,
            actionName: actionData.title,
            tags: actionData.tags,
            actionData,
            flowState: state
        });
    }

    return true;
}

async function onDamageStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;

    const damageResults = state.data?.damage_results || [];
    const targets = state.data?.targets || [];

    const damages = damageResults.map(dr => dr.roll?.total || 0);
    const types = damageResults.map(dr => dr.d_type);

    const actionData = {
        type: state.data?.type || "attack",
        title: state.data?.title || weapon?.name || "Attack",
        action: {
            name: state.data?.title || weapon?.name || "Attack"
        },
        detail: state.data?.effect || weapon?.system?.effect || "",
        attack_type: state.data?.attack_type || "Ranged",
        tags: state.data?.tags || weapon?.system?.tags || [],
        flowState: state
    };

    for (const targetInfo of targets) {
        const targetToken = targetInfo.target;
        const isCrit = targetInfo.crit || false;
        const isHit = targetInfo.hit || false;

        if (targetInfo.damage && targetToken.actor) {
            targetInfo.damage = applyDamageImmunities(targetToken.actor, targetInfo.damage, state);
        }

        const targetDamages = targetInfo.damage?.map(d => d.amount ?? d.val) || [];
        const targetTypes = targetInfo.damage?.map(d => d.type) || [];

        if (targetDamages.length > 0) {
            await handleTrigger('onDamage', {
                triggeringToken: token,
                weapon,
                target: targetToken,
                damages: targetDamages,
                types: targetTypes,
                isCrit,
                isHit,
                attackType: actionData.attack_type,
                actionName: actionData.title,
                tags: actionData.tags,
                actionData,
                flowState: state
            });
        }
    }

    return true;
}

async function onPreStructureStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStructure = actor?.system?.structure?.value ?? 0;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelStructureTriggered = false;
    const cancelStructure = _buildCancelFn({
        setFlag: () => {
            cancelStructureTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "Structure damage has been prevented.",
        defaultTitle: "STRUCTURE PREVENTED",
    });

    await handleTrigger('onPreStructure', {
        triggeringToken: token,
        remainingStructure,
        cancelStructure,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelStructureTriggered) {
        await cancelStructure.wait();
        return false;
    }
    return true;
}

async function onStructureStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStructure = actor?.system?.structure?.value ?? 0;
    const roll = state.data?.result?.roll;
    const rollResult = roll?.total;
    const rollDice = roll?.dice?.[0]?.results?.map(r => r.result) ?? [];
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelTriggered = false;
    const cancelStructureOutcome = _buildCancelFn({
        setFlag: () => {
            cancelTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "Structure outcome has been overridden.",
        defaultTitle: "STRUCTURE OUTCOME OVERRIDDEN",
    });

    const modifyRoll = (newTotal) => {
        if (state.data?.result?.roll) {
            state.data.result.roll._total = newTotal;
        }
    };

    await handleTrigger('onStructure', {
        triggeringToken: token,
        remainingStructure,
        rollResult,
        rollDice,
        cancelStructureOutcome,
        modifyRoll,
        _cancelledBy: state.data._cancelledBy,
        flowState: state,
    });

    if (cancelTriggered) {
        await cancelStructureOutcome.wait?.();
        return false;
    }
    return true;
}

async function onPreStressStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStress = actor?.system?.stress?.value ?? 0;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelStressTriggered = false;
    const cancelStress = _buildCancelFn({
        setFlag: () => {
            cancelStressTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "Stress damage has been prevented.",
        defaultTitle: "STRESS PREVENTED",
    });

    await handleTrigger('onPreStress', {
        triggeringToken: token,
        remainingStress,
        cancelStress,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelStressTriggered) {
        await cancelStress.wait();
        return false;
    }
    return true;
}

async function onStressStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStress = actor?.system?.stress?.value ?? 0;
    const roll = state.data?.result?.roll;
    const rollResult = roll?.total;
    const rollDice = roll?.dice?.[0]?.results?.map(r => r.result) ?? [];
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelTriggered = false;
    const cancelStressOutcome = _buildCancelFn({
        setFlag: () => {
            cancelTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "Stress outcome has been overridden.",
        defaultTitle: "STRESS OUTCOME OVERRIDDEN",
    });

    const modifyRoll = (newTotal) => {
        if (state.data?.result?.roll) {
            state.data.result.roll._total = newTotal;
        }
    };

    await handleTrigger('onStress', {
        triggeringToken: token,
        remainingStress,
        rollResult,
        rollDice,
        cancelStressOutcome,
        modifyRoll,
        _cancelledBy: state.data._cancelledBy,
        flowState: state,
    });

    if (cancelTriggered) {
        await cancelStressOutcome.wait?.();
        return false;
    }
    return true;
}

async function onTechAttackStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(t => t.target).filter(Boolean);

    const actionData = {
        type: state.data?.type || "tech",
        title: state.data?.title || techItem?.name || "Tech Attack",
        action: {
            name: state.data?.title || techItem?.name || "Tech Attack"
        },
        detail: state.data?.effect || techItem?.system?.effect || "",
        isInvade: state.data?.invade || false,
        tags: state.data?.tags || techItem?.system?.tags || [],
        flowState: state
    };

    await handleTrigger('onTechAttack', {
        triggeringToken: token,
        techItem,
        targets,
        actionName: actionData.title,
        isInvade: actionData.isInvade,
        tags: actionData.tags,
        actionData,
        flowState: state
    });
    return true;
}

async function onTechHitMissStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const hitResults = state.data?.hit_results || [];

    const actionData = {
        type: state.data?.type || "tech",
        title: state.data?.title || techItem?.name || "Tech Attack",
        action: {
            name: state.data?.title || techItem?.name || "Tech Attack"
        },
        detail: state.data?.effect || techItem?.system?.effect || "",
        isInvade: state.data?.invade || false,
        tags: state.data?.tags || techItem?.system?.tags || [],
        flowState: state
    };

    const hitTargets = [];
    const missTargets = [];

    for (let i = 0; i < hitResults.length; i++) {
        const hitResult = hitResults[i];
        const targetToken = targetInfos[i]?.target;
        const roll = hitResult?.roll || state.data?.attack_results?.[i]?.roll;

        if (!targetToken)
            continue;

        if (hitResult?.hit) {
            hitTargets.push({
                target: targetToken,
                roll: roll,
                crit: hitResult?.crit || false
            });
        } else {
            missTargets.push({
                target: targetToken,
                roll: roll
            });
        }
    }

    if (hitTargets.length > 0) {
        await handleTrigger('onTechHit', {
            triggeringToken: token,
            techItem,
            targets: hitTargets,
            actionName: actionData.title,
            isInvade: actionData.isInvade,
            tags: actionData.tags,
            actionData,
            flowState: state
        });
    }
    if (missTargets.length > 0) {
        await handleTrigger('onTechMiss', {
            triggeringToken: token,
            techItem,
            targets: missTargets,
            actionName: actionData.title,
            isInvade: actionData.isInvade,
            tags: actionData.tags,
            actionData,
            flowState: state
        });
    }

    return true;
}

async function onCheckStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    const roll = state.data?.result?.roll;
    const total = roll?.total;
    const targetVal = state.la_extraData?.targetVal ?? 10;
    const success = total >= targetVal;

    const targetTokenId = state.la_extraData?.targetTokenId;
    const checkAgainstToken = targetTokenId ? canvas.tokens.get(targetTokenId) : null;

    await handleTrigger('onCheck', {
        triggeringToken: token,
        statName,
        roll,
        total,
        success,
        checkAgainstToken: checkAgainstToken,
        targetVal: targetVal,
        flowState: state
    });
    return true;
}

/**
 * Builds a cancel handler with shared boilerplate: reason collection, preConfirm gating, choice card.
 * @param {Object} opts
 * @param {() => void} opts.setFlag
 * @param {any[]} opts.cancelledBy
 * @param {() => (() => Promise<void>)} opts.getIgnoreCallback - Returns the "ignore" action; called lazily.
 * @param {string} opts.defaultReason
 * @param {string} opts.defaultTitle
 * @param {string} [opts.choice1Text]
 * @param {string} [opts.choice2Text]
 * @param {((uc: string|null) => Object)|null} [opts.getExtraCardOptions]
 * @param {(() => Promise<void>)|null} [opts.onBefore] - Called before card, after preConfirms.
 * @param {(() => Promise<void>)|null} [opts.onAfter] - Called after card.
 * @returns {any}
 */
function _buildCancelFn({ setFlag, cancelledBy, getIgnoreCallback, defaultReason, defaultTitle, choice1Text = "Cancel", choice2Text = "Ignore", getExtraCardOptions = null, onBefore = null, onAfter = null }) {
    if (!cancelledBy)
        console.error('lancer-automations | _buildCancelFn: missing cancelledBy array');
    const cancelledReasons = [];
    const preConfirms = [];
    let cardPending = false;
    let _promise = null;

    /** @type {any} */
    const fn = (reasonText = defaultReason, title = defaultTitle, allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
        setFlag();
        if (!fn._reactorIdentity && !fn._engineCancel)
            console.error('lancer-automations | cancel called without _reactorIdentity');
        if (fn._reactorIdentity && cancelledBy)
            cancelledBy.push(fn._reactorIdentity);
        // Fall back to reactor-dispatch context when caller omits opts
        const def = fn._defaultContext ?? {};
        const item = opts.item ?? def.item ?? null;
        const originToken = opts.originToken ?? def.originToken ?? null;
        const relatedToken = opts.relatedToken ?? def.relatedToken ?? null;
        if (reasonText)
            cancelledReasons.push(reasonText);
        if (preConfirm)
            preConfirms.push(preConfirm);
        if (cardPending)
            return _promise;
        cardPending = true;
        _promise = (async () => {
            await Promise.resolve();
            const ignoreCallback = getIgnoreCallback();
            if (preConfirms.length > 0) {
                const results = await Promise.all(preConfirms.map(f => f()));
                if (results.every(r => !r)) {
                    await ignoreCallback();
                    return;
                }
            }
            if (!allowConfirm) {
                // Auto-pick choice1 (cancel-equivalent = keep blocked)
                await postChoice?.(true);
                return;
            }
            const description = cancelledReasons.length > 1
                ? cancelledReasons.map(r => `• ${r}`).join('<br>')
                : (cancelledReasons[0] ?? defaultReason);
            if (onBefore)
                await onBefore();
            const extraCardOptions = getExtraCardOptions ? getExtraCardOptions(userIdControl) : {};
            await startChoiceCard({
                mode: "or",
                title,
                description,
                item,
                originToken,
                relatedToken,
                userIdControl: userIdControl ?? getActiveGMId(),
                ...extraCardOptions,
                choices: [
                    {
                        text: choice1Text,
                        icon: "fas fa-check",
                        callback: async () => {
                            await postChoice?.(true);
                        }
                    },
                    {
                        text: choice2Text,
                        icon: "fas fa-times",
                        callback: async () => {
                            await postChoice?.(false);
                            await ignoreCallback();
                        }
                    }
                ]
            });
            if (onAfter)
                await onAfter();
        })();
        return _promise;
    };
    fn.wait = () => _promise;
    return fn;
}

async function stunnedAutoFailStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    if (!token)
        return true;

    const isStunned = !!findEffectOnToken(token, 'stunned');
    if (!isStunned)
        return true;

    const path = (state.data?.path || '').toLowerCase();
    const title = (state.data?.title || '').toUpperCase();
    const isHullOrAgi = path.includes('hull') || path.includes('agi')
        || title.includes('HULL') || title.includes('AGI');
    if (!isHullOrAgi)
        return true;

    if (state.data?.roll_str)
        state.data.roll_str = `(${state.data.roll_str}) * 0`;

    const statLabel = (path.includes('hull') || title.includes('HULL')) ? 'HULL' : 'AGILITY';
    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ token: token.document }),
        content: `<div class="lancer-chat-message"><b>${statLabel}</b><br>`
            + `<span style="color:#c0392b;font-weight:bold;">AUTOMATIC FAILURE</span> &mdash; ${token.name} is <b>Stunned</b> and automatically fails ${statLabel} checks and saves.</div>`
    });

    return true;
}

async function onInitCheckStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    const targetVal = state.la_extraData?.targetVal ?? 10;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelCheckTriggered = false;
    const cancelCheck = _buildCancelFn({
        setFlag: () => {
            cancelCheckTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "This check has been canceled.",
        defaultTitle: "CHECK CANCELED",
    });

    await handleTrigger('onInitCheck', {
        triggeringToken: token,
        statName,
        checkAgainstToken: state.la_extraData?.targetTokenId ? canvas.tokens.get(state.la_extraData.targetTokenId) : null,
        targetVal: targetVal,
        cancelCheck,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelCheckTriggered) {
        await cancelCheck.wait();
        return false;
    }

    if (token) {
        state.actor = token.actor;
    }
    return true;
}

async function onInitAttackStep(state) {
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targets = state.data?.acc_diff?.targets?.map(t => t.target).filter(Boolean) || [];
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    const actionData = {
        type: state.data?.type || "attack",
        title: state.data?.title || weapon?.name || "Attack",
        action: {
            name: state.data?.title || weapon?.name || "Attack"
        },
        detail: state.data?.effect || weapon?.system?.effect || "",
        attack_type: state.data?.attack_type || "Ranged",
        tags: state.data?.tags || weapon?.system?.tags || [],
        flowState: state
    };

    let cancelAttackTriggered = false;
    const cancelAttack = _buildCancelFn({
        setFlag: () => {
            cancelAttackTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "This attack has been canceled.",
        defaultTitle: "ATTACK CANCELED",
    });

    await handleTrigger('onInitAttack', {
        triggeringToken: token,
        weapon,
        targets,
        actionName: actionData.title,
        tags: actionData.tags,
        actionData,
        cancelAttack,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelAttackTriggered) {
        await cancelAttack.wait();
        return false;
    }

    if (token) {
        state.actor = token.actor;
    }
    return true;
}

async function onInitTechAttackStep(state) {
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targets = state.data?.acc_diff?.targets?.map(t => t.target).filter(Boolean) || [];
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    const actionData = {
        type: state.data?.type || "tech",
        title: state.data?.title || techItem?.name || "Tech Attack",
        action: {
            name: state.data?.title || techItem?.name || "Tech Attack"
        },
        detail: state.data?.effect || techItem?.system?.effect || "",
        isInvade: state.data?.invade || false,
        tags: state.data?.tags || techItem?.system?.tags || [],
        flowState: state
    };

    let cancelTechAttackTriggered = false;
    const cancelTechAttack = _buildCancelFn({
        setFlag: () => {
            cancelTechAttackTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {},
        defaultReason: "This tech attack has been canceled.",
        defaultTitle: "TECH ATTACK CANCELED",
    });

    await handleTrigger('onInitTechAttack', {
        triggeringToken: token,
        techItem,
        targets,
        actionName: actionData.title,
        isInvade: actionData.isInvade,
        tags: actionData.tags,
        actionData,
        cancelTechAttack,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelTechAttackTriggered) {
        await cancelTechAttack.wait();
        return false;
    }

    if (token) {
        state.actor = token.actor;
    }
    return true;
}

async function onActivationStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    let item = state.item;

    // Resolve source item for extra actions (SimpleActivationFlow has no item by default).
    // _sourceItemId is stamped by addExtraActions; the item ref is also passed from TAH.
    if (!item && state.data?.action?._sourceItemId && actor) {
        item = actor.items.get(state.data.action._sourceItemId) ?? null;
        if (item)
            state.item = item;
    }

    // Deployable: surface the actor's LID and resolve the source item (the parent
    // item whose system.deployables[] contains this LID) so reactions can match.
    let deployable = null;
    if (actor?.type === 'deployable') {
        deployable = { actor, lid: actor.system?.lid ?? null };
        if (!item) {
            item = await resolveDeployableSourceItem(actor) ?? null;
            if (item)
                state.item = item;
        }
    }

    let actionType = state.data?.action?.activation || item?.system?.activation || state.data?.type || 'Other';
    let actionName = state.data?.title || state.data?.action?.name || item?.name || 'Unknown Action';

    // Normalize built-in flows that have no item and use actor-prefixed titles
    const flowClass = state.name ?? '';
    if (flowClass === 'OverchargeFlow') {
        actionType = 'Protocol';
        actionName = 'Overcharge';
    } else if (flowClass === 'StabilizeFlow') {
        actionType = 'Full';
        actionName = 'Stabilize';
    }

    const tags = state.data?.tags || item?.system?.tags || [];
    if (Array.isArray(tags)) {
        const tagMap = {
            "tg_quick_action": "Quick",
            "tg_full_action": "Full",
            "tg_reaction": "Reaction",
            "tg_protocol": "Protocol",
            "tg_free_action": "Free"
        };

        for (const tag of tags) {
            if (tag.lid && tagMap[tag.lid]) {
                actionType = tagMap[tag.lid];
                break;
            }
        }
    }

    const actionData = {
        type: "action",
        title: state.data?.title || actionName,
        action: state.data?.action || {
            name: actionName,
            activation: actionType
        },
        detail: state.data?.detail || item?.system?.effect || "",
        tags: tags,
        flowState: state,
        deployable
    };

    await handleTrigger('onActivation', {
        triggeringToken: token,
        actionType: actionType,
        actionName: actionName,
        item,
        actionData,
        deployable,
        endActivation: state.la_extraData?.endActivation || false,
        extraData: state.la_extraData ?? {},
        flowState: state
    });

    if (token) {
        state.actor = token.actor;
        // Advance the move stack now that the activation is fully complete (post-effects).
        // Fire-and-forget, same reason as in the onMove handler.
        _advanceMoveStack('awaitActivation', token.id, false, { actionName });
    }

    // Auto-discharge extra actions that carry a `recharge` field after activation
    const activatedAction = state.data?.action;
    if (activatedAction?.recharge && activatedAction?.charged !== false) {
        for (const itm of (state.actor?.items ?? [])) {
            const ea = itm.getFlag('lancer-automations', 'extraActions') || [];
            const match = ea.find(a => a.name === activatedAction.name && a.recharge);
            if (match) {
                match.charged = false;
                await itm.setFlag('lancer-automations', 'extraActions', ea);
                break;
            }
        }
        const actorEa = state.actor?.getFlag('lancer-automations', 'extraActions') || [];
        const actorMatch = actorEa.find(a => a.name === activatedAction.name && a.recharge);
        if (actorMatch) {
            actorMatch.charged = false;
            await state.actor.setFlag('lancer-automations', 'extraActions', actorEa);
        }
    }

    if (actionType === 'Reaction' && token && game.settings.get('lancer-automations', 'consumeReaction')) {
        if (hasReactionAvailable(token)) {
            const newVal = (token.actor.system.action_tracker.reaction ?? 1) - 1;
            await token.actor.update({ 'system.action_tracker.reaction': newVal });
        } else {
            ui.notifications.warn(`${token.name} has no reaction available!`);
        }
    }

    return true;
}

async function onInitActivationStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    let item = state.item;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    // Deployable: surface the actor's LID and resolve the source item.
    let deployable = null;
    if (actor?.type === 'deployable') {
        deployable = { actor, lid: actor.system?.lid ?? null };
        if (!item) {
            item = await resolveDeployableSourceItem(actor) ?? null;
            if (item)
                state.item = item;
        }
    }

    let actionType = state.data?.action?.activation || item?.system?.activation || state.data?.type || 'Other';
    const actionName = state.data?.title || state.data?.action?.name || item?.name || 'Unknown Action';

    const tags = state.data?.tags || item?.system?.tags || [];
    if (Array.isArray(tags)) {
        const tagMap = {
            "tg_quick_action": "Quick",
            "tg_full_action": "Full",
            "tg_reaction": "Reaction",
            "tg_protocol": "Protocol",
            "tg_free_action": "Free"
        };
        for (const tag of tags) {
            if (tag.lid && tagMap[tag.lid]) {
                actionType = tagMap[tag.lid];
                break;
            }
        }
    }

    const actionData = {
        type: "action",
        title: state.data?.title || actionName,
        action: state.data?.action || { name: actionName, activation: actionType },
        detail: state.data?.detail || state.data?.effect || item?.system?.effect || "",
        tags: tags,
        flowState: state,
        deployable
    };

    let cancelActivation = false;
    const cancelAction = _buildCancelFn({
        setFlag: () => {
            cancelActivation = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => async () => {
            const flowClass = game.lancer?.flows?.get?.(state.name);
            if (flowClass) {
                let newFlow;
                if (state.name === "SimpleActivationFlow") {
                    newFlow = new flowClass(state.actor.uuid, { ...state.data });
                } else if (["SystemFlow", "TalentFlow", "ActivationFlow", "CoreActiveFlow"].includes(state.name)) {
                    newFlow = new flowClass(state.item, { ...state.data });
                } else {
                    ui.notifications.error(`lancer-automations | Unknown flow type "${state.name}". Cannot re-launch.`);
                    return;
                }
                await newFlow.begin();
            }
        },
        defaultReason: "This activation has been canceled.",
        defaultTitle: "ACTIVATION CANCELED",
    });

    // Called WITHOUT await; only synchronous evaluate functions work correctly with cancelAction.
    handleTrigger('onInitActivation', {
        triggeringToken: token,
        actionType,
        actionName,
        item,
        actionData,
        deployable,
        cancelAction,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelActivation) {
        if (_activeMoveStack && token && _activeMoveStack.tokenId === token.id) {
            _wipeMoveStack();
        }
        await cancelAction.wait();
        return false;
    }

    if (token)
        state.actor = token.actor;
    return true;
}

async function statRollTargetSelectStep(state) {
    if (!game.settings.get('lancer-automations', 'statRollTargeting')) {
        return true;
    }

    // If target already provided (e.g. via executeStatRoll), skip
    if (state.la_extraData?.targetTokenId || state.la_extraData?.chooseToken === false) {
        return true;
    }

    const actor = state.actor;
    const token = actor.token?.object || canvas.tokens.get(actor.token?.id) || canvas.tokens.controlled[0];
    if (!token) {
        return true;
    }

    // Infer stat from path (e.g. system.hull -> HULL)
    const STATS = new Set(['AGI', 'HULL', 'ENG', 'SYS', 'GRIT', 'TIER']);
    let statName = "STAT";
    if (state.data.path) {
        const parts = state.data.path.split('.');
        statName = parts[parts.length - 1].toUpperCase();
    }

    let targets = [];
    if (STATS.has(state.data.title)) {
        targets = await chooseToken(token, {
            title: `${statName} SAVE TARGET`,
            description: `Select a target to make it a Skill Save (Optional)`,
            count: 1,
            range: null,
            includeSelf: true // Allow self-targeting if needed
        });
    }

    if (targets && targets.length > 0) {
        const targetToken = targets[0];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.targetTokenId = targetToken.id;

        let targetVal = 10;
        const targetActor = targetToken.actor;

        if (targetActor.type === "npc" || targetActor.type === "deployable") {
            targetVal = targetActor.system.save || 10;
        } else if (targetActor.type === "mech") {
            // Try to map back to a stat path
            const path = state.data.path;
            targetVal = foundry.utils.getProperty(targetActor, path) || 10;
        }

        state.la_extraData.targetVal = targetVal;

        // Update title with difficulty
        const currentTitle = state.data.title || `${statName} Check`;
        // Replace "Check" with "Save" if present
        let newTitle = currentTitle.replace("Check", "Save");
        if (!newTitle.includes("Save"))
            newTitle += " Save";

        state.data.title = `${newTitle} (>= ${targetVal})`;
    }

    return true;
}

async function throwChoiceStep(state) {
    if (!game.settings.get('lancer-automations', 'enableThrowFlow'))
        return true;
    if (state.la_extraData?.is_throw)
        return true;

    const item = state.item;
    if (!item)
        return true;

    const profile = item.system?.active_profile;
    const tags = profile?.all_tags || item.system?.tags || [];
    const thrownTag = tags.find(t => t.lid === "tg_thrown" || t.id === "tg_thrown");
    if (!thrownTag)
        return true;

    const throwRange = thrownTag.val || thrownTag.num_val || "?";
    const activeProfileIdx = item.system?.selected_profile_index ?? 0;
    const activeProfileWithBonus = getWeaponProfiles_WithBonus(item, state.actor)?.[activeProfileIdx];
    const weaponRanges = (activeProfileWithBonus?.range ?? profile?.all_range ?? profile?.range ?? item.system?.range ?? [])
        .filter(r => r.type !== "Thrown")
        .map(r => `${r.type} ${r.val}`)
        .join(", ") || "—";

    let isThrow = false;
    const result = await startChoiceCard({
        mode: "or",
        title: item.name,
        icon: "cci cci-melee",
        description: "This weapon can be thrown.",
        choices: [
            { text: `Attack (${weaponRanges})`,
                icon: "cci cci-melee",
                callback: () => {
                    isThrow = false;
                } },
            { text: `Throw (${throwRange})`,
                icon: "fas fa-hammer",
                callback: () => {
                    isThrow = true;
                } }
        ]
    });

    if (result === null)
        return false;
    state.la_extraData = state.la_extraData || {};
    state.la_extraData.is_throw = isThrow;
    return true;
}

async function throwDeployStep(state) {
    if (!state.la_extraData?.is_throw)
        return true;

    const item = state.item;
    if (!item)
        return true;

    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const hitResults = state.data?.hit_results || [];
    const targetInfos = state.data?.acc_diff?.targets || [];

    let deployTarget = null;
    for (let i = 0; i < hitResults.length; i++) {
        if (hitResults[i]?.hit) {
            const tDoc = targetInfos[i]?.target;
            deployTarget = tDoc?.object || (tDoc?.id ? canvas.tokens.get(tDoc.id) : null);
            if (deployTarget)
                break;
        }
    }
    if (!deployTarget && targetInfos.length > 0) {
        const tDoc = targetInfos[0]?.target;
        deployTarget = tDoc?.object || (tDoc?.id ? canvas.tokens.get(tDoc.id) : null);
    }

    const multipleTargets = targetInfos.length > 1;
    await deployWeaponToken(item, actor, token, {
        range: multipleTargets ? null : 1,
        at: multipleTargets ? null : deployTarget,
        title: `THROW ${item.name}`
    });

    return true;
}

/**
 * Flow step that injects the Knockback checkbox into the damage HUD.
 */
async function knockbackInjectStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    injectKnockbackCheckbox(state);
    return true;
}

/**
 * Flow step that triggers knockback after damage is rolled in DamageRollFlow.
 */
async function knockbackDamageStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    const kb = state.data?._csmKnockback;
    if (!kb?.enabled)
        return true;

    const distance = kb.value || 1;
    const targets = state.data?.targets || [];
    const hitTokens = [];

    for (const targetInfo of targets) {
        const t = targetInfo.target;
        if (t) {
            const tokenObj = t.object || (t.id ? canvas.tokens.get(t.id) : null) || t;
            if (tokenObj)
                hitTokens.push(tokenObj);
        }
    }

    if (hitTokens.length === 0)
        return true;

    const attackerToken = state.actor?.token?.object
        || canvas.tokens.get(state.actor?.token?.id)
        || state.actor?.getActiveTokens()?.[0];

    const itemName = state.item?.name || state.data?.title || 'Damage';
    await knockBackToken(hitTokens, distance, {
        title: `${itemName} Knockback`,
        triggeringToken: attackerToken
    });

    return true;
}

const _lwfxSuppressActors = new Set();
function _actorSuppressId(x) {
    return x?.actor?.uuid ?? x?.uuid ?? x?.actor?.id ?? x?.id ?? null;
}
function _suppressNextLwfxFor(actorOrToken) {
    const id = _actorSuppressId(actorOrToken);
    if (!id)
        return;
    _lwfxSuppressActors.add(id);
    setTimeout(() => _lwfxSuppressActors.delete(id), 3000);
}

async function playInlineAttackFX(state) {
    const title = state.data?.title;
    const fxPlayer = LA_INLINE_ATTACK_FX[title];
    if (!fxPlayer)
        return true;
    _suppressNextLwfxFor(state.actor);
    try {
        await fxPlayer(state);
    } catch (e) {
        console.error(`lancer-automations | FX "${title}" failed:`, e);
    }
    return true;
}

async function playThrowFXIfNeeded(state) {
    if (!state.la_extraData?.is_throw)
        return true;
    _suppressNextLwfxFor(state.actor);
    try {
        await playDefaultThrowFX(state);
    } catch (e) {
        console.error('lancer-automations | throw FX failed:', e);
    }
    return true;
}

/**
 * Flow step: for damage flows spawned from a basic attack that carried injected tags
 */
async function pullInjectedTagsFromAttack(state) {
    const tags = ActiveFlowState.current?.injectedTags;
    if (Array.isArray(tags) && tags.length > 0) {
        if (!state.data)
            state.data = {};
        state.data.tags = [...(state.data.tags || []), ...tags];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.injectedTags = tags;
    }

    const flowBonus = ActiveFlowState.current?.flow_bonus;
    if (Array.isArray(flowBonus) && flowBonus.length > 0) {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.flow_bonus = [...(state.la_extraData.flow_bonus || []), ...flowBonus];
    }
    return true;
}

/** Flow step: injects the No Bonus Dmg checkbox into the damage HUD. */
async function noBonusDmgInjectStep(state) {
    if (ActiveFlowState.current?._csmNoBonusDmg) {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
    }
    injectNoBonusDmgCheckbox(state);
    return true;
}

/**
 * Wraps rollNormalDamage and rollCritDamage so that when No Bonus Dmg is active,
 * bonus_damage is cleared immediately before each roll step executes.
 */
function wrapRollDamageForNoBonusDmg(flowSteps) {
    for (const stepName of ['rollNormalDamage', 'rollCritDamage']) {
        const orig = flowSteps.get(stepName);
        if (!orig)
            continue;
        flowSteps.set(stepName, async function noBonusDmgWrapped(state) {
            if (ActiveFlowState.current?._csmNoBonusDmg && !state.la_extraData?._csmNoBonusDmg) {
                state.la_extraData = state.la_extraData || {};
                state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
            }
            if (state.la_extraData?._csmNoBonusDmg?.enabled) {
                state.data.bonus_damage = [];
                for (const t of (state.data.damage_hud_data?.targets || [])) {
                    t.bonusDamage = [];
                }
            }
            return orig(state);
        });
    }
}

// Allow 0.5-size tokens instead of Lancer's Math.max(1, size).
// Replaces the Lancer _preCreate and _onRelatedUpdate methods
// so Math.max(1, size) becomes just size, preventing any revert loop.
function patchHalfSizeTokens() {
    const docClass = /** @type {any} */ (CONFIG.Token.documentClass);
    if (!docClass)
        return;

    docClass.prototype._preCreate = async function (...[data, options, user]) {
        const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];
        const self = /** @type {any} */ (this);
        const isLancerActor = LANCER_ACTOR_TYPES.includes(self.actor?.type);
        if (isLancerActor
            && game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !self.getFlag(game.system.id, 'manual_token_size')) {
            const rawSize = self.actor?.system?.size;
            const newSize = typeof rawSize === 'number' && rawSize > 0 ? rawSize : 1;
            /** @type {Record<string, number>} */
            const updates = { width: newSize, height: newSize };
            // Center sub-1 tokens within their grid cell (hex-aware: hex bbox is taller
            // or wider than gs depending on orientation, so the offset isn't symmetric).
            if (newSize < 1 && canvas?.grid) {
                const gs = canvas.grid.size;
                const gt = canvas.grid.type;
                const HEX = 2 / Math.sqrt(3);
                const isPointy = (gt === 2 || gt === 3);
                const isFlat = (gt === 4 || gt === 5);
                const bbW = isFlat ? gs * HEX : gs;
                const bbH = isPointy ? gs * HEX : gs;
                const cc = canvas.grid.getCenterPoint
                    ? canvas.grid.getCenterPoint({ x: self.x + bbW / 2, y: self.y + bbH / 2 })
                    : { x: self.x + gs / 2, y: self.y + gs / 2 };
                updates.x = cc.x - (newSize * bbW) / 2;
                updates.y = cc.y - (newSize * bbH) / 2;
            }
            self.updateSource(updates);
        }
        // Skip Lancer's _preCreate (which has Math.max(1)), call grandparent directly
        const grandparent = /** @type {any} */ (TokenDocument.prototype);
        return grandparent._preCreate.call(this, data, options, user);
    };

    docClass.prototype._onRelatedUpdate = function (update, options) {
        // Call grandparent _onRelatedUpdate (skip Lancer's which has Math.max(1))
        const grandparent = /** @type {any} */ (TokenDocument.prototype);
        grandparent._onRelatedUpdate.call(this, update, options);
        const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];
        const self = /** @type {any} */ (this);
        if (LANCER_ACTOR_TYPES.includes(self.actor?.type)
            && game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !self.getFlag(game.system.id, 'manual_token_size')) {
            const rawSize = self.actor?.system?.size;
            const newSize = typeof rawSize === 'number' && rawSize > 0 ? rawSize : undefined;
            if (self.isOwner && self.id && newSize !== undefined
                && (self.width !== newSize || self.height !== newSize)) {
                self.update({ width: newSize, height: newSize });
            }
        }
    };

    console.log('lancer-automations | Patched token sizing to allow 0.5-size tokens');
}

// Inject Flat Modifier input into the stat roll HUD.
function wrapStatRollFlatModifier(flowSteps) {
    const orig = flowSteps.get('showStatRollHUD');
    if (!orig) {
        return;
    }
    flowSteps.set('showStatRollHUD', async function wrappedShowStatRollHUD(state) {
        if (!state.data) {
            throw new TypeError('Stat roll flow state missing!');
        }
        const bonus = state.data.bonus || 0;
        let flatMod = 0;

        const observer = new MutationObserver(() => {
            const dialog = document.getElementById('hase-accdiff-dialog');
            if (!dialog || dialog.querySelector('.la-stat-flat-mod')) {
                return;
            }
            observer.disconnect();
            flatMod = 0;
            _injectStatFlatModRow(dialog, bonus, (v) => {
                flatMod = v;
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const result = await orig(state);
        observer.disconnect();

        if (result !== false && flatMod !== 0) {
            state.data.bonus = bonus + flatMod;
            const accTotal = state.data.acc_diff?.base?.total || 0;
            const accStr = accTotal !== 0 ? ` + ${accTotal}d6kh1` : '';
            state.data.roll_str = `1d20+${state.data.bonus}${accStr}`;
        }
        return result;
    });
}

// Builds DOM matching the Lancer system's Svelte accdiff-flat-bonus structure.
function _injectStatFlatModRow(dialog, bonus, onChange) {
    // Label: identical to the attack dialog's "Flat Modifier" header.
    const label = document.createElement('label');
    label.className = 'flexrow accdiff-weight lancer-border-primary';
    label.setAttribute('for', 'accdiff-flat-bonus');
    label.textContent = 'Flat Modifier';

    // Container grid: matches accdiff-grid accdiff-flat-bonus.
    const grid = document.createElement('div');
    grid.className = 'la-stat-flat-mod accdiff-grid accdiff-flat-bonus svelte-k5ear2';

    // Left column: "Base: +N"
    const leftCol = document.createElement('div');
    leftCol.className = 'accdiff-other-grid svelte-k5ear2';
    const leftSpan = document.createElement('span');
    leftSpan.className = 'svelte-k5ear2';
    const leftB = document.createElement('b');
    leftB.textContent = 'Base:';
    leftSpan.appendChild(leftB);
    leftSpan.append(` ${bonus >= 0 ? '+' : ''}${bonus}`);
    leftCol.appendChild(leftSpan);

    // Middle column: input + plus/minus buttons
    const midCol = document.createElement('div');
    midCol.className = 'accdiff-other-grid accdiff-flat-mod svelte-k5ear2';
    midCol.style.position = 'relative';
    const input = document.createElement('input');
    input.className = 'accdiff-flat-mod__input svelte-k5ear2';
    input.type = 'number';
    input.value = '0';
    const plusBtn = document.createElement('button');
    plusBtn.className = 'accdiff-flat-mod__plus svelte-k5ear2';
    plusBtn.type = 'button';
    plusBtn.innerHTML = '<i class="fas fa-plus svelte-k5ear2"></i>';
    const minusBtn = document.createElement('button');
    minusBtn.className = 'accdiff-flat-mod__minus svelte-k5ear2';
    minusBtn.type = 'button';
    minusBtn.innerHTML = '<i class="fas fa-minus svelte-k5ear2"></i>';
    midCol.append(input, plusBtn, minusBtn);

    // Right column: "Total: +N"
    const rightCol = document.createElement('div');
    rightCol.className = 'accdiff-other-grid svelte-k5ear2';
    const rightSpan = document.createElement('span');
    rightSpan.className = 'svelte-k5ear2';
    const rightB = document.createElement('b');
    rightB.textContent = 'Total:';
    rightSpan.appendChild(rightB);
    rightSpan.append(' ');
    const totalText = document.createTextNode(`${bonus >= 0 ? '+' : ''}${bonus}`);
    rightSpan.appendChild(totalText);
    rightCol.appendChild(rightSpan);

    grid.append(leftCol, midCol, rightCol);

    // Insert before the first child of the dialog (same position as attack HUD).
    dialog.prepend(grid);
    dialog.prepend(label);

    const update = () => {
        const v = Number(input.value) || 0;
        onChange(v);
        const total = bonus + v;
        totalText.textContent = (total >= 0 ? '+' : '') + total;
    };
    input.addEventListener('input', update);
    plusBtn.addEventListener('click', () => {
        input.value = String((Number(input.value) || 0) + 1);
        update();
    });
    minusBtn.addEventListener('click', () => {
        input.value = String((Number(input.value) || 0) - 1);
        update();
    });
}

function wrapRollReliable(flowSteps) {
    const origRollReliable = flowSteps.get('rollReliable');
    if (!origRollReliable)
        return;

    flowSteps.set('rollReliable', async function wrappedRollReliable(state) {
        const result = await origRollReliable(state);
        if (result === false && state.data?._csmKnockback?.enabled) {
            // No damage configured but knockback is pending; let the flow continue
            return true;
        }
        return result;
    });
}

function wrapApplySelfHeat(flowSteps) {
    const origApplySelfHeat = flowSteps.get('applySelfHeat');
    if (!origApplySelfHeat)
        return;

    flowSteps.set('applySelfHeat', async function wrappedApplySelfHeat(state, options) {
        const actor = /** @type {Actor}*/(state.actor);
        // Only intercept when there's self_heat to process
        if (!actor || !state.data?.self_heat) {
            return origApplySelfHeat(state, options);
        }

        // --- Heat Immunity check (lancer-automations bonus system) ---
        const heatImmune = getImmunityBonuses(actor, "damage")
            .some(b => b.damageTypes?.some(t => ['heat', 'all'].includes(t.toLowerCase())));

        if (heatImmune) {
            // Zero out self_heat so original step skips the roll and applies 0
            const savedSelfHeat = state.data.self_heat;
            state.data.self_heat = undefined;
            const result = await origApplySelfHeat(state, options);
            state.data.self_heat = savedSelfHeat; // restore for chat card
            return result;
        }

        // --- Heat Resistance check (native OR lancer-automations bonus) ---
        const isShredded = actor.system.statuses?.shredded;
        const hasResistance = !isShredded && (
            actor.system.resistances?.heat ||
            checkDamageResistances(actor, "heat").length > 0
        );

        if (hasResistance) {
            // Roll the self_heat ourselves, halve (floor), apply the halved value
            const roll = await new Roll(state.data.self_heat).evaluate();
            const halved = Math.floor(roll.total / 2);
            state.data.self_heat_result = { roll, tt: await roll.getTooltip() };

            const automationSettings = game.settings.get(game.system.id, "automationOptions");
            if (automationSettings?.attack_self_heat && (actor.is_mech() || actor.is_npc())) {
                await actor.update(/** @type {any}*/({
                    "system.heat.value": actor.system.heat.value + (state.data.overkill_heat ?? 0) + halved
                }));
            }

            // Zero out both so original step applies nothing further
            const savedSelfHeat = state.data.self_heat;
            const savedOverkillHeat = state.data.overkill_heat;
            state.data.self_heat = undefined;
            state.data.overkill_heat = 0;
            const result = await origApplySelfHeat(state, options);
            state.data.self_heat = savedSelfHeat;      // restore for chat card
            state.data.overkill_heat = savedOverkillHeat;
            return result;
        }

        return origApplySelfHeat(state, options);
    });
}

// ─── Extra-action recharge ──────────────────────────────────────────────────
// Extra actions (from addExtraActions) that carry `recharge: N, charged: bool`
// are processed by Lancer's NPCRechargeFlow using the same d6 roll.
function wrapExtraActionRecharge(flowSteps, flows) {
    // (a) Wrap findRechargeableSystems so the flow doesn't abort when only
    //     extra actions need recharging (no native tg_recharge items).
    const origFind = flowSteps.get('findRechargeableSystems');
    if (origFind) {
        flowSteps.set('findRechargeableSystems', async function wrappedFindRechargeableSystems(state) {
            const result = await origFind.call(this, state);

            let hasExtraRechargeables = false;
            for (const item of state.actor.items) {
                const ea = item.getFlag('lancer-automations', 'extraActions') || [];
                if (ea.some(a => a.recharge && a.charged === false)) {
                    hasExtraRechargeables = true; break;
                }
            }
            if (!hasExtraRechargeables) {
                const actorEa = state.actor.getFlag('lancer-automations', 'extraActions') || [];
                if (actorEa.some(a => a.recharge && a.charged === false))
                    hasExtraRechargeables = true;
            }
            if (hasExtraRechargeables) {
                state.data.la_hasExtraRechargeables = true;
                return true;
            }
            return result;
        });
    }

    // (b) After Lancer applies native recharges, apply the same roll to extra actions.
    flowSteps.set('lancer-automations:rechargeExtraActions', async function rechargeExtraActions(state) {
        if (!state.data?.la_hasExtraRechargeables)
            return true;
        if (!state.data?.result?.roll)
            return true;
        const rollTotal = state.data.result.roll.total;

        for (const item of state.actor.items) {
            const extraActions = item.getFlag('lancer-automations', 'extraActions') || [];
            let changed = false;
            for (const action of extraActions) {
                if (action.recharge && action.charged === false) {
                    const recharged = rollTotal >= action.recharge;
                    action.charged = recharged;
                    state.data.charged.push({ name: action.name, target: action.recharge, charged: recharged });
                    changed = true;
                }
            }
            if (changed)
                await item.setFlag('lancer-automations', 'extraActions', extraActions);
        }
        const actorActions = state.actor.getFlag('lancer-automations', 'extraActions') || [];
        let actorChanged = false;
        for (const action of actorActions) {
            if (action.recharge && action.charged === false) {
                const recharged = rollTotal >= action.recharge;
                action.charged = recharged;
                state.data.charged.push({ name: action.name, target: action.recharge, charged: recharged });
                actorChanged = true;
            }
        }
        if (actorChanged)
            await state.actor.setFlag('lancer-automations', 'extraActions', actorActions);
        return true;
    });
    flows.get('NPCRechargeFlow')?.insertStepAfter('applyRecharge', 'lancer-automations:rechargeExtraActions');

    // (c) Block activation of uncharged extra actions (mirrors Lancer's own
    //     recharge check but for extra actions on SimpleActivationFlow).
    flowSteps.set('lancer-automations:checkExtraActionRecharge', async function checkExtraActionRecharge(state) {
        const action = state.data?.action;
        if (action?.recharge && action?.charged === false) {
            ui.notifications.warn(`${action.name} has not recharged! (Recharge ${action.recharge}+)`);
            return false;
        }
        return true;
    });
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', 'lancer-automations:checkExtraActionRecharge');
}

function insertModuleFlowSteps(flowSteps, flows) {
    flowSteps.set('lancer-automations:onAttack', onAttackStep);
    flowSteps.set('lancer-automations:onHitMiss', onHitMissStep);
    flowSteps.set('lancer-automations:onDamage', onDamageStep);
    flowSteps.set('lancer-automations:onPreStructure', onPreStructureStep);
    flowSteps.set('lancer-automations:onStructure', onStructureStep);
    flowSteps.set('lancer-automations:onPreStress', onPreStressStep);
    flowSteps.set('lancer-automations:onStress', onStressStep);
    flowSteps.set('lancer-automations:onTechAttack', onTechAttackStep);
    flowSteps.set('lancer-automations:onTechHitMiss', onTechHitMissStep);
    flowSteps.set('lancer-automations:onCheck', onCheckStep);
    flowSteps.set('lancer-automations:onActivation', onActivationStep);
    flowSteps.set('lancer-automations:onInitActivation', onInitActivationStep);
    flowSteps.set('lancer-automations:onInitCheck', onInitCheckStep);
    flowSteps.set('lancer-automations:stunnedAutoFail', stunnedAutoFailStep);
    flowSteps.set('lancer-automations:onInitAttack', onInitAttackStep);
    flowSteps.set('lancer-automations:onInitTechAttack', onInitTechAttackStep);
    // Register Knockback steps
    flowSteps.set('lancer-automations:knockbackInject', knockbackInjectStep);
    flowSteps.set('lancer-automations:knockbackDamage', knockbackDamageStep);
    // Register range injection steps (two IDs, same function: one fires before showAttackHUD,
    // one fires before printAttackCard; each self-destructs after its single use)
    // Register No Bonus Dmg steps
    flowSteps.set('lancer-automations:noBonusDmgInject', noBonusDmgInjectStep);
    // Pull tags injected on the source basic attack into the damage flow
    flowSteps.set('lancer-automations:pullInjectedTagsFromAttack', pullInjectedTagsFromAttack);
    // After printAttackCard, expose a synthetic item so Lancer Weapon FX (and similar)
    // can identify itemless basic attacks (Ram, etc.) by name.
    flowSteps.set('lancer-automations:stubBasicAttackItemForFx', playInlineAttackFX);
    flowSteps.set('lancer-automations:playThrowFXIfNeeded', playThrowFXIfNeeded);
    // Register Throw steps
    flowSteps.set('lancer-automations:throwChoice', throwChoiceStep);
    flowSteps.set('lancer-automations:throwDeploy', throwDeployStep);

    // Register generic accuracy steps
    flowSteps.set('lancer-automations:genericAccuracyStepAttack', genericAccuracyStepAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepTechAttack', genericAccuracyStepTechAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepWeaponAttack', genericAccuracyStepWeaponAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepStatRoll', genericAccuracyStepStatRoll);
    flowSteps.set('lancer-automations:genericBonusStepDamage', genericBonusStepDamage);

    // Register new targeting step
    flowSteps.set('lancer-automations:statRollTargetSelect', statRollTargetSelectStep);

    flowSteps.set('lancer-automations:forceTechHUD', forceTechHUDStep);

    flows.get('BasicAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepTechAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:forceTechHUD');
    flows.get('WeaponAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepWeaponAttack');

    // Insert onInitAttack/TechAttack steps
    flows.get('BasicAttackFlow')?.insertStepAfter('initAttackData', 'lancer-automations:onInitAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('initAttackData', 'lancer-automations:onInitAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('initTechAttackData', 'lancer-automations:onInitTechAttack');

    // Insert targeting step BEFORE HUD
    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:statRollTargetSelect');
    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:genericAccuracyStepStatRoll');

    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:genericBonusStepDamage');

    flows.get('WeaponAttackFlow')?.insertStepBefore('initAttackData', 'lancer-automations:throwChoice');
    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('WeaponAttackFlow')?.insertStepAfter('lancer-automations:onHitMiss', 'lancer-automations:throwDeploy');

    flows.get('BasicAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('BasicAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('BasicAttackFlow')?.insertStepAfter('printAttackCard', 'lancer-automations:stubBasicAttackItemForFx');
    flows.get('BasicAttackFlow')?.insertStepAfter('lancer-automations:stubBasicAttackItemForFx', 'lancer-automations:playThrowFXIfNeeded');
    flows.get('WeaponAttackFlow')?.insertStepAfter('printAttackCard', 'lancer-automations:playThrowFXIfNeeded');

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onTechHitMiss');

    // DamageRollFlow runs either rollNormalDamage OR rollCritDamage depending on crit state;
    // onDamage/knockbackDamage must sit after whichever one actually ran.
    const damageFlow = flows.get('DamageRollFlow');
    if (damageFlow?.steps) {
        const critIdx = damageFlow.steps.indexOf('rollCritDamage');
        const normIdx = damageFlow.steps.indexOf('rollNormalDamage');
        const anchorIdx = Math.max(critIdx, normIdx);
        if (anchorIdx >= 0) {
            damageFlow.steps.splice(anchorIdx + 1, 0, 'lancer-automations:onDamage', 'lancer-automations:knockbackDamage');
        }
    }
    flows.get('DamageRollFlow')?.insertStepBefore('setDamageTags', 'lancer-automations:pullInjectedTagsFromAttack');
    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:knockbackInject');
    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:noBonusDmgInject');

    // Flat Modifier input on stat roll HUD
    wrapStatRollFlatModifier(flowSteps);

    // Wrap rollReliable so knockback-only flows (no damage dice) don't abort
    wrapRollReliable(flowSteps);
    // Wrap rollNormalDamage/rollCritDamage to suppress bonus damage when No Bonus Dmg is active
    wrapRollDamageForNoBonusDmg(flowSteps);

    // Wrap applySelfHeat to honour heat immunity and resistance
    wrapApplySelfHeat(flowSteps);

    // Fix tech attack title override (Fragment Signal)
    wrapInitTechAttackData(flowSteps);
    // Preserve caller-supplied title/action/effect on basic attacks (Ram, etc.)
    wrapInitAttackData(flowSteps);

    // Extra-action recharge system (piggybacks on NPC recharge flow)
    wrapExtraActionRecharge(flowSteps, flows);

    flows.get('StructureFlow')?.insertStepBefore('preStructureRollChecks', 'lancer-automations:onPreStructure');
    flows.get('StructureFlow')?.insertStepAfter('rollStructureTable', 'lancer-automations:onStructure');
    flows.get('OverheatFlow')?.insertStepBefore('preOverheatRollChecks', 'lancer-automations:onPreStress');
    flows.get('OverheatFlow')?.insertStepAfter('rollOverheatTable', 'lancer-automations:onStress');

    flows.get('StatRollFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepStatRoll', 'lancer-automations:onInitCheck');
    flows.get('StatRollFlow')?.insertStepBefore('rollCheck', 'lancer-automations:stunnedAutoFail');
    flows.get('StatRollFlow')?.insertStepAfter('rollCheck', 'lancer-automations:onCheck');

    flows.get('ActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SystemFlow')?.insertStepAfter('printSystemCard', 'lancer-automations:onActivation');
    flows.get('TalentFlow')?.insertStepAfter('printTalentCard', 'lancer-automations:onActivation');
    flows.get('CoreActiveFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('OverchargeFlow')?.insertStepAfter('printOverchargeCard', 'lancer-automations:onActivation');
    flows.get('StabilizeFlow')?.insertStepAfter('printStabilizeResult', 'lancer-automations:onActivation');

    // Insert onInitActivation before resource consumption (applySelfHeat) in flows that consume resources.
    // For TalentFlow and SimpleActivationFlow there is no consumption step, so insert before the print step.
    flows.get('ActivationFlow')?.insertStepAfter('initActivationData', 'lancer-automations:onInitActivation');
    flows.get('CoreActiveFlow')?.insertStepAfter('initActivationData', 'lancer-automations:onInitActivation');
    flows.get('SystemFlow')?.insertStepAfter('initSystemUseData', 'lancer-automations:onInitActivation');
    flows.get('TalentFlow')?.insertStepAfter('printTalentCard', 'lancer-automations:onInitActivation');
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', 'lancer-automations:onInitActivation');
    // OverchargeFlow / StabilizeFlow have no init step; insert at the start so they're cancellable.
    flows.get('OverchargeFlow')?.insertStepBefore('initOverchargeData', 'lancer-automations:onInitActivation');
    flows.get('StabilizeFlow')?.insertStepBefore('initializeStabilize', 'lancer-automations:onInitActivation');

}

function openResetMovementDialog(token) {
    if (!token)
        return;
    new Dialog({
        title: `Movement History: ${token.name}`,
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">Movement History</h2>
                <p class="lancer-dialog-subtitle">${token.name}</p>
            </div>
            <div class="form-group">
                <p>What would you like to do with the movement history?</p>
            </div>
        `,
        buttons: {
            revertOne: {
                icon: '<i class="fas fa-step-backward"></i>',
                label: "Revert Last Move",
                callback: () => revertMovement(token)
            },
            clear: {
                icon: '<i class="fas fa-trash"></i>',
                label: "Reset History",
                callback: () => clearMovementHistory(token, false)
            },
            ...(game.modules.get('elevationruler')?.active
                && game.settings.get('elevationruler', 'token-ruler-combat-history')
                ? {
                    revert: {
                        icon: '<i class="fas fa-undo-alt"></i>',
                        label: "Reset & Revert All",
                        callback: () => clearMovementHistory(token, true)
                    },
                } : {}),
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "clear"
    }, {
        classes: ["lancer-dialog-base", "lancer-no-title"],
        width: 400,
        height: 300
    }).render(true);
}

Hooks.on('init', () => {
    console.log('lancer-automations | Init');
    registerSettings();
    registerStatusFXSettings(); // StatusFX settings + config menu
    registerSettingsMenus(); // Grouped Activations / Combat / Deployables menus
    registerTourBootstrap();
    registerTokenStatBarSettings(); // Custom token stat bar (standalone setting)
    registerFlowStatePersistence();
    initVisionFromEdge(); // Lancer-style vision: spawn perimeter vision sources for flagged tokens
    initTokenBlocksVision(); // Per-token "Blocks Line of Sight" flag + Bulwark status auto-blocking
    injectDisabledSchemaField(); // Add system.disabled field to item schemas
    injectDisabledCSS(); // Item Disabled system
    injectInfectionSchemaField(); // Add system.infection field to actor schemas
    if (game.settings.get('lancer-automations', 'enableInfectionDamageIntegration')) {
        injectInfectionDamageType(); // Add "Infection" to DamageField choices
        injectInfectionCSS(); // Infection damage icon + color
    }
    patchStatRollCardTemplate();

    if (game.modules.get("elevationruler")?.active) {
        Hooks.once("ready", () => {
            const MovePenalty = game.modules.get("elevationruler")?.api?.MovePenalty;
            if (!MovePenalty)
                return;
            CONFIG.elevationruler.MovePenalty = MovePenalty;

            /**
             * @param {string} name
             * @param {(base: (token: any) => boolean) => (token: any) => boolean} build
             */
            const wrap = (name, build) => {
                if (typeof MovePenalty[name] !== "function")
                    return;
                const base = MovePenalty[name].bind(MovePenalty);
                MovePenalty[name] = build(base);
            };

            wrap("isFlying", base => function(token) {
                if (base(token))
                    return true;
                if (token?.actor?.statuses?.has("flying"))
                    return true;
                if (token?.actor?.statuses?.has("hover"))
                    return true;
                return false;
            });

            if (typeof MovePenalty.getFlyingStep === "function") {
                MovePenalty.getFlyingStep = function(token) {
                    const speed = token?.actor?.system?.speed ?? 0;
                    if (speed <= 0)
                        return 0;
                    const perCell = canvas?.grid?.distance ?? 1;
                    return speed * perCell;
                };
            }

            wrap("isClimbingImmune", base => function(token) {
                if (base(token))
                    return true;
                if (token?.actor?.statuses?.has("climber"))
                    return true;
                if (getImmunityBonuses(token?.actor, "elevation").length > 0)
                    return true;
                return false;
            });

            wrap("isTerrainImmune", base => function(token) {
                if (base(token))
                    return true;
                if (token?.actor?.statuses?.has("terrain_immunity"))
                    return true;
                if (token?.actor?.statuses?.has("surefoot"))
                    return true;
                if (getImmunityBonuses(token?.actor, "terrain").length > 0)
                    return true;
                return false;
            });
        });
    }


    game.keybindings.register('lancer-automations', 'resetMovement', {
        name: 'Reset Movement',
        hint: 'Open the movement history reset dialog for the selected token.',
        editable: [{ key: 'KeyR' }],
        onDown: () => {
            const token = canvas.tokens?.controlled[0];
            if (!token) {
                ui.notifications.warn('Please select a token first.');
                return;
            }
            openResetMovementDialog(token);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
});

Hooks.on("lancer.registerFlows", (flowSteps, flows) => {
    registerModuleFlows(flowSteps, flows);
    insertModuleFlowSteps(flowSteps, flows);
    registerAltStructFlowSteps(flowSteps, flows);
    registerDisabledFlowSteps(flowSteps, flows); // Item Disabled system
    registerPermanentStatusFlowSteps(flowSteps, flows); // Permanent statuses survive Full Repair
    registerMeleeCoverFix(flowSteps, flows);
    registerUseAmmoFlow(flowSteps, flows); // Ammo flow
    registerInfectionFlows(flowSteps, flows); // Infection flow + stabilize/repair clearing
    registerRerollFlowSteps(flowSteps, flows); // onRoll trigger + reroll/changeRoll
});

async function _consumeFlowAction(flow, success) {
    if (!success)
        return;
    if (!game.settings.get('lancer-automations', 'consumeAction'))
        return;
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    const label = _flowResolveActivationLabel(flow);
    if (label === 'Quick' || label === 'Quick Tech' || label === 'Invade')
        await consumeAction(token, 'quick');
    else if (label === 'Full' || label === 'Full Tech')
        await consumeAction(token, 'full');
}
Hooks.on('lancer.postFlow.ActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SystemFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TechAttackFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SimpleActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.CoreActiveFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TalentFlow', _consumeFlowAction);

// Workaround for `lancer-alternative-sheets` reading prototypeToken on null compendium actors.
function patchFromUuidSyncForCompendiumActors() {
    if (typeof globalThis.fromUuidSync !== 'function')
        return;
    const orig = /** @type {any} */ (globalThis.fromUuidSync);
    if (orig._laCompendiumPatched)
        return;
    const patched = function (uuid, ...rest) {
        const r = orig.call(this, uuid, ...rest);
        if (r || typeof uuid !== 'string' || !/^Actor\.[A-Za-z0-9]+$/.test(uuid))
            return r;
        const id = uuid.split('.').pop();
        for (const pack of game.packs?.filter(p => p.documentName === 'Actor') ?? []) {
            const doc = pack.get?.(id);
            if (doc) return doc;
        }
        return r;
    };
    patched._laCompendiumPatched = true;
    globalThis.fromUuidSync = patched;
}

Hooks.once('ready', async () => {
    installJb2aHooks();
    initAltStructReady();
    patchFromUuidSyncForCompendiumActors();

    if (game.settings.get('lancer-automations', 'treatGenericPrintAsActivation')) {
        const flows = game.lancer?.flows;
        flows?.get('SimpleHTMLFlow')?.insertStepAfter('printGenericHTML', 'lancer-automations:onActivation');
        flows?.get('SendUnknownToChat')?.insertStepAfter('printFeatureCard', 'lancer-automations:onActivation');
    }

    if (game.user.isGM) {
        for (const tokenDoc of game.scenes.active?.tokens ?? []) {
            const actor = tokenDoc.actor;
            if (!actor)
                continue;
        }
    }

    initCollapseHook();

    // Scale down token vision radius during drag if the multiplier is configured
    if (typeof libWrapper !== 'undefined') {
        // Intercept currentProfile() and rangesFor() to apply persistent range bonuses from actor flags.
        // Uses isBonusApplicable for proper rollType / condition / itemLid filtering.
        const _ATTACK_TAGS = new Set(['all', 'attack']);

        /** Returns applicable range bonuses for the given item, or null if none. */
        function _getRangeBonuses(item) {
            const actor = item.parent;
            if (!actor)
                return null;
            const state = { actor, item, data: {} };
            const bonuses = [
                ...flattenBonuses(actor.getFlag('lancer-automations', 'global_bonuses')),
                ...(actor.getFlag('lancer-automations', 'constant_bonuses') ?? [])
            ].filter(b => b?.type === 'range' && isBonusApplicable(b, _ATTACK_TAGS, state));
            return bonuses.length ? bonuses : null;
        }

        /** Applies a list of range bonuses to a cloned range array and returns it. */
        function _applyRangeBonusesToArray(baseRange, bonuses) {
            const range = baseRange.map(r => Object.assign(Object.create(Object.getPrototypeOf(r)), r));
            for (const bonus of bonuses) {
                const rangeType = bonus.rangeType;
                const rangeMode = bonus.rangeMode || 'add';
                const isOverride = rangeMode === 'override';
                const isChange = rangeMode === 'change';
                const val = Number.parseInt(bonus.val) || 0;
                if (isChange) {
                    const RangeClass = range[0]?.constructor;
                    range.length = 0;
                    if (RangeClass && RangeClass !== Object) {
                        range.push(new RangeClass({ type: rangeType, val }));
                    } else {
                        range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
                    }
                } else {
                    const existingIdx = range.findIndex(r => r.type === rangeType);
                    if (existingIdx !== -1) {
                        const entry = range[existingIdx];
                        entry.val = isOverride ? val : (Number.parseInt(entry.val) || 0) + val;
                    } else {
                        const RangeClass = range[0]?.constructor;
                        if (RangeClass && RangeClass !== Object) {
                            range.push(new RangeClass({ type: rangeType, val }));
                        } else {
                            range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
                        }
                    }
                }
            }
            return range;
        }

        libWrapper.register('lancer-automations', 'CONFIG.Item.documentClass.prototype.currentProfile',
            function(wrapped) {
                const result = wrapped.call(this);
                const bonuses = _getRangeBonuses(this);
                if (!bonuses)
                    return result;
                result.range = _applyRangeBonusesToArray(result.range, bonuses);
                return result;
            }, 'WRAPPER');

        // rangesFor() is used by the attack HUD to find Blast/Burst/Cone/Line template buttons.
        // Delegates to currentProfile() (already wrapped) so bonuses are reflected there too.
        // Uses MIXED because we conditionally bypass the original when bonuses are present.
        libWrapper.register('lancer-automations', 'CONFIG.Item.documentClass.prototype.rangesFor',
            function(wrapped, types) {
                if (!_getRangeBonuses(this))
                    return wrapped.call(this, types);
                const filter = new Set(types);
                return this.currentProfile().range.filter(r => filter.has(r.type));
            }, 'MIXED');

        libWrapper.register('lancer-automations', 'Token.prototype._getVisionSourceData',
            function (wrapped, ...args) {
                const data = wrapped(...args);
                if (this.isPreview) {
                    const value = game.settings.get('lancer-automations', 'dragVisionMultiplier');
                    let mode = 'ratio';
                    try {
                        mode = game.settings.get('lancer-automations', 'dragVisionMode');
                    } catch (e) {
                        mode = 'ratio';
                    }
                    if (mode === 'flat' && value > 0) {
                        const px = this.getLightRadius(value);
                        data.radius = Math.min(data.radius, px);
                        data.lightRadius = Math.min(data.lightRadius, px);
                    } else if (value < 1) {
                        data.radius *= value;
                        data.lightRadius *= value;
                    }
                }
                return data;
            }, 'WRAPPER');

        // Suppress lwfx's default per-weapon FX when LA already played an inline
        // one for this attack (Ram / Grapple / throw).
        libWrapper.register('lancer-automations', 'Macro.prototype.execute',
            function (wrapped, ...args) {
                try {
                    const flowInfo = this.getFlag?.('lancer-weapon-fx', 'flowInfo');
                    if (flowInfo) {
                        const id = _actorSuppressId(flowInfo.sourceToken)
                            ?? _actorSuppressId(flowInfo.sourceToken?.document);
                        if (id && _lwfxSuppressActors.has(id)) {
                            _lwfxSuppressActors.delete(id);
                            return;
                        }
                    }
                } catch { /* fall through */ }
                return wrapped.call(this, ...args);
            }, 'MIXED');
    }
});

// After each scene load (including page reload), force-refresh all token effects so
// the collapse wrapper runs even if tokens were drawn before our hook was registered.
Hooks.on('canvasReady', () => {
    canvas.tokens?.placeables.forEach(t => t.renderFlags?.set({ refreshEffects: true }));

    // Set up deployable connection lines graphic
    if (deployableConnectionsGraphic && !deployableConnectionsGraphic.destroyed) {
        deployableConnectionsGraphic.destroy();
    }
    deployableConnectionsGraphic = new PIXI.Graphics();
    // Add to the background or tokens layer so it appears under/over tokens appropriately
    if (canvas.tokens) {
        canvas.tokens.addChild(deployableConnectionsGraphic);
    }
});

function _redrawHoverConnections() {
    if (!deployableConnectionsGraphic || deployableConnectionsGraphic.destroyed)
        return;
    deployableConnectionsGraphic.clear();
    const token = _hoverConnectionToken;
    if (!token)
        return;
    if (!token.actor?.isOwner)
        return;
    if (!game.settings.get('lancer-automations', 'showDeployableLines'))
        return;
    const sourceUuid = token.actor?.uuid;
    if (!sourceUuid)
        return;

    const ownerUuidFlag = token.document.getFlag('lancer-automations', 'ownerActorUuid');
    deployableConnectionsGraphic.lineStyle(2, 0xffd700, 0.6);
    if (ownerUuidFlag) {
        const ownerToken = canvas.tokens.placeables.find(t => t.actor?.uuid === ownerUuidFlag);
        if (ownerToken)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, ownerToken.center.x, ownerToken.center.y, 8, 14, _dashOffset);
    } else {
        const deployables = canvas.tokens.placeables.filter(t =>
            t.document.getFlag('lancer-automations', 'ownerActorUuid') === sourceUuid
        );
        for (const dep of deployables)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, dep.center.x, dep.center.y, 8, 14, _dashOffset);
    }

    const partnerUuids = [];
    const actor = token.actor;
    const pilotUuid = actor?.system?.pilot?.value?.uuid;
    const activeMechUuid = actor?.system?.active_mech?.value?.uuid;
    if (actor?.type === 'mech' && pilotUuid)
        partnerUuids.push(pilotUuid);
    if (actor?.type === 'pilot' && activeMechUuid)
        partnerUuids.push(activeMechUuid);
    if (partnerUuids.length)
        deployableConnectionsGraphic.lineStyle(2, 0x4caf50, 0.6);
    for (const uuid of partnerUuids) {
        const partner = canvas.tokens.placeables.find(t => t.actor?.uuid === uuid);
        if (partner)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, partner.center.x, partner.center.y, 8, 14, _dashOffset);
    }
}

Hooks.on('hoverToken', (token, hovered) => {
    _hoverConnectionToken = hovered ? token : null;
    _redrawHoverConnections();
    if (_hoverConnectionToken && !_hoverConnectionTicker) {
        _hoverConnectionTicker = () => {
            _dashOffset = (_dashOffset - 0.25) % 1000;
            _redrawHoverConnections();
        };
        canvas.app?.ticker?.add(_hoverConnectionTicker);
    } else if (!_hoverConnectionToken && _hoverConnectionTicker) {
        canvas.app?.ticker?.remove(_hoverConnectionTicker);
        _hoverConnectionTicker = null;
    }
});

// Clear deployable connection lines if a token is deleted (e.g. destroyed while hovering)
Hooks.on('deleteToken', () => {
    if (deployableConnectionsGraphic && !deployableConnectionsGraphic.destroyed) {
        deployableConnectionsGraphic.clear();
    }
});

Hooks.on('lancer.statusesReady', () => {
    // Always register infection; it's needed by the StatusFX auto-status logic
    // even when the broader additionalStatuses pack is disabled.
    if (!CONFIG.statusEffects.find(s => s.id === 'infection')) {
        CONFIG.statusEffects.push({
            id: "infection",
            name: "Infection",
            img: "modules/lancer-automations/icons/infection.svg",
            description: "Like Burn, but applies Heat instead of damage. Characters immediately take Heat equal to the Infection received, and the value stacks if Infection is already present. At the end of their turn, they roll a Systems check: on success they clear all Infection, otherwise they take Heat equal to the current Infection. Anything that clears Burn (e.g. Stabilize) also clears Infection."
        });
    }

    if (!CONFIG.statusEffects.find(s => s.id === 'guardian')) {
        CONFIG.statusEffects.push({
            id: "guardian",
            name: "Guardian",
            img: "modules/lancer-automations/icons/guarded-tower.svg",
            description: "Allied characters adjacent to this character can use them as hard cover."
        });
    }

    if (!CONFIG.statusEffects.find(s => s.id === 'bulwark')) {
        CONFIG.statusEffects.push({
            id: "bulwark",
            name: "Bulwark",
            img: "modules/lancer-automations/icons/brick-wall.svg",
            description: "This character is treated as hard cover and blocks line of sight."
        });
    }

    // Register QoL status effects if csm-lancer-qol module is not active.
    // These effects are normally provided by csm-lancer-qol; we add them as a fallback
    // so users without that module still get them. Skips any that already exist.
    if (!game.modules.get('csm-lancer-qol')?.active) {
        const qolStatusEffects = [
            { id: "dangerzone", name: "Danger Zone", img: "systems/lancer/assets/icons/white/status_dangerzone.svg" },
            { id: "burn", name: "Burn", img: "icons/svg/fire.svg" },
            { id: "overshield", name: "Overshield", img: "icons/svg/circle.svg" },
            { id: "engaged", name: "Engaged", img: "systems/lancer/assets/icons/white/status_engaged.svg" },
            { id: "cascading", name: "Cascading", img: "icons/svg/paralysis.svg" },
            { id: "bolster", name: "Bolstered", img: "systems/lancer/assets/icons/white/accuracy.svg" },
            { id: "mia", name: "M.I.A.", img: "modules/lancer-automations/icons/mia_lg.svg" }
        ];
        for (const eff of qolStatusEffects) {
            if (!CONFIG.statusEffects.find(s => s.id === eff.id)) {
                CONFIG.statusEffects.push(eff);
            }
        }
    }

    if (!game.settings.get('lancer-automations', 'additionalStatuses'))
        return;

    CONFIG.statusEffects.push({
        id: "resistance_all",
        name: "Resist All",
        img: "modules/lancer-automations/icons/resist_all.svg",
        changes: /** @type {any[]} */ ([
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.infection", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ])
    }, {
        id: "immovable",
        name: "Immovable",
        img: "modules/lancer-automations/icons/immovable.svg",
        description: "Cannot be moved"
    }, {
        id: "disengage",
        name: "Disengage",
        img: "modules/lancer-automations/icons/disengage.svg",
        description: "You ignore engagement and your movement does not provoke reactions"
    }, {
        id: "destroyed",
        name: "Destroyed",
        img: "modules/lancer-automations/icons/destroyed.svg",
        description: "You are destroyed"
    }, {
        id: "grappling",
        name: "Grappling",
        img: "modules/lancer-automations/icons/grappling.svg",
        description: "You are grappling in a grapple contest",
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "grappled",
        name: "Grappled",
        img: "modules/lancer-automations/icons/grappled.svg",
        description: "You are grappled in a grapple contest",
        changes: /** @type {any[]} */ ([
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ])
    }, {
        id: "falling",
        name: "Falling",
        img: "modules/lancer-automations/icons/falling.svg",
        description: "Characters take damage when they fall 3 or more spaces and cannot recover before hitting the ground. Characters fall 10 spaces per round in normal gravity, but can't fall in zero-G or very low-G environments. They take 3 Kinetic AP (armour piercing) damage for every three spaces fallen, to a maximum of 9 Kinetic AP. Falling is a type of involuntary movement."
    }, {
        id: "throttled",
        name: "Throttled",
        img: "modules/lancer-automations/icons/throttled.svg",
        description: "Deals Half damage, heat, and burn on attacks"
    }, {
        id: "blinded",
        name: "Blinded",
        img: "modules/lancer-automations/icons/blinded.svg",
        description: "Light of sight reduced to 1"
    }, {
        id: "climber",
        name: "Climber",
        img: "modules/lancer-automations/icons/mountain-climbing.svg",
        description: "You ignore effect of climbing terrain"
    }, {
        id: "hover",
        name: "Hover",
        img: "modules/lancer-automations/icons/hover.svg",
        description: "You hover above the ground: same movement rules as Flying."
    }, {
        id: "terrain_immunity",
        name: "Terrain Immunity",
        img: "modules/lancer-automations/icons/metal-boot.svg",
        description: "You ignore difficult and dangerous terrain"
    }, {
        id: "surefoot",
        name: "Surefoot",
        img: "modules/lancer-automations/icons/running-shoe.svg",
        description: "You ignore difficult terrain. Dangerous terrain still applies."
    }, {
        id: "reactor_meltdown",
        name: "Reactor Meltdown",
        img: "modules/lancer-automations/icons/mushroom-cloud.svg",
        description: "You are in a reactor meltdown"
    },
    {
        id: "aided",
        name: "Aided",
        img: "modules/lancer-automations/icons/health-capsule.svg",
        description: "You can Stabilize as a quick action"
    },
    {
        id: "brace",
        name: "Brace",
        img: "modules/lancer-automations/icons/brace.svg",
        changes: /** @type {any[]} */ ([
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.infection", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ])
    });

    // Dazed: only add if not already registered (e.g. by a status compendium)
    if (!CONFIG.statusEffects.find(s => s.id === 'dazed')) {
        CONFIG.statusEffects.push({
            id: "dazed",
            name: "Dazed",
            img: "modules/lancer-automations/icons/dazed.svg",
            description: "DAZED mechs can only take one quick action \u2013 they cannot OVERCHARGE, move normally, nor take full actions, reactions, or free actions."
        });
    }
});

const userHelpers = new Map();

function registerUserHelper(name, fn) {
    if (typeof fn !== 'function') {
        console.warn(`lancer-automations | registerUserHelper: "${name}" is not a function.`);
        return;
    }
    userHelpers.set(name, fn);
}

function getUserHelper(name) {
    return userHelpers.get(name) ?? null;
}

// Built-in startup scripts (pre-populated into the Startup tab on first load)
const builtinStartups = [];

function registerBuiltinStartup(entry) {
    builtinStartups.push(entry);
}

async function syncBuiltinStartups() {
    ReactionManager.builtinStartups = [];
    let persistentScripts = ReactionManager.getStartupScripts();
    let persistentChanged = false;

    for (const entry of builtinStartups) {
        // Remove from persistent if it exists (legacy cleanup)
        const persistentIdx = persistentScripts.findIndex(s => s.id === entry.id);
        if (persistentIdx !== -1) {
            persistentScripts.splice(persistentIdx, 1);
            persistentChanged = true;
        }

        const settingEnabled = entry.settingKey
            ? (game.settings.get(ReactionManager.ID, entry.settingKey) ?? true)
            : true;

        if (!settingEnabled)
            continue;

        try {
            const response = await fetch(`/modules/lancer-automations/${entry.filePath}`);
            const code = await response.text();
            ReactionManager.builtinStartups.push({
                id: entry.id,
                name: entry.name,
                description: entry.description,
                enabled: true,
                code,
                builtin: true
            });
            console.log(`lancer-automations | Registered built-in startup: ${entry.name}`);
        } catch (e) {
            console.error(`lancer-automations | Failed to load built-in startup "${entry.name}":`, e);
        }
    }

    if (persistentChanged) {
        await ReactionManager.saveStartupScripts(persistentScripts);
    }
}

function runStartupScripts(api) {
    const userScripts = ReactionManager.getStartupScripts();
    const allScripts = [...ReactionManager.builtinStartups, ...userScripts];

    for (const script of allScripts) {
        if (!script.enabled)
            continue;
        try {
            const fn = stringToAsyncFunction(script.code, ['api'], script.name);
            fn(api);
        } catch (e) {
            console.error(`lancer-automations | Startup script "${script.name}" failed:`, e);
        }
    }
}

registerBuiltinStartup({
    id: 'builtin-lasossis-items',
    settingKey: 'enableLaSossisItems',
    name: "LaSossis's Items",
    description: "LaSossis's item activations",
    filePath: 'startups/itemActivations.js'
});

registerBuiltinStartup({
    id: 'builtin-lasossis-personal',
    settingKey: 'enablePersonalStuff',
    name: "LaSossis's Personal Stuff",
    description: "Personal tweaks",
    filePath: 'startups/personalStuff.js'
});

Hooks.on('ready', async () => {
    console.log('lancer-automations | Ready');

    ReactionManager.initialize();
    LAAuras.init();

    game.modules.get('lancer-automations').api = /** @type {any} */ ({
        ...OverwatchAPI,
        ...ReactionsAPI,
        ...EffectsAPI,
        ...BonusesAPI,
        ...InteractiveAPI,
        ...MiscAPI,
        ...CompendiumToolsAPI,
        ...EffectManagerAPI,
        ...TerrainAPI,
        ...DowntimeAPI,
        ...ScanAPI,
        ...RestAPI,
        ...AurasAPI,
        ...ItemDisabledAPI,
        applyInfection,
        repairLCPData,
        TriggerUseAmmoFlow,
        setTokenFlag,
        unsetTokenFlag,
        startConfigTour,
        startActivationManagerTour,
        // Internal main.js functions
        clearMoveData,
        undoMoveData,
        getCumulativeMoveData,
        getIntentionalMoveData,
        getMovementHistory,
        getMovementCap,
        increaseMovementCap,
        initMovementCap,
        actionFX,
        processEffectConsumption,
        handleTrigger,
        registerUserHelper,
        getUserHelper,
        getActiveGMId,
        getTokenOwnerUserId,
        delayedTokenAppearance,
        // Tests
        tests: {
            cardStack: CardStackTests,
            flowQueue: FlowQueueTests,
        }
    });
    initSocket();
    // Defer to next tick so other 'ready' listeners (e.g. TAH's showAttackHUD wrap) finish first;
    // initFlowQueue must be the outermost wrap on game.lancer.flowSteps.
    setTimeout(initFlowQueue, 0);

    initDelayedAppearanceHook();
    await syncBuiltinStartups();
    runStartupScripts(game.modules.get('lancer-automations').api);
    Hooks.callAll('lancer-automations.ready', game.modules.get('lancer-automations').api);

    // Extra trackable attributes (action_tracker.move / reaction on token bars)
    registerExtraTrackableAttributes();

    // Custom flow dispatch (handles module-registered flows from chat buttons)
    initCustomFlowDispatch();

    initStatusFX();
    initTokenStatBar();
    if (game.settings.get('lancer-automations', 'enableInfectionDamageIntegration'))
        initInfectionHooks();
    initWreckTokenConfig();

    if (game.settings.get('lancer-automations', 'allowHalfSizeTokens')) {
        patchHalfSizeTokens();
    }

    checkCompatibility();
});

// Item Disabled system – uncomment to activate
Hooks.on('renderActorSheet', onRenderActorSheet);
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!game.settings.get('lancer-automations', 'enableInfectionDamageIntegration')) {
        return;
    }
    onRenderActorSheetInfection(app, html, data);
});

// Ammo editor on mech_system item sheets – uncomment to activate
Hooks.on('renderItemSheet', onRenderItemSheet);

function _isLikelyWhiteIcon(src) {
    if (!src)
        return false;
    if (/\/assets\/icons\/white\//.test(src))
        return true;
    if (/\/lancer-automations\/icons\/[^/]+\.svg$/i.test(src))
        return true;
    return false;
}

Hooks.on('renderChatMessage', (app, html, data) => {
    html.find('img').each((_, el) => {
        if (_isLikelyWhiteIcon(el.getAttribute('src')))
            el.classList.add('la-invert-icon');
    });
    bindChatMessageStateInterceptor(app, html);
    // Process damage cards for immunities and resistances
    if (html.find('.lancer-damage-targets').length) {
        // Get the damage types from the message
        const damageTypes = html.find('.lancer-dice-formula i.cci[class*="damage--"]')
            .map((_, el) => Array.from(el.classList)
                .find(c => c.startsWith('damage--'))
                ?.replace('damage--', '')
            ).get();

        if (damageTypes.length) {

            // Process each target
            html.find('.lancer-damage-target').each((_, targetEl) => {
                const target = $(targetEl);
                const uuid = target.data('uuid');
                if (!uuid)
                    return;

                const actor = /** @type {Actor} */ (/** @type {any} */ (fromUuidSync(uuid))?.actor || fromUuidSync(uuid));
                if (!actor)
                    return;

                // Find existing tags container or create it
                let tagsContainer = target.find('.lancer-damage-tags');
                let tagsContainerCreated = false;
                if (!tagsContainer.length) {
                    tagsContainer = $('<div class="lancer-damage-tags"></div>');
                    tagsContainerCreated = true;
                }

                let tagsHtml = '';

                // Collect all unique immunity types
                const immuneTypes = new Set();
                getImmunityBonuses(actor, "damage").forEach(b => {
                    b.damageTypes?.forEach(t => immuneTypes.add(t.toLowerCase()));
                });

                immuneTypes.forEach(dtype => {
                    if (dtype === 'variable' || dtype === 'all')
                        return;
                    const capitalizedType = dtype.charAt(0).toUpperCase() + dtype.slice(1);
                    const tooltip = `Immune to ${capitalizedType}`;
                    if (!tagsContainer.find(`span[data-tooltip="${tooltip}"]`).length) {
                        tagsHtml += `<span class="lancer-damage-tag" data-tooltip="${tooltip}"><i class="mdi mdi-shield i--xs"></i></span>`;
                    }
                });

                // Collect all unique resistance types
                const resistTypes = new Set();
                getImmunityBonuses(actor, "resistance").forEach(b => {
                    b.damageTypes?.forEach(t => resistTypes.add(t.toLowerCase()));
                });

                resistTypes.forEach(dtype => {
                    if (dtype === 'variable' || dtype === 'all')
                        return;
                    const capitalizedType = dtype.charAt(0).toUpperCase() + dtype.slice(1);
                    const tooltip = `Resist ${capitalizedType}`;
                    if (!tagsContainer.find(`span[data-tooltip="${tooltip}"]`).length && !tagsContainer.find(`span[data-tooltip="Resistance to ${capitalizedType}"]`).length) {
                        tagsHtml += `<span class="lancer-damage-tag" data-tooltip="${tooltip}"><i class="mdi mdi-shield-half-full i--xs"></i></span>`;
                    }
                });

                if (tagsHtml) {
                    if (tagsContainerCreated) {
                        const rollsTags = target.find('.lancer-damage-rolls-tags');
                        if (rollsTags.length) {
                            tagsContainer.append(tagsHtml);
                            rollsTags.append(tagsContainer);
                        }
                    } else {
                        tagsContainer.append(tagsHtml);
                    }
                }
            });
        }
    }

    // Process attack targets for crit immunity (downgraded crits)
    html.find('.lancer-hit-target').each((_, targetEl) => {
        const target = $(targetEl);
        const hitChip = target.find('.lancer-hit-chip');

        // If it's a regular hit, check if the roll was 20+ (which means it was downgraded)
        if (hitChip.length && hitChip.hasClass('hit')) {
            const rollTotalStr = target.find('.dice-total').text();
            const rollTotal = Number.parseInt(rollTotalStr, 10);

            if (!Number.isNaN(rollTotal) && rollTotal >= 20) {
                hitChip.css({
                    'background-color': '#eab308',
                    'color': '#000',
                    'border-color': '#ca8a04'
                });
                hitChip.attr('data-tooltip', 'Immune to Critical Hits');
            }
        }
    });
});

Hooks.on('renderTokenHUD', (hud, html, data) => {
    if (!game.settings.get('lancer-automations', 'showStatusEffectsHudButton')) {
        html.find('.col.right .control-icon[data-action="effects"]').remove();
    }

    // Existing Bonus Menu Button
    if (game.settings.get('lancer-automations', 'showBonusHudButton')) {
        const token = hud.object;
        if (token?.actor) {
            const button = $(`<div class="control-icon" data-action="bonus-menu" data-tooltip="Lancer EffectManager">
                <i class="cci cci-accuracy i--m"></i>
            </div>`);
            button.on('click', (e) => {
                e.preventDefault();
                executeGenericBonusMenu(token.actor);
            });
            html.find('.col.right').append(button);
        }
    }

    // Revert Last Movement Button
    const leftColumn = html.find(".col.left");
    if (leftColumn.length === 0)
        return;
    if (html.find('.lancer-ruler-reset-button').length)
        return;

    if (!game.combat?.started) {
        return;
    }

    if (!game.settings.get('lancer-automations', 'showRevertMovementHudButton')) {
        return;
    }

    const hasERHistory = game.modules.get('elevationruler')?.active
        && game.settings.get('elevationruler', 'token-ruler-combat-history');

    const resetButtonHtml = `
    <div class="control-icon lancer-ruler-reset-button" title="${hasERHistory ? 'Revert Last Movement' : 'Reset Movement History'}">
        <i class="fas fa-shoe-prints fa-fw"></i>
    </div>
  `;

    leftColumn.append(resetButtonHtml);
    const btn = html.find('.lancer-ruler-reset-button');
    btn.on('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const token = hud.object;
        if (!token)
            return;

        if (hasERHistory) {
            await revertMovement(token);
        } else {
            clearMovementHistory(token, false);
        }
    });

    btn.on('contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const token = hud.object;
        openResetMovementDialog(token);
    });
});

Hooks.on('combatTurnChange', async (combat, prior, current) => {
    if (!game.users.activeGM?.isSelf) {
        return;
    }
    if (prior.combatantId) {
        const endingCombatant = combat.combatants.get(prior.combatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            await handleTrigger('onTurnEnd', { triggeringToken: endingToken });
            processDurationEffects('end', endingToken.id);
        }
    }

    if (current.combatantId) {
        const startingCombatant = combat.combatants.get(current.combatantId);
        const startingToken = startingCombatant?.token ? canvas.tokens.get(startingCombatant.token.id) : null;
        if (startingToken) {
            clearMoveData(startingToken.document.id);
            initMovementCap(startingToken);
            await handleTrigger('onTurnStart', { triggeringToken: startingToken });
            processDurationEffects('start', startingToken.id);
            if (startingToken.actor)
                await rechargeExtraActionsForActor(startingToken.actor);
        }
    }

});

// Init movement cap for all combatants when combat starts.
// Either feature needs the cap initialized: boost offer reads it to know what's exceeded.
Hooks.on('combatStart', (combat) => {
    if (!game.settings.get('lancer-automations', 'enableMovementCapDetection')
        && !game.settings.get('lancer-automations', 'enableBoostOffer')) {
        return;
    }
    for (const combatant of combat.combatants) {
        const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
        if (token) {
            initMovementCap(token);
        }
    }
});

Hooks.on('createCombatant', async (combatant, options, userId) => {
    if (game.user.id !== userId)
        return;
    const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
    if (!token)
        return;
    initMovementCap(token);
    await handleTrigger('onEnterCombat', { triggeringToken: token });
});

Hooks.on('deleteCombatant', async (combatant, options, userId) => {
    if (game.user.id !== userId)
        return;
    const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
    if (!token)
        return;
    await handleTrigger('onExitCombat', { triggeringToken: token });
});

Hooks.on('deleteCombat', async (combat, options, userId) => {
    if (game.user.id !== userId)
        return;
    for (const combatant of combat.combatants) {
        const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
        if (!token)
            continue;
        await handleTrigger('onExitCombat', { triggeringToken: token });
    }
});

Hooks.on('updateCombat', async (combat, change, options, userId) => {
    // Turn/round logic is handled by combatTurnChange above.
    // Reserved for future use.
});

Hooks.on('preCreateActiveEffect', (effect, _data, options, _userId) => {
    // Immunity bypass
    if (options?.skipPreStatusHooks)
        return true;

    const actor = effect.parent;
    if (!actor)
        return true;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;
    if (!statusId)
        return true;

    // Immunity check: block before the effect is ever created
    const effectData = effect.toObject();
    const immunitySources = checkEffectImmunities(actor, statusId, effect);
    if (immunitySources.length > 0) {
        (async () => {
            await Promise.resolve();
            await startChoiceCard({
                title: "ACTIVATE IMMUNITY?",
                description: `<b>${actor.name}</b> affected by <b>${statusId}</b>.<hr>Immunity from: <i>${immunitySources.join(", ")}</i>. Activate?`,
                icon: "mdi mdi-shield",
                mode: "or",
                choices: [
                    {
                        text: "Yes (Resist Effect)",
                        icon: "fas fa-check",
                        callback: async () => {
                            ui.notifications.info(`${actor.name} resisted ${statusId}`);
                        }
                    },
                    {
                        text: "No (Allow Effect)",
                        icon: "fas fa-times",
                        callback: async () => {
                            await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { skipPreStatusHooks: true });
                        }
                    }
                ]
            });
        })().catch(() => {});
        return false;
    }

    let cancelChange = false;
    const _cancelledBy = options?._cancelledBy || [];
    const cancelChangeFn = _buildCancelFn({
        setFlag: () => {
            cancelChange = true;
        },
        cancelledBy: _cancelledBy,
        getIgnoreCallback: () => async () => {
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { _cancelledBy });
        },
        defaultReason: "This status change has been blocked.",
        defaultTitle: "STATUS BLOCKED",
        choice1Text: "Confirm",
        choice2Text: "Ignore (Allow Effect)",
    });

    handleTrigger('onPreStatusApplied', { triggeringToken: token, statusId, effect, cancelChange: cancelChangeFn, _cancelledBy });

    if (cancelChange) {
        cancelChangeFn.wait()?.catch(() => {});
        return false;
    }
});

Hooks.on('preDeleteActiveEffect', (effect, options, _userId) => {
    // Immunity bypass
    if (options?.skipPreStatusHooks)
        return true;

    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;
    if (!statusId)
        return;

    let cancelChange = false;
    const _cancelledBy = options?._cancelledBy || [];
    const cancelChangeFn = _buildCancelFn({
        setFlag: () => {
            cancelChange = true;
        },
        cancelledBy: _cancelledBy,
        getIgnoreCallback: () => async () => {
            effect.delete({ _cancelledBy: _cancelledBy });
        },
        defaultReason: "This status removal has been blocked.",
        defaultTitle: "REMOVAL BLOCKED",
        choice1Text: "Confirm",
        choice2Text: "Ignore (Delete Effect)",
    });

    handleTrigger('onPreStatusRemoved', { triggeringToken: token, statusId, effect, cancelChange: cancelChangeFn, _cancelledBy: _cancelledBy });

    if (cancelChange) {
        cancelChangeFn.wait()?.catch(() => {});
        return false;
    }
});

Hooks.on('createActiveEffect', async (effect, _options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    await handleTrigger('onStatusApplied', { triggeringToken: token, statusId, effect });
});

Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    await handleTrigger('onStatusRemoved', { triggeringToken: token, statusId, effect });

    // Clean up grouped effects: if one effect in a group is removed, remove the rest
    const groupId = effect.flags?.['lancer-automations']?.consumption?.groupId;
    if (groupId && !options?.skipGroupCleanup) {
        const groupEffects = actor.effects.filter(e =>
            e.id !== effect.id && e.flags?.['lancer-automations']?.consumption?.groupId === groupId
        );
        if (groupEffects.length > 0) {
            actor.deleteEmbeddedDocuments("ActiveEffect", groupEffects.map(e => e.id), { skipGroupCleanup: true });
        }
    }
});

Hooks.on('updateActiveEffect', (effect, change, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    if (options?.skipGroupSync)
        return;
    const newStack = change?.flags?.statuscounter?.value;
    if (newStack === undefined)
        return;

    const actor = effect.parent;
    if (!actor)
        return;

    const groupId = effect.flags?.['lancer-automations']?.consumption?.groupId;
    if (!groupId)
        return;

    const groupEffects = actor.effects.filter(e =>
        e.id !== effect.id && e.flags?.['lancer-automations']?.consumption?.groupId === groupId
    );
    if (groupEffects.length === 0)
        return;

    const updates = groupEffects
        .filter(e => (e.flags?.statuscounter?.value ?? 1) !== newStack)
        .map(e => ({
            _id: e.id,
            "flags.statuscounter.value": newStack,
            "flags.statuscounter.visible": newStack > 1
        }));
    if (updates.length > 0) {
        actor.updateEmbeddedDocuments("ActiveEffect", updates, { skipGroupSync: true });
    }
});

let previousHeatValues = new Map();
let previousHPValues = new Map();

Hooks.on('preDeleteToken', async (tokenDocument, _options, userId) => {
    if (userId !== game.userId)
        return;
    const actor = tokenDocument.actor;
    if (!actor)
        return;
    const structure = actor.system?.structure?.value ?? 1;
    const stress = actor.system?.stress?.value ?? 1;
    if (structure > 0 && stress > 0)
        return;
    const token = canvas.tokens.get(tokenDocument.id)
        ?? { document: tokenDocument, id: tokenDocument.id, name: tokenDocument.name, actor };
    await handleTrigger('onDestroyed', { triggeringToken: token });
});

Hooks.on('createToken', (tokenDocument, options, userId) => {
    if (userId !== game.userId)
        return;
    const token = canvas.tokens.get(tokenDocument.id);
    if (!token)
        return;
    setTimeout(() => {
        checkOnInitReactions(token);
        handleManualDeployLink(tokenDocument);
        handleTrigger('onTokenCreated', { triggeringToken: token });
    }, 100);
});

Hooks.on('preDeleteToken', (tokenDocument, _options, userId) => {
    if (userId !== game.userId)
        return;
    const token = canvas.tokens.get(tokenDocument.id);
    if (!token)
        return;
    // Fire before the token leaves canvas.tokens so self-reactors can still act.
    handleTrigger('onTokenRemoved', { triggeringToken: token });
});

Hooks.on('preUpdateActor', (actor, change, options, userId) => {
    if (userId !== game.userId)
        return true;
    if (options._bypassPreChange)
        return true;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    if (!token)
        return true;

    let blocked = false;

    // HP change
    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const newHP = change.system.hp.value;
        const delta = newHP - previousHP;
        if (delta !== 0) {
            const _cancelledBy = options._cancelledBy || [];
            let cancelHpTriggered = false;
            let modifyPromise = null;

            const cancelHpChange = _buildCancelFn({
                setFlag: () => {
                    cancelHpTriggered = true;
                },
                cancelledBy: _cancelledBy,
                getIgnoreCallback: () => async () => {
                    actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                },
                defaultReason: "HP change has been prevented.",
                defaultTitle: "HP CHANGE PREVENTED",
            });

            /** @type {any} */
            const modifyHpChange = (newValue, reasonText = "HP change has been modified.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
                cancelHpTriggered = true;
                const identity = modifyHpChange._reactorIdentity;
                if (identity)
                    _cancelledBy.push(identity);
                const def = modifyHpChange._defaultContext ?? {};
                item = item ?? def.item ?? null;
                originToken = originToken ?? def.originToken ?? null;
                relatedToken = relatedToken ?? def.relatedToken ?? null;

                const executeModify = async () => {
                    await actor.update({ "system.hp.value": newValue }, { ...options, _bypassPreChange: true, _cancelledBy });
                };
                const executeOriginal = async () => {
                    await actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                };

                modifyPromise = (async () => {
                    await Promise.resolve();
                    if (preConfirm) {
                        const confirmed = await preConfirm();
                        if (!confirmed) {
                            await executeOriginal();
                            return;
                        }
                    }
                    if (!allowConfirm) {
                        await executeModify();
                        await postChoice?.(true);
                        return;
                    }
                    await startChoiceCard({
                        mode: "or",
                        title: "HP MODIFIED",
                        description: reasonText,
                        item,
                        originToken,
                        relatedToken,
                        userIdControl: userIdControl ?? getActiveGMId(),
                        choices: [
                            { text: "Confirm",
                                icon: "fas fa-check",
                                callback: async () => {
                                    await executeModify();
                                    await postChoice?.(true);
                                } },
                            { text: "Ignore",
                                icon: "fas fa-times",
                                callback: async () => {
                                    await postChoice?.(false);
                                    await executeOriginal();
                                } }
                        ]
                    });
                })();
                return modifyPromise;
            };
            modifyHpChange.wait = () => modifyPromise;

            handleTrigger('onPreHpChange', {
                triggeringToken: token,
                previousHP,
                newHP,
                delta,
                cancelHpChange,
                modifyHpChange,
                _cancelledBy
            });

            if (cancelHpTriggered) {
                cancelHpChange.wait()?.catch(() => {});
                modifyHpChange.wait()?.catch(() => {});
                blocked = true;
            }
        }
    }

    // Heat change
    if (change.system?.heat?.value !== undefined) {
        const previousHeat = previousHeatValues.get(actor.id) ?? actor.system.heat.value;
        const newHeat = change.system.heat.value;
        const delta = newHeat - previousHeat;
        if (delta !== 0) {
            const _cancelledBy = options._cancelledBy || [];
            let cancelHeatTriggered = false;
            let modifyPromise = null;

            const cancelHeatChange = _buildCancelFn({
                setFlag: () => {
                    cancelHeatTriggered = true;
                },
                cancelledBy: _cancelledBy,
                getIgnoreCallback: () => async () => {
                    actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                },
                defaultReason: "Heat change has been prevented.",
                defaultTitle: "HEAT CHANGE PREVENTED",
            });

            /** @type {any} */
            const modifyHeatChange = (newValue, reasonText = "Heat change has been modified.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
                cancelHeatTriggered = true;
                const identity = modifyHeatChange._reactorIdentity;
                if (identity)
                    _cancelledBy.push(identity);
                const def = modifyHeatChange._defaultContext ?? {};
                item = item ?? def.item ?? null;
                originToken = originToken ?? def.originToken ?? null;
                relatedToken = relatedToken ?? def.relatedToken ?? null;

                const executeModify = async () => {
                    await actor.update({ "system.heat.value": newValue }, { ...options, _bypassPreChange: true, _cancelledBy });
                };
                const executeOriginal = async () => {
                    await actor.update(change, { ...options, _bypassPreChange: true, _cancelledBy });
                };

                modifyPromise = (async () => {
                    await Promise.resolve();
                    if (preConfirm) {
                        const confirmed = await preConfirm();
                        if (!confirmed) {
                            await executeOriginal();
                            return;
                        }
                    }
                    if (!allowConfirm) {
                        await executeModify();
                        await postChoice?.(true);
                        return;
                    }
                    await startChoiceCard({
                        mode: "or",
                        title: "HEAT MODIFIED",
                        description: reasonText,
                        item,
                        originToken,
                        relatedToken,
                        userIdControl: userIdControl ?? getActiveGMId(),
                        choices: [
                            { text: "Confirm",
                                icon: "fas fa-check",
                                callback: async () => {
                                    await executeModify();
                                    await postChoice?.(true);
                                } },
                            { text: "Ignore",
                                icon: "fas fa-times",
                                callback: async () => {
                                    await postChoice?.(false);
                                    await executeOriginal();
                                } }
                        ]
                    });
                })();
                return modifyPromise;
            };
            modifyHeatChange.wait = () => modifyPromise;

            handleTrigger('onPreHeatChange', {
                triggeringToken: token,
                previousHeat,
                newHeat,
                delta,
                cancelHeatChange,
                modifyHeatChange,
                _cancelledBy
            });

            if (cancelHeatTriggered) {
                cancelHeatChange.wait()?.catch(() => {});
                modifyHeatChange.wait()?.catch(() => {});
                blocked = true;
            }
        }
    }

    if (blocked)
        return false;
    return true;
});

Hooks.on('updateActor', async (actor, change, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    if (!token)
        return;

    if (change.system?.heat?.value !== undefined) {
        const previousHeat = previousHeatValues.get(actor.id) ?? actor.system.heat.value;
        const currentHeat = change.system.heat.value;
        const heatChange = currentHeat - previousHeat;

        if (heatChange > 0) {
            const heatMax = actor.system.heat.max;
            const inDangerZone = currentHeat >= Math.floor(heatMax / 2);
            await handleTrigger('onHeatGain', { triggeringToken: token, heatChange, currentHeat, inDangerZone });
        } else if (heatChange < 0) {
            const heatCleared = Math.abs(heatChange);
            await handleTrigger('onHeatLoss', { triggeringToken: token, heatCleared, currentHeat });
        }

        previousHeatValues.set(actor.id, currentHeat);
    }

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const currentHP = change.system.hp.value;
        const hpChange = currentHP - previousHP;

        if (hpChange > 0) {
            const maxHP = actor.system.hp.max;
            await handleTrigger('onHpGain', { triggeringToken: token, hpChange, currentHP, maxHP });
        } else if (hpChange < 0) {
            const hpLost = Math.abs(hpChange);
            await handleTrigger('onHpLoss', { triggeringToken: token, hpLost, currentHP });
        }

        previousHPValues.set(actor.id, currentHP);
    }

    // Wreck system: structure reaches 0 -> wreck the token.
    if (change.system?.structure !== undefined && game.userId === userId) {
        try {
            if (game.settings.get('lancer-automations', 'enableWrecks')) {
                await updateStructure(token);
            }
        } catch (e) {
            console.warn('lancer-automations | wreck updateStructure error:', e);
        }
    }

    // Deployable HP=0 -> destroy with FX.
    if (change.system?.hp !== undefined
        && actor.type === 'deployable'
        && (actor.system?.hp?.value ?? 1) <= 0
        && game.userId === userId) {
        console.log(`lancer-automations | Deployable ${token.name} destroyed (HP <= 0)`);
        if (game.combat && token.combatant) {
            await game.combat.combatants.get(token.combatant._id)?.delete();
        }
        await token.document.delete();
    }
});

// Wreck system hooks
Hooks.on('canvasReady', () => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        canvasReadyWreck();
    }
});
Hooks.on('createToken', (tokenDoc, options, userId) => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        preWreck(tokenDoc, options, userId);
    }
});

const TEMPLATE_NO_PROVOKE_NAMES = new Set([
    'Template Throw',
    'Template Hard Cover',
    'Template Wreck',
]);
Hooks.on('createToken', async (tokenDoc, _options, userId) => {
    if (userId !== game.userId)
        return;
    const baseName = tokenDoc?.baseActor?.name ?? tokenDoc?.actor?.name ?? '';
    if (!TEMPLATE_NO_PROVOKE_NAMES.has(baseName))
        return;
    const actor = tokenDoc.actor;
    const api = game.modules.get('lancer-automations')?.api;
    if (!actor || !api?.addConstantBonus)
        return;
    try {
        await api.addConstantBonus(actor, {
            id: 'la-deployable-no-provoke',
            name: 'No Provoke',
            type: 'immunity',
            subtype: 'provoke'
        });
    } catch (e) {
        console.warn('lancer-automations | could not add provoke immunity to template token:', e);
    }
});
Hooks.on('renderTileHUD', (app, html) => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        tileHUDButton(app, html);
    }
});

Hooks.on('renderSettings', (app, html) => {
    const lancerHeader = html.find('#settings-lancer');
    if (lancerHeader.length === 0) {
        return;
    }

    const overviewButton = $(`<button id="lancer-automations-overview" data-action="lancer-automations-overview">
        <i class="fas fa-cog"></i> Lancer Automations
    </button>`);
    const managerButton = $(`<button id="lancer-automations-manager" data-action="lancer-automations-manager">
        <i class="fas fa-tasks"></i> Activation Manager
    </button>`);

    const helpButton = lancerHeader.find('button#triggler-form');
    if (helpButton.length > 0) {
        helpButton.after(managerButton);
        helpButton.after(overviewButton);
    } else {
        lancerHeader.append(overviewButton);
        lancerHeader.append(managerButton);
    }

    overviewButton.on('click', (ev) => {
        ev.preventDefault();
        new LancerAutomationsConfig().render(true);
    });

    managerButton.on('click', async (ev) => {
        ev.preventDefault();
        new ReactionConfig().render(true);
    });
});



Hooks.on('preUpdateToken', (document, change, options, userId) => {

    //debug
    // if ('rulerSegment' in options || options.isDrag) {
    //     console.log('lancer-automations | preUpdateToken ruler segment:', {
    //         lancerSegmentDistance: options.lancerSegmentDistance,
    //         lancerSegmentCost: options.lancerSegmentCost,
    //         lancerTerrainPenalty: options.lancerTerrainPenalty,
    //         lancerFreeMovement: options.lancerFreeMovement
    //     });
    // }

    if (options.lancerDebugMovement)
        return true;

    const isDrag = !options.forceUnintentional && ('rulerSegment' in options || options.isDrag);

    if (options.IgnorePreMove) {
        if (isDrag) {
            const token = canvas.tokens.get(document.id);
            handleTokenMove(token, change, options, userId);
        }
        return true;
    }

    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return;
    if (options.isUndo)
        return;

    if (isDrag) {
        let cancelUpdate = false;
        const token = canvas.tokens.get(document.id);

        const startPos = { x: document.x, y: document.y };
        const endPos = { x: change.x ?? document.x, y: change.y ?? document.y };
        const elevationToMove = change.elevation ?? document.elevation;

        const { distanceMoved: distanceToMove, movementCost: moveToMovementCost, isFreeMovement: moveIsFreeMovement } = _computeMoveData(options, startPos, endPos);

        const isTeleport = !!options.teleport;
        const shouldCalculatePath = game.settings.get('lancer-automations', 'enablePathHexCalculation');
        const moveInfo = {
            isInvoluntary: !isDrag,
            isTeleport,
            isUndo: options.isUndo,
            isModified: options.isModified,
            pathHexes: shouldCalculatePath ? getMovementPathHexes(token, change) : /** @type {PathHexArray} */ (/** @type {any} */ ([]))
        };
        options.lancerPathHexes = moveInfo.pathHexes;

        const triggerData = {
            token: token,
            distanceToMove,
            elevationToMove,
            startPos,
            endPos,
            isDrag,
            moveInfo,
            cancel: () => {
                cancelUpdate = true;
            }
        };

        const continueCallback = async () => {
            // Re-submit the original movement, carrying _cancelledBy so only the
            // reactions that already cancelled are skipped on this pass
            const dest = { x: change.x ?? token.x, y: change.y ?? token.y };
            if (change.elevation !== undefined) {
                dest.elevation = change.elevation;
            }
            await _rulerMove(token, dest, { ...options, _cancelledBy: triggerData._cancelledBy });
        };
        triggerData._cancelledBy = options._cancelledBy || [];
        const _cancelMoveCard = _buildCancelFn({
            setFlag: () => {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
            },
            cancelledBy: triggerData._cancelledBy,
            getIgnoreCallback: () => continueCallback,
            defaultReason: "This movement has been canceled.",
            defaultTitle: "MOVEMENT CANCELED",
            choice1Text: "Stop",
            choice2Text: "Ignore",
            getExtraCardOptions: (uc) => ({
                traceData: (uc ?? getActiveGMId()) ? { tokenId: token.id, endPos, newEndPos: null } : null
            }),
        });
        // Adapter: preserves the original signature (no title param, allowConfirm is 2nd).
        // Trace is drawn here (not in _cancelMoveCard onBefore) so it shows during preConfirm too.
        triggerData.cancelTriggeredMove = (reasonText = "This movement has been canceled.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
            _cancelMoveCard._reactorIdentity = triggerData.cancelTriggeredMove._reactorIdentity;
            _cancelMoveCard._engineCancel = triggerData.cancelTriggeredMove._engineCancel;
            const trace = drawMovementTrace(token, endPos);
            const cleanup = () => {
                if (trace?.parent)
                    trace.parent.removeChild(trace);
                trace?.destroy();
            };
            const result = _cancelMoveCard(reasonText, undefined, allowConfirm, userIdControl, preConfirm, postChoice, opts);
            Promise.resolve(result).finally(cleanup);
            return result;
        };

        triggerData.changeTriggeredMove = async (position, extraData = {}, reasonText = "This movement has been rerouted.", allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
            triggerData.cancel();
            cancelRulerDrag(token, moveInfo);
            const identity = triggerData.changeTriggeredMove._reactorIdentity;
            if (identity && triggerData._cancelledBy)
                triggerData._cancelledBy.push(identity);

            const executeChange = () => {
                setTimeout(async () => {
                    const dest = { x: position.x, y: position.y };
                    if (extraData.elevation !== undefined) {
                        dest.elevation = extraData.elevation;
                    }
                    await _rulerMove(token, dest, { isUndo: false, isModified: true, ...extraData });
                }, 50);
            };
            const executeOriginal = async () => {
                const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                if (change.elevation !== undefined)
                    originalUpdate.elevation = change.elevation;
                await token.document.update(originalUpdate, { ...options, _cancelledBy: triggerData._cancelledBy, isDrag: true });
            };

            if (preConfirm) {
                const confirmed = await preConfirm();
                if (!confirmed) {
                    await executeOriginal();
                    return;
                }
            }

            if (!allowConfirm) {
                executeChange();
                await postChoice?.(true);
                return;
            }

            const trace = drawMovementTrace(token, endPos, position);

            await startChoiceCard({
                mode: "or",
                title: "MOVEMENT REROUTED",
                description: reasonText,
                item,
                originToken,
                relatedToken,
                userIdControl: userIdControl ?? getActiveGMId(),
                traceData: (userIdControl ?? getActiveGMId()) ? { tokenId: token.id, endPos, newEndPos: position } : null,
                choices: [
                    { text: "Confirm",
                        icon: "fas fa-check",
                        callback: async () => {
                            executeChange();
                            await postChoice?.(true);
                        } },
                    { text: "Ignore",
                        icon: "fas fa-times",
                        callback: async () => {
                            await postChoice?.(false);
                            await executeOriginal();
                        } }
                ]
            });

            if (trace.parent)
                trace.parent.removeChild(trace);
            trace.destroy();
        };

        _handleMovementCapExceeded(token, { options, change, startPos, endPos, moveInfo, moveToMovementCost, moveIsFreeMovement, triggerData });

        // Call handleTrigger without await. If onPreMove reactions are synchronous,
        // cancelUpdate will be set to true before we check it on the next line.
        // Skip if already cancelled by cap/boost check (no need to trigger reactions on a cancelled move)
        if (!cancelUpdate) {
            handleTrigger('onPreMove', { triggeringToken: token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo, cancel: triggerData.cancel, cancelTriggeredMove: triggerData.cancelTriggeredMove, changeTriggeredMove: triggerData.changeTriggeredMove, _cancelledBy: triggerData._cancelledBy });
        }

        if (cancelUpdate) {
            // A reactor (Overwatch, Engagement, etc.) cancelled this move. If a stack
            // is awaiting this token's leg, wipe it: chain is broken.
            if (_activeMoveStack && _activeMoveStack.tokenId === token.id) {
                _wipeMoveStack();
            }
            return false;
        }

        handleTokenMove(token, change, options, userId);

        if (game.settings.get('lancer-automations', 'debugPathHexCalculation') && moveInfo.pathHexes.length > 0) {
            try {
                drawDebugPath(moveInfo.pathHexes);
                setTimeout(() => {
                    if (canvas.lancerDebugPath && !canvas.lancerDebugPath.destroyed) {
                        canvas.lancerDebugPath.clear();
                    }
                }, 3000);
            } catch (err) {
                console.error("lancer-automations | Error drawing visual path debug:", err);
            }
        }
    }
    return true;
});

Hooks.on('updateToken', async function(document, change, options, userId) {
    if (game.user.id !== userId)
        return;

    if (change.hidden !== undefined) {
        const tok = canvas.tokens.get(document.id);
        if (tok)
            await handleTrigger('onTokenVisibility', { triggeringToken: tok, isHidden: !!change.hidden });
    }

    const hasPositionChange = change.x !== undefined || change.y !== undefined || change.elevation !== undefined;
    if (!hasPositionChange)
        return;
    if (options.lancerDebugMovement)
        return;

    if (options.rulerSegment && !options.lastRulerSegment)
        return;

    const token = canvas.tokens.get(document.id);
    if (!token)
        return;

    if (change.x !== undefined || change.y !== undefined || change.elevation !== undefined) {
        await new Promise(resolve => setTimeout(resolve, 100)); // a bit sketchy but it works
        const anim = CanvasAnimation.getAnimation(document.object?.animationName);
        if (anim)
            await anim.promise;
    }
    await handleTrigger("onUpdate", { triggeringToken: token, document, change, options });
});
