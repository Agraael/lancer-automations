import { untilEndOfTurn, untilStartOfTurn, untilEndOfRound, untilStartOfRound, untilEndOfEncounter } from '../bonuses/duration-builders.js';
import { normalizeV3StatusId, pilotOf, v3ConditionLabel } from './v3-condition.js';
import { getLAFlag } from './flag-utils.js';
import { MODULE_ID } from './constants.js';
import { isWeaponItem } from '../utils/lancer-token.js';
import { setItemFlag, unsetItemFlag } from '../socket.js';
import { EXTRA_ACTION_KINDS } from '../combat/action-extras.js';

const NPC_IMPORT_ID = "lancer-npc-import";
const RESIST_DAMAGE_TYPES = ['burn', 'energy', 'explosive', 'heat', 'kinetic'];
const DAMAGE_SUBJECTS = [...RESIST_DAMAGE_TYPES, 'aoe'];
const NON_PASSIVE_SEGMENTS = new Set(['actions', 'sub_actions', 'active_actions', 'passive_actions', 'deployables', 'on_attack', 'on_hit', 'on_crit', 'on_miss']);
const CORE_PASSIVE_KEYS = new Set(['passive_effects', 'active_effects', 'passive_bonuses', 'active_bonuses']);
const FREQUENCY_PERIODS = { round: 'round', turn: 'turn', scene: 'combat', encounter: 'combat', mission: 'mission' };
const DEFENSE_BONUS_IDS = new Set(['immunity', 'resistance']);
const PILOT_EQUIPMENT_TYPES = new Set(['pilot_gear', 'pilot_armor', 'pilot_weapon']);
const MECH_READS_PILOT_TYPES = new Set(['talent', 'core_bonus', 'reserve', ...PILOT_EQUIPMENT_TYPES]);
const SKILLS = ['hull', 'agility', 'systems', 'engineering'];
const ACCURACY_ROLL_TYPES = {
    attack: ['attack'],
    ranged: ['ranged', 'nexus'],
    melee: ['melee'],
    tech_attack: ['tech_attack'],
    grapple: ['grapple'],
    ram: ['ram'],
    save: ['save'],
    check: [...SKILLS, 'grit'].map(skill => `${skill}_check`),
    ...Object.fromEntries(SKILLS.flatMap(skill => [[skill, [skill]], [`${skill}_check`, [`${skill}_check`]], [`${skill}_save`, [`${skill}_save`]]]))
};
const WEAPON_FILTERS = { weapon_types: 'weaponTypes', weapon_sizes: 'weaponSizes', range_types: 'weaponRangeTypes', damage_types: 'weaponDamageTypes' };
const WEAPON_HOOK_PATH = /^(profiles\.\d+\.)?on_(hit|crit|attack|miss)(\.\d+)?$/;
const HOOK_HIT_TYPES = { on_hit: 'hit', on_crit: 'crit', on_attack: 'hit', on_miss: 'miss' };

export function getV3Data(item, options = {})
{
    return /** @type {any} */ (game.modules.get(NPC_IMPORT_ID))?.api?.getV3Data?.(item, options) ?? [];
}

export function getV3ChipRows(item)
{
    return /** @type {any} */ (game.modules.get(NPC_IMPORT_ID))?.api?.getV3ChipRows?.(item) ?? [];
}

export function v3Duration(duration, { self = null, target = null } = {})
{
    if (!duration || duration.encounter || duration.raw === 'end_of_encounter')
        return untilEndOfEncounter();
    if (duration.indefinite)
        return { label: 'indefinite', turns: null, rounds: null };
    if (duration.at && Number.isFinite(Number(duration.round)))
        return duration.at === 'end' ? untilEndOfRound(Number(duration.round) + 1) : untilStartOfRound(Number(duration.round));
    if (!duration.at || !duration.of)
        return null;
    const origin = duration.of === 'self' ? self : (target ?? self);
    if (!origin)
        return null;
    const turns = duration.next ? 1 : 0;
    return duration.at === 'start' ? untilStartOfTurn(origin, turns) : untilEndOfTurn(origin, turns);
}

function isPassiveLocation(path)
{
    const segments = String(path ?? '').split('.');
    if (segments.some(segment => NON_PASSIVE_SEGMENTS.has(segment)))
        return false;
    return segments[0] !== 'core_system' || CORE_PASSIVE_KEYS.has(segments[1]);
}

function isPresent(value)
{
    return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== '';
}

function isSelfRecord(record)
{
    return record?.target === 'self' && !record.save;
}

