/* global canvas, PIXI, game, ui, $, fromUuidSync */

import {
    _queueCard, _createInfoCard, _updateInfoCard, _removeInfoCard,
    _updatePendingBadge, _runCardCallback
} from "./cards.js";

import { drawMovementTrace } from "./canvas.js";
import { laDetailPopup, laRenderTextSection, laRenderActions, laRenderTags } from "./detail-renderers.js";

// --- GM-controlled choice cards ---
export const _pendingGMChoices = new Map(); // cardId → { resolve, cardEl, choices, mode }

/**
 * Inserts a compact item chip into a choice card and binds a detail popup on click.
 * @param {JQuery} cardEl
 * @param {any} item  Foundry Item document
 */
function _bindItemChip(cardEl, item) {
    if (!item) return;
    const img = item.img || '';
    const name = item.name || '';
    const chipHtml = `
        <div data-role="item-chip" style="display:flex;align-items:center;gap:6px;padding:4px 8px;margin-bottom:6px;background:rgba(255,255,255,0.04);border:1px solid #333;border-radius:3px;cursor:pointer;">
            ${img ? `<img src="${img}" style="width:22px;height:22px;object-fit:contain;border:none;flex-shrink:0;">` : ''}
            <span style="font-size:0.82em;color:#888;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</span>
            <i class="fas fa-info-circle" style="color:#666;font-size:0.75em;flex-shrink:0;"></i>
        </div>`;
    const sectionHeader = cardEl.find('.la-info-card-body .la-section-header').first();
    if (sectionHeader.length)
        sectionHeader.before(chipHtml);
    else
        cardEl.find('.la-info-card-body .dialog-buttons').before(chipHtml);

    const _closeChipPopup = (popup) => {
        popup.animate({ opacity: 0 }, 120, () => popup.remove());
    };

    cardEl.find('[data-role="item-chip"]').on('click', function (e) {
        e.stopPropagation();
        const existing = $('.la-item-chip-popup');
        if (existing.length) {
            _closeChipPopup(existing);
            return;
        }
        const ms = item.system ?? {};
        let bodyHtml = laRenderTextSection('EFFECT', ms.effect ?? ms.description ?? '', '#e65100');
        bodyHtml += laRenderActions(ms.actions ?? []);
        bodyHtml += laRenderTags(ms.tags ?? []);
        if (!bodyHtml)
            bodyHtml = '<div style="font-size:0.82em;color:#888;">No description.</div>';
        const themeMap = /** @type {Record<string,string>} */ ({ mech_weapon: 'weapon', mech_system: 'system', talent: 'talent', core_bonus: 'core_bonus', npc_feature: 'weapon' });
        const theme = themeMap[item.type] ?? 'default';
        const subtitle = (item.type ?? '').replaceAll('_', ' ').toUpperCase();
        const popup = laDetailPopup('la-item-chip-popup', item.name ?? '', subtitle, bodyHtml, theme);
        $('body').append(popup);
        const cardOffset = cardEl.offset() ?? { left: 0, top: 0 };
        const cardW = cardEl.outerWidth() ?? 200;
        const chipOffset = $(this).offset() ?? { left: 0, top: 0 };
        const pw = popup.outerWidth() ?? 300;
        const ph = popup.outerHeight() ?? 200;
        const wx = window.innerWidth, wy = window.innerHeight;
        let px = cardOffset.left + cardW + 8;
        if (px + pw > wx - 10) px = cardOffset.left - pw - 8;
        let py = chipOffset.top;
        if (py + ph > wy - 10) py = wy - ph - 10;
        popup.css({ left: Math.max(10, px), top: Math.max(10, py), opacity: 0 });
        popup.animate({ left: Math.max(10, px), opacity: 1 }, 150);
        popup.find('.la-detail-close').on('click', () => _closeChipPopup(popup));
        popup.on('click', ev => ev.stopPropagation());
        $(document).one('click', () => _closeChipPopup(popup));
    });
}

// --- Broadcast choice cards (multi-user, first-to-respond wins) ---
// Stores a cancel() fn on each TARGET client so the card can be forcefully dismissed.
export const _pendingBroadcastCards = new Map(); // cardId → cancel()

// --- Vote cards (creator side) ---
export const _pendingVoteCards = new Map(); // cardId → { resolve, cardEl, choices, votes: Map<userId,number>, allVoters: string[], hidden: boolean, refreshCreatorCard: fn }

// --- Vote cards (voter side) ---
export const _pendingVoterCards = new Map(); // cardId → { cardEl, choices, myVote: number|null, dismissed: boolean, cleanup: fn, updateCounts: fn }

/** Returns the userId of the first active GM, or null if none online. */
export function getActiveGMId() {
    return game.users.find(u => u.isGM && u.active)?.id ?? null;
}

