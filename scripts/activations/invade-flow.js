import { injectExtraDataUtility } from './flows.js';
import { emitInvadeHit } from './flow-steps.js';
import { releaseHeldDamageRoll } from './auto-damage.js';
import { getInvadeOptions } from '../tools/misc-tools.js';
import { localize } from '../tools/string-utils.js';
import { getLAFlags } from '../tools/flag-utils.js';
import { chooseInvadePerTarget, invadeTargetKey } from '../interactive/invade-card.js';
import { consumePerFrequencyForItem } from '../combat/per-frequency-tags.js';
import { patchTapeEntry } from '../tah/action-tape.js';
import { playHitMissMarkers, playInvadeInjectFX } from '../fx/actionFX.js';

function resolvePreset(preset, options)
{
    if (!preset)
        return null;

    return options.find(option => option.key === preset.key) ?? {
        key: preset.key,
        name: preset.name,
        detail: preset.detail ?? '',
        item: preset.itemUuid ? fromUuidSync(preset.itemUuid) : null,
        action: null,
        tags: [],
        source: '',
    };
}

async function spendOption(state, option)
{
    const item = option.item;
    if (!item || item.type?.includes('weapon'))
        return true;

    const steps = game.lancer?.flowSteps;
    const local = { ...state, item, data: { ...state.data, action: option.action ?? state.data?.action, self_heat: null, self_heat_result: null, overkill_heat: 0 } };

    for (const name of ['checkItemDestroyed', 'checkItemLimited', 'checkItemCharged'])
    {
        const step = steps?.get(name);
        if (step && await step(local) === false)
            return false;
    }

    await steps?.get('setAttackTags')?.(local);
    if (local.data.self_heat)
        await steps?.get('applySelfHeat')?.(local);
    await steps?.get('updateItemAfterAction')?.(local);
    await consumePerFrequencyForItem(item);
    return true;
}

async function pickOptions(state, options)
{
    const results = state.data?.hit_results ?? [];
    const hits = results.filter(result => result.hit && result.target);
    const preset = resolvePreset(state.la_extraData?.invadePreset, options);

    if (results.length && !hits.length)
        return new Map();

    if (preset)
        return new Map((results.length ? hits.map(result => invadeTargetKey(result.target)) : ['']).map(key => [key, preset]));

    const targets = results.length ? results.filter(result => result.target).map(result => ({ token: result.target, hit: !!result.hit })) : null;
    return await chooseInvadePerTarget(state.actor, { targets, options }) ?? new Map();
}

async function resolveInvadeAfterRoll(state)
{
    state = injectExtraDataUtility(state);
    const actor = state.actor;
    const plainTitle = localize('LA.tokenHud.label.invade');
    const message = state.la_cardMessage ?? null;

    const dice3d = /** @type {any} */ (game).dice3d;
    const diceDone = message?._dice3danimating && dice3d ? dice3d.waitFor3DAnimationByMessageID(message.id) : null;
    await playHitMissMarkers(state, { waitUntilDone: true });
    await diceDone;

    const picks = await pickOptions(state, getInvadeOptions(actor));

    const spent = new Set();
    for (const option of new Set(picks.values()))
    {
        if (option && await spendOption(state, option))
            spent.add(option);
    }

    const optionOf = token => (spent.has(picks.get(invadeTargetKey(token))) ? picks.get(invadeTargetKey(token)) : null);
    const results = state.data?.hit_results ?? [];
    const choices = results.length
        ? results.filter(result => result.hit && result.target).map(result => ({ target: invadeTargetKey(result.target), option: optionOf(result.target) }))
        : [...picks.keys()].map(key => ({ target: key, option: spent.has(picks.get(key)) ? picks.get(key) : null }));

    const used = [...new Set(choices.map(choice => choice.option).filter(Boolean))];

    state.injectFlowExtraData({
        invadeChoices: choices.map(choice => ({ target: choice.target, name: choice.option?.name ?? null, detail: choice.option?.detail ?? '' })),
    });

    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const tapeId = state.la_extraData?.tapeId;
    if (token && tapeId && used.length)
        await patchTapeEntry(token, tapeId, { name: `${plainTitle}: ${used.map(option => option.name).join(', ')}` });

    await emitInvadeHit(state, optionOf);

    if (message)
    {
        await message.update({ 'flags.lancer-automations.flowState': { ...state.la_extraData } });
        releaseHeldDamageRoll(message.id);
    }

    await playInvadeInjectFX(state);
}

