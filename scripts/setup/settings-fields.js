import { ReactionReset } from '../activations/reaction-reset.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { tfGetTeams } from '../tools/token-factions-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
import { setLAFlag } from '../tools/flag-utils.js';
import { ReactionExport, ReactionImport } from '../activations/reaction-export-import.js';
import { repairLCPData, syncAllActorImgs, syncAllTokenHeights } from './lancer-modif.js';
import { openNewsHistory } from './news.js';
import { openBattleLogGMCardTest, openBattleLogRecapTest } from '../Battelog/battlelog.js';
import { openTelemetryDebugWindow } from '../Battelog/telemetry-debug.js';
import { runSettingsOnboarding } from './settings-onboarding.js';
import { resetPaletteColorSettings } from '../interactive/canvas-helpers.js';
import { importTemplateMacroPresets } from './tmac-presets.js';
import { syncTemplateActors } from '../tools/template-actors.js';

import { MODULE_ID } from '../tools/constants.js';
import { STATUS_FX_KEYS } from '../fx/statusFX.js';

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
    { key: 'enablePerRoundTurnTags', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.scan.label' },
    { key: 'scanJournalSource', type: 'select', label: 'LA.settingsMenus.scanJournalSource.label', hint: 'LA.settingsMenus.scanJournalSource.hint' },
    { key: 'scanPlayerOwnershipMode', type: 'select', label: 'LA.settingsMenus.scanPlayerOwnershipMode.label', hint: 'LA.settingsMenus.scanPlayerOwnershipMode.hint' },
    { key: 'scanRevealMode', type: 'select', mergedFrom: ['revealStatsWithoutScan', 'scanRevealPlayers', 'scanRevealAllies'] },
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
    { key: 'attackTargeting', type: 'select', mergedFrom: ['enableAttackTargeting', 'autoStartTargetPicking'] },
    { key: 'areaSpread', type: 'boolean' },
    { key: 'enableDamageTargeting', type: 'boolean' },
    { key: 'statRollTargeting', type: 'boolean' },
    { key: 'clearTargetsAfterRoll', type: 'boolean', requires: ['attackTargeting!=off', 'enableDamageTargeting'] },
    { key: 'targetInfoDisplay', type: 'select' },
    { key: 'haseChanceLabels', type: 'boolean', label: 'LA.settingsMenus.haseChanceLabels.label', hint: 'LA.settingsMenus.haseChanceLabels.hint', nested: true, hideUnmet: true, requires: 'targetInfoDisplay!=off' },
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

    { type: 'section', label: 'LA.settingsMenus.section.combatCarousel.label', collapsible: true, collapsed: true },
    { key: 'combatCarousel', type: 'boolean' },
    { key: 'carouselPortraitSize', type: 'slider', requires: 'combatCarousel' },
    { key: 'carouselLength', type: 'slider', requires: 'combatCarousel' },
    { key: 'carouselMaxOverlap', type: 'slider', requires: 'combatCarousel' },
    { key: 'carouselDeckSlide', type: 'slider', requires: 'combatCarousel' },

    { type: 'section', label: 'LA.settingsMenus.section.movementBoost.label', collapsible: true, collapsed: true },
    { key: 'enableBoostOffer', type: 'select' },
    { key: 'count3DDistance', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.structureDamage.label', collapsible: true, collapsed: true },
    { key: 'enableAltStruct', type: 'boolean' },
    { key: 'enableOneStructNpc', type: 'boolean' },
    { key: 'enableInfectionDamageIntegration', type: 'boolean' },
    { key: 'convertHeatToEnergyOnHeatless', type: 'boolean' },
    { key: 'resistSelfHeat', type: 'boolean' },
];

const RULER_MEASURE_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.lancerAutomationsRuler.label', collapsible: true },
    { key: 'enableBuiltinSpeedProvider', type: 'boolean', label: 'LA.settingsMenus.enableBuiltinSpeedProvider.label', hint: 'LA.settingsMenus.enableBuiltinSpeedProvider.hint' },
    { key: 'rulerPerStepRender', type: 'boolean', label: 'LA.settingsMenus.rulerPerStepRender.label', hint: 'LA.settingsMenus.rulerPerStepRender.hint', nested: true, hideUnmet: true, requires: 'enableBuiltinSpeedProvider' },
    { key: 'enableClimbWaypoints', type: 'boolean', label: 'LA.settingsMenus.enableClimbWaypoints.label', hint: 'LA.settingsMenus.enableClimbWaypoints.hint', nested: true, hideUnmet: true, requires: 'enableBuiltinSpeedProvider' },
    { key: 'pathfindDragMovement', type: 'boolean', label: 'LA.settingsMenus.pathfindDragMovement.label', hint: 'LA.settingsMenus.pathfindDragMovement.hint', nested: true, hideUnmet: true, requires: ['enableBuiltinSpeedProvider', 'rulerPerStepRender'], requiresAll: true },
    { key: 'enableObstructionStepOver', type: 'boolean', label: 'LA.settingsMenus.enableObstructionStepOver.label', hint: 'LA.settingsMenus.enableObstructionStepOver.hint', nested: true, hideUnmet: true, requires: 'enableBuiltinSpeedProvider' },
    { key: 'rulerLabelScale', type: 'slider', label: 'LA.settingsMenus.rulerLabelScale.label', min: 0.5, max: 2, step: 0.05, hint: 'LA.settingsMenus.rulerLabelScale.hint', nested: true, hideUnmet: true, requires: 'enableBuiltinSpeedProvider' },
    { key: 'rulerLabelMinZoomScale', type: 'slider', label: 'LA.settingsMenus.rulerLabelMinZoomScale.label', min: 0, max: 2, step: 0.1, hint: 'LA.settingsMenus.rulerLabelMinZoomScale.hint', nested: true, hideUnmet: true, requires: 'enableBuiltinSpeedProvider' },
    { key: 'splitMovementAtTriggerBoundaries', type: 'boolean', label: 'LA.settingsMenus.splitMovementAtTriggerBoundaries.label', hint: 'LA.settingsMenus.splitMovementAtTriggerBoundaries.hint' },
    { key: 'splitMovementAtSpeedTiers', type: 'boolean', label: 'LA.settingsMenus.splitMovementAtSpeedTiers.label', hint: 'LA.settingsMenus.splitMovementAtSpeedTiers.hint' },
    { key: 'terrainElevationMode', type: 'select', mergedFrom: ['disableAutoTerrainElevation', 'disableAutoElevationOnMeasure'] },
    { key: 'measureRulerSnapToCenter', type: 'boolean', label: 'LA.settingsMenus.measureRulerSnapToCenter.label', hint: 'LA.settingsMenus.measureRulerSnapToCenter.hint' },
    { type: 'section', label: 'LA.settingsMenus.section.noStepOver.label', hint: 'LA.settingsMenus.section.noStepOver.hint', collapsible: false, subsection: true },
    { type: 'compactBooleans',
        requires: 'enableObstructionStepOver',
        items: [
            { key: 'obstructionBlocksVehicle', label: 'LA.settingsMenus.obstructionBlocksVehicle.label' },
            { key: 'obstructionBlocksSquad', label: 'LA.settingsMenus.obstructionBlocksSquad.label' },
            { key: 'obstructionBlocksHuman', label: 'LA.settingsMenus.obstructionBlocksHuman.label' },
            { key: 'obstructionBlocksSpecialist', label: 'LA.settingsMenus.obstructionBlocksSpecialist.label' }
        ]
    },

    { type: 'section', label: 'LA.settingsMenus.section.tacticalDistanceLabels.label', collapsible: true, collapsed: true },
    { key: 'enableTacticalDistance', type: 'select', label: 'LA.settingsMenus.enableTacticalDistance.label', hint: 'LA.settingsMenus.enableTacticalDistance.hint' },
    { key: 'tacticalLabelPosition', type: 'select', label: 'LA.settingsMenus.tacticalLabelPosition.label', requires: 'enableTacticalDistance!=off' },
    { key: 'tacticalMinZoomScale', type: 'slider', label: 'LA.settingsMenus.tacticalMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.tacticalMinZoomScale.hint', requires: 'enableTacticalDistance!=off' },
    { key: 'tacticalElevationStep', type: 'number', label: 'LA.settingsMenus.tacticalElevationStep.label', hint: 'LA.settingsMenus.tacticalElevationStep.hint', requires: 'enableTacticalDistance!=off' },

    { type: 'section', label: 'LA.settingsMenus.section.advancedMeasure.label', collapsible: true, collapsed: true },
    { key: 'ctrlRulerMode', type: 'select', label: 'LA.settingsMenus.ctrlRulerMode.label', hint: 'LA.settingsMenus.ctrlRulerMode.hint' },
    { key: 'rulerToolCursor', type: 'boolean', label: 'LA.settingsMenus.rulerToolCursor.label', hint: 'LA.settingsMenus.rulerToolCursor.hint' },
];

