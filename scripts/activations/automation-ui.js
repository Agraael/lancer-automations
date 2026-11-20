/*global console, game, Dialog, canvas, $, foundry */
import { AutomationManager, stringToAsyncFunction, ACTIVATION_TRIGGERS, declaredActionType } from "./automation-manager.js";
import { MODULE_ID } from "../tools/constants.js";
import { hasReactionAvailable } from "../tools/misc-tools.js";
import { runInFlowBody } from "./flow-queue.js";
import { escapeHtml, localize, localizeFormat } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { getCornerStack } from "../tools/corner-stack.js";

const LANE_ID = 'la-reaction-lane';
const UPLINK_ID = 'la-uplink-panel';
const CLOCKS_ID = 'la-world-clocks';
const LANE_MIN_OPEN = 120;

let activeDetailPanel = null;
let selectedAutomationKey = null;
let laneEl = null;
let laneRows = [];
let laneOpen = null;
let laneFrame = 0;
let laneWatch = null;

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
                ui.notifications.warn(localizeFormat('LA.notify.macroNotFound', { name: macroName }));
        }
    }
    else if (activationType === "code")
    {
        const code = source?.activationCode;

        if (code)
        {
            const api = game.modules.get(MODULE_ID)?.api;

            const invoke = typeof code === 'function'
                ? () => code(triggerType, triggerData, token, item, activationName, api)
                : (typeof code === 'string'
                    ? () =>
                    {
                        const lid = item?.system?.lid;
                        const registryAutomations = lid ? AutomationManager.getAutomations(lid)?.reactions : null;

                        const sourceName = lid
                            ? `${lid}/${Math.max(0, registryAutomations?.indexOf(source) ?? 0)}/activation`
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

export function activateAutomation(triggerType, triggerData, token, item, activationName, automation, isGeneral)
{
    // Silent code auto-activations show no UI, so don't steal control from the current token.
    const isSilentCode = automation?.autoActivate && automation?.activationType === 'code';
    if (!isSilentCode)
        token.control({ releaseOthers: true });

    if (item)
    {
        const lid = item.system?.lid;
        const reactionConfig = lid ? AutomationManager.getAutomations(lid) : null;
        const automationEntry = automation || reactionConfig?.reactions?.[0];

        const activationType = automationEntry?.activationType || "flow";
        const activationMode = automationEntry?.activationMode || "instead";

        const executeCustomActivation = () => runCustomActivation({
            activationType, source: automationEntry, triggerType, triggerData, token, item, activationName
        });

        const itemActivation = async () =>
        {
            const reactionPath = automationEntry?.reactionPath;
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
                    game.modules.get(MODULE_ID).api.executeSimpleActivation(token.actor, { title: item.name, action: { name: item.name } }, { item: item });
            }
        };

        // Re-activating the same item that triggered us would loop via onActivation/onInitActivation.
        const wouldRecurse = ACTIVATION_TRIGGERS.has(triggerType)
            && triggerData?.item?.uuid
            && triggerData.item.uuid === item?.uuid;

        const recurseGuardMatters = activationType === "flow"
            || ((activationType === "macro" || activationType === "code") && activationMode !== "instead");

        if (wouldRecurse && recurseGuardMatters)
            console.warn(`lancer-automations | Skipping itemActivation for "${item?.name}" to avoid onActivation recursion (automation on same item). Using macro/code activation only.`);

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
                    return Promise.all([itemActivationResult || Promise.resolve(), customActivationResult || Promise.resolve()]).then(([, custom]) => custom);
            }
        }
    }
    else
    {
        const actor = token.actor;
        const registryEntry = AutomationManager.getGeneralAutomation(activationName);
        const generalAutomation = (registryEntry && !Array.isArray(registryEntry.reactions)) ? registryEntry : (automation || registryEntry);

        const actionType = declaredActionType(generalAutomation);

        const activationType = generalAutomation?.activationType || "flow";
        const activationMode = generalAutomation?.activationMode || "after";

        const executeCustomActivation = () => runCustomActivation({
            activationType, source: generalAutomation, triggerType, triggerData, token, item: null, activationName
        });

        const showChatActivation = async () =>
        {
            if (!actor)
            {
                console.warn(`lancer-automations | "${activationName}": a scene reactor has no actor to post a flow for, use activation type code or none.`);
                return;
            }

            let flowData;

            if (generalAutomation?.onlyOnSourceMatch && triggerData?.actionData)
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
                const triggerText = generalAutomation?.triggerDescription || "No trigger description";
                const effectText = generalAutomation?.effectDescription || "No effect description";
                flowData = {
                    title: activationName,
                    action: {
                        name: activationName,
                        activation: actionType
                    },
                    detail: localizeFormat('LA.reaction.triggerEffectDetail', { trigger: triggerText, effect: effectText })
                };
            }

            await game.modules.get(MODULE_ID).api.executeSimpleActivation(actor, flowData);
        };

        const wouldRecurse = ACTIVATION_TRIGGERS.has(triggerType) && triggerData?.actionName === activationName;

        if (activationType === "none")
        { /* empty */ }
        else if (activationType === "flow")
        {
            if (wouldRecurse)
                return;
            return showChatActivation();
        }
        else if (activationType === "macro" || activationType === "code")
        {
            if (activationMode === "instead" || wouldRecurse)
                return executeCustomActivation();
            else
            {
                const chatActivationResult = showChatActivation();
                const customActivationResult = executeCustomActivation();

                if (chatActivationResult instanceof Promise || customActivationResult instanceof Promise)
                    return Promise.all([chatActivationResult || Promise.resolve(), customActivationResult || Promise.resolve()]).then(([, custom]) => custom);
            }
        }
    }

}

