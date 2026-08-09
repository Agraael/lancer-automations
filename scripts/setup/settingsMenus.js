/* global game, ui, canvas, FormApplication, foundry, jQuery, Dialog, $ */

import { ReactionReset } from '../activations/reaction-reset.js';
import { ReactionExport, ReactionImport } from '../activations/reaction-export-import.js';
import { repairLCPData, syncAllActorImgs, syncAllTokenHeights } from './lancer-modif.js';
import { openNewsHistory } from './news.js';
import { openBattleLogGMCardTest, openBattleLogRecapTest } from '../Battelog/battlelog.js';
import { openTelemetryDebugWindow } from '../Battelog/telemetry-debug.js';
import { getFCSData, toggleFCSForce } from './fcs.js';
import { runSettingsOnboarding } from './settings-onboarding.js';
import { resetPaletteColorSettings } from '../interactive/canvas-helpers.js';

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
    { key: 'scanPlayerOwnershipMode', type: 'select', label: 'Player Ownership', hint: 'Who gets ownership on a scan journal when a player runs the scan. GM scans always grant to all players.' },
    { type: 'button',
        key: 'regenerateScans',
        label: 'Regenerate All Scan Journals',
        icon: 'fas fa-book',
        hint: 'Walk every entry in the SCAN Database folder and re-render its page using the current template (LA legacy mode).',
        onClick: async () =>
        {
            const api = /** @type {any} */ (game.modules.get('lancer-automations'))?.api;
            await api?.regenerateScans?.();
        },
    },
];

