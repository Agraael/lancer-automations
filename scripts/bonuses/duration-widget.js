import { TG } from '../interactive/canvas-helpers.js';
import { createTokenMark } from '../interactive/target-shapes.js';

export function durationOptionsHtml()
{
    let durations = [
        { label: 'end', name: 'End of Turn' },
        { label: 'start', name: 'Start of Turn' },
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
            <span class="dur-opts la-dur-of">of</span>
            <select id="${prefix}-origin" class="dur-opts la-dur-origin" title="Duration origin token">${originOptionsHtml(selfTokenId)}</select>
            <button type="button" class="token-picker-btn dur-opts la-dur-pick" data-target="${prefix}-origin" title="Pick Token"><i class="fas fa-crosshairs"></i></button>
            <input type="number" id="${prefix}-turns" value="1" min="0" class="dur-opts la-dur-turns" title="Turns. 0 = next matching trigger">
        </div>`;
}

export function setupDurationUI($root, prefix, { onChange, onPickStart } = {})
{
    const toggle = () =>
    {
        const val = $root.find(`#${prefix}-duration`).val();
        const off = val === 'indefinite' || val === 'permanent';
        const opts = $root.find(`#${prefix}-duration`).siblings('.dur-opts');
        opts.toggleClass('la-dur-disabled', off);
        opts.filter('select, input, button').prop('disabled', off);
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
        const api = game.modules.get('lancer-automations').api;
        const currentVal = String($root.find(`#${prefix}-origin`).val());
        const caster = canvas.tokens.get(currentVal) || canvas.tokens.controlled[0];
        onPickStart?.();
        const selected = await api.chooseToken(caster, {
            count: 1,
            includeSelf: true,
            urgent: true,
            autoConfirm: true,
            title: 'Pick Token',
            description: 'Select a token on the map to update the field.',
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
    let duration = { label: 'indefinite', turns: null, rounds: null };
    if (durationLabel === 'permanent')
        duration.label = 'permanent';
    else if (durationLabel !== 'indefinite')
    {
        const isOriginTurn = game.combat?.current?.tokenId === originID;
        const turns = (durationLabel === 'end' && isOriginTurn) ? turnsInput + 1 : (turnsInput === 0 ? 1 : turnsInput);
        duration = { label: durationLabel, turns, rounds: 0, _preAdjusted: true };
    }
    return { duration, originID };
}

// White mark on the effect target, yellow on the duration origin, single yellow when same token.
export function createDurationMarks()
{
    let marks = [];
    const clear = () =>
    {
        for (const mark of marks)
            mark.destroy();
        marks = [];
    };
    return {
        update({ targetToken = null, targetTokens = null, originToken = null } = {})
        {
            clear();
            const targets = (targetTokens ?? [targetToken]).filter(Boolean);
            for (const token of targets)
            {
                if (originToken && token.id === originToken.id)
                    continue;
                marks.push(createTokenMark(token, TG.reference));
            }
            if (originToken)
                marks.push(createTokenMark(originToken, TG.placed));
        },
        destroy()
        {
            clear();
        }
    };
}
