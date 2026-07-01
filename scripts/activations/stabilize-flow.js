import { laDetailPopup } from "../interactive/detail-renderers.js";
import { chooseToken } from "../interactive/index.js";
import { consumeAction } from "../tools/misc-tools.js";
import { _flowSourceToken, _flowResolveActivationLabel } from "../fx/actionFX.js";

async function laPickConditionFromActor(targetActor, prompt, anchorHtml) {
    const effects = [...(targetActor?.effects ?? [])].filter(e => !e.disabled && (e.statuses?.size || e.name));
    if (!effects.length) {
        ui.notifications.warn(`${targetActor?.name ?? 'Actor'} has no conditions to clear.`);
        return null;
    }
    return new Promise((resolve) => {
        let done = false;
        const finish = (pickedEffectId) => {
            if (done)
                return;
            done = true;
            popup.remove();
            resolve(pickedEffectId);
        };
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
        popup.on('click', '.la-pick-cond', function (ev) {
            ev.stopPropagation();
            finish(String($(this).data('id')));
        });
        popup.on('mouseenter', '.la-pick-cond', function () {
            $(this).css({ background: 'rgba(255,255,255,0.06)', borderColor: 'rgba(255,255,255,0.15)' });
        }).on('mouseleave', '.la-pick-cond', function () {
            $(this).css({ background: '', borderColor: 'transparent' });
        });
        $('body').append(popup);
        const anchorDialog = anchorHtml.closest('.app, .application, .window-app').first();
        const anchorDialogOffset = anchorDialog.offset() ?? { left: 100, top: 100 };
        const anchorDialogWidthPx = anchorDialog.outerWidth() ?? 480;
        const popupWidthPx = popup.outerWidth();
        const popupHeightPx = popup.outerHeight();
        const viewportWidthPx = window.innerWidth;
        const viewportHeightPx = window.innerHeight;
        let popupLeftPx = anchorDialogOffset.left + anchorDialogWidthPx + 8;
        if (popupLeftPx + popupWidthPx > viewportWidthPx - 10)
            popupLeftPx = anchorDialogOffset.left - popupWidthPx - 8;
        let popupTopPx = anchorDialogOffset.top;
        if (popupTopPx + popupHeightPx > viewportHeightPx - 10)
            popupTopPx = viewportHeightPx - popupHeightPx - 10;
        const finalLeftPx = Math.max(10, popupLeftPx);
        popup.css({ left: finalLeftPx - 20, top: Math.max(10, popupTopPx), opacity: 0 });
        popup.animate({ left: finalLeftPx, opacity: 1 }, { duration: 150, easing: 'swing' });
        popup.on('click', e => e.stopPropagation());
        $(document).one('click', () => finish(null));
    });
}

