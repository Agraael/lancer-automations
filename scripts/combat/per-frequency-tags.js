/* global game, CONFIG, Hooks, foundry, ui */

import { getAutoConsumeDisabled, getSubAutoConsumeDisabled, getConsumeOn } from '../interactive/extra-config.js';
import { getSettingEnabled } from '../setup/settings-register.js';

const MODULE_ID = 'lancer-automations';
const SETTING_KEY = 'enablePerRoundTurnTags';
const TARGET_FLOWS = ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow', 'ActivationFlow', 'SystemFlow', 'CoreActiveFlow'];

function enabled()
{
    return getSettingEnabled(SETTING_KEY, MODULE_ID);
}

function inCombat()
{
    return !!game.combat?.started;
}

function tagLimit(item, lid)
{
    let best = 0;
    for (const tag of itemAllTags(item))
    {
        if (tag?.lid !== lid)
            continue;
        const rawLimit = Number(tag.val ?? 1);
        best = Math.max(best, Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1);
    }
    return best;
}

// Tags that gate resource badges/pips/consume. Accepts an item or a system object.
export function itemAllTags(itemOrSys)
{
    const sys = itemOrSys?.system ?? itemOrSys;
    if (!sys)
        return [];
    return [...(sys.active_profile?.tags ?? []), ...(sys.all_base_tags ?? sys.tags ?? [])];
}

const _RX_SCENE = /(\d+)\s*\/\s*scene\b/i;
const _RX_ROUND = /(\d+)\s*\/\s*round\b/i;
const _RX_TURN = /(\d+)\s*\/\s*turn\b/i;
// Free text only counts when the frequency opens it (leading whitespace / HTML tags allowed).
const _TEXT_LEAD = String.raw`^(?:\s|<[^>]*>|&nbsp;)*`;
const _RX_SCENE_START = new RegExp(_TEXT_LEAD + String.raw`(\d+)\s*\/\s*scene\b`, 'i');
const _RX_ROUND_START = new RegExp(_TEXT_LEAD + String.raw`(\d+)\s*\/\s*round\b`, 'i');
const _RX_TURN_START = new RegExp(_TEXT_LEAD + String.raw`(\d+)\s*\/\s*turn\b`, 'i');
const _USE_SCENE = new Set(['encounter', 'scene']);
const _USE_ROUND = new Set(['round']);
const _USE_TURN = new Set(['turn']);

function activeProfile(sys)
{
    return sys?.active_profile ?? sys?.profiles?.[sys?.selected_profile_index ?? 0] ?? null;
}

function hitTexts(sys)
{
    const profile = activeProfile(sys);
    return [sys?.on_hit, sys?.on_crit, profile?.on_hit, profile?.on_crit];
}

// Item-level sources only. Nested action frequencies get their own counter (see flowSub).
function scanFreqLimit(sys, rx, useSet, textRx = rx, { hitText = true } = {})
{
    if (!sys)
        return 0;
    let best = 0;
    const bump = (value) =>
    {
        if (Number.isFinite(value) && value > best)
            best = value;
    };
    const fromFreq = (entries) =>
    {
        for (const entry of entries ?? [])
        {
            const match = rx.exec(String(entry?.frequency ?? ''));
            if (match)
                bump(parseInt(match[1]) || 0);
        }
    };
    const fromText = (str) =>
    {
        const match = textRx.exec(String(str ?? ''));
        if (match)
            bump(parseInt(match[1]) || 0);
    };
    const fromUse = (use) =>
    {
        if (use && useSet.has(String(use).toLowerCase()))
            bump(1);
    };
    fromFreq(sys.powers);
    fromUse(sys.use);
    fromText(sys.effect);
    fromText(sys.description);
    fromText(activeProfile(sys)?.effect);
    if (hitText)
        hitTexts(sys).forEach(fromText);
    // Skip core_system: core power is already gated by system.core_energy.
    return best;
}

