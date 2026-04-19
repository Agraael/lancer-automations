/*global PIXI, libWrapper */

import { OverwatchAPI, getTokenDistance } from "./overwatch.js";
import { ReactionManager, stringToFunction, stringToAsyncFunction, ReactionConfig } from "./reaction-manager.js";
import { CompendiumToolsAPI } from "./compendium-tools.js";
import { ReactionReset } from "./reaction-reset.js";
import { ReactionExport, ReactionImport } from "./reaction-export-import.js";
import { displayReactionPopup, activateReaction } from "./reactions-ui.js";
import { ReactionsAPI } from "./reactions-registry.js";
import { cancelRulerDrag ,
    InteractiveAPI,
    chooseToken, knockBackToken, applyKnockbackMoves,
    startChoiceCard, deployWeaponToken,
    revertMovement, clearMovementHistory,
    showUserIdControlledChoiceCard, resolveGMChoiceCard,
    showMultiUserControlledChoiceCard, cancelBroadcastChoiceCard,
    drawMovementTrace,
    getActiveGMId, getTokenOwnerUserId,
    showVoteCardOnVoter, receiveVoteSubmission,
    updateVoteCardOnVoter, confirmVoteCardOnVoter, cancelVoteCardOnVoter,
    handleManualDeployLink, startWaitCard
} from './interactive/index.js';
import {
    EffectsAPI,
    setEffect,
    removeEffectsByName,
    consumeEffectCharge,
    processDurationEffects,
    initCollapseHook,
    findEffectOnToken,
} from "./flagged-effects.js";
import {
    getMovementPathHexes, drawDebugPath
} from "./grid-helpers.js";
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
} from "./genericBonuses.js";
import { EffectManagerAPI } from "./effectManager.js";
import { TerrainAPI } from "./terrain-utils.js";

import { MiscAPI, getItemLID, isItemAvailable, hasReactionAvailable, getWeaponProfiles_WithBonus, executeSimpleActivation, executeStatRoll } from "./misc-tools.js";
import { checkModuleUpdate } from "./version-check.js";
import { registerModuleFlows, registerFlowStatePersistence, injectExtraDataUtility,
    bindChatMessageStateInterceptor,
    ActiveFlowState,
    forceTechHUDStep
} from "./flows.js";
import { DowntimeAPI } from "./downtime.js";
import { ScanAPI, performSystemScan, performGMInputScan } from "./scan.js";
import { LAAuras, AurasAPI } from "./aura.js";
import { initDelayedAppearanceHook, delayedTokenAppearance } from "./reinforcement.js";
import { CardStackTests } from "../tests/card-stack.js";
import { registerAltStructFlowSteps, initAltStructReady } from "./alt-struct/index.js";
import { injectDisabledSchemaField, registerDisabledFlowSteps, onRenderActorSheet, onRenderItemSheet, injectDisabledCSS, ItemDisabledAPI, registerExtraTrackableAttributes, registerMeleeCoverFix, patchStatRollCardTemplate, initCustomFlowDispatch, registerUseAmmoFlow, repairLCPData, TriggerUseAmmoFlow, wrapInitTechAttackData } from "./lancer-modif.js";
import { registerStatusFXSettings, initStatusFX } from "./statusFX.js";
import { registerSettingsMenus } from "./settingsMenus.js";
import { registerTokenStatBarSettings, initTokenStatBar } from "./tah/tokenStatBar.js";
import { updateStructure, preWreck, canvasReadyWreck, preLoadImageForAll, tileHUDButton, resurrect, initWreckTokenConfig } from "./wreck.js";
import './filters/customFilters.js';
import { checkCompatibility } from "./checkCompatibility.js";
import { injectInfectionSchemaField, injectInfectionDamageType, injectInfectionCSS, registerInfectionFlows, initInfectionHooks, applyInfection, onRenderActorSheetInfection } from "./infection.js";

let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;
let cachedFlatGeneralReactions = null;
/** @type {Map<string, Array>} triggerType → filtered non-action reactions; cleared with cachedFlatGeneralReactions */
const cachedNonActionReactionsByTrigger = new Map();
/** @type {Map<string, (value?: unknown) => void>} requestId → resolve — for awaiting remote startRelatedFlow completion */
const _pendingFlowWaits = new Map();
const COMBAT_INHERENT_TRIGGERS = new Set(['onEnterCombat', 'onExitCombat', 'onTurnStart', 'onTurnEnd']);
let deployableConnectionsGraphic = null;

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

function getReactionItems(token) {
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


async function checkOnMessageReactions(token, itemLid, reactionPath, activationName, triggerType, data) {
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
            ui.notifications.warn(`${reactionName} (${token?.name ?? '?'}): not triggered — out of combat.`);
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
        const enrichedData = { ...data, distanceToTrigger };

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
 * Closes over token, item, reaction config, and activationName — no arguments needed at call time.
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
                return await new Promise(resolve => _pendingFlowWaits.set(requestId, resolve));
            } finally {
                waitCard?.remove();
            }
        }
    };
}

function _buildStartRelatedFlow(token, item, reaction, activationName, extraData = {}) {
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

        // General reaction — no item
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
    return async (userId = null, extraData = {}, { wait = false } = {}) => {
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
            await new Promise(resolve => _pendingFlowWaits.set(requestId, resolve));
        }
    };
}