export function displayAutomationPopup(triggerType, triggeredAutomations)
{
    let added = false;

    for (const entry of [...triggeredAutomations].reverse())
    {
        if ((!entry.isGeneral && !entry.item) || !hasReactionAvailable(entry.token.actor ?? entry.token))
            continue;

        const key = `${entry.token.id}|${entry.isGeneral ? 'general' : entry.item?.id ?? ''}|${entry.reactionName}`;
        laneRows = laneRows.filter(row => row.key !== key);
        laneRows.unshift({ key, entry, triggerType: entry.triggerType ?? triggerType });
        added = true;
    }

    if (added)
        renderLane();
}

function closeDetailPanel()
{
    laneEl?.querySelector('.la-rx-strip--selected')?.classList.remove('la-rx-strip--selected');

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
        selectedAutomationKey = null;
    }
}

function showDetailPanel(row, rowEl)
{
    const automationData = row.entry;
    const { triggerData } = automationData;
    const isGeneral = automationData.isGeneral || false;
    const item = isGeneral ? null : automationData.item;
    const automationKey = row.key;

    if (selectedAutomationKey === automationKey)
    {
        closeDetailPanel();
        return;
    }

    if (activeDetailPanel)
    {
        activeDetailPanel.remove();
        activeDetailPanel = null;
    }

    selectedAutomationKey = automationKey;

    let triggerText = "";
    let effectText = "";
    let panelActivationName = "Unknown";
    let actionType = "Automation";
    let frequency = "1/Round";

    if (isGeneral)
    {
        panelActivationName = automationData.reactionName;
        const generalAutomation = automationData.reaction ?? AutomationManager.getGeneralAutomation(automationData.reactionName) ?? null;

        if (generalAutomation?.onlyOnSourceMatch && triggerData?.actionData)
        {
            const actionData = triggerData.actionData;

            if (actionData.action)
            {
                triggerText = generalAutomation?.triggerDescription || actionData.action.trigger || "";
                effectText = generalAutomation?.effectDescription || actionData.detail || actionData.action.detail || "";
            }
            else
            {
                triggerText = generalAutomation?.triggerDescription || "";
                effectText = generalAutomation?.effectDescription || actionData.detail || "";
            }
        }
        else
        {
            triggerText = generalAutomation?.triggerDescription || "";
            effectText = generalAutomation?.effectDescription || "";
        }

        actionType = declaredActionType(generalAutomation);
        frequency = generalAutomation?.frequency || "1/Round";
    }
    else if (item)
    {
        const lid = item.system?.lid;
        const reactionConfig = lid ? AutomationManager.getAutomations(lid) : null;

        const specificAutomation = automationData?.reaction;
        const automationEntry = specificAutomation || reactionConfig?.reactions?.[0];

        const reactionPath = automationEntry?.reactionPath || "system";
        actionType = declaredActionType(automationEntry);
        frequency = automationEntry?.frequency || "1/Round";

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
        }
        else if (typeof resolvedData === 'object' && resolvedData !== null)
        {
            triggerText = resolvedData.trigger || resolvedData.description || "";

            effectText = resolvedData.effect || resolvedData.on_hit || resolvedData.on_crit || resolvedData.detail || rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit || "";
        }
        else
        {
            if (rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit)
                effectText = rootSystem.effect || rootSystem.on_hit || rootSystem.on_crit;
        }

        if (automationEntry?.triggerDescription)
            triggerText = automationEntry.triggerDescription;
        if (automationEntry?.effectDescription)
            effectText = automationEntry.effectDescription;

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

    document.body.insertAdjacentHTML('beforeend', html);
    activeDetailPanel = $(document.body.lastElementChild);

    laneEl.querySelector('.la-rx-strip--selected')?.classList.remove('la-rx-strip--selected');
    rowEl.classList.add('la-rx-strip--selected');

    const rowRect = rowEl.getBoundingClientRect();
    const laneRect = laneEl.getBoundingClientRect();

    activeDetailPanel.css({
        top: `${Math.max(10, Math.min(rowRect.top, window.innerHeight - activeDetailPanel.outerHeight() - 10))}px`,
        left: `${Math.max(10, laneRect.left - activeDetailPanel.outerWidth() - 10)}px`
    });

    activeDetailPanel.animate(
        { opacity: 1 },
        200
    );

    activeDetailPanel.find('.detail-close').click(closeDetailPanel);

    activeDetailPanel.find('.activate-btn').click(() =>
    {
        closeDetailPanel();
        useReminder(row);
    });
}

