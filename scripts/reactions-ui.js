/*global game, Dialog, ChatMessage, canvas, $, foundry */
import { ReactionManager, stringToAsyncFunction } from "./reaction-manager.js";

let activeReactionDialog = null;
let activeDetailPanel = null;
let selectedReactionKey = null;

export async function activateReaction(token, item, reaction, isGeneral, displayTitle, itemName, triggerData = null) {
    token.control({ releaseOthers: true });

    if (item) {
        const lid = item.system?.lid;
        const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;
        const reactionEntry = reactionConfig?.reactions?.[0] || reaction;

        const actionType = reactionEntry?.actionType || (reactionEntry?.isReaction !== false ? "Reaction" : "Free Action");
        const consumesReaction = reactionEntry?.consumesReaction !== false;

        const activationType = reactionEntry?.activationType || "flow";
        const activationMode = reactionEntry?.activationMode || "after";

        const executeCustomActivation = async () => {
            if (activationType === "macro") {
                const macroName = reactionEntry?.activationMacro;
                if (macroName) {
                    const macro = game.macros.find(m => m.name === macroName);
                    if (macro) {
                        await macro.execute({ token, actor: token.actor, item, reactionName: displayTitle, triggerData });
                    } else {
                        ui.notifications.warn(`Macro "${macroName}" not found`);
                    }
                }
            } else if (activationType === "code") {
                const code = reactionEntry?.activationCode;
                if (code) {
                    try {
                        if (typeof code === 'function') {
                            await code(token, token.actor, item, displayTitle, triggerData);
                        } else if (typeof code === 'string') {
                            const fn = stringToAsyncFunction(code, ["token", "actor", "item", "reactionName", "triggerData"]);
                            await fn(token, token.actor, item, displayTitle, triggerData);
                        }
                    } catch (e) {
                        console.error(`lancer-reactionChecker | Error executing activation code:`, e);
                    }
                }
            }
        };

        const itemActivation = async () => {
            const reactionPath = reactionEntry?.reactionPath;
            let activationPath = null;

            if (reactionPath) {
                activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
            }

            if (activationPath) {
                await item.beginActivationFlow(activationPath);
            } else if (item.system?.actions?.length > 0) {
                const actionIndex = item.system.actions.findIndex(a => a.activation === 'Reaction');
                const path = actionIndex >= 0 ? `system.actions.${actionIndex}` : 'system.actions.0';
                await item.beginActivationFlow(path);
            } else if (item.beginSystemFlow) {
                await item.beginSystemFlow();
            } else {
                await item.toChat();
            }
        };

        if (activationType === "none") {
        } else if (activationType === "flow") {
            await itemActivation();
        } else if (activationType === "macro" || activationType === "code") {
            if (activationMode === "instead") {
                await executeCustomActivation();
            } else {
                await itemActivation();
                await executeCustomActivation();
            }
        }
    } else {
        const actor = token.actor;
        const generalReaction = ReactionManager.getGeneralReaction(displayTitle) || reaction;

        const isReactionTypeResult = generalReaction?.actionType ? (generalReaction.actionType === "Reaction") : (generalReaction?.isReaction !== false);
        const actionType = generalReaction?.actionType || (isReactionTypeResult ? "Reaction" : "Free Action");
        const consumesReaction = generalReaction?.consumesReaction !== false;

        const activationType = generalReaction?.activationType || "flow";
        const activationMode = generalReaction?.activationMode || "after";

        const executeCustomActivation = async () => {
            if (activationType === "macro") {
                const macroName = generalReaction?.activationMacro;
                if (macroName) {
                    const macro = game.macros.find(m => m.name === macroName);
                    if (macro) {
                        await macro.execute({ token, actor, reactionName: displayTitle, triggerData });
                    } else {
                        ui.notifications.warn(`Macro "${macroName}" not found`);
                    }
                }
            } else if (activationType === "code") {
                const code = generalReaction?.activationCode;
                if (code) {
                    try {
                        if (typeof code === 'function') {
                            await code(token, actor, displayTitle, triggerData);
                        } else if (typeof code === 'string') {
                            const fn = stringToAsyncFunction(code, ["token", "actor", "reactionName", "triggerData"]);
                            await fn(token, actor, displayTitle, triggerData);
                        }
                    } catch (e) {
                        console.error(`lancer-reactionChecker | Error executing activation code:`, e);
                    }
                }
            }
        };

        const showChatActivation = async () => {
            const SimpleActivationFlow = game.lancer?.flows?.get("SimpleActivationFlow");

            let flowData;

            if (generalReaction?.onlyOnSourceMatch && triggerData?.actionData) {
                const actionData = triggerData.actionData;
                flowData = {
                    title: actionData.title || displayTitle,
                    action: {
                        name: actionData.action?.name || displayTitle,
                        activation: actionData.action?.activation || actionType
                    },
                    detail: actionData.detail || "No description"
                };
            } else {
                const triggerText = generalReaction?.triggerDescription || "No trigger description";
                const effectText = generalReaction?.effectDescription || "No effect description";
                flowData = {
                    title: displayTitle,
                    action: {
                        name: displayTitle,
                        activation: actionType
                    },
                    detail: `<strong>Trigger:</strong> ${triggerText}<br><strong>Effect:</strong> ${effectText}`
                };
            }

            const flow = new SimpleActivationFlow(actor, flowData);
            await flow.begin();
        };

        if (activationType === "none") {
        } else if (activationType === "flow") {
            await showChatActivation();
        } else if (activationType === "macro" || activationType === "code") {
            if (activationMode === "instead") {
                await executeCustomActivation();
            } else {
                await showChatActivation();
                await executeCustomActivation();
            }
        }
    }

    if (game.settings.get('lancer-reactionChecker', 'consumeReaction')) {
        let shouldConsume = false;

        if (item) {
            const lid = item.system?.lid;
            const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;
            const entry = reactionConfig?.reactions?.[0] || reaction;
            const type = entry?.actionType || (entry?.isReaction !== false ? "Reaction" : "Free Action");
            const consumes = entry?.consumesReaction !== false;

            shouldConsume = (type === "Reaction" && consumes);
        } else {
            const generalReaction = ReactionManager.getGeneralReaction(displayTitle) || reaction;
            const type = generalReaction?.actionType || (generalReaction?.isReaction !== false ? "Reaction" : "Free Action");
            const consumes = generalReaction?.consumesReaction !== false;

            shouldConsume = (type === "Reaction" && consumes);
        }

        if (shouldConsume) {
            const actor = token.actor;
            if (actor?.system?.action_tracker?.reaction > 0) {
                const newReaction = actor.system.action_tracker.reaction - 1;
                await actor.update({ 'system.action_tracker.reaction': newReaction });
            }
        }
    }
}

