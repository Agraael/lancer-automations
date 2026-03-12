/* global game, ui */

import { altRollStress, insertEngheckButton, stressCheckMultipleOnes, applyStressEffects, handleStressEngineeringCheckResult, rollMeltdownCountdown, executeMeltdown, executeCriticalMeltdown, handleNoStressRemaining } from "./stress.js";
import { altRollStructure, structCheckMultipleOnes, insertHullCheckButton, insertSecondaryRollButton, applyStructureEffects, selectDestructionTargetDirectHitFallback, selectDestructionTargetCrushingHitFallback, handleDirectHitHullCheckResult, handleCrushingHitHullCheckResult, manualSystemTrauma, tearOffCrushingHitFlow, tearOffDirectHitFlow } from "./structure.js";

// Captured during registerAltStructFlowSteps, used in initAltStructReady
let _flowSteps = null;
let _flows = null;

// Saved originals so we can restore if the setting is disabled at ready time
const _savedFlowSteps = {};
const _savedFlowStepArrays = {};  // for flows whose .steps arrays were spliced
const _addedFlowKeys = [];        // new flow keys we added

async function initSecondaryStructureCrushingHit(state) {
    state.data = {
        type: "secondary_structure",
        title: "Equipment Destruction",
        desc: "",
        roll_str: "1d6"
    };
    return true;
}

/**
 * Called from main.js inside the lancer.registerFlows hook.
 * Registers alternative structure/stress flow steps.
 * Only checks conflict here (game.settings not yet available at this point).
 * The setting check is deferred to initAltStructReady().
 */
export function registerAltStructFlowSteps(flowSteps, flows) {
    _flowSteps = flowSteps;
    _flows = flows;

    // Conflict check uses game.modules which is always available
    if (game.modules.get('lancer-alt-structure')?.active)
        return;

    // ── Save originals for potential rollback in initAltStructReady ──
    const structureStepKeys = [
        "rollStructureTable", "checkStructureMultipleOnes",
        "structureInsertHullCheckButton", "structureInsertSecondaryRollButton",
        "applyStructureEffects", "selectDestructionTargetDirectHitFallback",
        "selectDestructionTargetCrushingHitFallback", "handleDirectHitHullCheckResult",
        "handleCrushingHitHullCheckResult", "tearOffCrushingHitFlow", "tearOffDirectHitFlow",
        "initSecondaryStructureCrushingHit"
    ];
    const stressStepKeys = [
        "rollOverheatTable", "checkOverheatMultipleOnes", "overheatInsertEngCheckButton",
        "applyStressEffects", "handleStressEngineeringCheckResult",
        "rollMeltdownCountdown", "executeMeltdown", "executeCriticalMeltdown"
    ];
    for (const key of [...structureStepKeys, ...stressStepKeys]) {
        _savedFlowSteps[key] = flowSteps.get(key) ?? null;
    }

    const flowsToSplice = ["StructureFlow", "SecondaryStructureFlow", "OverheatFlow"];
    for (const key of flowsToSplice) {
        const f = flows.get(key);
        _savedFlowStepArrays[key] = f?.steps ? [...f.steps] : null;
    }

    const newFlowKeys = [
        "secondaryStructureCrushingHit", "TearOffDirectHitFlow", "TearOffCrushingHitFlow",
        "DirectHitHullCheckFlow", "CrushingHitHullCheckFlow", "SimulatedStructureFlow",
        "StressEngineeringCheckFlow", "MeltdownFlow", "CriticalMeltdownFlow"
    ];
    _addedFlowKeys.push(...newFlowKeys);

    // ── Structure flow steps ──
    flowSteps.set("rollStructureTable", altRollStructure);
    flowSteps.set("checkStructureMultipleOnes", structCheckMultipleOnes);
    flowSteps.set("structureInsertHullCheckButton", insertHullCheckButton);
    flowSteps.set("structureInsertSecondaryRollButton", insertSecondaryRollButton);
    flowSteps.set("applyStructureEffects", applyStructureEffects);
    flowSteps.set("selectDestructionTargetDirectHitFallback", selectDestructionTargetDirectHitFallback);
    flowSteps.set("selectDestructionTargetCrushingHitFallback", selectDestructionTargetCrushingHitFallback);
    flowSteps.set("handleDirectHitHullCheckResult", handleDirectHitHullCheckResult);
    flowSteps.set("handleCrushingHitHullCheckResult", handleCrushingHitHullCheckResult);
    flowSteps.set("tearOffCrushingHitFlow", tearOffCrushingHitFlow);
    flowSteps.set("tearOffDirectHitFlow", tearOffDirectHitFlow);
    flowSteps.set("initSecondaryStructureCrushingHit", initSecondaryStructureCrushingHit);

    const StructureFlow = flows.get("StructureFlow");
    if (StructureFlow?.steps) {
        const idx = StructureFlow.steps.indexOf("printStructureCard");
        if (idx > -1)
            StructureFlow.steps.splice(idx, 0, "applyStructureEffects");
    }

    const SecondaryStructureFlow = flows.get("SecondaryStructureFlow");
    if (SecondaryStructureFlow?.steps) {
        const idx = SecondaryStructureFlow.steps.indexOf("printSecondaryStructureCard");
        if (idx > -1)
            SecondaryStructureFlow.steps.splice(idx + 1, 0, "selectDestructionTargetDirectHitFallback", "printGenericCard");
    }

    flows.set("secondaryStructureCrushingHit", { name: "Secondary Structure Crushing Hit", steps: ["initSecondaryStructureCrushingHit", "secondaryStructureRoll", "printSecondaryStructureCard", "selectDestructionTargetCrushingHitFallback", "printGenericCard"] });
    flows.set("TearOffDirectHitFlow", { name: "Tear Off Direct Hit", steps: ["tearOffDirectHitFlow"] });
    flows.set("TearOffCrushingHitFlow", { name: "Tear Off Crushing Hit", steps: ["tearOffCrushingHitFlow"] });
    flows.set("DirectHitHullCheckFlow", { name: "Direct Hit HULL Check", steps: ["initStatRollData", "showStatRollHUD", "rollCheck", "handleDirectHitHullCheckResult", "printStatRollCard"] });
    flows.set("CrushingHitHullCheckFlow", { name: "Crushing Hit HULL Check", steps: ["initStatRollData", "showStatRollHUD", "rollCheck", "handleCrushingHitHullCheckResult", "printStatRollCard"] });
    flows.set("SimulatedStructureFlow", { name: "Simulated Structure Hit", steps: ["rollStructureTable", "noStructureRemaining", "checkStructureMultipleOnes", "structureInsertDismembermentButton", "structureInsertHullCheckButton", "structureInsertSecondaryRollButton", "structureInsertCascadeRollButton", "applyStructureEffects", "printStructureCard"] });

    // ── Stress flow steps ──
    flowSteps.set("rollOverheatTable", altRollStress);
    flowSteps.set("checkOverheatMultipleOnes", stressCheckMultipleOnes);
    flowSteps.set("overheatInsertEngCheckButton", insertEngheckButton);
    flowSteps.set("applyStressEffects", applyStressEffects);
    flowSteps.set("handleStressEngineeringCheckResult", handleStressEngineeringCheckResult);
    flowSteps.set("rollMeltdownCountdown", rollMeltdownCountdown);
    flowSteps.set("executeMeltdown", executeMeltdown);
    flowSteps.set("executeCriticalMeltdown", executeCriticalMeltdown);

    const OverheatFlow = flows.get("OverheatFlow");
    if (OverheatFlow?.steps) {
        const idx = OverheatFlow.steps.indexOf("printOverheatCard");
        if (idx > -1)
            OverheatFlow.steps.splice(idx, 0, "applyStressEffects");
    }

    flows.set("StressEngineeringCheckFlow", { name: "Stress Engineering Check", steps: ["initStatRollData", "showStatRollHUD", "rollCheck", "handleStressEngineeringCheckResult", "printStatRollCard"] });
    flows.set("MeltdownFlow", { name: "Reactor Meltdown", steps: ["rollMeltdownCountdown", "executeMeltdown", "printGenericCard"] });
    flows.set("CriticalMeltdownFlow", { name: "Critical Reactor Meltdown", steps: ["executeCriticalMeltdown", "printGenericCard"] });

    console.log("lancer-automations (alt-struct): flow steps registered (pending setting check at ready)");
}

