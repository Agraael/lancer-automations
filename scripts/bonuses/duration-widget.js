import { TG, createTokenTether } from '../interactive/canvas-helpers.js';
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
        const durationLabel = $root.find(`#${prefix}-duration`).val();
        const off = durationLabel === 'indefinite' || durationLabel === 'permanent';
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

// permanent/indefinite skip turns; otherwise adjust for whether it's origin's current turn.
export function buildDuration(durationLabel, originID, turnsInput)
{
    if (durationLabel === 'permanent')
        return { label: 'permanent', turns: null, rounds: null };
    if (durationLabel === 'indefinite')
        return { label: 'indefinite', turns: null, rounds: null };
    const isOriginTurn = game.combat?.current?.tokenId === originID;
    const turns = (durationLabel === 'end' && isOriginTurn) ? turnsInput + 1 : (turnsInput === 0 ? 1 : turnsInput);
    return { label: durationLabel, turns, rounds: 0, _preAdjusted: true };
}

/**
 * Duration ending at the end of a token's own turn, N turns out. Handles the +1 when it is
 * already that token's turn, and stamps the token as the turn origin.
 * @param {any} token
 * @param {number} [turns=1]
 * @returns {object}
 */
export function untilEndOfTurn(token, turns = 1)
{
    const id = token?.id ?? token;
    return { ...buildDuration('end', id, turns), overrideTurnOriginId: id };
}

/**
 * Same, ending at the start of the token's turn.
 * @param {any} token
 * @param {number} [turns=1]
 * @returns {object}
 */
export function untilStartOfTurn(token, turns = 1)
{
    const id = token?.id ?? token;
    return { ...buildDuration('start', id, turns), overrideTurnOriginId: id };
}

/**
 * Stable key for the current combat turn ("round:turn"), null out of combat.
 * Use it to tell "the turn this happened on" from any later turn.
 * @returns {string|null}
 */
export function currentTurnKey()
{
    return game.combat ? `${game.combat.round}:${game.combat.turn}` : null;
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
