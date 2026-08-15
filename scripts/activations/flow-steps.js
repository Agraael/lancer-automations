/* global canvas, ui, game, ChatMessage */

import { injectExtraDataUtility } from './flows.js';
import { accDiffTargetToken } from '../combat/grid-helpers.js';
import { applyDamageImmunities, convertHeatToEnergyIfHeatless, hasCritImmunity, hasHitImmunity, hasMissImmunity, consumeImmunityUse, burnBonusUsageForFlow } from '../bonuses/genericBonuses.js';
import { findEffectOnToken } from '../bonuses/flagged-effects.js';
import { getActiveGMId, startChoiceCard } from '../interactive/network.js';
import { resolveDeployableSourceItem } from '../interactive/deployables.js';
import { hasReactionAvailable, executeExtraActionCombat } from '../tools/misc-tools.js';
import { getActionOverlay } from '../interactive/action-overlays.js';
import { consumePerFrequencyForItem, itemAllTags } from '../combat/per-frequency-tags.js';
import { getAutoConsumeDisabled } from '../interactive/extra-config.js';
import { handleTrigger, _advanceMoveStack, _wipeMoveStack, _isActiveMoveStackFor } from '../main.js';

function attackActionData(state, weapon)
{
    return {
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
}

function techActionData(state, techItem)
{
    return {
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
}

export async function onAttackStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(accDiffTargetToken).filter(Boolean);

    const actionData = attackActionData(state, weapon);

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

export async function onHitMissStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const hitResults = state.data?.hit_results || [];

    const actionData = attackActionData(state, weapon);

    const hitTargets = [];
    const missTargets = [];

    for (let i = 0; i < hitResults.length; i++)
    {
        const hitResult = hitResults[i];
        const targetToken = hitResult?.target ?? accDiffTargetToken(targetInfos[i]);
        const roll = hitResult?.roll || state.data?.attack_results?.[i]?.roll;

        if (!targetToken)
            continue;

        if (await hasCritImmunity(targetToken.actor, state.actor, state) && (hitResult?.crit || state.data?.attack_results?.[i]?.crit))
        {
            if (hitResult)
                hitResult.crit = false;
            if (state.data?.attack_results?.[i])
                state.data.attack_results[i].crit = false;
            ui.notifications.info(`${targetToken.name} is immune to Critical Hits!`);
            await consumeImmunityUse(targetToken.actor, 'crit', state);
        }

        const missImmunity = await hasMissImmunity(targetToken.actor, state.actor, state);
        const hitImmunity = await hasHitImmunity(targetToken.actor, state.actor, state);
        if (missImmunity && hitImmunity)
            ui.notifications.info(`${targetToken.name} is immune to miss and hit - these effects cancel each other`);
        else
        {
            if (missImmunity && (hitResult?.miss || state.data?.attack_results?.[i]?.miss))
            {
                if (hitResult)
                    hitResult.hit = true;
                if (state.data?.attack_results?.[i])
                    state.data.attack_results[i].hit = true;
                ui.notifications.info(`${targetToken.name} is immune to miss - attack hits!`);
                await consumeImmunityUse(targetToken.actor, 'miss', state);
            }

            if (hitImmunity && (hitResult?.hit || state.data?.attack_results?.[i]?.hit))
            {
                if (hitResult)
                {
                    hitResult.hit = false;
                    hitResult.crit = false;
                }
                if (state.data?.attack_results?.[i])
                {
                    state.data.attack_results[i].hit = false;
                    state.data.attack_results[i].crit = false;
                }
                ui.notifications.info(`${targetToken.name} is immune to Hits: attack misses!`);
                await consumeImmunityUse(targetToken.actor, 'hit', state);
            }
        }
        if (hitResult?.hit)
        {
            hitTargets.push({
                target: targetToken,
                roll: roll,
                crit: hitResult?.crit || false
            });
        }
        else
        {
            missTargets.push({
                target: targetToken,
                roll: roll
            });
        }
    }

    if (hitTargets.length > 0)
    {
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
    if (missTargets.length > 0)
    {
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

    await burnBonusUsageForFlow(state);
    return true;
}

export async function onPreDamageStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;

    const actionData = attackActionData(state, weapon);

    return runCancellableStep(state, {
        trigger: 'onPreDamage',
        cancelKey: 'cancelDamage',
        reason: "This damage roll has been prevented.",
        title: "DAMAGE PREVENTED",
        token,
        data: {
            weapon,
            targets: (state.data?.hit_results ?? []).map(hitResult => hitResult.target).filter(Boolean),
            attackType: actionData.attack_type,
            // The damage flow titles itself "<weapon> DAMAGE"; onlyOnSourceMatch compares against the item name.
            actionName: weapon?.name ?? actionData.title,
            tags: actionData.tags,
            actionData
        }
    });
}

export async function onDamageStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;

    const damageResults = state.data?.damage_results || [];
    const targets = state.data?.targets || [];

    const actionData = attackActionData(state, weapon);

    for (const targetInfo of targets)
    {
        const targetToken = targetInfo.target;
        const isCrit = targetInfo.crit || false;
        const isHit = targetInfo.hit || false;

        if (targetInfo.damage && targetToken.actor)
        {
            const preTotal = targetInfo.damage.reduce((sum, damage) => sum + (Number(damage.amount ?? damage.val) || 0), 0);
            targetInfo.damage = applyDamageImmunities(targetToken.actor, targetInfo.damage, state);
            const postTotal = targetInfo.damage.reduce((sum, damage) => sum + (Number(damage.amount ?? damage.val) || 0), 0);
            if (postTotal < preTotal)
                await consumeImmunityUse(targetToken.actor, 'damage', state);
            targetInfo.damage = convertHeatToEnergyIfHeatless(targetToken.actor, targetInfo.damage);
        }
        if (Array.isArray(targetInfo.bonus_damage) && targetToken.actor)
            targetInfo.bonus_damage = convertHeatToEnergyIfHeatless(targetToken.actor, targetInfo.bonus_damage);

        const targetDamages = targetInfo.damage?.map(damage => damage.amount ?? damage.val) || [];
        const targetTypes = targetInfo.damage?.map(damage => damage.type) || [];

        if (targetDamages.length > 0)
        {
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

    await burnBonusUsageForFlow(state);
    return true;
}

export async function onPreStructureStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    return runCancellableStep(state, {
        trigger: 'onPreStructure',
        cancelKey: 'cancelStructure',
        reason: "Structure damage has been prevented.",
        title: "STRUCTURE PREVENTED",
        token,
        data: { remainingStructure: actor?.system?.structure?.value ?? 0 }
    });
}

export async function onStructureStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const roll = state.data?.result?.roll;
    const modifyRoll = (newTotal) =>
    {
        if (state.data?.result?.roll)
            state.data.result.roll._total = newTotal;
    };
    return runCancellableStep(state, {
        trigger: 'onStructure',
        cancelKey: 'cancelStructureOutcome',
        reason: "Structure outcome has been overridden.",
        title: "STRUCTURE OUTCOME OVERRIDDEN",
        token,
        data: {
            remainingStructure: actor?.system?.structure?.value ?? 0,
            rollResult: roll?.total,
            rollDice: roll?.dice?.[0]?.results?.map(die => die.result) ?? []
        },
        postData: { modifyRoll },
        getIgnoreCallback: () => async () =>
        {},
        choice2Text: null
    });
}

export async function onPreStressStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    return runCancellableStep(state, {
        trigger: 'onPreStress',
        cancelKey: 'cancelStress',
        reason: "Stress damage has been prevented.",
        title: "STRESS PREVENTED",
        token,
        data: { remainingStress: actor?.system?.stress?.value ?? 0 }
    });
}