function isAutoEntry(entry)
{
    const raw = entry.raw ?? {};
    if (entry.activation || entry.condition || entry.save || entry.attack)
        return false;
    if (['damage', 'add_status', 'add_other', 'add_special'].some(key => isPresent(raw[key])))
        return false;
    const resistRecords = [...entry.resist, ...entry.vulnerability, ...entry.immunity].filter(record => record.field === 'add_resist');
    return resistRecords.length > 0 && resistRecords.every(isSelfRecord) && isPassiveLocation(entry.path);
}

function damageTypeList(types)
{
    const unique = [...new Set(types)];
    if (RESIST_DAMAGE_TYPES.every(type => unique.includes(type)))
        return ['All'];
    return unique.map(type => (type === 'aoe' ? 'AoE' : type.charAt(0).toUpperCase() + type.slice(1)));
}

function passiveDefenseBonuses(entry)
{
    const bonuses = [];
    const resistTypes = entry.resist.filter(isSelfRecord).map(record => record.type);
    if (resistTypes.length)
        bonuses.push({ type: 'resistance', damageTypes: damageTypeList(resistTypes) });
    const vulnerableTypes = entry.vulnerability.filter(isSelfRecord).map(record => record.type);
    if (vulnerableTypes.length)
        bonuses.push({ type: 'vulnerability', damageTypes: damageTypeList(vulnerableTypes) });
    const immunities = entry.immunity.filter(isSelfRecord);
    const immuneTypes = immunities.filter(record => record.damage).map(record => record.damage);
    if (immuneTypes.length)
        bonuses.push({ type: 'immunity', subtype: 'damage', damageTypes: damageTypeList(immuneTypes) });
    const immuneEffects = immunities.filter(record => record.status).map(record => record.status);
    if (immuneTypes.includes('burn'))
        immuneEffects.push('burn');
    if (immuneEffects.length)
        bonuses.push({ type: 'immunity', subtype: 'effect', effects: [...new Set(immuneEffects)] });
    return bonuses;
}

function bonusRecordDefenses(record)
{
    const values = (Array.isArray(record.val) ? record.val : [record.val]).map(value => String(value ?? '').trim().toLowerCase()).filter(Boolean);
    const damage = values.flatMap(value => (value === 'all' ? RESIST_DAMAGE_TYPES : [value])).filter(value => DAMAGE_SUBJECTS.includes(value));
    if (record.id === 'resistance')
        return damage.length ? [{ type: 'resistance', damageTypes: damageTypeList(damage) }] : [];
    const bonuses = [];
    if (damage.length)
        bonuses.push({ type: 'immunity', subtype: 'damage', damageTypes: damageTypeList(damage) });
    const effects = values.filter(value => value !== 'all' && !DAMAGE_SUBJECTS.includes(value)).map(normalizeV3StatusId);
    if (damage.includes('burn'))
        effects.push('burn');
    if (effects.length)
        bonuses.push({ type: 'immunity', subtype: 'effect', effects: [...new Set(effects)] });
    return bonuses;
}

function recordFilters(record)
{
    return Object.fromEntries(Object.entries(WEAPON_FILTERS)
        .filter(([field]) => Array.isArray(record[field]) && record[field].length)
        .map(([field, key]) => [key, record[field]]));
}

function recordAccuracyBonus(record)
{
    const rollTypes = ACCURACY_ROLL_TYPES[String(record.id ?? '').toLowerCase()];
    const net = (Number(record.accuracy) || 0) - (Number(record.difficulty) || 0);
    if (!rollTypes || !net)
        return null;
    return { type: net > 0 ? 'accuracy' : 'difficulty', val: Math.abs(net), rollTypes, ...recordFilters(record) };
}

function recordStatMode(record)
{
    if (record.overwrite && record.replace)
        return 'replace';
    if (record.replace)
        return 'replace_base';
    return record.overwrite ? 'overwrite' : 'add';
}

function minRangeTypes(record)
{
    const listed = Array.isArray(record.range_types) && record.range_types.length ? record.range_types : ['Range', 'Threat'];
    return listed.map(type => String(type).charAt(0).toUpperCase() + String(type).slice(1).toLowerCase());
}

const VALUE_BONUS_BUILDERS = {
    threat: record => ({ type: 'range', rangeType: 'Threat', rangeMode: record.replace ? 'override' : 'add' }),
    knockback: () => ({ type: 'tag', tagId: 'tg_knockback', tagName: 'Knockback', tagMode: 'add' }),
    thrown: () => ({ type: 'tag', tagId: 'tg_thrown', tagName: 'Thrown', tagMode: 'at_least' }),
    min_range: record => minRangeTypes(record).map(rangeType => ({ type: 'range', rangeType, rangeMode: 'at_least' })),
    boost: () => ({ type: 'movement_extra', subtype: 'boost' }),
    attack: () => ({ type: 'flat', rollTypes: ['ranged', 'melee', 'nexus'] }),
    grapple: () => ({ type: 'flat', rollTypes: ['grapple'] }),
    ram: () => ({ type: 'flat', rollTypes: ['ram'] }),
    activations: record => ({ type: 'stat', stat: 'system.activations', statMode: recordStatMode(record) }),
    heat_cap: record => ({ type: 'stat', stat: 'system.heat.max', statMode: recordStatMode(record) }),
    extra_action: record =>
    {
        const kind = String(record.val).trim().toLowerCase();
        return EXTRA_ACTION_KINDS.includes(kind) ? { type: 'action_extra', subtype: kind, val: 1 } : [];
    }
};

