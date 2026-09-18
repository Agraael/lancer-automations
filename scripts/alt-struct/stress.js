/* global ui */

import { applyEffectsToTokens } from "../bonuses/flagged-effects.js";
import { executeReactorMeltdown } from "../tools/misc-tools.js";
import { altStructButton, pushEmbedButton, getRollCount } from "./alt-struct-helpers.js";
import { rollCard } from "../interactive/tools/rollCard.js";

import { localize, localizeFormat } from '../tools/string-utils.js';
const stressTableTitles = [
    'LA.altStruct.criticalReactorFailure',
    'LA.altStruct.meltdownTitle',
    'LA.altStruct.powerFailure',
    'LA.altStruct.powerFailure',
    'LA.altStruct.powerFailure',
    'LA.altStruct.emergencyShunt',
    'LA.altStruct.emergencyShunt',
];

function stressTableDescriptions(roll, remStress)
{
    switch (roll)
    {
    // Used for multiple ones
        case 0:
            return localize('LA.altStruct.stress.criticalReactorFailure');
        case 1:
            switch (remStress)
            {
                case 2:
                    return localize('LA.altStruct.stress.meltdownTwoLeft');
                case 1:
                    return localize('LA.altStruct.stress.meltdownOneLeft');
                default:
                    return localize('LA.altStruct.stress.meltdown');
            }
        case 2:
        case 3:
        case 4:
            return localize('LA.altStruct.stress.powerFailure');
        case 5:
        case 6:
            return localize('LA.altStruct.stress.emergencyShunt');
    }
    return "";
}

export async function altRollStress(state)
{
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);
    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanRollStress'));
        return false;
    }

    // Skip this step for 1-stress NPCs.
    if (actor.is_npc() && actor.system.stress.max === 1)
    {
        const forcedRollIndex = 3;
        const forcedRemStress = 1;
        state.data = {
            type: "stress",
            title: localize(stressTableTitles[forcedRollIndex]),
            desc: stressTableDescriptions(forcedRollIndex, forcedRemStress),
            remStress: forcedRemStress,
            val: actor.system.stress.value,
            max: actor.system.stress.max,
            roll_str: String(forcedRollIndex),
            result: undefined,
        };
        return true;
    }

    if ((state.data?.reroll_data?.stress ?? actor.system.stress.value) >=
    actor.system.stress.max)
    {
        ui.notifications.info(
            localize('LA.notify.fullStress')
        );
        return false;
    }

    let remStress = state.data?.reroll_data?.stress ?? actor.system.stress.value;
    let stressLost = actor.system.stress.max - remStress;
    let formula = `${stressLost}d6kl1`;
    // Legendary NPCs roll with advantage.
    if (actor.is_npc() &&
    actor.items.some((item) => ["npcf_legendary_ultra", "npcf_legendary_veteran"].includes(item.system.lid)
    ))

        formula = `{${formula}, ${formula}}kh`;

    let roll = await new Roll(formula).evaluate();

    let rollTotal = roll.total;
    if (rollTotal === undefined)
        return false;

    state.data = {
        type: "stress",
        title: localize(stressTableTitles[rollTotal]),
        desc: stressTableDescriptions(rollTotal, remStress),
        remStress: remStress,
        val: actor.system.stress.value,
        max: actor.system.stress.max,
        roll_str: roll.formula,
        result: {
            roll: roll,
            tt: await roll.getTooltip(),
            total: (roll.total ?? 0).toString(),
        },
    };

    return true;
}

export async function stressCheckMultipleOnes(state)
{
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    let actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanRollStress'));
        return false;
    }

    const roll = state.data.result?.roll;
    if (!roll)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    // Crushing hits
    let onesRolled = getRollCount(roll, 1);
    if (onesRolled > 1)
    {
        state.data.title = localize(stressTableTitles[0]);
        state.data.desc = stressTableDescriptions(0, 1);
    }

    return true;
}

export async function insertEngineeringCheckButton(state)
{
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    let actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanRollStress'));
        return false;
    }

    let showEngCheckButton = false;
    const result = state.data.result;
    if (!result)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    const roll = result.roll;

    switch (roll.total)
    {
        case 1:
            showEngCheckButton = true;
            break;
    }

    let onesRolled = getRollCount(roll, 1);

    if (showEngCheckButton && !(onesRolled > 1))
        pushEmbedButton(state, { flowType: 'StressEngineeringCheckFlow', actorUuid: actor.uuid, icon: 'fas fa-dice-d20', label: 'LA.altStruct.engineering', attrs: { 'check-type': 'eng' } });
    return true;
}

