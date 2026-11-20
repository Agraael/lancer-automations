/* global game, canvas, fromUuid, ui, Dialog, HTMLVideoElement */

import { displayAutomationPopup } from './activations/automation-ui.js';
import { AutomationManager } from './activations/automation-manager.js';
import {
    applyKnockbackMoves, startChoiceCard,
    showUserIdControlledChoiceCard, resolveGMChoiceCard,
    showMultiUserControlledChoiceCard, cancelBroadcastChoiceCard,
    drawMovementTrace,
    showVoteCardOnVoter, receiveVoteSubmission,
    updateVoteCardOnVoter, confirmVoteCardOnVoter, cancelVoteCardOnVoter,
    getTokenOwnerUserId, startWaitCard, cancelChoiceCardByKey,
} from './interactive/index.js';
import { MODULE_ID } from './tools/constants.js';
import { onRemotePresence, onRemotePresenceClear } from './interactive/presence.js';
import { onRemoteReactionCue } from './interactive/reaction-cue.js';
import { onRemoteSightlines, onRemoteSightlinesClear } from './vision/sightlines.js';
import { onUplinkRollOpen, onUplinkRollSnapshot, onUplinkRollClose } from './uplink/live-rolls.js';
import { localize, localizeFormat } from './tools/string-utils.js';
import { handleRemoteFocus } from './tools/auto-focus.js';
import { handleRemoteDice } from './activations/dice-first.js';
import { floatTokenText } from './tools/float-text.js';
import { receiveDeferredResistanceConsumption } from './bonuses/genericBonuses.js';
import { setEffect, setEffectOnDoc, removeEffectsByName, consumeEffectCharge, resolveEffectTarget } from './bonuses/flagged-effects.js';
import { performGMInputScan, performSystemScan, showSystemScanDialog } from './tools/scan.js';
import { preLoadImageForAll } from './tools/wreck.js';
import { createActorInDeployableFolder } from './interactive/deployable-specs.js';
import { executeStatRoll, getItemLID, isExecutorGM, hasExecutorGM } from './tools/misc-tools.js';
import { applyTapeOp } from './tah/tape-store.js';
import { runWorldClockOp } from './tools/world-clocks.js';
import { openDowntimeSummary, showDowntimeJournalPopup } from './tools/downtime.js';
import { playTerminalIntro } from './Battelog/intro-terminal.js';
import { openBattleLogRecap } from './Battelog/recap.js';
import { handleRemoteDamageEvent, handleRemoteDamageUndoEvent } from './Battelog/damage-capture.js';
import { handleRemoteAttackEvent } from './Battelog/attack-capture.js';
import { handleRemoteStateEvent } from './Battelog/state-capture.js';

import {
    _buildStartRelatedFlow,
    checkOnMessageAutomations,
    deserializeTriggerData,
    serializeTriggerData,
    withReactorFunctions,
    getAutomationItems,
    makeSceneReactor,
} from './main.js';

const CHANNEL = 'module.lancer-automations';

/** @type {Map<string, (value?: unknown) => void>} requestId → resolve */
const _pendingFlowWaits = new Map();

const _pendingWaitInfo = new Map();

