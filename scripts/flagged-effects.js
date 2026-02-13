/* global CONFIG, canvas, game, Dialog, ChatMessage, ui */

function log(...args) {
    console.log("lancer-automations |", ...args);
}

export function pushFlaggedEffect(targetID, effect, duration, note, originID) {
    if (game.users.filter(x => x.role === 4 && x.active).length < 1) {
        log('There is no active GM.');
        return ui.notifications.error('There must be an active GM for this to work.');
    }
    if (game.user.isGM) {
        // You are a GM, let's just set it.
        log(`Local setFlaggedEffect ${effect}`);
        setFlaggedEffect(targetID, effect, duration, note, originID);
    } else {
        // You are a user, ask a GM to do it.
        log(`Pushing setFlaggedEffect ${effect}`);
        game.socket.emit('module.lancer-automations', { action: "setFlaggedEffect", payload: { targetID, effect, duration, note, originID } });
    }
}

export async function setFlaggedEffect(targetID, effectOrData, duration, note, originID, extraOptions = {}) {
    log('**setFlaggedEffect**');
    const target = canvas.tokens.placeables.find(x => x.id === targetID);
    if (!target)
        return;

    // Handle Custom Data Object
    if (typeof effectOrData === 'object' && effectOrData.isCustom) {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;

        if (customStatusApi) {
            // Check for existing effect to stack
            const existingEffect = target.actor.effects.find(e =>
                e.getFlag("temporary-custom-statuses", "originalName") === effectOrData.name
            );

            if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId) {
                const addStack = extraOptions.stack || effectOrData.stack || 1;
                await customStatusApi.modifyStack(target.actor, existingEffect.id, addStack);

                // Build duration entries for stack-aware expiration
                const entries = [...(existingEffect.getFlag('lancer-automations', 'durationEntries') || [])];
                if (entries.length === 0) {
                    const existingDur = existingEffect.getFlag('lancer-automations', 'duration');
                    const existingOrigin = existingEffect.getFlag('lancer-automations', 'originID');
                    const existingApplied = existingEffect.getFlag('lancer-automations', 'appliedStack');
                    const existingStack = existingEffect.flags?.statuscounter?.value || 1;
                    if (existingDur && existingDur.label !== 'indefinite' && existingDur.turns !== null) {
                        entries.push({ label: existingDur.label, turns: existingDur.turns, originID: existingOrigin, stack: existingApplied || existingStack });
                    }
                }
                if (duration && duration.label !== 'indefinite' && duration.turns !== null) {
                    entries.push({ label: duration.label, turns: duration.turns, originID: originID, stack: addStack });
                }

                const flagsData = {
                    targetID: targetID,
                    effect: effectOrData.name,
                    duration: duration,
                    note: note,
                    originID: originID,
                    appliedRound: game.combat?.round || 0,
                    appliedStack: addStack,
                    ...extraOptions
                };
                if (entries.length > 0)
                    flagsData.durationEntries = entries;

                const totalStack = (existingEffect.flags?.statuscounter?.value || 1) + (extraOptions.stack || effectOrData.stack || 1);
                await existingEffect.update({
                    "flags.lancer-automations": flagsData,
                    "flags.statuscounter.visible": totalStack > 1
                });
                return;
            }

            const lancerFlags = {
                targetID: targetID,
                effect: effectOrData.name,
                duration: duration,
                note: note,
                originID: originID,
                appliedRound: game.combat?.round || 0,
                appliedStack: extraOptions.stack || effectOrData.stack || 1,
                ...extraOptions
            };

            const counterValue = extraOptions.stack || effectOrData.stack || 1;

            const activeEffects = await customStatusApi.addStatus(
                target.actor,
                effectOrData.name,
                effectOrData.icon,
                counterValue,
                {
                    forceNew: !!(extraOptions.consumption || extraOptions.linkedBonusId),
                    extraFlags: {
                        "lancer-automations": lancerFlags,
                        "statuscounter": { value: counterValue, visible: counterValue > 1 }
                    }
                }
            );

            if (activeEffects && !Array.isArray(activeEffects)) {
                // modifyStack was called — update our flags on the existing effect
                const existingEffect = target.actor.effects.find(e =>
                    e.getFlag("temporary-custom-statuses", "originalName") === effectOrData.name
                );
                if (existingEffect) {
                    const updateData = { "flags.lancer-automations": lancerFlags };
                    if (extraOptions?.changes?.length)
                        updateData.changes = extraOptions.changes;
                    await existingEffect.update(updateData);
                }
            } else if (Array.isArray(activeEffects) && activeEffects[0]) {
                // New effect created — statuscounter module may overwrite, re-set
                const updateData = {
                    "flags.statuscounter.value": counterValue,
                    "flags.statuscounter.visible": counterValue > 1
                };
                if (extraOptions?.changes?.length)
                    updateData.changes = extraOptions.changes;
                await activeEffects[0].update(updateData);
            }
            return;
        }

        // Fallback if module not active
        const effectData = {
            name: effectOrData.name,
            img: effectOrData.icon,
            statuses: [],
            changes: extraOptions?.changes || [],
            flags: {
                'lancer-automations': {
                    targetID: targetID,
                    effect: effectOrData.name,
                    duration: duration,
                    note: note,
                    originID: originID,
                    appliedRound: game.combat?.round || 0,
                    ...extraOptions
                },
                'temporary-custom-statuses': {
                    isCustom: true,
                    originalName: effectOrData.name
                },
                'statuscounter': {
                    value: extraOptions.stack || effectOrData.stack || 1,
                    visible: (extraOptions.stack || effectOrData.stack || 1) > 1
                }
            }
        };

        const fallbackStackVal = extraOptions.stack || effectOrData.stack || 1;
        const fallbackCreated = await target.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        if (fallbackCreated?.[0]) {
            await fallbackCreated[0].update({
                "flags.statuscounter.value": fallbackStackVal,
                "flags.statuscounter.visible": fallbackStackVal > 1
            });
        }

    } else {
        const effectName = typeof effectOrData === 'string' ? effectOrData : effectOrData.name;
        const statusEffect = CONFIG.statusEffects.find(x => x.name === effectName);

        if (!statusEffect) {
            ui.notifications.error(`Effect ${effectName} not found`);
            return;
        }

        // Check for existing effect to stack
        const existingEffect = target.actor.effects.find(e =>
            e.name === game.i18n.localize(statusEffect.name) ||
            e.statuses.has(statusEffect.id) ||
            e.getFlag('lancer-automations', 'effect') === statusEffect.name
        );

        if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId) {
            // Update existing stack
            const currentStack = existingEffect.getFlag('statuscounter', 'value') || 1;
            const addStack = extraOptions.stack || 1;
            const newStack = currentStack + addStack;

            // Build duration entries for stack-aware expiration
            const updateData = {
                "flags.statuscounter.value": newStack,
                "flags.statuscounter.visible": newStack > 1
            };

            if (duration && duration.label !== 'indefinite' && duration.turns !== null) {
                const entries = [...(existingEffect.getFlag('lancer-automations', 'durationEntries') || [])];
                if (entries.length === 0) {
                    const existingDur = existingEffect.getFlag('lancer-automations', 'duration');
                    const existingOrigin = existingEffect.getFlag('lancer-automations', 'originID');
                    const existingApplied = existingEffect.getFlag('lancer-automations', 'appliedStack') || currentStack;
                    if (existingDur && existingDur.label !== 'indefinite' && existingDur.turns !== null) {
                        entries.push({ label: existingDur.label, turns: existingDur.turns, originID: existingOrigin, stack: existingApplied });
                    }
                }
                entries.push({ label: duration.label, turns: duration.turns, originID: originID, stack: addStack });
                updateData["flags.lancer-automations.durationEntries"] = entries;
                updateData["flags.lancer-automations.duration"] = duration;
                updateData["flags.lancer-automations.originID"] = originID;
                updateData["flags.lancer-automations.appliedStack"] = addStack;
            }

            await existingEffect.update(updateData);
            ui.notifications.info(`Increased stack of ${statusEffect.name} on ${target.name} to ${newStack}.`);
            return;
        }

        const flags = {
            'lancer-automations': {
                targetID: targetID,
                effect: statusEffect.name,
                duration: duration,
                note: note,
                originID: originID,
                appliedRound: game.combat?.round || 0,
                appliedStack: extraOptions.stack || 0,
                ...extraOptions
            }
        };

        // Set statuscounter if stack is provided (used for both visual stacks and consumption charges)
        const stackVal = extraOptions.stack || 0;
        if (stackVal > 0) {
            flags['statuscounter'] = {
                value: stackVal,
                visible: stackVal > 1
            };
        }

        const effectData = {
            name: game.i18n.localize(statusEffect.name),
            img: statusEffect.img,
            description: statusEffect.description,
            id: statusEffect.id,
            statuses: [statusEffect.id],
            flags: flags,
            changes: extraOptions?.changes || []
        };
        log(statusEffect);
        log(effectData);
        const created = await target.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);

        // Post-creation update: statuscounter module may overwrite our flags, so re-set them
        if (stackVal > 0 && created?.[0]) {
            await created[0].update({
                "flags.statuscounter.value": stackVal,
                "flags.statuscounter.visible": stackVal > 1
            });
        }
    }
}

