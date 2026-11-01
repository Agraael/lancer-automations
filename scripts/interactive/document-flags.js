import { getLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { setActorFlag, unsetActorFlag, setItemFlag, unsetItemFlag, setTokenFlag, unsetTokenFlag } from "../socket.js";
import { localize } from "../tools/string-utils.js";

/**
 * Add or update lancer-automations flags on an item document.
 * Uses setFlag for reliable persistence (bypasses TypeDataModel restrictions).
 * Known flag keys:
 *   - deployRange {number} - default range when placing this item's deployables
 *   - deployCount {number} - default count when placing this item's deployables
 *   - activeStateData {Object} - contains { active: boolean, endAction: string, endActionDescription: string }
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function addItemFlags(item, flags)
{
    if (!item || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.addItemFlagsArgs'));
        return null;
    }
    for (const [key, flagValue] of Object.entries(flags))
        await setItemFlag(item, MODULE_ID,key, flagValue);
    return item;
}

/**
 * Removes flags from an item document.
 * @param {Item} item       The Foundry Item document to flag
 * @param {Object} flags    Keys to remove from the lancer-automations namespace
 * @returns {Promise<Item>} The updated item
 */
export async function removeItemFlags(item, flags)
{
    if (!item || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.removeItemFlagsArgs'));
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetItemFlag(item, MODULE_ID,key);
    return item;
}

/**
 * Add or update lancer-automations flags on an actor document.
 * @param {Actor} actor     The Foundry Actor document to flag
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 * @returns {Promise<Actor>} The updated actor
 */
export async function addActorFlags(actor, flags)
{
    if (!actor || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.addActorFlagsArgs'));
        return null;
    }
    for (const [key, value] of Object.entries(flags))
        await setActorFlag(actor, MODULE_ID,key, value);
    return actor;
}

/**
 * Removes lancer-automations flags from an actor document.
 * @param {Actor} actor     The Foundry Actor document
 * @param {Object} flags    Object whose keys are flags to unset
 * @returns {Promise<Actor>} The updated actor
 */
export async function removeActorFlags(actor, flags)
{
    if (!actor || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.removeActorFlagsArgs'));
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetActorFlag(actor, MODULE_ID,key);
    return actor;
}

/**
 * Add or update lancer-automations flags on a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Key/value pairs to set in the lancer-automations namespace
 */
export async function addTokenFlags(tokenOrDoc, flags)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.addTokenFlagsArgs'));
        return null;
    }
    for (const [key, value] of Object.entries(flags))
        await setTokenFlag(td, MODULE_ID,key, value);
    return td;
}

/**
 * Remove lancer-automations flags from a token document. Socket-routed for non-owners.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {Object} flags    Object whose keys are flags to unset
 */
export async function removeTokenFlags(tokenOrDoc, flags)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td || typeof flags !== 'object')
    {
        ui.notifications.error(localize('LA.notify.removeTokenFlagsArgs'));
        return null;
    }
    for (const key of Object.keys(flags))
        await unsetTokenFlag(td, MODULE_ID,key);
    return td;
}

/**
 * Read lancer-automations flag(s) from a token document.
 * @param {Token|TokenDocument} tokenOrDoc
 * @param {string} [flagName] If omitted, returns the whole `lancer-automations` namespace object.
 */
export function getTokenFlags(tokenOrDoc, flagName = null)
{
    const td = tokenOrDoc?.document ?? tokenOrDoc;
    if (!td)
    {
        ui.notifications.error(localize('LA.notify.getTokenFlagsArgs'));
        return null;
    }
    if (flagName)
        return getLAFlag(td,flagName);
    return getLAFlags(td) || {};
}

/**
 * Retrieve lancer-automations flags from an item document.
 * @param {Item} item          The Foundry Item document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or an object containing all lancer-automations flags if no key was provided.
 */
export function getItemFlags(item, flagName = null)
{
    if (!item)
    {
        ui.notifications.error(localize('LA.notify.getItemFlagsArgs'));
        return null;
    }
    if (flagName)
        return getLAFlag(item,flagName);
    return getLAFlags(item) || {};
}

/**
 * Retrieve lancer-automations flags from an actor document.
 * @param {Actor} actor        The Foundry Actor document
 * @param {string} [flagName]  Optional specific flag key to retrieve.
 * @returns {any}              The requested flag value, or all lancer-automations flags if no key was provided.
 */
export function getActorFlags(actor, flagName = null)
{
    if (!actor)
    {
        ui.notifications.error(localize('LA.notify.getActorFlagsArgs'));
        return null;
    }
    if (flagName)
        return getLAFlag(actor,flagName);
    return getLAFlags(actor) || {};
}
