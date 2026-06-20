/* global game, canvas, fromUuid, ui, Dialog, HTMLVideoElement */

import { displayReactionPopup, closeReactionPopupFromRemote } from './activations/reactions-ui.js';
import {
    applyKnockbackMoves, startChoiceCard,
    showUserIdControlledChoiceCard, resolveGMChoiceCard,
    showMultiUserControlledChoiceCard, cancelBroadcastChoiceCard,
    drawMovementTrace,
    showVoteCardOnVoter, receiveVoteSubmission,
    updateVoteCardOnVoter, confirmVoteCardOnVoter, cancelVoteCardOnVoter,
} from './interactive/index.js';
import { setEffect, removeEffectsByName, consumeEffectCharge } from './bonuses/flagged-effects.js';
import { performGMInputScan, performSystemScan } from './tools/scan.js';
import { preLoadImageForAll } from './tools/wreck.js';
import { executeStatRoll, getItemLID } from './tools/misc-tools.js';

import {
    _buildStartRelatedFlow,
    checkOnMessageReactions,
    deserializeTriggerData,
    getReactionItems,
} from './main.js';

const CHANNEL = 'module.lancer-automations';

/** @type {Map<string, (value?: unknown) => void>} requestId → resolve */
const _pendingFlowWaits = new Map();