const SCOPES = [
    { type: 'perRound', label: 'round', field: 'uses_per_round', rx: _RX_ROUND, useSet: _USE_ROUND, textRx: _RX_ROUND_START, combatOnly: true, limit: (item) => getPerRoundLimit(item), subLimit: (sub) => getPerRoundLimitFromSub(sub) },
    { type: 'perTurn', label: 'turn', field: 'uses_per_turn', rx: _RX_TURN, useSet: _USE_TURN, textRx: _RX_TURN_START, combatOnly: true, limit: (item) => getPerTurnLimit(item), subLimit: (sub) => getPerTurnLimitFromSub(sub) },
    { type: 'perScene', label: 'scene', field: 'uses_per_scene', rx: _RX_SCENE, useSet: _USE_SCENE, textRx: _RX_SCENE_START, combatOnly: false, limit: (item) => getPerSceneLimit(item), subLimit: (sub) => getPerSceneLimitFromSub(sub) },
];

// Scopes whose only text source is on_hit / on_crit.
export function detectHitGatedScopes(item)
{
    const sys = item?.system;
    return SCOPES
        .filter(scope => scanFreqLimit(sys, scope.rx, scope.useSet, scope.textRx, { hitText: false }) === 0
            && scanFreqLimit(sys, scope.rx, scope.useSet, scope.textRx) > 0)
        .map(scope => scope.type);
}

// Detection plus the item's consumeOn override: a weapon attack spends these on a hit only.
export function hitGatedScopes(item)
{
    const detected = new Set(detectHitGatedScopes(item));
    return SCOPES.filter(scope =>
    {
        const mode = getConsumeOn(item, scope.type);
        if (mode === 'hit')
            return scope.limit(item) > 0;
        if (mode === 'activation')
            return false;
        return detected.has(scope.type);
    }).map(scope => scope.type);
}

function scanFreqLimitFromSub(sub, rx, useSet, textRx = rx)
{
    if (!sub || sub._coreActive)
        return 0;
    let best = 0;
    const bump = (value) =>
    {
        if (Number.isFinite(value) && value > best)
            best = value;
    };
    const scan = (str, regex) =>
    {
        const match = regex.exec(String(str ?? ''));
        if (match)
            bump(parseInt(match[1]) || 0);
    };
    scan(sub.frequency, rx);
    scan(sub.description, textRx);
    scan(sub.effect ?? sub.detail, textRx);
    for (const entry of sub.actions ?? [])
        scan(entry?.frequency, rx);
    if (sub.use && useSet.has(String(sub.use).toLowerCase()))
        bump(1);
    return best;
}

export function getPerRoundLimit(item)
{
    return Math.max(tagLimit(item, 'tg_round'), scanFreqLimit(item?.system, _RX_ROUND, _USE_ROUND, _RX_ROUND_START));
}
export function getPerTurnLimit(item)
{
    return Math.max(tagLimit(item, 'tg_turn'), scanFreqLimit(item?.system, _RX_TURN, _USE_TURN, _RX_TURN_START));
}
export function getPerSceneLimit(item)
{
    return scanFreqLimit(item?.system, _RX_SCENE, _USE_SCENE, _RX_SCENE_START);
}
export function getPerRoundLimitFromSub(sub)
{
    return scanFreqLimitFromSub(sub, _RX_ROUND, _USE_ROUND, _RX_ROUND_START);
}
export function getPerTurnLimitFromSub(sub)
{
    return scanFreqLimitFromSub(sub, _RX_TURN, _USE_TURN, _RX_TURN_START);
}
export function getPerSceneLimitFromSub(sub)
{
    return scanFreqLimitFromSub(sub, _RX_SCENE, _USE_SCENE, _RX_SCENE_START);
}

const SUB_FLAG = 'perFreqSub';

