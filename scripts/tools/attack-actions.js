import { localize, localizeFormat } from "./string-utils.js";
import { getModuleSetting } from "./settings-utils.js";
import { choseMount, choseFiringOrder, choseBonusWeapons } from "../interactive/index.js";
import { playSkirmishFX, playBarrageFX, playFightFX, queueActionFx } from "../fx/actionFX.js";
import { recordAction } from "../tah/action-tape.js";
import { claimFreeUse } from "../tah/tape-changes.js";
import { mountLabel, tierValue } from "../utils/lancer-token.js";
import { consumeAction, spendReactionForTape } from "./action-economy.js";
import { beginWeaponAttackFlow, executeBasicAttack } from "./misc-tools.js";
import { fireChain, orderMount } from "./fire-chain.js";

async function spendUnlessFree(actor, kind)
{
    if (claimFreeUse(actor))
        return { free: true, tracker: null };
    return { free: false, tracker: getModuleSetting('consumeAction') ? await consumeAction(actor, kind) : null };
}

/** Superheavy is the size on mech weapons and the start of weapon_type on NPC features ("Superheavy Rifle"). */
function isSuperheavyWeapon(weapon)
{
    const sys = weapon?.system;
    const size = String(sys?.size || sys?.type || "").toLowerCase();
    return size === 'superheavy' || String(sys?.weapon_type || "").toLowerCase().startsWith('superheavy');
}

function weaponActiveProfile(weapon)
{
    const sys = weapon?.system;
    return sys?.active_profile ?? sys?.profiles?.[sys?.selected_profile_index ?? 0] ?? null;
}

// Superheavies are barrage-only, unless the active profile says otherwise (Leviathan HAC).
export function weaponSkirmishable(weapon)
{
    if (!isSuperheavyWeapon(weapon))
        return true;
    return weaponActiveProfile(weapon)?.skirmishable === true;
}

export function weaponBarrageable(weapon)
{
    if (!isSuperheavyWeapon(weapon))
        return true;
    return weaponActiveProfile(weapon)?.barrageable !== false;
}

function weaponUnloaded(weapon)
{
    const sys = weapon?.system;
    const tags = [...(sys?.active_profile?.tags ?? []), ...(sys?.all_base_tags ?? []), ...(sys?.tags ?? [])];
    return sys?.loaded === false && tags.some(tag => (tag.lid ?? tag.id) === 'tg_loading');
}

function warnIfAllUnloaded(weapons)
{
    if (weapons.length === 0 || !weapons.every(weaponUnloaded))
        return false;

    ui.notifications.warn(localizeFormat('LA.notify.mountUnloaded', { name: weapons[0].name }));
    return true;
}

/**
 * Post the action card listing the weapons an attack action fires.
 * @param {Actor} actor
 * @param {string} label   Header text, e.g. "SKIRMISH"
 * @param {any[]} weapons  Weapon items, in firing order
 * @returns {Promise<void>}
 */
async function printAttackActionCard(actor, label, weapons)
{
    if (!weapons.length)
        return;

    const rows = weapons.map(weapon => `
        <div style="display:flex;align-items:center;gap:6px;padding:4px 6px;">
            <img src="${weapon.img}" width="24" height="24" style="border:none;flex:0 0 auto;"/>
            <span>${weapon.name}</span>
        </div>`).join('');

    await ChatMessage.create({
        speaker: ChatMessage.getSpeaker({ actor }),
        content: `<div class="card clipped-bot" style="margin:0;">
            <div class="lancer-header lancer-primary">// ${label} //</div>
            <div style="display:flex;flex-direction:column;gap:2px;padding:4px;">${rows}</div>
        </div>`
    });
}

/**
 * Executes a Skirmish action: target validation, weapon selection, and attack/damage flow.
 * @param {Actor|Token|TokenDocument} actorOrToken - The acting entity.
 * @param {any} [bypassMount=null] - Direct mount to use, skipping selection.
 * @param {Token|null} [preTarget=null] - Token to pre-target before each attack flow.
 * @param {((weapon: any) => boolean)|null} [weaponFilter=null] - Keeps only the weapons it accepts.
 * @param {{noFX?: boolean, asReaction?: boolean, heldAction?: boolean, filterReason?: (weapon: any) => string, firstWeapon?: any}} [options={}] - `asReaction` spends no quick action and leaves the tape to the reaction itself. `heldAction` records the Skirmish itself as the reaction. `filterReason` says why `weaponFilter` refused a weapon. `firstWeapon` fires first on `bypassMount`.
 * @returns {Promise<void>}
 */