export async function removeFlaggedEffect(targetID, effectName, originID = null) {
    log('**removeFlaggedEffect**');
    const target = canvas.tokens.placeables.find(x => x.id === targetID);
    if (!target)
        return;

    let effectsStr = typeof effectName === 'object' ? effectName.name : effectName;
    // Normalize logic similar to check
    const effectNameLower = effectsStr.toLowerCase().split('.').pop();

    // Find effects matching the criteria
    const effectsToDelete = target.actor.effects.filter(e => {
        if (e.getFlag('lancer-automations', 'effect') === effectsStr)
            return true;
        if (e.getFlag('csm-lancer-qol', 'effect') === effectsStr)
            return true;
        if (e.name?.toLowerCase().includes(effectNameLower) ||
            e.statuses?.has(effectNameLower))
            return true;

        if (originID) {
            const flagOrigin = e.getFlag('lancer-automations', 'originID') || e.getFlag('csm-lancer-qol', 'originID');
            if (flagOrigin && flagOrigin !== originID)
                return false;
        }

        return false;
    });

    if (effectsToDelete.length > 0) {
        log(`Removing ${effectsToDelete.length} effects matching ${effectsStr} from ${target.name}`);
        await target.actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete.map(e => e.id));
    }
}

/**
 * Apply flagged effect(s) to a list of tokens with combat tracking
 * @param {Object} options - Configuration options
 * @param {Array} options.tokens - Array of tokens to apply effect to
 * @param {Array<string>|string} options.effectNames - Effect name(s) to apply (single string or array)
 * @param {string} options.note - Note/description for the effect
 * @param {Object} options.duration - Duration object { label: 'end', turns: 1, rounds: 0 }
 * @param {boolean} [options.useTokenAsOrigin=true] - If true, uses targetID as originID in payload
 * @param {string} [options.customOriginId] - Optional custom origin ID (ignored if useTokenAsOrigin is true)
 * @param {Function} [options.checkEffectCallback] - Optional custom function to check if effect already exists
 * @returns {Array} Array of valid tokens that received the effect(s)
 */
