import * as actionFX from '../fx/actionFX.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { grappleState } from './grapple-state.js';
import { getMinGridDistance } from './grid-helpers.js';

// IMMOBILIZED uses flagged-effects; ENGAGED is managed by overwatch.js, not here.

import { MODULE_ID } from '../tools/constants.js';
import { localize, localizeFormat } from '../tools/string-utils.js';

// Held > 0 while grapple-internal status mutations run on this client.
// Lets the deleteActiveEffect hook (Layer 3) tell its own removals from user-manual ones.
let _laInternalGuard = 0;

const getGrappleState = grappleState;

async function setGrappleState(token, state)
{
    if (!token)
        return;

    const api = game.modules.get(MODULE_ID)?.api;
    await api?.setTokenFlag?.(token.document, MODULE_ID, 'grappleState', state);
}

async function clearGrappleState(token)
{
    if (!token)
        return;

    const api = game.modules.get(MODULE_ID)?.api;
    await api?.unsetTokenFlag?.(token.document, MODULE_ID, 'grappleState');
}

function getTokenSize(token)
{
    return token?.actor?.system?.size || 1;
}

function grappleGroup(token)
{
    const holders = new Set();
    const held = new Set();
    const seen = new Set();
    const queue = [token];

    while (queue.length)
    {
        const current = queue.pop();
        if (!current || seen.has(current.id))
            continue;
        seen.add(current.id);

        const state = getGrappleState(current);
        if (state.grapplerIds?.length)
            held.add(current.id);
        if (state.grappledIds?.length)
            holders.add(current.id);

        for (const [ids, side] of [[state.grapplerIds, holders], [state.grappledIds, held]])
        {
            for (const id of ids ?? [])
            {
                const other = canvas.tokens.get(id);
                if (!other)
                    continue;
                side.add(id);
                queue.push(other);
            }
        }
    }

    return { holders: [...holders], held: [...held] };
}

const sideSize = ids => ids.reduce((sum, id) => sum + getTokenSize(canvas.tokens.get(id)), 0);

function isEqualSizeGrapple(token)
{
    const group = grappleGroup(token);
    return group.held.length > 0 && sideSize(group.holders) === sideSize(group.held);
}

function isAdjacent(token, other, position = null)
{
    return getMinGridDistance(token, other, position) <= 1;
}

async function postGrappleChat(token, text)
{
    await ChatMessage.create(/** @type {any} */ ({
        speaker: ChatMessage.getSpeaker({ token: token.document }),
        content: `<div class="la-grapple-chat">${text}</div>`,
    }));
}

function isImmobilizedByGrapple(token)
{
    // Status is the user-visible truth; if it was manually cleared, drop the block even if state flag is stale.
    if (!token?.actor?.statuses?.has('immobilized'))
        return false;
    return grappleImmobilizes(token);
}

function grappleImmobilizes(token)
{
    const state = getGrappleState(token);
    if (state.grapplerIds?.length > 0 && state.immobilizedSide === "grappled")
        return true;

    if (state.grappledIds?.length > 0)
    {
        for (const id of state.grappledIds)
        {
            const grappledState = getGrappleState(canvas.tokens.get(id));
            if (grappledState.immobilizedSide === "grapplers")
                return true;
        }
    }

    return false;
}

function grappleStatusExpected(token, statusId)
{
    const state = getGrappleState(token);
    if (statusId === 'grappled')
        return state.grapplerIds?.length > 0;
    if (statusId === 'grappling')
        return state.grappledIds?.length > 0;
    if (statusId === 'immobilized')
        return grappleImmobilizes(token);
    return false;
}

async function updateImmobilized(api, grappledToken, isInit = false)
{
    _laInternalGuard++;

    try
    {
        const state = getGrappleState(grappledToken);
        if (!state.grapplerIds?.length)
            return;

        const group = grappleGroup(grappledToken);
        const holderSize = sideSize(group.holders);
        const heldSize = sideSize(group.held);
        const heldTokens = group.held.map(id => canvas.tokens.get(id)).filter(Boolean);
        const holderTokens = group.holders.map(id => canvas.tokens.get(id)).filter(Boolean);

        let newImmobilizedSide;
        if (holderSize > heldSize)
            newImmobilizedSide = "grappled";
        else if (heldSize > holderSize)
            newImmobilizedSide = "grapplers";
        else
            // Equal size: init defaults grappled = immobilized; HULL contest preserves the winner.
            newImmobilizedSide = isInit ? "grappled" : (state.immobilizedSide ?? "grappled");

        for (const held of heldTokens)
        {
            const heldState = getGrappleState(held);
            if (heldState.immobilizedSide !== newImmobilizedSide)
                await setGrappleState(held, { ...heldState, immobilizedSide: newImmobilizedSide });
        }

        const [stuck, loose] = newImmobilizedSide === "grappled" ? [heldTokens, holderTokens] : [holderTokens, heldTokens];
        await api.applyEffectsToTokens({
            tokens: stuck,
            effectNames: ['immobilized'],
            note: 'Grapple',
        }, { grappleSource: true });
        await api.removeEffectsByNameFromTokens({ tokens: loose.filter(token => !grappleImmobilizes(token)), effectNames: ['immobilized'], extraFlags: { grappleSource: true } });
    }
    finally
    {
        _laInternalGuard--;
    }
}

