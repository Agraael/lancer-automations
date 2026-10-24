import { TG, createTokenTether } from '../interactive/canvas-helpers.js';
import { MODULE_ID } from '../tools/constants.js';
import { createTokenMark } from '../interactive/target-shapes.js';
import { localize } from '../tools/string-utils.js';
import { buildDuration, untilEndOfTurn, untilStartOfTurn, untilEndOfRound, untilStartOfRound, untilEndOfEncounter, currentTurnKey } from './duration-builders.js';

export { buildDuration, untilEndOfTurn, untilStartOfTurn, untilEndOfRound, untilStartOfRound, untilEndOfEncounter, currentTurnKey };

export function durationOptionsHtml()
{
    let durations = [
        { label: 'end', name: 'End of Turn' },
        { label: 'start', name: 'Start of Turn' },
        { label: 'roundEnd', name: 'End of Round' },
        { label: 'roundStart', name: 'Start of Round' },
        { label: 'encounter', name: 'End of Encounter' },
        { label: 'indefinite', name: 'Indefinite' },
        { label: 'permanent', name: 'Permanent' },
    ];
    if (!game.combat)
        durations = durations.filter(duration => duration.label === 'indefinite' || duration.label === 'permanent');
    return durations.map(duration => `<option value="${duration.label}" ${duration.label === 'end' ? 'selected' : ''}>${duration.name}</option>`).join('');
}

export function originOptionsHtml(selfTokenId)
{
    return canvas.tokens.placeables.map(token =>
    {
        const isSelf = token.id === selfTokenId;
        return `<option value="${token.id}" ${isSelf ? 'selected' : ''}>${token.name}${isSelf ? ' (self)' : ''}</option>`;
    }).join('');
}

export function durationFieldsHtml(prefix, selfTokenId)
{
    return `
        <div class="la-dur-tool" data-dur-prefix="${prefix}">
            <select id="${prefix}-duration" class="la-dur-select" title="Duration">${durationOptionsHtml()}</select>
            <span class="dur-opts la-dur-originpart la-dur-of">of</span>
            <select id="${prefix}-origin" class="dur-opts la-dur-originpart la-dur-origin" title="Duration origin token">${originOptionsHtml(selfTokenId)}</select>
            <button type="button" class="token-picker-btn dur-opts la-dur-originpart la-dur-pick" data-target="${prefix}-origin" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
            <input type="number" id="${prefix}-turns" value="1" min="0" class="dur-opts la-dur-turns" title="Turns. 0 = next matching trigger">
        </div>`;
}

export function setupDurationUI($root, prefix, { onChange, onPickStart } = {})
{
    const toggle = () =>
    {
        const durationLabel = $root.find(`#${prefix}-duration`).val();
        const off = durationLabel === 'indefinite' || durationLabel === 'permanent' || durationLabel === 'encounter';
        const isRound = durationLabel === 'roundEnd' || durationLabel === 'roundStart';
        const opts = $root.find(`#${prefix}-duration`).siblings('.dur-opts');
        opts.toggleClass('la-dur-disabled', off);
        opts.filter('select, input, button').prop('disabled', off);
        if (isRound)
        {
            const originParts = opts.filter('.la-dur-originpart');
            originParts.addClass('la-dur-disabled');
            originParts.filter('select, button').prop('disabled', true);
        }
        opts.filter('.la-dur-turns').attr('title', isRound ? 'Rounds, counting the current one' : 'Turns. 0 = next matching trigger');
    };
    $root.find(`#${prefix}-duration`).on('change', () =>
    {
        toggle();
        onChange?.();
    });
    $root.find(`#${prefix}-origin`).on('change', () => onChange?.());
    $root.find(`.token-picker-btn[data-target="${prefix}-origin"]`).on('click', async function (e)
    {
        e.preventDefault();
        e.stopPropagation();
        const api = game.modules.get(MODULE_ID).api;
        const currentVal = String($root.find(`#${prefix}-origin`).val());
        const caster = canvas.tokens.get(currentVal) || canvas.tokens.controlled[0];
        onPickStart?.();
        const selected = await api.chooseToken(caster, {
            count: 1,
            includeSelf: true,
            urgent: true,
            autoConfirm: true,
            title: localize('LA.dialogTitle.pickToken'),
            description: localize('LA.duration.selectATokenOnTheMap'),
            icon: 'fas fa-crosshairs'
        });
        if (selected && selected.length > 0)
            $root.find(`#${prefix}-origin`).val(selected[0].id).change();
        else
            onChange?.();
    });
    toggle();
}

// Same read/adjust logic as the Effect Manager apply (effectManager.js standard tab).
export function getDurationConfig($root, prefix)
{
    const durationLabel = String($root.find(`#${prefix}-duration`).val());
    const originID = String($root.find(`#${prefix}-origin`).val());
    const turnsInputRaw = Number.parseInt(String($root.find(`#${prefix}-turns`).val()));
    const turnsInput = Number.isNaN(turnsInputRaw) ? 1 : Math.max(0, turnsInputRaw);
    return { duration: buildDuration(durationLabel, originID, turnsInput), originID };
}

// White mark on the effect target, yellow on every reference token (duration origin, trigger origin),
// single yellow when same token. Each reference is tethered to the targets it applies to.
export function createDurationMarks()
{
    let marks = [];
    let tether = null;
    const clear = () =>
    {
        for (const mark of marks)
            mark.destroy();
        marks = [];
        tether?.destroy();
        tether = null;
    };
    return {
        update({ targetToken = null, targetTokens = null, originToken = null, originTokens = null } = {})
        {
            clear();
            const targets = (targetTokens ?? [targetToken]).filter(Boolean);
            const origins = (originTokens ?? [originToken]).filter(Boolean);
            const originIds = new Set(origins.map(token => token.id));
            for (const token of targets)
            {
                if (originIds.has(token.id))
                    continue;
                marks.push(createTokenMark(token, TG.reference));
            }
            for (const token of origins)
                marks.push(createTokenMark(token, TG.placed));
            if (!origins.length || !targets.length)
                return;
            const pairs = [];
            for (const target of targets)
            {
                for (const origin of origins)
                    pairs.push([target, origin]);
            }
            tether = createTokenTether();
            tether.setPairs(pairs);
        },
        destroy()
        {
            clear();
        }
    };
}