export async function applyFlaggedEffectToTokens(options, extraOptions = {}) {
    const {
        tokens,
        effectNames,
        note,
        duration,
        useTokenAsOrigin = true,
        customOriginId = null,
        checkEffectCallback = null
    } = options;

    // Normalize effectNames to always be an array
    const effectsToApply = Array.isArray(effectNames) ? effectNames : [effectNames];

    if (!effectNames || effectsToApply.length === 0) {
        ui.notifications.error('No effect name(s) specified!');
        return [];
    }

    const validTokens = [];

    for (const token of tokens) {
        const effectsToApplyToToken = [];

        // Check each effect individually
        for (const effect of effectsToApply) {
            let hasEffect = false;
            let existingEffect = null;
            let effectNameForLog = typeof effect === 'string' ? effect : effect.name;

            if (checkEffectCallback) {
                // Use custom check function if provided
                hasEffect = checkEffectCallback(token, effect);
            } else if (extraOptions?.consumption?.groupId || extraOptions?.linkedBonusId) {
                // Smart duplicate check: if the incoming effect has consumption/group data,
                // only consider it a duplicate if an existing effect has the SAME groupId or linkedBonusId.
                // Different sources = different effects, allowed to coexist.
                const groupId = extraOptions.consumption?.groupId;
                const bonusId = extraOptions.linkedBonusId;
                hasEffect = token.actor?.effects.some(e => {
                    const flags = e.flags?.['lancer-automations'] || {};
                    if (groupId && flags.consumption?.groupId === groupId)
                        return true;
                    if (bonusId && flags.linkedBonusId === bonusId)
                        return true;
                    return false;
                });
            } else {
                // Check if effect exists to stack it
                const effectNameToCheck = typeof effect === 'string' ? effect : effect.name;
                const effectNameLower = effectNameToCheck.toLowerCase().split('.').pop();

                existingEffect = token.actor?.effects.find(e =>
                    e.name?.toLowerCase().includes(effectNameLower) ||
                    e.statuses?.has(effectNameLower) ||
                    e.flags?.['lancer-automations']?.effect === effectNameToCheck ||
                    e.flags?.['csm-lancer-qol']?.effect === effectNameToCheck
                );

                // If it exists, we will update it (stack), so we DON'T block it.
            }

            if (checkEffectCallback && hasEffect) {
                // Custom callback blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()}!`);
            } else if ((extraOptions?.consumption?.groupId || extraOptions?.linkedBonusId) && hasEffect) {
                // Groups/Bonuses check blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()} (Group/Bonus conflict)!`);
            } else {
                // Add this effect to the list to apply (or stack)
                effectsToApplyToToken.push(effect);
            }
        }

        // Skip this token if no effects need to be applied
        if (effectsToApplyToToken.length === 0)
            continue;
        validTokens.push(token);

        const tokenID = token.id;
        const originID = useTokenAsOrigin ? token.id : (customOriginId || token.id);

        // Calculate duration - if it's currently the origin's turn, adjust turns to avoid immediate expiration
        let adjustedDuration = { ...duration };
        if (game.combat?.current?.tokenId === originID && duration.turns === 1) {
            adjustedDuration.turns = 2;
        }

        // Apply
        for (const effect of effectsToApplyToToken) {
            if (game.user.isGM) {
                // GM applies directly
                setFlaggedEffect(tokenID, effect, adjustedDuration, note, originID, extraOptions);
            } else {
                // Non-GM uses socket
                game.socket.emit('module.lancer-automations', {
                    action: "setFlaggedEffect",
                    payload: { targetID: tokenID, effect: effect, duration: adjustedDuration, note, originID, extraOptions }
                });
            }
        }
    }

    return validTokens;
}