async function refreshHolderGroup(api, holder)
{
    const firstHeld = (getGrappleState(holder).grappledIds ?? []).map(id => canvas.tokens.get(id)).find(Boolean);
    if (firstHeld)
        await updateImmobilized(api, firstHeld);
}

async function endApartGrapples(api, tokens, planned = new Map())
{
    const pairs = new Map();
    for (const token of tokens)
    {
        const state = getGrappleState(token);
        for (const id of state.grappledIds ?? [])
            pairs.set(`${token.id}:${id}`, [token.id, id]);
        for (const id of state.grapplerIds ?? [])
            pairs.set(`${id}:${token.id}`, [id, token.id]);
    }

    for (const [holderId, heldId] of pairs.values())
    {
        const holder = canvas.tokens.get(holderId);
        const held = canvas.tokens.get(heldId);
        if (!holder || !held || !getGrappleState(held).grapplerIds?.includes(holderId))
            continue;
        const [moved, other] = planned.has(heldId) ? [held, holder] : [holder, held];
        if (isAdjacent(moved, other, planned.get(moved.id) ?? null))
            continue;
        await releaseGrappler(api, holder, held);
        await postGrappleChat(holder, localizeFormat('LA.grapple.chat.apart', { holder: holder.name, held: held.name }));
    }
}

function dragsGrapple(token)
{
    const state = getGrappleState(token);

    if (state.grappledIds?.length > 0)
    {
        return state.grappledIds.some(id =>
        {
            const held = canvas.tokens.get(id);
            // Only drag if the other side actually still has immobilized; guards against stale flag.
            return held?.actor?.statuses?.has('immobilized')
                && getGrappleState(held).immobilizedSide === "grappled";
        });
    }

    if (state.grapplerIds?.length > 0)
    {
        return token?.actor?.statuses?.has('immobilized')
            && state.immobilizedSide === "grapplers";
    }

    return false;
}

async function establishGrapples(api, grappler, grappledTokens)
{
    _laInternalGuard++;

    try
    {
        const grapplerState = getGrappleState(grappler);
        const existingIds = grapplerState.grappledIds || [];

        for (const grappledToken of grappledTokens)
        {
            const existingState = getGrappleState(grappledToken);
            const wasFresh = !(existingState.grapplerIds?.length > 0);

            if (!wasFresh)
            {
                if (existingState.grapplerIds.includes(grappler.id))
                    continue;
                await setGrappleState(grappledToken, {
                    grapplerIds: [...existingState.grapplerIds, grappler.id],
                    immobilizedSide: existingState.immobilizedSide
                });
            }
            else
            {
                await setGrappleState(grappledToken, { grapplerIds: [grappler.id], immobilizedSide: null });
                await api.applyEffectsToTokens({
                    tokens: [grappledToken],
                    effectNames: ['grappled'],
                    note: `Grappled by ${grappler.name}`,
                }, { grappleSource: true });
            }

            await updateImmobilized(api, grappledToken, wasFresh);
        }

        const merged = Array.from(new Set([...existingIds, ...grappledTokens.map(target => target.id)]));
        await setGrappleState(grappler, { grappledIds: merged });
        await refreshHolderGroup(api, grappler);

        if (merged.length > 0)
        {
            const names = merged.map(id => canvas.tokens.get(id)?.name).filter(Boolean).join(', ');
            await api.applyEffectsToTokens({
                tokens: [grappler],
                effectNames: ['grappling'],
                note: names ? `Grappling ${names}` : 'Grappling',
            }, { grappleSource: true });
        }
    }
    finally
    {
        _laInternalGuard--;
    }
}