/**
 * Creates a non-interactive waiting card (same style as startChoiceCard's waiting state).
 * Returns an object with a `remove()` method to dismiss the card.
 * @param {Object} options
 * @param {string} [options.title]
 * @param {string} [options.description]
 * @param {string} [options.waitMessage] - Text shown in the hourglass line
 * @param {Token} [options.originToken]
 * @param {Token} [options.relatedToken]
 * @param {Item} [options.item]
 * @returns {{ remove: () => void }}
 */
export function startWaitCard({ title = 'WAITING', description = '', waitMessage = 'Waiting for response…', originToken = null, relatedToken = null, item = null } = {}) {
    const waitDesc = (description ? description + '<br>' : '') +
        `<em style="color:#aaa;"><i class="fas fa-hourglass-half"></i> ${waitMessage}</em>`;
    const cardEl = _createInfoCard("choiceCard", {
        title,
        description: waitDesc,
        disabled: true,
        relatedToken,
        originToken,
        onConfirm: () => {},
        onCancel: () => {}
    });
    _updateInfoCard(cardEl, "choiceCard", { choices: [], chosenSet: new Set(), disabled: true, onChoose: () => {} });
    _bindItemChip(cardEl, item);
    _updatePendingBadge();
    return { remove: () => _removeInfoCard(cardEl) };
}

/**
 * Returns all active OWNER-level non-GM userIds for a token.
 * Falls back to the active GM's userId if no player owners are found.
 * @param {Token} token
 * @returns {string[]}
 */
export function getTokenOwnerUserId(token) {
    const playerIds = game.users
        .filter(u => u.active && !u.isGM && token.document.testUserPermission(u, "OWNER"))
        .map(u => u.id);
    if (playerIds.length > 0)
        return playerIds;
    const gm = game.users.find(u => u.active && u.isGM);
    return gm ? [gm.id] : [];
}

/**
 * Interactive choice card — presents a list of choices with callbacks.
 * @param {Object} options - Configuration options
 * @param {string} [options.mode="or"] - "or" (pick one, done) or "and" (pick all sequentially)
 * @param {Array<Object>} [options.choices=[]] - Array of { text, icon?, callback, data? }
 * @param {string} [options.title] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {string} [options.icon] - Card icon class
 * @param {string} [options.headerClass=""] - Card header CSS class
 * @param {string|string[]|null} [options.userIdControl=null] - userId or array of userIds who control this card. Array = broadcast, first to respond wins. null = show locally. Offline users are dropped with a warning.
 * @param {Object} [options.traceData=null] - Optional trace data for the card
 * @param {Token} [options.relatedToken=null] - Optional token to show in the card header.
 * @param {Token} [options.originToken=null] - Optional origin token to show in the card header (orange border).
 * @param {boolean} [options.forceSocket=false] - If true, treats the current user as a remote target (shows delegated card instead of local)
 * @param {Item} [options.item=null] - Item associated with the card
 * @returns {Promise<true|null>} true on completion, null if cancelled
 */
