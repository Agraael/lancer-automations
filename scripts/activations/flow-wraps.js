/* global document, MutationObserver, Roll, game, ui, Number */

import { ActiveFlowState } from './flows.js';
import {
    injectNoBonusDmgCheckbox,
    getImmunityBonuses,
    checkDamageResistances
} from '../bonuses/genericBonuses.js';

export async function noBonusDmgInjectStep(state) {
    if (ActiveFlowState.current?._csmNoBonusDmg) {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
    }
    injectNoBonusDmgCheckbox(state);
    return true;
}

/**
 * Wraps rollNormalDamage and rollCritDamage so that when No Bonus Dmg is active,
 * bonus_damage is cleared immediately before each roll step executes.
 */
export function wrapRollDamageForNoBonusDmg(flowSteps) {
    for (const stepName of ['rollNormalDamage', 'rollCritDamage']) {
        const orig = flowSteps.get(stepName);
        if (!orig)
            continue;
        flowSteps.set(stepName, async function noBonusDmgWrapped(state) {
            if (ActiveFlowState.current?._csmNoBonusDmg && !state.la_extraData?._csmNoBonusDmg) {
                state.la_extraData = state.la_extraData || {};
                state.la_extraData._csmNoBonusDmg = { ...ActiveFlowState.current._csmNoBonusDmg };
            }
            if (state.la_extraData?._csmNoBonusDmg?.enabled) {
                state.data.bonus_damage = [];
                for (const t of (state.data.damage_hud_data?.targets || [])) {
                    t.bonusDamage = [];
                }
            }
            return orig(state);
        });
    }
}

