import { accDiffTargetToken } from '../combat/grid-helpers.js';
import { hasStatus, removeEffectsByNameFromTokens } from './flagged-effects.js';
import { isWeaponItem } from '../utils/lancer-token.js';
import { isAoeDamage } from '../tools/weapon-bonus-utils.js';
import { localize, localizeFormat, escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { formulaBounds } from '../tools/roll-utils.js';
import { _detectSvelteScope } from './bonus-roll-hud.js';
import { watchDamageHud } from './damage-hud-watch.js';
import { VARIABLE, VARIABLE_PICKS, variableHudPick } from './variable-type.js';

export const VULNERABLE_STATUS = 'DeadRings_statuses_vulnerable';

const BONUS_TYPES = new Set(['Kinetic', 'Energy', 'Explosive']);
const VULNERABLE_DIE = '1d6';
const AREA_ROW = '"vulnerable ."';

function vulnerableStore(state)
{
    state.la_extraData = state.la_extraData || {};
    state.la_extraData._laVulnerable ??= { off: new Set(), type: null, applied: [] };
    return state.la_extraData._laVulnerable;
}

export function vulnerableTargets(state)
{
    const hud = state.data?.damage_hud_data;
    const item = state.data?.lancerItem ?? state.item;

    if (!hud || (item && !isWeaponItem(item)))
        return [];

    return (hud.targets ?? [])
        .map((target, index) => ({ target, index, token: accDiffTargetToken(target) }))
        .filter(({ target, token }) => token && Number(target.quality) >= 1 && hasStatus(token, VULNERABLE_STATUS));
}

function typeAverages(rows)
{
    const averages = new Map();

    for (const row of rows)
    {
        const type = row?.type === 'Variable' ? 'Kinetic' : row?.type;
        const formula = String(row?.val ?? '').trim();

        if (!BONUS_TYPES.has(type) || !formula || formula === '0')
            continue;

        const bounds = formulaBounds(formula);
        averages.set(type, (averages.get(type) ?? 0) + (bounds.min + bounds.max) / 2);
    }

    return averages;
}

export function vulnerableTypeChoicesFor(rows)
{
    if (rows.some(row => row?.laVariable || row?.type === VARIABLE))
        return [...VARIABLE_PICKS];
    return [...new Set(['Kinetic', ...typeAverages(rows).keys()])];
}

export function vulnerableTypeFor(rows)
{
    let best = null;

    for (const [type, average] of typeAverages(rows))
    {
        if (!best || average > best.average)
            best = { type, average };
    }

    return best?.type ?? 'Kinetic';
}

function damageRows(state)
{
    const rows = state.data?.damage_hud_data?.base?.total?.damage ?? [];
    const pick = variableHudPick(state);
    return pick ? rows.map(row => (row?.type === VARIABLE ? { ...row, type: pick, laVariable: pick } : row)) : rows;
}

export function vulnerableTypeChoices(state)
{
    return vulnerableTypeChoicesFor(damageRows(state));
}

export function vulnerableType(state)
{
    const chosen = vulnerableStore(state).type;
    if (chosen && vulnerableTypeChoices(state).includes(chosen))
        return chosen;
    return vulnerableTypeFor(damageRows(state));
}

export function vulnerableHalved(state)
{
    return (state.data?.damage_hud_data?.targets?.length ?? 0) > 1 || isAoeDamage(state);
}

export function vulnerableDieLabel(halved)
{
    return halved ? `${VULNERABLE_DIE}/2` : VULNERABLE_DIE;
}

export function vulnerableRowHtml({ checked, partial, type, die, cycles, scope, hudScope })
{
    const lower = type.toLowerCase();
    const hint = localizeFormat('LA.bonus.vulnerableHint', { die, type });
    const typeHint = cycles ? localizeFormat('LA.bonus.damageTypeCycle', { type }) : type;

    return `<div class="flexrow la-vulnerable-row" style="grid-area: vulnerable;">`
        + `<label class="container ${scope}" data-tooltip="${escapeHtml(hint)}"><input type="checkbox" class="la-vulnerable-checkbox ${scope}${partial ? ' partial' : ''}"${checked ? ' checked' : ''}> <i class="la-vulnerable-icon i--2 ${scope}"></i> <span style="text-wrap: nowrap;">${escapeHtml(localize('LA.bonus.vulnerable'))}</span></label>`
        + `<i class="cci i--2 cci-${lower} damage--${lower} la-vulnerable-type ${hudScope}${cycles ? ' la-cycles' : ''}" data-tooltip="${escapeHtml(typeHint)}"></i>`
        + `<span class="la-vulnerable-die">${escapeHtml(die)}</span></div>`;
}

export function vulnerableBoxHtml({ checked, name, type, die, scope })
{
    const hint = localizeFormat('LA.bonus.vulnerableTargetHint', { name, die, type });
    return `<label class="container ${scope} la-vulnerable-box" data-tooltip="${escapeHtml(hint)}"><input type="checkbox" class="la-vulnerable-box-checkbox ${scope}"${checked ? ' checked' : ''}> <i class="la-vulnerable-icon i--2 ${scope}"></i> <span style="text-wrap: nowrap;" class="${scope}"></span></label>`;
}

function setGridRow($grid, shown)
{
    const areas = $grid.css('grid-template-areas') || '';
    const has = areas.includes('vulnerable');

    if (shown && !has)
        $grid.css('grid-template-areas', `${areas} ${AREA_ROW}`);
    else if (!shown && has)
        $grid.css('grid-template-areas', areas.replace(AREA_ROW, '').trim());
}

export function injectVulnerableToggle(state)
{
    const store = vulnerableStore(state);
    let lastSignature = null;

    const view = ($form) =>
    {
        const targets = vulnerableTargets(state);
        const $cards = $form.find('.damage-hud-target-card');
        const carded = targets.filter(({ index }) => $cards.eq(index).find('.damage-target-config').length > 0);
        const halved = targets.length > 0 && vulnerableHalved(state);
        const type = vulnerableType(state);
        const choices = vulnerableTypeChoices(state);
        return {
            targets,
            carded,
            type,
            die: vulnerableDieLabel(halved),
            choices,
            signature: JSON.stringify([targets.map(({ index, token }) => [index, token.id, store.off.has(token.id)]), carded.length, $cards.length, type, halved, choices]),
        };
    };

    const render = ($form, current, refresh) =>
    {
        const $grid = $form.find('.damage-hud-options-grid').first();

        $form.find('.la-vulnerable-row, .la-vulnerable-box').remove();
        $form.find('.damage-target-config.la-four').removeClass('la-four');
        setGridRow($grid, current.targets.length > 0);

        if (current.targets.length === 0)
            return;

        const scope = _detectSvelteScope($form, 'label.container');
        const hudScope = _detectSvelteScope($form, '.damage-hud-section');
        const onCount = current.targets.filter(({ token }) => !store.off.has(token.id)).length;

        const $row = $(htmlToElement(vulnerableRowHtml({
            checked: onCount === current.targets.length,
            partial: onCount > 0 && onCount < current.targets.length,
            type: current.type,
            die: current.die,
            cycles: current.choices.length > 1,
            scope,
            hudScope,
        })));

        $grid.append($row);

        $row.find('.la-vulnerable-checkbox').on('change', function ()
        {
            const on = $(this).is(':checked');

            for (const { token } of current.targets)
            {
                if (on)
                    store.off.delete(token.id);
                else
                    store.off.add(token.id);
            }

            refresh();
        });

        $row.find('.la-vulnerable-type').on('click', () =>
        {
            if (current.choices.length < 2)
                return;
            store.type = current.choices[(current.choices.indexOf(current.type) + 1) % current.choices.length];
            refresh();
        });

        const $cards = $form.find('.damage-hud-target-card');

        for (const { index, token } of current.carded)
        {
            const $config = $cards.eq(index).find('.damage-target-config').first();
            const $box = $(htmlToElement(vulnerableBoxHtml({ checked: !store.off.has(token.id), name: token.name, type: current.type, die: current.die, scope })));

            $config.addClass('la-four').append($box);

            $box.find('input').on('change', function ()
            {
                if ($(this).is(':checked'))
                    store.off.delete(token.id);
                else
                    store.off.add(token.id);
                refresh();
            });
        }
    };

    watchDamageHud(($form, refresh) =>
    {
        const current = view($form);
        const rowsPresent = $form.find('.la-vulnerable-row').length === (current.targets.length > 0 ? 1 : 0);
        const boxesPresent = $form.find('.la-vulnerable-box').length === current.carded.length;

        if (current.signature === lastSignature && rowsPresent && boxesPresent)
            return;

        lastSignature = current.signature;
        render($form, current, refresh);
    });
}

export async function vulnerableApplyStep(state)
{
    const store = state.la_extraData?._laVulnerable;
    if (!store || state.la_extraData?._csmNoBonusDmg?.enabled)
        return true;

    const targets = vulnerableTargets(state).filter(({ token }) => !store.off.has(token.id));
    if (targets.length === 0)
        return true;

    const halved = vulnerableHalved(state);
    const entry = { type: vulnerableType(state), val: halved ? `ceil((${VULNERABLE_DIE}) / 2)` : VULNERABLE_DIE };

    for (const { target, token } of targets)
    {
        target.bonusDamage = [...(target.bonusDamage ?? []), { ...entry }];
        store.applied.push(token.id);
    }

    return true;
}

export async function consumeVulnerable(state)
{
    const applied = state.la_extraData?._laVulnerable?.applied ?? [];
    if (applied.length === 0)
        return;

    const tokens = (state.data?.targets ?? [])
        .filter(targetInfo => (targetInfo.hit || targetInfo.crit) && applied.includes(targetInfo.target?.id) && hasStatus(targetInfo.target, VULNERABLE_STATUS))
        .map(targetInfo => targetInfo.target);

    if (tokens.length > 0)
        await removeEffectsByNameFromTokens({ tokens, effectNames: [VULNERABLE_STATUS] });
}
