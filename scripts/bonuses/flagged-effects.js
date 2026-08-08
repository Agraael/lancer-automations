/* global CONFIG, canvas, game, ChatMessage, ui */

import { socketRequestWithAck } from '../socket.js';
import { linkTierGate } from '../interactive/deployables.js';
import { isAdditionalStatusUnavailable } from '../setup/status-effects.js';

function log(...args)
{
    console.log("lancer-automations |", ...args);
}

let notificationQueue = [];
let notificationTimer = null;

// Notifications queued while >0 get whispered to the token's owners + GMs instead of broadcast.
let _onInitDepth = 0;

export function isInOnInitTriggerContext()
{
    return _onInitDepth > 0;
}

export async function runInOnInitTriggerContext(fn)
{
    _onInitDepth++;
    try
    {
        return await fn();
    }
    finally
    {
        _onInitDepth--;
    }
}

function _isStatBarActive()
{
    try
    {
        return game.settings.get('lancer-automations', 'tokenStatBar') === true;
    }
    catch
    {
        return false;
    }
}

// Settings cache for external module lookups
const _statusCache = {
    data: null,
    timestamp: 0,
    ttl: 500 // 500ms TTL is safe for user-driven changes
};

/**
 * Helper to get saved statuses with a short-lived cache to avoid redundant settings lookups in loops.
 */
function _getSavedStatuses()
{
    const now = Date.now();
    if (!_statusCache.data || (now - _statusCache.timestamp > _statusCache.ttl))
    {
        _statusCache.data = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
        _statusCache.timestamp = now;
    }
    return _statusCache.data;
}

/**
 * @param {Token|TokenDocument} token
 * @param {string} effectName
 * @param {Object|boolean} notifyOptions - Notification options { source, prefixText }
 * @param {string} defaultPrefix - Default prefix if notifyOptions.text is missing
 * @param {string} icon
 */
function queueEffectNotification(token, effectName, notifyOptions, defaultPrefix, icon)
{
    if (!notifyOptions)
        return;
    const tokenObj = /** @type {any} */ (token).object || token;
    notificationQueue.push({
        token: tokenObj,
        effectName,
        prefix: notifyOptions.prefixText || defaultPrefix,
        source: notifyOptions.source,
        icon,
        whisper: notifyOptions.whisper === true || isInOnInitTriggerContext()
    });

    if (notificationTimer)
        clearTimeout(notificationTimer);
    notificationTimer = setTimeout(dispatchNotifications, 100);
}

// Users who should see whispered notifications for a token: GMs + token owners.
function _whisperTargetsForToken(token)
{
    const actor = token?.actor;
    const ids = new Set();
    for (const user of game.users)
    {
        if (!user.active)
            continue;
        if (user.isGM)
        {
            ids.add(user.id);
            continue;
        }
        if (actor && actor.testUserPermission(user, 'OWNER'))
            ids.add(user.id);
    }
    return [...ids];
}

async function dispatchNotifications()
{
    if (notificationQueue.length === 0)
        return;

    const batch = [...notificationQueue];
    notificationQueue = [];
    notificationTimer = null;

    // Split by (tokenId, whisper) so each output message is fully public OR fully whispered.
    const groups = new Map();
    for (const item of batch)
    {
        const key = `${item.token.id}::${item.whisper ? 'w' : 'p'}`;
        if (!groups.has(key))
            groups.set(key, { token: item.token, whisper: item.whisper, updates: [] });
        groups.get(key).updates.push(item);
    }

    const renderLine = (update) =>
    {
        const iconHtml = update.icon ? `<img src="${update.icon}" width="20" height="20" style="border:none; vertical-align:middle; margin-right:4px;"> ` : "";
        const actionText = `${iconHtml}${update.prefix} <strong>${update.effectName}</strong>`;
        let sourceText = "";
        if (update.source)
        {
            const name = typeof update.source === 'object' ? update.source.name : update.source;
            if (name)
                sourceText = ` with ${name}`;
        }
        return `<li>${actionText}${sourceText}</li>`;
    };

    for (const { token, whisper, updates } of groups.values())
    {
        const lines = updates.map(renderLine).join("");
        const content = `<div class="lancer-automations-notification"><div><strong>${token.name}:</strong><ul>${lines}</ul></div></div>`;
        const messageData = {
            content,
            speaker: ChatMessage.getSpeaker({ token: token.document || token })
        };
        if (whisper)
        {
            const targets = _whisperTargetsForToken(token);
            if (targets.length === 0)
                continue;
            messageData.whisper = targets;
        }
        await ChatMessage.create(messageData);
    }
}

/** @returns {Promise<void>} */
export async function pushEffect(targetID, effect, duration, note, originID)
{
    const target = canvas.tokens.get(targetID);
    const canActDirectly = game.user.isGM || target?.document?.isOwner;
    if (!canActDirectly && game.users.filter(user => user.role === 4 && user.active).length < 1)
    {
        log('There is no active GM.');
        return ui.notifications.error('There must be an active GM for this to work.');
    }
    if (canActDirectly)
    {
        log(`Local setFlaggedEffect ${effect}`);
        await setEffect(targetID, effect, duration, note, originID);
    }
    else
    {
        log(`Pushing setFlaggedEffect ${effect}`);
        await socketRequestWithAck('setEffect', { targetID, effect, duration, note, originID });
    }
}

const META_KEYS = new Set(['allowStack', 'stack', 'changes', 'consumption', 'linkedBonusId', 'grouped', 'groupId', 'forceNew']);

/**
 * Returns true if the incoming extraOptions are considered the same "source" as an existing effect's stored flags.
 * Effects with different identity key values (e.g. different suppressSourceId) are treated as distinct
 * and should NOT be stacked onto each other.
 * @param {SetEffectOptions} extraOptions - The incoming extra options
 * @param {ActiveEffect} existingEffect - The existing effect on the actor
 */
function _sameIdentity(extraOptions, existingEffect)
{
    const identityKeys = Object.keys(extraOptions || {}).filter(key => !META_KEYS.has(key));
    if (identityKeys.length === 0)
        return true;
    const storedFlags = existingEffect?.flags?.['lancer-automations'] || {};
    return identityKeys.every(key => storedFlags[key] === extraOptions[key]);
}