export function displayReactionPopup(triggerType, triggeredReactions) {
    if (triggeredReactions.length === 0) return;

    const popupData = { triggerType, triggeredReactions };
    renderReactionDialog(popupData);
}

function closeDetailPanel() {
    if (activeDetailPanel) {
        activeDetailPanel.animate(
            { opacity: 0, left: '-=20px' },
            150,
            function () {
                $(this).remove();
            }
        );
        activeDetailPanel = null;
        selectedReactionKey = null;
    }
}

function showDetailPanel(token, item, mainDialogEl, popupData, reactionData = null, triggerData = null) {
    const isGeneral = reactionData?.isGeneral || false;
    const reactionKey = isGeneral ? `${token.id}-general-${reactionData.reactionName}` : `${token.id}-${item.id}`;

    if (selectedReactionKey === reactionKey) {
        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');
        return;
    }

    if (activeDetailPanel) {
        activeDetailPanel.remove();
        activeDetailPanel = null;
    }

    selectedReactionKey = reactionKey;

    let triggerText = "No trigger text";
    let effectText = "No effect info";
    let activationPath = null;
    let displayTitle = "Unknown";
    let isReactionType = true;
    let actionType = "Reaction";
    let frequency = "1/Round";

    if (isGeneral) {
        displayTitle = reactionData.reactionName;
        const generalReaction = ReactionManager.getGeneralReaction(reactionData.reactionName);

        if (generalReaction?.onlyOnSourceMatch && triggerData?.actionData) {
            const actionData = triggerData.actionData;
            if (actionData.action) {
                triggerText = generalReaction?.triggerDescription || actionData.action.trigger || "";
                effectText = generalReaction?.effectDescription || actionData.detail || actionData.action.detail || "";
            } else {
                triggerText = generalReaction?.triggerDescription || "";
                effectText = generalReaction?.effectDescription || actionData.detail || "";
            }
        } else {
            triggerText = generalReaction?.triggerDescription || "";
            effectText = generalReaction?.effectDescription || "";
        }

        isReactionType = generalReaction?.actionType ? (generalReaction.actionType === "Reaction") : (generalReaction?.isReaction !== false);
        actionType = generalReaction?.actionType || (isReactionType ? "Reaction" : "Free Action");
        frequency = generalReaction?.frequency || "1/Round";
    } else if (item) {
        const lid = item.system?.lid;
        const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;
        const reactionEntry = reactionConfig?.reactions?.[0];

        const reactionPath = reactionEntry?.reactionPath || "system.trigger";
        isReactionType = reactionEntry?.actionType ? (reactionEntry.actionType === "Reaction") : (reactionEntry?.isReaction !== false);
        actionType = reactionEntry?.actionType || (isReactionType ? "Reaction" : "Free Action");
        frequency = reactionEntry?.frequency || "1/Round";

        const resolvePath = (obj, path) => {
            if (!path) return undefined;
            const cleanPath = path.replace(/\[(\d+)\]/g, '.$1').replace(/^\./, '');

            let val = foundry.utils.getProperty(obj, cleanPath);
            if (val !== undefined) return val;

            if (!cleanPath.startsWith("system.")) {
                val = foundry.utils.getProperty(obj, `system.${cleanPath}`);
            }
            return val;
        };

        const resolvedData = resolvePath(item, reactionPath);

        if (typeof resolvedData === 'string') {
            triggerText = resolvedData;

            if (item.system?.effect) {
                effectText = item.system.effect;
            }

            activationPath = null;
        } else if (typeof resolvedData === 'object' && resolvedData !== null) {
            triggerText = resolvedData.trigger || resolvedData.description || "No trigger text";
            effectText = resolvedData.effect || resolvedData.detail || "No effect info";

            activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
        } else {
            triggerText = "Path not found: " + reactionPath;
        }

        if (reactionEntry?.triggerDescription) {
            triggerText = reactionEntry.triggerDescription;
        }
        if (reactionEntry?.effectDescription) {
            effectText = reactionEntry.effectDescription;
        }

        displayTitle = item.name;
    }

    const html = `
    <div id="reaction-detail-panel" style="
        position: fixed;
        background: #23272a;
        border: 1px solid #991e2a;
        border-radius: 5px;
        padding: 15px;
        width: 280px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        z-index: 10000;
        font-family: 'Roboto Condensed', sans-serif;
        color: #e0e0e0;
        opacity: 0;
    ">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; padding-bottom: 8px; border-bottom: 1px solid #444;">
            <span style="font-weight: bold; font-size: 1.1em; color: #fff;">${displayTitle}</span>
            <span class="detail-close" style="cursor: pointer; color: #888;">&times; Close</span>
        </div>

        ${triggerText ? `
        <div style="margin-bottom: 12px;">
            <div style="background: #991e2a; color: white; padding: 2px 8px; border-radius: 2px; display: inline-block; font-size: 0.8em; font-weight: bold; margin-bottom: 4px;">
                TRIGGER
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.4); border-left: 2px solid #991e2a; color: #ccc;">
                ${triggerText}
            </div>
        </div>
        ` : ''}

        ${effectText ? `
        <div style="margin-bottom: 12px;">
            <div style="background: #2a5599; color: white; padding: 2px 8px; border-radius: 2px; display: inline-block; font-size: 0.8em; font-weight: bold; margin-bottom: 4px;">
                ACTION INFO
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.4); border-left: 2px solid #2a5599; color: #ccc;">
                ${effectText}
            </div>
        </div>
        ` : ''}

        <div style="font-size: 0.85em; margin-bottom: 10px;">
            <span style="background: rgba(255,255,255,0.1); padding: 2px 8px; border-radius: 10px; margin-right: 5px;">
                <i class="fas fa-sync"></i> ${frequency}
            </span>
             ${actionType === "Reaction" ?
            `<span style="background: rgba(153, 30, 42, 0.3); padding: 2px 8px; border-radius: 10px;">
                    <i class="fas fa-bolt"></i> Reaction
                </span>` :
            actionType === "Free Action" ?
                `<span style="background: rgba(42, 153, 30, 0.3); padding: 2px 8px; border-radius: 10px;">
                    <i class="fas fa-check"></i> Free Action
                </span>` :
                `<span style="background: rgba(42, 153, 200, 0.3); padding: 2px 8px; border-radius: 10px;">
                    <i class="fas fa-play"></i> ${actionType}
                </span>`
        }
        </div>

        <button class="activate-btn" style="
            background: #991e2a;
            color: white;
            border: none;
            padding: 8px 16px;
            cursor: pointer;
            font-weight: bold;
            width: 100%;
            border-radius: 3px;
        "><i class="fas fa-bolt"></i> ACTIVATE</button>
    </div>`;

    $('body').append(html);
    activeDetailPanel = $('#reaction-detail-panel');

    const mainDialog = mainDialogEl.closest('.dialog');
    if (mainDialog.length) {
        const rect = mainDialog[0].getBoundingClientRect();
        activeDetailPanel.css({
            top: rect.top + 'px',
            left: (rect.right + 10) + 'px'
        });
    }

    activeDetailPanel.animate(
        { opacity: 1 },
        200
    );

    activeDetailPanel.find('.detail-close').click(() => {
        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');
    });

    activeDetailPanel.find('.activate-btn').click(async () => {
        let reaction = null;
        if (item) {
            const lid = item.system?.lid;
            const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;
            reaction = reactionConfig?.reactions?.[0];
        } else {
            reaction = ReactionManager.getGeneralReaction(displayTitle);
        }

        await activateReaction(token, item, reaction, isGeneral, displayTitle, item?.name || displayTitle, triggerData);

        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');

        const reactionCount = token.actor?.system?.action_tracker?.reaction || 0;
        if (reactionCount <= 0) {
            const tokenBox = mainDialogEl.find(`.lancer-list-item[data-token-id="${token.id}"]`);
            tokenBox.addClass('reaction-exhausted');
            tokenBox.find('img').css('filter', 'grayscale(100%)');
        }
    });
}