export async function laStabilizePrompt(state) {
    if (!state.data)
        throw new TypeError('Stabilize flow state data missing!');
    const actor = state.actor;
    if (actor?.is_npc?.()) {
        const npcContent = `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">STABILIZE</h2>
                <p class="lancer-dialog-subtitle">${actor.name}</p>
            </div>
            <div style="padding: 14px;">
                <p style="margin: 0 0 10px;">The NPC clears all heat and the EXPOSED status, and reloads all LOADING weapons.</p>
                <div class="lancer-info-box"><i class="fas fa-info-circle"></i><span>NPC Stabilize is fixed: Cool + Reload.</span></div>
            </div>`;
        return new Promise((resolve) => {
            new Dialog({
                title: `Stabilize - ${actor.name}`,
                content: npcContent,
                buttons: {
                    submit: {
                        icon: '<i class="fas fa-check"></i>',
                        label: 'Stabilize',
                        callback: () => {
                            state.data.option1 = 'Cool';
                            state.data.option2 = 'Reload';
                            resolve(true);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: 'Cancel',
                        callback: () => resolve(false)
                    }
                },
                default: 'submit',
                close: () => resolve(false)
            }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 460, top: 450, left: 150 }).render(true);
        });
    }
    const opt1 = [
        { val: 'Cool', label: 'Cool Mech', icon: 'fas fa-thermometer-empty', detail: 'Clear all heat and the EXPOSED status.' },
        { val: 'Repair', label: 'Restore HP', icon: 'cci cci-repair', detail: 'Spend 1 repair to regain HP.' }
    ];
    const opt2 = [
        { val: 'Reload', label: 'Reload', icon: 'cci cci-reload', detail: 'Reload all LOADING weapons.' },
        { val: 'ClearBurn', label: 'Clear Burn', icon: 'cci cci-burn', detail: 'Remove all burn from yourself.' },
        { val: 'ClearOwnCond', label: 'Clear Own Condition', icon: 'fas fa-user-shield', detail: 'Clear a condition affecting you (resolved manually).' },
        { val: 'ClearOtherCond', label: 'Clear Ally Condition', icon: 'fas fa-hands-helping', detail: 'Clear a condition on an adjacent ally (resolved manually).' }
    ];
    const noRepair = actor.is_mech?.() && (actor.system.repairs?.value ?? 0) <= 0;
    const card = (o, group, disabled) => `
        <div class="lancer-list-item la-stab-card" data-group="${group}" data-val="${o.val}" ${disabled ? 'data-disabled="true" style="opacity:0.45;pointer-events:none;"' : ''}>
            <i class="${o.icon} la-stab-icon"></i>
            <div class="la-stab-text">
                <span class="la-stab-label">${o.label}</span>
                <span class="la-stab-detail">${o.detail}</span>
            </div>
        </div>`;
    const content = `
        <div class="lancer-dialog-header">
            <h2 class="lancer-dialog-title">STABILIZE</h2>
            <p class="lancer-dialog-subtitle">${actor.name}</p>
        </div>
        <div style="padding: 10px;">
            <div class="lancer-section-title" style="margin-top:0;">OPTION 1</div>
            <div class="lancer-list">${opt1.map(o => card(o, '1', o.val === 'Repair' && noRepair)).join('')}</div>
            <div class="lancer-section-title" style="margin-top:14px;">OPTION 2</div>
            <div class="lancer-list">${opt2.map(o => card(o, '2', false)).join('')}</div>
        </div>`;
    return new Promise((resolve) => {
        let pickedOption1 = state.data.option1 ?? 'Cool';
        let pickedOption2 = state.data.option2 ?? 'Reload';
        if (pickedOption1 === 'Repair' && noRepair)
            pickedOption1 = 'Cool';
        let clearTargetUuid = null;
        let clearEffectId = null;
        let clearLabel = '';
        const stabilizeDialog = new Dialog({
            title: `Stabilize - ${actor.name}`,
            content,
            buttons: {
                submit: {
                    icon: '<i class="fas fa-check"></i>',
                    label: 'Submit',
                    callback: () => {
                        if (!pickedOption1 || !pickedOption2) {
                            ui.notifications.warn('Pick one option from each group.');
                            return false;
                        }
                        if ((pickedOption2 === 'ClearOwnCond' || pickedOption2 === 'ClearOtherCond') && !clearEffectId) {
                            ui.notifications.warn('Select a condition to clear first.');
                            return false;
                        }
                        state.data.option1 = pickedOption1;
                        state.data.option2 = pickedOption2;
                        if (clearEffectId) {
                            state.data.la_clearTargetUuid = clearTargetUuid;
                            state.data.la_clearEffectId = clearEffectId;
                        }
                        resolve(true);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: 'Cancel',
                    callback: () => resolve(false)
                }
            },
            default: 'submit',
            close: () => resolve(false),
            render: (html) => {
                const $h = html instanceof $ ? html : $(html);
                $h.find(`.la-stab-card[data-group="1"][data-val="${pickedOption1}"]`).addClass('selected');
                $h.find(`.la-stab-card[data-group="2"][data-val="${pickedOption2}"]`).addClass('selected');
                const refreshCardTargetLabel = ($card) => {
                    const $detailSpan = $card.find('.la-stab-detail');
                    if (clearLabel)
                        $detailSpan.text(`Target: ${clearLabel}`);
                };
                $h.find('.la-stab-card').on('click', async function (ev) {
                    ev.stopPropagation();
                    if ($(this).attr('data-disabled') === 'true')
                        return;
                    const groupId = String($(this).data('group'));
                    const optionValue = String($(this).data('val'));
                    if (groupId === '2' && (optionValue === 'ClearOwnCond' || optionValue === 'ClearOtherCond')) {
                        let targetActor = actor;
                        let labelPrefix = '';
                        if (optionValue === 'ClearOtherCond') {
                            const origin = actor.getActiveTokens?.()?.[0];
                            const picked = await chooseToken(origin, { title: 'PICK ALLY', includeSelf: false, count: 1 });
                            targetActor = picked?.[0]?.actor;
                            if (!targetActor)
                                return;
                            labelPrefix = `${targetActor.name}: `;
                        }
                        const pickedEffectId = await laPickConditionFromActor(targetActor, 'Clear which condition?', $h);
                        if (!pickedEffectId)
                            return;
                        const effect = targetActor.effects.get(pickedEffectId);
                        clearTargetUuid = targetActor.uuid;
                        clearEffectId = pickedEffectId;
                        clearLabel = `${labelPrefix}${effect?.name ?? 'Condition'}`;
                    } else if (groupId === '2') {
                        clearTargetUuid = null;
                        clearEffectId = null;
                        clearLabel = '';
                    }
                    $h.find(`.la-stab-card[data-group="${groupId}"]`).removeClass('selected');
                    $(this).addClass('selected');
                    if (groupId === '1')
                        pickedOption1 = optionValue;
                    else {
                        pickedOption2 = optionValue;
                        refreshCardTargetLabel($(this));
                    }
                });
            }
        }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 520, top: 450, left: 150 });
        stabilizeDialog.render(true);
    });
}