/** @returns {Promise<void>} */
export async function setEffect(targetID, effectOrData, duration, note, originID, extraOptions = {})
{
    log('**setEffect**');
    const target = canvas.tokens.placeables.find(token => token.id === targetID);
    if (!target)
        return;

    let effectNameForLog = typeof effectOrData === 'string' ? effectOrData : effectOrData.name;
    const isCustomRequest = (typeof effectOrData === 'object' && effectOrData.isCustom);// Auto-detect if "string" effect is actually an existing custom effect
    let resolvedEffectData = effectOrData;
    if (typeof effectOrData === 'string')
    {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi)
        {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effectOrData);
            if (hasCustom)
                resolvedEffectData = { name: effectOrData, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
        }
    }
    else if (typeof effectOrData === 'object' && effectOrData.name && !effectOrData.isCustom)
    {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi)
        {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effectOrData.name);
            if (hasCustom)
                resolvedEffectData = { ...effectOrData, isCustom: true, icon: effectOrData.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
        }
    }

    if (resolvedEffectData?.isCustom && !resolvedEffectData.icon)
        resolvedEffectData.icon = "icons/svg/mystery-man.svg";

    if (typeof resolvedEffectData === 'object' && resolvedEffectData.isCustom)
    {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;

        if (customStatusApi)
        {
            const existingEffect = target.actor.effects.find(effect =>
                (game.modules.get("temporary-custom-statuses")?.active && effect.getFlag("temporary-custom-statuses", "originalName") === resolvedEffectData.name)
            );

            if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId && _sameIdentity(extraOptions, existingEffect))
            {
                const addStack = extraOptions.stack || resolvedEffectData.stack || 1;
                await customStatusApi.modifyStack(target.actor, existingEffect.id, addStack);

                // Build duration entries for stack-aware expiration
                const entries = [...(existingEffect.getFlag('lancer-automations', 'durationEntries') || [])];
                if (entries.length === 0)
                {
                    const existingDur = existingEffect.getFlag('lancer-automations', 'duration');
                    const existingOrigin = existingEffect.getFlag('lancer-automations', 'originID');
                    const existingApplied = (game.modules.get("lancer-automations")?.active && existingEffect.getFlag('lancer-automations', 'appliedStack'));
                    const existingStack = (game.modules.get("statuscounter")?.active && existingEffect.getFlag("statuscounter", "value")) || 1;
                    if (existingDur && existingDur.label !== 'indefinite' && existingDur.turns !== null)
                        entries.push({ label: existingDur.label, turns: existingDur.turns, originID: existingOrigin, stack: existingApplied || existingStack });
                }
                if (duration && duration.label !== 'indefinite' && duration.turns !== null)
                    entries.push({ label: duration.label, turns: duration.turns, originID: originID, stack: addStack });

                /** @type {LancerEffectFlags} */
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
                await existingEffect.update(/** @type {any} */ ({
                    "flags.lancer-automations": flagsData,
                    "flags.statuscounter.visible": totalStack > 1
                }));
                return;
            }

            /** @type {LancerEffectFlags} */
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

            if (activeEffects && !Array.isArray(activeEffects))
            {
                // modifyStack was called; update our flags on the existing effect
                const existingEffect = target.actor.effects.find(effect =>
                    (game.modules.get("temporary-custom-statuses")?.active && effect.getFlag("temporary-custom-statuses", "originalName") === resolvedEffectData.name)
                );
                if (existingEffect)
                {
                    const updateData = { "flags.lancer-automations": lancerFlags };
                    if (extraOptions?.changes?.length)
                        updateData.changes = extraOptions.changes;
                    await existingEffect.update(/** @type {any} */ (updateData));
                }
            }
            else if (Array.isArray(activeEffects) && activeEffects[0])
            {
                // New effect created; statuscounter module may overwrite, re-set
                const updateData = {
                    "flags.statuscounter.value": counterValue,
                    "flags.statuscounter.visible": counterValue > 1
                };
                if (extraOptions?.changes?.length)
                    updateData.changes = extraOptions.changes;
                await activeEffects[0].update(/** @type {any} */ (updateData));
            }
            return;
        }

        // Fallback if module not active
        const effectData = {
            name: resolvedEffectData.name,
            img: resolvedEffectData.icon,
            statuses: [],
            changes: extraOptions.changes || resolvedEffectData.changes || [],
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
        const fallbackCreated = await target.actor.createEmbeddedDocuments("ActiveEffect", [/** @type {any} */ (effectData)]);
        if (fallbackCreated?.[0])
        {
            await fallbackCreated[0].update(/** @type {any} */ ({
                "flags.statuscounter.value": fallbackStackVal,
                "flags.statuscounter.visible": fallbackStackVal > 1
            }));
        }

    }
    else
    {
        const effectName = typeof resolvedEffectData === 'string' ? resolvedEffectData : resolvedEffectData.name;
        const statusEffect = CONFIG.statusEffects.find(candidate => candidate.name === effectName || candidate.id === effectName);

        if (!statusEffect)
        {
            if (!isAdditionalStatusUnavailable(effectName))
                ui.notifications.error(`Effect ${effectName} not found`);
            return;
        }

        const existingEffect = target.actor.effects.find(/** @param {any} effect */ effect =>
            effect.name === game.i18n.localize(statusEffect.name) ||
            effect.statuses?.has(statusEffect.id) ||
            effect.getFlag('lancer-automations', 'effect') === statusEffect.name
        );

        if (existingEffect && !extraOptions.consumption && !extraOptions.linkedBonusId && _sameIdentity(extraOptions, existingEffect))
        {
            const currentStack = (game.modules.get('statuscounter')?.active ? existingEffect.getFlag('statuscounter', 'value') : (existingEffect.flags?.statuscounter?.value)) || 1;
            const addStack = extraOptions.stack || 1;
            const newStack = currentStack + addStack;

            // Build duration entries for stack-aware expiration
            const updateData = {
                "flags.statuscounter.value": newStack,
                "flags.statuscounter.visible": newStack > 1
            };

            if (duration && duration.label !== 'indefinite' && duration.turns !== null)
            {
                const entries = [...(existingEffect.getFlag('lancer-automations', 'durationEntries') || [])];
                if (entries.length === 0)
                {
                    const existingDur = existingEffect.getFlag('lancer-automations', 'duration');
                    const existingOrigin = existingEffect.getFlag('lancer-automations', 'originID');
                    const existingApplied = existingEffect.getFlag('lancer-automations', 'appliedStack') || currentStack;
                    if (existingDur && existingDur.label !== 'indefinite' && existingDur.turns !== null)
                        entries.push({ label: existingDur.label, turns: existingDur.turns, originID: existingOrigin, stack: existingApplied });
                }
                entries.push({ label: duration.label, turns: duration.turns, originID: originID, stack: addStack });
                updateData["flags.lancer-automations.durationEntries"] = entries;
                updateData["flags.lancer-automations.duration"] = duration;
                updateData["flags.lancer-automations.originID"] = originID;
                updateData["flags.lancer-automations.appliedStack"] = addStack;
            }

            await existingEffect.update(/** @type {any} */ (updateData));
            ui.notifications.info(`Increased stack of ${statusEffect.name} on ${target.name} to ${newStack}.`);
            return;
        }

        const flags = {
            /** @type {LancerEffectFlags} */
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
        if (stackVal > 0)
        {
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
        const created = await target.actor.createEmbeddedDocuments("ActiveEffect", [/** @type {any} */ (effectData)]);

        // Post-creation update: statuscounter module may overwrite our flags, so re-set them
        if (stackVal > 0 && created?.[0])
        {
            await created[0].update(/** @type {any} */ ({
                "flags.statuscounter.value": stackVal,
                "flags.statuscounter.visible": stackVal > 1
            }));
        }
    }
}

export async function removeEffectsByName(targetID, effectName, originID = null, extraFlags = null)
{
    log('**removeEffectsByName**');
    const target = canvas.tokens.placeables.find(token => token.id === targetID);
    if (!target)
        return;

    let effectsStr = typeof effectName === 'object' ? effectName.name : effectName;
    const effectNameTail = effectsStr.split('.').pop();
    const effectNameLower = effectNameTail.toLowerCase();

    const effectsToDelete = target.actor.effects.filter(/** @param {any} effect */ effect =>
    {
        // When a source is specified, skip effects from any other source.
        if (originID)
        {
            const flagOrigin = effect.getFlag('lancer-automations', 'originID') || (game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'originID') : null);
            if (flagOrigin !== originID)
                return false;
        }

        // When extra flag constraints are specified, all must match.
        if (extraFlags)
        {
            const storedFlags = effect.flags?.['lancer-automations'] ?? {};
            for (const [key, value] of Object.entries(extraFlags))
            {
                if (storedFlags[key] !== value)
                    return false;
            }
        }

        if (effect.getFlag('lancer-automations', 'effect') === effectsStr)
            return true;
        if (effect.getFlag('temporary-custom-statuses', 'originalName') === effectsStr)
            return true;
        if (game.modules.get('csm-lancer-qol')?.active && effect.getFlag('csm-lancer-qol', 'effect') === effectsStr)
            return true;
        if (effect.name?.toLowerCase().includes(effectNameLower) ||
            effect.statuses?.has(effectNameTail))
            return true;

        return false;
    });

    if (effectsToDelete.length > 0)
    {
        log(`Removing ${effectsToDelete.length} effects matching ${effectsStr} from ${target.name}`);
        await target.actor.deleteEmbeddedDocuments("ActiveEffect", effectsToDelete.map(effect => effect.id));
    }
}
/**
 * Apply flagged effect(s) to a list of tokens with combat tracking
 * @param {Object} [options={}] - Configuration options
 * @param {Array<Token>} [options.tokens=[]] - Array of tokens to apply effect to
 * @param {any} [options.effectNames=[]] - Effect name(s) to apply (string, object, or array)
 * @param {string} [options.note=""] - Note/description for the effect
 * @param {Object} [options.duration={}] - Duration object
 * @param {string} [options.duration.overrideTurnOriginId] - When set, ties duration tracking to this token ID instead of the target's turn
 * @param {string} [options.duration.label] - Display label for the duration (e.g. 'start', 'end', 'unlimited')
 * @param {number} [options.duration.turns] - Number of turns before expiration
 * @param {number} [options.duration.rounds] - Number of rounds before expiration
 * @param {Function} [options.checkEffectCallback=null] - Optional custom function to check if effect already exists
 * @param {Object|boolean} [options.notify=true] - Optional notification options
 * @param {SetEffectOptions} [extraOptions={}] - Extra options forwarded to setEffect
 * @returns {Promise<Array<Token>>} Array of valid tokens that received the effect(s)
 */
