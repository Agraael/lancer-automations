/* global ui */

import { applyEffectsToTokens } from "../flagged-effects.js";
import { executeReactorMeltdown } from "../misc-tools.js";

const stressTableTitles = [
    "Critical Reactor Failure",
    "Meltdown",
    "Power Failure",
    "Power Failure",
    "Power Failure",
    "Emergency Shunt",
    "Emergency Shunt",
];

function stressTableDescriptions(roll, remStress) {
    switch (roll) {
    // Used for multiple ones
    case 0:
        return "Your Mech is Exposed and Throttled, and suffers a reactor meltdown at the end of your next turn. You can end this effect by stabilizing, or by passing an <strong>ENGINEERING</strong> check as a quick action.";
    case 1:
        switch (remStress) {
        case 2:
            return "Your mech must roll an <strong>ENGINEERING</strong> check. On a success, it is Slowed and Throttled until the end of your next turn. On a failure, it is Exposed and suffers a reactor meltdown after 1d3 of your turns (rolled by the GM). This effect can be ended by stabilizing, or by making a successful <strong>ENGINEERING</strong> check as a quick action.";
        case 1:
            return "Your mech is Exposed, and you must pass an <strong>ENGINEERING</strong> check. On a success, it becomes Throttled until the end of your next turn. On a failure, your mech suffers a reactor meltdown after 1d3 of your turns. This effect can be ended by stabilizing, or by passing an <strong>ENGINEERING</strong> check as a quick action.";
        default:
            return "Roll an <strong>ENGINEERING</strong> check. On a success, your mech is Slowed and Throttled until the end of your next turn. On a failure, your mech becomes Exposed.";
        }
    case 2:
    case 3:
    case 4:
        return "Your mech suffers catastrophic disruption to power regulation as it tries to divert energy to critical safety systems. Your mech is Slowed and Throttled until the end of your next turn.";
    case 5:
    case 6:
        return "Your mech's cooling systems manage to contain the increasing heat; however, your mech becomes Impaired until the end of your next turn.";
    }
    return "";
}

const getRollCount = (roll, num_to_count) => {
    return roll
        ? roll.terms[0].results.filter((v) => v.result === num_to_count).length
        : 0;
};

export async function altRollStress(state) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);
    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can roll stress.");
        return false;
    }

    // Skip this step for 1-stress NPCs.
    if (actor.is_npc() && actor.system.stress.max === 1) {
        const one_roll = 3;
        const one_stress = 1;
        state.data = {
            type: "stress",
            title: stressTableTitles[one_roll],
            desc: stressTableDescriptions(one_roll, one_stress),
            remStress: one_stress,
            val: actor.system.stress.value,
            max: actor.system.stress.max,
            roll_str: String(one_roll),
            result: undefined,
        };
        return true;
    }

    if ((state.data?.reroll_data?.stress ?? actor.system.stress.value) >=
    actor.system.stress.max) {
        ui.notifications.info(
            "The mech is at full Stress, no stress check to roll."
        );
        return false;
    }

    let remStress = state.data?.reroll_data?.stress ?? actor.system.stress.value;
    let damage = actor.system.stress.max - remStress;
    let formula = `${damage}d6kl1`;
    // If it's an NPC with legendary, change the formula to roll twice and keep the best result.
    if (actor.is_npc() &&
    actor.items.some((i) => ["npcf_legendary_ultra", "npcf_legendary_veteran"].includes(i.system.lid)
    )) {
        formula = `{${formula}, ${formula}}kh`;
    }
    let roll = await new Roll(formula).evaluate();

    let result = roll.total;
    if (result === undefined)
        return false;

    state.data = {
        type: "stress",
        title: stressTableTitles[result],
        desc: stressTableDescriptions(result, remStress),
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

export async function stressCheckMultipleOnes(state) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    let actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can roll stress.");
        return false;
    }

    const roll = state.data.result?.roll;
    if (!roll)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    // Crushing hits
    let one_count = getRollCount(roll, 1);
    if (one_count > 1) {
        state.data.title = stressTableTitles[0];
        state.data.desc = stressTableDescriptions(0, 1);
    }

    return true;
}