/** Applies SLOW+THROTTLED (2-4), IMPAIRED (5-6), or EXPOSED+THROTTLED (multiple 1s, + meltdown check) per the roll. */
export async function applyStressEffects(state)
{
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
        return false;

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    const roll = result.roll;
    const rollTotal = roll.total;

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0)
    {
        console.log("lancer-automations | alt-struct |No active token found for actor");
        return true;
    }

    const token = tokens[0];

    const onesRolled = getRollCount(roll, 1);
    const hasMultipleOnes = onesRolled > 1;

    if (hasMultipleOnes)
    {
    // Multiple 1s: EXPOSED + THROTTLED + Critical Meltdown
        try
        {
            // EXPOSED ends on stabilize or a passed ENG check, not on a turn timer
            await applyEffectsToTokens({
                tokens: [token],
                effectNames: ["exposed"],
                note: "Critical Stress Failure",
            });
            await applyEffectsToTokens({
                tokens: [token],
                effectNames: ["throttled"],
                note: "Critical Stress Failure",
                duration: { label: 'end', turns: 1, rounds: 0 },
            });
        }
        catch (error)
        {
            console.warn("lancer-automations | alt-struct |Could not apply EXPOSED + THROTTLED effects:", error);
        }

        pushEmbedButton(state, { flowType: 'CriticalMeltdownFlow', actorUuid: actor.uuid, icon: 'fas fa-radiation', label: 'LA.altStruct.criticalMeltdown' });
    }
    else
    {
        switch (rollTotal)
        {
            case 2:
            case 3:
            case 4:
                // Power Fail: SLOW + THROTTLED until end of next turn
                try
                {
                    await applyEffectsToTokens({
                        tokens: [token],
                        effectNames: ["slow", "throttled"],
                        note: "Power Fail",
                        duration: { label: 'end', turns: 1, rounds: 0 },
                    });
                }
                catch (error)
                {
                    console.warn("lancer-automations | alt-struct |Could not apply SLOW + THROTTLED effects:", error);
                }
                break;

            case 5:
            case 6:
                // Emergency Shunt: IMPAIRED until end of next turn
                try
                {
                    await applyEffectsToTokens({
                        tokens: [token],
                        effectNames: ["impaired"],
                        note: "Emergency Shunt",
                        duration: { label: 'end', turns: 1, rounds: 0 },
                    });
                }
                catch (error)
                {
                    console.warn("lancer-automations | alt-struct |Could not apply IMPAIRED effect:", error);
                }
                break;

            case 1:
                // At 1 stress the mech is Exposed up front, the rest waits on the engineering check
                if (state.data.remStress === 1)
                {
                    try
                    {
                        await applyEffectsToTokens({
                            tokens: [token],
                            effectNames: ["exposed"],
                            note: "Meltdown",
                        });
                    }
                    catch (error)
                    {
                        console.warn("lancer-automations | alt-struct |Could not apply EXPOSED effect:", error);
                    }
                }
                break;
        }
    }

    return true;
}

async function applyEngineeringCheckEffects(actor, engineeringSuccess)
{
    const remStress = actor.system.stress.value;
    let description = "";

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0)
    {
        console.log("lancer-automations | alt-struct |No active token found for actor");
        return description;
    }

    const token = tokens[0];

    try
    {
        const meltdownButton = () => altStructButton({ flowType: 'MeltdownFlow', actorUuid: actor.uuid, icon: 'fas fa-radiation', label: 'LA.altStruct.meltdown' });

        if (remStress >= 3)
        {
            if (engineeringSuccess)
            {
                // Success: SLOW + THROTTLED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "throttled"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
                description = localize('LA.altStruct.result.engPassedSlowThrottled');
            }
            else
            {
                // Failure: EXPOSED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "Engineering Check Failure",
                });
                description = localize('LA.altStruct.result.engFailedExposed');
            }
        }
        else if (remStress === 2)
        {
            if (engineeringSuccess)
            {
                // Success: SLOW + THROTTLED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "throttled"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
                description = localize('LA.altStruct.result.engPassedSlowThrottled');
            }
            else
            {
                // Failure: EXPOSED + Meltdown
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "Engineering Check Failure",
                });
                description = `${localize('LA.altStruct.result.engFailedExposedMeltdown')}<br>${meltdownButton()}`;
            }
        }
        else if (remStress === 1)
        {
            if (engineeringSuccess)
            {
                // Success: THROTTLED only
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["throttled"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
                description = localize('LA.altStruct.result.engPassedThrottled');
            }
            else
            {
                // Failure: Meltdown
                description = `${localize('LA.altStruct.result.engFailedMeltdown3')}<br>${meltdownButton()}`;
            }
        }
    }
    catch (error)
    {
        console.warn("lancer-automations | alt-struct |Could not apply engineering check effects:", error);
    }

    return description;
}

