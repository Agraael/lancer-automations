/* global CONFIG, canvas, game, Dialog, ChatMessage, ui */

function log(...args) {
    console.log("lancer-automations |", ...args);
}

let notificationQueue = [];
let notificationTimer = null;

// Settings cache for external module lookups
const _statusCache = {
    data: null,
    timestamp: 0,
    ttl: 500 // 500ms TTL is safe for user-driven changes
};

/**
 * Helper to get saved statuses with a short-lived cache to avoid redundant settings lookups in loops.
 */
function _getSavedStatuses() {
    const now = Date.now();
    if (!_statusCache.data || (now - _statusCache.timestamp > _statusCache.ttl)) {
        _statusCache.data = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
        _statusCache.timestamp = now;
    }
    return _statusCache.data;
}

/**
 * Queue an effect notification to be aggregated.
 * @param {Token|TokenDocument} token - The token involved
 * @param {string} effectName - Name of the effect
 * @param {Object|boolean} notifyOptions - Notification options { source, prefixText }
 * @param {string} defaultPrefix - Default prefix if notifyOptions.text is missing
 * @param {string} icon - Icon path
 */
function queueEffectNotification(token, effectName, notifyOptions, defaultPrefix, icon) {
    if (!notifyOptions)
        return;
    // Normalize token
    const tokenObj = token.object || token;
    notificationQueue.push({
        token: tokenObj,
        effectName,
        prefix: notifyOptions.prefixText || defaultPrefix,
        source: notifyOptions.source,
        icon
    });

    if (notificationTimer)
        clearTimeout(notificationTimer);
    notificationTimer = setTimeout(dispatchNotifications, 100);
}

