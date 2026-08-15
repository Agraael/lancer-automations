/* global game, Hooks, $, canvas, foundry, fromUuidSync */

import {
    pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker,
    clearSingleTargetShape, beginTargetSession, isTargetSessionActive, createTokenMark, createChanceLabel,
} from '../interactive/canvas.js';
import { targetInfoAllowed, haseSuccessChance, contestWinChance, pollForForm, chanceLabelsOn } from './targeting-ui.js';

function rollerLiveChance(state)
{
    if (!targetInfoAllowed())
        return null;
    const skill = String(state.data?.path ?? '').split('.').pop()?.toUpperCase();
    return () =>
    {
        const base = state.data?.acc_diff?.base;
        const netAcc = (Number(base?.accuracy) || 0) - (Number(base?.difficulty) || 0);
        const contest = state.la_extraData?.contest;
        if (contest)
        {
            const opponent = contest.actorUuid ? fromUuidSync(contest.actorUuid) : null;
            const oppActor = opponent?.actor ?? opponent;
            return oppActor ? contestWinChance(state.actor, skill, oppActor, contest.stat, { netAcc }) : null;
        }
        const preId = state.la_extraData?.targetTokenId;
        let hovered = isSingleTargetPickerActive() ? canvas.tokens?.hover : null;
        if (hovered && hovered.actor === state.actor)
            hovered = null;
        const chosen = hovered ?? Array.from(game.user.targets ?? [])[0] ?? null;
        let dc = 10;
        if (chosen)
            dc = (!hovered && preId && chosen.id === preId) ? (Number(state.la_extraData?.targetVal) || deriveTargetVal(chosen)) : deriveTargetVal(chosen);
        else if (!preId)
            dc = Number(state.la_extraData?.targetVal) || 10;
        return haseSuccessChance(state.actor, skill, dc, { netAcc, applyStatuses: false });
    };
}

// A Save is always rolled against the target's SAVE value.
function deriveTargetVal(targetToken)
{
    return targetToken?.actor?.system?.save || 10;
}

// "HULL" / "HULL Save (>= 8)" -> "HULL Save (>= N)"; targetVal null strips the save/threshold back to the base stat.
function applySaveTitle(state, targetVal)
{
    const base = String(state.data?.title ?? '').replace(/\s*\(>=\s*\d+\)\s*$/, '').trim();
    if (targetVal == null)
    {
        state.data.title = base.replace(/\s+Save\s*$/, '');
        return;
    }
    let saveTitle = base.includes('Save') ? base : base.replace('Check', 'Save');
    if (!saveTitle.includes('Save'))
        saveTitle += ' Save';
    state.data.title = `${saveTitle} (>= ${targetVal})`;
}

// The stat-roll HUD shares form[id^="accdiff"] with the attack HUD; the inner body div tells them apart.
function statRollForm()
{
    const $form = $('form[id^="accdiff"]');
    if (!$form.length || !$form.find('#hase-accdiff-dialog').length)
        return null;
    return $form;
}

function injectWhenReady(state)
{
    pollForForm(statRollForm, $form => injectButton(state, $form));
}

function injectButton(state, $form)
{
    $form = $form || statRollForm();
    if (!$form || !$form.length)
        return;
    if ($form.find('.la-statroll-target-button').length)
        return;

    let $row = $form.find('.accdiff-ranges').first();
    if (!$row.length)
    {
        const $section = $('<div class="accdiff-grid__section svelte-13q4b2q"><span class="accdiff-weight flex-center flexrow">Targeting</span><div class="accdiff-ranges flexrow svelte-13q4b2q"></div></div>');
        const $footer = $form.find('.accdiff-footer').first();
        if ($footer.length)
            $footer.before($section);
        else
            $form.append($section);
        $row = $section.find('.accdiff-ranges');
    }

    const caster = () => state.actor?.getActiveTokens?.()[0] ?? null;
    const $btn = $('<button class="range-button la-statroll-target-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> SAVE</button>');
    $btn.on('click', async (ev) =>
    {
        ev.preventDefault();
        ev.stopPropagation();
        if (isSingleTargetPickerActive())
        {
            cancelSingleTargetPicker();
            return;
        }
        $btn.addClass('la-targeting-active');
        try
        {
            await pickSingleTargetToggle(caster(), { single: true });
        }
        finally
        {
            $btn.removeClass('la-targeting-active');
        }
    });
    $row.append($btn);
}

