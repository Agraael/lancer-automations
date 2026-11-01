import { addConstantBonus, removeConstantBonus, getConstantBonuses, setItemBonusOff, isItemBonusOff, addGlobalBonus, removeGlobalBonus, getGlobalBonuses, bonusFrequencyFree, burnBonusUsageForFlow, getApplicableDefenseBonuses, consumeResistanceUse, checkEffectImmunities, getV3DefenseRows, getFlowTags, isBonusApplicable, linkedBonusOf, resolveDamageBonus, linkBonusToItem, unlinkBonusFromItem, itemAttachmentOrigin, resolveStatValue, statBonusValueText, applyTagBonus, mutateRangeWithBonus } from "../scripts/bonuses/genericBonuses.js";
import { v3DataRows, replaceV3Data, restoreV3Data, isV3DataReplaced } from "../scripts/tools/v3-data.js";
import { getLAFlags } from "../scripts/tools/flag-utils.js";
import { processEffectConsumption, reactionRunsOnToken, isPilotToken } from "../scripts/activations/reactions-engine.js";
import { effectStack, linkEffectToItem, unlinkEffectFromItem } from "../scripts/bonuses/flagged-effects.js";
import { clearGate, executeSimpleActivation, consumeReaction, modifyAction } from "../scripts/tools/misc-tools.js";
import { actionExtrasLeft, actionCounts } from "../scripts/combat/action-extras.js";
import { onCombatClock } from "../scripts/bonuses/duration-clock.js";
import { getPerTurnLimitFromSub, getPerRoundLimitFromSub, getPerSceneLimitFromSub, getSubUsed, traitSubKey, rankSubKey, actionSubKey, isPerFrequencyEnabled } from "../scripts/combat/per-frequency-tags.js";
import { evaluateV3Expression, v3ConditionMet } from "../scripts/tools/v3-condition.js";
import { executeEffectManager } from "../scripts/bonuses/effectManager.js";
import { MODULE_ID } from "../scripts/tools/constants.js";
import { itemAttachmentChips } from "../scripts/bonuses/status-tooltip.js";

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

async function runsOn()
{
    console.log('%c── automation runs on mech / pilot ──', 'color:orange;');
    const mechToken = { actor: { type: 'mech' } };
    const pilotToken = { actor: { type: 'pilot' } };
    const talent = { type: 'talent' };
    const system = { type: 'mech_system' };
    check('isPilotToken on a pilot', isPilotToken(pilotToken), true);
    check('isPilotToken on a mech', isPilotToken(mechToken), false);
    check('talent, default: runs on the mech', reactionRunsOnToken({}, mechToken, talent), true);
    check('talent, default: not on the pilot token', reactionRunsOnToken({}, pilotToken, talent), false);
    check('talent, runsOn pilot: pilot token only', [reactionRunsOnToken({ runsOn: 'pilot' }, mechToken, talent), reactionRunsOnToken({ runsOn: 'pilot' }, pilotToken, talent)], [false, true]);
    check('talent, runsOn both: both tokens', [reactionRunsOnToken({ runsOn: 'both' }, mechToken, talent), reactionRunsOnToken({ runsOn: 'both' }, pilotToken, talent)], [true, true]);
    check('mech items ignore runsOn', reactionRunsOnToken({ runsOn: 'pilot' }, mechToken, system), true);
}

async function flowTags()
{
    console.log('%c── roll tags: saves, checks, grapple, basic melee ──', 'color:orange;');
    const has = (tags, names) => names.map(name => tags.has(name));
    const save = getFlowTags('stat_roll', { data: { path: 'system.hull' }, la_extraData: { rollTypes: ['save'] } });
    check('a Hull save: save, hull, hull_save, no hull_check', has(save, ['save', 'hull', 'hull_save', 'hull_check']), [true, true, true, false]);
    const hullCheck = getFlowTags('stat_roll', { data: { path: 'system.hull' } });
    check('a Hull check: hull_check, no save', has(hullCheck, ['hull_check', 'save', 'check']), [true, false, true]);
    const grapple = getFlowTags('attack', { data: { attack_type: 'Melee' }, la_extraData: { rollTypes: ['grapple'] } });
    check('Grapple: attack, melee, grapple', has(grapple, ['attack', 'melee', 'grapple']), [true, true, true]);
}

function fakeV3Item(type, entries)
{
    const id = `${TEST_PREFIX}${type}`;
    return { id, uuid: `Item.${id}`, name: id, type, system: { curr_rank: 3 }, flags: { 'lancer-npc-import': { v3: { pack: 'la-test', entries } } } };
}

async function pilotSplit()
{
    console.log('%c── v3 data: mech vs pilot ──', 'color:orange;');
    const selfResist = (type, flags = {}) => ({ add_resist: [{ resistance: type, target: 'self' }], ...flags });
    const talent = fakeV3Item('talent', [
        { path: 'ranks.0.active_effects.0', data: selfResist('kinetic') },
        { path: 'ranks.0.active_effects.1', data: selfResist('energy', { pilot: true }) },
        { path: 'ranks.0.bonuses.0', data: { bonuses: [{ id: 'immunity', val: ['prone'] }] } }
    ]);
    const coreBonus = fakeV3Item('core_bonus', [{ path: 'active_effects.0', data: selfResist('explosive') }]);
    const reserve = fakeV3Item('reserve', [{ path: 'active_effects.0', data: selfResist('heat') }]);
    const gear = fakeV3Item('pilot_gear', [
        { path: 'active_effects.0', data: selfResist('burn') },
        { path: 'active_effects.1', data: selfResist('kinetic', { mech: true }) }
    ]);
    const system = fakeV3Item('mech_system', [{ path: 'active_effects.0', data: selfResist('energy', { pilot: true }) }]);
    const pilot = { type: 'pilot', items: [talent, coreBonus, reserve, gear], system: {}, statuses: new Set() };
    const mech = { type: 'mech', items: [system], system: { pilot: { value: pilot } }, statuses: new Set() };
    const rowIds = (actor) => getV3DefenseRows(actor).map((/** @type {any} */ row) => row.bonus.id.replace(`v3_${TEST_PREFIX}`, '')).sort();
    check('mech: pilot talent, core bonus, reserve, Bonus record and mech: true gear', rowIds(mech), ['core_bonus_active_effects_0', 'pilot_gear_active_effects_1', 'reserve_active_effects_0', 'talent_ranks_0_active_effects_0', 'talent_ranks_0_bonuses_0_b0']);
    check('pilot: gear by default and pilot: true effects only, no Bonus record', rowIds(pilot), ['pilot_gear_active_effects_0', 'talent_ranks_0_active_effects_1']);
    check('mech with no pilot: its own pilot: true effect is skipped', rowIds({ ...mech, system: {} }), []);
}

