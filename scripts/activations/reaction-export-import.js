/*global FormApplication, Dialog, $, game, ui, saveDataToFile */

import { ReactionManager, clearScriptCache } from "./reaction-manager.js";
import { escapeHtml as esc } from "../tools/string-utils.js";

export class ReactionExport extends FormApplication
{
    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "reaction-checker-export",
            title: "Export Configuration",
            width: 400,
            height: "auto"
        });
    }

    async _updateObject(_event, _formData)
    {}

    render(force = false, options = {})
    {
        ReactionManager.exportReactions();
        return this;
    }
}

export class ReactionImport extends FormApplication
{
    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "reaction-checker-import",
            title: "Import Configuration",
            width: 400,
            height: "auto"
        });
    }

    async _updateObject(_event, _formData)
    {}

    render(force = false, options = {})
    {
        new Dialog({
            title: "Import Configuration",
            content: `
                <form>
                    <div class="form-group">
                        <label>Select JSON File</label>
                        <input type="file" name="importFile" accept=".json" style="width: 100%;">
                    </div>
                </form>
            `,
            buttons: {
                next: {
                    icon: '<i class="fas fa-file-import"></i>',
                    label: "Open",
                    callback: async (html) =>
                    {
                        const fileInput = /** @type {HTMLInputElement} */ (html.find('input[name="importFile"]')[0]);
                        if (!fileInput.files.length)
                        {
                            ui.notifications.warn("Please select a file to import.");
                            return;
                        }
                        try
                        {
                            const text = await fileInput.files[0].text();
                            const data = JSON.parse(text);
                            openImportSummary(data);
                        }
                        catch (e)
                        {
                            ui.notifications.error(`Failed to parse file: ${e.message}`);
                        }
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "next"
        }, { width: 400, classes: ['lancer-dialog-base'] }).render(true);
        return this;
    }
}

function fmtVal(value)
{
    if (value === null || value === undefined)
        return '<em>—</em>';
    if (typeof value === 'object')
        return `<code>${esc(JSON.stringify(value))}</code>`;
    return `<code>${esc(String(value))}</code>`;
}

function openImportSummary(data)
{
    const itemReactions = data.itemReactions ?? {};
    const generalReactions = data.generalReactions ?? {};
    const startupScripts = Array.isArray(data.startupScripts) ? data.startupScripts : [];
    const settings = data.settings ?? {};
    const externalSettings = data.externalSettings ?? {};

    const section = (id, label, rows) => `
        <details class="la-imp-sec" data-section="${id}" open>
            <summary style="cursor:pointer;font-weight:bold;padding:6px 8px;background:color-mix(in srgb, var(--primary-color), transparent 85%);border-radius:4px;margin-top:8px;display:flex;align-items:center;gap:6px;">
                <input type="checkbox" class="la-imp-section-all" data-section="${id}" checked>
                <span>${label} (${rows.length})</span>
            </summary>
            <div style="padding:4px 0 0 18px;display:flex;flex-direction:column;gap:2px;">${rows.join('') || '<div style="font-style:italic;color:#888;font-size:0.85em;">empty</div>'}</div>
        </details>
    `;

    const itemRows = Object.entries(itemReactions).map(([lid, group]) =>
    {
        const reactions = (group?.reactions || []).filter(r => Object.keys(r).length !== 1 || r.enabled === undefined);
        const names = reactions.map(r => r.name).filter(Boolean).join(', ');
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88em;">
            <input type="checkbox" class="la-imp-pick" data-section="itemReactions" data-key="${esc(lid)}" checked>
            <code>${esc(lid)}</code>${names ? ` <span style="color:#888;">— ${esc(names)}</span>` : ''}
        </label>`;
    });

    const generalRows = Object.keys(generalReactions).map(name => `
        <label style="display:flex;align-items:center;gap:6px;font-size:0.88em;">
            <input type="checkbox" class="la-imp-pick" data-section="generalReactions" data-key="${esc(name)}" checked>
            <span>${esc(name)}</span>
        </label>`);

    const startupRows = startupScripts.map((s, i) =>
    {
        const key = s?.id ?? s?.name ?? String(i);
        const label = s?.name ?? key;
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88em;">
            <input type="checkbox" class="la-imp-pick" data-section="startupScripts" data-key="${esc(key)}" checked>
            <span>${esc(label)}</span>
        </label>`;
    });

    const settingRow = (sec, key, current, imported) =>
    {
        const same = JSON.stringify(current) === JSON.stringify(imported);
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.85em;${same ? 'opacity:0.55;' : ''}">
            <input type="checkbox" class="la-imp-pick" data-section="${sec}" data-key="${esc(key)}" ${same ? '' : 'checked'}>
            <code style="font-size:0.95em;">${esc(key)}</code>
            <span style="margin-left:auto;color:#888;">${fmtVal(current)} → ${fmtVal(imported)}</span>
        </label>`;
    };

    const settingRows = Object.keys(settings).sort().map(k =>
    {
        const current = (() =>
        {
            try
            {
                return game.settings.get('lancer-automations', k);
            }
            catch
            {
                return undefined;
            }
        })();
        return settingRow('settings', k, current, settings[k]);
    });

    const externalRows = Object.keys(externalSettings).sort().map(composite =>
    {
        const dot = composite.indexOf('.');
        if (dot < 0)
            return '';
        const mod = composite.slice(0, dot);
        const key = composite.slice(dot + 1);
        const current = (() =>
        {
            try
            {
                return game.settings.get(mod, key);
            }
            catch
            {
                return undefined;
            }
        })();
        return settingRow('externalSettings', composite, current, externalSettings[composite]);
    });

    const keybindings = data.keybindings ?? {};
    const fmtBindings = (bindings) =>
    {
        if (!Array.isArray(bindings) || !bindings.length)
            return '<em>none</em>';
        return bindings.map(binding => esc([...(binding.modifiers ?? []), binding.key].join('+'))).join(', ');
    };
    const keybindingRows = Object.keys(keybindings).sort().map(composite =>
    {
        const current = game.keybindings.bindings.get(composite) ?? [];
        const imported = keybindings[composite];
        const same = JSON.stringify(current) === JSON.stringify(imported);
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.85em;${same ? 'opacity:0.55;' : ''}">
            <input type="checkbox" class="la-imp-pick" data-section="keybindings" data-key="${esc(composite)}" ${same ? '' : 'checked'}>
            <code style="font-size:0.95em;">${esc(composite)}</code>
            <span style="margin-left:auto;color:#888;">${fmtBindings(current)} → ${fmtBindings(imported)}</span>
        </label>`;
    });

    const body = `
        <div style="margin-bottom:8px;font-size:0.85em;color:#666;">
            File from ${esc(data.exportDate ?? 'unknown')}. Uncheck anything you don't want to apply.
        </div>
        <div style="display:flex;gap:6px;margin-bottom:4px;">
            <button type="button" class="la-imp-all-on" style="font-size:0.85em;padding:2px 8px;cursor:pointer;">Select all</button>
            <button type="button" class="la-imp-all-off" style="font-size:0.85em;padding:2px 8px;cursor:pointer;">Deselect all</button>
        </div>
        <div class="lancer-scroll" style="max-height:60vh;overflow-y:auto;padding-right:6px;">
            ${section('itemReactions', 'Item Activations', itemRows)}
            ${section('generalReactions', 'General Activations', generalRows)}
            ${section('startupScripts', 'Startup Scripts', startupRows)}
            ${section('settings', 'Lancer Automations Settings', settingRows)}
            ${section('externalSettings', 'External Settings', externalRows)}
            ${section('keybindings', 'Keybindings', keybindingRows)}
        </div>
    `;

    const dlg = new Dialog({
        title: "Review Import",
        content: body,
        buttons: {
            import: {
                icon: '<i class="fas fa-file-import"></i>',
                label: "Import Selected",
                callback: async (html) =>
                {
                    const selection = { itemReactions: new Set(), generalReactions: new Set(), startupScripts: new Set(), settings: new Set(), externalSettings: new Set(), keybindings: new Set() };
                    html.find('.la-imp-pick:checked').each((_i, el) =>
                    {
                        const sec = $(el).data('section');
                        const key = $(el).data('key');
                        if (sec && selection[sec])
                            selection[sec].add(String(key));
                    });
                    await ReactionManager.applyImportSelection(data, selection);
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "import",
        render: (html) =>
        {
            html.find('.la-imp-section-all').on('change', (ev) =>
            {
                const sec = $(ev.currentTarget).data('section');
                const on = /** @type {HTMLInputElement} */ (ev.currentTarget).checked;
                html.find(`.la-imp-pick[data-section="${sec}"]`).each((_i, el) =>
                {
                    /** @type {HTMLInputElement} */ (el).checked = on;
                });
            });
            html.find('.la-imp-all-on').on('click', () =>
            {
                html.find('.la-imp-pick, .la-imp-section-all').each((_i, el) =>
                {
                    /** @type {HTMLInputElement} */ (el).checked = true;
                });
            });
            html.find('.la-imp-all-off').on('click', () =>
            {
                html.find('.la-imp-pick, .la-imp-section-all').each((_i, el) =>
                {
                    /** @type {HTMLInputElement} */ (el).checked = false;
                });
            });
        }
    }, { width: 640, classes: ['lancer-dialog-base'] });
    dlg.render(true);
}

// Activation packs (Activations + Startup scripts)

const PACK_TYPE = 'lancer-automations-pack';

// Defaults hold code as live functions; JSON drops those, so stringify (engine recompiles on import).
function _serializeFns(value)
{
    if (typeof value === 'function')
        return value.toString();
    if (Array.isArray(value))
        return value.map(_serializeFns);
    if (value && typeof value === 'object')
    {
        const out = {};
        for (const [k, v] of Object.entries(value))
            out[k] = _serializeFns(v);
        return out;
    }
    return value;
}

function packSection(id, label, rows)
{
    return `
        <details class="la-pack-sec" data-section="${id}" open>
            <summary style="cursor:pointer;font-weight:bold;padding:6px 8px;background:color-mix(in srgb, var(--primary-color), transparent 85%);border-radius:4px;margin-top:8px;display:flex;align-items:center;gap:6px;">
                <input type="checkbox" class="la-pack-section-all" data-section="${id}" checked>
                <span>${label} (${rows.length})</span>
            </summary>
            <div style="padding:4px 0 0 18px;display:flex;flex-direction:column;gap:2px;">${rows.join('') || '<div style="font-style:italic;color:#888;font-size:0.85em;">empty</div>'}</div>
        </details>`;
}

function packGroup(groupId, label, count, rows)
{
    return `
        <details class="la-pack-sec" data-group="${groupId}" open>
            <summary style="cursor:pointer;font-weight:bold;padding:6px 8px;background:color-mix(in srgb, var(--primary-color), transparent 85%);border-radius:4px;margin-top:8px;display:flex;align-items:center;gap:6px;">
                <input type="checkbox" class="la-pack-group-all" data-group="${groupId}" checked>
                <span>${esc(label)} (${count})</span>
            </summary>
            <div style="padding:4px 0 0 18px;display:flex;flex-direction:column;gap:2px;">${rows.join('') || '<div style="font-style:italic;color:#888;font-size:0.85em;">empty</div>'}</div>
        </details>`;
}

function packPick(section, key, label, { disabled = false, note = '', group = '' } = {})
{
    return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88em;${disabled ? 'opacity:0.55;' : ''}">
        <input type="checkbox" class="la-pack-pick" data-section="${section}" data-key="${esc(key)}" data-group="${esc(group)}" ${disabled ? 'disabled' : 'checked'}>
        <span>${esc(label)}${note ? ` <em style="color:#888;">${esc(note)}</em>` : ''}</span>
    </label>`;
}

const _packSelectAllBar = `
    <div style="display:flex;gap:6px;margin-bottom:4px;">
        <button type="button" class="la-pack-all-on" style="font-size:0.85em;padding:2px 8px;cursor:pointer;">Select all</button>
        <button type="button" class="la-pack-all-off" style="font-size:0.85em;padding:2px 8px;cursor:pointer;">Deselect all</button>
    </div>`;

function _wirePackSelectAll(html)
{
    html.find('.la-pack-section-all').on('change', (ev) =>
    {
        const sec = $(ev.currentTarget).data('section');
        const on = ev.currentTarget.checked;
        html.find(`.la-pack-pick[data-section="${sec}"]:not(:disabled)`).each((_i, el) =>
        {
            el.checked = on;
        });
    });
    html.find('.la-pack-group-all').on('change', (ev) =>
    {
        const grp = $(ev.currentTarget).data('group');
        const on = ev.currentTarget.checked;
        html.find(`.la-pack-pick[data-group="${grp}"]:not(:disabled)`).each((_i, el) =>
        {
            el.checked = on;
        });
    });
    html.find('.la-pack-all-on').on('click', () =>
    {
        html.find('.la-pack-pick:not(:disabled), .la-pack-section-all, .la-pack-group-all').each((_i, el) =>
        {
            el.checked = true;
        });
    });
    html.find('.la-pack-all-off').on('click', () =>
    {
        html.find('.la-pack-pick, .la-pack-section-all, .la-pack-group-all').each((_i, el) =>
        {
            el.checked = false;
        });
    });
}

function _activationRows(itemReactions, generalReactions)
{
    const itemRows = Object.entries(itemReactions).map(([lid, group]) =>
    {
        const names = (group?.reactions || []).map(r => r.name).filter(Boolean).join(', ');
        return packPick('itemReactions', lid, names ? `${lid} — ${names}` : lid);
    });
    const generalRows = Object.keys(generalReactions).map(name => packPick('generalReactions', name, name));
    return { itemRows, generalRows };
}

function _collectPackSelection(html, itemReactions, generalReactions, startupScripts)
{
    const items = {}, generals = {}, startups = [];
    html.find('.la-pack-pick:checked').each((_i, el) =>
    {
        const sec = $(el).data('section');
        const key = String($(el).data('key'));
        if (sec === 'itemReactions' && itemReactions[key])
            items[key] = itemReactions[key];
        else if (sec === 'generalReactions' && generalReactions[key])
            generals[key] = generalReactions[key];
        else if (sec === 'startupScripts')
        {
            const script = startupScripts.find(sc => (sc.id ?? sc.name ?? '') === key);
            if (script)
                startups.push(script);
        }
    });
    return { items, generals, startups };
}

export function openPackExport()
{
    const itemReactions = ReactionManager.getAllReactions() || {};
    const generalReactions = ReactionManager.getGeneralReactions() || {};
    const startupScripts = ReactionManager.getStartupScripts() || [];

    // Group activations the way the manager does: user folders first, then category, then Unfiled.
    const folders = ReactionManager.getFolders() || [];
    const keyToFolder = new Map();
    for (const f of folders)
    {
        for (const k of (f.items || []))
            keyToFolder.set(k, f.name);
    }

    const entries = [];
    for (const [lid, group] of Object.entries(itemReactions))
    {
        const names = (group?.reactions || []).map(r => r.name).filter(Boolean).join(', ');
        const key = `item::${lid}`;
        entries.push({ section: 'itemReactions', dataKey: lid, label: names ? `${lid} — ${names}` : lid, group: keyToFolder.get(key) ?? group?.category ?? 'Unfiled' });
    }
    for (const [name, reaction] of Object.entries(generalReactions))
    {
        const key = `general::${name}`;
        entries.push({ section: 'generalReactions', dataKey: name, label: name, group: keyToFolder.get(key) ?? reaction?.category ?? 'Unfiled' });
    }

    const order = [];
    const seen = new Set();
    for (const f of folders)
    {
        if (!seen.has(f.name))
        {
            order.push(f.name); seen.add(f.name);
        }
    }
    for (const g of [...new Set(entries.map(e => e.group))].sort((a, b) => a.localeCompare(b)))
    {
        if (!seen.has(g) && g !== 'Unfiled')
        {
            order.push(g); seen.add(g);
        }
    }
    order.push('Unfiled');

    const groupSections = order
        .filter(g => entries.some(e => e.group === g))
        .map((groupName, i) =>
        {
            const rows = entries.filter(entry => entry.group === groupName).map(entry => packPick(entry.section, entry.dataKey, entry.label, { group: `g${i}` }));
            return packGroup(`g${i}`, groupName, rows.length, rows);
        });

    const startupRows = startupScripts.map((s, i) => packPick('startupScripts', s.id ?? s.name ?? String(i), s.name ?? s.id ?? `Script ${i + 1}`, { group: 'startups' }));

    const body = `
        <div class="form-group" style="margin-bottom:8px;">
            <label style="font-weight:bold;">Pack name</label>
            <input type="text" class="la-pack-name" value="My Activation Pack" style="width:100%;">
        </div>
        ${_packSelectAllBar}
        <div class="lancer-scroll" style="max-height:55vh;overflow-y:auto;padding-right:6px;">
            ${groupSections.join('')}
            ${packGroup('startups', 'Startup Scripts', startupRows.length, startupRows)}
        </div>`;

    new Dialog({
        title: "Export Pack",
        content: body,
        buttons: {
            export: {
                icon: '<i class="fas fa-file-export"></i>',
                label: "Export",
                callback: (html) =>
                {
                    const name = String(html.find('.la-pack-name').val() ?? '').trim() || 'Activation Pack';
                    const { items, generals, startups } = _collectPackSelection(html, itemReactions, generalReactions, startupScripts);
                    if (!Object.keys(items).length && !Object.keys(generals).length && !startups.length)
                    {
                        ui.notifications.warn("Nothing selected to export.");
                        return;
                    }
                    const pack = _serializeFns({
                        type: PACK_TYPE,
                        version: 1,
                        name,
                        exportDate: new Date().toISOString(),
                        itemReactions: items,
                        generalReactions: generals,
                        startupScripts: startups,
                    });
                    const safeName = name.replace(/[^\w-]+/g, '_').slice(0, 60) || 'pack';
                    saveDataToFile(JSON.stringify(pack, null, 2), "application/json", `la-pack-${safeName}.json`);
                    ui.notifications.info(`Exported pack "${name}".`);
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "export",
        render: (html) => _wirePackSelectAll(html)
    }, { width: 560, classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
}

export function openPackImport(onDone)
{
    new Dialog({
        title: "Import Pack",
        content: `
            <form>
                <div class="form-group">
                    <label>Select pack JSON file</label>
                    <input type="file" name="packFile" accept=".json" style="width:100%;">
                </div>
            </form>`,
        buttons: {
            next: {
                icon: '<i class="fas fa-file-import"></i>',
                label: "Open",
                callback: async (html) =>
                {
                    const fileInput = /** @type {HTMLInputElement} */ (html.find('input[name="packFile"]')[0]);
                    if (!fileInput.files.length)
                    {
                        ui.notifications.warn("Please select a file to import.");
                        return;
                    }
                    try
                    {
                        const data = JSON.parse(await fileInput.files[0].text());
                        if (data?.type !== PACK_TYPE)
                        {
                            ui.notifications.error("That file isn't a Lancer Automations pack.");
                            return;
                        }
                        openPackImportSummary(data, onDone);
                    }
                    catch (e)
                    {
                        ui.notifications.error(`Failed to parse file: ${e.message}`);
                    }
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "next"
    }, { width: 400, classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
}

function openPackImportSummary(data, onDone)
{
    const itemReactions = data.itemReactions ?? {};
    const generalReactions = data.generalReactions ?? {};
    const startupScripts = Array.isArray(data.startupScripts) ? data.startupScripts : [];
    const packName = String(data.name ?? '').trim() || 'Imported Pack';

    const existingStartups = new Set(
        (game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [])
            .flatMap(s => [s.id, s.name].filter(Boolean))
    );

    const { itemRows, generalRows } = _activationRows(itemReactions, generalReactions);
    const startupRows = startupScripts.map((s, i) =>
    {
        const key = s.id ?? s.name ?? String(i);
        const dup = existingStartups.has(s.id) || existingStartups.has(s.name);
        return packPick('startupScripts', key, s.name ?? key, { disabled: dup, note: dup ? '(already present)' : '' });
    });

    const body = `
        <div style="margin-bottom:8px;font-size:0.9em;">
            Pack <b>${esc(packName)}</b>${data.exportDate ? ` <span style="color:#888;">(${esc(data.exportDate)})</span>` : ''}.
            Activations import into a folder named <b>${esc(packName)}</b>.
        </div>
        ${_packSelectAllBar}
        <div class="lancer-scroll" style="max-height:55vh;overflow-y:auto;padding-right:6px;">
            ${packSection('itemReactions', 'Item Activations', itemRows)}
            ${packSection('generalReactions', 'General Activations', generalRows)}
            ${packSection('startupScripts', 'Startup Scripts', startupRows)}
        </div>`;

    new Dialog({
        title: "Import Pack",
        content: body,
        buttons: {
            import: {
                icon: '<i class="fas fa-file-import"></i>',
                label: "Import Selected",
                callback: async (html) =>
                {
                    const { items, generals, startups } = _collectPackSelection(html, itemReactions, generalReactions, startupScripts);
                    await applyPackImport(packName, items, generals, startups);
                    if (typeof onDone === 'function')
                        onDone();
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel" }
        },
        default: "import",
        render: (html) => _wirePackSelectAll(html)
    }, { width: 640, classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
}

function _uniqueFolderName(base)
{
    const names = new Set(ReactionManager.getFolders().map(f => f.name));
    if (!names.has(base))
        return base;
    let n = 2;
    while (names.has(`${base} (${n})`))
        n++;
    return `${base} (${n})`;
}

// Returns the folder name to use, or null if the user cancels at the clash prompt.
async function _resolveFolderName(name)
{
    if (!ReactionManager.getFolders().some(f => f.name === name))
        return name;
    return await new Promise(resolve =>
    {
        new Dialog({
            title: "Folder Already Exists",
            content: `<p>A folder named <b>${esc(name)}</b> already exists.</p><p>Merge the pack into it, or create a new folder?</p>`,
            buttons: {
                merge: { icon: '<i class="fas fa-folder-open"></i>', label: "Merge into it", callback: () => resolve(name) },
                fresh: { icon: '<i class="fas fa-folder-plus"></i>', label: "New folder", callback: () => resolve(_uniqueFolderName(name)) },
                cancel: { icon: '<i class="fas fa-times"></i>', label: "Cancel", callback: () => resolve(null) }
            },
            default: "merge"
        }, { classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
    });
}

async function applyPackImport(packName, itemReactions, generalReactions, startupScripts)
{
    const hasActivations = Object.keys(itemReactions).length || Object.keys(generalReactions).length;

    let folderName = null;
    if (hasActivations)
    {
        folderName = await _resolveFolderName(packName);
        if (folderName === null)
            return; // cancelled at the clash prompt
    }

    if (Object.keys(itemReactions).length)
    {
        const current = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        for (const [lid, group] of Object.entries(itemReactions))
            current[lid] = group;
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, current);
    }
    if (Object.keys(generalReactions).length)
    {
        const current = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        for (const [name, reaction] of Object.entries(generalReactions))
            current[name] = reaction;
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, current);
    }

    if (hasActivations && folderName)
    {
        await ReactionManager.createFolder(folderName); // no-op if it already exists
        for (const lid of Object.keys(itemReactions))
            await ReactionManager.assignToFolder(folderName, `item::${lid}`);
        for (const name of Object.keys(generalReactions))
            await ReactionManager.assignToFolder(folderName, `general::${name}`);
    }

    let addedStartups = 0;
    if (startupScripts.length)
    {
        const current = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
        const seen = new Set(current.flatMap(s => [s.id, s.name].filter(Boolean)));
        for (const s of startupScripts)
        {
            if ((s.id && seen.has(s.id)) || (s.name && seen.has(s.name)))
                continue;
            current.push({ ...s, builtin: false });
            if (s.id)
                seen.add(s.id);
            if (s.name)
                seen.add(s.name);
            addedStartups++;
        }
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, current);
    }

    clearScriptCache();
    ui.notifications.info(`Imported pack "${packName}"${addedStartups ? ` (+${addedStartups} startup script${addedStartups === 1 ? '' : 's'})` : ''}.`);
}
