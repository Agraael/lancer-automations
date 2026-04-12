/**
 * Additional grouped settings menus for lancer-automations.
 * Each menu surfaces a subset of settings that are otherwise registered with
 * `config: false` in main.js so they don't appear in the main settings panel.
 */

const MODULE_ID = 'lancer-automations';

/**
 * Generic helper: build a config form class for a list of setting keys.
 * Each entry: { key, type: 'boolean'|'number'|'string'|'select', label?, hint?, choices? }
 */
function makeConfigForm({ id, title, template, fields }) {
    return class extends FormApplication {
        static get defaultOptions() {
            return foundry.utils.mergeObject(super.defaultOptions, {
                id,
                title,
                template,
                width: 520,
                closeOnSubmit: true,
            });
        }

        getData() {
            const items = fields.map(f => {
                if (f.type === 'section') {
                    return { type: 'section', label: f.label, isSection: true };
                }
                if (f.type === 'table') {
                    const table = f.getTable();
                    return { type: 'table', label: f.label, isTable: true, columns: table.columns, rows: table.rows };
                }
                let value;
                try {
                    value = game.settings.get(MODULE_ID, f.key);
                } catch {
                    value = f.default;
                }
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`) || {};
                return {
                    key: f.key,
                    type: f.type,
                    label: f.label ?? setting.name ?? f.key,
                    hint: f.hint ?? setting.hint ?? '',
                    value,
                    isBoolean: f.type === 'boolean',
                    isNumber: f.type === 'number',
                    isString: f.type === 'string',
                    isFolder: f.type === 'folder',
                    isColor: f.type === 'color',
                    isSelect: f.type === 'select',
                    isSlider: f.type === 'slider',
                    sliderMin: f.min ?? setting.range?.min ?? 0,
                    sliderMax: f.max ?? setting.range?.max ?? 1,
                    sliderStep: f.step ?? setting.range?.step ?? 0.1,
                    isSection: f.type === 'section',
                    choices: (typeof f.getChoices === 'function' ? f.getChoices() : f.choices)
                        ?? (setting.choices
                            ? Object.entries(setting.choices).map(([k, v]) => ({
                                  value: k, label: v, selected: k === value
                              }))
                            : []),
                };
            });
            return { items };
        }

        activateListeners(html) {
            super.activateListeners(html);
            _injectFCSLocks(html, fields, this);
        }

        async _updateObject(_event, formData) {
            // Collect all saveable keys including table cell keys.
            const allFields = [];
            for (const f of fields) {
                if (!f.key && f.type === 'table' && f.tableKeys) {
                    for (const tk of f.tableKeys) {
                        const setting = game.settings.settings.get(`${MODULE_ID}.${tk}`);
                        allFields.push({ key: tk, type: setting?.type === Boolean ? 'boolean' : 'string' });
                    }
                } else if (f.key && f.type !== 'section') {
                    allFields.push(f);
                }
            }
            for (const f of allFields) {
                if (!(f.key in formData)) {
                    // Unchecked checkboxes are absent from formData — set them to false
                    if (f.type === 'boolean') {
                        try {
                            await game.settings.set(MODULE_ID, f.key, false);
                        } catch (e) {
                            console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
                        }
                    }
                    continue;
                }
                let val = formData[f.key];
                if (f.type === 'number' || f.type === 'slider') val = Number(val);
                if (f.type === 'boolean') val = !!val;
                try {
                    await game.settings.set(MODULE_ID, f.key, val);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
                }
            }
            ui.notifications.info(`${title} saved.`);
        }
    };
}

// ---------------------------------------------------------------------------
// Activations Automations
// ---------------------------------------------------------------------------

const ActivationsConfig = makeConfigForm({
    id: 'la-activations-config',
    title: 'Lancer Automations — Activations Automations',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'reactionNotificationMode', type: 'select', label: 'Activation Notification Mode' },
        { key: 'consumeReaction', type: 'boolean' },
        { key: 'treatGenericPrintAsActivation', type: 'boolean' },
        { key: 'showBonusHudButton', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Combat & Movement
// ---------------------------------------------------------------------------

const CombatMovementConfig = makeConfigForm({
    id: 'la-combat-movement-config',
    title: 'Lancer Automations — Combat & Movement',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'enableKnockbackFlow', type: 'boolean' },
        { key: 'enableThrowFlow', type: 'boolean' },
        { key: 'statRollTargeting', type: 'boolean' },
        { key: 'enablePathHexCalculation', type: 'boolean' },
        { key: 'enableMovementCapDetection', type: 'boolean' },
        { key: 'experimentalBoostDetection', type: 'boolean' },
        { key: 'dragVisionMultiplier', type: 'number' },
        { key: 'enableAltStruct', type: 'boolean' },
        { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Wreck Automation
// ---------------------------------------------------------------------------

const WreckConfig = makeConfigForm({
    id: 'la-wreck-config',
    title: 'Lancer Automations — Wreck Automation',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'enableWrecks', type: 'boolean' },
        { key: 'wreckAssetsPath', type: 'folder', label: 'Wreck Assets Folder' },
        { key: 'enableRemoveFromCombat', type: 'boolean' },
        { key: 'enableWreckAnimation', type: 'boolean' },
        { key: 'enableWreckAudio', type: 'boolean' },
        { key: 'wreckMasterVolume', type: 'slider', label: 'Wreck Master Volume' },
        { key: 'squadLostOnDeath', type: 'boolean' },
        { key: 'wreckTerrainType', type: 'select', label: 'Wreck Terrain Type', getChoices: () => {
            const current = game.settings.get(MODULE_ID, 'wreckTerrainType') || '';
            const choices = [{ value: '', label: 'None (disabled)', selected: current === '' }];
            try {
                const types = globalThis.terrainHeightTools?.getTerrainTypes?.() || [];
                for (const t of types) {
                    choices.push({ value: t.id, label: t.name || t.id, selected: t.id === current });
                }
            } catch {}
            return choices;
        }},
        { key: 'disableHumanDeathSound', type: 'boolean' },
        { key: 'enableWipOnDeath', type: 'boolean' },
        // Per-category table.
        { type: 'table', label: 'Per-Category Settings',
          tableKeys: ['wreckMode_mech', 'wreckTerrain_mech', 'wreckMode_human', 'wreckTerrain_human',
                      'wreckMode_monstrosity', 'wreckTerrain_monstrosity', 'wreckMode_biological', 'wreckTerrain_biological'],
          getTable: () => {
            const modeChoices = (key) => {
                const cur = game.settings.get(MODULE_ID, key);
                return [
                    { value: 'token', label: 'Token', selected: cur === 'token' },
                    { value: 'tile', label: 'Tile', selected: cur === 'tile' },
                ];
            };
            return {
                columns: ['Category', 'Mode', 'Terrain'],
                rows: [
                    { label: 'Mech', cells: [
                        { isSelect: true, name: 'wreckMode_mech', choices: modeChoices('wreckMode_mech') },
                        { isBoolean: true, name: 'wreckTerrain_mech', checked: game.settings.get(MODULE_ID, 'wreckTerrain_mech') },
                    ]},
                    { label: 'Human / Pilot / Squad', cells: [
                        { isSelect: true, name: 'wreckMode_human', choices: modeChoices('wreckMode_human') },
                        { isBoolean: true, name: 'wreckTerrain_human', checked: game.settings.get(MODULE_ID, 'wreckTerrain_human') },
                    ]},
                    { label: 'Monstrosity', cells: [
                        { isSelect: true, name: 'wreckMode_monstrosity', choices: modeChoices('wreckMode_monstrosity') },
                        { isBoolean: true, name: 'wreckTerrain_monstrosity', checked: game.settings.get(MODULE_ID, 'wreckTerrain_monstrosity') },
                    ]},
                    { label: 'Biological', cells: [
                        { isSelect: true, name: 'wreckMode_biological', choices: modeChoices('wreckMode_biological') },
                        { isBoolean: true, name: 'wreckTerrain_biological', checked: game.settings.get(MODULE_ID, 'wreckTerrain_biological') },
                    ]},
                ],
            };
          },
        },
    ],
});

// ---------------------------------------------------------------------------
// Deployables & Display
// ---------------------------------------------------------------------------

const DeployablesDisplayConfig = makeConfigForm({
    id: 'la-deployables-display-config',
    title: 'Lancer Automations — Deployables & Display',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'linkManualDeploy', type: 'boolean' },
        { key: 'showDeployableLines', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Token Action HUD
// ---------------------------------------------------------------------------

const TokenActionHudConfig = makeConfigForm({
    id: 'la-tah-config',
    title: 'Lancer Automations — Token Action HUD',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'tahEnabled', type: 'boolean', label: 'Enable Token Action HUD' },
        { key: 'tah.clickToOpen', type: 'boolean' },
        { key: 'tah.hoverCloseDelay', type: 'number' },
        { key: 'tah.rangePreview', type: 'boolean' },
        // Aura settings table.
        { type: 'table', label: 'Range Auras',
          tableKeys: ['tah.auraColorThreat', 'tah.auraOpacityThreat', 'tah.auraDefaultThreat',
                      'tah.auraColorSensor', 'tah.auraOpacitySensor', 'tah.auraDefaultSensor',
                      'tah.auraColorRange', 'tah.auraOpacityRange', 'tah.auraDefaultRange'],
          getTable: () => {
            const defaultChoices = (key) => {
                const cur = game.settings.get(MODULE_ID, key);
                return [
                    { value: 'none', label: 'None', selected: cur === 'none' },
                    { value: 'combat', label: 'Combat', selected: cur === 'combat' },
                    { value: 'all', label: 'Always', selected: cur === 'all' },
                ];
            };
            const makeRow = (label, colorKey, opacityKey, defaultKey) => ({
                label,
                cells: [
                    { isColor: true, name: colorKey, value: game.settings.get(MODULE_ID, colorKey) },
                    { isNumber: true, name: opacityKey, value: game.settings.get(MODULE_ID, opacityKey) },
                    { isSelect: true, name: defaultKey, choices: defaultChoices(defaultKey) },
                ],
            });
            return {
                columns: ['Aura', 'Color', 'Opacity', 'Default'],
                rows: [
                    makeRow('Threat', 'tah.auraColorThreat', 'tah.auraOpacityThreat', 'tah.auraDefaultThreat'),
                    makeRow('Sensor', 'tah.auraColorSensor', 'tah.auraOpacitySensor', 'tah.auraDefaultSensor'),
                    makeRow('Max Range', 'tah.auraColorRange', 'tah.auraOpacityRange', 'tah.auraDefaultRange'),
                ],
            };
          },
        },
    ],
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

const MiscConfig = makeConfigForm({
    id: 'la-misc-config',
    title: 'Lancer Automations — Miscellaneous',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'allowHalfSizeTokens', type: 'boolean' },
        { key: 'autoTokenHeight', type: 'boolean', label: 'Auto Token Height (Wall Height)', hint: 'Auto-set tokenHeight to actor size + 0.1 so tokens peek above walls of their size.' },
        { key: 'autoTokenHeightVehicleSquad', type: 'boolean', label: 'Vehicle & Squad Height Adjustments', hint: 'Vehicles get reduced height (size-1, capped at 4). Squads get 0.5.' },
    ],
});

// ---------------------------------------------------------------------------
// Menu registration
// ---------------------------------------------------------------------------

// Inject Force Client Settings lock icons into our custom config forms.
function _getFCSData() {
    if (!game.modules.get('force-client-settings')?.active) {
        return null;
    }
    try {
        const forced = new Map(Object.entries(
            game.settings.get('force-client-settings', 'forced') ?? {}
        ));
        const unlocked = new Map(Object.entries(
            game.settings.get('force-client-settings', 'unlocked') ?? {}
        ));
        return { forced, unlocked };
    } catch {
        return null;
    }
}

// Cycle FCS force mode: open → soft → hard → open.
async function _toggleFCSForce(key, fcs) {
    if (!game.user?.isGM) {
        return;
    }
    const currentMode = fcs.forced.get(key)?.mode ?? 'open';
    const forced = Object.fromEntries(fcs.forced);
    if (currentMode === 'open') {
        forced[key] = { mode: 'soft' };
    } else if (currentMode === 'soft') {
        forced[key] = { mode: 'hard' };
    } else {
        delete forced[key];
    }
    await game.settings.set('force-client-settings', 'forced', forced);
    // Update local cache.
    fcs.forced = new Map(Object.entries(forced));
}

function _injectFCSLocks(html, fields, app) {
    const fcs = _getFCSData();
    if (!fcs) {
        return;
    }
    const isGM = game.user?.isGM;
    const fa = {
        'hard-gm': 'fa-lock',
        'soft-gm': 'fa-unlock-keyhole',
        'open-gm': 'fa-lock-keyhole-open',
        'unlocked-gm': 'fa-dungeon',
        'hard-client': 'fa-lock',
        'soft-client': 'fa-unlock-keyhole',
        'unlocked-client': 'fa-lock-keyhole-open',
    };
    const $html = $(html);
    for (const f of fields) {
        const key = `${MODULE_ID}.${f.key}`;
        const setting = game.settings.settings.get(key);
        if (!setting || setting.scope === 'world') {
            continue;
        }
        const $input = $html.find(`[name="${f.key}"]`);
        if ($input.length === 0) {
            continue;
        }
        const $group = $input.closest('.form-group');
        const $label = $group.find('label').first();
        if ($label.length === 0) {
            continue;
        }
        let mode = fcs.forced.get(key)?.mode ?? 'open';
        if ((mode === 'soft' || isGM) && fcs.unlocked.has(key)) {
            mode = 'unlocked';
        }
        const modeKey = mode + (isGM ? '-gm' : '-client');
        // Non-GM + unforced = no icon needed.
        if (modeKey === 'open-client') {
            continue;
        }
        const icon = fa[modeKey];
        if (!icon) {
            continue;
        }
        const $icon = $('<span>')
            .html('&nbsp;')
            .prop('title', game.i18n.localize(`FORCECLIENTSETTINGS.ui.${modeKey}-hint`))
            .data('settings-key', key)
            .addClass(`fas ${icon}`)
            .css({ cursor: 'pointer', marginRight: '4px' })
            .on('click', async () => {
                await _toggleFCSForce(key, fcs);
                app.render();
            });
        $label.prepend($icon);
        if (['hard-client', 'soft-client'].includes(modeKey)) {
            $input.prop('disabled', true);
        }
    }
}

export function registerSettingsMenus() {
    game.settings.registerMenu(MODULE_ID, 'activationsConfigMenu', {
        name: 'Activations Automations',
        label: 'Configure Activations',
        hint: 'Notifications, reaction consumption, chat-card triggers.',
        icon: 'fas fa-bolt',
        type: ActivationsConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'combatMovementConfigMenu', {
        name: 'Combat & Movement',
        label: 'Configure Combat & Movement',
        hint: 'Knockback, throw, movement tracking, vision, alt-structure, infection.',
        icon: 'fas fa-running',
        type: CombatMovementConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'wreckConfigMenu', {
        name: 'Wreck Automation',
        label: 'Configure Wrecks',
        hint: 'Wreck spawning, FX, terrain, combat removal.',
        icon: 'fas fa-skull-crossbones',
        type: WreckConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'deployablesDisplayConfigMenu', {
        name: 'Deployables & Display',
        label: 'Configure Deployables & Display',
        hint: 'Deployable linking and on-canvas display.',
        icon: 'fas fa-cubes',
        type: DeployablesDisplayConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'tahConfigMenu', {
        name: 'Token Action HUD',
        label: 'Configure Token Action HUD',
        hint: 'Action HUD display, interaction mode, close delay.',
        icon: 'fas fa-th-list',
        type: TokenActionHudConfig,
        restricted: false,
    });

    game.settings.registerMenu(MODULE_ID, 'miscConfigMenu', {
        name: 'Miscellaneous',
        label: 'Configure Misc',
        hint: 'Half-size tokens and other options.',
        icon: 'fas fa-cog',
        type: MiscConfig,
        restricted: true,
    });
}
