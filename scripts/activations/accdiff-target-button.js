/* global game, Hooks, $ */

import { pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker } from '../interactive/canvas.js';

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

    let $row = $form.find('.accdiff-ranges').first();
    if ($row.length && $row.children().length > 0)
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

    const label = buildLabel(state);
    const $btn = $(`<button class="range-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> ${label}</button>`);
    $btn.on('click', async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Re-clicking while the picker is open cancels it (same as Escape).
        if (isSingleTargetPickerActive()) {
            cancelSingleTargetPicker();
            return;
        }
        await pickSingleTargetToggle();
    });
    $row.append($btn);
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
            return await original(state, options);
        });
    });
}
