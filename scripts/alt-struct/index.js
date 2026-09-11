/* global game, ui, Hooks */

import { altRollStress, insertEngineeringCheckButton, stressCheckMultipleOnes, applyStressEffects, handleStressEngineeringCheckResult, rollMeltdownCountdown, executeMeltdown, executeCriticalMeltdown, handleNoStressRemaining } from "./stress.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { npcOneStructStep, altRollStructure, structCheckMultipleOnes, insertHullCheckButton, insertSecondaryRollButton, applyStructureEffects, selectDestructionTargetDirectHitFallback, selectDestructionTargetCrushingHitFallback, handleDirectHitHullCheckResult, handleCrushingHitHullCheckResult, manualSystemTrauma, tearOffCrushingHitFlow, tearOffDirectHitFlow, interactiveSecondaryStructureRoll } from "./structure.js";
import { baseApplyStructureEffects, baseInsertHullCheckButton, baseHandleHullCheckResult, baseSelectDestructionTarget, baseApplyStressEffects, baseHandleNoStressRemaining, baseInsertEngCheckButton, baseHandleEngCheckResult } from "./base-rules.js";
import { executeStatRoll } from "../tools/misc-tools.js";

let _flowSteps = null;
let _flows = null;
const _preInstallSnapshot = new Map();
const _preRegisterCollisions = { steps: [], flows: [] };

const OVERRIDE_STEP_KEYS = [
    "rollStructureTable", "checkStructureMultipleOnes",
    "structureInsertHullCheckButton", "structureInsertSecondaryRollButton",
    "rollOverheatTable", "checkOverheatMultipleOnes", "overheatInsertEngCheckButton",
    "noStressRemaining", "secondaryStructureRoll"
];
const NEW_STEP_KEYS = [
    "npcOneStructStep", "applyStructureEffects", "selectDestructionTargetDirectHitFallback",
    "selectDestructionTargetCrushingHitFallback", "tearOffCrushingHitFlow", "tearOffDirectHitFlow",
    "initSecondaryStructureCrushingHit", "applyStressEffects", "rollMeltdownCountdown",
    "executeMeltdown", "executeCriticalMeltdown",
    "baseApplyStructureEffects", "baseSelectDestructionTarget", "baseApplyStressEffects"
];
const ALL_STEP_KEYS = [...OVERRIDE_STEP_KEYS, ...NEW_STEP_KEYS];
const NEW_FLOW_KEYS = [
    "secondaryStructureCrushingHit", "secondaryStructureDirectHit",
    "TearOffDirectHitFlow", "TearOffCrushingHitFlow", "SimulatedStructureFlow",
    "MeltdownFlow", "CriticalMeltdownFlow"
];

async function initSecondaryStructureCrushingHit(state)
{
    state.data = {
        type: "secondary_structure",
        title: "Equipment Destruction",
        desc: "",
        roll_str: "1d6"
    };
    return true;
}

// Defer install to ready so the setting gate works and we don't stomp on other modules.
export function registerAltStructFlowSteps(flowSteps, flows)
{
    _flowSteps = flowSteps;
    _flows = flows;
    _preInstallSnapshot.clear();
    for (const key of ALL_STEP_KEYS)
        _preInstallSnapshot.set(key, flowSteps.get(key) ?? null);
    _preRegisterCollisions.steps = NEW_STEP_KEYS.filter(k => flowSteps.get(k) != null);
    _preRegisterCollisions.flows = NEW_FLOW_KEYS.filter(k => flows.get(k) != null);
}

// Lancer's insertStepBefore/After double-insert when the anchor is missing, so resolve the index ourselves.
function insertSteps(flow, anchor, offset, ...steps)
{
    const idx = flow?.steps?.indexOf(anchor) ?? -1;
    if (idx > -1)
        flow.steps.splice(idx + offset, 0, ...steps);
    else
        console.warn(`lancer-automations | alt-struct |anchor "${anchor}" missing, skipped ${steps.join(", ")}`);
}

function chainNoStressRemaining(flowSteps, handler)
{
    const original = flowSteps?.get("noStressRemaining");
    if (!original)
    {
        console.warn("lancer-automations | alt-struct |noStressRemaining flow step not found");
        return;
    }
    flowSteps.set("noStressRemaining", async function (state)
    {
        await handler(state);
        return await original(state);
    });
}

