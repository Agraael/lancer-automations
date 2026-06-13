/* global game, CONFIG, Hooks, foundry, ui */

const MODULE_ID = 'lancer-automations';
const SETTING_KEY = 'enablePerRoundTurnTags';
const TARGET_FLOWS = ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow', 'ActivationFlow', 'SystemFlow', 'CoreActiveFlow'];

function enabled() {
    try { return !!game.settings.get(MODULE_ID, SETTING_KEY); } catch { return false; }
}

function inCombat() {
    return !!game.combat?.started;
}

function tagLimit(item, lid) {
    const tag = item?.system?.tags?.find?.(t => t.lid === lid);
    if (!tag) return 0;
    const v = Number(tag.val ?? 1);
    return Number.isFinite(v) && v > 0 ? v : 1;
}

export function getPerRoundLimit(item) { return tagLimit(item, 'tg_round'); }
export function getPerTurnLimit(item) { return tagLimit(item, 'tg_turn'); }
export function getPerRoundUsed(item) { return Number(item?.system?.uses_per_round?.value ?? 0); }
export function getPerTurnUsed(item) { return Number(item?.system?.uses_per_turn?.value ?? 0); }
export function isPerRoundExhausted(item) { const lim = getPerRoundLimit(item); return lim > 0 && getPerRoundUsed(item) >= lim; }
export function isPerTurnExhausted(item) { const lim = getPerTurnLimit(item); return lim > 0 && getPerTurnUsed(item) >= lim; }

export function injectPerFrequencySchemaFields() {
    if (!enabled()) return;
    const NumberField = foundry.data.fields.NumberField;
    const SchemaField = foundry.data.fields.SchemaField;
    const itemTypes = ['mech_weapon', 'mech_system', 'pilot_weapon', 'pilot_gear', 'pilot_armor', 'npc_feature', 'frame', 'talent', 'core_bonus'];
    for (const key of itemTypes) {
        const model = CONFIG.Item.dataModels?.[key];
        const fields = model?.schema?.fields;
        if (!fields) continue;
        if (!fields.uses_per_round) {
            try {
                fields.uses_per_round = new SchemaField({ value: new NumberField({ initial: 0, integer: true, min: 0 }) });
            } catch (e) { console.warn(`${MODULE_ID} | uses_per_round inject failed on ${key}:`, e); }
        }
        if (!fields.uses_per_turn) {
            try {
                fields.uses_per_turn = new SchemaField({ value: new NumberField({ initial: 0, integer: true, min: 0 }) });
            } catch (e) { console.warn(`${MODULE_ID} | uses_per_turn inject failed on ${key}:`, e); }
        }
    }
}

async function checkPerFrequencyStep(state) {
    if (!enabled() || !inCombat()) return true;
    const item = state.item;
    if (!item) return true;
    if (isPerRoundExhausted(item)) {
        ui.notifications.warn(`${item.name}: per-round limit reached (${getPerRoundUsed(item)}/${getPerRoundLimit(item)}).`);
        return false;
    }
    if (isPerTurnExhausted(item)) {
        ui.notifications.warn(`${item.name}: per-turn limit reached (${getPerTurnUsed(item)}/${getPerTurnLimit(item)}).`);
        return false;
    }
    return true;
}

async function consumePerFrequencyStep(state) {
    if (!enabled() || !inCombat()) return true;
    const item = state.item;
    if (!item) return true;
    const updates = {};
    if (getPerRoundLimit(item) > 0) updates['system.uses_per_round.value'] = getPerRoundUsed(item) + 1;
    if (getPerTurnLimit(item) > 0) updates['system.uses_per_turn.value'] = getPerTurnUsed(item) + 1;
    if (Object.keys(updates).length) await item.update(updates);
    return true;
}