export function startChoiceCard(options = {}) {
    // Delegate vote mode to the dedicated vote card function
    if (/** @type {any} */ (options).mode === "vote" || /** @type {any} */ (options).mode === "vote-hidden")
        return startVoteCard({ ...options, hidden: /** @type {any} */ (options).mode === "vote-hidden" });

    const _title = options.title || 'CHOICE';
    const {
        mode = "or",
        choices = [],
        title,
        description = "",
        icon,
        headerClass = "",
        userIdControl = null,
        traceData = null,
        forceSocket = false,
        item = null,
        relatedToken = null,
        originToken = null
    } = /** @type {any} */ (options);

    // Normalize userIdControl to an array.
    const rawTargets = Array.isArray(userIdControl)
        ? userIdControl
        : (userIdControl ? [userIdControl] : []);

    // If the current user is one of the targets — show the card locally, no waiting, no socket.
    if (rawTargets.includes(game.user.id) && !forceSocket)
        rawTargets.length = 0; // clear targets so we fall through to the local card

    // Filter remaining targets to active users only (self already removed above if needed).
    const activeTargets = rawTargets.filter(id => id && game.users.get(id)?.active);
    const offlineTargets = rawTargets.filter(id => id && !game.users.get(id)?.active);

    if (offlineTargets.length > 0) {
        const offlineNames = offlineTargets.map(id => game.users.get(id)?.name ?? id).join(', ');
        if (activeTargets.length === 0) {
            const gmId = getActiveGMId();
            if (gmId)
                activeTargets.push(gmId);
            const fallbackName = activeTargets.length > 0 ? (game.users.get(activeTargets[0])?.name ?? activeTargets[0]) : 'local user';
            ui.notifications.warn(`lancer-automations | "${offlineNames}" offline — ${fallbackName} will handle the choice instead.`);
        } else {
            ui.notifications.warn(`lancer-automations | "${offlineNames}" offline — removed from choice recipients.`);
        }
    }

    // If targets were specified but all gone, fall back to GM.
    if (rawTargets.length > 0 && activeTargets.length === 0) {
        const gmId = getActiveGMId();
        if (gmId)
            activeTargets.push(gmId);
    }

    const _makeWaitingCard = (waitMsg, onCancel = () => {}) => {
        const cardEl = _createInfoCard("choiceCard", {
            title,
            icon,
            headerClass,
            description: (description ? description + '<br>' : '') + `<em style="color:#aaa;"><i class="fas fa-hourglass-half"></i> ${waitMsg}</em>`,
            mode,
            disabled: true,
            relatedToken,
            originToken,
            onConfirm: () => {},
            onCancel
        });
        _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet: new Set(), disabled: true, onChoose: () => {} });
        _updatePendingBadge();
        return cardEl;
    };

    if (activeTargets.length > 0) {
        const cardId = foundry.utils.randomID();
        const payload = {
            cardId,
            requestingUserId: game.user.id,
            title,
            description,
            icon,
            headerClass,
            mode,
            choices: choices.map(c => ({ text: c.text, icon: c.icon })),
            traceData,
            itemUuid: item?.uuid ?? null,
            relatedTokenId: relatedToken?.id ?? null,
            originTokenId: originToken?.id ?? null
        };

        if (activeTargets.length === 1) {
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardGMRequest',
                payload: { ...payload, targetUserId: activeTargets[0] }
            });
        } else {
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardBroadcastRequest',
                payload: { ...payload, allTargetUserIds: activeTargets }
            });
        }

        const isSelfTarget = activeTargets.includes(game.user.id);
        const controllerNames = activeTargets.map(id => game.users.get(id)?.name ?? id).join(', ');

        return _queueCard(() => new Promise(async (resolve) => {
            if (isSelfTarget) {
                // SENDER IS A TARGET: Show interactive card to ourselves instead of waiting.
                let dismissed = false;
                const chosenSet = new Set();
                const _cancelOthers = (isCancellation = false) => {
                    const others = activeTargets.filter(id => id !== game.user.id);
                    if (others.length > 0) {
                        game.socket.emit('module.lancer-automations', {
                            action: 'choiceCardBroadcastCancel',
                            payload: { cardId, otherTargetUserIds: others, responderName: game.user.name, isCancellation }
                        });
                    }
                };

                let gmTrace = null;
                if (traceData) {
                    const { tokenId, endPos, newEndPos } = traceData;
                    const traceToken = canvas.tokens.get(tokenId);
                    if (traceToken)
                        gmTrace = drawMovementTrace(traceToken, endPos, newEndPos);
                }

                const doCleanup = () => {
                    document.removeEventListener('keydown', keyHandler);
                    _removeInfoCard(cardEl);
                    if (gmTrace?.parent)
                        gmTrace.parent.removeChild(gmTrace);
                    if (gmTrace)
                        gmTrace.destroy();
                };

                const onCancel = async () => {
                    if (dismissed)
                        return;
                    const confirm = await Dialog.confirm({
                        title: "Cancel Choice?",
                        content: `<p>Are you sure you want to cancel the <b>${title}</b> choice card for all recipients?</p>`,
                        yes: () => true,
                        no: () => false,
                        defaultYes: false
                    });
                    if (!confirm)
                        return;
                    _cancelOthers(true);
                    dismissed = true;
                    doCleanup();
                    await resolveGMChoiceCard(cardId, null, game.user.name, game.user.id);
                };

                const cardEl = _createInfoCard("choiceCard", {
                    title,
                    origin: "Self",
                    icon,
                    headerClass,
                    description,
                    mode,
                    relatedToken,
                    onConfirm: () => {},
                    onCancel
                });

                const keyHandler = (e) => {
                    if (e.key === "Escape")
                        onCancel();
                };
                document.addEventListener('keydown', keyHandler);

                const handleChoose = async (idx) => {
                    if (dismissed)
                        return;

                    if (chosenSet.size === 0)
                        _cancelOthers();

                    if (mode === "or") {
                        dismissed = true;
                        doCleanup();
                        await resolveGMChoiceCard(cardId, idx, game.user.name, game.user.id);
                    } else {
                        chosenSet.add(idx);
                        await resolveGMChoiceCard(cardId, idx, game.user.name, game.user.id);

                        if (chosenSet.size === choices.length) {
                            dismissed = true;
                            doCleanup();
                        } else {
                            // Update UI without closing
                            _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
                        }
                    }
                };

                _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
                _bindItemChip(cardEl, item);
                _pendingGMChoices.set(cardId, { resolve, cardEl, choices, mode, chosenSet, activeTargets: new Set(activeTargets) });
                _updatePendingBadge();

            } else {
                // REQUIESTER ONLY: Show waiting card.
                const onCancel = async () => {
                    const confirm = await Dialog.confirm({
                        title: "Cancel Choice?",
                        content: `<p>Are you sure you want to cancel the <b>${title}</b> choice card for all recipients?</p>`,
                        yes: () => true,
                        no: () => false,
                        defaultYes: false
                    });
                    if (confirm) {
                        game.socket.emit('module.lancer-automations', {
                            action: 'choiceCardBroadcastCancel',
                            payload: { cardId, otherTargetUserIds: activeTargets, responderName: game.user.name, isCancellation: true }
                        });
                        await resolveGMChoiceCard(cardId, null, game.user.name, game.user.id);
                    }
                };
                const cardEl = _makeWaitingCard(`Waiting for first response from: ${controllerNames}`, onCancel);
                _pendingGMChoices.set(cardId, { resolve, cardEl, choices, mode, chosenSet: new Set(), activeTargets: new Set(activeTargets) });
            }
        }), title);
    }

    return _queueCard(() => new Promise((resolve) => {
        if (choices.length === 0) {
            resolve({ choiceIdx: null, responderIds: [game.user.id] });
            return;
        }

        const chosenSet = new Set();
        let dismissed = false;

        const doCleanup = () => {
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
        };

        const onCancel = () => {
            if (dismissed)
                return;
            dismissed = true;
            doCleanup();
            resolve(null);
        };

        const cardEl = _createInfoCard("choiceCard", {
            title,
            icon,
            headerClass,
            description,
            mode,
            relatedToken,
            originToken,
            onConfirm: () => {},
            onCancel
        });

        const keyHandler = (event) => {
            if (event.key === "Escape")
                onCancel();
        };
        document.addEventListener('keydown', keyHandler);

        const handleChoose = async (idx) => {
            if (dismissed)
                return;

            if (mode === "or") {
                dismissed = true;
                doCleanup();
                const choice = choices[idx];
                resolve({ choiceIdx: idx, responderIds: [game.user.id] }); // Release queue slot
                if (choice.callback)
                    await _runCardCallback(() => choice.callback({ ...choice.data, responderName: game.user.name }));
            } else {
                chosenSet.add(idx);
                const choice = choices[idx];
                if (choice.callback)
                    await _runCardCallback(() => choice.callback({ ...choice.data, responderName: game.user.name }));

                if (chosenSet.size === choices.length) {
                    dismissed = true;
                    doCleanup();
                    resolve({ choiceIdx: null, responderIds: [game.user.id] });
                } else {
                    // Update UI without closing
                    _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
                }
            }
        };

        _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
        _bindItemChip(cardEl, item);
        _updatePendingBadge();
    }), _title);
}