export async function insertEngheckButton(state) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    let actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can roll stress.");
        return false;
    }

    let show_button = false;
    const result = state.data.result;
    if (!result)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    const roll = result.roll;

    switch (roll.total) {
    case 1:
        show_button = true;
        break;
    }

    let one_count = getRollCount(roll, 1);

    if (show_button && !(one_count > 1)) {
        state.data.embedButtons = state.data.embedButtons || [];
        state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="StressEngineeringCheckFlow"
            data-check-type="engineering"
            data-actor-id="${actor.uuid}"
          >
            <i class="fas fa-dice-d20 i--sm"></i> ENGINEERING
          </a>`);
    }
    return true;
}

/**
 * Apply automatic effects based on stress/overheat roll result
 * - Power Fail (2-4): Apply SLOW + DAZED until end of next turn
 * - Emergency Shunt (5-6): Apply IMPAIRED until end of next turn
 * - Multiple 1s: Apply EXPOSED + DAZED (+ meltdown check)
 */
export async function applyStressEffects(state) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        return false;
    }

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Stress check hasn't been rolled yet!`);

    const roll = result.roll;
    const rollTotal = roll.total;

    // Get the token for this actor
    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0) {
        console.log("lancer-automations (alt-struct): No active token found for actor");
        return true;
    }

    const token = tokens[0];

    // Check for multiple 1s
    const one_count = getRollCount(roll, 1);
    const hasMultipleOnes = one_count > 1;

    // Apply effects based on roll result
    if (hasMultipleOnes) {
    // Multiple 1s: EXPOSED + DAZED + Critical Meltdown
        try {
            await applyEffectsToTokens({
                tokens: [token],
                effectNames: ["exposed", "dazed"],
                note: "Critical Stress Failure",
                duration: { label: 'end', turns: 1, rounds: 0 },
            });
        } catch (error) {
            console.warn("lancer-automations (alt-struct): Could not apply EXPOSED + DAZED effects:", error);
        }

        // Add Critical Meltdown button
        state.data.embedButtons = state.data.embedButtons || [];
        state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="CriticalMeltdownFlow"
            data-actor-id="${actor.uuid}"
          >
            <i class="fas fa-radiation i--sm"></i> CRITICAL MELTDOWN
          </a>`);
    } else {
    // Single die result
        switch (rollTotal) {
        case 2:
        case 3:
        case 4:
        // Power Fail: SLOW + DAZED until end of next turn
            try {
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "dazed"],
                    note: "Power Fail",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } catch (error) {
                console.warn("lancer-automations (alt-struct): Could not apply SLOW + DAZED effects:", error);
            }
            break;

        case 5:
        case 6:
        // Emergency Shunt: IMPAIRED until end of next turn
            try {
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["impaired"],
                    note: "Emergency Shunt",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } catch (error) {
                console.warn("lancer-automations (alt-struct): Could not apply IMPAIRED effect:", error);
            }
            break;

        case 1:
        // Single 1: Engineering check required (handled by button)
        // Effects applied after engineering check result
            break;
        }
    }

    return true;
}

/**
 * Apply effects based on engineering check result for single 1 stress roll
 */
async function applyEngineeringCheckEffects(state, engineeringSuccess) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        return false;
    }

    const remStress = state.data.remStress;

    // Get the token for this actor
    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0) {
        console.log("lancer-automations (alt-struct): No active token found for actor");
        return true;
    }

    const token = tokens[0];

    try {
        if (remStress >= 3) {
            // 3+ stress remaining
            if (engineeringSuccess) {
                // Success: SLOW + DAZED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "dazed"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } else {
                // Failure: EXPOSED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "Engineering Check Failure",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            }
        } else if (remStress === 2) {
            // 2 stress remaining
            if (engineeringSuccess) {
                // Success: SLOW + DAZED
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["slow", "dazed"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } else {
                // Failure: EXPOSED + Meltdown
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "Engineering Check Failure",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });

                // Add Meltdown button
                state.data.embedButtons = state.data.embedButtons || [];
                state.data.embedButtons.push(`<a
                class="flow-button lancer-button"
                data-flow-type="MeltdownFlow"
                data-actor-id="${actor.uuid}"
              >
                <i class="fas fa-radiation i--sm"></i> MELTDOWN
              </a>`);
            }
        } else if (remStress === 1) {
            // 1 stress remaining
            if (engineeringSuccess) {
                // Success: DAZED only
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["dazed"],
                    note: "Engineering Check Success",
                    duration: { label: 'end', turns: 1, rounds: 0 },
                });
            } else {
                // Failure: Meltdown
                state.data.embedButtons = state.data.embedButtons || [];
                state.data.embedButtons.push(`<a
                class="flow-button lancer-button"
                data-flow-type="MeltdownFlow"
                data-actor-id="${actor.uuid}"
              >
                <i class="fas fa-radiation i--sm"></i> MELTDOWN
              </a>`);
            }
        }
    } catch (error) {
        console.warn("lancer-automations (alt-struct): Could not apply engineering check effects:", error);
    }

    return true;
}

/**
 * Handle Engineering check result for single 1 stress roll
 */
export async function handleStressEngineeringCheckResult(state) {
    console.log("lancer-automations (alt-struct): handleStressEngineeringCheckResult EXECUTING");
    if (!state.data)
        throw new TypeError(`Check flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can perform this action.");
        return false;
    }

    const result = state.data.result;
    if (!result)
        throw new TypeError(`Engineering check hasn't been rolled yet!`);

    const roll = result.roll;
    const DC = 10;
    const success = roll.total >= DC;

    // Get the remStress from the actor
    const remStress = state.actor.system.stress.value;

    // Store remStress in state data for applyEngineeringCheckEffects
    state.data.remStress = remStress;

    // Apply effects based on engineering check result
    await applyEngineeringCheckEffects(state, success);

    return true;
}

