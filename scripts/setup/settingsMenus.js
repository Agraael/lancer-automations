/* global game, ui, canvas, FormApplication, foundry, jQuery, Dialog, $ */

import { ReactionReset } from '../activations/reaction-reset.js';
import { ReactionExport, ReactionImport } from '../activations/reaction-export-import.js';
import { repairLCPData, syncAllActorImgs, syncAllTokenHeights } from './lancer-modif.js';
import { openNewsHistory } from './news.js';

const MODULE_ID = 'lancer-automations';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/lancer-automations-config.html`;

const ACTIVATIONS_FIELDS = [
    { type: 'section', label: 'Activation Manager' },
    { key: 'reactionNotificationMode', type: 'select', label: 'Activation Notification Mode' },
    { key: 'consumeReaction', type: 'boolean' },
    { key: 'consumeAction', type: 'boolean' },
    { key: 'treatGenericPrintAsActivation', type: 'boolean' },

    { type: 'section', label: 'Scan' },
    { key: 'scanJournalSource', type: 'select', label: 'Scan journal source', hint: 'System: native Lancer v3 scan journal. LA legacy: the older Lancer Automations custom journal template.' },
    { type: 'button',
        key: 'regenerateScans',
        label: 'Regenerate All Scan Journals',
        icon: 'fas fa-book',
        hint: 'Walk every entry in the SCAN Database folder and re-render its page using the current template (LA legacy mode).',
        onClick: async () => {
            const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
            await api?.regenerateScans?.();
        },
    },
];

const COMBAT_MOVEMENT_FIELDS = [
    { type: 'section', label: 'Combat Flows' },
    { key: 'enableKnockbackFlow', type: 'boolean' },
    { key: 'enableThrowFlow', type: 'boolean' },
    { key: 'statRollTargeting', type: 'boolean' },
    { key: 'enablePathHexCalculation', type: 'boolean' },
    { key: 'enableMovementCapDetection', type: 'boolean' },
    { key: 'tah.rangePreviewOnAttackCard', type: 'boolean', label: 'Range Preview on Attack Card' },
    { key: 'enableBoostOffer', type: 'boolean' },
    { key: 'experimentalBoostDetection', type: 'boolean' },
    { key: 'enableAltStruct', type: 'boolean' },
    { key: 'enableOneStructNpc', type: 'boolean' },
    { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    { key: 'count3DDistance', type: 'boolean' },
    { type: 'section', label: 'Lancer Automations Ruler', collapsible: true, collapsed: true },
    { key: 'enableBuiltinSpeedProvider', type: 'boolean', label: 'Enable Lancer Automations Ruler', hint: 'Custom token/canvas ruler with Lancer speed tiers, free/debug movement modes, and THT elevation readout. Reload after toggling.' },
    { key: 'rulerPerStepRender', type: 'boolean', label: 'Per-step Ruler Path', hint: 'Polyline through each grid step instead of a straight line.' },
    { key: 'enableClimbWaypoints', type: 'boolean', label: 'Auto-insert Climb Waypoints', hint: 'Tag movement path steps with the "climb" action wherever terrain elevation changes under the token.' },
    { key: 'disableAutoTerrainElevation', type: 'boolean', label: 'Disable Auto-elevation from Terrain', hint: 'Stop tracking THT terrain elevation under tokens during ruler moves. Q/E offsets still work.' },
    { key: 'speedProvider.colorStandard', type: 'color', label: 'Speed Color: Standard' },
    { key: 'speedProvider.colorBoost', type: 'color', label: 'Speed Color: Boost' },
    { key: 'speedProvider.colorOverBoost', type: 'color', label: 'Speed Color: Over-boost' },
    { key: 'speedProvider.colorFreeMovement', type: 'color', label: 'Speed Color: Free Movement' },
    { key: 'speedProvider.colorForceMovement', type: 'color', label: 'Speed Color: Force Movement' },
    { key: 'resetMovementTypeOnDragStart', type: 'boolean', label: 'Reset Movement Type on Drag Start', hint: 'Each drag starts on the token\'s natural action (walk, or fly if the token is flying). Use M to cycle mid-drag.' },
    { key: 'enableTacticalDistance', type: 'select', label: 'Tactical Distance Labels', hint: 'While dragging a token, show its 2D distance and elevation delta below every other visible token.' },
];

const WRECKS_FIELDS = [
    { type: 'section', label: 'Wreck Generation' },
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
            const terrainChoices = (key) => {
                let cur = game.settings.get(MODULE_ID, key);
                if (cur === true)
                    cur = 'terrain';
                else if (cur === false)
                    cur = 'none';
                else if (cur !== 'terrain' && cur !== 'aura' && cur !== 'none')
                    cur = 'none';
                return [
                    { value: 'none', label: 'Nothing', selected: cur === 'none' },
                    { value: 'terrain', label: 'THT Terrain', selected: cur === 'terrain' },
                    { value: 'aura', label: 'Aura (movement +1)', selected: cur === 'aura' },
                ];
            };
            return {
                columns: ['Category', 'Mode', 'On Wreck'],
                rows: [
                    { label: 'Mech',
                        cells: [
                            { isSelect: true, name: 'wreckMode_mech', choices: modeChoices('wreckMode_mech') },
                            { isSelect: true, name: 'wreckTerrain_mech', choices: terrainChoices('wreckTerrain_mech') },
                        ]},
                    { label: 'Human / Pilot / Squad',
                        cells: [
                            { isSelect: true, name: 'wreckMode_human', choices: modeChoices('wreckMode_human') },
                            { isSelect: true, name: 'wreckTerrain_human', choices: terrainChoices('wreckTerrain_human') },
                        ]},
                    { label: 'Monstrosity',
                        cells: [
                            { isSelect: true, name: 'wreckMode_monstrosity', choices: modeChoices('wreckMode_monstrosity') },
                            { isSelect: true, name: 'wreckTerrain_monstrosity', choices: terrainChoices('wreckTerrain_monstrosity') },
                        ]},
                    { label: 'Biological',
                        cells: [
                            { isSelect: true, name: 'wreckMode_biological', choices: modeChoices('wreckMode_biological') },
                            { isSelect: true, name: 'wreckTerrain_biological', choices: terrainChoices('wreckTerrain_biological') },
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
    { type: 'section', label: 'Token Display' },
    { key: 'linkManualDeploy', type: 'boolean' },
    { key: 'showDeployableLines', type: 'boolean' },
    { key: 'allowHalfSizeTokens', type: 'boolean' },
    { key: 'autoTokenHeight', type: 'boolean', label: 'Auto Token Height (Wall Height)', hint: 'Auto-set tokenHeight to actor size + 0.1 so tokens peek above walls of their size.' },
    { key: 'autoTokenHeightVehicleSquad', type: 'boolean', label: 'Vehicle & Squad Height Adjustments', hint: 'Vehicles get reduced height (size-1, capped at 4). Squads get 0.5.' },
    { type: 'button',
        key: 'syncAllTokenHeights',
        label: 'Apply Token Heights to All Actors',
        icon: 'fas fa-ruler-vertical',
        hint: 'Walk every world actor and write prototypeToken.flags.wall-height.tokenHeight using the rules above.',
        onClick: () => syncAllTokenHeights(),
    },

    { type: 'section', label: 'Token HUD Buttons', collapsible: true, collapsed: true },
    { key: 'showBonusHudButton', type: 'boolean' },
    { key: 'showStatusEffectsHudButton', type: 'boolean' },
    { key: 'showCombatStateHudButton', type: 'boolean' },
    { key: 'showTargetStateHudButton', type: 'boolean' },
    { key: 'showRevertMovementHudButton', type: 'boolean' },
    { type: 'moduleBoolean', module: 'temporary-custom-statuses', key: 'enableHud', label: 'Custom Status HUD Button' },

    { type: 'section', label: 'Custom Token Stat Bars', collapsible: true, collapsed: true },
    { key: 'tokenStatBar', type: 'boolean', label: 'Enable Custom Token Stat Bars', hint: 'Requires reload when toggled. Disabled when Bar Brawl is active.' },
    { key: 'statBarEffectIconScale', type: 'slider', label: 'Effect Icon Scale (Stat Bar)', min: 0.3, max: 1, step: 0.05 },
    { key: 'statBarDefaultHidden', type: 'boolean', label: 'Hide Stat Bar by Default' },
    { key: 'statBarDefaultCombatOnly', type: 'boolean', label: 'Show Only In Combat by Default' },
    { key: 'statBarDefaultRowHeight', type: 'number', label: 'Default Row Height (px)', hint: 'Leave 0 for auto (scales with grid).' },
    { key: 'statBarDefaultPilotStress', type: 'boolean', label: 'Display Stress on Pilot Tokens' },
    { key: 'statBarVisibilityOutOfCombat', type: 'select', label: 'Visibility — Out of Combat', getChoices: () => _statBarVisChoices('statBarVisibilityOutOfCombat') },
    { key: 'statBarVisibilityInCombat',   type: 'select', label: 'Visibility — In Combat',   getChoices: () => _statBarVisChoices('statBarVisibilityInCombat') },
    { type: 'button',
        key: 'statBarApplyDefaults',
        label: 'Apply Defaults to Current Scene',
        icon: 'fas fa-clone',
        hint: 'Overwrites per-token settings on every Lancer token in the active scene.',
        onClick: async () => {
            const mod = await import('../tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).applyDefaultsToCurrentScene;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn('applyDefaultsToCurrentScene is not exported.');
        },
    },
];

const TAH_FIELDS = [
    { type: 'section', label: 'Token Action HUD' },
    { key: 'tahEnabled', type: 'boolean', label: 'Enable Token Action HUD' },
    { key: 'tah.clickToOpen', type: 'boolean' },
    { key: 'tah.hoverCloseDelay', type: 'number' },
    { key: 'tah.maxColumnItems', type: 'number' },
    { key: 'tah.rangePreview', type: 'boolean' },
    { key: 'tah.showAidHandleInteractSqueeze', type: 'boolean' },
    { key: 'tah.auraUseAltKey', type: 'boolean' },
    { key: 'tah.aboveActorSheets', type: 'boolean' },
    { key: 'tah.showDisposition', type: 'boolean', label: 'Show Team / Disposition Indicator', hint: 'Colored stripe on the title bar. Shows team if Token Factions advanced teams is active, otherwise disposition.' },
    { key: 'tah.resetPosition',
        type: 'button',
        label: 'Reset TAH Position',
        icon: 'fas fa-undo',
        hint: 'Reset the HUD to its default screen position.',
        clientAllowed: true,
        onClick: async () => {
            await game.settings.set(MODULE_ID, 'tah.position', null);
            ui.notifications.info('TAH position reset to default. Re-select a token to see the change.');
        } },
    { key: 'tah.clearAuras',
        type: 'button',
        label: 'Clear & Rebuild TAH Auras (Scene)',
        icon: 'fas fa-broom',
        hint: 'Remove all TAH-created auras from every token on the current scene, then re-apply configured defaults.',
        onClick: async () => {
            if (!canvas?.scene)
                return ui.notifications.warn('No active scene.');
            const { applyDefaultAuras } = await import('../tah/hover.js');
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
            for (const tok of tokens)
                await applyDefaultAuras(tok);
            ui.notifications.info(`Cleared TAH auras from ${cleared} token(s) and rebuilt defaults.`);
        } },
    { key: 'tah.clearMacros',
        type: 'button',
        label: 'Clear TAH Macros',
        icon: 'fas fa-trash',
        hint: 'Remove every macro from the TAH Macros category for this client.',
        clientAllowed: true,
        onClick: async () => {
            const confirmed = await Dialog.confirm({
                title: 'Clear TAH Macros',
                content: '<p>Remove every macro from the TAH Macros category? This cannot be undone.</p>',
            });
            if (!confirmed)
                return;
            await game.settings.set(MODULE_ID, 'tah.macroList', []);
            Hooks.callAll('forceUpdateTokenActionHud');
            ui.notifications.info('TAH Macros cleared.');
        } },
    { key: 'tah.clearFavorites',
        type: 'button',
        label: 'Clear TAH Favorites',
        icon: 'fas fa-star',
        hint: 'Remove every favorite (★) marked through the TAH. Saved per user.',
        clientAllowed: true,
        onClick: async () => {
            const confirmed = await Dialog.confirm({
                title: 'Clear TAH Favorites',
                content: '<p>Remove every favorite marker? This cannot be undone.</p>',
            });
            if (!confirmed)
                return;
            await /** @type {any} */ (game.user).setFlag(MODULE_ID, 'tahFavorites', []);
            Hooks.callAll('forceUpdateTokenActionHud');
            ui.notifications.info('TAH Favorites cleared.');
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

// Per-action FX functions. Same list as the settings registered in tah/index.js.
const ACTION_FX_KEYS = [
    'skirmish', 'eject', 'selfDestruct', 'teleport', 'bootUp',
    'dismount', 'mount', 'disengage', 'deployable', 'freeAction', 'corePower',
    'protocol', 'reaction', 'fullAction', 'quickAction', 'standingUp',
    'prepare', 'interact', 'handle', 'fullTech', 'quickTech', 'invade',
    'grapple', 'ram', 'jockey', 'barrage', 'boost', 'overchargeNpc', 'hide',
    'shutDown', 'fall', 'fallImpact', 'search', 'scan', 'targetSuccess',
    'defaultThrow', 'targetFail', 'reload', 'fight',
];
const UI_VARIANTS = ['hover', 'open', 'details', 'toggle', 'statusHover'];
const TOKEN_VARIANTS = ['tokenHover', 'tokenSelect', 'tokenDeselect',
    'tokenTarget', 'tokenUntarget', 'tokenDrag', 'tokenMove', 'elevationKey'];
const DAMAGE_TYPES = ['kinetic', 'energy', 'explosive', 'variable',
    'heat', 'burn', 'infection', 'armor', 'hit_overshield', 'overshield'];
const STAT_EVENTS = ['hp_loss', 'hp_heal', 'heat_clean', 'stress_hit', 'stress_heal', 'miss', 'hit', 'crit', 'success', 'fail'];
const STATUS_SFX_EVENTS = ['bonus'];

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

    { type: 'section', label: 'Status SFX (mute toggles)', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STATUS_SFX_EVENTS.map((e) => ({ key: `tah.statusSfx.${e}`, label: _toLabel(e), preview: true })) },

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
    { key: 'guardianBulwarkAuraMode', type: 'select', label: 'Guardian / Bulwark Aura', hint: '"Only in Combat" requires the GAA Fork.' },

    { type: 'section', label: 'Auto-status icons' },
    { type: 'compactStatusFx', items: STATUS_FX_AUTO },
];

const DEBUG_FIELDS = [
    { type: 'section', label: 'Debug Toggles' },
    { key: 'debugBoostDetection', type: 'boolean' },
    { key: 'debugPathHexCalculation', type: 'boolean' },
    { key: 'debugOutOfCombat', type: 'boolean' },
    { key: 'debugForceJb2aFree', type: 'boolean' },
];

const VISION_FIELDS = [
    { type: 'section', label: 'Vision From Edge (Lancer LOS-style) [experimental]' },
    { key: 'visionFromEdgeEnabled', type: 'boolean' },
    { key: 'visionFromEdgeSampleMode', type: 'select' },
    { key: 'visionFromEdgeSampleOffset', type: 'number' },
    { key: 'visionFromEdgeDebug', type: 'boolean' },

    { type: 'section', label: 'Token Blocks Line of Sight' },
    { key: 'bulwarkBlocksLineOfSight', type: 'boolean' },

    { type: 'section', label: 'Lancer Vision Modes' },
    { key: 'lancerVisionAutoAdd', type: 'boolean' },
    { type: 'compactBooleans',
        items: [
            { key: 'lancerSensorCombatOnly', label: 'Sensor: Combat Only' },
            { key: 'lancerAwarenessCombatOnly', label: 'Awareness: Combat Only' },
            { key: 'lancerSensorUseModeRange', label: 'Sensor: Use Mode Range' },
            { key: 'lancerAwarenessUseModeRange', label: 'Awareness: Use Mode Range' }
        ]
    },
    { type: 'button',
        key: 'refreshLancerVisionTokens',
        label: 'Refresh Tokens (All Scenes + Actors)',
        icon: 'fas fa-sync',
        hint: 'Adds missing Lancer detection modes and reorders them so Sensors take priority over Awareness. Touches every actor prototype and every placed token in every scene.',
        onClick: () => globalThis.lancerAutoVisionSetup?.(false),
    },

    { type: 'section', label: 'Basic Vision' },
    { key: 'basicSightTo999', type: 'boolean' },

    { type: 'section', label: 'Drag Vision' },
    { key: 'dragVisionMode', type: 'select' },
    { key: 'dragVisionMultiplier', type: 'number' },

    { type: 'section', label: 'Performance' },
    { key: 'visionAnimationThrottleFps', type: 'number' },
    { key: 'disableVisionAboveControlled', type: 'number' },
];

const TOOLS_FIELDS = [
    { type: 'section', label: 'Optional content packs' },
    { key: 'enableLaSossisItems', type: 'boolean' },
    { key: 'enablePersonalStuff', type: 'boolean' },

    { type: 'section', label: 'Actor ↔ Prototype Token sync' },
    { key: 'syncActorImgToToken', type: 'boolean', label: 'Sync actor portrait to token image', hint: 'When the prototype token image changes, also update the actor portrait (Actors directory).' },
    { key: 'syncActorNameToToken', type: 'boolean', label: 'Sync actor name to token name', hint: 'When the prototype token name changes, also update the actor name (Actors directory).' },
    { type: 'button',
        key: 'syncAllActorImgs',
        label: 'Sync All Actors Now',
        icon: 'fas fa-images',
        hint: 'Walk every world actor and copy the prototype token image and name onto the actor.',
        onClick: () => syncAllActorImgs(),
    },

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
        hint: 'Export custom activations, user startup scripts, all Lancer Automations settings, and the foreign-module shortcuts shown here, to a JSON file.',
        onClick: () => new ReactionExport().render(true),
    },
    { type: 'button',
        key: 'openImport',
        label: 'Import from JSON',
        icon: 'fas fa-file-import',
        hint: 'Import from a JSON file. A review dialog lets you pick exactly which activations and settings to apply.',
        onClick: () => new ReactionImport().render(true),
    },

    { type: 'section', label: 'News' },
    { type: 'button',
        key: 'openNewsHistory',
        label: 'News & Releases',
        icon: 'fas fa-newspaper',
        hint: 'Browse past news entries and module release notes.',
        onClick: () => openNewsHistory(),
    },
];

const laKb = (key) => ({ type: 'keybinding', module: 'lancer-automations', key });

const CONTROL_FIELDS = [
    { type: 'section', label: 'Lancer Automations' },
    laKb('resetMovement'),
    laKb('tah.toggleSearch'),

    { type: 'section', label: 'Movement' },
    laKb('freeMovement'),
    laKb('debugMovement'),
];

const ISO_FIELDS = [
    { type: 'section', label: 'Isometric Integrations' },
    { key: 'iso.statBar', type: 'boolean' },
    { key: 'iso.tacticalDistance', type: 'boolean' },
    { key: 'iso.waypointLabel', type: 'boolean' },
    { key: 'iso.elevationAnimation', type: 'boolean' },
    { key: 'iso.restoreAnchor', type: 'boolean' },
    { key: 'iso.scrollingText', type: 'boolean' },
    { key: 'iso.targetReticle', type: 'boolean' },
    { key: 'iso.clickZone', type: 'boolean' },
    { key: 'iso.selectionMarquee', type: 'boolean' },
    { key: 'iso.moduleLabels', type: 'boolean' },
];

const TAB_DEFS = [
    { id: 'activations', label: 'Activations', icon: 'fas fa-bolt', fields: ACTIVATIONS_FIELDS },
    { id: 'combat', label: 'Combat & Movement', icon: 'fas fa-running', fields: COMBAT_MOVEMENT_FIELDS },
    { id: 'wrecks', label: 'Wrecks', icon: 'fas fa-skull-crossbones', fields: WRECKS_FIELDS },
    { id: 'tokens', label: 'Tokens & Display', icon: 'fas fa-cubes', fields: TOKENS_DISPLAY_FIELDS },
    { id: 'tah', label: 'Token Action HUD', icon: 'fas fa-th-list', fields: TAH_FIELDS },
    { id: 'sounds', label: 'Sounds', icon: 'fas fa-volume-high', fields: SOUNDS_FIELDS },
    { id: 'statuses', label: 'Statuses & FX', icon: 'fas fa-tags', fields: STATUSES_FIELDS },
    { id: 'iso', label: 'Isometric', icon: 'fas fa-cube', fields: ISO_FIELDS, condition: () => !!game.modules.get('isometric-perspective')?.active || !!game.modules.get('grape_juice-isometrics')?.active },
    { id: 'debug', label: 'Debug', icon: 'fas fa-bug', fields: DEBUG_FIELDS },
    { id: 'tools', label: 'Tools & Extras', icon: 'fas fa-toolbox', fields: TOOLS_FIELDS },
    { id: 'experimental', label: 'Vision', icon: 'fas fa-eye', fields: VISION_FIELDS },
    { id: 'control', label: 'Control', icon: 'fas fa-keyboard', fields: CONTROL_FIELDS },
];

function _visibleTabs() {
    return TAB_DEFS.filter(t => !t.condition || t.condition());
}

export function getExportableModuleBooleanFields() {
    /** @type {{ module: string, key: string }[]} */
    const out = [];
    for (const tab of TAB_DEFS) {
        for (const f of tab.fields) {
            const fa = /** @type {any} */ (f);
            if (fa.type === 'moduleBoolean' && fa.module && fa.key)
                out.push({ module: fa.module, key: fa.key });
        }
    }
    return out;
}

export function getExportableKeybindingFields() {
    /** @type {{ module: string, key: string }[]} */
    const out = [];
    for (const tab of TAB_DEFS) {
        for (const f of tab.fields) {
            const fa = /** @type {any} */ (f);
            if (fa.type === 'keybinding' && fa.module && fa.key)
                out.push({ module: fa.module, key: fa.key });
        }
    }
    return out;
}

const KEY_DISPLAY = {
    ArrowLeft: '🡸',
    ArrowRight: '🡺',
    ArrowUp: '🡹',
    ArrowDown: '🡻',
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
function _displayKey(code) {
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
function _formatBinding(b) {
    const parts = [...(b.modifiers ?? [])];
    parts.push(_displayKey(b.key));
    return parts.join(' + ');
}

function _isLockedForUser(key) {
    if (game.user.isGM) {
        return false;
    }
    if (!key) {
        return true;
    }
    if (typeof key === 'string' && key.startsWith('_sfx.')) {
        return true;
    }
    const setting = game.settings.settings.get(`${MODULE_ID}.${key}`);
    if (!setting) {
        return true;
    }
    return setting.scope === 'world';
}

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
    if (f.type === 'section') {
        if (f.requireForkTitle) {
            const m = game.modules.get(f.requireForkTitle.module);
            if (!m?.active || m.title !== f.requireForkTitle.title)
                return null;
        }
        return { type: 'section', label: f.label, isSection: true, collapsible: !!f.collapsible, collapsed: !!f.collapsed };
    }
    if (f.type === 'button')
        return { type: 'button', isButton: true, key: f.key, label: f.label, hint: f.hint ?? '', icon: f.icon ?? '', isLocked: !game.user.isGM && !f.clientAllowed };
    if (f.type === 'table') {
        const table = f.getTable();
        const rows = table.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({ ...cell, isLocked: _isLockedForUser(cell.name) }))
        }));
        return { type: 'table', label: f.label, isTable: true, columns: table.columns, rows };
    }
    if (f.type === 'keybinding') {
        const mod = game.modules.get(f.module);
        if (!mod?.active)
            return null;
        if (f.requireTitle && mod.title !== f.requireTitle)
            return null;
        const fullKey = `${f.module}.${f.key}`;
        const action = /** @type {any} */ (game.keybindings).actions?.get(fullKey);
        if (!action)
            return null;
        const bindings = /** @type {any[]} */ (game.keybindings.bindings?.get(fullKey)) ?? [];
        return {
            type: 'keybinding',
            isKeybinding: true,
            fullKey,
            name: game.i18n.localize(action.name ?? f.key),
            hint: action.hint ? game.i18n.localize(action.hint) : '',
            bindings: bindings.map(/** @type {any} */ b => ({ display: _formatBinding(b) }))
        };
    }
    if (f.type === 'moduleBoolean') {
        const mod = game.modules.get(f.module);
        if (!mod?.active) {
            return null;
        }
        let value = false;
        try {
            value = !!game.settings.get(f.module, f.key);
        } catch { /* setting not registered */ }
        const setting = game.settings.settings.get(`${f.module}.${f.key}`) ?? {};
        return {
            key: `__ext.${f.module}.${f.key}`,
            type: 'boolean',
            label: f.label ?? setting.name ?? f.key,
            hint: f.hint ?? setting.hint ?? '',
            value,
            isBoolean: true,
            isLocked: !game.user.isGM
        };
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
                return { key: it.key, label: it.label, value, preview: !!it.preview, isLocked: _isLockedForUser(it.key) };
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
                isLocked: !game.user.isGM
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
            isLocked: !game.user.isGM
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
        isLocked: _isLockedForUser(f.key)
    };
}

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

/** @param {any} html @param {any[]} fields @param {any} _app */
function _injectFCSLocks(html, fields, _app) {
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
                const newMode = fcs.forced.get(key)?.mode ?? 'open';
                let resolved = newMode;
                if ((resolved === 'soft' || isGM) && fcs.unlocked.has(key))
                    resolved = 'unlocked';
                const newModeKey = resolved + (isGM ? '-gm' : '-client');
                const newIcon = fa[newModeKey];
                $icon.attr('class', `fas ${newIcon ?? 'fa-lock-keyhole-open'}`);
                $icon.prop('title', game.i18n.localize(`FORCECLIENTSETTINGS.ui.${newModeKey}-hint`));
                $input.prop('disabled', ['hard-client', 'soft-client'].includes(newModeKey));
            });
        $label.prepend($icon);
        if (['hard-client', 'soft-client'].includes(modeKey))
            $input.prop('disabled', true);
    }
}

/** @param {string} key */
async function _previewSettingSound(key) {
    if (!key)
        return;
    const sound = await import('../tah/sound.js');
    const fx = await import('../fx/actionFX.js');
    if (key.startsWith('tah.uiSound.')) {
        sound.playUiSound(/** @type {any} */ (key.slice('tah.uiSound.'.length)), { force: true });
    } else if (key.startsWith('tah.tokenSound.')) {
        sound.playUiSound(/** @type {any} */ (key.slice('tah.tokenSound.'.length)), { force: true });
    } else if (key.startsWith('tah.damageSound.')) {
        await sound.playDamageSound(key.slice('tah.damageSound.'.length), { force: true });
    } else if (key.startsWith('tah.statSound.')) {
        sound.playStatsSound(key.slice('tah.statSound.'.length), { force: true });
    } else if (key.startsWith('tah.statusSfx.')) {
        sound.playStatusSfxSound(key.slice('tah.statusSfx.'.length), { force: true });
    } else if (key.startsWith('tah.actionFxSound.')) {
        fx.previewActionFxSound(key.slice('tah.actionFxSound.'.length));
    }
}

/**
 * Reads every named input/select/textarea inside the form into a Map<name, value>.
 * Used so action buttons see edits that haven't been persisted via the Save button yet.
 * @param {HTMLFormElement|null} form
 * @returns {Map<string, any>}
 */
function _readFormSettings(form) {
    const map = new Map();
    if (!form)
        return map;
    const els = form.querySelectorAll('input[name], select[name], textarea[name]');
    for (const el of /** @type {any} */ (els)) {
        const name = el.name;
        if (!name)
            continue;
        let value;
        if (el.type === 'checkbox') {
            value = !!el.checked;
        } else if (el.type === 'number' || el.type === 'range') {
            value = el.value === '' ? null : Number(el.value);
        } else {
            value = el.value;
        }
        map.set(name, value);
    }
    return map;
}

/**
 * Temporarily wraps `game.settings.get` so calls for keys present in `formMap`
 * return the form's current value (with type coercion based on the registered setting type).
 * @param {Map<string, any>} formMap
 * @returns {() => void} restore function
 */
function _patchSettingsGet(formMap) {
    const original = game.settings.get.bind(game.settings);
    game.settings.get = function(namespace, key) {
        if (namespace === MODULE_ID && formMap.has(key)) {
            const cfg = /** @type {any} */ (game.settings.settings.get(`${namespace}.${key}`));
            const raw = formMap.get(key);
            try {
                if (cfg?.type === Boolean)
                    return Boolean(raw);
                if (cfg?.type === Number)
                    return raw === null ? cfg.default : Number(raw);
                if (cfg?.type === String)
                    return raw == null ? "" : String(raw);
            } catch { /* fall through */ }
            return raw;
        }
        return original(namespace, key);
    };
    return () => {
        game.settings.get = original;
    };
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
            width: 860,
            height: 720,
            resizable: true,
            closeOnSubmit: true,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: 'activations' }],
        });
    }

    getData() {
        const tabs = _visibleTabs().map((tab, idx) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            active: idx === 0,
            items: tab.fields.map(_buildItem).filter(Boolean),
        }));
        return { tabs };
    }

    activateListeners(html) {
        super.activateListeners(html);
        const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
        const captureKey = (onDone) => {
            const km = /** @type {any} */ (globalThis).KeyboardManager;
            const protectedKeys = new Set(km?.PROTECTED_KEYS ?? ['F5', 'F11', 'F12', 'PrintScreen', 'ScrollLock', 'NumLock', 'CapsLock', 'Pause', 'Break', 'Insert', 'Home', 'PageUp', 'PageDown', 'End', 'ContextMenu']);
            const handler = (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.key === 'Escape') {
                    document.removeEventListener('keydown', handler, true);
                    onDone(null);
                    return;
                }
                if (['Alt', 'AltLeft', 'AltRight', 'Control', 'ControlLeft', 'ControlRight', 'Shift', 'ShiftLeft', 'ShiftRight', 'Meta', 'MetaLeft', 'MetaRight'].includes(ev.code))
                    return;
                if (protectedKeys.has(ev.code)) {
                    ui.notifications.warn(`"${ev.code}" is reserved by Foundry and cannot be bound.`);
                    document.removeEventListener('keydown', handler, true);
                    onDone(null);
                    return;
                }
                const modifiers = [];
                if (ev.altKey)
                    modifiers.push('Alt');
                if (ev.ctrlKey)
                    modifiers.push('Control');
                if (ev.shiftKey)
                    modifiers.push('Shift');
                if (ev.metaKey)
                    modifiers.push('Meta');
                document.removeEventListener('keydown', handler, true);
                onDone({ key: ev.code, modifiers });
            };
            document.addEventListener('keydown', handler, true);
        };
        const splitFullKey = (fullKey) => {
            const dot = fullKey.indexOf('.');
            return [fullKey.slice(0, dot), fullKey.slice(dot + 1)];
        };
        const writeBindings = async (fullKey, next) => {
            const [ns, action] = splitFullKey(fullKey);
            await game.keybindings.set(ns, action, next);
            this.render(true);
        };

        const placeholderStyle = 'flex:0 0 auto; padding:2px 10px; height:24px; line-height:20px; border:1px solid var(--primary-color, #991e2a); background:rgba(153,30,42,0.08); color:var(--primary-color, #991e2a); border-radius:3px; font-family:inherit; font-size:0.78em; font-style:italic; margin:0; cursor:default;';

        $html.find('.la-kb-key').on('click', (/** @type {any} */ ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            const row = btn.closest('.la-keybinding-row');
            const fullKey = row?.dataset.fullKey;
            const idx = parseInt(btn.dataset.idx, 10);
            if (!fullKey || Number.isNaN(idx))
                return;
            const original = btn.outerHTML;
            const placeholder = document.createElement('span');
            placeholder.style.cssText = placeholderStyle;
            placeholder.textContent = 'Press a key… (Esc to cancel)';
            btn.replaceWith(placeholder);
            captureKey(async (binding) => {
                if (!binding) {
                    placeholder.outerHTML = original;
                    return;
                }
                const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
                current[idx] = binding;
                await writeBindings(fullKey, current);
            });
        });
        $html.find('.la-kb-key').on('contextmenu', async (/** @type {any} */ ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            const row = btn.closest('.la-keybinding-row');
            const fullKey = row?.dataset.fullKey;
            const idx = parseInt(btn.dataset.idx, 10);
            if (!fullKey || Number.isNaN(idx))
                return;
            const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
            current.splice(idx, 1);
            await writeBindings(fullKey, current);
        });
        $html.find('.la-kb-reset').on('click', async (/** @type {any} */ ev) => {
            ev.preventDefault();
            const row = ev.currentTarget.closest('.la-keybinding-row');
            const fullKey = row?.dataset.fullKey;
            if (!fullKey)
                return;
            const action = /** @type {any} */ (game.keybindings).actions?.get(fullKey);
            const defaults = (action?.editable ?? []).map(/** @type {any} */ b => ({ key: b.key, modifiers: [...(b.modifiers ?? [])] }));
            await writeBindings(fullKey, defaults);
        });
        $html.find('.la-kb-add').on('click', (/** @type {any} */ ev) => {
            ev.preventDefault();
            const btn = ev.currentTarget;
            const row = btn.closest('.la-keybinding-row');
            const binds = row?.querySelector('.la-kb-binds');
            const fullKey = row?.dataset.fullKey;
            if (!fullKey || !binds)
                return;
            const placeholder = document.createElement('span');
            placeholder.style.cssText = placeholderStyle;
            placeholder.textContent = 'Press a key… (Esc to cancel)';
            const resetBtn = binds.querySelector('.la-kb-reset');
            binds.insertBefore(placeholder, resetBtn);
            btn.style.display = 'none';
            captureKey(async (binding) => {
                if (!binding) {
                    placeholder.remove();
                    btn.style.display = '';
                    return;
                }
                const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
                current.push(binding);
                await writeBindings(fullKey, current);
            });
        });

        $html.find('button[data-action-key]').on('click', async (/** @type {any} */ ev) => {
            ev.preventDefault();
            const key = ev.currentTarget.dataset.actionKey;
            for (const tab of TAB_DEFS) {
                const f = /** @type {any} */ (tab.fields.find((/** @type {any} */ x) => x.key === key));
                if (f?.onClick) {
                    const formEl = ev.currentTarget.closest('form');
                    const formMap = _readFormSettings(formEl);
                    const restore = _patchSettingsGet(formMap);
                    try {
                        await f.onClick();
                    } finally {
                        restore();
                    }
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

        const $searchBar = $html.find('.la-config-search');
        const $searchToggle = $html.find('.la-config-search-toggle');
        const $search = $html.find('.la-config-search-input');
        const $clear = $html.find('.la-config-search-clear');
        const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapeHtml = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const stash = (/** @type {any} */ $el) => {
            if ($el.data('la-orig') === undefined)
                $el.data('la-orig', $el.html());
        };
        const restore = (/** @type {any} */ $el) => {
            const orig = $el.data('la-orig');
            if (orig !== undefined)
                $el.html(orig);
        };
        const MARK_OPEN = '<mark style="background:#f8d96b;color:#111;padding:0 1px;border-radius:2px;">';
        const MARK_CLOSE = '</mark>';
        const highlightIn = (/** @type {any} */ $el, /** @type {RegExp} */ re) => {
            stash($el);
            // Restore first, then walk text nodes to wrap matches.
            const orig = $el.data('la-orig') ?? '';
            $el.html(orig);
            const root = $el[0];
            if (!root)
                return;
            const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
            /** @type {Text[]} */
            const textNodes = [];
            let n;
            while ((n = walker.nextNode()))
                textNodes.push(/** @type {Text} */ (n));
            for (const node of textNodes) {
                const text = node.nodeValue ?? '';
                re.lastIndex = 0;
                if (!re.test(text))
                    continue;
                re.lastIndex = 0;
                const replaced = escapeHtml(text).replace(re, MARK_OPEN + '$&' + MARK_CLOSE);
                const span = document.createElement('span');
                span.innerHTML = replaced;
                node.parentNode?.replaceChild(span, node);
            }
        };
        const applyFilter = (query) => {
            const q = (query || '').trim().toLowerCase();
            $clear.css('display', q ? 'inline' : 'none');
            const re = q ? new RegExp(escapeRe(q), 'gi') : null;
            $html.find('.tab').each((/** @type {number} */ _i, /** @type {any} */ tab) => {
                const $tab = $(tab);
                const groups = $tab.find('.form-group, h2.la-section');
                if (!q) {
                    groups.css('display', '');
                    groups.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ el) => restore($(el)));
                    return;
                }
                let lastSection = null;
                let sectionHasMatch = false;
                const finalize = () => {
                    if (lastSection)
                        lastSection.css('display', sectionHasMatch ? '' : 'none');
                };
                groups.each((/** @type {number} */ _j, /** @type {any} */ el) => {
                    const $el = $(el);
                    if ($el.is('h2.la-section')) {
                        finalize();
                        lastSection = $el;
                        sectionHasMatch = false;
                        return;
                    }
                    const text = ($el.text() || '').toLowerCase();
                    const name = ($el.find('[name]').attr('name') || '').toLowerCase();
                    const match = text.includes(q) || name.includes(q);
                    $el.css('display', match ? '' : 'none');
                    if (match) {
                        sectionHasMatch = true;
                        $el.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ child) => highlightIn($(child), /** @type {RegExp} */ (re)));
                    } else {
                        $el.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ child) => restore($(child)));
                    }
                });
                finalize();
            });
            if (q) {
                $html.find('.tab').addClass('active').css('display', '');
            } else {
                $html.find('.tab').removeClass('active');
                const activeId = $html.find('.tabs .item.active').data('tab')
                    || $html.find('.tab').first().data('tab');
                $html.find(`.tab[data-tab="${activeId}"]`).addClass('active');
            }
        };
        $search.on('input', (/** @type {any} */ ev) => applyFilter(ev.currentTarget.value));
        $clear.on('click', () => {
            $search.val(''); applyFilter('');
        });

        const idleStyle    = { color: 'var(--primary-color)', 'border-color': 'var(--primary-color)', background: 'rgba(255,255,255,0.5)' };
        const hoverStyle   = { color: '#fff',                 'border-color': 'var(--primary-color)', background: 'var(--primary-color)' };
        const activeStyle  = { color: '#fff',                 'border-color': 'var(--primary-color)', background: 'var(--primary-color)' };
        const applyToggle = (style) => {
            $searchToggle.css(style);
            $searchToggle.find('i').css('color', style.color);
        };
        applyToggle(idleStyle);
        $searchToggle.on('mouseenter', () => applyToggle(hoverStyle));
        $searchToggle.on('mouseleave', () => {
            const open = $searchBar.css('display') !== 'none';
            applyToggle(open ? activeStyle : idleStyle);
        });
        $searchToggle.on('click', () => {
            const open = $searchBar.css('display') !== 'none';
            if (open) {
                $searchBar.css('display', 'none');
                $search.val('');
                applyFilter('');
                applyToggle(idleStyle);
            } else {
                $searchBar.css('display', 'flex');
                applyToggle(activeStyle);
                setTimeout(() => $search.trigger('focus'), 10);
            }
        });
    }

    async _updateObject(_event, formData) {
        // non-GM submits skip world-scoped writes so player saves don't clobber GM values
        const isGM = !!game.user?.isGM;
        const _canWrite = (moduleId, key) => {
            const setting = game.settings.settings.get(`${moduleId}.${key}`);
            if (!setting) return false;
            if (setting.scope === 'world') return isGM;
            return true;
        };

        for (const formKey of Object.keys(formData)) {
            if (!formKey.startsWith('__ext.')) {
                continue;
            }
            const rest = formKey.slice('__ext.'.length);
            const dot = rest.indexOf('.');
            if (dot < 1) {
                continue;
            }
            const moduleId = rest.slice(0, dot);
            const settingKey = rest.slice(dot + 1);
            if (!game.modules.get(moduleId)?.active) {
                continue;
            }
            if (!_canWrite(moduleId, settingKey))
                continue;
            try {
                await game.settings.set(moduleId, settingKey, !!formData[formKey]);
            } catch (e) {
                console.warn(`${MODULE_ID} | Could not save ${moduleId}.${settingKey}`, e);
            }
        }
        for (const tab of TAB_DEFS) {
            for (const fRaw of tab.fields) {
                const f = /** @type {any} */ (fRaw);
                if (f.type !== 'moduleBoolean') {
                    continue;
                }
                if (!game.modules.get(f.module)?.active) {
                    continue;
                }
                const formKey = `__ext.${f.module}.${f.key}`;
                if (formKey in formData) {
                    continue;
                }
                if (!_canWrite(f.module, f.key))
                    continue;
                try {
                    await game.settings.set(f.module, f.key, false);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Could not save ${f.module}.${f.key}`, e);
                }
            }
        }


        const sfxSubs = new Set();
        for (const tab of TAB_DEFS) {
            for (const fRaw of tab.fields) {
                const f = /** @type {any} */ (fRaw);
                if (f.type === 'statusFx' && f.sub)
                    sfxSubs.add(f.sub);
                else if (f.type === 'compactStatusFx') {
                    for (const it of (f.items ?? [])) {
                        if (it?.sub)
                            sfxSubs.add(it.sub);
                    }
                }
            }
        }
        if (sfxSubs.size > 0 && _canWrite(MODULE_ID, 'statusFXConfig')) {
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
            if (!_canWrite(MODULE_ID, f.key))
                continue;
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
