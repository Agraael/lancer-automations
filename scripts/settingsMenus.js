/* global game, ui, canvas, FormApplication, foundry, jQuery, Dialog, $ */

import { ReactionReset } from './reaction-reset.js';
import { ReactionExport, ReactionImport } from './reaction-export-import.js';
import { repairLCPData } from './lancer-modif.js';

const MODULE_ID = 'lancer-automations';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/lancer-automations-config.html`;

const ACTIVATIONS_FIELDS = [
    { key: 'reactionNotificationMode', type: 'select', label: 'Activation Notification Mode' },
    { key: 'consumeReaction', type: 'boolean' },
    { key: 'treatGenericPrintAsActivation', type: 'boolean' },
    { key: 'showBonusHudButton', type: 'boolean' },
];

const COMBAT_MOVEMENT_FIELDS = [
    { key: 'enableKnockbackFlow', type: 'boolean' },
    { key: 'enableThrowFlow', type: 'boolean' },
    { key: 'statRollTargeting', type: 'boolean' },
    { key: 'enablePathHexCalculation', type: 'boolean' },
    { key: 'enableMovementCapDetection', type: 'boolean' },
    { key: 'enableBoostOffer', type: 'boolean' },
    { key: 'experimentalBoostDetection', type: 'boolean' },
    { key: 'dragVisionMultiplier', type: 'number' },
    { key: 'enableAltStruct', type: 'boolean' },
    { key: 'enableOneStructNpc', type: 'boolean' },
    { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    { key: 'count3DDistance', type: 'boolean' },
    { type: 'section', label: 'Speed Provider (drag-ruler / elevation-ruler)', collapsible: true, collapsed: true },
    { key: 'enableBuiltinSpeedProvider', type: 'boolean', label: 'Built-in Speed Provider', hint: 'Provide ruler tiers from this module instead of the standalone lancer-speed-provider. Reload after toggling.' },
    { key: 'speedProvider.colorStandard', type: 'color', label: 'Speed Color: Standard' },
    { key: 'speedProvider.colorBoost', type: 'color', label: 'Speed Color: Boost' },
    { key: 'speedProvider.colorOverBoost', type: 'color', label: 'Speed Color: Over-boost' },
];

const WRECKS_FIELDS = [
    { key: 'enableWrecks', type: 'boolean' },
    { key: 'wreckAssetsPath', type: 'folder', label: 'Wreck Assets Folder' },
    { key: 'enableRemoveFromCombat', type: 'boolean' },
    { key: 'enableWreckAnimation', type: 'boolean' },
    { key: 'enableWreckAudio', type: 'boolean' },
    { key: 'squadLostOnDeath', type: 'boolean' },
    { key: 'wreckTerrainType',
        type: 'select',
        label: 'Wreck Terrain Type',
        getChoices: () => {
            const current = game.settings.get(MODULE_ID, 'wreckTerrainType') || '';
            const choices = [{ value: '', label: 'None (disabled)', selected: current === '' }];
            try {
                const types = globalThis.terrainHeightTools?.getTerrainTypes?.() || [];
                for (const t of types)
                    choices.push({ value: t.id, label: t.name || t.id, selected: t.id === current });
            } catch { /* ignore */ }
            return choices;
        }},
    { key: 'disableHumanDeathSound', type: 'boolean' },
    { type: 'table',
        label: 'Per-Category Settings',
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
                    { label: 'Mech',
                        cells: [
                            { isSelect: true, name: 'wreckMode_mech', choices: modeChoices('wreckMode_mech') },
                            { isBoolean: true, name: 'wreckTerrain_mech', checked: game.settings.get(MODULE_ID, 'wreckTerrain_mech') },
                        ]},
                    { label: 'Human / Pilot / Squad',
                        cells: [
                            { isSelect: true, name: 'wreckMode_human', choices: modeChoices('wreckMode_human') },
                            { isBoolean: true, name: 'wreckTerrain_human', checked: game.settings.get(MODULE_ID, 'wreckTerrain_human') },
                        ]},
                    { label: 'Monstrosity',
                        cells: [
                            { isSelect: true, name: 'wreckMode_monstrosity', choices: modeChoices('wreckMode_monstrosity') },
                            { isBoolean: true, name: 'wreckTerrain_monstrosity', checked: game.settings.get(MODULE_ID, 'wreckTerrain_monstrosity') },
                        ]},
                    { label: 'Biological',
                        cells: [
                            { isSelect: true, name: 'wreckMode_biological', choices: modeChoices('wreckMode_biological') },
                            { isBoolean: true, name: 'wreckTerrain_biological', checked: game.settings.get(MODULE_ID, 'wreckTerrain_biological') },
                        ]},
                ],
            };
        },
    },
];

/** @param {string} key */
function _statBarVisChoices(key) {
    let cur = 'all';
    try {
        cur = game.settings.get(MODULE_ID, key);
    } catch { /* not ready */ }
    return [
        { value: 'all',   label: 'All (default behaviour)', selected: cur === 'all' },
        { value: 'owner', label: 'Owners only',             selected: cur === 'owner' },
        { value: 'none',  label: 'None (hidden)',           selected: cur === 'none' },
    ];
}

const TOKENS_DISPLAY_FIELDS = [
    { key: 'linkManualDeploy', type: 'boolean' },
    { key: 'showDeployableLines', type: 'boolean' },
    { key: 'allowHalfSizeTokens', type: 'boolean' },
    { key: 'autoTokenHeight', type: 'boolean', label: 'Auto Token Height (Wall Height)', hint: 'Auto-set tokenHeight to actor size + 0.1 so tokens peek above walls of their size.' },
    { key: 'autoTokenHeightVehicleSquad', type: 'boolean', label: 'Vehicle & Squad Height Adjustments', hint: 'Vehicles get reduced height (size-1, capped at 4). Squads get 0.5.' },

    { type: 'section', label: 'Custom Token Stat Bars', collapsible: true, collapsed: true },
    { key: 'tokenStatBar', type: 'boolean', label: 'Enable Custom Token Stat Bars', hint: 'Requires reload when toggled. Disabled when Bar Brawl is active.' },
    { key: 'statBarDefaultHidden', type: 'boolean', label: 'Hide Stat Bar by Default' },
    { key: 'statBarDefaultCombatOnly', type: 'boolean', label: 'Show Only In Combat by Default' },
    { key: 'statBarDefaultRowHeight', type: 'number', label: 'Default Row Height (px)', hint: 'Leave 0 for auto (scales with grid).' },
    { key: 'statBarVisibilityOutOfCombat', type: 'select', label: 'Visibility — Out of Combat', getChoices: () => _statBarVisChoices('statBarVisibilityOutOfCombat') },
    { key: 'statBarVisibilityInCombat',   type: 'select', label: 'Visibility — In Combat',   getChoices: () => _statBarVisChoices('statBarVisibilityInCombat') },
    { type: 'button',
        key: 'statBarApplyDefaults',
        label: 'Apply Defaults to Current Scene',
        icon: 'fas fa-clone',
        hint: 'Overwrites per-token settings on every Lancer token in the active scene.',
        onClick: async () => {
            const mod = await import('./tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).applyDefaultsToCurrentScene;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn('applyDefaultsToCurrentScene is not exported.');
        },
    },
];

const TAH_FIELDS = [
    { key: 'tahEnabled', type: 'boolean', label: 'Enable Token Action HUD' },
    { key: 'tah.clickToOpen', type: 'boolean' },
    { key: 'tah.hoverCloseDelay', type: 'number' },
    { key: 'tah.rangePreview', type: 'boolean' },
    { key: 'tah.rangePreviewOnAttackCard', type: 'boolean' },
    { key: 'tah.auraUseAltKey', type: 'boolean' },
    { key: 'tah.showDisposition', type: 'boolean', label: 'Show Team / Disposition Indicator', hint: 'Colored stripe on the title bar. Shows team if Token Factions advanced teams is active, otherwise disposition.' },
    { key: 'tah.resetPosition', type: 'button', label: 'Reset TAH Position', icon: 'fas fa-undo', hint: 'Reset the HUD to its default screen position.',
        onClick: async () => {
            await game.settings.set(MODULE_ID, 'tah.position', null);
            ui.notifications.info('TAH position reset to default. Re-select a token to see the change.');
        } },
    { key: 'tah.clearAuras', type: 'button', label: 'Clear & Rebuild TAH Auras (Scene)', icon: 'fas fa-broom', hint: 'Remove all TAH-created auras from every token on the current scene, then re-apply configured defaults.',
        onClick: async () => {
            if (!canvas?.scene)
                return ui.notifications.warn('No active scene.');
            const { applyDefaultAuras } = await import('./tah/hover.js');
            let cleared = 0;
            const tokens = canvas.tokens?.placeables ?? [];
            for (const tok of tokens) {
                const auras = tok.document.getFlag('grid-aware-auras', 'auras') ?? [];
                const kept = auras.filter((/** @type {any} */ a) => !a?.name?.startsWith?.('LA_'));
                if (kept.length !== auras.length) {
                    await tok.document.setFlag('grid-aware-auras', 'auras', kept);
                    cleared++;
                }
            }
            for (const tok of tokens) await applyDefaultAuras(tok);
            ui.notifications.info(`Cleared TAH auras from ${cleared} token(s) and rebuilt defaults.`);
        } },
    { type: 'table',
        label: 'Range Auras',
        tableKeys: ['tah.auraColorThreat', 'tah.auraOpacityThreat', 'tah.auraDefaultThreat',
            'tah.auraColorSensor', 'tah.auraOpacitySensor', 'tah.auraDefaultSensor',
            'tah.auraColorRange', 'tah.auraOpacityRange', 'tah.auraDefaultRange',
            'tah.auraColorCustom', 'tah.auraOpacityCustom'],
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
                    ...(defaultKey ? [{ isSelect: true, name: defaultKey, choices: defaultChoices(defaultKey) }] : [{ isEmpty: true }]),
                ],
            });
            return {
                columns: ['Aura', 'Color', 'Opacity', 'Default'],
                rows: [
                    makeRow('Threat', 'tah.auraColorThreat', 'tah.auraOpacityThreat', 'tah.auraDefaultThreat'),
                    makeRow('Sensor', 'tah.auraColorSensor', 'tah.auraOpacitySensor', 'tah.auraDefaultSensor'),
                    makeRow('Weapon Range', 'tah.auraColorRange', 'tah.auraOpacityRange', 'tah.auraDefaultRange'),
                    makeRow('Custom Measure', 'tah.auraColorCustom', 'tah.auraOpacityCustom', null),
                ],
            };
        },
    },
];

// ── Sounds tab ──────────────────────────────────────────────────────────────
// Per-action FX functions. Same list as the settings registered in tah/index.js.
const ACTION_FX_KEYS = [
    'skirmish', 'eject', 'selfDestruct', 'teleport', 'bootUp',
    'dismount', 'disengage', 'deployable', 'freeAction', 'corePower',
    'protocol', 'reaction', 'fullAction', 'quickAction', 'standingUp',
    'prepare', 'interact', 'handle', 'fullTech', 'quickTech', 'invade',
    'grapple', 'ram', 'barrage', 'boost', 'overchargeNpc', 'hide',
    'shutDown', 'fall', 'fallImpact', 'search', 'scan', 'targetSuccess',
    'defaultThrow', 'targetFail',
];
const UI_VARIANTS = ['hover', 'open', 'details', 'toggle', 'statusHover'];
const TOKEN_VARIANTS = ['tokenHover', 'tokenSelect', 'tokenDeselect',
    'tokenTarget', 'tokenUntarget', 'tokenDrag', 'tokenMove', 'elevationKey'];
const DAMAGE_TYPES = ['kinetic', 'energy', 'explosive', 'variable',
    'heat', 'burn', 'infection', 'armor', 'hit_overshield', 'overshield'];
const STAT_EVENTS = ['hp_loss', 'hp_heal', 'heat_clean', 'miss', 'crit'];

function _toLabel(s) {
    return s.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase()).trim();
}

const SOUNDS_FIELDS = [
    { type: 'section', label: 'Master volumes' },
    { key: 'tah.uiSoundVolume', type: 'slider', label: 'UI Sounds', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.tokenFeedbackVolume', type: 'slider', label: 'Token Feedback', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.damageSoundVolume', type: 'slider', label: 'Damage / Stat Feedback', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.actionFxVolume', type: 'slider', label: 'Action FX', min: 0, max: 1.5, step: 0.05 },
    { key: 'wreckMasterVolume', type: 'slider', label: 'Wreck Explosions', min: 0, max: 1.5, step: 0.1 },

    { type: 'section', label: 'UI sounds (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: UI_VARIANTS.map((v) => ({ key: `tah.uiSound.${v}`, label: _toLabel(v), preview: true })) },

    { type: 'section', label: 'Token feedback (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: TOKEN_VARIANTS.map((v) => ({ key: `tah.tokenSound.${v}`, label: _toLabel(v.replace(/^token/, '')), preview: true })) },

    { type: 'section', label: 'Damage type sounds (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: DAMAGE_TYPES.map((t) => ({ key: `tah.damageSound.${t}`, label: _toLabel(t), preview: true })) },

    { type: 'section', label: 'Stat feedback (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STAT_EVENTS.map((e) => ({ key: `tah.statSound.${e}`, label: _toLabel(e), preview: true })) },

    { type: 'section', label: 'Action FX audio (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: ACTION_FX_KEYS.map((a) => ({ key: `tah.actionFxSound.${a}`, label: _toLabel(a), preview: true })) },
];

// StatusFX subkeys live in the `statusFXConfig` Object setting.
const STATUS_FX_VISUAL = [
    { sub: 'fx_dangerZone',  label: 'Danger Zone Glow' },
    { sub: 'fx_burn',        label: 'Burn Glow' },
    { sub: 'fx_overshield',  label: 'Overshield Glow' },
    { sub: 'fx_cascading',   label: 'Cascading Effect' },
    { sub: 'fx_invisible',   label: 'Invisible Effect' },
    { sub: 'fx_hidden',      label: 'Hidden Effect' },
    { sub: 'fx_brace',       label: 'Brace Shield Effect' },
    { sub: 'fx_jammed',      label: 'Jammed Effect' },
    { sub: 'fx_intangible',  label: 'Intangible Effect' },
    { sub: 'fx_infection',   label: 'Infection Glow' },
    { sub: 'fx_exposed',     label: 'Exposed Effect' },
    { sub: 'fx_falling',     label: 'Falling Effect' },
    { sub: 'fx_dazed',       label: 'Dazed Effect' },
    { sub: 'fx_stunned',     label: 'Stunned Effect' },
    { sub: 'fx_shredded',    label: 'Shredded / Stripped Effect' },
    { sub: 'fx_slowed',      label: 'Slowed Effect' },
    { sub: 'fx_throttled',   label: 'Throttled Effect' },
    { sub: 'fx_immobilized', label: 'Immobilized / Staggered Effect' },
    { sub: 'fx_blinded',     label: 'Blinded Effect' },
    { sub: 'fx_flying',      label: 'Flying Hover Bob' },
    { sub: 'fx_corePower',   label: 'Core Power Active Bloom' },
];
const STATUS_FX_AUTO = [
    { sub: 'auto_dangerZone', label: 'Auto Danger Zone (heat ≥ 50%)' },
    { sub: 'auto_burn',       label: 'Auto Burn icon (burn > 0)' },
    { sub: 'auto_overshield', label: 'Auto Overshield icon (OS > 0)' },
    { sub: 'auto_infection',  label: 'Auto Infection icon (infection > 0)' },
    { sub: 'auto_cascading',  label: 'Auto Cascading icon (NHP cascading)' },
];

const STATUSES_FIELDS = [
    { key: 'additionalStatuses', type: 'boolean' },

    { type: 'section', label: 'Effects Configuration' },
    { type: 'statusFx', sub: 'master', label: 'Master toggle (Status FX)', hint: 'Disable to suppress all visual + auto-status effects.' },
    { type: 'statusFx', sub: 'actionFX', label: 'Enable Action FX', hint: 'Boost, Hide, Shut Down, Fall, Overcharge, etc. Some use JB2A Patreon assets.' },
    { type: 'statusFx', sub: 'removeStatusesOnDeath', label: 'Remove Statuses on Death' },

    { type: 'section', label: 'Visual effects' },
    { type: 'compactStatusFx', items: STATUS_FX_VISUAL },

    { type: 'section', label: 'Auto-status icons' },
    { type: 'compactStatusFx', items: STATUS_FX_AUTO },
];

const DEBUG_FIELDS = [
    { key: 'debugBoostDetection', type: 'boolean' },
    { key: 'debugPathHexCalculation', type: 'boolean' },
    { key: 'debugOutOfCombat', type: 'boolean' },
];

const TOOLS_FIELDS = [
    { type: 'section', label: 'Optional content packs' },
    { key: 'enableLaSossisItems', type: 'boolean' },
    { key: 'enablePersonalStuff', type: 'boolean' },

    { type: 'section', label: 'Maintenance' },
    { type: 'button',
        key: 'openLcpRepair',
        label: 'Apply Fixes (LCP Data)',
        icon: 'fas fa-wrench',
        hint: '(optional, mainly for ammo stuff) Rebuild all compendium and actor item data with Lancer Automations patches applied.',
        onClick: () => repairLCPData(),
    },
    { type: 'button',
        key: 'openReset',
        label: 'Reset to Defaults',
        icon: 'fas fa-undo',
        hint: 'Reset all module settings and activations to their default values.',
        onClick: () => new ReactionReset().render(true),
    },
    { type: 'button',
        key: 'openExport',
        label: 'Export to JSON',
        icon: 'fas fa-file-export',
        hint: 'Export all custom activations to a JSON file.',
        onClick: () => new ReactionExport().render(true),
    },
    { type: 'button',
        key: 'openImport',
        label: 'Import from JSON',
        icon: 'fas fa-file-import',
        hint: 'Import activations from a JSON file.',
        onClick: () => new ReactionImport().render(true),
    },
];

const TAB_DEFS = [
    { id: 'activations', label: 'Activations', icon: 'fas fa-bolt', fields: ACTIVATIONS_FIELDS },
    { id: 'combat', label: 'Combat & Movement', icon: 'fas fa-running', fields: COMBAT_MOVEMENT_FIELDS },
    { id: 'wrecks', label: 'Wrecks', icon: 'fas fa-skull-crossbones', fields: WRECKS_FIELDS },
    { id: 'tokens', label: 'Tokens & Display', icon: 'fas fa-cubes', fields: TOKENS_DISPLAY_FIELDS },
    { id: 'tah', label: 'Token Action HUD', icon: 'fas fa-th-list', fields: TAH_FIELDS },
    { id: 'sounds', label: 'Sounds', icon: 'fas fa-volume-high', fields: SOUNDS_FIELDS },
    { id: 'statuses', label: 'Statuses & FX', icon: 'fas fa-tags', fields: STATUSES_FIELDS },
    { id: 'debug', label: 'Debug', icon: 'fas fa-bug', fields: DEBUG_FIELDS },
    { id: 'tools', label: 'Tools & Extras', icon: 'fas fa-toolbox', fields: TOOLS_FIELDS },
];

/** @param {string} sub */
function _readStatusFx(sub) {
    try {
        const cfg = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
        return cfg[sub] !== undefined ? cfg[sub] : true;
    } catch {
        return true;
    }
}

/** @param {any} f */
function _buildItem(f) {
    if (f.type === 'section')
        return { type: 'section', label: f.label, isSection: true, collapsible: !!f.collapsible, collapsed: !!f.collapsed };
    if (f.type === 'button')
        return { type: 'button', isButton: true, key: f.key, label: f.label, hint: f.hint ?? '', icon: f.icon ?? '' };
    if (f.type === 'table') {
        const table = f.getTable();
        return { type: 'table', label: f.label, isTable: true, columns: table.columns, rows: table.rows };
    }
    if (f.type === 'compactBooleans') {
        return {
            type: 'compactBooleans',
            isCompactBooleans: true,
            items: (f.items ?? []).map((/** @type {any} */ it) => {
                let value = true;
                try {
                    value = !!game.settings.get(MODULE_ID, it.key);
                } catch { /* not ready */ }
                return { key: it.key, label: it.label, value, preview: !!it.preview };
            }),
        };
    }
    if (f.type === 'compactStatusFx') {
        return {
            type: 'compactBooleans',
            isCompactBooleans: true,
            items: (f.items ?? []).map((/** @type {any} */ it) => ({
                key: `_sfx.${it.sub}`,
                label: it.label,
                value: _readStatusFx(it.sub) !== false,
                preview: false,
            })),
        };
    }
    if (f.type === 'statusFx') {
        // _sfx. prefix routes the value back into statusFXConfig on save.
        return {
            key: `_sfx.${f.sub}`,
            type: 'boolean',
            label: f.label,
            hint: f.hint ?? '',
            value: _readStatusFx(f.sub) !== false,
            isBoolean: true,
            choices: [],
        };
    }
    let value;
    try {
        value = game.settings.get(MODULE_ID, f.key);
    } catch {
        value = f.default;
    }
    const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`) || {};
    if (f.type === 'color') {
        const hexRe = /^#[0-9a-fA-F]{6}$/;
        if (typeof value !== 'string' || !hexRe.test(value)) {
            const fromColor = (typeof value?.toString === 'function') ? value.toString() : null;
            value = (fromColor && hexRe.test(fromColor)) ? fromColor : (setting.default ?? f.default ?? '#000000');
        }
    }
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
}

