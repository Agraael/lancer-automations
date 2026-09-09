/**
 * Structure / Stress outcome matrix
 * Run via:  api.tests.structStress.runAll()  with a DISPOSABLE mech/npc token selected
 * (effects are wiped and hp/structure/stress restored, but do not use a live PC).
 * Both rulesets are tested regardless of the enableAltStruct setting: the handlers
 * are called directly, only the flow wiring differs per mode.
 * Live meltdown cases (chat card, FX, reactor_meltdown status) are opt-in:
 *   api.tests.structStress.meltdownLive()
 *
 * Globals: game, canvas
 */

import { applyStructureEffects, insertHullCheckButton, insertSecondaryRollButton, handleDirectHitHullCheckResult, handleCrushingHitHullCheckResult, destroyTraumaChoice, getValidWeaponMounts, getValidSystems, hasUniquePhysiology } from "../scripts/alt-struct/structure.js";
import { applyStressEffects, insertEngineeringCheckButton, handleStressEngineeringCheckResult } from "../scripts/alt-struct/stress.js";
import { baseApplyStructureEffects, baseInsertHullCheckButton, baseHandleHullCheckResult, baseApplyStressEffects, baseInsertEngCheckButton, baseHandleEngCheckResult, baseHandleNoStressRemaining } from "../scripts/alt-struct/base-rules.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const STATUS_IDS = ['slow', 'impaired', 'stunned', 'immobilized', 'exposed', 'throttled', 'dazed', 'reactor_meltdown'];

function pass(name)
{
    console.log(`%c✅ PASS: ${name}`, 'color:limegreen; font-weight:bold;');
}

function fail(name, reason)
{
    console.error(`❌ FAIL: ${name} :: ${reason}`);
}

function assert(condition, name, reason)
{
    if (condition)
        pass(name);
    else
        fail(name, reason ?? 'condition false');
}

function getApi()
{
    return /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
}

function getToken()
{
    const token = canvas.tokens.controlled[0];
    if (!token?.actor || (!token.actor.is_mech?.() && !token.actor.is_npc?.()))
    {
        console.error('struct-stress tests: select a disposable mech or npc token first.');
        return null;
    }
    return token;
}

// kl1 pools keep the lowest die
/** @returns {any} */
function forge(actor, dice, extra = {})
{
    const total = Math.min(...dice);
    return {
        actor,
        data: {
            result: { roll: { total, terms: [{ results: dice.map(value => ({ result: value })) }] } },
            ...extra
        }
    };
}

function hasStatus(token, id)
{
    return token.actor.effects.some(effect => effect.statuses?.has(id) || effect.name?.toLowerCase() === id.toLowerCase());
}

function noStatuses(token)
{
    return STATUS_IDS.every(id => !hasStatus(token, id));
}

async function wipe(token)
{
    await getApi()?.deleteAllEffects?.([token]);
    await delay(100);
}

function snapshot(actor)
{
    return {
        'system.hp.value': actor.system.hp.value,
        'system.structure.value': actor.system.structure.value,
        'system.stress.value': actor.system.stress.value,
        'system.heat.value': actor.system.heat.value
    };
}

async function restore(actor, snap)
{
    await actor.update(snap);
}

async function setStructure(actor, value)
{
    await actor.update({ 'system.structure.value': value });
}

async function setStress(actor, value)
{
    await actor.update({ 'system.stress.value': value });
}

// destroy-path cases zero structure, which would wreck and replace the test token
async function withWrecksSuppressed(fn)
{
    const prev = game.settings.get('lancer-automations', 'enableWrecks');
    if (prev)
        await game.settings.set('lancer-automations', 'enableWrecks', false);
    try
    {
        await fn();
    }
    finally
    {
        if (prev)
            await game.settings.set('lancer-automations', 'enableWrecks', true);
    }
}

function makeStubItem(name, indestructible = false)
{
    const calls = [];
    return {
        name,
        system: { tags: indestructible ? [{ lid: 'tg_indestructible' }] : [] },
        update: async (data) => calls.push(data),
        _calls: calls
    };
}

