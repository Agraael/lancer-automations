import { localize } from "./string-utils.js";
import { getModuleSetting } from "./settings-utils.js";
import { choseMount, InteractiveAPI } from "../interactive/index.js";
import { playSkirmishFX, playBarrageFX, playFightFX, queueActionFx } from "../fx/actionFX.js";
import { recordAction } from "../tah/action-tape.js";
import { claimFreeUse } from "../tah/tape-changes.js";
import { tierValue } from "../utils/lancer-token.js";
import { consumeAction } from "./action-economy.js";
import { isItemUsable, beginWeaponAttackFlow, executeBasicAttack } from "./misc-tools.js";

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

// Bonus damage: non-Aux is primary in X/Aux mounts; in Aux/Aux only the first weapon fired keeps bonus.
function auxBonusRule(weapons)
{
    const isAuxSize = (weapon) => String(weapon.system?.size || "").toLowerCase() === 'auxiliary';
    const hasNonAux = weapons.some(weapon => !isAuxSize(weapon) && isItemUsable(weapon));
    let auxPrimaryUsed = false;
    return {
        hasNonAux,
        suppressBonus: (weapon) =>
        {
            if (hasNonAux)
                return isAuxSize(weapon);
            const suppressed = auxPrimaryUsed;
            if (isItemUsable(weapon))
                auxPrimaryUsed = true;
            return suppressed;
        }
    };
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
 * @param {{noFX?: boolean, asReaction?: boolean}} [options={}] - `asReaction` spends no quick action and leaves the tape to the reaction itself.
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
        weapons = (bypassMount.slots ?? [])
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
            .filter(Boolean);
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

        const choices = await choseMount(actor, 1, filterPredicate, null, "SKIRMISH");
        if (!choices || choices.length === 0)
            return;

        const chosenMount = choices[0];
        if (chosenMount.slots)
        {
            weapons = chosenMount.slots
                .map(slot => slot.weapon?.value)
                .filter(Boolean);
        }
        else
            weapons = [chosenMount];
    }

    const tapeId = foundry.utils.randomID();
    if (sourceToken && !options.noFX)
        queueActionFx(() => playSkirmishFX(sourceToken), sourceToken, 'skirmish');
    if (sourceToken)
        Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'SKIRMISH', actionType: 'Quick', tapeId });
    const { free, tracker } = options.asReaction ? { free: false, tracker: null } : await spendUnlessFree(actor, 'quick');
    await printAttackActionCard(actor, 'SKIRMISH', weapons);
    if (sourceToken && !options.asReaction)
        await recordAction(sourceToken, { id: tapeId, name: 'Skirmish', activation: 'Quick', icon: 'modules/lancer-automations/icons/skirmish.svg', tracker, ...(free ? { type: 'free' } : {}) });

    const { hasNonAux, suppressBonus } = auxBonusRule(weapons);

    const fireWeapon = async (weapon) =>
    {
        if (preTarget)
            /** @type {any} */ (canvas.tokens).setTargets([preTarget.id]);
        const extraData = suppressBonus(weapon) ? { _csmNoBonusDmg: { enabled: true } } : {};
        await beginWeaponAttackFlow(weapon, {}, extraData);
    };

    if (weapons.length === 1)
        await fireWeapon(weapons[0]);
    else
    {
        const choices = weapons.map(weapon => ({
            text: weapon.name,
            icon: weapon.img,
            callback: async () => fireWeapon(weapon)
        }));

        await InteractiveAPI.startChoiceCard({
            title: localize('LA.dialogTitle.skirmishWeaponOrder'),
            description: hasNonAux
                ? "Aux weapons don't deal bonus damage."
                : "First weapon fired deals bonus damage; others don't.",
            mode: "and",
            choices
        });
    }
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
    await beginWeaponAttackFlow(weapon);
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
 * @returns {Promise<void>}
 */