async function talentCounters()
{
    console.log('%c── talent counters: a rank and its actions ──', 'color:orange;');
    const reaction = { name: 'LA Test Reaction', activation: 'Reaction', frequency: '1/scene' };
    const quick = { name: 'LA Test Quick', activation: 'Quick' };
    const ranks = [
        { name: 'Rank I', description: 'Passive text.', actions: [reaction] },
        { name: 'Rank II', description: '1/round, when you hit a character.', actions: [quick] },
        { name: 'Rank III', description: '', actions: [] }
    ];
    const entries = [
        { path: 'ranks.1.actions.0', data: { frequency: '1/turn' } },
        { path: 'ranks.2.active_effects.0', data: { frequency: '1/scene', condition: 'An ally makes a check.' } }
    ];
    const talent = { ...fakeV3Item('talent', entries), system: { curr_rank: 3, ranks, actions: [reaction, quick] } };
    const rankCtx = (index) => ({ item: talent, key: rankSubKey(index) });
    check('a rank does not take its action\'s 1/scene', getPerSceneLimitFromSub(ranks[0], rankCtx(0)), 0);
    check('the action keeps its own 1/scene counter', [actionSubKey(talent, reaction), getPerSceneLimitFromSub(reaction, { item: talent, key: 'a0' })], ['a0', 1]);
    check('a rank keeps the limit its own text opens with', getPerRoundLimitFromSub(ranks[1], rankCtx(1)), 1);
    check('v3 frequency on a rank action goes to that action, not the rank', [getPerTurnLimitFromSub(quick, { item: talent, key: 'a1' }), getPerTurnLimitFromSub(ranks[1], rankCtx(1))], [1, 0]);
    check('v3 frequency gated by a prose condition gives no counter', getPerSceneLimitFromSub(ranks[2], rankCtx(2)), 0);
}

