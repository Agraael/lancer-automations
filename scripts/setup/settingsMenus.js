/* global game, ui, canvas, FormApplication, foundry, jQuery, Dialog, $ */

import { ReactionReset } from '../activations/reaction-reset.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
import { setLAFlag } from '../tools/flag-utils.js';
import { ReactionExport, ReactionImport } from '../activations/reaction-export-import.js';
import { repairLCPData, syncAllActorImgs, syncAllTokenHeights } from './lancer-modif.js';
import { openNewsHistory } from './news.js';
import { openBattleLogGMCardTest, openBattleLogRecapTest } from '../Battelog/battlelog.js';
import { openTelemetryDebugWindow } from '../Battelog/telemetry-debug.js';
import { getFCSData, toggleFCSForce } from './fcs.js';
import { getFCCData, getFCCModeKey, toggleFCCForce } from './fcc.js';
import { runSettingsOnboarding } from './settings-onboarding.js';
import { resetPaletteColorSettings } from '../interactive/canvas-helpers.js';
import { importTemplateMacroPresets } from './tmac-presets.js';

import { MODULE_ID } from '../tools/constants.js';
import { STATUS_FX_KEYS } from '../fx/statusFX.js';
const TEMPLATE_PATH = `modules/${MODULE_ID}/templates/lancer-automations-config.html`;

// Per-action FX functions, as [action id, label key].
// Same list as the settings registered in tah/index.js.
const ACTION_FX_KEYS = [
    ['skirmish', 'LA.settingsMenus.tah.actionFxSound.skirmish.label'],
    ['eject', 'LA.settingsMenus.tah.actionFxSound.eject.label'],
    ['selfDestruct', 'LA.settingsMenus.tah.actionFxSound.selfDestruct.label'],
    ['teleport', 'LA.settingsMenus.tah.actionFxSound.teleport.label'],
    ['bootUp', 'LA.settingsMenus.tah.actionFxSound.bootUp.label'],
    ['dismount', 'LA.settingsMenus.tah.actionFxSound.dismount.label'],
    ['mount', 'LA.settingsMenus.tah.actionFxSound.mount.label'],
    ['disengage', 'LA.settingsMenus.tah.actionFxSound.disengage.label'],
    ['deployable', 'LA.settingsMenus.tah.actionFxSound.deployable.label'],
    ['freeAction', 'LA.settingsMenus.tah.actionFxSound.freeAction.label'],
    ['corePower', 'LA.settingsMenus.tah.actionFxSound.corePower.label'],
    ['protocol', 'LA.settingsMenus.tah.actionFxSound.protocol.label'],
    ['activation', 'LA.settingsMenus.tah.actionFxSound.activation.label'],
    ['reaction', 'LA.settingsMenus.tah.actionFxSound.reaction.label'],
    ['fullAction', 'LA.settingsMenus.tah.actionFxSound.fullAction.label'],
    ['quickAction', 'LA.settingsMenus.tah.actionFxSound.quickAction.label'],
    ['standingUp', 'LA.settingsMenus.tah.actionFxSound.standingUp.label'],
    ['prepare', 'LA.settingsMenus.tah.actionFxSound.prepare.label'],
    ['interact', 'LA.settingsMenus.tah.actionFxSound.interact.label'],
    ['handle', 'LA.settingsMenus.tah.actionFxSound.handle.label'],
    ['fullTech', 'LA.settingsMenus.tah.actionFxSound.fullTech.label'],
    ['quickTech', 'LA.settingsMenus.tah.actionFxSound.quickTech.label'],
    ['invade', 'LA.settingsMenus.tah.actionFxSound.invade.label'],
    ['grapple', 'LA.settingsMenus.tah.actionFxSound.grapple.label'],
    ['ram', 'LA.settingsMenus.tah.actionFxSound.ram.label'],
    ['jockey', 'LA.settingsMenus.tah.actionFxSound.jockey.label'],
    ['barrage', 'LA.settingsMenus.tah.actionFxSound.barrage.label'],
    ['boost', 'LA.settingsMenus.tah.actionFxSound.boost.label'],
    ['overchargeNpc', 'LA.settingsMenus.tah.actionFxSound.overchargeNpc.label'],
    ['hide', 'LA.settingsMenus.tah.actionFxSound.hide.label'],
    ['shutDown', 'LA.settingsMenus.tah.actionFxSound.shutDown.label'],
    ['fall', 'LA.settingsMenus.tah.actionFxSound.fall.label'],
    ['fallImpact', 'LA.settingsMenus.tah.actionFxSound.fallImpact.label'],
    ['search', 'LA.settingsMenus.tah.actionFxSound.search.label'],
    ['scan', 'LA.settingsMenus.tah.actionFxSound.scan.label'],
    ['targetSuccess', 'LA.settingsMenus.tah.actionFxSound.targetSuccess.label'],
    ['defaultThrow', 'LA.settingsMenus.tah.actionFxSound.defaultThrow.label'],
    ['targetFail', 'LA.settingsMenus.tah.actionFxSound.targetFail.label'],
    ['reload', 'LA.settingsMenus.tah.actionFxSound.reload.label'],
    ['fight', 'LA.settingsMenus.tah.actionFxSound.fight.label'],
    ['mineDetonation', 'LA.settingsMenus.tah.actionFxSound.mineDetonation.label'],
    ['profile', 'LA.settingsMenus.tah.actionFxSound.profile.label'],
    ['mod', 'LA.settingsMenus.tah.actionFxSound.mod.label'],
    ['attack', 'LA.settingsMenus.tah.actionFxSound.attack.label'],
    ['damage', 'LA.settingsMenus.tah.actionFxSound.damage.label'],
    ['hase', 'LA.settingsMenus.tah.actionFxSound.hase.label'],
    ['skill', 'LA.settingsMenus.tah.actionFxSound.skill.label'],
];

const FOCUS_ACTION_CATEGORIES = [
    { key: 'activation', label: 'LA.settingsMenus.focusCategory.activation' },
    { key: 'attack', label: 'LA.settingsMenus.focusCategory.attack' },
    { key: 'damage', label: 'LA.settingsMenus.focusCategory.damage' },
    { key: 'hase', label: 'LA.settingsMenus.focusCategory.hase' },
    { key: 'skill', label: 'LA.settingsMenus.focusCategory.skill' },
    { key: 'profile', label: 'LA.settingsMenus.focusCategory.profile' },
    { key: 'mod', label: 'LA.settingsMenus.focusCategory.mod' },
    { key: 'tech', label: 'LA.settingsMenus.focusCategory.tech' },
];

const ACTIVATIONS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.activationManager.label' },
    { key: 'reactionNotificationMode', type: 'select', label: 'LA.settingsMenus.reactionNotificationMode.label' },
    { key: 'consumeReaction', type: 'boolean' },
    { key: 'consumeAction', type: 'boolean' },
    { key: 'treatGenericPrintAsActivation', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.scan.label' },
    { key: 'scanJournalSource', type: 'select', label: 'LA.settingsMenus.scanJournalSource.label', hint: 'LA.settingsMenus.scanJournalSource.hint' },
    { key: 'scanPlayerOwnershipMode', type: 'select', label: 'LA.settingsMenus.scanPlayerOwnershipMode.label', hint: 'LA.settingsMenus.scanPlayerOwnershipMode.hint' },
    { type: 'section', label: 'LA.settingsMenus.section.countAsScanned.label', hint: 'LA.settingsMenus.section.countAsScanned.hint', collapsible: false, subsection: true },
    { type: 'compactBooleans',
        items: [
            { key: 'revealStatsWithoutScan', label: 'LA.settingsMenus.revealStatsWithoutScan.label', hint: 'LA.settingsMenus.revealStatsWithoutScan.hint' },
            { key: 'scanRevealAllies', label: 'LA.settingsMenus.scanRevealAllies.label', hint: 'LA.settingsMenus.scanRevealAllies.hint' },
            { key: 'scanRevealPlayers', label: 'LA.settingsMenus.scanRevealPlayers.label', hint: 'LA.settingsMenus.scanRevealPlayers.hint' },
        ]
    },
    { type: 'button',
        key: 'regenerateScans',
        label: 'LA.settingsMenus.regenerateScans.label',
        icon: 'fas fa-book',
        hint: 'LA.settingsMenus.regenerateScans.hint',
        onClick: async () =>
        {
            const api = /** @type {any} */ (game.modules.get(MODULE_ID))?.api;
            await api?.regenerateScans?.();
        },
    },
];

