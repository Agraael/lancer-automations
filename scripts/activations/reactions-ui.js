/*global console, game, Dialog, canvas, $, foundry */
import { ReactionManager, stringToAsyncFunction } from "./reaction-manager.js";
import { hasReactionAvailable } from "../tools/misc-tools.js";
import { runInFlowBody } from "./flow-queue.js";

let activeReactionDialog = null;
let activeDetailPanel = null;
let selectedReactionKey = null;

function runCustomActivation({ activationType, source, triggerType, triggerData, token, item, activationName })
{
    if (activationType === "macro")
    {
        const macroName = source?.activationMacro;
        if (macroName)
        {
            const macro = game.macros.find(entry => entry.name === macroName);
            if (macro)
                return macro.execute({ triggerType, triggerData, reactorToken: token, item, activationName });
            else
                ui.notifications.warn(`Macro "${macroName}" not found`);
        }
    }
    else if (activationType === "code")
    {
        const code = source?.activationCode;
        if (code)
        {
            const api = game.modules.get('lancer-automations')?.api;
            const invoke = typeof code === 'function'
                ? () => code(triggerType, triggerData, token, item, activationName, api)
                : (typeof code === 'string'
                    ? () =>
                    {
                        const lid = item?.system?.lid;
                        const registryReactions = lid ? ReactionManager.getReactions(lid)?.reactions : null;
                        const sourceName = lid
                            ? `${lid}/${Math.max(0, registryReactions?.indexOf(source) ?? 0)}/activation`
                            : `${activationName || 'activation'}/activation`;
                        const fn = stringToAsyncFunction(code, ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], sourceName);
                        return fn(triggerType, triggerData, token, item, activationName, api);
                    }
                    : null);
            if (invoke)
            {
                return runInFlowBody(invoke).catch(error =>
                {
                    console.error(`lancer-automations | Error executing activation code:`, error);
                });
            }
        }
    }
}

