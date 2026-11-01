import { TAB_DEFS } from './settings-fields.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';

import { MODULE_ID } from '../tools/constants.js';

// Field opt-in: `requires: 'key'`, `'!key'`, `'key=value'`, `'key!=value'` or a list, plus `requiresAll` for AND.
export function _requiredKeys(field)
{
    if (!field?.requires)
        return [];
    return Array.isArray(field.requires) ? field.requires : [field.requires];
}

// Compact boolean items count as fields so they can carry `requires` too.
export function _allKeyedFields()
{
    return TAB_DEFS.flatMap(tab => /** @type {any[]} */ (tab.fields ?? []))
        .flatMap(field => ['compactBooleans', 'compactStatusFx'].includes(field?.type)
            ? (field.items ?? []).map(item => (field.requires && !item.requires ? { ...item, requires: field.requires } : item))
            : [field]);
}

export function _fieldName(field)
{
    return field?.key ?? (field?.sub ? `_sfx.${field.sub}` : undefined);
}

export function _fieldByKey(key)
{
    return _allKeyedFields().find(field => _fieldName(field) === key);
}

export function _parseRequirement(key)
{
    const match = /^!?([^=!]+)(?:(!=|=)(.*))?$/.exec(key);
    return { name: match?.[1] ?? key, op: match?.[2] ?? null, expected: match?.[3] ?? '' };
}

function _settingLabel(name)
{
    if (name.startsWith('module:'))
        return game.modules.get(name.slice(7))?.title ?? name.slice(7);
    return localize(_fieldByKey(name)?.label ?? game.settings.settings.get(`${MODULE_ID}.${name}`)?.name ?? name);
}

function _choiceLabel(name, value)
{
    const field = _fieldByKey(name);
    const choices = typeof field?.getChoices === 'function' ? field.getChoices() : field?.choices;
    const match = choices?.find(choice => String(choice.value) === value);
    return localize(match?.label ?? game.settings.settings.get(`${MODULE_ID}.${name}`)?.choices?.[value] ?? value);
}

function _requirementLabel(key)
{
    const { name, op, expected } = _parseRequirement(key);
    const label = _settingLabel(name);
    if (key.startsWith('!'))
        return localizeFormat('LA.settingsMenus.requires.off', { label });
    if (op === '=')
        return localizeFormat('LA.settingsMenus.requires.choice', { label, choice: _choiceLabel(name, expected) });
    return label;
}

// A dependency that is itself gated counts as unmet, so chains resolve.
export function _isRequirementMet($html, key, seen = new Set())
{
    if (key.startsWith('!'))
        return !_isRequirementMet($html, key.slice(1), seen);
    const { name, op, expected } = _parseRequirement(key);
    if (seen.has(name))
        return true;
    seen.add(name);
    const input = $html.find(`[name="${name}"]`)[0];
    let on;
    if (name.startsWith('module:'))
        on = !!game.modules.get(name.slice(7))?.active;
    else if (op)
    {
        const current = String(input ? input.value : getModuleSetting(name));
        on = op === '=' ? current === expected : current !== expected;
    }
    else if (input)
        on = !!input.checked;
    else if (name.startsWith('_sfx.'))
        on = _readStatusFx(name.slice(5)) !== false;
    else
        on = !!getModuleSetting(name);
    if (!on)
        return false;
    return _isFieldMet($html, _fieldByKey(name), seen);
}

function _isFieldMet($html, field, seen = new Set())
{
    if (!field?.requires)
        return true;
    const keys = _requiredKeys(field);
    return field.requiresAll
        ? keys.every(key => _isRequirementMet($html, key, seen))
        : keys.some(key => _isRequirementMet($html, key, seen));
}

export function _requirementHint(field)
{
    const names = _requiredKeys(field).map(_requirementLabel);
    if (!names.length)
        return '';
    const joiner = ` ${localize(field.requiresAll ? 'LA.settingsMenus.requires.and' : 'LA.settingsMenus.requires.or')} `;
    return localizeFormat('LA.settingsMenus.requires.needs', { names: names.join(joiner) });
}

function _unmetRoot($html, field, depth = 0)
{
    if (!field?.requires || depth > 6)
        return null;
    for (const key of _requiredKeys(field))
    {
        if (_isRequirementMet($html, key))
            continue;
        if (key.startsWith('!'))
            return key;
        const { name } = _parseRequirement(key);
        if (name !== key && _isFieldMet($html, _fieldByKey(name)))
            return key;
        return _unmetRoot($html, _fieldByKey(name), depth + 1) ?? key;
    }
    return null;
}

function _requirementLineText($html, key)
{
    const { name, op, expected } = _parseRequirement(key);
    if (!game.user.isGM && !$html.find(`[name="${name}"]`).length)
        return localize('LA.settingsMenus.requires.worldOff');
    const label = _settingLabel(name);
    if (key.startsWith('!'))
        return localizeFormat('LA.settingsMenus.requires.turnOff', { label });
    if (op === '=')
        return localizeFormat('LA.settingsMenus.requires.setTo', { label, choice: _choiceLabel(name, expected) });
    return localizeFormat('LA.settingsMenus.requires.turnOn', { label });
}

export function _syncRequirementLines($html, gated)
{
    $html.find('.la-req-line').remove();
    $html.find('.la-req-grouped').removeClass('la-req-grouped');
    const unmet = gated
        .filter(entry => entry.$row.hasClass('la-req-unmet'))
        .map(entry => ({ row: entry.$row[0], root: _unmetRoot($html, entry.field) }))
        .filter(entry => entry.root);
    const sharedRoot = (list) => list.length > 0 && list.every(entry => entry.root === list[0].root);
    const addLine = (body, list) =>
    {
        if (!body)
            return;
        const line = document.createElement('p');
        line.className = 'notes la-section-hint la-req-line';
        const icon = document.createElement('i');
        icon.className = 'fas fa-triangle-exclamation la-req-icon';
        const text = document.createElement('span');
        text.textContent = _requirementLineText($html, list[0].root);
        line.append(icon, text);
        body.prepend(line);
        for (const entry of list)
            entry.row.classList.add('la-req-grouped');
    };
    $html.find('.la-card').each((/** @type {number} */ _i, /** @type {any} */ card) =>
    {
        const inCard = unmet.filter(entry => card.contains(entry.row));
        if (!inCard.length)
            return;
        if (inCard.some(entry => !entry.row.closest('.la-sub')) && sharedRoot(inCard))
        {
            addLine(card.querySelector(':scope > .la-card-body'), inCard);
            return;
        }
        for (const sub of card.querySelectorAll('.la-sub'))
        {
            const inSub = inCard.filter(entry => sub.contains(entry.row));
            if (sharedRoot(inSub))
                addLine(sub.querySelector(':scope > .la-sub-body'), inSub);
        }
    });
}

export function _fieldsWithRequirements()
{
    return _allKeyedFields().filter(field => _fieldName(field) && field.requires);
}

/** @param {string} sub */
export function _readStatusFx(sub, fallback = true)
{
    try
    {
        const cfg = getModuleSetting('statusFXConfig') ?? {};
        return cfg[sub] !== undefined ? cfg[sub] : fallback;
    }
    catch
    {
        return fallback;
    }
}

export { _settingLabel as settingLabel, _choiceLabel as choiceLabel };
