import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag } from '../tools/flag-utils.js';

export const SNAPSHOT_STEP = 'lancer-automations:undoSnapshot';
const SNAPSHOT_FLOWS = ['ActivationFlow', 'SystemFlow', 'CoreActiveFlow', 'OverchargeFlow', 'StabilizeFlow', 'SimpleActivationFlow', 'TalentFlow', 'BondPowerFlow', 'TechAttackFlow', 'WeaponAttackFlow', 'BasicAttackFlow'];
const ITEM_COUNTERS = ['uses_per_round', 'uses_per_turn', 'uses_per_scene', 'uses_per_mission'];
const ACTOR_VALUES = [
    { key: 'hp', path: 'system.hp.value', label: 'LA.tape.back.hp' },
    { key: 'repairs', path: 'system.repairs.value', label: 'LA.tape.back.repairs' },
    { key: 'burn', path: 'system.burn', label: 'LA.tape.back.burn' },
    { key: 'infection', path: 'system.infection', label: 'LA.tape.back.infection' },
];

const FREE_USE_WINDOW_MS = 30000;
let _freeUse = null;
let _effectCapture = null;

export function armFreeUse(actor)
{
    _freeUse = actor ? { actorId: actor.id, until: Date.now() + FREE_USE_WINDOW_MS } : null;
}

export function claimFreeUse(actor)
{
    if (!_freeUse || Date.now() > _freeUse.until)
    {
        _freeUse = null;
        return false;
    }
    if (_freeUse.actorId !== actor?.id)
        return false;
    _freeUse = null;
    return true;
}

export function captureAppliedEffects(tapeId = null)
{
    const capture = { applied: [], removed: [], tapeId };
    _effectCapture = capture;
    return () =>
    {
        if (_effectCapture === capture)
            _effectCapture = null;
        return capture;
    };
}

export function captureTapeId()
{
    return _effectCapture?.tapeId ?? null;
}

export function noteAppliedEffect(targetID, effect)
{
    const name = typeof effect === 'string' ? effect : effect?.name;
    if (_effectCapture && targetID && name)
        _effectCapture.applied.push({ targetID, name });
}

export function noteRemovedEffect(effect)
{
    if (_effectCapture && effect?.parent?.uuid)
        _effectCapture.removed.push(removedRecord(effect));
}

export function removedRecord(effect)
{
    const data = effect.toObject();
    delete data._id;
    return { parentUuid: effect.parent.uuid, name: effect.name, data };
}

function flowItem(state)
{
    const actor = state?.actor;
    return state?.item ?? (state?.data?.action?._sourceItemId ? actor?.items?.get(state.data.action._sourceItemId) : null) ?? null;
}

function freqValues(doc)
{
    return foundry.utils.flattenObject(foundry.utils.deepClone(getLAFlag(doc, 'perFreqSub') ?? {}));
}

function readNumber(doc, path)
{
    const value = foundry.utils.getProperty(doc ?? {}, path);
    return typeof value === 'number' ? value : null;
}

function loadedWeapons(actor)
{
    return (actor?.items ?? []).filter(item => typeof item.system?.loaded === 'boolean').map(item => ({ id: item.id, loaded: item.system.loaded }));
}

function snapshotFor(actor, item)
{
    const system = item?.system ?? {};
    return {
        heat: actor?.system?.heat?.value ?? null,
        overcharge: actor?.system?.overcharge ?? null,
        coreEnergy: actor?.system?.core_energy ?? null,
        coreActive: !!actor?.system?.core_active,
        stress: actor?.system?.stress?.value ?? null,
        values: Object.fromEntries(ACTOR_VALUES.map(entry => [entry.key, readNumber(actor, entry.path)])),
        weapons: loadedWeapons(actor),
        actorFreq: freqValues(actor),
        item: item
            ? {
                id: item.id,
                uses: system.uses?.value ?? null,
                charged: system.charged ?? null,
                loaded: system.loaded ?? null,
                counters: Object.fromEntries(ITEM_COUNTERS.map(field => [field, system[field]?.value ?? null])),
                freq: freqValues(item),
            }
            : null,
    };
}

