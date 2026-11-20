import { laDetailPopup } from "../interactive/detail-renderers.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { pickTokensCardless, cancelCardlessTokenPicker, createTokenMark } from "../interactive/index.js";
import { createTokenTether } from "../interactive/canvas-helpers.js";
import { startPickCard } from "../interactive/pick-card.js";
import { isWhiteSvgIcon } from "../interactive/cards.js";
import { getMinGridDistance } from "../combat/grid-helpers.js";
import { consumeAction, activationSpendKind } from "../tools/misc-tools.js";
import { patchTapeEntry, wasUndone } from "../tah/action-tape.js";
import { flowChanges, removedRecord } from "../tah/tape-changes.js";
import { _flowSourceToken, _flowResolveActivationLabel } from "../fx/actionFX.js";
import { applyPrepared } from "./prepare-flow.js";

const clearableEffects = targetActor => [...(targetActor?.effects ?? [])].filter(effect => !effect.disabled && (effect.statuses?.size || effect.name));

async function laPickConditionFromActor(targetActor, prompt, anchorHtml)
{
    const effects = clearableEffects(targetActor);

    if (!effects.length)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noConditionsToClear', { name: targetActor?.name ?? localize('LA.common.actor') }));
        return null;
    }

    return new Promise((resolve) =>
    {
        let done = false;

        const keyHandler = (event) =>
        {
            if (event.key === 'Escape')
                finish(null);
        };

        const finish = (pickedEffectId) =>
        {
            if (done)
                return;
            done = true;
            document.removeEventListener('keydown', keyHandler);
            popup.remove();
            resolve(pickedEffectId);
        };

        document.addEventListener('keydown', keyHandler);

        const rows = effects.map(e => `
            <div class="la-pick-cond" data-id="${e.id}" style="display:flex;align-items:center;gap:10px;padding:6px 8px;border-radius:3px;cursor:pointer;border:1px solid transparent;margin-bottom:4px;">
                <img src="${e.img}" style="width:28px;height:28px;flex-shrink:0;border:none;">
                <div style="display:flex;flex-direction:column;min-width:0;">
                    <span style="font-weight:700;text-transform:uppercase;font-size:0.85em;color:#fff;">${e.name}</span>
                    <span style="font-size:0.72em;color:#888;line-height:1.2;">${[...(e.statuses ?? [])].join(', ') || ''}</span>
                </div>
            </div>`).join('');

        const popup = laDetailPopup('la-pick-cond-popup', prompt, targetActor.name, rows, 'system');
        popup.find('.la-detail-close').on('click', () => finish(null));
        popup.on('click', '.la-pick-cond', function (ev)
        {
            ev.stopPropagation();
            finish(String($(this).data('id')));
        });
        popup.on('mouseenter', '.la-pick-cond', function ()
        {
            $(this).css({ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' });
        }).on('mouseleave', '.la-pick-cond', function ()
        {
            $(this).css({ background: '', borderColor: 'transparent' });
        });
        popup.appendTo(document.body);
        const anchorDialog = anchorHtml.closest('.app, .application, .window-app, .la-info-card').first();
        const anchorDialogOffset = anchorDialog.offset() ?? { left: 100, top: 100 };
        const anchorDialogWidthPx = anchorDialog.outerWidth() ?? 480;
        const popupWidthPx = popup.outerWidth();
        const popupHeightPx = popup.outerHeight();
        const viewportWidthPx = window.innerWidth;
        const viewportHeightPx = window.innerHeight;
        let popupLeftPx = anchorDialogOffset.left - popupWidthPx - 8;

        if (popupLeftPx < 10 && anchorDialogOffset.left + anchorDialogWidthPx + 8 + popupWidthPx <= viewportWidthPx - 10)
            popupLeftPx = anchorDialogOffset.left + anchorDialogWidthPx + 8;

        let popupTopPx = anchorDialogOffset.top;
        if (popupTopPx + popupHeightPx > viewportHeightPx - 10)
            popupTopPx = viewportHeightPx - popupHeightPx - 10;

        const finalLeftPx = Math.max(10, popupLeftPx);
        popup.css({ left: finalLeftPx + 20, top: Math.max(10, popupTopPx), opacity: 0 });
        popup.animate({ left: finalLeftPx, opacity: 1 }, { duration: 150, easing: 'swing' });
        popup.on('click', e => e.stopPropagation());
        setTimeout(() => $(document).one('click', () => finish(null)));
    });
}

export async function laStabilizePrompt(state)
{
    if (!state.data)
        throw new TypeError('Stabilize flow state data missing!');

    const actor = state.actor;

    if (actor?.is_npc?.())
    {
        const confirmed = await startPickCard({
            title: 'STABILIZE',
            origin: actor.name,
            description: 'The NPC clears all heat and the EXPOSED status, and reloads all LOADING weapons.',
            foot: 'NPC Stabilize is fixed: Cool + Reload.',
            confirmText: localize('LA.stabilize.stabilize'),
            getRows: () => [],
            onPick: () => null,
            onConfirm: card => card.finish(true),
        });

        if (!confirmed)
            return false;

        state.data.option1 = 'Cool';
        state.data.option2 = 'Reload';
        return true;
    }

    const opt1 = [
        { val: 'Cool', label: localize('LA.stabilize.cool.label'), icon: 'fas fa-thermometer-empty', detail: localize('LA.stabilize.cool.detail') },
        { val: 'Repair', label: localize('LA.stabilize.repair.label'), icon: 'cci cci-repair', detail: localize('LA.stabilize.repair.detail') }
    ];

    const opt2 = [
        { val: 'Reload', label: localize('LA.stabilize.reload.label'), icon: 'cci cci-ammo', detail: localize('LA.stabilize.reload.detail') },
        { val: 'ClearBurn', label: localize('LA.stabilize.clearBurn.label'), icon: 'cci cci-burn', detail: localize('LA.stabilize.clearBurn.detail') },
        { val: 'ClearOwnCond', label: localize('LA.stabilize.clearOwnCond.label'), icon: 'fas fa-user-shield', detail: localize('LA.stabilize.clearOwnCond.detail') },
        { val: 'ClearOtherCond', label: localize('LA.stabilize.clearOtherCond.label'), icon: 'fas fa-hands-helping', detail: localize('LA.stabilize.clearOtherCond.detail') }
    ];

    const noRepair = actor.is_mech?.() && (actor.system.repairs?.value ?? 0) <= 0;

    let pickedOption1 = state.data.option1 ?? 'Cool';
    let pickedOption2 = state.data.option2 ?? 'Reload';

    if (pickedOption1 === 'Repair' && noRepair)
        pickedOption1 = 'Cool';

    let clearEffect = null;
    let clearToken = null;
    let clearTargetUuid = null;
    let pickStage = '';
    let stageToken = null;
    let allyMark = null;
    let allyTether = null;

    const showAlly = (token) =>
    {
        allyMark?.destroy();
        allyMark = null;
        allyTether?.destroy();
        allyTether = null;

        if (!token)
            return;

        allyMark = createTokenMark(token);
        const origin = actor.getActiveTokens?.()?.[0];

        if (origin)
        {
            allyTether = createTokenTether();
            allyTether.setPairs([[origin, token]]);
        }
    };

    const tokenArt = token => `<img class="la-pick-inside-art" src="${token.document?.texture?.src ?? ''}" alt="">`;

    const insideHtml = (val) =>
    {
        if (val === 'ClearOtherCond' && pickStage === 'token')
        {
            return `<div class="la-pick-inside"><span class="la-pick-inside-text">${localize('LA.stabilize.clickAlly')}</span>`
                + `<button type="button" data-inside-cancel="1"><i class="fas fa-times"></i> ${localize('LA.common.cancel')}</button></div>`;
        }

        if (val === 'ClearOtherCond' && pickStage === 'condition')
            return `<div class="la-pick-inside"><span class="la-pick-cleared">${tokenArt(stageToken)}<b>${localizeFormat('LA.stabilize.chooseWhatToClear', { name: stageToken.name })}</b></span></div>`;

        if (val !== pickedOption2 || !clearEffect)
            return '';

        const invert = isWhiteSvgIcon(clearEffect.img) ? ' style="filter:invert(1);"' : '';
        const onToken = clearToken ? `<span>${localize('LA.stabilize.onToken')}</span>${tokenArt(clearToken)}<b>${clearToken.name}</b>` : '';

        return `<div class="la-pick-inside la-pick-inside--done"><span class="la-pick-inside-label">${localize('LA.stabilize.willClear')}</span>`
            + `<span class="la-pick-cleared"><img class="la-pick-inside-icon" src="${clearEffect.img}" alt=""${invert}><b>${clearEffect.name}</b>${onToken}</span></div>`;
    };

    const badgeFor = (val) =>
    {
        if (val === 'Repair' && actor.is_mech?.())
            return `${actor.system.repairs?.value ?? 0}/${actor.system.repairs?.max ?? 0}`;
        if (val === 'ClearBurn' && actor.system?.burn > 0)
            return String(actor.system.burn);
        if (val === 'ClearOwnCond' && clearableEffects(actor).length > 0)
            return String(clearableEffects(actor).length);
        return '';
    };

    const rowFor = (option, group, section) => ({
        optionGroup: group,
        val: option.val,
        section,
        icon: option.icon,
        name: option.label,
        lines: [option.detail],
        badge: badgeFor(option.val),
        off: option.val === 'Repair' && noRepair,
        why: option.val === 'Repair' && noRepair ? localize('LA.stabilize.noRepairs') : '',
        picked: group === 1 ? pickedOption1 === option.val : (pickedOption2 === option.val || (option.val === 'ClearOtherCond' && !!pickStage)),
        inside: group === 2 ? insideHtml(option.val) : '',
    });

    const pickCondition = async (val, card) =>
    {
        card.busy = true;
        let targetActor = actor;
        let token = null;

        if (val === 'ClearOtherCond')
        {
            pickStage = 'token';
            card.refresh();
            showAlly(null);

            const origin = actor.getActiveTokens?.()?.[0];
            const picked = await pickTokensCardless(origin, { includeSelf: false, single: true, linkFrom: [origin] });
            token = picked?.[0] ?? null;

            if (!token?.actor)
            {
                pickStage = '';
                card.busy = false;
                showAlly(clearToken);
                card.refresh();
                return;
            }

            if (origin && getMinGridDistance(origin, token) > 1)
                ui.notifications.warn(localizeFormat('LA.notify.allyNotAdjacent', { name: token.name }));

            targetActor = token.actor;
            pickStage = 'condition';
            stageToken = token;
            showAlly(token);
            card.refresh();
        }

        const effectId = await laPickConditionFromActor(targetActor, localize('LA.stabilize.clearWhichCondition'), card.element);
        pickStage = '';
        stageToken = null;
        card.busy = false;

        if (effectId)
        {
            clearEffect = targetActor.effects.get(effectId);
            clearToken = token;
            clearTargetUuid = targetActor.uuid;
            pickedOption2 = val;
        }

        showAlly(clearToken);
        card.refresh();
    };

    const confirmed = await startPickCard({
        title: 'STABILIZE',
        origin: actor.name,
        confirmText: localize('LA.stabilize.stabilize'),
        getRows: () => [
            ...opt1.map((option, index) => rowFor(option, 1, index === 0 ? localize('LA.stabilize.option1') : null)),
            ...opt2.map((option, index) => rowFor(option, 2, index === 0 ? localize('LA.stabilize.option2') : null)),
        ],
        onPick: ({ optionGroup, val }, card) =>
        {
            if (optionGroup === 2 && (val === 'ClearOwnCond' || val === 'ClearOtherCond'))
            {
                void pickCondition(val, card);
                return;
            }

            if (optionGroup === 1)
                pickedOption1 = val;
            else
            {
                pickedOption2 = val;
                clearEffect = null;
                clearToken = null;
                clearTargetUuid = null;
                showAlly(null);
            }

            card.refresh();
        },
        onConfirm: card => card.finish(true),
        onReady: (card) =>
        {
            card.element.on('click', '[data-inside-cancel]', () => cancelCardlessTokenPicker());
        },
    });

    if (pickStage === 'token')
        cancelCardlessTokenPicker();

    showAlly(null);

    if (!confirmed)
        return false;

    state.data.option1 = pickedOption1;
    state.data.option2 = pickedOption2;

    if (clearEffect)
    {
        state.data.la_clearTargetUuid = clearTargetUuid;
        state.data.la_clearEffectId = clearEffect.id;
    }

    return true;
}

export async function laStabilizeExtras(state)
{
    if (!state?.data)
        return true;

    const actor = state.actor;

    if (state.data.la_clearEffectId && state.data.la_clearTargetUuid)
    {
        try
        {
            const target = await fromUuid(state.data.la_clearTargetUuid);
            const cleared = target?.effects?.get?.(state.data.la_clearEffectId);

            if (cleared)
            {
                state.la_extraData = state.la_extraData ?? {};
                state.la_extraData.removedEffects = [...(state.la_extraData.removedEffects ?? []), removedRecord(cleared)];
            }

            if (target?.deleteEmbeddedDocuments)
                await target.deleteEmbeddedDocuments('ActiveEffect', [state.data.la_clearEffectId]);
        }
        catch (e)
        {
            console.warn('lancer-automations | stabilize condition clear failed:', e);
        }
    }

    if (state.data.option2 === 'ClearBurn'
        && getModuleSetting('enableInfectionDamageIntegration')
        && actor?.system?.infection > 0)
    {
        try
        {
            await actor.update({ 'system.infection': 0 });
        }
        catch (e)
        {
            console.warn('lancer-automations | stabilize infection clear failed:', e);
        }
    }

    return true;
}

function _flowSpendKind(flow)
{
    if (flow?.constructor?.name === 'StabilizeFlow')
        return flow.state?.la_extraData?.aided ? 'quick' : 'full';

    const kind = activationSpendKind(_flowResolveActivationLabel(flow));
    return kind === 'quick' || kind === 'full' ? kind : null;
}

async function _consumeFlowAction(flow, success)
{
    const token = _flowSourceToken(flow);
    if (!token)
        return;

    const tapeId = flow?.state?.la_extraData?.tapeId;
    if (wasUndone(tapeId))
        return;

    const changes = flowChanges(flow, token.actor);
    const kind = success && !flow?.state?.la_extraData?.freeUse && !flow?.state?.la_extraData?.tapeRecorded && getModuleSetting('consumeAction') ? _flowSpendKind(flow) : null;
    const tracker = kind ? await consumeAction(token, kind) : null;
    await patchTapeEntry(token, tapeId, { changes, ...(tracker ? { tracker } : {}) });

    if (success && flow?.state?.la_extraData?.prepared)
        await applyPrepared(token, flow.state.la_extraData.prepared, tapeId);
}

async function _settleFlowChip(flow)
{
    const token = _flowSourceToken(flow);
    const tapeId = flow?.state?.la_extraData?.tapeId;

    if (token && !wasUndone(tapeId))
        await patchTapeEntry(token, tapeId, { changes: flowChanges(flow, token.actor) });
}

Hooks.on('lancer.postFlow.ActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SystemFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TechAttackFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SimpleActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.CoreActiveFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TalentFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.StabilizeFlow', _consumeFlowAction);
for (const flowName of ['OverchargeFlow', 'BondPowerFlow', 'SimpleHTMLFlow', 'SendUnknownToChat', 'WeaponAttackFlow', 'BasicAttackFlow'])
    Hooks.on(`lancer.postFlow.${flowName}`, _settleFlowChip);
