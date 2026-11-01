import { pickItem } from "./item-picker.js";
import { playReloadFX } from "../fx/actionFX.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { itemAllTags } from "../combat/per-frequency-tags.js";

/**
 * Retrieves all valid weapon items from an actor, handling both Mechs and NPCs.
 * @param {Actor|Token|TokenDocument} entity - The actor or token to get weapons from.
 * @returns {Item[]} Array of weapon items.
 */
export function getWeapons(entity)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (entity))?.actor || entity);
    if (!actor?.items)
        return [];

    return actor.items.filter(item =>
        item.type === 'mech_weapon' ||
        item.type === 'pilot_weapon' ||
        (item.system?.type?.toLowerCase() === 'weapon')
    );
}

/**
 * Finds an item on an actor by its Lancer ID (lid).
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to search.
 * @param {string} lid - The Lancer ID to find.
 * @returns {Item|null} The item, or null if not found.
 */
export function findItemByLid(actorOrToken, lid)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items)
        return null;
    return actor.items.find(item => item.system?.lid === lid) || null;
}

/**
 * Returns true if the actor (mech / pilot / npc / deployable) has any item whose LID matches.
 * Accepts a single LID string or an array of LIDs (any-match).
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {string|string[]} lidOrLids
 * @returns {boolean}
 */
export function hasItem(actorOrToken, lidOrLids)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor?.items || !lidOrLids)
        return false;
    const lids = Array.isArray(lidOrLids) ? lidOrLids : [lidOrLids];
    if (lids.length === 0)
        return false;
    return actor.items.some(item => lids.includes(item.system?.lid));
}

/**
 * Prompts the user to pick an unloaded weapon from an actor and reloads it.
 * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to reload weapons for.
 * @param {string} [targetName] - Optional target name for the UI notification.
 * @returns {Promise<Item|null>} The reloaded weapon, or null if cancelled.
 */
export async function reloadOneWeapon(actorOrToken, targetName)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor)
    {
        ui.notifications.warn(localize('LA.notify.noValidActorProvidedForReloading'));
        return null;
    }

    const weapons = getWeapons(actor);
    const unloadedWeapons = weapons.filter(weapon =>
    {
        const tags = itemAllTags(weapon);
        return tags.some(tag => tag.lid === 'tg_loading') && weapon.system.loaded === false;
    });

    if (unloadedWeapons.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noUnloadedWeapons', { name }));
        return null;
    }

    const chosenWeapon = await pickItem(unloadedWeapons, {
        title: localize('LA.deployables.chooseWeaponToReloadTitle'),
        description: localizeFormat('LA.deployables.selectWeaponToReload', { name }),
        icon: "fas fa-sync",
        formatText: (weapon) => `Reload ${weapon.name}`
    });

    if (chosenWeapon)
    {
        await chosenWeapon.update(/** @type {any} */({ "system.loaded": true }));
        ui.notifications.info(localizeFormat('LA.notify.weaponReloaded', { name, weapon: chosenWeapon.name }));
        const token = (/** @type {any} */ (actorOrToken))?.actor
            ? /** @type {any} */ (actorOrToken)
            : actor.getActiveTokens?.()?.[0];
        if (token)
            playReloadFX(token);
    }
    return chosenWeapon;
}

/**
 * Prompts the user to pick a depleted system from an actor and restores its uses or charged state.
 * Targets system items (mech_system, pilot_gear, NPC non-weapon features) with tg_limited (uses <= 0) or tg_recharge (charged === false).
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {string} [targetName]
 * @returns {Promise<Item|null>}
 */
export async function rechargeSystem(actorOrToken, targetName)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    const name = targetName || actorOrToken?.name || actor?.name || "Target";

    if (!actor)
    {
        ui.notifications.warn(localize('LA.notify.noValidActorProvidedForRecharging'));
        return null;
    }

    const depletedItems = actor.items.filter(item =>
    {
        if (item.type === 'mech_weapon' || item.type === 'pilot_weapon')
            return false;
        if (item.system?.type?.toLowerCase() === 'weapon')
            return false;
        const sys = item.system;
        const tags = itemAllTags(sys);
        const hasLimited = tags.some(tag => tag.lid === 'tg_limited');
        const hasRecharge = tags.some(tag => tag.lid === 'tg_recharge');
        if (hasLimited)
        {
            const usesValue = typeof sys.uses === 'number' ? sys.uses : (sys.uses?.value ?? 0);
            if (usesValue <= 0)
                return true;
        }
        if (hasRecharge && sys.charged === false)
            return true;
        return false;
    });

    if (depletedItems.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noDepletedSystems', { name }));
        return null;
    }

    const chosen = await pickItem(depletedItems, {
        title: localize('LA.deployables.chooseSystemToRechargeTitle'),
        description: localizeFormat('LA.deployables.selectSystemToRecharge', { name }),
        icon: "fas fa-bolt",
        formatText: (item) => `Recharge ${item.name}`
    });

    if (!chosen)
        return null;

    const sys = chosen.system;
    const tags = itemAllTags(sys);
    const hasLimited = tags.some(tag => tag.lid === 'tg_limited');
    const hasRecharge = tags.some(tag => tag.lid === 'tg_recharge');
    const update = /** @type {any} */ ({});

    if (hasLimited)
    {
        if (typeof sys.uses === 'number')
            update['system.uses'] = sys.uses_max ?? sys.max_uses ?? 0;
        else
            update['system.uses.value'] = sys.uses?.max ?? 0;
    }
    if (hasRecharge)
        update['system.charged'] = true;

    await chosen.update(update);
    ui.notifications.info(localizeFormat('LA.notify.systemRecharged', { name, system: chosen.name }));
    return chosen;
}