function recordValueBonuses(record)
{
    const id = String(record.id ?? '').toLowerCase();
    const build = VALUE_BONUS_BUILDERS[id];
    if (!build || record.val === undefined || record.val === null || record.val === '')
        return [];
    const filters = recordFilters(record);
    if (id === 'min_range')
        delete filters.weaponRangeTypes;
    return [build(record)].flat().map(bonus => ({ val: record.val, ...bonus, ...filters }));
}

function frequencyFields(frequency)
{
    const period = FREQUENCY_PERIODS[frequency?.per];
    if (!period || !frequency.count)
        return {};
    return frequency.count > 1 ? { frequency: period, frequencyCount: frequency.count } : { frequency: period };
}

function isPassiveBonusEntry(entry)
{
    return isPassiveLocation(entry.path);
}

function isPilotSide(item, entry)
{
    if (entry.pilot)
        return true;
    if (entry.mech)
        return false;
    return PILOT_EQUIPMENT_TYPES.has(item.type);
}

function ownerName(item, path)
{
    const [first, second] = String(path ?? '').split('.');
    const system = item.system ?? {};
    if (['traits', 'ranks', 'actions'].includes(first) && /^\d+$/.test(second ?? ''))
        return system[first]?.[Number(second)]?.name ?? null;
    if (first !== 'core_system')
        return null;
    const core = system.core_system ?? {};
    return (String(second ?? '').startsWith('passive') ? core.passive_name : core.active_name) || core.name || null;
}

function buildRow(item, entry, bonuses, { idSuffix = '', condition = null, duration = null, bonusRecord = false } = {})
{
    const id = `v3_${item.id}_${entry.path ? entry.path.replace(/\./g, '_') : 'root'}${idSuffix}`;
    const name = entry.name || ownerName(item, entry.path) || item.name;
    const dataSource = { uuid: item.uuid, name: item.name };
    const extra = { ...frequencyFields(entry.frequency), ...(condition ? { dataCondition: condition } : {}) };
    const bonus = bonuses.length === 1 ? { id, name, ...bonuses[0], ...extra, dataSource } : { id, name, type: 'multi', bonuses, ...extra, dataSource };
    return { bonus, path: entry.path, condition, duration, reactionPath: String(entry.path ?? '').replace(/\.(\d+)/g, '[$1]'), pilotSide: isPilotSide(item, entry), bonusRecord };
}

function bonusDamageScope(item, entry)
{
    if (entry.condition || entry.activation || entry.save || entry.attack)
        return null;
    const weapon = isWeaponItem(item);
    if (WEAPON_HOOK_PATH.test(entry.path))
        return weapon ? { itemId: item.id, hitType: HOOK_HIT_TYPES[entry.hook] } : null;
    return isPassiveLocation(entry.path) ? { itemId: weapon ? item.id : null, hitType: null } : null;
}

function damageBonusRows(item, entry)
{
    const scope = entry.bonusDamage?.length ? bonusDamageScope(item, entry) : null;
    if (!scope)
        return [];
    return entry.bonusDamage.flatMap(record =>
    {
        const hitType = record.hitType ?? scope.hitType;
        if (hitType === 'miss')
            return [];
        const bonus = {
            type: 'damage',
            damageMode: 'add',
            damage: [{ val: String(record.val), type: record.type ?? null }],
            ...(scope.itemId ? { itemId: scope.itemId } : {}),
            ...(record.weaponTypes?.length ? { weaponTypes: record.weaponTypes } : {}),
            ...(record.weaponSizes?.length ? { weaponSizes: record.weaponSizes } : {}),
            ...(hitType === 'crit' ? { critOnly: true } : { defaultOff: true })
        };
        return [buildRow(item, entry, [bonus], { idSuffix: `_d${record.index}`, duration: entry.duration ?? null })];
    });
}

const _rowCache = new WeakMap();

