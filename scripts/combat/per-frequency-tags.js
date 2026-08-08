/* global game, CONFIG, Hooks, foundry, ui */

const MODULE_ID = 'lancer-automations';
const SETTING_KEY = 'enablePerRoundTurnTags';
const TARGET_FLOWS = ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow', 'ActivationFlow', 'SystemFlow', 'CoreActiveFlow'];

function enabled()
{
    try
    {
        return !!game.settings.get(MODULE_ID, SETTING_KEY);
    }
    catch
    {
        return false;
    }
}

function inCombat()
{
    return !!game.combat?.started;
}

function tagLimit(item, lid)
{
    const tag = item?.system?.tags?.find?.(t => t.lid === lid);
    if (!tag)
        return 0;
    const rawLimit = Number(tag.val ?? 1);
    return Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1;
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
const _RX_SCENE_START = /^\s*(\d+)\s*\/\s*scene\b/i;
const _RX_ROUND = /(\d+)\s*\/\s*round\b/i;
const _RX_TURN = /(\d+)\s*\/\s*turn\b/i;
const _USE_SCENE = new Set(['encounter', 'scene']);
const _USE_ROUND = new Set(['round']);
const _USE_TURN = new Set(['turn']);

function scanFreqLimit(sys, rx, useSet, textRx = rx)
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
    fromFreq(sys.actions);
    fromFreq(sys.powers);
    fromUse(sys.use);
    fromText(sys.effect);
    fromText(sys.description);
    // Skip core_system: core power is already gated by system.core_energy.
    return best;
}