async function useReminder(row)
{
    const { entry } = row;
    const token = entry.token;

    removeLaneRows(other => other === row);

    if (!hasReactionAvailable(token))
    {
        ui.notifications.warn(localizeFormat('LA.notify.noReactionAvailable', { name: token.name }));
        pruneExhaustedReactors();
        return;
    }

    const item = entry.isGeneral ? null : entry.item;
    const activationName = item ? item.name : entry.reactionName;

    const automation = item
        ? entry.reaction || AutomationManager.getAutomations(item.system?.lid)?.reactions?.[0]
        : entry.reaction ?? AutomationManager.getGeneralAutomation(activationName) ?? null;

    await activateAutomation(row.triggerType, entry.triggerData, token, item, activationName, automation, !!entry.isGeneral);
    pruneExhaustedReactors();
}

let _trackerHook = null;

// The reaction is spent well after activateAutomation resolves, so the lane prunes on the tracker change itself.
function pruneExhaustedReactors()
{
    removeLaneRows(row => !hasReactionAvailable(row.entry.token.actor ?? row.entry.token));
}

function watchReactionTracker()
{
    if (_trackerHook !== null)
        return;
    _trackerHook = Hooks.on('updateActor', (_actor, changes) =>
    {
        if (foundry.utils.getProperty(changes, 'system.action_tracker.reaction') !== undefined)
            pruneExhaustedReactors();
    });
}

function unwatchReactionTracker()
{
    if (_trackerHook === null)
        return;
    Hooks.off('updateActor', _trackerHook);
    _trackerHook = null;
}

function laneKindIcon(entry)
{
    if (entry.isGeneral && entry.reaction?.onlyOnSourceMatch)
        return 'fas fa-angles-right la-rx-kind--action';

    return entry.isGeneral ? 'fas fa-globe la-rx-kind--general' : 'fas fa-eye la-rx-kind--item';
}

function laneStripHtml(row, attrs, extra = 0)
{
    const { entry } = row;
    const source = !entry.isGeneral && entry.reactionName !== entry.itemName ? entry.itemName : '';
    const trigger = (row.triggerType ?? '').replace('on', '').toUpperCase();
    const sub = [entry.token.name, source, trigger].filter(Boolean).map(escapeHtml).join(' · ');
    const count = extra ? ` <em class="la-rx-count">+${extra}</em>` : '';
    const selected = !extra && row.key === selectedAutomationKey ? ' la-rx-strip--selected' : '';
    const action = localize(extra ? 'LA.reaction.lane.open' : 'LA.reaction.lane.use');

    return `<div class="la-rx-strip${selected}" ${attrs}><img src="${escapeHtml(entry.token.document.texture.src)}" alt="" data-rx-pan><span class="la-rx-text"><b><i class="${laneKindIcon(entry)}"></i> ${escapeHtml(entry.reactionName)}${count}</b><small>${sub}</small></span><span class="la-rx-use" data-rx-use>${action}</span><span class="la-rx-x" data-rx-dismiss data-tooltip="${localize('LA.reaction.lane.dismiss')}"><i class="fas fa-times"></i></span></div>`;
}

const laneRowHtml = index => laneStripHtml(laneRows[index], `data-rx-index="${index}"`);

function laneGroups()
{
    const groups = new Map();

    laneRows.forEach((row, index) =>
    {
        const tokenId = row.entry.token.id;
        if (!groups.has(tokenId))
            groups.set(tokenId, []);
        groups.get(tokenId).push(index);
    });

    return [...groups].map(([tokenId, indexes]) => ({ tokenId, indexes }));
}

