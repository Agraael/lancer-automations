import { localizeFormat } from '../tools/string-utils.js';
import { watchDamageHud } from './damage-hud-watch.js';
import { VARIABLE, VARIABLE_PICKS, variableHudPick } from './variable-type.js';

const TYPE_CLASS = /^(cci-|damage--)/;

function baseDamageTypes(state)
{
    const types = [];

    for (const row of state.data?.damage_hud_data?.base?.total?.damage ?? [])
    {
        const formula = String(row?.val ?? '').trim();
        if (!row?.type || !formula || formula === '0')
            continue;

        const offered = row.laVariable || row.type === VARIABLE ? VARIABLE_PICKS : [row.type];
        for (const type of offered)
        {
            if (!types.includes(type))
                types.push(type);
        }
    }

    return types;
}

export function reliableChosenType(state)
{
    const chosen = state.la_extraData?._laReliableType;
    return chosen && baseDamageTypes(state).includes(chosen) ? chosen : null;
}

function shownType(icon)
{
    const typeClass = [...icon.classList].find(name => name.startsWith('damage--'));
    return typeClass ? typeClass.slice('damage--'.length) : null;
}

function showType($icon, type)
{
    const lower = type.toLowerCase();
    if (shownType($icon[0]) === lower)
        return;

    $icon.removeClass((index, classes) => classes.split(/\s+/).filter(name => TYPE_CLASS.test(name)).join(' '));
    $icon.addClass(`cci-${lower} damage--${lower}`);
}

export function injectReliableTypePicker(state)
{
    state.la_extraData = state.la_extraData || {};

    watchDamageHud(($form, refresh) =>
    {
        const $icon = $form.find('.damage-hud-options-grid > [style*="grid-area: reliable"] > i.cci').first();
        if ($icon.length === 0)
            return;

        const types = baseDamageTypes(state);
        const chosen = reliableChosenType(state);
        const firstType = state.data?.damage_hud_data?.base?.total?.damage?.[0]?.type;
        const followed = chosen ?? (firstType === VARIABLE ? variableHudPick(state) : null);
        const shown = followed ?? types.find(type => type.toLowerCase() === shownType($icon[0])) ?? types[0];

        if (followed)
            showType($icon, followed);

        const cycles = types.length > 1;
        $icon.toggleClass('la-cycles', cycles);
        if (shown)
            $icon.attr('data-tooltip', cycles ? localizeFormat('LA.bonus.damageTypeCycle', { type: shown }) : shown);

        if ($icon.data('laReliablePick'))
            return;

        $icon.data('laReliablePick', true).on('click', function ()
        {
            const options = baseDamageTypes(state);
            if (options.length < 2)
                return;

            const current = reliableChosenType(state) ?? options.find(type => type.toLowerCase() === shownType(this)) ?? options[0];
            state.la_extraData._laReliableType = options[(options.indexOf(current) + 1) % options.length];
            refresh();
        });
    });
}