export function activateReaction(triggerType, triggerData, token, item, activationName, reaction, isGeneral)
{
    // Silent code auto-activations show no UI, so don't steal control from the current token.
    const isSilentCode = reaction?.autoActivate && reaction?.activationType === 'code';
    if (!isSilentCode)
        token.control({ releaseOthers: true });

    if (item)
    {
        const lid = item.system?.lid;
        const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;
        const reactionEntry = reaction || reactionConfig?.reactions?.[0];

        const actionType = reactionEntry?.actionType || (reactionEntry?.isReaction !== false ? "Reaction" : "Free Action");
        const checkReaction = reactionEntry?.checkReaction !== false;

        const activationType = reactionEntry?.activationType || "flow";
        const activationMode = reactionEntry?.activationMode || "instead";

        const executeCustomActivation = () => runCustomActivation({
            activationType, source: reactionEntry, triggerType, triggerData, token, item, activationName
        });

        const itemActivation = async () =>
        {
            const reactionPath = reactionEntry?.reactionPath;
            let activationPath = null;

            if (reactionPath)
                activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;

            if (activationPath)
                await item.beginActivationFlow(activationPath);
            else if (item.system?.actions?.length > 0)
            {
                const actionIndex = item.system.actions.findIndex(action => action.activation === 'Reaction');
                const path = actionIndex >= 0 ? `system.actions.${actionIndex}` : 'system.actions.0';
                await item.beginActivationFlow(path);
            }
            else if (item.beginSystemFlow && item.system.type !== "Weapon" && !item.is_mech_weapon?.() && !item.is_pilot_weapon?.())
                await item.beginSystemFlow();
            else
            {
                const sendUnknownToChatFlow = game.lancer?.flows?.get("SendUnknownToChat");
                if (sendUnknownToChatFlow)
                {
                    new sendUnknownToChatFlow(item.uuid, {
                        title: item.name,
                        description: item.system.description,
                        trigger: item.system.trigger,
                        effect: item.system.effect,
                        onHit: item.system.on_hit,
                        onCrit: item.system.on_crit,
                        tags: item.system.tags
                    }).begin();
                }
                else
                    game.modules.get('lancer-automations').api.executeSimpleActivation(token.actor, { title: item.name, action: { name: item.name } }, { item: item });
            }
        };

        // Re-activating the same item that triggered us would loop via onActivation/onInitActivation.
        const wouldRecurse = (triggerType === 'onActivation' || triggerType === 'onInitActivation')
            && triggerData?.item?.uuid
            && triggerData.item.uuid === item?.uuid;
        const recurseGuardMatters = activationType === "flow"
            || ((activationType === "macro" || activationType === "code") && activationMode !== "instead");
        if (wouldRecurse && recurseGuardMatters)
            console.warn(`lancer-automations | Skipping itemActivation for "${item?.name}" to avoid onActivation recursion (reaction on same item). Using macro/code activation only.`);

        if (activationType === "none")
        { /* empty */ }
        else if (activationType === "flow")
        {
            if (wouldRecurse)
                return;
            return itemActivation();
        }
        else if (activationType === "macro" || activationType === "code")
        {
            if (activationMode === "instead" || wouldRecurse)
                return executeCustomActivation();
            else
            {
                const itemActivationResult = itemActivation();
                const customActivationResult = executeCustomActivation();
                if (itemActivationResult instanceof Promise || customActivationResult instanceof Promise)
                    return Promise.all([itemActivationResult || Promise.resolve(), customActivationResult || Promise.resolve()]);
            }
        }
    }
    else
    {
        const actor = token.actor;
        const registryEntry = ReactionManager.getGeneralReaction(activationName);
        const generalReaction = (registryEntry && !Array.isArray(registryEntry.reactions)) ? registryEntry : (reaction || registryEntry);

        const isReactionTypeResult = generalReaction?.actionType ? (generalReaction.actionType === "Reaction") : (generalReaction?.isReaction !== false);
        const actionType = generalReaction?.actionType || (isReactionTypeResult ? "Reaction" : "Free Action");
        const checkReaction = generalReaction?.checkReaction !== false;

        const activationType = generalReaction?.activationType || "flow";
        const activationMode = generalReaction?.activationMode || "after";

        const executeCustomActivation = () => runCustomActivation({
            activationType, source: generalReaction, triggerType, triggerData, token, item: null, activationName
        });

        const showChatActivation = async () =>
        {
            if (!actor)
            {
                console.warn(`lancer-automations | "${activationName}": a scene reactor has no actor to post a flow for, use activation type code or none.`);
                return;
            }
            let flowData;
            if (generalReaction?.onlyOnSourceMatch && triggerData?.actionData)
            {
                const actionData = triggerData.actionData;
                flowData = {
                    title: actionData.title || activationName,
                    action: {
                        name: actionData.action?.name || activationName,
                        activation: actionData.action?.activation || actionType
                    },
                    detail: actionData.detail || "No description"
                };
            }
            else
            {
                const triggerText = generalReaction?.triggerDescription || "No trigger description";
                const effectText = generalReaction?.effectDescription || "No effect description";
                flowData = {
                    title: activationName,
                    action: {
                        name: activationName,
                        activation: actionType
                    },
                    detail: `<strong>Trigger:</strong> ${triggerText}<br><strong>Effect:</strong> ${effectText}`
                };
            }

            await game.modules.get('lancer-automations').api.executeSimpleActivation(actor, flowData);
        };

        if (activationType === "none")
        { /* empty */ }
        else if (activationType === "flow")
            return showChatActivation();
        else if (activationType === "macro" || activationType === "code")
        {
            if (activationMode === "instead")
                return executeCustomActivation();
            else
            {
                const chatActivationResult = showChatActivation();
                const customActivationResult = executeCustomActivation();
                if (chatActivationResult instanceof Promise || customActivationResult instanceof Promise)
                    return Promise.all([chatActivationResult || Promise.resolve(), customActivationResult || Promise.resolve()]);
            }
        }
    }

}

export function displayReactionPopup(triggerType, triggeredReactions)
{
    if (triggeredReactions.length === 0)
        return;

    const popupData = { triggerType, triggeredReactions };
    renderReactionDialog(popupData);
}

function closeDetailPanel()
{
    if (activeDetailPanel)
    {
        activeDetailPanel.animate(
            { opacity: 0, left: '-=20px' },
            150,
            function ()
            {
                $(this).remove();
            }
        );
        activeDetailPanel = null;
        selectedReactionKey = null;
    }
}