function laneGroupHtml(group)
{
    if (group.indexes.length === 1 || group.tokenId === laneOpen)
        return group.indexes.map(laneRowHtml).join('');

    return laneStripHtml(laneRows[group.indexes[0]], `data-rx-token="${group.tokenId}"`, group.indexes.length - 1);
}

function laneMoreHtml(rest)
{
    const count = rest.reduce((sum, group) => sum + group.indexes.length, 0);

    const text = rest.length === 1
        ? localizeFormat('LA.reaction.lane.moreOnToken', { count })
        : localizeFormat('LA.reaction.lane.moreOnTokens', { count, tokens: rest.length });

    return `<div class="la-rx-more" data-rx-more>${text}</div>`;
}

function laneHeadHtml(count = laneRows.length, open = laneOpen)
{
    if (count < 2)
        return '';

    const fold = open ? `<span data-rx-fold>${localize('LA.reaction.lane.fold')}</span>` : '';
    return `<div class="la-rx-head"><b>${localizeFormat('LA.reaction.lane.count', { count })}</b><span class="la-rx-head-links">${fold}<span data-rx-clear>${localize('LA.reaction.lane.clearAll')}</span></span></div>`;
}

export function automationLanePreview(rows)
{
    const lane = htmlToElement(`<div id="${LANE_ID}" class="la-rx-lane"></div>`);
    lane.innerHTML = laneHeadHtml(rows.length, null) + rows.map((row, index) => laneStripHtml(row, `data-rx-index="${index}"`)).join('');
    return lane;
}

function sideFloor(rect)
{
    const huds = [...(document.getElementById('hudzone')?.children ?? [])]
        .map(child => child.getBoundingClientRect())
        .filter(hud => hud.left < rect.right && hud.right > rect.left);

    return Math.min(window.innerHeight - 16, ...huds.map(hud => hud.top - 8));
}

function laneRoom()
{
    if (laneEl.classList.contains('la-rx-lane--side'))
    {
        const rect = laneEl.getBoundingClientRect();
        const scale = laneEl.offsetWidth ? rect.width / laneEl.offsetWidth : 1;
        return (sideFloor(rect) - rect.top) / scale;
    }

    const stack = laneEl.parentElement;
    const gap = Number.parseFloat(getComputedStyle(stack).rowGap) || 0;
    const others = [...stack.children].filter(child => child !== laneEl && child.getClientRects().length);

    const used = others.reduce((sum, child) =>
    {
        const bar = child.id === CLOCKS_ID ? child.querySelector('.lau-bar') : null;
        return sum + gap + Math.min(child.offsetHeight, bar?.offsetHeight ?? child.offsetHeight);
    }, 0);

    return stack.clientHeight - used;
}

function paintLane(body)
{
    laneEl.innerHTML = laneHeadHtml() + body;
    return laneEl.offsetHeight <= laneRoom() + 1;
}

function fitLane()
{
    const groups = laneGroups();
    const allRows = laneRows.map((_row, index) => laneRowHtml(index)).join('');
    const sides = document.getElementById(UPLINK_ID) ? [false, true] : [false];

    laneEl.style.removeProperty('max-height');
    laneEl.classList.remove('la-rx-lane--side', 'la-rx-lane--open');

    if (paintLane(allRows))
    {
        if (laneOpen)
        {
            laneOpen = null;
            paintLane(allRows);
        }

        return;
    }

    if (laneOpen)
    {
        laneEl.classList.add('la-rx-lane--open');
        paintLane(laneOpen === 'more' ? allRows : groups.map(laneGroupHtml).join(''));

        if (laneRoom() < LANE_MIN_OPEN && sides.length > 1)
            laneEl.classList.add('la-rx-lane--side');

        laneEl.style.maxHeight = `${Math.max(LANE_MIN_OPEN, laneRoom())}px`;
        return;
    }

    const forms = [groups.map(laneGroupHtml).join('')];

    for (let shown = groups.length - 1; shown >= 1; shown--)
        forms.push(groups.slice(0, shown).map(laneGroupHtml).join('') + laneMoreHtml(groups.slice(shown)));

    for (const side of sides)
    {
        laneEl.classList.toggle('la-rx-lane--side', side);
        if ((side ? [allRows, ...forms] : forms).some(paintLane))
            return;
    }

    laneEl.classList.remove('la-rx-lane--side');
    paintLane(forms.at(-1));
}

