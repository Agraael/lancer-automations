/* global canvas, ui, game, ChatMessage */

import { injectExtraDataUtility } from './flows.js';
import { accDiffTargetToken } from '../combat/grid-helpers.js';
import { applyDamageImmunities, hasCritImmunity, hasHitImmunity, hasMissImmunity } from '../bonuses/genericBonuses.js';
import { findEffectOnToken } from '../bonuses/flagged-effects.js';
import { getActiveGMId, startChoiceCard } from '../interactive/network.js';
import { resolveDeployableSourceItem } from '../interactive/deployables.js';
import { hasReactionAvailable } from '../tools/misc-tools.js';
import { handleTrigger, _advanceMoveStack, _wipeMoveStack, _isActiveMoveStackFor } from '../main.js';

export async function onAttackStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(accDiffTargetToken).filter(Boolean);

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

export async function onHitMissStep(state) {
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
        const targetToken = hitResult?.target ?? accDiffTargetToken(targetInfos[i]);
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

export async function onDamageStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;

    const damageResults = state.data?.damage_results || [];
    const targets = state.data?.targets || [];

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

export async function onPreStructureStep(state) {
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

export async function onStructureStep(state) {
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

export async function onPreStressStep(state) {
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

export async function onStressStep(state) {
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

export async function onTechAttackStep(state) {
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targetInfos = state.data?.acc_diff?.targets || [];
    const targets = targetInfos.map(accDiffTargetToken).filter(Boolean);

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

export async function onTechHitMissStep(state) {
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
        const targetToken = hitResult?.target ?? accDiffTargetToken(targetInfos[i]);
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

export async function onCheckStep(state) {
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
export function _buildCancelFn({ setFlag, cancelledBy, getIgnoreCallback, defaultReason, defaultTitle, choice1Text = "Cancel", choice2Text = "Ignore", getExtraCardOptions = null, onBefore = null, onAfter = null }) {
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

export async function stunnedAutoFailStep(state) {
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

export async function onInitCheckStep(state) {
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

export async function onInitAttackStep(state) {
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const weapon = item;
    const targets = state.data?.acc_diff?.targets?.map(accDiffTargetToken).filter(Boolean) || [];
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

export async function onInitTechAttackStep(state) {
    const actor = state.actor;
    const item = state.item;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const techItem = item;
    const targets = state.data?.acc_diff?.targets?.map(accDiffTargetToken).filter(Boolean) || [];
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

export async function onActivationStep(state) {
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
    // Lancer prepends ALL-CAPS flow tags like "CORE ACTIVATION :: " / "RESERVE :: " to action names.
    actionName = actionName.replace(/^[A-Z][A-Z ]+ :: /, '');

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

export async function onInitActivationStep(state) {
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
        if (token && _isActiveMoveStackFor(token.id)) {
            _wipeMoveStack();
        }
        await cancelAction.wait();
        return false;
    }

    if (token)
        state.actor = token.actor;
    return true;
}