/**
 * Called on the GM's client (via socket) to show a controlled choice card on behalf of a player.
 * When the GM picks or cancels, the result is sent back to the requesting user.
 */
export async function showUserIdControlledChoiceCard({ cardId, requestingUserId, title, description, icon, headerClass, mode, choices, itemUuid = null, relatedTokenId = null, originTokenId = null }) {
    const requesterName = game.users.get(requestingUserId)?.name ?? '?';
    const item = itemUuid ? fromUuidSync(itemUuid) : null;
    const relatedToken = relatedTokenId ? canvas.tokens.get(relatedTokenId) : null;
    const originToken = originTokenId ? canvas.tokens.get(originTokenId) : null;
    await _queueCard(() => new Promise((resolve) => {
        const chosenSet = new Set();
        let dismissed = false;

        const doCleanup = () => {
            _pendingBroadcastCards.delete(cardId);
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
        };

        const onCancel = () => {
            if (dismissed)
                return;
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardGMResponse',
                payload: { cardId, requestingUserId, choiceIdx: null, responderName: game.user.name, responderUserId: game.user.id }
            });
            dismissed = true;
            doCleanup();
            resolve(null);
        };

        const cardEl = _createInfoCard("choiceCard", {
            title,
            origin: `${requesterName} → You`,
            icon,
            headerClass,
            description,
            mode,
            relatedToken,
            originToken,
            onConfirm: () => {},
            onCancel
        });

        const keyHandler = (event) => {
            if (event.key === "Escape")
                onCancel();
        };
        document.addEventListener('keydown', keyHandler);

        // Register cancel hook so the requester's dismissal can close this card silently.
        _pendingBroadcastCards.set(cardId, () => {
            if (dismissed)
                return;
            dismissed = true;
            doCleanup();
            resolve(null);
        });

        const handleChoose = (idx) => {
            if (dismissed)
                return;

            if (mode === "or") {
                dismissed = true;
                game.socket.emit('module.lancer-automations', {
                    action: 'choiceCardGMResponse',
                    payload: { cardId, requestingUserId, choiceIdx: idx, responderName: game.user.name, responderUserId: game.user.id }
                });
                doCleanup();
                resolve(true);
            } else {
                chosenSet.add(idx);
                game.socket.emit('module.lancer-automations', {
                    action: 'choiceCardGMResponse',
                    payload: { cardId, requestingUserId, choiceIdx: idx, responderName: game.user.name, responderUserId: game.user.id }
                });

                if (chosenSet.size === choices.length) {
                    dismissed = true;
                    doCleanup();
                    resolve(true);
                } else {
                    // Update UI without closing
                    _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
                }
            }
        };

        _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
        _bindItemChip(cardEl, item);
        _updatePendingBadge();
    }), `[${requesterName}→You] ${title}`);
}