function showDetailPanel(token, item, mainDialogEl, popupData, reactionData = null, triggerData = null)
{
    const isGeneral = reactionData?.isGeneral || false;
    const reactionKey = isGeneral ? `${token.id}-general-${reactionData.reactionName}` : `${token.id}-${item.id}`;

    if (selectedReactionKey === reactionKey)
    {
        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');
        return;
    }

    if (activeDetailPanel)
    {
        activeDetailPanel.remove();
        activeDetailPanel = null;
    }

    selectedReactionKey = reactionKey;

    let triggerText = "";
    let effectText = "";
    let activationPath = null;
    let panelActivationName = "Unknown";
    let isReactionType = true;
    let actionType = "Reaction";
    let frequency = "1/Round";

    if (isGeneral)
    {
        panelActivationName = reactionData.reactionName;
        const generalReaction = ReactionManager.getGeneralReaction(reactionData.reactionName) ?? reactionData.reaction ?? null;

        if (generalReaction?.onlyOnSourceMatch && triggerData?.actionData)
        {
            const actionData = triggerData.actionData;
            if (actionData.action)
            {
                triggerText = generalReaction?.triggerDescription || actionData.action.trigger || "";
                effectText = generalReaction?.effectDescription || actionData.detail || actionData.action.detail || "";
            }
            else
            {
                triggerText = generalReaction?.triggerDescription || "";
                effectText = generalReaction?.effectDescription || actionData.detail || "";
            }
        }
        else
        {
            triggerText = generalReaction?.triggerDescription || "";
            effectText = generalReaction?.effectDescription || "";
        }

        isReactionType = generalReaction?.actionType ? (generalReaction.actionType === "Reaction") : (generalReaction?.isReaction !== false);
        actionType = generalReaction?.actionType || (isReactionType ? "Reaction" : "Free Action");
        frequency = generalReaction?.frequency || "1/Round";
    }
    else if (item)
    {
        const lid = item.system?.lid;
        const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;

        const specificReaction = reactionData?.reaction;
        const reactionEntry = specificReaction || reactionConfig?.reactions?.[0];

        const reactionPath = reactionEntry?.reactionPath || "system";
        isReactionType = reactionEntry?.actionType ? (reactionEntry.actionType === "Reaction") : (reactionEntry?.isReaction !== false);
        actionType = reactionEntry?.actionType || (isReactionType ? "Reaction" : "Free Action");
        frequency = reactionEntry?.frequency || "1/Round";

        const resolvePath = (obj, path) =>
        {
            if (!path)
                return undefined;
            const cleanPath = path.replaceAll(/\[(\d+)\]/g, '.$1').replace(/^\./, '');

            let resolved = foundry.utils.getProperty(obj, cleanPath);
            if (resolved !== undefined)
                return resolved;

            if (!cleanPath.startsWith("system."))
                resolved = foundry.utils.getProperty(obj, `system.${cleanPath}`);
            return resolved;
        };

        const resolvedData = resolvePath(item, reactionPath);
        const rootSystem = item.system;

        if (typeof resolvedData === 'string')
        {
            triggerText = resolvedData;

            if (rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit)
                effectText = rootSystem.effect || rootSystem.on_hit || rootSystem.on_crit;

            activationPath = null;
        }
        else if (typeof resolvedData === 'object' && resolvedData !== null)
        {
            triggerText = resolvedData.trigger || resolvedData.description || "";

            effectText = resolvedData.effect || resolvedData.on_hit || resolvedData.on_crit || resolvedData.detail || rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit || "";

            activationPath = reactionPath.startsWith("system.") ? reactionPath : `system.${reactionPath}`;
        }
        else
        {
            if (rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit)
                effectText = rootSystem.effect || rootSystem.on_hit || rootSystem.on_crit;
        }

        if (reactionEntry?.triggerDescription)
            triggerText = reactionEntry.triggerDescription;
        if (reactionEntry?.effectDescription)
            effectText = reactionEntry.effectDescription;

        panelActivationName = item.name;
    }

    const html = `
    <div id="reaction-detail-panel" style="
        position: fixed;
        background: #23272a;
        border: 1px solid var(--primary-color);
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
            <span style="font-weight: bold; font-size: 1.1em; color: #fff;">${panelActivationName}</span>
            <span class="detail-close" style="cursor: pointer; color: #888;">&times; Close</span>
        </div>

        ${triggerText ? `
        <div style="margin-bottom: 12px;">
            <div style="background: var(--primary-color); color: white; padding: 2px 8px; border-radius: 2px; display: inline-block; font-size: 0.8em; font-weight: bold; margin-bottom: 4px;">
                TRIGGER
            </div>
            <div style="padding: 6px 8px; background: rgba(0,0,0,0.4); border-left: 2px solid var(--primary-color); color: #ccc;">
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
                        `<span style="background: color-mix(in srgb, var(--primary-color), transparent 70%); padding: 2px 8px; border-radius: 10px;">
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
            background: var(--primary-color);
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
    if (mainDialog.length)
    {
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

    activeDetailPanel.find('.detail-close').click(() =>
    {
        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');
    });

    activeDetailPanel.find('.activate-btn').click(async () =>
    {
        let reaction = null;
        if (item)
        {
            const lid = item.system?.lid;
            const reactionConfig = lid ? ReactionManager.getReactions(lid) : null;

            const specificReaction = reactionData?.reaction;
            reaction = specificReaction || reactionConfig?.reactions?.[0];
        }
        else
            reaction = ReactionManager.getGeneralReaction(panelActivationName) ?? reactionData?.reaction ?? null;

        await activateReaction(popupData.triggerType, triggerData, token, item, panelActivationName, reaction, isGeneral);

        closeDetailPanel();
        mainDialogEl.find('.lancer-reaction-item').removeClass('selected');

        const reactionCount = Number(token.actor?.system?.action_tracker?.reaction || 0);
        if (reactionCount <= 0)
        {
            const tokenBox = mainDialogEl.find(`.lancer-list-item[data-token-id="${token.id}"]`);
            tokenBox.addClass('reaction-exhausted');
            tokenBox.find('img').css('filter', 'grayscale(100%)');
        }
    });
}

// Scene stand-ins are not on the canvas, so the popup keeps its own id-to-reactor lookup.
const reactorsById = new Map();

function renderReactionDialog(popupData)
{
    const { triggerType, triggeredReactions } = popupData;

    const byToken = new Map();
    reactorsById.clear();
    for (const entry of triggeredReactions)
    {
        reactorsById.set(entry.token.id, entry.token);
        if (!byToken.has(entry.token.id))
        {
            byToken.set(entry.token.id, {
                token: entry.token,
                reactions: []
            });
        }
        byToken.get(entry.token.id).reactions.push(entry);
    }

    for (const [tokenId, tokenEntry] of byToken)
    {
        const actor = tokenEntry.token.actor;
        const hasReaction = hasReactionAvailable(actor);
        if (!hasReaction)
            byToken.delete(tokenId);
    }

    if (byToken.size === 0)
    {
        closeDetailPanel();
        if (activeReactionDialog)
        {
            activeReactionDialog.close();
            activeReactionDialog = null;
        }
        return;
    }

    let tokenItemsHtml = "";
    for (const [tokenId, tokenEntry] of byToken)
    {
        const token = tokenEntry.token;
        const reactionCount = Number(token.actor?.system?.action_tracker?.reaction || 0);

        let reactionList = "";
        for (const reaction of tokenEntry.reactions)
        {
            const isGeneral = reaction.isGeneral || false;
            const isActionBased = isGeneral && reaction.reaction?.onlyOnSourceMatch;
            const itemId = reaction.item?.id || '';
            const itemName = isGeneral ? 'General' : reaction.itemName;

            let icon = 'fa-eye';
            let iconColor = '#cc3333';

            if (isActionBased)
            {
                icon = 'fa-angles-right';
                iconColor = '#cc9933';
            }
            else if (isGeneral)
            {
                icon = 'fa-globe';
                iconColor = '#3366cc';
            }

            reactionList += `
            <div class="lancer-reaction-item"
                 data-token-id="${tokenId}"
                 data-item-id="${itemId}"
                 data-reaction-name="${reaction.reactionName}"
                 data-general="${isGeneral}"
                 data-action-based="${isActionBased}">
                <i class="fas ${icon}" style="color: ${iconColor}; margin-right: 6px;"></i>
                <span class="lancer-reaction-name">${reaction.reactionName}</span>
                ${(!isGeneral && reaction.reactionName !== reaction.itemName) ? `<span class="lancer-reaction-source">(${reaction.itemName})</span>` : ''}
            </div>`;
        }

        tokenItemsHtml += `
        <div class="lancer-list-item" data-token-id="${tokenId}">
            <img src="${token.document.texture.src}" width="36" height="36" style="margin-right:10px; border: 1px solid var(--primary-color); border-radius: 4px; background: #000; cursor: pointer;">
            <div class="lancer-item-content">
                <div class="lancer-item-name">${token.name}</div>
                <div class="lancer-item-details">${tokenEntry.reactions.length} reaction(s) available</div>
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
            background: color-mix(in srgb, var(--primary-color), transparent 85%);
            border-left: 3px solid var(--primary-color);
            cursor: pointer;
            display: flex;
            align-items: center;
        }
        .lancer-reaction-item:hover, .lancer-reaction-item.selected {
            background: color-mix(in srgb, var(--primary-color), transparent 60%);
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
            ${tokenItemsHtml}
        </div>

        <div class="lancer-info-box">
            <i class="fas fa-bolt"></i>
            <span>Click a reaction to view details.</span>
        </div>
    </div>`;

    if (activeReactionDialog)
        activeReactionDialog.close();

    activeReactionDialog = new Dialog({
        title: `Activation Opportunity: ${triggerDisplay}`,
        content: html,
        buttons: {
            ok: { label: "ACKNOWLEDGE" }
        },
        default: "ok",
        render: (htmlEl) =>
        {
            htmlEl.find('.lancer-list-item').click((event) =>
            {
                if (event.target.closest('.lancer-reaction-item'))
                    return;

                event.stopPropagation();
                const tokenId = event.currentTarget.dataset.tokenId;
                const token = canvas.tokens.get(tokenId);
                if (token)
                {
                    token.control({ releaseOthers: true });
                    canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 250 });
                }
            });

            htmlEl.find('.lancer-reaction-item').click((event) =>
            {
                const el = event.currentTarget;
                const tokenId = el.dataset.tokenId;
                const itemId = el.dataset.itemId;
                const isGeneral = el.dataset.general === 'true';
                const reactionName = el.dataset.reactionName;

                const token = canvas.tokens.get(tokenId) ?? reactorsById.get(tokenId);

                let item = null;
                let reactionData = null;
                let triggerData = null;

                if (isGeneral)
                {
                    reactionData = triggeredReactions.find(entry =>
                        entry.token.id === tokenId && entry.isGeneral && entry.reactionName === reactionName
                    );
                    triggerData = reactionData?.triggerData;
                }
                else
                {
                    const reactionEntry = triggeredReactions.find(entry =>
                        entry.token.id === tokenId && !entry.isGeneral && entry.item?.id === itemId && entry.reactionName === reactionName
                    );
                    item = reactionEntry?.item;
                    triggerData = reactionEntry?.triggerData;
                    reactionData = reactionEntry;
                    if (!item)
                        return;
                }

                htmlEl.find('.lancer-reaction-item').removeClass('selected');
                el.classList.add('selected');

                showDetailPanel(token, item, htmlEl, popupData, reactionData, triggerData);
            });

            htmlEl.find('.lancer-reaction-item').on('contextmenu', (event) =>
            {
                event.preventDefault();
                const el = event.currentTarget;
                if (el.dataset.general === 'true')
                    return;
                const tokenId = el.dataset.tokenId;
                const itemId = el.dataset.itemId;
                const token = canvas.tokens.get(tokenId);
                const item = token?.actor?.items.get(itemId);
                if (item)
                    item.sheet.render(true);
            });
        },
        close: () =>
        {
            closeDetailPanel();
            activeReactionDialog = null;
            if (!_suppressCloseEmit)
            {
                try
                {
                    game.socket.emit('module.lancer-automations', {
                        action: 'closeReactionPopup',
                        payload: {}
                    });
                }
                catch
                { /* ignore */ }
            }
        }
    }, { top: 450, left: 150, classes: ['dialog', 'lancer-dialog-base', 'lancer-no-title']});

    activeReactionDialog.render(true);
}

let _suppressCloseEmit = false;
export function closeReactionPopupFromRemote()
{
    if (!activeReactionDialog)
        return;
    _suppressCloseEmit = true;
    try
    {
        activeReactionDialog.close();
    }
    catch
    { /* ignore */ }
    _suppressCloseEmit = false;
}