export async function socketRequestWithAck(action, payload, { timeoutMs = 5000 } = {})
{
    if (!hasExecutorGM())
    {
        console.warn(`lancer-automations | ${action} skipped, no GM online`);
        return undefined;
    }

    const requestId = `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    const ackPromise = new Promise((resolve) =>
    {
        _pendingFlowWaits.set(requestId, resolve);
        setTimeout(() =>
        {
            if (_pendingFlowWaits.has(requestId))
            {
                _pendingFlowWaits.delete(requestId);
                console.warn(`lancer-automations | ${action} GM ack timed out after ${timeoutMs}ms`);
                resolve();
            }
        }, timeoutMs);
    });

    game.socket.emit(CHANNEL, { action, payload: { ...payload, requestId } });
    return ackPromise;
}

export async function setTokenFlag(tokenDoc, ns, key, value)
{
    if (!tokenDoc)
        return;

    const resolvedDoc = tokenDoc.document ?? tokenDoc;

    if (game.user.isGM || resolvedDoc?.isOwner)
    {
        if (value === undefined)
        {
            await resolvedDoc.unsetFlag(ns, key).catch(() =>
            {});
        }
        else
            await resolvedDoc.setFlag(ns, key, value);
        return;
    }

    await socketRequestWithAck('setTokenFlag', {
        sceneId: resolvedDoc.parent?.id ?? canvas?.scene?.id,
        tokenId: resolvedDoc.id,
        ns,
        key,
        value,
    });
}

export async function unsetTokenFlag(tokenDoc, ns, key)
{
    return setTokenFlag(tokenDoc, ns, key, undefined);
}

export async function setActorFlag(actor, ns, key, value)
{
    if (!actor)
        return;

    if (game.user.isGM || actor.isOwner)
    {
        if (value === undefined)
        {
            await actor.unsetFlag(ns, key).catch(() =>
            {});
        }
        else
            await actor.setFlag(ns, key, value);
        return;
    }

    await socketRequestWithAck('setActorFlag', {
        actorId: actor.id,
        uuid: actor.uuid,
        ns,
        key,
        value,
    });
}

export async function unsetActorFlag(actor, ns, key)
{
    return setActorFlag(actor, ns, key, undefined);
}

export async function setItemFlag(item, ns, key, value)
{
    if (!item)
        return;

    const owner = item.parent ?? item;

    if (game.user.isGM || owner.isOwner)
    {
        if (value === undefined)
        {
            await item.unsetFlag(ns, key).catch(() =>
            {});
        }
        else
            await item.setFlag(ns, key, value);
        return;
    }

    await socketRequestWithAck('setItemFlag', {
        uuid: item.uuid,
        ns,
        key,
        value,
    });
}

export async function unsetItemFlag(item, ns, key)
{
    return setItemFlag(item, ns, key, undefined);
}

/**
 * Update any document, through the GM when the current user does not own it.
 * @param {any} doc
 * @param {object} data
 * @param {object} [options]
 * @returns {Promise<any>} The document
 */
export async function updateDocumentRouted(doc, data, options = {})
{
    if (!doc)
        return;
    if (game.user.isGM || doc.isOwner || !hasExecutorGM())
        return doc.update(data, options);
    await socketRequestWithAck('updateDocument', { uuid: doc.uuid, data, options });
    return doc;
}

/**
 * Delete any document, through the GM when the current user lacks the right to.
 * @param {any} doc
 * @param {object} [options]
 * @returns {Promise<void>}
 */
export async function deleteDocumentRouted(doc, options = {})
{
    if (!doc)
        return;

    if (game.user.isGM || doc.canUserModify?.(game.user, 'delete') || !hasExecutorGM())
    {
        await doc.delete(options);
        return;
    }

    await socketRequestWithAck('deleteDocument', { uuid: doc.uuid, options });
}

// GM-only Combat operations routed through the GM socket so owners of the
// combatant's actor can use them too (default Foundry permission is GM-only).
export async function activateCombatantSocket(combat, combatant)
{
    if (game.user.isGM)
        return combat.activateCombatant(combatant.id);
    return socketRequestWithAck('combatAction', {
        method: 'activateCombatant',
        combatId: combat.id,
        combatantId: combatant.id,
    });
}

export async function deactivateCombatantSocket(combat, combatant)
{
    if (game.user.isGM)
        return combat.deactivateCombatant(combatant.id);
    return socketRequestWithAck('combatAction', {
        method: 'deactivateCombatant',
        combatId: combat.id,
        combatantId: combatant.id,
    });
}

export async function modifyCombatantActivationsSocket(combat, combatant, delta)
{
    if (game.user.isGM)
        return /** @type {any} */ (combatant).modifyCurrentActivations(delta);
    return socketRequestWithAck('combatAction', {
        method: 'modifyCurrentActivations',
        combatId: combat.id,
        combatantId: combatant.id,
        delta,
    });
}

export function awaitPendingAck(requestId, { userId = null, fallback = undefined } = {})
{
    _pendingWaitInfo.set(requestId, { userId, fallback });
    return new Promise(resolve => _pendingFlowWaits.set(requestId, resolve));
}

function resolveAck(requestId, value)
{
    const resolve = _pendingFlowWaits.get(requestId);
    _pendingWaitInfo.delete(requestId);

    if (resolve)
    {
        _pendingFlowWaits.delete(requestId);
        resolve(value);
    }
}

export function cancelPendingAck(requestId)
{
    const info = _pendingWaitInfo.get(requestId);
    if (!info)
        return;

    if (info.userId)
        game.socket.emit(CHANNEL, { action: 'remoteRequestCancel', payload: { requestId, userId: info.userId } });
    resolveAck(requestId, info.fallback);
}

function releaseWaitsOf(user, connected)
{
    if (connected)
        return;

    for (const [requestId, info] of _pendingWaitInfo)
    {
        if (info.userId === user.id)
            resolveAck(requestId, info.fallback);
    }
}

function emitAck(action, requestId, extra = {})
{
    if (!requestId)
        return;
    game.socket.emit(CHANNEL, { action, payload: { requestId, ...extra } });
}

const knockbackOtherScene = ({ user, scene }) => localizeFormat('LA.notify.knockbackOtherScene', { user, scene });
const scanOtherScene = ({ user, scene }) => localizeFormat('LA.notify.scanOtherScene', { user, scene });

function requestFromOtherScene(payload, warning)
{
    if (!payload.sceneId || payload.sceneId === canvas.scene?.id)
        return false;

    ui.notifications.warn(warning({ user: payload.requestingUserName ?? '', scene: game.scenes.get(payload.sceneId)?.name ?? '' }));
    return true;
}

const AS_OWNER_FUNCTIONS = ['rollCard', 'chooseToken', 'placeZone', 'moveTokenRuler', 'boostMove', 'knockBackToken', 'attackWith', 'executeDamageRoll', 'executeItemActivation', 'executeSimpleActivation', 'executeStatRoll', 'activateGeneralAction', 'usePrepared'];

const packValue = (value) => serializeTriggerData({ v: value });
const unpackValue = (packed) => deserializeTriggerData(packed)?.v;
const withoutFlow = (result) => (result && typeof result === 'object' && 'flow' in result) ? { ...result, flow: undefined } : result;

/**
 * Interactive API calls run on the client that controls the token: its active player owner, else the active GM.
 * Local when the current user is that controller. Arguments and results cross as data: tokens, actors, items
 * and rolls are rebuilt, functions are dropped, a returned flow is not carried back.
 * @param {Token} token
 * @param {{ title?: string, description?: string, item?: any, relatedToken?: Token | null }} [wait] Wait card shown here while a remote call runs
 * @returns {Pick<LancerAutomationsAPI, 'rollCard' | 'chooseToken' | 'placeZone' | 'moveTokenRuler' | 'boostMove' | 'knockBackToken' | 'attackWith' | 'executeDamageRoll' | 'executeItemActivation' | 'executeSimpleActivation' | 'executeStatRoll' | 'activateGeneralAction' | 'usePrepared'>}
 */
export function asOwner(token, wait = null)
{
    return /** @type {any} */ (Object.fromEntries(AS_OWNER_FUNCTIONS.map(name => [name, (...args) => callAsOwner(token, name, args, wait)])));
}

async function callAsOwner(token, name, args, wait)
{
    const api = /** @type {any} */ (game.modules.get(MODULE_ID)).api;
    const ownerIds = getTokenOwnerUserId(token);
    const targetUserId = ownerIds.includes(game.user.id) ? null : (ownerIds[0] ?? null);

    if (!targetUserId)
        return api[name](...args);

    const requestId = `asOwner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const resultPromise = awaitPendingAck(requestId, { userId: targetUserId, fallback: null });
    game.socket.emit(CHANNEL, { action: 'asOwnerCall', payload: { userId: targetUserId, name, args: args.map(packValue), requestId } });

    const waitCard = wait
        ? startWaitCard({
            title: wait.title ?? 'WAITING',
            description: wait.description ?? '',
            waitMessage: localizeFormat('LA.reaction.waitingForUser', { name: game.users.get(targetUserId)?.name ?? localize('LA.reaction.remoteUser') }),
            item: wait.item ?? null,
            originToken: token,
            relatedToken: wait.relatedToken ?? null,
            onCancel: () => cancelPendingAck(requestId)
        })
        : null;

    try
    {
        return unpackValue(await resultPromise);
    }
    finally
    {
        waitCard?.remove();
    }
}