// ─── Alt structure ───

async function altStructureEffects()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: applyStructureEffects ──', 'color:cyan;');

    await applyStructureEffects(forge(token.actor, [1], { remStruct: 3 }));
    await delay(100);
    assert(hasStatus(token, 'slow') && hasStatus(token, 'impaired'), 'alt struct roll 1 rem 3 = slow + impaired');
    await wipe(token);

    await applyStructureEffects(forge(token.actor, [5], { remStruct: 3 }));
    await delay(100);
    assert(hasStatus(token, 'impaired') && !hasStatus(token, 'slow'), 'alt struct roll 5 = impaired only');
    await wipe(token);

    await applyStructureEffects(forge(token.actor, [3], { remStruct: 3 }));
    await delay(100);
    assert(noStatuses(token), 'alt struct roll 3 = no status (tear off handles it)');
    await wipe(token);
}

async function altButtons()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: card buttons ──', 'color:cyan;');

    let state = forge(token.actor, [1], { remStruct: 2 });
    await insertHullCheckButton(state);
    assert(state.data.embedButtons?.[0]?.includes('DirectHitHullCheckFlow'), 'alt roll 1 rem 2 = direct hit HULL button');

    state = forge(token.actor, [1, 1], { remStruct: 2 });
    await insertHullCheckButton(state);
    assert(state.data.embedButtons?.[0]?.includes('CrushingHitHullCheckFlow'), 'alt multiple 1s = crushing hit HULL button');

    state = forge(token.actor, [3], { remStruct: 3 });
    await insertHullCheckButton(state);
    assert(!state.data.embedButtons?.length, 'alt roll 3 = no HULL button');

    const hasItems = getValidWeaponMounts(token.actor).length > 0 || getValidSystems(token.actor).length > 0;
    state = forge(token.actor, [3], { remStruct: 3 });
    await insertSecondaryRollButton(state);
    const expected = hasItems ? 'secondaryStructureDirectHit' : 'TearOffDirectHitFlow';
    assert(state.data.embedButtons?.[0]?.includes(expected), `alt roll 3 = ${expected} button`);

    state = forge(token.actor, [1], { remStress: 2 });
    await insertEngineeringCheckButton(state);
    assert(state.data.embedButtons?.[0]?.includes('StressEngineeringCheckFlow'), 'alt stress roll 1 = ENG button');

    state = forge(token.actor, [1, 1], { remStress: 2 });
    await insertEngineeringCheckButton(state);
    assert(!state.data.embedButtons?.length, 'alt stress multiple 1s = no ENG button');
}

async function altDirectHitCheck()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: handleDirectHitHullCheckResult ──', 'color:cyan;');
    const snap = snapshot(token.actor);
    const hasItems = getValidWeaponMounts(token.actor).length > 0 || getValidSystems(token.actor).length > 0;

    await setStructure(token.actor, 2);
    let outcome = await handleDirectHitHullCheckResult(token.actor, true);
    await delay(100);
    assert(hasStatus(token, 'slow') && hasStatus(token, 'impaired'), 'alt DH rem 2 pass = slow + impaired');
    assert(outcome?.description?.includes('passed'), 'alt DH rem 2 pass = outcome card text');
    await wipe(token);

    outcome = await handleDirectHitHullCheckResult(token.actor, false);
    await delay(100);
    if (hasItems)
    {
        assert(hasStatus(token, 'immobilized') && hasStatus(token, 'impaired'), 'alt DH rem 2 fail = immobilized + impaired');
        assert(outcome?.description?.includes('TEAR OFF'), 'alt DH rem 2 fail = tear off button');
    }
    else
        assert(outcome?.description?.includes('CRUSHING HIT'), 'alt DH rem 2 fail no items = crushing hit button');
    await wipe(token);

    await setStructure(token.actor, 1);
    outcome = await handleDirectHitHullCheckResult(token.actor, false);
    await delay(100);
    if (hasItems)
    {
        assert(hasStatus(token, 'stunned'), 'alt DH rem 1 fail = stunned');
        assert(outcome?.description?.includes('TEAR OFF'), 'alt DH rem 1 fail = tear off button');
    }
    else
        assert(outcome?.description?.includes('CRUSHING HIT'), 'alt DH rem 1 no items = crushing hit button');
    await wipe(token);
    await restore(token.actor, snap);
}

