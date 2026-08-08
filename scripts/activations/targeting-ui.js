// Shared targeting machinery for the roll HUDs (attack accdiff + damage). Each HUD's
// injector locates/creates its row, then buildTargetingUI installs the full system.

import {
    pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker,
    pickAreaTargetToggle, isAreaPickerActive, cancelAreaPicker,
    rangePulse, RANGE_PULSE_PRIORITY, RANGE_GLOW,
} from '../interactive/canvas.js';
import { firstKeyFor } from '../interactive/keybindings.js';
import { getMaxItemRanges_WithBonus } from '../tools/misc-tools.js';
import { playUiSound } from '../tah/sound.js';

const AOE_TYPES = ['Blast', 'Burst', 'Cone', 'Line'];

// Who sees the target-info labels (hit chance / damage range): 'off' | 'gm' | 'all'.
export function targetInfoAllowed()
{
    let mode = 'gm';
    try
    {
        mode = game.settings.get('lancer-automations', 'targetInfoDisplay') ?? 'gm';
    }
    catch
    {
        mode = 'gm';
    }
    return mode === 'all' || (mode === 'gm' && !!game.user?.isGM);
}

// Returns {val,type,canSwitch}. canSwitch when both Range and Threat differ (then useThreat picks); else larger wins, Range on ties.
async function resolveWeaponRange(state, useThreat = false)
{
    if (isTechAttack(state))
        return { val: sensorRange(state.actor), type: 'Sensors', canSwitch: false };
    const item = state.data?.lancerItem ?? state.item;
    const thrown = !!state.data?.acc_diff?.weapon?.thrown;
    const throwDist = throwDistance(item);
    if (thrown && throwDist > 0)
        return { val: throwDist, type: 'Throw', canSwitch: false };
    const ranges = await getMaxItemRanges_WithBonus(item, state.actor);
    const rangeVal = ranges.Range ?? 0;
    const threatVal = ranges.Threat ?? 0;
    const canSwitch = rangeVal > 0 && threatVal > 0 && rangeVal !== threatVal;
    if (canSwitch)
    {
        return useThreat
            ? { val: threatVal, type: 'Threat', canSwitch: true }
            : { val: rangeVal, type: 'Range', canSwitch: true };
    }
    return threatVal > rangeVal
        ? { val: threatVal, type: 'Threat', canSwitch: false }
        : { val: rangeVal, type: 'Range', canSwitch: false };
}

// tg_thrown tag value, 0 if not throwable.
function throwDistance(lancerItem)
{
    const tags = lancerItem?.system?.active_profile?.all_tags || lancerItem?.system?.tags || [];
    const tag = tags.find(candidateTag => candidateTag?.lid === 'tg_thrown' || candidateTag?.id === 'tg_thrown');
    return tag ? (Number(tag.val ?? tag.num_val) || 0) : 0;
}

// AoE ranges on the weapon → [{ type:'Blast'|'Burst'|'Cone'|'Line', val:number }].
export function aoeRanges(lancerItem)
{
    if (!lancerItem || typeof lancerItem.rangesFor !== 'function')
        return [];
    let ranges = [];
    try
    {
        ranges = lancerItem.rangesFor(AOE_TYPES) ?? [];
    }
    catch
    {
        ranges = [];
    }
    return ranges
        .map(entry => ({ type: String(entry?.type ?? ''), val: Number(entry?.val) || 0 }))
        .filter(entry => entry.val > 0 && AOE_TYPES.includes(entry.type));
}

function sensorRange(actor)
{
    return Number(actor?.system?.sensor_range) || 5;
}

function isTechAttack(state)
{
    const lancerItem = state?.data?.lancerItem;
    if (lancerItem)
    {
        const isWeapon = (lancerItem.is_mech_weapon?.() || lancerItem.is_pilot_weapon?.()
            || (lancerItem.is_npc_feature?.() && lancerItem.system?.type === 'Weapon'));
        return !isWeapon;
    }
    const title = String(state?.data?.title ?? '').toLowerCase();
    return title === 'tech attack' || title.includes('tech');
}

function readToggles($form)
{
    // Missing checkbox → default on for elevation/auto, off for propagation.
    return {
        elevationAware: $form.find('.la-tg-elev').prop('checked') !== false,
        autoElevation: $form.find('.la-tg-autoelev').prop('checked') !== false,
        propagation: !!$form.find('.la-tg-prop').prop('checked'),
    };
}