/**
 * Called on the player's client (via socket) to resolve a pending GM-controlled choice.
 */
export async function resolveGMChoiceCard(cardId, choiceIdx, responderName, responderUserId = null) {
    const pending = _pendingGMChoices.get(cardId);
    if (!pending)
        return;

    if (choiceIdx === null || choiceIdx === undefined) {
        // If the responder is the requester (local call) - always cancel.
        // Otherwise check if there are other targets.
        const isRequester = (responderUserId === game.user.id) || (responderName === game.user.name);

        if (isRequester) {
            _pendingGMChoices.delete(cardId);
            if (pending.cardEl)
                _removeInfoCard(pending.cardEl);
            pending.resolve(null);
            return;
        }

        // It's a target cancelling.
        if (pending.activeTargets) {
            const targetId = responderUserId || game.users.find(u => u.name === responderName)?.id;
            if (targetId)
                pending.activeTargets.delete(targetId);

            if (pending.activeTargets.size === 0) {
                // All targets either responded or cancelled.
                _pendingGMChoices.delete(cardId);
                if (pending.cardEl)
                    _removeInfoCard(pending.cardEl);
                pending.resolve(null);
            } else {
                // Still waiting for others.
                ui.notifications.info(`${responderName} declined the choice.`);
                // Update waiting card text?
                // For now just letting them wait.
            }
        } else {
            // No target list (legacy or single target).
            _pendingGMChoices.delete(cardId);
            if (pending.cardEl)
                _removeInfoCard(pending.cardEl);
            pending.resolve(null);
        }
        return;
    }

    const choice = pending.choices[choiceIdx];

    if (pending.mode === "or") {
        _pendingGMChoices.delete(cardId);
        if (pending.cardEl)
            _removeInfoCard(pending.cardEl);
        pending.resolve({ choiceIdx, responderIds: [responderUserId].filter(Boolean) });
    } else {
        // AND mode: track choices if we have a chosenSet
        if (pending.chosenSet) {
            pending.chosenSet.add(choiceIdx);
            if (pending.chosenSet.size === pending.choices.length) {
                _pendingGMChoices.delete(cardId);
                if (pending.cardEl)
                    _removeInfoCard(pending.cardEl);
                pending.resolve({ choiceIdx: null, responderIds: [responderUserId].filter(Boolean) });
            }
        } else {
            // Fallback for legacy calls without chosenSet
            _pendingGMChoices.delete(cardId);
            if (pending.cardEl)
                _removeInfoCard(pending.cardEl);
            pending.resolve({ choiceIdx, responderIds: [responderUserId].filter(Boolean) });
        }
    }

    if (choice?.callback) {
        await _runCardCallback(() => choice.callback({ ...choice.data, responderName }));
    }
}

/**
 * Called on a non-winning target client to forcefully dismiss their broadcast choice card
 * when another target responded first or the requester cancelled.
 */
export function cancelBroadcastChoiceCard(cardId, responderName, isCancellation = false) {
    const cancel = _pendingBroadcastCards.get(cardId);
    if (cancel) {
        if (isCancellation)
            ui.notifications.info(`${responderName || 'The requester'} cancelled the choice card.`);
        else if (responderName)
            ui.notifications.info(`${responderName} took the choice card.`);
        cancel();
    }
}

// ─── Vote Card ────────────────────────────────────────────────────────────────

/**
 * Start a vote card. All listed voters receive a card and cast their choice.
 * Only the creator (caller) sees the tally and can confirm to close the vote.
 * @param {Object} options
 * @param {Array<{text:string,icon?:string,callback?:Function,data?:Object}>} [options.choices=[]]
 * @param {string} [options.title]
 * @param {string} [options.description=""]
 * @param {string} [options.icon]
 * @param {string} [options.headerClass=""]
 * @param {string|string[]|null} [options.userIdControl=null] - voter userIds
 * @param {boolean} [options.hidden=false] - if true voters cannot see each other's vote counts
 * @returns {Promise<true|null>}
 */
