/*global FormApplication, Dialog, $, game, ui */

import { ReactionManager } from "./reaction-manager.js";

export class ReactionExport extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "reaction-checker-export",
            title: "Export Configuration",
            width: 400,
            height: "auto"
        });
    }

    async _updateObject(_event, _formData) {}

    render(force = false, options = {}) {
        ReactionManager.exportReactions();
        return this;
    }
}

export class ReactionImport extends FormApplication {
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "reaction-checker-import",
            title: "Import Configuration",
            width: 400,
            height: "auto"
        });
    }

    async _updateObject(_event, _formData) {}

    render(force = false, options = {}) {
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
                    callback: async (html) => {
                        const fileInput = /** @type {HTMLInputElement} */ (html.find('input[name="importFile"]')[0]);
                        if (!fileInput.files.length) {
                            ui.notifications.warn("Please select a file to import.");
                            return;
                        }
                        try {
                            const text = await fileInput.files[0].text();
                            const data = JSON.parse(text);
                            openImportSummary(data);
                        } catch (e) {
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

function esc(s) {
    return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function fmtVal(v) {
    if (v === null || v === undefined) return '<em>—</em>';
    if (typeof v === 'object') return `<code>${esc(JSON.stringify(v))}</code>`;
    return `<code>${esc(String(v))}</code>`;
}

function openImportSummary(data) {
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

    const itemRows = Object.entries(itemReactions).map(([lid, group]) => {
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

    const startupRows = startupScripts.map((s, i) => {
        const key = s?.id ?? s?.name ?? String(i);
        const label = s?.name ?? key;
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.88em;">
            <input type="checkbox" class="la-imp-pick" data-section="startupScripts" data-key="${esc(key)}" checked>
            <span>${esc(label)}</span>
        </label>`;
    });

    const settingRow = (sec, key, current, imported) => {
        const same = JSON.stringify(current) === JSON.stringify(imported);
        return `<label style="display:flex;align-items:center;gap:6px;font-size:0.85em;${same ? 'opacity:0.55;' : ''}">
            <input type="checkbox" class="la-imp-pick" data-section="${sec}" data-key="${esc(key)}" ${same ? '' : 'checked'}>
            <code style="font-size:0.95em;">${esc(key)}</code>
            <span style="margin-left:auto;color:#888;">${fmtVal(current)} → ${fmtVal(imported)}</span>
        </label>`;
    };

    const settingRows = Object.keys(settings).sort().map(k => {
        const current = (() => { try { return game.settings.get('lancer-automations', k); } catch { return undefined; } })();
        return settingRow('settings', k, current, settings[k]);
    });

    const externalRows = Object.keys(externalSettings).sort().map(composite => {
        const dot = composite.indexOf('.');
        if (dot < 0) return '';
        const mod = composite.slice(0, dot);
        const key = composite.slice(dot + 1);
        const current = (() => { try { return game.settings.get(mod, key); } catch { return undefined; } })();
        return settingRow('externalSettings', composite, current, externalSettings[composite]);
    });

    const keybindings = data.keybindings ?? {};
    const fmtBindings = (arr) => {
        if (!Array.isArray(arr) || !arr.length) return '<em>none</em>';
        return arr.map(b => esc([...(b.modifiers ?? []), b.key].join('+'))).join(', ');
    };
    const keybindingRows = Object.keys(keybindings).sort().map(composite => {
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
                callback: async (html) => {
                    const selection = { itemReactions: new Set(), generalReactions: new Set(), startupScripts: new Set(), settings: new Set(), externalSettings: new Set(), keybindings: new Set() };
                    html.find('.la-imp-pick:checked').each((_i, el) => {
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
        render: (html) => {
            html.find('.la-imp-section-all').on('change', (ev) => {
                const sec = $(ev.currentTarget).data('section');
                const on = /** @type {HTMLInputElement} */ (ev.currentTarget).checked;
                html.find(`.la-imp-pick[data-section="${sec}"]`).each((_i, el) => { /** @type {HTMLInputElement} */ (el).checked = on; });
            });
            html.find('.la-imp-all-on').on('click', () => {
                html.find('.la-imp-pick, .la-imp-section-all').each((_i, el) => { /** @type {HTMLInputElement} */ (el).checked = true; });
            });
            html.find('.la-imp-all-off').on('click', () => {
                html.find('.la-imp-pick, .la-imp-section-all').each((_i, el) => { /** @type {HTMLInputElement} */ (el).checked = false; });
            });
        }
    }, { width: 640, classes: ['lancer-dialog-base'] });
    dlg.render(true);
}