async function resetPerFrequencyOnRepairStep(state) {
    if (!state.actor) return true;
    const updates = [];
    for (const item of state.actor.items) {
        const patch = { _id: item.id };
        let touched = false;
        if (getPerRoundLimit(item) > 0 && getPerRoundUsed(item) > 0) {
            patch['system.uses_per_round.value'] = 0;
            touched = true;
        }
        if (getPerTurnLimit(item) > 0 && getPerTurnUsed(item) > 0) {
            patch['system.uses_per_turn.value'] = 0;
            touched = true;
        }
        if (touched) updates.push(patch);
    }
    if (updates.length) await state.actor.updateEmbeddedDocuments('Item', updates);
    return true;
}

export function registerPerFrequencyFlowSteps(flowSteps, flows) {
    if (!enabled()) return;
    flowSteps.set('lancer-automations:checkPerFrequency', checkPerFrequencyStep);
    flowSteps.set('lancer-automations:consumePerFrequency', consumePerFrequencyStep);
    flowSteps.set('lancer-automations:resetPerFrequencyOnRepair', resetPerFrequencyOnRepairStep);
    for (const name of TARGET_FLOWS) {
        const flow = flows.get(name);
        if (!flow) continue;
        try { flow.insertStepAfter('checkItemCharged', 'lancer-automations:checkPerFrequency'); } catch {}
        try { flow.insertStepBefore('printActionUseCard', 'lancer-automations:consumePerFrequency'); }
        catch {
            try { flow.insertStepAfter('updateItemAfterAction', 'lancer-automations:consumePerFrequency'); } catch {}
        }
    }
    try { flows.get('FullRepairFlow')?.insertStepAfter('executeFullRepair', 'lancer-automations:resetPerFrequencyOnRepair'); } catch {}
}

async function resetForCombatants(combatants, scope) {
    if (!game.users.activeGM?.isSelf) return;
    const field = scope === 'round' ? 'uses_per_round' : 'uses_per_turn';
    const limitFn = scope === 'round' ? getPerRoundLimit : getPerTurnLimit;
    for (const cb of combatants) {
        const actor = cb.actor;
        if (!actor?.items) continue;
        const updates = [];
        for (const item of actor.items) {
            if (limitFn(item) > 0 && Number(item.system?.[field]?.value ?? 0) > 0) {
                updates.push({ _id: item.id, [`system.${field}.value`]: 0 });
            }
        }
        if (updates.length) await actor.updateEmbeddedDocuments('Item', updates);
    }
}

export function initPerFrequencyHooks() {
    if (!enabled()) return;
    Hooks.on('combatTurn', async (combat, _changed) => {
        const prev = combat.combatants.get(combat.previous?.combatantId);
        const curr = combat.combatants.get(combat.current?.combatantId);
        const set = [prev, curr].filter(Boolean);
        if (set.length) await resetForCombatants(set, 'turn');
    });
    Hooks.on('combatRound', async (combat, _changed, options) => {
        if (options?.direction === -1) return;
        await resetForCombatants(combat.combatants, 'round');
        await resetForCombatants(combat.combatants, 'turn');
    });
    Hooks.on('deleteCombat', async (combat) => {
        await resetForCombatants(combat.combatants, 'round');
        await resetForCombatants(combat.combatants, 'turn');
    });
}

function pipsHtmlStandard(max, used, iconReady, iconConsumed, field) {
    const ready = Math.max(0, max - Math.min(max, used));
    const dim = !inCombat() ? 'opacity:0.5;' : '';
    const out = [];
    for (let i = 0; i < max; i++) {
        const isReady = i < ready;
        out.push(`<span class="la-pf-pip mdi ${isReady ? iconReady : iconConsumed}" data-field="${field}" data-index="${i + 1}" style="cursor:pointer;font-size:1.3em;color:#ffffff;${dim}padding:0 1px;"></span>`);
    }
    return out.join('');
}

function pipsHtmlAlt(max, used, iconReady, iconConsumed, field) {
    const ready = Math.max(0, max - Math.min(max, used));
    const dim = !inCombat() ? 'opacity:0.5;' : '';
    const out = [];
    for (let i = 0; i < max; i++) {
        const isReady = i < ready;
        out.push(`<button type="button" class="la-pf-pip la-counterbox__button mdi ${isReady ? iconReady : iconConsumed} la-prmy-header -glow-prmy la-scdy-primary -glow-scdy-hover -fontsize7" data-field="${field}" data-index="${i + 1}" data-available="${isReady}" style="${dim}"></button>`);
    }
    return out.join('');
}

