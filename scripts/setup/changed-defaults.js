import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize } from '../tools/string-utils.js';
import { afterFirstRun } from './first-run-queue.js';
import { CHANGED_DEFAULTS, migrationsDone, pinnedThisLoad, storedSettingValue } from './migrations.js';
import { choiceLabel, settingLabel } from './settingsMenus.js';

const SETTING_REVIEWED = 'reviewedDefaultKeys';

const _same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function _valueLabel(key, value)
{
    if (typeof value === 'boolean')
        return localize(value ? 'LA.common.on' : 'LA.common.off');
    return choiceLabel(key, String(value));
}

function _pendingRows()
{
    const reviewed = new Set(getModuleSetting(SETTING_REVIEWED) ?? []);
    return CHANGED_DEFAULTS.flatMap(([key, previous]) =>
    {
        const setting = /** @type {any} */ (game.settings.settings.get(`${MODULE_ID}.${key}`));
        if (!setting || reviewed.has(key) || (setting.scope === 'world' && !game.user.isGM))
            return [];
        const stored = storedSettingValue(key, setting.scope);
        if (stored === undefined || !_same(stored, previous) || _same(setting.default, previous))
            return [];
        return [{ key, setting, previous }];
    });
}

function _content(rows)
{
    const root = document.createElement('div');
    root.className = 'la-changed-defaults';
    const intro = document.createElement('p');
    intro.textContent = localize('LA.changedDefaults.intro');
    root.append(intro);
    for (const { key, setting, previous } of rows)
    {
        const row = document.createElement('label');
        row.className = 'la-changed-default-row';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.name = key;
        box.setAttribute('checked', '');
        const name = document.createElement('span');
        name.className = 'la-changed-default-name';
        name.textContent = settingLabel(key);
        const values = document.createElement('span');
        values.className = 'la-changed-default-values';
        values.textContent = `${_valueLabel(key, previous)} → ${_valueLabel(key, setting.default)}`;
        row.append(box, name, values);
        root.append(row);
    }
    return root.outerHTML;
}

async function _apply(html, rows)
{
    const root = html?.[0] ?? html;
    let reload = false;
    for (const { key, setting } of rows)
    {
        const ticked = !!root?.querySelector(`input[name="${key}"]`)?.checked;
        if (ticked)
            await game.settings.set(MODULE_ID, key, setting.default);
        reload ||= !!setting.requiresReload && ticked !== pinnedThisLoad.has(key);
    }
    if (reload)
        await /** @type {any} */ (foundry.applications.settings.SettingsConfig).reloadConfirm({ world: game.user.isGM });
}

async function _markReviewed()
{
    const reviewed = new Set(getModuleSetting(SETTING_REVIEWED) ?? []);
    await game.settings.set(MODULE_ID, SETTING_REVIEWED, [...new Set([...reviewed, ...CHANGED_DEFAULTS.map(([key]) => key)])]);
}

Hooks.once('init', () =>
{
    game.settings.register(MODULE_ID, SETTING_REVIEWED, { scope: 'client', config: false, type: Array, default: [] });
});

Hooks.once('ready', async () =>
{
    await migrationsDone;
    await afterFirstRun();
    const rows = _pendingRows();
    if (!rows.length)
    {
        await _markReviewed();
        return;
    }
    new Dialog({
        title: localize('LA.changedDefaults.title'),
        content: _content(rows),
        buttons: {
            apply: {
                icon: '<i class="fas fa-check"></i>',
                label: localize('LA.changedDefaults.apply'),
                callback: (html) => _apply(html, rows),
            },
            keep: {
                icon: '<i class="fas fa-xmark"></i>',
                label: localize('LA.changedDefaults.keep'),
                callback: () => _apply(null, rows),
            },
        },
        default: 'apply',
        close: () => _markReviewed(),
    }, { width: 520, classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
});