export function rankSubKey(rankIdx)
{
    return `r${rankIdx}`;
}
export function getSubUses(item, subKey)
{
    return item?.getFlag?.(MODULE_ID, SUB_FLAG)?.[subKey] ?? {};
}
export function getSubUsed(item, subKey, field)
{
    return Number(getSubUses(item, subKey)?.[field]?.value ?? 0);
}
export async function patchSubUses(item, subKey, patch)
{
    const all = foundry.utils.duplicate(item.getFlag(MODULE_ID, SUB_FLAG) ?? {});
    all[subKey] = { ...all[subKey], ...patch };
    await item.setFlag(MODULE_ID, SUB_FLAG, all);
}

export function subHasLimits(sub)
{
    return getPerRoundLimitFromSub(sub) > 0 || getPerTurnLimitFromSub(sub) > 0 || getPerSceneLimitFromSub(sub) > 0;
}

// Nested actions with their own frequency, keyed like flowSub keys them.
export function itemActionSubs(item)
{
    const sys = item?.system;
    if (!sys)
        return [];
    const subs = [];
    const seen = new Set();
    const addSub = (key, action) =>
    {
        const identity = `${action?.name ?? ''}|${action?.activation ?? ''}`;
        if (seen.has(identity))
            return;
        seen.add(identity);
        subs.push({ key, data: action, name: action?.name });
    };
    (sys.actions ?? []).forEach((action, idx) => addSub(`a${idx}`, action));
    const profIdx = sys.selected_profile_index ?? 0;
    (sys.profiles?.[profIdx]?.actions ?? []).forEach((action, idx) => addSub(`p${profIdx}a${idx}`, action));
    return subs.filter(sub => subHasLimits(sub.data));
}

export function actionSubKey(item, action)
{
    if (!action)
        return null;
    const match = itemActionSubs(item).find(entry => entry.data === action
        || (entry.data?.name === action.name && entry.data?.activation === action.activation));
    return match?.key ?? null;
}

// Resolves the sub-entry (talent rank or nested action) a flow targets, from Lancer's action_path.
function flowSub(state)
{
    const item = state?.item;
    const path = String(state?.data?.action_path ?? '');
    if (!item || !path)
        return null;
    const rankMatch = /^system\.ranks\.(\d+)\.actions\./.exec(path);
    if (rankMatch)
    {
        const rankIdx = Number(rankMatch[1]);
        const rank = item.system?.ranks?.[rankIdx];
        return rank && subHasLimits(rank) ? { key: rankSubKey(rankIdx), data: rank, name: rank.name } : null;
    }
    const actionMatch = /^system\.(?:actions\.(\d+)|profiles\.(\d+)\.actions\.(\d+))$/.exec(path);
    if (!actionMatch)
        return null;
    const key = actionMatch[1] != null ? `a${actionMatch[1]}` : `p${actionMatch[2]}a${actionMatch[3]}`;
    return itemActionSubs(item).find(entry => entry.key === key) ?? null;
}