async function dispatchNotifications() {
    if (notificationQueue.length === 0)
        return;

    const data = [...notificationQueue];
    notificationQueue = [];
    notificationTimer = null;

    // Group by token
    const tokenGroups = new Map();
    for (const item of data) {
        if (!tokenGroups.has(item.token.id)) {
            tokenGroups.set(item.token.id, { token: item.token, updates: [] });
        }
        tokenGroups.get(item.token.id).updates.push(item);
    }

    let fullContent = "";
    for (const [tokenId, group] of tokenGroups) {
        const token = group.token;
        const updates = group.updates;
        const lines = updates.map(u => {
            let iconHtml = u.icon ? `<img src="${u.icon}" width="20" height="20" style="border:none; vertical-align:middle; margin-right:4px;"> ` : "";
            let actionText = `${iconHtml}${u.prefix} <strong>${u.effectName}</strong>`;

            let sourceText = "";
            if (u.source) {
                const name = typeof u.source === 'object' ? u.source.name : u.source;
                if (name)
                    sourceText = ` with ${name}`;
            }

            return `<li>${actionText}${sourceText}</li>`;
        });

        fullContent += `<div><strong>${token.name}:</strong><ul>${lines.join("")}</ul></div>`;
    }

    if (fullContent) {
        await ChatMessage.create({
            content: `<div class="lancer-automations-notification">${fullContent}</div>`,
            speaker: ChatMessage.getSpeaker({ token: data[0].token.document || data[0].token })
        });
    }
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

/**
 * Returns true if the incoming extraOptions are considered the same "source" as an existing effect's stored flags.
 * Effects with different identity key values (e.g. different suppressSourceId) are treated as distinct
 * and should NOT be stacked onto each other.
 * @param {Object} extraOptions - The incoming extra options
 * @param {ActiveEffect} existingEffect - The existing effect on the actor
 */
function _sameIdentity(extraOptions, existingEffect) {
    const META_KEYS = new Set(['allowStack', 'stack', 'changes', 'consumption', 'linkedBonusId', 'grouped', 'groupId', 'forceNew']);
    const identityKeys = Object.keys(extraOptions || {}).filter(k => !META_KEYS.has(k));
    if (identityKeys.length === 0)
        return true;
    const storedFlags = existingEffect?.flags?.['lancer-automations'] || {};
    return identityKeys.every(k => storedFlags[k] === extraOptions[k]);
}

export async function setFlaggedEffect(targetID, effectOrData, duration, note, originID, extraOptions = {}) {
    log('**setFlaggedEffect**');
    const target = canvas.tokens.placeables.find(x => x.id === targetID);
    if (!target)
        return;

    let effectNameForLog = typeof effectOrData === 'string' ? effectOrData : effectOrData.name;
    const isCustomRequest = (typeof effectOrData === 'object' && effectOrData.isCustom);// Auto-detect if "string" effect is actually an existing custom effect
    let resolvedEffectData = effectOrData;
    if (typeof effectOrData === 'string') {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi) {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(s => s.name === effectOrData);
            if (hasCustom) {
                resolvedEffectData = { name: effectOrData, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
            }
        }
    } else if (typeof effectOrData === 'object' && effectOrData.name && !effectOrData.isCustom) {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi) {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(s => s.name === effectOrData.name);
            if (hasCustom) {
                resolvedEffectData = { ...effectOrData, isCustom: true, icon: effectOrData.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
            }
        }
    }

    if (resolvedEffectData && resolvedEffectData.isCustom && !resolvedEffectData.icon) {
        resolvedEffectData.icon = "icons/svg/mystery-man.svg";
    }

    // Handle Custom Data Object
    if (typeof resolvedEffectData === 'object' && resolvedEffectData.isCustom) {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;

        if (customStatusApi) {
            // Check for existing effect to stack
            const existingEffect = target.actor.effects.find(e =>
                e.getFlag("temporary-custom-statuses", "originalName") === resolvedEffectData.name
            );

            if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId && _sameIdentity(extraOptions, existingEffect)) {
                const addStack = extraOptions.stack || resolvedEffectData.stack || 1;
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
                    effect: resolvedEffectData.name,
                    duration: duration,
                    note: note,
                    originID: originID,
                    appliedRound: game.combat?.round || 0,
                    appliedStack: addStack,
                    ...extraOptions
                };
                if (entries.length > 0)
                    flagsData.durationEntries = entries;

                const totalStack = (existingEffect.flags?.statuscounter?.value || 1) + (extraOptions.stack || resolvedEffectData.stack || 1);
                await existingEffect.update({
                    "flags.lancer-automations": flagsData,
                    "flags.statuscounter.visible": totalStack > 1
                });
                return;
            }

            const lancerFlags = {
                targetID: targetID,
                effect: resolvedEffectData.name,
                duration: duration,
                note: note,
                originID: originID,
                appliedRound: game.combat?.round || 0,
                appliedStack: extraOptions.stack || resolvedEffectData.stack || 1,
                ...extraOptions
            };

            const counterValue = extraOptions.stack || resolvedEffectData.stack || 1;

            const activeEffects = await customStatusApi.addStatus(
                target.actor,
                resolvedEffectData.name,
                resolvedEffectData.icon,
                counterValue,
                {
                    forceNew: !!(extraOptions.consumption || extraOptions.linkedBonusId || existingEffect),
                    extraFlags: {
                        "lancer-automations": lancerFlags,
                        "statuscounter": { value: counterValue, visible: counterValue > 1 }
                    }
                }
            );

            if (activeEffects && !Array.isArray(activeEffects)) {
                // modifyStack was called — update our flags on the existing effect
                const existingEffect = target.actor.effects.find(e =>
                    e.getFlag("temporary-custom-statuses", "originalName") === resolvedEffectData.name
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
            name: resolvedEffectData.name,
            img: resolvedEffectData.icon,
            statuses: [],
            changes: extraOptions.changes || statusEffect.changes || [],
            flags: {
                'lancer-automations': {
                    targetID: targetID,
                    effect: resolvedEffectData.name,
                    duration: duration,
                    note: note,
                    originID: originID,
                    appliedRound: game.combat?.round || 0,
                    ...extraOptions
                },
                'temporary-custom-statuses': {
                    isCustom: true,
                    originalName: resolvedEffectData.name
                },
                'statuscounter': {
                    value: extraOptions.stack || resolvedEffectData.stack || 1,
                    visible: (extraOptions.stack || resolvedEffectData.stack || 1) > 1
                }
            }
        };

        const fallbackStackVal = extraOptions.stack || resolvedEffectData.stack || 1;
        const fallbackCreated = await target.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
        if (fallbackCreated?.[0]) {
            await fallbackCreated[0].update({
                "flags.statuscounter.value": fallbackStackVal,
                "flags.statuscounter.visible": fallbackStackVal > 1
            });
        }

    } else {
        const effectName = typeof resolvedEffectData === 'string' ? resolvedEffectData : resolvedEffectData.name;
        const statusEffect = CONFIG.statusEffects.find(x => x.name === effectName || x.id === effectName);

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

        if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId && _sameIdentity(extraOptions, existingEffect)) {
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
            changes: extraOptions.changes || statusEffect.changes || []
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

export async function removeFlaggedEffect(targetID, effectName, originID = null, extraFlags = null) {
    log('**removeFlaggedEffect**');
    const target = canvas.tokens.placeables.find(x => x.id === targetID);
    if (!target)
        return;

    let effectsStr = typeof effectName === 'object' ? effectName.name : effectName;
    // Normalize logic similar to check
    const effectNameLower = effectsStr.toLowerCase().split('.').pop();

    // Find effects matching the criteria
    const effectsToDelete = target.actor.effects.filter(e => {
        // When a source is specified, skip effects from any other source.
        if (originID) {
            const flagOrigin = e.getFlag('lancer-automations', 'originID') || e.getFlag('csm-lancer-qol', 'originID');
            if (flagOrigin !== originID)
                return false;
        }

        // When extra flag constraints are specified, all must match.
        if (extraFlags) {
            const storedFlags = e.flags?.['lancer-automations'] ?? {};
            for (const [key, val] of Object.entries(extraFlags)) {
                if (storedFlags[key] !== val)
                    return false;
            }
        }

        if (e.getFlag('lancer-automations', 'effect') === effectsStr)
            return true;
        if (e.getFlag('temporary-custom-statuses', 'originalName') === effectsStr)
            return true;
        if (e.getFlag('csm-lancer-qol', 'effect') === effectsStr)
            return true;
        if (e.name?.toLowerCase().includes(effectNameLower) ||
            e.statuses?.has(effectNameLower))
            return true;

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
 * @param {Object} [options.notify] - Optional notification options
 * @returns {Array} Array of valid tokens that received the effect(s)
 */
export async function applyFlaggedEffectToTokens(options = {notify: true}, extraOptions = {}) {
    const {
        tokens,
        effectNames,
        note,
        duration = {},
        useTokenAsOrigin = true,
        customOriginId = null,
        checkEffectCallback = null
    } = options;

    // Auto-generate groupId if grouped is true and no groupId was provided
    if (extraOptions?.consumption?.grouped && !extraOptions.consumption.groupId) {
        extraOptions.consumption.groupId = foundry.utils.randomID();
    }

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

            // Auto-detect if "string" effect is an existing custom effect
            let resolvedEffectData = effect;
            if (typeof effect === 'string') {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi) {
                    const savedStatuses = _getSavedStatuses();
                    const hasCustom = savedStatuses.find(s => s.name === effect);
                    if (hasCustom) {
                        resolvedEffectData = { name: effect, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
                    }
                }
            } else if (typeof effect === 'object' && effect.name && !effect.isCustom) {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi) {
                    const savedStatuses = _getSavedStatuses();
                    const hasCustom = savedStatuses.find(s => s.name === effect.name);
                    if (hasCustom) {
                        resolvedEffectData = { ...effect, isCustom: true, icon: effect.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
                    }
                }
            }

            if (checkEffectCallback) {
                // Use custom check function if provided
                hasEffect = checkEffectCallback(token, resolvedEffectData);
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
                const effectNameToCheck = typeof resolvedEffectData === 'string' ? resolvedEffectData : resolvedEffectData.name;
                const effectNameLower = effectNameToCheck.toLowerCase().split('.').pop();

                // Find a matching effect: same name AND same identity flags (different source = different effect).
                existingEffect = token.actor?.effects.find(e => {
                    const nameMatch = e.name?.toLowerCase().includes(effectNameLower) ||
                        e.statuses?.has(effectNameLower) ||
                        e.flags?.['lancer-automations']?.effect === effectNameToCheck ||
                        e.flags?.['csm-lancer-qol']?.effect === effectNameToCheck;
                    if (!nameMatch)
                        return false;
                    return _sameIdentity(extraOptions, e);
                });

                // If it exists, check if stacking is allowed
                if (existingEffect) {
                    const allowStack = extraOptions?.allowStack;
                    const hasConsumption = extraOptions?.consumption;

                    if (!allowStack && !hasConsumption) {
                        hasEffect = true; // Block stacking
                    }
                }
            }

            if (checkEffectCallback && hasEffect) {
                // Custom callback blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()}!`);
            } else if ((extraOptions?.consumption?.groupId || extraOptions?.linkedBonusId) && hasEffect) {
                // Groups/Bonuses check blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()} (Group/Bonus conflict)!`);
            } else if (hasEffect) {
                // Standard blocking (no stack allowed)
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()}!`);
            } else {
                // Add this effect to the list to apply (or stack)
                effectsToApplyToToken.push(resolvedEffectData);
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

            if (options.notify) {
                const effectName = typeof effect === 'string' ? effect : effect.name;
                const icon = typeof effect === 'object' ? (effect.icon || "icons/svg/mystery-man.svg") : CONFIG.statusEffects.find(e => e.id === effect)?.icon;
                queueEffectNotification(token, effectName, options.notify, 'Gained', icon);
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
 * @param {Object} [options.notify] - Optional notification options
 * @returns {Array} Array of tokens processed
 */
export async function removeFlaggedEffectToTokens(options = {notify: true}) {
    const {
        tokens,
        effectNames,
        originId = null,
        extraFlags = null,
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

            let icon = "";
            let resolvedEffect = effect;
            if (typeof effect === 'string') {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi) {
                    const savedStatuses = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
                    const hasCustom = savedStatuses.find(s => s.name === effect);
                    if (hasCustom) {
                        resolvedEffect = { name: effect, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
                        effectNameVal = effect;
                    }
                }
            } else if (typeof effect === 'object' && effect.name && !effect.isCustom) {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi) {
                    const savedStatuses = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
                    const hasCustom = savedStatuses.find(s => s.name === effect.name);
                    if (hasCustom) {
                        resolvedEffect = { ...effect, isCustom: true, icon: effect.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
                        effectNameVal = effect.name;
                    }
                }
            }

            if (options.notify) {
                const existing = findFlaggedEffectOnToken(token, effectNameVal);
                icon = existing?.img || existing?.icon || (typeof resolvedEffect === 'object' ? resolvedEffect.icon : "");
            }

            if (game.user.isGM) {
                removeFlaggedEffect(tokenID, effectNameVal, originId, extraFlags);
            } else {
                game.socket.emit('module.lancer-automations', {
                    action: "removeFlaggedEffect",
                    payload: { targetID: tokenID, effect: effectNameVal, originID: originId, extraFlags }
                });
            }

            if (options.notify) {
                queueEffectNotification(token, effectNameVal, options.notify, 'Loss', icon);
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
        const identifierLower = identifier.toLowerCase();
        const identifierPathTail = identifierLower.split('.').pop();

        return actor.effects.find(e => {
            const flags = e.flags;
            const laFlags = flags?.['lancer-automations'];
            const tcsFlags = flags?.['temporary-custom-statuses'];
            const qolFlags = flags?.['csm-lancer-qol'];

            return (
                tcsFlags?.originalName === identifier ||
                e.name === identifier ||
                laFlags?.effect === identifier ||
                qolFlags?.effect === identifier ||
                (e.name && e.name.toLowerCase().includes(identifierPathTail)) ||
                (e.statuses && e.statuses.has(identifierPathTail))
            );
        });
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
/**
 * Check if the token has any of the specified effects, remove them,
 * and trigger a chat message mentioning the token's immunity.
 * @param {Token|TokenDocument} token - The token to check
 * @param {Array<string>|string} effectNames - List of effects to check for
 * @param {Item|string} source - The item or text describing the source of immunity
 * @param {boolean} [notify=true] - Whether to show a chat notification
 */
export async function triggerFlaggedEffectImmunity(token, effectNames, source = "", notify = true) {
    const actor = token?.actor;
    if (!actor)
        return;
    const targets = Array.isArray(effectNames) ? effectNames : [effectNames];
    if (targets.length === 0)
        return;

    const foundEffects = actor.effects.filter(e => {
        const flagName = e.getFlag('lancer-automations', 'effect');
        const legacyFlagName = e.getFlag('csm-lancer-qol', 'effect');

        return targets.some(name => {
            const lowerName = name.toLowerCase().split('.').pop();
            return (
                e.name?.toLowerCase().includes(lowerName) ||
                e.statuses?.has(lowerName) ||
                (flagName && flagName.toLowerCase().includes(lowerName)) ||
                (legacyFlagName && legacyFlagName.toLowerCase().includes(lowerName))
            );
        });
    });

    if (foundEffects.length > 0) {
        const notifyOptions = notify ? {
            source: source,
            prefixText: 'Immunity to'
        } : false;

        await removeFlaggedEffectToTokens({
            tokens: [token],
            effectNames: targets,
            notify: notifyOptions
        });
    }
}

/**
 * Delete flagged (or all) active effects from a list of tokens.
 * @param {Array<Token|TokenDocument>} tokens - List of tokens to process
 * @param {boolean} [allEffects=false] - If true, removes ALL effects instead of just flagged ones.
 */
export async function executeDeleteAllFlaggedEffect(tokens, allEffects = false) {
    if (!tokens || tokens.length === 0) {
        return ui.notifications.error('No tokens provided for effect removal!');
    }

    ui.notifications.info(`Removing ${allEffects ? 'ALL' : 'flagged'} effects from ${tokens.length} tokens...`);

    for (const token of tokens) {
        if (!token.actor)
            continue;

        let effectsToDelete;
        if (allEffects) {
            effectsToDelete = token.actor.effects;
        } else {
            effectsToDelete = token.actor.effects.filter(e =>
                e.getFlag('lancer-automations', 'effect') ||
                e.getFlag('temporary-custom-statuses', 'originalName') ||
                e.getFlag('csm-lancer-qol', 'effect')
            );
        }

        const ids = effectsToDelete.map(e => e.id.toString());
        if (ids.length > 0) {
            await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
            log(`Removed ${ids.length} ${allEffects ? '' : 'flagged '}effects from ${token.name}`);
        }
    }
}

// --- Multi-source effect display collapsing ---

/**
 * Register a libWrapper on Token._refreshEffects to collapse duplicate same-name
 * lancer-automations effects into a single visible icon with an aggregate counter badge.
 * Must be called in a 'ready' hook so it runs after statuscounter's wrapper (outermost).
 */
export function initCollapseHook() {
    if (typeof libWrapper === 'undefined')
        return;
    libWrapper.register('lancer-automations', 'Token.prototype._refreshEffects',
        function (wrapped, ...args) {
            // PRE: destroy duplicate sprites before _refreshEffects positions them.
            // This prevents layout gaps and removes bg boxes for duplicates automatically,
            // since FoundryVTT only draws bg boxes for sprites it actually sees.
            _collapseRemoveDuplicates(this);
            // FoundryVTT lays out the remaining sprites compactly; statuscounter adds its badges.
            wrapped(...args);
            // POST: add count badges for each collapsed group.
            _collapseAddBadges(this);
        }, 'WRAPPER');
}

/**
 * PRE-phase: remove duplicate sprites for same-name lancer-automations effects from
 * token.effects.children before _refreshEffects positions them.
 * Sprites are matched to effects via sprite.zIndex (set by _drawEffects = effect index).
 * @param {Token} token
 */
function _collapseRemoveDuplicates(token) {
    if (!token.actor || !token.effects?.children)
        return;
    const temporaryEffects = token.actor.temporaryEffects;
    if (!temporaryEffects?.length)
        return;

    // Build a map from effect id to its current sprite using zIndex as the key.
    const bg = token.effects.bg;
    const spriteMap = new Map();
    for (const child of token.effects.children) {
        if (child === bg)
            continue;
        const zIdx = child.zIndex;
        if (zIdx >= 0 && zIdx < temporaryEffects.length)
            spriteMap.set(temporaryEffects[zIdx].id, child);
    }

    // Walk effects in order; keep the first sprite for each name, destroy the rest.
    const seenPrimary = new Set();
    for (const e of temporaryEffects) {
        if (!e.flags?.['lancer-automations'] || !spriteMap.has(e.id))
            continue;
        const name = e.name;
        if (!name)
            continue;
        if (seenPrimary.has(name)) {
            const sprite = spriteMap.get(e.id);
            if (sprite.parent === token.effects) {
                token.effects.removeChild(sprite);
                sprite.destroy();
            }
        } else {
            seenPrimary.add(name);
        }
    }
}

/**
 * POST-phase: after _refreshEffects and statuscounter have run with the compacted sprite list,
 * add numeric count badges on primary sprites for each collapsed group.
 * Counts ALL effects by name from actor data, so the badge shows the true total even when
 * duplicate sprites have already been removed.
 * @param {Token} token
 */
function _collapseAddBadges(token) {
    if (!token.actor || !token.effects?.children)
        return;
    const temporaryEffects = token.actor.temporaryEffects;
    if (!temporaryEffects?.length)
        return;

    // Rebuild spriteMap with post-layout positions (sprites were repositioned by _refreshEffects).
    const bg = token.effects.bg;
    const spriteMap = new Map();
    for (const child of token.effects.children) {
        if (child === bg)
            continue;
        const zIdx = child.zIndex;
        if (zIdx >= 0 && zIdx < temporaryEffects.length)
            spriteMap.set(temporaryEffects[zIdx].id, child);
    }

    // Count ALL lancer-automations effects by name (including those whose sprites were removed).
    const effectCountByName = new Map();
    for (const e of temporaryEffects) {
        if (!e.flags?.['lancer-automations'])
            continue;
        const name = e.name;
        if (!name)
            continue;
        effectCountByName.set(name, (effectCountByName.get(name) ?? 0) + 1);
    }

    const effectsOffsetX = token.effects?.x ?? 0;
    const effectsOffsetY = token.effects?.y ?? 0;

    for (const [name, count] of effectCountByName) {
        if (count <= 1)
            continue;
        // Find the first effect with this name that still has a sprite (the primary).
        const primaryEffect = temporaryEffects.find(e =>
            e.flags?.['lancer-automations'] && e.name === name && spriteMap.has(e.id));
        if (!primaryEffect)
            continue;
        const sprite = spriteMap.get(primaryEffect.id);
        const entry = { posX: sprite.x, posY: sprite.y, width: sprite.width, height: sprite.height };
        _addCounterBadge(token, entry, effectsOffsetX, effectsOffsetY, count);
    }
}

function _addCounterBadge(token, entry, offsetX, offsetY, count) {
    if (!token.effectCounters) {
        const container = new PIXI.Container();
        container.name = "effectCounters";
        token.effectCounters = token.addChild(container);
    }

    // statuscounter always clears effectCounters before our POST runs, so we always create fresh.
    // (No need to search for existing badges — there won't be any for our effects.)
    const sizeRatio = entry.height / 20;
    const badgeX = entry.posX + offsetX + entry.width + 1 * sizeRatio;
    const badgeY = entry.posY + offsetY + entry.height + 4 * sizeRatio;
    const style = new PIXI.TextStyle({
        fontFamily: 'Signika, sans-serif',
        fontSize: Math.max(9, Math.round(12 * sizeRatio)),
        fill: '#00aaff',
        stroke: '#000000',
        strokeThickness: Math.max(1, Math.round(2 * sizeRatio)),
        fontWeight: 'bold'
    });
    const text = new PIXI.Text(String(count), style);
    text.anchor.set(1, 1);
    text.x = badgeX;
    text.y = badgeY;
    text.resolution = Math.max(1, 1 / sizeRatio * 1.5);
    token.effectCounters.addChild(text);
}