// Show only the explicit pre-seeded API target; otherwise start clean so a stray target isn't taken as the check target.
function seedSingleTarget(state)
{
    const preId = state.la_extraData?.targetTokenId;
    const seededToken = preId ? canvas.tokens.get(preId) : null;
    if (seededToken)
        seededToken.setTarget(true, { releaseOthers: true });
    else
    {
        for (const target of [...(game.user.targets ?? [])])
            target.setTarget(false, { releaseOthers: false });
    }
}

export function registerStatRollTargetButton()
{
    Hooks.once('ready', () =>
    {
        const original = game.lancer?.flowSteps?.get?.('showStatRollHUD');
        if (!original)
            return;

        game.lancer.flowSteps.set('showStatRollHUD', async function(state, options)
        {
            // Alt-sheets' "Other Skill" uses its own flow, not StatRollFlow; alt-struct check flows stay excluded.
            const isStatOrSkillRoll = state?.name === 'StatRollFlow'
                || state?.name === 'SkillTriggerOther'
                || state?.data?.path === 'system.__generic_skill_trigger';
            const active = isStatOrSkillRoll && !isTargetSessionActive() && (() =>
            {
                try
                {
                    return game.settings.get('lancer-automations', 'statRollTargeting') || !!state.la_extraData?.forceTargeting;
                }
                catch
                {
                    return false;
                }
            })();
            const preId = active ? state.la_extraData?.targetTokenId : null;
            let rollerMark = null;
            let rollerChance = null;
            if (active)
            {
                try
                {
                    seedSingleTarget(state);
                    state.data?.acc_diff?.replaceTargets?.([...(game.user.targets ?? [])].map((target) => target.document.uuid));
                    injectWhenReady(state);
                    beginTargetSession();
                    rollerMark = createTokenMark(state.actor?.getActiveTokens?.()[0] ?? null);
                }
                catch
                { /* */ }
            }
            if (isStatOrSkillRoll && chanceLabelsOn())
            {
                try
                {
                    const chanceFn = rollerLiveChance(state);
                    if (chanceFn)
                        rollerChance = createChanceLabel(state.actor?.getActiveTokens?.()[0] ?? null, chanceFn);
                }
                catch
                { /* */ }
            }
            try
            {
                return await original(state, options);
            }
            finally
            {
                rollerChance?.destroy();
                if (active)
                {
                    // HUD closed: fold the chosen target into la_extraData (onCheck + card read it)...
                    try
                    {
                        const chosen = Array.from(game.user.targets ?? [])[0] ?? null;
                        state.la_extraData = state.la_extraData || {};
                        if (chosen && !(preId && chosen.id === preId))
                        {
                            // new/changed pick: derive difficulty here (an untouched pre-seed keeps executeStatRoll's value)
                            state.la_extraData.targetTokenId = chosen.id;
                            state.la_extraData.targetVal = deriveTargetVal(chosen);
                            applySaveTitle(state, state.la_extraData.targetVal);
                        }
                        else if (!chosen && preId)
                        {
                            // user cleared the pre-seeded token target; a caller-set numeric difficulty is left untouched
                            delete state.la_extraData.targetTokenId;
                            state.la_extraData.targetVal = 10;
                            applySaveTitle(state, null);
                        }
                    }
                    catch
                    { /* */ }
                    finally
                    {
                        // ...then always drop the picker/shape/targets so nothing leaks into a later attack's acc_diff.
                        try
                        {
                            rollerMark?.destroy();
                            if (isSingleTargetPickerActive())
                                cancelSingleTargetPicker();
                            clearSingleTargetShape();
                            for (const target of [...(game.user.targets ?? [])])
                                target.setTarget(false, { releaseOthers: false });
                        }
                        catch
                        { /* */ }
                    }
                }
            }
        });
    });
}