export async function onStressStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const roll = state.data?.result?.roll;
    const modifyRoll = (newTotal) =>
    {
        if (state.data?.result?.roll)
            state.data.result.roll._total = newTotal;
    };
    return runCancellableStep(state, {
        trigger: 'onStress',
        cancelKey: 'cancelStressOutcome',
        reason: "Stress outcome has been overridden.",
        title: "STRESS OUTCOME OVERRIDDEN",
        token,
        data: {
            remainingStress: actor?.system?.stress?.value ?? 0,
            rollResult: roll?.total,
            rollDice: roll?.dice?.[0]?.results?.map(die => die.result) ?? []
        },
        postData: { modifyRoll },
        getIgnoreCallback: () => async () =>
        {},
        choice2Text: null
    });
}

export async function onTechAttackStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(accDiffTargetToken).filter(Boolean);

    const actionData = techActionData(state, techItem);

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

export async function onTechHitMissStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const hitResults = state.data?.hit_results || [];

    const actionData = techActionData(state, techItem);

    const hitTargets = [];
    const missTargets = [];

    for (let i = 0; i < hitResults.length; i++)
    {
        const hitResult = hitResults[i];
        const targetToken = hitResult?.target ?? accDiffTargetToken(targetInfos[i]);
        const roll = hitResult?.roll || state.data?.attack_results?.[i]?.roll;

        if (!targetToken)
            continue;

        if (hitResult?.hit)
        {
            hitTargets.push({
                target: targetToken,
                roll: roll,
                crit: hitResult?.crit || false
            });
        }
        else
        {
            missTargets.push({
                target: targetToken,
                roll: roll
            });
        }
    }

    if (hitTargets.length > 0)
    {
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
    if (missTargets.length > 0)
    {
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

    await burnBonusUsageForFlow(state);
    return true;
}

export async function onCheckStep(state)
{
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
    await burnBonusUsageForFlow(state);
    return true;
}

// Flow constructors whitelist data keys, so _cancelledBy and la_extraData are re-attached after construction.
function _relaunchIgnore(state)
{
    return async () =>
    {
        const flowClass = game.lancer?.flows?.get?.(state.name);
        if (!flowClass)
        {
            ui.notifications.error(`lancer-automations | Unknown flow type "${state.name}". Cannot re-launch.`);
            return;
        }
        try
        {
            const newFlow = new flowClass(state.item ?? state.actor, { ...state.data });
            if (newFlow.state?.data)
                newFlow.state.data._cancelledBy = state.data._cancelledBy;
            if (state.la_extraData)
                newFlow.state.la_extraData = foundry.utils.mergeObject(newFlow.state.la_extraData || {}, state.la_extraData);
            await newFlow.begin();
        }
        catch (error)
        {
            console.error(`lancer-automations | Re-launch of "${state.name}" failed:`, error);
        }
    };
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
 * @param {string} [opts.choice2Text] - null drops the second button.
 * @param {((uc: string|null) => Object)|null} [opts.getExtraCardOptions]
 * @param {(() => Promise<void>)|null} [opts.onBefore] - Called before card, after preConfirms.
 * @param {(() => Promise<void>)|null} [opts.onAfter] - Called after card.
 * @returns {((reasonText?: string, title?: string, allowConfirm?: boolean, userIdControl?: any, preConfirm?: any, postChoice?: any, opts?: Object) => Promise<void>) & { wait: () => Promise<void> }}
 */
export function _buildCancelFn({ setFlag, cancelledBy, getIgnoreCallback, defaultReason, defaultTitle, choice1Text = "Cancel", choice2Text = "Ignore", getExtraCardOptions = null, onBefore = null, onAfter = null })
{
    if (!cancelledBy)
        console.error('lancer-automations | _buildCancelFn: missing cancelledBy array');
    const cancelledReasons = [];
    const preConfirms = [];
    let cardPending = false;
    let _promise = null;

    /** @type {any} */
    const cancelFn = (reasonText = defaultReason, title = defaultTitle, allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) =>
    {
        setFlag();
        if (!cancelFn._reactorIdentity && !cancelFn._engineCancel)
            console.error('lancer-automations | cancel called without _reactorIdentity');
        if (cancelFn._reactorIdentity && cancelledBy)
            cancelledBy.push(cancelFn._reactorIdentity);
        // Fall back to reactor-dispatch context when caller omits opts
        const defaultContext = cancelFn._defaultContext ?? {};
        const item = opts.item ?? defaultContext.item ?? null;
        const originToken = opts.originToken ?? defaultContext.originToken ?? null;
        const relatedToken = opts.relatedToken ?? defaultContext.relatedToken ?? null;
        if (reasonText)
            cancelledReasons.push(reasonText);
        if (preConfirm)
            preConfirms.push(preConfirm);
        if (cardPending)
            return _promise;
        cardPending = true;
        _promise = (async () =>
        {
            await Promise.resolve();
            const ignoreCallback = getIgnoreCallback();
            if (preConfirms.length > 0)
            {
                const results = await Promise.all(preConfirms.map(preConfirmFn => preConfirmFn()));
                if (results.every(result => !result))
                {
                    await ignoreCallback();
                    return;
                }
            }
            if (!allowConfirm)
            {
                // Auto-pick choice1 (cancel-equivalent = keep blocked)
                await postChoice?.(true);
                return;
            }
            const description = cancelledReasons.length > 1
                ? cancelledReasons.map(reason => `• ${reason}`).join('<br>')
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
                        callback: async () =>
                        {
                            await postChoice?.(true);
                        }
                    },
                    ...(choice2Text ? [{
                        text: choice2Text,
                        icon: "fas fa-times",
                        callback: async () =>
                        {
                            await postChoice?.(false);
                            await ignoreCallback();
                        }
                    }] : [])
                ]
            });
            if (onAfter)
                await onAfter();
        })();
        return _promise;
    };
    cancelFn.wait = () => _promise;
    return cancelFn;
}