function injectToggleRow($form)
{
    if ($form.find('.la-accdiff-area-toggles').length)
        return;
    const $tg = $(`<div class="la-accdiff-area-toggles flexrow" style="gap:12px;justify-content:center;padding:4px 0 2px;font-size:11px;color:var(--dark-text, #fff);flex-wrap:wrap;">
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
function ensureHint($form)
{
    let $hint = $form.find('.la-accdiff-hint');
    if (!$hint.length)
    {
        $hint = $('<div class="la-accdiff-hint" style="display:none;text-align:center;opacity:0.6;font-size:10px;color:var(--dark-text, #fff);padding:2px 0;"></div>');
        const $section = $form.find('.accdiff-ranges').first().closest('.accdiff-grid__section');
        if ($section.length)
            $section.append($hint);
        else
            $form.find('.accdiff-ranges').first().after($hint);
    }
    return $hint;
}

// Full targeting system on a prepared row: AoE pattern buttons or the big single-target
// button, shape strip, Range/Threat switch, pickers, auto-start.
export async function buildTargetingUI(state, $form, $row, { weapon = null, aoe = [], hitChanceForFactory = () => null, hudHasTargets = null, autoStart = 'setting', pulseOwner = null } = {})
{
    // pulseOwner: range pulse shown only while a picker from this HUD is running
    const setPickPulse = (rangeVal) =>
    {
        if (!pulseOwner)
            return;
        const token = state.actor?.getActiveTokens?.()[0] ?? null;
        if (token && rangeVal > 0)
            rangePulse.setRange(pulseOwner, { token, range: rangeVal, includeSelf: true, priority: RANGE_PULSE_PRIORITY.ATTACK_CARD, glowColor: weapon ? RANGE_GLOW.weapon : RANGE_GLOW.manual });
        else
            rangePulse.clear(pulseOwner);
    };
    const clearPickPulse = () =>
    {
        if (pulseOwner)
            rangePulse.clear(pulseOwner);
    };

    if (aoe.length)
    {
        // Replace the native template buttons with our cardless AoE pickers.
        $row.empty();
        const caster = () => state.actor?.getActiveTokens?.()[0] ?? null;
        $row.css({ justifyContent: 'center', alignItems: 'center', position: 'relative' });
        const $shapeToggle = $(`<button class="la-accdiff-shape-switch" type="button" title="Shape / Size / Range" style="position:absolute;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--dark-text,#fff);opacity:0.7;cursor:pointer;padding:2px 5px;font-size:15px;line-height:1;"><i class="fas fa-draw-polygon"></i></button>`);
        $row.append($shapeToggle);
        // hang the toggle off the left edge of the (centered) button group
        const positionShapeToggle = () =>
        {
            requestAnimationFrame(() =>
            {
                const buttons = $row.find('.la-accdiff-target-button').toArray();
                if (!buttons.length)
                    return;
                const firstRect = buttons[0].getBoundingClientRect();
                const lastRect = buttons[buttons.length - 1].getBoundingClientRect();
                const half = Math.round((lastRect.right - firstRect.left) / 2) + 1;
                $shapeToggle.css('right', `calc(50% + ${half}px)`);
            });
        };

        const resolved = await resolveWeaponRange(state);
        const firstAoe = aoe[0];
        state.__laAttackShapeDefaults = {
            pattern: firstAoe.type.toLowerCase(),
            size: firstAoe.val,
            range: Math.max(0, (resolved.val || 0) + firstAoe.val),
        };
        state.__laAttackShape = state.__laAttackShape ?? { ...state.__laAttackShapeDefaults };

        // while the strip is open it drives every button; closed = native per-pattern behavior
        const stripDrives = () => !!state.__laAttackShapeVisible;
        let pickerRun = null;
        let $lastActive = null;
        const launchStripPicker = ($activeBtn, keepExisting = false) =>
        {
            const $hint = ensureHint($form);
            const shape = state.__laAttackShape ?? state.__laAttackShapeDefaults;
            const isArea = !!shape.pattern && shape.pattern !== 'target';
            if (isArea)
            {
                const lbl = (id) => (firstKeyFor(id) || '').replace(/^Key/, '');
                const tiltHint = shape.pattern === 'line' ? ` · ${lbl('lineTiltDown')}/${lbl('lineTiltUp')}: tilt` : '';
                $hint.text(`⇧ stack shapes · Ctrl+wheel: rotate · ${lbl('elevationDown')}/${lbl('elevationUp')}: elevation${tiltHint} · Esc / re-click cancels`).stop(true, true).slideDown(120);
            }
            else
                $hint.text('⇧ multi-targets · Esc / re-click cancels').stop(true, true).slideDown(120);
            $lastActive = $activeBtn;
            $activeBtn.addClass('la-targeting-active');
            setPickPulse(shape.range);
            pickerRun = (async () =>
            {
                try
                {
                    if (isArea)
                    {
                        await pickAreaTargetToggle(caster(), {
                            pattern: shape.pattern,
                            areaRange: Math.max(1, Number(shape.size) || 1),
                            keepExisting,
                            getToggles: () => readToggles($form),
                            hitChanceFor: hitChanceForFactory(state),
                            castRange: shape.range > 0 ? shape.range : -1,
                        });
                    }
                    else
                    {
                        await pickSingleTargetToggle(caster(), {
                            hitChanceFor: hitChanceForFactory(state),
                            range: shape.range > 0 ? shape.range : null,
                            includeSelf: true,
                        });
                    }
                }
                finally
                {
                    $hint.stop(true, true).slideUp(120);
                    $activeBtn.removeClass('la-targeting-active');
                    clearPickPulse();
                }
            })();
            return pickerRun;
        };

        for (const aoeRange of aoe)
        {
            const pattern = aoeRange.type.toLowerCase();
            const $aoeBtn = $(`<button class="range-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> ${aoeRange.type} ${aoeRange.val}</button>`);
            $aoeBtn.on('click', async (ev) =>
            {
                ev.preventDefault();
                ev.stopPropagation();
                if (isAreaPickerActive())
                {
                    cancelAreaPicker();
                    return;
                }
                if (isSingleTargetPickerActive())
                {
                    cancelSingleTargetPicker();
                    return;
                }
                if (stripDrives())
                {
                    launchStripPicker($aoeBtn, ev.shiftKey);
                    return;
                }
                const $hint = ensureHint($form);
                const lbl = (id) => (firstKeyFor(id) || '').replace(/^Key/, '');
                const tiltHint = pattern === 'line' ? ` · ${lbl('lineTiltDown')}/${lbl('lineTiltUp')}: tilt` : '';
                $hint.text(`⇧ stack shapes · Ctrl+wheel: rotate · ${lbl('elevationDown')}/${lbl('elevationUp')}: elevation${tiltHint} · Esc / re-click cancels`).stop(true, true).slideDown(120);
                $lastActive = $aoeBtn;
                $aoeBtn.addClass('la-targeting-active');
                pickerRun = (async () =>
                {
                    try
                    {
                        const castRangeVal = (await resolveWeaponRange(state)).val;
                        const castRange = (castRangeVal + aoeRange.val) > 0 ? (castRangeVal + aoeRange.val) : -1;
                        setPickPulse(castRange);
                        await pickAreaTargetToggle(caster(), {
                            pattern,
                            areaRange: aoeRange.val,
                            size: 1,
                            keepExisting: ev.shiftKey,
                            getToggles: () => readToggles($form),
                            hitChanceFor: hitChanceForFactory(state),
                            castRange,
                        });
                    }
                    finally
                    {
                        $hint.stop(true, true).slideUp(120);
                        $aoeBtn.removeClass('la-targeting-active');
                        clearPickPulse();
                    }
                })();
                await pickerRun;
            });
            $row.append($aoeBtn);
        }
        positionShapeToggle();

        let restartTimer = null;
        const onShapeStripChange = () =>
        {
            if (!stripDrives())
                return;
            if (!isAreaPickerActive() && !isSingleTargetPickerActive())
                return;
            if (restartTimer)
                clearTimeout(restartTimer);
            restartTimer = setTimeout(async () =>
            {
                restartTimer = null;
                if (isAreaPickerActive())
                    cancelAreaPicker();
                if (isSingleTargetPickerActive())
                    cancelSingleTargetPicker();
                try
                {
                    await pickerRun;
                }
                catch
                {
                    // prior picker resolves to null on cancel; ignore
                }
                launchStripPicker($lastActive ?? $row.find('.la-accdiff-target-button').first());
            }, 250);
        };
        const strip = injectAttackShapeStrip($form, $row, state, { onCommit: onShapeStripChange, showReset: true });
        strip.$strip.toggle(!!state.__laAttackShapeVisible);
        $shapeToggle.on('click', (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            const next = !strip.$strip.is(':visible');
            state.__laAttackShapeVisible = next;
            if (next)
                strip.$strip.stop(true, true).slideDown(120);
            else
                strip.$strip.stop(true, true).slideUp(120);
        });
        injectToggleRow($form);
        maybeAutoStart($form, { mode: autoStart, hudHasTargets });
        return;
    }

    // Simple range / tech: single-target picker driven by the editable shape state.
    const $targetBtn = $(`<button class="range-button la-accdiff-target-button svelte-13q4b2q" type="button"><i class="fas fa-crosshairs"></i> <span class="la-tgt-label">…</span></button>`);
    let useThreat = false;
    const $switch = $(`<button class="la-accdiff-range-switch" type="button" title="Toggle Range / Threat" style="display:none;position:absolute;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--dark-text,#fff);opacity:0.7;cursor:pointer;padding:2px 5px;font-size:15px;line-height:1;"><i class="fas fa-arrow-right-arrow-left"></i></button>`);
    const isBasicAttack = !weapon;
    const $shapeToggle = $(`<button class="la-accdiff-shape-switch" type="button" title="Shape / Size / Range" style="position:absolute;top:50%;transform:translateY(-50%);background:transparent;border:none;color:var(--dark-text,#fff);opacity:0.7;cursor:pointer;padding:2px 5px;font-size:15px;line-height:1;"><i class="fas fa-draw-polygon"></i></button>`);

    // keep the big button dead-center: side buttons hang off it at a measured offset
    const positionSideButtons = () =>
    {
        requestAnimationFrame(() =>
        {
            const half = Math.round(($targetBtn.outerWidth() || 0) / 2) + 1;
            $shapeToggle.css('right', `calc(50% + ${half}px)`);
            $switch.css('left', `calc(50% + ${half}px)`);
        });
    };

    let strip = null;
    const initialResolved = await resolveWeaponRange(state, useThreat);
    state.__laAttackShapeDefaults = { pattern: 'target', size: 1, range: Math.max(0, initialResolved.val || 0) };
    state.__laAttackShape = state.__laAttackShape ?? { ...state.__laAttackShapeDefaults };

    const relabel = () =>
    {
        return resolveWeaponRange(state, useThreat).then(({ val, type, canSwitch }) =>
        {
            const native = { pattern: 'target', size: 1, range: Math.max(0, val || 0) };
            // follow the native range (thrown toggle, bonuses) while the shape is untouched
            if (shapesEqual(state.__laAttackShape, state.__laAttackShapeDefaults) && !shapesEqual(state.__laAttackShape, native))
            {
                state.__laAttackShape = { ...native };
                strip?.setFields(native);
            }
            state.__laAttackShapeDefaults = native;
            const shape = state.__laAttackShape ?? native;
            let label = 'Target';
            if (shape.pattern && shape.pattern !== 'target')
                label = `${shape.pattern[0].toUpperCase() + shape.pattern.slice(1)} ${Math.max(1, Number(shape.size) || 1)}`;
            else if (shape.range > 0)
                label = shape.range === val ? `${type} ${shape.range}` : `Range ${shape.range}`;
            $targetBtn.find('.la-tgt-label').text(label);
            $switch.css('display', canSwitch ? '' : 'none');
            if (!canSwitch)
                useThreat = false;
            positionSideButtons();
        });
    };
    relabel();
    $form.on('change.laTargetBtn', 'input[type="checkbox"]', relabel);

    let pickerRun = null;
    const launchPicker = () =>
    {
        const $hint = ensureHint($form);
        const shape = state.__laAttackShape ?? state.__laAttackShapeDefaults ?? { pattern: 'target', size: 1, range: 0 };
        const isArea = !!shape.pattern && shape.pattern !== 'target';
        if (isArea)
        {
            const lbl = (id) => (firstKeyFor(id) || '').replace(/^Key/, '');
            const tiltHint = shape.pattern === 'line' ? ` · ${lbl('lineTiltDown')}/${lbl('lineTiltUp')}: tilt` : '';
            $hint.text(`⇧ stack shapes · Ctrl+wheel: rotate · ${lbl('elevationDown')}/${lbl('elevationUp')}: elevation${tiltHint} · Esc / re-click cancels`).stop(true, true).slideDown(120);
        }
        else
            $hint.text('⇧ multi-targets · Esc / re-click cancels').stop(true, true).slideDown(120);
        $targetBtn.addClass('la-targeting-active');
        setPickPulse(shape.range);
        pickerRun = (async () =>
        {
            try
            {
                if (isArea)
                {
                    await pickAreaTargetToggle(state.actor?.getActiveTokens?.()[0] ?? null, {
                        pattern: shape.pattern,
                        areaRange: Math.max(1, Number(shape.size) || 1),
                        hitChanceFor: hitChanceForFactory(state),
                        castRange: shape.range > 0 ? shape.range : -1,
                        includeSelf: true,
                    });
                }
                else
                {
                    await pickSingleTargetToggle(state.actor?.getActiveTokens?.()[0] ?? null, {
                        hitChanceFor: hitChanceForFactory(state),
                        range: shape.range > 0 ? shape.range : null,
                        includeSelf: true,
                    });
                }
            }
            finally
            {
                $hint.stop(true, true).slideUp(120);
                $targetBtn.removeClass('la-targeting-active');
                clearPickPulse();
            }
        })();
        return pickerRun;
    };

    $targetBtn.on('click', (ev) =>
    {
        ev.preventDefault();
        ev.stopPropagation();
        playUiSound('toggle');
        if (isSingleTargetPickerActive())
            cancelSingleTargetPicker();
        else if (isAreaPickerActive())
            cancelAreaPicker();
        else
            launchPicker();
    });
    // The range pulse (tah/index.js) reads state.__laUseThreat and redraws on the hook; restart an open picker so its check follows.
    $switch.on('click', async (ev) =>
    {
        ev.preventDefault();
        ev.stopPropagation();
        useThreat = !useThreat;
        state.__laUseThreat = useThreat;
        const resolved = await resolveWeaponRange(state, useThreat);
        const native = { pattern: 'target', size: 1, range: Math.max(0, resolved.val || 0) };
        state.__laAttackShapeDefaults = native;
        state.__laAttackShape = { ...(state.__laAttackShape ?? native), range: native.range };
        strip?.setFields(state.__laAttackShape);
        await relabel();
        Hooks.callAll('lancer-automations.attackRangeMode', state);
        if (isSingleTargetPickerActive() || isAreaPickerActive())
        {
            if (isSingleTargetPickerActive())
                cancelSingleTargetPicker();
            if (isAreaPickerActive())
                cancelAreaPicker();
            await pickerRun;
            launchPicker();
        }
    });
    $row.css({ justifyContent: 'center', alignItems: 'center', gap: '6px', position: 'relative' });
    $row.append($shapeToggle, $targetBtn, $switch);
    positionSideButtons();

    let restartTimer = null;
    const onShapeStripChange = () =>
    {
        relabel();
        if (!isAreaPickerActive() && !isSingleTargetPickerActive())
            return;
        if (restartTimer)
            clearTimeout(restartTimer);
        restartTimer = setTimeout(async () =>
        {
            restartTimer = null;
            if (isAreaPickerActive())
                cancelAreaPicker();
            if (isSingleTargetPickerActive())
                cancelSingleTargetPicker();
            try
            {
                await pickerRun;
            }
            catch
            {
                // prior picker resolves to null on cancel; ignore
            }
            launchPicker();
        }, 250);
    };
    strip = injectAttackShapeStrip($form, $row, state, { onCommit: onShapeStripChange, showReset: !isBasicAttack });
    strip.$strip.toggle(!!state.__laAttackShapeVisible);
    $shapeToggle.on('click', (ev) =>
    {
        ev.preventDefault();
        ev.stopPropagation();
        const next = !strip.$strip.is(':visible');
        state.__laAttackShapeVisible = next;
        if (next)
            strip.$strip.stop(true, true).slideDown(120);
        else
            strip.$strip.stop(true, true).slideUp(120);
    });
    maybeAutoStart($form, { mode: autoStart, hudHasTargets });
}

