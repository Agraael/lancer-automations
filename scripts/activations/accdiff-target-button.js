// Attack HUD targeting: gates + accdiff row setup, then delegates to the shared targeting UI.

import {
    isSingleTargetPickerActive, cancelSingleTargetPicker,
    isAreaPickerActive, cancelAreaPicker,
    beginTargetSession, createTokenMark, getPlacedBlastCenters,
} from '../interactive/canvas.js';
import { rollHitCritChance } from '../interactive/canvas-helpers.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { buildTargetingUI, aoeRanges, clearAllAttackShapes, injectWhenReady, targetInfoAllowed, targetInfoAllowedFor, UNKNOWN_CHANCE } from './targeting-ui.js';
import { weaponTypeIcon } from '../tah/item-helpers.js';
import { accDiffTargetInvisible } from '../combat/grid-helpers.js';
import { laInstallRollCardTags } from '../bonuses/roll-card-rows.js';
import { laInstallRollCardHeader } from './roll-card-header.js';

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
        if (!targetInfoAllowedFor(actor))
            return UNKNOWN_CHANCE;
        const isSmart = !!weapon.smart || !!state?.data?.is_smart;
        const bonus = (Number(base.grit) || 0) + (Number(base.flatBonus) || 0);
        const defense = isSmart ? (Number(actor.system.edef) || 8) : (Number(actor.system.evasion) || 5);
        const targetEntry = (accDiff.targets ?? []).find(entry => entry.targetUuid === token.document?.uuid);
        let netAcc;
        let invisible;
        if (targetEntry)
        {
            netAcc = Number(targetEntry.total) || 0;
            invisible = accDiffTargetInvisible(targetEntry, actor);
        }
        else
        {
            const cover = actor.statuses?.has?.('cover_hard') ? 2 : actor.statuses?.has?.('cover_soft') ? 1 : 0;
            const prone = actor.system?.statuses?.prone ? 1 : 0;
            const lockOn = actor.system?.statuses?.lockon ? 1 : 0;
            netAcc = (Number(weapon.total(cover)) || 0) + (Number(base.accuracy) || 0) - (Number(base.difficulty) || 0) + prone + lockOn;
            invisible = !!actor.statuses?.has?.('invisible');
        }
        const result = rollHitCritChance(bonus, netAcc, defense);
        if (invisible)
        {
            result.hit /= 2;
            result.crit /= 2;
        }
        if (weapon.tech)
            result.crit = 0;
        return result;
    };
}

// The system header renders a generic cci-weapon glyph. Mask it with the weapon's own type icon.
function swapHeaderIcon(state, $form)
{
    const icon = weaponTypeIcon(state.data?.lancerItem ?? state.item);
    if (!icon)
        return;
    const $host = $form.closest('.app, .sliding-hud');
    const $glyph = ($host.length ? $host : $form).find('i.cci-weapon').first();
    if (!$glyph.length)
        return;
    const url = foundry.utils.getRoute(icon);
    $glyph.css({
        fontSize: 0,
        display: 'inline-block',
        width: '26px',
        height: '26px',
        verticalAlign: 'middle',
        backgroundColor: 'currentColor',
        webkitMask: `url("${url}") center / contain no-repeat`,
        mask: `url("${url}") center / contain no-repeat`,
    });
}

async function injectButton(state, $form)
{
    if (!getModuleSetting('enableAttackTargeting', true))
        return;
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

    const targeting = state.la_extraData?.laTargeting ?? null;
    if (targeting && !state.__laAttackShape)
    {
        state.__laAttackShape = {
            pattern: String(targeting.pattern ?? 'target'),
            size: Math.max(1, Number(targeting.size) || 1),
            range: Math.max(0, Number(targeting.range) || 0),
        };
    }

    // Weapon attacks honor the auto-start setting; bare basic/tech attacks start empty like bare damage rolls.
    return buildTargetingUI(state, $form, $row, { weapon, aoe, hitChanceForFactory: buildHitChanceFor, autoStart: weapon ? 'setting' : 'ifEmpty' });
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
                injectWhenReady(state, () => $('form[id^="accdiff"]'), injectButton, 'targeting');
                injectWhenReady(state, () => $('form[id^="accdiff"]'), swapHeaderIcon, 'weapon header icon');
                injectWhenReady(state, () => $('form[id^="accdiff"]'), laInstallRollCardTags, 'roll card tags');
                injectWhenReady(state, () => $('form[id^="accdiff"]'), laInstallRollCardHeader, 'roll card header');
                if (getModuleSetting('enableAttackTargeting'))
                {
                    const attackerToken = state.actor?.getActiveTokens?.()[0] ?? null;
                    beginTargetSession(buildHitChanceFor(state), attackerToken); // shapes + live hit-% + distances
                    attackerMark = createTokenMark(attackerToken);
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
                const blastCenters = getPlacedBlastCenters();
                if (blastCenters.length && state.__laAttackShape)
                    state.__laAttackShape = { ...state.__laAttackShape, blastCenters };
                clearAllAttackShapes();
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
            if (!getModuleSetting('enableAttackTargeting'))
                return;
            if (!getModuleSetting('clearTargetsAfterRoll'))
                return;
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
                clearAllAttackShapes();
            }
            catch
            {
                // ignore
            }
        });
    });
}