/** @returns {Promise<{title: string, description: string}|null>} */
export async function handleStressEngineeringCheckResult(actor, success)
{
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanPerformThis'));
        return null;
    }

    const description = await applyEngineeringCheckEffects(actor, success);
    return description ? { title: localize('LA.altStruct.meltdownTitle'), description } : null;
}

export async function rollMeltdownCountdown(state)
{
    if (!state.data)
        throw new TypeError(`Meltdown flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanRollMeltdown'));
        return false;
    }

    // alt-struct rolls 1d3, the core table rolls 1d6, the button carries the formula
    const formula = state.data.countdownFormula || "1d3";
    const token = actor.getActiveTokens()?.[0] ?? null;
    const rolled = await rollCard({
        title: localize('LA.dialogTitle.meltdownCountdown'),
        roll: formula,
        allowEdit: false,
        originToken: token,
        icon: "fas fa-radiation"
    });
    if (!rolled)
        return false;
    const countdown = rolled.total;

    state.data = {
        type: "meltdown",
        title: localize('LA.dialogTitle.reactorMeltdownCountdown'),
        description: localizeFormat('LA.altStruct.meltdownCountdownBody', { turns: countdown, plural: countdown > 1 ? 's' : '' }),
        roll_str: formula,
        countdown: countdown
    };

    return true;
}

/** Executes a reactor meltdown; countdown length comes from the roll. */
export async function executeMeltdown(state)
{
    if (!state.data)
        throw new TypeError(`Meltdown flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
        return false;

    const countdown = state.data.countdown || 1;

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0)
    {
        console.log("lancer-automations | alt-struct |No active token found for actor");
        return false;
    }

    await executeReactorMeltdown(tokens[0], countdown);
    return true;
}

/** Executes a critical reactor meltdown: no countdown, resolves at end of next turn. */
export async function executeCriticalMeltdown(state)
{
    if (!state.data)
        state.data = {};

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
    {
        ui.notifications.warn(localize('LA.notify.onlyNpcsAndMechsCanHaveReactor'));
        return false;
    }

    state.data.type = "critical_meltdown";
    state.data.title = localize('LA.altStruct.criticalReactorMeltdown');
    state.data.desc = localize('LA.altStruct.criticalReactorMeltdownDesc');

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0)
    {
        console.log("lancer-automations | alt-struct |No active token found for actor");
        return false;
    }

    await executeReactorMeltdown(tokens[0], 1);
    return true;
}

/** noStressRemaining: NPC with max stress 1 gets EXPOSED; remStress 0 offers a Critical Meltdown button. */
export async function handleNoStressRemaining(state)
{
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc())
        return false;

    const remStress = state.data.remStress;

    if (actor.is_npc() && actor.system.stress.max === 1)
    {
        const tokens = actor.getActiveTokens();
        if (tokens && tokens.length > 0)
        {
            const token = tokens[0];
            try
            {
                // Apply EXPOSED without duration (permanent until removed)
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "NPC Overheat",
                });
            }
            catch (error)
            {
                console.warn("lancer-automations | alt-struct |Could not apply EXPOSED effect:", error);
            }
        }
    }

    else if (remStress === 0)
        pushEmbedButton(state, { flowType: 'CriticalMeltdownFlow', actorUuid: actor.uuid, icon: 'fas fa-radiation', label: 'LA.altStruct.criticalMeltdown' });

    // the system's preOverheatRollChecks already set heat to the overflow remainder; zeroing it here would eat the overflow

    return true;
}