export function wrapStatRollFlatModifier(flowSteps) {
    const orig = flowSteps.get('showStatRollHUD');
    if (!orig) {
        return;
    }
    flowSteps.set('showStatRollHUD', async function wrappedShowStatRollHUD(state) {
        if (!state.data) {
            throw new TypeError('Stat roll flow state missing!');
        }
        const bonus = state.data.bonus || 0;
        let flatMod = 0;

        const observer = new MutationObserver(() => {
            const dialog = document.getElementById('hase-accdiff-dialog');
            if (!dialog || dialog.querySelector('.la-stat-flat-mod')) {
                return;
            }
            observer.disconnect();
            flatMod = 0;
            _injectStatFlatModRow(dialog, bonus, (v) => {
                flatMod = v;
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const result = await orig(state);
        observer.disconnect();

        if (result !== false && flatMod !== 0) {
            state.data.bonus = bonus + flatMod;
            const accTotal = state.data.acc_diff?.base?.total || 0;
            const accStr = accTotal !== 0 ? ` + ${accTotal}d6kh1` : '';
            state.data.roll_str = `1d20+${state.data.bonus}${accStr}`;
        }
        return result;
    });
}

// Builds DOM matching the Lancer system's Svelte accdiff-flat-bonus structure.
function _injectStatFlatModRow(dialog, bonus, onChange) {
    // Detect v3's current svelte scope class from a sibling .accdiff-grid (svelte scope hashes
    // rebuild on every Lancer release; hardcoding breaks on update).
    const _scope = (() => {
        const ref = dialog.querySelector('.accdiff-grid, .accdiff-other-grid');
        if (!ref) return '';
        for (const cls of ref.classList) {
            if (cls.startsWith('svelte-')) return cls;
        }
        return '';
    })();

    // Label: identical to the attack dialog's "Flat Modifier" header.
    const label = document.createElement('label');
    label.className = 'flexrow accdiff-weight lancer-border-primary';
    label.setAttribute('for', 'accdiff-flat-bonus');
    label.textContent = 'Flat Modifier';

    // Container grid: matches accdiff-grid accdiff-flat-bonus.
    const grid = document.createElement('div');
    grid.className = `la-stat-flat-mod accdiff-grid accdiff-flat-bonus ${_scope}`.trim();

    // Left column: "Base: +N"
    const leftCol = document.createElement('div');
    leftCol.className = `accdiff-other-grid ${_scope}`.trim();
    const leftSpan = document.createElement('span');
    leftSpan.className = _scope;
    const leftB = document.createElement('b');
    leftB.textContent = 'Base:';
    leftSpan.appendChild(leftB);
    leftSpan.append(` ${bonus >= 0 ? '+' : ''}${bonus}`);
    leftCol.appendChild(leftSpan);

    // Middle column: input + plus/minus buttons
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

    // Right column: "Total: +N"
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

    const update = () => {
        const v = Number(input.value) || 0;
        onChange(v);
        const total = bonus + v;
        totalText.textContent = (total >= 0 ? '+' : '') + total;
    };
    input.addEventListener('input', update);
    plusBtn.addEventListener('click', () => {
        input.value = String((Number(input.value) || 0) + 1);
        update();
    });
    minusBtn.addEventListener('click', () => {
        input.value = String((Number(input.value) || 0) - 1);
        update();
    });
}

export function wrapRollReliable(flowSteps) {
    const origRollReliable = flowSteps.get('rollReliable');
    if (!origRollReliable)
        return;

    flowSteps.set('rollReliable', async function wrappedRollReliable(state) {
        const result = await origRollReliable(state);
        if (result === false && state.data?._csmKnockback?.enabled) {
            // No damage configured but knockback is pending; let the flow continue
            return true;
        }
        return result;
    });
}

export function wrapApplySelfHeat(flowSteps) {
    const origApplySelfHeat = flowSteps.get('applySelfHeat');
    if (!origApplySelfHeat)
        return;

    flowSteps.set('applySelfHeat', async function wrappedApplySelfHeat(state, options) {
        const actor = /** @type {Actor}*/(state.actor);
        // Only intercept when there's self_heat to process
        if (!actor || !state.data?.self_heat) {
            return origApplySelfHeat(state, options);
        }

        // --- Heat Immunity check (lancer-automations bonus system) ---
        const heatImmune = getImmunityBonuses(actor, "damage")
            .some(b => b.damageTypes?.some(t => ['heat', 'all'].includes(t.toLowerCase())));

        if (heatImmune) {
            // Zero out self_heat so original step skips the roll and applies 0
            const savedSelfHeat = state.data.self_heat;
            state.data.self_heat = undefined;
            const result = await origApplySelfHeat(state, options);
            state.data.self_heat = savedSelfHeat; // restore for chat card
            return result;
        }

        // --- Heat Resistance check (native OR lancer-automations bonus) ---
        const isShredded = actor.system.statuses?.shredded;
        const hasResistance = !isShredded && (
            actor.system.resistances?.heat ||
            checkDamageResistances(actor, "heat").length > 0
        );

        if (hasResistance) {
            // Roll the self_heat ourselves, halve (floor), apply the halved value
            const roll = await new Roll(state.data.self_heat).evaluate();
            const halved = Math.floor(roll.total / 2);
            state.data.self_heat_result = { roll, tt: await roll.getTooltip() };

            const automationSettings = game.settings.get(game.system.id, "automationOptions");
            if (automationSettings?.attack_self_heat && (actor.is_mech() || actor.is_npc())) {
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

// ─── Extra-action recharge ──────────────────────────────────────────────────
// Extra actions (from addExtraActions) that carry `recharge: N, charged: bool`
// are processed by Lancer's NPCRechargeFlow using the same d6 roll.
export function wrapExtraActionRecharge(flowSteps, flows) {
    // (a) Wrap findRechargeableSystems so the flow doesn't abort when only
    //     extra actions need recharging (no native tg_recharge items).
    const origFind = flowSteps.get('findRechargeableSystems');
    if (origFind) {
        flowSteps.set('findRechargeableSystems', async function wrappedFindRechargeableSystems(state) {
            const result = await origFind.call(this, state);

            let hasExtraRechargeables = false;
            for (const item of state.actor.items) {
                const ea = item.getFlag('lancer-automations', 'extraActions') || [];
                if (ea.some(a => a.recharge && a.charged === false)) {
                    hasExtraRechargeables = true; break;
                }
            }
            if (!hasExtraRechargeables) {
                const actorEa = state.actor.getFlag('lancer-automations', 'extraActions') || [];
                if (actorEa.some(a => a.recharge && a.charged === false))
                    hasExtraRechargeables = true;
            }
            if (hasExtraRechargeables) {
                state.data.la_hasExtraRechargeables = true;
                return true;
            }
            return result;
        });
    }

    // (b) After Lancer applies native recharges, apply the same roll to extra actions.
    flowSteps.set('lancer-automations:rechargeExtraActions', async function rechargeExtraActions(state) {
        if (!state.data?.la_hasExtraRechargeables)
            return true;
        if (!state.data?.result?.roll)
            return true;
        const rollTotal = state.data.result.roll.total;

        for (const item of state.actor.items) {
            const extraActions = item.getFlag('lancer-automations', 'extraActions') || [];
            let changed = false;
            for (const action of extraActions) {
                if (action.recharge && action.charged === false) {
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
        for (const action of actorActions) {
            if (action.recharge && action.charged === false) {
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
    flowSteps.set('lancer-automations:checkExtraActionRecharge', async function checkExtraActionRecharge(state) {
        const action = state.data?.action;
        if (action?.recharge && action?.charged === false) {
            ui.notifications.warn(`${action.name} has not recharged! (Recharge ${action.recharge}+)`);
            return false;
        }
        return true;
    });
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', 'lancer-automations:checkExtraActionRecharge');
}
