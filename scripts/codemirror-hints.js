/* global CodeMirror, game */

import { AUTO_API_MANIFEST, AUTO_OPTION_SCHEMAS, AUTO_DOC_INDEX, AUTO_DOC_REF } from '../tools/codemirror-hints-data.generated.js';

const HAND_SIGNATURE_OVERRIDES = {
};
const HAND_RETURN_OVERRIDES = {
};

const SIG_BY_NAME = new Map(AUTO_API_MANIFEST.map((e) => [e.name, e.args]));
const RETURNS_BY_NAME = new Map(AUTO_API_MANIFEST.map((e) => [e.name, e.returns ?? '']));
const SUMMARY_BY_NAME = new Map(AUTO_API_MANIFEST.map((e) => [e.name, e.summary ?? '']));
const PARAMS_BY_NAME = new Map(AUTO_API_MANIFEST.map((e) => [e.name, e.params ?? []]));
const HAS_DOC_BY_NAME = new Map(AUTO_API_MANIFEST.map((e) => [e.name, !!e.hasDoc]));


const TRIGGER_MANIFEST = [
    { name: 'triggeringToken' },
    { name: 'distanceToTrigger' },
    { name: 'canTriggerReaction' },
    { name: 'flowState' },
    { name: 'actionData' },
    { name: 'extraData' },
    { name: 'startRelatedFlow', args: '()' },
    { name: 'startRelatedFlowToReactor', args: '(userId, extraData, opts)' },
    { name: 'sendMessageToReactor', args: '(data, userId, opts)' },
    { name: 'cancel', args: '(reason)' },
    { name: 'cancelAttack', args: '(reason)' },
    { name: 'cancelTechAttack', args: '(reason)' },
    { name: 'cancelCheck', args: '(reason)' },
    { name: 'cancelAction', args: '(reason)' },
    { name: 'cancelTriggeredMove', args: '(reason)' },
    { name: 'cancelChange', args: '(reason)' },
    { name: 'cancelStructure', args: '(reason)' },
    { name: 'cancelStress', args: '(reason)' },
    { name: 'cancelHpChange', args: '(reason)' },
    { name: 'cancelHeatChange', args: '(reason)' },
    { name: 'changeTriggeredMove', args: '(newPos, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)' },
    { name: 'modifyHpChange', args: '(newValue, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)' },
    { name: 'modifyHeatChange', args: '(newValue, reason, allowConfirm, userIdControl, preConfirm, postChoice, opts)' },
    { name: 'reroll', args: '(reason)' },
    { name: 'changeRoll', args: '(newTotal)' },
    { name: 'targets' },
    { name: 'weapon' },
    { name: 'damages' },
    { name: 'item' },
    { name: 'roll' },
    { name: 'total' },
    { name: 'success' },
    { name: 'rollType' },
    { name: 'isCrit' },
    { name: 'isHit' },
    { name: 'previousHP' },
    { name: 'newHP' },
    { name: 'previousHeat' },
    { name: 'newHeat' },
    { name: 'delta' },
    { name: 'remainingStructure' },
    { name: 'remainingStress' },
    { name: 'rollResult' },
    { name: 'statusId' },
    { name: 'effect' },
    { name: 'startPos' },
    { name: 'endPos' },
    { name: 'distance' },
    { name: 'elevation' },
    { name: 'isDrag' },
    { name: 'moveInfo' },
    { name: 'token' },
    { name: 'actionName' },
    { name: 'destination' },
    { name: 'combat' },
    { name: 'combatant' },
    { name: 'changes' },
    { name: 'isHidden' },
    { name: 'deployable' },
    { name: 'deployedTokens' },
    { name: 'target' },
    { name: 'hpDelta' },
    { name: 'currentHeat' },
    { name: 'heatDelta' },
    { name: 'actor' },
    { name: 'checkType' },
    { name: 'checkResult' },
    { name: 'endActivation' },
    { name: 'isReroll' },
    { name: 'rerollCount' },
];

const COMMON_TRIGGER_FIELDS = new Set([
    'triggeringToken', 'distanceToTrigger', 'canTriggerReaction',
    'flowState', 'actionData', 'extraData',
    'startRelatedFlow', 'startRelatedFlowToReactor', 'sendMessageToReactor',
]);