// cancelKey must stay the exact name reaction code reads from trigger data (e.g. triggerData.cancelAttack)
async function runCancellableStep(state, { trigger, cancelKey, reason, title, token, data = {}, postData = {}, getIgnoreCallback = null, choice2Text = undefined })
{
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    let cancelTriggered = false;
    const cancelFn = _buildCancelFn({
        setFlag: () =>
        {
            cancelTriggered = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: getIgnoreCallback ?? (() => _relaunchIgnore(state)),
        defaultReason: reason,
        defaultTitle: title,
        choice2Text
    });

    await handleTrigger(trigger, {
        triggeringToken: token,
        ...data,
        [cancelKey]: cancelFn,
        ...postData,
        _cancelledBy: state.data._cancelledBy,
        flowState: state
    });

    if (cancelTriggered)
    {
        await cancelFn.wait();
        return false;
    }
    return true;
}

export async function stunnedAutoFailStep(state)
{
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

export async function onInitCheckStep(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const proceed = await runCancellableStep(state, {
        trigger: 'onInitCheck',
        cancelKey: 'cancelCheck',
        reason: "This check has been canceled.",
        title: "CHECK CANCELED",
        token,
        data: {
            statName: state.data?.title || 'Unknown',
            checkAgainstToken: state.la_extraData?.targetTokenId ? canvas.tokens.get(state.la_extraData.targetTokenId) : null,
            targetVal: state.la_extraData?.targetVal ?? 10
        }
    });
    if (!proceed)
        return false;

    if (token)
        state.actor = token.actor;
    return true;
}

export async function onInitAttackStep(state)
{
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targets = state.data?.acc_diff?.targets?.map(accDiffTargetToken).filter(Boolean) || [];
    const actionData = attackActionData(state, weapon);
    const proceed = await runCancellableStep(state, {
        trigger: 'onInitAttack',
        cancelKey: 'cancelAttack',
        reason: "This attack has been canceled.",
        title: "ATTACK CANCELED",
        token,
        data: {
            weapon,
            targets,
            actionName: actionData.title,
            tags: actionData.tags,
            actionData
        }
    });
    if (!proceed)
        return false;

    if (token)
        state.actor = token.actor;
    return true;
}

export async function onInitTechAttackStep(state)
{
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targets = state.data?.acc_diff?.targets?.map(accDiffTargetToken).filter(Boolean) || [];
    const actionData = techActionData(state, techItem);
    const proceed = await runCancellableStep(state, {
        trigger: 'onInitTechAttack',
        cancelKey: 'cancelTechAttack',
        reason: "This tech attack has been canceled.",
        title: "TECH ATTACK CANCELED",
        token,
        data: {
            techItem,
            targets,
            actionName: actionData.title,
            isInvade: actionData.isInvade,
            tags: actionData.tags,
            actionData
        }
    });
    if (!proceed)
        return false;

    if (token)
        state.actor = token.actor;
    return true;
}

export async function onActivationStep(state)
{
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    let item = state.item;

    // Resolve source item for extra actions (SimpleActivationFlow has no item by default).
    // _sourceItemId is stamped by addExtraActions; the item ref is also passed from TAH.
    if (!item && state.data?.action?._sourceItemId && actor)
    {
        item = actor.items.get(state.data.action._sourceItemId) ?? null;
        if (item)
            state.item = item;
    }

    // Deployable: resolve source item so reactions can match.
    let deployable = null;
    if (actor?.type === 'deployable')
    {
        deployable = { actor, lid: actor.system?.lid ?? null };
        if (!item)
        {
            item = await resolveDeployableSourceItem(actor) ?? null;
            if (item)
                state.item = item;
        }
    }

    let actionType = state.data?.action?.activation || item?.system?.activation || state.data?.type || 'Other';
    let actionName = state.data?.title || state.data?.action?.name || item?.name || 'Unknown Action';
    // Lancer prepends ALL-CAPS flow tags like "CORE ACTIVATION :: " / "RESERVE :: " to action names.
    actionName = actionName.replace(/^[A-Z][A-Z ]+ :: /, '');

    // Normalize built-in flows that have no item and use actor-prefixed titles
    const flowClass = state.name ?? '';
    if (flowClass === 'OverchargeFlow')
    {
        actionType = 'Protocol';
        actionName = 'Overcharge';
    }
    else if (flowClass === 'StabilizeFlow')
    {
        actionType = 'Full';
        actionName = 'Stabilize';
    }
    else if (flowClass === 'TalentFlow' && state.data?.rank?.name)
        actionName = state.data.rank.name;
    else if (flowClass === 'BondPowerFlow')
        actionName = state.item?.system?.powers?.[state.data?.powerIndex]?.name ?? actionName;

    if (state.la_extraData?.endActivation && item?.name)
        actionName = item.name;

    const tags = state.data?.tags || item?.system?.tags || [];
    if (!state.data?.action?.activation && Array.isArray(tags))
    {
        const tagMap = {
            "tg_quick_action": "Quick",
            "tg_full_action": "Full",
            "tg_reaction": "Reaction",
            "tg_protocol": "Protocol",
            "tg_free_action": "Free"
        };

        for (const tag of tags)
        {
            if (tag.lid && tagMap[tag.lid])
            {
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

    let reactionJustConsumed = false;
    if (actionType === 'Reaction' && token && game.settings.get('lancer-automations', 'consumeReaction'))
    {
        if (hasReactionAvailable(token))
        {
            const updatedReactionCount = (token.actor.system.action_tracker.reaction ?? 1) - 1;
            await token.actor.update({ 'system.action_tracker.reaction': updatedReactionCount });
            reactionJustConsumed = true;
        }
        else
            ui.notifications.warn(`${token.name} has no reaction available!`);
    }

    await handleTrigger('onActivation', {
        triggeringToken: token,
        actionType: actionType,
        actionName: actionName,
        item,
        actionData,
        deployable,
        reactionJustConsumed,
        endActivation: state.la_extraData?.endActivation || false,
        extraData: state.la_extraData ?? {},
        flowState: state
    });

    // Gated on the overlay flag, not action.laCombat, so extras don't double-roll. Deployables
    // keep their actions on the actor, hence the second lookup.
    const overlayActor = token?.actor ?? actor;
    const overlay = (item ? getActionOverlay(item, actionName) : null) ?? getActionOverlay(overlayActor, actionName);
    if (overlay?.laCombat)
        await executeExtraActionCombat(overlayActor, { ...actionData.action, ...overlay, name: actionName }, item);

    if (token)
    {
        state.actor = token.actor;
        // Advance move stack post-effects; fire-and-forget.
        _advanceMoveStack('awaitActivation', token.id, false, { actionName });
    }

    // Auto-discharge extra actions that carry a `recharge` field after activation
    const activatedAction = state.data?.action;
    if (activatedAction?.recharge && activatedAction?.charged !== false)
    {
        for (const actorItem of (state.actor?.items ?? []))
        {
            const itemExtraActions = actorItem.getFlag('lancer-automations', 'extraActions') || [];
            const match = itemExtraActions.find(action => action.name === activatedAction.name && action.recharge);
            if (match)
            {
                match.charged = false;
                await actorItem.setFlag('lancer-automations', 'extraActions', itemExtraActions);
                break;
            }
        }
        const actorExtraActions = state.actor?.getFlag('lancer-automations', 'extraActions') || [];
        const actorMatch = actorExtraActions.find(action => action.name === activatedAction.name && action.recharge);
        if (actorMatch)
        {
            actorMatch.charged = false;
            await state.actor.setFlag('lancer-automations', 'extraActions', actorExtraActions);
        }
    }

    return true;
}

export async function consumeGenericPrintResourcesStep(state)
{
    const item = state.item;
    if (!item?.system)
        return true;
    const itemSystem = item.system;
    const tags = itemAllTags(itemSystem);
    const hasTag = (lid) => tags.some(tag => tag?.lid === lid);
    const disabled = getAutoConsumeDisabled(item);
    const updates = {};
    if (!disabled.has('uses') && hasTag('tg_limited') && itemSystem.uses != null)
    {
        const usesIsNested = typeof itemSystem.uses !== 'number';
        const currentUses = usesIsNested ? Number(itemSystem.uses.value ?? 0) : Number(itemSystem.uses);
        if (currentUses > 0)
            updates[usesIsNested ? 'system.uses.value' : 'system.uses'] = currentUses - 1;
    }
    if (!disabled.has('loading') && hasTag('tg_loading') && itemSystem.loaded === true)
        updates['system.loaded'] = false;
    if (!disabled.has('charged') && hasTag('tg_recharge') && itemSystem.charged !== false)
        updates['system.charged'] = false;
    if (Object.keys(updates).length)
        await item.update(updates);
    await consumePerFrequencyForItem(item, { skipTypes: disabled });
    return true;
}

export async function onInitActivationStep(state)
{
    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    let item = state.item;
    if (!state.data)
        state.data = {};
    if (!state.data._cancelledBy)
        state.data._cancelledBy = [];

    // Deployable: surface the actor's LID and resolve the source item.
    let deployable = null;
    if (actor?.type === 'deployable')
    {
        deployable = { actor, lid: actor.system?.lid ?? null };
        if (!item)
        {
            item = await resolveDeployableSourceItem(actor) ?? null;
            if (item)
                state.item = item;
        }
    }

    let actionType = state.data?.action?.activation || item?.system?.activation || state.data?.type || 'Other';
    const actionName = state.data?.title || state.data?.action?.name || item?.name || 'Unknown Action';

    const tags = state.data?.tags || item?.system?.tags || [];
    if (!state.data?.action?.activation && Array.isArray(tags))
    {
        const tagMap = {
            "tg_quick_action": "Quick",
            "tg_full_action": "Full",
            "tg_reaction": "Reaction",
            "tg_protocol": "Protocol",
            "tg_free_action": "Free"
        };
        for (const tag of tags)
        {
            if (tag.lid && tagMap[tag.lid])
            {
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
        setFlag: () =>
        {
            cancelActivation = true;
        },
        cancelledBy: state.data._cancelledBy,
        getIgnoreCallback: () => _relaunchIgnore(state),
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

    if (cancelActivation)
    {
        if (token && _isActiveMoveStackFor(token.id))
            _wipeMoveStack();
        await cancelAction.wait();
        return false;
    }

    if (token)
        state.actor = token.actor;
    return true;
}
