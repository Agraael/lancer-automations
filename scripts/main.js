import { drawThreatDebug, drawDistanceDebug, getTokenDistance, isHostile, isFriendly, checkOverwatchCondition, getActorMaxThreat, getMinGridDistance } from "./overwatch.js";
import { ReactionManager, stringToFunction, ReactionConfig } from "./reaction-manager.js";
import { ReactionReset } from "./reaction-reset.js";
import { ReactionExport, ReactionImport } from "./reaction-export-import.js";
import { displayReactionPopup } from "./reactions-ui.js";
import { registerExternalItemReactions, registerExternalGeneralReactions } from "./reactions-registry.js";
import {
    setFlaggedEffect,
    removeFlaggedEffect,
    applyFlaggedEffectToTokens,
    removeFlaggedEffectToTokens,
    findFlaggedEffectOnToken,
    consumeEffectCharge,
    processDurationEffects
} from "./flagged-effects.js";
import {
    addGlobalBonus,
    removeGlobalBonus,
    getGlobalBonuses,
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
import { chooseToken, placeZone, getGridDistance, drawRangeHighlight } from "./interactive-tools.js";


let reactionDebounceTimer = null;
let reactionQueue = [];
const REACTION_DEBOUNCE_MS = 100;

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

function getItemLID(item) {
    return item.system?.lid || null;
}

function isItemAvailable(item, reactionPath) {
    if (!item)
        return false;
    if (item.system?.destroyed || item.system?.disabled)
        return false;

    if (item.type === "talent" && reactionPath) {
        const rankMatch = reactionPath.match(/ranks\[(\d+)\]/);
        if (rankMatch) {
            const requiredRank = parseInt(rankMatch[1]) + 1;
            if ((item.system?.curr_rank || 0) < requiredRank)
                return false;
        }
    }

    if (item.type === "mech_weapon" && reactionPath) {
        const profileMatch = reactionPath.match(/profiles\[(\d+)\]/);
        if (profileMatch) {
            const requiredProfile = parseInt(profileMatch[1]);
            const currentProfile = item.system?.selected_profile_index ?? 0;
            if (currentProfile !== requiredProfile)
                return false;
        }
    }

    return true;
}

function hasReactionAvailable(token) {
    const reaction = token.actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && reaction > 0;
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

const STAT_PATHS = {
    HULL: "system.hull",
    AGI: "system.agi",
    SYS: "system.sys",
    ENG: "system.eng",
    GRIT: "system.grit"
};

async function executeStatRoll(actor, stat, title, target = 10, extraData = {}) {
    const StatRollFlow = game.lancer.flows.get("StatRollFlow");
    if (!StatRollFlow) {
        console.error("lancer-automations | StatRollFlow not found");
        return { completed: false };
    }

    let targetVal = target;
    let targetToken = null;
    let rollTitle = title;
    const upperStat = stat.toUpperCase();

    // Handle "token" target selection or object target
    const useFlowTargeting = game.settings.get('lancer-automations', 'statRollTargeting');

    if (target === "token" && !useFlowTargeting) {
        const token = actor.token?.object;
        if (!token) {
            ui.notifications.warn("No source token found for choosing target.");
            return { completed: false };
        }

        const targets = await chooseToken(token, {
            title: `${upperStat} SAVE TARGET`,
            description: `Select a target for the ${upperStat} Save.`,
            count: 1,
            range: null
        });

        if (targets && targets.length > 0) {
            targetToken = targets[0];
        } else {
            return { completed: false };
        }
    } else if (typeof target === 'object') {
        if (target instanceof TokenDocument) {
            targetToken = target.object;
        } else if (target.actor) {
            targetToken = target;
        } else {
            console.error("lancer-automations | executeStatRoll | Invalid target type");
        }

    }

    if (targetToken && targetToken.actor) {
        const targetActor = targetToken.actor;

        if (!rollTitle) {
            rollTitle = `${upperStat} Save`;
        }

        // Dynamic Difficulty
        if (targetActor.type === "npc" || targetActor.type === "deployable") {
            targetVal = targetActor.system.save || 10;
        } else if (targetActor.type === "mech") {
            // Same stat on target (e.g. HULL check vs HULL)
            const path = STAT_PATHS[upperStat] || stat;
            targetVal = foundry.utils.getProperty(targetActor, path) || 10;
        }
    }

    if (!rollTitle) {
        rollTitle = `${upperStat} Check`;
    }

    const isNpcGrit = actor.type === "npc" && upperStat === "GRIT";
    const statPath = isNpcGrit ? "system.tier" : (STAT_PATHS[upperStat] || stat);

    // Pass targetToken to flow options
    const flowOptions = { path: statPath, title: rollTitle };
    const flow = new StatRollFlow(actor, flowOptions);
    if (targetToken)
        flow.state.data.targetToken = targetToken;
    flow.state.data.targetVal = targetVal;

    if (extraData && typeof extraData === 'object')
        foundry.utils.mergeObject(flow.state.data, extraData);

    const completed = await flow.begin();
    if (!completed) {
        return { completed: false };
    }
    const total = flow.state.data?.result?.roll?.total ?? null;
    return {
        completed: true,
        total,
        roll: flow.state.data?.result?.roll ?? null,
        passed: total !== null ? (targetVal !== undefined ? total >= targetVal : false) : false
    };
}

async function executeDamageRoll(attacker, targets, damageValue, damageType, title = "Damage Roll", options = {}, extraData = {}) {
    const DamageRollFlow = game.lancer.flows.get("DamageRollFlow");
    if (!DamageRollFlow)
        return { completed: false };

    const actor = attacker.actor || attacker;
    if (!actor)
        return { completed: false };

    if (targets && Array.isArray(targets)) {
        targets.forEach((t, i) => {
            const token = t.object || t;
            if (token?.setTarget)
                token.setTarget(true, { releaseOthers: i === 0, groupSelection: true });
        });
    }

    const typeMap = {kinetic: "Kinetic",energy: "Energy",explosive: "Explosive",burn: "Burn",heat: "Heat",variable: "Variable"};
    const resolvedType = typeMap[damageType.toLowerCase()] || "Kinetic";

    const flowData = {
        title: title,
        damage: [{
            val: String(damageValue),
            type: resolvedType
        }],
        tags: options.tags || [],
        hit_results: options.hit_results || [],
        has_normal_hit: options.has_normal_hit !== undefined ? options.has_normal_hit : true,
        has_crit_hit: options.has_crit_hit || false,
        ap: options.ap || false,
        paracausal: options.paracausal || false,
        half_damage: options.half_damage || false,
        overkill: options.overkill || false,
        reliable: options.reliable || false,
        add_burn: options.add_burn !== undefined ? options.add_burn : true,
        invade: options.invade || false,
        bonus_damage: options.bonus_damage || []
    };

    foundry.utils.mergeObject(flowData, options);
    const flow = new DamageRollFlow(actor.uuid, flowData);
    if (extraData && typeof extraData === 'object')
        foundry.utils.mergeObject(flow.state.data, extraData);
    const completed = await flow.begin();
    return {completed, flow};
}

async function evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat) {
    if (!isInCombat && !reaction.outOfCombat)
        return null;
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
            shouldTrigger = await reaction.evaluate(triggerType, enrichedData, token, null, reactionName);
        } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName"]);
            shouldTrigger = await evalFunc(triggerType, enrichedData, token, null, reactionName);
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
    const generalReactions = ReactionManager.getGeneralReactions();

    const actionBasedReaction = data.actionName && generalReactions[data.actionName]?.onlyOnSourceMatch ?
        { name: data.actionName, reaction: generalReactions[data.actionName] } : null;

    const nonActionBasedReactions = [];
    for (const [reactionName, reaction] of Object.entries(generalReactions)) {
        if (reaction.onlyOnSourceMatch)
            continue;
        if (!reaction.triggers?.includes(triggerType))
            continue;
        if (reaction.enabled === false)
            continue;
        nonActionBasedReactions.push([reactionName, reaction]);
    }

    const hasValidActionBasedReaction = actionBasedReaction &&
        actionBasedReaction.reaction.triggers?.includes(triggerType) &&
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

                if (!isInCombat && !reaction.outOfCombat)
                    continue;

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
                        shouldTrigger = await reaction.evaluate(triggerType, enrichedData, token, item, activationName);
                    } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                        try {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "triggerData", "reactorToken", "item", "activationName"]);
                            shouldTrigger = await evalFunc(triggerType, enrichedData, token, item, activationName);
                        } catch (e) {
                            console.error(`lancer-automations | Error parsing custom evaluate for ${item.name}:`, e);
                        }
                    } else {
                        shouldTrigger = true;
                    }

                    if (shouldTrigger) {
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
                } catch (error) {
                    console.error(`lancer-automations | Error evaluating reaction ${item.name}:`, error);
                }
            }
        }

        if (hasValidActionBasedReaction) {
            const reactionName = actionBasedReaction.name;
            const reaction = actionBasedReaction.reaction;
            const enrichedData = await evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
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

        for (const [reactionName, reaction] of nonActionBasedReactions) {
            const enrichedData = await evaluateGeneralReaction(reactionName, reaction, triggerType, data, token, isSelf, isInCombat);
            if (enrichedData) {
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

    if (reactionDebounceTimer) {
        clearTimeout(reactionDebounceTimer);
    }

    reactionDebounceTimer = setTimeout(async () => {
        if (reactionQueue.length > 0) {
            const autoReactions = [];
            const manualReactions = [];

            for (const r of reactionQueue) {
                if (r.reaction.autoActivate) {
                    autoReactions.push(r);
                } else {
                    manualReactions.push(r);
                }
            }

            for (const r of autoReactions) {
                try {
                    const { activateReaction } = await import('./reactions-ui.js');
                    await activateReaction(r.triggerType, r.triggerData, r.token, r.item, r.reactionName, r.reaction, r.isGeneral);
                } catch (error) {
                    console.error(`lancer-automations | Error auto-activating reaction:`, error);
                }
            }

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
                                isGeneral: r.isGeneral
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
                        continue;
                } catch (e) {
                    console.error(`lancer-automations | Error evaluating consumption for ${effect.name}:`, e);
                    continue;
                }
            }

            console.log(`lancer-automations | Consuming charge on ${effect.name} (trigger: ${triggerType})`);
            if (consumption.groupId)
                consumedGroups.add(consumption.groupId);
            await consumeEffectCharge(effect);
        }
    }
}

/**
 * Handle a trigger event: run reactions AND process consumption-based effects.
 */
function handleTrigger(triggerType, data) {
    checkReactions(triggerType, data);
    processEffectConsumption(triggerType, data);
}

function registerReactionHooks() {
    Hooks.on('lancer-automations.onAttack', (attacker, weapon, targets, actionData) => {
        handleTrigger('onAttack', {
            triggeringToken: attacker,
            weapon,
            targets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onHit', (attacker, weapon, hitTargets, actionData) => {
        handleTrigger('onHit', {
            triggeringToken: attacker,
            weapon,
            targets: hitTargets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onMiss', (attacker, weapon, missTargets, actionData) => {
        handleTrigger('onMiss', {
            triggeringToken: attacker,
            weapon,
            targets: missTargets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onDamage', (attacker, weapon, target, damages, types, isCrit, isHit, actionData) => {
        handleTrigger('onDamage', {
            triggeringToken: attacker,
            weapon,
            target,
            damages,
            types,
            isCrit,
            isHit,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onMove', (mover, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo) => {
        handleTrigger('onMove', { triggeringToken: mover, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo });
    });

    Hooks.on('lancer-automations.onTurnStart', (token) => {
        handleTrigger('onTurnStart', { triggeringToken: token });
    });

    Hooks.on('lancer-automations.onTurnEnd', (token) => {
        handleTrigger('onTurnEnd', { triggeringToken: token });
    });

    Hooks.on('lancer-automations.onStatusApplied', (token, statusId, effect) => {
        handleTrigger('onStatusApplied', { triggeringToken: token, statusId, effect });
    });

    Hooks.on('lancer-automations.onStatusRemoved', (token, statusId, effect) => {
        handleTrigger('onStatusRemoved', { triggeringToken: token, statusId, effect });
    });

    Hooks.on('lancer-automations.onStructure', (token, remainingStructure, rollResult) => {
        handleTrigger('onStructure', { triggeringToken: token, remainingStructure, rollResult });
    });

    Hooks.on('lancer-automations.onStress', (token, remainingStress, rollResult) => {
        handleTrigger('onStress', { triggeringToken: token, remainingStress, rollResult });
    });

    Hooks.on('lancer-automations.onHeat', (token, heatGained, currentHeat, inDangerZone) => {
        handleTrigger('onHeat', { triggeringToken: token, heatGained, currentHeat, inDangerZone });
    });

    Hooks.on('lancer-automations.onDestroyed', (token) => {
        handleTrigger('onDestroyed', { triggeringToken: token });
    });

    Hooks.on('lancer-automations.onTechAttack', (attacker, techItem, targets, actionData) => {
        handleTrigger('onTechAttack', {
            triggeringToken: attacker,
            techItem,
            targets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onTechHit', (attacker, techItem, hitTargets, actionData) => {
        handleTrigger('onTechHit', {
            triggeringToken: attacker,
            techItem,
            targets: hitTargets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onTechMiss', (attacker, techItem, missTargets, actionData) => {
        handleTrigger('onTechMiss', {
            triggeringToken: attacker,
            techItem,
            targets: missTargets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-automations.onCheck', (triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal) => {
        handleTrigger('onCheck', { triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal });
    });

    Hooks.on('lancer-automations.onInitCheck', (triggeringToken, statName, checkAgainstToken, targetVal) => {
        handleTrigger('onInitCheck', { triggeringToken, statName, checkAgainstToken, targetVal });
    });

    Hooks.on('lancer-automations.onActivation', (token, actionType, actionName, item, actionData) => {
        handleTrigger('onActivation', { triggeringToken: token, actionType, actionName, item, actionData });
    });

    Hooks.on('lancer-automations.onHPRestored', (token, hpRestored, currentHP, maxHP) => {
        handleTrigger('onHPRestored', { triggeringToken: token, hpRestored, currentHP, maxHP });
    });

    Hooks.on('lancer-automations.onHpLoss', (token, hpLost, currentHP) => {
        handleTrigger('onHpLoss', { triggeringToken: token, hpLost, currentHP });
    });

    Hooks.on('lancer-automations.onClearHeat', (token, heatCleared, currentHeat) => {
        handleTrigger('onClearHeat', { triggeringToken: token, heatCleared, currentHeat });
    });
}

function registerSettings() {
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

    game.settings.register('lancer-automations', 'statRollTargeting', {
        name: 'Enable Stat Roll Target Selection',
        hint: 'If enabled, stat rolls (HULL, AGI, etc.) will prompt for an optional target to calculate difficulty (Save Target vs Stat).',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
    });



    game.settings.register('lancer-automations', 'consumeReaction', {
        name: 'Consume Activation on Activate',
        hint: 'Automatically reduce reaction count by 1 when activating an activation.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'experimentalBoostDetection', {
        name: 'Experimental Boost Detection (WIP)',
        hint: 'Detect Boost based on cumulative drag movement exceeding the token base speed. Adds moveInfo (isBoost, boostSet) to onMove triggerData. Requires Elevation Ruler or my own fork. Enable "Debug Boost Detection" to test. Use game.modules.get("lancer-automations").api.clearMoveData(tokenDocId) to manually reset cumulative data.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugBoostDetection', {
        name: 'Debug Boost Detection',
        hint: 'Show UI notifications when boost detection triggers (for testing purposes).',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Show a button on the Token HUD to open the Lancer Effect Manager.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
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
}

function handleSocketEvent({ action, payload }) {
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
            });
        }

        if (reconstructed.length > 0) {
            displayReactionPopup(triggerType, reconstructed);
        }
    } else if (action === 'setFlaggedEffect') {
        setFlaggedEffect(payload.targetID, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions);
    } else if (action === 'removeFlaggedEffect') {
        removeFlaggedEffect(payload.targetID, payload.effect, payload.originID);
    } else if (action === 'removeEffect') {
        const target = canvas.tokens.get(payload.targetID);
        if (target?.actor) {
            target.actor.deleteEmbeddedDocuments("ActiveEffect", [payload.effectID]);
        }
    }
}

const cumulativeMoveData = new Map();

function clearMoveData(tokenId) {
    cumulativeMoveData.delete(tokenId);
}

function getCumulativeMoveData(tokenDocId) {
    return cumulativeMoveData.get(tokenDocId) || 0;
}

function handleTokenMove(document, change, options, userId) {
    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange)
        return;
    if (options.isUndo)
        return;

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

    const isDrag = 'rulerSegment' in options;
    const isTeleport = !!options.teleport;

    // Check for Elevation Ruler free movement (not counted in cumulative boost tracking)
    let isFreeMovement = false;
    const elevationRulerSettings = game.modules.get('elevationruler')?.api?.Settings;
    if (elevationRulerSettings?.FORCE_FREE_MOVEMENT) {
        isFreeMovement = true;
    }

    const moveInfo = { isInvoluntary: !isDrag, isTeleport };

    // Always track basic cumulative movement (used by Fall reaction to check if token moved)
    const prev = cumulativeMoveData.get(document.id) || 0;
    const cumulative = prev + distanceMoved;
    if (!isFreeMovement) {
        cumulativeMoveData.set(document.id, cumulative);
    }

    // Boost detection only when enabled
    if (game.settings.get('lancer-automations', 'experimentalBoostDetection') && isDrag && !isFreeMovement) {
        const speed = token.actor?.system?.speed || 0;

        const boostSet = [];
        if (speed > 0) {
            // Standard move is 1-speed, boost 1 is speed+1 to 2*speed, boost 2 is 2*speed+1 to 3*speed, etc.
            // Boost N is used when cumulative > N * speed
            const prevBoostCount = prev > 0 ? Math.floor((prev - 1) / speed) : 0;
            const newBoostCount = cumulative > 0 ? Math.floor((cumulative - 1) / speed) : 0;
            for (let n = prevBoostCount + 1; n <= newBoostCount; n++) {
                boostSet.push(n);
            }
        }
        moveInfo.boostSet = boostSet;
        moveInfo.isBoost = boostSet.length > 0;

        // Debug notification for boost detection testing
        if (game.settings.get('lancer-automations', 'debugBoostDetection')) {
            ui.notifications.info(`${token.name}: moved ${distanceMoved}, cumulative ${cumulative}/${speed} | isBoost: ${moveInfo.isBoost}, boostSet: [${boostSet.join(',')}]`);
        }
    }

    Hooks.callAll('lancer-automations.onMove', token, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo);
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
        tags: state.data?.tags || weapon?.system?.tags || []
    };

    Hooks.callAll('lancer-automations.onAttack', token, weapon, targets, actionData);
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
        tags: state.data?.tags || weapon?.system?.tags || []
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
        Hooks.callAll('lancer-automations.onHit', token, weapon, hitTargets, actionData);
    }
    if (missTargets.length > 0) {
        Hooks.callAll('lancer-automations.onMiss', token, weapon, missTargets, actionData);
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
        tags: state.data?.tags || weapon?.system?.tags || []
    };

    for (const targetInfo of targets) {
        const targetToken = targetInfo.target;
        const isCrit = targetInfo.crit || false;
        const isHit = targetInfo.hit || false;
        const targetDamages = targetInfo.damage?.map(d => d.amount) || [];
        const targetTypes = targetInfo.damage?.map(d => d.type) || [];

        if (targetDamages.length > 0) {
            Hooks.callAll('lancer-automations.onDamage', token, weapon, targetToken, targetDamages, targetTypes, isCrit, isHit, actionData);
        }
    }

    return true;
}

async function onStructureStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStructure = actor?.system?.structure?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    Hooks.callAll('lancer-automations.onStructure', token, remainingStructure, rollResult);
    return true;
}

async function onStressStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStress = actor?.system?.stress?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    Hooks.callAll('lancer-automations.onStress', token, remainingStress, rollResult);
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
        tags: state.data?.tags || techItem?.system?.tags || []
    };

    Hooks.callAll('lancer-automations.onTechAttack', token, techItem, targets, actionData);
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
        tags: state.data?.tags || techItem?.system?.tags || []
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
        Hooks.callAll('lancer-automations.onTechHit', token, techItem, hitTargets, actionData);
    }
    if (missTargets.length > 0) {
        Hooks.callAll('lancer-automations.onTechMiss', token, techItem, missTargets, actionData);
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

    Hooks.callAll('lancer-automations.onCheck', token, statName, roll, total, success, state.data.targetToken, state.data.targetVal);
    return true;
}

async function onInitCheckStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    state.data.targetVal = state.data.targetVal ? state.data.targetVal : 10;
    Hooks.callAll('lancer-automations.onInitCheck', token, statName, state.data.targetToken, state.data.targetVal);
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
        tags: state.data?.tags || weapon?.system?.tags || []
    };

    Hooks.callAll('lancer-automations.onInitAttack', token, weapon, targets, actionData);
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
        tags: state.data?.tags || techItem?.system?.tags || []
    };

    Hooks.callAll('lancer-automations.onInitTechAttack', token, techItem, targets, actionData);
    return true;
}

async function onActivationStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const item = state.item;

    let actionType = state.data?.action?.activation || item?.system?.activation || state.data?.type || 'Unknown';
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
        tags: tags
    };

    Hooks.callAll('lancer-automations.onActivation', token, actionType, actionName, item, actionData);
    return true;
}

async function statRollTargetSelectStep(state) {
    if (!game.settings.get('lancer-automations', 'statRollTargeting')) {
        return true;
    }

    // If target already provided (e.g. via executeStatRoll), skip
    if (state.data.targetToken) {
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

Hooks.once('lancer.registerFlows', (flowSteps, flows) => {
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

    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');

    flows.get('BasicAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('BasicAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onTechHitMiss');

    flows.get('DamageRollFlow')?.insertStepAfter('rollNormalDamage', 'lancer-automations:onDamage');

    flows.get('StructureFlow')?.insertStepAfter('rollStructureTable', 'lancer-automations:onStructure');
    flows.get('OverheatFlow')?.insertStepAfter('rollOverheatTable', 'lancer-automations:onStress');

    flows.get('StatRollFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepStatRoll', 'lancer-automations:onInitCheck');
    flows.get('StatRollFlow')?.insertStepAfter('rollCheck', 'lancer-automations:onCheck');

    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SystemFlow')?.insertStepAfter('printSystemCard', 'lancer-automations:onActivation');
});

Hooks.on('init', () => {
    console.log('lancer-automations | Init');
    registerSettings();
});

Hooks.on('lancer.statusesReady', () => {
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
});

Hooks.on('ready', () => {
    console.log('lancer-automations | Ready');

    ReactionManager.initialize();
    registerReactionHooks();

    game.modules.get('lancer-automations').api = {
        drawThreatDebug,
        drawDistanceDebug,
        getTokenDistance,
        checkOverwatchCondition,
        isHostile,
        isFriendly,
        getActorMaxThreat,
        getMinGridDistance,
        registerDefaultItemReactions: registerExternalItemReactions,
        registerDefaultGeneralReactions: registerExternalGeneralReactions,
        clearMoveData,
        applyFlaggedEffectToTokens,
        removeFlaggedEffectToTokens,
        findFlaggedEffectOnToken,
        consumeEffectCharge,
        processEffectConsumption,
        processDurationEffects,
        addGlobalBonus,
        removeGlobalBonus,
        getGlobalBonuses,
        executeGenericBonusMenu,
        injectBonusToNextRoll,
        executeEffectManager,
        openItemBrowser,
        getCumulativeMoveData,
        getTokenCells,
        getMaxGroundHeightUnderToken,
        executeStatRoll,
        executeDamageRoll,
        chooseToken,
        placeZone,
        getGridDistance,
        drawRangeHighlight
    };
    game.socket.on('module.lancer-automations', handleSocketEvent);

    Hooks.callAll('lancer-automations.ready', game.modules.get('lancer-automations').api);
});

Hooks.on('renderTokenHUD', (hud, html, data) => {
    if (!game.settings.get('lancer-automations', 'showBonusHudButton'))
        return;

    const token = hud.object;
    if (!token?.actor)
        return;

    const button = $(`<div class="control-icon" data-action="bonus-menu" data-tooltip="Lancer EffectManager">
        <i class="cci cci-accuracy i--m"></i>
    </div>`);

    button.on('click', (e) => {
        e.preventDefault();
        executeGenericBonusMenu(token.actor);
    });

    html.find('.col.right').append(button);
});

Hooks.on('preUpdateToken', handleTokenMove);

let previousCombatantId = null;

Hooks.on('combatTurnChange', (combat, prior, current) => {
    if (prior.combatantId) {
        const endingCombatant = combat.combatants.get(prior.combatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            Hooks.callAll('lancer-automations.onTurnEnd', endingToken);
            processDurationEffects('end', endingToken.id);
        }
    }

    if (current.combatantId) {
        const startingCombatant = combat.combatants.get(current.combatantId);
        const startingToken = startingCombatant?.token ? canvas.tokens.get(startingCombatant.token.id) : null;
        if (startingToken) {
            clearMoveData(startingToken.document.id);
            Hooks.callAll('lancer-automations.onTurnStart', startingToken);
            processDurationEffects('start', startingToken.id);
        }
    }

    previousCombatantId = current.combatantId;
});

Hooks.on('updateCombat', (combat, change, options, userId) => {
    if (change.turn === undefined && change.round === undefined)
        return;

    const currentCombatant = combat.combatant;
    if (!currentCombatant)
        return;

    if (previousCombatantId && previousCombatantId !== currentCombatant.id) {
        const endingCombatant = combat.combatants.get(previousCombatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            Hooks.callAll('lancer-automations.onTurnEnd', endingToken);
            processDurationEffects('end', endingToken.id);
        }
    }

    const startingToken = currentCombatant.token ? canvas.tokens.get(currentCombatant.token.id) : null;
    if (startingToken && currentCombatant.id !== previousCombatantId) {
        clearMoveData(startingToken.document.id);
        Hooks.callAll('lancer-automations.onTurnStart', startingToken);
        processDurationEffects('start', startingToken.id);
    }

    previousCombatantId = currentCombatant.id;
});

Hooks.on('createActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    Hooks.callAll('lancer-automations.onStatusApplied', token, statusId, effect);
});

Hooks.on('deleteActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    Hooks.callAll('lancer-automations.onStatusRemoved', token, statusId, effect);

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

Hooks.on('updateActor', (actor, change, options, userId) => {
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
            Hooks.callAll('lancer-automations.onHeat', token, heatChange, currentHeat, inDangerZone);
        } else if (heatChange < 0) {
            const heatCleared = Math.abs(heatChange);
            Hooks.callAll('lancer-automations.onClearHeat', token, heatCleared, currentHeat);
        }

        previousHeatValues.set(actor.id, currentHeat);
    }

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const currentHP = change.system.hp.value;
        const hpChange = currentHP - previousHP;

        if (hpChange > 0) {
            const maxHP = actor.system.hp.max;
            Hooks.callAll('lancer-automations.onHPRestored', token, hpChange, currentHP, maxHP);
        } else if (hpChange < 0) {
            const hpLost = Math.abs(hpChange);
            Hooks.callAll('lancer-automations.onHpLoss', token, hpLost, currentHP);

            if (previousHP > 0 && currentHP <= 0) {
                Hooks.callAll('lancer-automations.onDestroyed', token);
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

Hooks.once('ready', () => {
    const module = game.modules.get('lancer-automations');
    if (module) {
        module.api = module.api || {};
        module.api.executeDamageRoll = executeDamageRoll;
        module.api.executeStatRoll = executeStatRoll; // Ensure this is exposed too as it was missing from my search
        console.log("lancer-automations | API exposed");
    }
});