const WRECK_AURA_REQUIRES = ['mech', 'vehicle', 'human', 'monstrosity', 'biological'].map(category => `wreckTerrain_${category}=aura`);

const WRECKS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.wreckGeneration.label' },
    { key: 'enableWrecks', type: 'boolean' },
    { key: 'enableRemoveFromCombat', type: 'boolean' , requires: 'enableWrecks' },
    { key: 'squadLostOnDeath', type: 'boolean' , requires: 'enableWrecks' },

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
    { key: 'wreckAuraColor', type: 'color', nested: true, hideUnmet: true, requires: WRECK_AURA_REQUIRES },
    { key: 'wreckAuraOpacity', type: 'slider', min: 0, max: 1, step: 0.05, nested: true, hideUnmet: true, requires: WRECK_AURA_REQUIRES },
    { key: 'wreckFactionOnDeath',
        type: 'select',
        label: 'LA.settingsMenus.wreckFactionOnDeath.label',
        hint: 'LA.settingsMenus.wreckFactionOnDeath.hint',
        getChoices: () =>
        {
            const cur = getModuleSetting('wreckFactionOnDeath') || 'same';
            const choices = [
                { value: 'same', label: 'LA.settingsMenus.choice.same.label', selected: cur === 'same' },
                { value: 'neutral', label: 'LA.settingsMenus.choice.neutral.label', selected: cur === 'neutral' },
            ];
            for (const team of tfGetTeams())
                choices.push({ value: team.id, label: team.name, selected: team.id === cur });
            return choices;
        },
        requires: 'enableWrecks' },

    { type: 'section', label: 'LA.settingsMenus.section.assetsAudio.label', collapsible: true, collapsed: true },
    { key: 'wreckAssetsPath', type: 'folder', label: 'LA.settingsMenus.wreckAssetsPath.label' , requires: 'enableWrecks' },
    { key: 'enableWreckAnimation', type: 'boolean' , requires: 'enableWrecks' },
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
    { key: 'defaultDeployableArt', type: 'boolean' },
    { key: 'deployableArtScale', type: 'number', min: 0.5, max: 3, step: 0.1, requires: 'defaultDeployableArt' },
    { key: 'showDeployableLines', type: 'boolean' },
    { key: 'allowHalfSizeTokens', type: 'boolean' },
    { key: 'overlapTokenPicker', type: 'boolean' },
    { type: 'button',
        key: 'toggleLancerFloatingNumbers',
        label: 'LA.settingsMenus.toggleLancerFloatingNumbers.label',
        hint: 'LA.settingsMenus.toggleLancerFloatingNumbers.hint',
        icon: 'fas fa-arrows-alt-v',
        clientAllowed: true,
        state: () => localize(game.settings.get('lancer', 'floatingNumbers') ? 'LA.common.on' : 'LA.common.off'),
        onClick: async () =>
        {
            const before = !!game.settings.get('lancer', 'floatingNumbers');
            await game.settings.set('lancer', 'floatingNumbers', !before);
            ui.notifications?.info(localizeFormat('LA.notify.floatingNumbers', { state: localize(!before ? 'LA.common.on' : 'LA.common.off') }));
        },
    },
    { type: 'section', label: 'LA.settingsMenus.section.groundShadow.label', hint: 'LA.settingsMenus.section.groundShadow.hint', subsection: true },
    { key: 'tokenGroundShadowOpacity', type: 'slider' },
    { key: 'tokenGroundShadowThrow', type: 'slider', requires: 'tokenGroundShadowOpacity!=0' },

    { type: 'section', label: 'LA.settingsMenus.section.autoFocus.label', collapsible: true, collapsed: true },
    { key: 'autoFocusEnabled', type: 'boolean', mergedFrom: ['autoFocusCards', 'autoFocusAttack', 'autoFocusDamage', 'autoFocusCheck', 'autoFocusActivation'] },
    { key: 'autoFocusDuration', type: 'slider', min: 200, max: 3000, step: 100, nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { key: 'autoFocusCards', type: 'boolean', nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { key: 'autoFocusAttack', type: 'boolean', nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { key: 'autoFocusDamage', type: 'boolean', nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { key: 'autoFocusCheck', type: 'boolean', nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { key: 'autoFocusActivation', type: 'boolean', nested: true, hideUnmet: true, requires: 'autoFocusEnabled' },
    { type: 'section', label: 'LA.settingsMenus.section.focusedActions.label', collapsible: true, collapsed: true, subsection: true },
    { type: 'compactBooleans', items: FOCUS_ACTION_CATEGORIES.map((category) => ({ key: `autoFocusAction.${category.key}`, label: category.label })) },

    { type: 'section', label: 'LA.settingsMenus.section.tokenHudButtons.label', collapsible: true, collapsed: true },
    { type: 'compactBooleans',
        items: [
            { key: 'showStatusEffectsHudButton', label: 'LA.settingsMenus.showStatusEffectsHudButton.label' },
            { key: 'showCombatStateHudButton', label: 'LA.settingsMenus.showCombatStateHudButton.label' },
            { key: 'showTargetStateHudButton', label: 'LA.settingsMenus.showTargetStateHudButton.label' },
            { key: 'showBonusHudButton', label: 'LA.settingsMenus.showBonusHudButton.label' },
            { key: 'showRevertMovementHudButton', label: 'LA.settingsMenus.showRevertMovementHudButton.label' },
        ]
    },
    { type: 'moduleBoolean', module: 'temporary-custom-statuses', key: 'enableHud', label: 'LA.settingsMenus.enableHud.label' },

    { type: 'section', label: 'LA.settingsMenus.section.statusIcons.label', collapsible: true, collapsed: true },
    { key: 'statusHalo', type: 'boolean' },
    { key: 'statusHaloRadius', type: 'slider', min: 0.5, max: 2, step: 0.05, nested: true, hideUnmet: true, requires: ['statusHalo', 'module:status-halo'] },
    { key: 'statusHaloStartAngle', type: 'slider', min: 0, max: 360, step: 5, nested: true, hideUnmet: true, requires: ['statusHalo', 'module:status-halo'] },
    { key: 'statBarEffectIconScale', type: 'slider', label: 'LA.settingsMenus.statBarEffectIconScale.label', min: 0.3, max: 2, step: 0.05 },
    { key: 'statusIconMinZoomScale', type: 'slider', label: 'LA.settingsMenus.statusIconMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.statusIconMinZoomScale.hint' },
    { key: 'statusIconHover', type: 'boolean' },
    { key: 'statusBadgeFontScale', type: 'slider', min: 0.5, max: 2, step: 0.05 },
];

const STAT_BARS_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.customTokenStatBars.label', collapsible: true },
    { key: 'tokenStatBar', type: 'boolean', label: 'LA.settingsMenus.tokenStatBar.label', hint: 'LA.settingsMenus.tokenStatBar.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.display.label', subsection: true },
    { key: 'statBarShowValues', type: 'boolean', label: 'LA.settingsMenus.statBarShowValues.label', hint: 'LA.settingsMenus.statBarShowValues.hint' , requires: 'tokenStatBar' },
    { key: 'statBarMinZoomScale', type: 'slider', label: 'LA.settingsMenus.statBarMinZoomScale.label', min: 0, max: 4, step: 0.1, hint: 'LA.settingsMenus.statBarMinZoomScale.hint' , requires: 'tokenStatBar' },
    { key: 'statBarElevationBadgeScale', type: 'slider', label: 'LA.settingsMenus.statBarElevationBadgeScale.label', min: 0.5, max: 3, step: 0.05, hint: 'LA.settingsMenus.statBarElevationBadgeScale.hint' , requires: 'tokenStatBar' },

    { type: 'section', label: 'LA.settingsMenus.section.statBarTokenWidth.label', subsection: true },
    { type: 'compactBooleans',
        requires: 'tokenStatBar',
        items: [
            { key: 'statBarTokenWidthMech', label: 'LA.settingsMenus.statBarTokenWidthMech.label', hint: 'LA.settingsMenus.statBarTokenWidth.hint' },
            { key: 'statBarTokenWidthNpc', label: 'LA.settingsMenus.statBarTokenWidthNpc.label', hint: 'LA.settingsMenus.statBarTokenWidth.hint' },
            { key: 'statBarTokenWidthDeployable', label: 'LA.settingsMenus.statBarTokenWidthDeployable.label', hint: 'LA.settingsMenus.statBarTokenWidth.hint' }
        ]
    },

    { type: 'section', label: 'LA.settingsMenus.section.perTokenDefaults.label', subsection: true },
    { key: 'statBarDefaultHidden', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultHidden.label' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultCombatOnly', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultCombatOnly.label' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultAlwaysShow', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultAlwaysShow.label', hint: 'LA.settingsMenus.statBarDefaultAlwaysShow.hint', requires: 'tokenStatBar' },
    { key: 'statBarDefaultRowHeight', type: 'number', label: 'LA.settingsMenus.statBarDefaultRowHeight.label', hint: 'LA.settingsMenus.statBarDefaultRowHeight.hint' , requires: 'tokenStatBar' },
    { key: 'statBarDefaultPilotStress', type: 'boolean', label: 'LA.settingsMenus.statBarDefaultPilotStress.label', hint: 'LA.settingsMenus.statBarDefaultPilotStress.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.visibility.label', subsection: true },
    { key: 'statBarVisibilityOutOfCombat', type: 'select', label: 'LA.settingsMenus.statBarVisibilityOutOfCombat.label', getChoices: () => _statBarVisChoices('statBarVisibilityOutOfCombat') , requires: 'tokenStatBar' },
    { key: 'statBarVisibilityInCombat',   type: 'select', label: 'LA.settingsMenus.statBarVisibilityInCombat.label',   getChoices: () => _statBarVisChoices('statBarVisibilityInCombat') , requires: 'tokenStatBar' },
    { key: 'statBarFlashFollowsVisibility', type: 'boolean', label: 'LA.settingsMenus.statBarFlashFollowsVisibility.label', hint: 'LA.settingsMenus.statBarFlashFollowsVisibility.hint' , requires: 'tokenStatBar' },

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

    { type: 'section', label: 'LA.settingsMenus.section.tokenStatHint.label', collapsible: true },
    { key: 'tokenStatHintEnabled', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintEnabled.label', hint: 'LA.settingsMenus.tokenStatHintEnabled.hint' },
    { key: 'tokenStatHintDelayMs', type: 'slider', label: 'LA.settingsMenus.tokenStatHintDelayMs.label', min: 0, max: 2000, step: 50, hint: 'LA.settingsMenus.tokenStatHintDelayMs.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintPlacement', type: 'select', requires: 'tokenStatHintEnabled', mergedFrom: ['tokenStatHintDocked', 'tokenStatHintScaleWithZoom'] },
    { key: 'tokenStatHintEffectsMode',
        type: 'select',
        label: 'LA.settingsMenus.tokenStatHintEffectsMode.label',
        choices: [
            { value: 'icons', label: 'LA.settingsMenus.choice.icons.label' },
            { value: 'names', label: 'LA.settingsMenus.choice.names.label' },
        ],
        hint: 'LA.settingsMenus.tokenStatHintEffectsMode.hint',
        requires: 'tokenStatHintPlacement=docked' },
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
    { key: 'tokenStatHintUnknownLabel', type: 'string', label: 'LA.settingsMenus.tokenStatHintUnknownLabel.label', hint: 'LA.settingsMenus.tokenStatHintUnknownLabel.hint', requires: 'tokenStatHintLabelMode=scan' },
    { key: 'tokenStatHintHideClassWhenUnknown', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintHideClassWhenUnknown.label', hint: 'LA.settingsMenus.tokenStatHintHideClassWhenUnknown.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintHideCurrentOnScan', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintHideCurrentOnScan.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentOnScan.hint' , requires: 'tokenStatHintEnabled' },
    { key: 'tokenStatHintShowHase', type: 'boolean', label: 'LA.settingsMenus.tokenStatHintShowHase.label', hint: 'LA.settingsMenus.tokenStatHintShowHase.hint', requires: 'tokenStatHintEnabled' },
    { type: 'section', label: 'LA.settingsMenus.section.alsoHideCurrentValuesFrom.label', hint: 'LA.settingsMenus.section.alsoHideCurrentValuesFrom.hint', collapsible: false, subsection: true },
    { type: 'compactBooleans',
        items: [
            { key: 'tokenStatHintHideCurrentFromAllies', label: 'LA.settingsMenus.tokenStatHintHideCurrentFromAllies.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentFromAllies.hint', requires: ['tokenStatHintEnabled', 'tokenStatHintHideCurrentOnScan'], requiresAll: true },
            { key: 'tokenStatHintHideCurrentFromPlayers', label: 'LA.settingsMenus.tokenStatHintHideCurrentFromPlayers.label', hint: 'LA.settingsMenus.tokenStatHintHideCurrentFromPlayers.hint', requires: ['tokenStatHintEnabled', 'tokenStatHintHideCurrentOnScan'], requiresAll: true },
        ]
    },
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
    { key: 'tah.openMode', type: 'select', label: 'LA.settingsMenus.tah.openMode.label', requires: 'tahEnabled', mergedFrom: ['tah.clickToOpen'] },
    { key: 'tah.hoverCloseDelay', type: 'number', nested: true, hideUnmet: true, requires: 'tah.openMode=hover' },
    { key: 'tah.maxColumnItems', type: 'number' , requires: 'tahEnabled' },
    { key: 'tah.wheelRadiusOffset', type: 'slider', label: 'LA.settingsMenus.tah.wheelRadiusOffset.label', min: -40, max: 120, step: 5, requires: 'tahEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.keyboard.label', collapsible: true, collapsed: true },
    { key: 'tah.keyboardNav', type: 'boolean' , requires: 'tahEnabled' },
    { key: 'tah.keyboardNavResetDelay', type: 'number', nested: true, hideUnmet: true, requires: ['tah.keyboardNav', 'tah.openMode=hover'], requiresAll: true },
    { key: 'tah.preventWasdMovement', type: 'boolean' },

    { type: 'section', label: 'LA.settingsMenus.section.rangesDisplay.label', collapsible: true, collapsed: true },
    { key: 'tah.uiScale', type: 'slider', label: 'LA.settingsMenus.tah.uiScale.label', min: 0.6, max: 1.6, step: 0.05 },
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
            await setLAFlag(game.user,'tahFavorites3', []);
            Hooks.callAll('forceUpdateTokenActionHud', { patch: true });
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
    { key: 'wreckMasterVolume', type: 'slider', label: 'LA.settingsMenus.wreckMasterVolume.label', min: 0, max: 1.5, step: 0.1 , requires: 'enableWrecks' },
    { key: 'tah.battleLogVolume', type: 'slider', label: 'LA.settingsMenus.tah.battleLogVolume.label', min: 0, max: 1.5, step: 0.05 },
    { key: 'tah.battleLog.themeVolume',
        type: 'slider',
        label: 'LA.settingsMenus.tah.battleLog.themeVolume.label',
        min: 0.5, max: 2, step: 0.05,
        hint: 'LA.settingsMenus.tah.battleLog.themeVolume.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.uiSounds.label', collapsible: true, collapsed: true },
    { key: 'tah.uiSoundVolume', type: 'slider', label: 'LA.settingsMenus.tah.uiSoundVolume.label', min: 0, max: 1.5, step: 0.05 },
    { type: 'compactBooleans', items: UI_VARIANTS.map(([variant, label]) => ({ key: `tah.uiSound.${variant}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.tokenFeedback.label', collapsible: true, collapsed: true },
    { key: 'tah.tokenFeedbackVolume', type: 'slider', label: 'LA.settingsMenus.tah.tokenFeedbackVolume.label', min: 0, max: 1.5, step: 0.05 },
    { type: 'compactBooleans', items: TOKEN_VARIANTS.map(([variant, label]) => ({ key: `tah.tokenSound.${variant}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.damageTypeSounds.label', collapsible: true, collapsed: true },
    { key: 'tah.damageSoundVolume', type: 'slider', label: 'LA.settingsMenus.tah.damageSoundVolume.label', min: 0, max: 1.5, step: 0.05 },
    { type: 'compactBooleans', items: DAMAGE_TYPES.map(([damageType, label]) => ({ key: `tah.damageSound.${damageType}`, label, preview: true })) },
    { type: 'section', label: 'LA.settingsMenus.section.statFeedback.label', collapsible: true, collapsed: true, subsection: true },
    { type: 'compactBooleans', items: STAT_EVENTS.map(([statEvent, label]) => ({ key: `tah.statSound.${statEvent}`, label, preview: true })) },
    { type: 'section', label: 'LA.settingsMenus.section.statusSfx.label', collapsible: true, collapsed: true, subsection: true },
    { type: 'compactBooleans', items: STATUS_SFX_EVENTS.map(([sfxEvent, label]) => ({ key: `tah.statusSfx.${sfxEvent}`, label, preview: true })) },

    { type: 'section', label: 'LA.settingsMenus.section.actionFxAudio.label', collapsible: true, collapsed: true },
    { key: 'tah.actionFxVolume', type: 'slider', label: 'LA.settingsMenus.tah.actionFxVolume.label', min: 0, max: 1.5, step: 0.05 },
    { type: 'compactBooleans', requires: '_sfx.actionFX', items: ACTION_FX_KEYS.map(([actionKey, label]) => ({ key: `tah.actionFxSound.${actionKey}`, label, preview: true })) },
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
    { key: 'shortStatusTexts', type: 'boolean' },
    { key: 'effectNotificationMode', type: 'select', label: 'LA.settingsMenus.effectNotificationMode.label' },
    { type: 'statusFx', sub: 'master', label: 'LA.settingsMenus.statusFx.master.label', hint: 'LA.settingsMenus.statusFx.master.hint' },
    { type: 'statusFx', sub: 'actionFX', label: 'LA.settingsMenus.statusFx.actionFX.label', hint: 'LA.settingsMenus.statusFx.actionFX.hint' },
    { key: 'actionBadgeItemName', type: 'boolean', label: 'LA.settingsMenus.actionBadgeItemName.label', hint: 'LA.settingsMenus.actionBadgeItemName.hint', nested: true, hideUnmet: true, requires: '_sfx.actionFX' },
    { type: 'statusFx', sub: 'rollResultFX', label: 'LA.settingsMenus.statusFx.rollResultFX.label', hint: 'LA.settingsMenus.statusFx.rollResultFX.hint' },
    { type: 'statusFx', sub: 'damageImpactFX', label: 'LA.settingsMenus.statusFx.damageImpactFX.label', hint: 'LA.settingsMenus.statusFx.damageImpactFX.hint' },
    { type: 'statusFx', sub: 'removeStatusesOnDeath', label: 'LA.settingsMenus.statusFx.removeStatusesOnDeath.label', hint: 'LA.settingsMenus.statusFx.removeStatusesOnDeath.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.visualEffects.label', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_VISUAL, requires: '_sfx.master' },
    { key: 'weaponFxAboveTokens', type: 'boolean' },
    { key: 'guardianBulwarkAuraMode', type: 'select', label: 'LA.settingsMenus.guardianBulwarkAuraMode.label', hint: 'LA.settingsMenus.guardianBulwarkAuraMode.hint' },

    { type: 'section', label: 'LA.settingsMenus.section.autoStatusIcons.label', collapsible: true, collapsed: true },
    { type: 'compactStatusFx', items: STATUS_FX_AUTO, requires: '_sfx.master' },
];

const DEBUG_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.debugToggles.label' },
    { key: 'debugMovement', type: 'boolean', label: 'LA.settingsMenus.debugMovement.label', mergedFrom: ['debugPathHexCalculation'] },
    { key: 'debugOutOfCombat', type: 'boolean', label: 'LA.settingsMenus.debugOutOfCombat.label' },
    { key: 'debugForceJb2aFree', type: 'boolean', label: 'LA.settingsMenus.debugForceJb2aFree.label' },
    { key: 'debugAutomation', type: 'boolean', label: 'LA.settingsMenus.debugAutomation.label' },
    { key: 'iso.debugSelectionOverlay', type: 'boolean', label: 'LA.settingsMenus.iso.debugSelectionOverlay.label' },
    { key: 'lancerLosDebug', type: 'boolean' },
    { key: 'visionFromEdgeDebug', type: 'boolean', label: 'LA.settingsMenus.visionFromEdgeDebug.label' },
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
];

const VISION_FIELDS = [
    { type: 'section', label: 'LA.settingsMenus.section.visionRules.label' },
    { key: 'basicSightTo999', type: 'boolean' },
    { key: 'bulwarkBlocksLineOfSight', type: 'boolean', hideUnmet: true, requires: 'additionalStatuses' },
    { key: 'blindedSetsVision', type: 'boolean' },
    { key: 'rangePulseLos', type: 'boolean', label: 'LA.settingsMenus.rangePulseLos.label' },

    { type: 'section', label: 'LA.settingsMenus.section.lancerVisionModes.label', hint: 'LA.settingsMenus.section.lancerVisionModes.hint' },
    { key: 'lancerVisionAutoAdd', type: 'boolean' },
    { key: 'lancerLos', type: 'boolean' },
    { key: 'lancerLosAttackHover', type: 'boolean', nested: true, hideUnmet: true, requires: 'lancerLos' },
    { key: 'lancerLosPeekRange', type: 'number', nested: true, hideUnmet: true, requires: ['lancerLos', 'lancerLosHeightRule=trig'], requiresAll: true },
    { key: 'lancerLosFlagOnly', type: 'boolean' },
    { key: 'lancerLosHeightRule', type: 'select' },
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
    { key: 'visionFromEdgeSampleMode', type: 'select', label: 'LA.settingsMenus.visionFromEdgeSampleMode.label', softRequires: true, requires: 'visionFromEdgeEnabled' },
    { key: 'visionFromEdgeSampleOffset', type: 'number', label: 'LA.settingsMenus.visionFromEdgeSampleOffset.label', softRequires: true, requires: 'visionFromEdgeEnabled' },

    { type: 'section', label: 'LA.settingsMenus.section.dragVision.label', collapsible: true, collapsed: true },
    { key: 'dragVisionMode', type: 'select' },
    { key: 'dragVisionMultiplier', type: 'number', nested: true, hideUnmet: true, requires: 'dragVisionMode!=full' },
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
    { type: 'statusFx', sub: 'lowQuality', default: false, label: 'LA.settingsMenus.statusFx.lowQuality.label', hint: 'LA.settingsMenus.statusFx.lowQuality.hint', requires: '_sfx.master' },
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
        key: 'syncTemplateActors',
        label: 'LA.settingsMenus.syncTemplateActors.label',
        icon: 'fas fa-rotate',
        hint: 'LA.settingsMenus.syncTemplateActors.hint',
        onClick: () => syncTemplateActors({ force: true }),
    },
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
    ...Array.from({ length: 9 }, (unused, index) => laKb(`tahNavRow${index + 1}`)),
    laKb('tah.escape'),

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
    laKb('advancedMeasureNextSource'),
    laKb('advancedMeasureClear'),
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

    { type: 'section', label: 'LA.settingsMenus.section.themeMusic.label', collapsible: true, collapsed: true },
    { key: 'tah.battleLog.themeStart',
        type: 'select',
        label: 'LA.settingsMenus.tah.battleLog.themeStart.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeStart.hint',
        requires: 'battleLogEnabled' },
    { key: 'tah.battleLog.themeLoop',
        type: 'boolean',
        label: 'LA.settingsMenus.tah.battleLog.themeLoop.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeLoop.hint',
        requires: 'battleLogEnabled' },
    { key: 'tah.battleLog.themeDefault',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeDefault.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeDefault.hint',
        requires: 'battleLogEnabled' },
    { key: 'tah.battleLog.themeVictory',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeVictory.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeVictory.hint',
        requires: 'battleLogEnabled' },
    { key: 'tah.battleLog.themeDefeat',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themeDefeat.label',
        hint: 'LA.settingsMenus.tah.battleLog.themeDefeat.hint',
        requires: 'battleLogEnabled' },
    { key: 'tah.battleLog.themePartial',
        type: 'audio',
        label: 'LA.settingsMenus.tah.battleLog.themePartial.label',
        hint: 'LA.settingsMenus.tah.battleLog.themePartial.hint',
        requires: 'battleLogEnabled' },
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
            COLORS_FIELDS.filter(field => field.key && !field.module && field.type !== 'button'
                && game.settings.settings.get(`${MODULE_ID}.${field.key}`)?.scope !== 'world').map(field => field.key)
        ),
    },
    { type: 'section', label: 'LA.settingsMenus.section.statusBadgeColors.label', hint: 'LA.settingsMenus.section.statusBadgeColors.hint' },
    { key: 'statusCounterColor', type: 'color' },
    { key: 'statusUsageColor', type: 'color' },
    { key: 'statusDurationColor', type: 'color' },
    { key: 'statusRoundColor', type: 'color' },
];

const THT_ID = 'terrain-height-tools';
const TMAC_ID = 'templatemacro';

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

export const TAB_DEFS = [
    // Gameplay & rules
    { id: 'activations', label: 'LA.settingsMenus.tab.activations.label', icon: 'fas fa-bolt', fields: ACTIVATIONS_FIELDS, doc: 'AUTOMATION_ENGINE' },
    { id: 'combat', label: 'LA.settingsMenus.tab.combat.label', icon: 'fas fa-running', fields: COMBAT_MOVEMENT_FIELDS, doc: 'GAMEPLAY_AUTOMATION' },
    { id: 'ruler', label: 'LA.settingsMenus.tab.ruler.label', icon: 'fas fa-ruler', fields: RULER_MEASURE_FIELDS, doc: 'MOVEMENT' },
    { id: 'statuses', label: 'LA.settingsMenus.tab.statuses.label', icon: 'fas fa-tags', fields: STATUSES_FIELDS, doc: 'FX_AND_SOUNDS' },
    { id: 'vision', label: 'LA.settingsMenus.tab.experimental.label', icon: 'fas fa-eye', fields: VISION_FIELDS, doc: 'VISION' },
    { id: 'wrecks', label: 'LA.settingsMenus.tab.wrecks.label', icon: 'fas fa-skull-crossbones', fields: WRECKS_FIELDS, doc: 'WRECK' },
    // Look & feel
    { id: 'tokens', label: 'LA.settingsMenus.tab.tokens.label', icon: 'fas fa-cubes', fields: TOKENS_DISPLAY_FIELDS, doc: 'TOKEN_DISPLAY' },
    { id: 'statbars', label: 'LA.settingsMenus.tab.statbars.label', icon: 'fas fa-chart-bar', fields: STAT_BARS_FIELDS, doc: 'TOKEN_DISPLAY' },
    { id: 'tah', label: 'LA.settingsMenus.tab.tah.label', icon: 'fas fa-th-list', fields: TAH_FIELDS, doc: 'HUD' },
    { id: 'colors', label: 'LA.settingsMenus.tab.colors.label', icon: 'fas fa-palette', fields: COLORS_FIELDS, doc: 'INTERACTIVE_TOOLS' },
    { id: 'sounds', label: 'LA.settingsMenus.tab.sounds.label', icon: 'fas fa-volume-high', fields: SOUNDS_FIELDS, doc: 'FX_AND_SOUNDS' },
    {
        id: 'iso',
        label: 'LA.settingsMenus.tab.iso.label',
        icon: 'fas fa-cube',
        fields: ISO_FIELDS,
        doc: 'ISOMETRIC',
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
    { id: 'battelog', label: 'LA.settingsMenus.tab.battelog.label', icon: 'fas fa-flag-checkered', fields: BATTLE_LOG_FIELDS, doc: 'BATTLE_LOG' },
    { id: 'tools', label: 'LA.settingsMenus.tab.tools.label', icon: 'fas fa-toolbox', fields: TOOLS_FIELDS, doc: 'SETUP_AND_TOOLS' },
    { id: 'control', label: 'LA.settingsMenus.tab.control.label', icon: 'fas fa-keyboard', fields: CONTROL_FIELDS },
    // Help & maintenance
    { id: 'tutorials', label: 'LA.settingsMenus.tab.tutorials.label', icon: 'fas fa-graduation-cap', fields: TUTORIALS_FIELDS, doc: 'SETUP_AND_TOOLS' },
    { id: 'performance', label: 'LA.settingsMenus.tab.performance.label', icon: 'fas fa-gauge-high', fields: PERFORMANCE_FIELDS },
    { id: 'debug', label: 'LA.settingsMenus.tab.debug.label', icon: 'fas fa-bug', fields: DEBUG_FIELDS },
];

export const NAV_GROUPS = [
    { label: 'LA.settingsMenus.navGroup.core.label', icon: 'fas fa-crosshairs', tabs: ['activations', 'combat', 'ruler', 'statuses', 'wrecks'] },
    { label: 'LA.settingsMenus.navGroup.canvas.label', icon: 'fas fa-map', tabs: ['vision', 'tokens', 'statbars', 'iso', 'mapModules'] },
    { label: 'LA.settingsMenus.navGroup.interface.label', icon: 'fas fa-window-maximize', tabs: ['tah', 'control', 'colors', 'sounds'] },
    { label: 'LA.settingsMenus.navGroup.extras.label', icon: 'fas fa-star', tabs: ['battelog', 'tools'] },
    { label: 'LA.settingsMenus.navGroup.help.label', icon: 'fas fa-circle-question', tabs: ['tutorials', 'performance', 'debug'] },
];

export function getExportableModuleBooleanFields()
{
    /** @type {{ module: string, key: string }[]} */
    const fields = [];
    for (const tab of TAB_DEFS)
    {
        for (const field of /** @type {any[]} */ (tab.fields))
        {
            if (field.type === 'moduleBoolean' && field.module && field.key)
                fields.push({ module: field.module, key: field.key });
        }
    }
    return fields;
}

export function getExportableKeybindingFields()
{
    /** @type {{ module: string, key: string }[]} */
    const fields = [];
    for (const tab of TAB_DEFS)
    {
        for (const field of /** @type {any[]} */ (tab.fields))
        {
            if (field.type === 'keybinding' && field.module && field.key)
                fields.push({ module: field.module, key: field.key });
        }
    }
    return fields;
}