async function v3ValueBonuses()
{
    console.log('%c── v3 value bonuses: threat, knockback, boost, activations, heat_cap ──', 'color:orange;');
    const item = fakeV3Item('core_bonus', [
        { path: 'bonuses.0', data: { bonuses: [{ id: 'threat', val: 1, weapon_types: ['Melee'] }] } },
        { path: 'bonuses.1', data: { bonuses: [{ id: 'knockback', val: 2, weapon_types: ['Improvised'] }] } },
        { path: 'bonuses.2', data: { bonuses: [{ id: 'boost', val: 2 }] } },
        { path: 'bonuses.3', data: { bonuses: [{ id: 'activations', val: 1 }] } },
        { path: 'bonuses.4', data: { bonuses: [{ id: 'heat_cap', val: 2, replace: true }] } },
        { path: 'bonuses.5', data: { bonuses: [{ id: 'attack', val: 1, weapon_types: ['Rifle'] }] } },
        { path: 'bonuses.6', data: { bonuses: [{ id: 'grapple', val: 1 }] } },
        { path: 'bonuses.7', data: { bonuses: [{ id: 'thrown', val: 5, weapon_types: ['Melee'], weapon_sizes: ['Auxiliary'] }] } },
        { path: 'bonuses.8', data: { bonuses: [{ id: 'min_range', val: 3 }] } },
        { path: 'bonuses.9', data: { bonuses: [{ id: 'min_range', val: 3, range_types: ['threat'] }] } },
        { path: 'bonuses.10', data: { bonuses: [{ id: 'extra_action', val: 'reaction' }] } }
    ]);
    const byId = Object.fromEntries(v3DataRows(item).map((/** @type {any} */ row) => [row.bonus.id, row.bonus]));
    const at = (index, extra = '') => byId[`v3_${item.id}_bonuses_${index}_b0v${extra}`] ?? null;
    const pick = (bonus, keys) => (bonus ? Object.fromEntries(keys.map(key => [key, bonus[key]])) : null);
    check('threat: Range, Threat +1, melee only', pick(at(0), ['type', 'rangeType', 'rangeMode', 'val', 'weaponTypes']), { type: 'range', rangeType: 'Threat', rangeMode: 'add', val: 1, weaponTypes: ['Melee'] });
    check('knockback: Tag Knockback +2, Improvised only', pick(at(1), ['type', 'tagId', 'tagMode', 'val', 'weaponTypes']), { type: 'tag', tagId: 'tg_knockback', tagMode: 'add', val: 2, weaponTypes: ['Improvised'] });
    check('boost: Movement Extra, Boost +2', pick(at(2), ['type', 'subtype', 'val']), { type: 'movement_extra', subtype: 'boost', val: 2 });
    check('activations: Stat on system.activations, add', pick(at(3), ['type', 'stat', 'statMode', 'val']), { type: 'stat', stat: 'system.activations', statMode: 'add', val: 1 });
    check('heat_cap with replace: Stat on Heat Cap, replace base', pick(at(4), ['type', 'stat', 'statMode', 'val']), { type: 'stat', stat: 'system.heat.max', statMode: 'replace_base', val: 2 });
    const improvised = at(1);
    check('an Improvised Attack counts as weapon type Improvised', improvised ? [isBonusApplicable(improvised, new Set(['attack', 'improvised']), { data: {} }), isBonusApplicable(improvised, new Set(['attack']), { data: {} })] : null, [true, false]);
    check('attack: Flat +1 on weapon attacks, rifles only', pick(at(5), ['type', 'val', 'rollTypes', 'weaponTypes']), { type: 'flat', val: 1, rollTypes: ['ranged', 'melee', 'nexus'], weaponTypes: ['Rifle'] });
    check('grapple: Flat +1 on Grapple', pick(at(6), ['type', 'rollTypes']), { type: 'flat', rollTypes: ['grapple'] });
    check('thrown: Thrown at least 5, Auxiliary Melee', pick(at(7), ['type', 'tagId', 'tagMode', 'val', 'weaponTypes', 'weaponSizes']), { type: 'tag', tagId: 'tg_thrown', tagMode: 'at_least', val: 5, weaponTypes: ['Melee'], weaponSizes: ['Auxiliary'] });
    check('min_range without types: Range and Threat at least 3', [pick(at(8), ['rangeType', 'rangeMode', 'val']), pick(at(8, '1'), ['rangeType', 'rangeMode', 'val'])], [{ rangeType: 'Range', rangeMode: 'at_least', val: 3 }, { rangeType: 'Threat', rangeMode: 'at_least', val: 3 }]);
    check('min_range with range_types threat: Threat only, not a weapon filter', [pick(at(9), ['rangeType', 'weaponRangeTypes']), at(9, '1')], [{ rangeType: 'Threat', weaponRangeTypes: undefined }, null]);
    check('extra_action reaction: Action Extra, 1 extra reaction', pick(at(10), ['type', 'subtype', 'val']), { type: 'action_extra', subtype: 'reaction', val: 1 });

    const thrownState = (val) => ({ data: { tags: val === null ? [] : [{ id: 'tg_thrown', lid: 'tg_thrown', val }] } });
    const thrownAfter = (val) =>
    {
        const state = thrownState(val);
        applyTagBonus(state, { tagId: 'tg_thrown', tagName: 'Thrown', tagMode: 'at_least', val: 5 });
        return state.data.tags.find((/** @type {any} */ tag) => tag.lid === 'tg_thrown')?.val ?? null;
    };
    check('Thrown at least 5: 3 -> 5, 6 stays 6, missing -> 5', [thrownAfter('3'), thrownAfter('6'), thrownAfter(null)], ['5', '6', '5']);
    const rangesAfter = (range, rangeType) =>
    {
        const state = { data: { range } };
        mutateRangeWithBonus(state, { rangeType, rangeMode: 'at_least', val: 3 });
        return state.data.range.map((/** @type {any} */ entry) => `${entry.type} ${entry.val}`);
    };
    check('Threat at least 3: Threat 1 -> 3, a ranged weapon gains Threat 3', [rangesAfter([{ type: 'Threat', val: 1 }], 'Threat'), rangesAfter([{ type: 'Range', val: 10 }], 'Threat')], [['Threat 3'], ['Range 10', 'Threat 3']]);
    check('Range at least 3 never adds Range to a melee weapon', rangesAfter([{ type: 'Threat', val: 1 }], 'Range'), ['Threat 1']);
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
    for (const type of ['stat', 'tag', 'range', 'movement_extra', 'action_extra'])
        check(`Limit hidden for ${type}`, shown(type), false);
    check('Action Extra shows its own panel', $('#bonus-type-action_extra').css('display') !== 'none', true);
    check('Limit shown for immunity: damage', shown('immunity', 'damage'), true);
    check('Limit hidden for immunity: elevation', shown('immunity', 'elevation'), false);
    $('#bonus-frequency').val('round').trigger('change');
    check('count box appears once a period is picked', $('#bonus-frequency-count')[0]?.style.display !== 'none', true);
    const app = Object.values(ui.windows).find((/** @type {any} */ win) => win.element?.find?.('#bonus-type').length);
    await /** @type {any} */ (app)?.close?.();
}

async function itemBonusSwitch(token)
{
    console.log('%c── switch an item bonus off for one token ──', 'color:orange;');
    const actor = token.actor;
    const source = { sourceItemUuid: `Item.${TEST_PREFIX}source`, sourceTemplateId: `${TEST_PREFIX}template` };
    const accId = `${TEST_PREFIX}item-acc`;
    const statId = `${TEST_PREFIX}item-stat`;
    const globalId = `${TEST_PREFIX}item-global`;
    const plainId = `${TEST_PREFIX}plain`;
    const ids = [accId, statId, globalId, plainId];
    const baseEvasion = actor.system.evasion;
    const constantIds = () => getConstantBonuses(actor).map((/** @type {any} */ bonus) => bonus.id);
    const globalOn = () => getGlobalBonuses(actor).some((/** @type {any} */ bonus) => bonus.id === globalId);
    const linkedDisabled = () => linkedEffect(actor, globalId)?.disabled ?? null;
    try
    {
        await addConstantBonus(actor, { id: accId, name: 'LA Test Item Bonus', type: 'accuracy', val: 1, ...source });
        await addConstantBonus(actor, { id: statId, name: 'LA Test Item Stat', type: 'stat', stat: 'system.evasion', val: 2, ...source });
        await addConstantBonus(actor, { id: plainId, name: 'LA Test Actor Bonus', type: 'accuracy', val: 1 });
        await addGlobalBonus(actor, { id: globalId, name: 'LA Test Item Global', type: 'accuracy', val: 1, ...source }, { duration: 'indefinite' });
        await delay(400);
        check('item bonuses apply while on (roll bonus, +2 Evasion, global)', [constantIds().includes(accId), actor.system.evasion, globalOn()], [true, baseEvasion + 2, true]);
        for (const id of ids)
            await setItemBonusOff(actor, id, true);
        await delay(400);
        check('switched off: no roll bonus, Evasion back, global gone, its effect disabled', [constantIds().includes(accId), actor.system.evasion, globalOn(), linkedDisabled()], [false, baseEvasion, false, true]);
        check('a bonus added to the actor itself cannot be switched off', [constantIds().includes(plainId), isItemBonusOff(actor, { id: plainId })], [true, false]);
        for (const id of ids)
            await setItemBonusOff(actor, id, false);
        await delay(400);
        check('switched back on', [constantIds().includes(accId), actor.system.evasion, globalOn(), linkedDisabled()], [true, baseEvasion + 2, true, false]);
    }
    finally
    {
        for (const id of ids)
            await setItemBonusOff(actor, id, false);
        for (const id of [accId, statId, plainId])
            await removeConstantBonus(actor, id);
        await removeGlobalBonus(actor, globalId);
        await delay(300);
    }
}

