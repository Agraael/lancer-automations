import { addGlobalBonus, removeGlobalBonus, getGlobalBonuses, bonusFrequencyFree, burnBonusUsageForFlow, getApplicableDefenseBonuses, consumeResistanceUse, checkEffectImmunities, getV3DefenseRows } from "../scripts/bonuses/genericBonuses.js";
import { processEffectConsumption } from "../scripts/activations/reactions-engine.js";
import { effectStack } from "../scripts/bonuses/flagged-effects.js";
import { clearGate } from "../scripts/tools/misc-tools.js";
import { evaluateV3Expression, v3ConditionMet } from "../scripts/tools/v3-condition.js";
import { executeEffectManager } from "../scripts/bonuses/effectManager.js";
import { MODULE_ID } from "../scripts/tools/constants.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const TEST_PREFIX = 'la-test-v3l-';
const TEST_ITEM_NAME = 'LA Test v3 Item';
const results = { pass: 0, fail: 0 };

function pass(name)
{
    results.pass++;
    console.log(`%c✅ PASS: ${name}`, 'color:limegreen; font-weight:bold;');
}

function fail(name, reason)
{
    results.fail++;
    console.error(`❌ FAIL: ${name} :: ${reason}`);
}

function check(name, actual, expected)
{
    const same = JSON.stringify(actual) === JSON.stringify(expected);
    if (same)
        pass(name);
    else
        fail(name, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function getToken()
{
    const token = canvas.tokens.controlled[0];
    if (token?.actor?.type !== 'mech')
    {
        console.error('v3-limits tests: select a disposable MECH token first.');
        return null;
    }
    return token;
}

function storedBonus(actor, id)
{
    return getGlobalBonuses(actor).find((/** @type {any} */ bonus) => bonus.id === id) ?? null;
}

function linkedEffect(actor, id)
{
    return actor.effects.find((/** @type {any} */ effect) => effect.getFlag(MODULE_ID, 'linkedBonusId') === id) ?? null;
}

function usageState(actor, bonus)
{
    return {
        actor,
        la_extraData: {
            bonusUsage: {
                flowType: 'attack',
                candidates: {
                    [bonus.id]: { id: bonus.id, bucket: 'acc', type: bonus.type, subtype: null, consumeOnUsage: bonus.consumeOnUsage, uses: bonus.uses, applyTo: null, frequency: bonus.frequency, frequencyCount: bonus.frequencyCount, frequencyKey: bonus.frequencyKey, context: bonus.context }
                },
                enabledById: new Map(),
                disabledByUser: new Set(),
                dmgEnabled: new Map(),
                modEnabled: null,
                appliedMode: new Map(),
                appliedTargetIds: new Map(),
                burned: new Set()
            }
        }
    };
}

async function rollWithBonus(actor, id)
{
    const bonus = storedBonus(actor, id);
    const free = bonusFrequencyFree(bonus, { actor });
    if (free)
        await burnBonusUsageForFlow(usageState(actor, bonus));
    await delay(150);
    return free;
}

function v3RowById(actor, id)
{
    return getV3DefenseRows(actor).find((/** @type {any} */ row) => row.bonus.id === id) ?? null;
}

async function setStatus(actor, statusId, active)
{
    if (actor.statuses?.has(statusId) !== active)
        await actor.toggleStatusEffect(statusId, { active });
    await delay(300);
}

async function expressions()
{
    console.log('%c── condition expressions ──', 'color:orange;');
    const pilot = { type: 'pilot', system: { level: 3, grit: 2, hp: { max: 8 } }, statuses: new Set() };
    const mech = { type: 'mech', system: { pilot: { value: pilot }, grit: 2, hp: { max: 12 }, structure: { max: 4 }, stress: { max: 4 } }, statuses: new Set(['exposed', 'dangerzone']) };
    const npc = { type: 'npc', system: { tier: 2, hp: { max: 15 } }, statuses: new Set() };
    check('{exposed} on an Exposed mech = 1', evaluateV3Expression('{exposed}', mech), 1);
    check('{exposed} on an NPC without it = 0', evaluateV3Expression('{exposed}', npc), 0);
    check('{danger_zone} uses the Lancer id dangerzone', evaluateV3Expression('{danger_zone}', mech), 1);
    check('2 + {ll} on a mech reads its pilot (LL3) = 5', evaluateV3Expression('2 + {ll}', mech), 5);
    check('({grit}/2) + 1 with grit 2 = 2', evaluateV3Expression('({grit}/2) + 1', mech), 2);
    check('{tier} * 2 - 1 on a tier 2 NPC = 3', evaluateV3Expression('{tier} * 2 - 1', npc), 3);
    check('{tier} on a mech is dropped = 0', evaluateV3Expression('{tier}', mech), 0);
    check('{ll} on an NPC is dropped = 0', evaluateV3Expression('{ll}', npc), 0);
    check('{hp} / 5 rounds up (12/5) = 3', evaluateV3Expression('{hp} / 5', mech), 3);
    check('broken expression = 0', evaluateV3Expression('((2)', mech), 0);
    check('empty condition is met', v3ConditionMet('', npc), true);
    check('{tier} - 1 on tier 2 is met', v3ConditionMet('{tier} - 1', npc), true);
}

async function effectManagerLimit(token)
{
    console.log('%c── Effect Manager Limit visibility ──', 'color:orange;');
    executeEffectManager({ actor: token.actor });
    let $type = $();
    for (let tries = 0; tries < 40 && !$type.length; tries++)
    {
        await delay(100);
        $type = $('#bonus-type');
    }
    if (!$type.length)
    {
        fail('Effect Manager opened', 'no #bonus-type found');
        return;
    }
    const shown = (type, subtype = null) =>
    {
        $type.val(type).trigger('change');
        if (subtype)
            $('#bonus-immunity-subtype').val(subtype).trigger('change');
        return $('#bonus-frequency-row')[0]?.style.display !== 'none';
    };
    for (const type of ['roll', 'damage', 'target_modifier', 'reroll', 'resistance', 'vulnerability'])
        check(`Limit shown for ${type}`, shown(type), true);
    for (const type of ['stat', 'tag', 'range', 'movement_extra'])
        check(`Limit hidden for ${type}`, shown(type), false);
    check('Limit shown for immunity: damage', shown('immunity', 'damage'), true);
    check('Limit hidden for immunity: elevation', shown('immunity', 'elevation'), false);
    $('#bonus-frequency').val('round').trigger('change');
    check('count box appears once a period is picked', $('#bonus-frequency-count')[0]?.style.display !== 'none', true);
    const app = Object.values(ui.windows).find((/** @type {any} */ win) => win.element?.find?.('#bonus-type').length);
    await /** @type {any} */ (app)?.close?.();
}

async function limitConsumeOff(token, combat)
{
    console.log('%c── limit, consume on usage OFF ──', 'color:orange;');
    const actor = token.actor;
    const id = `${TEST_PREFIX}off`;
    await addGlobalBonus(actor, { id, name: 'LA Test Limit Off', type: 'accuracy', val: 1, uses: 3, consumeOnUsage: false, frequency: 'round', frequencyCount: 2 }, { duration: 'indefinite' });
    await delay(300);
    const applied = [await rollWithBonus(actor, id), await rollWithBonus(actor, id), await rollWithBonus(actor, id)];
    check('2/round: applies on rolls 1 and 2, not 3', applied, [true, true, false]);
    check('consume on usage off: uses stay at 3', storedBonus(actor, id)?.uses, 3);
    await combat.nextRound();
    await delay(400);
    check('next round: limit free again', bonusFrequencyFree(storedBonus(actor, id), { actor }), true);
}

async function limitConsumeOn(token)
{
    console.log('%c── limit, consume on usage ON ──', 'color:orange;');
    const actor = token.actor;
    const id = `${TEST_PREFIX}on`;
    await addGlobalBonus(actor, { id, name: 'LA Test Limit On', type: 'accuracy', val: 1, uses: 3, consumeOnUsage: true, frequency: 'round', frequencyCount: 2 }, { duration: 'indefinite' });
    await delay(300);
    const applied = [await rollWithBonus(actor, id), await rollWithBonus(actor, id), await rollWithBonus(actor, id)];
    check('2/round: applies on rolls 1 and 2, not 3', applied, [true, true, false]);
    check('consume on usage on: uses 3 -> 1', storedBonus(actor, id)?.uses, 1);
}

async function limitAutoConsume(token, combat)
{
    console.log('%c── limit + Auto-consume on hit ──', 'color:orange;');
    const actor = token.actor;
    const id = `${TEST_PREFIX}auto`;
    await addGlobalBonus(actor, { id, name: 'LA Test Limit Auto', type: 'accuracy', val: 1, uses: 3, consumeOnUsage: false, frequency: 'round' }, { duration: 'indefinite', consumption: { trigger: 'onHit' } });
    await delay(400);
    const effect = () => linkedEffect(actor, id);
    if (!effect())
    {
        fail('auto-consume bonus has a linked effect', 'no linked effect found');
        return;
    }
    await burnBonusUsageForFlow(usageState(actor, storedBonus(actor, id)));
    await delay(150);
    check('applying to a roll does not count the limit (auto-consume set)', bonusFrequencyFree(storedBonus(actor, id), { actor }), true);
    const start = effectStack(effect());
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('first hit spends 1 use', effectStack(effect()), start - 1);
    check('first hit fills the 1/round limit', bonusFrequencyFree(storedBonus(actor, id), { actor }), false);
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('second hit in the same round spends nothing', effectStack(effect()), start - 1);
    await combat.nextRound();
    await delay(400);
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('next round: a hit spends a use again', effectStack(effect()), start - 2);
}

async function limitMission(token, combat)
{
    console.log('%c── limit per mission ──', 'color:orange;');
    const actor = token.actor;
    const id = `${TEST_PREFIX}mission`;
    await addGlobalBonus(actor, { id, name: 'LA Test Limit Mission', type: 'accuracy', val: 1, frequency: 'mission' }, { duration: 'indefinite' });
    await delay(300);
    check('1/mission: first roll applies', await rollWithBonus(actor, id), true);
    check('1/mission: second roll does not', await rollWithBonus(actor, id), false);
    await combat.nextRound();
    await delay(400);
    check('a new round does not reset a mission limit', bonusFrequencyFree(storedBonus(actor, id), { actor }), false);
    const step = game.lancer?.flowSteps?.get('lancer-automations:resetBonusMissionUses');
    if (!step)
    {
        fail('Full Repair reset step registered', 'step lancer-automations:resetBonusMissionUses missing');
        return;
    }
    await step({ actor });
    await delay(300);
    check('Full Repair resets the mission limit', bonusFrequencyFree(storedBonus(actor, id), { actor }), true);
}

async function limitResistance(token)
{
    console.log('%c── limit on a resistance ──', 'color:orange;');
    const actor = token.actor;
    const id = `${TEST_PREFIX}resist`;
    await addGlobalBonus(actor, { id, name: 'LA Test Resist Limit', type: 'resistance', damageTypes: ['Kinetic'], frequency: 'round' }, { duration: 'indefinite' });
    await delay(300);
    const state = { actor, data: {}, la_extraData: {} };
    const applicable = () => getApplicableDefenseBonuses(actor, 'resistance', state, { ownerTokenId: token.id }).some((/** @type {any} */ bonus) => bonus.id === id);
    check('1/round resistance: applies to the first kinetic hit', applicable(), true);
    await consumeResistanceUse(actor, state, { damageTypes: ['Kinetic'], bonuses: getApplicableDefenseBonuses(actor, 'resistance', state, { ownerTokenId: token.id }) });
    await delay(300);
    check('1/round resistance: not on the second hit that round', applicable(), false);
}

function v3Entries()
{
    return [
        { path: 'active_effects.0', data: { bonuses: [{ id: 'immunity', val: ['prone'] }] } },
        { path: 'active_effects.1', data: { bonuses: [{ id: 'resistance', val: 'all' }] } },
        { path: 'active_effects.2', data: { add_resist: [{ resistance: 'kinetic', target: 'self' }], frequency: '1/round' } },
        { path: 'active_effects.3', data: { add_resist: [{ resistance: 'energy', target: 'self' }], duration: 'next_turn_end_self' } },
        { path: 'core_system.active_effects.0', data: { add_resist: [{ resistance: 'explosive', target: 'self' }] } },
        { path: 'active_effects.5', data: { bonuses: [{ id: 'immunity', val: ['slow'], condition: '{exposed}' }] } }
    ];
}

async function createV3Item(actor)
{
    const [item] = await actor.createEmbeddedDocuments('Item', [{
        name: TEST_ITEM_NAME,
        type: 'mech_system',
        flags: { 'lancer-npc-import': { v3: { pack: 'la-test', entries: v3Entries() } } }
    }]);
    await delay(300);
    return item;
}

async function v3Rows(token, item)
{
    console.log('%c── v3 data rows ──', 'color:orange;');
    const actor = token.actor;
    const rowId = (path, suffix = '') => `v3_${item.id}_${path.replace(/\./g, '_')}${suffix}`;
    const prone = v3RowById(actor, rowId('active_effects.0', '_b0'));
    check('Bonus {id: immunity, val: [prone]} -> effect immunity', prone ? { type: prone.bonus.type, subtype: prone.bonus.subtype, effects: prone.bonus.effects } : null, { type: 'immunity', subtype: 'effect', effects: ['prone'] });
    check('the token is immune to Prone', checkEffectImmunities(actor, 'prone').length > 0, true);
    const all = v3RowById(actor, rowId('active_effects.1', '_b0'));
    check('Bonus {id: resistance, val: all} -> Resistance All', all ? { type: all.bonus.type, damageTypes: all.bonus.damageTypes } : null, { type: 'resistance', damageTypes: ['All'] });
    const kinetic = v3RowById(actor, rowId('active_effects.2'));
    check('frequency 1/round -> Limit once per round', kinetic ? { frequency: kinetic.bonus.frequency, frequencyCount: kinetic.bonus.frequencyCount ?? 1 } : null, { frequency: 'round', frequencyCount: 1 });
    check('an effect with a duration is not always-on', v3RowById(actor, rowId('active_effects.3')), null);
    check('the source line names the item', kinetic?.bonus?.dataSource?.name, TEST_ITEM_NAME);
    const state = { actor, data: {}, la_extraData: {} };
    const kineticApplies = () => getApplicableDefenseBonuses(actor, 'resistance', state, { ownerTokenId: token.id }).some((/** @type {any} */ bonus) => bonus.id === kinetic?.bonus.id);
    check('the 1/round data resistance applies to a first hit', kineticApplies(), true);
    await consumeResistanceUse(actor, state, { damageTypes: ['Kinetic'], bonuses: getApplicableDefenseBonuses(actor, 'resistance', state, { ownerTokenId: token.id }) });
    await delay(300);
    check('and not to a second hit that round', kineticApplies(), false);
}

async function v3TimedApplied(token, item)
{
    console.log('%c── v3 duration: applied at combat start ──', 'color:orange;');
    const timed = storedBonus(token.actor, `v3_${item.id}_active_effects_3_timed`);
    check('combat start adds the timed resistance', timed ? { type: timed.type, damageTypes: timed.damageTypes } : null, { type: 'resistance', damageTypes: ['Energy'] });
    check('the timed bonus keeps its source', timed?.dataSource?.name, TEST_ITEM_NAME);
}

async function v3TimedExpired(token, item)
{
    console.log('%c── v3 duration: ended ──', 'color:orange;');
    check('"end of your next turn" has ended after two turns (timing)', storedBonus(token.actor, `v3_${item.id}_active_effects_3_timed`), null);
}

async function v3Condition(token, item)
{
    console.log('%c── v3 condition {exposed} ──', 'color:orange;');
    const actor = token.actor;
    const id = `v3_${item.id}_active_effects_5_b0`;
    await setStatus(actor, 'exposed', false);
    check('not Exposed: the row is inactive', v3RowById(actor, id)?.inactive, true);
    check('not Exposed: no Slow immunity', checkEffectImmunities(actor, 'slow').length > 0, false);
    await setStatus(actor, 'exposed', true);
    check('Exposed: the row is active', v3RowById(actor, id)?.inactive, false);
    check('Exposed: immune to Slow', checkEffectImmunities(actor, 'slow').length > 0, true);
    await setStatus(actor, 'exposed', false);
}

async function coreActive(token, item)
{
    console.log('%c── core active and its status ──', 'color:orange;');
    const actor = token.actor;
    const coreRow = () => (item ? v3RowById(actor, `v3_${item.id}_core_system_active_effects_0`) : null);
    await actor.update({ 'system.core_active': false });
    await delay(400);
    if (item)
        check('core active off: no core active data row', coreRow(), null);
    await actor.update({ 'system.core_active': true });
    await delay(500);
    check('core_active on -> Core Power Active status appears', actor.statuses.has('core_power_active'), true);
    if (item)
        check('core active on: the core active data row appears', !!coreRow(), true);
    await setStatus(actor, 'core_power_active', false);
    await delay(300);
    check('status removed -> core_active off', actor.system.core_active, false);
    await setStatus(actor, 'core_power_active', true);
    await delay(300);
    check('status added -> core_active on', actor.system.core_active, true);
    await actor.update({ 'system.core_active': false, 'system.core_energy': 1 });
    await delay(500);
    check('Full Repair reset (core_active false) removes the status', actor.statuses.has('core_power_active'), false);

    const frame = actor.items.find((/** @type {any} */ owned) => owned.type === 'frame');
    if (!frame)
    {
        console.warn('core power flow skipped: the mech has no frame');
        return;
    }
    await Promise.race([/** @type {any} */ (frame).beginCoreActiveFlow('system.core_system'), delay(6000)]);
    await delay(800);
    check('using the core power -> status on', actor.statuses.has('core_power_active'), true);
    check('using the core power -> core_active on', actor.system.core_active, true);
}

async function coreActiveCombatEnd(token, combat)
{
    console.log('%c── core active ends with the encounter ──', 'color:orange;');
    const actor = token.actor;
    await actor.update({ 'system.core_active': true });
    await delay(500);
    await combat.delete();
    await delay(800);
    check('combat deleted -> status off', actor.statuses.has('core_power_active'), false);
    check('combat deleted -> core_active off', actor.system.core_active, false);
}

async function cleanup(token, item, snapshot)
{
    const actor = token.actor;
    for (const bonus of getGlobalBonuses(actor).filter((/** @type {any} */ entry) => String(entry.id).startsWith(TEST_PREFIX) || (item && String(entry.id).startsWith(`v3_${item.id}_`))))
    {
        await removeGlobalBonus(actor, bonus.id);
        await clearGate(token, `bonus:${bonus.id}`);
    }
    for (const suffix of ['off', 'on', 'auto', 'mission', 'resist'])
        await clearGate(token, `bonus:${TEST_PREFIX}${suffix}`);
    if (item)
        await clearGate(token, `bonus:v3_${item.id}_active_effects_2`);
    const missionKeys = Object.keys(actor.getFlag(MODULE_ID, 'bonusMissionUses') ?? {}).filter(key => key.startsWith(TEST_PREFIX));
    if (missionKeys.length)
        await actor.update(Object.fromEntries(missionKeys.map(key => [`flags.${MODULE_ID}.bonusMissionUses.-=${key}`, null])));
    if (item && actor.items.get(item.id))
        await actor.deleteEmbeddedDocuments('Item', [item.id]);
    await setStatus(actor, 'exposed', snapshot.exposed);
    await actor.update({ 'system.core_active': snapshot.coreActive, 'system.core_energy': snapshot.coreEnergy });
    await delay(300);
}

async function runAll()
{
    const token = getToken();
    if (!token)
        return;
    if (game.combat)
    {
        console.error('v3-limits tests: end or delete the current combat first (the suite creates and deletes its own).');
        return;
    }
    results.pass = 0;
    results.fail = 0;
    const actor = token.actor;
    const snapshot = { exposed: actor.statuses.has('exposed'), coreActive: !!actor.system.core_active, coreEnergy: actor.system.core_energy ?? 1 };
    const hasNpcImport = !!(/** @type {any} */ (game.modules.get('lancer-npc-import'))?.api?.getV3Data);
    console.log(`%cv3 + limits suite on ${token.name}`, 'color:gold; font-weight:bold;');
    let item = null;
    let combat = null;
    const run = async (section, ...args) =>
    {
        try
        {
            await section(...args);
        }
        catch (error)
        {
            fail(section.name, error?.message ?? error);
        }
    };
    try
    {
        await run(expressions);
        await run(effectManagerLimit, token);
        if (hasNpcImport)
            item = await createV3Item(actor);
        else
            console.warn('lancer-npc-import is not active: v3 data sections skipped');
        combat = await Combat.create({ scene: canvas.scene.id, active: true });
        await combat.createEmbeddedDocuments('Combatant', [{ tokenId: token.id, sceneId: canvas.scene.id, actorId: actor.id }]);
        await combat.startCombat();
        await delay(1200);
        if (item)
            await run(v3TimedApplied, token, item);
        await run(limitConsumeOff, token, combat);
        await run(limitConsumeOn, token);
        await run(limitAutoConsume, token, combat);
        await run(limitMission, token, combat);
        await run(limitResistance, token);
        if (item)
        {
            await run(v3TimedExpired, token, item);
            await run(v3Rows, token, item);
            await run(v3Condition, token, item);
        }
        await run(coreActive, token, item);
        await run(coreActiveCombatEnd, token, combat);
    }
    finally
    {
        if (combat && game.combats.get(combat.id))
            await combat.delete();
        await cleanup(token, item, snapshot);
    }
    const color = results.fail ? 'color:red; font-weight:bold;' : 'color:gold; font-weight:bold;';
    console.log(`%cv3 + limits suite done: ${results.pass} passed, ${results.fail} failed`, color);
}

export const V3LimitsTests = { expressions, effectManagerLimit, runAll };