/**
 * Roll 1d3 for meltdown countdown
 */
export async function rollMeltdownCountdown(state) {
    if (!state.data)
        throw new TypeError(`Meltdown flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can roll meltdown.");
        return false;
    }

    // Roll 1d3 for meltdown countdown
    const roll = await new Roll("1d3").evaluate();
    const countdown = roll.total;

    state.data = {
        type: "meltdown",
        title: "Reactor Meltdown Countdown",
        desc: `Your reactor will melt down in ${countdown} turn${countdown > 1 ? 's' : ''}.`,
        roll_str: "1d3",
        result: {
            roll: roll,
            tt: await roll.getTooltip(),
            total: countdown.toString(),
        },
        countdown: countdown
    };

    return true;
}

/**
 * Execute reactor meltdown with countdown from roll
 */
export async function executeMeltdown(state) {
    if (!state.data)
        throw new TypeError(`Meltdown flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        return false;
    }

    const countdown = state.data.countdown || 1;

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0) {
        console.log("lancer-automations (alt-struct): No active token found for actor");
        return false;
    }

    await executeReactorMeltdown(tokens[0], countdown);
    return true;
}

/**
 * Execute critical reactor meltdown (immediate, at end of next turn)
 */
export async function executeCriticalMeltdown(state) {
    if (!state.data)
        state.data = {};

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        ui.notifications.warn("Only npcs and mechs can have reactor meltdown.");
        return false;
    }

    state.data.type = "critical_meltdown";
    state.data.title = "Critical Reactor Meltdown";
    state.data.desc = "Your reactor goes critical and will melt down at the end of your next turn!";

    const tokens = actor.getActiveTokens();
    if (!tokens || tokens.length === 0) {
        console.log("lancer-automations (alt-struct): No active token found for actor");
        return false;
    }

    await executeReactorMeltdown(tokens[0], 1);
    return true;
}

/**
 * Handle noStressRemaining cases:
 * - If NPC with max stress = 1: Apply EXPOSED immediately (no duration)
 * - If remStress = 0 (critical): Add Critical Meltdown button
 */
export async function handleNoStressRemaining(state) {
    if (!state.data)
        throw new TypeError(`Stress roll flow data missing!`);

    const actor = state.actor;
    if (!actor.is_mech() && !actor.is_npc()) {
        return false;
    }

    const remStress = state.data.remStress;

    // Check if lancer-automations module is active
    // Case 1: NPC with max stress = 1
    if (actor.is_npc() && actor.system.stress.max === 1) {
        const tokens = actor.getActiveTokens();
        if (tokens && tokens.length > 0) {
            const token = tokens[0];
            try {
                // Apply EXPOSED without duration (permanent until removed)
                await applyEffectsToTokens({
                    tokens: [token],
                    effectNames: ["exposed"],
                    note: "NPC Overheat",
                });
            } catch (error) {
                console.warn("lancer-automations (alt-struct): Could not apply EXPOSED effect:", error);
            }
        }
    }

    // Case 2: remStress = 0 (critical reactor failure)
    else if (remStress === 0) {
    // Add Critical Meltdown button
        state.data.embedButtons = state.data.embedButtons || [];
        state.data.embedButtons.push(`<a
            class="flow-button lancer-button"
            data-flow-type="CriticalMeltdownFlow"
            data-actor-id="${actor.uuid}"
          >
            <i class="fas fa-radiation i--sm"></i> CRITICAL MELTDOWN
          </a>`);
    }

    if (!(actor.is_npc() && actor.system.stress.max === 1)) {
        await actor.update({ "system.heat.value": 0 });
    }

    return true;
}