function scheduleLaneFit()
{
    if (laneFrame)
        return;

    laneFrame = requestAnimationFrame(() =>
    {
        laneFrame = 0;
        if (laneEl?.isConnected)
            fitLane();
    });
}

function watchLaneRoom()
{
    if (laneWatch)
        return;

    const stack = getCornerStack();
    const sizes = new ResizeObserver(scheduleLaneFit);

    const observeSizes = () =>
    {
        sizes.disconnect();
        [stack, ...stack.children].forEach(node => sizes.observe(node));
    };

    const changes = new MutationObserver(() =>
    {
        observeSizes();
        scheduleLaneFit();
    });

    changes.observe(stack, { childList: true, attributes: true, attributeFilter: ['style'] });
    const chat = document.getElementById('chat-notifications');
    if (chat)
        changes.observe(chat, { attributes: true, attributeFilter: ['class'] });

    observeSizes();
    window.addEventListener('resize', scheduleLaneFit);
    laneWatch = { sizes, changes };
}

function unwatchLaneRoom()
{
    if (!laneWatch)
        return;

    laneWatch.sizes.disconnect();
    laneWatch.changes.disconnect();
    window.removeEventListener('resize', scheduleLaneFit);
    cancelAnimationFrame(laneFrame);
    laneFrame = 0;
    laneWatch = null;
}

function renderLane()
{
    if (selectedAutomationKey && !laneRows.some(row => row.key === selectedAutomationKey))
        closeDetailPanel();

    if (laneOpen && laneOpen !== 'more' && !laneRows.some(row => row.entry.token.id === laneOpen))
        laneOpen = null;

    if (!laneRows.length)
    {
        unwatchLaneRoom();
        unwatchReactionTracker();
        laneEl?.remove();
        laneEl = null;
        laneOpen = null;
        return;
    }

    if (!laneEl?.isConnected)
    {
        unwatchLaneRoom();
        laneEl = htmlToElement(`<div id="${LANE_ID}" class="la-rx-lane"></div>`);
        laneEl.addEventListener('click', onLaneClick);
        laneEl.addEventListener('contextmenu', onLaneContext);
        getCornerStack().prepend(laneEl);
    }

    watchReactionTracker();
    watchLaneRoom();
    fitLane();
}

function removeLaneRows(predicate)
{
    const kept = laneRows.filter(row => !predicate(row));
    if (kept.length === laneRows.length)
        return;

    laneRows = kept;
    renderLane();
}

function clearLane()
{
    removeLaneRows(() => true);
}

function panToReactor(token)
{
    const placed = canvas.tokens?.get(token.id);
    if (!placed)
        return;

    placed.control({ releaseOthers: true });
    canvas.animatePan({ x: placed.center.x, y: placed.center.y, duration: 250 });
}

function onLaneClick(event)
{
    const target = event.target;

    if (target.closest('[data-rx-clear]'))
    {
        clearLane();
        return;
    }

    if (target.closest('[data-rx-fold]') || target.closest('[data-rx-more]'))
    {
        laneOpen = target.closest('[data-rx-more]') ? 'more' : null;
        renderLane();
        return;
    }

    const strip = target.closest('.la-rx-strip');
    const tokenId = strip?.dataset.rxToken;
    const row = strip && !tokenId ? laneRows[Number(strip.dataset.rxIndex)] : null;
    const token = row?.entry.token ?? laneRows.find(other => other.entry.token.id === tokenId)?.entry.token;

    if (!token)
        return;

    if (target.closest('[data-rx-dismiss]'))
        removeLaneRows(other => (row ? other === row : other.entry.token.id === tokenId));
    else if (target.closest('[data-rx-pan]'))
        panToReactor(token);
    else if (!row)
    {
        laneOpen = tokenId;
        renderLane();
    }
    else if (target.closest('[data-rx-use]'))
    {
        closeDetailPanel();
        useReminder(row);
    }
    else
        showDetailPanel(row, strip);
}

function onLaneContext(event)
{
    const strip = event.target.closest('.la-rx-strip[data-rx-index]');
    const row = strip ? laneRows[Number(strip.dataset.rxIndex)] : null;
    if (!row)
        return;

    event.preventDefault();
    if (!row.entry.isGeneral)
        row.entry.item?.sheet?.render(true);
}

Hooks.on('updateCombat', (combat, changed) =>
{
    if (!('turn' in changed || 'round' in changed))
        return;

    if ('round' in changed || combat.previous?.combatantId !== combat.current?.combatantId)
        clearLane();
});

Hooks.on('deleteCombat', () => clearLane());
Hooks.on('canvasReady', () => clearLane());
