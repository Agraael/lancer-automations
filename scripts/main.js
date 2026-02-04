/*global game, Hooks, canvas */

import { drawThreatDebug, drawDistanceDebug, getTokenDistance, isHostile, isFriendly, checkOverwatchCondition, getActorMaxThreat, getMinGridDistance } from "./overwatch.js";
import { ReactionManager, stringToFunction } from "./reaction-manager.js";
import { ReactionReset } from "./reaction-reset.js";
import { ReactionExport, ReactionImport } from "./reaction-export-import.js";
import { displayReactionPopup } from "./reactions-ui.js";
import { registerExternalItemReactions, registerExternalGeneralReactions } from "./reactions-registry.js";

let reactionQueue = [];
let reactionDebounceTimer = null;
const REACTION_DEBOUNCE_MS = 100;

function getReactionItems(token) {
    const actor = token.actor;
    if (!actor) return [];

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
    if (!item) return false;
    if (item.system?.destroyed || item.system?.disabled) return false;

    if (item.type === "talent" && reactionPath) {
        const rankMatch = reactionPath.match(/ranks\[(\d+)\]/);
        if (rankMatch) {
            const requiredRank = parseInt(rankMatch[1]) + 1;
            if ((item.system?.curr_rank || 0) < requiredRank) return false;
        }
    }

    if (item.type === "mech_weapon" && reactionPath) {
        const profileMatch = reactionPath.match(/profiles\[(\d+)\]/);
        if (profileMatch) {
            const requiredProfile = parseInt(profileMatch[1]);
            const currentProfile = item.system?.selected_profile_index ?? 0;
            if (currentProfile !== requiredProfile) return false;
        }
    }

    return true;
}

function hasReactionAvailable(token) {
    const reaction = token.actor?.system?.action_tracker?.reaction;
    return reaction !== undefined && reaction > 0;
}

function getCombatTokens() {
    if (!game.combat) return [];

    return canvas.tokens.placeables.filter(token => {
        if (!token.inCombat) return false;
        if (!token.actor) return false;
        return true;
    });
}

function getAllSceneTokens() {
    return canvas.tokens.placeables.filter(token => {
        if (!token.actor) return false;
        return true;
    });
}