// ---------------------------------------------------------------------------
// FCS lock injection (unchanged from original settingsMenus.js)
// ---------------------------------------------------------------------------

function _getFCSData() {
    if (!game.modules.get('force-client-settings')?.active)
        return null;
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

/** @param {string} key @param {any} fcs */
async function _toggleFCSForce(key, fcs) {
    if (!game.user?.isGM)
        return;
    const currentMode = fcs.forced.get(key)?.mode ?? 'open';
    const forced = Object.fromEntries(fcs.forced);
    if (currentMode === 'open')
        forced[key] = { mode: 'soft' };
    else if (currentMode === 'soft')
        forced[key] = { mode: 'hard' };
    else
        delete forced[key];
    await game.settings.set('force-client-settings', 'forced', forced);
    fcs.forced = new Map(Object.entries(forced));
}

/** @param {any} html @param {any[]} fields @param {any} app */
function _injectFCSLocks(html, fields, app) {
    const fcs = _getFCSData();
    if (!fcs)
        return;
    const isGM = game.user?.isGM;
    /** @type {Record<string, string>} */
    const fa = {
        'hard-gm': 'fa-lock',
        'soft-gm': 'fa-unlock-keyhole',
        'open-gm': 'fa-lock-keyhole-open',
        'unlocked-gm': 'fa-dungeon',
        'hard-client': 'fa-lock',
        'soft-client': 'fa-unlock-keyhole',
        'unlocked-client': 'fa-lock-keyhole-open',
    };
    const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
    // compactStatusFx skipped: its values write into the world-scoped
    // statusFXConfig Object, so FCS per-key forcing doesn't apply.
    /** @type {any[]} */
    const expanded = [];
    for (const f of fields) {
        if (f.type === 'compactBooleans') {
            for (const it of (f.items ?? []))
                expanded.push({ key: it.key, type: 'boolean', _inCompactGrid: true });
        } else if (f.type === 'compactStatusFx') {
            continue;
        } else {
            expanded.push(f);
        }
    }
    for (const f of expanded) {
        if (!f.key || f.type === 'section' || f.type === 'button' || f.type === 'table')
            continue;
        const key = `${MODULE_ID}.${f.key}`;
        const setting = game.settings.settings.get(key);
        if (!setting || setting.scope === 'world')
            continue;
        const $input = $html.find(`[name="${f.key}"]`);
        if ($input.length === 0)
            continue;
        const $label = f._inCompactGrid
            ? $input.closest('label')
            : $input.closest('.form-group').find('label').first();
        if ($label.length === 0)
            continue;
        let mode = fcs.forced.get(key)?.mode ?? 'open';
        if ((mode === 'soft' || isGM) && fcs.unlocked.has(key))
            mode = 'unlocked';
        const modeKey = mode + (isGM ? '-gm' : '-client');
        if (modeKey === 'open-client')
            continue;
        const icon = fa[modeKey];
        if (!icon)
            continue;
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
        if (['hard-client', 'soft-client'].includes(modeKey))
            $input.prop('disabled', true);
    }
}

// ---------------------------------------------------------------------------
// Unified configuration window
// ---------------------------------------------------------------------------

/** @param {string} key */
async function _previewSettingSound(key) {
    if (!key) return;
    const sound = await import('./tah/sound.js');
    const fx = await import('./actionFX.js');
    if (key.startsWith('tah.uiSound.')) {
        sound.playUiSound(/** @type {any} */ (key.slice('tah.uiSound.'.length)), { force: true });
    } else if (key.startsWith('tah.tokenSound.')) {
        sound.playUiSound(/** @type {any} */ (key.slice('tah.tokenSound.'.length)), { force: true });
    } else if (key.startsWith('tah.damageSound.')) {
        await sound.playDamageSound(key.slice('tah.damageSound.'.length), { force: true });
    } else if (key.startsWith('tah.statSound.')) {
        sound.playStatsSound(key.slice('tah.statSound.'.length), { force: true });
    } else if (key.startsWith('tah.actionFxSound.')) {
        fx.previewActionFxSound(key.slice('tah.actionFxSound.'.length));
    }
}

/** @param {any} $h2 @param {boolean} collapsed */
function _toggleSection($h2, collapsed) {
    $h2.attr('data-collapsed', collapsed ? 'true' : 'false');
    $h2.find('.la-chevron').css('transform', collapsed ? 'rotate(-90deg)' : '');
    let $next = $h2.next();
    while ($next.length && !$next.is('h2.la-section')) {
        $next.toggle(!collapsed);
        $next = $next.next();
    }
}

export class LancerAutomationsConfig extends FormApplication {
    constructor(...args) {
        super(...args);
        this._needsReload = false;
        /** @type {Map<string, boolean>} label → collapsed; survives app.render() so toggles like FCS lock don't reset open sections. */
        this._sectionStates = new Map();
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'lancer-automations-config',
            title: 'Lancer Automations Configuration',
            template: TEMPLATE_PATH,
            width: 760,
            height: 720,
            resizable: true,
            closeOnSubmit: true,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'activations' }],
        });
    }

    getData() {
        const tabs = TAB_DEFS.map((tab, idx) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            active: idx === 0,
            items: tab.fields.map(_buildItem),
        }));
        return { tabs };
    }

    activateListeners(html) {
        super.activateListeners(html);
        const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
        $html.find('button[data-action-key]').on('click', async (/** @type {any} */ ev) => {
            ev.preventDefault();
            const key = ev.currentTarget.dataset.actionKey;
            for (const tab of TAB_DEFS) {
                const f = /** @type {any} */ (tab.fields.find((/** @type {any} */ x) => x.key === key));
                if (f?.onClick) {
                    await f.onClick();
                    return;
                }
            }
        });
        $html.find('.la-preview-btn').on('click', async (/** @type {any} */ ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await _previewSettingSound(ev.currentTarget.dataset.previewKey);
        });
        $html.find('h2.la-collapsible').each((/** @type {number} */ _i, /** @type {any} */ h2) => {
            const $h2 = $(h2);
            const label = $h2.text().trim();
            const collapsed = this._sectionStates.has(label)
                ? this._sectionStates.get(label)
                : $h2.attr('data-collapsed') === 'true';
            _toggleSection($h2, collapsed);
        }).on('click', (/** @type {any} */ ev) => {
            const $h2 = $(ev.currentTarget);
            const next = $h2.attr('data-collapsed') !== 'true';
            _toggleSection($h2, next);
            this._sectionStates.set($h2.text().trim(), next);
        });
        for (const tab of TAB_DEFS)
            _injectFCSLocks(html, tab.fields, this);
    }

    async _updateObject(_event, formData) {
        // _sfx.* form values fold back into the single statusFXConfig object.
        const sfxSubs = new Set();
        for (const tab of TAB_DEFS) {
            for (const fRaw of tab.fields) {
                const f = /** @type {any} */ (fRaw);
                if (f.type === 'statusFx' && f.sub)
                    sfxSubs.add(f.sub);
            }
        }
        if (sfxSubs.size > 0) {
            try {
                const existing = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                /** @type {any} */
                const next = { ...existing };
                let changed = false;
                for (const sub of sfxSubs) {
                    const formKey = `_sfx.${sub}`;
                    const newVal = !!formData[formKey];
                    if (next[sub] !== newVal) {
                        next[sub] = newVal;
                        changed = true;
                    }
                }
                if (changed) {
                    await game.settings.set(MODULE_ID, 'statusFXConfig', next);
                    const setting = game.settings.settings.get(`${MODULE_ID}.statusFXConfig`);
                    if (setting?.requiresReload)
                        this._needsReload = true;
                }
            } catch (e) {
                console.warn(`${MODULE_ID} | Could not save statusFXConfig`, e);
            }
        }

        // Unchecked checkboxes are absent from formData; treat as false.
        /** @type {any[]} */
        const allFields = [];
        for (const tab of TAB_DEFS) {
            for (const fRaw of tab.fields) {
                const f = /** @type {any} */ (fRaw);
                if (!f.key && f.type === 'table' && f.tableKeys) {
                    for (const tk of f.tableKeys) {
                        const setting = game.settings.settings.get(`${MODULE_ID}.${tk}`);
                        allFields.push({ key: tk, type: setting?.type === Boolean ? 'boolean' : 'string' });
                    }
                } else if (f.type === 'compactBooleans') {
                    for (const it of (f.items ?? []))
                        allFields.push({ key: it.key, type: 'boolean' });
                } else if (f.type === 'compactStatusFx') {
                    continue;
                } else if (f.key && f.type !== 'section' && f.type !== 'button' && f.type !== 'statusFx') {
                    allFields.push(f);
                }
            }
        }
        for (const f of allFields) {
            if (!(f.key in formData)) {
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
            if (f.type === 'number' || f.type === 'slider')
                val = Number(val);
            if (f.type === 'boolean')
                val = !!val;
            try {
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`);
                const prev = game.settings.get(MODULE_ID, f.key);
                if (prev !== val && setting?.requiresReload)
                    this._needsReload = true;
                await game.settings.set(MODULE_ID, f.key, val);
            } catch (e) {
                console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
            }
        }
        ui.notifications.info('Lancer Automations configuration saved.');
    }

    async close(options) {
        const r = await super.close(options);
        if (this._needsReload) {
            this._needsReload = false;
            const reload = await Dialog.confirm({
                title: 'Reload Required',
                content: '<p>One or more changes require a reload to take effect. Reload now?</p>',
                yes: () => true,
                no: () => false,
                defaultYes: true,
            });
            if (reload)
                foundry.utils.debouncedReload();
        }
        return r;
    }
}

export function registerSettingsMenus() {
    game.settings.registerMenu(MODULE_ID, 'lancerAutomationsConfigMenu', {
        name: 'Lancer Automations Configuration',
        label: 'Open Configuration',
        hint: 'Unified configuration window for all module settings.',
        icon: 'fas fa-sliders-h',
        type: LancerAutomationsConfig,
        restricted: false,
    });
}