function numericDeltas(before, now)
{
    const deltas = [];
    for (const [path, value] of Object.entries(now))
    {
        if (!path.endsWith('.value') || typeof value !== 'number')
            continue;
        const delta = value - (Number(before[path]) || 0);
        if (delta !== 0)
            deltas.push({ path, delta });
    }
    return deltas;
}

export function changesSince(snapshot, actor)
{
    if (!snapshot || !actor)
        return null;
    const changes = {};
    const heat = actor.system?.heat?.value;
    if (snapshot.heat !== null && typeof heat === 'number' && heat !== snapshot.heat)
    {
        changes.heat = heat - snapshot.heat;
        if (changes.heat > 0)
            changes.stressBefore = snapshot.stress;
    }
    const overcharge = actor.system?.overcharge;
    if (snapshot.overcharge !== null && typeof overcharge === 'number' && overcharge !== snapshot.overcharge)
        changes.overcharge = overcharge - snapshot.overcharge;
    if (snapshot.coreEnergy !== null && actor.system?.core_energy !== snapshot.coreEnergy)
        changes.coreEnergy = { before: snapshot.coreEnergy, after: actor.system?.core_energy };
    if (!snapshot.coreActive && actor.system?.core_active)
        changes.coreActive = true;
    for (const entry of ACTOR_VALUES)
    {
        const before = snapshot.values?.[entry.key];
        const now = readNumber(actor, entry.path);
        if (before !== null && before !== undefined && now !== null && now !== before)
            changes[entry.key] = now - before;
    }
    const reloaded = (snapshot.weapons ?? [])
        .filter(weapon => weapon.loaded === false && actor.items?.get(weapon.id)?.system?.loaded === true)
        .map(weapon => weapon.id);
    if (reloaded.length)
        changes.reloaded = reloaded;
    const actorFreq = numericDeltas(snapshot.actorFreq, freqValues(actor));
    if (actorFreq.length)
        changes.actorFreq = actorFreq;
    const item = snapshot.item ? actor.items?.get(snapshot.item.id) : null;
    if (item)
    {
        const system = item.system ?? {};
        const itemChanges = {};
        if (snapshot.item.uses !== null && typeof system.uses?.value === 'number' && system.uses.value !== snapshot.item.uses)
            itemChanges.uses = system.uses.value - snapshot.item.uses;
        if (snapshot.item.charged === true && system.charged === false)
            itemChanges.charged = true;
        if (snapshot.item.loaded === true && system.loaded === false)
            itemChanges.loaded = true;
        for (const field of ITEM_COUNTERS)
        {
            const value = system[field]?.value;
            if (typeof value === 'number' && snapshot.item.counters[field] !== null && value !== snapshot.item.counters[field])
                itemChanges[field] = value - snapshot.item.counters[field];
        }
        const freq = numericDeltas(snapshot.item.freq, freqValues(item));
        if (freq.length)
            itemChanges.freq = freq;
        if (Object.keys(itemChanges).length)
            changes.item = { id: item.id, ...itemChanges };
    }
    return Object.keys(changes).length ? changes : null;
}

export function flowChanges(flow, actor)
{
    const extra = flow?.state?.la_extraData;
    const changes = /** @type {any} */ (changesSince(extra?.undoSnapshot, actor ?? flow?.state?.actor) ?? {});
    if (extra?.removedEffects?.length)
        changes.removedEffects = extra.removedEffects;
    return Object.keys(changes).length ? changes : null;
}

