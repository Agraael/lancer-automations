// Core Lancer structure/overheat outcomes, used when the alt-struct ruleset is off.

import { applyEffectsToTokens } from "../bonuses/flagged-effects.js";
import { executeReactorMeltdown } from "../tools/misc-tools.js";
import { altStructButton, pushEmbedButton, destroyMech } from "./alt-struct-helpers.js";
import { localize } from "../tools/string-utils.js";
import { describeDestruction, destroyTraumaChoice, getValidSystems, getValidWeaponMounts, hasUniquePhysiology, isValidActor, showSystemTraumaDialog } from "./structure.js";

const UNTIL_NEXT_TURN = { label: 'end', turns: 1, rounds: 0 };

// Legendary NPCs roll the table twice as a pool, so drill into the kept sub-roll first.
function countOnes(roll)
{
    let dice = roll;
    if (dice?.terms?.[0]?.rolls?.length > 1)
    {
        const kept = dice.terms[0].results.findIndex(result => !result.discarded);
        dice = dice.terms[0].rolls[kept] || dice;
    }
    return dice?.terms?.[0]?.results?.filter(result => result.result === 1).length ?? 0;
}

async function applyStatus(actor, effectNames, note, duration)
{
    const token = actor.getActiveTokens()?.[0];
    if (!token)
        return;
    try
    {
        await applyEffectsToTokens({ tokens: [token], effectNames, note, ...(duration ? { duration } : {}) });
    }
    catch (error)
    {
        console.warn("lancer-automations | base-struct |Could not apply effects:", error);
    }
}

async function startMeltdown(actor, turns)
{
    const token = actor.getActiveTokens()?.[0];
    if (token)
        await executeReactorMeltdown(token, turns);
}

const hullCheckOpts = (actor) => ({
    flowType: 'BaseStructureHullCheckFlow',
    actorUuid: actor.uuid,
    icon: 'fas fa-dice-d20',
    label: 'LA.common.hull',
    attrs: { 'check-type': 'hull' }
});

function hullCheckButton(actor)
{
    return altStructButton(hullCheckOpts(actor));
}

// #region Structure

/** Standard table: Direct Hit at 3+ is STUNNED, Glancing Blow is IMPAIRED. Monstrosity table adds SLOW and PRONE. */
export async function baseApplyStructureEffects(state)
{
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const roll = state.data?.result?.roll;
    if (!roll || countOnes(roll) > 1)
        return true;

    const total = roll.total;
    const directHit = total === 1 && state.data.remStruct >= 3;

    if (hasUniquePhysiology(actor))
    {
        if (directHit)
            await applyStatus(actor, ["stunned"], "Direct Hit", UNTIL_NEXT_TURN);
        else if (total === 2)
            await applyStatus(actor, ["slow"], "Dismemberment");
        else if (total === 3 || total === 4)
            await applyStatus(actor, ["prone"], "Powerful Hit");
        else if (total >= 5)
            await applyStatus(actor, ["impaired"], "Glancing Hit", UNTIL_NEXT_TURN);
        return true;
    }

    if (directHit)
        await applyStatus(actor, ["stunned"], "Direct Hit", UNTIL_NEXT_TURN);
    else if (total >= 5)
        await applyStatus(actor, ["impaired"], "Glancing Blow", UNTIL_NEXT_TURN);
    return true;
}

/** Replaces the system's button so the HULL check outcome is actually resolved. */
export async function baseInsertHullCheckButton(state)
{
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const roll = state.data?.result?.roll;
    if (roll && countOnes(roll) <= 1 && roll.total === 1 && state.data.remStruct === 2)
    {
        pushEmbedButton(state, hullCheckOpts(actor));
    }
    return true;
}

/** @returns {Promise<{title: string, description: string}|null>} */
export async function baseHandleHullCheckResult(actor, success)
{
    if (!isValidActor(actor))
        return null;

    const title = localize('LA.altStruct.directHit');
    if (!success)
    {
        await destroyMech(actor);
        return { title, description: localize('LA.altStruct.result.hullFailedDestroyed') };
    }
    if (hasUniquePhysiology(actor))
        return { title, description: localize('LA.altStruct.result.hullSavePassed') };

    await applyStatus(actor, ["stunned"], "Direct Hit (HULL check success)", UNTIL_NEXT_TURN);
    return { title, description: localize('LA.altStruct.result.hullPassedStunned') };
}

