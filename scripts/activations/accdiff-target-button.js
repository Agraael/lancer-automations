// Attack HUD targeting: gates + accdiff row setup, then delegates to the shared targeting UI.

import {
    isSingleTargetPickerActive, cancelSingleTargetPicker, clearSingleTargetShape,
    isAreaPickerActive, cancelAreaPicker, clearAreaTargetShape,
    beginTargetSession, createTokenMark,
} from '../interactive/canvas.js';
import { rollHitCritChance } from '../interactive/canvas-helpers.js';
import { buildTargetingUI, aoeRanges, clearAttackShapePreview, targetInfoAllowed } from './targeting-ui.js';

function buildHitChanceFor(state)
{
    if (!targetInfoAllowed())
        return null;
    return (token) =>
    {
        const accDiff = state?.data?.acc_diff;
        const base = accDiff?.base;
        const weapon = accDiff?.weapon;
        const actor = token?.actor;
        if (!base || !weapon || typeof weapon.total !== 'function' || !actor?.system)
            return null;
        const isSmart = !!weapon.smart || !!state?.data?.is_smart;
        const bonus = (Number(base.grit) || 0) + (Number(base.flatBonus) || 0);
        const defense = isSmart ? (Number(actor.system.edef) || 8) : (Number(actor.system.evasion) || 5);
        const targetEntry = (accDiff.targets ?? []).find(entry => entry.targetUuid === token.document?.uuid);
        let netAcc;
        if (targetEntry)
            netAcc = Number(targetEntry.total) || 0;
        else
        {
            const cover = actor.statuses?.has?.('cover_hard') ? 2 : actor.statuses?.has?.('cover_soft') ? 1 : 0;
            const prone = actor.system?.statuses?.prone ? 1 : 0;
            const lockOn = actor.system?.statuses?.lockon ? 1 : 0;
            netAcc = (Number(weapon.total(cover)) || 0) + (Number(base.accuracy) || 0) - (Number(base.difficulty) || 0) + prone + lockOn;
        }
        const result = rollHitCritChance(bonus, netAcc, defense);
        if (weapon.tech)
            result.crit = 0;
        return result;
    };
}

function injectWhenReady(state)
{
    let elapsed = 0;
    const tick = () =>
    {
        const $form = $('form[id^="accdiff"]');
        if ($form.length)
        {
            injectButton(state, $form).catch(err => console.warn('lancer-automations | targeting inject failed', err));
            return;
        }
        elapsed += 50;
        if (elapsed > 2000)
            return;
        setTimeout(tick, 50);
    };
    tick();
}

async function injectButton(state, $form)
{
    try
    {
        if (!game.settings.get('lancer-automations', 'enableAttackTargeting'))
            return;
    }
    catch
    {
        // settings not ready
    }
    $form = $form || $('form[id^="accdiff"]');
    if (!$form.length)
        return;
    if ($form.find('.la-accdiff-target-button').length)
        return;

    const weapon = state.data?.lancerItem ?? state.item;
    const aoe = aoeRanges(weapon);

    let $row = $form.find('.accdiff-ranges').first();
    const hasNative = $row.length && $row.children().length > 0;

    // Non-AoE weapon with native range buttons: leave the native HUD alone.
    if (!aoe.length && hasNative)
        return;

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
    const $targetingSection = $row.closest('.accdiff-grid__section');
    ($targetingSection.length ? $targetingSection : $row).addClass('la-targeting-section');

    return buildTargetingUI(state, $form, $row, { weapon, aoe, hitChanceForFactory: buildHitChanceFor });
}

export function registerAccDiffTargetButton()
{
    Hooks.once('ready', () =>
    {
        const original = game.lancer?.flowSteps?.get?.('showAttackHUD');
        if (!original)
            return;
        game.lancer.flowSteps.set('showAttackHUD', async function(state, options)
        {
            // Must schedule before awaiting; original returns only after the HUD closes.
            let attackerMark = null;
            try
            {
                injectWhenReady(state);
                if (game.settings.get('lancer-automations', 'enableAttackTargeting'))
                {
                    beginTargetSession(buildHitChanceFor(state)); // shapes + live hit-% for targets already set before the HUD
                    attackerMark = createTokenMark(state.actor?.getActiveTokens?.()[0] ?? null);
                }
            }
            catch
            {
                // settings not ready
            }
            const hudResult = await original(state, options);
            // HUD closed (roll or cancel): stop the picker + drop shapes
            try
            {
                attackerMark?.destroy();
                if (isAreaPickerActive())
                    cancelAreaPicker();
                if (isSingleTargetPickerActive())
                    cancelSingleTargetPicker();
                clearSingleTargetShape(); // end session first so the area clear's resync is a no-op
                clearAreaTargetShape();
                clearAttackShapePreview();
            }
            catch
            {
                // ignore
            }
            return hudResult;
        });

        // postFlow fires after roll; weapon-fx snapshots flow-state, so clearing here is safe.
        const clearTargetsAfterRoll = () =>
        {
            try
            {
                if (!game.settings.get('lancer-automations', 'enableAttackTargeting'))
                    return;
            }
            catch
            {
                return;
            }
            for (const target of [...(game.user.targets ?? [])])
                target.setTarget(false, { releaseOthers: false });
        };
        for (const flowName of ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow'])
            Hooks.on(`lancer.postFlow.${flowName}`, clearTargetsAfterRoll);

        // scene change: drop shapes + their pulse tickers before the canvas is torn down
        Hooks.on('canvasTearDown', () =>
        {
            try
            {
                clearSingleTargetShape();
                clearAreaTargetShape();
                clearAttackShapePreview();
            }
            catch
            {
                // ignore
            }
        });
    });
}