export function getPerRoundUsed(item)
{
    return Number(item?.system?.uses_per_round?.value ?? 0);
}
export function getPerTurnUsed(item)
{
    return Number(item?.system?.uses_per_turn?.value ?? 0);
}
export function getPerSceneUsed(item)
{
    return Number(item?.system?.uses_per_scene?.value ?? 0);
}
export function injectPerFrequencySchemaFields()
{
    if (!enabled())
        return;
    const NumberField = foundry.data.fields.NumberField;
    const SchemaField = foundry.data.fields.SchemaField;
    const itemTypes = ['mech_weapon', 'mech_system', 'pilot_weapon', 'pilot_gear', 'pilot_armor', 'npc_feature', 'frame', 'talent', 'core_bonus'];
    for (const key of itemTypes)
    {
        const model = CONFIG.Item.dataModels?.[key];
        const fields = model?.schema?.fields;
        if (!fields)
            continue;
        if (!fields.uses_per_round)
        {
            try
            {
                fields.uses_per_round = new SchemaField({ value: new NumberField({ initial: 0, integer: true, min: 0 }) });
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | uses_per_round inject failed on ${key}:`, e);
            }
        }
        if (!fields.uses_per_turn)
        {
            try
            {
                fields.uses_per_turn = new SchemaField({ value: new NumberField({ initial: 0, integer: true, min: 0 }) });
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | uses_per_turn inject failed on ${key}:`, e);
            }
        }
        if (!fields.uses_per_scene)
        {
            try
            {
                fields.uses_per_scene = new SchemaField({ value: new NumberField({ initial: 0, integer: true, min: 0 }) });
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | uses_per_scene inject failed on ${key}:`, e);
            }
        }
    }
}

function scopeLimit(scope, item, sub)
{
    return sub ? scope.subLimit(sub.data) : scope.limit(item);
}

function scopeUsed(scope, item, sub)
{
    return sub ? getSubUsed(item, sub.key, scope.field) : Number(item?.system?.[scope.field]?.value ?? 0);
}

// Soft gate: warns on an exhausted limit, never aborts the flow.
async function checkPerFrequencyStep(state)
{
    if (!enabled())
        return true;
    const item = state.item;
    if (!item)
        return true;
    const sub = flowSub(state);
    const label = sub ? `${item.name} (${sub.name})` : item.name;
    const hitGated = new Set(sub ? [] : hitGatedScopes(item));
    for (const scope of SCOPES)
    {
        if (scope.combatOnly && !inCombat())
            continue;
        const limit = scopeLimit(scope, item, sub);
        const used = scopeUsed(scope, item, sub);
        if (limit <= 0 || used < limit)
            continue;
        ui.notifications.warn(hitGated.has(scope.type)
            ? `${label}: on-hit effect already used this ${scope.label} (${used}/${limit}).`
            : `${label}: per-${scope.label} limit reached (${used}/${limit}).`);
    }
    return true;
}

export async function consumePerFrequencyForItem(item, { skipTypes = null, sub = null } = {})
{
    if (!enabled() || !item)
        return;
    const skip = skipTypes ?? new Set();
    const patch = {};
    for (const scope of SCOPES)
    {
        if (skip.has(scope.type) || (scope.combatOnly && !inCombat()) || scopeLimit(scope, item, sub) <= 0)
            continue;
        patch[scope.field] = { value: scopeUsed(scope, item, sub) + 1 };
    }
    if (!Object.keys(patch).length)
        return;
    if (sub)
    {
        await patchSubUses(item, sub.key, patch);
        return;
    }
    const updates = {};
    for (const [field, entry] of Object.entries(patch))
        updates[`system.${field}.value`] = entry.value;
    await item.update(updates);
}

async function consumePerFrequencyStep(state)
{
    const item = state.item;
    const sub = flowSub(state);
    const skip = new Set(sub ? getSubAutoConsumeDisabled(item, sub.key) : getAutoConsumeDisabled(item));
    const missed = state.data?.type === 'weapon' && !(state.data?.hit_results ?? []).some(result => result?.hit);
    if (missed && !sub)
        hitGatedScopes(item).forEach(type => skip.add(type));
    await consumePerFrequencyForItem(item, { skipTypes: skip, sub });
    return true;
}

async function resetPerFrequencyOnRepairStep(state)
{
    if (!state.actor)
        return true;
    const updates = [];
    for (const item of state.actor.items)
    {
        const patch = { _id: item.id };
        let touched = false;
        if (getPerRoundLimit(item) > 0 && getPerRoundUsed(item) > 0)
        {
            patch['system.uses_per_round.value'] = 0;
            touched = true;
        }
        if (getPerTurnLimit(item) > 0 && getPerTurnUsed(item) > 0)
        {
            patch['system.uses_per_turn.value'] = 0;
            touched = true;
        }
        if (getPerSceneLimit(item) > 0 && getPerSceneUsed(item) > 0)
        {
            patch['system.uses_per_scene.value'] = 0;
            touched = true;
        }
        const subMap = item.getFlag?.(MODULE_ID, 'perFreqSub');
        for (const [subKey, entry] of Object.entries(subMap ?? {}))
        {
            for (const subField of ['uses_per_round', 'uses_per_turn', 'uses_per_scene'])
            {
                if (Number(entry?.[subField]?.value ?? 0) > 0)
                {
                    patch[`flags.${MODULE_ID}.perFreqSub.${subKey}.${subField}.value`] = 0;
                    touched = true;
                }
            }
        }
        if (touched)
            updates.push(patch);
    }
    if (updates.length)
        await state.actor.updateEmbeddedDocuments('Item', updates);
    return true;
}

export function registerPerFrequencyFlowSteps(flowSteps, flows)
{
    if (!enabled())
        return;
    flowSteps.set('lancer-automations:checkPerFrequency', checkPerFrequencyStep);
    flowSteps.set('lancer-automations:consumePerFrequency', consumePerFrequencyStep);
    flowSteps.set('lancer-automations:resetPerFrequencyOnRepair', resetPerFrequencyOnRepairStep);
    for (const name of TARGET_FLOWS)
    {
        const flow = flows.get(name);
        if (!flow?.steps)
            continue;
        if (flow.steps.includes('checkItemCharged'))
            flow.insertStepAfter('checkItemCharged', 'lancer-automations:checkPerFrequency');
        if (flow.steps.includes('updateItemAfterAction'))
            flow.insertStepAfter('updateItemAfterAction', 'lancer-automations:consumePerFrequency');
        else if (flow.steps.includes('printActionUseCard'))
            flow.insertStepBefore('printActionUseCard', 'lancer-automations:consumePerFrequency');
    }
    try
    {
        flows.get('FullRepairFlow')?.insertStepAfter('executeFullRepair', 'lancer-automations:resetPerFrequencyOnRepair');
    }
    catch
    {}
}

async function resetForCombatants(combatants, scope)
{
    if (!game.users.activeGM?.isSelf)
        return;
    const field = scope === 'round' ? 'uses_per_round'
        : scope === 'turn' ? 'uses_per_turn'
            : 'uses_per_scene';
    const limitFn = scope === 'round' ? getPerRoundLimit
        : scope === 'turn' ? getPerTurnLimit
            : getPerSceneLimit;
    for (const cb of combatants)
    {
        const actor = cb.actor;
        if (!actor?.items)
            continue;
        const updates = [];
        for (const item of actor.items)
        {
            const patch = { _id: item.id };
            let touched = false;
            if (limitFn(item) > 0 && Number(item.system?.[field]?.value ?? 0) > 0)
            {
                patch[`system.${field}.value`] = 0;
                touched = true;
            }
            const subMap = item.getFlag?.(MODULE_ID, 'perFreqSub');
            for (const [subKey, entry] of Object.entries(subMap ?? {}))
            {
                if (Number(entry?.[field]?.value ?? 0) > 0)
                {
                    patch[`flags.${MODULE_ID}.perFreqSub.${subKey}.${field}.value`] = 0;
                    touched = true;
                }
            }
            if (touched)
                updates.push(patch);
        }
        if (updates.length)
            await actor.updateEmbeddedDocuments('Item', updates);
    }
}


export function initPerFrequencyHooks()
{
    if (!enabled())
        return;
    Hooks.on('combatTurn', async (combat, _changed) =>
    {
        const prev = combat.combatants.get(combat.previous?.combatantId);
        const curr = combat.combatants.get(combat.current?.combatantId);
        const pair = [prev, curr].filter(Boolean);
        if (pair.length)
            await resetForCombatants(pair, 'turn');
    });
    Hooks.on('combatRound', async (combat, _changed, options) =>
    {
        if (options?.direction === -1)
            return;
        await resetForCombatants(combat.combatants, 'round');
        await resetForCombatants(combat.combatants, 'turn');
    });
    // Per-scene = per combat encounter.
    Hooks.on('combatStart', async (combat) =>
    {
        await resetForCombatants(combat.combatants, 'scene');
    });
    Hooks.on('deleteCombat', async (combat) =>
    {
        await resetForCombatants(combat.combatants, 'round');
        await resetForCombatants(combat.combatants, 'turn');
        await resetForCombatants(combat.combatants, 'scene');
    });
}

function pipsHtmlStandard(max, used, iconReady, iconConsumed, field)
{
    const ready = Math.max(0, max - Math.min(max, used));
    const dimStyle = !inCombat() ? 'opacity:0.5;' : '';
    const pips = [];
    for (let i = 0; i < max; i++)
    {
        const isReady = i < ready;
        pips.push(`<span class="la-pf-pip mdi ${isReady ? iconReady : iconConsumed}" data-field="${field}" data-index="${i + 1}" style="cursor:pointer;font-size:1.3em;color:#ffffff;${dimStyle}padding:0 1px;"></span>`);
    }
    return pips.join('');
}

function pipsHtmlAlt(max, used, iconReady, iconConsumed, field)
{
    const ready = Math.max(0, max - Math.min(max, used));
    const dimStyle = !inCombat() ? 'opacity:0.5;' : '';
    const pips = [];
    for (let i = 0; i < max; i++)
    {
        const isReady = i < ready;
        pips.push(`<button type="button" class="la-pf-pip la-counterbox__button mdi ${isReady ? iconReady : iconConsumed} la-prmy-header -glow-prmy la-scdy-primary -glow-scdy-hover -fontsize7" data-field="${field}" data-index="${i + 1}" data-available="${isReady}" style="${dimStyle}"></button>`);
    }
    return pips.join('');
}

function buildBadgeStandard(item)
{
    const roundLimit = getPerRoundLimit(item);
    const turnLimit = getPerTurnLimit(item);
    const sceneLimit = getPerSceneLimit(item);
    if (!roundLimit && !turnLimit && !sceneLimit)
        return '';
    const blocks = [];
    if (roundLimit)
        blocks.push(`<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}"><span style="margin:4px;">PER ROUND</span>${pipsHtmlStandard(roundLimit, getPerRoundUsed(item), 'mdi-restart', 'mdi-restart-off', 'uses_per_round')}</div>`);
    if (turnLimit)
        blocks.push(`<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}"><span style="margin:4px;">PER TURN</span>${pipsHtmlStandard(turnLimit, getPerTurnUsed(item), 'mdi-circle-slice-8', 'mdi-circle-outline', 'uses_per_turn')}</div>`);
    if (sceneLimit)
        blocks.push(`<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}"><span style="margin:4px;">PER SCENE</span>${pipsHtmlStandard(sceneLimit, getPerSceneUsed(item), 'mdi-cog', 'mdi-cog-off', 'uses_per_scene')}</div>`);
    return blocks.join('');
}

function buildBadgeAlt(item)
{
    const roundLimit = getPerRoundLimit(item);
    const turnLimit = getPerTurnLimit(item);
    const sceneLimit = getPerSceneLimit(item);
    if (!roundLimit && !turnLimit && !sceneLimit)
        return '';
    const blocks = [];
    const wrap = (label, pips) => `<div class="la-counterbox la-flexrow -aligncenter la-text-header -padding1-lr clipped-alt -widthfull la-bckg-header-anti la-pf-card" data-item-id="${item.id}"><span class="la-counterbox__span -fontsizemedium">${label}</span>${pips}</div>`;
    if (roundLimit)
        blocks.push(wrap('PER ROUND', pipsHtmlAlt(roundLimit, getPerRoundUsed(item), 'mdi-restart', 'mdi-restart-off', 'uses_per_round')));
    if (turnLimit)
        blocks.push(wrap('PER TURN', pipsHtmlAlt(turnLimit, getPerTurnUsed(item), 'mdi-circle-slice-8', 'mdi-circle-outline', 'uses_per_turn')));
    if (sceneLimit)
        blocks.push(wrap('PER SCENE', pipsHtmlAlt(sceneLimit, getPerSceneUsed(item), 'mdi-cog', 'mdi-cog-off', 'uses_per_scene')));
    return blocks.join('');
}

function buildSubBadges(item, subs, alt)
{
    const blocks = [];
    for (const sub of subs)
    {
        const specs = [
            { max: getPerRoundLimitFromSub(sub.data), field: 'uses_per_round', label: 'PER ROUND', ready: 'mdi-restart', off: 'mdi-restart-off' },
            { max: getPerTurnLimitFromSub(sub.data), field: 'uses_per_turn', label: 'PER TURN', ready: 'mdi-circle-slice-8', off: 'mdi-circle-outline' },
            { max: getPerSceneLimitFromSub(sub.data), field: 'uses_per_scene', label: 'PER SCENE', ready: 'mdi-cog', off: 'mdi-cog-off' },
        ];
        for (const spec of specs)
        {
            if (!spec.max)
                continue;
            const used = getSubUsed(item, sub.key, spec.field);
            const label = `${sub.label} · ${spec.label}`;
            const pips = alt ? pipsHtmlAlt(spec.max, used, spec.ready, spec.off, spec.field) : pipsHtmlStandard(spec.max, used, spec.ready, spec.off, spec.field);
            blocks.push(alt
                ? `<div class="la-counterbox la-flexrow -aligncenter la-text-header -padding1-lr clipped-alt -widthfull la-bckg-header-anti la-pf-card" data-item-id="${item.id}" data-sub-key="${sub.key}"><span class="la-counterbox__span -fontsizemedium">${label}</span>${pips}</div>`
                : `<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}" data-sub-key="${sub.key}"><span style="margin:4px;">${label}</span>${pips}</div>`);
        }
    }
    return blocks.join('');
}

function buildTalentBadges(item, alt)
{
    const ranks = item.system?.ranks ?? [];
    const currRank = Number(item.system?.curr_rank ?? 0);
    const roman = ['I', 'II', 'III'];
    const subs = [];
    for (let rankIdx = 0; rankIdx < Math.min(currRank, ranks.length, 3); rankIdx++)
        subs.push({ key: rankSubKey(rankIdx), data: ranks[rankIdx], label: roman[rankIdx] });
    return buildSubBadges(item, subs, alt);
}

function buildActionBadges(item, alt)
{
    return buildSubBadges(item, itemActionSubs(item).map(sub => ({ ...sub, label: String(sub.name ?? '').toUpperCase() })), alt);
}

function bindPipClicks(root, actor)
{
    root.querySelectorAll('.la-pf-pip').forEach(pip =>
    {
        pip.addEventListener('click', async (ev) =>
        {
            ev.stopPropagation();
            const card = pip.closest('.la-pf-card');
            const itemId = card?.getAttribute('data-item-id');
            const item = itemId && actor?.items?.get(itemId);
            if (!item)
                return;
            const field = pip.getAttribute('data-field');
            const clickedPip = Number(pip.getAttribute('data-index'));
            const subKey = card?.getAttribute('data-sub-key');
            if (subKey)
            {
                const currentUsed = getSubUsed(item, subKey, field);
                const nextUsed = clickedPip === currentUsed ? clickedPip - 1 : clickedPip;
                await item.update({ [`flags.${MODULE_ID}.perFreqSub.${subKey}.${field}.value`]: Math.max(0, nextUsed) });
                return;
            }
            const currentUsed = Number(item.system?.[field]?.value ?? 0);
            const nextUsed = clickedPip === currentUsed ? clickedPip - 1 : clickedPip;
            await item.update({ [`system.${field}.value`]: Math.max(0, nextUsed) });
        });
    });
}

export function onRenderActorSheetPerFrequency(app, html)
{
    if (!enabled())
        return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const actor = app.actor ?? app.document;
    if (!root || !actor?.items)
        return;
    const isAlt = !!root.querySelector('.la-root, .la-common, .la-counterbox');
    for (const el of root.querySelectorAll('[data-item-id]'))
    {
        const id = /** @type {any} */ (el).dataset.itemId;
        const item = actor.items.get(id);
        if (!item)
            continue;
        if (isAlt)
        {
            const existingCounter = el.querySelector(':scope .la-counterbox:not(.la-pf-card)');
            const container = existingCounter ? existingCounter.parentElement : el;
            if (!container)
                continue;
            if (container.querySelector(`:scope > .la-pf-card[data-item-id="${id}"]`))
                continue;
            const badgeHtml = item.type === 'talent' ? buildTalentBadges(item, true) : buildBadgeAlt(item) + buildActionBadges(item, true);
            if (!badgeHtml)
                continue;
            if (existingCounter)
                existingCounter.insertAdjacentHTML('afterend', badgeHtml);
            else
                container.insertAdjacentHTML('beforeend', badgeHtml);
        }
        else
        {
            const body = el.querySelector(':scope .lancer-body') ?? el;
            if (body.querySelector(`:scope > .la-pf-card[data-item-id="${id}"]`))
                continue;
            const badgeHtml = item.type === 'talent' ? buildTalentBadges(item, false) : buildBadgeStandard(item) + buildActionBadges(item, false);
            if (!badgeHtml)
                continue;
            const charged = body.querySelector(':scope > .charged-box:not(.la-pf-card)');
            const limited = body.querySelector(':scope > .limited-card:not(.la-pf-card)');
            const anchor = charged ?? limited;
            if (anchor)
                anchor.insertAdjacentHTML('afterend', badgeHtml);
            else
                body.insertAdjacentHTML('afterbegin', badgeHtml);
        }
    }
    // Per-trait per-scene injection.
    const seenTraitKeys = new Set();
    for (const traitBtn of root.querySelectorAll('[data-type="trait"][data-uuid][data-index]'))
    {
        const uuid = /** @type {any} */ (traitBtn).dataset.uuid;
        const traitIdx = Number(/** @type {any} */ (traitBtn).dataset.index);
        const key = `${uuid}::${traitIdx}`;
        if (seenTraitKeys.has(key))
            continue;
        seenTraitKeys.add(key);
        let frame = [...actor.items.values()].find(/** @type {any} */ frameItem => frameItem.uuid === uuid);
        if (!frame)
        {
            const tailId = /Item\.([^.]+)$/.exec(uuid)?.[1];
            if (tailId)
                frame = actor.items.get(tailId);
        }
        const trait = /** @type {any} */ (frame)?.system?.traits?.[traitIdx];
        if (!frame || !trait)
            continue;
        const sceneMax = getPerSceneLimitFromSub(trait);
        if (!sceneMax)
            continue;
        let body = traitBtn.closest('.frame-trait')?.querySelector(':scope > .lancer-body') ?? null;
        const altBody = root.querySelector(`[data-la-collapse-id="${actor.uuid}_${frame.id}_trait_${traitIdx}"]`);
        if (!body)
            body = altBody;
        if (!body)
            continue;
        const useAlt = !!altBody && body === altBody;
        if (body.querySelector(`:scope > .la-pf-card[data-item-id="${frame.id}"][data-trait-idx="${traitIdx}"]`))
            continue;
        const sceneUsed = Number(/** @type {any} */ (frame).system?.uses_per_scene?.value ?? 0);
        const pips = useAlt
            ? pipsHtmlAlt(sceneMax, sceneUsed, 'mdi-cog', 'mdi-cog-off', 'uses_per_scene')
            : pipsHtmlStandard(sceneMax, sceneUsed, 'mdi-cog', 'mdi-cog-off', 'uses_per_scene');
        const card = useAlt
            ? `<div class="la-counterbox la-flexrow -aligncenter la-text-header -padding1-lr clipped-alt -widthfull la-bckg-header-anti la-pf-card" data-item-id="${frame.id}" data-trait-idx="${traitIdx}"><span class="la-counterbox__span -fontsizemedium">PER SCENE</span>${pips}</div>`
            : `<div class="clipped card charged-box la-pf-card" data-item-id="${frame.id}" data-trait-idx="${traitIdx}"><span style="margin:4px;">PER SCENE</span>${pips}</div>`;
        body.insertAdjacentHTML('beforeend', card);
    }
    bindPipClicks(root, actor);
}