export async function applyEffectsToTokens(options = {}, extraOptions = {})
{
    const {
        tokens = [],
        effectNames = [],
        note = "",
        duration = {},
        checkEffectCallback = null,
        notify = true
    } = /** @type {any} */ (options);

    if (extraOptions?.consumption?.grouped && !extraOptions.consumption.groupId)
        extraOptions.consumption.groupId = foundry.utils.randomID();

    const effectsToApply = Array.isArray(effectNames) ? effectNames : [effectNames];

    if (!effectNames || effectsToApply.length === 0)
    {
        ui.notifications.error('No effect name(s) specified!');
        return [];
    }

    const hasLimitedDuration = duration && (
        ['start', 'end', 'round'].includes(duration.label) ||
        (duration.turns != null && duration.turns !== 0) ||
        (duration.rounds != null && duration.rounds !== 0)
    );
    if (hasLimitedDuration && !game.combat?.started)
    {
        const names = effectsToApply.map(effect => typeof effect === 'string' ? effect : effect?.name).filter(Boolean).join(', ');
        ui.notifications.warn(`Out of combat: ${names} duration will not tick.`);
    }

    const validTokens = [];

    for (const token of tokens)
    {
        const effectsToApplyToToken = [];

        for (const effect of effectsToApply)
        {
            let hasEffect = false;
            let existingEffect = null;
            let effectNameForLog = typeof effect === 'string' ? effect : effect.name;

            // Auto-detect if "string" effect is an existing custom effect
            let resolvedEffectData = effect;
            if (typeof effect === 'string')
            {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi)
                {
                    const savedStatuses = _getSavedStatuses();
                    const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effect);
                    if (hasCustom)
                        resolvedEffectData = { name: effect, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
                }
            }
            else if (typeof effect === 'object' && effect.name && !effect.isCustom)
            {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi)
                {
                    const savedStatuses = _getSavedStatuses();
                    const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effect.name);
                    if (hasCustom)
                        resolvedEffectData = { ...effect, isCustom: true, icon: effect.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
                }
            }

            if (checkEffectCallback)
                hasEffect = checkEffectCallback(token, resolvedEffectData);
            else if (extraOptions?.consumption?.groupId || extraOptions?.linkedBonusId)
            {
                // only flag duplicate when groupId or linkedBonusId matches; different sources coexist
                const groupId = extraOptions.consumption?.groupId;
                const bonusId = extraOptions.linkedBonusId;
                hasEffect = token.actor?.effects.some(actorEffect =>
                {
                    const flags = /** @type {SetEffectOptions} */ (actorEffect.flags?.['lancer-automations'] || {});
                    if (groupId && flags.consumption?.groupId === groupId)
                        return true;
                    if (bonusId && flags.linkedBonusId === bonusId)
                        return true;
                    return false;
                });
            }
            else
            {
                const effectNameToCheck = typeof resolvedEffectData === 'string' ? resolvedEffectData : resolvedEffectData.name;
                const effectNameTail = /** @type {string} */ (effectNameToCheck.split('.').pop());
                const effectNameLower = effectNameTail.toLowerCase();

                // Find a matching effect: same name AND same identity flags (different source = different effect).
                existingEffect = token.actor?.effects.find(effect =>
                {
                    const nameMatch = (effect.name)?.toLowerCase().includes(effectNameLower) ||
                        effect.statuses?.has(effectNameTail) ||
                        effect.flags?.['lancer-automations']?.effect === effectNameToCheck ||
                        effect.flags?.['csm-lancer-qol']?.effect === effectNameToCheck;
                    if (!nameMatch)
                        return false;
                    return _sameIdentity(extraOptions, effect);
                });

                // Unflagged (player-added) effect is distinct when the new application carries managed settings (duration/origin); allow it.
                if (existingEffect &&
                    !existingEffect.flags?.['lancer-automations']?.effect &&
                    !existingEffect.flags?.['temporary-custom-statuses']?.originalName &&
                    !existingEffect.flags?.['csm-lancer-qol']?.effect &&
                    (duration?.label || duration?.overrideTurnOriginId))

                    existingEffect = null;


                if (existingEffect)
                {
                    const allowStack = extraOptions?.allowStack;
                    const hasConsumption = extraOptions?.consumption;

                    if (!allowStack && !hasConsumption)
                        hasEffect = true; // Block stacking
                }
            }

            if (checkEffectCallback && hasEffect)
            {
                // Custom callback blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()}!`);
            }
            else if ((extraOptions?.consumption?.groupId || extraOptions?.linkedBonusId) && hasEffect)
            {
                // Groups/Bonuses check blocking
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()} (Group/Bonus conflict)!`);
            }
            else if (hasEffect)
            {
                // Standard blocking (no stack allowed)
                ui.notifications.warn(`${token.name} already has ${effectNameForLog.split('.').pop()}!`);
            }
            else
                effectsToApplyToToken.push(resolvedEffectData);
        }

        if (effectsToApplyToToken.length === 0)
            continue;
        validTokens.push(token);

        const tokenID = token.id;
        const originID = duration?.overrideTurnOriginId ?? token.id;

        // External callers passing raw turns=1 on the origin's turn need +1; _preAdjusted (effect manager submit paths) skips this.
        let adjustedDuration = { ...duration };
        if (!duration._preAdjusted && game.combat?.current?.tokenId === originID && duration.turns === 1)
            adjustedDuration.turns = 2;
        delete adjustedDuration._preAdjusted;

        // Apply
        const canApplyDirectly = game.user.isGM || token.document?.isOwner;
        for (const effect of effectsToApplyToToken)
        {
            if (canApplyDirectly)
                await setEffect(tokenID, effect, adjustedDuration, note, originID, extraOptions);
            else
                await socketRequestWithAck('setEffect', { targetID: tokenID, effect, duration: adjustedDuration, note, originID, extraOptions });

            if (notify)
            {
                const effectName = typeof effect === 'string' ? effect : effect.name;
                const icon = typeof effect === 'object' ? (effect.icon || "icons/svg/mystery-man.svg") : CONFIG.statusEffects.find(statusEffect => statusEffect.id === effect)?.icon;
                queueEffectNotification(token, effectName, notify, 'Gained', icon);
            }
        }
    }

    return validTokens;
}

// Doc-aware setEffect. Sets transfer=false and disabled=true.
/**
 * @param {Actor|Item} doc
 * @param {string|Object} effectOrData
 * @param {Object} [duration]
 * @param {string} [note]
 * @param {string|null} [originID]
 * @param {Object} [extraOptions]
 * @returns {Promise<ActiveEffect|null>}
 */
export async function setEffectOnDoc(doc, effectOrData, duration = {}, note = "", originID = null, extraOptions = {})
{
    if (!doc)
        return null;
    const isItem = doc.documentName === 'Item';

    let resolvedEffectData = effectOrData;
    if (typeof effectOrData === 'string')
    {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi)
        {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effectOrData);
            if (hasCustom)
                resolvedEffectData = { name: effectOrData, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
        }
    }
    else if (typeof effectOrData === 'object' && effectOrData.name && !effectOrData.isCustom)
    {
        const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
        if (customStatusApi)
        {
            const savedStatuses = _getSavedStatuses();
            const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effectOrData.name);
            if (hasCustom)
                resolvedEffectData = { ...effectOrData, isCustom: true, icon: effectOrData.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
        }
    }
    if (resolvedEffectData?.isCustom && !resolvedEffectData.icon)
        resolvedEffectData.icon = "icons/svg/mystery-man.svg";

    const stackVal = extraOptions.stack || (typeof resolvedEffectData === 'object' && resolvedEffectData.stack) || 0;

    let effectData;
    if (typeof resolvedEffectData === 'object' && resolvedEffectData.isCustom)
    {
        effectData = {
            name: resolvedEffectData.name,
            img: resolvedEffectData.icon,
            statuses: [],
            changes: extraOptions.changes || resolvedEffectData.changes || [],
            flags: {
                'lancer-automations': {
                    effect: resolvedEffectData.name,
                    duration,
                    note,
                    originID,
                    appliedRound: game.combat?.round || 0,
                    appliedStack: stackVal || 1,
                    ...extraOptions
                },
                'temporary-custom-statuses': {
                    isCustom: true,
                    originalName: resolvedEffectData.name
                }
            }
        };
    }
    else
    {
        const effectName = typeof resolvedEffectData === 'string' ? resolvedEffectData : resolvedEffectData.name;
        const statusEffect = CONFIG.statusEffects.find(candidate => candidate.name === effectName || candidate.id === effectName);
        if (!statusEffect)
        {
            if (!isAdditionalStatusUnavailable(effectName))
                ui.notifications.error(`Effect ${effectName} not found`);
            return null;
        }
        effectData = {
            name: game.i18n.localize(statusEffect.name),
            img: statusEffect.img,
            description: statusEffect.description,
            id: statusEffect.id,
            statuses: [statusEffect.id],
            changes: extraOptions.changes || statusEffect.changes || [],
            flags: {
                'lancer-automations': {
                    effect: statusEffect.name,
                    duration,
                    note,
                    originID,
                    appliedRound: game.combat?.round || 0,
                    appliedStack: stackVal || 0,
                    ...extraOptions
                }
            }
        };
    }

    if (stackVal > 0)
        effectData.flags.statuscounter = { value: stackVal, visible: stackVal > 1 };
    /** @type {any} */ (effectData).transfer = false;
    /** @type {any} */ (effectData).disabled = true;
    if (isItem)
        effectData.flags['lancer-automations'].isItemTemplate = true;
    else
        effectData.flags['lancer-automations'].isActorTemplate = true;

    const created = await /** @type {any} */ (doc).createEmbeddedDocuments("ActiveEffect", [/** @type {any} */ (effectData)]);

    if (stackVal > 0 && created?.[0])
    {
        await created[0].update(/** @type {any} */ ({
            "flags.statuscounter.value": stackVal,
            "flags.statuscounter.visible": stackVal > 1
        }));
    }
    return created?.[0] ?? null;
}

/**
 * Convert a template AE into the descriptor shape `applyEffectsToTokens` expects
 * (a string status id, an `{isCustom, ...}` custom-status object, or a raw AE-like descriptor).
 * @param {any} template
 */
export function templateToEffectDescriptor(template)
{
    const isCustom = template?.flags?.['temporary-custom-statuses']?.isCustom === true;
    if (isCustom)
        return { name: template.name, icon: template.img, isCustom: true, changes: template.changes ?? [] };
    const statuses = template?.statuses ? Array.from(template.statuses) : [];
    if (statuses.length > 0)
        return String(statuses[0]);
    return { name: template.name, icon: template.img, changes: template.changes ?? [] };
}

async function _applyTemplatesToTokens(sourceDoc, templates, sourceKey, tokens)
{
    if (!templates?.length || !tokens?.length)
        return;
    for (const template of templates)
    {
        const descriptor = templateToEffectDescriptor(template);
        const laFlags = template.flags?.['lancer-automations'] ?? {};
        const persistedStack = laFlags.lastRuntimeStack;
        const stack = Number.isFinite(persistedStack)
            ? persistedStack
            : (template.flags?.statuscounter?.value || 0);
        const duration = laFlags.duration ?? { label: 'permanent' };
        for (const token of tokens)
        {
            if (!token?.actor)
                continue;
            if (!linkTierGate(laFlags, token.actor, sourceKey === 'sourceItemUuid' ? sourceDoc : null))
                continue;
            const already = /** @type {any[]} */ (Array.from(token.actor.effects ?? [])).some(effect =>
            {
                const flags = effect.flags?.['lancer-automations'];
                return flags?.[sourceKey] === sourceDoc.uuid && flags?.sourceTemplateId === template.id;
            });
            if (already)
                continue;
            const extraOptions = /** @type {any} */ ({
                [sourceKey]: sourceDoc.uuid,
                sourceTemplateId: template.id,
                stack
            });
            try
            {
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: [descriptor],
                    note: `From ${sourceDoc.name}`,
                    duration
                }, extraOptions);
            }
            catch (err)
            {
                console.warn('lancer-automations | template materialize failed:', err);
            }
        }
    }
}

/**
 * Materialize all `isItemTemplate` templates on an item to the given tokens via the standard applier.
 * Idempotent - skips tokens that already carry the runtime for that template.
 * @param {any} item
 * @param {any[]} tokens
 */
export async function applyItemTemplatesToTokens(item, tokens)
{
    if (!item || !tokens?.length)
        return;
    if (item.system?.destroyed || item.system?.disabled)
        return;
    const templates = /** @type {any[]} */ (Array.from(item.effects ?? []))
        .filter(effect => effect.flags?.['lancer-automations']?.isItemTemplate === true);
    await _applyTemplatesToTokens(item, templates, 'sourceItemUuid', tokens);
}

/**
 * Materialize all `isActorTemplate` templates on an actor to the given tokens via the standard applier.
 * @param {any} actor
 * @param {any[]} tokens
 */
export async function applyActorTemplatesToTokens(actor, tokens)
{
    if (!actor || !tokens?.length)
        return;
    const templates = /** @type {any[]} */ (Array.from(actor.effects ?? []))
        .filter(effect => effect.flags?.['lancer-automations']?.isActorTemplate === true);
    await _applyTemplatesToTokens(actor, templates, 'sourceActorUuid', tokens);
}

/**
 * Stamp effect template(s) on the given item(s) and immediately materialize on any active tokens
 * carrying them. Templates persist across item remove/re-add and destroy/restore; runtime AEs
 * on tokens are managed by the lifecycle hooks (createItem / createToken / deleteItem / etc).
 * @param {Object} options
 * @param {any[]} options.items
 * @param {Array<string|Object>|string|Object} options.effectNames
 * @param {string} [options.note]
 * @param {Object} [options.duration]
 * @param {Object} [extraOptions]
 */
export async function linkEffectToItem(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { items = [], effectNames = [], note = "", duration = {} } = /** @type {any} */ (options);
    const effectsToStamp = Array.isArray(effectNames) ? effectNames : [effectNames];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        for (const effect of effectsToStamp)
        {
            const canApplyDirectly = game.user.isGM || item.isOwner;
            if (canApplyDirectly)
                await setEffectOnDoc(item, effect, duration, note, extraOptions?.originID ?? null, extraOptions);
            else
                await socketRequestWithAck('setEffectOnDoc', { docUuid: item.uuid, effect, duration, note, originID: extraOptions?.originID ?? null, extraOptions });
        }
        const actor = item.parent;
        if (actor?.documentName === 'Actor')
            await applyItemTemplatesToTokens(item, actor.getActiveTokens?.() ?? []);
    }
    return items;
}

/**
 * Stamp effect template(s) on the given actor(s) and immediately materialize on any active tokens.
 * Templates on prototype actors also fire from `createToken` for future spawns.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {Array<string|Object>|string|Object} options.effectNames
 * @param {string} [options.note]
 * @param {Object} [options.duration]
 * @param {Object} [extraOptions]
 */
export async function linkEffectToActor(options = /** @type {any} */ ({}), extraOptions = {})
{
    const { actors = [], effectNames = [], note = "", duration = {} } = /** @type {any} */ (options);
    const effectsToStamp = Array.isArray(effectNames) ? effectNames : [effectNames];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        for (const effect of effectsToStamp)
        {
            const canApplyDirectly = game.user.isGM || actor.isOwner;
            if (canApplyDirectly)
                await setEffectOnDoc(actor, effect, duration, note, extraOptions?.originID ?? null, extraOptions);
            else
                await socketRequestWithAck('setEffectOnDoc', { docUuid: actor.uuid, effect, duration, note, originID: extraOptions?.originID ?? null, extraOptions });
        }
        await applyActorTemplatesToTokens(actor, actor.getActiveTokens?.() ?? []);
    }
    return actors;
}

/**
 * Remove template(s) matching `effectName` (and optional identity `extraFlags`) from the given items.
 * The `deleteActiveEffect` cascade hook cleans up runtime AEs on carrying tokens automatically.
 * @param {Object} options
 * @param {any[]} options.items
 * @param {string} options.effectName
 * @param {Object} [options.extraFlags]
 */
export async function unlinkEffectFromItem(options = /** @type {any} */ ({}))
{
    const { items = [], effectName = "", extraFlags = null } = /** @type {any} */ (options);
    if (!effectName)
        return [];
    const removed = [];
    for (const item of items)
    {
        if (!item || item.documentName !== 'Item')
            continue;
        const nameLower = String(effectName).toLowerCase();
        const matches = /** @type {any[]} */ (Array.from(item.effects ?? [])).filter(effect =>
        {
            if (effect.flags?.['lancer-automations']?.isItemTemplate !== true)
                return false;
            const nameMatch = effect.name?.toLowerCase() === nameLower
                || effect.statuses?.has?.(effectName)
                || effect.flags?.['lancer-automations']?.effect === effectName;
            if (!nameMatch)
                return false;
            if (!extraFlags)
                return true;
            const laFlags = effect.flags?.['lancer-automations'] ?? {};
            return Object.entries(extraFlags).every(([key, value]) => laFlags[key] === value);
        });
        if (!matches.length)
            continue;
        await item.deleteEmbeddedDocuments("ActiveEffect", matches.map(effect => effect.id));
        removed.push(...matches);
    }
    return removed;
}

/**
 * Remove template(s) matching `effectName` from the given actors. Cascade cleans token runtimes.
 * @param {Object} options
 * @param {any[]} options.actors
 * @param {string} options.effectName
 * @param {Object} [options.extraFlags]
 */
export async function unlinkEffectFromActor(options = /** @type {any} */ ({}))
{
    const { actors = [], effectName = "", extraFlags = null } = /** @type {any} */ (options);
    if (!effectName)
        return [];
    const removed = [];
    for (const actor of actors)
    {
        if (!actor || actor.documentName !== 'Actor')
            continue;
        const nameLower = String(effectName).toLowerCase();
        const matches = /** @type {any[]} */ (Array.from(actor.effects ?? [])).filter(effect =>
        {
            if (effect.flags?.['lancer-automations']?.isActorTemplate !== true)
                return false;
            const nameMatch = effect.name?.toLowerCase() === nameLower
                || effect.statuses?.has?.(effectName)
                || effect.flags?.['lancer-automations']?.effect === effectName;
            if (!nameMatch)
                return false;
            if (!extraFlags)
                return true;
            const laFlags = effect.flags?.['lancer-automations'] ?? {};
            return Object.entries(extraFlags).every(([key, value]) => laFlags[key] === value);
        });
        if (!matches.length)
            continue;
        await actor.deleteEmbeddedDocuments("ActiveEffect", matches.map(effect => effect.id));
        removed.push(...matches);
    }
    return removed;
}

/**
 * Sync a runtime AE's current statuscounter back to its source template as `lastRuntimeStack`
 * so charge state survives item remove/re-add or destroy/restore cycles. Called before deletion.
 * Handles both item-source templates (sourceItemUuid) and actor-source templates (sourceActorUuid).
 * @param {ActiveEffect} runtime
 */
export async function persistRuntimeStackToTemplate(runtime)
{
    const laFlags = runtime?.flags?.['lancer-automations'];
    const sourceUuid = laFlags?.sourceItemUuid ?? laFlags?.sourceActorUuid;
    const sourceTemplateId = laFlags?.sourceTemplateId;
    if (!sourceUuid || !sourceTemplateId)
        return;
    try
    {
        const source = /** @type {any} */ (await fromUuid(sourceUuid));
        const template = source?.effects?.get?.(sourceTemplateId);
        if (!template)
            return;
        const currentStack = runtime.flags?.statuscounter?.value;
        if (Number.isFinite(currentStack))
            await template.setFlag('lancer-automations', 'lastRuntimeStack', currentStack);
    }
    catch (e)
    {
        console.warn('lancer-automations | persistRuntimeStackToTemplate failed:', e);
    }
}

/**
 * Remove flagged effect(s) from a list of tokens
 * @param {Object} [options={}] - Configuration options
 * @param {Array<Token|TokenDocument>} [options.tokens=[]] - Array of tokens to remove effect from
 * @param {Array<string|EffectDescriptorInput>|string|EffectDescriptorInput} [options.effectNames=[]] - Effect name(s) to remove (single string, object, or array)
 * @param {string} [options.originId=null] - Optional origin ID to filter removal
 * @param {Object} [options.extraFlags=null] - Optional extra flags to filter removal
 * @param {Object|boolean} [options.notify=true] - Optional notification options
 * @returns {Promise<Array<Token|TokenDocument>>} Array of tokens processed
 */
export async function removeEffectsByNameFromTokens(options = {})
{
    const {
        tokens = [],
        effectNames = [],
        originId = null,
        extraFlags = null,
        notify = true
    } = options;

    const effectsToRemove = Array.isArray(effectNames) ? effectNames : [effectNames];

    if (!effectNames || effectsToRemove.length === 0)
    {
        ui.notifications.error('No effect name(s) specified for removal!');
        return [];
    }

    const processedTokens = [];

    for (const token of tokens)
    {
        processedTokens.push(token);
        const tokenID = token.id;

        for (const effect of effectsToRemove)
        {
            let effectNameStr = typeof effect === 'object' ? effect.name : effect;

            let icon = "";
            let resolvedEffect = effect;
            if (typeof effect === 'string')
            {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi)
                {
                    const savedStatuses = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
                    const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effect);
                    if (hasCustom)
                    {
                        resolvedEffect = { name: effect, icon: hasCustom.icon || "icons/svg/mystery-man.svg", isCustom: true };
                        effectNameStr = effect;
                    }
                }
            }
            else if (typeof effect === 'object' && effect.name && !effect.isCustom)
            {
                const customStatusApi = game.modules.get("temporary-custom-statuses")?.api;
                if (customStatusApi)
                {
                    const savedStatuses = game.settings.get("temporary-custom-statuses", "savedStatuses") || [];
                    const hasCustom = savedStatuses.find(savedStatus => savedStatus.name === effect.name);
                    if (hasCustom)
                    {
                        resolvedEffect = { ...effect, isCustom: true, icon: effect.icon || hasCustom.icon || "icons/svg/mystery-man.svg" };
                        effectNameStr = effect.name;
                    }
                }
            }

            if (notify)
            {
                const existing = findEffectOnToken(token, effectNameStr);
                icon = existing?.img || (existing && game.modules.get('temporary-custom-statuses')?.active ? existing.getFlag('temporary-custom-statuses', 'icon') : "") || (typeof resolvedEffect === 'object' ? resolvedEffect.icon : "");
            }

            if (game.user.isGM || (/** @type {Token} */ (token)).document?.isOwner)
                await removeEffectsByName(tokenID, effectNameStr, originId, extraFlags);
            else
                await socketRequestWithAck('removeEffect', { targetID: tokenID, effect: effectNameStr, originID: originId, extraFlags });

            if (notify)
                queueEffectNotification(token, effectNameStr, notify, 'Loss', icon);
        }
    }
    return processedTokens;
}

/**
 * Find a flagged effect on a token
 * @param {Token|TokenDocument} token - The token to search on
 * @param {string|((e: ActiveEffect) => boolean)} identifier - Effect name (string) or predicate function (e => boolean)
 * @returns {ActiveEffect|undefined} The found effect or undefined
 */
export function findEffectOnToken(token, identifier)
{
    const actor = /** @type {Actor} */(token?.actor);
    if (!actor)
        return undefined;

    if (typeof identifier === 'function')
        return actor.effects.find(identifier);

    if (typeof identifier === 'string')
    {
        const identifierPathTail = identifier.split('.').pop();
        const identifierPathTailLower = identifierPathTail.toLowerCase();

        return actor.effects.find(/** @param {any} e */ effect =>
        {
            const flags = effect.flags;
            const laFlags = flags?.['lancer-automations'];
            const tcsFlags = flags?.['temporary-custom-statuses'];
            const qolFlags = flags?.['csm-lancer-qol'];

            return (
                tcsFlags?.originalName === identifier ||
                effect.name === identifier ||
                laFlags?.effect === identifier ||
                qolFlags?.effect === identifier ||
                (effect.name?.toLowerCase().includes(identifierPathTailLower)) ||
                (effect.statuses?.has(identifierPathTail))
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
export async function consumeEffectCharge(effect)
{
    if (!effect)
        return false;

    const actor = /** @type {Actor} */ (effect.parent);
    if (!actor)
        return false;

    if (!game.user.isGM && !actor.isOwner)
    {
        await socketRequestWithAck('consumeEffectCharge', { effectUuid: effect.uuid });
        return true;
    }

    const consumption = effect.getFlag('lancer-automations', 'consumption');
    if (!consumption?.trigger)
        return false;

    const currentStack = effect.flags?.statuscounter?.value ?? 1;
    const newStack = currentStack - 1;
    const groupId = consumption.groupId;

    if (groupId)
    {
        const groupEffects = actor.effects.filter(groupMember =>
        {
            const innerConsumption = groupMember.flags?.['lancer-automations']?.consumption;
            return innerConsumption?.groupId === groupId;
        });

        if (newStack <= 0)
        {
            const idsToDelete = groupEffects.map(effect => effect.id);
            log(`Consumption depleted for group ${groupId}, removing ${idsToDelete.length} effects`);
            await actor.deleteEmbeddedDocuments("ActiveEffect", idsToDelete);
        }
        else
        {
            const updates = groupEffects.map(effect => ({
                _id: effect.id,
                "flags.statuscounter.value": newStack,
                "flags.statuscounter.visible": newStack > 1
            }));
            log(`Consuming charge for group ${groupId}: ${newStack} remaining`);
            await actor.updateEmbeddedDocuments("ActiveEffect", updates);
        }
    }
    else if (newStack <= 0)
    {
        log(`Consumption depleted for ${effect.name}, removing effect`);
        await effect.delete();
    }
    else
    {
        log(`Consuming charge for ${effect.name}: ${newStack} remaining`);
        await effect.update(/** @type {any} */({ "flags.statuscounter.value": newStack, "flags.statuscounter.visible": newStack > 1 }));
    }

    return true;
}

/**
 * Process duration-based effects on turn changes.
 * Decrements turn counters and removes effects (or stacks) when they expire.
 * Supports both single-duration effects and multi-duration stacked effects via durationEntries.
 * @param {string} triggerLabel - 'start' or 'end'
 * @param {string} triggeringTokenId - The token ID whose turn is starting/ending
 * @returns {Promise<void>}
 */
export async function processDurationEffects(triggerLabel, triggeringTokenId)
{
    // Only the active GM processes duration to avoid conflicts
    if (game.user.id !== game.users.find(user => user.active && user.isGM)?.id)
        return;

    const allTokens = canvas.tokens.placeables.filter(token => token.actor);

    for (const token of allTokens)
    {
        const actor = token.actor;
        if (!actor)
            continue;

        const effects = [...actor.effects];

        for (const effect of effects)
        {
            const flags = effect.flags?.['lancer-automations'];
            if (!flags)
            {
                const legacyFlags = effect.flags?.['csm-lancer-qol'];
                if (!legacyFlags?.duration)
                    continue;
                // QoL handles its own ticks; skip to avoid a double-delete race.
                if (game.modules.get('csm-lancer-qol')?.active)
                    continue;
                const dur = legacyFlags.duration;
                if (!dur || dur.label === 'indefinite' || dur.turns === null || dur.turns === undefined)
                    continue;
                if (dur.label !== triggerLabel)
                    continue;
                const legacyOrigin = legacyFlags.originID;
                if (legacyOrigin !== triggeringTokenId)
                    continue;

                const newTurns = (dur.turns || 1) - 1;
                if (newTurns <= 0)
                {
                    log(`Duration expired for ${effect.name} (legacy), removing effect`);
                    await effect.delete();
                }
                else
                    await effect.update(/** @type {any} */({ "flags.csm-lancer-qol.duration.turns": newTurns }));
                continue;
            }

            // Check durationEntries first (multi-duration stacks)
            const entries = flags.durationEntries;

            if (entries && Array.isArray(entries) && entries.length > 0)
            {
                let totalStackToRemove = 0;
                const remaining = [];
                let modified = false;

                for (const entry of entries)
                {
                    if (entry.label !== triggerLabel || entry.originID !== triggeringTokenId)
                    {
                        remaining.push(entry);
                        continue;
                    }

                    modified = true;
                    const newTurns = (entry.turns || 1) - 1;

                    if (newTurns <= 0)
                        totalStackToRemove += (entry.stack || 1);
                    else
                        remaining.push({ ...entry, turns: newTurns });
                }

                if (!modified)
                    continue;

                if (totalStackToRemove > 0)
                {
                    const currentStack = effect.flags?.statuscounter?.value || 1;
                    const newStack = currentStack - totalStackToRemove;

                    if (newStack <= 0 || remaining.length === 0)
                    {
                        log(`Duration expired for ${effect.name} (all stacks depleted), removing effect`);
                        await effect.delete();
                    }
                    else
                    {
                        log(`Duration expired for ${effect.name}, removing ${totalStackToRemove} stacks (${newStack} remaining)`);
                        await effect.update(/** @type {any} */({
                            "flags.statuscounter.value": newStack,
                            "flags.statuscounter.visible": newStack > 1,
                            "flags.lancer-automations.durationEntries": remaining
                        }));
                    }
                }
                else
                {
                    // Entries were modified (turns decremented) but none expired yet
                    await effect.update(/** @type {any} */({
                        "flags.lancer-automations.durationEntries": remaining
                    }));
                }
            }
            else
            {
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

                if (newTurns <= 0)
                {
                    const appliedStack = flags.appliedStack || 0;

                    if (appliedStack > 0)
                    {
                        const currentStack = effect.flags?.statuscounter?.value || 0;
                        const newStack = currentStack - appliedStack;

                        if (newStack <= 0)
                        {
                            log(`Duration expired for ${effect.name}, removing effect (all stacks)`);
                            await effect.delete();
                        }
                        else
                        {
                            log(`Duration expired for ${effect.name}, removing ${appliedStack} stacks (${newStack} remaining)`);
                            await effect.update(/** @type {any} */({
                                "flags.statuscounter.value": newStack,
                                "flags.statuscounter.visible": newStack > 1,
                                "flags.lancer-automations.duration": null,
                                "flags.lancer-automations.appliedStack": null
                            }));
                        }
                    }
                    else
                    {
                        log(`Duration expired for ${effect.name}, removing effect`);
                        await effect.delete();
                    }
                }
                else
                {
                    await effect.update(/** @type {any} */({
                        "flags.lancer-automations.duration.turns": newTurns
                    }));
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
 * @returns {Promise<void>}
 */
export async function triggerEffectImmunity(token, effectNames, source = "", notify = true)
{
    const actor = token?.actor;
    if (!actor)
        return;
    const targets = Array.isArray(effectNames) ? effectNames : [effectNames];
    if (targets.length === 0)
        return;

    const foundEffects = actor.effects.filter(effect =>
    {
        const flagName = effect.getFlag('lancer-automations', 'effect');
        const legacyFlagName = game.modules.get('csm-lancer-qol')?.active ? effect.getFlag('csm-lancer-qol', 'effect') : null;

        return targets.some(name =>
        {
            const nameTail = name.split('.').pop();
            const lowerName = nameTail.toLowerCase();
            return (
                effect.name?.toLowerCase().includes(lowerName) ||
                effect.statuses?.has(nameTail) ||
                (flagName?.toLowerCase().includes(lowerName)) ||
                (legacyFlagName?.toLowerCase().includes(lowerName))
            );
        });
    });

    if (foundEffects.length > 0)
    {
        const notifyOptions = notify ? {
            source: source,
            prefixText: 'Immunity to'
        } : false;

        await removeEffectsByNameFromTokens({
            tokens: [token],
            effectNames: targets,
            notify: notifyOptions
        });
    }
}

/**
 * Delete flagged (or all) active effects from a list of tokens.
 * @param {Array<Token|TokenDocument>} tokens - List of tokens to process
 * @returns {Promise<void>}
 */
export async function deleteAllEffects(tokens)
{
    if (!tokens || tokens.length === 0)
        return ui.notifications.error('No tokens provided for effect removal!');

    ui.notifications.info(`Removing all effects from ${tokens.length} tokens...`);

    for (const token of tokens)
    {
        if (!token.actor)
            continue;

        const ids = token.actor.effects.map(effect => effect.id.toString());
        if (ids.length > 0)
        {
            await token.actor.deleteEmbeddedDocuments("ActiveEffect", ids);
            log(`Removed ${ids.length} effects from ${token.name}`);
        }
    }
}

// Multi-source effect display collapsing

/**
 * Register a libWrapper on Token._refreshEffects to collapse duplicate same-name
 * lancer-automations effects into a single visible icon with an aggregate counter badge.
 * Must be called in a 'ready' hook so it runs after statuscounter's wrapper (outermost).
 */
export function initCollapseHook()
{
    if (typeof libWrapper === 'undefined')
        return;
    libWrapper.register('lancer-automations', 'Token.prototype._refreshEffects',
        function (wrapped, ...args)
        {
            // PRE: destroy duplicate sprites before _refreshEffects positions them.
            _collapseRemoveDuplicates(this);
            // FoundryVTT lays out the remaining sprites compactly; statuscounter adds its badges.
            wrapped(...args);
            // Only shrink icons when the custom stat bar is active.
            if (_isStatBarActive())
                _shrinkEffectIcons(this);
            // POST: add count badges for each collapsed group.
            _collapseAddBadges(this);
        }, 'WRAPPER');
}

/**
 * Shrink effect icons and re-lay them out at the smaller size.
 * @param {Token} token
 */
function _shrinkEffectIcons(token)
{
    const bg = token.effects?.bg;
    if (!bg || !token.effects?.children)
        return;

    let scale = 1;
    try
    {
        scale = Number(game.settings.get('lancer-automations', 'statBarEffectIconScale')) || 1;
    }
    catch
    { /* not registered */ }
    if (scale >= 1)
        return;

    const sprites = token.effects.children.filter(child => child !== bg && child instanceof PIXI.Sprite);
    if (sprites.length === 0)
        return;

    const gridPx = canvas.dimensions?.size ?? 100;
    const shrunk = gridPx * 0.1;
    const natural = gridPx * 0.2;
    const targetSize = Math.max(8, Math.round(shrunk + (natural - shrunk) * ((scale - 0.3) / 0.7)));

    if (sprites[0].width === targetSize && sprites[0].height === targetSize)
        return;

    const rows = Math.floor(token.document.height * 5);

    for (let i = 0; i < sprites.length; i++)
    {
        const sprite = sprites[i];
        // Scale direct to dodge .width setter dividing by a 0/stale texture size.
        const textureWidth = sprite.texture?.orig?.width || sprite.texture?.width || targetSize;
        const textureHeight = sprite.texture?.orig?.height || sprite.texture?.height || targetSize;
        sprite.scale.set(targetSize / textureWidth, targetSize / textureHeight);
        sprite.x = Math.floor(i / rows) * targetSize;
        sprite.y = (i % rows) * targetSize;
    }

    bg.clear();
    bg.beginFill(0x000000, 0.4);
    bg.lineStyle(1, 0x000000, 1);
    for (const sprite of sprites)
        bg.drawRoundedRect(sprite.x, sprite.y, targetSize, targetSize, 2);
    bg.endFill();
}

/**
 * PRE-phase: remove duplicate sprites for same-name lancer-automations effects from
 * token.effects.children before _refreshEffects positions them.
 * Sprites are matched to effects via sprite.zIndex (set by _drawEffects = effect index).
 * @param {Token} token
 */
function _collapseRemoveDuplicates(token)
{
    if (!token.actor || !token.effects?.children)
        return;
    const temporaryEffects = token.actor.temporaryEffects;
    if (!temporaryEffects?.length)
        return;

    // Build a map from effect id to its current sprite using zIndex as the key.
    const bg = token.effects.bg;
    const spriteMap = new Map();
    for (const child of token.effects.children)
    {
        if (child === bg)
            continue;
        const zIdx = child.zIndex;
        if (zIdx >= 0 && zIdx < temporaryEffects.length)
            spriteMap.set(temporaryEffects[zIdx].id, child);
    }

    // Collect names managed by lancer-automations so we can include HUD effects with the same name.
    const managedNames = new Set(
        temporaryEffects.filter(effect => effect.flags?.['lancer-automations'] && effect.name).map(effect => effect.name)
    );

    // Walk effects in order; keep the first sprite for each name, destroy the rest.
    const seenPrimary = new Set();
    for (const effect of temporaryEffects)
    {
        if (!spriteMap.has(effect.id))
            continue;
        const name = effect.name;
        if (!name || !managedNames.has(name))
            continue;
        if (seenPrimary.has(name))
        {
            const sprite = spriteMap.get(effect.id);
            if (sprite.parent === token.effects)
            {
                token.effects.removeChild(sprite);
                sprite.destroy();
            }
        }
        else
            seenPrimary.add(name);
    }
}

/**
 * POST-phase: after _refreshEffects and statuscounter have run with the compacted sprite list,
 * add numeric count badges on primary sprites for each collapsed group.
 * Counts ALL effects by name from actor data, so the badge shows the true total even when
 * duplicate sprites have already been removed.
 * @param {Token} token
 */
function _collapseAddBadges(token)
{
    if (!token.actor || !token.effects?.children)
        return;
    const temporaryEffects = token.actor.temporaryEffects;
    if (!temporaryEffects?.length)
        return;

    // Rebuild spriteMap with post-layout positions (sprites were repositioned by _refreshEffects).
    const bg = token.effects.bg;
    const spriteMap = new Map();
    for (const child of token.effects.children)
    {
        if (child === bg)
            continue;
        const zIdx = child.zIndex;
        if (zIdx >= 0 && zIdx < temporaryEffects.length)
            spriteMap.set(temporaryEffects[zIdx].id, child);
    }

    // Collect names managed by lancer-automations, then count ALL effects (flagged or HUD) sharing those names.
    const managedNames = new Set(
        temporaryEffects.filter(effect => effect.flags?.['lancer-automations'] && effect.name).map(effect => effect.name)
    );

    const effectCountByName = new Map();
    for (const effect of temporaryEffects)
    {
        const name = effect.name;
        if (!name || !managedNames.has(name))
            continue;
        effectCountByName.set(name, (effectCountByName.get(name) ?? 0) + 1);
    }

    const effectsOffsetX = token.effects?.x ?? 0;
    const effectsOffsetY = token.effects?.y ?? 0;

    for (const [name, count] of effectCountByName)
    {
        if (count <= 1)
            continue;
        // Find the first effect with this name that still has a sprite (the primary).
        const primaryEffect = temporaryEffects.find(effect => effect.name === name && spriteMap.has(effect.id));
        if (!primaryEffect)
            continue;
        const sprite = spriteMap.get(primaryEffect.id);
        const entry = { posX: sprite.x, posY: sprite.y, width: sprite.width, height: sprite.height };
        _addCounterBadge(token, entry, effectsOffsetX, effectsOffsetY, count);
    }
}

function _addCounterBadge(token, entry, offsetX, offsetY, count)
{
    if (!token.effectCounters)
    {
        const container = new PIXI.Container();
        container.name = "effectCounters";
        token.effectCounters = token.addChild(container);
    }

    // statuscounter always clears effectCounters before our POST runs, so we always create fresh.
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

/**
 * Get all flagged effects on a token or actor.
 * Flagged effects are those managed by lancer-automations, temporary-custom-statuses, or csm-lancer-qol.
 * @param {Token|TokenDocument|Actor} target - The target to search effects on
 * @returns {Array<ActiveEffect>} Array of flagged effects
 */
export function getAllEffects(target)
{
    const actor = /** @type {Actor} */(/** @type {any} */ (target).actor || target);
    if (!actor?.effects)
        return [];

    return [...actor.effects];
}

/**
 * Delete a specific active effect from a token by ID, with GM socket routing for non-GM users.
 * @param {Token|TokenDocument|string} token - The token (or its ID) that owns the effect
 * @param {ActiveEffect|string} effect - The effect (or its ID) to delete
 * @returns {Promise<void>}
 */
export async function deleteEffect(token, effect)
{
    const tokenID = /** @type {any} */ (token)?.id ?? token;
    const effectID = /** @type {any} */ (effect)?.id ?? effect;
    const target = canvas.tokens.get(tokenID);
    if (game.user.isGM || target?.document?.isOwner)
    {
        if (target?.actor)
            await target.actor.deleteEmbeddedDocuments("ActiveEffect", [effectID]);
    }
    else
        await socketRequestWithAck('removeEffectById', { targetID: tokenID, effectID });
}

// Deprecation layer

/** @deprecated use pushEffect */
export function pushFlaggedEffect(...args)
{
    console.warn("lancer-automations | pushFlaggedEffect is deprecated, use pushEffect instead");
    return pushEffect.apply(null, args);
}

/** @deprecated use setEffect @returns {Promise<void>} */
export function setFlaggedEffect(...args)
{
    console.warn("lancer-automations | setFlaggedEffect is deprecated, use setEffect instead");
    return setEffect.apply(null, args);
}

/** @deprecated use applyEffectsToTokens @returns {Promise<void>} */
export function applyFlaggedEffectToTokens(...args)
{
    console.warn("lancer-automations | applyFlaggedEffectToTokens is deprecated, use applyEffectsToTokens instead");
    return applyEffectsToTokens.apply(null, args);
}

/** @deprecated use removeEffectsByNameFromTokens @returns {Promise<void>} */
export function removeFlaggedEffectFromTokens(...args)
{
    console.warn("lancer-automations | removeFlaggedEffectFromTokens is deprecated, use removeEffectsByNameFromTokens instead");
    return removeEffectsByNameFromTokens.apply(null, args);
}

/** @deprecated use removeEffectsByNameFromTokens @returns {Promise<void>} */
export function removeEffectsFromTokens(...args)
{
    console.warn("lancer-automations | removeEffectsFromTokens is deprecated, use removeEffectsByNameFromTokens instead");
    return removeEffectsByNameFromTokens.apply(null, args);
}

/** @deprecated use findEffectOnToken @returns {ActiveEffect|null} */
export function findFlaggedEffectOnToken(...args)
{
    console.warn("lancer-automations | findFlaggedEffectOnToken is deprecated, use findEffectOnToken instead");
    return findEffectOnToken.apply(null, args);
}

/** @deprecated use triggerEffectImmunity @returns {Promise<void>} */
export function triggerFlaggedEffectImmunity(...args)
{
    console.warn("lancer-automations | triggerFlaggedEffectImmunity is deprecated, use triggerEffectImmunity instead");
    return triggerEffectImmunity.apply(null, args);
}

/** @deprecated use deleteAllEffects @returns {Promise<void>} */
export function executeDeleteAllFlaggedEffect(...args)
{
    console.warn("lancer-automations | executeDeleteAllFlaggedEffect is deprecated, use deleteAllEffects instead");
    return deleteAllEffects.apply(null, args);
}

/** @deprecated use getAllEffects @returns {ActiveEffect[]} */
export function getAllFlaggedEffects(...args)
{
    console.warn("lancer-automations | getAllFlaggedEffects is deprecated, use getAllEffects instead");
    return getAllEffects.apply(null, args);
}


/**
 * Read status templates attached to an item or an actor (item templates with
 * `isItemTemplate: true` on items, actor templates with `isActorTemplate: true` on actors).
 * @param {any} source  Item or Actor
 * @returns {any[]}
 */
export function getLinkedEffects(source)
{
    if (!source)
        return [];
    return /** @type {any[]} */ (Array.from(source.effects ?? []))
        .filter(effect =>
        {
            const laFlags = effect.flags?.['lancer-automations'];
            return laFlags?.isItemTemplate === true || laFlags?.isActorTemplate === true;
        });
}

export const EffectsAPI = {
    applyEffectsToTokens,
    removeEffectsByNameFromTokens,
    linkEffectToItem,
    linkEffectToActor,
    unlinkEffectFromItem,
    unlinkEffectFromActor,
    applyItemTemplatesToTokens,
    applyActorTemplatesToTokens,
    templateToEffectDescriptor,
    getLinkedEffects,
    findEffectOnToken,
    getAllEffects,
    deleteEffect,
    consumeEffectCharge,
    processDurationEffects,
    deleteAllEffects,
    triggerEffectImmunity,
    // Deprecated
    pushFlaggedEffect,
    setFlaggedEffect,
    applyFlaggedEffectToTokens,
    removeFlaggedEffectFromTokens,
    removeEffectsFromTokens,
    findFlaggedEffectOnToken,
    triggerFlaggedEffectImmunity,
    executeDeleteAllFlaggedEffect,
    getAllFlaggedEffects,
    pushEffect,
    setEffect
};