async function altCrushingCheck()
{
    await withWrecksSuppressed(_altCrushingCheckBody);
}

async function _altCrushingCheckBody()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: handleCrushingHitHullCheckResult ──', 'color:cyan;');
    const snap = snapshot(token.actor);

    let outcome = await handleCrushingHitHullCheckResult(token.actor, true);
    await delay(100);
    assert(hasStatus(token, 'dazed'), 'alt crushing pass = dazed');
    assert(outcome?.description?.includes('passed'), 'alt crushing pass = outcome text');
    await wipe(token);

    outcome = await handleCrushingHitHullCheckResult(token.actor, false);
    await delay(100);
    assert(token.actor.system.structure.value === 0 && token.actor.system.hp.value <= 0, 'alt crushing fail = destroyed');
    assert(outcome?.description?.includes('DESTROYED'), 'alt crushing fail = outcome text');
    await restore(token.actor, snap);
    await wipe(token);
}

// ─── Alt stress ───

async function altStressEffects()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: applyStressEffects ──', 'color:cyan;');

    await applyStressEffects(forge(token.actor, [3], { remStress: 3 }));
    await delay(100);
    assert(hasStatus(token, 'slow') && hasStatus(token, 'throttled'), 'alt stress roll 3 = slow + throttled');
    await wipe(token);

    await applyStressEffects(forge(token.actor, [5], { remStress: 3 }));
    await delay(100);
    assert(hasStatus(token, 'impaired'), 'alt stress roll 5 = impaired');
    await wipe(token);

    const state = forge(token.actor, [1, 1], { remStress: 2 });
    await applyStressEffects(state);
    await delay(100);
    assert(hasStatus(token, 'exposed') && hasStatus(token, 'throttled'), 'alt stress multiple 1s = exposed + throttled');
    const exposedEffect = /** @type {any} */ (token.actor).effects.find(effect => effect.statuses?.has('exposed'));
    assert(exposedEffect?.flags?.['lancer-automations']?.duration?.label !== 'end', 'alt multiple 1s exposed has no turn duration');
    assert(state.data.embedButtons?.[0]?.includes('CriticalMeltdownFlow'), 'alt multiple 1s = critical meltdown button');
    await wipe(token);

    await applyStressEffects(forge(token.actor, [1], { remStress: 1 }));
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'alt stress roll 1 rem 1 = exposed up front');
    await wipe(token);

    await applyStressEffects(forge(token.actor, [1], { remStress: 2 }));
    await delay(100);
    assert(noStatuses(token), 'alt stress roll 1 rem 2 = nothing before the ENG check');
    await wipe(token);
}

async function altEngCheck()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── alt: handleStressEngineeringCheckResult ──', 'color:cyan;');
    const snap = snapshot(token.actor);

    await setStress(token.actor, 3);
    await handleStressEngineeringCheckResult(token.actor, true);
    await delay(100);
    assert(hasStatus(token, 'slow') && hasStatus(token, 'throttled'), 'alt ENG rem 3 pass = slow + throttled');
    await wipe(token);

    await handleStressEngineeringCheckResult(token.actor, false);
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'alt ENG rem 3 fail = exposed');
    await wipe(token);

    await setStress(token.actor, 2);
    const outcomeRem2 = await handleStressEngineeringCheckResult(token.actor, false);
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'alt ENG rem 2 fail = exposed');
    assert(outcomeRem2?.description?.includes('MeltdownFlow'), 'alt ENG rem 2 fail = meltdown button');
    await wipe(token);

    await setStress(token.actor, 1);
    await handleStressEngineeringCheckResult(token.actor, true);
    await delay(100);
    assert(hasStatus(token, 'throttled') && !hasStatus(token, 'slow'), 'alt ENG rem 1 pass = throttled only');
    await wipe(token);

    const outcomeRem1 = await handleStressEngineeringCheckResult(token.actor, false);
    await delay(100);
    assert(!hasStatus(token, 'exposed') && outcomeRem1?.description?.includes('MeltdownFlow'), 'alt ENG rem 1 fail = meltdown button only');
    await wipe(token);
    await restore(token.actor, snap);
}

