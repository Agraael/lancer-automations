import { addItemFlags, removeItemFlags, getItemFlags } from "./document-flags.js";
import { lockActorAction, unlockActorAction } from "./action-locks.js";
import { pickItem } from "./item-picker.js";
import { MODULE_ID } from "../tools/constants.js";
import { localize, localizeFormat } from "../tools/string-utils.js";

/**
 * Marks an item as activated.
 * @param {Item} item - The item to mark natively
 * @param {Token} token - The token that owns the item (kept for signature compatibility)
 * @param {string} endAction - A string defining what action is used to end the activation (e.g. "Quick", "Full")
 * @param {string} [endActionDescription=""] - Optional text description shown when ending the activation
 * @param {Object} [options]
 * @param {boolean} [options.blockAction=true] - Lock the activated action while active
 * @param {string} [options.actionName] - Action to lock, defaults to the item name
 * @param {string} [options.blockReason] - Reason shown on the locked row
 * @returns {Promise<Item>} The updated item
 */
export async function setItemAsActivated(item, token, endAction, endActionDescription = "", options = {})
{
    if (!item)
    {
        ui.notifications.warn(localize('LA.notify.noItemProvidedToSetitemasactivated'));
        return null;
    }
    const blockedAction = options.blockAction === false ? null : (options.actionName ?? item.name);
    if (blockedAction)
        await lockActorAction(item, blockedAction, { reason: options.blockReason ?? `${item.name} is already active.` });
    return await addItemFlags(item, {
        activeStateData: {
            active: true,
            endAction: endAction,
            endActionDescription: endActionDescription,
            blockedAction: blockedAction
        }
    });
}

/**
 * Gets all activated items for a token.
 * @param {Token} token
 * @returns {Array<Item>} Array of activated items.
 */
export function getActivatedItems(token)
{
    if (!token?.actor)
        return [];
    const allItems = token.actor.items;
    return allItems.filter(item =>
    {
        const flags = getItemFlags(item);
        return flags?.activeStateData?.active === true;
    });
}

/**
 * Ends an item's activation. Removes the activated flags and posts a chat message (via SimpleActivationFlow).
 * @param {Item} item - The activated item
 * @param {Token} token - The token (needed for the flow)
 * @returns {Promise<boolean>} Whether the flow completed
 */
export async function endItemActivation(item, token)
{
    if (!item || !token?.actor)
        return false;

    const flags = getItemFlags(item);
    if (!flags?.activeStateData?.active)
        return false;

    const endAction = flags.activeStateData.endAction || "Unknown";
    const endActionDescription = flags.activeStateData.endActionDescription || "";
    const blockedAction = flags.activeStateData.blockedAction;

    await removeItemFlags(item, { activeStateData: true });
    if (blockedAction)
        await unlockActorAction(item, blockedAction);

    const api = game.modules.get(MODULE_ID)?.api;
    if (api?.executeSimpleActivation)
    {
        const result = await api.executeSimpleActivation(token.actor, {
            title: endActionDescription || `End ${item.name}`,
            action: { name: item.name, activation: endAction },
            detail: item.system?.effect || "",
            tags: item.system?.tags || []
        }, {
            item: item,
            endActivation: true
        });
        return result.completed;
    }
    return false;
}

/**
 * Opens a prompt to choose an activated item to end.
 * @param {Token} token - The token that has the activated items.
 * @returns {Promise<Item|null>} The item that was selected and ended, or null if canceled.
 */
export async function openEndActivationMenu(token)
{
    if (!token?.actor)
    {
        ui.notifications.warn(localize('LA.notify.noValidTokenSelected'));
        return null;
    }

    const activatedItems = getActivatedItems(token);
    if (activatedItems.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noActivatedItems', { name: token.name }));
        return null;
    }

    const chosenItem = await pickItem(activatedItems, {
        title: localize('LA.deployables.endItemActivationTitle'),
        description: localizeFormat('LA.deployables.selectActivatedToEnd', { name: token.name }),
        icon: "fas fa-power-off",
        formatText: (activatedItem) =>
        {
            const flags = getItemFlags(activatedItem);
            const actionText = flags?.activeStateData?.endAction ? ` [${flags.activeStateData.endAction}]` : "";
            return `${flags?.activeStateData?.endActionDescription || `End ${activatedItem.name}`}${actionText}`;
        }
    });

    if (chosenItem)
    {
        await endItemActivation(chosenItem, token);
        return chosenItem;
    }

    return null;
}
