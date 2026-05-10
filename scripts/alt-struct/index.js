/* global game, ui, Hooks */

import { altRollStress, insertEngheckButton, stressCheckMultipleOnes, applyStressEffects, handleStressEngineeringCheckResult, rollMeltdownCountdown, executeMeltdown, executeCriticalMeltdown, handleNoStressRemaining } from "./stress.js";
import { npcOneStructStep, altRollStructure, structCheckMultipleOnes, insertHullCheckButton, insertSecondaryRollButton, applyStructureEffects, selectDestructionTargetDirectHitFallback, selectDestructionTargetCrushingHitFallback, handleDirectHitHullCheckResult, handleCrushingHitHullCheckResult, manualSystemTrauma, tearOffCrushingHitFlow, tearOffDirectHitFlow } from "./structure.js";

let _flowSteps = null;
let _flows = null;
const _preInstallSnapshot = new Map();
const _preRegisterCollisions = { steps: [], flows: [] };

const OVERRIDE_STEP_KEYS = [
    "rollStructureTable", "checkStructureMultipleOnes",
    "structureInsertHullCheckButton", "structureInsertSecondaryRollButton",
    "rollOverheatTable", "checkOverheatMultipleOnes", "overheatInsertEngCheckButton"
];
const NEW_STEP_KEYS = [
    "npcOneStructStep", "applyStructureEffects", "selectDestructionTargetDirectHitFallback",
    "selectDestructionTargetCrushingHitFallback", "handleDirectHitHullCheckResult",
    "handleCrushingHitHullCheckResult", "tearOffCrushingHitFlow", "tearOffDirectHitFlow",
    "initSecondaryStructureCrushingHit", "applyStressEffects",
    "handleStressEngineeringCheckResult", "rollMeltdownCountdown",
    "executeMeltdown", "executeCriticalMeltdown"
];
const ALL_STEP_KEYS = [...OVERRIDE_STEP_KEYS, ...NEW_STEP_KEYS];
const NEW_FLOW_KEYS = [
    "secondaryStructureCrushingHit", "secondaryStructureDirectHit",
    "TearOffDirectHitFlow", "TearOffCrushingHitFlow",
    "DirectHitHullCheckFlow", "CrushingHitHullCheckFlow", "SimulatedStructureFlow",
    "StressEngineeringCheckFlow", "MeltdownFlow", "CriticalMeltdownFlow"
];

async function initSecondaryStructureCrushingHit(state) {
    state.data = {
        type: "secondary_structure",
        title: "Equipment Destruction",
        desc: "",
        roll_str: "1d6"
    };
    return true;
}

// Snapshot only — install is deferred to ready so we can read the setting and
// avoid stomping on other modules when the feature is off.
export function registerAltStructFlowSteps(flowSteps, flows) {
    _flowSteps = flowSteps;
    _flows = flows;
    _preInstallSnapshot.clear();
    for (const key of ALL_STEP_KEYS)
        _preInstallSnapshot.set(key, flowSteps.get(key) ?? null);
    _preRegisterCollisions.steps = NEW_STEP_KEYS.filter(k => flowSteps.get(k) != null);
    _preRegisterCollisions.flows = NEW_FLOW_KEYS.filter(k => flows.get(k) != null);
}

function setupHooks(flowSteps, flows) {
    flowSteps.set("npcOneStructStep", npcOneStructStep);
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
    flows.get("StructureFlow")?.insertStepBefore?.("preStructureRollChecks", "npcOneStructStep");

    const SecondaryStructureFlow = flows.get("SecondaryStructureFlow");
    if (SecondaryStructureFlow?.steps) {
        const idx = SecondaryStructureFlow.steps.indexOf("printSecondaryStructureCard");
        if (idx > -1)
            SecondaryStructureFlow.steps.splice(idx + 1, 0, "selectDestructionTargetDirectHitFallback", "printGenericCard");
    }

    flows.set("secondaryStructureCrushingHit", { name: "Secondary Structure Crushing Hit", steps: ["initSecondaryStructureCrushingHit", "secondaryStructureRoll", "printSecondaryStructureCard", "selectDestructionTargetCrushingHitFallback", "printGenericCard"] });
    flows.set("secondaryStructureDirectHit",   { name: "Secondary Structure Direct Hit",   steps: ["initSecondaryStructureCrushingHit", "secondaryStructureRoll", "printSecondaryStructureCard", "selectDestructionTargetDirectHitFallback",   "printGenericCard"] });
    flows.set("TearOffDirectHitFlow", { name: "Tear Off Direct Hit", steps: ["tearOffDirectHitFlow"] });
    flows.set("TearOffCrushingHitFlow", { name: "Tear Off Crushing Hit", steps: ["tearOffCrushingHitFlow"] });
    flows.set("DirectHitHullCheckFlow", { name: "Direct Hit HULL Check", steps: ["initStatRollData", "showStatRollHUD", "rollCheck", "handleDirectHitHullCheckResult", "printStatRollCard"] });
    flows.set("CrushingHitHullCheckFlow", { name: "Crushing Hit HULL Check", steps: ["initStatRollData", "showStatRollHUD", "rollCheck", "handleCrushingHitHullCheckResult", "printStatRollCard"] });
    flows.set("SimulatedStructureFlow", { name: "Simulated Structure Hit", steps: ["rollStructureTable", "noStructureRemaining", "checkStructureMultipleOnes", "structureInsertDismembermentButton", "structureInsertHullCheckButton", "structureInsertSecondaryRollButton", "structureInsertCascadeRollButton", "applyStructureEffects", "printStructureCard"] });

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
}