function adoptLancerInvade(flow)
{
    const state = flow?.state;
    if (!state?.data || state.la_extraData?.invadeAfterHit)
        return;

    const item = state.item ?? null;
    const npcInvade = !!item?.is_npc_feature?.() && (item.system?.tags ?? []).some(tag => (tag.lid ?? tag.id) === 'tg_invade');
    if (!state.data.invade && !npcInvade)
        return;

    let actor = state.actor;
    if (actor?.type === 'pilot' && item?.type === 'talent')
        actor = actor.system?.active_mech?.value ?? actor;
    if (actor?.type !== 'mech' && actor?.type !== 'npc')
        return;

    const name = state.data.action?.name ?? (npcInvade ? item.name : state.data.title);
    const plain = !name || /^(tech attack|invade)$/i.test(name.trim());
    const preset = plain ? null : {
        key: `${item?.id ?? ''}|${name}`,
        name,
        detail: state.data.action?.detail ?? state.data.effect ?? '',
        itemUuid: item?.uuid ?? null,
    };

    state.actor = actor;
    state.item = null;
    state.data.invade = true;
    state.data.title = localize('LA.tokenHud.label.invade');
    state.data.action = { name: 'Invade', activation: 'Invade' };
    state.data.effect = '';
    state.data.tags = [];
    state.la_extraData = { ...(state.la_extraData ?? {}), invadeAfterHit: true, ...(preset ? { invadePreset: preset } : {}) };
}

function plainInvadeCardStep(state)
{
    if (state.la_extraData?.invadeAfterHit && state.data)
        state.data.title = '';
    return true;
}

function invadeLine(choice, folded)
{
    const line = document.createElement('div');
    line.className = 'la-invade-choice';

    if (!choice.name)
    {
        line.classList.add('la-invade-choice--none');
        line.textContent = localize('LA.invade.noneChosen');
        return [line];
    }

    const icon = document.createElement('i');
    icon.className = folded ? 'la-invade-caret fas fa-caret-right' : 'cci cci-tech-quick';
    line.append(icon, choice.name);

    if (!folded || !choice.detail)
        return [line];

    const detail = document.createElement('div');
    detail.className = 'la-invade-detail collapse collapsed';
    detail.innerHTML = choice.detail;
    line.classList.add('la-invade-choice--fold');
    line.addEventListener('click', (event) =>
    {
        event.stopPropagation();
        line.classList.toggle('is-open', detail.classList.toggle('collapsed') === false);
    });
    return [line, detail];
}

function invadeEffectSection(detail)
{
    const section = document.createElement('div');
    section.className = 'card clipped';
    const header = document.createElement('div');
    header.className = 'lancer-mini-header';
    header.textContent = game.i18n.localize('lancer.chat-card.title.effect');
    const text = document.createElement('span');
    text.className = 'effect-text';
    text.innerHTML = detail;
    section.append(header, text);
    return section;
}

function decorateInvadeCard(message, html)
{
    const flowState = getLAFlags(message)?.flowState;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!flowState?.invadeAfterHit || !root)
        return;

    const targets = message.flags?.lancer?.attackData?.targets ?? [];
    if (targets.length && !targets.some(target => target.hit))
        root.querySelector('.lancer-damage-flow')?.remove();

    const choices = flowState.invadeChoices;
    if (!Array.isArray(choices) || !choices.length)
        return;

    const names = [...new Set(choices.map(choice => choice.name).filter(Boolean))];
    const header = root.querySelector('.lancer-header > span');
    if (header && names.length === 1)
        header.textContent = `${header.textContent.trim()} :: ${names[0]}`;

    const folded = choices.length > 1;
    for (const choice of choices)
    {
        const row = choice.target ? root.querySelector(`.lancer-hit-target[data-uuid="${choice.target}"]`) : null;
        row?.after(...invadeLine(choice, folded));
    }

    const single = choices.length === 1 ? choices[0] : null;
    if (single?.name && single.detail)
    {
        const section = invadeEffectSection(single.detail);
        const button = root.querySelector('.lancer-damage-flow');
        if (button)
            button.before(section);
        else
            root.querySelector('.card.clipped-bot')?.append(section);
    }
}

export function registerInvadeFlowSteps(flowSteps, flows)
{
    flowSteps.set('lancer-automations:plainInvadeCard', plainInvadeCardStep);
    flows.get('TechAttackFlow')?.insertStepBefore('printTechAttackCard', 'lancer-automations:plainInvadeCard');

    Hooks.on('lancer.preFlow.TechAttackFlow', adoptLancerInvade);

    Hooks.on('lancer.postFlow.TechAttackFlow', (flow, success) =>
    {
        if (success && flow?.state?.la_extraData?.invadeAfterHit)
            resolveInvadeAfterRoll(flow.state).catch(error => console.error('lancer-automations | invade after roll failed:', error));
    });

    Hooks.on('renderChatMessageHTML', decorateInvadeCard);
}