function setupHooks(flowSteps, flows)
{
    flowSteps.set("npcOneStructStep", npcOneStructStep);
    flowSteps.set("rollStructureTable", altRollStructure);
    flowSteps.set("checkStructureMultipleOnes", structCheckMultipleOnes);
    flowSteps.set("structureInsertHullCheckButton", insertHullCheckButton);
    flowSteps.set("structureInsertSecondaryRollButton", insertSecondaryRollButton);
    flowSteps.set("applyStructureEffects", applyStructureEffects);
    flowSteps.set("selectDestructionTargetDirectHitFallback", selectDestructionTargetDirectHitFallback);
    flowSteps.set("selectDestructionTargetCrushingHitFallback", selectDestructionTargetCrushingHitFallback);
    flowSteps.set("tearOffCrushingHitFlow", tearOffCrushingHitFlow);
    flowSteps.set("tearOffDirectHitFlow", tearOffDirectHitFlow);
    flowSteps.set("initSecondaryStructureCrushingHit", initSecondaryStructureCrushingHit);
    flowSteps.set("secondaryStructureRoll", interactiveSecondaryStructureRoll);

    insertSteps(flows.get("StructureFlow"), "printStructureCard", 0, "applyStructureEffects");
    insertSteps(flows.get("StructureFlow"), "preStructureRollChecks", 0, "npcOneStructStep");
    insertSteps(flows.get("SecondaryStructureFlow"), "printSecondaryStructureCard", 1, "selectDestructionTargetDirectHitFallback", "printGenericCard");

    flows.set("secondaryStructureCrushingHit", { name: "Secondary Structure Crushing Hit", steps: ["initSecondaryStructureCrushingHit", "secondaryStructureRoll", "printSecondaryStructureCard", "selectDestructionTargetCrushingHitFallback", "printGenericCard"] });
    flows.set("secondaryStructureDirectHit",   { name: "Secondary Structure Direct Hit",   steps: ["initSecondaryStructureCrushingHit", "secondaryStructureRoll", "printSecondaryStructureCard", "selectDestructionTargetDirectHitFallback",   "printGenericCard"] });
    flows.set("TearOffDirectHitFlow", { name: "Tear Off Direct Hit", steps: ["tearOffDirectHitFlow"] });
    flows.set("TearOffCrushingHitFlow", { name: "Tear Off Crushing Hit", steps: ["tearOffCrushingHitFlow"] });
    flows.set("SimulatedStructureFlow", { name: "Simulated Structure Hit", steps: ["rollStructureTable", "noStructureRemaining", "checkStructureMultipleOnes", "structureInsertDismembermentButton", "structureInsertHullCheckButton", "structureInsertSecondaryRollButton", "structureInsertCascadeRollButton", "applyStructureEffects", "printStructureCard"] });

    flowSteps.set("rollOverheatTable", altRollStress);
    flowSteps.set("checkOverheatMultipleOnes", stressCheckMultipleOnes);
    flowSteps.set("overheatInsertEngCheckButton", insertEngineeringCheckButton);
    flowSteps.set("applyStressEffects", applyStressEffects);
    flowSteps.set("rollMeltdownCountdown", rollMeltdownCountdown);
    flowSteps.set("executeMeltdown", executeMeltdown);
    flowSteps.set("executeCriticalMeltdown", executeCriticalMeltdown);

    insertSteps(flows.get("OverheatFlow"), "printOverheatCard", 0, "applyStressEffects");

    flows.set("MeltdownFlow", { name: "Reactor Meltdown", steps: ["rollMeltdownCountdown", "executeMeltdown", "printGenericCard"] });
    flows.set("CriticalMeltdownFlow", { name: "Critical Reactor Meltdown", steps: ["executeCriticalMeltdown", "printGenericCard"] });

    chainNoStressRemaining(flowSteps, handleNoStressRemaining);
}

function setupBaseRules(flowSteps, flows)
{
    flowSteps.set("baseApplyStructureEffects", baseApplyStructureEffects);
    flowSteps.set("structureInsertHullCheckButton", baseInsertHullCheckButton);
    flowSteps.set("baseSelectDestructionTarget", baseSelectDestructionTarget);
    flowSteps.set("baseApplyStressEffects", baseApplyStressEffects);
    flowSteps.set("overheatInsertEngCheckButton", baseInsertEngCheckButton);
    flowSteps.set("secondaryStructureRoll", interactiveSecondaryStructureRoll);
    flowSteps.set("rollMeltdownCountdown", rollMeltdownCountdown);
    flowSteps.set("executeMeltdown", executeMeltdown);

    insertSteps(flows.get("StructureFlow"), "printStructureCard", 0, "baseApplyStructureEffects");
    insertSteps(flows.get("OverheatFlow"), "printOverheatCard", 0, "baseApplyStressEffects");
    insertSteps(flows.get("SecondaryStructureFlow"), "printSecondaryStructureCard", 1, "baseSelectDestructionTarget", "printGenericCard");

    flows.set("MeltdownFlow", { name: "Reactor Meltdown", steps: ["rollMeltdownCountdown", "executeMeltdown", "printGenericCard"] });

    chainNoStressRemaining(flowSteps, baseHandleNoStressRemaining);
    _registerChatHook();
}

function _detectPostRegisterConflicts(flowSteps)
{
    const conflicts = [];
    for (const key of ALL_STEP_KEYS)
    {
        const snapshot = _preInstallSnapshot.get(key);
        const current = flowSteps.get(key) ?? null;
        if (snapshot !== current)
            conflicts.push(key);
    }
    return conflicts;
}