async function statResolver(token)
{
    console.log('%c── stat resolver: replace and overwrite math ──', 'color:orange;');
    const entry = (mode, value) => ({ mode, value });
    check('base 8, +1, +1, 3 replace base = 5', resolveStatValue(8, [entry('add', 1), entry('add', 1), entry('replace_base', 3)]), 5);
    check('base 10, +4, +2, 3 and 2 highest wins = 13', resolveStatValue(10, [entry('add', 4), entry('add', 2), entry('overwrite', 3), entry('overwrite', 2)]), 13);
    check('base 8, +1, 3 replace base, 5 highest wins, 2 set final = 2', resolveStatValue(8, [entry('add', 1), entry('replace_base', 3), entry('overwrite', 5), entry('replace', 2)]), 2);
    check('replace base then highest wins drops the adds = 8', resolveStatValue(8, [entry('add', 1), entry('replace_base', 3), entry('overwrite', 5)]), 8);
    check('two replace base bonuses add up = 6', resolveStatValue(8, [entry('replace_base', 2), entry('replace_base', 3), entry('add', 1)]), 6);
    check('two set final bonuses: the highest = 6', resolveStatValue(8, [entry('replace', 4), entry('replace', 6)]), 6);
    check('labels', [statBonusValueText({ val: 1 }), statBonusValueText({ val: -1 }), statBonusValueText({ val: 3, statMode: 'replace_base' }), statBonusValueText({ val: 4, statMode: 'overwrite' }), statBonusValueText({ val: 9, statMode: 'replace' }), statBonusValueText({ val: '{ll}' })], ['+1', '-1', 'base = 3', '+4 (highest)', '= 9', '+{ll}']);

    const actor = token.actor;
    const stat = 'system.evasion';
    const base = actor.system.evasion;
    const addId = `${TEST_PREFIX}stat-add`;
    const exprId = `${TEST_PREFIX}stat-expr`;
    const tokenId = `${TEST_PREFIX}stat-token`;
    const baseId = `${TEST_PREFIX}stat-base`;
    const highId = `${TEST_PREFIX}stat-high`;
    const finalId = `${TEST_PREFIX}stat-final`;
    const statBonus = (id, val, statMode = 'add') => ({ id, name: 'LA Test Stat', type: 'stat', stat, val, statMode });
    try
    {
        await addConstantBonus(actor, statBonus(addId, 1));
        await addConstantBonus(actor, statBonus(exprId, '1 + 1'));
        await addGlobalBonus(actor, statBonus(tokenId, 2), { duration: 'indefinite' });
        await delay(400);
        check('constant +1, constant "1 + 1" and token +2: each counted once', actor.system.evasion, base + 5);
        await addConstantBonus(actor, statBonus(baseId, 3, 'replace_base'));
        await delay(400);
        check('replace base 3 plus the adds = 8', actor.system.evasion, 8);
        await addConstantBonus(actor, statBonus(highId, 4, 'overwrite'));
        await delay(400);
        check('highest wins 4 drops the adds: 3 + 4 = 7', actor.system.evasion, 7);
        await addConstantBonus(actor, statBonus(finalId, 9, 'replace'));
        await delay(400);
        check('set final 9', actor.system.evasion, 9);
    }
    finally
    {
        for (const id of [addId, exprId, baseId, highId, finalId])
            await removeConstantBonus(actor, id);
        await removeGlobalBonus(actor, tokenId);
        await delay(400);
    }
    check('all removed: Evasion back to its base', actor.system.evasion, base);
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
    check('next round, before its turn: still used up', bonusFrequencyFree(storedBonus(actor, id), { actor }), false);
    const combatant = await startTurn(combat, token);
    check('its next turn starts: limit free again', await waitFor(() => bonusFrequencyFree(storedBonus(actor, id), { actor })), true);
    await endTurn(combat, combatant);
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
    const consumption = getLAFlags(effect())?.consumption;
    check('the effect stores the onHit trigger for this token', { trigger: consumption?.trigger, originId: consumption?.originId }, { trigger: 'onHit', originId: token.id });
    check('the suite token is the one on the canvas', canvas.tokens.get(token.id) === token, true);
    check('the linked bonus limit is free before the hit', bonusFrequencyFree(linkedBonusOf(actor, effect()), { actor }), true);
    const start = effectStack(effect());
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('first hit spends 1 use', effectStack(effect()), start - 1);
    check('first hit fills the 1/round limit', bonusFrequencyFree(storedBonus(actor, id), { actor }), false);
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('second hit in the same round spends nothing', effectStack(effect()), start - 1);
    await combat.nextRound();
    const combatant = await startTurn(combat, token);
    await processEffectConsumption('onHit', { triggeringToken: token });
    await delay(400);
    check('its next turn: a hit spends a use again', effectStack(effect()), start - 2);
    await endTurn(combat, combatant);
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

async function actionExtras(token, combat)
{
    console.log('%c── extra actions: reaction, quick and full ──', 'color:orange;');
    const actor = token.actor;
    const reactionId = `${TEST_PREFIX}extra-reaction`;
    const quickId = `${TEST_PREFIX}extra-quick`;
    const fullId = `${TEST_PREFIX}extra-full`;
    const tracker = () => actor.system.action_tracker;
    const left = () => actionExtrasLeft(actor);
    try
    {
        await actor.update({ 'system.action_tracker.reaction': true });
        await addConstantBonus(actor, { id: reactionId, name: 'LA Test Extra Reaction', type: 'action_extra', subtype: 'reaction', val: 1 });
        await delay(300);
        check('Extra Reaction +1: one extra reaction left, 2 reactions shown', [left().reaction, actionCounts(actor).reaction], [1, 2]);
        await consumeReaction(token);
        await delay(300);
        check('first reaction: the reaction stays, the extra is used', [!!tracker().reaction, left().reaction], [true, 0]);
        await consumeReaction(token);
        await delay(300);
        check('second reaction: no reaction left', !!tracker().reaction, false);
        await modifyAction(actor, 'reaction', false);
        await delay(300);
        check('refund: the reaction comes back first', [!!tracker().reaction, left().reaction], [true, 0]);
        await modifyAction(actor, 'reaction', false);
        await delay(300);
        check('refund with the reaction up: the extra comes back', left().reaction, 1);
        await actor.update({ 'system.action_tracker.reaction': false });
        check('a spend from the Lancer sheet uses the extra too', await waitFor(() => !!tracker().reaction && left().reaction === 0), true);

        const shown = () => [actionCounts(actor).full, actionCounts(actor).quick];
        await addConstantBonus(actor, { id: quickId, name: 'LA Test Extra Quick', type: 'action_extra', subtype: 'quick', val: 1 });
        await actor.update({ 'system.action_tracker.full': true, 'system.action_tracker.quick': true });
        await delay(300);
        check('out of its turn, slots up: 1 full, 3 quick shown', shown(), [1, 3]);
        await modifyAction(actor, 'full');
        await delay(300);
        check('out of its turn, a full spent: the extra quick is left', [...shown(), !!tracker().full, !!tracker().quick], [0, 1, false, true]);
        await combat.nextRound();
        const combatant = await startTurn(combat, token);
        await onCombatClock(() => null);
        check('a turn start gives the extra reaction back', left().reaction, 1);
        check('its turn with an extra quick: 1 full, 3 quick', shown(), [1, 3]);
        await modifyAction(actor, 'quick');
        await delay(300);
        check('one quick spent: still 1 full, 2 quick, both Lancer slots up', [...shown(), !!tracker().full, !!tracker().quick], [1, 2, true, true]);
        await modifyAction(actor, 'quick', false);
        await delay(300);
        check('refunding that quick: 1 full, 3 quick again', shown(), [1, 3]);
        await actor.update({ 'system.action_tracker.full': false });
        check('a quick spent from the Lancer sheet: 1 full, 2 quick', await waitFor(() => shown().join() === '1,2' && !!tracker().full), true);
        await modifyAction(actor, 'quick', false);
        await delay(300);
        await modifyAction(actor, 'full');
        await delay(300);
        check('a full spent from 3 quick: 0 full, 1 quick', [...shown(), !!tracker().full, !!tracker().quick], [0, 1, false, true]);
        await modifyAction(actor, 'quick');
        await delay(300);
        check('the last quick spent: nothing left', shown(), [0, 0]);
        await endTurn(combat, combatant);
        await removeConstantBonus(actor, quickId);
        await addConstantBonus(actor, { id: fullId, name: 'LA Test Extra Full', type: 'action_extra', subtype: 'full', val: 1 });
        await combat.nextRound();
        const nextTurn = await startTurn(combat, token);
        await onCombatClock(() => null);
        check('its turn with an extra full: 2 full, 4 quick', shown(), [2, 4]);
        await modifyAction(actor, 'full');
        await delay(300);
        check('a full spent: 1 full, 2 quick', shown(), [1, 2]);
        await modifyAction(actor, 'full', false);
        await delay(300);
        await modifyAction(actor, 'quick');
        await delay(300);
        check('refund it, spend a quick instead: 1 full, 3 quick', shown(), [1, 3]);
        await endTurn(combat, nextTurn);
        await onCombatClock(() => null);
        check('its turn ends: the unused extra expires', [left().slots, ...shown()], [0, 0, 0]);
        const reactionBefore = left().reaction;
        await setStatus(actor, 'dazed', true);
        check('Dazed blocks the extra reaction', [reactionBefore, left().reaction], [1, 0]);
        await setStatus(actor, 'dazed', false);
    }
    finally
    {
        await removeConstantBonus(actor, reactionId);
        await removeConstantBonus(actor, quickId);
        await removeConstantBonus(actor, fullId);
        await delay(300);
    }
}

async function traitCounters(token, combat)
{
    console.log('%c── frame trait counters ──', 'color:orange;');
    const actor = token.actor;
    const frame = actor.items.find((/** @type {any} */ owned) => owned.type === 'frame');
    const traits = /** @type {any} */ (frame)?.system?.traits ?? [];
    if (!isPerFrequencyEnabled() || traits.length < 2)
    {
        console.warn('trait counters skipped: needs the per-frequency counters setting on and a frame with 2 traits');
        return;
    }
    const originalV3 = foundry.utils.deepClone(frame.getFlag('lancer-npc-import', 'v3') ?? null);
    const originalSubs = foundry.utils.deepClone(frame.getFlag(MODULE_ID, 'perFreqSub') ?? null);
    try
    {
        const entries = [
            { path: 'traits.0.active_effects.0', data: { frequency: '1/turn' } },
            { path: 'traits.1.active_effects.0', data: { frequency: '1/turn' } }
        ];
        await frame.unsetFlag('lancer-npc-import', 'v3');
        await frame.setFlag('lancer-npc-import', 'v3', { pack: 'la-test', entries });
        await frame.unsetFlag(MODULE_ID, 'perFreqSub');
        await delay(300);
        const ctx = (index) => ({ item: frame, key: traitSubKey(index) });
        check('trait 1 reads its 1/turn from v3 data', getPerTurnLimitFromSub(traits[0], ctx(0)), 1);
        check('trait 2 reads its 1/turn from v3 data', getPerTurnLimitFromSub(traits[1], ctx(1)), 1);
        await executeSimpleActivation(actor, { title: traits[0].name, action: { name: traits[0].name, activation: 'Passive' }, detail: '' }, { item: frame, traitIndex: 0 });
        await delay(500);
        check('using trait 1 from TAH spends its own counter', getSubUsed(frame, traitSubKey(0), 'uses_per_turn'), 1);
        check('trait 2 keeps its own counter', getSubUsed(frame, traitSubKey(1), 'uses_per_turn'), 0);
        await combat.nextRound();
        const combatant = await startTurn(combat, token);
        check('the next turn resets the trait counter', await waitFor(() => getSubUsed(frame, traitSubKey(0), 'uses_per_turn') === 0), true);
        await endTurn(combat, combatant);
    }
    finally
    {
        await frame.unsetFlag('lancer-npc-import', 'v3');
        if (originalV3)
            await frame.setFlag('lancer-npc-import', 'v3', originalV3);
        await frame.unsetFlag(MODULE_ID, 'perFreqSub');
        if (originalSubs)
            await frame.setFlag(MODULE_ID, 'perFreqSub', originalSubs);
    }
}

function v3Entries()
{
    return [
        { path: 'active_effects.0', data: { bonuses: [{ id: 'immunity', val: ['prone'] }] } },
        { path: 'active_effects.1', data: { bonuses: [{ id: 'resistance', val: 'all' }] } },
        { path: 'active_effects.2', data: { add_resist: [{ resistance: 'kinetic', target: 'self' }], frequency: '1/round' } },
        { path: 'active_effects.3', data: { add_resist: [{ resistance: 'energy', target: 'self' }], duration: 'next_turn_end_self' } },
        { path: 'core_system.active_effects.0', data: { add_resist: [{ resistance: 'explosive', target: 'self' }] } },
        { path: 'active_effects.5', data: { bonuses: [{ id: 'immunity', val: ['slow'], condition: '{exposed}' }] } },
        { path: 'bonuses.0', data: { bonuses: [{ id: 'attack', accuracy: 1, weapon_types: ['Rifle'] }] } },
        { path: 'bonuses.1', data: { bonuses: [{ id: 'hull_save', accuracy: -1 }] } },
        { path: 'bonuses.2', data: { bonuses: [{ id: 'tech_attack', accuracy: 2, condition: '{exposed}' }] } },
        { path: 'active_effects.6', data: { bonus_damage: { val: '1d6', type: 'Energy', weapon_types: ['Rifle'] } } },
        { path: 'active_effects.7', data: { bonus_damage: { val: 2, hit_type: 'crit' } } },
        { path: 'active_effects.8', data: { condition: 'x', bonus_damage: { val: '1d6' } } }
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

async function waitFor(predicate, timeout = 3000)
{
    for (let waited = 0; waited < timeout && !predicate(); waited += 100)
        await delay(100);
    return predicate();
}

async function startTurn(combat, token)
{
    const combatant = combat.combatants.find((/** @type {any} */ entry) => entry.tokenId === token.id);
    await combat.activateCombatant(combatant.id);
    if (!(await waitFor(() => combat.combatant?.id === combatant.id)))
        fail('the mech starts its turn', 'activateCombatant did not give it the turn (no activation left?)');
    await delay(500);
    return combatant;
}

async function endTurn(combat, combatant)
{
    await combat.deactivateCombatant(combatant.id);
    await delay(500);
}

async function v3TimedExpired(token, item, combat)
{
    console.log('%c── v3 duration: ended ──', 'color:orange;');
    const timedId = `v3_${item.id}_active_effects_3_timed`;
    const combatant = combat.combatants.find((/** @type {any} */ entry) => entry.tokenId === token.id);
    await combat.activateCombatant(combatant.id);
    if (!(await waitFor(() => combat.combatant?.id === combatant.id)))
    {
        fail('the mech starts its turn', 'activateCombatant did not give it the turn (no activation left?)');
        return;
    }
    await delay(500);
    check('"end of your next turn" lasts through the turn start', !!storedBonus(token.actor, timedId), true);
    await combat.deactivateCombatant(combatant.id);
    check('"end of your next turn" ends when the mech ends that turn', await waitFor(() => !storedBonus(token.actor, timedId)), true);
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

async function v3Accuracy(token, item)
{
    console.log('%c── v3 accuracy Bonus records ──', 'color:orange;');
    const actor = token.actor;
    const rowBonus = (path) => v3RowById(actor, `v3_${item.id}_${path.replace(/\./g, '_')}_b0`)?.bonus ?? null;
    const weapon = (type) => ({ system: { profiles: [{ type, range: [], damage: [] }], selected_profile_index: 0, size: 'Main' } });
    const attackTags = getFlowTags('attack', { data: {}, item: weapon('Rifle') });
    const rifle = rowBonus('bonuses.0');
    check('{id: attack, accuracy: 1, weapon_types: [Rifle]} -> +1 Accuracy on attacks, Rifle only', rifle ? { type: rifle.type, val: rifle.val, rollTypes: rifle.rollTypes, weaponTypes: rifle.weaponTypes } : null, { type: 'accuracy', val: 1, rollTypes: ['attack'], weaponTypes: ['Rifle'] });
    check('applies to a Rifle attack', !!rifle && isBonusApplicable(rifle, attackTags, { actor, item: weapon('Rifle') }), true);
    check('not to a Cannon attack', !!rifle && isBonusApplicable(rifle, attackTags, { actor, item: weapon('Cannon') }), false);
    check('not to a tech attack (no weapon)', !!rifle && isBonusApplicable(rifle, getFlowTags('tech_attack', { data: {} }), { actor }), false);
    const hullSave = rowBonus('bonuses.1');
    check('{id: hull_save, accuracy: -1} -> +1 Difficulty on Hull saves', hullSave ? { type: hullSave.type, val: hullSave.val, rollTypes: hullSave.rollTypes } : null, { type: 'difficulty', val: 1, rollTypes: ['hull_save'] });
    const saveTags = getFlowTags('stat_roll', { data: { path: 'system.hull' }, la_extraData: { rollTypes: ['save'] } });
    check('applies to a Hull save, not a Hull check', [isBonusApplicable(hullSave, saveTags, { actor }), isBonusApplicable(hullSave, getFlowTags('stat_roll', { data: { path: 'system.hull' } }), { actor })], [true, false]);
    await setStatus(actor, 'exposed', false);
    check('{id: tech_attack, condition: {exposed}}: not Exposed -> inactive', v3RowById(actor, `v3_${item.id}_bonuses_2_b0`)?.inactive, true);
    await setStatus(actor, 'exposed', true);
    check('Exposed -> active', v3RowById(actor, `v3_${item.id}_bonuses_2_b0`)?.inactive, false);
    await setStatus(actor, 'exposed', false);
    const frame = { ...fakeV3Item('frame', [{ path: 'traits.1.bonuses.0', data: { bonuses: [{ id: 'hull', accuracy: 1 }] } }]), system: { traits: [{ name: 'Trait A' }, { name: 'Trait B' }] } };
    check('a trait Bonus record is named after its trait', v3DataRows(frame)[0]?.bonus?.name, 'Trait B');
}

async function v3BonusDamage(token, item)
{
    console.log('%c── v3 bonus_damage ──', 'color:orange;');
    const actor = token.actor;
    const rowBonus = (path) => v3RowById(actor, `v3_${item.id}_${path.replace(/\./g, '_')}_d0`)?.bonus ?? null;
    const energy = rowBonus('active_effects.6');
    check('{val: 1d6, type: Energy, weapon_types: [Rifle]} -> add 1d6 Energy, Rifle only', energy ? { type: energy.type, damage: energy.damage, weaponTypes: energy.weaponTypes, itemId: energy.itemId ?? null } : null, { type: 'damage', damage: [{ val: '1d6', type: 'Energy' }], weaponTypes: ['Rifle'], itemId: null });
    const crit = rowBonus('active_effects.7');
    check('{val: 2, hit_type: crit} -> crit only, type left to the attack', crit ? { critOnly: crit.critOnly, damage: crit.damage } : null, { critOnly: true, damage: [{ val: '2', type: null }] });
    check('an effect with a condition text gives nothing', rowBonus('active_effects.8'), null);
    check('damage window: plain bonus damage starts unticked, crit-only stays ticked', [!!energy?.defaultOff, !!crit?.defaultOff], [true, false]);
    const target = (id, isCrit) => ({ target: { id }, crit: isCrit, hit: true });
    const mixed = resolveDamageBonus(crit, { data: { damage: [{ type: 'Explosive' }], hit_results: [target('a', true), target('b', false)] } });
    check('crit on one of two targets: that target only, halved, attack type', mixed ? { applyTo: mixed.applyTo, damage: mixed.damage } : null, { applyTo: ['a'], damage: [{ val: 'ceil((2) / 2)', type: 'Explosive' }] });
    check('no crit: nothing', resolveDamageBonus(crit, { data: { damage: [{ type: 'Kinetic' }], hit_results: [target('a', false)] } }), null);
    const weaponEntries = [
        { path: '', data: { bonus_damage: [{ val: '1d6' }] } },
        { path: 'on_crit', data: { bonus_damage: { val: '1d6', hit_type: 'crit' } } },
        { path: 'on_miss', data: { bonus_damage: { val: '1d6' } } }
    ];
    const weapon = { ...fakeV3Item('mech_weapon', weaponEntries), name: 'LA Test Weapon' };
    const weaponRows = Object.fromEntries(v3DataRows(weapon).map((/** @type {any} */ row) => [row.bonus.id.replace(`v3_${weapon.id}_`, ''), { itemId: row.bonus.itemId, critOnly: !!row.bonus.critOnly }]));
    check('weapon root and on_crit: this weapon only, on_crit crits only, on_miss nothing', weaponRows, { root_d0: { itemId: weapon.id, critOnly: false }, on_crit_d0: { itemId: weapon.id, critOnly: true } });
}

async function v3Replaced(token, item)
{
    console.log('%c── v3 data replaced by an automation ──', 'color:orange;');
    const actor = token.actor;
    const rowId = (path) => `v3_${item.id}_${path.replace(/\./g, '_')}_b0`;
    const state = { actor, data: {}, la_extraData: {} };
    const prone = () => checkEffectImmunities(actor, 'prone').includes(TEST_ITEM_NAME);
    const resistAll = () => getApplicableDefenseBonuses(actor, 'resistance', state, { ownerTokenId: token.id }).some((/** @type {any} */ bonus) => bonus.id === rowId('active_effects.1'));
    const fakeTrait = (replaced) => ({ ...fakeV3Item('frame', [{ path: 'traits.0.active_effects.0', data: { frequency: '1/turn' } }]), getFlag: (scope, key) => (scope === MODULE_ID && key === 'v3Replaced' ? replaced : undefined) });
    try
    {
        check('before: Prone immunity and Resistance All apply', [prone(), resistAll()], [true, true]);
        await replaceV3Data(item, ['active_effects.0', 'active_effects.1']);
        await delay(300);
        check('replaced: the rows stay listed, marked replaced', [v3RowById(actor, rowId('active_effects.0'))?.replaced, v3RowById(actor, rowId('active_effects.1'))?.replaced], [true, true]);
        check('replaced: no Prone immunity, no Resistance All', [prone(), resistAll()], [false, false]);
        await replaceV3Data(item, 'bonuses');
        await delay(300);
        check('a path replaces everything under it', ['bonuses.0', 'bonuses.1', 'bonuses.2'].map(path => v3RowById(actor, rowId(path))?.replaced), [true, true, true]);
        check('active_effects.1 covers active_effects.1.damage.0, not active_effects.10', [isV3DataReplaced(item, 'active_effects.1.damage.0'), isV3DataReplaced(item, 'active_effects.10')], [true, false]);
        await restoreV3Data(item, 'active_effects.0');
        await delay(300);
        check('restore one path: Prone immunity back, Resistance All still replaced', [prone(), resistAll()], [true, false]);
        await replaceV3Data(item, 'root');
        await delay(300);
        check('root is the item-level entry only', [isV3DataReplaced(item, ''), isV3DataReplaced(item, 'active_effects.5')], [true, false]);
        await restoreV3Data(item);
        await delay(300);
        check('restore all: flag gone, nothing replaced', [item.getFlag(MODULE_ID, 'v3Replaced') ?? null, resistAll(), getV3DefenseRows(actor).some((/** @type {any} */ row) => row.replaced)], [null, true, false]);
        check('a replaced 1/turn gives no trait counter', [getPerTurnLimitFromSub({}, { item: fakeTrait([]), key: traitSubKey(0) }), getPerTurnLimitFromSub({}, { item: fakeTrait(['traits.0']), key: traitSubKey(0) })], [1, 0]);
    }
    finally
    {
        await restoreV3Data(item);
    }
}

async function itemOrigin(token, item)
{
    console.log('%c── item attachments: by hand or by automation ──', 'color:orange;');
    const actor = token.actor;
    const handId = `${TEST_PREFIX}hand`;
    const autoId = `${TEST_PREFIX}auto-link`;
    const markName = 'LA Test Mark';
    const stamped = [];
    const runtime = (id) => (getLAFlags(actor)?.constant_bonuses ?? []).find((/** @type {any} */ bonus) => bonus.sourceBonusId === id) ?? null;
    try
    {
        stamped.push(...await linkBonusToItem({ items: [item], bonusData: { id: handId, name: 'LA Test Hand', type: 'accuracy', val: 1 }, addOptions: { duration: 'constant', addedViaUI: true } }));
        stamped.push(...await linkBonusToItem({ items: [item], bonusData: { id: autoId, name: 'LA Test Automation', type: 'accuracy', val: 1 }, addOptions: { duration: 'constant' } }));
        await linkEffectToItem({ items: [item], effectNames: [{ name: markName, icon: 'icons/svg/aura.svg', isCustom: true }], duration: { label: 'permanent' } }, { addedViaUI: true });
        await delay(500);
        const mark = actor.effects.find((/** @type {any} */ effect) => effect.name === markName && getLAFlags(effect)?.sourceItemUuid === item.uuid);
        check('bonus added from the item L.A menu: by hand', itemAttachmentOrigin(runtime(handId)), 'hand');
        check('bonus added from code: by automation', itemAttachmentOrigin(runtime(autoId)), 'automation');
        check('status added from the item L.A menu: by hand', itemAttachmentOrigin(mark), 'hand');
        check('a bonus on the actor itself has no item origin', itemAttachmentOrigin({ id: handId, type: 'accuracy', val: 1 }), null);
        check('item chips: hand bonus, automation bonus, hand status', itemAttachmentChips(item).map((/** @type {any} */ chip) => `${chip.kind}:${chip.origin}:${chip.text}`), ['bonus:hand:Accuracy +1', 'bonus:automation:Accuracy +1', `status:hand:${markName}`]);
        const legacyItem = { documentName: 'Item', parent: { type: 'mech' }, effects: [], flags: { [MODULE_ID]: { bonusTemplates: [{ id: 'legacy', bonusData: { type: 'accuracy', val: 1 }, addOptions: {} }] } } };
        check('no marker (attached before the update): unknown, no claim', [itemAttachmentOrigin({ sourceItemUuid: item.uuid, sourceTemplateId: 'missing' }), itemAttachmentChips(legacyItem)[0]?.origin], ['unknown', 'unknown']);
    }
    finally
    {
        for (const { templateId } of stamped)
            await unlinkBonusFromItem({ items: [item], templateId });
        await unlinkEffectFromItem({ items: [item], effectName: markName });
        await delay(300);
    }
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
        await run(runsOn);
        await run(flowTags);
        await run(effectManagerLimit, token);
        await run(itemBonusSwitch, token);
        await run(statResolver, token);
        if (hasNpcImport)
        {
            await run(pilotSplit);
            await run(talentCounters);
            await run(v3ValueBonuses);
            item = await createV3Item(actor);
        }
        else
            console.warn('lancer-npc-import is not active: v3 data sections skipped');
        combat = await Combat.create({ scene: canvas.scene.id, active: true });
        await combat.createEmbeddedDocuments('Combatant', [{ tokenId: token.id, sceneId: canvas.scene.id, actorId: actor.id }]);
        await combat.startCombat();
        await delay(1200);
        if (item)
        {
            await run(v3TimedApplied, token, item);
            await run(v3TimedExpired, token, item, combat);
        }
        await run(limitConsumeOff, token, combat);
        await run(limitConsumeOn, token);
        await run(limitAutoConsume, token, combat);
        await run(limitMission, token, combat);
        await run(limitResistance, token);
        await run(actionExtras, token, combat);
        if (hasNpcImport)
            await run(traitCounters, token, combat);
        if (item)
        {
            await run(v3Rows, token, item);
            await run(v3Condition, token, item);
            await run(v3Accuracy, token, item);
            await run(v3BonusDamage, token, item);
            await run(v3Replaced, token, item);
            await run(itemOrigin, token, item);
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