// ─── Base rules ───

async function baseStructure()
{
    await withWrecksSuppressed(_baseStructureBody);
}

async function _baseStructureBody()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── base: structure ──', 'color:cyan;');
    const snap = snapshot(token.actor);
    if (hasUniquePhysiology(token.actor))
        console.warn('struct-stress: monstrosity actor, standard-table assertions skipped');
    else
    {
        await baseApplyStructureEffects(forge(token.actor, [1], { remStruct: 3 }));
        await delay(100);
        assert(hasStatus(token, 'stunned'), 'base struct roll 1 rem 3 = stunned');
        await wipe(token);

        await baseApplyStructureEffects(forge(token.actor, [5], { remStruct: 3 }));
        await delay(100);
        assert(hasStatus(token, 'impaired'), 'base struct roll 5 = impaired');
        await wipe(token);

        await baseApplyStructureEffects(forge(token.actor, [3], { remStruct: 3 }));
        await delay(100);
        assert(noStatuses(token), 'base struct roll 3 = no status');
        await wipe(token);

        await baseApplyStructureEffects(forge(token.actor, [1, 1], { remStruct: 3 }));
        await delay(100);
        assert(noStatuses(token), 'base struct multiple 1s = no status (system destroys)');
        await wipe(token);
    }

    let state = forge(token.actor, [1], { remStruct: 2 });
    await baseInsertHullCheckButton(state);
    assert(state.data.embedButtons?.[0]?.includes('BaseStructureHullCheckFlow'), 'base roll 1 rem 2 = HULL button');

    state = forge(token.actor, [1], { remStruct: 3 });
    await baseInsertHullCheckButton(state);
    assert(!state.data.embedButtons?.length, 'base roll 1 rem 3 = no HULL button');

    state = forge(token.actor, [1, 1], { remStruct: 2 });
    await baseInsertHullCheckButton(state);
    assert(!state.data.embedButtons?.length, 'base multiple 1s = no HULL button');

    let outcome = await baseHandleHullCheckResult(token.actor, true);
    await delay(100);
    if (hasUniquePhysiology(token.actor))
        assert(!hasStatus(token, 'stunned') && outcome?.description?.includes('passed'), 'base HULL pass (monstrosity) = nothing applied');
    else
        assert(hasStatus(token, 'stunned'), 'base HULL pass = stunned');
    await wipe(token);

    outcome = await baseHandleHullCheckResult(token.actor, false);
    await delay(100);
    assert(token.actor.system.structure.value === 0 && outcome?.description?.includes('DESTROYED'), 'base HULL fail = destroyed');
    await restore(token.actor, snap);
    await wipe(token);
}

async function baseStress()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── base: stress (meltdown cases are in meltdownLive) ──', 'color:cyan;');

    await baseApplyStressEffects(forge(token.actor, [3], { remStress: 3 }));
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'base stress roll 3 = exposed');
    await wipe(token);

    await baseApplyStressEffects(forge(token.actor, [5], { remStress: 3 }));
    await delay(100);
    assert(hasStatus(token, 'impaired'), 'base stress roll 5 = impaired');
    await wipe(token);

    await baseApplyStressEffects(forge(token.actor, [1], { remStress: 3 }));
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'base stress roll 1 rem 3 = exposed');
    await wipe(token);

    await baseApplyStressEffects(forge(token.actor, [1], { remStress: 2 }));
    await delay(100);
    assert(noStatuses(token), 'base stress roll 1 rem 2 = nothing before the ENG check');
    await wipe(token);

    let state = forge(token.actor, [1], { remStress: 2 });
    await baseInsertEngCheckButton(state);
    assert(state.data.embedButtons?.[0]?.includes('BaseStressEngCheckFlow'), 'base roll 1 rem 2 = ENG button');

    state = forge(token.actor, [1], { remStress: 3 });
    await baseInsertEngCheckButton(state);
    assert(!state.data.embedButtons?.length, 'base roll 1 rem 3 = no ENG button');

    await baseHandleEngCheckResult(token.actor, true);
    await delay(100);
    assert(hasStatus(token, 'exposed'), 'base ENG pass = exposed');
    await wipe(token);

    const outcome = await baseHandleEngCheckResult(token.actor, false);
    await delay(100);
    assert(!hasStatus(token, 'exposed'), 'base ENG fail = no status');
    assert(outcome?.description?.includes('MeltdownFlow') && outcome?.description?.includes('1d6'), 'base ENG fail = 1d6 meltdown button');
    await wipe(token);
}

