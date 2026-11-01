import { TAB_DEFS } from './settings-fields.js';
import { _readStatusFx } from './settings-requirements.js';
import { getModuleSetting, getExternalSetting } from '../tools/settings-utils.js';
import { localize } from '../tools/string-utils.js';

import { MODULE_ID } from '../tools/constants.js';

// Core is not a module, but its settings ride the same external-shortcut plumbing.
export function _extNamespaceActive(namespace)
{
    return namespace === 'core' || !!game.modules.get(namespace)?.active;
}

// Keep the owning module's own wording, minus a prefix that the section header already says
function externalLabel(field, setting)
{
    if (field.label)
        return localize(field.label);
    const name = localize(setting?.name ?? field.key);
    if (typeof name !== 'string')
        return name;
    const trimmed = name.replace(/^experimental:\s*/i, '');
    return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function _visibleTabs()
{
    return TAB_DEFS.filter(tab => !tab.condition || tab.condition()).map(tab =>
    {
        const reason = tab.disabledReason?.() ?? null;
        return { ...tab, _disabled: !!reason, _disabledReason: reason };
    });
}

const KEY_DISPLAY = {
    ArrowLeft: '⬅',
    ArrowRight: '➡',
    ArrowUp: '⬆',
    ArrowDown: '⬇',
    Backquote: '`',
    Backslash: '\\',
    BracketLeft: '[',
    BracketRight: ']',
    Comma: ',',
    Equal: '=',
    Meta: '⊞',
    MetaLeft: '⊞',
    MetaRight: '⊞',
    OsLeft: '⊞',
    OsRight: '⊞',
    Minus: '-',
    NumpadAdd: 'Numpad+',
    NumpadSubtract: 'Numpad-',
    Period: '.',
    Quote: "'",
    Semicolon: ';',
    Slash: '/'
};
function _displayKey(code)
{
    if (code in KEY_DISPLAY)
        return KEY_DISPLAY[code];
    if (typeof code !== 'string')
        return String(code);
    if (code.startsWith('Digit'))
        return code.slice(5);
    if (code.startsWith('Key'))
        return code.slice(3);
    return code;
}
function _formatBinding(binding)
{
    const parts = [...(binding.modifiers ?? [])];
    parts.push(_displayKey(binding.key));
    return parts.join(' + ');
}

function _isLockedForUser(key)
{
    if (game.user.isGM)
        return false;
    if (!key)
        return true;
    if (typeof key === 'string' && key.startsWith('_sfx.'))
        return true;
    const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
    if (!setting)
        return true;
    return setting.scope === 'world';
}

function _rowFlags(setting, choices = [])
{
    const raw = setting?.default;
    const text = raw !== null && typeof raw === 'object' ? String(raw) : raw;
    const primitive = ['string', 'number', 'boolean'].includes(typeof text) && (typeof raw !== 'object' || /^#[0-9a-fA-F]{6}$/.test(text));
    const hasDefault = primitive && (!choices.length || choices.some(choice => String(choice.value) === String(text)));
    return {
        hasDefault,
        defaultValue: hasDefault ? String(text) : '',
        isReload: !!setting?.requiresReload,
        isClientOnly: !!game.user.isGM && setting?.scope === 'client',
    };
}

/** @param {any} field */
function _buildItem(field)
{
    if (field.type === 'section')
    {
        if (field.requireForkTitle)
        {
            const mod = game.modules.get(field.requireForkTitle.module);
            if (!mod?.active || mod.title !== field.requireForkTitle.title)
                return null;
        }
        return { type: 'section', label: localize(field.label), hint: localize(field.hint ?? ''), isSection: true, collapsible: field.collapsible !== false, collapsed: !!field.collapsed, isSubsection: !!field.subsection };
    }
    if (field.type === 'button')
    {
        if (field.requiresModule && !game.modules.get(field.requiresModule)?.active)
            return null;
        let state = null;
        try
        {
            state = typeof field.state === 'function' ? field.state() : null;
        }
        catch
        { /* setting not registered */ }
        return { type: 'button', isButton: true, key: field.key, label: localize(field.label), hint: localize(field.hint ?? ''), icon: field.icon ?? '', state, isLocked: !game.user.isGM && !field.clientAllowed };
    }
    if (field.type === 'table')
    {
        const table = field.getTable();
        const rows = table.rows.map(row => ({
            ...row,
            label: localize(row.label),
            cells: row.cells.map(cell => ({
                ...cell,
                text: localize(cell.text),
                choices: cell.choices?.map(choice => ({ ...choice, label: localize(choice.label) })),
                isLocked: cell.name ? _isLockedForUser(cell.name) : false
            }))
        }));
        return { type: 'table', label: localize(field.label), isTable: true, columns: table.columns.map(localize), rows };
    }
    if (field.type === 'keybinding')
    {
        const mod = game.modules.get(field.module);
        if (!mod?.active)
            return null;
        if (field.requireTitle && mod.title !== field.requireTitle)
            return null;
        const fullKey = `${field.module}.${field.key}`;
        const action = /** @type {any} */ (game.keybindings).actions?.get(fullKey);
        if (!action)
            return null;
        const bindings = /** @type {any[]} */ (game.keybindings.bindings?.get(fullKey)) ?? [];
        return {
            type: 'keybinding',
            isKeybinding: true,
            fullKey,
            name: localize(action.name ?? field.key),
            hint: action.hint ? localize(action.hint) : '',
            bindings: bindings.map(/** @type {any} */ binding => ({ display: _formatBinding(binding) }))
        };
    }
    if (field.type === 'tour')
    {
        const mod = game.modules.get(field.module);
        if (!mod?.active)
            return null;
        const fullKey = `${field.module}.${field.key}`;
        const tour = /** @type {any} */ (game.tours)?.get?.(fullKey);
        if (!tour)
            return null;
        const rawTitle = tour.title ?? field.key;
        const title = String(rawTitle).replace(/^Lancer Automations:\s*/i, '');
        const stepCount = tour.steps?.length ?? 0;
        return {
            type: 'tour',
            isTour: true,
            fullKey,
            title,
            stepCount,
            description: tour.description ?? '',
        };
    }
    if (field.type === 'moduleBoolean')
    {
        if (!_extNamespaceActive(field.module))
            return null;
        // Absent means that build of the module does not have it, so there is nothing to shortcut to
        const setting = /** @type {any} */ (game.settings.settings.get(`${field.module}.${field.key}`));
        if (!setting)
            return null;
        const value = !!getExternalSetting(field.module, field.key, setting.default);
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'boolean',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isBoolean: true,
            ..._rowFlags(setting),
            isLocked: setting.scope === 'world' && !game.user.isGM
        };
    }
    if (field.type === 'moduleSlider')
    {
        if (!_extNamespaceActive(field.module))
            return null;
        const setting = /** @type {any} */ (game.settings.settings.get(`${field.module}.${field.key}`));
        if (!setting)
            return null;
        const value = getExternalSetting(field.module, field.key, setting.default);
        const range = setting.range ?? {};
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'slider',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isSlider: true,
            sliderMin: field.min ?? range.min ?? 0,
            sliderMax: field.max ?? range.max ?? 1,
            sliderStep: field.step ?? range.step ?? 1,
            ..._rowFlags(setting),
            isLocked: setting.scope === 'world' && !game.user.isGM
        };
    }
    if (field.type === 'moduleColor')
    {
        if (!game.modules.get(field.module)?.active)
            return null;
        const setting = /** @type {any} */ (game.settings.settings.get(`${field.module}.${field.key}`));
        if (!setting)
            return null;
        let value = getExternalSetting(field.module, field.key, setting.default);
        // A ColorField hands back a Color object, and the picker needs a plain hex string
        const hexRe = /^#[0-9a-fA-F]{6}$/;
        if (typeof value !== 'string' || !hexRe.test(value))
        {
            const asText = (typeof value?.toString === 'function') ? value.toString() : null;
            value = (asText && hexRe.test(asText)) ? asText : (setting.default ?? '#000000');
        }
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'color',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isColor: true,
            ..._rowFlags(setting),
            isLocked: setting.scope === 'world' && !game.user.isGM
        };
    }
    if (field.type === 'moduleSelect')
    {
        if (!_extNamespaceActive(field.module))
            return null;
        const setting = game.settings.settings.get(`${field.module}.${field.key}`);
        if (!setting)
            return null;
        const value = getExternalSetting(field.module, field.key, setting.default);
        // Core puts its choices on the DataField rather than on the setting config.
        const choices = Object.entries(setting.choices ?? setting.type?.choices ?? {}).map(([choiceValue, choiceLabel]) => ({
            value: choiceValue,
            label: localize(String(choiceLabel)),
            selected: choiceValue === String(value),
        }));
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'select',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isSelect: true,
            choices,
            ..._rowFlags(setting, choices),
            isLocked: setting.scope === 'world' && !game.user.isGM
        };
    }
    if (field.type === 'compactBooleans')
    {
        return {
            type: 'compactBooleans',
            isCompactBooleans: true,
            items: (field.items ?? []).map((/** @type {any} */ it) =>
            {
                let value = true;
                try
                {
                    value = !!getModuleSetting(it.key);
                }
                catch
                { /* not ready */ }
                const setting = game.settings.settings.get(`${MODULE_ID}.${it.key}`);
                const hint = it.hint || setting?.hint || '';
                return { key: it.key, label: localize(it.label), hint: localize(hint), value, preview: !!it.preview, ..._rowFlags(setting), isLocked: _isLockedForUser(it.key) };
            }),
        };
    }
    if (field.type === 'compactStatusFx')
    {
        return {
            type: 'compactBooleans',
            isCompactBooleans: true,
            items: (field.items ?? []).map((/** @type {any} */ it) => ({
                key: `_sfx.${it.sub}`,
                label: localize(it.label),
                value: _readStatusFx(it.sub) !== false,
                preview: false,
                isLocked: !game.user.isGM
            })),
        };
    }
    if (field.type === 'statusFx')
    {
        // _sfx. prefix routes the value back into statusFXConfig on save.
        const fallback = field.default ?? true;
        return {
            key: `_sfx.${field.sub}`,
            type: 'boolean',
            label: localize(field.label),
            hint: localize(field.hint ?? ''),
            value: _readStatusFx(field.sub, fallback) !== false,
            isBoolean: true,
            choices: [],
            isLocked: !game.user.isGM
        };
    }
    let value;
    try
    {
        value = getModuleSetting(field.key);
    }
    catch
    {
        value = field.default;
    }
    const setting = /** @type {any} */ (game.settings.settings.get(`${MODULE_ID}.${field.key}`) || {});
    if (field.type === 'color')
    {
        const hexRe = /^#[0-9a-fA-F]{6}$/;
        if (typeof value !== 'string' || !hexRe.test(value))
        {
            const fromColor = (typeof value?.toString === 'function') ? value.toString() : null;
            value = (fromColor && hexRe.test(fromColor)) ? fromColor : (setting.default ?? field.default ?? '#000000');
        }
    }
    const choices = (() =>
    {
        const raw = (typeof field.getChoices === 'function' ? field.getChoices() : field.choices);
        if (raw)
            return raw.map(choice => ({ ...choice, label: localize(choice.label), selected: choice.selected ?? (choice.value === value) }));
        if (setting.choices)
        {
            return Object.entries(setting.choices).map(([choiceValue, choiceLabel]) => ({
                value: choiceValue, label: localize(choiceLabel), selected: choiceValue === value,
            }));
        }
        return [];
    })();
    return {
        key: field.key,
        type: field.type,
        label: externalLabel(field, setting),
        hint: localize(field.hint ?? setting.hint ?? ''),
        value,
        isBoolean: field.type === 'boolean',
        isNumber: field.type === 'number',
        isString: field.type === 'string',
        isFolder: field.type === 'folder',
        isAudio: field.type === 'audio',
        isColor: field.type === 'color',
        isSelect: field.type === 'select',
        isSlider: field.type === 'slider',
        sliderMin: field.min ?? setting.range?.min ?? 0,
        sliderMax: field.max ?? setting.range?.max ?? 1,
        sliderStep: field.step ?? setting.range?.step ?? 0.1,
        isSection: field.type === 'section',
        isNested: !!field.nested,
        choices,
        ..._rowFlags(setting, field.type === 'select' ? choices : []),
        isLocked: _isLockedForUser(field.key)
    };
}

