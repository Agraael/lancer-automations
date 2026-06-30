/* global game, Hooks, $ */

import {
    pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker, clearSingleTargetShape,
    pickAreaTargetToggle, isAreaPickerActive, cancelAreaPicker, clearAreaTargetShape,
} from '../interactive/canvas.js';
import { firstKeyFor } from '../interactive/keybindings.js';

const AOE_TYPES = ['Blast', 'Burst', 'Cone', 'Line'];

function maxSimpleRange(lancerItem) {
    if (!lancerItem || typeof lancerItem.rangesFor !== 'function')
        return 0;
    let ranges = [];
    try {
        ranges = lancerItem.rangesFor(['Range']) ?? [];
    } catch { /* */ }
    let max = 0;
    for (const r of ranges) {
        const v = Number(r?.val) || 0;
        if (v > max)
            max = v;
    }
    return max;
}

// AoE ranges on the weapon → [{ type:'Blast'|'Burst'|'Cone'|'Line', val:number }].
function aoeRanges(lancerItem) {
    if (!lancerItem || typeof lancerItem.rangesFor !== 'function')
        return [];
    let ranges = [];
    try {
        ranges = lancerItem.rangesFor(AOE_TYPES) ?? [];
    } catch { /* */ }
    return ranges
        .map(r => ({ type: String(r?.type ?? ''), val: Number(r?.val) || 0 }))
        .filter(r => r.val > 0 && AOE_TYPES.includes(r.type));
}

function sensorRange(actor) {
    return Number(actor?.system?.sensor_range) || 5;
}

function isTechAttack(state) {
    const li = state?.data?.lancerItem;
    if (li) {
        const isWeapon = (li.is_mech_weapon?.() || li.is_pilot_weapon?.()
            || (li.is_npc_feature?.() && li.system?.type === 'Weapon'));
        return !isWeapon;
    }
    const title = String(state?.data?.title ?? '').toLowerCase();
    return title === 'tech attack' || title.includes('tech');
}

function buildLabel(state) {
    if (isTechAttack(state))
        return `Sensors ${sensorRange(state.actor)}`;
    const simpleMax = maxSimpleRange(state.data?.lancerItem ?? state.item);
    if (simpleMax > 0)
        return `Range ${simpleMax}`;
    return 'Target';
}

function readToggles($form) {
    // Missing checkbox → default on for elevation/auto, off for propagation.
    return {
        elevationAware: $form.find('.la-tg-elev').prop('checked') !== false,
        autoElevation: $form.find('.la-tg-autoelev').prop('checked') !== false,
        propagation: !!$form.find('.la-tg-prop').prop('checked'),
    };
}

function injectToggleRow($form) {
    if ($form.find('.la-accdiff-area-toggles').length)
        return;
    const $tg = $(`<div class="la-accdiff-area-toggles flexrow" style="gap:12px;justify-content:center;padding:4px 0 2px;font-size:11px;color:#fff;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" class="la-tg-elev" checked> Elevation aware</label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" class="la-tg-autoelev" checked> Auto elevation</label>
        <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" class="la-tg-prop" checked> Propagation</label>
    </div>`);
    const $section = $form.find('.accdiff-ranges').first().closest('.accdiff-grid__section');
    if ($section.length)
        $section.append($tg);
    else
        $form.find('.accdiff-ranges').first().after($tg);
}

// Shortcut hint shown below the buttons only while a picker is active.
function ensureHint($form) {
    let $hint = $form.find('.la-accdiff-hint');
    if (!$hint.length) {
        $hint = $('<div class="la-accdiff-hint" style="display:none;text-align:center;opacity:0.6;font-size:10px;color:#fff;padding:2px 0;"></div>');
        const $section = $form.find('.accdiff-ranges').first().closest('.accdiff-grid__section');
        if ($section.length)
            $section.append($hint);
        else
            $form.find('.accdiff-ranges').first().after($hint);
    }
    return $hint;
}

function injectWhenReady(state) {
    let elapsed = 0;
    const tick = () => {
        const $form = $('form[id^="accdiff"]');
        if ($form.length) {
            injectButton(state, $form); return;
        }
        elapsed += 50;
        if (elapsed > 2000)
            return;
        setTimeout(tick, 50);
    };
    tick();
}