// ─── Destruction ───

async function destroyTrauma()
{
    console.log('%c── destroyTraumaChoice (stubs, nothing real touched) ──', 'color:cyan;');

    const gun = makeStubItem('Stub Gun');
    const relic = makeStubItem('Stub Relic', true);
    let destroyed = await destroyTraumaChoice({ type: 'mount', mount: { name: 'Stub Mount', weapons: [gun, relic] } });
    assert(destroyed.length === 1 && destroyed[0] === 'Stub Gun', 'mount destroys only destructible weapons');
    assert(gun._calls.length === 1 && relic._calls.length === 0, 'indestructible weapon untouched');

    const sys = makeStubItem('Stub System');
    destroyed = await destroyTraumaChoice({ type: 'system', system: sys });
    assert(destroyed[0] === 'Stub System' && sys._calls.length === 1, 'system destroyed');

    destroyed = await destroyTraumaChoice({ type: 'mount', mount: { name: 'Locked', weapons: [makeStubItem('A', true)] } });
    assert(destroyed.length === 0, 'all-indestructible mount destroys nothing');
}

// ─── Live meltdowns (chat card, FX, reactor_meltdown status) ───

async function meltdownLive()
{
    const token = getToken();
    if (!token)
        return;
    console.log('%c── LIVE meltdown cases ──', 'color:orange;');
    const snap = snapshot(token.actor);

    await baseApplyStressEffects(forge(token.actor, [1, 1], { remStress: 2 }));
    await delay(600);
    assert(hasStatus(token, 'reactor_meltdown'), 'base stress multiple 1s = meltdown started');
    await wipe(token);

    await baseApplyStressEffects(forge(token.actor, [1], { remStress: 1 }));
    await delay(600);
    assert(hasStatus(token, 'reactor_meltdown'), 'base stress roll 1 rem 1 = meltdown started');
    await wipe(token);

    await baseHandleNoStressRemaining({ actor: token.actor, data: { remStress: 0 } });
    await delay(600);
    if (token.actor.is_npc?.() && token.actor.system.stress.max === 1)
        assert(hasStatus(token, 'exposed'), 'base 1-stress npc = exposed');
    else
        assert(hasStatus(token, 'reactor_meltdown'), 'base 0 stress = irreversible meltdown');
    await wipe(token);
    await restore(token.actor, snap);
}

async function runAll()
{
    const token = getToken();
    if (!token)
        return;
    console.log(`%cstruct-stress matrix on ${token.name}`, 'color:gold; font-weight:bold;');
    await wipe(token);

    const sections = [altStructureEffects, altButtons, altDirectHitCheck, altCrushingCheck, altStressEffects, altEngCheck, baseStructure, baseStress, destroyTrauma];
    for (const section of sections)
    {
        try
        {
            await section();
        }
        catch (error)
        {
            fail(section.name, error?.message ?? error);
        }
    }

    console.log('%cstruct-stress matrix complete (run meltdownLive() for the noisy cases)', 'color:gold; font-weight:bold;');
}

export const StructStressTests = { altStructureEffects, altButtons, altDirectHitCheck, altCrushingCheck, altStressEffects, altEngCheck, baseStructure, baseStress, destroyTrauma, meltdownLive, runAll };
