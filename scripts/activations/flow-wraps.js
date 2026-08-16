/* global document, MutationObserver, Roll, game, ui, Number */

import { ActiveFlowState } from './flows.js';
import {
    injectNoBonusDmgCheckbox,
    injectThrottledCheckbox,
    getImmunityBonuses,
    checkDamageResistances,
    mutateDamageWithBonus,
    isBonusApplicable,
    flattenBonuses,
    getConstantBonuses,
    getGlobalBonuses
} from '../bonuses/genericBonuses.js';

export async function noBonusDmgInjectStep(state)
{
    if (ActiveFlowState.current?._csmNoBonusDmg)
    {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
    }
    injectNoBonusDmgCheckbox(state);
    injectThrottledCheckbox(state);
    return true;
}

/**
 * Wraps rollNormalDamage and rollCritDamage so that when No Bonus Dmg is active,
 * bonus_damage is cleared immediately before each roll step executes.
 */
export function wrapRollDamageForNoBonusDmg(flowSteps)
{
    for (const stepName of ['rollNormalDamage', 'rollCritDamage'])
    {
        const orig = flowSteps.get(stepName);
        if (!orig)
            continue;
        flowSteps.set(stepName, async function noBonusDmgWrapped(state)
        {
            if (ActiveFlowState.current?._csmNoBonusDmg && !state.la_extraData?._csmNoBonusDmg)
            {
                state.la_extraData = state.la_extraData || {};
                state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
            }
            if (state.la_extraData?._csmNoBonusDmg?.enabled)
            {
                state.data.bonus_damage = [];
                for (const target of (state.data.damage_hud_data?.targets || []))
                    target.bonusDamage = [];
            }
            return orig(state);
        });
    }
}

/**
 * Seed the HASE HUD from `la_extraData` before it opens, so a caller can set acc/diff/flat
 * the way a weapon's tags do on an attack. The player still sees and can change them.
 * @param {any} state
 */
function applyStatRollPresets(state)
{
    const extra = state.la_extraData;
    if (!extra)
        return;
    const base = state.data.acc_diff?.base;
    if (base)
    {
        if (Number(extra.accuracy))
            base.accuracy = (base.accuracy || 0) + Number(extra.accuracy);
        if (Number(extra.difficulty))
            base.difficulty = (base.difficulty || 0) + Number(extra.difficulty);
    }
    if (Number(extra.flatModifier))
        state.data.bonus = (state.data.bonus || 0) + Number(extra.flatModifier);
}

