import { setLAFlag } from '../tools/flag-utils.js';
import { accDiffTargetToken } from '../combat/grid-helpers.js';
import { itemAllTags } from '../combat/per-frequency-tags.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { startChoiceCard } from '../interactive/network.js';
import { _detectSvelteScope } from './bonus-roll-hud.js';
import { watchDamageHud } from './damage-hud-watch.js';
import { VARIABLE, VARIABLE_PICKS, VARIABLE_TYPE_FLAG, storedVariableType, bestVariableType } from './variable-type.js';

const SET_ONCE_TAG = 'tg_set_damage_type';
const AREA_ROW = '"variable variable"';

function variableStore(state)
{
    state.la_extraData = state.la_extraData || {};
    state.la_extraData._laVariable ??= { picked: null, shown: null, applied: null };
    return state.la_extraData._laVariable;
}

export function isSetOnceItem(item)
{
    return !!item && itemAllTags(item).some(tag => tag?.lid === SET_ONCE_TAG);
}

function rowLists(hud)
{
    return [[hud.weapon, 'damage'], [hud.weapon, 'bonusDamage'], [hud.base, 'damage'], [hud.base, 'bonusDamage'], ...(hud.targets ?? []).map(target => [target, 'bonusDamage'])]
        .filter(([holder, key]) => Array.isArray(holder?.[key]));
}

const isOurs = row => row?.type === VARIABLE || (row?.laVariable && row.type === row.laVariable);

export function hudHasVariable(hud)
{
    return !!hud && rowLists(hud).some(([holder, key]) => holder[key].some(isOurs));
}

function applyPick(hud, pick)
{
    for (const [holder, key] of rowLists(hud))
    {
        const rows = holder[key];
        if (!rows.some(row => isOurs(row) && row.type !== pick))
            continue;
        holder[key] = rows.map(row => (isOurs(row) ? { ...row, type: pick, laVariable: pick } : row));
    }
}

function hitTokens(hud)
{
    return (hud.targets ?? [])
        .filter(target => Number(target.quality) >= 1)
        .map(target => accDiffTargetToken(target))
        .filter(token => token?.actor);
}

function defaultPick(state, hud)
{
    const item = state.data?.lancerItem ?? state.item;
    const stored = variableStore(state).picked ?? storedVariableType(item);
    if (stored)
        return stored;
    return game.user.isGM ? bestVariableType(hitTokens(hud).map(token => token.actor)) : VARIABLE_PICKS[0];
}

export function variableRowHtml({ pick, hudScope })
{
    const buttons = VARIABLE_PICKS.map((type) =>
    {
        const lower = type.toLowerCase();
        return `<span class="la-variable-type${type === pick ? ' active' : ''}" role="button" data-type="${type}" data-tooltip="${type}"><i class="cci cci-${lower} damage--${lower} i--2 ${hudScope}"></i></span>`;
    }).join('');

    return `<div class="flexrow la-variable-row" style="grid-area: variable;">`
        + `<span class="la-variable-label" data-tooltip="${escapeHtml(localize('LA.bonus.variableHint'))}"><i class="cci cci-variable damage--variable i--2 ${hudScope}"></i>${escapeHtml(localize('LA.bonus.variable'))}</span>`
        + `<span class="la-variable-pick">${buttons}</span></div>`;
}

function setGridRow($grid, shown)
{
    const areas = $grid.css('grid-template-areas') || '';
    const has = areas.includes(AREA_ROW);

    if (shown && !has)
        $grid.css('grid-template-areas', `${areas} ${AREA_ROW}`);
    else if (!shown && has)
        $grid.css('grid-template-areas', areas.replace(AREA_ROW, '').trim());
}

export function injectVariablePicker(state)
{
    const store = variableStore(state);
    let lastSignature = null;

    watchDamageHud(($form, refresh) =>
    {
        const hud = state.data?.damage_hud_data;
        if (!hud)
            return;

        const $grid = $form.find('.damage-hud-options-grid').first();

        if (!hudHasVariable(hud))
        {
            $form.find('.la-variable-row').remove();
            setGridRow($grid, false);
            store.shown = null;
            lastSignature = null;
            return;
        }

        const pick = defaultPick(state, hud);
        store.shown = pick;

        if (pick === lastSignature && $form.find('.la-variable-row').length)
            return;

        lastSignature = pick;
        $form.find('.la-variable-row').remove();
        setGridRow($grid, true);

        const $row = $(htmlToElement(variableRowHtml({ pick, hudScope: _detectSvelteScope($form, '.damage-hud-section') })));
        $grid.append($row);

        $row.find('.la-variable-type').on('click', function ()
        {
            store.picked = this.dataset.type;
            refresh();
        });
    });
}

export async function variableSetOnceStep(state)
{
    const item = state.data?.lancerItem ?? state.item;
    if (!isSetOnceItem(item) || storedVariableType(item))
        return true;

    const actor = state.actor;
    const originToken = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens?.()?.[0];

    const result = await startChoiceCard({
        title: localize('LA.bonus.variableSetTitle'),
        description: localizeFormat('LA.bonus.variableSetText', { name: escapeHtml(item.name) }),
        icon: 'cci cci-variable',
        choices: VARIABLE_PICKS.map(type => ({ text: type, icon: `cci cci-${type.toLowerCase()} damage--${type.toLowerCase()}` })),
        originToken,
        item,
    });

    const type = VARIABLE_PICKS[result?.choiceIdx ?? -1];
    if (type)
    {
        variableStore(state).picked = type;
        await setLAFlag(item, VARIABLE_TYPE_FLAG, type);
    }

    return true;
}

export async function variableResolveStep(state)
{
    const hud = state.data?.damage_hud_data;
    if (!hudHasVariable(hud))
        return true;

    const store = variableStore(state);
    const item = state.data?.lancerItem ?? state.item;
    const pick = defaultPick(state, hud);

    applyPick(hud, pick);
    store.applied = pick;

    if (isSetOnceItem(item) && (store.picked || storedVariableType(item)) && storedVariableType(item) !== pick)
        await setLAFlag(item, VARIABLE_TYPE_FLAG, pick);

    return true;
}

export function stampVariableTargets(state)
{
    const applied = state.la_extraData?._laVariable?.applied;
    if (!applied)
        return;

    for (const targetInfo of state.data?.targets ?? [])
        targetInfo.laVariable = applied;
}