function shapesEqual(shapeA, shapeB)
{
    return !!shapeA && !!shapeB && shapeA.pattern === shapeB.pattern
        && Number(shapeA.size) === Number(shapeB.size) && Number(shapeA.range) === Number(shapeB.range);
}

// Inline shape/size/range editor: writes state.__laAttackShape and calls onCommit() so a running picker restarts with the new shape.
function injectAttackShapeStrip($form, $targetRow, state, { onCommit = null, showReset = false } = {})
{
    $form.find('.la-attack-shape-strip').remove();
    const shape = state.__laAttackShape ?? { pattern: 'target', size: 1, range: 0 };
    const caster = state.actor?.getActiveTokens?.()[0] ?? null;
    const $strip = $(`
        <div class="la-attack-shape-strip" style="display:flex;align-items:center;justify-content:center;gap:6px;margin:4px 0 6px;font-size:12px;color:var(--dark-text,#ddd);">
            <select class="la-bas-shape" title="Shape" style="width:78px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid #444;padding:2px 4px;">
                <option value="target">Target</option>
                <option value="blast">Blast</option>
                <option value="cone">Cone</option>
                <option value="line">Line</option>
                <option value="burst">Burst</option>
            </select>
            <label class="la-bas-size-lbl" style="display:flex;align-items:center;gap:3px;">Size
                <input type="number" class="la-bas-size" min="1" max="20" value="${shape.size}" style="width:44px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid #444;padding:2px 4px;">
            </label>
            <label style="display:flex;align-items:center;gap:3px;">Range
                <input type="number" class="la-bas-range" min="0" max="30" value="${shape.range}" style="width:44px;background:rgba(0,0,0,0.3);color:inherit;border:1px solid #444;padding:2px 4px;">
            </label>
        </div>
    `);
    $strip.find('.la-bas-shape').val(shape.pattern);
    const $sizeLbl = $strip.find('.la-bas-size-lbl');
    const syncSizeVisibility = () =>
    {
        const isTarget = String($strip.find('.la-bas-shape').val()) === 'target';
        $sizeLbl.toggle(!isTarget);
    };
    syncSizeVisibility();
    // the custom preview pulse only runs once the shape differs from the roll's native one
    const syncPreview = (next) =>
    {
        if (shapesEqual(next, state.__laAttackShapeDefaults))
            clearAttackShapePreview();
        else
            updateAttackShapePreview(caster, next.range);
    };
    const setFields = (next) =>
    {
        $strip.find('.la-bas-shape').val(next.pattern ?? 'target');
        $strip.find('.la-bas-size').val(Math.max(1, Number(next.size) || 1));
        $strip.find('.la-bas-range').val(Math.max(0, Number(next.range) || 0));
        syncSizeVisibility();
        syncPreview(next);
    };
    const commit = () =>
    {
        const next = {
            pattern: String($strip.find('.la-bas-shape').val()),
            size: Math.max(1, Number($strip.find('.la-bas-size').val()) || 1),
            range: Math.max(0, Number($strip.find('.la-bas-range').val()) || 0),
        };
        state.__laAttackShape = next;
        syncPreview(next);
        onCommit?.();
    };
    $strip.on('change input', 'select,input', () =>
    {
        syncSizeVisibility();
        commit();
    });
    if (showReset)
    {
        const $reset = $(`<button class="la-bas-reset" type="button" title="Reset to weapon range" style="background:transparent;border:none;color:var(--dark-text,#fff);opacity:0.7;cursor:pointer;padding:2px 4px;font-size:13px;line-height:1;"><i class="fas fa-rotate-left"></i></button>`);
        $reset.on('click', (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            setFields(state.__laAttackShapeDefaults ?? { pattern: 'target', size: 1, range: 0 });
            commit();
        });
        $strip.append($reset);
    }
    $targetRow.before($strip);
    syncPreview(shape);
    return { $strip, setFields };
}