export function wrapStatRollFlatModifier(flowSteps)
{
    const orig = flowSteps.get('showStatRollHUD');
    if (!orig)
        return;
    flowSteps.set('showStatRollHUD', async function wrappedShowStatRollHUD(state)
    {
        if (!state.data)
            throw new TypeError('Stat roll flow state missing!');
        applyStatRollPresets(state);
        const bonus = state.data.bonus || 0;
        let flatMod = 0;

        const observer = new MutationObserver(() =>
        {
            const dialog = document.getElementById('hase-accdiff-dialog');
            if (!dialog || dialog.querySelector('.la-stat-flat-mod'))
                return;
            observer.disconnect();
            flatMod = 0;
            _injectStatFlatModRow(dialog, bonus, (value) =>
            {
                flatMod = value;
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const result = await orig(state);
        observer.disconnect();

        if (result !== false && flatMod !== 0)
        {
            state.data.bonus = bonus + flatMod;
            const accTotal = state.data.acc_diff?.base?.total || 0;
            const accStr = accTotal !== 0 ? ` + ${accTotal}d6kh1` : '';
            state.data.roll_str = `1d20+${state.data.bonus}${accStr}`;
        }
        return result;
    });
}

// Builds DOM matching the Lancer system's Svelte accdiff-flat-bonus structure.
function _injectStatFlatModRow(dialog, bonus, onChange)
{
    // Svelte scope hash changes each Lancer release; read it from a sibling element.
    const _scope = (() =>
    {
        const ref = dialog.querySelector('.accdiff-grid, .accdiff-other-grid');
        if (!ref)
            return '';
        for (const cls of ref.classList)
        {
            if (cls.startsWith('svelte-'))
                return cls;
        }
        return '';
    })();

    // Label: identical to the attack dialog's "Flat Modifier" header.
    const label = document.createElement('label');
    label.className = 'flexrow accdiff-weight lancer-border-primary';
    label.setAttribute('for', 'accdiff-flat-bonus');
    label.textContent = 'Flat Modifier';

    const grid = document.createElement('div');
    grid.className = `la-stat-flat-mod accdiff-grid accdiff-flat-bonus ${_scope}`.trim();

    const leftCol = document.createElement('div');
    leftCol.className = `accdiff-other-grid ${_scope}`.trim();
    const leftSpan = document.createElement('span');
    leftSpan.className = _scope;
    const leftB = document.createElement('b');
    leftB.textContent = 'Base:';
    leftSpan.appendChild(leftB);
    leftSpan.append(` ${bonus >= 0 ? '+' : ''}${bonus}`);
    leftCol.appendChild(leftSpan);

    const midCol = document.createElement('div');
    midCol.className = `accdiff-other-grid accdiff-flat-mod ${_scope}`.trim();
    midCol.style.position = 'relative';
    const input = document.createElement('input');
    input.className = `accdiff-flat-mod__input ${_scope}`.trim();
    input.type = 'number';
    input.value = '0';
    const plusBtn = document.createElement('button');
    plusBtn.className = `accdiff-flat-mod__plus ${_scope}`.trim();
    plusBtn.type = 'button';
    plusBtn.innerHTML = `<i class="fas fa-plus ${_scope}"></i>`;
    const minusBtn = document.createElement('button');
    minusBtn.className = `accdiff-flat-mod__minus ${_scope}`.trim();
    minusBtn.type = 'button';
    minusBtn.innerHTML = `<i class="fas fa-minus ${_scope}"></i>`;
    midCol.append(input, plusBtn, minusBtn);

    const rightCol = document.createElement('div');
    rightCol.className = `accdiff-other-grid ${_scope}`.trim();
    const rightSpan = document.createElement('span');
    rightSpan.className = _scope;
    const rightB = document.createElement('b');
    rightB.textContent = 'Total:';
    rightSpan.appendChild(rightB);
    rightSpan.append(' ');
    const totalText = document.createTextNode(`${bonus >= 0 ? '+' : ''}${bonus}`);
    rightSpan.appendChild(totalText);
    rightCol.appendChild(rightSpan);

    grid.append(leftCol, midCol, rightCol);

    // Insert before the first child of the dialog (same position as attack HUD).
    dialog.prepend(grid);
    dialog.prepend(label);

    const update = () =>
    {
        const parsedValue = Number(input.value) || 0;
        onChange(parsedValue);
        const total = bonus + parsedValue;
        totalText.textContent = (total >= 0 ? '+' : '') + total;
    };
    input.addEventListener('input', update);
    plusBtn.addEventListener('click', () =>
    {
        input.value = String((Number(input.value) || 0) + 1);
        update();
    });
    minusBtn.addEventListener('click', () =>
    {
        input.value = String((Number(input.value) || 0) - 1);
        update();
    });
}

async function _collectBaseDamageMutations(state)
{
    const actor = state.actor;
    if (!actor)
        return [];
    const flowTags = new Set(['all', 'damage']);
    const raw = flattenBonuses([
        ...getGlobalBonuses(actor),
        ...getConstantBonuses(actor)
    ]);
    const applicableBonuses = [];
    for (const bonus of raw)
    {
        if (bonus.type !== 'damage')
            continue;
        const mode = bonus.damageMode || 'add';
        if (mode !== 'replace' && mode !== 'change_type' && mode !== 'add_base')
            continue;
        if (await isBonusApplicable(bonus, flowTags, state))
            applicableBonuses.push(bonus);
    }
    return applicableBonuses;
}

// fromParams reads the weapon's damage from item.system, so we swap it before the HUD builds and restore after.
export function wrapShowDamageHUD(flowSteps)
{
    const orig = flowSteps.get('showDamageHUD');
    if (!orig)
        return;

    flowSteps.set('showDamageHUD', async function wrappedShowDamageHUD(state)
    {
        const bonuses = await _collectBaseDamageMutations(state);
        if (bonuses.length === 0)
            return orig(state);

        const item = state.item;
        if (!item?.system)
            return orig(state);

        let restore = null;
        try
        {
            if (item.type === 'mech_weapon' && item.system.active_profile)
            {
                const activeProfile = item.system.active_profile;
                const origDmg = activeProfile.damage;
                if (Array.isArray(origDmg))
                {
                    const cloned = origDmg.map(dmg => ({ type: dmg.type, val: dmg.val }));
                    const mockState = { actor: state.actor, item, data: { damage: cloned } };
                    for (const bonus of bonuses)
                        mutateDamageWithBonus(mockState, bonus);
                    activeProfile.damage = cloned;
                    restore = () =>
                    {
                        activeProfile.damage = origDmg;
                    };
                }
            }
            else if (item.type === 'npc_feature' && item.system?.type === 'Weapon')
            {
                const tier = (state.actor?.system?.tier || 1) - 1;
                const tierArr = item.system.damage;
                const origDmg = Array.isArray(tierArr) && Array.isArray(tierArr[tier]) ? tierArr[tier] : null;
                if (Array.isArray(origDmg))
                {
                    const cloned = origDmg.map(dmg => ({ type: dmg.type, val: dmg.val }));
                    const mockState = { actor: state.actor, item, data: { damage: cloned } };
                    for (const bonus of bonuses)
                        mutateDamageWithBonus(mockState, bonus);
                    tierArr[tier] = cloned;
                    restore = () =>
                    {
                        tierArr[tier] = origDmg;
                    };
                }
            }
            else if (item.type === 'pilot_weapon' && Array.isArray(item.system.damage))
            {
                const origDmg = item.system.damage;
                const cloned = origDmg.map(dmg => ({ type: dmg.type, val: dmg.val }));
                const mockState = { actor: state.actor, item, data: { damage: cloned } };
                for (const bonus of bonuses)
                    mutateDamageWithBonus(mockState, bonus);
                item.system.damage = cloned;
                restore = () =>
                {
                    item.system.damage = origDmg;
                };
            }
        }
        catch (e)
        {
            console.warn('lancer-automations | pre-HUD damage mutation failed:', e);
            if (restore)
            {
                try
                {
                    restore();
                }
                catch (_)
                { /* ignore */ } restore = null;
            }
        }

        try
        {
            return await orig(state);
        }
        finally
        {
            if (restore)
            {
                try
                {
                    restore();
                }
                catch (e)
                {
                    console.warn('lancer-automations | damage restore failed:', e);
                }
            }
        }
    });
}

export function wrapRollReliable(flowSteps)
{
    const origRollReliable = flowSteps.get('rollReliable');
    if (!origRollReliable)
        return;

    flowSteps.set('rollReliable', async function wrappedRollReliable(state)
    {
        const result = await origRollReliable(state);
        if (result === false && state.data?._csmKnockback?.enabled)
        {
            // No damage configured but knockback is pending; let the flow continue
            return true;
        }
        return result;
    });
}

function getHeatMitigation(actor)
{
    let enabled = true;
    try
    {
        enabled = !!game.settings.get('lancer-automations', 'resistSelfHeat');
    }
    catch
    {
        enabled = true;
    }
    if (!enabled)
        return { immune: false, resisted: false };

    const immune = getImmunityBonuses(actor, "damage")
        .some(bonus => bonus.damageTypes?.some(damageType => ['heat', 'all'].includes(damageType.toLowerCase())));
    const resisted = !actor.system.statuses?.shredded && (
        actor.system.resistances?.heat ||
        checkDamageResistances(actor, "heat").length > 0
    );
    return { immune, resisted };
}

export function wrapApplySelfHeat(flowSteps)
{
    const origApplySelfHeat = flowSteps.get('applySelfHeat');
    if (!origApplySelfHeat)
        return;

    flowSteps.set('applySelfHeat', async function wrappedApplySelfHeat(state, options)
    {
        const actor = /** @type {Actor}*/(state.actor);
        if (!actor || !state.data?.self_heat)
            return origApplySelfHeat(state, options);

        const { immune: heatImmune, resisted: hasResistance } = getHeatMitigation(actor);

        if (heatImmune)
        {
            // Zero out self_heat so original step skips the roll and applies 0
            const savedSelfHeat = state.data.self_heat;
            state.data.self_heat = undefined;
            const result = await origApplySelfHeat(state, options);
            state.data.self_heat = savedSelfHeat; // restore for chat card
            return result;
        }

        if (hasResistance)
        {
            const roll = await new Roll(state.data.self_heat).evaluate();
            const halved = Math.floor(roll.total / 2);
            state.data.self_heat_result = { roll, tt: await roll.getTooltip() };

            const automationSettings = game.settings.get(game.system.id, "automationOptions");
            if (automationSettings?.attack_self_heat && (actor.is_mech() || actor.is_npc()))
            {
                await actor.update(/** @type {any}*/({
                    "system.heat.value": actor.system.heat.value + (state.data.overkill_heat ?? 0) + halved
                }));
            }

            // Zero out both so original step applies nothing further
            const savedSelfHeat = state.data.self_heat;
            const savedOverkillHeat = state.data.overkill_heat;
            state.data.self_heat = undefined;
            state.data.overkill_heat = 0;
            const result = await origApplySelfHeat(state, options);
            state.data.self_heat = savedSelfHeat;      // restore for chat card
            state.data.overkill_heat = savedOverkillHeat;
            return result;
        }

        return origApplySelfHeat(state, options);
    });
}

export function wrapUpdateOverchargeActor(flowSteps)
{
    const orig = flowSteps.get('updateOverchargeActor');
    if (!orig)
        return;

    flowSteps.set('updateOverchargeActor', async function wrappedUpdateOverchargeActor(state, options)
    {
        const actor = /** @type {Actor}*/(state.actor);
        const rollTotal = Number(state.data?.result?.roll?.total);
        if (!actor?.is_mech?.() || !Number.isFinite(rollTotal))
            return orig(state, options);

        const { immune, resisted } = getHeatMitigation(actor);
        if (!immune && !resisted)
            return orig(state, options);

        await actor.update(/** @type {any}*/({ "system.overcharge": state.data.level }));
        const heatEnabled = game.settings.get(game.system.id, "automationOptions")?.overcharge_heat;
        if (heatEnabled)
        {
            const applied = immune ? 0 : Math.floor(rollTotal / 2);
            await actor.update(/** @type {any}*/({ "system.heat.value": actor.system.heat.value + applied }));
        }
        return true;
    });
}

export function wrapApplyOverkillHeat(flowSteps)
{
    const orig = flowSteps.get('applyOverkillHeat');
    if (!orig)
        return;

    flowSteps.set('applyOverkillHeat', async function wrappedApplyOverkillHeat(state, options)
    {
        const actor = /** @type {Actor}*/(state.actor);
        if (!actor || !state.data?.overkill)
            return orig(state, options);

        const { immune, resisted } = getHeatMitigation(actor);
        if (!immune && !resisted)
            return orig(state, options);

        let overkillHeat = 0;
        const results = state.data.has_crit_hit ? state.data.crit_damage_results : state.data.damage_results;
        for (const entry of (results ?? []))
        {
            for (const term of (entry.roll?.terms ?? []))
            {
                for (const die of (Array.isArray(term.results) ? term.results : []))
                {
                    if (die.exploded)
                        overkillHeat += 1;
                }
            }
        }
        state.data.overkill_heat = overkillHeat;

        if ((actor.is_mech?.() || actor.is_npc?.() || actor.is_deployable?.()) && (actor.system.heat?.max ?? 0) > 0)
        {
            const applied = immune ? 0 : Math.floor(overkillHeat / 2);
            await actor.update(/** @type {any}*/({ "system.heat.value": (Number(actor.system.heat.value) || 0) + applied }));
        }
        return true;
    });
}

export function wrapExtraActionRecharge(flowSteps, flows)
{
    // (a) Wrap findRechargeableSystems so the flow doesn't abort when only
    //     extra actions need recharging (no native tg_recharge items).
    const origFind = flowSteps.get('findRechargeableSystems');
    if (origFind)
    {
        flowSteps.set('findRechargeableSystems', async function wrappedFindRechargeableSystems(state)
        {
            const result = await origFind.call(this, state);

            let hasExtraRechargeables = false;
            for (const item of state.actor.items)
            {
                const extraActions = item.getFlag('lancer-automations', 'extraActions') || [];
                if (extraActions.some(action => action.recharge && action.charged === false))
                {
                    hasExtraRechargeables = true; break;
                }
            }
            if (!hasExtraRechargeables)
            {
                const actorExtraActions = state.actor.getFlag('lancer-automations', 'extraActions') || [];
                if (actorExtraActions.some(action => action.recharge && action.charged === false))
                    hasExtraRechargeables = true;
            }
            if (hasExtraRechargeables)
            {
                state.data.la_hasExtraRechargeables = true;
                return true;
            }
            return result;
        });
    }

    // (b) After Lancer applies native recharges, apply the same roll to extra actions.
    flowSteps.set('lancer-automations:rechargeExtraActions', async function rechargeExtraActions(state)
    {
        if (!state.data?.la_hasExtraRechargeables)
            return true;
        if (!state.data?.result?.roll)
            return true;
        const rollTotal = state.data.result.roll.total;

        for (const item of state.actor.items)
        {
            const extraActions = item.getFlag('lancer-automations', 'extraActions') || [];
            let changed = false;
            for (const action of extraActions)
            {
                if (action.recharge && action.charged === false)
                {
                    const recharged = rollTotal >= action.recharge;
                    action.charged = recharged;
                    state.data.charged.push({ name: action.name, target: action.recharge, charged: recharged });
                    changed = true;
                }
            }
            if (changed)
                await item.setFlag('lancer-automations', 'extraActions', extraActions);
        }
        const actorActions = state.actor.getFlag('lancer-automations', 'extraActions') || [];
        let actorChanged = false;
        for (const action of actorActions)
        {
            if (action.recharge && action.charged === false)
            {
                const recharged = rollTotal >= action.recharge;
                action.charged = recharged;
                state.data.charged.push({ name: action.name, target: action.recharge, charged: recharged });
                actorChanged = true;
            }
        }
        if (actorChanged)
            await state.actor.setFlag('lancer-automations', 'extraActions', actorActions);
        return true;
    });
    flows.get('NPCRechargeFlow')?.insertStepAfter('applyRecharge', 'lancer-automations:rechargeExtraActions');

    // (c) Block activation of uncharged extra actions (mirrors Lancer's own
    //     recharge check but for extra actions on SimpleActivationFlow).
    flowSteps.set('lancer-automations:checkExtraActionRecharge', async function checkExtraActionRecharge(state)
    {
        const action = state.data?.action;
        if (action?.recharge && action?.charged === false)
        {
            ui.notifications.warn(`${action.name} has not recharged! (Recharge ${action.recharge}+)`);
            return false;
        }
        return true;
    });
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', 'lancer-automations:checkExtraActionRecharge');
}