async function checkReactions(triggerType, data) {
    const allTokens = getAllSceneTokens();
    const generalReactions = ReactionManager.getGeneralReactions();

    const actionBasedReaction = data.actionName && generalReactions[data.actionName]?.onlyOnSourceMatch ?
        { name: data.actionName, reaction: generalReactions[data.actionName] } : null;

    const nonActionBasedReactions = [];
    for (const [reactionName, reaction] of Object.entries(generalReactions)) {
        if (reaction.onlyOnSourceMatch) continue;
        if (!reaction.triggers?.includes(triggerType)) continue;
        if (reaction.enabled === false) continue;
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
            if (!lid) continue;

            const registryEntry = ReactionManager.getReactions(lid);
            if (!registryEntry) continue;

            for (const reaction of registryEntry.reactions) {
                if (!reaction.triggers.includes(triggerType)) continue;
                if (reaction.enabled === false) continue;

                if (reaction.onlyOnSourceMatch) {
                    const triggeringItem = data.weapon || data.techItem || data.item;
                    const triggeringItemLid = triggeringItem?.system?.lid;
                    if (!triggeringItemLid || triggeringItemLid !== lid) continue;
                }

                if (!isInCombat && !reaction.outOfCombat) continue;

                if (isSelf) {
                    if (!reaction.triggerSelf) continue;
                } else {
                    if (reaction.triggerOther === false) continue;
                }

                if (reaction.consumesReaction && !hasReactionAvailable(token)) continue;

                const reactionPath = reaction.reactionPath || "";
                if (!isItemAvailable(item, reactionPath)) continue;

                try {
                    const sourceToken = data.triggeringToken;
                    let distanceToTrigger = null;
                    if (sourceToken && token) {
                        distanceToTrigger = getTokenDistance(token, sourceToken);
                    }

                    const enrichedData = { ...data, distanceToTrigger };

                    let shouldTrigger = false;

                    if (typeof reaction.evaluate === 'function') {
                        shouldTrigger = await reaction.evaluate(triggerType, enrichedData, item, token);
                    } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                        try {
                            const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "data", "item", "reactorToken"]);
                            shouldTrigger = await evalFunc(triggerType, enrichedData, item, token);
                        } catch (e) {
                            console.error(`lancer-reactionChecker | Error parsing custom evaluate for ${item.name}:`, e);
                        }
                    } else {
                        shouldTrigger = true;
                    }

                    if (shouldTrigger) {
                        let actionName = item.name;
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
                                actionName = actionData.name;
                            }
                        }

                        reactionQueue.push({
                            triggerType,
                            token,
                            item,
                            reaction,
                            itemName: item.name,
                            reactionName: actionName,
                            triggerData: enrichedData
                        });
                    }
                } catch (error) {
                    console.error(`lancer-reactionChecker | Error evaluating reaction ${item.name}:`, error);
                }
            }
        }

        if (hasValidActionBasedReaction) {
            const reactionName = actionBasedReaction.name;
            const reaction = actionBasedReaction.reaction;

            if (!isInCombat && !reaction.outOfCombat) continue;

            if (isSelf && !reaction.triggerSelf) continue;
            if (!isSelf && reaction.triggerOther === false) continue;

            if (reaction.consumesReaction && !hasReactionAvailable(token)) continue;

            try {
                const sourceToken = data.triggeringToken;
                let distanceToTrigger = null;
                if (sourceToken && token) {
                    distanceToTrigger = getTokenDistance(token, sourceToken);
                }

                const enrichedData = { ...data, distanceToTrigger };

                let shouldTrigger = false;

                if (typeof reaction.evaluate === 'function') {
                    shouldTrigger = await reaction.evaluate(triggerType, enrichedData, null, token);
                } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                    try {
                        const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "data", "item", "reactorToken"]);
                        shouldTrigger = await evalFunc(triggerType, enrichedData, null, token);
                    } catch (e) {
                        console.error(`lancer-reactionChecker | Error parsing general evaluate for ${reactionName}:`, e);
                    }
                } else {
                    shouldTrigger = true;
                }

                if (shouldTrigger) {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName: reactionName,
                        isGeneral: true,
                        triggerData: enrichedData
                    });
                }
            } catch (error) {
                console.error(`lancer-reactionChecker | Error evaluating general reaction ${reactionName}:`, error);
            }
        }

        for (const [reactionName, reaction] of nonActionBasedReactions) {
            if (!isInCombat && !reaction.outOfCombat) continue;

            if (isSelf && !reaction.triggerSelf) continue;
            if (!isSelf && reaction.triggerOther === false) continue;

            if (reaction.consumesReaction && !hasReactionAvailable(token)) continue;

            try {
                const sourceToken = data.triggeringToken;
                let distanceToTrigger = null;
                if (sourceToken && token) {
                    distanceToTrigger = getTokenDistance(token, sourceToken);
                }

                const enrichedData = { ...data, distanceToTrigger };

                let shouldTrigger = false;

                if (typeof reaction.evaluate === 'function') {
                    shouldTrigger = await reaction.evaluate(triggerType, enrichedData, null, token);
                } else if (typeof reaction.evaluate === 'string' && reaction.evaluate.trim() !== '') {
                    try {
                        const evalFunc = stringToFunction(reaction.evaluate, ["triggerType", "data", "item", "reactorToken"]);
                        shouldTrigger = await evalFunc(triggerType, enrichedData, null, token);
                    } catch (e) {
                        console.error(`lancer-reactionChecker | Error parsing general evaluate for ${reactionName}:`, e);
                    }
                } else {
                    shouldTrigger = true;
                }

                if (shouldTrigger) {
                    reactionQueue.push({
                        triggerType,
                        token,
                        item: null,
                        reaction,
                        itemName: reactionName,
                        reactionName: reactionName,
                        isGeneral: true,
                        triggerData: enrichedData
                    });
                }
            } catch (error) {
                console.error(`lancer-reactionChecker | Error evaluating general reaction ${reactionName}:`, error);
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
                    await activateReaction(r.token, r.item, r.reaction, r.isGeneral, r.reactionName, r.itemName, r.triggerData);
                } catch (error) {
                    console.error(`lancer-reactionChecker | Error auto-activating reaction:`, error);
                }
            }

            if (manualReactions.length > 0) {
                const mode = game.settings.get('lancer-reactionChecker', 'reactionNotificationMode');
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
                        if (!distribution.has(user.id)) distribution.set(user.id, []);
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
                        game.socket.emit('module.lancer-reactionChecker', {
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

function registerReactionHooks() {
    Hooks.on('lancer-reactionChecker.onAttack', (attacker, weapon, targets, actionData) => {
        checkReactions('onAttack', {
            triggeringToken: attacker,
            weapon, targets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onHit', (attacker, weapon, hitTargets, actionData) => {
        checkReactions('onHit', {
            triggeringToken: attacker,
            weapon,
            targets: hitTargets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onMiss', (attacker, weapon, missTargets, actionData) => {
        checkReactions('onMiss', {
            triggeringToken: attacker,
            weapon,
            targets: missTargets,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onDamage', (attacker, weapon, target, damages, types, isCrit, actionData) => {
        checkReactions('onDamage', {
            triggeringToken: attacker,
            weapon, target, damages, types, isCrit,
            attackType: actionData?.attack_type || null,
            actionName: actionData?.title || actionData?.action?.name || null,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onMove', (mover, distanceMoved, elevationMoved, startPos, endPos) => {
        checkReactions('onMove', { triggeringToken: mover, distanceMoved, elevationMoved, startPos, endPos });
    });

    Hooks.on('lancer-reactionChecker.onTurnStart', (token) => {
        checkReactions('onTurnStart', { triggeringToken: token });
    });

    Hooks.on('lancer-reactionChecker.onTurnEnd', (token) => {
        checkReactions('onTurnEnd', { triggeringToken: token });
    });

    Hooks.on('lancer-reactionChecker.onStatusApplied', (token, statusId, effect) => {
        checkReactions('onStatusApplied', { triggeringToken: token, statusId, effect });
    });

    Hooks.on('lancer-reactionChecker.onStatusRemoved', (token, statusId, effect) => {
        checkReactions('onStatusRemoved', { triggeringToken: token, statusId, effect });
    });

    Hooks.on('lancer-reactionChecker.onStructure', (token, remainingStructure, rollResult) => {
        checkReactions('onStructure', { triggeringToken: token, remainingStructure, rollResult });
    });

    Hooks.on('lancer-reactionChecker.onStress', (token, remainingStress, rollResult) => {
        checkReactions('onStress', { triggeringToken: token, remainingStress, rollResult });
    });

    Hooks.on('lancer-reactionChecker.onHeat', (token, heatGained, currentHeat, inDangerZone) => {
        checkReactions('onHeat', { triggeringToken: token, heatGained, currentHeat, inDangerZone });
    });

    Hooks.on('lancer-reactionChecker.onDestroyed', (token) => {
        checkReactions('onDestroyed', { triggeringToken: token });
    });

    Hooks.on('lancer-reactionChecker.onTechAttack', (attacker, techItem, targets, actionData) => {
        checkReactions('onTechAttack', {
            triggeringToken: attacker,
            techItem, targets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onTechHit', (attacker, techItem, hitTargets, actionData) => {
        checkReactions('onTechHit', {
            triggeringToken: attacker,
            techItem,
            targets: hitTargets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onTechMiss', (attacker, techItem, missTargets, actionData) => {
        checkReactions('onTechMiss', {
            triggeringToken: attacker,
            techItem,
            targets: missTargets,
            actionName: actionData?.title || actionData?.action?.name || null,
            isInvade: actionData?.isInvade || false,
            tags: actionData?.tags || [],
            actionData
        });
    });

    Hooks.on('lancer-reactionChecker.onCheck', (token, statName, roll, total, success) => {
        checkReactions('onCheck', { triggeringToken: token, statName, roll, total, success });
    });

    Hooks.on('lancer-reactionChecker.onActivation', (token, actionType, actionName, item, actionData) => {
        checkReactions('onActivation', { triggeringToken: token, actionType, actionName, item, actionData });
    });

    Hooks.on('lancer-reactionChecker.onHPRestored', (token, hpRestored, currentHP, maxHP) => {
        checkReactions('onHPRestored', { triggeringToken: token, hpRestored, currentHP, maxHP });
    });

    Hooks.on('lancer-reactionChecker.onHpLoss', (token, hpLost, currentHP) => {
        checkReactions('onHpLoss', { triggeringToken: token, hpLost, currentHP });
    });

    Hooks.on('lancer-reactionChecker.onClearHeat', (token, heatCleared, currentHeat) => {
        checkReactions('onClearHeat', { triggeringToken: token, heatCleared, currentHeat });
    });
}

function registerSettings() {
    game.settings.register('lancer-reactionChecker', 'reactionNotificationMode', {
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

    game.settings.register('lancer-reactionChecker', 'consumeReaction', {
        name: 'Consume Activation on Activate',
        hint: 'Automatically reduce reaction count by 1 when activating an activation.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
    });

    game.settings.registerMenu('lancer-reactionChecker', 'resetSettings', {
        name: 'Reset Module',
        label: 'Reset to Defaults',
        hint: 'Reset all module settings and activations to their default values.',
        icon: 'fas fa-undo',
        type: ReactionReset,
        restricted: true
    });

    game.settings.registerMenu('lancer-reactionChecker', 'exportActivations', {
        name: 'Export Activations',
        label: 'Export to JSON',
        hint: 'Export all custom activations to a JSON file.',
        icon: 'fas fa-file-export',
        type: ReactionExport,
        restricted: true
    });

    game.settings.registerMenu('lancer-reactionChecker', 'importActivations', {
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
        if (payload.targetUserId && payload.targetUserId !== game.userId) return;

        const { triggerType, reactions } = payload;

        const reconstructed = [];
        for (const r of reactions) {
            const token = canvas.tokens.get(r.tokenId);
            if (!token) continue;

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
    }
}

function handleTokenMove(document, change, options, userId) {
    const threshold = canvas.grid.size / 2;
    const hasElevationChange = change.elevation !== undefined && change.elevation !== document.elevation;
    const hasXChange = change.x !== undefined && Math.abs(change.x - document.x) >= threshold;
    const hasYChange = change.y !== undefined && Math.abs(change.y - document.y) >= threshold;

    if (!hasElevationChange && !hasXChange && !hasYChange) return;

    const token = canvas.tokens.get(document.id);
    if (!token) return;

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

    Hooks.callAll('lancer-reactionChecker.onMove', token, distanceMoved, elevationMoved, startPos, endPos);
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

    Hooks.callAll('lancer-reactionChecker.onAttack', token, weapon, targets, actionData);
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

        if (!targetToken) continue;

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
        Hooks.callAll('lancer-reactionChecker.onHit', token, weapon, hitTargets, actionData);
    }
    if (missTargets.length > 0) {
        Hooks.callAll('lancer-reactionChecker.onMiss', token, weapon, missTargets, actionData);
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
        const targetDamages = targetInfo.damage?.map(d => d.amount) || [];
        const targetTypes = targetInfo.damage?.map(d => d.type) || [];

        if (targetDamages.length > 0) {
            Hooks.callAll('lancer-reactionChecker.onDamage', token, weapon, targetToken, targetDamages, targetTypes, isCrit, actionData);
        }
    }

    return true;
}

async function onStructureStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStructure = actor?.system?.structure?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    Hooks.callAll('lancer-reactionChecker.onStructure', token, remainingStructure, rollResult);
    return true;
}

async function onStressStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const remainingStress = actor?.system?.stress?.value ?? 0;
    const rollResult = state.data?.result?.roll?.total;

    Hooks.callAll('lancer-reactionChecker.onStress', token, remainingStress, rollResult);
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

    Hooks.callAll('lancer-reactionChecker.onTechAttack', token, techItem, targets, actionData);
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

        if (!targetToken) continue;

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
        Hooks.callAll('lancer-reactionChecker.onTechHit', token, techItem, hitTargets, actionData);
    }
    if (missTargets.length > 0) {
        Hooks.callAll('lancer-reactionChecker.onTechMiss', token, techItem, missTargets, actionData);
    }

    return true;
}

async function onCheckStep(state) {
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const statName = state.data?.title || 'Unknown';
    const roll = state.data?.result?.roll;
    const total = roll?.total;
    const success = state.data?.result?.success;

    Hooks.callAll('lancer-reactionChecker.onCheck', token, statName, roll, total, success);
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

    Hooks.callAll('lancer-reactionChecker.onActivation', token, actionType, actionName, item, actionData);
    return true;
}

Hooks.once('lancer.registerFlows', (flowSteps, flows) => {
    flowSteps.set('lancer-reactionChecker:onAttack', onAttackStep);
    flowSteps.set('lancer-reactionChecker:onHitMiss', onHitMissStep);
    flowSteps.set('lancer-reactionChecker:onDamage', onDamageStep);
    flowSteps.set('lancer-reactionChecker:onStructure', onStructureStep);
    flowSteps.set('lancer-reactionChecker:onStress', onStressStep);
    flowSteps.set('lancer-reactionChecker:onTechAttack', onTechAttackStep);
    flowSteps.set('lancer-reactionChecker:onTechHitMiss', onTechHitMissStep);
    flowSteps.set('lancer-reactionChecker:onCheck', onCheckStep);
    flowSteps.set('lancer-reactionChecker:onActivation', onActivationStep);

    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-reactionChecker:onAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-reactionChecker:onHitMiss');

    flows.get('BasicAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-reactionChecker:onAttack');
    flows.get('BasicAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-reactionChecker:onHitMiss');

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-reactionChecker:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-reactionChecker:onTechHitMiss');

    flows.get('DamageRollFlow')?.insertStepAfter('rollNormalDamage', 'lancer-reactionChecker:onDamage');

    flows.get('StructureFlow')?.insertStepAfter('rollStructureTable', 'lancer-reactionChecker:onStructure');
    flows.get('OverheatFlow')?.insertStepAfter('rollOverheatTable', 'lancer-reactionChecker:onStress');

    flows.get('StatRollFlow')?.insertStepAfter('rollCheck', 'lancer-reactionChecker:onCheck');

    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-reactionChecker:onActivation');
    flows.get('SystemFlow')?.insertStepAfter('printSystemCard', 'lancer-reactionChecker:onActivation');
});

Hooks.on('init', () => {
    console.log('lancer-reactionChecker | Init');
    registerSettings();
});

Hooks.on('ready', () => {
    console.log('lancer-reactionChecker | Ready');

    ReactionManager.initialize();
    registerReactionHooks();

    game.modules.get('lancer-reactionChecker').api = {
        drawThreatDebug,
        drawDistanceDebug,
        getTokenDistance,
        checkOverwatchCondition,
        isHostile,
        isFriendly,
        getActorMaxThreat,
        getMinGridDistance,
        registerDefaultItemReactions: registerExternalItemReactions,
        registerDefaultGeneralReactions: registerExternalGeneralReactions
    };
    game.socket.on('module.lancer-reactionChecker', handleSocketEvent);

    Hooks.callAll('lancer-reactionChecker.ready', game.modules.get('lancer-reactionChecker').api);
});

Hooks.on('preUpdateToken', handleTokenMove);

let previousCombatantId = null;

Hooks.on('combatTurnChange', (combat, prior, current) => {
    if (prior.combatantId) {
        const endingCombatant = combat.combatants.get(prior.combatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            Hooks.callAll('lancer-reactionChecker.onTurnEnd', endingToken);
        }
    }

    if (current.combatantId) {
        const startingCombatant = combat.combatants.get(current.combatantId);
        const startingToken = startingCombatant?.token ? canvas.tokens.get(startingCombatant.token.id) : null;
        if (startingToken) {
            Hooks.callAll('lancer-reactionChecker.onTurnStart', startingToken);
        }
    }

    previousCombatantId = current.combatantId;
});

Hooks.on('updateCombat', (combat, change, options, userId) => {
    if (change.turn === undefined && change.round === undefined) return;

    const currentCombatant = combat.combatant;
    if (!currentCombatant) return;

    if (previousCombatantId && previousCombatantId !== currentCombatant.id) {
        const endingCombatant = combat.combatants.get(previousCombatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            Hooks.callAll('lancer-reactionChecker.onTurnEnd', endingToken);
        }
    }

    const startingToken = currentCombatant.token ? canvas.tokens.get(currentCombatant.token.id) : null;
    if (startingToken && currentCombatant.id !== previousCombatantId) {
        Hooks.callAll('lancer-reactionChecker.onTurnStart', startingToken);
    }

    previousCombatantId = currentCombatant.id;
});

Hooks.on('createActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!actor) return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    Hooks.callAll('lancer-reactionChecker.onStatusApplied', token, statusId, effect);
});

Hooks.on('deleteActiveEffect', (effect, options, userId) => {
    const actor = effect.parent;
    if (!actor) return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    Hooks.callAll('lancer-reactionChecker.onStatusRemoved', token, statusId, effect);
});

let previousHeatValues = new Map();
let previousHPValues = new Map();

Hooks.on('updateActor', (actor, change, options, userId) => {
    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    if (!token) return;

    if (change.system?.heat?.value !== undefined) {
        const previousHeat = previousHeatValues.get(actor.id) ?? actor.system.heat.value;
        const currentHeat = change.system.heat.value;
        const heatChange = currentHeat - previousHeat;

        if (heatChange > 0) {
            const heatMax = actor.system.heat.max;
            const inDangerZone = currentHeat >= Math.floor(heatMax / 2);
            Hooks.callAll('lancer-reactionChecker.onHeat', token, heatChange, currentHeat, inDangerZone);
        } else if (heatChange < 0) {
            const heatCleared = Math.abs(heatChange);
            Hooks.callAll('lancer-reactionChecker.onClearHeat', token, heatCleared, currentHeat);
        }

        previousHeatValues.set(actor.id, currentHeat);
    }

    if (change.system?.hp?.value !== undefined) {
        const previousHP = previousHPValues.get(actor.id) ?? actor.system.hp.value;
        const currentHP = change.system.hp.value;
        const hpChange = currentHP - previousHP;

        if (hpChange > 0) {
            const maxHP = actor.system.hp.max;
            Hooks.callAll('lancer-reactionChecker.onHPRestored', token, hpChange, currentHP, maxHP);
        } else if (hpChange < 0) {
            const hpLost = Math.abs(hpChange);
            Hooks.callAll('lancer-reactionChecker.onHpLoss', token, hpLost, currentHP);

            if (previousHP > 0 && currentHP <= 0) {
                Hooks.callAll('lancer-reactionChecker.onDestroyed', token);
            }
        }

        previousHPValues.set(actor.id, currentHP);
    }
});