/**
 * Called from main.js inside the ready hook (after registerSettings has run).
 * Checks the setting — restores originals if disabled, finishes init if enabled.
 */
export function initAltStructReady() {
    const hasConflict = game.modules.get('lancer-alt-structure')?.active;
    const isEnabled = game.settings.get('lancer-automations', 'enableAltStruct');

    if (hasConflict) {
        if (isEnabled) {
            ui.notifications.warn(
                "Lancer Automations: Alt Structure feature is enabled but the standalone 'lancer-alt-structure' module is also active — integrated version will not load. Disable one of them."
            );
        }
        // Restore originals (they were overridden in registerAltStructFlowSteps before conflict check could use settings)
        _restoreOriginals();
        return;
    }

    if (!isEnabled) {
        _restoreOriginals();
        return;
    }

    // ── Wrap noStressRemaining ──
    const originalNoStressRemaining = _flowSteps?.get("noStressRemaining");
    if (!originalNoStressRemaining) {
        console.warn("lancer-automations (alt-struct): noStressRemaining flow step not found");
    } else {
        _flowSteps.set("noStressRemaining", async function(state) {
            await handleNoStressRemaining(state);
            return await originalNoStressRemaining(state);
        });
    }

    // ── Expose on module API ──
    const mod = game.modules.get('lancer-automations');
    if (mod?.api) {
        mod.api.manualSystemTrauma = manualSystemTrauma;
    }

    console.log("lancer-automations (alt-struct): initialized");
}

function _restoreOriginals() {
    if (!_flowSteps)
        return;

    // Restore overridden flow steps
    for (const [key, fn] of Object.entries(_savedFlowSteps)) {
        if (fn !== undefined) {
            if (fn === null)
                _flowSteps.delete(key);
            else
                _flowSteps.set(key, fn);
        }
    }

    // Restore spliced steps arrays
    if (_flows) {
        for (const [key, steps] of Object.entries(_savedFlowStepArrays)) {
            if (steps !== null) {
                const flow = _flows.get(key);
                if (flow)
                    flow.steps = steps;
            }
        }
        // Remove added flows
        for (const key of _addedFlowKeys) {
            _flows.delete(key);
        }
    }

    console.log("lancer-automations (alt-struct): alt structure disabled, originals restored");
}