function scanFreqLimitFromSub(sub, rx, useSet, textRx = rx)
{
    if (!sub)
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
    return Math.max(tagLimit(item, 'tg_round'), scanFreqLimit(item?.system, _RX_ROUND, _USE_ROUND));
}
export function getPerTurnLimit(item)
{
    return Math.max(tagLimit(item, 'tg_turn'), scanFreqLimit(item?.system, _RX_TURN, _USE_TURN));
}
export function getPerSceneLimit(item)
{
    return scanFreqLimit(item?.system, _RX_SCENE, _USE_SCENE, _RX_SCENE_START);
}
export function getPerRoundLimitFromSub(sub)
{
    return scanFreqLimitFromSub(sub, _RX_ROUND, _USE_ROUND);
}
export function getPerTurnLimitFromSub(sub)
{
    return scanFreqLimitFromSub(sub, _RX_TURN, _USE_TURN);
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

// resolves the talent rank a flow's action belongs to, from Lancer's action_path
function talentRankSub(state)
{
    const item = state?.item;
    if (item?.type !== 'talent')
        return null;
    const match = /^system\.ranks\.(\d+)\.actions\./.exec(String(state?.data?.action_path ?? ''));
    if (!match)
        return null;
    const rankIdx = Number(match[1]);
    const rank = item.system?.ranks?.[rankIdx];
    return rank ? { key: rankSubKey(rankIdx), rank } : null;
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
export function isPerRoundExhausted(item)
{
    const lim = getPerRoundLimit(item); return lim > 0 && getPerRoundUsed(item) >= lim;
}
export function isPerTurnExhausted(item)
{
    const lim = getPerTurnLimit(item); return lim > 0 && getPerTurnUsed(item) >= lim;
}
export function isPerSceneExhausted(item)
{
    const lim = getPerSceneLimit(item); return lim > 0 && getPerSceneUsed(item) >= lim;
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

async function checkPerFrequencyStep(state)
{
    if (!enabled())
        return true;
    const item = state.item;
    if (!item)
        return true;
    const sub = talentRankSub(state);
    if (sub)
    {
        const roundLimit = getPerRoundLimitFromSub(sub.rank);
        const turnLimit = getPerTurnLimitFromSub(sub.rank);
        const sceneLimit = getPerSceneLimitFromSub(sub.rank);
        if (inCombat() && roundLimit > 0 && getSubUsed(item, sub.key, 'uses_per_round') >= roundLimit)
        {
            ui.notifications.warn(`${item.name} (${sub.rank.name}): per-round limit reached (${getSubUsed(item, sub.key, 'uses_per_round')}/${roundLimit}).`);
            return false;
        }
        if (inCombat() && turnLimit > 0 && getSubUsed(item, sub.key, 'uses_per_turn') >= turnLimit)
        {
            ui.notifications.warn(`${item.name} (${sub.rank.name}): per-turn limit reached (${getSubUsed(item, sub.key, 'uses_per_turn')}/${turnLimit}).`);
            return false;
        }
        if (sceneLimit > 0 && getSubUsed(item, sub.key, 'uses_per_scene') >= sceneLimit)
            ui.notifications.warn(`${item.name} (${sub.rank.name}): per-scene limit reached (${getSubUsed(item, sub.key, 'uses_per_scene')}/${sceneLimit}).`);
        return true;
    }
    if (inCombat() && isPerRoundExhausted(item))
    {
        ui.notifications.warn(`${item.name}: per-round limit reached (${getPerRoundUsed(item)}/${getPerRoundLimit(item)}).`);
        return false;
    }
    if (inCombat() && isPerTurnExhausted(item))
    {
        ui.notifications.warn(`${item.name}: per-turn limit reached (${getPerTurnUsed(item)}/${getPerTurnLimit(item)}).`);
        return false;
    }
    if (isPerSceneExhausted(item))
        ui.notifications.warn(`${item.name}: per-scene limit reached (${getPerSceneUsed(item)}/${getPerSceneLimit(item)}).`);
    return true;
}

export async function consumePerFrequencyForItem(item, { skipTypes = null, sub = null } = {})
{
    if (!enabled() || !item)
        return;
    const skip = skipTypes ?? new Set();
    if (sub)
    {
        const patch = {};
        if (!skip.has('perRound') && inCombat() && getPerRoundLimitFromSub(sub.rank) > 0)
            patch.uses_per_round = { value: getSubUsed(item, sub.key, 'uses_per_round') + 1 };
        if (!skip.has('perTurn') && inCombat() && getPerTurnLimitFromSub(sub.rank) > 0)
            patch.uses_per_turn = { value: getSubUsed(item, sub.key, 'uses_per_turn') + 1 };
        if (!skip.has('perScene') && getPerSceneLimitFromSub(sub.rank) > 0)
            patch.uses_per_scene = { value: getSubUsed(item, sub.key, 'uses_per_scene') + 1 };
        if (Object.keys(patch).length)
            await patchSubUses(item, sub.key, patch);
        return;
    }
    const updates = {};
    if (!skip.has('perRound') && inCombat() && getPerRoundLimit(item) > 0)
        updates['system.uses_per_round.value'] = getPerRoundUsed(item) + 1;
    if (!skip.has('perTurn') && inCombat() && getPerTurnLimit(item) > 0)
        updates['system.uses_per_turn.value'] = getPerTurnUsed(item) + 1;
    if (!skip.has('perScene') && getPerSceneLimit(item) > 0)
        updates['system.uses_per_scene.value'] = getPerSceneUsed(item) + 1;
    if (Object.keys(updates).length)
        await item.update(updates);
}

async function consumePerFrequencyStep(state)
{
    await consumePerFrequencyForItem(state.item, { sub: talentRankSub(state) });
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

function buildTalentBadges(item, alt)
{
    const ranks = item.system?.ranks ?? [];
    const currRank = Number(item.system?.curr_rank ?? 0);
    const roman = ['I', 'II', 'III'];
    const blocks = [];
    for (let rankIdx = 0; rankIdx < Math.min(currRank, ranks.length, 3); rankIdx++)
    {
        const rank = ranks[rankIdx];
        const subKey = rankSubKey(rankIdx);
        const specs = [
            { max: getPerRoundLimitFromSub(rank), field: 'uses_per_round', label: 'PER ROUND', ready: 'mdi-restart', off: 'mdi-restart-off' },
            { max: getPerTurnLimitFromSub(rank), field: 'uses_per_turn', label: 'PER TURN', ready: 'mdi-circle-slice-8', off: 'mdi-circle-outline' },
            { max: getPerSceneLimitFromSub(rank), field: 'uses_per_scene', label: 'PER SCENE', ready: 'mdi-cog', off: 'mdi-cog-off' },
        ];
        for (const spec of specs)
        {
            if (!spec.max)
                continue;
            const used = getSubUsed(item, subKey, spec.field);
            const label = `${roman[rankIdx]} · ${spec.label}`;
            const pips = alt ? pipsHtmlAlt(spec.max, used, spec.ready, spec.off, spec.field) : pipsHtmlStandard(spec.max, used, spec.ready, spec.off, spec.field);
            blocks.push(alt
                ? `<div class="la-counterbox la-flexrow -aligncenter la-text-header -padding1-lr clipped-alt -widthfull la-bckg-header-anti la-pf-card" data-item-id="${item.id}" data-sub-key="${subKey}"><span class="la-counterbox__span -fontsizemedium">${label}</span>${pips}</div>`
                : `<div class="clipped card charged-box la-pf-card" data-item-id="${item.id}" data-sub-key="${subKey}"><span style="margin:4px;">${label}</span>${pips}</div>`);
        }
    }
    return blocks.join('');
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
            const badgeHtml = item.type === 'talent' ? buildTalentBadges(item, true) : buildBadgeAlt(item);
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
            const badgeHtml = item.type === 'talent' ? buildTalentBadges(item, false) : buildBadgeStandard(item);
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
