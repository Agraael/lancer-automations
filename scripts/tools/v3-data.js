import { untilEndOfTurn, untilStartOfTurn, untilEndOfRound, untilStartOfRound, untilEndOfEncounter } from '../bonuses/duration-builders.js';
import { normalizeV3StatusId } from './v3-condition.js';

const NPC_IMPORT_ID = "lancer-npc-import";
const RESIST_DAMAGE_TYPES = ['burn', 'energy', 'explosive', 'heat', 'kinetic'];
const DAMAGE_SUBJECTS = [...RESIST_DAMAGE_TYPES, 'aoe'];
const NON_PASSIVE_SEGMENTS = new Set(['actions', 'sub_actions', 'active_actions', 'passive_actions', 'deployables', 'on_attack', 'on_hit', 'on_crit', 'on_miss']);
const CORE_PASSIVE_KEYS = new Set(['passive_effects', 'active_effects', 'passive_bonuses', 'active_bonuses']);
const FREQUENCY_PERIODS = { round: 'round', turn: 'turn', scene: 'combat', encounter: 'combat', mission: 'mission' };
const DEFENSE_BONUS_IDS = new Set(['immunity', 'resistance']);

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

function frequencyFields(frequency)
{
    const period = FREQUENCY_PERIODS[frequency?.per];
    if (!period || !frequency.count)
        return {};
    return frequency.count > 1 ? { frequency: period, frequencyCount: frequency.count } : { frequency: period };
}

function isPassiveBonusEntry(entry)
{
    return !entry.activation && !entry.save && !entry.attack && isPassiveLocation(entry.path);
}

function buildRow(item, entry, bonuses, { idSuffix = '', condition = null, duration = null } = {})
{
    const id = `v3_${item.id}_${entry.path ? entry.path.replace(/\./g, '_') : 'root'}${idSuffix}`;
    const name = entry.name || item.name;
    const dataSource = { uuid: item.uuid, name: item.name };
    const extra = { ...frequencyFields(entry.frequency), ...(condition ? { dataCondition: condition } : {}) };
    const bonus = bonuses.length === 1 ? { id, name, ...bonuses[0], ...extra, dataSource } : { id, name, type: 'multi', bonuses, ...extra, dataSource };
    return { bonus, path: entry.path, condition, duration, reactionPath: String(entry.path ?? '').replace(/\.(\d+)/g, '[$1]') };
}

const _defenseCache = new WeakMap();

export function v3DefenseBonuses(item)
{
    const entries = item?.flags?.[NPC_IMPORT_ID]?.v3?.entries;
    if (!Array.isArray(entries))
        return [];
    const cached = _defenseCache.get(entries);
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
        if (!isPassiveBonusEntry(entry))
            continue;
        for (const { record, index } of v3EntryBonusRecords(entry))
        {
            if (!DEFENSE_BONUS_IDS.has(record.id))
                continue;
            const bonuses = bonusRecordDefenses(record);
            if (bonuses.length)
                built.push(buildRow(item, entry, bonuses, { idSuffix: `_b${index}`, condition: record.condition ?? null, duration: entry.duration ?? null }));
        }
    }
    _defenseCache.set(entries, built);
    return built;
}

function v3EntryBonusRecords(entry)
{
    return (entry.bonuses ?? []).map((record, index) => ({ record, index }))
        .filter(({ record }) => record && typeof record === 'object' && (!entry.condition || record.condition));
}

export function v3BonusRecords(item)
{
    return getV3Data(item).flatMap(entry => v3EntryBonusRecords(entry).map(({ record, index }) => ({ record, entry, path: entry.path, index, condition: record.condition ?? null })));
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

export const V3DataAPI = {
    getV3Data
};