export async function executeSkirmish(actorOrToken, bypassMount = null, preTarget = null, weaponFilter = null, options = {})
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);

    if (!actor)
    {
        ui.notifications.error(localize('LA.notify.skirmishNeedsToken'));
        return;
    }

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );

    let weapons;

    if (bypassMount)
    {
        weapons = orderMount((bypassMount.slots ?? [])
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
            .filter(Boolean), options.firstWeapon);
        if (!weapons.length)
            return;
    }
    else
    {
        // one/mount; no superheavy; non-fitting shown disabled
        const filterPredicate = (weapon) =>
        {
            if (!weaponSkirmishable(weapon))
                return false;
            if (weaponFilter)
                return weaponFilter(weapon);
            return true;
        };

        const filterReason = weapon => (weaponSkirmishable(weapon) ? options.filterReason?.(weapon) : localize('LA.choiceCard.barrageOnly'));
        const groups = await choseFiringOrder(actor, { title: 'SKIRMISH', filterPredicate, filterReason });
        if (!groups?.length)
            return;

        weapons = groups[0];
    }

    if (warnIfAllUnloaded(weapons))
        return;

    if (bypassMount && !options.firstWeapon)
    {
        const picked = await choseBonusWeapons(actor, [{ label: bypassMount.type ? mountLabel(actor, bypassMount) : '', weapons }]);
        if (!picked)
            return;
        weapons = picked[0];
    }

    const tapeId = foundry.utils.randomID();
    if (sourceToken && !options.noFX)
        queueActionFx(() => playSkirmishFX(sourceToken), sourceToken, 'skirmish');
    if (sourceToken)
        Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'SKIRMISH', actionType: options.heldAction ? 'Reaction' : 'Quick', tapeId });

    const { free, tracker } = options.asReaction ? { free: false, tracker: options.heldAction ? await spendReactionForTape(sourceToken ?? actor, { held: true }) : null } : await spendUnlessFree(actor, 'quick');
    await printAttackActionCard(actor, 'SKIRMISH', weapons);
    if (sourceToken && (!options.asReaction || options.heldAction))
        await recordAction(sourceToken, { id: tapeId, name: 'Skirmish', activation: options.heldAction ? 'Reaction' : 'Quick', icon: 'modules/lancer-automations/icons/skirmish.svg', tracker, ...(free ? { type: 'free' } : {}) });

    await fireChain({ action: 'SKIRMISH', groups: [weapons], tapeId, preTarget });
}

/**
 * Executes a Fight action for a pilot: choose one pilot weapon and attack.
 * @param {Actor|Token|TokenDocument} actorOrToken
 * @param {Item|null} bypassWeapon  Direct weapon item to attack with (skips selection dialog).
 * @returns {Promise<void>}
 */
export async function executeFight(actorOrToken, bypassWeapon = null)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return;

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens?.()?.[0] || null
    );

    let weapon = bypassWeapon;

    if (!weapon)
    {
        const choices = await choseMount(actor, 1, null, null, 'FIGHT');
        if (!choices?.length)
            return;

        const chosenMount = choices[0];
        weapon = chosenMount.slots
            ? chosenMount.slots.find(/** @type {any} */ slot => slot.weapon?.value)?.weapon?.value ?? null
            : chosenMount;
    }

    if (!weapon)
        return;

    const tapeId = foundry.utils.randomID();

    if (sourceToken)
    {
        queueActionFx(() => playFightFX(sourceToken), sourceToken, 'fight');
        Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'FIGHT', actionType: 'Full', tapeId });
    }

    const { free, tracker } = await spendUnlessFree(actor, 'full');
    if (sourceToken)
        await recordAction(sourceToken, { id: tapeId, name: 'Fight', activation: 'Full', icon: 'modules/lancer-automations/icons/crossed-slashes.svg', tracker, ...(free ? { type: 'free' } : {}) });
    await beginWeaponAttackFlow(weapon, {}, { tapeAnchor: tapeId });
}