async function releaseGrappler(api, grappler, grappledToken)
{
    _laInternalGuard++;

    try
    {
        const grappledState = getGrappleState(grappledToken);
        const newGrapplerIds = (grappledState.grapplerIds || []).filter(id => id !== grappler.id);

        if (newGrapplerIds.length === 0)
            await cancelGrappleForToken(api, grappledToken);
        else
        {
            await setGrappleState(grappledToken, { grapplerIds: newGrapplerIds, immobilizedSide: grappledState.immobilizedSide });
            await unlinkGrappled(api, grappler, grappledToken);
            await updateImmobilized(api, grappledToken);
        }
        await refreshHolderGroup(api, grappler);
    }
    finally
    {
        _laInternalGuard--;
    }
}

async function unlinkGrappled(api, grappler, grappledToken)
{
    const remaining = (getGrappleState(grappler).grappledIds || []).filter(id => id !== grappledToken.id);

    if (remaining.length === 0)
    {
        await clearGrappleState(grappler);
        await api.removeEffectsByNameFromTokens({
            tokens: [grappler],
            effectNames: ['grappling', 'immobilized'],
            extraFlags: { grappleSource: true }
        });
        return;
    }

    await setGrappleState(grappler, { grappledIds: remaining });
    if (!grappleImmobilizes(grappler))
        await api.removeEffectsByNameFromTokens({ tokens: [grappler], effectNames: ['immobilized'], extraFlags: { grappleSource: true } });
}

async function cleanupGrappleReferences(api, deletedTokenId)
{
    _laInternalGuard++;

    try
    {
        const sceneTokens = canvas?.scene?.tokens;
        if (!sceneTokens)
            return;

        for (const tokenDoc of sceneTokens)
        {
            if (tokenDoc.id === deletedTokenId)
                continue;

            const token = canvas.tokens.get(tokenDoc.id);
            if (!token)
                continue;

            const state = getLAFlag(tokenDoc,'grappleState');
            if (!state)
                continue;

            if (state.grapplerIds?.includes(deletedTokenId))
            {
                const newIds = state.grapplerIds.filter(id => id !== deletedTokenId);

                if (newIds.length === 0)
                    await cancelGrappleForToken(api, token);
                else
                {
                    await setGrappleState(token, { grapplerIds: newIds, immobilizedSide: state.immobilizedSide });
                    await updateImmobilized(api, token);
                }
            }

            if (state.grappledIds?.includes(deletedTokenId))
                await unlinkGrappled(api, token, { id: deletedTokenId });
        }
    }
    finally
    {
        _laInternalGuard--;
    }
}

async function cancelGrappleForToken(api, token)
{
    _laInternalGuard++;

    try
    {
        const state = getGrappleState(token);

        if (state.grappledIds?.length > 0)
        {
            for (const grappledId of [...state.grappledIds])
            {
                const grappledToken = canvas.tokens.get(grappledId);
                if (grappledToken)
                    await releaseGrappler(api, token, grappledToken);
            }

            await clearGrappleState(token); // ensure cleared even if some targets were missing
        }
        else if (state.grapplerIds?.length > 0)
        {
            const grapplerTokens = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);

            await clearGrappleState(token);
            await api.removeEffectsByNameFromTokens({
                tokens: [token],
                effectNames: ['grappled', 'immobilized'],
                extraFlags: { grappleSource: true }
            });
            for (const grappler of grapplerTokens)
            {
                await unlinkGrappled(api, grappler, token);
                await refreshHolderGroup(api, grappler);
            }
        }
    }
    finally
    {
        _laInternalGuard--;
    }
}