export function startVoteCard(options = {}) {
    const _title = /** @type {any} */ (options).title || 'VOTE';
    const {
        choices = [],
        title,
        description = "",
        icon,
        headerClass = "",
        userIdControl = null,
        hidden = false
    } = /** @type {any} */ (options);

    const cardId = foundry.utils.randomID();
    const rawVoters = Array.isArray(userIdControl)
        ? userIdControl
        : (userIdControl ? [userIdControl] : []);
    const activeVoters = rawVoters.filter(id => id && game.users.get(id)?.active);

    // Emit to all voters (socket reaches everyone including self, filtered on receiver side)
    if (activeVoters.length > 0) {
        game.socket.emit('module.lancer-automations', {
            action: 'voteCardRequest',
            payload: {
                cardId,
                requestingUserId: game.user.id,
                allVoterUserIds: activeVoters,
                title,
                description,
                icon,
                headerClass,
                choices: choices.map(c => ({ text: c.text, icon: c.icon })),
                hidden
            }
        });
    }

    const creatorIsVoter = activeVoters.includes(game.user.id);

    return _queueCard(() => new Promise((resolve) => {
        /** @type {Map<string, number>} */
        const votes = new Map();
        let dismissed = false;

        const doCleanup = () => {
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
        };

        const refreshCreatorCard = () => {
            const counts = choices.map((_, i) => [...votes.values()].filter(v => v === i).length);
            const myVote = votes.has(game.user.id) ? votes.get(game.user.id) : null;
            _updateInfoCard(cardEl, "voteCard", {
                choices,
                voteCounts: counts,
                hidden: false, // creator always sees everything
                isCreator: true,
                disabled: !creatorIsVoter,
                myVote: myVote ?? null,
                responded: [...votes.keys()],
                allVoters: activeVoters,
                onChoose: creatorIsVoter ? handleCreatorVote : null
            });
            // Broadcast tally update to voters
            game.socket.emit('module.lancer-automations', {
                action: 'voteCardUpdate',
                payload: {
                    cardId,
                    allVoterUserIds: activeVoters,
                    voteCounts: hidden ? null : counts,
                    responded: [...votes.keys()]
                }
            });
        };

        const handleCreatorVote = (idx) => {
            if (dismissed)
                return;
            // Creator votes or changes their vote
            votes.set(game.user.id, idx);
            refreshCreatorCard();
        };

        const onConfirmVote = async () => {
            if (dismissed)
                return;
            if (votes.size === 0) {
                ui.notifications.warn("No votes cast yet.");
                return;
            }
            const counts = choices.map((_, i) => [...votes.values()].filter(v => v === i).length);
            const maxCount = Math.max(...counts);
            const winners = counts.reduce((acc, c, i) => {
                if (c === maxCount)
                    acc.push(i); return acc;
            }, /** @type {number[]} */ ([]));

            let winnerIdx;
            if (winners.length === 1) {
                winnerIdx = winners[0];
            } else {
                // Tie: build a dialog with one button per tied option
                const tieButtons = /** @type {Record<string,any>} */ ({});
                for (const i of winners) {
                    tieButtons[`choice_${i}`] = { label: choices[i].text, callback: () => i };
                }
                tieButtons.cancel = { label: "Cancel", callback: () => null };
                const tiedNames = winners.map(i => `<b>${choices[i].text}</b>`).join(', ');
                const picked = await Dialog.wait({
                    title: "Vote Tie",
                    content: `<p>There is a tie between: ${tiedNames}.</p><p>Pick the winner or cancel.</p>`,
                    buttons: tieButtons,
                    default: "cancel"
                });
                if (picked === null || picked === undefined)
                    return;
                winnerIdx = picked;
            }

            dismissed = true;
            doCleanup();
            _pendingVoteCards.delete(cardId);

            // Notify voters
            if (activeVoters.length > 0) {
                game.socket.emit('module.lancer-automations', {
                    action: 'voteCardConfirm',
                    payload: {
                        cardId,
                        allVoterUserIds: activeVoters,
                        winnerIdx,
                        winnerText: choices[winnerIdx]?.text ?? ''
                    }
                });
            }

            const winner = choices[winnerIdx];
            resolve({ choiceIdx: winnerIdx, responderIds: [...votes.keys()] });
            if (winner?.callback)
                await _runCardCallback(() => winner.callback({ ...winner.data, responderName: game.user.name }));
        };

        const onCancel = async () => {
            if (dismissed)
                return;
            const confirm = await Dialog.confirm({
                title: "Cancel Vote?",
                content: `<p>Are you sure you want to cancel the <b>${title}</b> vote?</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
            if (!confirm)
                return;
            dismissed = true;
            doCleanup();
            _pendingVoteCards.delete(cardId);
            if (activeVoters.length > 0) {
                game.socket.emit('module.lancer-automations', {
                    action: 'voteCardCancel',
                    payload: { cardId, allVoterUserIds: activeVoters }
                });
            }
            resolve(null);
        };

        const _desc = creatorIsVoter
            ? description
            : (description ? description + '<br>' : '') + `<em style="color:#aaa;"><i class="fas fa-hourglass-half"></i> Waiting for votes from ${activeVoters.map(id => game.users.get(id)?.name ?? id).join(', ')}</em>`;

        const cardEl = _createInfoCard("voteCard", {
            title,
            origin: "Vote",
            icon,
            headerClass,
            description: _desc,
            disabled: !creatorIsVoter,
            isCreator: true,
            onConfirmVote,
            onCancel
        });

        const keyHandler = (e) => {
            if (e.key === "Escape")
                onCancel();
        };
        document.addEventListener('keydown', keyHandler);

        _pendingVoteCards.set(cardId, { resolve, cardEl, choices, votes, allVoters: activeVoters, hidden, refreshCreatorCard });
        refreshCreatorCard();
    }), _title);
}

/**
 * Called on voter clients when a voteCardRequest socket event arrives.
 * @param {{ cardId:string, requestingUserId:string, allVoterUserIds:string[], title:string, description:string, icon:string, headerClass:string, choices:Array, hidden:boolean }} payload
 */
export async function showVoteCardOnVoter({ cardId, requestingUserId, allVoterUserIds, title, description, icon, headerClass, choices, hidden }) {
    const creatorName = game.users.get(requestingUserId)?.name ?? '?';

    await _queueCard(() => new Promise((resolve) => {
        let myVote = null;
        let dismissed = false;
        let voteCounts = choices.map(() => 0);
        let responded = [];

        const doCleanup = () => {
            _pendingVoterCards.delete(cardId);
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
        };

        const onCancel = () => {
            if (dismissed)
                return;
            // Notify creator that this voter cancelled
            game.socket.emit('module.lancer-automations', {
                action: 'voteCardSubmit',
                payload: {
                    cardId,
                    requestingUserId,
                    voterUserId: game.user.id,
                    voterName: game.user.name,
                    choiceIdx: null // null = cancel/withdraw
                }
            });
            dismissed = true;
            doCleanup();
            resolve(null);
        };

        const cardEl = _createInfoCard("voteCard", {
            title,
            origin: `Vote by ${creatorName}`,
            icon,
            headerClass,
            description,
            isCreator: false,
            onConfirmVote: null,
            onCancel
        });

        const keyHandler = (e) => {
            if (e.key === "Escape")
                onCancel();
        };
        document.addEventListener('keydown', keyHandler);

        const refreshVoterCard = () => {
            _updateInfoCard(cardEl, "voteCard", {
                choices,
                voteCounts,
                hidden,
                isCreator: false,
                myVote,
                responded,
                allVoters: allVoterUserIds,
                onChoose: handleVote
            });
        };

        const handleVote = (idx) => {
            if (dismissed)
                return;
            myVote = idx;
            game.socket.emit('module.lancer-automations', {
                action: 'voteCardSubmit',
                payload: {
                    cardId,
                    requestingUserId,
                    voterUserId: game.user.id,
                    voterName: game.user.name,
                    choiceIdx: idx
                }
            });
            refreshVoterCard();
        };

        _pendingVoterCards.set(cardId, {
            cardEl,
            choices,
            get myVote() {
                return myVote;
            },
            set myVote(v) {
                myVote = v;
            },
            get dismissed() {
                return dismissed;
            },
            set dismissed(v) {
                dismissed = v;
            },
            cleanup: doCleanup,
            updateCounts: (newCounts, newResponded) => {
                if (!hidden)
                    voteCounts = newCounts;
                responded = newResponded;
                refreshVoterCard();
            },
            resolve
        });

        refreshVoterCard();
    }), `[${creatorName}] ${title}`);
}

/**
 * Called on the creator's client when a voter submits or withdraws their vote.
 * @param {{ cardId:string, voterUserId:string, voterName:string, choiceIdx:number|null }} payload
 */
export function receiveVoteSubmission({ cardId, voterUserId, voterName, choiceIdx }) {
    const pending = _pendingVoteCards.get(cardId);
    if (!pending)
        return;

    if (choiceIdx === null) {
        // Voter withdrew — remove their vote
        pending.votes.delete(voterUserId);
    } else {
        pending.votes.set(voterUserId, choiceIdx);
    }
    pending.refreshCreatorCard();
}

/**
 * Called on voter clients to update vote tallies (non-hidden mode).
 * @param {{ cardId:string, voteCounts:number[]|null, responded:string[] }} payload
 */
export function updateVoteCardOnVoter({ cardId, voteCounts, responded }) {
    const pending = _pendingVoterCards.get(cardId);
    if (!pending)
        return;
    pending.updateCounts(voteCounts ?? pending.choices.map(() => 0), responded ?? []);
}

/**
 * Called on voter clients when the creator confirms the vote result.
 * @param {{ cardId:string, winnerIdx:number, winnerText:string }} payload
 */
export function confirmVoteCardOnVoter({ cardId, winnerIdx, winnerText }) {
    const pending = _pendingVoterCards.get(cardId);
    if (!pending || pending.dismissed)
        return;
    pending.dismissed = true;
    pending.cleanup();
    ui.notifications.info(`Vote concluded — winner: ${winnerText}`);
    pending.resolve({ choiceIdx: winnerIdx, responderIds: [] });
}

/**
 * Called on voter clients when the creator cancels the vote.
 * @param {{ cardId:string }} payload
 */
export function cancelVoteCardOnVoter({ cardId }) {
    const pending = _pendingVoterCards.get(cardId);
    if (!pending || pending.dismissed)
        return;
    pending.dismissed = true;
    pending.cleanup();
    ui.notifications.info("The vote was cancelled.");
    pending.resolve(null);
}

/**
 * Called on each target client when a multi-user broadcast choice card is requested.
 * First user to respond wins: their choice is sent to the requester and all other
 * targets' cards are cancelled.
 * @param {{ cardId: string, requestingUserId: string, allTargetUserIds: string[], title: string, description: string, icon: string, headerClass: string, mode: string, choices: Array, itemUuid?: string|null, relatedTokenId?: string|null, originTokenId?: string|null }} payload
 */
export async function showMultiUserControlledChoiceCard({ cardId, requestingUserId, allTargetUserIds, title, description, icon, headerClass, mode, choices, itemUuid = null, relatedTokenId = null, originTokenId = null }) {
    const requesterName = game.users.get(requestingUserId)?.name ?? '?';
    const item = itemUuid ? fromUuidSync(itemUuid) : null;
    const relatedToken = relatedTokenId ? canvas.tokens.get(relatedTokenId) : null;
    const originToken = originTokenId ? canvas.tokens.get(originTokenId) : null;

    const _cancelOthers = () => {
        const otherTargets = allTargetUserIds.filter(id => id !== game.user.id);
        if (otherTargets.length > 0) {
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardBroadcastCancel',
                payload: { cardId, otherTargetUserIds: otherTargets, responderName: game.user.name, isCancellation: false }
            });
        }
    };

    await _queueCard(() => new Promise((resolve) => {
        const chosenSet = new Set();
        let dismissed = false;
        let firstPick = true;

        const doCleanup = () => {
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(cardEl);
            _pendingBroadcastCards.delete(cardId);
        };

        const onCancel = () => {
            if (dismissed)
                return;
            game.socket.emit('module.lancer-automations', {
                action: 'choiceCardGMResponse',
                payload: { cardId, requestingUserId, choiceIdx: null, responderName: game.user.name, responderUserId: game.user.id }
            });
            dismissed = true;
            doCleanup();
            resolve(null);
        };

        const cardEl = _createInfoCard("choiceCard", {
            title,
            origin: `${requesterName} → You`,
            icon,
            headerClass,
            description,
            mode,
            relatedToken,
            originToken,
            onConfirm: () => {},
            onCancel
        });

        const keyHandler = (event) => {
            if (event.key === "Escape")
                onCancel();
        };
        document.addEventListener('keydown', keyHandler);

        // Register cancel hook so another user's response can dismiss this card silently.
        _pendingBroadcastCards.set(cardId, () => {
            if (dismissed)
                return;
            dismissed = true;
            doCleanup();
            resolve(null);
        });

        const handleChoose = (idx) => {
            if (dismissed)
                return;

            if (firstPick) {
                _cancelOthers();
                firstPick = false;
            }

            if (mode === "or") {
                dismissed = true;
                game.socket.emit('module.lancer-automations', {
                    action: 'choiceCardGMResponse',
                    payload: { cardId, requestingUserId, choiceIdx: idx, responderName: game.user.name, responderUserId: game.user.id }
                });
                doCleanup();
                resolve(true);
            } else {
                chosenSet.add(idx);
                game.socket.emit('module.lancer-automations', {
                    action: 'choiceCardGMResponse',
                    payload: { cardId, requestingUserId, choiceIdx: idx, responderName: game.user.name, responderUserId: game.user.id }
                });

                if (chosenSet.size === choices.length) {
                    dismissed = true;
                    doCleanup();
                    resolve(true);
                } else {
                    // Update UI without closing
                    _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
                }
            }
        };

        _updateInfoCard(cardEl, "choiceCard", { choices, chosenSet, onChoose: handleChoose });
        _bindItemChip(cardEl, item);
        _updatePendingBadge();
    }), `[${requesterName}→You] ${title}`);
}