export function v3DataRows(item)
{
    const entries = item?.flags?.[NPC_IMPORT_ID]?.v3?.entries;
    if (!Array.isArray(entries) || !(/** @type {any} */ (game.modules.get(NPC_IMPORT_ID))?.api?.getV3Data))
        return [];
    const cached = _rowCache.get(entries);
    if (cached)
        return cached;
    const built = [];
    for (const entry of getV3Data(item))
    {
        if (isAutoEntry(entry))
        {
            const bonuses = passiveDefenseBonuses(entry);
            const recordDuration = [...entry.resist, ...entry.vulnerability, ...entry.immunity].find(record => record.field === 'add_resist' && record.duration)?.duration ?? null;
            if (bonuses.length)
                built.push(buildRow(item, entry, bonuses, { duration: entry.duration ?? recordDuration }));
        }
        built.push(...damageBonusRows(item, entry));
        if (!isPassiveBonusEntry(entry))
            continue;
        for (const { record, index } of v3EntryBonusRecords(entry))
        {
            const rowOptions = { condition: record.condition ?? null, duration: entry.duration ?? null, bonusRecord: true };
            const bonuses = DEFENSE_BONUS_IDS.has(record.id) ? bonusRecordDefenses(record) : [recordAccuracyBonus(record)].filter(Boolean);
            if (bonuses.length)
                built.push(buildRow(item, entry, bonuses, { idSuffix: `_b${index}`, ...rowOptions }));
            recordValueBonuses(record).forEach((valueBonus, valueIndex) =>
                built.push(buildRow(item, entry, [valueBonus], { idSuffix: `_b${index}v${valueIndex || ''}`, ...rowOptions })));
        }
    }
    _rowCache.set(entries, built);
    return built;
}

function actorReadsRow(actorType, row)
{
    if (actorType === 'pilot')
        return row.pilotSide && !row.bonusRecord;
    return actorType !== 'mech' || !row.pilotSide;
}

export function v3ActorRows(actor)
{
    const pilot = actor?.type === 'mech' ? pilotOf(actor) : null;
    const pilotItems = [...(pilot?.items ?? [])].filter(item => MECH_READS_PILOT_TYPES.has(item.type));
    return [...(actor?.items ?? []), ...pilotItems].flatMap(item => v3DataRows(item)
        .filter(row => actorReadsRow(actor.type, row))
        .map(row => ({ item, row })));
}

function v3EntryBonusRecords(entry)
{
    return (entry.bonuses ?? []).map((record, index) => ({ record, index }))
        .filter(({ record }) => record && typeof record === 'object' && (!entry.condition || record.condition));
}

export function v3BonusDurationOptions(duration, token)
{
    if (!duration || duration.encounter || duration.indefinite)
        return { duration: 'encounter' };
    if (duration.at && Number.isFinite(Number(duration.round)))
        return duration.at === 'end' ? { duration: 'roundEnd', durationRounds: Number(duration.round) + 1 } : { duration: 'roundStart', durationRounds: Math.max(1, Number(duration.round)) };
    if (duration.at === 'start' || duration.at === 'end')
        return { duration: duration.at, durationTurns: duration.next ? 1 : 0, origin: token };
    return { duration: 'encounter' };
}

const REPLACED_FLAG = 'v3Replaced';

function v3PathKey(path)
{
    return path === 'root' ? '' : String(path ?? '');
}

export function isV3DataReplaced(item, path)
{
    const target = v3PathKey(path);
    const replaced = getLAFlag(item, REPLACED_FLAG);
    return Array.isArray(replaced) && replaced.some(entry => entry === target || (entry !== '' && target.startsWith(`${entry}.`)));
}

export async function replaceV3Data(item, paths)
{
    if (!item?.setFlag)
        return;
    if (paths === undefined || paths === null)
    {
        console.warn('lancer-automations | replaceV3Data: no path given');
        return;
    }
    const current = getLAFlag(item, REPLACED_FLAG) ?? [];
    const next = [...new Set([...current, ...[paths].flat().map(v3PathKey)])];
    if (next.length !== current.length)
        await setItemFlag(item, MODULE_ID, REPLACED_FLAG, next);
}

export async function restoreV3Data(item, paths)
{
    if (!item?.setFlag)
        return;
    const current = getLAFlag(item, REPLACED_FLAG) ?? [];
    if (paths === undefined)
    {
        if (current.length)
            await unsetItemFlag(item, MODULE_ID, REPLACED_FLAG);
        return;
    }
    const removed = new Set([paths].flat().map(v3PathKey));
    const next = current.filter(entry => !removed.has(entry));
    if (next.length !== current.length)
        await setItemFlag(item, MODULE_ID, REPLACED_FLAG, next);
}

export const V3DataAPI = {
    getV3Data,
    v3ConditionLabel,
    replaceV3Data,
    restoreV3Data,
    isV3DataReplaced
};