async function checkReactions(triggerType, data) {
    const allTokens = getAllSceneTokens();
    const reactionsPromises = [];
    // Change 4: hoist api lookup out of the inner loop
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

    // Change 3: compute actionBasedReaction with a single .find()
    let actionBasedReaction = null;
    if (data.actionName) {
        const found = flatGeneralReactions.find(([name, r]) =>
            name === data.actionName && r.onlyOnSourceMatch && r.triggers?.includes(triggerType));
        if (found)
            actionBasedReaction = { name: found[0], reaction: found[1] };
    }

    // Change 2: cache nonActionBasedReactions per triggerType
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

    for (const token of allTokens) {
        const isSelf = data.triggeringToken?.id === token.id;
        // Hidden triggering tokens don't provoke reactions from others — only self-reactions fire.
        if (triggeringTokenHidden && !isSelf)
            continue;
        const isInCombat = token.inCombat;

        // Change 5: compute distance and enrichedData once per token, not per item/reaction
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = sourceToken ? getTokenDistance(token, sourceToken) : null;
        const enrichedData = { ...data, distanceToTrigger };

        const items = getReactionItems(token);
        for (const item of items) {
            const lid = getItemLID(item);
            if (!lid)
                continue;

            const registryEntry = ReactionManager.getReactions(lid);
            if (!registryEntry)
                continue;

            for (const reaction of registryEntry.reactions) {
                if (!reaction.triggers.includes(triggerType))
                    continue;
                if (reaction.enabled === false)
                    continue;

                if (reaction.onlyOnSourceMatch) {
                    const triggeringItem = data.weapon || data.techItem || data.item;
                    const triggeringItemLid = triggeringItem?.system?.lid;
                    if (!triggeringItemLid || triggeringItemLid !== lid)
                        continue;
                }

                // Change 1: use module-level Set instead of inline array
                if (!isInCombat && !reaction.outOfCombat && !COMBAT_INHERENT_TRIGGERS.has(triggerType)) {
                    if ((token.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
                        ui.notifications.warn(`${item.name} (${token.name}): not triggered — out of combat.`);
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
                        const reactionTriggerData = { ...enrichedData, startRelatedFlow: _buildStartRelatedFlow(token, item, reaction, activationName), startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, item, reaction, activationName), sendMessageToReactor: _buildSendMessageToReactor(token, item, reactionPath, activationName, triggerType) };
                        // Inject reactor identity on all cancel functions so _buildCancelFn can record who cancelled
                        const reactorIdentity = { tokenId: token.id, lid, reactionPath: reaction.reactionPath || "" };
                        const defaultCancelContext = { item, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                        for (const key of Object.keys(reactionTriggerData)) {
                            if ((key.startsWith('cancel') || key.startsWith('change')) && typeof reactionTriggerData[key] === 'function') {
                                reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                                reactionTriggerData[key]._defaultContext = defaultCancelContext;
                            }
                        }
                        if (reaction.autoActivate) {
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
                const reactionTriggerData = { ...enrichedData, startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName), startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName), sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType) };
                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }
                if (reaction.autoActivate) {
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
                const reactionTriggerData = { ...enrichedData, startRelatedFlow: _buildStartRelatedFlow(token, null, reaction, reactionName), startRelatedFlowToReactor: _buildStartRelatedFlowToReactor(token, null, reaction, reactionName), sendMessageToReactor: _buildSendMessageToReactor(token, null, null, reactionName, triggerType) };
                const reactorIdentity = { tokenId: token.id, reactionName };
                const defaultCancelContext = { item: null, originToken: token, relatedToken: enrichedData.triggeringToken ?? null };
                for (const key of Object.keys(reactionTriggerData)) {
                    if ((key.startsWith('cancel') || key.startsWith('change')) && typeof reactionTriggerData[key] === 'function') {
                        reactionTriggerData[key]._reactorIdentity = reactorIdentity;
                        reactionTriggerData[key]._defaultContext = defaultCancelContext;
                    }
                }
                if (reaction.autoActivate) {
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

        const validLids = consumption.itemLid.split(',').map(s => s.trim()).filter(s => s);
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
            return consumption && consumption.trigger === triggerType;
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

    game.settings.register('lancer-automations', 'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Adds a button on the Token HUD to open the Effect Manager.',
        scope: 'world',
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
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableThrowFlow', {
        name: 'Automate Throw Choice for Thrown Weapons',
        hint: 'Thrown-tagged weapons prompt Attack or Throw at the start of the flow.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'statRollTargeting', {
        name: 'Enable Stat Roll Target Selection',
        hint: 'Stat rolls prompt for a target to auto-calculate difficulty.',
        scope: 'client',
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
        scope: 'client',
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
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'enableWreckAudio', {
        name: 'Wreck Explosion Audio',
        hint: 'Play explosion sounds when tokens are wrecked.',
        scope: 'world',
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
        scope: 'world',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1.5, step: 0.1 },
    });
    game.settings.register('lancer-automations', 'disableHumanDeathSound', {
        name: 'Disable Human Death Sound',
        hint: 'Mute wreck sounds for human/pilot/squad deaths.',
        scope: 'world',
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
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugPathHexCalculation', {
        name: 'Debug: Path Hex Calculation',
        hint: 'Draw temporary circles on the map highlighting the calculated path hex steps.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugOutOfCombat', {
        name: 'Debug: Out of Combat Warnings',
        hint: 'Show UI warnings when an activation is skipped because the token is not in combat.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    // ── Data Management ──
    game.settings.registerMenu('lancer-automations', 'repairLCPDataMenu', {
        name: 'Lancer System Patches & Fixes',
        label: 'Apply Fixes',
        hint: 'Rebuild all compendium and actor item data with Lancer Automations patches applied.',
        icon: 'fas fa-wrench',
        type: class extends FormApplication {
            render() {
                repairLCPData(); return this;
            }
        },
        restricted: true
    });

    game.settings.registerMenu('lancer-automations', 'resetSettings', {
        name: 'Reset Module',
        label: 'Reset to Defaults',
        hint: 'Reset all module settings and activations to their default values.',
        icon: 'fas fa-undo',
        type: ReactionReset,
        restricted: true
    });

    game.settings.registerMenu('lancer-automations', 'exportActivations', {
        name: 'Export Activations',
        label: 'Export to JSON',
        hint: 'Export all custom activations to a JSON file.',
        icon: 'fas fa-file-export',
        type: ReactionExport,
        restricted: true
    });

    game.settings.registerMenu('lancer-automations', 'importActivations', {
        name: 'Import Activations',
        label: 'Import from JSON',
        hint: 'Import activations from a JSON file.',
        icon: 'fas fa-file-import',
        type: ReactionImport,
        restricted: true
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
        hint: 'Add elevation to distance for overwatch, engagement, range checks, distanceToTrigger, and getTokenDistance / getMinGridDistance defaults.',
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

function deserializeTriggerData(data) {
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

async function handleSocketEvent({ action, payload }) {
    if (action === 'showReactionPopup') {
        if (payload.targetUserId && payload.targetUserId !== game.userId)
            return;

        const { triggerType, reactions } = payload;

        const reconstructed = [];
        for (const r of reactions) {
            const token = canvas.tokens.get(r.tokenId);
            if (!token)
                continue;

            let item = null;
            if (r.itemId) {
                item = token.actor?.items.get(r.itemId);
            }

            reconstructed.push({
                token,
                item,
                reactionName: r.reactionName,
                itemName: r.itemName,
                isGeneral: r.isGeneral,
                triggerData: deserializeTriggerData(r.triggerData),
            });
        }

        if (reconstructed.length > 0) {
            displayReactionPopup(triggerType, reconstructed);
        }
    } else if (action === 'setActorFlag') {
        if (!game.user.isGM)
            return;
        const actor = game.actors.get(payload.actorId);
        if (actor)
            await actor.setFlag(payload.ns, payload.key, payload.value);
    } else if (action === 'setEffect' || action === 'setFlaggedEffect') {
        setEffect(payload.targetID, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions);
    } else if (action === 'removeEffect' || action === 'removeFlaggedEffect') {
        removeEffectsByName(payload.targetID, payload.effect, payload.originID, payload.extraFlags ?? null);
    } else if (action === 'removeEffect') {
        const target = canvas.tokens.get(payload.targetID);
        if (target?.actor) {
            target.actor.deleteEmbeddedDocuments("ActiveEffect", [payload.effectID]);
        }
    } else if (action === 'preLoadImageForAll') {
        if (payload)
            await preLoadImageForAll(payload);
    } else if (action === 'moveTokens') {
        if (!game.user.isGM)
            return;
        const trigToken = payload.triggeringTokenId ? canvas.tokens.get(payload.triggeringTokenId) : null;
        const kbItem = payload.itemId
            ? (canvas.tokens.placeables.find(t => t.actor?.items?.get(payload.itemId))?.actor?.items?.get(payload.itemId) ?? null)
            : null;
        applyKnockbackMoves(payload.moves, trigToken, payload.distance, payload.actionName || "", kbItem, { asVoluntary: !!payload.asVoluntary });
    } else if (action === 'createTokens') {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        const created = await scene.createEmbeddedDocuments("Token", payload.tokenDataArray);
        const tokenIds = created.map(d => d.id);
        game.socket.emit('module.lancer-automations', {
            action: "createTokensResponse",
            payload: { requestId: payload.requestId, tokenIds }
        });
    } else if (action === 'pickupWeapon') {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;
        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();
        const ownerActor = /** @type {Actor} */(await fromUuid(payload.ownerActorUuid));
        if (ownerActor) {
            const weapon = ownerActor.items.get(payload.weaponId);
            if (weapon)
                await weapon.update(/** @type {any} */({ 'system.disabled': false }));
        }
    } else if (action === 'recallDeployable') {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;
        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();
    } else if (action === 'scanInfoRequest') {
        if (!game.user.isGM)
            return;
        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        await performGMInputScan([target], payload.scanTitle, payload.requestingUserName);
    } else if (action === 'scanSystemJournalRequest') {
        if (!game.user.isGM)
            return;
        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        new Dialog({
            title: "Journal Entry Request",
            content: `
                <div class="lancer-dialog-header">
                    <h2 class="lancer-dialog-title">Journal Entry Request</h2>
                    <p class="lancer-dialog-subtitle">Requested by: ${payload.requestingUserName}</p>
                </div>
                <form>
                    <div class="form-group">
                        <p style="margin-bottom: 12px;"><strong>${payload.requestingUserName}</strong> wants to create a journal entry for the scan of <strong>${payload.targetName}</strong>.</p>
                        <p style="color: #666; margin-bottom: 12px;">Do you want to create this journal entry?</p>
                    </div>
                    <div class="form-group">
                        <label style="font-weight: bold; margin-bottom: 8px; display: block;">Custom Journal Name (optional):</label>
                        <input type="text" id="custom-journal-name" name="custom-journal-name" value="${payload.customName || ''}" placeholder="Leave empty for auto-generated name" style="width: 100%; padding: 8px; font-size: 14px; border: 2px solid #999; border-radius: 4px;" />
                    </div>
                </form>
            `,
            buttons: {
                yes: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Create Journal Entry",
                    callback: async (html) => {
                        const customName = (String)(html.find('[name="custom-journal-name"]').val()).trim();
                        await performSystemScan(target, true, customName);
                        ui.notifications.info(`Journal entry created for ${payload.targetName}`);
                    }
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Decline",
                    callback: () => {
                        ui.notifications.info(`Journal entry request declined`);
                    }
                }
            },
            default: "yes"
        }, { classes: ["lancer-dialog-base", "lancer-no-title"], width: 450 }).render(true);
    } else if (action === 'choiceCardGMRequest') {
        if (payload.targetUserId !== game.user.id)
            return;
        let gmTrace = null;
        if (payload.traceData) {
            const { tokenId, endPos, newEndPos } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);
            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos);
        }
        await showUserIdControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    } else if (action === 'choiceCardBroadcastRequest') {
        if (!payload.allTargetUserIds?.includes(game.user.id))
            return;
        let gmTrace = null;
        if (payload.traceData) {
            const { tokenId, endPos, newEndPos } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);
            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos);
        }
        await showMultiUserControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    } else if (action === 'choiceCardBroadcastCancel') {
        if (!payload.otherTargetUserIds?.includes(game.user.id))
            return;
        cancelBroadcastChoiceCard(payload.cardId, payload.responderName, payload.isCancellation);
    } else if (action === 'choiceCardGMResponse') {
        if (payload.requestingUserId !== game.user.id)
            return;
        resolveGMChoiceCard(payload.cardId, payload.choiceIdx, payload.responderName, payload.responderUserId);
    } else if (action === 'updateActorSystem') {
        if (!game.user.isGM)
            return;
        const actor = game.actors.get(payload.actorId);
        if (actor)
            await actor.update(payload.data);
    } else if (action === 'voteCardRequest') {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        showVoteCardOnVoter(payload);
    } else if (action === 'voteCardSubmit') {
        if (payload.requestingUserId !== game.user.id)
            return;
        receiveVoteSubmission(payload);
    } else if (action === 'voteCardUpdate') {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        updateVoteCardOnVoter(payload);
    } else if (action === 'voteCardConfirm') {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        confirmVoteCardOnVoter(payload);
    } else if (action === 'voteCardCancel') {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        cancelVoteCardOnVoter(payload);
    } else if (action === 'onMessage') {
        if (payload.userId && payload.userId !== game.userId)
            return;
        const msgToken = canvas.tokens.get(payload.reactorTokenId);
        if (!msgToken)
            return;
        checkOnMessageReactions(msgToken, payload.itemLid ?? null, payload.reactionPath ?? null, payload.activationName ?? null, payload.triggerType, payload.data ?? {})
            .then(returnData => {
                if (payload.requestId) {
                    game.socket.emit('module.lancer-automations', {
                        action: 'onMessageDone',
                        payload: { requestId: payload.requestId, returnData: returnData ?? null }
                    });
                }
            })
            .catch(e => console.error('lancer-automations | onMessage socket error:', e));
    } else if (action === 'onMessageDone') {
        const resolve = _pendingFlowWaits.get(payload.requestId);
        if (resolve) {
            _pendingFlowWaits.delete(payload.requestId);
            resolve(payload.returnData ?? null);
        }
    } else if (action === 'startRelatedFlow') {
        if (payload.userId && payload.userId !== game.user.id)
            return;
        const flowToken = canvas.tokens.get(payload.reactorTokenId);
        if (!flowToken)
            return;
        const flowItem = payload.itemLid ? getReactionItems(flowToken).find(i => getItemLID(i) === payload.itemLid) ?? null : null;
        const fakeReaction = { reactionPath: payload.reactionPath, actionType: payload.actionType, effectDescription: payload.effectDescription };
        _buildStartRelatedFlow(flowToken, flowItem, fakeReaction, payload.activationName, payload.extraData ?? {})()
            .catch(e => console.error('lancer-automations | startRelatedFlow socket error:', e))
            .finally(() => {
                if (payload.requestId) {
                    game.socket.emit('module.lancer-automations', {
                        action: 'startRelatedFlowDone',
                        payload: { requestId: payload.requestId }
                    });
                }
            });
    } else if (action === 'startRelatedFlowDone') {
        const resolve = _pendingFlowWaits.get(payload.requestId);
        if (resolve) {
            _pendingFlowWaits.delete(payload.requestId);
            resolve();
        }
    } else if (action === 'statRollRequest') {
        // Remote client: player rolls on their side, sends result back.
        if (payload.targetUserId !== game.user.id)
            return;
        (async () => {
            const rollActor = await fromUuid(payload.actorUuid);
            if (!rollActor) {
                game.socket.emit('module.lancer-automations', {
                    action: 'statRollResponse', payload: { requestId: payload.requestId, result: { completed: false } }
                });
                return;
            }
            const rollToken = rollActor.token?.object ?? rollActor.getActiveTokens()?.[0];
            const upperStat = payload.stat.toUpperCase();
            const cardResult = await startChoiceCard({
                title: payload.cardTitle || payload.title,
                description: payload.cardDescription || `<b>${rollToken?.name ?? rollActor.name}</b> must roll a ${upperStat} save.`,
                relatedToken: rollToken,
                choices: [{ text: `Roll ${upperStat} Save`, icon: "fas fa-dice" }]
            });
            let result = { completed: false };
            if (cardResult?.choiceIdx === 0) {
                result = await executeStatRoll(rollActor, payload.stat, payload.title, payload.targetVal ?? 10);
            }
            game.socket.emit('module.lancer-automations', {
                action: 'statRollResponse', payload: { requestId: payload.requestId, result }
            });
        })().catch(e => console.error('lancer-automations | statRollRequest error:', e));
    } else if (action === 'statRollResponse') {
        const resolve = _pendingFlowWaits.get(payload.requestId);
        if (resolve) {
            _pendingFlowWaits.delete(payload.requestId);
            resolve(payload.result ?? { completed: false });
        }
    } else if (action === 'syncPlaceholderVideos') {
        setTimeout(() => {
            for (let tokenId of payload.placeholderIds) {
                const token = canvas.tokens.get(tokenId);
                const video = token?.mesh?.texture?.baseTexture?.resource?.["source"];
                if (video instanceof HTMLVideoElement) {
                    video.currentTime = 0;
                    video.play().catch(() => {});
                }
            }
        }, 200);
    }
}

// Move history flags on token document:
//   lancer-automations.moveHistory  = { moves: Array<{ distanceMoved, isDrag, isFreeMovement, boostSet, startPos }> }
//   lancer-automations.movementCap  = number

// In-memory cache for move history (survives between preUpdateToken calls in multi-segment moves)
const _moveHistoryCache = new Map();

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
 * Compute move distances from preUpdateToken options.
 * Uses ElevationRuler segment data when available, falls back to 2D grid measurement.
 * @param {object} options           preUpdateToken options
 * @param {object} startPos          {x, y}
 * @param {object} endPos            {x, y}
 * @param {number} [elevationFallback=0]  elevation value used only in fallback path
 * @returns {{ distanceMoved: number, movementCost: number, isFreeMovement: boolean }}
 *   distanceMoved — physical squares traveled (no terrain penalty overhead)
 *   movementCost  — squares consumed from movement cap (includes terrain penalty)
 */
/**
 * Move a token as if dragged with the ruler.
 * Uses Elevation Ruler's API if available for correct cost, otherwise falls back to raw update.
 */
export async function _rulerMove(token, destination, extraOpts = {}) {
    const erApi = game.modules.get('elevationruler')?.active ? game.modules.get('elevationruler')?.api : null;
    if (erApi?.moveTokenTo) {
        // ER's simulated drag requires the token to be controlled; restore selection after.
        // ER's segment measurement reads FORCE_FREE_MOVEMENT at measure time (not from extraOpts),
        // so toggle it on for lancerFreeMovement callers and restore after.
        const Settings = erApi.Settings;
        const prevForceFree = Settings?.FORCE_FREE_MOVEMENT;
        const wantFree = !!extraOpts.lancerFreeMovement;
        const previouslyControlled = canvas.tokens.controlled.map(t => t.id);
        const needsTempControl = !token.controlled;
        try {
            if (wantFree && Settings)
                Settings.FORCE_FREE_MOVEMENT = true;
            if (needsTempControl)
                token.control({ releaseOthers: true });
            await erApi.moveTokenTo(token, destination, extraOpts);
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
        await token.document.update(update, { isDrag: true, ...extraOpts });
    }
}

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

    // Build updated move history and persist (only in combat — outside combat, keep in-memory only for the trigger call)
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
    }

    if (!isDrag || options.IgnoreOnMove)
        return;

    await handleTrigger('onMove', { triggeringToken: token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });
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
                ui.notifications.info(`${targetToken.name} is immune to Hits — attack misses!`);
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
 * @param {() => (() => Promise<void>)} opts.getIgnoreCallback - Returns the "ignore" action; called lazily.
 * @param {string} opts.defaultReason
 * @param {string} opts.defaultTitle
 * @param {string} [opts.choice1Text]
 * @param {string} [opts.choice2Text]
 * @param {((uc: string|null) => Object)|null} [opts.getExtraCardOptions]
 * @param {(() => Promise<void>)|null} [opts.onBefore] - Called before card, after preConfirms.
 * @param {(() => Promise<void>)|null} [opts.onAfter] - Called after card.
 * @returns {Function & { wait: () => Promise<any>|null }}
 */
function _buildCancelFn({ setFlag, cancelledBy, getIgnoreCallback, defaultReason, defaultTitle, choice1Text = "Cancel", choice2Text = "Ignore", getExtraCardOptions = null, onBefore = null, onAfter = null }) {
    if (!cancelledBy)
        console.error('lancer-automations | _buildCancelFn: missing cancelledBy array');
    const cancelledReasons = [];
    const preConfirms = [];
    let cardPending = false;
    let _promise = null;

    const fn = (reasonText = defaultReason, title = defaultTitle, showCard = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
        setFlag();
        if (!fn._reactorIdentity && !fn._engineCancel)
            console.error('lancer-automations | cancel called without _reactorIdentity');
        if (fn._reactorIdentity && cancelledBy)
            cancelledBy.push(fn._reactorIdentity);
        if (!showCard)
            return;
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
            return;
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
        flowState: state
    };

    await handleTrigger('onActivation', {
        triggeringToken: token,
        actionType: actionType,
        actionName: actionName,
        item,
        actionData,
        endActivation: state.la_extraData?.endActivation || false,
        extraData: state.la_extraData ?? {},
        flowState: state
    });

    if (token) {
        state.actor = token.actor;
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
    const item = state.item;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

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
        flowState: state
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

    // Called WITHOUT await — only synchronous evaluate functions work correctly with cancelAction.
    handleTrigger('onInitActivation', {
        triggeringToken: token,
        actionType,
        actionName,
        item,
        actionData,
        cancelAction,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelActivation) {
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
 * Runs before showDamageHUD in DamageRollFlow.
 */
async function knockbackInjectStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    injectKnockbackCheckbox(state);
    return true;
}

/**
 * Flow step that triggers knockback after damage is rolled in DamageRollFlow.
 * Reads the checkbox state from state.data._csmKnockback (set by knockbackInjectStep).
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
 * This is more reliable than insertStepAfter because it runs synchronously
 * inside the same call frame as _collectBonusDamage.
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
// Directly replaces the Lancer _preCreate and _onRelatedUpdate methods
// so Math.max(1, size) becomes just size, preventing any revert loop.
function patchHalfSizeTokens() {
    const docClass = CONFIG.Token.documentClass;
    if (!docClass)
        return;

    docClass.prototype._preCreate = async function (...[data, options, user]) {
        if (game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !this.getFlag(game.system.id, 'manual_token_size')) {
            const newSize = this.actor?.system?.size ?? 1;
            const updates = { width: newSize, height: newSize };
            // Center sub-1 tokens within their grid cell
            if (newSize < 1 && canvas?.grid) {
                const gs = canvas.grid.size;
                const offset = (1 - newSize) * gs / 2;
                updates.x = this.x + offset;
                updates.y = this.y + offset;
            }
            this.updateSource(updates);
        }
        // Skip Lancer's _preCreate (which has Math.max(1)), call grandparent directly
        return TokenDocument.prototype._preCreate.call(this, data, options, user);
    };

    docClass.prototype._onRelatedUpdate = function (update, options) {
        // Call grandparent _onRelatedUpdate (skip Lancer's which has Math.max(1))
        TokenDocument.prototype._onRelatedUpdate.call(this, update, options);
        if (game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !this.getFlag(game.system.id, 'manual_token_size')) {
            const newSize = this.actor ? this.actor.system.size : undefined;
            if (this.isOwner && this.id && newSize !== undefined
                && (this.width !== newSize || this.height !== newSize)) {
                this.update({ width: newSize, height: newSize });
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
    // Label — identical to the attack dialog's "Flat Modifier" header.
    const label = document.createElement('label');
    label.className = 'flexrow accdiff-weight lancer-border-primary';
    label.setAttribute('for', 'accdiff-flat-bonus');
    label.textContent = 'Flat Modifier';

    // Container grid — matches accdiff-grid accdiff-flat-bonus.
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
        input.value = (Number(input.value) || 0) + 1;
        update();
    });
    minusBtn.addEventListener('click', () => {
        input.value = (Number(input.value) || 0) - 1;
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
            // No damage configured but knockback is pending — let the flow continue
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
    // Register range injection steps (two IDs, same function — one fires before showAttackHUD,
    // one fires before printAttackCard; each self-destructs after its single use)
    // Register No Bonus Dmg steps
    flowSteps.set('lancer-automations:noBonusDmgInject', noBonusDmgInjectStep);
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

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onTechHitMiss');

    flows.get('DamageRollFlow')?.insertStepAfter('rollNormalDamage', 'lancer-automations:onDamage');
    flows.get('DamageRollFlow')?.insertStepAfter('lancer-automations:onDamage', 'lancer-automations:knockbackDamage');
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
    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onInitActivation');

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
    registerTokenStatBarSettings(); // Custom token stat bar (standalone setting)
    registerFlowStatePersistence();
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

            // Extend the climb-malus and terrain-immunity decisions with Lancer rules:
            // climber status and elevation/terrain immunity bonuses from the effect system.
            const baseClimbImmune = MovePenalty.isClimbingImmune.bind(MovePenalty);
            MovePenalty.isClimbingImmune = function(token) {
                if (baseClimbImmune(token))
                    return true;
                if (token?.actor?.statuses?.has("hover"))
                    return true;
                if (token?.actor?.statuses?.has("climber"))
                    return true;
                if (getImmunityBonuses(token?.actor, "elevation").length > 0)
                    return true;
                return false;
            };

            const baseTerrainImmune = MovePenalty.isTerrainImmune.bind(MovePenalty);
            MovePenalty.isTerrainImmune = function(token) {
                if (baseTerrainImmune(token))
                    return true;
                if (token?.actor?.statuses?.has("terrain_immunity"))
                    return true;
                if (getImmunityBonuses(token?.actor, "terrain").length > 0)
                    return true;
                return false;
            };
        });
    }

    if (game.modules.get("templatemacro")?.active) {
        Hooks.once("ready", () => {
            const tmApi = game.modules.get("templatemacro")?.api;
            if (!tmApi?.triggerDangerousZoneFlow)
                return;
            const orig = tmApi.triggerDangerousZoneFlow;
            tmApi.triggerDangerousZoneFlow = async function(token, ...args) {
                const immunityBonuses = getImmunityBonuses(token?.actor, "terrain");
                const hasStatusImmunity = token?.actor?.statuses.has("terrain_immunity");
                if (!hasStatusImmunity && immunityBonuses.length === 0)
                    return orig.call(this, token, ...args);

                const sources = [
                    ...immunityBonuses.map(b => b.name || b.id),
                    ...(hasStatusImmunity ? ["Terrain Immunity"] : [])
                ];
                const tokenObj = token?.object ?? token;
                const actorName = token?.actor?.name ?? "Token";
                await startChoiceCard({
                    title: "TERRAIN IMMUNITY",
                    description: `<b>${actorName}</b> entered dangerous terrain.<hr>Immunity from: <i>${sources.join(", ")}</i>`,
                    icon: "mdi mdi-boot",
                    mode: "or",
                    relatedToken: tokenObj,
                    userIdControl: getActiveGMId(),
                    choices: [
                        {
                            text: "Activate (Ignore Terrain)",
                            icon: "fas fa-shield-alt",
                            callback: async () => {
                                ui.notifications.info(`${actorName} ignored dangerous terrain.`);
                            }
                        },
                        {
                            text: "No (Apply Effect)",
                            icon: "fas fa-times",
                            callback: async () => {
                                await orig.call(this, token, ...args);
                            }
                        }
                    ]
                });
            };
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
    registerMeleeCoverFix(flowSteps, flows);
    registerUseAmmoFlow(flowSteps, flows); // Ammo flow
    registerInfectionFlows(flowSteps, flows); // Infection flow + stabilize/repair clearing
});

Hooks.once('ready', async () => {
    initAltStructReady();

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

    checkModuleUpdate('lancer-automations');
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
                    const multiplier = game.settings.get('lancer-automations', 'dragVisionMultiplier');
                    if (multiplier < 1) {
                        data.radius *= multiplier;
                        data.lightRadius *= multiplier;
                    }
                }
                return data;
            }, 'WRAPPER');
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

Hooks.on('hoverToken', (token, hovered) => {
    if (!deployableConnectionsGraphic || deployableConnectionsGraphic.destroyed) {
        return;
    }
    deployableConnectionsGraphic.clear();

    if (!hovered) {
        return;
    }

    // Only show lines if the user has ownership over the hovered token
    if (!token.actor?.isOwner) {
        return;
    }

    if (!game.settings.get('lancer-automations', 'showDeployableLines')) {
        return;
    }

    const sourceUuid = token.actor?.uuid;
    if (!sourceUuid) {
        return;
    }

    // Check if hovered token is a deployable itself
    const ownerUuidFlag = token.document.getFlag('lancer-automations', 'ownerActorUuid');

    const drawDashedLine = (g, x1, y1, x2, y2, dashLength = 8, spaceLength = 8) => {
        const dx = x2 - x1;
        const dy = y2 - y1;
        const distance = Math.hypot(dx, dy);
        const steps = Math.floor(distance / (dashLength + spaceLength));
        const dashX = (dx / distance) * dashLength;
        const dashY = (dy / distance) * dashLength;
        const spaceX = (dx / distance) * spaceLength;
        const spaceY = (dy / distance) * spaceLength;

        let cx = x1;
        let cy = y1;
        for (let i = 0; i < steps; i++) {
            g.moveTo(cx, cy);
            g.lineTo(cx + dashX, cy + dashY);
            cx += dashX + spaceX;
            cy += dashY + spaceY;
        }
        const rem = distance - (steps * (dashLength + spaceLength));
        if (rem > 0) {
            g.moveTo(cx, cy);
            if (rem > dashLength) {
                g.lineTo(cx + dashX, cy + dashY);
            } else {
                g.lineTo(x2, y2);
            }
        }
    };

    // 2px width, yellowish color (0xffd700 = Gold), 0.6 alpha
    deployableConnectionsGraphic.lineStyle(2, 0xffd700, 0.6);

    if (ownerUuidFlag) {
        // Hovered token is a deployable, draw line to its owner
        const ownerToken = canvas.tokens.placeables.find(t => t.actor?.uuid === ownerUuidFlag);
        if (ownerToken) {
            drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, ownerToken.center.x, ownerToken.center.y);
        }
    } else {
        // Hovered token is a potential owner, draw lines to all its deployables
        const deployables = canvas.tokens.placeables.filter(t =>
            t.document.getFlag('lancer-automations', 'ownerActorUuid') === sourceUuid
        );
        for (const dep of deployables) {
            drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, dep.center.x, dep.center.y);
        }
    }
});

// Clear deployable connection lines if a token is deleted (e.g. destroyed while hovering)
Hooks.on('deleteToken', () => {
    if (deployableConnectionsGraphic && !deployableConnectionsGraphic.destroyed) {
        deployableConnectionsGraphic.clear();
    }
});

Hooks.on('lancer.statusesReady', () => {
    // Always register infection — it's needed by the StatusFX auto-status logic
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

    // Dazed — only add if not already registered (e.g. by a status compendium)
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
        ...AurasAPI,
        ...ItemDisabledAPI,
        applyInfection,
        repairLCPData,
        TriggerUseAmmoFlow,
        // Internal main.js functions
        clearMoveData,
        undoMoveData,
        getCumulativeMoveData,
        getIntentionalMoveData,
        getMovementHistory,
        getMovementCap,
        increaseMovementCap,
        initMovementCap,
        processEffectConsumption,
        handleTrigger,
        registerUserHelper,
        getUserHelper,
        getActiveGMId,
        getTokenOwnerUserId,
        delayedTokenAppearance,
        // Tests
        tests: {
            cardStack: CardStackTests
        }
    });
    game.socket.on('module.lancer-automations', handleSocketEvent);

    initDelayedAppearanceHook();
    await syncBuiltinStartups();
    runStartupScripts(game.modules.get('lancer-automations').api);
    Hooks.callAll('lancer-automations.ready', game.modules.get('lancer-automations').api);

    // Extra trackable attributes (action_tracker.move / reaction on token bars)
    registerExtraTrackableAttributes();

    // Custom flow dispatch (handles module-registered flows from chat buttons)
    initCustomFlowDispatch();

    // StatusFX — TokenMagic visual effects for statuses
    initStatusFX();

    // Token stat bar — custom multi-bar token hub (Bar Brawl alternative)
    initTokenStatBar();

    // Infection — turn-end hooks
    initInfectionHooks();

    // Wreck system — token config tab
    initWreckTokenConfig();

    // Allow 0.5-size tokens instead of forcing minimum 1.
    if (game.settings.get('lancer-automations', 'allowHalfSizeTokens')) {
        patchHalfSizeTokens();
    }

    // Compatibility checker — detect and offer to fix conflicts with other modules
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

Hooks.on('renderChatMessage', (app, html, data) => {
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
        }
    }

});

// Init movement cap for all combatants when combat starts.
Hooks.on('combatStart', (combat) => {
    if (!game.settings.get('lancer-automations', 'enableMovementCapDetection')) {
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

    // Immunity check — block before the effect is ever created
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

Hooks.on('deleteToken', async (tokenDocument, _options, userId) => {
    if (userId !== game.userId)
        return;
    const token = canvas.tokens.get(tokenDocument.id)
        ?? { document: tokenDocument, id: tokenDocument.id, name: tokenDocument.name, actor: tokenDocument.actor };
    await handleTrigger('onTokenRemoved', { triggeringToken: token });
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
            let modifiedValue = null;

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

            const modifyHpChange = (newValue) => {
                modifiedValue = newValue;
            };

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
                blocked = true;
            } else if (modifiedValue !== null) {
                change.system.hp.value = modifiedValue;
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
            let modifiedValue = null;

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

            const modifyHeatChange = (newValue) => {
                modifiedValue = newValue;
            };

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
                blocked = true;
            } else if (modifiedValue !== null) {
                change.system.heat.value = modifiedValue;
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
Hooks.on('renderTileHUD', (app, html, context) => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        tileHUDButton(app, html, context);
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
        const sheet = game.settings.sheet;
        sheet.render(true);
        setTimeout(() => sheet.activateTab?.('lancer-automations'), 100);
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
        let _moveTrace = null;
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
            onBefore: async () => {
                _moveTrace = drawMovementTrace(token, endPos);
            },
            onAfter: async () => {
                if (_moveTrace?.parent)
                    _moveTrace.parent.removeChild(_moveTrace);
                _moveTrace.destroy();
                _moveTrace = null;
            },
        });
        // Adapter: preserves the original signature (no title param, showCard is 2nd).
        triggerData.cancelTriggeredMove = (reasonText = "This movement has been canceled.", showCard = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
            _cancelMoveCard._reactorIdentity = triggerData.cancelTriggeredMove._reactorIdentity;
            _cancelMoveCard._engineCancel = triggerData.cancelTriggeredMove._engineCancel;
            return _cancelMoveCard(reasonText, undefined, showCard, userIdControl, preConfirm, postChoice, opts);
        };

        triggerData.changeTriggeredMove = async (position, extraData = {}, reasonText = "This movement has been rerouted.", showCard = true, userIdControl = null, preConfirm = null, postChoice = null, { item = null, originToken = null, relatedToken = null } = {}) => {
            const executeChange = () => {
                setTimeout(async () => {
                    const dest = { x: position.x, y: position.y };
                    if (extraData.elevation !== undefined) {
                        dest.elevation = extraData.elevation;
                    }
                    await _rulerMove(token, dest, { isUndo: false, isModified: true, ...extraData });
                }, 50);
            };

            if (showCard) {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
                // Record who triggered this reroute
                const identity = triggerData.changeTriggeredMove._reactorIdentity;
                if (identity && triggerData._cancelledBy)
                    triggerData._cancelledBy.push(identity);

                if (preConfirm) {
                    const confirmed = await preConfirm();
                    if (!confirmed) {
                        executeChange();
                        return;
                    }
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
                                const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                                if (change.elevation !== undefined)
                                    originalUpdate.elevation = change.elevation;
                                token.document.update(originalUfpdate, { ...options, _cancelledBy: triggerData._cancelledBy, isDrag: true });
                            }}
                    ]
                });

                if (trace.parent)
                    trace.parent.removeChild(trace);
                trace.destroy();
            } else {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
                const identity = triggerData.changeTriggeredMove._reactorIdentity;
                if (identity && triggerData._cancelledBy)
                    triggerData._cancelledBy.push(identity);
                executeChange();
            }
        };

        // Movement cap check: block the move if it would exceed the cap (combat only, non-free moves)
        const isTokenInCombat = !!game.combat?.combatants.find(c => c.token?.id === token.id);
        if (!options.ignoreMovementCap
            && game.settings.get('lancer-automations', 'enableMovementCapDetection')
            && isTokenInCombat && !moveIsFreeMovement && moveToMovementCost > 0) {
            const cap = getMovementCap(token);
            const history = getMovementHistory(token);
            const spent = history.exists ? history.intentional.regularCost : 0;
            if (spent <= cap && spent + moveToMovementCost > cap) {
                const freeKey = game.keybindings.get('elevationruler', 'freeMovement')?.[0]?.key ?? '[free movement key]';
                const speed = token.actor?.system?.speed ?? 0;
                const canBoost = speed > 0 && (spent + moveToMovementCost) <= (cap + speed);
                options.ignoreMovementCap = true;
                triggerData.cancelTriggeredMove._engineCancel = true;

                // Always cancel first
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);

                const finalX = change.x ?? endPos.x;
                const finalY = change.y ?? endPos.y;
                const finalElev = change.elevation;

                if (canBoost && !options._skipBoostOffer) {
                    const remaining = cap - spent;
                    const totalDist = moveToMovementCost;
                    const ratio = totalDist > 0 ? Math.max(0, remaining / totalDist) : 0;
                    const midX = startPos.x + (endPos.x - startPos.x) * ratio;
                    const midY = startPos.y + (endPos.y - startPos.y) * ratio;

                    setTimeout(async () => {
                        const result = await startChoiceCard({
                            title: 'BOOST & MOVE',
                            icon: 'modules/lancer-automations/icons/black/speedometer.svg',
                            description: `Movement exceeds cap (${spent + moveToMovementCost}/${cap}). Boost adds +${speed}.`,
                            originToken: token,
                            userIdControl: getTokenOwnerUserId(token),
                            choices: [
                                { text: 'Boost & Move', icon: 'modules/lancer-automations/icons/black/speedometer.svg' },
                                { text: 'No', icon: 'fas fa-times' },
                            ]
                        });
                        if (/** @type {any} */ (result)?.choiceIdx !== 0) {
                            // Redo the original move, skip boost offer, fall back to normal cap check
                            await _rulerMove(token, { x: finalX, y: finalY, elevation: finalElev }, { _skipBoostOffer: true });
                            return;
                        }
                        // Step 1: move to cap boundary (no triggers, just position + tracking)
                        const snapMid = token.getSnappedPosition({ x: midX, y: midY });
                        await _rulerMove(token, snapMid, { IgnorePreMove: true });
                        // Step 2: boost
                        await new Promise(r => setTimeout(r, 800));
                        await executeSimpleActivation(token.actor, {
                            title: 'Boost',
                            action: { name: 'Boost', activation: 'Quick' },
                            detail: 'Move your speed.',
                        });
                        // Step 3: move to final destination (no triggers, just position + tracking)
                        await new Promise(r => setTimeout(r, 800));
                        await _rulerMove(token, { x: finalX, y: finalY, elevation: finalElev }, { IgnorePreMove: true });
                    }, 100);
                } else {
                    // No boost possible or boost declined — redo with normal cap check
                    setTimeout(() => {
                        const redoUpdate = { x: finalX, y: finalY };
                        if (finalElev !== undefined) {
                            redoUpdate.elevation = finalElev;
                        }
                        triggerData.cancelTriggeredMove(
                            `Not enough movement points (${spent + moveToMovementCost} > ${cap}). ` +
                            `Hold <b>${freeKey}</b> for free movement.`
                        );
                    }, 100);
                }
            }
        }

        // Call handleTrigger without await. If onPreMove reactions are synchronous,
        // cancelUpdate will be set to true before we check it on the next line.
        // Skip if already cancelled by cap/boost check (no need to trigger reactions on a cancelled move)
        if (!cancelUpdate) {
            handleTrigger('onPreMove', { triggeringToken: token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo, cancel: triggerData.cancel, cancelTriggeredMove: triggerData.cancelTriggeredMove, changeTriggeredMove: triggerData.changeTriggeredMove, _cancelledBy: triggerData._cancelledBy });
        }

        if (cancelUpdate) {
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
