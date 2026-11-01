// Triggers whose payload carries targets, the only ones React as Target / consumption role can key on.
export const TARGET_CAPABLE_TRIGGERS = new Set([
    'onInitAttack', 'onAttack', 'onHit', 'onMiss', 'onPreDamage', 'onDamage',
    'onInitTechAttack', 'onTechAttack', 'onTechHit', 'onTechMiss',
    'onRoll', 'onCheck', 'onInitCheck'
]);

// Triggers that report a source, the only ones Only On Source Match can key on.
export const SOURCE_MATCH_TRIGGERS = new Set([
    'onAttack', 'onHit', 'onMiss', 'onPreDamage', 'onDamage',
    'onTechAttack', 'onTechHit', 'onTechMiss', 'onActivation', 'onInitActivation',
    'onEndActivation', 'onInitEndActivation', 'onPostActivation', 'onPostEndActivation',
    'onInitAttack', 'onInitTechAttack', 'onPreInvoluntaryMove', 'onInvoluntaryMove', 'onDeploy', 'onRoll'
]);

// Editor picker groups, also the complete built-in list: any other trigger name is a custom trigger.
export const TRIGGER_GROUPS = [
    { label: "LA.triggerGroup.combat", triggers: ["onEnterCombat", "onExitCombat", "onRoundStart", "onRoundEnd", "onTurnStart", "onTurnEnd"] },
    { label: "LA.triggerGroup.movement", triggers: ["onPreMove", "onMove", "onPreInvoluntaryMove", "onInvoluntaryMove"] },
    { label: "LA.triggerGroup.rolls", triggers: ["onRoll"] },
    { label: "LA.triggerGroup.attack", triggers: ["onInitAttack", "onAttack", "onHit", "onMiss", "onPreDamage", "onDamage"] },
    { label: "LA.triggerGroup.tech", triggers: ["onInitTechAttack", "onTechAttack", "onTechHit", "onTechMiss"] },
    { label: "LA.triggerGroup.activation", triggers: ["onInitActivation", "onActivation", "onInitEndActivation", "onEndActivation", "onPostActivation", "onPostEndActivation", "onInitCheck", "onCheck", "onDeploy"] },
    { label: "LA.triggerGroup.status", triggers: ["onPreStatusApplied", "onPreStatusRemoved", "onStatusApplied", "onStatusRemoved"] },
    { label: "LA.triggerGroup.hpHeat", triggers: ["onPreHpChange", "onHpGain", "onHpLoss", "onPreHeatChange", "onHeatGain", "onHeatLoss"] },
    { label: "LA.triggerGroup.structureStress", triggers: ["onPreStructure", "onStructure", "onPreStress", "onStress", "onDestroyed", "onFullRepair"] },
    { label: "LA.triggerGroup.token", triggers: ["onTokenCreated", "onTokenRemoved", "onTokenVisibility"] },
    { label: "LA.triggerGroup.other", triggers: ["onUpdate"] }
];
export const BUILT_IN_TRIGGERS = new Set(TRIGGER_GROUPS.flatMap(group => group.triggers));

export const ACTIVATION_TRIGGERS = new Set(['onActivation', 'onInitActivation', 'onEndActivation', 'onInitEndActivation', 'onPostActivation', 'onPostEndActivation']);
const ACTIVATION_TRIGGER_SELECTOR = [...ACTIVATION_TRIGGERS].map(trigger => `input[name="trigger.${trigger}"]`).join(', ');

const sameTriggerSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(trigger => right.includes(trigger));

export { ACTIVATION_TRIGGER_SELECTOR, sameTriggerSet };