export async function executeBarrage(actorOrToken, bypassMount = null, preTarget = null)
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
            return { valid: false, message: "Select 1 or 2 mounts.", level: "info" };

        if (selected.length === 1)
        {
            const isSuperheavy = hasSuperheavy(selected[0]);
            return {
                valid: true,
                message: isSuperheavy ? "Superheavy weapon selected." : "1 mount selected.",
                level: "success",
            };
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

    const choices = bypassMount
        ? (Array.isArray(bypassMount) ? bypassMount : [bypassMount])
        : await choseMount(actor, 2, weaponBarrageable, null, "BARRAGE", barrageValidator);
    if (!choices || choices.length === 0)
        return;

    const tapeId = foundry.utils.randomID();
    if (sourceToken)
    {
        queueActionFx(() => playBarrageFX(sourceToken), sourceToken, 'barrage');
        Hooks.callAll('lancer-automations.battelog.action', { token: sourceToken, name: 'BARRAGE', actionType: 'Full', tapeId });
    }
    const { free, tracker } = await spendUnlessFree(actor, 'full');
    await printAttackActionCard(actor, 'BARRAGE', choices.flatMap(mount => mount.slots
        ? mount.slots
            .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
            .filter(Boolean)
        : [mount]));
    if (sourceToken)
        await recordAction(sourceToken, { id: tapeId, name: 'Barrage', activation: 'Full', icon: 'modules/lancer-automations/icons/barrage.svg', tracker, ...(free ? { type: 'free' } : {}) });

    // AND card when mount has multiple weapons
    // RAW: Aux weapons in a Barrage don't deal bonus damage; the Main/Heavy/SH does.
    const fireMountWeapons = async (mount) =>
    {
        let weapons;
        if (mount.slots)
        {
            weapons = mount.slots
                .map(slot => slot.weapon?.value ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id) : null))
                .filter(Boolean);
        }
        else
            weapons = [mount];

        const { hasNonAux, suppressBonus } = auxBonusRule(weapons);

        const fireWeapon = async (weapon) =>
        {
            if (preTarget)
            {
                /** @type {any} */ (canvas.tokens).setTargets([preTarget.id]);
            }
            const extraData = suppressBonus(weapon) ? { _csmNoBonusDmg: { enabled: true } } : {};
            await beginWeaponAttackFlow(weapon, {}, extraData);
        };

        if (weapons.length === 1)
            await fireWeapon(weapons[0]);
        else if (weapons.length > 1)
        {
            const choices = weapons.map(weapon => ({
                text: weapon.name,
                icon: weapon.img,
                callback: async () => fireWeapon(weapon)
            }));
            await InteractiveAPI.startChoiceCard({
                title: localize('LA.dialogTitle.weaponOrder'),
                description: hasNonAux
                    ? `Firing weapons from ${mount.type || "Mount"}. Aux weapons don't deal bonus damage.`
                    : `Firing weapons from ${mount.type || "Mount"}. First weapon fired deals bonus damage; others don't.`,
                mode: "and",
                choices
            });
        }
    };

    if (choices.length === 1)
    {
        // Superheavy, just fire its weapons
        await fireMountWeapons(choices[0]);
    }
    else
    {
        const mountChoices = choices.map((mount, index) =>
        {
            const mountLabel = mount.name || mount.type || "Mount " + (index + 1);
            const weaponNames = (mount.slots ?? [])
                .map(slot => slot.weapon?.value?.name ?? (slot.weapon?.id ? actor.items.get(slot.weapon.id)?.name : null))
                .filter(Boolean);
            const text = weaponNames.length
                ? `Fire ${mountLabel} (${weaponNames.join(", ")})`
                : `Fire ${mountLabel}`;
            return {
                text,
                icon: mount.slots?.[0]?.weapon?.value?.img || "icons/svg/item-bag.svg",
                callback: async () =>
                {
                    await fireMountWeapons(mount);
                }
            };
        });

        await InteractiveAPI.startChoiceCard({
            title: localize('LA.dialogTitle.barrageMountOrder'),
            description: localize('LA.misc.selectWhichMountToTriggerAux'),
            mode: "and",
            choices: mountChoices
        });
    }
}