const ATTACK_SHAPE_RANGE_OWNER = 'la-attack-shape';
export function clearAttackShapePreview()
{
    rangePulse.clear(ATTACK_SHAPE_RANGE_OWNER);
}
function updateAttackShapePreview(casterToken, range)
{
    if (!casterToken || range <= 0)
    {
        clearAttackShapePreview();
        return;
    }
    rangePulse.setRange(ATTACK_SHAPE_RANGE_OWNER, {
        token: casterToken,
        range,
        includeSelf: true,
        priority: RANGE_PULSE_PRIORITY.ATTACK_CARD,
    });
}

// Auto-launch first targeting button. mode: 'setting' (opt-in world setting), 'ifEmpty' (no target set), 'force' (always), 'never'.
function maybeAutoStart($form, { mode = 'setting', hudHasTargets = null } = {})
{
    if (mode === 'never')
        return;
    if (mode === 'setting')
    {
        try
        {
            if (!game.settings.get('lancer-automations', 'autoStartTargetPicking'))
                return;
        }
        catch
        {
            return;
        }
    }
    if (mode !== 'force')
    {
        if (hudHasTargets?.())
            return;
        if ((game.user.targets?.size ?? 0) > 0)
            return;
    }
    if (isAreaPickerActive() || isSingleTargetPickerActive())
        return;
    const $targetBtn = $form.find('.la-accdiff-target-button').first();
    if ($targetBtn.length)
        setTimeout(() => $targetBtn.trigger('click'), 50);
}