const TRIGGER_FIELDS_BY_TRIGGER = {
    onPreMove:           ['token', 'moveInfo', 'startPos', 'endPos', 'cancelTriggeredMove', 'changeTriggeredMove'],
    onMove:              ['distance', 'elevation', 'startPos', 'endPos', 'isDrag', 'moveInfo'],
    onInvoluntaryMove:   ['token', 'distance', 'actionName', 'item', 'destination', 'cancel'],
    onAttack:            ['targets', 'weapon'],
    onInitAttack:        ['targets', 'weapon', 'cancelAttack'],
    onHit:               ['targets', 'weapon'],
    onMiss:              ['targets', 'weapon'],
    onTechAttack:        ['targets'],
    onInitTechAttack:    ['targets', 'cancelTechAttack'],
    onTechHit:           ['targets'],
    onTechMiss:          ['targets'],
    onDamage:            ['target', 'damages', 'weapon', 'isCrit', 'isHit'],
    onPreStructure:      ['remainingStructure', 'cancelStructure'],
    onStructure:         ['remainingStructure', 'rollResult'],
    onPreStress:         ['remainingStress', 'cancelStress'],
    onStress:            ['remainingStress', 'rollResult'],
    onPreHpChange:       ['previousHP', 'newHP', 'delta', 'cancelHpChange', 'modifyHpChange'],
    onHpLoss:            ['hpDelta', 'actor'],
    onPreHeatChange:     ['previousHeat', 'newHeat', 'delta', 'cancelHeatChange', 'modifyHeatChange'],
    onHeatGain:          ['currentHeat', 'heatDelta'],
    onRoll:              ['rollType', 'roll', 'total', 'success', 'targets', 'item', 'isReroll', 'rerollCount', 'reroll', 'changeRoll'],
    onPreStatusApplied:  ['statusId', 'effect', 'cancelChange'],
    onPreStatusRemoved:  ['statusId', 'effect', 'cancelChange'],
    onStatusApplied:     ['statusId', 'effect'],
    onStatusRemoved:     ['statusId', 'effect'],
    onTurnStart:         ['combat', 'combatant'],
    onTurnEnd:           ['combat', 'combatant'],
    onEnterCombat:       ['combat'],
    onExitCombat:        ['combat'],
    onInitActivation:    ['actionName', 'item', 'cancelAction'],
    onActivation:        ['actionName', 'item', 'endActivation'],
    onInitCheck:         ['cancelCheck'],
    onCheck:             ['success', 'checkType', 'checkResult'],
    onDestroyed:         ['token'],
    onTokenCreated:      ['token'],
    onTokenRemoved:      ['token'],
    onTokenVisibility:   ['token', 'isHidden'],
    onDeploy:            ['deployedTokens', 'deployable'],
    onUpdate:            ['changes'],
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
    ],
    'removeEffectsByNameFromTokens.options': [
        ['tokens', 'Token[]'],
        ['effectNames', 'string[]'],
        ['extraFlags', 'object'],
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
        ['direction', 'number | { x, y }'],
        ['originToken', 'Token'],
        ['ignoreRange', 'boolean'],
    ],
    'placeToken.options': [
        ['actor', 'Actor | string'],
        ['multiActor', 'boolean'],
        ['count', 'number'],
    ],
    'spawnHardCover.options': [
        ['size', 'number'],
        ['name', 'string'],
        ['persistent', 'boolean'],
    ],
    'executeBasicAttack.options': [
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
        ['critical', 'boolean'],
        ['heat', 'number'],
        ['noBonusDmg', 'boolean'],
    ],
    'addGlobalBonus.options': [
        ['duration', '"end" | "start" | "unlimited" | "indefinite" | "1 Round"'],
        ['origin', 'Token'],
        ['consumption', '{ trigger, itemLid?, grouped? }'],
    ],
    'createAura.config': [
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

const OPTION_SCHEMAS = { ...AUTO_OPTION_SCHEMAS, ...HAND_OPTION_SCHEMAS };

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

function _walkType(typeName, segments) {
    let curType = typeName;
    for (const seg of segments) {
        const fields = TYPE_FIELDS[curType];
        if (!fields)
            return null;
        const f = fields[seg];
        if (!f?.type)
            return null;
        curType = f.type;
    }
    return curType;
}

function _typeFieldsAsManifest(typeName) {
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

let _apiCache = null;
function _getApiList() {
    if (_apiCache)
        return _apiCache;
    const apiObj = game?.modules?.get?.('lancer-automations')?.api ?? {};
    const out = [];
    for (const k of Object.keys(apiObj)) {
        if (typeof apiObj[k] !== 'function')
            continue;
        const args = HAND_SIGNATURE_OVERRIDES[k] ?? SIG_BY_NAME.get(k) ?? '(...)';
        const returns = HAND_RETURN_OVERRIDES[k] ?? RETURNS_BY_NAME.get(k) ?? '';
        const summary = SUMMARY_BY_NAME.get(k) ?? '';
        const params = PARAMS_BY_NAME.get(k) ?? [];
        const hasDoc = HAS_DOC_BY_NAME.get(k) ?? false;
        out.push({ name: k, args, returns, summary, params, hasDoc });
    }
    _apiCache = out.sort((a, b) => a.name.localeCompare(b.name));
    return _apiCache;
}

function _splitArgs(args) {
    if (!args)
        return [];
    const inner = args.replace(/^\(/, '').replace(/\)$/, '').trim();
    if (!inner)
        return [];
    const parts = [];
    let depth = 0;
    let buf = '';
    for (const ch of inner) {
        if (ch === '(' || ch === '{' || ch === '[') {
            depth++;
            buf += ch;
        } else if (ch === ')' || ch === '}' || ch === ']') {
            depth--;
            buf += ch;
        } else if (ch === ',' && depth === 0) {
            parts.push(buf.trim());
            buf = '';
        } else {
            buf += ch;
        }
    }
    if (buf.trim())
        parts.push(buf.trim());
    return parts;
}

function _shortPart(part) {
    const noDefault = part.split('=')[0].trim();
    if (noDefault.startsWith('{')) {
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

function _shortSig(args) {
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

function _hideTooltip() {
    if (_tooltipTimer) {
        clearTimeout(_tooltipTimer);
        _tooltipTimer = null;
    }
    if (_tooltipEl?.parentElement)
        _tooltipEl.remove();
    _tooltipEl = null;
}

function _escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function _openDocPopup(name) {
    const entry = AUTO_DOC_INDEX[name];
    const ref = AUTO_DOC_REF[name];
    if (!entry && !ref) {
        ui?.notifications?.warn?.(`No doc reference for ${name}`);
        return;
    }
    const file = entry?.file ?? ref.file;
    const line = entry?.line ?? ref.line;
    const url = `https://github.com/Agraael/lancer-automations/blob/main/doc/${file}#L${line}`;
    window.open(url, '_blank', 'noopener');
}

function _showTooltip(anchor, name, fullArgs, returns, summary = '', params = []) {
    _hideTooltip();
    const parts = _splitArgs(fullArgs);
    const paramByName = new Map((params ?? []).map((p) => [p.name, p]));
    let body;
    if (!fullArgs || fullArgs === '()' || fullArgs === '(...)') {
        body = `<div class="la-hint-tt-paren">${fullArgs || '()'}</div>`;
    } else {
        const argLines = parts.map((p, i) => {
            const eq = p.indexOf('=');
            const namePart = eq >= 0 ? p.slice(0, eq).trim() : p;
            const defPart = eq >= 0 ? ` = ${p.slice(eq + 1).trim()}` : '';
            const comma = i < parts.length - 1 ? ',' : '';
            const lookupKey = namePart.replace(/^\{.*\}$/, 'options');
            const schema = OPTION_SCHEMAS[`${name}.${lookupKey}`];
            let schemaHtml = '';
            if (schema) {
                const lines = schema.map(([k, t]) => `<div class="la-hint-tt-schema-line"><span class="la-hint-tt-argname">${k}</span><span class="la-hint-tt-default">: ${t}</span></div>`).join('');
                schemaHtml = `<div class="la-hint-tt-schema">${lines}</div>`;
            }
            const paramMeta = paramByName.get(namePart);
            let metaHtml = '';
            if (paramMeta) {
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
    const r = anchor.getBoundingClientRect();
    const ttRect = _tooltipEl.getBoundingClientRect();
    let left = r.right + 8;
    if (left + ttRect.width > window.innerWidth - 8)
        left = Math.max(8, r.left - ttRect.width - 8);
    let top = r.top;
    if (top + ttRect.height > window.innerHeight - 8)
        top = Math.max(8, window.innerHeight - ttRect.height - 8);
    _tooltipEl.style.top = `${top}px`;
    _tooltipEl.style.left = `${left}px`;
}

function _renderHint(el, _self, data) {
    const name = data.displayName ?? data.text;
    const shortArgs = data.shortArgs ?? '';
    const isFn = !!data.fullArgs;
    const docBtn = data.hasDoc
        ? `<a class="la-hint-row-doc" title="Open API doc">?</a>`
        : '';
    el.classList.add(isFn ? 'la-hint-fn' : 'la-hint-var');
    el.innerHTML = `<span class="la-hint-name">${name}</span><span class="la-hint-args"> ${shortArgs}</span>${docBtn}`;
    if (data.hasDoc) {
        const btn = el.querySelector('.la-hint-row-doc');
        btn?.addEventListener('mousedown', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            _openDocPopup(name);
        });
    }
}

function _toCompletion(entry) {
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

function _filter(entries, prefix) {
    if (!prefix)
        return entries.map(_toCompletion);
    const lo = prefix.toLowerCase();
    const starts = [];
    const contains = [];
    for (const e of entries) {
        const n = e.name.toLowerCase();
        if (n.startsWith(lo))
            starts.push(e);
        else if (n.includes(lo))
            contains.push(e);
    }
    return [...starts, ...contains].map(_toCompletion);
}

function _attachTooltipEvents(data, cm) {
    if (!data || !data.list?.length)
        return data;
    CodeMirror.on(data, 'select', (entry, el) => {
        if (entry?.fullArgs && el)
            _showTooltip(el, entry.displayName ?? entry.text, entry.fullArgs, entry.returns, entry.summary, entry.params);
        else
            _hideTooltip();
    });
    CodeMirror.on(data, 'close', _hideTooltip);
    CodeMirror.on(data, 'pick', (entry) => {
        _hideTooltip();
        if (cm && entry?._isFn) {
            const pos = cm.getCursor();
            cm.setCursor({ line: pos.line, ch: pos.ch - 1 });
        }
    });
    return data;
}

/** @param {any} cm @param {string} kind */
function _getSelectedTriggers(cm) {
    const wrapper = cm?.getWrapperElement?.();
    if (!wrapper)
        return null;
    const form = wrapper.closest('form');
    if (!form)
        return null;
    const selected = new Set();
    for (const input of form.querySelectorAll('input[type="checkbox"][name^="trigger."]')) {
        if (input.checked) {
            const key = input.name.slice('trigger.'.length);
            if (key)
                selected.add(key);
        }
    }
    return selected.size > 0 ? selected : null;
}

function _filterTriggerManifestByForm(cm) {
    const selected = _getSelectedTriggers(cm);
    if (!selected)
        return TRIGGER_MANIFEST;
    const allowed = new Set(COMMON_TRIGGER_FIELDS);
    for (const trig of selected) {
        const fields = TRIGGER_FIELDS_BY_TRIGGER[trig];
        if (fields)
            for (const f of fields)
                allowed.add(f);
    }
    return TRIGGER_MANIFEST.filter((e) => allowed.has(e.name));
}

function _hint(cm, kind) {
    const cur = cm.getCursor();
    const line = cm.getLine(cur.line);
    const before = line.slice(0, cur.ch);

    const apiMatch = before.match(/\bapi\.(\w*)$/);
    if (apiMatch) {
        const prefix = apiMatch[1];
        return _attachTooltipEvents({
            list: _filter(_getApiList(), prefix),
            from: { line: cur.line, ch: cur.ch - prefix.length },
            to: cur,
        }, cm);
    }

    const triggerObj = TRIGGER_OBJECT_BY_KIND[kind];
    if (triggerObj) {
        const re = new RegExp(`\\b${triggerObj}\\.(\\w*)$`);
        const trigMatch = before.match(re);
        if (trigMatch) {
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
    if (chainMatch) {
        const chain = chainMatch[1].split('.');
        const root = chain[0];
        const startType = VAR_TYPES[root];
        if (startType) {
            const finalType = _walkType(startType, chain.slice(1));
            const fields = finalType ? _typeFieldsAsManifest(finalType) : null;
            if (fields) {
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
export function installLancerHints(cm, kind = 'activationCode') {
    if (!cm || typeof CodeMirror === 'undefined' || !CodeMirror.showHint)
        return;
    const trigger = () => CodeMirror.showHint(cm, (cmInst) => _hint(cmInst, kind), {
        completeSingle: false,
        closeOnUnfocus: true,
    });
    const prev = cm.getOption('extraKeys') || {};
    cm.setOption('extraKeys', {
        ...prev,
        'Alt-Enter': trigger,
    });
    cm.on('inputRead', (_cm, change) => {
        const ch = change.text?.[0] ?? '';
        if (!ch)
            return;
        if (/[\w.]/.test(ch))
            setTimeout(trigger, 0);
    });
}

export function refreshLancerHintCache() {
    _apiCache = null;
}