const HANDLERS = {

    autoFocus: handleRemoteFocus,
    diceFirst: handleRemoteDice,

    uplinkRollOpen: onUplinkRollOpen,
    uplinkRollSnapshot: onUplinkRollSnapshot,
    uplinkRollClose: onUplinkRollClose,

    floatTokenText: ({ tokenId, text, fill }) =>
    {
        const token = canvas.tokens.get(tokenId);
        if (token)
            floatTokenText(token, text, fill);
    },

    deferResistanceConsumption: receiveDeferredResistanceConsumption,

    showAutomationPopup: async ({ targetUserId, triggerType, reactions: automations }) =>
    {
        if (targetUserId && targetUserId !== game.userId)
            return;

        const reconstructed = [];

        for (const automation of automations)
        {
            const token = automation.tokenId === `scene:${canvas.scene?.id}`
                ? makeSceneReactor(canvas.scene)
                : canvas.tokens.get(automation.tokenId);

            if (!token)
                continue;

            const candidates = (automation.itemId || automation.itemLid) ? getAutomationItems(token) : [];
            const item = candidates.find(candidate => (automation.itemId ? candidate.id === automation.itemId : getItemLID(candidate) === automation.itemLid)) ?? null;
            const itemReactions = item ? AutomationManager.getAutomations(getItemLID(item))?.reactions : null;

            const resolved = automation.isGeneral
                ? AutomationManager.getGeneralAutomation(automation.reactionName)?.reactions?.[automation.subIndex]
                : itemReactions?.[automation.itemAutomationIndex ?? 0];

            const forFunctions = resolved ?? (automation.isGeneral ? AutomationManager.getGeneralAutomation(automation.reactionName) : itemReactions?.[0]);
            reconstructed.push({
                token,
                item,
                reactionName: automation.reactionName,
                itemName: automation.itemName,
                isGeneral: automation.isGeneral,
                reaction: resolved,
                triggerData: withReactorFunctions(deserializeTriggerData(automation.triggerData) ?? {}, token, item, forFunctions, automation.reactionName, triggerType),
            });
        }

        if (reconstructed.length > 0)
            displayAutomationPopup(triggerType, reconstructed);
    },

    showDowntimeSummary: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        openDowntimeSummary(payload.pilotName, payload.summaryContent, payload.journalTemplate, payload.requestingUserId);
    },

    showDowntimeJournalLink: async (payload) =>
    {
        if (game.user.id !== payload.requestingUserId)
            return;
        showDowntimeJournalPopup(payload.pageUuid, payload.pageName);
    },

    setActorFlag: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        const actor = payload.uuid ? await fromUuid(payload.uuid) : game.actors.get(payload.actorId);

        if (actor)
        {
            try
            {
                if (payload.value === undefined)
                    await actor.unsetFlag(payload.ns, payload.key);
                else
                    await actor.setFlag(payload.ns, payload.key, payload.value);
            }
            catch (e)
            {
                failed = true;
                console.warn('lancer-automations | setActorFlag GM-side failed:', e);
            }
        }

        emitAck('setActorFlagAck', payload.requestId, { failed });
    },
    setActorFlagAck: ({ requestId }) => resolveAck(requestId),

    setItemFlag: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const item = await fromUuid(payload.uuid);

            if (item)
            {
                if (payload.value === undefined)
                    await item.unsetFlag(payload.ns, payload.key);
                else
                    await item.setFlag(payload.ns, payload.key, payload.value);
            }
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | setItemFlag GM-side failed:', e);
        }

        emitAck('setItemFlagAck', payload.requestId, { failed });
    },
    setItemFlagAck: ({ requestId }) => resolveAck(requestId),

    updateDocument: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const doc = await fromUuid(payload.uuid);
            if (doc)
                await doc.update(payload.data, payload.options ?? {});
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | updateDocument GM-side failed:', e);
        }

        emitAck('updateDocumentAck', payload.requestId, { failed });
    },
    updateDocumentAck: ({ requestId }) => resolveAck(requestId),

    worldClockOp: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            await runWorldClockOp(payload.method, payload.args);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | worldClockOp GM-side failed:', e);
        }

        emitAck('worldClockOpAck', payload.requestId, { failed });
    },
    worldClockOpAck: ({ requestId }) => resolveAck(requestId),

    deleteDocument: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const doc = await fromUuid(payload.uuid);
            if (doc)
                await doc.delete(payload.options ?? {});
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | deleteDocument GM-side failed:', e);
        }

        emitAck('deleteDocumentAck', payload.requestId, { failed });
    },
    deleteDocumentAck: ({ requestId }) => resolveAck(requestId),

    updateAllEngagements: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        await /** @type {any} */ (game.modules.get(MODULE_ID)).api.updateAllEngagements(payload.options ?? {});
    },

    setTokenFlag: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        const scene = game.scenes.get(payload.sceneId) ?? canvas.scene;
        const tokenDoc = scene?.tokens.get(payload.tokenId);

        if (tokenDoc)
        {
            try
            {
                if (payload.value === undefined)
                    await tokenDoc.unsetFlag(payload.ns, payload.key);
                else
                    await tokenDoc.setFlag(payload.ns, payload.key, payload.value);
            }
            catch (e)
            {
                failed = true;
                console.warn('lancer-automations | setTokenFlag GM-side failed:', e);
            }
        }

        emitAck('setTokenFlagAck', payload.requestId, { failed });
    },
    setTokenFlagAck: ({ requestId }) => resolveAck(requestId),

    setEffect: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            await setEffect(payload.targetID, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions, payload.sceneId ?? null);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | setEffect GM-side failed:', e);
        }

        emitAck('setEffectAck', payload.requestId, { failed });
    },
    setFlaggedEffect: (payload) => HANDLERS.setEffect(payload),
    setEffectAck: ({ requestId }) => resolveAck(requestId),

    setEffectOnDoc: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const doc = await fromUuid(payload.docUuid);
            if (doc)
                await setEffectOnDoc(doc, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | setEffectOnDoc GM-side failed:', e);
        }

        emitAck('setEffectOnDocAck', payload.requestId, { failed });
    },
    setEffectOnDocAck: ({ requestId }) => resolveAck(requestId),

    removeEffectFromDoc: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        try
        {
            const doc = await fromUuid(payload.docUuid);
            if (doc)
                await doc.deleteEmbeddedDocuments("ActiveEffect", [payload.effectID]);
        }
        catch (e)
        {
            console.warn('lancer-automations | removeEffectFromDoc GM-side failed:', e);
        }
    },

    removeEffect: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            await removeEffectsByName(payload.targetID, payload.effect, payload.originID, payload.extraFlags ?? null, payload.sceneId ?? null);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | removeEffect GM-side failed:', e);
        }

        emitAck('removeEffectAck', payload.requestId, { failed });
    },
    removeFlaggedEffect: (payload) => HANDLERS.removeEffect(payload),
    removeEffectAck: ({ requestId }) => resolveAck(requestId),

    removeEffectById: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        const target = resolveEffectTarget(payload.targetID, payload.sceneId ?? null);

        if (target?.actor)
        {
            try
            {
                await target.actor.deleteEmbeddedDocuments('ActiveEffect', [payload.effectID]);
            }
            catch (e)
            {
                failed = true;
                console.warn('lancer-automations | removeEffectById GM-side failed:', e);
            }
        }

        emitAck('removeEffectByIdAck', payload.requestId, { failed });
    },
    removeEffectByIdAck: ({ requestId }) => resolveAck(requestId),

    consumeEffectCharge: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const effect = await fromUuid(payload.effectUuid);
            if (effect)
                await consumeEffectCharge(effect);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | consumeEffectCharge GM-side failed:', e);
        }

        emitAck('consumeEffectChargeAck', payload.requestId, { failed });
    },
    consumeEffectChargeAck: ({ requestId }) => resolveAck(requestId),

    preLoadImageForAll: async (payload) =>
    {
        if (payload)
            await preLoadImageForAll(payload);
    },

    moveTokens: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        if (requestFromOtherScene(payload, knockbackOtherScene))
            return;

        const trigToken = payload.triggeringTokenId ? canvas.tokens.get(payload.triggeringTokenId) : null;

        const knockbackItem = (payload.itemUuid ? fromUuidSync(payload.itemUuid) : null) ?? (payload.itemId
            ? canvas.tokens.placeables.find(placeable => placeable.actor?.items?.get(payload.itemId))?.actor?.items?.get(payload.itemId) ?? null
            : null);

        applyKnockbackMoves(payload.moves, trigToken, payload.distance, payload.actionName || '', knockbackItem, { asVoluntary: !!payload.asVoluntary });
    },

    createTokens: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        let tokenIds = [];

        try
        {
            const scene = game.scenes.get(payload.sceneId) || canvas.scene;
            const created = await scene.createEmbeddedDocuments('Token', payload.tokenDataArray);

            tokenIds = created.map(doc => doc.id);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | createTokens GM-side failed:', e);
        }

        emitAck('createTokensResponse', payload.requestId, { tokenIds, failed });
    },
    createTokensResponse: ({ requestId, tokenIds }) => resolveAck(requestId, tokenIds ?? []),

    createDeployableActor: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        let uuid = null;

        try
        {
            const actor = await createActorInDeployableFolder(payload.actorData, payload.ownerFolderId ?? null);
            uuid = actor?.uuid ?? null;
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | createDeployableActor GM-side failed:', e);
        }

        emitAck('createDeployableActorAck', payload.requestId, { uuid, failed });
    },
    createDeployableActorAck: ({ requestId, uuid }) => resolveAck(requestId, uuid ?? null),

    pickupWeapon: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;

        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();

        const ownerActor = /** @type {any} */ (await fromUuid(payload.ownerActorUuid));

        if (ownerActor)
        {
            const weapon = ownerActor.items.get(payload.weaponId);
            if (weapon)
                await weapon.update(/** @type {any} */ ({ 'system.disabled': false }));
        }
    },

    recallDeployable: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;

        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();
    },

    scanInfoRequest: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        if (requestFromOtherScene(payload, scanOtherScene))
            return;

        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        await performGMInputScan([target], payload.scanTitle, payload.requestingUserName);
    },

    scanSystemOptionsRequest: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        if (requestFromOtherScene(payload, scanOtherScene))
            return;

        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        ui.notifications.info(localizeFormat('LA.notify.scanRequestedBy', { user: payload.requestingUserName, target: payload.targetName }));
        await showSystemScanDialog([target]);
    },

    scanSystemJournalRequest: async (payload) =>
    {
        if (!isExecutorGM())
            return;
        if (requestFromOtherScene(payload, scanOtherScene))
            return;

        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        new Dialog({
            title: localize('LA.dialogTitle.journalEntryRequest'),
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
                        <input type="text" id="custom-journal-name" name="custom-journal-name" value="${payload.customName || ''}" placeholder="${localize('LA.socket.journalNamePlaceholder')}" style="width: 100%; padding: 8px; font-size: 14px; border: 2px solid #999; border-radius: 4px;" />
                    </div>
                </form>
            `,
            buttons: {
                yes: {
                    icon: '<i class="fas fa-check"></i>',
                    label: localize('LA.socket.createJournalEntry'),
                    callback: async (html) =>
                    {
                        const customName = String(/** @type {any} */ (html).find('[name="custom-journal-name"]').val()).trim();
                        await performSystemScan(target, true, customName, payload.ownership ?? null);
                        ui.notifications.info(localizeFormat('LA.notify.journalCreatedFor', { target: payload.targetName }));
                    },
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: localize('LA.common.decline'),
                    callback: () => ui.notifications.info(localize('LA.notify.journalEntryRequestDeclined')),
                },
            },
            default: 'yes',
        }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 450 }).render(true);
    },

    choiceCardGMRequest: async (payload) =>
    {
        if (payload.targetUserId !== game.user.id)
            return;

        let gmTrace = null;

        if (payload.traceData)
        {
            const { tokenId, endPos, newEndPos, path, newPath } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);

            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos, { suppressBroadcast: true, path, newPath });
        }

        await showUserIdControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    },

    choiceCardBroadcastRequest: async (payload) =>
    {
        if (!payload.allTargetUserIds?.includes(game.user.id))
            return;

        let gmTrace = null;

        if (payload.traceData)
        {
            const { tokenId, endPos, newEndPos, path, newPath } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);

            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos, { suppressBroadcast: true, path, newPath });
        }

        await showMultiUserControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    },

    choiceCardBroadcastCancel: (payload) =>
    {
        if (!payload.otherTargetUserIds?.includes(game.user.id))
            return;
        cancelBroadcastChoiceCard(payload.cardId, payload.responderName, payload.isCancellation);
    },

    choiceCardGMResponse: (payload) =>
    {
        if (payload.requestingUserId !== game.user.id)
            return;
        resolveGMChoiceCard(payload.cardId, payload.choiceIdx, payload.responderName, payload.responderUserId);
    },

    updateActorSystem: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        const tokenDoc = payload.tokenUuid ? await fromUuid(payload.tokenUuid) : null;
        const actor = tokenDoc?.actor ?? game.actors.get(payload.actorId);

        let failed = false;

        try
        {
            if (actor)
                await actor.update(payload.data);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | updateActorSystem GM-side failed:', e);
        }

        emitAck('updateActorSystemAck', payload.requestId, { failed });
    },
    updateActorSystemAck: ({ requestId }) => resolveAck(requestId),

    createActorEffects: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const parent = await fromUuid(payload.uuid);
            if (parent?.createEmbeddedDocuments && payload.effects?.length)
                await parent.createEmbeddedDocuments('ActiveEffect', payload.effects);
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | createActorEffects GM-side failed:', e);
        }

        emitAck('createActorEffectsAck', payload.requestId, { failed });
    },
    createActorEffectsAck: ({ requestId }) => resolveAck(requestId),

    combatAction: async (payload) =>
    {
        if (!isExecutorGM())
            return;

        let failed = false;

        try
        {
            const combat = game.combats.get(payload.combatId);

            if (combat)
            {
                if (payload.method === 'activateCombatant')
                    await combat.activateCombatant(payload.combatantId);
                else if (payload.method === 'deactivateCombatant')
                    await /** @type {any} */ (combat).deactivateCombatant(payload.combatantId);
                else if (payload.method === 'modifyCurrentActivations')
                {
                    const combatant = combat.combatants.get(payload.combatantId);
                    if (combatant)
                        await /** @type {any} */ (combatant).modifyCurrentActivations(payload.delta);
                }
                else if (payload.method === 'tapeOp')
                {
                    const combatant = combat.combatants.get(payload.combatantId);
                    if (combatant)
                        await applyTapeOp(combatant, payload.op);
                }
            }
        }
        catch (e)
        {
            failed = true;
            console.warn('lancer-automations | combatAction GM-side failed:', e);
        }

        emitAck('combatActionAck', payload.requestId, { failed });
    },
    combatActionAck: ({ requestId }) => resolveAck(requestId),

    voteCardRequest: (payload) =>
    {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        showVoteCardOnVoter(payload);
    },
    voteCardSubmit: (payload) =>
    {
        if (payload.requestingUserId !== game.user.id)
            return;
        receiveVoteSubmission(payload);
    },
    voteCardUpdate: (payload) =>
    {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        updateVoteCardOnVoter(payload);
    },
    voteCardConfirm: (payload) =>
    {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        confirmVoteCardOnVoter(payload);
    },
    voteCardCancel: (payload) =>
    {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        cancelVoteCardOnVoter(payload);
    },

    onMessage: (payload) =>
    {
        if (payload.userId && payload.userId !== game.userId)
            return;

        const msgToken = canvas.tokens.get(payload.reactorTokenId);
        if (!msgToken)
            return emitAck('onMessageDone', payload.requestId, { returnData: null });
        checkOnMessageAutomations(msgToken, payload.itemLid ?? null, payload.reactionPath ?? null, payload.activationName ?? null, payload.triggerType, deserializeTriggerData(payload.data) ?? {})
            .then((returnData) => emitAck('onMessageDone', payload.requestId, { returnData: returnData ?? null }))
            .catch((error) =>
            {
                console.error('lancer-automations | onMessage socket error:', error);
                emitAck('onMessageDone', payload.requestId, { returnData: null });
            });
    },
    onMessageDone: ({ requestId, returnData }) => resolveAck(requestId, returnData ?? null),

    startRelatedFlow: (payload) =>
    {
        if (payload.userId && payload.userId !== game.user.id)
            return;

        const flowToken = canvas.tokens.get(payload.reactorTokenId);
        if (!flowToken)
            return emitAck('startRelatedFlowDone', payload.requestId);

        const flowItem = payload.itemLid
            ? getAutomationItems(flowToken).find(i => getItemLID(i) === payload.itemLid) ?? null
            : null;

        const fakeAutomation = {
            reactionPath: payload.reactionPath,
            actionType: payload.actionType,
            checkReaction: payload.checkReaction,
            effectDescription: payload.effectDescription,
        };

        _buildStartRelatedFlow(flowToken, flowItem, fakeAutomation, payload.activationName, payload.extraData ?? {})()
            .catch((e) => console.error('lancer-automations | startRelatedFlow socket error:', e))
            .finally(() => emitAck('startRelatedFlowDone', payload.requestId));
    },
    startRelatedFlowDone: ({ requestId }) => resolveAck(requestId),

    asOwnerCall: (payload) =>
    {
        if (payload.userId !== game.user.id)
            return;

        const api = /** @type {any} */ (game.modules.get(MODULE_ID)).api;
        const run = AS_OWNER_FUNCTIONS.includes(payload.name) ? api?.[payload.name] : null;
        const args = (payload.args ?? []).map(unpackValue);
        Promise.resolve()
            .then(() => (run ? run(...args) : null))
            .then((result) => emitAck('asOwnerDone', payload.requestId, { result: packValue(withoutFlow(result)) }))
            .catch((error) =>
            {
                console.error(`lancer-automations | asOwner ${payload.name} failed:`, error);
                emitAck('asOwnerDone', payload.requestId, { result: null });
            });
    },
    asOwnerDone: ({ requestId, result }) => resolveAck(requestId, result ?? null),

    statRollRequest: (payload) =>
    {
        if (payload.targetUserId !== game.user.id)
            return;
        void (async () =>
        {
            let result = { completed: false };

            try
            {
                const rollActor = /** @type {any} */ (await fromUuid(payload.actorUuid));
                if (!rollActor)
                    return;

                const rollToken = rollActor.token?.object ?? rollActor.getActiveTokens()?.[0];
                const upperStat = payload.stat.toUpperCase();

                const cardResult = await startChoiceCard({
                    title: payload.cardTitle || payload.title,
                    description: payload.cardDescription || `<b>${rollToken?.name ?? rollActor.name}</b> must roll a ${upperStat} save.`,
                    relatedToken: rollToken,
                    choices: [{ text: `Roll ${upperStat} Save`, icon: 'fas fa-dice' }],
                    cancelKey: payload.requestId,
                });

                if (cardResult?.choiceIdx === 0)
                    result = await executeStatRoll(rollActor, payload.stat, payload.title, payload.targetVal ?? 10, payload.extraData ?? {});
            }
            catch (error)
            {
                console.error('lancer-automations | statRollRequest error:', error);
            }
            finally
            {
                emitAck('statRollResponse', payload.requestId, { result });
            }
        })();
    },
    statRollResponse: ({ requestId, result }) => resolveAck(requestId, result ?? { completed: false }),

    remoteRequestCancel: ({ requestId, userId }) =>
    {
        if (userId === game.user.id)
            cancelChoiceCardByKey(requestId);
    },

    toolPresence: (payload) => onRemotePresence(payload),
    toolPresenceClear: (payload) => onRemotePresenceClear(payload),
    reactionCue: (payload) => onRemoteReactionCue(payload),

    sightlines: (payload) => onRemoteSightlines(payload),
    sightlinesClear: (payload) => onRemoteSightlinesClear(payload),

    // Foundry doesn't echo socket emits to sender, so GM playback is triggered locally in gm-card.
    battleLogPlayIntro: ({ outcome, battle, mvpId, extraLines }) =>
    {
        if (game.user.isGM)
            return;
        playTerminalIntro({ outcome, battle, mvpId, extraLines })
            .then(() => openBattleLogRecap(battle, { outcome, mvpId }));
    },

    // Non-GM client wraps damageCalc on its own actor; relays here for the GM to log.
    battleLogDamage: (payload) =>
    {
        handleRemoteDamageEvent(payload);
    },
    // Non-GM client sees an attack fire; relays here for the GM to log.
    battleLogAttack: (payload) =>
    {
        handleRemoteAttackEvent(payload);
    },
    // Non-GM client clicks the Undo button on a damage card; relays here for the GM to log.
    battleLogDamageUndo: (payload) =>
    {
        handleRemoteDamageUndoEvent(payload);
    },
    // Generic battle-log event from a non-GM client (structure, stress, move, action, death).
    battleLogEvent: (payload) =>
    {
        handleRemoteStateEvent(payload);
    },
};

async function dispatchSocketEvent({ action, payload })
{
    const handler = /** @type {any} */ (HANDLERS)[action];
    if (!handler)
        return;

    if (payload?.failed && payload.requestId && _pendingFlowWaits.has(payload.requestId))
        ui.notifications.warn(localize('LA.notify.gmRequestFailed'));

    try
    {
        await handler(payload ?? {});
    }
    catch (e)
    {
        console.error(`lancer-automations | socket handler '${action}' failed:`, e);
    }
}

export function initSocket()
{
    game.socket.on(CHANNEL, dispatchSocketEvent);
    Hooks.on('userConnected', releaseWaitsOf);
}
