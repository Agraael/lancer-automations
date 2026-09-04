// Damage HUD targeting: same system as the attack HUD, on form#damage-hud. The HUD
// live-syncs its target cards with game.user.targets, so the pickers need no extra wiring.

import {
    isSingleTargetPickerActive, cancelSingleTargetPicker,
    isAreaPickerActive, cancelAreaPicker,
    beginTargetSession, isTargetSessionActive, createTokenMark,
} from '../interactive/canvas.js';
import { buildTargetingUI, aoeRanges, clearAllAttackShapes, injectWhenReady, targetInfoAllowed } from './targeting-ui.js';

const _formulaBounds = new Map();
function formulaBounds(formula)
{
    let bounds = _formulaBounds.get(formula);
    if (!bounds)
    {
        try
        {
            bounds = {
                min: Number(new Roll(formula).evaluateSync({ minimize: true }).total) || 0,
                max: Number(new Roll(formula).evaluateSync({ maximize: true }).total) || 0,
            };
        }
        catch
        {
            bounds = { min: 0, max: 0 };
        }
        _formulaBounds.set(formula, bounds);
    }
    return bounds;
}

// Damage min-max label on targets (the damage counterpart of the attack hit-%). Lazy: for
// weapon flows state.data.damage stays empty until the HUD closes, so read the live HUD rows.
function hitResultFor(state, token)
{
    const id = token?.document?.id ?? token?.id;
    if (!id)
        return null;
    for (const result of state.data?.hit_results ?? [])
    {
        const target = result?.target;
        if ((target?.document?.id ?? target?.id) === id)
            return result;
    }
    return null;
}

function reliableValue(state)
{
    const weapon = state.data?.damage_hud_data?.weapon;
    if (weapon && !weapon.reliable)
        return 0;
    return Number(weapon?.reliableValue ?? state.data?.reliable_val ?? 0) || 0;
}

function damageRangeLabelFor(state)
{
    if (!targetInfoAllowed())
        return null;
    return (token) =>
    {
        // A resolved miss only ever deals Reliable, so never preview the rolled range on it.
        const result = hitResultFor(state, token);
        if (result && !result.hit)
        {
            const reliable = reliableValue(state);
            return reliable > 0 ? { label: `${reliable}`, fill: 0xb0763a } : null;
        }
        const hud = state.data?.damage_hud_data;
        const entries = hud
            ? [...(hud.base?.damage ?? []), ...(hud.base?.bonusDamage ?? []), ...(hud.weapon?.damage ?? []), ...(hud.weapon?.bonusDamage ?? [])]
            : [...(state.data?.damage ?? []), ...(state.data?.bonus_damage ?? [])];
        let min = 0;
        let max = 0;
        for (const entry of entries)
        {
            const formula = String(entry?.val ?? '').trim();
            if (!formula)
                continue;
            const bounds = formulaBounds(formula);
            min += bounds.min;
            max += bounds.max;
        }
        if (max <= 0)
            return null;
        return { label: min === max ? `${max}` : `${min}-${max}`, fill: 0xff9a4d };
    };
}

// Damage rolls chained from an attack carry hit_results but no user targets (the attack
// flow cleared them); re-target those tokens so the session shapes and labels can attach.
function seedTargetsFromHitResults(state)
{
    const tokens = (state.data?.hit_results ?? [])
        .map(result => result?.target?.object ?? result?.target)
        .filter(token => typeof token?.setTarget === 'function');
    for (const [index, token] of tokens.entries())
        token.setTarget(true, { releaseOthers: index === 0, groupSelection: true });
}

function damageForm()
{
    const $form = $('form#damage-hud');
    return $form.length ? $form : null;
}

async function injectButton(state, $form)
{
    if ($form.find('.la-accdiff-target-button').length)
        return;

    const weapon = state.data?.lancerItem ?? state.item;
    const aoe = aoeRanges(weapon);

    const headerCls = $form.find('h4.damage-hud-section').first().attr('class')
        || 'damage-hud-section lancer-border-primary';
    const $section = $(`<div class="accdiff-grid__section la-targeting-section la-damage-targeting" style="border-top:1px solid var(--primary-color,#991e2a);margin-top:6px;padding-top:2px;">
        <h4 class="${headerCls}" style="justify-content: center;">Targeting</h4>
        <div class="accdiff-ranges flexrow svelte-13q4b2q"></div></div>`);
    const $targets = $form.find('.damage-hud-targets').first();
    const $footer = $form.find('.lancer-hud-buttons').first();
    if ($targets.length)
        $targets.before($section);
    else if ($footer.length)
        $footer.before($section);
    else
        $form.append($section);
    const $row = $section.find('.accdiff-ranges');

    const targeting = state.la_extraData?.laTargeting ?? null;
    if (targeting && !state.__laAttackShape)
    {
        state.__laAttackShape = {
            pattern: String(targeting.pattern ?? 'target'),
            size: Math.max(1, Number(targeting.size) || 1),
            range: Math.max(0, Number(targeting.range) || 0),
        };
    }
    // Targeting is an optional tool here: never auto-engage on weapon damage (targets come from
    // the attack); bare rolls with no target start with it on; API-requested targeting always starts.
    let autoStart = 'never';
    if (targeting)
        autoStart = 'force';
    else if (!weapon)
        autoStart = 'ifEmpty';

    return buildTargetingUI(state, $form, $row, {
        weapon,
        aoe,
        hitChanceForFactory: damageRangeLabelFor,
        hudHasTargets: () => (state.data?.damage_hud_data?.targets?.length ?? 0) > 0,
        autoStart,
        pulseOwner: 'la-damage-pick',
    });
}

export function registerDamageTargetButton()
{
    Hooks.once('ready', () =>
    {
        const original = game.lancer?.flowSteps?.get?.('showDamageHUD');
        if (!original)
            return;
        game.lancer.flowSteps.set('showDamageHUD', async function(state, options)
        {
            // Defer if another HUD already owns the shared shape session.
            const active = state?.name === 'DamageRollFlow' && !isTargetSessionActive() && (() =>
            {
                try
                {
                    return game.settings.get('lancer-automations', 'enableDamageTargeting');
                }
                catch
                {
                    return false;
                }
            })();
            let attackerMark = null;
            if (active)
            {
                try
                {
                    seedTargetsFromHitResults(state);
                    injectWhenReady(state, damageForm, injectButton, 'damage targeting');
                    const attackerToken = state.actor?.getActiveTokens?.()[0] ?? null;
                    beginTargetSession(damageRangeLabelFor(state), attackerToken);
                    attackerMark = createTokenMark(attackerToken);
                }
                catch
                {
                    // ignore
                }
            }
            try
            {
                return await original(state, options);
            }
            finally
            {
                if (active)
                {
                    try
                    {
                        attackerMark?.destroy();
                        if (isAreaPickerActive())
                            cancelAreaPicker();
                        if (isSingleTargetPickerActive())
                            cancelSingleTargetPicker();
                        clearAllAttackShapes();
                    }
                    catch
                    {
                        // ignore
                    }
                }
            }
        });

        const clearTargetsAfterRoll = () =>
        {
            try
            {
                if (!game.settings.get('lancer-automations', 'enableDamageTargeting'))
                    return;
                if (!game.settings.get('lancer-automations', 'clearTargetsAfterRoll'))
                    return;
            }
            catch
            {
                return;
            }
            for (const target of [...(game.user.targets ?? [])])
                target.setTarget(false, { releaseOthers: false });
        };
        Hooks.on('lancer.postFlow.DamageRollFlow', clearTargetsAfterRoll);
    });
}