Hooks.on('lancer-automations.ready', (api) =>
{

    api.registerDefaultGeneralAutomations({

        "Grapple": {
            category: "General",
            reactions: [

                {
                    triggers: ["onActivation"],
                    onlyOnSourceMatch: true,
                    comments: "Melee attack, the grapple starts on a hit",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        await actionFX.queueActionFx(() => actionFX.playGrappleFX(reactorToken), reactorToken, 'grapple');
                        await api.executeBasicAttack(reactorToken.actor, {
                            title: "Grapple",
                            attack_type: "Melee"
                        }, { tapeRecorded: true, rollTypes: ['grapple'], noDamage: true });
                    }
                },

                {
                    triggers: ["onHit"],
                    onlyOnSourceMatch: true,
                    comments: "On hit: establish grapple",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        const targets = triggerData.targets?.map(t => t.target) || [];
                        const validTargets = [];

                        for (const target of targets)
                        {
                            if (api.checkEffectImmunities(target.actor, 'grappled', null, null, { ownerTokenId: target.id, otherToken: reactorToken }).length > 0)
                                ui.notifications.warn(localizeFormat('LA.notify.immuneToGrapple', { name: target.name }));
                            else
                                validTargets.push(target);
                        }

                        if (!validTargets.length)
                            return;
                        await establishGrapples(api, reactorToken, validTargets);
                        await postGrappleChat(reactorToken, localizeFormat('LA.grapple.chat.start', { name: reactorToken.name, targets: validTargets.map(target => target.name).join(', ') }));
                    }
                },

                {
                    triggers: ["onMove"],
                    comments: "Drag the immobilized side, or end the grapple when apart",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        const state = getGrappleState(reactorToken);
                        return !!(state.grapplerIds?.length || state.grappledIds?.length);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        if (!dragsGrapple(reactorToken))
                        {
                            await endApartGrapples(api, [reactorToken]);
                            return;
                        }

                        const state = getGrappleState(reactorToken);
                        let tokensToMove = [];

                        if (state.grappledIds?.length > 0)
                        {
                            tokensToMove = state.grappledIds
                                .map(id => canvas.tokens.get(id))
                                .filter(held => held && getGrappleState(held).immobilizedSide === "grappled");
                        }
                        else if (state.grapplerIds?.length > 0)
                            tokensToMove = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);

                        if (!tokensToMove.length)
                            return;

                        const shiftX = (triggerData.endPos?.x ?? 0) - (triggerData.startPos?.x ?? 0);
                        const shiftY = (triggerData.endPos?.y ?? 0) - (triggerData.startPos?.y ?? 0);
                        const presets = Object.fromEntries(tokensToMove.map(held => [held.id, { x: held.document.x + shiftX, y: held.document.y + shiftY }]));

                        const moves = await api.knockBackToken(tokensToMove, -1, {
                            title: localize('LA.dialogTitle.grappleFollowMovement'),
                            description: localizeFormat('LA.grapple.placeToFollow', { tokens: tokensToMove.map(held => held.name).join(', '), name: reactorToken.name }),
                            triggeringToken: reactorToken,
                            actionName: "Grapple",
                            presets,
                            stayAdjacentTo: reactorToken,
                        });
                        const planned = new Map((moves ?? []).map(move => [move.tokenId, move.updateData]));
                        await endApartGrapples(api, [reactorToken, ...tokensToMove], planned);
                    }
                },

                {
                    triggers: ["onPreMove"],
                    awaitActivationCompletion: true,
                    comments: "Block movement while IMMOBILIZED",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        return isImmobilizedByGrapple(reactorToken);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        await triggerData.cancelTriggeredMove(localizeFormat('LA.grapple.cannotMove', { name: reactorToken.name }));
                    }
                },

                {
                    triggers: ["onInvoluntaryMove"],
                    comments: "Involuntary move (e.g. knockback) ends the grapple",
                    triggerSelf: true,
                    triggerOther: true,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        if (triggerData.actionName === "Grapple")
                            return false;

                        const state = getGrappleState(reactorToken);
                        if (!state.grapplerIds?.length && !state.grappledIds?.length)
                            return false;
                        return triggerData.triggeringToken?.id === reactorToken.id;
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        await cancelGrappleForToken(api, reactorToken);
                    }
                },

                {
                    triggers: ["onTokenRemoved"],
                    comments: "Cleanup grapple references when this token is removed",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        const state = getGrappleState(reactorToken);
                        return !!(state.grapplerIds?.length || state.grappledIds?.length);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        await cleanupGrappleReferences(api, reactorToken.id);
                    }
                },

                {
                    triggers: ["onStatusRemoved"],
                    comments: "User manually cleared a grapple status — cancel the whole grapple",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: true,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        if (_laInternalGuard > 0)
                            return false;
                        if (!getLAFlag(triggerData.effect,'grappleSource'))
                            return false;
                        return grappleStatusExpected(reactorToken, triggerData.statusId);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        await cancelGrappleForToken(api, reactorToken);
                    }
                },

                {
                    triggers: ["onTurnStart"],
                    comments: "Equal size: HULL contest",
                    triggerSelf: true,
                    triggerOther: false,
                    autoActivate: true,
                    isReaction: false,
                    checkReaction: false,
                    activationType: "code",
                    activationMode: "instead",
                    outOfCombat: false,
                    evaluate: function(triggerType, triggerData, reactorToken)
                    {
                        return isEqualSizeGrapple(reactorToken) && isImmobilizedByGrapple(reactorToken);
                    },
                    activationCode: async function(triggerType, triggerData, reactorToken)
                    {
                        const group = grappleGroup(reactorToken);
                        const state = getGrappleState(reactorToken);
                        const reactorHeld = group.held.includes(reactorToken.id);
                        // Multi-grappler equal-size: first grappler represents the side.
                        const opponent = canvas.tokens.get(reactorHeld ? state.grapplerIds?.[0] : state.grappledIds?.[0]);
                        const firstHeld = canvas.tokens.get(group.held[0]);

                        if (!opponent || !firstHeld)
                            return;

                        const result = await api.openHaseContestCard({
                            tokenA: reactorToken,
                            skillA: "HULL",
                            tokenB: opponent,
                            skillB: "HULL",
                            title: localize('LA.dialogTitle.grappleContestHull'),
                            cardTitle: localize('LA.dialogTitle.grappleContest'),
                            description: localizeFormat('LA.grapple.contestPrompt', { name: reactorToken.name }),
                            cancelText: localize('LA.grapple.skipContest'),
                            sendToOwner: true,
                            sourceAction: "Grapple",
                        });

                        if (!result?.completed)
                            return;

                        const reactorWon = result.winner === reactorToken.actor;
                        const reactorSide = reactorHeld ? "grappled" : "grapplers";
                        const losingSide = reactorWon ? (reactorHeld ? "grapplers" : "grappled") : reactorSide;

                        await setGrappleState(firstHeld, { ...getGrappleState(firstHeld), immobilizedSide: losingSide });
                        await updateImmobilized(api, firstHeld);
                        await postGrappleChat(reactorToken, reactorWon
                            ? localizeFormat('LA.grapple.chat.contestWon', { name: reactorToken.name, other: opponent.name })
                            : localizeFormat('LA.grapple.chat.contestLost', { name: reactorToken.name, other: opponent.name }));
                    }
                }

            ]
        },

        "End Grapple": {
            category: "General",
            comments: "Free action: end your grapple",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            activationType: "code",
            activationMode: "instead",
            outOfCombat: true,
            activationCode: async function(triggerType, triggerData, reactorToken)
            {
                const names = (getGrappleState(reactorToken).grappledIds ?? []).map(id => canvas.tokens.get(id)?.name).filter(Boolean);
                await cancelGrappleForToken(api, reactorToken);
                if (names.length)
                    await postGrappleChat(reactorToken, localizeFormat('LA.grapple.chat.end', { name: reactorToken.name, targets: names.join(', ') }));
            }
        },

        "Break Free": {
            category: "General",
            comments: "Quick: contested HULL to escape",
            triggers: ["onActivation"],
            onlyOnSourceMatch: true,
            triggerSelf: true,
            triggerOther: false,
            autoActivate: true,
            isReaction: false,
            checkReaction: false,
            activationType: "code",
            activationMode: "instead",
            outOfCombat: true,
            activationCode: async function(triggerType, triggerData, reactorToken)
            {
                const state = getGrappleState(reactorToken);

                if (!state.grapplerIds?.length)
                {
                    ui.notifications.warn(localizeFormat('LA.notify.notGrappled', { name: reactorToken.name }));
                    return;
                }

                const grapplerTokens = state.grapplerIds.map(id => canvas.tokens.get(id)).filter(Boolean);

                if (grapplerTokens.length === 0)
                {
                    await cancelGrappleForToken(api, reactorToken); return;
                }

                let chosenGrappler;

                if (grapplerTokens.length === 1)
                    chosenGrappler = grapplerTokens[0];
                else
                {
                    const result = await api.startChoiceCard({
                        mode: "or",
                        title: localize('LA.dialogTitle.breakFreeCaps'),
                        description: localizeFormat('LA.grapple.chooseGrappler', { name: reactorToken.name }),
                        choices: grapplerTokens.map(g => ({
                            text: g.name,
                            icon: "cci cci-structure",
                            callback: async () =>
                            {}
                        }))
                    });

                    if (result?.choiceIdx == null)
                        return;
                    chosenGrappler = grapplerTokens[result.choiceIdx];
                }

                const result = await api.openHaseContestCard({
                    tokenA: reactorToken,
                    skillA: "HULL",
                    tokenB: chosenGrappler,
                    skillB: "HULL",
                    title: localize('LA.dialogTitle.breakFreeHull'),
                    cardTitle: localize('LA.dialogTitle.breakFreeCaps'),
                    sendToOwner: true,
                    sourceAction: "Break Free",
                });

                if (!result?.completed)
                    return;

                if (result.winner === reactorToken.actor)
                {
                    await releaseGrappler(api, chosenGrappler, reactorToken);
                    await postGrappleChat(reactorToken, localizeFormat('LA.grapple.chat.breakFree', { name: reactorToken.name, grappler: chosenGrappler.name }));
                }
                else
                {
                    await postGrappleChat(reactorToken, localizeFormat('LA.grapple.chat.breakFreeFail', { name: reactorToken.name, grappler: chosenGrappler.name }));
                }
            }
        }

    });

    console.log("lancer-automations | Grapple automation registered.");
});