function injectButton(state, $form) {
    try {
        if (!game.settings.get('lancer-automations', 'enableAttackTargeting'))
            return;
    } catch { /* settings not ready */ }
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

    if (!$row.length) {
        const $section = $('<div class="accdiff-grid__section svelte-13q4b2q"><span class="accdiff-weight flex-center flexrow">Targeting</span><div class="accdiff-ranges flexrow svelte-13q4b2q"></div></div>');
        const $footer = $form.find('.accdiff-footer').first();
        if ($footer.length)
            $footer.before($section);
        else
            $form.append($section);
        $row = $section.find('.accdiff-ranges');
    }

    if (aoe.length) {
        // Replace the native template buttons with our cardless AoE pickers.
        $row.empty();
        const caster = () => state.actor?.getActiveTokens?.()[0] ?? null;
        for (const ar of aoe) {
            const pattern = ar.type.toLowerCase();
            const $b = $(`<button class="range-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> ${ar.type} ${ar.val}</button>`);
            $b.on('click', async (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (isAreaPickerActive()) {
                    cancelAreaPicker();
                    return;
                }
                const $hint = ensureHint($form);
                const lbl = (id) => (firstKeyFor(id) || '').replace(/^Key/, '');
                const tiltHint = pattern === 'line' ? ` · ${lbl('lineTiltDown')}/${lbl('lineTiltUp')}: tilt` : '';
                $hint.text(`⇧ stack shapes · Ctrl+wheel: rotate · ${lbl('elevationDown')}/${lbl('elevationUp')}: elevation${tiltHint} · Esc / re-click cancels`).show();
                try {
                    await pickAreaTargetToggle(caster(), {
                        pattern,
                        areaRange: ar.val,
                        size: 1,
                        keepExisting: ev.shiftKey,
                        getToggles: () => readToggles($form),
                    });
                } finally {
                    $hint.hide();
                }
            });
            $row.append($b);
        }
        injectToggleRow($form);
        maybeAutoStart($form);
        return;
    }

    // Simple range / tech: single-target picker.
    const label = buildLabel(state);
    const $btn = $(`<button class="range-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> ${label}</button>`);
    $btn.on('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (isSingleTargetPickerActive()) {
            cancelSingleTargetPicker();
            return;
        }
        const $hint = ensureHint($form);
        $hint.text('⇧ multi-targets · Esc / re-click cancels').show();
        try {
            await pickSingleTargetToggle();
        } finally {
            $hint.hide();
        }
    });
    $row.append($btn);
    maybeAutoStart($form);
}

// Auto-launch the first targeting button when the HUD opens with no target set (opt-in setting).
function maybeAutoStart($form) {
    try {
        if (!game.settings.get('lancer-automations', 'autoStartTargetPicking'))
            return;
    } catch { return; }
    if ((game.user.targets?.size ?? 0) > 0)
        return;
    if (isAreaPickerActive() || isSingleTargetPickerActive())
        return;
    const $btn = $form.find('.la-accdiff-target-button').first();
    if ($btn.length)
        setTimeout(() => $btn.trigger('click'), 50);
}

export function registerAccDiffTargetButton() {
    Hooks.once('ready', () => {
        const original = game.lancer?.flowSteps?.get?.('showAttackHUD');
        if (!original)
            return;
        game.lancer.flowSteps.set('showAttackHUD', async function(state, options) {
            // Must schedule before awaiting; original returns only after the HUD closes.
            try {
                injectWhenReady(state);
            } catch { /* */ }
            const ret = await original(state, options);
            // HUD closed (roll or cancel): stop the picker + drop shapes
            try {
                if (isAreaPickerActive())
                    cancelAreaPicker();
                if (isSingleTargetPickerActive())
                    cancelSingleTargetPicker();
                clearAreaTargetShape();
                clearSingleTargetShape();
            } catch { /* */ }
            return ret;
        });

        // Clear Foundry targets once the attack is fully resolved. postFlow runs after the roll, and
        // weapon-fx & co read their own flow-state snapshot, so this is safe.
        const clearTargetsAfterRoll = () => {
            try {
                if (!game.settings.get('lancer-automations', 'enableAttackTargeting'))
                    return;
            } catch { return; }
            for (const t of [...(game.user.targets ?? [])])
                t.setTarget(false, { releaseOthers: false });
        };
        for (const flowName of ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow'])
            Hooks.on(`lancer.postFlow.${flowName}`, clearTargetsAfterRoll);

        // scene change: drop shapes + their pulse tickers before the canvas is torn down
        Hooks.on('canvasTearDown', () => {
            try {
                clearAreaTargetShape();
                clearSingleTargetShape();
            } catch { /* */ }
        });
    });
}