function buildBadgeStandard(item) {
    const r = getPerRoundLimit(item);
    const t = getPerTurnLimit(item);
    if (!r && !t) return '';
    const blocks = [];
    if (r) blocks.push(`<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}"><span style="margin:4px;">PER ROUND</span>${pipsHtmlStandard(r, getPerRoundUsed(item), 'mdi-restart', 'mdi-restart-off', 'uses_per_round')}</div>`);
    if (t) blocks.push(`<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}"><span style="margin:4px;">PER TURN</span>${pipsHtmlStandard(t, getPerTurnUsed(item), 'mdi-circle-slice-8', 'mdi-circle-outline', 'uses_per_turn')}</div>`);
    return blocks.join('');
}

function buildBadgeAlt(item) {
    const r = getPerRoundLimit(item);
    const t = getPerTurnLimit(item);
    if (!r && !t) return '';
    const blocks = [];
    const wrap = (label, pips) => `<div class="la-counterbox la-flexrow -aligncenter la-text-header -padding1-lr clipped-alt -widthfull la-bckg-header-anti la-pf-card" data-item-id="${item.id}"><span class="la-counterbox__span -fontsizemedium">${label}</span>${pips}</div>`;
    if (r) blocks.push(wrap('PER ROUND', pipsHtmlAlt(r, getPerRoundUsed(item), 'mdi-restart', 'mdi-restart-off', 'uses_per_round')));
    if (t) blocks.push(wrap('PER TURN', pipsHtmlAlt(t, getPerTurnUsed(item), 'mdi-circle-slice-8', 'mdi-circle-outline', 'uses_per_turn')));
    return blocks.join('');
}

function bindPipClicks(root, actor) {
    root.querySelectorAll('.la-pf-pip').forEach(pip => {
        pip.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            const card = pip.closest('.la-pf-card');
            const itemId = card?.getAttribute('data-item-id');
            const item = itemId && actor?.items?.get(itemId);
            if (!item) return;
            const field = pip.getAttribute('data-field');
            const idx = Number(pip.getAttribute('data-index'));
            const current = Number(item.system?.[field]?.value ?? 0);
            const next = idx === current ? idx - 1 : idx;
            await item.update({ [`system.${field}.value`]: Math.max(0, next) });
        });
    });
}

export function onRenderActorSheetPerFrequency(app, html) {
    if (!enabled()) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const actor = app.actor ?? app.document;
    if (!root || !actor?.items) return;
    const isAlt = !!root.querySelector('.la-root, .la-common, .la-counterbox');
    for (const el of root.querySelectorAll('[data-item-id]')) {
        const id = el.getAttribute('data-item-id');
        const item = actor.items.get(id);
        if (!item) continue;
        if (isAlt) {
            const existingCounter = el.querySelector(':scope .la-counterbox:not(.la-pf-card)');
            const container = existingCounter ? existingCounter.parentElement : el;
            if (!container) continue;
            if (container.querySelector(`:scope > .la-pf-card[data-item-id="${id}"]`)) continue;
            const html2 = buildBadgeAlt(item);
            if (!html2) continue;
            if (existingCounter) existingCounter.insertAdjacentHTML('afterend', html2);
            else container.insertAdjacentHTML('beforeend', html2);
        } else {
            const body = el.querySelector(':scope .lancer-body') ?? el;
            if (body.querySelector(`:scope > .la-pf-card[data-item-id="${id}"]`)) continue;
            const html2 = buildBadgeStandard(item);
            if (!html2) continue;
            const charged = body.querySelector(':scope > .charged-box:not(.la-pf-card)');
            const limited = body.querySelector(':scope > .limited-card:not(.la-pf-card)');
            const anchor = charged ?? limited;
            if (anchor) anchor.insertAdjacentHTML('afterend', html2);
            else body.insertAdjacentHTML('afterbegin', html2);
        }
    }
    bindPipClicks(root, actor);
}