/**
 * Remove flagged effect(s) from a list of tokens
 * @param {Object} options - Configuration options
 * @param {Array} options.tokens - Array of tokens to remove effect from
 * @param {Array<string>|string} options.effectNames - Effect name(s) to remove (single string or array)
 * @param {string} [options.originId] - Optional origin ID to filter removal
 * @returns {Array} Array of tokens processed
 */
export async function removeFlaggedEffectToTokens(options) {
    const {
        tokens,
        effectNames,
        originId = null
    } = options;

    const effectsToRemove = Array.isArray(effectNames) ? effectNames : [effectNames];

    if (!effectNames || effectsToRemove.length === 0) {
        ui.notifications.error('No effect name(s) specified for removal!');
        return [];
    }

    const processedTokens = [];

    for (const token of tokens) {
        processedTokens.push(token);
        const tokenID = token.id;

        for (const effect of effectsToRemove) {
            let effectNameVal = typeof effect === 'object' ? effect.name : effect;

            if (game.user.isGM) {
                removeFlaggedEffect(tokenID, effectNameVal, originId);
            } else {
                game.socket.emit('module.lancer-automations', {
                    action: "removeFlaggedEffect",
                    payload: { targetID: tokenID, effect: effectNameVal, originID: originId }
                });
            }
        }
    }
    return processedTokens;
}