const COMBAT_MOVEMENT_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.targeting.label', collapsible: true },
    { key: 'enableAttackTargeting', type: 'boolean' },
    { key: 'autoStartTargetPicking', type: 'boolean' , requires: 'enableAttackTargeting' },
    { key: 'enableDamageTargeting', type: 'boolean' },
    { key: 'statRollTargeting', type: 'boolean' },
    { key: 'haseChanceLabels', type: 'boolean', label: 'LA.settingsMenus.haseChanceLabels.label', hint: 'LA.settingsMenus.haseChanceLabels.hint' },
    { key: 'clearTargetsAfterRoll', type: 'boolean', requires: ['enableAttackTargeting', 'enableDamageTargeting'] },
    { key: 'targetInfoDisplay', type: 'select', requires: ['enableAttackTargeting', 'enableDamageTargeting'] },
    { key: 'tah.rangePreviewOnAttackCard', type: 'boolean', label: 'LA.settingsMenus.tah.rangePreviewOnAttackCard.label' },
    { key: 'displayToolsToOthers', type: 'boolean', label: 'LA.settingsMenus.displayToolsToOthers.label' },

    { type: 'section', label: 'LA.settingsMenus.section.attacks.label', collapsible: true, collapsed: true },
    { key: 'enableKnockbackFlow', type: 'boolean' },
    { key: 'enableThrowFlow', type: 'boolean' },
    { key: 'autoDamageRoll', type: 'boolean' },
    { key: 'autoDamageApply', type: 'boolean' },
    { key: 'autoStructFollowup', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.rollUplink.label', collapsible: true, collapsed: true },
    { key: 'uplinkEnabled', type: 'boolean' },
    { key: 'uplinkAutoOpen', type: 'boolean', requires: 'uplinkEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.movementBoost.label', collapsible: true, collapsed: true },
    { key: 'enableMovementCapDetection', type: 'boolean' },
    { key: 'enableBoostOffer', type: 'select' },
    { key: 'count3DDistance', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.structureDamage.label', collapsible: true, collapsed: true },
    { key: 'enableAltStruct', type: 'boolean' },
    { key: 'enableOneStructNpc', type: 'boolean' },
    { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    { key: 'convertHeatToEnergyOnHeatless', type: 'boolean' },
    { key: 'resistSelfHeat', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.turnsActions.label', collapsible: true, collapsed: true },
    { key: 'enablePerRoundTurnTags', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.lancerAutomationsRuler.label', collapsible: true, collapsed: true },
    { key: 'enableBuiltinSpeedProvider', type: 'boolean', label: 'LA.settingsMenus.enableBuiltinSpeedProvider.label', hint: 'LA.settingsMenus.enableBuiltinSpeedProvider.hint' },
    { key: 'rulerPerStepRender', type: 'boolean', label: 'LA.settingsMenus.rulerPerStepRender.label', hint: 'LA.settingsMenus.rulerPerStepRender.hint' , requires: 'enableBuiltinSpeedProvider' },
    { key: 'enableClimbWaypoints', type: 'boolean', label: 'LA.settingsMenus.enableClimbWaypoints.label', hint: 'LA.settingsMenus.enableClimbWaypoints.hint' , requires: 'enableBuiltinSpeedProvider' },
    { key: 'splitMovementAtTriggerBoundaries', type: 'boolean', label: 'LA.settingsMenus.splitMovementAtTriggerBoundaries.label', hint: 'LA.settingsMenus.splitMovementAtTriggerBoundaries.hint' },
    { key: 'splitMovementAtSpeedTiers', type: 'boolean', label: 'LA.settingsMenus.splitMovementAtSpeedTiers.label', hint: 'LA.settingsMenus.splitMovementAtSpeedTiers.hint' },
    { key: 'pathfindDragMovement', type: 'boolean', label: 'LA.settingsMenus.pathfindDragMovement.label', hint: 'LA.settingsMenus.pathfindDragMovement.hint', requires: ['enableBuiltinSpeedProvider', 'rulerPerStepRender'], requiresAll: true },
    { key: 'enableObstructionStepOver', type: 'boolean', label: 'LA.settingsMenus.enableObstructionStepOver.label', hint: 'LA.settingsMenus.enableObstructionStepOver.hint', requires: 'enableBuiltinSpeedProvider' },
    { type: 'section', label: 'LA.settingsMenus.section.noStepOver.label', hint: 'LA.settingsMenus.section.noStepOver.hint', collapsible: false, subsection: true },
    { type: 'compactBooleans',
        items: [
            { key: 'obstructionBlocksVehicle', label: 'LA.settingsMenus.obstructionBlocksVehicle.label' },
            { key: 'obstructionBlocksSquad', label: 'LA.settingsMenus.obstructionBlocksSquad.label' },
            { key: 'obstructionBlocksHuman', label: 'LA.settingsMenus.obstructionBlocksHuman.label' },
            { key: 'obstructionBlocksSpecialist', label: 'LA.settingsMenus.obstructionBlocksSpecialist.label' }
        ]
    },
    { key: 'disableAutoTerrainElevation', type: 'boolean', label: 'LA.settingsMenus.disableAutoTerrainElevation.label', hint: 'LA.settingsMenus.disableAutoTerrainElevation.hint' },
    { key: 'disableAutoElevationOnMeasure', type: 'boolean', label: 'LA.settingsMenus.disableAutoElevationOnMeasure.label', hint: 'LA.settingsMenus.disableAutoElevationOnMeasure.hint' , requires: 'enableBuiltinSpeedProvider' },

    { type: 'section', label: 'LA.settingsMenus.section.tacticalDistanceLabels.label', collapsible: true, collapsed: true },
    { key: 'enableTacticalDistance', type: 'select', label: 'LA.settingsMenus.enableTacticalDistance.label', hint: 'LA.settingsMenus.enableTacticalDistance.hint' },
    { key: 'tacticalLabelPosition', type: 'select', label: 'LA.settingsMenus.tacticalLabelPosition.label' },
    { key: 'tacticalMinZoomScale', type: 'slider', label: 'LA.settingsMenus.tacticalMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.tacticalMinZoomScale.hint' },
    { key: 'tacticalElevationStep', type: 'number', label: 'LA.settingsMenus.tacticalElevationStep.label', hint: 'LA.settingsMenus.tacticalElevationStep.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.advancedMeasure.label', collapsible: true, collapsed: true },
    { key: 'ctrlRulerMode', type: 'select', label: 'LA.settingsMenus.ctrlRulerMode.label', hint: 'LA.settingsMenus.ctrlRulerMode.hint' },
    { key: 'advMeasureScale', type: 'slider', label: 'LA.settingsMenus.advMeasureScale.label', min: 0.6, max: 1.6, step: 0.05 },
    { key: 'rulerToolCursor', type: 'boolean', label: 'LA.settingsMenus.rulerToolCursor.label', hint: 'LA.settingsMenus.rulerToolCursor.hint' },
    { key: 'targetToolCursor', type: 'boolean', label: 'LA.settingsMenus.targetToolCursor.label', hint: 'LA.settingsMenus.targetToolCursor.hint' },
];

const WRECKS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.wreckGeneration.label' },
    { key: 'enableWrecks', type: 'boolean' },
    { key: 'enableRemoveFromCombat', type: 'boolean' , requires: 'enableWrecks' },
    { key: 'squadLostOnDeath', type: 'boolean' , requires: 'enableWrecks' },
    { key: 'wreckAuraColor', type: 'color', requires: 'enableWrecks' },
    { key: 'wreckAuraOpacity', type: 'slider', min: 0, max: 1, step: 0.05, requires: 'enableWrecks' },

    { type: 'section', label: 'LA.settingsMenus.section.perCategoryWrecks.label', collapsible: true, collapsed: true },
    { key: 'wreckTerrainType',
        type: 'select',
        label: 'LA.settingsMenus.wreckTerrainType.label',
        getChoices: () =>
        {
            const current = getModuleSetting('wreckTerrainType') || '';
            const choices = [{ value: '', label: 'LA.settingsMenus.choice.blank.label', selected: current === '' }];
            try
            {
                const types = globalThis.terrainHeightTools?.getTerrainTypes?.() || [];
                for (const terrainType of types)
                    choices.push({ value: terrainType.id, label: terrainType.name || terrainType.id, selected: terrainType.id === current });
            }
            catch
            { /* ignore */ }
            return choices;
        },
        requires: 'enableWrecks' },
    { type: 'table',
        label: 'LA.settingsMenus.table.perCategorySettings.label',
        tableKeys: ['wreckMode_mech', 'wreckTerrain_mech', 'wreckMode_vehicle', 'wreckTerrain_vehicle', 'wreckMode_human', 'wreckTerrain_human',
            'wreckMode_monstrosity', 'wreckTerrain_monstrosity', 'wreckMode_biological', 'wreckTerrain_biological'],
        getTable: () =>
        {
            const modeChoices = (key) =>
            {
                const cur = getModuleSetting(key);
                return [
                    { value: 'token', label: 'LA.settingsMenus.choice.token.label', selected: cur === 'token' },
                    { value: 'tile', label: 'LA.settingsMenus.choice.tile.label', selected: cur === 'tile' },
                    { value: 'none', label: 'LA.settingsMenus.choice.none.label', selected: cur === 'none' },
                ];
            };
            const terrainChoices = (key) =>
            {
                let cur = getModuleSetting(key);
                if (cur === true)
                    cur = 'terrain';
                else if (cur === false)
                    cur = 'none';
                else if (cur !== 'terrain' && cur !== 'aura' && cur !== 'none')
                    cur = 'none';
                return [
                    { value: 'none', label: 'LA.settingsMenus.choice.none2.label', selected: cur === 'none' },
                    { value: 'terrain', label: 'LA.settingsMenus.choice.terrain.label', selected: cur === 'terrain' },
                    { value: 'aura', label: 'LA.settingsMenus.choice.aura.label', selected: cur === 'aura' },
                ];
            };
            return {
                columns: ['LA.settingsMenus.tableColumn.category', 'LA.settingsMenus.tableColumn.mode', 'LA.settingsMenus.tableColumn.onWreck'],
                rows: [
                    { label: 'LA.settingsMenus.tableRow.mech.label',
                        cells: [
                            { isSelect: true, name: 'wreckMode_mech', choices: modeChoices('wreckMode_mech') },
                            { isSelect: true, name: 'wreckTerrain_mech', choices: terrainChoices('wreckTerrain_mech') },
                        ]},
                    { label: 'LA.settingsMenus.tableRow.vehicle.label',
                        cells: [
                            { isSelect: true, name: 'wreckMode_vehicle', choices: modeChoices('wreckMode_vehicle') },
                            { isSelect: true, name: 'wreckTerrain_vehicle', choices: terrainChoices('wreckTerrain_vehicle') },
                        ]},
                    { label: 'LA.settingsMenus.tableRow.humanPilotSquad.label',
                        cells: [
                            { isSelect: true, name: 'wreckMode_human', choices: modeChoices('wreckMode_human') },
                            { isSelect: true, name: 'wreckTerrain_human', choices: terrainChoices('wreckTerrain_human') },
                        ]},
                    { label: 'LA.settingsMenus.tableRow.monstrosity.label',
                        cells: [
                            { isSelect: true, name: 'wreckMode_monstrosity', choices: modeChoices('wreckMode_monstrosity') },
                            { isSelect: true, name: 'wreckTerrain_monstrosity', choices: terrainChoices('wreckTerrain_monstrosity') },
                        ]},
                    { label: 'LA.settingsMenus.tableRow.biological.label',
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
        label: 'LA.settingsMenus.wreckFactionOnDeath.label',
        getChoices: () =>
        {
            const cur = getModuleSetting('wreckFactionOnDeath') || 'same';
            const choices = [
                { value: 'same', label: 'LA.settingsMenus.choice.same.label', selected: cur === 'same' },
                { value: 'neutral', label: 'LA.settingsMenus.choice.neutral.label', selected: cur === 'neutral' },
            ];
            const teams = game.settings.settings.has('token-factions.team-setup')
                ? (game.settings.get('token-factions', 'team-setup') || [])
                : [];
            for (const team of teams)
                choices.push({ value: team.id, label: team.name, selected: team.id === cur });
            return choices;
        },
        requires: 'enableWrecks' },

    { type: 'section', label: 'LA.settingsMenus.section.assetsAudio.label', collapsible: true, collapsed: true },
    { key: 'wreckAssetsPath', type: 'folder', label: 'LA.settingsMenus.wreckAssetsPath.label' , requires: 'enableWrecks' },
    { key: 'enableWreckAnimation', type: 'boolean' , requires: 'enableWrecks' },
    { key: 'enableWreckAudio', type: 'boolean' , requires: 'enableWrecks' },
    { key: 'disableHumanDeathSound', type: 'boolean' , requires: 'enableWrecks' },
];

/** @param {string} key */
function _statBarVisChoices(key)
{
    const cur = getModuleSetting(key, 'all');
    return [
        { value: 'all',     label: 'LA.settingsMenus.choice.all.label',     selected: cur === 'all' },
        { value: 'owner',   label: 'LA.settingsMenus.choice.owner.label',   selected: cur === 'owner' },
        { value: 'scanned', label: 'LA.settingsMenus.choice.scanned.label', selected: cur === 'scanned' },
        { value: 'none',    label: 'LA.settingsMenus.choice.none3.label',   selected: cur === 'none' },
    ];
}

const TOKENS_DISPLAY_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.tokenDisplay.label' },
    { key: 'linkManualDeploy', type: 'boolean' },
    { key: 'showDeployableLines', type: 'boolean' },
    { type: 'section', label: 'LA.settingsMenus.section.groundShadow.label', hint: 'LA.settingsMenus.section.groundShadow.hint', subsection: true },
    { key: 'tokenGroundShadow', type: 'boolean' },
    { key: 'tokenGroundShadowThrow', type: 'slider', requires: 'tokenGroundShadow' },
    { key: 'tokenGroundShadowOpacity', type: 'slider', requires: 'tokenGroundShadow' },
    { key: 'allowHalfSizeTokens', type: 'boolean' },
    { key: 'overlapTokenPicker', type: 'boolean' },
    { type: 'button',
        key: 'toggleLancerFloatingNumbers',
        label: 'LA.settingsMenus.toggleLancerFloatingNumbers.label',
        hint: 'LA.settingsMenus.toggleLancerFloatingNumbers.hint',
        icon: 'fas fa-arrows-alt-v',
        clientAllowed: true,
        state: () => (game.settings.get('lancer', 'floatingNumbers') ? 'On' : 'Off'),
        onClick: async () =>
        {
            const before = !!game.settings.get('lancer', 'floatingNumbers');
            await game.settings.set('lancer', 'floatingNumbers', !before);
            ui.notifications?.info(localizeFormat('LA.notify.floatingNumbers', { state: localize(!before ? 'LA.common.on' : 'LA.common.off') }));
        },
    },

    { type: 'section', label: 'LA.settingsMenus.section.autoFocus.label', collapsible: true, collapsed: true },
    { key: 'autoFocusDuration', type: 'slider', min: 200, max: 3000, step: 100 },
    { key: 'autoFocusCards', type: 'boolean' },
    { key: 'autoFocusAttack', type: 'boolean' },
    { key: 'autoFocusDamage', type: 'boolean' },
    { key: 'autoFocusCheck', type: 'boolean' },
    { key: 'autoFocusActivation', type: 'boolean' },
    { type: 'section', label: 'LA.settingsMenus.section.focusedActions.label', collapsible: true, collapsed: true, subsection: true },
    { type: 'compactBooleans', items: FOCUS_ACTION_CATEGORIES.map((category) => ({ key: `autoFocusAction.${category.key}`, label: category.label })) },

    { type: 'section', label: 'LA.settingsMenus.section.tokenHudButtons.label', collapsible: true, collapsed: true },
    { key: 'showBonusHudButton', type: 'boolean' },
    { key: 'showStatusEffectsHudButton', type: 'boolean' },
    { key: 'showCombatStateHudButton', type: 'boolean' },
    { key: 'showTargetStateHudButton', type: 'boolean' },
    { key: 'showRevertMovementHudButton', type: 'boolean' },
    { type: 'moduleBoolean', module: 'temporary-custom-statuses', key: 'enableHud', label: 'LA.settingsMenus.enableHud.label' },

    { type: 'section', label: 'LA.settingsMenus.section.statusIcons.label', collapsible: true, collapsed: true },
    { key: 'statusHalo', type: 'boolean' },
    { key: 'statusHaloRadius', type: 'slider', min: 0.5, max: 2, step: 0.05 },
    { key: 'statusHaloStartAngle', type: 'slider', min: 0, max: 360, step: 5 },
    { key: 'statBarEffectIconScale', type: 'slider', label: 'LA.settingsMenus.statBarEffectIconScale.label', min: 0.3, max: 2, step: 0.05 },
    { key: 'statusIconMinZoomScale', type: 'slider', label: 'LA.settingsMenus.statusIconMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.statusIconMinZoomScale.hint' },
    { key: 'statusIconHover', type: 'boolean' },
    { key: 'statusCounterColor', type: 'color' },
    { key: 'statusUsageColor', type: 'color' },
    { key: 'statusDurationColor', type: 'color' },
    { key: 'statusBadgeFontScale', type: 'slider', min: 0.5, max: 2, step: 0.05 },

    { type: 'section', label: 'LA.settingsMenus.section.customTokenStatBars.label', collapsible: true, collapsed: true },
    { key: 'tokenStatBar', type: 'boolean', label: 'LA.settingsMenus.tokenStatBar.label', hint: 'LA.settingsMenus.tokenStatBar.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.display.label', subsection: true },
    { key: 'statBarShowValues', type: 'boolean', label: 'LA.settingsMenus.statBarShowValues.label', hint: 'LA.settingsMenus.statBarShowValues.hint' , requires: 'tokenStatBar' },
    { key: 'statBarMinZoomScale', type: 'slider', label: 'LA.settingsMenus.statBarMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.statBarMinZoomScale.hint' , requires: 'tokenStatBar' },

    { type: 'section', label: 'LA.settingsMenus.section.perTokenDefaults.label', subsection: true },
    { key: 'statBarDefaultHidden', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultHidden.label' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultCombatOnly', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultCombatOnly.label' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultRowHeight', type: 'number', label: 'LA.settingsMenus.statBarDefaultRowHeight.label', hint: 'LA.settingsMenus.statBarDefaultRowHeight.hint' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultPilotStress', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultPilotStress.label', hint: 'LA.settingsMenus.statBarDefaultPilotStress.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.visibility.label', subsection: true },
    { key: 'statBarVisibilityOutOfCombat', type: 'select', label: 'LA.settingsMenus.statBarVisibilityOutOfCombat.label', getChoices: () => _statBarVisChoices('statBarVisibilityOutOfCombat') , requires: 'tokenStatBar' },
    { key: 'statBarVisibilityInCombat',   type: 'select', label: 'LA.settingsMenus.statBarVisibilityInCombat.label',   getChoices: () => _statBarVisChoices('statBarVisibilityInCombat') , requires: 'tokenStatBar' },

    { type: 'section', label: 'LA.settingsMenus.section.autoInjectedBars.label', subsection: true },
    { key: 'statBarAutoInjectTalents', type: 'boolean', label: 'LA.settingsMenus.statBarAutoInjectTalents.label', hint: 'LA.settingsMenus.statBarAutoInjectTalents.hint' , requires: 'tokenStatBar' },
    { key: 'statBarAutoInjectTalentColor', type: 'color', label: 'LA.settingsMenus.statBarAutoInjectTalentColor.label', hint: 'LA.settingsMenus.statBarAutoInjectTalentColor.hint' , requires: ['tokenStatBar', 'statBarAutoInjectTalents'], requiresAll: true },
    { key: 'statBarAutoInjectTalentWidthPct', type: 'number', label: 'LA.settingsMenus.statBarAutoInjectTalentWidthPct.label', min: 1, max: 100, step: 1, hint: 'LA.settingsMenus.statBarAutoInjectTalentWidthPct.hint' , requires: ['tokenStatBar', 'statBarAutoInjectTalents'], requiresAll: true },
    { key: 'statBarAutoInjectTalentFeedback', type: 'boolean', label: 'LA.settingsMenus.statBarAutoInjectTalentFeedback.label', hint: 'LA.settingsMenus.statBarAutoInjectTalentFeedback.hint' , requires: ['tokenStatBar', 'statBarAutoInjectTalents'], requiresAll: true },
    { key: 'statBarAutoInjectCustomFlags', type: 'boolean', label: 'LA.settingsMenus.statBarAutoInjectCustomFlags.label', hint: 'LA.settingsMenus.statBarAutoInjectCustomFlags.hint' , requires: 'tokenStatBar' },
    { key: 'statBarAutoInjectBondXp', type: 'boolean', label: 'LA.settingsMenus.statBarAutoInjectBondXp.label', hint: 'LA.settingsMenus.statBarAutoInjectBondXp.hint' , requires: 'tokenStatBar' },
    { type: 'button',
        key: 'statBarReinjectAllAutoBars',
        label: 'LA.settingsMenus.statBarReinjectAllAutoBars.label',
        icon: 'fas fa-sync',
        hint: 'LA.settingsMenus.statBarReinjectAllAutoBars.hint',
        onClick: async () =>
        {
            const mod = await import('../tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).reinjectAutoBarsOnAllTokens;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn(localize('LA.notify.reinjectautobarsonalltokensIsNotExported'));
        },
    },

    { type: 'section', label: 'LA.settingsMenus.section.sceneActions.label', subsection: true },
    { type: 'button',
        key: 'statBarApplyDefaults',
        label: 'LA.settingsMenus.statBarApplyDefaults.label',
        icon: 'fas fa-clone',
        hint: 'LA.settingsMenus.statBarApplyDefaults.hint',
        onClick: async () =>
        {
            const mod = await import('../tah/tokenStatBar.js');
            const fn = /** @type {any} */ (mod).applyDefaultsToCurrentScene;
            if (typeof fn === 'function')
                await fn();
            else
                ui.notifications.warn(localize('LA.notify.applydefaultstocurrentsceneIsNotExported'));
        },
    },

    { type: 'section', label: 'LA.settingsMenus.section.tokenStatHint.label', collapsible: true, collapsed: true },
    { key: 'tokenStatHintEnabled', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintEnabled.label', hint: 'LA.settingsMenus.tokenStatHintEnabled.hint' },
    { key: 'tokenStatHintDelayMs', type: 'slider', label: 'LA.settingsMenus.tokenStatHintDelayMs.label', min: 0, max: 2000, step: 50, hint: 'LA.settingsMenus.tokenStatHintDelayMs.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintScale', type: 'slider', label: 'LA.settingsMenus.tokenStatHintScale.label', min: 0.5, max: 2, step: 0.05, hint: 'LA.settingsMenus.tokenStatHintScale.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintShowForControlled', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintShowForControlled.label', hint: 'LA.settingsMenus.tokenStatHintShowForControlled.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintCombatOnly', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintCombatOnly.label', hint: 'LA.settingsMenus.tokenStatHintCombatOnly.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintLabelMode',
        type: 'select',
        label: 'LA.settingsMenus.tokenStatHintLabelMode.label',
        choices: [
            { value: 'actor', label: 'LA.settingsMenus.choice.actor.label' },
            { value: 'scan', label: 'LA.settingsMenus.choice.scan.label' },
        ],
        hint: 'LA.settingsMenus.tokenStatHintLabelMode.hint',
        requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintUnknownLabel', type: 'string', label: 'LA.settingsMenus.tokenStatHintUnknownLabel.label', hint: 'LA.settingsMenus.tokenStatHintUnknownLabel.hint' },
    { key: 'tokenStatHintHideClassWhenUnknown', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintHideClassWhenUnknown.label', hint: 'LA.settingsMenus.tokenStatHintHideClassWhenUnknown.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintHideCurrentOnScan', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintHideCurrentOnScan.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentOnScan.hint' , requires: 'tokenStatHintEnabled' },
    { type: 'section', label: 'LA.settingsMenus.section.alsoHideCurrentValuesFrom.label', hint: 'LA.settingsMenus.section.alsoHideCurrentValuesFrom.hint', collapsible: false, subsection: true },
    { type: 'compactBooleans',
        items: [
            { key: 'tokenStatHintHideCurrentFromAllies', label: 'LA.settingsMenus.tokenStatHintHideCurrentFromAllies.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentFromAllies.hint', requires: ['tokenStatHintEnabled', 'tokenStatHintHideCurrentOnScan'], requiresAll: true },
            { key: 'tokenStatHintHideCurrentFromPlayers', label: 'LA.settingsMenus.tokenStatHintHideCurrentFromPlayers.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentFromPlayers.hint', requires: ['tokenStatHintEnabled', 'tokenStatHintHideCurrentOnScan'], requiresAll: true },
        ]
    },
    { key: 'tokenStatHintShowHase', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintShowHase.label', hint: 'LA.settingsMenus.tokenStatHintShowHase.hint', requires: 'tokenStatHintEnabled' },
];

const TAH_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.general.label', collapsible: true },
    { key: 'tahEnabled', type: 'boolean', label: 'LA.settingsMenus.tahEnabled.label' },
    { key: 'tah.narrativeMode', type: 'boolean', label: 'LA.settingsMenus.tah.narrativeMode.label', hint: 'LA.settingsMenus.tah.narrativeMode.hint' , requires: 'tahEnabled' },
    { key: 'tah.aboveActorSheets', type: 'boolean' , requires: 'tahEnabled' },
    { key: 'tah.showDisposition', type: 'boolean', label: 'LA.settingsMenus.tah.showDisposition.label', hint: 'LA.settingsMenus.tah.showDisposition.hint' , requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.tahPortrait.label', collapsible: true, collapsed: true },
    { key: 'tah.portrait.mode', type: 'select', label: 'LA.settingsMenus.tah.portrait.mode.label', hint: 'LA.settingsMenus.tah.portrait.mode.hint', requires: 'tahEnabled' },
    { key: 'tah.portrait.scope', type: 'select', label: 'LA.settingsMenus.tah.portrait.scope.label', hint: 'LA.settingsMenus.tah.portrait.scope.hint', requires: 'tahEnabled' },
    { key: 'tah.portrait.mechUsePilot', type: 'boolean', label: 'LA.settingsMenus.tah.portrait.mechUsePilot.label', hint: 'LA.settingsMenus.tah.portrait.mechUsePilot.hint', requires: 'tahEnabled' },
    { key: 'tah.portrait.scale', type: 'slider', label: 'LA.settingsMenus.tah.portrait.scale.label', hint: 'LA.settingsMenus.tah.portrait.scale.hint', min: 0.5, max: 2.5, step: 0.05, requires: 'tahEnabled' },
    { key: 'tah.portrait.trim', type: 'boolean', label: 'LA.settingsMenus.tah.portrait.trim.label', hint: 'LA.settingsMenus.tah.portrait.trim.hint', requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.openingLayout.label', collapsible: true, collapsed: true },
    { key: 'tah.clickToOpen', type: 'boolean' , requires: 'tahEnabled' },
    { key: 'tah.hoverCloseDelay', type: 'number' , requires: 'tahEnabled' },
    { key: 'tah.maxColumnItems', type: 'number' , requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.radialWheels.label', collapsible: true, collapsed: true },
    { key: 'tah.wheelRadiusOffset', type: 'slider', label: 'LA.settingsMenus.tah.wheelRadiusOffset.label', min: -40, max: 120, step: 5, requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.keyboard.label', collapsible: true, collapsed: true },
    { key: 'tah.keyboardNav', type: 'boolean' , requires: 'tahEnabled' },
    { key: 'tah.keyboardNavResetDelay', type: 'number' , requires: ['tahEnabled', 'tah.keyboardNav'], requiresAll: true },
    { key: 'tah.preventWasdMovement', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.rangesDisplay.label', collapsible: true, collapsed: true },
    { key: 'tah.uiScale', type: 'slider', label: 'LA.settingsMenus.tah.uiScale.label', min: 0.6, max: 1.6, step: 0.05 , requires: 'tahEnabled' },
    { key: 'tah.rangePreview', type: 'boolean' , requires: 'tahEnabled' },
    { key: 'tah.areaElevationAware', type: 'boolean', label: 'LA.settingsMenus.tah.areaElevationAware.label', hint: 'LA.settingsMenus.tah.areaElevationAware.hint' },
    { key: 'tah.showAidHandleInteractSqueeze', type: 'boolean' , requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.maintenance.label', collapsible: true, collapsed: true },
    { key: 'tah.resetPosition',
        type: 'button',
        label: 'LA.settingsMenus.tah.resetPosition.label',
        icon: 'fas fa-undo',
        hint: 'LA.settingsMenus.tah.resetPosition.hint',
        clientAllowed: true,
        onClick: async () =>
        {
            await game.settings.set(MODULE_ID, 'tah.position', null);
            ui.notifications.info(localize('LA.notify.tahPositionResetToDefaultReSelect'));
        } },
    { key: 'tah.clearMacros',
        type: 'button',
        label: 'LA.settingsMenus.tah.clearMacros.label',
        icon: 'fas fa-trash',
        hint: 'LA.settingsMenus.tah.clearMacros.hint',
        clientAllowed: true,
        onClick: async () =>
        {
            const confirmed = await Dialog.confirm({
                title: localize('LA.dialogTitle.clearTahMacros'),
                content: localize('LA.settingsMenus.content.removeEveryMacroFromTheTah'),
            });
            if (!confirmed)
                return;
            await game.settings.set(MODULE_ID, 'tah.macroList', []);
            Hooks.callAll('forceUpdateTokenActionHud');
            ui.notifications.info(localize('LA.notify.tahMacrosCleared'));
        } },
    { key: 'tah.clearFavorites',
        type: 'button',
        label: 'LA.settingsMenus.tah.clearFavorites.label',
        icon: 'fas fa-star',
        hint: 'LA.settingsMenus.tah.clearFavorites.hint',
        clientAllowed: true,
        onClick: async () =>
        {
            const confirmed = await Dialog.confirm({
                title: localize('LA.dialogTitle.clearTahFavorites'),
                content: localize('LA.settingsMenus.content.removeEveryFavoriteMarkerThisCannot'),
            });
            if (!confirmed)
                return;
            await setLAFlag(game.user,'tahFavorites', []);
            await setLAFlag(game.user,'tahFavorites2', []);
            Hooks.callAll('forceUpdateTokenActionHud');
            ui.notifications.info(localize('LA.notify.tahFavoritesCleared'));
        } },
];

// [sound id, label key] pairs.
const UI_VARIANTS = [
    ['hover', 'LA.settingsMenus.tah.uiSound.hover.label'],
    ['open', 'LA.settingsMenus.tah.uiSound.open.label'],
    ['details', 'LA.settingsMenus.tah.uiSound.details.label'],
    ['toggle', 'LA.settingsMenus.tah.uiSound.toggle.label'],
    ['statusHover', 'LA.settingsMenus.tah.uiSound.statusHover.label'],
    ['battleLogHover', 'LA.settingsMenus.tah.uiSound.battleLogHover.label'],
    ['battleLogClick', 'LA.settingsMenus.tah.uiSound.battleLogClick.label'],
];
const TOKEN_VARIANTS = [
    ['tokenHover', 'LA.settingsMenus.tah.tokenSound.tokenHover.label'],
    ['tokenSelect', 'LA.settingsMenus.tah.tokenSound.tokenSelect.label'],
    ['tokenDeselect', 'LA.settingsMenus.tah.tokenSound.tokenDeselect.label'],
    ['tokenTarget', 'LA.settingsMenus.tah.tokenSound.tokenTarget.label'],
    ['tokenUntarget', 'LA.settingsMenus.tah.tokenSound.tokenUntarget.label'],
    ['tokenDrag', 'LA.settingsMenus.tah.tokenSound.tokenDrag.label'],
    ['tokenMove', 'LA.settingsMenus.tah.tokenSound.tokenMove.label'],
    ['elevationKey', 'LA.settingsMenus.tah.tokenSound.elevationKey.label'],
    ['targeting', 'LA.settingsMenus.tah.tokenSound.targeting.label'],
    ['targetingConfirm', 'LA.settingsMenus.tah.tokenSound.targetingConfirm.label'],
];
const DAMAGE_TYPES = [
    ['kinetic', 'LA.settingsMenus.tah.damageSound.kinetic.label'],
    ['energy', 'LA.settingsMenus.tah.damageSound.energy.label'],
    ['explosive', 'LA.settingsMenus.tah.damageSound.explosive.label'],
    ['variable', 'LA.settingsMenus.tah.damageSound.variable.label'],
    ['heat', 'LA.settingsMenus.tah.damageSound.heat.label'],
    ['burn', 'LA.settingsMenus.tah.damageSound.burn.label'],
    ['infection', 'LA.settingsMenus.tah.damageSound.infection.label'],
    ['armor', 'LA.settingsMenus.tah.damageSound.armor.label'],
    ['hit_overshield', 'LA.settingsMenus.tah.damageSound.hit_overshield.label'],
    ['overshield', 'LA.settingsMenus.tah.damageSound.overshield.label'],
];
const STAT_EVENTS = [
    ['hp_loss', 'LA.settingsMenus.tah.statSound.hp_loss.label'],
    ['hp_heal', 'LA.settingsMenus.tah.statSound.hp_heal.label'],
    ['heat_clean', 'LA.settingsMenus.tah.statSound.heat_clean.label'],
    ['stress_hit', 'LA.settingsMenus.tah.statSound.stress_hit.label'],
    ['stress_heal', 'LA.settingsMenus.tah.statSound.stress_heal.label'],
    ['xp_gain', 'LA.settingsMenus.tah.statSound.xp_gain.label'],
    ['xp_loss', 'LA.settingsMenus.tah.statSound.xp_loss.label'],
    ['miss', 'LA.settingsMenus.tah.statSound.miss.label'],
    ['hit', 'LA.settingsMenus.tah.statSound.hit.label'],
    ['crit', 'LA.settingsMenus.tah.statSound.crit.label'],
    ['success', 'LA.settingsMenus.tah.statSound.success.label'],
    ['fail', 'LA.settingsMenus.tah.statSound.fail.label'],
    ['generic_stat', 'LA.settingsMenus.tah.statSound.generic_stat.label'],
];
const STATUS_SFX_EVENTS = [
    ['bonus', 'LA.settingsMenus.tah.statusSfx.bonus.label'],
    ['status', 'LA.settingsMenus.tah.statusSfx.status.label'],
];

const SOUNDS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.masterVolumes.label' },
    { key: 'tah.uiSoundVolume', type: 'slider', label: 'LA.settingsMenus.tah.uiSoundVolume.label', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.tokenFeedbackVolume', type: 'slider', label: 'LA.settingsMenus.tah.tokenFeedbackVolume.label', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.damageSoundVolume', type: 'slider', label: 'LA.settingsMenus.tah.damageSoundVolume.label', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.actionFxVolume', type: 'slider', label: 'LA.settingsMenus.tah.actionFxVolume.label', min: 0, max: 1.5, step: 0.05 },
    { key: 'wreckMasterVolume', type: 'slider', label: 'LA.settingsMenus.wreckMasterVolume.label', min: 0, max: 1.5, step: 0.1 , requires: ['enableWrecks', 'enableWreckAudio'], requiresAll: true },
    { key: 'tah.battleLogVolume', type: 'slider', label: 'LA.settingsMenus.tah.battleLogVolume.label', min: 0, max: 1.5, step: 0.05 },

    { type: 'section', label: 'LA.settingsMenus.section.uiSounds.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: UI_VARIANTS.map(([variant, label]) => ({ key: `tah.uiSound.${variant}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.tokenFeedback.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: TOKEN_VARIANTS.map(([v, label]) => ({ key: `tah.tokenSound.${v}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.damageTypeSounds.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: DAMAGE_TYPES.map(([damageType, label]) => ({ key: `tah.damageSound.${damageType}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.statFeedback.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STAT_EVENTS.map(([statEvent, label]) => ({ key: `tah.statSound.${statEvent}`, label, preview: true })) },
    { type: 'section', label: 'LA.settingsMenus.section.statusSfx.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: STATUS_SFX_EVENTS.map(([e, label]) => ({ key: `tah.statusSfx.${e}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.actionFxAudio.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans', items: ACTION_FX_KEYS.map(([actionKey, label]) => ({ key: `tah.actionFxSound.${actionKey}`, label, preview: true })) },
];

// StatusFX subkeys live in the `statusFXConfig` Object setting. Derived from the one list statusFX.js owns.
const STATUS_FX_VISUAL = STATUS_FX_KEYS.map(key => ({
    sub: `fx_${key}`,
    label: `LA.settingsMenus.statusFx.fx_${key}.label`,
}));
const STATUS_FX_AUTO = [
    { sub: 'auto_dangerZone', label: 'LA.settingsMenus.statusFx.auto_dangerZone.label' },
    { sub: 'auto_burn',       label: 'LA.settingsMenus.statusFx.auto_burn.label' },
    { sub: 'auto_overshield', label: 'LA.settingsMenus.statusFx.auto_overshield.label' },
    { sub: 'auto_infection',  label: 'LA.settingsMenus.statusFx.auto_infection.label' },
    { sub: 'auto_cascading',  label: 'LA.settingsMenus.statusFx.auto_cascading.label' },
];

const STATUSES_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.statusesEffects.label' },
    { key: 'additionalStatuses', type: 'boolean' },
    { key: 'effectNotificationMode', type: 'select', label: 'LA.settingsMenus.effectNotificationMode.label' },
    { type: 'statusFx', sub: 'master', label: 'LA.settingsMenus.statusFx.master.label', hint: 'LA.settingsMenus.statusFx.master.hint' },
    { type: 'statusFx', sub: 'actionFX', label: 'LA.settingsMenus.statusFx.actionFX.label', hint: 'LA.settingsMenus.statusFx.actionFX.hint' },
    { type: 'statusFx', sub: 'rollResultFX', label: 'LA.settingsMenus.statusFx.rollResultFX.label', hint: 'LA.settingsMenus.statusFx.rollResultFX.hint' },
    { type: 'statusFx', sub: 'damageImpactFX', label: 'LA.settingsMenus.statusFx.damageImpactFX.label', hint: 'LA.settingsMenus.statusFx.damageImpactFX.hint' },
    { key: 'actionBadgeItemName', type: 'boolean', label: 'LA.settingsMenus.actionBadgeItemName.label', hint: 'LA.settingsMenus.actionBadgeItemName.hint' },
    { type: 'statusFx', sub: 'removeStatusesOnDeath', label: 'LA.settingsMenus.statusFx.removeStatusesOnDeath.label' },

    { type: 'section', label: 'LA.settingsMenus.section.visualEffects.label', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_VISUAL },
    { key: 'weaponFxAboveTokens', type: 'boolean' },
    { key: 'guardianBulwarkAuraMode', type: 'select', label: 'LA.settingsMenus.guardianBulwarkAuraMode.label', hint: 'LA.settingsMenus.guardianBulwarkAuraMode.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.autoStatusIcons.label', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_AUTO },
];

const DEBUG_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.debugToggles.label' },
    { key: 'debugPathHexCalculation', type: 'boolean' },
    { key: 'debugOutOfCombat', type: 'boolean' },
    { key: 'debugForceJb2aFree', type: 'boolean' },
    { key: 'debugAutomation', type: 'boolean' },
    { key: 'iso.debugSelectionOverlay', type: 'boolean' },
];

const VISION_FIELDS = [
    { type: 'button',
        key: 'visionDocs',
        label: 'LA.settingsMenus.visionDocs.label',
        icon: 'fas fa-book',
        hint: 'LA.settingsMenus.visionDocs.hint',
        clientAllowed: true,
        onClick: () => window.open('https://agraael.github.io/lancer-automations/feature/VISION.html', '_blank'),
    },

    { type: 'section', label: 'LA.settingsMenus.section.basicVision.label' },
    { key: 'basicSightTo999', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.lancerVisionModes.label', hint: 'LA.settingsMenus.section.lancerVisionModes.hint' },
    { key: 'lancerVisionAutoAdd', type: 'boolean' },
    { key: 'lancerLos', type: 'boolean' },
    { key: 'lancerLosFlagOnly', type: 'boolean' },
    { key: 'lancerLosAttackHover', type: 'boolean', requires: 'lancerLos' },
    { key: 'lancerLosHeightRule', type: 'select' },
    { key: 'lancerLosPeekRange', type: 'number', requires: 'lancerLos' },
    { key: 'lancerLosDebug', type: 'boolean' },
    { key: 'lancerAwarenessStyle', type: 'select' },
    { type: 'compactBooleans',
        items: [
            { key: 'lancerSensorCombatOnly', label: 'LA.settingsMenus.lancerSensorCombatOnly.label' },
            { key: 'lancerAwarenessCombatOnly', label: 'LA.settingsMenus.lancerAwarenessCombatOnly.label' },
            { key: 'lancerSensorUseModeRange', label: 'LA.settingsMenus.lancerSensorUseModeRange.label' },
            { key: 'lancerAwarenessUseModeRange', label: 'LA.settingsMenus.lancerAwarenessUseModeRange.label' }
        ]
    },
    { type: 'button',
        key: 'refreshLancerVisionTokens',
        label: 'LA.settingsMenus.refreshLancerVisionTokens.label',
        icon: 'fas fa-sync',
        hint: 'LA.settingsMenus.refreshLancerVisionTokens.hint',
        onClick: () => globalThis.lancerAutoVisionSetup?.(false),
    },

    { type: 'section', label: 'LA.settingsMenus.section.tokenBlocksLineOfSight.label', hint: 'LA.settingsMenus.section.tokenBlocksLineOfSight.hint' },
    { key: 'bulwarkBlocksLineOfSight', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.blinded.label' },
    { key: 'blindedSetsVision', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.tokenHeightWallHeight.label', hint: 'LA.settingsMenus.section.tokenHeightWallHeight.hint' },
    { key: 'autoTokenHeight', type: 'boolean', label: 'LA.settingsMenus.autoTokenHeight.label', hint: 'LA.settingsMenus.autoTokenHeight.hint' },
    { key: 'autoTokenHeightVehicleSquad', type: 'boolean', label: 'LA.settingsMenus.autoTokenHeightVehicleSquad.label', hint: 'LA.settingsMenus.autoTokenHeightVehicleSquad.hint' },
    { type: 'button',
        key: 'syncAllTokenHeights',
        label: 'LA.settingsMenus.syncAllTokenHeights.label',
        icon: 'fas fa-ruler-vertical',
        hint: 'LA.settingsMenus.syncAllTokenHeights.hint',
        onClick: () => syncAllTokenHeights(),
    },

    { type: 'section', label: 'LA.settingsMenus.section.visionFromEdgeExperimental.label', collapsible: true, collapsed: true, hint: 'LA.settingsMenus.section.visionFromEdgeExperimental.hint' },
    { key: 'visionFromEdgeEnabled', type: 'boolean' },
    { key: 'visionFromEdgeSampleMode', type: 'select' },
    { key: 'visionFromEdgeSampleOffset', type: 'number' },
    { key: 'visionFromEdgeDebug', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.rangePulseLineOfSightExperimental.label', collapsible: true, collapsed: true, hint: 'LA.settingsMenus.section.rangePulseLineOfSightExperimental.hint' },
    { key: 'rangePulseLos', type: 'boolean', label: 'LA.settingsMenus.rangePulseLos.label' },

    { type: 'section', label: 'LA.settingsMenus.section.dragVision.label', collapsible: true, collapsed: true },
    { key: 'dragVisionMode', type: 'select' },
    { key: 'dragVisionMultiplier', type: 'number' },
    { key: 'dragSuppressOriginSources', type: 'boolean' },

];

const PERFORMANCE_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.vision.label', hint: 'LA.settingsMenus.section.vision.hint' },
    { key: 'visionAnimationThrottleFps', type: 'number' },
    { key: 'visionFromEdgeDeferDrag', type: 'boolean' },
    { key: 'occlusionDimDeferMoving', type: 'boolean' },
    { key: 'disableVisionAboveControlled', type: 'number' },

    { type: 'section', label: 'LA.settingsMenus.section.coreShortcuts.label', hint: 'LA.settingsMenus.section.coreShortcuts.hint' },
    { type: 'moduleSelect', module: 'core', key: 'performanceMode' },
    { type: 'moduleSlider', module: 'core', key: 'maxFPS', min: 10, max: 60, step: 10 },
    { type: 'moduleBoolean', module: 'core', key: 'visionAnimation' },
    { type: 'moduleBoolean', module: 'core', key: 'lightAnimation' },
    { type: 'moduleBoolean', module: 'core', key: 'tokenDragPreview' },

    { type: 'section', label: 'LA.settingsMenus.section.settingsCache.label' },
    { key: 'settingsCacheAllModules', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.statusFx.label' },
    { type: 'statusFx', sub: 'lowQuality', default: false, label: 'LA.settingsMenus.statusFx.lowQuality.label', hint: 'LA.settingsMenus.statusFx.lowQuality.hint' },
];

const TOOLS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.optionalContentPacks.label', hint: 'LA.settingsMenus.section.optionalContentPacks.hint' },
    { key: 'enableLaSossisItems', type: 'boolean', requires: 'additionalStatuses' },
    { key: 'enablePersonalStuff', type: 'boolean' },
    { type: 'button',
        key: 'getDeployablesLcp',
        label: 'LA.settingsMenus.getDeployablesLcp.label',
        icon: 'fas fa-download',
        hint: 'LA.settingsMenus.getDeployablesLcp.hint',
        clientAllowed: true,
        onClick: () => window.open(foundry.utils.getRoute('modules/lancer-automations/extra/LaSossis_Npc_Deployables.lcp'), '_blank'),
    },

    { type: 'section', label: 'LA.settingsMenus.section.downtime.label', hint: 'LA.settingsMenus.section.downtime.hint' },
    { type: 'button',
        key: 'importDowntimeLcp',
        label: 'LA.settingsMenus.importDowntimeLcp.label',
        icon: 'fas fa-file-import',
        hint: 'LA.settingsMenus.importDowntimeLcp.hint',
        onClick: () => game.modules.get(MODULE_ID)?.api?.openDowntimeImportDialog?.(),
    },

    { type: 'section', label: 'LA.settingsMenus.section.templateMacro.label' },
    { type: 'button',
        key: 'importTmacPresets',
        requiresModule: 'templatemacro',
        label: 'LA.settingsMenus.importTmacPresets.label',
        icon: 'fas fa-shapes',
        hint: 'LA.settingsMenus.importTmacPresets.hint',
        onClick: () => importTemplateMacroPresets(),
    },

    { type: 'section', label: 'LA.settingsMenus.section.actorPrototypeTokenSync.label' },
    { key: 'syncActorImgToToken', type: 'boolean', label: 'LA.settingsMenus.syncActorImgToToken.label', hint: 'LA.settingsMenus.syncActorImgToToken.hint' },
    { key: 'syncActorNameToToken', type: 'boolean', label: 'LA.settingsMenus.syncActorNameToToken.label', hint: 'LA.settingsMenus.syncActorNameToToken.hint' },
    { type: 'button',
        key: 'syncAllActorImgs',
        label: 'LA.settingsMenus.syncAllActorImgs.label',
        icon: 'fas fa-images',
        hint: 'LA.settingsMenus.syncAllActorImgs.hint',
        onClick: () => syncAllActorImgs(),
    },

    { type: 'section', label: 'LA.settingsMenus.section.maintenance.label', collapsible: true, collapsed: true },
    { type: 'button',
        key: 'openLcpRepair',
        label: 'LA.settingsMenus.openLcpRepair.label',
        icon: 'fas fa-wrench',
        hint: 'LA.settingsMenus.openLcpRepair.hint',
        onClick: () => repairLCPData(),
    },
    { type: 'button',
        key: 'openReset',
        label: 'LA.settingsMenus.openReset.label',
        icon: 'fas fa-undo',
        hint: 'LA.settingsMenus.openReset.hint',
        onClick: () => new ReactionReset().render(true),
    },
    { type: 'button',
        key: 'openExport',
        label: 'LA.settingsMenus.openExport.label',
        icon: 'fas fa-file-export',
        hint: 'LA.settingsMenus.openExport.hint',
        onClick: () => new ReactionExport().render(true),
    },
    { type: 'button',
        key: 'openImport',
        label: 'LA.settingsMenus.openImport.label',
        icon: 'fas fa-file-import',
        hint: 'LA.settingsMenus.openImport.hint',
        onClick: () => new ReactionImport().render(true),
    },

    { type: 'section', label: 'LA.settingsMenus.section.news.label' },
    { type: 'button',
        key: 'openNewsHistory',
        label: 'LA.settingsMenus.openNewsHistory.label',
        icon: 'fas fa-newspaper',
        hint: 'LA.settingsMenus.openNewsHistory.hint',
        onClick: () => openNewsHistory(),
    },
];

const laKb = (key) => ({ type: 'keybinding', module: MODULE_ID, key });
const laTour = (key) => ({ type: 'tour', module: MODULE_ID, key });

const TUTORIALS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.setup.label', hint: 'LA.settingsMenus.section.setup.hint' },
    { type: 'button', key: 'openOnboarding', label: 'LA.settingsMenus.openOnboarding.label', icon: 'fas fa-wand-magic-sparkles', hint: 'LA.settingsMenus.openOnboarding.hint', onClick: () => runSettingsOnboarding() },
    { type: 'section', label: 'LA.settingsMenus.section.tutorials.label', hint: 'LA.settingsMenus.section.tutorials.hint' },
    laTour('config-tour'),
    laTour('activation-manager-tour'),
    laTour('effect-manager-tour'),
    laTour('tah-tour'),
    laTour('tah-advanced-tour'),
    laTour('ruler-tour'),
    laTour('advanced-measure-tour'),
    laTour('add-extra-tour'),
];

// [control, where, action] keys. Verified against the handlers, not the docs.
const FIXED_CONTROLS = [
    ['LA.settingsMenus.fixedControl.rightClickHudRowWheelItem.control', 'LA.settingsMenus.fixedControl.rightClickHudRowWheelItem.where', 'LA.settingsMenus.fixedControl.rightClickHudRowWheelItem.action'],
    ['LA.settingsMenus.fixedControl.ctrlRightClickHudRow.control', 'LA.settingsMenus.fixedControl.ctrlRightClickHudRow.where', 'LA.settingsMenus.fixedControl.ctrlRightClickHudRow.action'],
    ['LA.settingsMenus.fixedControl.ctrlRightClickStatusRow.control', 'LA.settingsMenus.fixedControl.ctrlRightClickStatusRow.where', 'LA.settingsMenus.fixedControl.ctrlRightClickStatusRow.action'],
    ['LA.settingsMenus.fixedControl.hoverHudRow.control', 'LA.settingsMenus.fixedControl.hoverHudRow.where', 'LA.settingsMenus.fixedControl.hoverHudRow.action'],
    ['LA.settingsMenus.fixedControl.tabActionStatusWheel.control', 'LA.settingsMenus.fixedControl.tabActionStatusWheel.where', 'LA.settingsMenus.fixedControl.tabActionStatusWheel.action'],
    ['LA.settingsMenus.fixedControl.escapeAnyWheel.control', 'LA.settingsMenus.fixedControl.escapeAnyWheel.where', 'LA.settingsMenus.fixedControl.escapeAnyWheel.action'],
    ['LA.settingsMenus.fixedControl.shiftWheelShapePlacement.control', 'LA.settingsMenus.fixedControl.shiftWheelShapePlacement.where', 'LA.settingsMenus.fixedControl.shiftWheelShapePlacement.action'],
    ['LA.settingsMenus.fixedControl.ctrlWheelShapePlacement.control', 'LA.settingsMenus.fixedControl.ctrlWheelShapePlacement.where', 'LA.settingsMenus.fixedControl.ctrlWheelShapePlacement.action'],
    ['LA.settingsMenus.fixedControl.tAdvancedMeasure.control', 'LA.settingsMenus.fixedControl.tAdvancedMeasure.where', 'LA.settingsMenus.fixedControl.tAdvancedMeasure.action'],
    ['LA.settingsMenus.fixedControl.gAdvancedMeasure.control', 'LA.settingsMenus.fixedControl.gAdvancedMeasure.where', 'LA.settingsMenus.fixedControl.gAdvancedMeasure.action'],
    ['LA.settingsMenus.fixedControl.shiftLeftClickAdvancedMeasure.control', 'LA.settingsMenus.fixedControl.shiftLeftClickAdvancedMeasure.where', 'LA.settingsMenus.fixedControl.shiftLeftClickAdvancedMeasure.action'],
    ['LA.settingsMenus.fixedControl.ctrlFThisWindow.control', 'LA.settingsMenus.fixedControl.ctrlFThisWindow.where', 'LA.settingsMenus.fixedControl.ctrlFThisWindow.action'],
];

const CONTROL_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.lancerAutomations.label' },
    laKb('resetMovement'),
    laKb('cardTargeting'),

    { type: 'section', label: 'LA.settingsMenus.section.tahNavigation.label', collapsible: true, collapsed: true },
    laKb('tah.toggleSearch'),
    laKb('tah.toggleFavorites'),
    laKb('tah.toggleStatuses'),
    laKb('tahNavUp'),
    laKb('tahNavDown'),
    laKb('tahNavLeft'),
    laKb('tahNavRight'),
    laKb('tahNavActivate'),
    laKb('tahNavContext'),

    { type: 'section', label: 'LA.settingsMenus.section.movement.label' },
    laKb('freeMovement'),
    laKb('debugMovement'),
    laKb('togglePathfinding'),
    laKb('swapElevationMode'),
    laKb('movementWheel'),
    laKb('actionWheel'),
    laKb('statusWheel'),

    { type: 'section', label: 'LA.settingsMenus.section.advancedMeasure.label', collapsible: true, collapsed: true },
    laKb('advancedMeasure'),
    laKb('elevationUp'),
    laKb('elevationDown'),
    laKb('lineTiltUp'),
    laKb('lineTiltDown'),
    laKb('resetShape'),

    { type: 'section', label: 'LA.settingsMenus.section.fixedControls.label', hint: 'LA.settingsMenus.section.fixedControls.hint', collapsible: true, collapsed: true },
    { type: 'table',
        label: 'LA.settingsMenus.table.mouseAndKeyboard.label',
        getTable: () => ({
            columns: ['LA.settingsMenus.tableColumn.control', 'LA.settingsMenus.tableColumn.where', 'LA.settingsMenus.tableColumn.action'],
            rows: FIXED_CONTROLS.map(([control, where, action]) => ({
                label: control,
                cells: [{ isText: true, text: where }, { isText: true, text: action }],
            })),
        }) },
];

const ISO_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.isometricIntegrations.label' },
    { key: 'iso.statBar', type: 'boolean' , requires: 'tokenStatBar' },
    { key: 'iso.tacticalDistance', type: 'boolean' },
    { key: 'iso.waypointLabel', type: 'boolean' },
    { key: 'iso.elevationAnimation', type: 'boolean' },
    { key: 'iso.restoreAnchor', type: 'boolean' },
    { key: 'iso.scrollingText', type: 'boolean' },
    { key: 'iso.targetReticle', type: 'boolean' , requires: 'tokenStatBar' },
    { key: 'iso.clickZone', type: 'boolean' , requires: 'tokenStatBar' },
    { key: 'iso.selectionMarquee', type: 'boolean' },
    { key: 'iso.moduleLabels', type: 'boolean' },
    { key: 'iso.effectAspect', type: 'boolean' },
];

const BATTLE_LOG_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.battleLog.label' },
    {
        key: 'battleLogEnabled',
        type: 'boolean',
        label: 'LA.settingsMenus.battleLogEnabled.label',
        hint: 'LA.settingsMenus.battleLogEnabled.hint',
    },
    {
        key: 'tah.telemetryFriendlyMechAsSquad',
        type: 'boolean',
        label: 'LA.settingsMenus.tah.telemetryFriendlyMechAsSquad.label',
        hint: 'LA.settingsMenus.tah.telemetryFriendlyMechAsSquad.hint',
        requires: 'battleLogEnabled' },
    {
        key: 'tah.disableAwards',
        type: 'boolean',
        label: 'LA.settingsMenus.tah.disableAwards.label',
        hint: 'LA.settingsMenus.tah.disableAwards.hint',
        requires: 'battleLogEnabled' },
    {
        key: 'tah.telemetryDebug',
        type: 'boolean',
        label: 'LA.settingsMenus.tah.telemetryDebug.label',
        hint: 'LA.settingsMenus.tah.telemetryDebug.hint',
        requires: 'battleLogEnabled' },

    { type: 'button',
        key: 'openBattleLogTest',
        label: 'LA.settingsMenus.openBattleLogTest.label',
        icon: 'fas fa-flag-checkered',
        onClick: () => openBattleLogGMCardTest(),
    },
    { type: 'button',
        key: 'openBattleLogRecapTest',
        label: 'LA.settingsMenus.openBattleLogRecapTest.label',
        icon: 'fas fa-clipboard-list',
        onClick: () => openBattleLogRecapTest(),
    },
    { type: 'button',
        key: 'openTelemetryDebug',
        label: 'LA.settingsMenus.openTelemetryDebug.label',
        icon: 'fas fa-bug',
        onClick: () => openTelemetryDebugWindow(),
    },

    { type: 'section', label: 'LA.settingsMenus.section.themeMusic.label', collapsible: true, collapsed: true },
    { key: 'tah.battleLog.themeStart',
        type: 'select',
        label: 'LA.settingsMenus.tah.battleLog.themeStart.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeStart.hint' },
    { key: 'tah.battleLog.themeVolume',
        type: 'slider',
        label: 'LA.settingsMenus.tah.battleLog.themeVolume.label',
        min: 0.5, max: 2, step: 0.05,
        hint: 'LA.settingsMenus.tah.battleLog.themeVolume.hint' },
    { key: 'tah.battleLog.themeLoop',
        type: 'boolean',
        label: 'LA.settingsMenus.tah.battleLog.themeLoop.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeLoop.hint' },
    { key: 'tah.battleLog.themeDefault',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeDefault.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeDefault.hint' },
    { key: 'tah.battleLog.themeVictory',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeVictory.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeVictory.hint' },
    { key: 'tah.battleLog.themeDefeat',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeDefeat.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeDefeat.hint' },
    { key: 'tah.battleLog.themePartial',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themePartial.label',
        hint: 'LA.settingsMenus.tah.battleLog.themePartial.hint' },
];

const COLORS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.theme.label' },
    { type: 'moduleSelect', module: 'lancer-style-library', key: 'theme' },
    { type: 'section', label: 'LA.settingsMenus.section.targetingColors.label' },
    { key: 'color.inRange', type: 'color', label: 'LA.settingsMenus.color.inRange.label' },
    { key: 'color.target', type: 'color', label: 'LA.settingsMenus.color.target.label' },
    { key: 'color.reference', type: 'color', label: 'LA.settingsMenus.color.reference.label' },
    { key: 'color.outOfRange', type: 'color', label: 'LA.settingsMenus.color.outOfRange.label' },
    { key: 'color.placed', type: 'color', label: 'LA.settingsMenus.color.placed.label' },
    { key: 'color.noHost', type: 'color', label: 'LA.settingsMenus.color.noHost.label' },
    { key: 'color.selected', type: 'color', label: 'LA.settingsMenus.color.selected.label' },
    { key: 'color.crit', type: 'color', label: 'LA.settingsMenus.color.crit.label' },
    { key: 'color.rangeFill', type: 'color', label: 'LA.settingsMenus.color.rangeFill.label' },
    { type: 'section', label: 'LA.settingsMenus.section.toolColors.label' },
    { key: 'color.traceStart', type: 'color', label: 'LA.settingsMenus.color.traceStart.label' },
    { key: 'color.traceEnd', type: 'color', label: 'LA.settingsMenus.color.traceEnd.label' },
    { key: 'color.traceLine', type: 'color', label: 'LA.settingsMenus.color.traceLine.label' },
    { type: 'section', label: 'LA.settingsMenus.section.rangeGlowColors.label' },
    { key: 'color.glowManual', type: 'color', label: 'LA.settingsMenus.color.glowManual.label' },
    { key: 'color.glowThreat', type: 'color', label: 'LA.settingsMenus.color.glowThreat.label' },
    { key: 'color.glowSensor', type: 'color', label: 'LA.settingsMenus.color.glowSensor.label' },
    { key: 'color.glowWeapon', type: 'color', label: 'LA.settingsMenus.color.glowWeapon.label' },
    { key: 'color.glowReach', type: 'color', label: 'LA.settingsMenus.color.glowReach.label' },
    { key: 'color.glowMark', type: 'color', label: 'LA.settingsMenus.color.glowMark.label' },
    { key: 'color.glowDeploy', type: 'color', label: 'LA.settingsMenus.color.glowDeploy.label' },
    { type: 'section', label: 'LA.settingsMenus.section.rangePulse.label' },
    { key: 'rangePulseStyle', type: 'select', label: 'LA.settingsMenus.rangePulseStyle.label', hint: 'LA.settingsMenus.rangePulseStyle.hint' },
    { key: 'rangePulseMotion', type: 'select', label: 'LA.settingsMenus.rangePulseMotion.label' },
    { key: 'color.pulseLine', type: 'color', label: 'LA.settingsMenus.color.pulseLine.label' },
    // Retired 2026-09-12, forced to 0 in _staticGridAlpha. Uncomment both to bring it back.
    // { key: 'rangePulseLineOpacity', type: 'slider', label: 'LA.settingsMenus.rangePulseLineOpacity.label', min: 0, max: 1, step: 0.05 },
    { key: 'rangePulseWaveOpacity', type: 'slider', label: 'LA.settingsMenus.rangePulseWaveOpacity.label', min: 0.1, max: 1, step: 0.05 },
    { key: 'rangePulseLineWidth', type: 'slider', label: 'LA.settingsMenus.rangePulseLineWidth.label', min: 1, max: 4, step: 0.25 },
    { key: 'rangePulseSpeed', type: 'slider', label: 'LA.settingsMenus.rangePulseSpeed.label', min: 0.25, max: 3, step: 0.05 },
    { type: 'section', label: 'LA.settingsMenus.section.rulerColors.label' },
    { key: 'speedProvider.colorStandard', type: 'color', label: 'LA.settingsMenus.speedProvider.colorStandard.label' },
    { key: 'speedProvider.colorBoost', type: 'color', label: 'LA.settingsMenus.speedProvider.colorBoost.label' },
    { key: 'speedProvider.colorOverBoost', type: 'color', label: 'LA.settingsMenus.speedProvider.colorOverBoost.label' },
    { key: 'speedProvider.colorFreeMovement', type: 'color', label: 'LA.settingsMenus.speedProvider.colorFreeMovement.label' , requires: 'enableBuiltinSpeedProvider' },
    { key: 'speedProvider.colorForceMovement', type: 'color', label: 'LA.settingsMenus.speedProvider.colorForceMovement.label' },
    {
        key: 'color.resetDefaults',
        type: 'button',
        label: 'LA.settingsMenus.color.resetDefaults.label',
        icon: 'fas fa-undo',
        hint: 'LA.settingsMenus.color.resetDefaults.hint',
        clientAllowed: true,
        onClick: () => resetPaletteColorSettings(
            COLORS_FIELDS.filter(field => field.key && !field.module && field.type !== 'button').map(field => field.key)
        ),
    },
];

const THT_ID = 'terrain-height-tools';
const TMAC_ID = 'templatemacro';

// Keep the owning module's own wording, minus a prefix that the section header already says
// Core is not a module, but its settings ride the same external-shortcut plumbing.
function _extNamespaceActive(namespace)
{
    return namespace === 'core' || !!game.modules.get(namespace)?.active;
}

// A select hands back a string, and core's numeric settings are DataFields that reject one.
function _coerceExtValue(setting, raw)
{
    if (setting?.type === Boolean)
        return !!raw;
    const isNumeric = setting?.type === Number
        || setting?.type instanceof foundry.data.fields.NumberField;
    if (!isNumeric)
        return raw;
    if (raw === '' || raw === null || raw === undefined)
        return setting?.type?.nullable ? null : raw;
    return Number(raw);
}

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

// Shortcuts only. Anything that has its own automation on the LA side (line of sight, rulers, auto elevation) is
// deliberately absent, and fields whose setting is not registered drop out on their own.
const THT_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.thtShortcuts.label', hint: 'LA.settingsMenus.section.thtShortcuts.hint', collapsible: true },

    // The section header carries the feature name, so the rows only name the property
    { type: 'section', label: 'LA.settingsMenus.section.thtDropShading.label', hint: 'LA.settingsMenus.section.thtDropShading.hint', subsection: true, collapsed: true },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainDropBand' },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainDropBandReach' },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainDropBandOpacity' },
    { type: 'moduleColor', module: THT_ID, key: 'terrainDropBandColor' },

    { type: 'section', label: 'LA.settingsMenus.section.thtTanaka.label', hint: 'LA.settingsMenus.section.thtTanaka.hint', subsection: true, collapsed: true },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainTanaka' },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainTanakaWidth' },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainTanakaOpacity' },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainTanakaTint' },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainTanakaTexture' },
    { type: 'moduleColor', module: THT_ID, key: 'terrainTanakaLight' },
    { type: 'moduleColor', module: THT_ID, key: 'terrainTanakaDark' },

    { type: 'section', label: 'LA.settingsMenus.section.thtLight.label', hint: 'LA.settingsMenus.section.thtLight.hint', subsection: true, collapsed: true },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainExtrusionSunAngle' },

    { type: 'section', label: 'LA.settingsMenus.section.thtStacking.label', hint: 'LA.settingsMenus.section.thtStacking.hint', subsection: true, collapsed: true },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainAboveLowerTokens' },

    { type: 'section', label: 'LA.settingsMenus.section.thtLabels.label', subsection: true, collapsed: true },
    { type: 'moduleBoolean', module: THT_ID, key: 'useFractionsForLabels' },
    { type: 'moduleBoolean', module: THT_ID, key: 'smartLabelPlacement' },

    { type: 'section', label: 'LA.settingsMenus.section.thtPerformance.label', hint: 'LA.settingsMenus.section.thtPerformance.hint', subsection: true, collapsed: true },
    { type: 'moduleBoolean', module: THT_ID, key: 'scaleVisualsToGrid' },
    { type: 'moduleBoolean', module: THT_ID, key: 'terrainCacheEnabled' },
    { type: 'moduleSlider', module: THT_ID, key: 'terrainCacheResolution' },

    { type: 'section', label: 'LA.settingsMenus.section.thtTypes.label', subsection: true, collapsed: true },
    {
        type: 'button',
        key: 'openThtTerrainTypes',
        label: 'LA.settingsMenus.openThtTerrainTypes.label',
        hint: 'LA.settingsMenus.openThtTerrainTypes.hint',
        icon: 'fas fa-mountain',
        onClick: () =>
        {
            const menu = /** @type {any} */ (game.settings.menus.get(`${THT_ID}.terrainTypes`));
            if (!menu?.type)
            {
                ui.notifications?.warn(localize('LA.settingsMenus.openThtTerrainTypes.missing'));
                return;
            }
            new menu.type().render(true);
        },
    },
];

const TMAC_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.tmacShortcuts.label', hint: 'LA.settingsMenus.section.tmacShortcuts.hint', collapsible: true },
    { type: 'moduleBoolean', module: TMAC_ID, key: 'scaleVisualsToGrid' },
    { type: 'moduleSlider', module: TMAC_ID, key: 'centerLabelSize', min: 6, max: 48, step: 1 },
    { type: 'moduleBoolean', module: TMAC_ID, key: 'thtAutoElevation' },
];

const MAP_MODULE_IDS = [THT_ID, TMAC_ID];

const TAB_DEFS = [
    // Gameplay & rules
    { id: 'activations', label: 'LA.settingsMenus.tab.activations.label', icon: 'fas fa-bolt', fields: ACTIVATIONS_FIELDS },
    { id: 'combat', label: 'LA.settingsMenus.tab.combat.label', icon: 'fas fa-running', fields: COMBAT_MOVEMENT_FIELDS },
    { id: 'statuses', label: 'LA.settingsMenus.tab.statuses.label', icon: 'fas fa-tags', fields: STATUSES_FIELDS },
    { id: 'experimental', label: 'LA.settingsMenus.tab.experimental.label', icon: 'fas fa-eye', fields: VISION_FIELDS },
    { id: 'wrecks', label: 'LA.settingsMenus.tab.wrecks.label', icon: 'fas fa-skull-crossbones', fields: WRECKS_FIELDS },
    // Look & feel
    { id: 'tokens', label: 'LA.settingsMenus.tab.tokens.label', icon: 'fas fa-cubes', fields: TOKENS_DISPLAY_FIELDS },
    { id: 'tah', label: 'LA.settingsMenus.tab.tah.label', icon: 'fas fa-th-list', fields: TAH_FIELDS },
    { id: 'colors', label: 'LA.settingsMenus.tab.colors.label', icon: 'fas fa-palette', fields: COLORS_FIELDS },
    { id: 'sounds', label: 'LA.settingsMenus.tab.sounds.label', icon: 'fas fa-volume-high', fields: SOUNDS_FIELDS },
    {
        id: 'iso',
        label: 'LA.settingsMenus.tab.iso.label',
        icon: 'fas fa-cube',
        fields: ISO_FIELDS,
        disabledReason: () =>
        {
            const hasIsometricPerspective = !!game.modules.get('isometric-perspective')?.active;
            const hasGrapeJuiceIsometrics = !!game.modules.get('grape_juice-isometrics')?.active;
            if (hasIsometricPerspective || hasGrapeJuiceIsometrics)
                return null;
            return 'LA.settingsMenus.tab.iso.disabledReason';
        },
    },
    {
        id: 'mapModules',
        label: 'LA.settingsMenus.tab.mapModules.label',
        icon: 'fas fa-layer-group',
        fields: [...THT_FIELDS, ...TMAC_FIELDS],
        disabledReason: () => MAP_MODULE_IDS.some(id => game.modules.get(id)?.active)
            ? null
            : 'LA.settingsMenus.tab.mapModules.disabledReason',
    },
    // Interface & tools
    { id: 'battelog', label: 'LA.settingsMenus.tab.battelog.label', icon: 'fas fa-flag-checkered', fields: BATTLE_LOG_FIELDS },
    { id: 'tools', label: 'LA.settingsMenus.tab.tools.label', icon: 'fas fa-toolbox', fields: TOOLS_FIELDS },
    { id: 'control', label: 'LA.settingsMenus.tab.control.label', icon: 'fas fa-keyboard', fields: CONTROL_FIELDS },
    // Help & maintenance
    { id: 'tutorials', label: 'LA.settingsMenus.tab.tutorials.label', icon: 'fas fa-graduation-cap', fields: TUTORIALS_FIELDS },
    { id: 'performance', label: 'LA.settingsMenus.tab.performance.label', icon: 'fas fa-gauge-high', fields: PERFORMANCE_FIELDS },
    { id: 'debug', label: 'LA.settingsMenus.tab.debug.label', icon: 'fas fa-bug', fields: DEBUG_FIELDS },
];

const NAV_GROUPS = [
    { label: 'LA.settingsMenus.navGroup.core.label', icon: 'fas fa-crosshairs', tabs: ['activations', 'combat', 'statuses'] },
    { label: 'LA.settingsMenus.navGroup.canvas.label', icon: 'fas fa-map', tabs: ['experimental', 'tokens', 'wrecks', 'iso', 'mapModules', 'performance'] },
    { label: 'LA.settingsMenus.navGroup.interface.label', icon: 'fas fa-window-maximize', tabs: ['tah', 'control', 'colors', 'sounds'] },
    { label: 'LA.settingsMenus.navGroup.extras.label', icon: 'fas fa-star', tabs: ['battelog', 'tools'] },
    { label: 'LA.settingsMenus.navGroup.help.label', icon: 'fas fa-circle-question', tabs: ['tutorials', 'debug'] },
];

// Field opt-in: `requires: 'key'` or `['a','b']`, plus `requiresAll` for AND.
function _requiredKeys(field)
{
    if (!field?.requires)
        return [];
    return Array.isArray(field.requires) ? field.requires : [field.requires];
}

// Compact boolean items count as fields so they can carry `requires` too.
function _allKeyedFields()
{
    return TAB_DEFS.flatMap(tab => /** @type {any[]} */ (tab.fields ?? []))
        .flatMap(field => field?.type === 'compactBooleans' ? (field.items ?? []) : [field]);
}

function _fieldByKey(key)
{
    return _allKeyedFields().find(field => field?.key === key);
}

function _requirementLabel(key)
{
    return localize(_fieldByKey(key)?.label ?? game.settings.settings.get(`${MODULE_ID}.${key}`)?.name ?? key);
}

// A dependency that is itself gated counts as unmet, so chains resolve.
function _isRequirementMet($html, key, seen = new Set())
{
    if (seen.has(key))
        return true;
    seen.add(key);
    const input = $html.find(`[name="${key}"]`)[0];
    let on;
    if (input)
        on = !!input.checked;
    else
        on = !!getModuleSetting(key);
    if (!on)
        return false;
    const parent = _fieldByKey(key);
    if (!parent?.requires)
        return true;
    const parentKeys = _requiredKeys(parent);
    return parent.requiresAll
        ? parentKeys.every(sub => _isRequirementMet($html, sub, seen))
        : parentKeys.some(sub => _isRequirementMet($html, sub, seen));
}

function _requirementHint(field)
{
    const names = _requiredKeys(field).map(_requirementLabel);
    if (!names.length)
        return '';
    return `Needs ${names.join(field.requiresAll ? ' and ' : ' or ')}.`;
}

function _fieldsWithRequirements()
{
    return _allKeyedFields().filter(field => field?.key && field.requires);
}

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
    ArrowLeft: 'ðŸ¡¸',
    ArrowRight: 'ðŸ¡º',
    ArrowUp: 'ðŸ¡¹',
    ArrowDown: 'ðŸ¡»',
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

/** @param {string} sub */
function _readStatusFx(sub, fallback = true)
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
            name: game.i18n.localize(action.name ?? field.key),
            hint: action.hint ? game.i18n.localize(action.hint) : '',
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
        let value = false;
        try
        {
            value = !!game.settings.get(field.module, field.key);
        }
        catch
        {
            value = !!setting.default;
        }
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'boolean',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isBoolean: true,
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
        let value = setting.default;
        try
        {
            value = game.settings.get(field.module, field.key);
        }
        catch
        { /* fall back to the default */ }
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
        let value = setting.default;
        try
        {
            value = game.settings.get(field.module, field.key);
        }
        catch
        { /* fall back to the default */ }
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
        let value;
        try
        {
            value = game.settings.get(field.module, field.key);
        }
        catch
        {
            value = setting.default;
        }
        return {
            key: `__ext.${field.module}.${field.key}`,
            type: 'select',
            label: externalLabel(field, setting),
            hint: localize(field.hint ?? setting.hint ?? ''),
            value,
            isSelect: true,
            // Core puts its choices on the DataField rather than on the setting config.
            choices: Object.entries(setting.choices ?? setting.type?.choices ?? {}).map(([choiceValue, choiceLabel]) => ({
                value: choiceValue,
                label: game.i18n.localize(String(choiceLabel)),
                selected: choiceValue === String(value),
            })),
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
                return { key: it.key, label: localize(it.label), hint: localize(hint), value, preview: !!it.preview, isLocked: _isLockedForUser(it.key) };
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
        choices: (() =>
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
        })(),
        isLocked: _isLockedForUser(field.key)
    };
}

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

/** @param {any} html @param {any[]} fields @param {any} _app */
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
        const isExternal = f.type === 'moduleSelect' || f.type === 'moduleBoolean';
        const key = isExternal ? `${f.module}.${f.key}` : `${MODULE_ID}.${f.key}`;
        const setting = game.settings.settings.get(key);
        if (!setting || setting.scope === 'world')
            continue;
        const $input = $html.find(`[name="${isExternal ? `__ext.${f.module}.${f.key}` : f.key}"]`);
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

/** @param {any} $row @param {string} modeKey */
function _renderFCCRowLock($row, modeKey)
{
    $row.find('.la-fcc-lock').remove();
    const icon = _FCS_ICONS[modeKey];
    if (icon)
    {
        $row.find('> div').first().children().first().prepend($('<span>')
            .html('&nbsp;')
            .prop('title', game.i18n.localize(`FORCECLIENTCONTROLS.ui.${modeKey}-hint`))
            .addClass(`fas ${icon} la-fcc-lock`)
            .css({ cursor: 'pointer', marginRight: '4px' }));
    }
    $row.find('.la-kb-add, .la-kb-key, .la-kb-reset').prop('disabled', ['hard-client', 'soft-client'].includes(modeKey));
}

// FCC only decorates Foundry's own controls config, so the Control tab grows its own locks.
/** @param {any} html */
function _injectControlLocks(html)
{
    const fcc = getFCCData();
    if (!fcc)
        return;
    const isGM = !!game.user?.isGM;
    const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));
    $html.find('.la-keybinding-row').each(function ()
    {
        const $row = $(this);
        const action = $row.attr('data-full-key');
        if (!action)
            return;
        const modeKey = getFCCModeKey(action, fcc, isGM);
        if (modeKey !== 'open-client')
            _renderFCCRowLock($row, modeKey);
    });
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

/** Snapshot form values into a Map so button callbacks see unsaved edits. */
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
 * Temporarily wraps `game.settings.get` so keys present in `formMap` return the form's current value, coerced to the registered setting type.
 * @param {Map<string, any>} formMap
 * @returns {() => void} restore function
 */
function _patchSettingsGet(formMap)
{
    const original = game.settings.get.bind(game.settings);
    // defineProperty, not assignment: libWrapper's accessor setter would keep this as a permanent override.
    const patched = function(namespace, key, options)
    {
        // set() fetches the current document through this.get
        if (namespace === MODULE_ID && formMap.has(key) && !options?.document)
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
        return original(namespace, key, options);
    };
    Object.defineProperty(game.settings, 'get', { value: patched, configurable: true, writable: true, enumerable: false });
    return () =>
    {
        delete game.settings.get;
    };
}

/** @param {any} $header @param {boolean} collapsed @param {boolean} [animate] */
function _toggleSection($header, collapsed, animate = false)
{
    const $box = $header.closest('.la-card, .la-sub');
    const $body = $box.children('.la-card-body, .la-sub-body').first();
    $box.toggleClass('collapsed', collapsed);
    $header.attr('aria-expanded', collapsed ? 'false' : 'true');
    if (!animate)
    {
        $body.toggle(!collapsed);
        return;
    }
    $body.stop(true, false);
    if (collapsed)
        $body.slideUp(150);
    else
        $body.slideDown(150);
}

const _slug = (/** @type {string} */ text) => String(text).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A section owns the rows after it, a subsection nests inside the current one.
/** @param {string} tabId @param {any[]} items */
function _groupSections(tabId, items)
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

function _dropEmptySections(sections)
{
    for (const section of sections)
        section.subs = section.subs.filter(sub => sub.items.length > 0);
    return sections.filter(section => section.items.length > 0 || section.subs.length > 0);
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
        /** @type {IntersectionObserver|null} */
        this._stripObserver = null;
    }

    static get defaultOptions()
    {
        const saved = _laConfigState;
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'lancer-automations-config',
            title: localize('LA.config.windowTitle'),
            template: TEMPLATE_PATH,
            width: saved?.width ?? 860,
            height: saved?.height ?? 820,
            top: saved?.top ?? undefined,
            left: saved?.left ?? undefined,
            resizable: true,
            closeOnSubmit: false,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            tabs: [{ navSelector: '.tabs', contentSelector: '.content', initial: saved?.tab ?? 'activations' }],
        });
    }

    getData()
    {
        const visible = _visibleTabs().map(tab =>
        {
            const items = _dropLockedItems(tab.fields.map(_buildItem).filter(Boolean));
            return { ...tab, sections: _dropEmptySections(_groupSections(tab.id, items)) };
        }).filter(tab => tab.sections.length > 0);
        const firstEnabledIdx = visible.findIndex(tab => !tab._disabled);
        const tabs = visible.map((tab, idx) =>
        {
            const sections = tab.sections;
            return {
                id: tab.id,
                label: localize(tab.label),
                icon: tab.icon,
                active: idx === Math.max(firstEnabledIdx, 0),
                disabled: tab._disabled,
                disabledReason: localize(tab._disabledReason),
                sections,
                settingCount: sections.reduce((sum, section) => sum + section.count, 0),
                sectionCount: sections.filter(section => !section.headerless).length,
            };
        });
        const tabController = this._tabs?.[0];
        if (tabController && !tabs.some(tab => tab.id === tabController.active))
            tabController.active = tabs.find(tab => tab.active)?.id ?? tabs[0]?.id;
        const grouped = new Set();
        const groups = NAV_GROUPS.map(group => ({
            label: localize(group.label),
            icon: group.icon,
            tabs: group.tabs.map(id => tabs.find(tab => tab.id === id)).filter(Boolean).map(tab => (grouped.add(tab.id), tab)),
        })).filter(group => group.tabs.length > 0);
        const leftover = tabs.filter(tab => !grouped.has(tab.id));
        if (leftover.length > 0)
            groups.push({ label: localize('LA.settingsMenus.navGroup.other.label'), icon: 'fas fa-ellipsis', tabs: leftover });
        return { tabs, groups };
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        const $html = /** @type {any} */ (html instanceof jQuery ? html : $(html));

        // Measured on hover rather than on render, so it stays right through resizes and tab switches
        const root = $html[0];
        if (root)
        {
            root.addEventListener('pointerover', event =>
            {
                const label = event.target?.closest?.('.la-opt-label');
                const text = label?.querySelector('.la-opt-label-text');
                if (!text)
                    return;
                const overflow = Math.round(text.scrollWidth - label.clientWidth);
                if (overflow <= 1)
                    return;
                label.style.setProperty('--la-pan', `-${overflow}px`);
                label.classList.add('la-pans');
            });

            root.addEventListener('pointerout', event =>
            {
                const label = event.target?.closest?.('.la-opt-label');
                if (label && !label.contains(event.relatedTarget))
                    label.classList.remove('la-pans');
            });
        }

        const scroller = $html.find('.la-config-content')[0];
        if (_laConfigState?.scroll != null && scroller)
        {
            requestAnimationFrame(() =>
            {
                scroller.scrollTop = _laConfigState.scroll;
            });
        }
        $html.find('.la-config-rail .item.la-tab-disabled').on('click', (/** @type {any} */ ev) =>
        {
            ev.preventDefault();
            ev.stopImmediatePropagation();
        });
        $html.find('.la-config-rail .item').on('click', () =>
        {
            if (scroller)
                scroller.scrollTop = 0;
        });
        $html.find('.la-config-rail').on('keydown', (/** @type {any} */ ev) =>
        {
            if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp')
                return;
            const items = $html.find('.la-config-rail .item:not(.la-tab-disabled)').toArray();
            const index = items.indexOf(document.activeElement);
            if (index < 0)
                return;
            ev.preventDefault();
            const next = items[(index + (ev.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
            next.focus();
            next.click();
        });
        $html.find('.la-config-rail .item').attr('tabindex', '0');

        for (const field of _fieldsWithRequirements())
        {
            const $target = $html.find(`[name="${field.key}"]`);
            if (!$target.length)
                continue;
            const keys = _requiredKeys(field);
            const isMet = (key) => _isRequirementMet($html, key);
            const $row = $target.closest('.form-group, .la-compact-bool');
            const $warning = $('<i class="fas fa-triangle-exclamation la-req-icon"></i>')
                .attr('data-tooltip', _requirementHint(field))
                .hide();
            ($row.find('label').first().length ? $row.find('label').first() : $row).append($warning);
            const syncRequirement = () =>
            {
                const met = field.requiresAll ? keys.every(isMet) : keys.some(isMet);
                $target.prop('disabled', !met);
                $row.toggleClass('la-req-unmet', !met);
                $warning.toggle(!met);
            };
            const watched = new Set();
            const watch = (key) =>
            {
                if (watched.has(key))
                    return;
                watched.add(key);
                for (const sub of _requiredKeys(_fieldByKey(key)))
                    watch(sub);
            };
            keys.forEach(watch);
            $html.find([...watched].map(key => `[name="${key}"]`).join(', ')).on('change', syncRequirement);
            syncRequirement();
        }
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
                    ui.notifications.warn(localizeFormat('LA.notify.keyReservedByFoundry', { key: ev.code }));
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
            placeholder.textContent = localize('LA.settingsMenus.pressKey');
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
            placeholder.textContent = localize('LA.settingsMenus.pressKey');
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
                    catch (error)
                    {
                        console.error(`lancer-automations | config button "${key}" failed:`, error);
                        ui.notifications?.error(localizeFormat('LA.notify.configButtonFailed', { label: matchedField.label }));
                    }
                    finally
                    {
                        restore();
                    }
                    if (typeof matchedField.state === 'function')
                        $(ev.currentTarget).find('.la-btn-state').text(matchedField.state());
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
        const $headers = $html.find('.la-collapsible');
        const sectionKey = (/** @type {any} */ $h) =>
        {
            const $box = $h.closest('.la-card, .la-sub');
            return `${$box.closest('.la-card').attr('id') ?? ''}:${$box.attr('data-label') ?? ''}`;
        };
        const applySectionState = (/** @type {any} */ h) =>
        {
            const $h = $(h);
            const label = sectionKey($h);
            const collapsed = this._sectionStates.has(label)
                ? this._sectionStates.get(label)
                : $h.closest('.la-card, .la-sub').hasClass('collapsed');
            _toggleSection($h, collapsed);
        };
        const applyAllSectionStates = () =>
        {
            $headers.each((/** @type {number} */ _i, /** @type {any} */ h) => applySectionState(h));
        };
        applyAllSectionStates();
        $headers.on('click', (/** @type {any} */ ev) =>
        {
            const $h = $(ev.currentTarget);
            const next = !$h.closest('.la-card, .la-sub').hasClass('collapsed');
            _toggleSection($h, next, true);
            this._sectionStates.set(sectionKey($h), next);
        });

        $html.find('.la-chip').on('click', (/** @type {any} */ ev) =>
        {
            const target = $html.find(`#${ev.currentTarget.dataset.target}`);
            if (!target.length)
                return;
            const $head = target.find('.la-collapsible').first();
            if (target.hasClass('collapsed') && $head.length)
            {
                _toggleSection($head, false);
                this._sectionStates.set(sectionKey($head), false);
            }
            if (!scroller)
            {
                target[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
                return;
            }
            const top = scroller.scrollTop + target[0].getBoundingClientRect().top - scroller.getBoundingClientRect().top;
            scroller.scrollTo({ top, behavior: 'smooth' });
        });
        if (scroller && typeof IntersectionObserver === 'function')
        {
            this._stripObserver?.disconnect();
            const visibleCards = new Set();
            this._stripObserver = new IntersectionObserver(entries =>
            {
                for (const entry of entries)
                {
                    if (entry.isIntersecting)
                        visibleCards.add(entry.target.id);
                    else
                        visibleCards.delete(entry.target.id);
                }
                $html.find('.la-chip').each((/** @type {number} */ _i, /** @type {any} */ chip) =>
                {
                    chip.classList.toggle('active', visibleCards.has(chip.dataset.target));
                });
            }, { root: scroller, threshold: 0.01 });
            $html.find('.la-card').each((/** @type {number} */ _i, /** @type {any} */ card) => this._stripObserver.observe(card));
        }
        this._bindTruncatedLabels($html);
        for (const tab of TAB_DEFS)
            _injectFCSLocks(html, tab.fields, this);
        _injectControlLocks(html);
        $html.off('click.laFccLock').on('click.laFccLock', '.la-fcc-lock', async (/** @type {any} */ ev) =>
        {
            ev.stopPropagation();
            const action = $(ev.currentTarget).closest('.la-keybinding-row').attr('data-full-key');
            if (!action || !getFCCData())
                return;
            await toggleFCCForce(ev, action);
            this.render(true);
        });
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
            const inputName = lockKey.startsWith(`${MODULE_ID}.`) ? lockKey.slice(MODULE_ID.length + 1) : `__ext.${lockKey}`;
            $html.find(`[name="${inputName}"]`).prop('disabled', ['hard-client', 'soft-client'].includes(newModeKey));
            // drop the search cache for this label so a re-search re-stashes the new icon
            $icon.closest('label').removeData('la-orig');
        });

        const $search = $html.find('.la-config-search-input');
        const $clear = $html.find('.la-config-search-clear');
        const escapeRe = (/** @type {string} */ str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapeHtml = (/** @type {string} */ str) => str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
        const ROW_SELECTOR = '.la-opt-row, .la-compact-bool, .la-keybinding-row, .la-tour-row, .la-config-table';
        const rowText = (/** @type {any} */ $row) =>
        {
            const hints = $row.find('[data-tooltip]').toArray().map((/** @type {any} */ el) => el.dataset.tooltip ?? '').join(' ');
            const own = $row.attr('data-tooltip') ?? '';
            const names = $row.find('[name]').toArray().map((/** @type {any} */ el) => el.getAttribute('name') ?? '').join(' ');
            return `${$row.text()} ${hints} ${own} ${names}`.toLowerCase();
        };
        const applyFilter = (query) =>
        {
            const normalizedQuery = (query || '').trim().toLowerCase();
            $clear.toggleClass('visible', !!normalizedQuery);
            this.element.find('form.la-config-form').toggleClass('la-searching', !!normalizedQuery);
            const re = normalizedQuery ? new RegExp(escapeRe(normalizedQuery), 'gi') : null;
            $html.find('.tab').each((/** @type {number} */ _i, /** @type {any} */ tab) =>
            {
                const $tab = $(tab);
                const $rows = $tab.find(ROW_SELECTOR);
                let tabHits = 0;
                if (!normalizedQuery)
                {
                    $rows.css('display', '');
                    $rows.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ el) => restore($(el)));
                    $tab.find('.la-card, .la-sub, .la-compact-bools').css('display', '');
                }
                else
                {
                    $rows.each((/** @type {number} */ _j, /** @type {any} */ el) =>
                    {
                        const $row = $(el);
                        const match = rowText($row).includes(normalizedQuery);
                        $row.css('display', match ? '' : 'none');
                        if (match)
                        {
                            tabHits++;
                            $row.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ child) => highlightIn($(child), /** @type {RegExp} */ (re)));
                        }
                        else
                            $row.find('label, .notes, .la-kb-name').each((/** @type {number} */ _k, /** @type {any} */ child) => restore($(child)));
                    });
                    const hasVisibleRow = (/** @type {any} */ $box) => $box.find(ROW_SELECTOR).toArray().some((/** @type {any} */ el) => el.style.display !== 'none');
                    $tab.find('.la-compact-bools').each((/** @type {number} */ _k, /** @type {any} */ el) => $(el).css('display', hasVisibleRow($(el)) ? '' : 'none'));
                    $tab.find('.la-sub').each((/** @type {number} */ _k, /** @type {any} */ el) => $(el).css('display', hasVisibleRow($(el)) ? '' : 'none'));
                    $tab.find('.la-card').each((/** @type {number} */ _k, /** @type {any} */ el) =>
                    {
                        const $card = $(el);
                        $card.css('display', hasVisibleRow($card) ? '' : 'none');
                        $card.removeClass('collapsed').children('.la-card-body').css('display', '');
                        $card.find('.la-sub').removeClass('collapsed').children('.la-sub-body').css('display', '');
                    });
                }
                $tab.toggleClass('la-no-hits', !!normalizedQuery && tabHits === 0);
                const $navItem = $html.find(`.la-config-rail .item[data-tab="${$tab.data('tab')}"]`);
                const $badge = $navItem.find('.la-rail-badge');
                $badge.text(normalizedQuery ? tabHits : ($badge.attr('data-count') ?? ''));
                $badge.toggleClass('hit', !!normalizedQuery && tabHits > 0);
                $navItem.toggleClass('la-dim', !!normalizedQuery && tabHits === 0);
            });
            if (!normalizedQuery)
                applyAllSectionStates();
            if (normalizedQuery)
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
        $search.on('keydown', (/** @type {any} */ ev) =>
        {
            if (ev.key === 'Escape' && $search.val())
            {
                ev.stopPropagation();
                $search.val('');
                applyFilter('');
            }
        });
        $clear.on('click', () =>
        {
            $search.val('');
            applyFilter('');
            $search.trigger('focus');
        });
        $html.on('keydown', (/** @type {any} */ ev) =>
        {
            if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'f')
            {
                ev.preventDefault();
                $search.trigger('focus');
                $search.trigger('select');
            }
        });
    }

    // Cut-off labels put their full text at the top of the row tooltip.
    _bindTruncatedLabels($html)
    {
        const measure = () =>
        {
            $html.find('.la-compact-label').each((/** @type {number} */ _i, /** @type {any} */ el) =>
            {
                const row = el.closest('.la-compact-bool');
                if (!row)
                    return;
                const full = (el.textContent ?? '').trim();
                if (row.dataset.laHint === undefined)
                    row.dataset.laHint = row.dataset.tooltip ?? '';
                const hint = row.dataset.laHint;
                const cut = el.scrollWidth > el.clientWidth + 1;
                el.classList.toggle('is-truncated', cut);
                const tooltip = cut ? (hint ? `<b>${full}</b><br>${hint}` : full) : hint;
                if (tooltip)
                    row.dataset.tooltip = tooltip;
                else
                    delete row.dataset.tooltip;
            });
        };
        measure();
        this._truncObserver?.disconnect();
        if (typeof ResizeObserver !== 'function')
            return;
        this._truncObserver = new ResizeObserver(() => measure());
        $html.find('.la-compact-bools').each((/** @type {number} */ _i, /** @type {any} */ el) => this._truncObserver.observe(el));
    }

    /** @param {'idle'|'saving'|'saved'} state */
    _setSaveState(state)
    {
        const button = this.element?.find?.('.la-config-save');
        if (!button?.length)
            return;
        clearTimeout(this._saveStateTimer);
        button.removeClass('is-saving is-saved').prop('disabled', state === 'saving');
        if (state === 'saving')
            button.addClass('is-saving').html('<i class="fas fa-circle-notch fa-spin"></i> Saving');
        else if (state === 'saved')
        {
            button.addClass('is-saved').html('<i class="fas fa-check"></i> Saved');
            this._saveStateTimer = setTimeout(() => this._setSaveState('idle'), 1600);
        }
        else
            button.html('<i class="fas fa-save"></i> Save');
    }

    async _updateObject(_event, formData)
    {
        this._setSaveState('saving');
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
            if (!_extNamespaceActive(moduleId))
                continue;
            if (!_canWrite(moduleId, settingKey))
                continue;
            try
            {
                const targetSetting = game.settings.settings.get(`${moduleId}.${settingKey}`);
                const raw = formData[formKey];
                await game.settings.set(moduleId, settingKey, _coerceExtValue(targetSetting, raw));
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
                if (!_extNamespaceActive(f.module))
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
                const existing = getModuleSetting('statusFXConfig') ?? {};
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
            let newValue = formData[f.key];
            if (f.type === 'number' || f.type === 'slider')
                newValue = Number(newValue);
            if (f.type === 'boolean')
                newValue = !!newValue;
            try
            {
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`);
                const prev = getModuleSetting(f.key);
                if (prev !== newValue && setting?.requiresReload)
                    this._needsReload = true;
                await game.settings.set(MODULE_ID, f.key, newValue);
            }
            catch (e)
            {
                console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
            }
        }
        this._setSaveState('saved');
        await this._promptReload();
    }

    async _promptReload()
    {
        if (!this._needsReload)
            return;
        this._needsReload = false;
        const reload = await Dialog.confirm({
            title: localize('LA.dialogTitle.reloadRequired'),
            content: localize('LA.settingsMenus.content.oneOrMoreChangesRequireA'),
            yes: () => true,
            no: () => false,
            defaultYes: true,
        });
        if (reload)
            foundry.utils.debouncedReload();
    }

    async close(options)
    {
        clearTimeout(this._saveStateTimer);
        this._truncObserver?.disconnect();
        try
        {
            const root = this.element?.[0];
            const activeNav = /** @type {any} */ (root?.querySelector('.tabs .item.active'));
            const scroller = root?.querySelector('.la-config-content');
            this._stripObserver?.disconnect();
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
        const closeResult = await super.close(options);
        await this._promptReload();
        return closeResult;
    }
}

export function registerSettingsMenus()
{
    game.settings.registerMenu(MODULE_ID, 'lancerAutomationsConfigMenu', {
        name: 'LA.settings.lancerAutomationsConfigMenu.name',
        label: 'LA.settings.lancerAutomationsConfigMenu.label',
        hint: 'LA.settings.lancerAutomationsConfigMenu.hint',
        icon: 'fas fa-sliders-h',
        type: LancerAutomationsConfig,
        restricted: false,
    });
}