const _slug = (/** @type {string} */ text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A section owns the rows after it, a subsection nests inside the current one.
/** @param {string} tabId @param {any[]} items */
export function _groupSections(tabId, items)
{
    /** @type {any[]} */
    const sections = [];
    let current = null;
    let currentSub = null;
    const rowCount = (/** @type {any} */ item) => item.isCompactBooleans ? item.items.length : (item.isSection ? 0 : 1);
    const ensureCard = () =>
    {
        if (!current)
        {
            current = { id: `la-sec-${tabId}-general`, label: localize('LA.settingsMenus.section.general.label'), headerless: true, collapsible: false, collapsed: false, hint: '', items: [], subs: [], count: 0 };
            sections.push(current);
        }
        return current;
    };
    for (const item of items)
    {
        if (item.isSection && !item.isSubsection)
        {
            current = { id: `la-sec-${tabId}-${_slug(item.label)}`, label: item.label, headerless: false, collapsible: item.collapsible, collapsed: item.collapsed, hint: item.hint, items: [], subs: [], count: 0 };
            currentSub = null;
            sections.push(current);
            continue;
        }
        if (item.isSection && item.isSubsection)
        {
            currentSub = { label: item.label, collapsible: item.collapsible, collapsed: item.collapsed, hint: item.hint, items: [] };
            ensureCard().subs.push(currentSub);
            continue;
        }
        (currentSub ? currentSub.items : ensureCard().items).push(item);
        ensureCard().count += rowCount(item);
        if (item.isCompactBooleans && !currentSub)
            ensureCard().hasGrid = true;
    }
    return sections;
}

// Players only see what they can change.
function _dropLockedItems(items)
{
    if (game.user.isGM)
        return items;
    return items.map(item =>
    {
        if (item.isCompactBooleans)
        {
            const open = item.items.filter(entry => !entry.isLocked);
            return open.length > 0 ? { ...item, items: open } : null;
        }
        if (item.isTable)
        {
            const rows = item.rows.filter(row => row.cells.some(cell => !cell.isLocked));
            return rows.length > 0 ? { ...item, rows } : null;
        }
        return item.isLocked ? null : item;
    }).filter(Boolean);
}

export function _dropEmptySections(sections)
{
    for (const section of sections)
        section.subs = section.subs.filter(sub => sub.items.length > 0);
    return sections.filter(section => section.items.length > 0 || section.subs.length > 0);
}

export function _tabItems(tab, newKeys)
{
    return _dropLockedItems(tab.fields.map(field =>
    {
        const item = _buildItem(field);
        if (item?.isCompactBooleans)
        {
            item.items.forEach((entry, idx) =>
            {
                entry.isNew = newKeys.has(field.items?.[idx]?.key);
            });
        }
        else if (item)
            /** @type {any} */ (item).isNew = newKeys.has(field.key);
        return item;
    }).filter(Boolean));
}

export function _newCount(items)
{
    return items.reduce((sum, item) => sum + (item.isCompactBooleans ? item.items.filter(entry => entry.isNew).length : Number(!!item.isNew)), 0);
}