export async function socketRequestWithAck(action, payload, { timeoutMs = 5000 } = {}) {
    const requestId = `${action}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const ackPromise = new Promise((resolve) => {
        _pendingFlowWaits.set(requestId, resolve);
        setTimeout(() => {
            if (_pendingFlowWaits.has(requestId)) {
                _pendingFlowWaits.delete(requestId);
                console.warn(`lancer-automations | ${action} GM ack timed out after ${timeoutMs}ms`);
                resolve();
            }
        }, timeoutMs);
    });
    game.socket.emit(CHANNEL, { action, payload: { ...payload, requestId } });
    return ackPromise;
}

export async function setTokenFlag(tokenDoc, ns, key, value) {
    if (!tokenDoc)
        return;
    const td = tokenDoc.document ?? tokenDoc;
    if (game.user.isGM || td?.isOwner) {
        if (value === undefined)
            await td.unsetFlag(ns, key).catch(() => {});
        else
            await td.setFlag(ns, key, value);
        return;
    }
    await socketRequestWithAck('setTokenFlag', {
        sceneId: td.parent?.id ?? canvas?.scene?.id,
        tokenId: td.id,
        ns,
        key,
        value,
    });
}

export async function unsetTokenFlag(tokenDoc, ns, key) {
    return setTokenFlag(tokenDoc, ns, key, undefined);
}

export async function setActorFlag(actor, ns, key, value) {
    if (!actor)
        return;
    if (game.user.isGM || actor.isOwner) {
        if (value === undefined)
            await actor.unsetFlag(ns, key).catch(() => {});
        else
            await actor.setFlag(ns, key, value);
        return;
    }
    await socketRequestWithAck('setActorFlag', {
        actorId: actor.id,
        ns,
        key,
        value,
    });
}

export async function unsetActorFlag(actor, ns, key) {
    return setActorFlag(actor, ns, key, undefined);
}

export async function setItemFlag(item, ns, key, value) {
    if (!item)
        return;
    const owner = item.parent ?? item;
    if (game.user.isGM || owner.isOwner) {
        if (value === undefined)
            await item.unsetFlag(ns, key).catch(() => {});
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

export async function unsetItemFlag(item, ns, key) {
    return setItemFlag(item, ns, key, undefined);
}

// GM-only Combat operations routed through the GM socket so owners of the
// combatant's actor can use them too (default Foundry permission is GM-only).
export async function activateCombatantSocket(combat, combatant) {
    if (game.user.isGM)
        return combat.activateCombatant(combatant.id);
    return socketRequestWithAck('combatAction', {
        method: 'activateCombatant',
        combatId: combat.id,
        combatantId: combatant.id,
    });
}

export async function deactivateCombatantSocket(combat, combatant) {
    if (game.user.isGM)
        return combat.deactivateCombatant(combatant.id);
    return socketRequestWithAck('combatAction', {
        method: 'deactivateCombatant',
        combatId: combat.id,
        combatantId: combatant.id,
    });
}

export async function modifyCombatantActivationsSocket(combat, combatant, delta) {
    if (game.user.isGM)
        return /** @type {any} */ (combatant).modifyCurrentActivations(delta);
    return socketRequestWithAck('combatAction', {
        method: 'modifyCurrentActivations',
        combatId: combat.id,
        combatantId: combatant.id,
        delta,
    });
}

/** Returns a Promise that resolves when an ack arrives for the given requestId. */
export function awaitPendingAck(requestId) {
    return new Promise(resolve => _pendingFlowWaits.set(requestId, resolve));
}

function resolveAck(requestId, value) {
    const resolve = _pendingFlowWaits.get(requestId);
    if (resolve) {
        _pendingFlowWaits.delete(requestId);
        resolve(value);
    }
}

function emitAck(action, requestId, extra = {}) {
    if (!requestId)
        return;
    game.socket.emit(CHANNEL, { action, payload: { requestId, ...extra } });
}

const HANDLERS = {

    showReactionPopup: async ({ targetUserId, triggerType, reactions }) => {
        if (targetUserId && targetUserId !== game.userId)
            return;
        const reconstructed = [];
        for (const r of reactions) {
            const token = canvas.tokens.get(r.tokenId);
            if (!token)
                continue;
            const item = r.itemId ? token.actor?.items.get(r.itemId) ?? null : null;
            reconstructed.push({
                token,
                item,
                reactionName: r.reactionName,
                itemName: r.itemName,
                isGeneral: r.isGeneral,
                triggerData: deserializeTriggerData(r.triggerData),
            });
        }
        if (reconstructed.length > 0)
            displayReactionPopup(triggerType, reconstructed);
    },

    closeReactionPopup: async () => {
        closeReactionPopupFromRemote();
    },

    setActorFlag: async (payload) => {
        if (!game.user.isGM)
            return;
        const actor = game.actors.get(payload.actorId);
        if (actor) {
            try {
                if (payload.value === undefined)
                    await actor.unsetFlag(payload.ns, payload.key);
                else
                    await actor.setFlag(payload.ns, payload.key, payload.value);
            } catch (e) {
                console.warn('lancer-automations | setActorFlag GM-side failed:', e);
            }
        }
        emitAck('setActorFlagAck', payload.requestId);
    },
    setActorFlagAck: ({ requestId }) => resolveAck(requestId),

    setItemFlag: async (payload) => {
        if (!game.user.isGM)
            return;
        try {
            const item = await fromUuid(payload.uuid);
            if (item) {
                if (payload.value === undefined)
                    await item.unsetFlag(payload.ns, payload.key);
                else
                    await item.setFlag(payload.ns, payload.key, payload.value);
            }
        } catch (e) {
            console.warn('lancer-automations | setItemFlag GM-side failed:', e);
        }
        emitAck('setItemFlagAck', payload.requestId);
    },
    setItemFlagAck: ({ requestId }) => resolveAck(requestId),

    setTokenFlag: async (payload) => {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) ?? canvas.scene;
        const tokenDoc = scene?.tokens.get(payload.tokenId);
        if (tokenDoc) {
            try {
                if (payload.value === undefined)
                    await tokenDoc.unsetFlag(payload.ns, payload.key);
                else
                    await tokenDoc.setFlag(payload.ns, payload.key, payload.value);
            } catch (e) {
                console.warn('lancer-automations | setTokenFlag GM-side failed:', e);
            }
        }
        emitAck('setTokenFlagAck', payload.requestId);
    },
    setTokenFlagAck: ({ requestId }) => resolveAck(requestId),

    setEffect: async (payload) => {
        if (!game.user.isGM)
            return;
        try {
            await setEffect(payload.targetID, payload.effect, payload.duration, payload.note, payload.originID, payload.extraOptions);
        } catch (e) {
            console.warn('lancer-automations | setEffect GM-side failed:', e);
        }
        emitAck('setEffectAck', payload.requestId);
    },
    setFlaggedEffect: (payload) => HANDLERS.setEffect(payload),
    setEffectAck: ({ requestId }) => resolveAck(requestId),

    removeEffect: async (payload) => {
        if (!game.user.isGM)
            return;
        try {
            await removeEffectsByName(payload.targetID, payload.effect, payload.originID, payload.extraFlags ?? null);
        } catch (e) {
            console.warn('lancer-automations | removeEffect GM-side failed:', e);
        }
        emitAck('removeEffectAck', payload.requestId);
    },
    removeFlaggedEffect: (payload) => HANDLERS.removeEffect(payload),
    removeEffectAck: ({ requestId }) => resolveAck(requestId),

    removeEffectById: async (payload) => {
        if (!game.user.isGM)
            return;
        const target = canvas.tokens.get(payload.targetID);
        if (target?.actor) {
            try {
                await target.actor.deleteEmbeddedDocuments('ActiveEffect', [payload.effectID]);
            } catch (e) {
                console.warn('lancer-automations | removeEffectById GM-side failed:', e);
            }
        }
        emitAck('removeEffectByIdAck', payload.requestId);
    },
    removeEffectByIdAck: ({ requestId }) => resolveAck(requestId),

    consumeEffectCharge: async (payload) => {
        if (!game.user.isGM)
            return;
        try {
            const effect = await fromUuid(payload.effectUuid);
            if (effect)
                await consumeEffectCharge(effect);
        } catch (e) {
            console.warn('lancer-automations | consumeEffectCharge GM-side failed:', e);
        }
        emitAck('consumeEffectChargeAck', payload.requestId);
    },
    consumeEffectChargeAck: ({ requestId }) => resolveAck(requestId),

    preLoadImageForAll: async (payload) => {
        if (payload)
            await preLoadImageForAll(payload);
    },

    moveTokens: async (payload) => {
        if (!game.user.isGM)
            return;
        const trigToken = payload.triggeringTokenId ? canvas.tokens.get(payload.triggeringTokenId) : null;
        const kbItem = payload.itemId
            ? canvas.tokens.placeables.find(t => t.actor?.items?.get(payload.itemId))?.actor?.items?.get(payload.itemId) ?? null
            : null;
        applyKnockbackMoves(payload.moves, trigToken, payload.distance, payload.actionName || '', kbItem, { asVoluntary: !!payload.asVoluntary });
    },

    createTokens: async (payload) => {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        const created = await scene.createEmbeddedDocuments('Token', payload.tokenDataArray);
        const tokenIds = created.map(d => d.id);
        emitAck('createTokensResponse', payload.requestId, { tokenIds });
    },

    pickupWeapon: async (payload) => {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;
        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();
        const ownerActor = /** @type {any} */ (await fromUuid(payload.ownerActorUuid));
        if (ownerActor) {
            const weapon = ownerActor.items.get(payload.weaponId);
            if (weapon)
                await weapon.update(/** @type {any} */ ({ 'system.disabled': false }));
        }
    },

    recallDeployable: async (payload) => {
        if (!game.user.isGM)
            return;
        const scene = game.scenes.get(payload.sceneId) || canvas.scene;
        if (!scene)
            return;
        const token = scene.tokens.get(payload.tokenId);
        if (token)
            await token.delete();
    },

    scanInfoRequest: async (payload) => {
        if (!game.user.isGM)
            return;
        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        await performGMInputScan([target], payload.scanTitle, payload.requestingUserName);
    },

    scanSystemJournalRequest: async (payload) => {
        if (!game.user.isGM)
            return;
        const target = canvas.tokens.get(payload.targetId);
        if (!target)
            return;
        new Dialog({
            title: 'Journal Entry Request',
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
                    label: 'Create Journal Entry',
                    callback: async (html) => {
                        const customName = String(/** @type {any} */ (html).find('[name="custom-journal-name"]').val()).trim();
                        await performSystemScan(target, true, customName, payload.ownership ?? null);
                        ui.notifications.info(`Journal entry created for ${payload.targetName}`);
                    },
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Decline',
                    callback: () => ui.notifications.info('Journal entry request declined'),
                },
            },
            default: 'yes',
        }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 450 }).render(true);
    },

    choiceCardGMRequest: async (payload) => {
        if (payload.targetUserId !== game.user.id)
            return;
        let gmTrace = null;
        if (payload.traceData) {
            const { tokenId, endPos, newEndPos } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);
            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos);
        }
        await showUserIdControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    },

    choiceCardBroadcastRequest: async (payload) => {
        if (!payload.allTargetUserIds?.includes(game.user.id))
            return;
        let gmTrace = null;
        if (payload.traceData) {
            const { tokenId, endPos, newEndPos } = payload.traceData;
            const traceToken = canvas.tokens.get(tokenId);
            if (traceToken)
                gmTrace = drawMovementTrace(traceToken, endPos, newEndPos);
        }
        await showMultiUserControlledChoiceCard(payload);
        if (gmTrace?.parent)
            gmTrace.parent.removeChild(gmTrace);
        if (gmTrace)
            gmTrace.destroy();
    },

    choiceCardBroadcastCancel: (payload) => {
        if (!payload.otherTargetUserIds?.includes(game.user.id))
            return;
        cancelBroadcastChoiceCard(payload.cardId, payload.responderName, payload.isCancellation);
    },

    choiceCardGMResponse: (payload) => {
        if (payload.requestingUserId !== game.user.id)
            return;
        resolveGMChoiceCard(payload.cardId, payload.choiceIdx, payload.responderName, payload.responderUserId);
    },

    updateActorSystem: async (payload) => {
        if (!game.user.isGM)
            return;
        const actor = game.actors.get(payload.actorId);
        if (actor)
            await actor.update(payload.data);
        emitAck('updateActorSystemAck', payload.requestId);
    },
    updateActorSystemAck: ({ requestId }) => resolveAck(requestId),

    combatAction: async (payload) => {
        if (!game.user.isGM)
            return;
        try {
            const combat = game.combats.get(payload.combatId);
            if (combat) {
                if (payload.method === 'activateCombatant') {
                    await combat.activateCombatant(payload.combatantId);
                } else if (payload.method === 'deactivateCombatant') {
                    await /** @type {any} */ (combat).deactivateCombatant(payload.combatantId);
                } else if (payload.method === 'modifyCurrentActivations') {
                    const combatant = combat.combatants.get(payload.combatantId);
                    if (combatant)
                        await /** @type {any} */ (combatant).modifyCurrentActivations(payload.delta);
                }
            }
        } catch (e) {
            console.warn('lancer-automations | combatAction GM-side failed:', e);
        }
        emitAck('combatActionAck', payload.requestId);
    },
    combatActionAck: ({ requestId }) => resolveAck(requestId),

    voteCardRequest: (payload) => {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        showVoteCardOnVoter(payload);
    },
    voteCardSubmit: (payload) => {
        if (payload.requestingUserId !== game.user.id)
            return;
        receiveVoteSubmission(payload);
    },
    voteCardUpdate: (payload) => {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        updateVoteCardOnVoter(payload);
    },
    voteCardConfirm: (payload) => {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        confirmVoteCardOnVoter(payload);
    },
    voteCardCancel: (payload) => {
        if (!payload.allVoterUserIds?.includes(game.user.id))
            return;
        cancelVoteCardOnVoter(payload);
    },

    onMessage: (payload) => {
        if (payload.userId && payload.userId !== game.userId)
            return;
        const msgToken = canvas.tokens.get(payload.reactorTokenId);
        if (!msgToken)
            return;
        checkOnMessageReactions(msgToken, payload.itemLid ?? null, payload.reactionPath ?? null, payload.activationName ?? null, payload.triggerType, payload.data ?? {})
            .then((returnData) => emitAck('onMessageDone', payload.requestId, { returnData: returnData ?? null }))
            .catch((e) => console.error('lancer-automations | onMessage socket error:', e));
    },
    onMessageDone: ({ requestId, returnData }) => resolveAck(requestId, returnData ?? null),

    startRelatedFlow: (payload) => {
        if (payload.userId && payload.userId !== game.user.id)
            return;
        const flowToken = canvas.tokens.get(payload.reactorTokenId);
        if (!flowToken)
            return;
        const flowItem = payload.itemLid
            ? getReactionItems(flowToken).find(i => getItemLID(i) === payload.itemLid) ?? null
            : null;
        const fakeReaction = {
            reactionPath: payload.reactionPath,
            actionType: payload.actionType,
            effectDescription: payload.effectDescription,
        };
        _buildStartRelatedFlow(flowToken, flowItem, fakeReaction, payload.activationName, payload.extraData ?? {})()
            .catch((e) => console.error('lancer-automations | startRelatedFlow socket error:', e))
            .finally(() => emitAck('startRelatedFlowDone', payload.requestId));
    },
    startRelatedFlowDone: ({ requestId }) => resolveAck(requestId),

    statRollRequest: (payload) => {
        if (payload.targetUserId !== game.user.id)
            return;
        (async () => {
            const rollActor = /** @type {any} */ (await fromUuid(payload.actorUuid));
            if (!rollActor) {
                emitAck('statRollResponse', payload.requestId, { result: { completed: false } });
                return;
            }
            const rollToken = rollActor.token?.object ?? rollActor.getActiveTokens()?.[0];
            const upperStat = payload.stat.toUpperCase();
            const cardResult = await startChoiceCard({
                title: payload.cardTitle || payload.title,
                description: payload.cardDescription || `<b>${rollToken?.name ?? rollActor.name}</b> must roll a ${upperStat} save.`,
                relatedToken: rollToken,
                choices: [{ text: `Roll ${upperStat} Save`, icon: 'fas fa-dice' }],
            });
            let result = { completed: false };
            if (cardResult?.choiceIdx === 0)
                result = await executeStatRoll(rollActor, payload.stat, payload.title, payload.targetVal ?? 10, payload.extraData ?? {});
            emitAck('statRollResponse', payload.requestId, { result });
        })().catch((e) => console.error('lancer-automations | statRollRequest error:', e));
    },
    statRollResponse: ({ requestId, result }) => resolveAck(requestId, result ?? { completed: false }),

    syncPlaceholderVideos: ({ placeholderIds }) => {
        setTimeout(() => {
            for (const tokenId of placeholderIds) {
                const token = canvas.tokens.get(tokenId);
                const video = token?.mesh?.texture?.baseTexture?.resource?.['source'];
                if (video instanceof HTMLVideoElement) {
                    video.currentTime = 0;
                    video.play().catch(() => {});
                }
            }
        }, 200);
    },
};

async function dispatchSocketEvent({ action, payload }) {
    const handler = /** @type {any} */ (HANDLERS)[action];
    if (!handler)
        return;
    try {
        await handler(payload ?? {});
    } catch (e) {
        console.error(`lancer-automations | socket handler '${action}' failed:`, e);
    }
}

export function initSocket() {
    game.socket.on(CHANNEL, dispatchSocketEvent);
}
