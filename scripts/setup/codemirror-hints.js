/* global CodeMirror, game */

import { AUTO_API_MANIFEST, AUTO_OPTION_SCHEMAS, AUTO_DOC_INDEX, AUTO_DOC_REF, AUTO_DOC_PARAMS } from '../../tools/codemirror-hints-data.generated.js';

const HAND_SIGNATURE_OVERRIDES = {
};
const HAND_RETURN_OVERRIDES = {
};

const SIG_BY_NAME = new Map(AUTO_API_MANIFEST.map((entry) => [entry.name, entry.args]));
const RETURNS_BY_NAME = new Map(AUTO_API_MANIFEST.map((entry) => [entry.name, entry.returns ?? '']));
const SUMMARY_BY_NAME = new Map(AUTO_API_MANIFEST.map((entry) => [entry.name, entry.summary ?? '']));
const PARAMS_BY_NAME = new Map(AUTO_API_MANIFEST.map((entry) => [entry.name, entry.params ?? []]));
const HAS_DOC_BY_NAME = new Map(AUTO_API_MANIFEST.map((entry) => [entry.name, !!entry.hasDoc]));


// Mirrors the real emit-site payloads. `doc` names the shared type to link to.
const TRIGGER_MANIFEST = [
    { name: 'triggeringToken', returns: 'Token', summary: 'Token that caused the trigger.' },
    { name: 'distanceToTrigger', returns: 'number | null', summary: 'Reactor to triggering token, in spaces.' },
    { name: 'canTriggerReaction', returns: 'boolean', summary: 'False when the trigger cannot provoke (disengage, hidden, ...).' },
    { name: 'startRelatedFlow', args: '()', returns: 'Promise<void>', summary: "Run the reacting item's own flow on this client." },
    { name: 'startRelatedFlowToReactor', args: '(userId, extraData, opts)', returns: 'Promise<any>', summary: "Same, on the reactor owner's client. opts.wait blocks for the result." },
    { name: 'sendMessageToReactor', args: '(data, userId, opts)', returns: 'Promise<any>', summary: "Call this activation's onMessage on another client." },
    { name: 'debugActivation', args: '(label)', returns: 'void', summary: 'Console-dump the reactor, trigger and payload.' },

    { name: 'cancel', args: '(reason)', returns: 'Promise<void>', summary: 'onInvoluntaryMove takes a reason; the onPreMove one takes none.' },
    { name: 'cancelAttack', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelTechAttack', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelCheck', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelDamage', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction', summary: 'Aborts the whole damage roll, not one target.' },
    { name: 'cancelAction', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelChange', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelStructure', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelStress', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelStructureOutcome', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction', summary: 'Blocks the structure result, not the roll.' },
    { name: 'cancelStressOutcome', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction', summary: 'Blocks the stress result, not the roll.' },
    { name: 'cancelHpChange', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelHeatChange', args: '(reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelFunction' },
    { name: 'cancelTriggeredMove', args: '(reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelMoveFunction', summary: 'No title param, unlike the other cancels.' },
    { name: 'changeTriggeredMove', args: '(position, extraData, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'CancelMoveFunction', summary: 'Reroute to position. A rerouted move is a new move.' },
    { name: 'modifyHpChange', args: '(newValue, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'ModifyValueFunction' },
    { name: 'modifyHeatChange', args: '(newValue, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'ModifyValueFunction' },
    { name: 'modifyRoll', args: '(newTotal)', returns: 'void', doc: 'ModifyValueFunction', summary: 'Structure/stress only. Sets the total, leaves title and text stale.' },
    { name: 'reroll', args: '(reason, subtype, title, allowConfirm, userIdControl, opts)', returns: 'Promise<void>', doc: 'ModifyValueFunction', summary: "subtype: 'retry' | 'highest' | 'lowest' | 'choose'." },
    { name: 'changeRoll', args: '(newTotal, reason, title, allowConfirm, userIdControl, preConfirm, postChoice, opts)', returns: 'Promise<void>', doc: 'ModifyValueFunction' },
    { name: 'endActivation', args: '()', returns: 'Promise<void>', summary: 'End the item activation this trigger came from.' },

    { name: 'actionData', returns: 'ActionData', doc: 'actionData' },
    { name: 'flowState', returns: 'FlowState', doc: 'actionData' },
    { name: 'extraData', returns: 'object', summary: 'Injected by startRelatedFlowToReactor.' },
    { name: 'hitTokens', returns: 'Token[]', summary: 'Targets flattened to plain Tokens.' },
    { name: 'isTarget', returns: 'boolean', summary: 'True when the reactor is one of the event targets.' },
    { name: 'targetEntry', returns: 'object | null', summary: 'The reactor\'s own targets entry (roll, crit, ...) when the trigger has per-target entries.' },
    { name: 'targets', returns: 'Token[] | Array<{ target, roll, crit? }>' },
    { name: 'target', returns: 'Token' },
    { name: 'weapon', returns: 'Item' },
    { name: 'techItem', returns: 'Item' },
    { name: 'item', returns: 'Item' },
    { name: 'damages', returns: 'Array<{ type, val }>' },
    { name: 'types', returns: 'string[]' },
    { name: 'isCrit', returns: 'boolean' },
    { name: 'isHit', returns: 'boolean' },
    { name: 'isInvade', returns: 'boolean' },
    { name: 'attackType', returns: 'string' },
    { name: 'actionName', returns: 'string' },
    { name: 'actionType', returns: 'string' },
    { name: 'tags', returns: 'Array<{ lid, val? }>' },
    { name: 'deployable', returns: '{ actor, lid }' },
    { name: 'reactionJustConsumed', returns: 'boolean' },
    { name: 'roll', returns: 'Roll' },
    { name: 'total', returns: 'number' },
    { name: 'success', returns: 'boolean' },
    { name: 'rollType', returns: "'attackRoll' | 'techAttackRoll' | 'damageRoll' | 'skillRoll' | 'structureRoll' | 'stressRoll'" },
    { name: 'isReroll', returns: 'boolean' },
    { name: 'rerollCount', returns: 'number' },
    { name: 'statName', returns: 'string' },
    { name: 'checkAgainstToken', returns: 'Token | null' },
    { name: 'targetVal', returns: 'number | null' },
    { name: 'previousHP', returns: 'number' },
    { name: 'newHP', returns: 'number' },
    { name: 'currentHP', returns: 'number' },
    { name: 'maxHP', returns: 'number' },
    { name: 'hpChange', returns: 'number' },
    { name: 'hpLost', returns: 'number' },
    { name: 'previousHeat', returns: 'number' },
    { name: 'newHeat', returns: 'number' },
    { name: 'currentHeat', returns: 'number' },
    { name: 'heatChange', returns: 'number' },
    { name: 'heatCleared', returns: 'number' },
    { name: 'inDangerZone', returns: 'boolean' },
    { name: 'delta', returns: 'number' },
    { name: 'remainingStructure', returns: 'number' },
    { name: 'remainingStress', returns: 'number' },
    { name: 'rollResult', returns: 'object' },
    { name: 'rollDice', returns: 'number[]' },
    { name: 'statusId', returns: 'string' },
    { name: 'effect', returns: 'ActiveEffect' },
    { name: 'token', returns: 'Token' },
    { name: 'startPos', returns: '{ x, y, elevation }' },
    { name: 'endPos', returns: '{ x, y, elevation }' },
    { name: 'distanceToMove', returns: 'number' },
    { name: 'elevationToMove', returns: 'number' },
    { name: 'distanceMoved', returns: 'number' },
    { name: 'elevationMoved', returns: 'number' },
    { name: 'distance', returns: 'number' },
    { name: 'destination', returns: '{ x, y }' },
    { name: 'isDrag', returns: 'boolean' },
    { name: 'moveInfo', returns: '{ isInvoluntary, isTeleport, isUndo, isModified, pathHexes, isBoost?, boostSet?, extraData? }' },
    { name: 'combat', returns: 'Combat' },
    { name: 'round', returns: 'number' },
    { name: 'isHidden', returns: 'boolean' },
    { name: 'deployedTokens', returns: 'Token[]' },
    { name: 'deployType', returns: "'deployable' | 'throw'" },
    { name: 'document', returns: 'Document' },
    { name: 'change', returns: 'object' },
    { name: 'options', returns: 'object' },
];

const COMMON_TRIGGER_FIELDS = new Set([
    'triggeringToken', 'distanceToTrigger', 'canTriggerReaction',
    'hitTokens', 'isTarget', 'targetEntry',
    'startRelatedFlow', 'startRelatedFlowToReactor', 'sendMessageToReactor',
    'debugActivation',
]);

const TRIGGER_FIELDS_BY_TRIGGER = {
    onPreMove:           ['distanceToMove', 'elevationToMove', 'startPos', 'endPos', 'isDrag', 'moveInfo', 'cancel', 'cancelTriggeredMove', 'changeTriggeredMove'],
    onMove:              ['distanceMoved', 'elevationMoved', 'startPos', 'endPos', 'isDrag', 'moveInfo'],
    onInvoluntaryMove:   ['token', 'distance', 'actionName', 'item', 'destination', 'cancel'],
    onAttack:            ['weapon', 'targets', 'hitTokens', 'attackType', 'actionName', 'tags', 'actionData', 'flowState'],
    onInitAttack:        ['weapon', 'targets', 'hitTokens', 'actionName', 'tags', 'actionData', 'cancelAttack', 'flowState'],
    onHit:               ['weapon', 'targets', 'hitTokens', 'attackType', 'actionName', 'tags', 'actionData', 'flowState'],
    onMiss:              ['weapon', 'targets', 'hitTokens', 'attackType', 'actionName', 'tags', 'actionData', 'flowState'],
    onPreDamage:         ['weapon', 'targets', 'hitTokens', 'attackType', 'actionName', 'tags', 'actionData', 'cancelDamage', 'flowState'],
    onDamage:            ['weapon', 'target', 'hitTokens', 'damages', 'types', 'isCrit', 'isHit', 'attackType', 'actionName', 'tags', 'actionData', 'flowState'],
    onTechAttack:        ['techItem', 'targets', 'hitTokens', 'actionName', 'isInvade', 'tags', 'actionData', 'flowState'],
    onInitTechAttack:    ['techItem', 'targets', 'hitTokens', 'actionName', 'isInvade', 'tags', 'actionData', 'cancelTechAttack', 'flowState'],
    onTechHit:           ['techItem', 'targets', 'hitTokens', 'actionName', 'isInvade', 'tags', 'actionData', 'flowState'],
    onTechMiss:          ['techItem', 'targets', 'hitTokens', 'actionName', 'isInvade', 'tags', 'actionData', 'flowState'],
    onCheck:             ['statName', 'roll', 'total', 'success', 'checkAgainstToken', 'targetVal', 'flowState'],
    onInitCheck:         ['statName', 'checkAgainstToken', 'targetVal', 'cancelCheck', 'flowState'],
    onActivation:        ['actionType', 'actionName', 'item', 'actionData', 'deployable', 'reactionJustConsumed', 'endActivation', 'extraData', 'flowState'],
    onInitActivation:    ['actionType', 'actionName', 'item', 'actionData', 'deployable', 'cancelAction', 'flowState'],
    onPreStructure:      ['remainingStructure', 'cancelStructure', 'flowState'],
    onStructure:         ['remainingStructure', 'rollResult', 'rollDice', 'cancelStructureOutcome', 'modifyRoll', 'flowState'],
    onPreStress:         ['remainingStress', 'cancelStress', 'flowState'],
    onStress:            ['remainingStress', 'rollResult', 'rollDice', 'cancelStressOutcome', 'modifyRoll', 'flowState'],
    onPreHpChange:       ['previousHP', 'newHP', 'delta', 'cancelHpChange', 'modifyHpChange'],
    onHpGain:            ['hpChange', 'currentHP', 'maxHP'],
    onHpLoss:            ['hpLost', 'currentHP'],
    onPreHeatChange:     ['previousHeat', 'newHeat', 'delta', 'cancelHeatChange', 'modifyHeatChange'],
    onHeatGain:          ['heatChange', 'currentHeat', 'inDangerZone'],
    onHeatLoss:          ['heatCleared', 'currentHeat'],
    onRoll:              ['rollType', 'roll', 'total', 'success', 'targets', 'hitTokens', 'item', 'isReroll', 'rerollCount', 'reroll', 'changeRoll', 'flowState'],
    onPreStatusApplied:  ['statusId', 'effect', 'cancelChange'],
    onPreStatusRemoved:  ['statusId', 'effect', 'cancelChange'],
    onStatusApplied:     ['statusId', 'effect'],
    onStatusRemoved:     ['statusId', 'effect'],
    onTurnStart:         [],
    onTurnEnd:           [],
    onRoundStart:        ['combat', 'round'],
    onEnterCombat:       [],
    onExitCombat:        [],
    onDestroyed:         [],
    onTokenCreated:      [],
    onTokenRemoved:      [],
    onTokenVisibility:   ['isHidden'],
    onDeploy:            ['item', 'deployedTokens', 'deployType'],
    onUpdate:            ['document', 'change', 'options'],
};

const HAND_OPTION_SCHEMAS = {
    'startChoiceCard.options': [
        ['title', 'string'],
        ['description', 'string'],
        ['choices', 'Array<{ text, icon, callback }>'],
        ['mode', '"or" | "and"'],
        ['userIdControl', 'string'],
        ['item', 'Item'],
        ['originToken', 'Token'],
        ['relatedToken', 'Token'],
        ['icon', 'string'],
        ['headerClass', 'string'],
    ],
    'startVoteCard.options': [
        ['title', 'string'],
        ['description', 'string'],
        ['choices', 'Array<{ text, icon }>'],
        ['userIds', 'string[]'],
        ['mode', '"majority" | "unanimous"'],
        ['hidden', 'boolean'],
        ['icon', 'string'],
        ['headerClass', 'string'],
    ],
    'applyEffectsToTokens.options': [
        ['tokens', 'Token[]'],
        ['effectNames', '(string | EffectData)[]'],
        ['note', 'string'],
        ['duration', '{ label, turns?, rounds?, overrideTurnOriginId? }'],
        ['checkEffectCallback', '(token, effectData) => boolean'],
        ['notify', 'boolean | object'],
    ],
    'applyEffectsToTokens.extraOptions': [
        ['consumption', '{ trigger, originId?, groupId?, grouped? }'],
        ['linkedBonusId', 'string'],
        ['allowStack', 'boolean'],
        ['stack', 'number'],
        ['changes', 'object[]'],
        ['forceNew', 'boolean'],
    ],
    'setEffect.extraOptions': [
        ['consumption', '{ trigger, originId?, groupId?, evaluate?, itemLid?, itemId?, actionName? }'],
        ['linkedBonusId', 'string'],
        ['stack', 'number'],
        ['changes', 'object[]'],
        ['allowStack', 'boolean'],
        ['forceNew', 'boolean'],
        ['statDirect', '{ key, value, preBonusValue }'],
    ],
    'moveToken.options': [
        ['destination', '{ x, y }'],
        ['teleport', 'boolean'],
        ['action', 'string'],
        ['range', 'number'],
        ['cost', 'number'],
        ['free', 'boolean'],
        ['urgent', 'boolean'],
        ['canBeBlocked', 'boolean'],
        ['title', 'string'],
        ['description', 'string'],
        ['icon', 'string'],
        ['headerClass', 'string'],
    ],
    'rollCard.options': [
        ['title', 'string'],
        ['description', 'string'],
        ['roll', 'string'],
        ['allowEdit', 'boolean'],
        ['flavor', 'string'],
        ['originToken', 'Token'],
        ['relatedToken', 'Token'],
        ['item', 'Item'],
        ['icon', 'string'],
        ['urgent', 'boolean'],
    ],
    'removeEffectsByNameFromTokens.options': [
        ['tokens', 'Token[]'],
        ['effectNames', 'string[]'],
        ['originId', 'string'],
        ['extraFlags', 'object'],
        ['notify', 'boolean | object'],
    ],
    'chooseToken.options': [
        ['range', 'number'],
        ['count', 'number'],
        ['includeSelf', 'boolean'],
        ['includeHidden', 'boolean'],
        ['title', 'string'],
        ['description', 'string'],
        ['icon', 'string'],
        ['filter', '(token) => boolean'],
    ],
    'placeZone.options': [
        ['shape', '"Blast" | "Burst" | "Cone" | "Line"'],
        ['range', 'number'],
        ['size', 'number'],
        ['fillColor', 'number'],
        ['difficultTerrain', 'boolean'],
        ['dangerous', 'object'],
        ['statusEffects', 'string[]'],
        ['requireRange', 'boolean'],
    ],
    'knockBackToken.options': [
        ['triggeringToken', 'Token'],
        ['actionName', 'string'],
        ['item', 'Item'],
        ['asVoluntary', 'boolean'],
        ['setElevation', 'boolean'],
        ['urgent', 'boolean'],
        ['title', 'string'],
        ['description', 'string'],
        ['icon', 'string'],
        ['headerClass', 'string'],
    ],
    'placeToken.options': [
        ['actor', 'Actor | Actor[] | { actor, extraData }[]'],
        ['range', 'number'],
        ['count', 'number'],
        ['extraData', 'object'],
        ['origin', 'Token | { x, y }'],
        ['onSpawn', '(newTokenDoc, origin) => void'],
        ['title', 'string'],
        ['description', 'string'],
        ['icon', 'string'],
        ['headerClass', 'string'],
        ['noCard', 'boolean'],
        ['disposition', 'number'],
        ['team', 'string'],
        ['elevation', 'number'],
    ],
    'spawnHardCover.options': [
        ['range', 'number'],
        ['count', 'number'],
        ['size', 'number'],
        ['name', 'string'],
        ['title', 'string'],
        ['description', 'string'],
    ],
    'executeBasicAttack.options': [
        ['tags', 'TagField[]'],
        ['title', 'string'],
        ['attack_type', '"Melee" | "Ranged"'],
        ['lookupItem', 'Item'],
    ],
    'executeSimpleActivation.options': [
        ['title', 'string'],
        ['action', '{ name, activation }'],
        ['detail', 'string'],
    ],
    'executeDamageRoll.options': [
        ['tags', 'TagField[]'],
        ['hit_results', 'object[]'],
        ['has_normal_hit', 'boolean'],
        ['has_crit_hit', 'boolean'],
        ['ap', 'boolean'],
        ['paracausal', 'boolean'],
        ['half_damage', 'boolean'],
        ['overkill', 'boolean'],
        ['reliable', 'boolean'],
        ['add_burn', 'boolean'],
        ['invade', 'boolean'],
        ['bonus_damage', 'object[]'],
    ],
    'addGlobalBonus.options': [
        ['duration', '"end" | "start" | "indefinite" | "permanent" | "1 Round"'],
        ['durationTurns', 'number'],
        ['origin', 'Token | string'],
        ['icon', 'string'],
        ['consumption', '{ trigger, originId?, groupId?, evaluate?, itemLid?, itemId?, actionName?, isBoost?, minDistance?, checkType?, checkAbove?, checkBelow? }'],
    ],
    'executeEffectManager.options': [
        ['initialTab', '"bonus" | "manage" | string'],
    ],
    'executeSkirmish.opts': [
        ['noFX', 'boolean'],
    ],
    'updateAllEngagements.options': [
        ['excludeTokenId', 'string'],
    ],
    'createAura.auraConfig': [
        ['name', 'string'],
        ['radius', 'string | number'],
        ['unified', 'boolean'],
        ['lineWidth', 'number'],
        ['lineColor', 'string'],
        ['lineOpacity', 'number'],
        ['lineDashSize', 'number'],
        ['lineGapSize', 'number'],
        ['fillType', 'number'],
        ['fillColor', 'string'],
        ['fillOpacity', 'number'],
        ['animation', 'boolean'],
        ['nonOwnerVisibility', 'object'],
    ],
    'regenerateScans.opts': [
        ['filter', '(entry) => boolean'],
        ['dryRun', 'boolean'],
    ],
};

// Union per key so a partial hand entry supplements the generated one instead of shadowing it. Hand wins on type; `...rest` dropped.
function _mergeOptionSchemas(auto, hand)
{
    const out = {};
    for (const key of new Set([...Object.keys(auto), ...Object.keys(hand)]))
    {
        const byName = new Map();
        for (const pair of (hand[key] ?? []))
        {
            if (!String(pair[0]).startsWith('...'))
                byName.set(pair[0], pair);
        }
        for (const pair of (auto[key] ?? []))
        {
            if (!String(pair[0]).startsWith('...') && !byName.has(pair[0]))
                byName.set(pair[0], pair);
        }
        out[key] = [...byName.values()];
    }
    return out;
}

const OPTION_SCHEMAS = _mergeOptionSchemas(AUTO_OPTION_SCHEMAS, HAND_OPTION_SCHEMAS);

const TYPE_FIELDS = {
    Actor: {
        type:       { desc: 'mech | pilot | npc | deployable' },
        system:     { type: 'ActorSystem' },
        items:      { desc: 'Collection<Item>' },
        itemTypes:  { desc: 'Record<string, Item[]>' },
        name:       { desc: 'string' },
        id:         { desc: 'string' },
        uuid:       { desc: 'string' },
        effects:    { desc: 'EmbeddedCollection<ActiveEffect>' },
        token:      { type: 'TokenDocument' },
        prototypeToken: { type: 'TokenDocument' },
        folder:     { desc: 'Folder|null' },
        getFlag:    { desc: '(scope, key) => any' },
        setFlag:    { desc: '(scope, key, value) => Promise<Actor>' },
        unsetFlag:  { desc: '(scope, key) => Promise<Actor>' },
        update:     { desc: '(data) => Promise<Actor>' },
        getActiveTokens: { desc: '() => Token[]' },
    },
    ActorSystem: {
        hp:             { type: 'Bounded' },
        heat:           { type: 'Bounded' },
        structure:      { type: 'Bounded' },
        stress:         { type: 'Bounded' },
        overshield:     { type: 'Bounded' },
        repairs:        { type: 'Bounded' },
        burn:           { desc: 'number' },
        activations:    { desc: 'number' },
        overcharge:     { desc: 'number (0-3)' },
        core_active:    { desc: 'boolean' },
        core_energy:    { desc: 'number' },
        meltdown_timer: { desc: 'number|null' },
        pilot:          { desc: 'SyncUUIDRef → PILOT actor' },
        lid:            { desc: 'string' },
        notes:          { desc: 'HTML' },
        tier:           { desc: 'number (1-3, NPC only)' },
        destroyed:      { desc: 'boolean' },
        disabled:       { desc: 'boolean' },
        action_tracker: { type: 'ActionTracker' },
        loadout:        { type: 'Loadout' },
        speed:          { desc: 'number (computed)' },
        evasion:        { desc: 'number' },
        edef:            { desc: 'number' },
        save:           { desc: 'number' },
        sensor_range:   { desc: 'number' },
        size:           { desc: 'number' },
        armor:          { desc: 'number' },
        tech_attack:    { desc: 'number' },
        hull:           { desc: 'number (0-6, pilot)' },
        agi:            { desc: 'number (0-6, pilot)' },
        sys:            { desc: 'number (0-6, pilot)' },
        eng:            { desc: 'number (0-6, pilot)' },
        level:          { desc: 'number (0-12, pilot)' },
        callsign:       { desc: 'string (pilot)' },
        active_mech:    { desc: 'SyncUUIDRef → MECH actor' },
        mounted:        { desc: 'boolean (pilot)' },
        bond_state:     { desc: '{ xp, stress, xp_checklist, answers, burdens, clocks }' },
        statuses:       { desc: 'Record<string, boolean>' },
        resistances:    { desc: 'Record<DamageType, boolean>' },
    },
    Bounded: {
        value: { desc: 'number' },
        max:   { desc: 'number' },
        min:   { desc: 'number' },
    },
    ActionTracker: {
        protocol:       { desc: 'boolean' },
        move:           { desc: 'number (remaining = speed)' },
        full:           { desc: 'boolean' },
        quick:          { desc: 'boolean' },
        reaction:       { desc: 'boolean' },
        free:           { desc: 'boolean' },
        used_reactions: { desc: 'string[] (LIDs)' },
    },
    Loadout: {
        frame:         { desc: 'EmbeddedRef → FRAME item' },
        weapon_mounts: { desc: 'WeaponMount[] (mech)' },
        systems:       { desc: 'EmbeddedRef[] → MECH_SYSTEM' },
        sp:            { type: 'Bounded' },
        ai_cap:        { type: 'Bounded' },
        limited_bonus: { desc: 'number' },
        armor:         { desc: 'EmbeddedRef[] → PILOT_ARMOR (pilot)' },
        gear:          { desc: 'EmbeddedRef[] → PILOT_GEAR (pilot)' },
        weapons:       { desc: 'EmbeddedRef[] → PILOT_WEAPON (pilot)' },
    },
    Token: {
        actor:    { type: 'Actor' },
        document: { type: 'TokenDocument' },
        name:     { desc: 'string' },
        id:       { desc: 'string' },
        x:        { desc: 'number (top-left px)' },
        y:        { desc: 'number (top-left px)' },
        center:   { desc: '{ x, y }' },
        isOwner:  { desc: 'boolean' },
        inCombat: { desc: 'boolean' },
        control:  { desc: '(opts) => void' },
        setTarget:{ desc: '(state, opts) => void' },
        scene:    { desc: 'Scene' },
    },
    TokenDocument: {
        x:           { desc: 'number' },
        y:           { desc: 'number' },
        elevation:   { desc: 'number' },
        hidden:      { desc: 'boolean' },
        disposition: { desc: 'CONST.TOKEN_DISPOSITIONS' },
        width:       { desc: 'number (grid units)' },
        height:      { desc: 'number (grid units)' },
        name:        { desc: 'string' },
        actor:       { type: 'Actor' },
        scene:       { desc: 'Scene' },
        getFlag:     { desc: '(scope, key) => any' },
        setFlag:     { desc: '(scope, key, value) => Promise<TokenDocument>' },
        update:      { desc: '(data) => Promise<TokenDocument>' },
    },
    Item: {
        type:    { desc: 'mech_weapon | mech_system | npc_feature | weapon_mod | frame | …' },
        system:  { type: 'ItemSystem' },
        name:    { desc: 'string' },
        id:      { desc: 'string' },
        uuid:    { desc: 'string' },
        parent:  { desc: 'Actor|null' },
        actor:   { type: 'Actor' },
        effects: { desc: 'EmbeddedCollection<ActiveEffect>' },
        getFlag: { desc: '(scope, key) => any' },
        setFlag: { desc: '(scope, key, value) => Promise<Item>' },
        update:  { desc: '(data) => Promise<Item>' },
        isLimited:    { desc: '() => boolean' },
        is_weapon:    { desc: '() => boolean' },
        currentProfile:{ desc: '() => WeaponProfile' },
        rangesFor:    { desc: '(profile) => RangeField[]' },
        beginSystemFlow: { desc: '() => Promise<boolean>' },
    },
    ItemSystem: {
        lid:             { desc: 'string' },
        tags:            { desc: 'TagField[]' },
        uses:            { type: 'Bounded' },
        size:            { desc: 'WeaponSize ("Auxiliary"|"Main"|"Heavy"|"Superheavy")' },
        loaded:          { desc: 'boolean' },
        cascading:       { desc: 'boolean' },
        destroyed:       { desc: 'boolean' },
        disabled:        { desc: 'boolean' },
        sp:              { desc: 'number' },
        effect:          { desc: 'HTML' },
        description:     { desc: 'HTML' },
        manufacturer:    { desc: 'string' },
        license_level:   { desc: 'number (0-3)' },
        license:         { desc: 'string' },
        type:            { desc: 'WeaponType | NpcFeatureType | …' },
        profiles:        { desc: 'WeaponProfile[]' },
        actions:         { desc: 'LancerAction[]' },
        bonuses:         { desc: 'BonusField[]' },
        synergies:       { desc: 'SynergyField[]' },
        counters:        { desc: 'CounterField[]' },
        deployables:     { desc: 'LIDField[]' },
        integrated:      { desc: 'LIDField[]' },
        ammo:            { desc: 'AmmoField[]' },
        selected_profile_index: { desc: 'number' },
        on_hit:          { desc: 'HTML (NPC weapon)' },
        damage:          { desc: 'DamageField[][] (NPC weapon: tier x damages)' },
        range:           { desc: 'RangeField[]' },
        accuracy:        { desc: 'number[3]' },
        attack_bonus:    { desc: 'number[3]' },
        weapon_type:     { desc: 'WeaponType' },
        tech_type:       { desc: '"Quick"|"Full"' },
        tech_attack:     { desc: 'boolean|null' },
        trigger:         { desc: 'string (NPC reaction)' },
        tier_override:   { desc: 'number (0-3)' },
        charged:         { desc: 'boolean (NPC recharge)' },
        origin:          { desc: '{ type, name, base }' },
    },
    Combat: {
        round:     { desc: 'number' },
        turn:      { desc: 'number' },
        started:   { desc: 'boolean' },
        current:   { desc: '{ tokenId, combatantId }' },
        combatants: { desc: 'EmbeddedCollection<Combatant>' },
    },
    Combatant: {
        token:       { type: 'TokenDocument' },
        actor:       { type: 'Actor' },
        activations: { desc: '{ value, max }' },
        initiative:  { desc: 'number' },
    },
};

const VAR_TYPES = {
    actor:           'Actor',
    target:          'Token',
    targetToken:     'Token',
    triggeringToken: 'Token',
    reactorToken:    'Token',
    token:           'Token',
    movedToken:      'Token',
    item:            'Item',
    weapon:          'Item',
    sourceItem:      'Item',
    parentItem:      'Item',
    combat:          'Combat',
    combatant:       'Combatant',
};

function _walkType(typeName, segments)
{
    let curType = typeName;
    for (const seg of segments)
    {
        const fields = TYPE_FIELDS[curType];
        if (!fields)
            return null;
        const field = fields[seg];
        if (!field?.type)
            return null;
        curType = field.type;
    }
    return curType;
}

function _typeFieldsAsManifest(typeName)
{
    const fields = TYPE_FIELDS[typeName];
    if (!fields)
        return null;
    return Object.entries(fields).map(([name, info]) => ({
        name,
        returns: info.type ?? info.desc ?? '',
    }));
}

const PARAMS_BY_KIND = {
    evaluate:        ['triggerType', 'triggerData', 'reactorToken', 'item', 'activationName', 'api'],
    activationCode:  ['triggerType', 'triggerData', 'reactorToken', 'item', 'activationName', 'api'],
    onInit:          ['token', 'item', 'api'],
    onMessage:       ['triggerType', 'data', 'reactorToken', 'item', 'activationName', 'api'],
    startup:         ['api', 'game', 'canvas', 'ui', 'Hooks'],
};

const TRIGGER_OBJECT_BY_KIND = {
    evaluate:        'triggerData',
    activationCode:  'triggerData',
    onMessage:       null,
    onInit:          null,
    startup:         null,
};

const _triggerReCache = new Map();

let _apiCache = null;
function _getApiList()
{
    if (_apiCache)
        return _apiCache;
    const apiObj = game?.modules?.get?.('lancer-automations')?.api ?? {};
    const entries = [];
    for (const apiName of Object.keys(apiObj))
    {
        if (typeof apiObj[apiName] !== 'function')
            continue;
        const args = HAND_SIGNATURE_OVERRIDES[apiName] ?? SIG_BY_NAME.get(apiName) ?? '(...)';
        const returns = HAND_RETURN_OVERRIDES[apiName] ?? RETURNS_BY_NAME.get(apiName) ?? '';
        const summary = SUMMARY_BY_NAME.get(apiName) ?? '';
        const params = PARAMS_BY_NAME.get(apiName) ?? [];
        const hasDoc = HAS_DOC_BY_NAME.get(apiName) ?? false;
        entries.push({ name: apiName, args, returns, summary, params, hasDoc });
    }
    _apiCache = entries.sort((a, b) => a.name.localeCompare(b.name));
    return _apiCache;
}

function _splitArgs(args)
{
    if (!args)
        return [];
    const inner = args.replace(/^\(/, '').replace(/\)$/, '').trim();
    if (!inner)
        return [];
    const parts = [];
    let depth = 0;
    let buf = '';
    for (const char of inner)
    {
        if (char === '(' || char === '{' || char === '[')
        {
            depth++;
            buf += char;
        }
        else if (char === ')' || char === '}' || char === ']')
        {
            depth--;
            buf += char;
        }
        else if (char === ',' && depth === 0)
        {
            parts.push(buf.trim());
            buf = '';
        }
        else
            buf += char;
    }
    if (buf.trim())
        parts.push(buf.trim());
    return parts;
}

function _shortPart(part)
{
    const noDefault = part.split('=')[0].trim();
    if (noDefault.startsWith('{'))
    {
        const inner = noDefault.replace(/^\{/, '').replace(/\}$/, '').trim();
        if (!inner)
            return '{}';
        const keys = _splitArgs(`(${inner})`);
        if (keys.length === 0)
            return '{}';
        const firstKey = keys[0].split('=')[0].trim();
        if (keys.length === 1)
            return `{ ${firstKey} }`;
        return `{ ${firstKey}, …+${keys.length - 1} }`;
    }
    if (noDefault.startsWith('['))
        return '[…]';
    return noDefault;
}

function _shortSig(args)
{
    if (!args)
        return '';
    if (args === '(...)' || args === '()')
        return args;
    const parts = _splitArgs(args);
    if (parts.length === 0)
        return '()';
    const first = _shortPart(parts[0]);
    if (parts.length === 1)
        return `(${first})`;
    return `(${first}, …+${parts.length - 1})`;
}

let _tooltipEl = null;
let _tooltipTimer = null;

function _hideTooltip()
{
    if (_tooltipTimer)
    {
        clearTimeout(_tooltipTimer);
        _tooltipTimer = null;
    }
    if (_tooltipEl?.parentElement)
        _tooltipEl.remove();
    _tooltipEl = null;
}

function _escapeHtml(str)
{
    return String(str ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

export function apiDocUrl(name)
{
    const entry = AUTO_DOC_INDEX[name];
    const ref = AUTO_DOC_REF[name];
    if (!entry && !ref)
        return null;
    const file = entry?.file ?? ref.file;
    const anchor = entry?.anchor ? `#${entry.anchor}` : '';
    return `https://agraael.github.io/lancer-automations/${file.replace(/\.md$/, '.html')}${anchor}`;
}

// Live api surface (spread-composed names included), enriched from the generated manifest.
export function getApiEntries()
{
    return _getApiList();
}

// Callable triggerData.* helpers, for the reference panel.
export function getTriggerHelperEntries()
{
    return TRIGGER_MANIFEST
        .filter((entry) => entry.args)
        .map((entry) => ({
            name: `triggerData.${entry.name}`,
            args: entry.args,
            returns: entry.returns ?? '',
            summary: entry.summary ?? '',
            params: [],
            docName: entry.doc ?? null,
            hasDoc: !!(entry.doc && apiDocUrl(entry.doc)),
        }));
}

function _openDocPopup(name)
{
    const url = apiDocUrl(name);
    if (!url)
    {
        ui?.notifications?.warn?.(`No doc reference for ${name}`);
        return;
    }
    window.open(url, '_blank', 'noopener');
}

function _showTooltip(anchor, name, fullArgs, returns, summary = '', params = [])
{
    _hideTooltip();
    const parts = _splitArgs(fullArgs);
    const paramByName = new Map((params ?? []).map((param) => [param.name, param]));
    // Doc tables are the maintained source; prefer them over JSDoc-derived meta.
    const docRows = AUTO_DOC_PARAMS[name] ?? null;
    const positionalNames = new Set(parts.map((argStr) =>
    {
        const eq = argStr.indexOf('=');
        return (eq >= 0 ? argStr.slice(0, eq) : argStr).trim();
    }));
    if (docRows)
        for (const [pname, ptype, pdflt] of docRows)
            if (positionalNames.has(pname))
                paramByName.set(pname, { name: pname, type: ptype, desc: pdflt && pdflt !== 'required' ? `default: ${pdflt}` : '' });
    let body;
    if (!fullArgs || fullArgs === '()' || fullArgs === '(...)')
        body = `<div class="la-hint-tt-paren">${fullArgs || '()'}</div>`;
    else
    {
        const argLines = parts.map((argStr, i) =>
        {
            const eq = argStr.indexOf('=');
            const namePart = eq >= 0 ? argStr.slice(0, eq).trim() : argStr;
            const defPart = eq >= 0 ? ` = ${argStr.slice(eq + 1).trim()}` : '';
            const comma = i < parts.length - 1 ? ',' : '';
            const lookupKey = namePart.replace(/^\{.*\}$/, 'options');
            let schema = OPTION_SCHEMAS[`${name}.${lookupKey}`];
            if (docRows && (lookupKey === 'options' || lookupKey === 'opts'))
            {
                const bagRows = docRows.filter(([pname]) => !positionalNames.has(pname));
                if (bagRows.length)
                    schema = bagRows.map(([pname, ptype]) => [pname, ptype || 'any']);
            }
            let schemaHtml = '';
            if (schema)
            {
                const lines = schema.map(([fieldName, fieldType]) => `<div class="la-hint-tt-schema-line"><span class="la-hint-tt-argname">${_escapeHtml(fieldName)}</span><span class="la-hint-tt-default">: ${_escapeHtml(fieldType)}</span></div>`).join('');
                schemaHtml = `<div class="la-hint-tt-schema">${lines}</div>`;
            }
            const paramMeta = paramByName.get(namePart);
            let metaHtml = '';
            if (paramMeta)
            {
                const typeHtml = paramMeta.type ? `<span class="la-hint-tt-argtype">: ${_escapeHtml(paramMeta.type)}</span>` : '';
                const descHtml = paramMeta.desc ? `<div class="la-hint-tt-argdesc">${_escapeHtml(paramMeta.desc)}</div>` : '';
                metaHtml = `${typeHtml}${descHtml}`;
            }
            return `<div class="la-hint-tt-arg"><span class="la-hint-tt-argname">${namePart}</span>${metaHtml}<span class="la-hint-tt-default">${defPart}</span>${comma}${schemaHtml}</div>`;
        }).join('');
        body = `<div class="la-hint-tt-paren">(</div>${argLines}<div class="la-hint-tt-paren">)</div>`;
    }
    const summaryHtml = summary
        ? `<div class="la-hint-tt-summary">${_escapeHtml(summary)}</div>`
        : '';
    const retHtml = returns
        ? `<div class="la-hint-tt-returns"><span class="la-hint-tt-ret-arrow">→</span> <span class="la-hint-tt-ret-type">${returns}</span></div>`
        : '';
    _tooltipEl = document.createElement('div');
    _tooltipEl.className = 'la-hint-tooltip';
    _tooltipEl.innerHTML = `<div class="la-hint-tt-name">${name}</div>${summaryHtml}${body}${retHtml}`;
    document.body.appendChild(_tooltipEl);
    const anchorRect = anchor.getBoundingClientRect();
    const ttRect = _tooltipEl.getBoundingClientRect();
    let left = anchorRect.right + 8;
    if (left + ttRect.width > window.innerWidth - 8)
        left = Math.max(8, anchorRect.left - ttRect.width - 8);
    let top = anchorRect.top;
    if (top + ttRect.height > window.innerHeight - 8)
        top = Math.max(8, window.innerHeight - ttRect.height - 8);
    _tooltipEl.style.top = `${top}px`;
    _tooltipEl.style.left = `${left}px`;
}

function _renderHint(el, _self, data)
{
    const name = data.displayName ?? data.text;
    const shortArgs = data.shortArgs ?? '';
    const isFn = !!data.fullArgs;
    const docBtn = data.hasDoc
        ? `<a class="la-hint-row-doc" title="Open API doc">?</a>`
        : '';
    el.classList.add(isFn ? 'la-hint-fn' : 'la-hint-var');
    el.innerHTML = `<span class="la-hint-name">${name}</span><span class="la-hint-args"> ${shortArgs}</span>${docBtn}`;
    if (data.hasDoc)
    {
        const btn = el.querySelector('.la-hint-row-doc');
        btn?.addEventListener('mousedown', (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            _openDocPopup(name);
        });
    }
}

function _toCompletion(entry)
{
    const fullArgs = entry.args ?? '';
    const isFn = !!fullArgs;
    return {
        text: isFn ? `${entry.name}()` : entry.name,
        displayName: entry.name,
        displayText: isFn ? `${entry.name}${fullArgs}` : entry.name,
        shortArgs: _shortSig(fullArgs),
        fullArgs,
        returns: entry.returns ?? '',
        summary: entry.summary ?? '',
        params: entry.params ?? [],
        hasDoc: !!entry.hasDoc,
        render: _renderHint,
        _isFn: isFn,
    };
}

function _filter(entries, prefix)
{
    if (!prefix)
        return entries.map(_toCompletion);
    const prefixLo = prefix.toLowerCase();
    const starts = [];
    const contains = [];
    for (const entry of entries)
    {
        const nameLo = entry.name.toLowerCase();
        if (nameLo.startsWith(prefixLo))
            starts.push(entry);
        else if (nameLo.includes(prefixLo))
            contains.push(entry);
    }
    return [...starts, ...contains].map(_toCompletion);
}

function _attachTooltipEvents(data, cm)
{
    if (!data || !data.list?.length)
        return data;
    CodeMirror.on(data, 'select', (entry, el) =>
    {
        if (entry?.fullArgs && el)
            _showTooltip(el, entry.displayName ?? entry.text, entry.fullArgs, entry.returns, entry.summary, entry.params);
        else
            _hideTooltip();
    });
    CodeMirror.on(data, 'close', _hideTooltip);
    CodeMirror.on(data, 'pick', (entry) =>
    {
        _hideTooltip();
        if (cm && entry?._isFn)
        {
            const pos = cm.getCursor();
            cm.setCursor({ line: pos.line, ch: pos.ch - 1 });
        }
    });
    return data;
}

/** @param {any} cm */
function _getSelectedTriggers(cm)
{
    const wrapper = cm?.getWrapperElement?.();
    if (!wrapper)
        return null;
    const form = wrapper.closest('form');
    if (!form)
        return null;
    const selected = new Set();
    for (const checkbox of form.querySelectorAll('input[type="checkbox"][name^="trigger."]'))
    {
        if (checkbox.checked)
        {
            const triggerName = checkbox.name.slice('trigger.'.length);
            if (triggerName)
                selected.add(triggerName);
        }
    }
    return selected.size > 0 ? selected : null;
}

function _filterTriggerManifestByForm(cm)
{
    const selected = _getSelectedTriggers(cm);
    if (!selected)
        return TRIGGER_MANIFEST;
    const allowed = new Set(COMMON_TRIGGER_FIELDS);
    for (const triggerName of selected)
    {
        const fields = TRIGGER_FIELDS_BY_TRIGGER[triggerName];
        if (fields)
        {
            for (const fieldName of fields)
                allowed.add(fieldName);
        }
    }
    return TRIGGER_MANIFEST.filter((entry) => allowed.has(entry.name));
}

function _hint(cm, kind)
{
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    const before = line.slice(0, cur.ch);

    const apiMatch = before.match(/\bapi\.(\w*)$/);
    if (apiMatch)
    {
        const prefix = apiMatch[1];
        return _attachTooltipEvents({
            list: _filter(_getApiList(), prefix),
            from: { line: cur.line, ch: cur.ch - prefix.length },
            to: cur,
        }, cm);
    }

    const triggerObj = TRIGGER_OBJECT_BY_KIND[kind];
    if (triggerObj)
    {
        let re = _triggerReCache.get(triggerObj);
        if (!re)
        {
            re = new RegExp(`\\b${triggerObj}\\.(\\w*)$`);
            _triggerReCache.set(triggerObj, re);
        }
        const trigMatch = before.match(re);
        if (trigMatch)
        {
            const prefix = trigMatch[1];
            const filtered = _filterTriggerManifestByForm(cm);
            return _attachTooltipEvents({
                list: _filter(filtered, prefix),
                from: { line: cur.line, ch: cur.ch - prefix.length },
                to: cur,
            }, cm);
        }
    }

    const chainMatch = before.match(/(\w+(?:\.\w+)*)\.(\w*)$/);
    if (chainMatch)
    {
        const chain = chainMatch[1].split('.');
        const root = chain[0];
        const startType = VAR_TYPES[root];
        if (startType)
        {
            const finalType = _walkType(startType, chain.slice(1));
            const fields = finalType ? _typeFieldsAsManifest(finalType) : null;
            if (fields)
            {
                const prefix = chainMatch[2];
                return _attachTooltipEvents({
                    list: _filter(fields, prefix),
                    from: { line: cur.line, ch: cur.ch - prefix.length },
                    to: cur,
                }, cm);
            }
        }
        return null;
    }

    const wordMatch = before.match(/(\w+)$/);
    const prefix = wordMatch ? wordMatch[1] : '';
    const params = PARAMS_BY_KIND[kind] ?? [];
    const list = _filter(params.map((p) => ({ name: p })), prefix);
    if (!list.length)
        return null;
    return _attachTooltipEvents({
        list,
        from: { line: cur.line, ch: cur.ch - prefix.length },
        to: cur,
    }, cm);
}

/**
 * @param {any} cm
 * @param {'evaluate'|'activationCode'|'onInit'|'onMessage'|'startup'} [kind]
 */
// Lazy-load optional addons (autoCloseBrackets, match-highlighter): module.json load fails before _CodeMirror exists.
let _extraAddonsPromise = null;
function _ensureExtraAddons()
{
    if (_extraAddonsPromise)
        return _extraAddonsPromise;
    if (typeof CodeMirror === 'undefined')
        return Promise.resolve(false);
    const cmModule = game.modules.get('_CodeMirror');
    if (!cmModule?.active)
        return Promise.resolve(false);
    const load = (src) => new Promise((resolve) =>
    {
        const s = document.createElement('script');
        s.src = src;
        s.async = false;
        s.onload = () => resolve(true);
        s.onerror = () => resolve(false);
        document.head.appendChild(s);
    });
    const loadCss = (href) =>
    {
        if (document.querySelector(`link[href="${href}"]`))
            return;
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = href;
        document.head.appendChild(l);
    };
    loadCss('/modules/_CodeMirror/addon/dialog/dialog.css');
    loadCss('/modules/_CodeMirror/addon/fold/foldgutter.css');
    _extraAddonsPromise = (async () =>
    {
        const closeOk = await load('/modules/_CodeMirror/addon/edit/closebrackets.js');
        const cursorOk = await load('/modules/_CodeMirror/addon/search/searchcursor.js');
        const matchOk = cursorOk && await load('/modules/_CodeMirror/addon/search/match-highlighter.js');
        const dialogOk = await load('/modules/_CodeMirror/addon/dialog/dialog.js');
        const searchOk = cursorOk && dialogOk && await load('/modules/_CodeMirror/addon/search/search.js');
        const commentOk = await load('/modules/_CodeMirror/addon/comment/comment.js');
        const foldCodeOk = await load('/modules/_CodeMirror/addon/fold/foldcode.js');
        const foldGutterOk = foldCodeOk && await load('/modules/_CodeMirror/addon/fold/foldgutter.js');
        const braceFoldOk = foldCodeOk && await load('/modules/_CodeMirror/addon/fold/brace-fold.js');
        const jsHintOk = await load('/modules/_CodeMirror/addon/hint/javascript-hint.js');
        return { closeOk, matchOk, searchOk, commentOk, foldOk: foldCodeOk && foldGutterOk && braceFoldOk, jsHintOk };
    })();
    return _extraAddonsPromise;
}

export function installLancerHints(cm, kind = 'activationCode')
{
    if (!cm || typeof CodeMirror === 'undefined' || !CodeMirror.showHint)
        return;
    _ensureExtraAddons().then((flags) =>
    {
        if (flags.closeOk)
        {
            try
            {
                cm.setOption('autoCloseBrackets', true);
            }
            catch
            { /* addon missing */ }
        }
        if (flags.matchOk)
        {
            try
            {
                cm.setOption('highlightSelectionMatches', { showToken: /\w/ });
            }
            catch
            { /* addon missing */ }
        }
        if (flags.foldOk)
        {
            try
            {
                cm.setOption('foldGutter', true);
                cm.setOption('gutters', ['CodeMirror-linenumbers', 'CodeMirror-foldgutter']);
            }
            catch
            { /* addon missing */ }
        }
        // Bind Ctrl-/ (toggle line comment), Ctrl-F (search): keymaps are no-ops if the addon isn't loaded.
        const extra = { ...(cm.getOption('extraKeys') || {}) };
        if (flags.commentOk)
            extra['Ctrl-/'] = (cm) => cm.toggleComment();
        if (flags.searchOk)
        {
            extra['Ctrl-F'] = 'findPersistent';
            extra['Ctrl-G'] = 'findNext';
            extra['Shift-Ctrl-G'] = 'findPrev';
        }
        cm.setOption('extraKeys', extra);
    });
    const trigger = () => CodeMirror.showHint(cm, (cmInst) => _hint(cmInst, kind), {
        completeSingle: false,
        closeOnUnfocus: true,
    });
    const prev = cm.getOption('extraKeys') || {};
    cm.setOption('extraKeys', {
        ...prev,
        'Alt-Enter': trigger,
    });
    cm.on('inputRead', (_cm, change) =>
    {
        const ch = change.text?.[0] ?? '';
        if (!ch)
            return;
        if (/[\w.]/.test(ch))
            setTimeout(trigger, 0);
    });
    _installLancerArgOverlay(cm, kind);
    _installLancerSignatureTooltip(cm);
}

function _installLancerSignatureTooltip(cm)
{
    let tip = null;
    const hide = () =>
    {
        if (tip)
        {
            tip.remove(); tip = null;
        }
    };
    const show = (text, x, y) =>
    {
        if (!tip)
        {
            tip = document.createElement('div');
            tip.className = 'la-cm-sigtip';
            tip.style.cssText = 'position:fixed;z-index:99999;background:#1a1a1a;border:1px solid #555;color:#e8a020;font-family:monospace;font-size:0.78em;padding:3px 6px;border-radius:3px;box-shadow:0 2px 8px rgba(0,0,0,0.5);pointer-events:none;white-space:nowrap;';
            document.body.appendChild(tip);
        }
        tip.textContent = text;
        const rect = tip.getBoundingClientRect();
        const left = Math.max(4, Math.min(window.innerWidth - rect.width - 4, x));
        const top = Math.max(4, y - rect.height - 4);
        tip.style.left = left + 'px';
        tip.style.top = top + 'px';
    };
    cm.on('cursorActivity', () =>
    {
        const cur = cm.getCursor();
        const line = cm.getLine(cur.line) || '';
        const upto = line.slice(0, cur.ch);
        // Match: api.fnName( ... cursor here, no close paren yet on this line segment
        const sigMatch = upto.match(/api\.(\w+)\([^)]*$/);
        if (!sigMatch)
        {
            hide(); return;
        }
        const name = sigMatch[1];
        const sig = SIG_BY_NAME.get(name);
        const returnType = RETURNS_BY_NAME.get(name);
        if (!sig)
        {
            hide(); return;
        }
        const text = `${name}${sig}${returnType ? ` → ${returnType}` : ''}`;
        const coord = cm.cursorCoords(true, 'window');
        show(text, coord.left, coord.top);
    });
    cm.on('blur', hide);
    cm.on('focus', () =>
    { /* keep hidden until cursor moves */ });
}

function _installLancerArgOverlay(cm, kind)
{
    const params = PARAMS_BY_KIND[kind] ?? [];
    if (!params.length)
        return;
    _ensureLancerArgStyle();
    const paramRe = new RegExp(`\\b(${params.join('|')})\\b`);
    cm.addOverlay({
        token: (stream) =>
        {
            if (stream.match(paramRe))
                return 'la-arg';
            while (stream.next() != null && !paramRe.test(stream.peek() ?? ''))
            { /* advance */ }
            return null;
        }
    });
}

let _argStyleInjected = false;
function _ensureLancerArgStyle()
{
    if (_argStyleInjected)
        return;
    _argStyleInjected = true;
    const style = document.createElement('style');
    style.textContent = '.CodeMirror .cm-la-arg { color: #e8a020; font-weight: 600; }';
    document.head.appendChild(style);
}

export function refreshLancerHintCache()
{
    _apiCache = null;
}