const COMBAT_MOVEMENT_FIELDS = [
    { type: 'section', label: 'Combat Flows' },

    { type: 'section', label: 'Targeting', subsection: true },
    { key: 'enableAttackTargeting', type: 'boolean' },
    { key: 'enableDamageTargeting', type: 'boolean' },
    { key: 'autoStartTargetPicking', type: 'boolean' },
    { key: 'statRollTargeting', type: 'boolean' },
    { key: 'targetInfoDisplay', type: 'select' },
    { key: 'tah.rangePreviewOnAttackCard', type: 'boolean', label: 'Range Preview on Attack/Damage HUD' },
    { key: 'displayToolsToOthers', type: 'boolean', label: 'Share Interactive Tools' },

    { type: 'section', label: 'Attacks', subsection: true },
    { key: 'enableKnockbackFlow', type: 'boolean' },
    { key: 'enableThrowFlow', type: 'boolean' },
    { key: 'autoDamageRoll', type: 'boolean' },
    { key: 'autoDamageApply', type: 'boolean' },

    { type: 'section', label: 'Movement & Boost', subsection: true },
    { key: 'enableMovementCapDetection', type: 'boolean' },
    { key: 'enableBoostOffer', type: 'boolean' },
    { key: 'experimentalBoostDetection', type: 'boolean' },
    { key: 'count3DDistance', type: 'boolean' },

    { type: 'section', label: 'Structure & Damage', subsection: true },
    { key: 'enableAltStruct', type: 'boolean' },
    { key: 'enableOneStructNpc', type: 'boolean' },
    { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    { key: 'convertHeatToEnergyOnHeatless', type: 'boolean' },
    { key: 'resistSelfHeat', type: 'boolean' },

    { type: 'section', label: 'Turns & Actions', subsection: true },
    { key: 'enablePerRoundTurnTags', type: 'boolean' },
    { type: 'section', label: 'Lancer Automations Ruler', collapsible: true, collapsed: true },
    { key: 'enableBuiltinSpeedProvider', type: 'boolean', label: 'Enable Lancer Automations Ruler', hint: 'Custom token/canvas ruler with Lancer speed tiers, free/debug movement modes, and THT elevation readout. Reload after toggling.' },
    { key: 'rulerPerStepRender', type: 'boolean', label: 'Per-step Ruler Path', hint: 'Polyline through each grid step instead of a straight line.' },
    { key: 'enableClimbWaypoints', type: 'boolean', label: 'Auto-insert Climb Waypoints', hint: 'Tag movement path steps with the "climb" action wherever terrain elevation changes under the token.' },
    { key: 'splitMovementAtTriggerBoundaries', type: 'boolean', label: 'Split Movement at Trigger Boundaries', hint: 'Split a token drag into sub-movements at each cell where it crosses a THT/TemplateMacro/GAA trigger boundary, so triggers fire per-crossing instead of once at the end.' },
    { key: 'splitMovementAtSpeedTiers', type: 'boolean', label: 'Split Movement at Speed Tiers', hint: 'Split a drag into sub-movements where the ruler tier changes, so events fire per tier.' },
    { key: 'pathfindDragMovement', type: 'boolean', label: 'Pathfind Drag Movement', hint: 'Route drags around hostile bodies and high terrain; straight line if blocked.' },
    { key: 'disableAutoTerrainElevation', type: 'boolean', label: 'Disable Auto-elevation from Terrain', hint: 'Stop tracking THT terrain elevation under tokens during ruler moves. Q/E offsets still work.' },
    { key: 'disableAutoElevationOnMeasure', type: 'boolean', label: 'Disable Auto-elevation on Measure', hint: 'Ignore THT terrain elevation in the canvas measure ruler labels. Token drag and drop unaffected.' },
    { key: 'enableTacticalDistance', type: 'select', label: 'Tactical Distance Labels', hint: 'While dragging a token, show its 2D distance and elevation delta below every other visible token.' },
    { key: 'tacticalElevationStep', type: 'number', label: 'Elevation Step (label)', hint: 'Round the elevation delta on the label to the nearest multiple of this (0.5 by default). Gridless scenes unaffected.' },

    { type: 'section', label: 'Advanced Measure', collapsible: true, collapsed: true },
    { key: 'ctrlRulerMode', type: 'select', label: 'Ctrl Ruler', hint: 'Hold Ctrl to switch to the Measure Distance ruler.' },
    { key: 'advMeasureScale', type: 'slider', label: 'Measure Toolbar Scale', min: 0.6, max: 1.6, step: 0.05 },
    { key: 'rulerToolCursor', type: 'boolean', label: 'Measure cursor', hint: 'While the Measure Distance tool is active, replace the cursor with the ruler icon and play a sound on toggle.' },
    { key: 'targetToolCursor', type: 'boolean', label: 'Select Target cursor', hint: 'While the Select Target tool is active, replace the cursor with the target icon and play a sound on toggle.' },
];

const WRECKS_FIELDS = [
    { type: 'section', label: 'Wreck Generation' },
    { key: 'enableWrecks', type: 'boolean' },
    { key: 'enableRemoveFromCombat', type: 'boolean' },
    { key: 'squadLostOnDeath', type: 'boolean' },

    { type: 'section', label: 'Per-Category Wrecks', collapsible: true, collapsed: true },
    { key: 'wreckTerrainType',
        type: 'select',
        label: 'Wreck Terrain Type',
        getChoices: () =>
        {
            const current = game.settings.get(MODULE_ID, 'wreckTerrainType') || '';
            const choices = [{ value: '', label: 'None (disabled)', selected: current === '' }];
            try
            {
                const types = globalThis.terrainHeightTools?.getTerrainTypes?.() || [];
                for (const terrainType of types)
                    choices.push({ value: terrainType.id, label: terrainType.name || terrainType.id, selected: terrainType.id === current });
            }
            catch
            { /* ignore */ }
            return choices;
        }},
    { type: 'table',
        label: 'Per-Category Settings',
        tableKeys: ['wreckMode_mech', 'wreckTerrain_mech', 'wreckMode_human', 'wreckTerrain_human',
            'wreckMode_monstrosity', 'wreckTerrain_monstrosity', 'wreckMode_biological', 'wreckTerrain_biological'],
        getTable: () =>
        {
            const modeChoices = (key) =>
            {
                const cur = game.settings.get(MODULE_ID, key);
                return [
                    { value: 'token', label: 'Token', selected: cur === 'token' },
                    { value: 'tile', label: 'Tile', selected: cur === 'tile' },
                    { value: 'none', label: 'Skip (do nothing)', selected: cur === 'none' },
                ];
            };
            const terrainChoices = (key) =>
            {
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
    { key: 'wreckFactionOnDeath',
        type: 'select',
        label: 'Wreck Faction On Death',
        getChoices: () =>
        {
            const cur = game.settings.get(MODULE_ID, 'wreckFactionOnDeath') || 'same';
            const choices = [
                { value: 'same', label: 'Same Team / Disposition', selected: cur === 'same' },
                { value: 'neutral', label: 'Neutral (No Team)', selected: cur === 'neutral' },
            ];
            const teams = game.modules.get('token-factions')?.active
                ? (game.settings.get('token-factions', 'team-setup') || [])
                : [];
            for (const team of teams)
                choices.push({ value: team.id, label: team.name, selected: team.id === cur });
            return choices;
        }},

    { type: 'section', label: 'Assets & Audio', collapsible: true, collapsed: true },
    { key: 'wreckAssetsPath', type: 'folder', label: 'Wreck Assets Folder' },
    { key: 'enableWreckAnimation', type: 'boolean' },
    { key: 'enableWreckAudio', type: 'boolean' },
    { key: 'disableHumanDeathSound', type: 'boolean' },
];

/** @param {string} key */
function _statBarVisChoices(key)
{
    let cur = 'all';
    try
    {
        cur = game.settings.get(MODULE_ID, key);
    }
    catch
    { /* not ready */ }
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
    { key: 'overlapTokenPicker', type: 'boolean' },

    { type: 'section', label: 'Token HUD Buttons', collapsible: true, collapsed: true },
    { key: 'showBonusHudButton', type: 'boolean' },
    { key: 'showStatusEffectsHudButton', type: 'boolean' },
    { key: 'showCombatStateHudButton', type: 'boolean' },
    { key: 'showTargetStateHudButton', type: 'boolean' },
    { key: 'showRevertMovementHudButton', type: 'boolean' },
    { type: 'moduleBoolean', module: 'temporary-custom-statuses', key: 'enableHud', label: 'Custom Status HUD Button' },

    { type: 'section', label: 'Custom Token Stat Bars', collapsible: true, collapsed: true },
    { key: 'tokenStatBar', type: 'boolean', label: 'Enable Custom Token Stat Bars', hint: 'Requires reload when toggled. Disabled when Bar Brawl is active.' },

    { type: 'section', label: 'Display', subsection: true },
    { key: 'statBarEffectIconScale', type: 'slider', label: 'Effect Icon Scale (Stat Bar)', min: 0.3, max: 1, step: 0.05 },
    { key: 'statBarShowValues', type: 'boolean', label: 'Show Numeric Values on Bars', hint: 'When off, HP/Heat/Stress numbers are hidden, only the bars are drawn.' },
    { key: 'statBarMinZoomScale', type: 'slider', label: 'Minimum Bar Zoom Scale', min: 0, max: 4, step: 0.1, hint: 'Below this zoom level the bar keeps a constant screen size. 0 = disabled.' },

    { type: 'section', label: 'Per-Token Defaults', subsection: true },
    { key: 'statBarDefaultHidden', type: 'boolean', label: 'Hide Stat Bar by Default' },
    { key: 'statBarDefaultCombatOnly', type: 'boolean', label: 'Show Only In Combat by Default' },
    { key: 'statBarDefaultRowHeight', type: 'number', label: 'Default Row Height (px)', hint: 'Leave 0 for auto (scales with grid).' },
    { key: 'statBarDefaultPilotStress', type: 'boolean', label: 'Display Stress on Pilot Tokens' },

    { type: 'section', label: 'Visibility', subsection: true },
    { key: 'statBarVisibilityOutOfCombat', type: 'select', label: 'Visibility — Out of Combat', getChoices: () => _statBarVisChoices('statBarVisibilityOutOfCombat') },
    { key: 'statBarVisibilityInCombat',   type: 'select', label: 'Visibility — In Combat',   getChoices: () => _statBarVisChoices('statBarVisibilityInCombat') },

    { type: 'section', label: 'Auto-Injected Bars', subsection: true },
    { key: 'statBarAutoInjectTalents', type: 'boolean', label: 'Auto-add Talent & Frame Counter Bars', hint: 'Inject an extra bar for every talent counter and frame core counter on Lancer tokens. Deleted bars are not re-added.' },
    { key: 'statBarAutoInjectTalentColor', type: 'color', label: 'Auto-Injected Bar Color', hint: 'Default color for auto-injected bars (talents, frame counters, and item/actor templates that do not set their own).' },
    { key: 'statBarAutoInjectTalentWidthPct', type: 'number', label: 'Auto-Injected Bar Width (%)', min: 1, max: 100, step: 1, hint: 'Default width % for auto-injected bars. Each is added on its own line.' },
    { key: 'statBarAutoInjectTalentFeedback', type: 'boolean', label: 'Auto-Injected Bar Audio/Text Feedback', hint: 'Default audio + floating text on value changes for auto-injected bars.' },
    { key: 'statBarAutoInjectCustomFlags', type: 'boolean', label: 'Auto-add Custom Flag Bars (Alt Sheets)', hint: 'When Annoying\'s Alternative Sheets is active: fraction custom flags render as token bars, value flags as TAH counters. Adding a bar via Add Extra creates a flag.' },
    { type: 'button',
        key: 'statBarReinjectAllAutoBars',
        label: 'Reinject Auto-Bars on All Tokens',
        icon: 'fas fa-sync',
        hint: 'Rebuild auto-injected bars on every Lancer token in every scene and on every actor prototype. Clears prior tombstones.',
        onClick: async () =>
        {
            const mod = await import('../tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).reinjectAutoBarsOnAllTokens;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn('reinjectAutoBarsOnAllTokens is not exported.');
        },
    },

    { type: 'section', label: 'Scene Actions', subsection: true },
    { type: 'button',
        key: 'statBarApplyDefaults',
        label: 'Apply Defaults to Current Scene',
        icon: 'fas fa-clone',
        hint: 'Overwrites per-token settings on every Lancer token in the active scene.',
        onClick: async () =>
        {
            const mod = await import('../tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).applyDefaultsToCurrentScene;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn('applyDefaultsToCurrentScene is not exported.');
        },
    },

    { type: 'section', label: 'Token Stat Hint', collapsible: true, collapsed: true },
    { key: 'tokenStatHintEnabled', type: 'boolean', label: 'Enable Token Stat Hint', hint: 'Hover popup showing stats for hovered tokens.' },
    { key: 'tokenStatHintDelayMs', type: 'slider', label: 'Hover Delay (ms)', min: 0, max: 2000, step: 50, hint: 'Delay before the popup appears.' },
    { key: 'tokenStatHintScale', type: 'slider', label: 'Popup Scale', min: 0.5, max: 2, step: 0.05, hint: 'Visual size of the popup. Independent of token size and zoom.' },
    { key: 'tokenStatHintShowForControlled', type: 'boolean', label: 'Show for Controlled Token', hint: 'When off, the popup is suppressed for the token you currently control.' },
    { key: 'tokenStatHintCombatOnly', type: 'boolean', label: 'Show Only In Combat', hint: 'When on, the popup only appears for tokens in an active combat.' },
    { key: 'tokenStatHintLabelMode',
        type: 'select',
        label: 'Header Label (NPC)',
        choices: [
            { value: 'actor', label: 'Always show name' },
            { value: 'scan', label: 'Tied to scan (UNKNOWN until scanned)' },
        ],
        hint: 'How to display the NPC token name in the popup header.',
    },
    { key: 'tokenStatHintUnknownLabel', type: 'string', label: 'Unknown Label', hint: 'Text shown for unscanned NPCs in Tied-to-scan mode.' },
    { key: 'tokenStatHintHideClassWhenUnknown', type: 'boolean', label: 'Hide class/templates/tier when not scanned', hint: 'Hide the NPC class+templates subtitle (or Mech frame name) and the NPC tier badge under the UNKNOWN header until scanned.' },
];

const TAH_FIELDS = [
    { type: 'section', label: 'Token Action HUD' },

    { type: 'section', label: 'General', subsection: true },
    { key: 'tahEnabled', type: 'boolean', label: 'Enable Token Action HUD' },
    { key: 'tah.narrativeMode', type: 'boolean', label: 'Narrative TAH', hint: 'When no token is selected, show a narrative HUD linkable to a pilot.' },
    { key: 'tah.aboveActorSheets', type: 'boolean' },
    { key: 'tah.showDisposition', type: 'boolean', label: 'Show Team / Disposition Indicator', hint: 'Colored stripe on the title bar. Shows team if Token Factions advanced teams is active, otherwise disposition.' },

    { type: 'section', label: 'Opening & Layout', subsection: true },
    { key: 'tah.clickToOpen', type: 'boolean' },
    { key: 'tah.hoverCloseDelay', type: 'number' },
    { key: 'tah.maxColumnItems', type: 'number' },

    { type: 'section', label: 'Keyboard', subsection: true, collapsible: true, collapsed: true },
    { key: 'tah.keyboardNav', type: 'boolean' },
    { key: 'tah.keyboardNavResetDelay', type: 'number' },
    { key: 'tah.preventWasdMovement', type: 'boolean' },

    { type: 'section', label: 'Ranges & Display', subsection: true },
    { key: 'tah.uiScale', type: 'slider', label: 'HUD Scale', min: 0.6, max: 1.6, step: 0.05 },
    { key: 'tah.rangePreview', type: 'boolean' },
    { key: 'tah.areaElevationAware', type: 'boolean', label: 'Area Elevation Aware (default)', hint: 'Default for area pickers (blast etc.). When on, areas become 3D volumes that clip to terrain.' },
    { key: 'tah.showAidHandleInteractSqueeze', type: 'boolean' },

    { type: 'section', label: 'Maintenance', subsection: true, collapsible: true, collapsed: true },
    { key: 'tah.resetPosition',
        type: 'button',
        label: 'Reset TAH Position',
        icon: 'fas fa-undo',
        hint: 'Reset the HUD to its default screen position.',
        clientAllowed: true,
        onClick: async () =>
        {
            await game.settings.set(MODULE_ID, 'tah.position', null);
            ui.notifications.info('TAH position reset to default. Re-select a token to see the change.');
        } },
    { key: 'tah.clearMacros',
        type: 'button',
        label: 'Clear TAH Macros',
        icon: 'fas fa-trash',
        hint: 'Remove every macro from the TAH Macros category for this client.',
        clientAllowed: true,
        onClick: async () =>
        {
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
        onClick: async () =>
        {
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
];

// Per-action FX functions. Same list as the settings registered in tah/index.js.
const ACTION_FX_KEYS = [
    'skirmish', 'eject', 'selfDestruct', 'teleport', 'bootUp',
    'dismount', 'mount', 'disengage', 'deployable', 'freeAction', 'corePower',
    'protocol', 'activation', 'reaction', 'fullAction', 'quickAction', 'standingUp',
    'prepare', 'interact', 'handle', 'fullTech', 'quickTech', 'invade',
    'grapple', 'ram', 'jockey', 'barrage', 'boost', 'overchargeNpc', 'hide',
    'shutDown', 'fall', 'fallImpact', 'search', 'scan', 'targetSuccess',
    'defaultThrow', 'targetFail', 'reload', 'fight',
];
const UI_VARIANTS = ['hover', 'open', 'details', 'toggle', 'statusHover', 'battleLogHover', 'battleLogClick'];
const TOKEN_VARIANTS = ['tokenHover', 'tokenSelect', 'tokenDeselect',
    'tokenTarget', 'tokenUntarget', 'tokenDrag', 'tokenMove', 'elevationKey', 'targeting', 'targetingConfirm'];
const DAMAGE_TYPES = ['kinetic', 'energy', 'explosive', 'variable',
    'heat', 'burn', 'infection', 'armor', 'hit_overshield', 'overshield'];
const STAT_EVENTS = ['hp_loss', 'hp_heal', 'heat_clean', 'stress_hit', 'stress_heal', 'miss', 'hit', 'crit', 'success', 'fail', 'generic_stat'];
const STATUS_SFX_EVENTS = ['bonus'];

function _toLabel(str)
{
    return str.replace(/_/g, ' ').replace(/([A-Z])/g, ' $1')
        .replace(/^./, (c) => c.toUpperCase()).trim();
}

const SOUNDS_FIELDS = [
    { type: 'section', label: 'Master volumes' },
    { key: 'tah.uiSoundVolume', type: 'slider', label: 'UI Sounds', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.tokenFeedbackVolume', type: 'slider', label: 'Token Feedback', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.damageSoundVolume', type: 'slider', label: 'Damage / Stat Feedback', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.actionFxVolume', type: 'slider', label: 'Action FX', min: 0, max: 1.5, step: 0.05 },
    { key: 'wreckMasterVolume', type: 'slider', label: 'Wreck Explosions', min: 0, max: 1.5, step: 0.1 },
    { key: 'tah.battleLogVolume', type: 'slider', label: 'Battle Log', min: 0, max: 1.5, step: 0.05 },

    { type: 'section', label: 'UI sounds', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: UI_VARIANTS.map((v) => ({ key: `tah.uiSound.${v}`, label: _toLabel(v), preview: true })) },

    { type: 'section', label: 'Token feedback', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: TOKEN_VARIANTS.map((v) => ({ key: `tah.tokenSound.${v}`, label: _toLabel(v.replace(/^token/, '')), preview: true })) },

    { type: 'section', label: 'Damage type sounds', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: DAMAGE_TYPES.map((t) => ({ key: `tah.damageSound.${t}`, label: _toLabel(t), preview: true })) },

    { type: 'section', label: 'Stat feedback', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STAT_EVENTS.map((e) => ({ key: `tah.statSound.${e}`, label: _toLabel(e), preview: true })) },
    { type: 'button',
        key: 'toggleLancerFloatingNumbers',
        label: 'Toggle Lancer Floating Numbers',
        icon: 'fas fa-arrows-alt-v',
        clientAllowed: true,
        onClick: async () =>
        {
            const cur = !!game.settings.get('lancer', 'floatingNumbers');
            await game.settings.set('lancer', 'floatingNumbers', !cur);
            ui.notifications?.info(`Floating Numbers: ${!cur ? 'ON' : 'OFF'}`);
        },
    },

    { type: 'section', label: 'Status SFX', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STATUS_SFX_EVENTS.map((e) => ({ key: `tah.statusSfx.${e}`, label: _toLabel(e), preview: true })) },

    { type: 'section', label: 'Action FX audio', collapsible: true, collapsed: true },
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
    { type: 'section', label: 'Statuses & Effects' },
    { key: 'additionalStatuses', type: 'boolean' },
    { type: 'statusFx', sub: 'master', label: 'Master toggle (Status FX)', hint: 'Disable to suppress all visual + auto-status effects.' },
    { type: 'statusFx', sub: 'lowQuality', default: false, label: 'Low-quality mode', hint: 'Outline-only swaps for Danger Zone, Core Power, Jammed.' },
    { type: 'statusFx', sub: 'actionFX', label: 'Enable Action FX', hint: 'Boost, Hide, Shut Down, Fall, Overcharge, etc. Some use JB2A Patreon assets.' },
    { type: 'statusFx', sub: 'removeStatusesOnDeath', label: 'Remove Statuses on Death' },

    { type: 'section', label: 'Visual effects', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_VISUAL },
    { key: 'guardianBulwarkAuraMode', type: 'select', label: 'Guardian / Bulwark Aura', hint: '"Only in Combat" requires the GAA Fork.' },

    { type: 'section', label: 'Auto-status icons', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_AUTO },
];

const DEBUG_FIELDS = [
    { type: 'section', label: 'Debug Toggles' },
    { key: 'debugBoostDetection', type: 'boolean' },
    { key: 'debugPathHexCalculation', type: 'boolean' },
    { key: 'debugOutOfCombat', type: 'boolean' },
    { key: 'debugForceJb2aFree', type: 'boolean' },
    { key: 'debugAutomation', type: 'boolean' },
    { key: 'iso.debugSelectionOverlay', type: 'boolean' },
];

const VISION_FIELDS = [
    { type: 'section', label: 'Lancer Vision Modes', hint: '<b>Line of Sight</b> = reciprocal 3D sight. <b>Sensors</b> (blue) = precise <code>sensor_range</code>. <b>Awareness</b> (yellow) = infinite, fuzzy. Sensor wins ties. Best with <b>fog of war</b> and token vision on.' },
    { key: 'lancerVisionAutoAdd', type: 'boolean' },
    { key: 'lancerLos', type: 'boolean' },
    { key: 'lancerLosDebug', type: 'boolean' },
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
        hint: 'Rebuild and reorder detection modes on every token. Run after enabling Auto-add.',
        onClick: () => globalThis.lancerAutoVisionSetup?.(false),
    },

    { type: 'section', label: 'Token Blocks Line of Sight', hint: 'Bulwarked tokens block line of sight around their footprint.' },
    { key: 'bulwarkBlocksLineOfSight', type: 'boolean' },

    { type: 'section', label: 'Token Height (Wall Height)', hint: 'Vertical tokenHeight for 3D line-of-sight over walls of the token\'s own size.' },
    { key: 'autoTokenHeight', type: 'boolean', label: 'Auto Token Height (Wall Height)', hint: 'Auto-set tokenHeight to actor size + 0.1 so tokens peek above walls of their size.' },
    { key: 'autoTokenHeightVehicleSquad', type: 'boolean', label: 'Vehicle & Squad Height Adjustments', hint: 'Vehicles get reduced height (size 1 = 0.5, otherwise size-1, capped at 4). Squads get 0.5.' },
    { type: 'button',
        key: 'syncAllTokenHeights',
        label: 'Apply Token Heights to All Actors',
        icon: 'fas fa-ruler-vertical',
        hint: 'Walk every world actor and write prototypeToken.flags.wall-height.tokenHeight using the rules above.',
        onClick: () => syncAllTokenHeights(),
    },

    { type: 'section', label: 'Basic Vision' },
    { key: 'basicSightTo999', type: 'boolean' },

    { type: 'section', label: 'Vision From Edge (Lancer LOS-style) [experimental]', collapsible: true, collapsed: true, hint: 'Sample vision from the token edge so you can see past cover.' },
    { key: 'visionFromEdgeEnabled', type: 'boolean' },
    { key: 'visionFromEdgeSampleMode', type: 'select' },
    { key: 'visionFromEdgeSampleOffset', type: 'number' },
    { key: 'visionFromEdgeDebug', type: 'boolean' },

    { type: 'section', label: 'Drag Vision', collapsible: true, collapsed: true },
    { key: 'dragVisionMode', type: 'select' },
    { key: 'dragVisionMultiplier', type: 'number' },

    { type: 'section', label: 'Performance', collapsible: true, collapsed: true },
    { key: 'visionAnimationThrottleFps', type: 'number' },
    { key: 'disableVisionAboveControlled', type: 'number' },
];

const TOOLS_FIELDS = [
    { type: 'section', label: 'Optional content packs', hint: 'Some LaSossis deployables need the personal <b>NPC Deployables LCP</b>. Get it below, then import it via the Lancer Compendium Manager (import .lcp).' },
    { key: 'enableLaSossisItems', type: 'boolean' },
    { key: 'enablePersonalStuff', type: 'boolean' },
    { type: 'button',
        key: 'getDeployablesLcp',
        label: 'Get the Deployables LCP',
        icon: 'fas fa-download',
        hint: 'Downloads LaSossis_Npc_Deployables.lcp (bundled with the module).',
        clientAllowed: true,
        onClick: () => window.open(foundry.utils.getRoute('modules/lancer-automations/extra/LaSossis_Npc_Deployables.lcp'), '_blank'),
    },

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

    { type: 'section', label: 'Maintenance', collapsible: true, collapsed: true },
    { type: 'button',
        key: 'openLcpRepair',
        label: 'Apply Fixes (LCP Data)',
        icon: 'fas fa-wrench',
        hint: '(optional) Rebuild compendium and actor item data with LA patches applied: ammo metadata, weapon profile text merging, and missing/empty action names (e.g. "Auto-Cooler" actions previously named just "Action").',
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
const laTour = (key) => ({ type: 'tour', module: 'lancer-automations', key });

const TUTORIALS_FIELDS = [
    { type: 'section', label: 'Setup', hint: 'First-run setup and guided walkthroughs.' },
    { type: 'button', key: 'openOnboarding', label: 'Re-run Setup Wizard', icon: 'fas fa-wand-magic-sparkles', hint: 'Answer the main settings as yes/no questions. Nothing is written until you press Apply.', onClick: () => runSettingsOnboarding() },
    { type: 'section', label: 'Tutorials', hint: 'Guided walkthroughs of the module. Clicking a tour will close this window and start it.' },
    laTour('config-tour'),
    laTour('activation-manager-tour'),
    laTour('effect-manager-tour'),
    laTour('tah-tour'),
    laTour('tah-advanced-tour'),
    laTour('ruler-tour'),
    laTour('advanced-measure-tour'),
    laTour('add-extra-tour'),
];

const CONTROL_FIELDS = [
    { type: 'section', label: 'Lancer Automations' },
    laKb('resetMovement'),

    { type: 'section', label: 'TAH Navigation', collapsible: true, collapsed: true },
    laKb('tah.toggleSearch'),
    laKb('tahNavUp'),
    laKb('tahNavDown'),
    laKb('tahNavLeft'),
    laKb('tahNavRight'),
    laKb('tahNavActivate'),
    laKb('tahNavContext'),

    { type: 'section', label: 'Movement' },
    laKb('freeMovement'),
    laKb('debugMovement'),
    laKb('movementWheel'),

    { type: 'section', label: 'Advanced Measure', collapsible: true, collapsed: true },
    laKb('advancedMeasure'),
    laKb('elevationUp'),
    laKb('elevationDown'),
    laKb('lineTiltUp'),
    laKb('lineTiltDown'),
    laKb('resetShape'),
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

const BATTLE_LOG_FIELDS = [
    { type: 'section', label: 'Battle Log' },
    {
        key: 'battleLogEnabled',
        type: 'boolean',
        label: 'Enable Battle Log',
        hint: 'Record combat telemetry and open the recap when a combat ends.',
    },
    {
        key: 'tah.telemetryFriendlyMechAsSquad',
        type: 'boolean',
        label: 'Friendly mechs count as squad',
        hint: 'Include FRIENDLY-disposition mechs (not owned by players) in the squad. Off: they render as friendlies.',
    },
    {
        key: 'tah.disableAwards',
        type: 'boolean',
        label: 'Disable awards',
        hint: 'No awards computed. No MVP auto-pick. GM can still pick MVP manually.',
    },
    {
        key: 'tah.telemetryDebug',
        type: 'boolean',
        label: 'Debug: log every telemetry event',
        hint: 'Console-log every event written to the combat telemetry flag. Turn off for normal play.',
    },

    { type: 'button',
        key: 'openBattleLogTest',
        label: 'Open GM card (test)',
        icon: 'fas fa-flag-checkered',
        onClick: () => openBattleLogGMCardTest(),
    },
    { type: 'button',
        key: 'openBattleLogRecapTest',
        label: 'Open Battle Log Recap',
        icon: 'fas fa-clipboard-list',
        onClick: () => openBattleLogRecapTest(),
    },
    { type: 'button',
        key: 'openTelemetryDebug',
        label: 'Telemetry debug',
        icon: 'fas fa-bug',
        onClick: () => openTelemetryDebugWindow(),
    },

    { type: 'section', label: 'Theme music', collapsible: true, collapsed: true },
    { key: 'tah.battleLog.themeDefault',
        type: 'audio',
        label: 'Default theme',
        hint: 'Audio file played for all outcomes unless a specific one is set below. Leave empty for no theme.' },
    { key: 'tah.battleLog.themeVictory',
        type: 'audio',
        label: 'Success theme',
        hint: 'Overrides the default when the mission outcome is SUCCESS.' },
    { key: 'tah.battleLog.themeDefeat',
        type: 'audio',
        label: 'Failure theme',
        hint: 'Overrides the default when the mission outcome is FAILURE.' },
    { key: 'tah.battleLog.themePartial',
        type: 'audio',
        label: 'Partial theme',
        hint: 'Overrides the default when the mission outcome is PARTIAL.' },
];

const COLORS_FIELDS = [
    { type: 'section', label: 'Targeting Colors' },
    { key: 'color.inRange', type: 'color', label: 'In Range' },
    { key: 'color.target', type: 'color', label: 'Target' },
    { key: 'color.reference', type: 'color', label: 'Reference Token' },
    { key: 'color.outOfRange', type: 'color', label: 'Out of Range' },
    { key: 'color.placed', type: 'color', label: 'Placed Shape' },
    { key: 'color.noHost', type: 'color', label: 'No Host' },
    { key: 'color.selected', type: 'color', label: 'Selected' },
    { key: 'color.crit', type: 'color', label: 'Critical' },
    { key: 'color.rangeFill', type: 'color', label: 'Range Fill' },
    { type: 'section', label: 'Tool Colors' },
    { key: 'color.traceStart', type: 'color', label: 'Trace Start' },
    { key: 'color.traceEnd', type: 'color', label: 'Trace End' },
    { key: 'color.traceLine', type: 'color', label: 'Trace Line' },
    { type: 'section', label: 'Range Glow Colors' },
    { key: 'color.glowManual', type: 'color', label: 'Default' },
    { key: 'color.glowThreat', type: 'color', label: 'Threat' },
    { key: 'color.glowSensor', type: 'color', label: 'Sensor' },
    { key: 'color.glowWeapon', type: 'color', label: 'Weapon' },
    { key: 'color.glowReach', type: 'color', label: 'Max Reach' },
    { key: 'color.glowMark', type: 'color', label: 'Mark' },
    { type: 'section', label: 'Range Pulse' },
    { key: 'rangePulseLineWidth', type: 'slider', label: 'Line Width', min: 1, max: 4, step: 0.25 },
    { type: 'section', label: 'Ruler Colors' },
    { key: 'speedProvider.colorStandard', type: 'color', label: 'Standard' },
    { key: 'speedProvider.colorBoost', type: 'color', label: 'Boost' },
    { key: 'speedProvider.colorOverBoost', type: 'color', label: 'Over-boost' },
    { key: 'speedProvider.colorFreeMovement', type: 'color', label: 'Free Movement' },
    { key: 'speedProvider.colorForceMovement', type: 'color', label: 'Force Movement' },
    {
        key: 'color.resetDefaults',
        type: 'button',
        label: 'Reset Colors to Default',
        icon: 'fas fa-undo',
        hint: 'Restore every color on this tab to its default.',
        clientAllowed: true,
        onClick: () => resetPaletteColorSettings(),
    },
];

const TAB_DEFS = [
    // Gameplay & rules
    { id: 'activations', label: 'Activations', icon: 'fas fa-bolt', fields: ACTIVATIONS_FIELDS },
    { id: 'combat', label: 'Combat & Movement', icon: 'fas fa-running', fields: COMBAT_MOVEMENT_FIELDS },
    { id: 'wrecks', label: 'Wrecks', icon: 'fas fa-skull-crossbones', fields: WRECKS_FIELDS },
    { id: 'statuses', label: 'Statuses & FX', icon: 'fas fa-tags', fields: STATUSES_FIELDS },
    { id: 'experimental', label: 'Vision', icon: 'fas fa-eye', fields: VISION_FIELDS },
    // Look & feel
    { id: 'tokens', label: 'Tokens & Display', icon: 'fas fa-cubes', fields: TOKENS_DISPLAY_FIELDS },
    { id: 'tah', label: 'Token Action HUD', icon: 'fas fa-th-list', fields: TAH_FIELDS },
    { id: 'colors', label: 'Colors', icon: 'fas fa-palette', fields: COLORS_FIELDS },
    { id: 'sounds', label: 'Sounds', icon: 'fas fa-volume-high', fields: SOUNDS_FIELDS },
    {
        id: 'iso',
        label: 'Isometric',
        icon: 'fas fa-cube',
        fields: ISO_FIELDS,
        disabledReason: () =>
        {
            const iso1 = !!game.modules.get('isometric-perspective')?.active;
            const iso2 = !!game.modules.get('grape_juice-isometrics')?.active;
            if (iso1 || iso2)
                return null;
            return 'Install and enable "Isometric Perspective" or "Grape Juice Isometrics" to use these settings.';
        },
    },
    // Interface & tools
    { id: 'battelog', label: 'Battle Log', icon: 'fas fa-flag-checkered', fields: BATTLE_LOG_FIELDS },
    { id: 'tools', label: 'Tools & Extras', icon: 'fas fa-toolbox', fields: TOOLS_FIELDS },
    { id: 'control', label: 'Control', icon: 'fas fa-keyboard', fields: CONTROL_FIELDS },
    // Help & maintenance
    { id: 'tutorials', label: 'Tutorial & Help', icon: 'fas fa-graduation-cap', fields: TUTORIALS_FIELDS },
    { id: 'debug', label: 'Debug', icon: 'fas fa-bug', fields: DEBUG_FIELDS },
];

function _visibleTabs()
{
    return TAB_DEFS.filter(tab => !tab.condition || tab.condition()).map(tab =>
    {
        const reason = tab.disabledReason?.() ?? null;
        return { ...tab, _disabled: !!reason, _disabledReason: reason };
    });
}

export function getExportableModuleBooleanFields()
{
    /** @type {{ module: string, key: string }[]} */
    const out = [];
    for (const tab of TAB_DEFS)
    {
        for (const f of tab.fields)
        {
            const field = /** @type {any} */ (f);
            if (field.type === 'moduleBoolean' && field.module && field.key)
                out.push({ module: field.module, key: field.key });
        }
    }
    return out;
}

export function getExportableKeybindingFields()
{
    /** @type {{ module: string, key: string }[]} */
    const out = [];
    for (const tab of TAB_DEFS)
    {
        for (const f of tab.fields)
        {
            const field = /** @type {any} */ (f);
            if (field.type === 'keybinding' && field.module && field.key)
                out.push({ module: field.module, key: field.key });
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
function _formatBinding(b)
{
    const parts = [...(b.modifiers ?? [])];
    parts.push(_displayKey(b.key));
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

/** @param {string} sub */
function _readStatusFx(sub, fallback = true)
{
    try
    {
        const cfg = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
        return cfg[sub] !== undefined ? cfg[sub] : fallback;
    }
    catch
    {
        return fallback;
    }
}

/** @param {any} f */
function _buildItem(f)
{
    if (f.type === 'section')
    {
        if (f.requireForkTitle)
        {
            const mod = game.modules.get(f.requireForkTitle.module);
            if (!mod?.active || mod.title !== f.requireForkTitle.title)
                return null;
        }
        return { type: 'section', label: f.label, hint: f.hint ?? '', isSection: true, collapsible: f.collapsible !== false, collapsed: !!f.collapsed, isSubsection: !!f.subsection };
    }
    if (f.type === 'button')
        return { type: 'button', isButton: true, key: f.key, label: f.label, hint: f.hint ?? '', icon: f.icon ?? '', isLocked: !game.user.isGM && !f.clientAllowed };
    if (f.type === 'table')
    {
        const table = f.getTable();
        const rows = table.rows.map(row => ({
            ...row,
            cells: row.cells.map(cell => ({ ...cell, isLocked: _isLockedForUser(cell.name) }))
        }));
        return { type: 'table', label: f.label, isTable: true, columns: table.columns, rows };
    }
    if (f.type === 'keybinding')
    {
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
    if (f.type === 'tour')
    {
        const mod = game.modules.get(f.module);
        if (!mod?.active)
            return null;
        const fullKey = `${f.module}.${f.key}`;
        const tour = /** @type {any} */ (game.tours)?.get?.(fullKey);
        if (!tour)
            return null;
        const rawTitle = tour.title ?? f.key;
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
    if (f.type === 'moduleBoolean')
    {
        const mod = game.modules.get(f.module);
        if (!mod?.active)
            return null;
        let value = false;
        try
        {
            value = !!game.settings.get(f.module, f.key);
        }
        catch
        { /* setting not registered */ }
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
    if (f.type === 'compactBooleans')
    {
        return {
            type: 'compactBooleans',
            isCompactBooleans: true,
            items: (f.items ?? []).map((/** @type {any} */ it) =>
            {
                let value = true;
                try
                {
                    value = !!game.settings.get(MODULE_ID, it.key);
                }
                catch
                { /* not ready */ }
                let hint = it.hint;
                if (!hint)
                {
                    try
                    {
                        hint = game.settings.settings.get(`${MODULE_ID}.${it.key}`)?.hint || '';
                    }
                    catch
                    {
                        hint = '';
                    }
                }
                return { key: it.key, label: it.label, hint, value, preview: !!it.preview, isLocked: _isLockedForUser(it.key) };
            }),
        };
    }
    if (f.type === 'compactStatusFx')
    {
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
    if (f.type === 'statusFx')
    {
        // _sfx. prefix routes the value back into statusFXConfig on save.
        const fallback = f.default ?? true;
        return {
            key: `_sfx.${f.sub}`,
            type: 'boolean',
            label: f.label,
            hint: f.hint ?? '',
            value: _readStatusFx(f.sub, fallback) !== false,
            isBoolean: true,
            choices: [],
            isLocked: !game.user.isGM
        };
    }
    let value;
    try
    {
        value = game.settings.get(MODULE_ID, f.key);
    }
    catch
    {
        value = f.default;
    }
    const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`) || {};
    if (f.type === 'color')
    {
        const hexRe = /^#[0-9a-fA-F]{6}$/;
        if (typeof value !== 'string' || !hexRe.test(value))
        {
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
        isAudio: f.type === 'audio',
        isColor: f.type === 'color',
        isSelect: f.type === 'select',
        isSlider: f.type === 'slider',
        sliderMin: f.min ?? setting.range?.min ?? 0,
        sliderMax: f.max ?? setting.range?.max ?? 1,
        sliderStep: f.step ?? setting.range?.step ?? 0.1,
        isSection: f.type === 'section',
        choices: (() =>
        {
            const raw = (typeof f.getChoices === 'function' ? f.getChoices() : f.choices);
            if (raw)
                return raw.map(choice => ({ ...choice, selected: choice.selected ?? (choice.value === value) }));
            if (setting.choices)
            {
                return Object.entries(setting.choices).map(([k, v]) => ({
                    value: k, label: v, selected: k === value,
                }));
            }
            return [];
        })(),
        isLocked: _isLockedForUser(f.key)
    };
}

/** @param {any} html @param {any[]} fields @param {any} _app */
/** @type {Record<string, string>} */
const _FCS_ICONS = {
    'hard-gm': 'fa-lock',
    'soft-gm': 'fa-unlock-keyhole',
    'open-gm': 'fa-lock-keyhole-open',
    'unlocked-gm': 'fa-dungeon',
    'hard-client': 'fa-lock',
    'soft-client': 'fa-unlock-keyhole',
    'unlocked-client': 'fa-lock-keyhole-open',
};

function _injectFCSLocks(html, fields, _app)
{
    const fcs = getFCSData();
    if (!fcs)
        return;
    const isGM = game.user?.isGM;
    const faIcons = _FCS_ICONS;
    const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
    // compactStatusFx skipped: values live in world-scoped statusFXConfig, so FCS per-key forcing doesn't apply.
    /** @type {any[]} */
    const expanded = [];
    for (const f of fields)
    {
        if (f.type === 'compactBooleans')
        {
            for (const it of (f.items ?? []))
                expanded.push({ key: it.key, type: 'boolean', _inCompactGrid: true });
        }
        else if (f.type === 'compactStatusFx')
            continue;
        else
            expanded.push(f);
    }
    for (const f of expanded)
    {
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
        const icon = faIcons[modeKey];
        if (!icon)
            continue;
        const $icon = $('<span>')
            .html('&nbsp;')
            .prop('title', game.i18n.localize(`FORCECLIENTSETTINGS.ui.${modeKey}-hint`))
            .attr('data-settings-key', key)
            .addClass(`fas ${icon} la-fcs-lock`)
            .css({ cursor: 'pointer', marginRight: '4px' });
        $label.prepend($icon);
        if (['hard-client', 'soft-client'].includes(modeKey))
            $input.prop('disabled', true);
    }
}

/** @param {string} key */
async function _previewSettingSound(key)
{
    if (!key)
        return;
    const sound = await import('../tah/sound.js');
    const fx = await import('../fx/actionFX.js');
    if (key.startsWith('tah.uiSound.'))
        sound.playUiSound(/** @type {any} */ (key.slice('tah.uiSound.'.length)), { force: true });
    else if (key.startsWith('tah.tokenSound.'))
        sound.playUiSound(/** @type {any} */ (key.slice('tah.tokenSound.'.length)), { force: true });
    else if (key.startsWith('tah.damageSound.'))
        await sound.playDamageSound(key.slice('tah.damageSound.'.length), { force: true });
    else if (key.startsWith('tah.statSound.'))
        sound.playStatsSound(key.slice('tah.statSound.'.length), { force: true });
    else if (key.startsWith('tah.statusSfx.'))
        sound.playStatusSfxSound(key.slice('tah.statusSfx.'.length), { force: true });
    else if (key.startsWith('tah.actionFxSound.'))
        fx.previewActionFxSound(key.slice('tah.actionFxSound.'.length));
}

/**
 * Reads every named input/select/textarea inside the form into a Map<name, value>.
 * Used so action buttons see edits that haven't been persisted via the Save button yet.
 * @param {HTMLFormElement|null} form
 * @returns {Map<string, any>}
 */
function _readFormSettings(form)
{
    const map = new Map();
    if (!form)
        return map;
    const els = form.querySelectorAll('input[name], select[name], textarea[name]');
    for (const el of /** @type {any} */ (els))
    {
        const name = el.name;
        if (!name)
            continue;
        let value;
        if (el.type === 'checkbox')
            value = !!el.checked;
        else if (el.type === 'number' || el.type === 'range')
            value = el.value === '' ? null : Number(el.value);
        else
            value = el.value;
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
function _patchSettingsGet(formMap)
{
    const original = game.settings.get.bind(game.settings);
    game.settings.get = function(namespace, key)
    {
        if (namespace === MODULE_ID && formMap.has(key))
        {
            const cfg = /** @type {any} */ (game.settings.settings.get(`${namespace}.${key}`));
            const raw = formMap.get(key);
            try
            {
                if (cfg?.type === Boolean)
                    return Boolean(raw);
                if (cfg?.type === Number)
                    return raw === null ? cfg.default : Number(raw);
                if (cfg?.type === String)
                    return raw == null ? "" : String(raw);
            }
            catch
            { /* fall through */ }
            return raw;
        }
        return original(namespace, key);
    };
    return () =>
    {
        game.settings.get = original;
    };
}

/** @param {any} $header @param {boolean} collapsed @param {boolean} [animate] */
function _toggleSection($header, collapsed, animate = false)
{
    $header.attr('data-collapsed', collapsed ? 'true' : 'false');
    $header.find('.la-chevron').css('transform', collapsed ? 'rotate(-90deg)' : '');

    const isSub = $header.is('h3.la-subsection-header');
    // Subsections stop on the next header of any level; top-level sections stop only on the next top-level.
    const stopSelector = isSub
        ? 'h2.la-section, h3.la-subsection-header'
        : 'h2.la-section';

    const setVisible = (/** @type {any} */ $el, /** @type {boolean} */ show) =>
    {
        if (!animate)
        {
            $el.toggle(show);
            return;
        }
        $el.stop(true, false);
        if (show)
            $el.slideDown(150);
        else
            $el.slideUp(150);
    };

    let $next = $header.next();
    let underCollapsedSub = false;
    while ($next.length && !$next.is(stopSelector))
    {
        if (collapsed)
            setVisible($next, false);
        else if (!isSub && $next.is('h3.la-subsection-header'))
        {
            setVisible($next, true);
            underCollapsedSub = $next.attr('data-collapsed') === 'true';
        }
        else
            setVisible($next, !underCollapsedSub);
        $next = $next.next();
    }
}

let _laConfigState = null;

export class LancerAutomationsConfig extends FormApplication
{
    constructor(...args)
    {
        super(...args);
        this._needsReload = false;
        /** @type {Map<string, boolean>} label → collapsed; survives app.render() so toggles like FCS lock don't reset open sections. */
        this._sectionStates = new Map();
    }

    static get defaultOptions()
    {
        const saved = _laConfigState;
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'lancer-automations-config',
            title: 'Lancer Automations Configuration',
            template: TEMPLATE_PATH,
            width: saved?.width ?? 860,
            height: saved?.height ?? 720,
            top: saved?.top ?? undefined,
            left: saved?.left ?? undefined,
            resizable: true,
            closeOnSubmit: true,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: saved?.tab ?? 'activations' }],
        });
    }

    getData()
    {
        const visible = _visibleTabs();
        const firstEnabledIdx = visible.findIndex(tab => !tab._disabled);
        const tabs = visible.map((tab, idx) => ({
            id: tab.id,
            label: tab.label,
            icon: tab.icon,
            active: idx === Math.max(firstEnabledIdx, 0),
            disabled: tab._disabled,
            disabledReason: tab._disabledReason,
            items: tab.fields.map(_buildItem).filter(Boolean),
        }));
        return { tabs };
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
        if (_laConfigState?.scroll != null)
        {
            const scroller = $html.find('.content .tab.active')[0] ?? $html.find('.content')[0];
            if (scroller)
            {
                requestAnimationFrame(() =>
                {
                    scroller.scrollTop = _laConfigState.scroll;
                });
            }
        }
        $html.find('.la-config-tabs .item.la-tab-disabled').on('click', (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        });
        const captureKey = (onDone) =>
        {
            const km = /** @type {any} */ (globalThis).KeyboardManager;
            const protectedKeys = new Set(km?.PROTECTED_KEYS ?? ['F5', 'F11', 'F12', 'PrintScreen', 'ScrollLock', 'NumLock', 'CapsLock', 'Pause', 'Break', 'Insert', 'Home', 'PageUp', 'PageDown', 'End', 'ContextMenu']);
            const handler = (ev) =>
            {
                ev.preventDefault();
                ev.stopPropagation();
                if (ev.key === 'Escape')
                {
                    document.removeEventListener('keydown', handler, true);
                    onDone(null);
                    return;
                }
                if (['Alt', 'AltLeft', 'AltRight', 'Control', 'ControlLeft', 'ControlRight', 'Shift', 'ShiftLeft', 'ShiftRight', 'Meta', 'MetaLeft', 'MetaRight'].includes(ev.code))
                    return;
                if (protectedKeys.has(ev.code))
                {
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
        const splitFullKey = (fullKey) =>
        {
            const dot = fullKey.indexOf('.');
            return [fullKey.slice(0, dot), fullKey.slice(dot + 1)];
        };
        const writeBindings = async (fullKey, next) =>
        {
            const [ns, action] = splitFullKey(fullKey);
            await game.keybindings.set(ns, action, next);
            this.render(true);
        };

        const placeholderStyle = 'flex:0 0 auto; padding:2px 10px; height:24px; line-height:20px; border:1px solid var(--primary-color, #991e2a); background:rgba(153,30,42,0.08); color:var(--primary-color, #991e2a); border-radius:3px; font-family:inherit; font-size:0.78em; font-style:italic; margin:0; cursor:default;';

        $html.find('.la-kb-key').on('click', (/** @type {any} */ ev) =>
        {
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
            captureKey(async (binding) =>
            {
                if (!binding)
                {
                    placeholder.outerHTML = original;
                    return;
                }
                const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
                current[idx] = binding;
                await writeBindings(fullKey, current);
            });
        });
        $html.find('.la-kb-key').on('contextmenu', async (/** @type {any} */ ev) =>
        {
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
        $html.find('.la-kb-reset').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            const row = ev.currentTarget.closest('.la-keybinding-row');
            const fullKey = row?.dataset.fullKey;
            if (!fullKey)
                return;
            const action = /** @type {any} */ (game.keybindings).actions?.get(fullKey);
            const defaults = (action?.editable ?? []).map(/** @type {any} */ b => ({ key: b.key, modifiers: [...(b.modifiers ?? [])] }));
            await writeBindings(fullKey, defaults);
        });
        $html.find('.la-kb-add').on('click', (/** @type {any} */ ev) =>
        {
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
            captureKey(async (binding) =>
            {
                if (!binding)
                {
                    placeholder.remove();
                    btn.style.display = '';
                    return;
                }
                const current = [...(game.keybindings.bindings.get(fullKey) ?? [])];
                current.push(binding);
                await writeBindings(fullKey, current);
            });
        });

        $html.find('.la-tour-play').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            const row = ev.currentTarget.closest('.la-tour-row');
            const fullKey = row?.dataset.fullKey;
            if (!fullKey)
                return;
            const tour = /** @type {any} */ (game.tours)?.get?.(fullKey);
            if (!tour)
                return;
            // Close the config window before starting the tour (matches Foundry's native Tour Manager UX).
            try
            {
                const appEl = ev.currentTarget.closest('.window-app');
                const appId = appEl?.dataset.appid;
                const app = appId ? ui.windows?.[appId] : null;
                if (app)
                    await app.close();
            }
            catch
            { /* ignore */ }
            try
            {
                await tour.start();
            }
            catch (e)
            {
                console.error('lancer-automations | failed to start tour', fullKey, e);
            }
        });

        $html.find('button[data-action-key]').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            const key = ev.currentTarget.dataset.actionKey;
            for (const tab of TAB_DEFS)
            {
                const matchedField = /** @type {any} */ (tab.fields.find((/** @type {any} */ field) => field.key === key));
                if (matchedField?.onClick)
                {
                    const formEl = ev.currentTarget.closest('form');
                    const formMap = _readFormSettings(formEl);
                    const restore = _patchSettingsGet(formMap);
                    try
                    {
                        await matchedField.onClick();
                    }
                    finally
                    {
                        restore();
                    }
                    return;
                }
            }
        });
        $html.find('.la-preview-btn').on('click', async (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await _previewSettingSound(ev.currentTarget.dataset.previewKey);
        });
        $html.find('h2.la-collapsible, h3.la-subsection-header.la-collapsible').each((/** @type {number} */ _i, /** @type {any} */ h) =>
        {
            const $h = $(h);
            const label = $h.text().trim();
            const collapsed = this._sectionStates.has(label)
                ? this._sectionStates.get(label)
                : $h.attr('data-collapsed') === 'true';
            _toggleSection($h, collapsed);
        }).on('click', (/** @type {any} */ ev) =>
        {
            const $h = $(ev.currentTarget);
            const next = $h.attr('data-collapsed') !== 'true';
            _toggleSection($h, next, true);
            this._sectionStates.set($h.text().trim(), next);
        });
        for (const tab of TAB_DEFS)
            _injectFCSLocks(html, tab.fields, this);
        // Delegated so the lock keeps working after the search filter rebuilds a label's HTML.
        $html.off('click.laFcsLock').on('click.laFcsLock', '.la-fcs-lock', async function ()
        {
            const fcsData = getFCSData();
            if (!fcsData)
                return;
            const isGM = game.user?.isGM;
            const $icon = $(this);
            const lockKey = $icon.attr('data-settings-key');
            if (!lockKey)
                return;
            await toggleFCSForce(lockKey, fcsData);
            let resolved = fcsData.forced.get(lockKey)?.mode ?? 'open';
            if ((resolved === 'soft' || isGM) && fcsData.unlocked.has(lockKey))
                resolved = 'unlocked';
            const newModeKey = resolved + (isGM ? '-gm' : '-client');
            const newIcon = _FCS_ICONS[newModeKey] ?? 'fa-lock-keyhole-open';
            $icon.attr('class', `fas ${newIcon} la-fcs-lock`);
            $icon.prop('title', game.i18n.localize(`FORCECLIENTSETTINGS.ui.${newModeKey}-hint`));
            const shortKey = lockKey.slice(MODULE_ID.length + 1);
            $html.find(`[name="${shortKey}"]`).prop('disabled', ['hard-client', 'soft-client'].includes(newModeKey));
            // drop the search cache for this label so a re-search re-stashes the new icon
            $icon.closest('label').removeData('la-orig');
        });

        const $searchBar = $html.find('.la-config-search');
        const $searchToggle = $html.find('.la-config-search-toggle');
        const $search = $html.find('.la-config-search-input');
        const $clear = $html.find('.la-config-search-clear');
        const escapeRe = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapeHtml = (/** @type {string} */ s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const stash = (/** @type {any} */ $el) =>
        {
            if ($el.data('la-orig') === undefined)
                $el.data('la-orig', $el.html());
        };
        const restore = (/** @type {any} */ $el) =>
        {
            const orig = $el.data('la-orig');
            if (orig !== undefined)
                $el.html(orig);
        };
        const MARK_OPEN = '<mark style="background:#f8d96b;color:#111;padding:0 1px;border-radius:2px;">';
        const MARK_CLOSE = '</mark>';
        const highlightIn = (/** @type {any} */ $el, /** @type {RegExp} */ re) =>
        {
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
            let textNode;
            while ((textNode = walker.nextNode()))
                textNodes.push(/** @type {Text} */ (textNode));
            for (const node of textNodes)
            {
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
        const applyFilter = (query) =>
        {
            const q = (query || '').trim().toLowerCase();
            $clear.css('display', q ? 'inline' : 'none');
            const re = q ? new RegExp(escapeRe(q), 'gi') : null;
            $html.find('.tab').each((/** @type {number} */ _i, /** @type {any} */ tab) =>
            {
                const $tab = $(tab);
                const groups = $tab.find('.form-group, h2.la-section, h3.la-subsection-header');
                if (!q)
                {
                    groups.css('display', '');
                    groups.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ el) => restore($(el)));
                    return;
                }
                let lastSection = null;
                let sectionHasMatch = false;
                let lastSub = null;
                let subHasMatch = false;
                const finalizeSub = () =>
                {
                    if (lastSub)
                        lastSub.css('display', subHasMatch ? '' : 'none');
                };
                const finalizeSection = () =>
                {
                    if (lastSection)
                        lastSection.css('display', sectionHasMatch ? '' : 'none');
                };
                groups.each((/** @type {number} */ _j, /** @type {any} */ el) =>
                {
                    const $el = $(el);
                    if ($el.is('h2.la-section'))
                    {
                        finalizeSub();
                        finalizeSection();
                        lastSection = $el;
                        sectionHasMatch = false;
                        lastSub = null;
                        subHasMatch = false;
                        return;
                    }
                    if ($el.is('h3.la-subsection-header'))
                    {
                        finalizeSub();
                        lastSub = $el;
                        subHasMatch = false;
                        return;
                    }
                    const text = ($el.text() || '').toLowerCase();
                    const name = ($el.find('[name]').attr('name') || '').toLowerCase();
                    const match = text.includes(q) || name.includes(q);
                    $el.css('display', match ? '' : 'none');
                    if (match)
                    {
                        sectionHasMatch = true;
                        subHasMatch = true;
                        $el.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ child) => highlightIn($(child), /** @type {RegExp} */ (re)));
                    }
                    else
                        $el.find('label, .notes').each((/** @type {number} */ _k, /** @type {any} */ child) => restore($(child)));
                });
                finalizeSub();
                finalizeSection();
            });
            if (q)
                $html.find('.tab').addClass('active').css('display', '');
            else
            {
                $html.find('.tab').removeClass('active');
                const activeId = $html.find('.tabs .item.active').data('tab')
                    || $html.find('.tab').first().data('tab');
                $html.find(`.tab[data-tab="${activeId}"]`).addClass('active');
            }
        };
        $search.on('input', (/** @type {any} */ ev) => applyFilter(ev.currentTarget.value));
        $clear.on('click', () =>
        {
            $search.val(''); applyFilter('');
        });

        const idleStyle    = { color: 'var(--primary-color)', 'border-color': 'var(--primary-color)', background: 'rgba(255,255,255,0.5)' };
        const hoverStyle   = { color: '#fff',                 'border-color': 'var(--primary-color)', background: 'var(--primary-color)' };
        const activeStyle  = { color: '#fff',                 'border-color': 'var(--primary-color)', background: 'var(--primary-color)' };
        const applyToggle = (style) =>
        {
            $searchToggle.css(style);
            $searchToggle.find('i').css('color', style.color);
        };
        applyToggle(idleStyle);
        $searchToggle.on('mouseenter', () => applyToggle(hoverStyle));
        $searchToggle.on('mouseleave', () =>
        {
            const open = $searchBar.css('display') !== 'none';
            applyToggle(open ? activeStyle : idleStyle);
        });
        $searchToggle.on('click', () =>
        {
            const open = $searchBar.css('display') !== 'none';
            if (open)
            {
                $searchBar.css('display', 'none');
                $search.val('');
                applyFilter('');
                applyToggle(idleStyle);
            }
            else
            {
                $searchBar.css('display', 'flex');
                applyToggle(activeStyle);
                setTimeout(() => $search.trigger('focus'), 10);
            }
        });
    }

    async _updateObject(_event, formData)
    {
        // non-GM submits skip world-scoped writes so player saves don't clobber GM values
        const isGM = !!game.user?.isGM;
        const _canWrite = (moduleId, key) =>
        {
            const setting = game.settings.settings.get(`${moduleId}.${key}`);
            if (!setting)
                return false;
            if (setting.scope === 'world')
                return isGM;
            return true;
        };

        for (const formKey of Object.keys(formData))
        {
            if (!formKey.startsWith('__ext.'))
                continue;
            const rest = formKey.slice('__ext.'.length);
            const dot = rest.indexOf('.');
            if (dot < 1)
                continue;
            const moduleId = rest.slice(0, dot);
            const settingKey = rest.slice(dot + 1);
            if (!game.modules.get(moduleId)?.active)
                continue;
            if (!_canWrite(moduleId, settingKey))
                continue;
            try
            {
                await game.settings.set(moduleId, settingKey, !!formData[formKey]);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save ${moduleId}.${settingKey}`, e);
            }
        }
        for (const tab of TAB_DEFS)
        {
            for (const fRaw of tab.fields)
            {
                const f = /** @type {any} */ (fRaw);
                if (f.type !== 'moduleBoolean')
                    continue;
                if (!game.modules.get(f.module)?.active)
                    continue;
                const formKey = `__ext.${f.module}.${f.key}`;
                if (formKey in formData)
                    continue;
                if (!_canWrite(f.module, f.key))
                    continue;
                try
                {
                    await game.settings.set(f.module, f.key, false);
                }
                catch (e)
                {
                    console.warn(`${MODULE_ID} | Could not save ${f.module}.${f.key}`, e);
                }
            }
        }


        const sfxSubs = new Set();
        for (const tab of TAB_DEFS)
        {
            for (const fRaw of tab.fields)
            {
                const f = /** @type {any} */ (fRaw);
                if (f.type === 'statusFx' && f.sub)
                    sfxSubs.add(f.sub);
                else if (f.type === 'compactStatusFx')
                {
                    for (const it of (f.items ?? []))
                    {
                        if (it?.sub)
                            sfxSubs.add(it.sub);
                    }
                }
            }
        }
        if (sfxSubs.size > 0 && _canWrite(MODULE_ID, 'statusFXConfig'))
        {
            try
            {
                const existing = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                /** @type {any} */
                const next = { ...existing };
                let changed = false;
                for (const sub of sfxSubs)
                {
                    const formKey = `_sfx.${sub}`;
                    const newVal = !!formData[formKey];
                    if (next[sub] !== newVal)
                    {
                        next[sub] = newVal;
                        changed = true;
                    }
                }
                if (changed)
                {
                    await game.settings.set(MODULE_ID, 'statusFXConfig', next);
                    const setting = game.settings.settings.get(`${MODULE_ID}.statusFXConfig`);
                    if (setting?.requiresReload)
                        this._needsReload = true;
                }
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save statusFXConfig`, e);
            }
        }

        // Unchecked checkboxes are absent from formData; treat as false.
        /** @type {any[]} */
        const allFields = [];
        for (const tab of TAB_DEFS)
        {
            for (const fRaw of tab.fields)
            {
                const f = /** @type {any} */ (fRaw);
                if (!f.key && f.type === 'table' && f.tableKeys)
                {
                    for (const tk of f.tableKeys)
                    {
                        const setting = game.settings.settings.get(`${MODULE_ID}.${tk}`);
                        allFields.push({ key: tk, type: setting?.type === Boolean ? 'boolean' : 'string' });
                    }
                }
                else if (f.type === 'compactBooleans')
                {
                    for (const it of (f.items ?? []))
                        allFields.push({ key: it.key, type: 'boolean' });
                }
                else if (f.type === 'compactStatusFx')
                    continue;
                else if (f.key && f.type !== 'section' && f.type !== 'button' && f.type !== 'statusFx')
                    allFields.push(f);
            }
        }
        for (const f of allFields)
        {
            if (!_canWrite(MODULE_ID, f.key))
                continue;
            if (!(f.key in formData))
            {
                if (f.type === 'boolean')
                {
                    try
                    {
                        await game.settings.set(MODULE_ID, f.key, false);
                    }
                    catch (e)
                    {
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
            try
            {
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`);
                const prev = game.settings.get(MODULE_ID, f.key);
                if (prev !== val && setting?.requiresReload)
                    this._needsReload = true;
                await game.settings.set(MODULE_ID, f.key, val);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
            }
        }
        ui.notifications.info('Lancer Automations configuration saved.');
    }

    async close(options)
    {
        try
        {
            const root = this.element?.[0];
            const activeNav = /** @type {any} */ (root?.querySelector('.tabs .item.active'));
            const scroller = root?.querySelector('.content .tab.active') ?? root?.querySelector('.content');
            const pos = /** @type {any} */ (this.position ?? {});
            _laConfigState = {
                tab: activeNav?.dataset?.tab ?? null,
                scroll: scroller?.scrollTop ?? 0,
                top: pos.top ?? null,
                left: pos.left ?? null,
                width: pos.width ?? null,
                height: pos.height ?? null,
            };
        }
        catch
        { /* ignore */ }
        const r = await super.close(options);
        if (this._needsReload)
        {
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

export function registerSettingsMenus()
{
    game.settings.registerMenu(MODULE_ID, 'lancerAutomationsConfigMenu', {
        name: 'Lancer Automations Configuration',
        label: 'Open Configuration',
        hint: 'Unified configuration window for all module settings.',
        icon: 'fas fa-sliders-h',
        type: LancerAutomationsConfig,
        restricted: false,
    });
}