export async function executeImprovisedAttack(actorOrToken)
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return;

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens?.()?.[0] || null
    );

    if (!sourceToken)
    {
        ui.notifications.error(localize('LA.notify.improvisedAttackNeedsToken'));
        return;
    }

    const tapeId = foundry.utils.randomID();
    Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'IMPROVISED ATTACK', actionType: 'Full', tapeId });
    const { free, tracker } = await spendUnlessFree(actor, 'full');
    await recordAction(sourceToken, { id: tapeId, name: 'Improvised Attack', activation: 'Full', icon: 'mdi mdi-hexagon-slice-6', tracker, ...(free ? { type: 'free' } : {}) });
    await executeBasicAttack(actor, {
        title: 'Improvised Attack',
        attack_type: 'Melee',
        action: { name: 'Improvised Attack', activation: 'Full' },
        damage: [{ val: actor.type === 'npc' ? String(tierValue(actor, [3, 4, 6])) : '1d6', type: 'Kinetic' }],
    }, { tapeRecorded: true, rollTypes: ['improvised'], laTargeting: { pattern: 'target', size: 1, range: 1, rangeType: 'Threat' } });
}

/**
 * Executes a Barrage action: attacks with either two different mounts or one superheavy mount.
 * @param {Actor|Token|TokenDocument} actorOrToken - The acting entity.
 * @param {any} [bypassMount=null] - Direct mount(s) to use, skipping selection.
 * @param {Token|null} [preTarget=null] - Token to pre-target before each attack flow.
 * @param {{firstWeapon?: any}} [options={}] - `firstWeapon` fires first on its mount in `bypassMount`.
 * @returns {Promise<void>}
 */
export async function executeBarrage(actorOrToken, bypassMount = null, preTarget = null, options = {})
{
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);

    if (!actor)
    {
        ui.notifications.error(localize('LA.notify.barrageNeedsToken'));
        return;
    }

    const sourceToken = /** @type {Token|null} */ (
        (/** @type {any} */ (actorOrToken))?.actor
            ? actorOrToken
            : actor.token?.object || actor.getActiveTokens()[0] || null
    );

    const hasSuperheavy = (selectedItem) => selectedItem?.slots
        ? selectedItem.slots.some(slot => !!slot.weapon?.value && isSuperheavyWeapon(slot.weapon.value))
        : isSuperheavyWeapon(selectedItem);

    const barrageValidator = (selected) =>
    {
        if (selected.length === 0)
            return { valid: false, message: "Two mounts, or one superheavy.", level: "info" };

        if (selected.length === 1)
        {
            return hasSuperheavy(selected[0])
                ? { valid: true, message: "Superheavy weapon selected.", level: "success" }
                : { valid: false, message: "1 mount selected. Pick a second.", level: "info" };
        }

        if (selected.length === 2)
        {
            const anySuperheavy = selected.some(mount => hasSuperheavy(mount));
            return anySuperheavy
                ? { valid: false, message: "Cannot mix a Superheavy weapon with another mount.", level: "error" }
                : { valid: true, message: "2 mounts selected.", level: "success" };
        }

        return { valid: false, message: "Invalid selection.", level: "error" };
    };

    const mountWeapons = mount => (mount.slots
        ? mount.slots
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
            .filter(Boolean)
        : [mount]);

    const bypassMounts = bypassMount && (Array.isArray(bypassMount) ? bypassMount : [bypassMount]);
    let groups = bypassMounts
        ? bypassMounts.map(mount => orderMount(mountWeapons(mount), options.firstWeapon))
        : await choseFiringOrder(actor, { count: 2, filterPredicate: weaponBarrageable, title: 'BARRAGE', selectionValidator: barrageValidator });

    if (!groups || groups.length === 0)
        return;

    if (groups.some(warnIfAllUnloaded))
        return;

    if (bypassMounts && !options.firstWeapon)
    {
        groups = await choseBonusWeapons(actor, bypassMounts.map((mount, index) => ({ label: mount.slots && mount.type ? mountLabel(actor, mount) : '', weapons: groups[index] })));
        if (!groups)
            return;
    }

    const tapeId = foundry.utils.randomID();

    if (sourceToken)
    {
        queueActionFx(() => playBarrageFX(sourceToken), sourceToken, 'barrage');
        Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'BARRAGE', actionType: 'Full', tapeId });
    }

    const { free, tracker } = await spendUnlessFree(actor, 'full');
    await printAttackActionCard(actor, 'BARRAGE', groups.flat());
    if (sourceToken)
        await recordAction(sourceToken, { id: tapeId, name: 'Barrage', activation: 'Full', icon: 'modules/lancer-automations/icons/barrage.svg', tracker, ...(free ? { type: 'free' } : {}) });

    const firing = groups.filter(weapons => weapons.length);

    if (firing.length)
        await fireChain({ action: 'BARRAGE', groups: firing, tapeId, preTarget });
}