export function planChangesUndo(actor, changes, effects, removed)
{
    const actorUpdate = {};
    const items = [];
    const back = [];
    if (changes?.heat)
    {
        const stress = actor.system?.stress?.value;
        if (changes.heat > 0 && changes.stressBefore !== null && changes.stressBefore !== undefined && typeof stress === 'number' && stress < changes.stressBefore)
            return { reason: 'LA.tape.undoOverheated' };
        actorUpdate['system.heat.value'] = Math.max(0, (Number(actor.system?.heat?.value) || 0) - changes.heat);
        back.push('LA.tape.back.heat');
    }
    if (changes?.overcharge)
    {
        actorUpdate['system.overcharge'] = Math.max(0, (Number(actor.system?.overcharge) || 0) - changes.overcharge);
        back.push('LA.tape.back.overcharge');
    }
    if (changes?.coreEnergy)
        actorUpdate['system.core_energy'] = changes.coreEnergy.before;
    if (changes?.coreActive)
        actorUpdate['system.core_active'] = false;
    if (changes?.coreEnergy || changes?.coreActive)
        back.push('LA.tape.back.core');
    for (const entry of ACTOR_VALUES)
    {
        if (!changes?.[entry.key])
            continue;
        actorUpdate[entry.path] = Math.max(0, (readNumber(actor, entry.path) ?? 0) - changes[entry.key]);
        back.push(entry.label);
    }
    const actorFreq = freqValues(actor);
    const actorDeltas = Array.isArray(changes?.actorFreq) ? changes.actorFreq : [];
    for (const { path, delta } of actorDeltas)
        actorUpdate[`flags.${MODULE_ID}.perFreqSub.${path}`] = Math.max(0, (Number(actorFreq[path]) || 0) - (Number(delta) || 0));
    if (actorDeltas.length)
        back.push('LA.tape.back.uses');
    for (const weaponId of changes?.reloaded ?? [])
    {
        const weapon = actor.items?.get(weaponId);
        if (weapon?.system?.loaded === true)
            items.push({ item: weapon, update: { 'system.loaded': false } });
    }
    if (changes?.reloaded?.length)
        back.push('LA.tape.back.loading');
    const item = changes?.item ? actor.items?.get(changes.item.id) : null;
    if (item)
    {
        const system = item.system ?? {};
        const itemUpdate = {};
        if (changes.item.uses)
            itemUpdate['system.uses.value'] = Math.max(0, (Number(system.uses?.value) || 0) - changes.item.uses);
        if (changes.item.charged && system.charged === false)
            itemUpdate['system.charged'] = true;
        if (changes.item.loaded && system.loaded === false)
            itemUpdate['system.loaded'] = true;
        for (const field of ITEM_COUNTERS)
        {
            if (changes.item[field])
                itemUpdate[`system.${field}.value`] = Math.max(0, (Number(system[field]?.value) || 0) - changes.item[field]);
        }
        const itemFreq = freqValues(item);
        for (const { path, delta } of (Array.isArray(changes.item.freq) ? changes.item.freq : []))
            itemUpdate[`flags.${MODULE_ID}.perFreqSub.${path}`] = Math.max(0, (Number(itemFreq[path]) || 0) - (Number(delta) || 0));
        if (Object.keys(itemUpdate).length)
        {
            items.push({ item, update: itemUpdate });
            back.push(changes.item.charged ? 'LA.tape.back.charge' : changes.item.loaded ? 'LA.tape.back.loading' : 'LA.tape.back.uses');
        }
    }
    const effectNames = [...(effects ?? []).map(effect => effect.name), ...(removed ?? []).map(effect => effect.name)].filter(Boolean);
    back.push(...[...new Set(effectNames)].map(name => CONFIG.statusEffects?.find(status => status.id === name)?.name ?? name));
    return { actorUpdate, items, back };
}

export async function removeAppliedEffects(effects)
{
    const api = game.modules.get(MODULE_ID)?.api;
    for (const effect of effects ?? [])
    {
        const target = canvas.tokens?.get(effect.targetID);
        if (target)
            await api?.removeEffectsByNameFromTokens?.({ tokens: [target], effectNames: [effect.name] });
    }
}

async function snapshotStep(state)
{
    const actor = state?.actor;
    if (!actor)
        return true;
    state.la_extraData = state.la_extraData ?? {};
    state.la_extraData.undoSnapshot = snapshotFor(actor, flowItem(state));
    if (claimFreeUse(actor))
        state.la_extraData.freeUse = true;
    return true;
}

export function registerUndoSnapshotStep(steps, flows)
{
    steps.set(SNAPSHOT_STEP, snapshotStep);
    for (const name of SNAPSHOT_FLOWS)
    {
        const flow = flows.get(name);
        if (flow?.steps?.length && !flow.steps.includes(SNAPSHOT_STEP))
            flow.insertStepBefore(flow.steps[0], SNAPSHOT_STEP);
    }
}