function renderReactionDialog(popupData) {
    const { triggerType, triggeredReactions } = popupData;

    const byToken = new Map();
    for (const tr of triggeredReactions) {
        if (!byToken.has(tr.token.id)) {
            byToken.set(tr.token.id, {
                token: tr.token,
                reactions: []
            });
        }
        byToken.get(tr.token.id).reactions.push(tr);
    }

    for (const [tokenId, data] of byToken) {
        const actor = data.token.actor;
        const hasReaction = actor?.system?.action_tracker?.reaction > 0;
        if (!hasReaction) {
            byToken.delete(tokenId);
        }
    }

    if (byToken.size === 0) {
        closeDetailPanel();
        if (activeReactionDialog) {
            activeReactionDialog.close();
            activeReactionDialog = null;
        }
        return;
    }

    let tokenItems = "";
    for (const [tokenId, data] of byToken) {
        const token = data.token;
        const reactionCount = token.actor?.system?.action_tracker?.reaction || 0;

        let reactionList = "";
        for (const r of data.reactions) {
            const isGeneral = r.isGeneral || false;
            const isActionBased = isGeneral && r.reaction?.onlyOnSourceMatch;
            const itemId = r.item?.id || '';
            const itemName = isGeneral ? 'General' : r.itemName;

            let icon = 'fa-eye';
            let iconColor = '#cc3333';

            if (isActionBased) {
                icon = 'fa-angles-right';
                iconColor = '#cc9933';
            } else if (isGeneral) {
                icon = 'fa-globe';
                iconColor = '#3366cc';
            }

            reactionList += `
            <div class="lancer-reaction-item"
                 data-token-id="${tokenId}"
                 data-item-id="${itemId}"
                 data-reaction-name="${r.reactionName}"
                 data-general="${isGeneral}"
                 data-action-based="${isActionBased}">
                <i class="fas ${icon}" style="color: ${iconColor}; margin-right: 6px;"></i>
                <span class="lancer-reaction-name">${r.reactionName}</span>
                ${(!isGeneral && r.reactionName !== r.itemName) ? `<span class="lancer-reaction-source">(${r.itemName})</span>` : ''}
            </div>`;
        }

        tokenItems += `
        <div class="lancer-list-item" data-token-id="${tokenId}">
            <img src="${token.document.texture.src}" width="36" height="36" style="margin-right:10px; border: 1px solid #991e2a; border-radius: 4px; background: #000; cursor: pointer;">
            <div class="lancer-item-content">
                <div class="lancer-item-name">${token.name}</div>
                <div class="lancer-item-details">${data.reactions.length} reaction(s) available</div>
            </div>
        </div>
        <div class="lancer-reactions-sublist">
            ${reactionList}
        </div>`;
    }

    const triggerDisplay = triggerType.replace('on', '').toUpperCase();

    const html = `
    <style>
        .lancer-reaction-item {
            padding: 4px 10px 4px 46px;
            margin: 2px 0;
            background: rgba(153, 30, 42, 0.15);
            border-left: 3px solid #991e2a;
            cursor: pointer;
            display: flex;
            align-items: center;
        }
        .lancer-reaction-item:hover, .lancer-reaction-item.selected {
            background: rgba(153, 30, 42, 0.4);
        }
        .lancer-reaction-name {
            font-weight: bold;
        }
        .lancer-reaction-source {
            color: #888;
            font-size: 0.9em;
            margin-left: 5px;
        }
        .lancer-reactions-sublist {
            margin-bottom: 8px;
        }
        .reaction-exhausted {
            opacity: 0.5;
        }
        .reaction-exhausted .lancer-item-name {
            text-decoration: line-through;
        }
    </style>
    <div class="lancer-dialog-base">
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">${triggerDisplay} TRIGGERED</div>
            <div class="lancer-dialog-subtitle">The following Actions may be activated</div>
        </div>

        <div class="lancer-list">
            ${tokenItems}
        </div>

        <div class="lancer-info-box">
            <i class="fas fa-bolt"></i>
            <span>Click a reaction to view details.</span>
        </div>
    </div>`;

    if (activeReactionDialog) {
        activeReactionDialog.close();
    }

    activeReactionDialog = new Dialog({
        title: `Activation Opportunity: ${triggerDisplay}`,
        content: html,
        buttons: {
            ok: { label: "ACKNOWLEDGE" }
        },
        default: "ok",
        render: (htmlEl) => {
            htmlEl.find('.lancer-list-item').click((event) => {
                if (event.target.closest('.lancer-reaction-item')) return;

                event.stopPropagation();
                const tokenId = event.currentTarget.dataset.tokenId;
                const token = canvas.tokens.get(tokenId);
                if (token) {
                    token.control({ releaseOthers: true });
                    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
                }
            });

            htmlEl.find('.lancer-reaction-item').click((event) => {
                const el = event.currentTarget;
                const tokenId = el.dataset.tokenId;
                const itemId = el.dataset.itemId;
                const isGeneral = el.dataset.general === 'true';
                const reactionName = el.dataset.reactionName;

                const token = canvas.tokens.get(tokenId);

                let item = null;
                let reactionData = null;
                let triggerData = null;

                if (isGeneral) {
                    reactionData = triggeredReactions.find(r =>
                        r.token.id === tokenId && r.isGeneral && r.reactionName === reactionName
                    );
                    triggerData = reactionData?.triggerData;
                } else {
                    const reactionEntry = triggeredReactions.find(r =>
                        r.token.id === tokenId && !r.isGeneral && r.item?.id === itemId
                    );
                    item = reactionEntry?.item;
                    triggerData = reactionEntry?.triggerData;
                    if (!item) return;
                }

                htmlEl.find('.lancer-reaction-item').removeClass('selected');
                el.classList.add('selected');

                showDetailPanel(token, item, htmlEl, popupData, reactionData, triggerData);
            });
        },
        close: () => {
            closeDetailPanel();
            activeReactionDialog = null;
        }
    }, { top: 450, left: 150 });

    activeReactionDialog.render(true);
}