/**
 * Find a flagged effect on a token
 * @param {Token|TokenDocument} token - The token to search on
 * @param {string|Function} identifier - Effect name (string) or predicate function (e => boolean)
 * @returns {ActiveEffect|undefined} The found effect or undefined
 */
export function findFlaggedEffectOnToken(token, identifier) {
    const actor = token?.actor;
    if (!actor)
        return undefined;

    if (typeof identifier === 'function') {
        return actor.effects.find(identifier);
    }

    if (typeof identifier === 'string') {
        // Check for effect by name or label (V12 uses name, older might use label)
        // Also check if it matches the flag 'effect' value which is robust
        return actor.effects.find(e =>
            e.name === identifier ||
            e.label === identifier ||
            e.getFlag('lancer-automations', 'effect') === identifier ||
            e.getFlag('csm-lancer-qol', 'effect') === identifier
        );
    }

    return undefined;
}

/**
 * Consume one charge from a flagged effect with a consumption trigger.
 * Decrements statuscounter.value. If it reaches 0, the effect is removed.
 * If the effect has a groupId, all effects in the group share the same counter.
 * @param {ActiveEffect} effect - The active effect to consume a charge from
 * @returns {Promise<boolean>} true if consumed, false if not applicable
 */
export async function consumeEffectCharge(effect) {
    if (!effect)
        return false;

    const actor = effect.parent;
    if (!actor)
        return false;

    const consumption = effect.getFlag('lancer-automations', 'consumption');
    if (!consumption?.trigger)
        return false;

    const currentStack = effect.flags?.statuscounter?.value ?? 1;
    const newStack = currentStack - 1;
    const groupId = consumption.groupId;

    if (groupId) {
        const groupEffects = actor.effects.filter(e => {
            const c = e.flags?.['lancer-automations']?.consumption;
            return c?.groupId === groupId;
        });

        if (newStack <= 0) {
            const idsToDelete = groupEffects.map(e => e.id);
            log(`Consumption depleted for group ${groupId}, removing ${idsToDelete.length} effects`);
            await actor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
        } else {
            const updates = groupEffects.map(e => ({
                _id: e.id,
                "flags.statuscounter.value": newStack,
                "flags.statuscounter.visible": newStack > 1
            }));
            log(`Consuming charge for group ${groupId}: ${newStack} remaining`);
            await actor.updateEmbeddedDocuments("ActiveEffect", updates);
        }
    } else {
        if (newStack <= 0) {
            log(`Consumption depleted for ${effect.name}, removing effect`);
            await effect.delete();
        } else {
            log(`Consuming charge for ${effect.name}: ${newStack} remaining`);
            await effect.update({ "flags.statuscounter.value": newStack, "flags.statuscounter.visible": newStack > 1 });
        }
    }

    return true;
}

/**
 * Process duration-based effects on turn changes.
 * Decrements turn counters and removes effects (or stacks) when they expire.
 * Supports both single-duration effects and multi-duration stacked effects via durationEntries.
 * @param {string} triggerLabel - 'start' or 'end'
 * @param {string} triggeringTokenId - The token ID whose turn is starting/ending
 */
