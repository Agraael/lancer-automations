import { drawThreatDebug, drawDistanceDebug, getTokenDistance, isHostile, isFriendly, checkOverwatchCondition, getActorMaxThreat, getMinGridDistance, canEngage, updateAllEngagements } from "./overwatch.js";
import { ReactionManager, stringToFunction, ReactionConfig } from "./reaction-manager.js";
import { packMacros, executePackMacro } from "./compendium-tools.js";
import { ReactionReset } from "./reaction-reset.js";
import { ReactionExport, ReactionImport } from "./reaction-export-import.js";
import { displayReactionPopup, activateReaction } from "./reactions-ui.js";
import { registerExternalItemReactions, registerExternalGeneralReactions } from "./reactions-registry.js";
import { cancelRulerDrag } from './interactive-tools.js';
import {
    setFlaggedEffect,
    removeFlaggedEffect,
    applyFlaggedEffectToTokens,
    removeFlaggedEffectToTokens,
    findFlaggedEffectOnToken,
    consumeEffectCharge,
    processDurationEffects,
    triggerFlaggedEffectImmunity,
    executeDeleteAllFlaggedEffect,
    initCollapseHook
} from "./flagged-effects.js";
import { getOccupiedCenters,    getMovementPathHexes,
    drawDebugPath,
    snapTokenCenter,
    isHexGrid, getOccupiedOffsets, drawHexAt
} from "./grid-helpers.js";
import {
    addGlobalBonus,
    removeGlobalBonus,
    getGlobalBonuses,
    addConstantBonus,
    removeConstantBonus,
    getConstantBonuses,
    executeGenericBonusMenu,
    injectBonusToNextRoll,
    genericAccuracyStepAttack,
    genericAccuracyStepTechAttack,
    genericAccuracyStepWeaponAttack,
    genericAccuracyStepStatRoll,
    genericBonusStepDamage
} from "./genericBonuses.js";
import { executeEffectManager, openItemBrowser } from "./effectManager.js";
import { getTokenCells, getMaxGroundHeightUnderToken } from "./terrain-utils.js";
import {
    chooseToken, placeZone, knockBackToken, applyKnockbackMoves,
    placeToken, startChoiceCard, deployWeaponToken, pickupWeaponToken,
    resolveDeployable, placeDeployable, deployDeployable, beginDeploymentCard, openDeployableMenu, recallDeployable,
    openThrowMenu,
    getGridDistance, drawRangeHighlight, revertMovement, clearMovementHistory,
    showGMControlledChoiceCard, resolveGMChoiceCard
} from "./interactive-tools.js";
import {
    executeFall, getItemLID, isItemAvailable, hasReactionAvailable,
    executeStatRoll, executeDamageRoll, executeBasicAttack,
    executeTechAttack, executeSimpleActivation, executeReactorMeltdown, executeReactorExplosion
} from "./misc-tools.js";
import { checkModuleUpdate } from "./version-check.js";
import { registerModuleFlows } from "./flows.js";
import { executeDowntime } from "./downtime.js";
import { executeScanOnActivation, performSystemScan, performGMInputScan } from "./scan.js";


let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;
let cachedFlatGeneralReactions = null;

Hooks.on('lancer-automations.clearCaches', () => {
    cachedFlatGeneralReactions = null;
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

    const itemTypes = ["frame", "mech_system", "mech_weapon", "npc_feature", "pilot_gear", "talent"];
    let items = actor.items.filter(item => itemTypes.includes(item.type));

    if (actor.type === "mech") {
        let pilot = null;
        const pilotRef = actor.system.pilot;

        if (pilotRef) {
            if (typeof pilotRef === 'object' && pilotRef.id) {
                const idStr = pilotRef.id;
                if (idStr.startsWith('Actor.')) {
                    pilot = fromUuidSync(idStr);
                } else {
                    pilot = game.actors.get(idStr);
                }
            } else if (typeof pilotRef === 'string') {
                if (pilotRef.startsWith('Actor.')) {
                    pilot = fromUuidSync(pilotRef);
                } else {
                    pilot = game.actors.get(pilotRef);
                }
            }
        }

        if (pilot) {
            const pilotItems = pilot.items.filter(item => itemTypes.includes(item.type));
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

async function checkOnInitReactions(token) {
    // 1. Check Item-based onInit
    const items = getReactionItems(token);

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
                    await reaction.onInit(token, item);
                } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                    const onInitFunc = stringToFunction(reaction.onInit, ["token", "item"]);
                    await onInitFunc(token, item);
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
                await reaction.onInit(token, null);
            } else if (typeof reaction.onInit === 'string' && reaction.onInit.trim() !== '') {
                const onInitFunc = stringToFunction(reaction.onInit, ["token", "item"]);
                await onInitFunc(token, null);
            }
        } catch (error) {
            console.error(`lancer-automations | Error executing onInit for General Activation ${name}:`, error);
        }
    }
}


function evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat) {
    if (!isInCombat && !reaction.outOfCombat) {
        if ((token?.isOwner || game.user.isGM) && game.settings.get('lancer-automations', 'debugOutOfCombat'))
            ui.notifications.warn(`${reactionName} (${token?.name ?? '?'}): not triggered — out of combat.`);
        return null;
    }
    if (isSelf && !reaction.triggerSelf)
        return null;
    if (!isSelf && reaction.triggerOther === false)
        return null;
    if (reaction.consumesReaction && !hasReactionAvailable(token))
        return null;
    if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
        return null;

    try {
        const sourceToken = data.triggeringToken;
        const distanceToTrigger = (sourceToken && token) ? getTokenDistance(token, sourceToken) : null;
        const enrichedData = { ...data, distanceToTrigger };

        let shouldTrigger = false;
        if (typeof reaction.evaluate === 'function') {
            const result = reaction.evaluate(triggerType, enrichedData, token, null, reactionName);
            if (result instanceof Promise) {
                console.warn(`lancer-automations | evaluate for "${reactionName}" is async. Async evaluate functions run asynchronously and cannot use cancel(). Consider making it synchronous.`);
                result.then(val => { /* fire-and-forget async evaluate */ });
                shouldTrigger = false;
            } else {
                shouldTrigger = result;
            }
        } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName"], reaction);
            const result = evalFunc(triggerType, enrichedData, token, null, reactionName);
            if (result instanceof Promise) {
                console.warn(`lancer-automations | String evaluate for "${reactionName}" returned a Promise. Async evaluate cannot use cancel().`);
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

async function checkReactions(triggerType, data) {
    const allTokens = getAllSceneTokens();
    const reactionsPromises = [];

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

    const _matchActionReaction = ([name, r]) =>
        name === data.actionName && r.onlyOnSourceMatch && r.triggers?.includes(triggerType);
    const actionBasedReaction = data.actionName ?
        flatGeneralReactions.find(_matchActionReaction)?.[1] ?
            { name: data.actionName, reaction: flatGeneralReactions.find(_matchActionReaction)[1] } : null
        : null;

    const nonActionBasedReactions = [];
    for (const [reactionName, reaction] of flatGeneralReactions) {
        if (reaction.onlyOnSourceMatch)
            continue;
        if (!reaction.triggers?.includes(triggerType))
            continue;
        if (reaction.enabled === false)
            continue;
        nonActionBasedReactions.push([reactionName, reaction]);
    }

    const hasValidActionBasedReaction = actionBasedReaction &&
        actionBasedReaction.reaction.enabled !== false;

    for (const token of allTokens) {
        const isSelf = data.triggeringToken?.id === token.id;
        const isInCombat = token.inCombat;

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

                if (!isInCombat && !reaction.outOfCombat) {
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

                if (reaction.consumesReaction && !hasReactionAvailable(token))
                    continue;

                const reactionPath = reaction.reactionPath || "";
                if (!isItemAvailable(item, reactionPath))
                    continue;

                if (!checkDispositionFilter(token, data.triggeringToken, reaction.dispositionFilter))
                    continue;

                try {
                    const sourceToken = data.triggeringToken;
                    let distanceToTrigger = null;
                    if (sourceToken && token) {
                        distanceToTrigger = getTokenDistance(token, sourceToken);
                    }

                    const enrichedData = { ...data, distanceToTrigger };

                    let activationName = item.name;
                    const reactionPath = reaction.reactionPath || "";

                    if (reactionPath && reactionPath !== "" && reactionPath !== "system" && reactionPath !== "system.trigger") {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
                        let actionData = item.system;
                        for (const part of pathParts) {
                            if (actionData && (typeof actionData === 'object' || Array.isArray(actionData))) {
                                actionData = actionData[part];
                            } else {
                                actionData = null;
                                break;
                            }
                        }
                        if (actionData && actionData.name) {
                            activationName = actionData.name;
                        }
                    }

                    let shouldTrigger = false;

                    if (typeof reaction.evaluate === 'function') {
                        const result = reaction.evaluate(triggerType, enrichedData, token, item, activationName);
                        if (result instanceof Promise) {
                            console.warn(`lancer-automations | evaluate for "${item.name}" is async. Async evaluate functions run asynchronously and cannot use cancel(). Consider making it synchronous.`);
                            result.then(val => { /* fire-and-forget */ });
                            shouldTrigger = false;
                        } else {
                            shouldTrigger = result;
                        }
                    } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                        try {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName"], reaction);
                            const result = evalFunc(triggerType, enrichedData, token, item, activationName);
                            if (result instanceof Promise) {
                                console.warn(`lancer-automations | String evaluate for "${item.name}" returned a Promise. Async evaluate cannot use cancel().`);
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
                        if (reaction.autoActivate) {
                            try {
                                const p = activateReaction(triggerType, enrichedData, token, item, activationName, reaction, false);
                                if (p instanceof Promise) {
                                    p.catch(error => console.error(`lancer-automations | Error auto-activating reaction:`, error));
                                    if (reaction.forceSynchronous !== false) {
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
                                triggerData: enrichedData
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
                if (reaction.autoActivate) {
                    try {
                        const p = activateReaction(triggerType, enrichedData, token, null, reactionName, reaction, true);
                        if (p instanceof Promise) {
                            p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                            if (reaction.forceSynchronous !== false) {
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
                        triggerData: enrichedData
                    });
                }
            }
        }

        for (const [reactionName, reaction] of nonActionBasedReactions) {
            const enrichedData = evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
                if (reaction.autoActivate) {
                    try {
                        const p = activateReaction(triggerType, enrichedData, token, null, reactionName, reaction, true);
                        if (p instanceof Promise) {
                            p.catch(error => console.error(`lancer-automations | Error auto-activating general reaction:`, error));
                            if (reaction.forceSynchronous !== false) {
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
                        triggerData: enrichedData
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
    const reactionsPromise = checkReactions(triggerType, data);
    const consumptionPromise = processEffectConsumption(triggerType, data);
    await reactionsPromise;
    await consumptionPromise;
}


function registerSettings() {
    // ── Core ──
    game.settings.register('lancer-automations', 'reactionNotificationMode', {
        name: 'Notification Mode',
        hint: 'Who should see the activation popup? (GM/Owner)',
        scope: 'world',
        config: true,
        type: String,
        choices: {
            "both": "GM and Owner",
            "gm": "GM Only",
            "owner": "Owner Only"
        },
        default: "both"
    });

    game.settings.register('lancer-automations', 'consumeReaction', {
        name: 'Consume Activation on Activate',
        hint: 'Automatically reduce reaction count by 1 when activating an activation.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Show a button on the Token HUD to open the Lancer Effect Manager.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    // ── Features ──
    game.settings.register('lancer-automations', 'additionalStatuses', {
        name: 'LaSossis Additional statutes and effects',
        hint: 'If enabled, registers additional statuses and effects from Lancer Automations into the standard status effects list.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'enableKnockbackFlow', {
        name: 'Automate Knockback on Hit',
        hint: 'If enabled, successful hits with weapons/tech that have the "Knockback X" tag will automatically trigger the Knockback tool on the targets.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableThrowFlow', {
        name: 'Automate Throw Choice for Thrown Weapons',
        hint: 'If enabled, weapons with the "Thrown" tag will show a choice card asking to Attack or Throw at the start of the attack flow.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'statRollTargeting', {
        name: 'Enable Stat Roll Target Selection',
        hint: 'If enabled, stat rolls (HULL, AGI, etc.) will prompt for an optional target to calculate difficulty (Save Target vs Stat).',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'treatGenericPrintAsActivation', {
        name: 'Treat Generic Prints as Activations',
        hint: 'If enabled, items printed to chat using the generic method (SimpleHTMLFlow) will trigger onActivation events. Use this to automate items that lack specific mechanical flows.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enablePathHexCalculation', {
        name: 'Enable Path Hex Calculation',
        hint: 'Calculates the token\'s exact path hexes during movement. Essential for accurate onPreMove and onMove interception. Works best with my Elevation Ruler fork.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'experimentalBoostDetection', {
        name: 'Experimental Boost Detection (WIP)',
        hint: 'Detect Boost based on cumulative drag movement exceeding the token base speed. Adds moveInfo (isBoost, boostSet) to onMove triggerData. Requires Elevation Ruler or my own fork.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
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
    } else if (action === 'setFlaggedEffect') {
        setFlaggedEffect(payload.targetID, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions);
    } else if (action === 'removeFlaggedEffect') {
        removeFlaggedEffect(payload.targetID, payload.effect, payload.originID, payload.extraFlags ?? null);
    } else if (action === 'removeEffect') {
        const target = canvas.tokens.get(payload.targetID);
        if (target?.actor) {
            target.actor.deleteEmbeddedDocuments("ActiveEffect", [payload.effectID]);
        }
    } else if (action === 'moveTokens') {
        if (!game.user.isGM)
            return;
        const trigToken = payload.triggeringTokenId ? canvas.tokens.get(payload.triggeringTokenId) : null;
        const kbItem = payload.itemId
            ? (canvas.tokens.placeables.find(t => t.actor?.items?.get(payload.itemId))?.actor?.items?.get(payload.itemId) ?? null)
            : null;
        applyKnockbackMoves(payload.moves, trigToken, payload.distance, payload.actionName || "", kbItem);
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
        const ownerActor = await fromUuid(payload.ownerActorUuid);
        if (ownerActor) {
            const weapon = ownerActor.items.get(payload.weaponId);
            if (weapon)
                await weapon.update({ 'system.disabled': false });
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
                        const customName = html.find('[name="custom-journal-name"]').val().trim();
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
        }, { classes: ["lancer-dialog-base"], width: 450 }).render(true);
    } else if (action === 'choiceCardGMRequest') {
        if (!game.user.isGM)
            return;
        showGMControlledChoiceCard(payload);
    } else if (action === 'choiceCardGMResponse') {
        if (payload.requestingUserId !== game.userId)
            return;
        resolveGMChoiceCard(payload.cardId, payload.choiceIdx);
    }
}

const cumulativeMoveData = new Map();
const intentionalMoveData = new Map();

function clearMoveData(tokenId) {
    cumulativeMoveData.delete(tokenId);
    intentionalMoveData.delete(tokenId);
}

function undoMoveData(tokenId, distance) {
    const current = cumulativeMoveData.get(tokenId) || 0;
    const newVal = Math.max(0, current - distance);
    cumulativeMoveData.set(tokenId, newVal);

    const currentIntentional = intentionalMoveData.get(tokenId) || 0;
    const newIntentional = Math.max(0, currentIntentional - distance);
    intentionalMoveData.set(tokenId, newIntentional);
}

function getCumulativeMoveData(tokenDocId) {
    return cumulativeMoveData.get(tokenDocId) || 0;
}

function getIntentionalMoveData(tokenDocId) {
    return intentionalMoveData.get(tokenDocId) || 0;
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

    let distanceMoved = 0;
    if (canvas.grid.measurePath) {
        distanceMoved = canvas.grid.measurePath([startPos, endPos]).distance;
    } else {
        distanceMoved = canvas.grid.measureDistance(startPos, endPos);
    }
    distanceMoved = Math.round(distanceMoved / canvas.scene.grid.distance);

    const isDrag = 'rulerSegment' in options || options.isDrag;
    const isTeleport = !!options.teleport;

    // Check for Elevation Ruler free movement (not counted in cumulative boost tracking)
    let isFreeMovement = false;
    const elevationRulerSettings = game.modules.get('elevationruler')?.api?.Settings;
    if (elevationRulerSettings?.FORCE_FREE_MOVEMENT) {
        isFreeMovement = true;
    }

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

    // Update Cumulative (Total) Movement
    const prev = cumulativeMoveData.get(document.id) || 0;
    const cumulative = prev + distanceMoved;
    if (!isFreeMovement) {
        cumulativeMoveData.set(document.id, cumulative);
        // Intentional: Only if Voluntary (isDrag) AND not Free
        if (isDrag) {
            const prevIntentional = intentionalMoveData.get(document.id) || 0;
            intentionalMoveData.set(document.id, prevIntentional + distanceMoved);
        }
    }

    // Boost detection only when enabled
    if (game.settings.get('lancer-automations', 'experimentalBoostDetection') && isDrag && !isFreeMovement) {
        const speed = token.actor?.system?.speed || 0;
        const currentIntentional = intentionalMoveData.get(document.id) || 0;
        const prevIntentional = (currentIntentional - distanceMoved);

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
            ui.notifications.info(`${token.name}: moved ${distanceMoved}, intentional ${currentIntentional}/${speed} | isBoost: ${moveInfo.isBoost}, boostSet: [${boostSet.join(',')}]`);
        }
    }

    await handleTrigger('onMove', { triggeringToken: token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });
}

async function onAttackStep(state) {
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
        stateData: state.data
    };

    await handleTrigger('onAttack', {
        triggeringToken: token,
        weapon,
        targets,
        attackType: actionData.attack_type,
        actionName: actionData.title,
        tags: actionData.tags,
        actionData
    });
    return true;
}

async function onHitMissStep(state) {
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
        stateData: state.data
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
        await handleTrigger('onHit', {
            triggeringToken: token,
            weapon,
            targets: hitTargets,
            attackType: actionData.attack_type,
            actionName: actionData.title,
            tags: actionData.tags,
            actionData
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
            actionData
        });
    }

    return true;
}

async function onDamageStep(state) {
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
        stateData: state.data
    };

    for (const targetInfo of targets) {
        const targetToken = targetInfo.target;
        const isCrit = targetInfo.crit || false;
        const isHit = targetInfo.hit || false;
        const targetDamages = targetInfo.damage?.map(d => d.amount) || [];
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
                actionData
            });
        }
    }

    return true;
}

async function onStructureStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStructure = actor?.system?.structure?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    await handleTrigger('onStructure', { triggeringToken: token, remainingStructure, rollResult });
    return true;
}

async function onStressStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStress = actor?.system?.stress?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    await handleTrigger('onStress', { triggeringToken: token, remainingStress, rollResult });
    return true;
}

async function onTechAttackStep(state) {
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
        stateData: state.data
    };

    await handleTrigger('onTechAttack', {
        triggeringToken: token,
        techItem,
        targets,
        actionName: actionData.title,
        isInvade: actionData.isInvade,
        tags: actionData.tags,
        actionData
    });
    return true;
}

async function onTechHitMissStep(state) {
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
        stateData: state.data
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
            actionData
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
            actionData
        });
    }

    return true;
}

async function onCheckStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    const roll = state.data?.result?.roll;
    const total = roll?.total;
    state.data.targetVal = state.data.targetVal? state.data.targetVal : 10;
    const success = total >= state.data.targetVal;

    await handleTrigger('onCheck', {
        triggeringToken: token,
        statName,
        roll,
        total,
        success,
        checkAgainstToken: state.data.targetToken,
        targetVal: state.data.targetVal
    });
    return true;
}

async function onInitCheckStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    state.data.targetVal = state.data.targetVal ? state.data.targetVal : 10;

    await handleTrigger('onInitCheck', {
        triggeringToken: token,
        statName,
        checkAgainstToken: state.data.targetToken,
        targetVal: state.data.targetVal
    });

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

    const actionData = {
        type: state.data?.type || "attack",
        title: state.data?.title || weapon?.name || "Attack",
        action: {
            name: state.data?.title || weapon?.name || "Attack"
        },
        detail: state.data?.effect || weapon?.system?.effect || "",
        attack_type: state.data?.attack_type || "Ranged",
        tags: state.data?.tags || weapon?.system?.tags || [],
        stateData: state.data
    };

    await handleTrigger('onInitAttack', {
        triggeringToken: token,
        weapon,
        targets,
        actionName: actionData.title,
        tags: actionData.tags,
        actionData
    });

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

    const actionData = {
        type: state.data?.type || "tech",
        title: state.data?.title || techItem?.name || "Tech Attack",
        action: {
            name: state.data?.title || techItem?.name || "Tech Attack"
        },
        detail: state.data?.effect || techItem?.system?.effect || "",
        isInvade: state.data?.invade || false,
        tags: state.data?.tags || techItem?.system?.tags || [],
        stateData: state.data
    };

    await handleTrigger('onInitTechAttack', {
        triggeringToken: token,
        techItem,
        targets,
        actionName: actionData.title,
        isInvade: actionData.isInvade,
        tags: actionData.tags,
        actionData
    });

    if (token) {
        state.actor = token.actor;
    }
    return true;
}

async function onActivationStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const item = state.item;

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
        action: state.data?.action || {
            name: actionName,
            activation: actionType
        },
        detail: state.data?.detail || item?.system?.effect || "",
        tags: tags,
        stateData: state.data
    };

    await handleTrigger('onActivation', {
        triggeringToken: token,
        actionType: actionType,
        actionName: actionName,
        item,
        actionData
    });

    if (token) {
        state.actor = token.actor;
    }
    return true;
}

async function statRollTargetSelectStep(state) {
    if (!game.settings.get('lancer-automations', 'statRollTargeting')) {
        return true;
    }

    // If target already provided (e.g. via executeStatRoll), skip
    if (state.data.targetToken || state.data.chooseToken === false) {
        return true;
    }

    const actor = state.actor;
    const token = actor.token?.object || canvas.tokens.get(actor.token?.id) || canvas.tokens.controlled[0];
    if (!token) {
        return true;
    }

    // Infer stat from path (e.g. system.hull -> HULL)
    let statName = "STAT";
    if (state.data.path) {
        const parts = state.data.path.split('.');
        statName = parts[parts.length - 1].toUpperCase();
    }

    const targets = await chooseToken(token, {
        title: `${statName} SAVE TARGET`,
        description: `Select a target to make it a Skill Save (Optional)`,
        count: 1,
        range: null,
        includeSelf: true // Allow self-targeting if needed
    });

    if (targets && targets.length > 0) {
        const targetToken = targets[0];
        state.data.targetToken = targetToken;

        let targetVal = 10;
        const targetActor = targetToken.actor;

        if (targetActor.type === "npc" || targetActor.type === "deployable") {
            targetVal = targetActor.system.save || 10;
        } else if (targetActor.type === "mech") {
            // Try to map back to a stat path
            const path = state.data.path;
            targetVal = foundry.utils.getProperty(targetActor, path) || 10;
        }

        state.data.targetVal = targetVal;

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
    if (state.data?.is_throw)
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
    const weaponRanges = (profile?.range || item.system?.range || [])
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
    state.data.is_throw = isThrow;
    return true;
}

async function throwDeployStep(state) {
    if (!state.data?.is_throw)
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

async function beginThrowWeaponFlow(weapon) {
    const WeaponAttackFlow = CONFIG.lancer?.flowClasses?.WeaponAttackFlow;
    if (WeaponAttackFlow) {
        const flow = new WeaponAttackFlow(weapon);
        flow.state.data.is_throw = true;
        await flow.begin();
    } else {
        await weapon.beginWeaponAttackFlow(true);
    }
}

async function knockbackStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;

    const item = state.item; // Weapon or Tech
    if (!item)
        return true;
    const tags = state.data?.tags || item.system?.tags || [];
    const kbTag = tags.find(t => t.id === "knockback");
    if (!kbTag)
        return true;

    let distance = parseInt(kbTag.val);
    if (isNaN(distance) || distance <= 0)
        distance = 1;
    const hitResults = state.data?.hit_results || [];
    const targetInfos = state.data?.acc_diff?.targets || [];
    const hitTokens = [];

    for (let i = 0; i < hitResults.length; i++) {
        if (hitResults[i]?.hit) {
            const tDoc = targetInfos[i]?.target;
            const t = tDoc?.object || (tDoc?.id ? canvas.tokens.get(tDoc.id) : null);
            if (t) {
                hitTokens.push(t);
            }
        }
    }

    const attackerToken = state.actor?.token?.object || canvas.tokens.get(state.actor?.token?.id) || state.actor?.getActiveTokens()?.[0];
    if (hitTokens.length > 0) {
        await knockBackToken(hitTokens, distance, {
            title: `${item.name} Knockback`,
            triggeringToken: attackerToken
        });
    }

    return true;
}

function insertModuleFlowSteps(flowSteps, flows) {
    flowSteps.set('lancer-automations:onAttack', onAttackStep);
    flowSteps.set('lancer-automations:onHitMiss', onHitMissStep);
    flowSteps.set('lancer-automations:onDamage', onDamageStep);
    flowSteps.set('lancer-automations:onStructure', onStructureStep);
    flowSteps.set('lancer-automations:onStress', onStressStep);
    flowSteps.set('lancer-automations:onTechAttack', onTechAttackStep);
    flowSteps.set('lancer-automations:onTechHitMiss', onTechHitMissStep);
    flowSteps.set('lancer-automations:onCheck', onCheckStep);
    flowSteps.set('lancer-automations:onActivation', onActivationStep);
    flowSteps.set('lancer-automations:onInitCheck', onInitCheckStep);
    flowSteps.set('lancer-automations:onInitAttack', onInitAttackStep);
    flowSteps.set('lancer-automations:onInitTechAttack', onInitTechAttackStep);
    // Register Knockback step
    flowSteps.set('lancer-automations:knockback', knockbackStep);
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

    flows.get('BasicAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepTechAttack');
    flows.get('WeaponAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepWeaponAttack');

    // Insert onInitAttack/TechAttack steps
    flows.get('BasicAttackFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepAttack', 'lancer-automations:onInitAttack');
    flows.get('WeaponAttackFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepWeaponAttack', 'lancer-automations:onInitAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepTechAttack', 'lancer-automations:onInitTechAttack');

    // Insert targeting step BEFORE HUD
    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:statRollTargetSelect');
    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:genericAccuracyStepStatRoll');

    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:genericBonusStepDamage');

    flows.get('WeaponAttackFlow')?.insertStepBefore('initAttackData', 'lancer-automations:throwChoice');
    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('WeaponAttackFlow')?.insertStepAfter('lancer-automations:onHitMiss', 'lancer-automations:knockback');
    flows.get('WeaponAttackFlow')?.insertStepAfter('lancer-automations:knockback', 'lancer-automations:throwDeploy');

    flows.get('BasicAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('BasicAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('BasicAttackFlow')?.insertStepAfter('lancer-automations:onHitMiss', 'lancer-automations:knockback');

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onTechHitMiss');
    flows.get('TechAttackFlow')?.insertStepAfter('lancer-automations:onTechHitMiss', 'lancer-automations:knockback');

    flows.get('DamageRollFlow')?.insertStepAfter('rollNormalDamage', 'lancer-automations:onDamage');

    flows.get('StructureFlow')?.insertStepAfter('rollStructureTable', 'lancer-automations:onStructure');
    flows.get('OverheatFlow')?.insertStepAfter('rollOverheatTable', 'lancer-automations:onStress');

    flows.get('StatRollFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepStatRoll', 'lancer-automations:onInitCheck');
    flows.get('StatRollFlow')?.insertStepAfter('rollCheck', 'lancer-automations:onCheck');

    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SystemFlow')?.insertStepAfter('printSystemCard', 'lancer-automations:onActivation');

}

Hooks.on('init', () => {
    console.log('lancer-automations | Init');
    registerSettings();
});

Hooks.on("lancer.registerFlows", (flowSteps, flows) => {
    registerModuleFlows(flowSteps, flows);
    insertModuleFlowSteps(flowSteps, flows);
});

Hooks.once('ready', async () => {
    if (game.settings.get('lancer-automations', 'treatGenericPrintAsActivation')) {
        const flows = game.lancer?.flows;
        flows?.get('SimpleHTMLFlow')?.insertStepAfter('printGenericHTML', 'lancer-automations:onActivation');
    }

    if (game.user.isGM) {
        for (const tokenDoc of game.scenes.active?.tokens ?? []) {
            const actor = tokenDoc.actor;
            if (!actor)
                continue;
            if (actor.getFlag("lancer-automations", "ephemeral_bonuses")?.length)
                await actor.setFlag("lancer-automations", "ephemeral_bonuses", []);
        }
    }

    checkModuleUpdate('lancer-automations');
    initCollapseHook();
});

// After each scene load (including page reload), force-refresh all token effects so
// the collapse wrapper runs even if tokens were drawn before our hook was registered.
Hooks.on('canvasReady', () => {
    canvas.tokens?.placeables.forEach(t => t.renderFlags?.set({ refreshEffects: true }));
});

Hooks.on('lancer.statusesReady', () => {
    if (!game.settings.get('lancer-automations', 'additionalStatuses'))
        return;

    CONFIG.statusEffects.push({
        id: "resistance_all",
        name: "Resist All",
        img: "modules/lancer-automations/icons/resist_all.svg",
        changes: [
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ]
    });

    CONFIG.statusEffects.push({
        id: "immovable",
        name: "Immovable",
        img: "modules/lancer-automations/icons/immovable.svg",
        description: "Cannot be moved"
    });

    CONFIG.statusEffects.push({
        id: "disengage",
        name: "Disengage",
        img: "modules/lancer-automations/icons/disengage.svg",
        description: "You ignore engagement and your movement does not provoke reactions"
    });

    CONFIG.statusEffects.push({
        id: "destroyed",
        name: "Destroyed",
        img: "modules/lancer-automations/icons/destroyed.svg",
        description: "You are destroyed"
    });

    CONFIG.statusEffects.push({
        id: "grappling",
        name: "Grappling",
        img: "modules/lancer-automations/icons/grappling.svg",
        description: "You are grappling in a grapple contest",
        changes: [
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ]
    });

    CONFIG.statusEffects.push({
        id: "grappled",
        name: "Grappled",
        img: "modules/lancer-automations/icons/grappled.svg",
        description: "You are grappled in a grapple contest",
        changes: [
            { key: "system.statuses.engaged", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.action_tracker.reaction", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "false" },
        ]
    });

    CONFIG.statusEffects.push({
        id: "falling",
        name: "Falling",
        img: "modules/lancer-automations/icons/falling.svg",
        description: "Characters take damage when they fall 3 or more spaces and cannot recover before hitting the ground. Characters fall 10 spaces per round in normal gravity, but can't fall in zero-G or very low-G environments. They take 3 Kinetic AP (armour piercing) damage for every three spaces fallen, to a maximum of 9 Kinetic AP. Falling is a type of involuntary movement."
    });

    CONFIG.statusEffects.push({
        id: "lagging",
        name: "Lagging",
        img: "modules/lancer-automations/icons/lagging.svg",
        description: "You can only take a quick action"
    });

    CONFIG.statusEffects.push({
        id: "infection",
        name: "Infection",
        img: "modules/lancer-automations/icons/infection.svg",
        description: "Works in the same way as burn but target heat instead"
    });

    CONFIG.statusEffects.push({
        id: "throttled",
        name: "Throttled",
        img: "modules/lancer-automations/icons/throttled.svg",
        description: "Deals Half damage, heat, and burn on attacks"
    });

    CONFIG.statusEffects.push({
        id: "brace",
        name: "Brace",
        img: "modules/lancer-automations/icons/brace.svg",
        changes: [
            { key: "system.resistances.burn", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.energy", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.explosive", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.heat", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" },
            { key: "system.resistances.kinetic", mode: CONST.ACTIVE_EFFECT_MODES.OVERRIDE, value: "true" }
        ]
    });
});

Hooks.on('ready', () => {
    console.log('lancer-automations | Ready');

    ReactionManager.initialize();

    game.modules.get('lancer-automations').api = {
        drawThreatDebug,
        drawDistanceDebug,
        getTokenDistance,
        checkOverwatchCondition,
        isHostile,
        isFriendly,
        getActorMaxThreat,
        getMinGridDistance,
        canEngage,
        updateAllEngagements,
        registerDefaultItemReactions: registerExternalItemReactions,
        registerDefaultGeneralReactions: registerExternalGeneralReactions,
        clearMoveData,
        applyFlaggedEffectToTokens,
        removeFlaggedEffectToTokens,
        findFlaggedEffectOnToken,
        consumeEffectCharge,
        processEffectConsumption,
        processDurationEffects,
        executeDeleteAllFlaggedEffect,
        addGlobalBonus,
        removeGlobalBonus,
        getGlobalBonuses,
        addConstantBonus,
        removeConstantBonus,
        getConstantBonuses,
        executeGenericBonusMenu,
        injectBonusToNextRoll,
        executeEffectManager,
        openItemBrowser,
        getCumulativeMoveData,
        getTokenCells,
        getMaxGroundHeightUnderToken,
        executeStatRoll,
        executeDamageRoll,
        executeBasicAttack,
        executeTechAttack,
        executeSimpleActivation,
        executeReactorMeltdown,
        executeReactorExplosion,
        knockBackToken,
        chooseToken,
        placeZone,
        placeToken,
        startChoiceCard,
        deployWeaponToken,
        pickupWeaponToken,
        resolveDeployable,
        placeDeployable,
        deployDeployable,
        beginDeploymentCard,
        openDeployableMenu,
        recallDeployable,
        beginThrowWeaponFlow,
        getGridDistance,
        drawRangeHighlight,
        revertMovement,
        clearMovementHistory,
        undoMoveData,
        getIntentionalMoveData,
        triggerFlaggedEffectImmunity,
        packMacros,
        executePackMacro,
        executeDowntime,
        executeScanOnActivation,
        openThrowMenu,
        handleTrigger
    };
    game.socket.on('module.lancer-automations', handleSocketEvent);

    Hooks.callAll('lancer-automations.ready', game.modules.get('lancer-automations').api);
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

    if (!game.modules.get("elevationruler")?.active || !game.combat?.started) {
        return;
    }

    const resetButtonHtml = `
    <div class="control-icon lancer-ruler-reset-button" title="Revert Last Movement">
        <i class="fas fa-undo"></i>
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

        await revertMovement(token);
    });

    btn.on('contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const token = hud.object;
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
                clear: {
                    icon: '<i class="fas fa-trash"></i>',
                    label: "Reset History",
                    callback: () => clearMovementHistory(token, false)
                },
                revert: {
                    icon: '<i class="fas fa-undo-alt"></i>',
                    label: "Reset & Revert Movement",
                    callback: () => clearMovementHistory(token, true)
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "revert"
        }, {
            classes: ["lancer-dialog-base"],
            width: 400,
            height: 250
        }).render(true);
    });
});
let previousCombatantId = null;

Hooks.on('combatTurnChange', async (combat, prior, current) => {
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
            await handleTrigger('onTurnStart', { triggeringToken: startingToken });
            processDurationEffects('start', startingToken.id);
        }
    }

    previousCombatantId = current.combatantId;
});

Hooks.on('updateCombat', async (combat, change, options, userId) => {
    // Turn/round logic is handled by combatTurnChange above.
    // Reserved for future use.
});

Hooks.on('createActiveEffect', async (effect, options, userId) => {
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    await handleTrigger('onStatusApplied', { triggeringToken: token, statusId, effect });
});

Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
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

Hooks.on('createToken', (tokenDocument, options, userId) => {
    const token = canvas.tokens.get(tokenDocument.id);
    if (!token)
        return;
    setTimeout(() => {
        checkOnInitReactions(token);
    }, 100);
});

Hooks.on('updateActor', async (actor, change, options, userId) => {
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
            await handleTrigger('onHeat', { triggeringToken: token, heatChange, currentHeat, inDangerZone });
        } else if (heatChange < 0) {
            const heatCleared = Math.abs(heatChange);
            await handleTrigger('onClearHeat', { triggeringToken: token, heatCleared, currentHeat });
        }

        previousHeatValues.set(actor.id, currentHeat);
    }

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const currentHP = change.system.hp.value;
        const hpChange = currentHP - previousHP;

        if (hpChange > 0) {
            const maxHP = actor.system.hp.max;
            await handleTrigger('onHPRestored', { triggeringToken: token, hpChange, currentHP, maxHP });
        } else if (hpChange < 0) {
            const hpLost = Math.abs(hpChange);
            await handleTrigger('onHpLoss', { triggeringToken: token, hpLost, currentHP });

            if (previousHP > 0 && currentHP <= 0) {
                await handleTrigger('onDestroyed', { triggeringToken: token });
            }
        }

        previousHPValues.set(actor.id, currentHP);
    }
});

Hooks.on('renderSettings', (app, html) => {
    const lancerHeader = html.find('#settings-lancer');
    if (lancerHeader.length === 0) {
        return;
    }

    const managerButton = $(`<button id="lancer-automations-manager" data-action="lancer-automations-manager">
        <i class="fas fa-tasks"></i> Activation Manager
    </button>`);

    const helpButton = lancerHeader.find('button#triggler-form');
    if (helpButton.length > 0) {
        helpButton.after(managerButton);
    } else {
        lancerHeader.append(managerButton);
    }

    managerButton.on('click', async (ev) => {
        ev.preventDefault();
        new ReactionConfig().render(true);
    });
});

function drawMovementTrace(token, originalEndPos, newEndPos = null) {
    const trace = new PIXI.Graphics();
    const centerStart = token.center;
    const gridSize = canvas.grid.size;

    const drawFootprint = (targetX, targetY, lineColor, fillColor) => {
        trace.lineStyle(3, lineColor, 0.8);
        trace.beginFill(fillColor, 0.3);
        if (isHexGrid()) {
            const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
            for (const o of offsets) {
                drawHexAt(trace, o.col, o.row);
            }
        } else {
            trace.drawRect(targetX, targetY, token.document.width * gridSize, token.document.height * gridSize);
        }
        trace.endFill();
    };

    // Start Position
    drawFootprint(token.document.x, token.document.y, 0xffff00, 0xffff00);

    // Original End Position
    const originalColor = newEndPos ? 0xff0000 : 0xff6400;
    const centerOriginal = { x: originalEndPos.x + token.w/2, y: originalEndPos.y + token.h/2 };
    drawFootprint(originalEndPos.x, originalEndPos.y, originalColor, originalColor);

    // Line to Original End
    trace.lineStyle(4, 0xffffff, 0.5); // white fading line
    trace.moveTo(centerStart.x, centerStart.y);
    trace.lineTo(centerOriginal.x, centerOriginal.y);

    if (newEndPos) {
        // New End Position
        const centerNew = { x: newEndPos.x + token.w/2, y: newEndPos.y + token.h/2 };
        drawFootprint(newEndPos.x, newEndPos.y, 0xff6400, 0xff6400);

        // Line to New End
        trace.lineStyle(4, 0xffffff, 1);
        trace.moveTo(centerStart.x, centerStart.y);
        trace.lineTo(centerNew.x, centerNew.y);
    }

    if (canvas.tokens && canvas.tokens.parent) {
        canvas.tokens.parent.addChildAt(trace, canvas.tokens.parent.getChildIndex(canvas.tokens));
    } else {
        canvas.stage.addChild(trace);
    }

    return trace;
}

Hooks.on('preUpdateToken', (document, change, options, userId) => {
    if (options.IgnorePreMove)
        return true;

    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return;
    if (options.isUndo)
        return;

    const isDrag = 'rulerSegment' in options || options.isDrag;
    if (isDrag) {
        let cancelUpdate = false;
        const token = canvas.tokens.get(document.id);

        const startPos = { x: document.x, y: document.y };
        const endPos = { x: change.x ?? document.x, y: change.y ?? document.y };
        const elevationToMove = change.elevation ?? document.elevation;

        let distanceToMove = 0;
        if (canvas.grid.measurePath) {
            distanceToMove = canvas.grid.measurePath([startPos, endPos]).distance;
        } else {
            distanceToMove = canvas.grid.measureDistance(startPos, endPos);
        }
        distanceToMove = Math.round(distanceToMove / canvas.scene.grid.distance);

        const isTeleport = !!options.teleport;
        const shouldCalculatePath = game.settings.get('lancer-automations', 'enablePathHexCalculation');
        const moveInfo = {
            isInvoluntary: !isDrag,
            isTeleport,
            isUndo: options.isUndo,
            isModified: options.isModified,
            pathHexes: shouldCalculatePath ? getMovementPathHexes(token, change) : []
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

        // Shared state for deduplicating simultaneous cancel cards.
        let cancelCardPending = false;
        const cancelledReasons = [];

        triggerData.cancelTriggeredMove = async (reasonText = "This movement has been canceled.", showCard = true, gmControl = false) => {
            // Always cancel the movement immediately (idempotent).
            triggerData.cancel();
            cancelRulerDrag(token, moveInfo);

            if (!showCard)
                return;

            if (reasonText)
                cancelledReasons.push(reasonText);

            // If a card is already being prepared by a concurrent cancelTriggeredMove call, bail out.
            // Our reason has been collected above and will appear in that card.
            if (cancelCardPending)
                return;
            cancelCardPending = true;

            // Yield one microtask so any other simultaneous cancelTriggeredMove calls can
            // push their reasons into cancelledReasons before we render the card.
            await Promise.resolve();

            const description = cancelledReasons.length > 1
                ? cancelledReasons.map(r => `• ${r}`).join('<br>')
                : (cancelledReasons[0] ?? "This movement has been canceled.");

            const trace = drawMovementTrace(token, endPos);

            await startChoiceCard({
                mode: "or",
                title: "MOVEMENT CANCELED",
                description,
                gmControl,
                choices: [
                    { text: "Confirm", icon: "fas fa-check", callback: async () => {} },
                    { text: "Ignore",
                        icon: "fas fa-times",
                        callback: async () => {
                        // Re-submit the original movement with a flag to bypass preUpdateToken
                            const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                            if (change.elevation !== undefined)
                                originalUpdate.elevation = change.elevation;
                            token.document.update(originalUpdate, { ...options, IgnorePreMove: true, isDrag: true });
                        }}
                ]
            });

            if (trace.parent)
                trace.parent.removeChild(trace);
            trace.destroy();
        };

        triggerData.changeTriggeredMove = async (position, extraData = {}, reasonText = "This movement has been rerouted.", showCard = true, gmControl = false) => {
            const executeChange = () => {
                setTimeout(() => {
                    const updateData = { x: position.x, y: position.y };
                    if (extraData.elevation !== undefined) {
                        updateData.elevation = extraData.elevation;
                    }
                    const contextData = { isDrag: true, isUndo: false, isModified: true, ...extraData };
                    token.document.update(updateData, contextData);
                }, 50);
            };

            if (showCard) {
                // Cancel immediately because we cannot block Foundry synchronously with async code
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);

                const trace = drawMovementTrace(token, endPos, position);

                await startChoiceCard({
                    mode: "or",
                    title: "MOVEMENT REROUTED",
                    description: reasonText,
                    gmControl,
                    choices: [
                        { text: "Confirm",
                            icon: "fas fa-check",
                            callback: async () => {
                                executeChange();
                            } },
                        { text: "Ignore",
                            icon: "fas fa-times",
                            callback: async () => {
                            // Re-submit the original movement with a flag to bypass preUpdateToken
                                const originalUpdate = { x: change.x ?? token.x, y: change.y ?? token.y };
                                if (change.elevation !== undefined)
                                    originalUpdate.elevation = change.elevation;
                                token.document.update(originalUpdate, { ...options, IgnorePreMove: true, isDrag: true });
                            }}
                    ]
                });

                if (trace.parent)
                    trace.parent.removeChild(trace);
                trace.destroy();
            } else {
                triggerData.cancel();
                cancelRulerDrag(token, moveInfo);
                executeChange();
            }
        };

        // Call handleTrigger without await. If onPreMove reactions are synchronous,
        // cancelUpdate will be set to true before we check it on the next line.
        handleTrigger('onPreMove', { triggeringToken: token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo, cancel: triggerData.cancel, cancelTriggeredMove: triggerData.cancelTriggeredMove, changeTriggeredMove: triggerData.changeTriggeredMove });

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
    if (options.IgnorePreMove)
        return;

    const token = canvas.tokens.get(document.id);
    if (!token)
        return;

    // Await the physical canvas animation to complete so distance
    // evaluations on `onUpdate` use the token's final rendered position.
    if ((change.x !== undefined || change.y !== undefined || change.elevation !== undefined) && document.object?.animationName) {
        await CanvasAnimation.getAnimation(document.object.animationName)?.promise;
    }

    await handleTrigger("onUpdate", { triggeringToken: token, document, change, options });
});