export async function laStabilizeExtras(state) {
    if (!state?.data)
        return true;
    const actor = state.actor;
    if (state.data.la_clearEffectId && state.data.la_clearTargetUuid) {
        try {
            const target = await fromUuid(state.data.la_clearTargetUuid);
            if (target?.deleteEmbeddedDocuments)
                await target.deleteEmbeddedDocuments('ActiveEffect', [state.data.la_clearEffectId]);
        } catch (e) {
            console.warn('lancer-automations | stabilize condition clear failed:', e);
        }
    }
    if (state.data.option2 === 'ClearBurn'
        && game.settings.get('lancer-automations', 'enableInfectionDamageIntegration')
        && actor?.system?.infection > 0) {
        try {
            await actor.update({ 'system.infection': 0 });
        } catch (e) {
            console.warn('lancer-automations | stabilize infection clear failed:', e);
        }
    }
    return true;
}

async function _consumeFlowAction(flow, success) {
    if (!success)
        return;
    if (!game.settings.get('lancer-automations', 'consumeAction'))
        return;
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    if (flow?.constructor?.name === 'StabilizeFlow') {
        await consumeAction(token, 'full');
        return;
    }
    const label = _flowResolveActivationLabel(flow);
    if (label === 'Quick' || label === 'Quick Tech' || label === 'Invade')
        await consumeAction(token, 'quick');
    else if (label === 'Full' || label === 'Full Tech')
        await consumeAction(token, 'full');
}
Hooks.on('lancer.postFlow.ActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SystemFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TechAttackFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.SimpleActivationFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.CoreActiveFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.TalentFlow', _consumeFlowAction);
Hooks.on('lancer.postFlow.StabilizeFlow', _consumeFlowAction);