export async function processDurationEffects(triggerLabel, triggeringTokenId) {
    // Only the active GM processes duration to avoid conflicts
    if (game.user.id !== game.users.find(u => u.active && u.isGM)?.id)
        return;

    const allTokens = canvas.tokens.placeables.filter(t => t.actor);

    for (const token of allTokens) {
        const actor = token.actor;
        if (!actor)
            continue;

        const effects = [...actor.effects];

        for (const effect of effects) {
            const flags = effect.flags?.['lancer-automations'];
            if (!flags) {
                // Check legacy namespace
                const legacyFlags = effect.flags?.['csm-lancer-qol'];
                if (!legacyFlags?.duration)
                    continue;
                // Treat legacy as single-duration
                const dur = legacyFlags.duration;
                if (!dur || dur.label === 'indefinite' || dur.turns === null || dur.turns === undefined)
                    continue;
                if (dur.label !== triggerLabel)
                    continue;
                const legacyOrigin = legacyFlags.originID;
                if (legacyOrigin !== triggeringTokenId)
                    continue;

                const newTurns = (dur.turns || 1) - 1;
                if (newTurns <= 0) {
                    log(`Duration expired for ${effect.name} (legacy), removing effect`);
                    await effect.delete();
                } else {
                    await effect.update({ "flags.csm-lancer-qol.duration.turns": newTurns });
                }
                continue;
            }

            // Check durationEntries first (multi-duration stacks)
            const entries = flags.durationEntries;

            if (entries && Array.isArray(entries) && entries.length > 0) {
                let totalStackToRemove = 0;
                const remaining = [];
                let modified = false;

                for (const entry of entries) {
                    if (entry.label !== triggerLabel || entry.originID !== triggeringTokenId) {
                        remaining.push(entry);
                        continue;
                    }

                    modified = true;
                    const newTurns = (entry.turns || 1) - 1;

                    if (newTurns <= 0) {
                        totalStackToRemove += (entry.stack || 1);
                    } else {
                        remaining.push({ ...entry, turns: newTurns });
                    }
                }

                if (!modified)
                    continue;

                if (totalStackToRemove > 0) {
                    const currentStack = effect.flags?.statuscounter?.value || 1;
                    const newStack = currentStack - totalStackToRemove;

                    if (newStack <= 0 || remaining.length === 0) {
                        log(`Duration expired for ${effect.name} (all stacks depleted), removing effect`);
                        await effect.delete();
                    } else {
                        log(`Duration expired for ${effect.name}, removing ${totalStackToRemove} stacks (${newStack} remaining)`);
                        await effect.update({
                            "flags.statuscounter.value": newStack,
                            "flags.statuscounter.visible": newStack > 1,
                            "flags.lancer-automations.durationEntries": remaining
                        });
                    }
                } else {
                    // Entries were modified (turns decremented) but none expired yet
                    await effect.update({
                        "flags.lancer-automations.durationEntries": remaining
                    });
                }
            } else {
                // Fall back to single duration field
                const dur = flags.duration;
                if (!dur || dur.label === 'indefinite' || dur.turns === null || dur.turns === undefined)
                    continue;
                if (dur.label !== triggerLabel)
                    continue;

                const originID = flags.originID;
                if (originID !== triggeringTokenId)
                    continue;

                const newTurns = (dur.turns || 1) - 1;

                if (newTurns <= 0) {
                    const appliedStack = flags.appliedStack || 0;

                    if (appliedStack > 0) {
                        const currentStack = effect.flags?.statuscounter?.value || 0;
                        const newStack = currentStack - appliedStack;

                        if (newStack <= 0) {
                            log(`Duration expired for ${effect.name}, removing effect (all stacks)`);
                            await effect.delete();
                        } else {
                            log(`Duration expired for ${effect.name}, removing ${appliedStack} stacks (${newStack} remaining)`);
                            await effect.update({
                                "flags.statuscounter.value": newStack,
                                "flags.statuscounter.visible": newStack > 1,
                                "flags.lancer-automations.duration": null,
                                "flags.lancer-automations.appliedStack": null
                            });
                        }
                    } else {
                        log(`Duration expired for ${effect.name}, removing effect`);
                        await effect.delete();
                    }
                } else {
                    await effect.update({
                        "flags.lancer-automations.duration.turns": newTurns
                    });
                }
            }
        }
    }
}