// Stock Lancer step fns are named after their key; a mismatch means someone replaced it.
function _detectPreRegisterOverrideHijacks()
{
    const hijacked = [];
    for (const key of OVERRIDE_STEP_KEYS)
    {
        const fn = _preInstallSnapshot.get(key);
        if (typeof fn !== 'function')
            continue;
        if (fn.name && fn.name !== key)
            hijacked.push({ key, byFunctionName: fn.name });
    }
    return hijacked;
}

export function initAltStructReady()
{
    const hasConflict = game.modules.get('lancer-alt-structure')?.active;
    const isEnabled = getModuleSetting('enableAltStruct');

    // One-struct NPCs is a separate opt-in from the full alt-struct rules.
    if (!isEnabled)
    {
        if (getModuleSetting('enableOneStructNpc'))
        {
            _flowSteps?.set('npcOneStructStep', npcOneStructStep);
            insertSteps(_flows?.get('StructureFlow'), 'preStructureRollChecks', 0, 'npcOneStructStep');
        }
        if (!hasConflict && _flowSteps && _flows)
        {
            setupBaseRules(_flowSteps, _flows);
            console.log("lancer-automations | base-struct |initialized");
        }
        return;
    }

    if (hasConflict)
    {
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
    if (totalConflicts > 0)
    {
        const parts = [];
        if (preSteps.length)
            parts.push(`new flow step(s) already claimed: ${preSteps.join(", ")}`);
        if (preFlows.length)
            parts.push(`new flow(s) already claimed: ${preFlows.join(", ")}`);
        if (postConflicts.length)
            parts.push(`override step(s) modified after us: ${postConflicts.join(", ")}`);
        if (preHijacks.length)
            parts.push(`override step(s) already replaced before us: ${preHijacks.map(conflict => `${conflict.key} (by ${conflict.byFunctionName})`).join(", ")}`);
        ui.notifications.warn(
            `Lancer Automations (Alt Structure): flow conflict detected. The other module's changes will be overwritten. ${parts.join(" | ")}. See console.`,
            { permanent: true }
        );
        console.warn("lancer-automations | alt-struct |flow conflicts", { preSteps, preFlows, postConflicts, preHijacks });
    }

    setupHooks(_flowSteps, _flows);
    _registerChatHook();

    const mod = game.modules.get(MODULE_ID);
    if (mod?.api)
        mod.api.manualSystemTrauma = manualSystemTrauma;

    console.log("lancer-automations | alt-struct |initialized");
}

let _chatHookRegistered = false;

const CHECK_RESULTS = {
    DirectHitHullCheckFlow: handleDirectHitHullCheckResult,
    CrushingHitHullCheckFlow: handleCrushingHitHullCheckResult,
    StressEngineeringCheckFlow: handleStressEngineeringCheckResult,
    BaseStructureHullCheckFlow: baseHandleHullCheckResult,
    BaseStressEngCheckFlow: baseHandleEngCheckResult
};

async function _runHaseCheck(btn, handler)
{
    const actor = await fromUuid(btn.dataset.actorId);
    if (!actor)
    {
        ui.notifications?.error("Invalid actor ID on check button.");
        return;
    }
    const result = await executeStatRoll(actor, btn.dataset.checkType ?? "hull", null);
    if (!result.completed)
        return;

    const outcome = await handler(actor, result.passed);
    const printGenericCard = /** @type {any} */ (game)?.lancer?.flowSteps?.get("printGenericCard");
    if (outcome && printGenericCard)
        await printGenericCard({ actor, data: { ...outcome, tags: [] } });
}

function _runAltStructFlow(btn)
{
    const flowType = btn.dataset.flowType;
    const actorId = btn.dataset.actorId;
    if (!flowType || !actorId)
    {
        ui.notifications?.error("Missing flow type or actor ID on alt-struct button.");
        return;
    }
    if (CHECK_RESULTS[flowType])
    {
        _runHaseCheck(btn, CHECK_RESULTS[flowType])
            .catch(error => console.error(`lancer-automations | alt-struct |${flowType} failed:`, error));
        return;
    }
    const Flow = /** @type {any} */ (game)?.lancer?.Flow;
    const flowDef = /** @type {any} */ (game)?.lancer?.flows?.get(flowType);
    if (!Flow || !flowDef?.steps)
    {
        ui.notifications?.error(`Alt-struct flow "${flowType}" not registered.`);
        return;
    }
    const flowParams = { ...btn.dataset };
    delete flowParams.flowType;
    delete flowParams.actorId;
    class AltStructFlow extends Flow
    {}
    AltStructFlow.steps = flowDef.steps;
    Object.defineProperty(AltStructFlow, "name", { value: flowType });
    new AltStructFlow(actorId, flowParams).begin();
}

function _registerChatHook()
{
    if (_chatHookRegistered)
        return;
    _chatHookRegistered = true;
    Hooks.on("renderChatMessageHTML", (_app, htmlOrEl) =>
    {
        const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl[0];
        root?.querySelectorAll(".alt-struct-flow-button").forEach(btn =>
        {
            btn.addEventListener("click", function (ev)
            {
                ev.stopPropagation();
                _runAltStructFlow(this);
            });
        });
    });
}
