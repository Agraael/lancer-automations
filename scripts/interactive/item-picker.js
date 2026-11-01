import { startChoiceCard } from "./network.js";
import { localize } from "../tools/string-utils.js";

/**
 * Prompts the user to pick an item from a list of items using a Choice Card.
 * @param {Item[]} items - Array of items to choose from.
 * @param {Object} [options] - Options for the choice card.
 * @param {string} [options.title="PICK ITEM"] - Title of the choice card.
 * @param {string} [options.description="Select an item:"] - Description text.
 * @param {string} [options.icon="fas fa-box"] - Icon class for the choice card.
 * @param {function} [options.formatText] - Optional function to format the button text. Defaults to `(item) => item.name`.
 * @param {Token} [options.relatedToken=null] - Optional token to show in the card header.
 * @returns {Promise<Item|null>} The selected item or null if cancelled (or ignored).
 */
export function pickItem(items, options = {})
{
    return new Promise((resolve) =>
    {
        if (!items || items.length === 0)
        {
            ui.notifications.warn(localize('LA.notify.noItemsAvailableToPick'));
            return resolve(null);
        }

        const choices = items.map(item =>
        {
            const text = options.formatText ? options.formatText(item) : item.name;
            const icon = item.img || "systems/lancer/assets/icons/white/generic_item.svg";
            return {
                text: text,
                icon: icon,
                callback: () => resolve(item)
            };
        });

        startChoiceCard({
            title: options.title || "PICK ITEM",
            description: options.description || "Select an item:",
            choices: choices,
            icon: options.icon || "fas fa-box",
            relatedToken: options.relatedToken ?? null
        }).then(result =>
        {
            if (!result)
                resolve(null);
        });
    });
}