// Catches modules that hook AFTER us — snapshot vs current at ready.
function _detectPostRegisterConflicts(flowSteps) {
    const conflicts = [];
    for (const key of ALL_STEP_KEYS) {
        const snapshot = _preInstallSnapshot.get(key);
        const current = flowSteps.get(key) ?? null;
        if (snapshot !== current)
            conflicts.push(key);
    }
    return conflicts;
}

// Catches modules that hook BEFORE us. Stock Lancer step fns are named to match
// their key; if the snapshot fn has a different name, someone replaced it.
function _detectPreRegisterOverrideHijacks() {
    const hijacked = [];
    for (const key of OVERRIDE_STEP_KEYS) {
        const fn = _preInstallSnapshot.get(key);
        if (typeof fn !== 'function')
            continue;
        if (fn.name && fn.name !== key)
            hijacked.push({ key, byFunctionName: fn.name });
    }
    return hijacked;
}

export function initAltStructReady() {
    const hasConflict = game.modules.get('lancer-alt-structure')?.active;
    const isEnabled = game.settings.get('lancer-automations', 'enableAltStruct');

    // One-struct NPCs is its own opt-in, independent of the full alt-struct rules.
    if (!isEnabled) {
        if (game.settings.get('lancer-automations', 'enableOneStructNpc')) {
            _flowSteps?.set('npcOneStructStep', npcOneStructStep);
            _flows?.get('StructureFlow')?.insertStepBefore?.('preStructureRollChecks', 'npcOneStructStep');
        }
        return;
    }

    if (hasConflict) {
        ui.notifications.warn(
            "Lancer Automations: Alt Structure feature is enabled but the standalone 'lancer-alt-structure' module is also active - integrated version will not load. Disable one of them."
        );
        return;
    }

    const preSteps = _preRegisterCollisions.steps;
    const preFlows = _preRegisterCollisions.flows;
    const postConflicts = _detectPostRegisterConflicts(_flowSteps);
    const preHijacks = _detectPreRegisterOverrideHijacks();

    const totalConflicts = preSteps.length + preFlows.length + postConflicts.length + preHijacks.length;
    if (totalConflicts > 0) {
        const parts = [];
        if (preSteps.length)
            parts.push(`new flow step(s) already claimed: ${preSteps.join(", ")}`);
        if (preFlows.length)
            parts.push(`new flow(s) already claimed: ${preFlows.join(", ")}`);
        if (postConflicts.length)
            parts.push(`override step(s) modified after us: ${postConflicts.join(", ")}`);
        if (preHijacks.length)
            parts.push(`override step(s) already replaced before us: ${preHijacks.map(h => `${h.key} (by ${h.byFunctionName})`).join(", ")}`);
        ui.notifications.warn(
            `Lancer Automations (Alt Structure): flow conflict detected. The other module's changes will be overwritten. ${parts.join(" | ")}. See console.`,
            { permanent: true }
        );
        console.warn("lancer-automations (alt-struct): flow conflicts", { preSteps, preFlows, postConflicts, preHijacks });
    }

    setupHooks(_flowSteps, _flows);
    _registerChatHook();

    // Chain our handler in front of the original noStressRemaining.
    const originalNoStressRemaining = _flowSteps?.get("noStressRemaining");
    if (!originalNoStressRemaining) {
        console.warn("lancer-automations (alt-struct): noStressRemaining flow step not found");
    } else {
        _flowSteps.set("noStressRemaining", async function(state) {
            await handleNoStressRemaining(state);
            return await originalNoStressRemaining(state);
        });
    }

    const mod = game.modules.get('lancer-automations');
    if (mod?.api)
        mod.api.manualSystemTrauma = manualSystemTrauma;

    console.log("lancer-automations (alt-struct): initialized");
}

let _chatHookRegistered = false;

function _runAltStructFlow(btn) {
    const flowType = btn.dataset.flowType;
    const actorId = btn.dataset.actorId;
    if (!flowType || !actorId) {
        ui.notifications?.error("Missing flow type or actor ID on alt-struct button.");
        return;
    }
    const Flow = /** @type {any} */ (game)?.lancer?.Flow;
    const flowDef = /** @type {any} */ (game)?.lancer?.flows?.get(flowType);
    if (!Flow || !flowDef?.steps) {
        ui.notifications?.error(`Alt-struct flow "${flowType}" not registered.`);
        return;
    }
    const data = { ...btn.dataset };
    delete data.flowType;
    delete data.actorId;
    if (data.checkType) {
        data.type = "stat";
        data.path = `system.${data.checkType}`;
        const cap = data.checkType[0].toUpperCase() + data.checkType.slice(1);
        data.title = data.title ?? `${cap} Check`;
        data.bonus = 0;
        data.roll_str = "1d20";
    }
    class AltStructFlow extends Flow {}
    AltStructFlow.steps = flowDef.steps;
    Object.defineProperty(AltStructFlow, "name", { value: flowType });
    new AltStructFlow(actorId, data).begin();
}

function _registerChatHook() {
    if (_chatHookRegistered) {
        return;
    }
    _chatHookRegistered = true;
    Hooks.on("renderChatMessage", (_app, html) => {
        html.find(".alt-struct-flow-button").on("click", function (ev) {
            ev.stopPropagation();
            _runAltStructFlow(this);
        });
    });
}