/** System Trauma: the 1d6 already picked weapon or system, this destroys the chosen one. */
export async function baseSelectDestructionTarget(state)
{
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const roll = state.data?.result?.roll;
    if (!roll)
        throw new TypeError(`Secondary Structure check hasn't been rolled yet!`);

    const hadValidItems = getValidWeaponMounts(actor).length > 0 || getValidSystems(actor).length > 0;
    const choice = await showSystemTraumaDialog(actor, roll.total <= 3 ? "weapon" : "system");
    // stops printGenericCard from re-printing the tear-off dice
    delete state.data.result;
    state.data.tags = [];

    if (!choice)
    {
        // null means the player cancelled OR nothing destructible remains, only the latter escalates
        if (hadValidItems)
            return false;
        return baseDirectHitFallback(state, actor);
    }

    const destroyed = await destroyTraumaChoice(choice);
    Object.assign(state.data, describeDestruction(choice, destroyed));
    return true;
}

async function baseDirectHitFallback(state, actor)
{
    const remStruct = actor.system.structure.value;
    const lead = localize('LA.altStruct.result.noValidEquipmentDirectHit');
    state.data.title = localize('LA.altStruct.directHit');

    if (remStruct >= 3)
    {
        await applyStatus(actor, ["stunned"], "Direct Hit", UNTIL_NEXT_TURN);
        state.data.description = `${lead} ${localize('LA.altStruct.result.stunnedNextTurn')}`;
    }
    else if (remStruct === 2)
        state.data.description = `${lead}<br>${hullCheckButton(actor)}`;
    else
    {
        await destroyMech(actor);
        state.data.description = `${lead} ${localize('LA.altStruct.result.mechDestroyed')}`;
    }
    return true;
}

// #endregion

// #region Stress

/** Meltdown at 3+ stress and Destabilized Power Plant are EXPOSED, Emergency Shunt is IMPAIRED. */
export async function baseApplyStressEffects(state)
{
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const roll = state.data?.result?.roll;
    if (!roll)
        return true;

    if (countOnes(roll) > 1)
    {
        await startMeltdown(actor, 1);
        return true;
    }

    const remStress = state.data.remStress;
    if (roll.total === 1)
    {
        if (remStress === 1)
            await startMeltdown(actor, 1);
        else if (remStress !== 2)
            await applyStatus(actor, ["exposed"], "Meltdown");
    }
    else if (roll.total <= 4)
        await applyStatus(actor, ["exposed"], "Destabilized Power Plant");
    else
        await applyStatus(actor, ["impaired"], "Emergency Shunt", UNTIL_NEXT_TURN);
    return true;
}

/** Irreversible Meltdown at 0 stress, plus the 1-stress NPC shortcut. Chained in front of the system's step. */
export async function baseHandleNoStressRemaining(state)
{
    const actor = state.actor;
    if (!actor?.is_mech?.() && !actor?.is_npc?.())
        return false;

    if (actor.is_npc() && actor.system.stress.max === 1)
        await applyStatus(actor, ["exposed"], "NPC Overheat");
    else if (state.data?.remStress === 0)
        await startMeltdown(actor, 1);
    return true;
}

/** Replaces the system's button so the ENGINEERING check outcome is actually resolved. */
export async function baseInsertEngCheckButton(state)
{
    const actor = state.actor;
    if (!isValidActor(actor))
        return false;

    const roll = state.data?.result?.roll;
    if (roll && countOnes(roll) <= 1 && roll.total === 1 && state.data.remStress === 2)
    {
        pushEmbedButton(state, {
            flowType: 'BaseStressEngCheckFlow',
            actorUuid: actor.uuid,
            icon: 'fas fa-dice-d20',
            label: 'LA.altStruct.engineering',
            attrs: { 'check-type': 'eng' }
        });
    }
    return true;
}

/** @returns {Promise<{title: string, description: string}|null>} */
export async function baseHandleEngCheckResult(actor, success)
{
    if (!isValidActor(actor))
        return null;

    const title = localize('LA.altStruct.meltdownTitle');
    if (success)
    {
        await applyStatus(actor, ["exposed"], "Meltdown (ENGINEERING check success)");
        return { title, description: localize('LA.altStruct.result.engPassedExposed') };
    }

    const meltdown = altStructButton({
        flowType: 'MeltdownFlow',
        actorUuid: actor.uuid,
        icon: 'fas fa-radiation',
        label: 'LA.altStruct.meltdown',
        attrs: { 'countdown-formula': '1d6' }
    });
    return { title, description: `${localize('LA.altStruct.result.engFailedMeltdown6')}<br>${meltdown}` };
}

// #endregion
