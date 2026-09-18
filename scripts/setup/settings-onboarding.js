// GM setup wizard: yes/no questions that flip the module's main settings, launched from the tour welcome dialog and re-runnable from the settings menu.

import { isFCSActive, getFCSData, getFCSMode, setFCSForceBulk } from './fcs.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { localize } from '../tools/string-utils.js';
import { ReactionManager } from '../activations/reaction-manager.js';

import { MODULE_ID } from '../tools/constants.js';
const TEMPLATE = `modules/${MODULE_ID}/templates/settings-onboarding.html`;

/**
 * @typedef {Object} OnbQuestion
 * @property {string} id
 * @property {string} label
 * @property {string} explain
 * @property {string[]} keys
 * @property {string} [module]
 * @property {'boolean'|'choice'|'sfx'|'reactions'} [kind]
 * @property {string} [sfxSub]
 * @property {{value:string,label:string}[]} [choices]
 * @property {(yes:boolean|string)=>Record<string, any>} [apply]
 * @property {()=>boolean|string} [read]
 * @property {()=>boolean} [condition]
 * @property {string} [warn]
 */

/** @type {{id:string,label:string,icon:string,blurb:string,condition?:()=>boolean,questions:OnbQuestion[]}[]} */
const GROUPS = [
    {
        id: 'interface',
        label: 'LA.onboarding.interface.label',
        icon: 'fas fa-th-list',
        blurb: 'LA.onboarding.interface.blurb',
        questions: [
            {
                id: 'tah-enabled',
                label: 'LA.onboarding.tah-enabled.label',
                explain: 'LA.onboarding.tah-enabled.explain',
                keys: ['tahEnabled'],
            },
            {
                id: 'prevent-wasd-movement',
                label: 'LA.onboarding.prevent-wasd-movement.label',
                explain: 'LA.onboarding.prevent-wasd-movement.explain',
                keys: ['tah.preventWasdMovement'],
            },
            {
                id: 'range-preview-hover',
                label: 'LA.onboarding.range-preview-hover.label',
                explain: 'LA.onboarding.range-preview-hover.explain',
                keys: ['tah.rangePreview'],
            },
            {
                id: 'tah-click-to-open',
                label: 'LA.onboarding.tah-click-to-open.label',
                explain: 'LA.onboarding.tah-click-to-open.explain',
                keys: ['tah.clickToOpen'],
            },
            {
                id: 'tah-keyboard-nav',
                label: 'LA.onboarding.tah-keyboard-nav.label',
                explain: 'LA.onboarding.tah-keyboard-nav.explain',
                keys: ['tah.keyboardNav'],
            },
            {
                id: 'tah-narrative-mode',
                label: 'LA.onboarding.tah-narrative-mode.label',
                explain: 'LA.onboarding.tah-narrative-mode.explain',
                keys: ['tah.narrativeMode'],
            },
            {
                id: 'ppg-actions',
                label: 'LA.onboarding.ppg-actions.label',
                explain: 'LA.onboarding.ppg-actions.explain',
                keys: ['tah.showAidHandleInteractSqueeze'],
            },
        ],
    },
    {
        id: 'tokens-statuses',
        label: 'LA.onboarding.tokens-statuses.label',
        icon: 'fas fa-tags',
        blurb: 'LA.onboarding.tokens-statuses.blurb',
        questions: [
            {
                id: 'token-stat-bar',
                label: 'LA.onboarding.token-stat-bar.label',
                explain: 'LA.onboarding.token-stat-bar.explain',
                keys: ['tokenStatBar'],
                condition: () => !game.modules.get('barbrawl')?.active,
            },
            {
                id: 'token-stat-hint',
                label: 'LA.onboarding.token-stat-hint.label',
                explain: 'LA.onboarding.token-stat-hint.explain',
                keys: ['tokenStatHintEnabled'],
            },
            {
                id: 'stat-privacy',
                label: 'LA.onboarding.stat-privacy.label',
                explain: 'LA.onboarding.stat-privacy.explain',
                kind: 'choice',
                keys: ['statBarVisibilityOutOfCombat', 'statBarVisibilityInCombat', 'tokenStatHintHideCurrentOnScan'],
                choices: [
                    { value: 'owner', label: 'LA.onboarding.stat-privacy.choices.owner' },
                    { value: 'scanned', label: 'LA.onboarding.stat-privacy.choices.scanned' },
                ],
                read: () => getModuleSetting('statBarVisibilityInCombat') === 'scanned' ? 'scanned' : 'owner',
                apply: (value) => value === 'scanned'
                    ? { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'scanned', tokenStatHintHideCurrentOnScan: false }
                    : { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'owner', tokenStatHintHideCurrentOnScan: true },
            },
            {
                id: 'reveal-without-scan',
                label: 'LA.onboarding.reveal-without-scan.label',
                explain: 'LA.onboarding.reveal-without-scan.explain',
                keys: ['revealStatsWithoutScan'],
            },
            {
                id: 'scan-reveal',
                label: 'LA.onboarding.scan-reveal.label',
                explain: 'LA.onboarding.scan-reveal.explain',
                kind: 'choice',
                keys: ['scanRevealPlayers', 'scanRevealAllies'],
                choices: [
                    { value: 'none', label: 'LA.onboarding.scan-reveal.choices.none' },
                    { value: 'players', label: 'LA.onboarding.scan-reveal.choices.players' },
                    { value: 'allies', label: 'LA.onboarding.scan-reveal.choices.allies' },
                ],
                read: () => getModuleSetting('scanRevealAllies') ? 'allies'
                    : (getModuleSetting('scanRevealPlayers') ? 'players' : 'none'),
                apply: (value) => ({
                    scanRevealPlayers: value !== 'none',
                    scanRevealAllies: value === 'allies',
                }),
            },
            {
                id: 'effect-notifications',
                label: 'LA.onboarding.effect-notifications.label',
                explain: 'LA.onboarding.effect-notifications.explain',
                kind: 'choice',
                keys: ['effectNotificationMode'],
                choices: [
                    { value: 'public', label: 'LA.onboarding.effect-notifications.choices.public' },
                    { value: 'whisper', label: 'LA.onboarding.effect-notifications.choices.whisper' },
                    { value: 'off', label: 'LA.onboarding.effect-notifications.choices.off' },
                ],
            },
            {
                id: 'status-fx-master',
                label: 'LA.onboarding.status-fx-master.label',
                explain: 'LA.onboarding.status-fx-master.explain',
                kind: 'sfx',
                sfxSub: 'master',
                keys: [],
            },
            {
                id: 'additional-statuses',
                label: 'LA.onboarding.additional-statuses.label',
                explain: 'LA.onboarding.additional-statuses.explain',
                keys: ['additionalStatuses'],
            },
            {
                id: 'half-size-tokens',
                label: 'LA.onboarding.half-size-tokens.label',
                explain: 'LA.onboarding.half-size-tokens.explain',
                keys: ['allowHalfSizeTokens'],
            },
            {
                id: 'deployable-lines',
                label: 'LA.onboarding.deployable-lines.label',
                explain: 'LA.onboarding.deployable-lines.explain',
                keys: ['showDeployableLines'],
            },
            {
                id: 'token-hud-buttons',
                label: 'LA.onboarding.token-hud-buttons.label',
                explain: 'LA.onboarding.token-hud-buttons.explain',
                keys: ['showStatusEffectsHudButton', 'showCombatStateHudButton', 'showTargetStateHudButton', 'showBonusHudButton', 'showRevertMovementHudButton'],
                read: () => !getModuleSetting('showStatusEffectsHudButton'),
                apply: (yes) => ({
                    showStatusEffectsHudButton: !yes,
                    showCombatStateHudButton: !yes,
                    showTargetStateHudButton: !yes,
                    showBonusHudButton: !yes,
                    showRevertMovementHudButton: !yes,
                }),
            },
            {
                id: 'tf-border-under-token',
                label: 'LA.onboarding.tf-border-under-token.label',
                explain: 'LA.onboarding.tf-border-under-token.explain',
                module: 'token-factions',
                keys: ['borderUnderSpriteOnHover', 'base-opacity'],
                condition: () => game.settings.settings.has('token-factions.borderUnderSpriteOnHover')
                    && game.settings.settings.has('token-factions.base-opacity'),
                read: () => game.settings.get('token-factions', 'borderUnderSpriteOnHover') === true
                    && game.settings.get('token-factions', 'base-opacity') === 0,
                apply: (yes) =>
                {
                    if (yes)
                        return { borderUnderSpriteOnHover: true, 'base-opacity': 0 };
                    const isSet = game.settings.get('token-factions', 'borderUnderSpriteOnHover') === true
                        && game.settings.get('token-factions', 'base-opacity') === 0;
                    return isSet ? { borderUnderSpriteOnHover: false, 'base-opacity': 0.5 } : {};
                },
            },
            {
                id: 'guardian-bulwark-aura',
                label: 'LA.onboarding.guardian-bulwark-aura.label',
                explain: 'LA.onboarding.guardian-bulwark-aura.explain',
                kind: 'choice',
                keys: ['guardianBulwarkAuraMode'],
                choices: [
                    { value: 'off', label: 'LA.onboarding.guardian-bulwark-aura.choices.off' },
                    { value: 'combat', label: 'LA.onboarding.guardian-bulwark-aura.choices.combat' },
                    { value: 'always', label: 'LA.onboarding.guardian-bulwark-aura.choices.always' },
                ],
            },
            {
                id: 'dialog-theme',
                label: 'LA.onboarding.dialog-theme.label',
                explain: 'LA.onboarding.dialog-theme.explain',
                kind: 'choice',
                module: 'lancer-style-library',
                keys: ['theme'],
                choices: [
                    { value: 'light', label: 'LA.onboarding.dialog-theme.choices.light' },
                    { value: 'dark', label: 'LA.onboarding.dialog-theme.choices.dark' },
                    { value: 'lancer', label: 'LA.onboarding.dialog-theme.choices.lancer' },
                ],
                condition: () => !!game.modules.get('lancer-style-library')?.active,
            },
        ],
    },
    {
        id: 'targeting',
        label: 'LA.onboarding.targeting.label',
        icon: 'fas fa-crosshairs',
        blurb: 'LA.onboarding.targeting.blurb',
        questions: [
            {
                id: 'attack-targeting',
                label: 'LA.onboarding.attack-targeting.label',
                explain: 'LA.onboarding.attack-targeting.explain',
                keys: ['enableAttackTargeting', 'enableDamageTargeting'],
            },
            {
                id: 'auto-start-targeting',
                label: 'LA.onboarding.auto-start-targeting.label',
                explain: 'LA.onboarding.auto-start-targeting.explain',
                keys: ['autoStartTargetPicking'],
            },
            {
                id: 'stat-roll-targeting',
                label: 'LA.onboarding.stat-roll-targeting.label',
                explain: 'LA.onboarding.stat-roll-targeting.explain',
                keys: ['statRollTargeting'],
            },
            {
                id: 'target-info',
                label: 'LA.onboarding.target-info.label',
                explain: 'LA.onboarding.target-info.explain',
                kind: 'choice',
                keys: ['targetInfoDisplay'],
                choices: [
                    { value: 'off', label: 'LA.onboarding.target-info.choices.off' },
                    { value: 'gm', label: 'LA.onboarding.target-info.choices.gm' },
                    { value: 'all', label: 'LA.onboarding.target-info.choices.all' },
                ],
            },
        ],
    },
    {
        id: 'attacks-areas',
        label: 'LA.onboarding.attacks-areas.label',
        icon: 'fas fa-bomb',
        blurb: 'LA.onboarding.attacks-areas.blurb',
        questions: [
            {
                id: 'area-elevation-aware',
                label: 'LA.onboarding.area-elevation-aware.label',
                explain: 'LA.onboarding.area-elevation-aware.explain',
                keys: ['tah.areaElevationAware'],
            },
            {
                id: 'overlap-picker',
                label: 'LA.onboarding.overlap-picker.label',
                explain: 'LA.onboarding.overlap-picker.explain',
                keys: ['overlapTokenPicker'],
            },
            {
                id: 'range-preview-attack-card',
                label: 'LA.onboarding.range-preview-attack-card.label',
                explain: 'LA.onboarding.range-preview-attack-card.explain',
                keys: ['tah.rangePreviewOnAttackCard'],
            },
            {
                id: 'display-tools-to-others',
                label: 'LA.onboarding.display-tools-to-others.label',
                explain: 'LA.onboarding.display-tools-to-others.explain',
                keys: ['displayToolsToOthers'],
            },
            {
                id: 'knockback-flow',
                label: 'LA.onboarding.knockback-flow.label',
                explain: 'LA.onboarding.knockback-flow.explain',
                keys: ['enableKnockbackFlow'],
            },
            {
                id: 'throw-flow',
                label: 'LA.onboarding.throw-flow.label',
                explain: 'LA.onboarding.throw-flow.explain',
                keys: ['enableThrowFlow'],
            },
            {
                id: 'auto-damage-roll',
                label: 'LA.onboarding.auto-damage-roll.label',
                explain: 'LA.onboarding.auto-damage-roll.explain',
                keys: ['autoDamageRoll'],
            },
            {
                id: 'auto-damage-apply',
                label: 'LA.onboarding.auto-damage-apply.label',
                explain: 'LA.onboarding.auto-damage-apply.explain',
                keys: ['autoDamageApply'],
            },
            {
                id: 'auto-struct-followup',
                label: 'LA.onboarding.auto-struct-followup.label',
                explain: 'LA.onboarding.auto-struct-followup.explain',
                keys: ['autoStructFollowup'],
            },
            {
                id: 'auto-focus',
                label: 'LA.onboarding.auto-focus.label',
                explain: 'LA.onboarding.auto-focus.explain',
                keys: ['autoFocusAttack', 'autoFocusDamage', 'autoFocusCheck', 'autoFocusActivation', 'autoFocusCards'],
            },
        ],
    },
    {
        id: 'ruler',
        label: 'LA.onboarding.ruler.label',
        icon: 'fas fa-ruler-combined',
        blurb: 'LA.onboarding.ruler.blurb',
        questions: [
            {
                id: 'builtin-ruler',
                label: 'LA.onboarding.builtin-ruler.label',
                explain: 'LA.onboarding.builtin-ruler.explain',
                keys: ['enableBuiltinSpeedProvider'],
                condition: () => !game.modules.get('lancer-speed-provider')?.active,
            },
            {
                id: 'count-3d-distance',
                label: 'LA.onboarding.count-3d-distance.label',
                explain: 'LA.onboarding.count-3d-distance.explain',
                keys: ['count3DDistance'],
            },
            {
                id: 'climb-waypoints',
                label: 'LA.onboarding.climb-waypoints.label',
                explain: 'LA.onboarding.climb-waypoints.explain',
                keys: ['enableClimbWaypoints'],
            },
            {
                id: 'terrain-elevation',
                label: 'LA.onboarding.terrain-elevation.label',
                explain: 'LA.onboarding.terrain-elevation.explain',
                keys: ['disableAutoTerrainElevation', 'disableAutoElevationOnMeasure'],
                read: () => !getModuleSetting('disableAutoTerrainElevation'),
                apply: (yes) => ({ disableAutoTerrainElevation: !yes, disableAutoElevationOnMeasure: !yes }),
            },
            {
                id: 'tactical-distance',
                label: 'LA.onboarding.tactical-distance.label',
                explain: 'LA.onboarding.tactical-distance.explain',
                kind: 'choice',
                keys: ['enableTacticalDistance'],
                choices: [
                    { value: 'off', label: 'LA.onboarding.tactical-distance.choices.off' },
                    { value: 'combat', label: 'LA.onboarding.tactical-distance.choices.combat' },
                    { value: 'always', label: 'LA.onboarding.tactical-distance.choices.always' },
                ],
            },
        ],
    },
    {
        id: 'ruler-extras',
        label: 'LA.onboarding.ruler-extras.label',
        icon: 'fas fa-ruler-vertical',
        blurb: 'LA.onboarding.ruler-extras.blurb',
        questions: [
            {
                id: 'ruler-per-step',
                label: 'LA.onboarding.ruler-per-step.label',
                explain: 'LA.onboarding.ruler-per-step.explain',
                keys: ['rulerPerStepRender'],
            },
            {
                id: 'pathfind-drag',
                label: 'LA.onboarding.pathfind-drag.label',
                explain: 'LA.onboarding.pathfind-drag.explain',
                keys: ['pathfindDragMovement'],
            },
            {
                id: 'split-at-speed-tiers',
                label: 'LA.onboarding.split-at-speed-tiers.label',
                explain: 'LA.onboarding.split-at-speed-tiers.explain',
                keys: ['splitMovementAtSpeedTiers'],
            },
            {
                id: 'ctrl-ruler',
                label: 'LA.onboarding.ctrl-ruler.label',
                explain: 'LA.onboarding.ctrl-ruler.explain',
                kind: 'choice',
                keys: ['ctrlRulerMode'],
                choices: [
                    { value: 'none', label: 'LA.onboarding.ctrl-ruler.choices.none' },
                    { value: 'tool', label: 'LA.onboarding.ctrl-ruler.choices.tool' },
                    { value: 'always', label: 'LA.onboarding.ctrl-ruler.choices.always' },
                ],
            },
            {
                id: 'target-cursor',
                label: 'LA.onboarding.target-cursor.label',
                explain: 'LA.onboarding.target-cursor.explain',
                keys: ['targetToolCursor'],
            },
            {
                id: 'ruler-cursor',
                label: 'LA.onboarding.ruler-cursor.label',
                explain: 'LA.onboarding.ruler-cursor.explain',
                keys: ['rulerToolCursor'],
            },
            {
                id: 'obstruction-step-over',
                label: 'LA.onboarding.obstruction-step-over.label',
                explain: 'LA.onboarding.obstruction-step-over.explain',
                keys: ['enableObstructionStepOver', 'obstructionBlocksHuman', 'obstructionBlocksSpecialist', 'obstructionBlocksSquad', 'obstructionBlocksVehicle'],
            },
        ],
    },
    {
        id: 'movement-beta',
        label: 'LA.onboarding.movement-beta.label',
        icon: 'fas fa-flask',
        blurb: 'LA.onboarding.movement-beta.blurb',
        questions: [
            {
                id: 'overwatch-style',
                label: 'LA.onboarding.overwatch-style.label',
                explain: 'LA.onboarding.overwatch-style.explain',
                kind: 'reactions',
                keys: [],
                choices: [
                    { value: 'off', label: 'LA.onboarding.overwatch-style.choices.off' },
                    { value: 'v1', label: 'LA.onboarding.overwatch-style.choices.v1' },
                    { value: 'v2', label: 'LA.onboarding.overwatch-style.choices.v2' },
                ],
                readCurrent: () =>
                {
                    const reactions = ReactionManager.getGeneralReactions()['Overwatch']?.reactions;
                    if (reactions?.[1]?.enabled)
                        return 'v2';
                    if (reactions?.[0]?.enabled)
                        return 'v1';
                    return 'off';
                },
                togglesFor: (value) =>
                {
                    if (value === 'v2')
                        return [{ name: 'Overwatch', index: 0, enabled: false }, { name: 'Overwatch', index: 1, enabled: true }];
                    if (value === 'v1')
                        return [{ name: 'Overwatch', index: 0, enabled: true }, { name: 'Overwatch', index: 1, enabled: false }];
                    return [{ name: 'Overwatch', index: 0, enabled: false }, { name: 'Overwatch', index: 1, enabled: false }];
                },
            },
            {
                id: 'engagement-block',
                label: 'LA.onboarding.engagement-block.label',
                explain: 'LA.onboarding.engagement-block.explain',
                keys: [],
                reaction: { name: 'Engagement Interrupt Movement', index: 0 },
            },
            {
                id: 'movement-cap',
                label: 'LA.onboarding.movement-cap.label',
                explain: 'LA.onboarding.movement-cap.explain',
                kind: 'choice',
                keys: ['enableBoostOffer', 'enableMovementCapDetection'],
                choices: [
                    { value: 'no', label: 'LA.onboarding.movement-cap.choices.no' },
                    { value: 'yes', label: 'LA.onboarding.movement-cap.choices.yes' },
                    { value: 'auto', label: 'LA.onboarding.movement-cap.choices.auto' },
                ],
                apply: (value) => ({ enableMovementCapDetection: value !== 'no', enableBoostOffer: value }),
            },
            {
                id: 'split-at-boundaries',
                label: 'LA.onboarding.split-at-boundaries.label',
                explain: 'LA.onboarding.split-at-boundaries.explain',
                keys: ['splitMovementAtTriggerBoundaries'],
            },
        ],
    },
    {
        id: 'structure',
        label: 'LA.onboarding.structure.label',
        icon: 'fas fa-heart-crack',
        blurb: 'LA.onboarding.structure.blurb',
        questions: [
            {
                id: 'alt-struct',
                label: 'LA.onboarding.alt-struct.label',
                explain: 'LA.onboarding.alt-struct.explain',
                keys: ['enableAltStruct'],
                warn: 'LA.onboarding.alt-struct.warn',
            },
            {
                id: 'one-struct-npc',
                label: 'LA.onboarding.one-struct-npc.label',
                explain: 'LA.onboarding.one-struct-npc.explain',
                keys: ['enableOneStructNpc'],
            },
            {
                id: 'infection-damage',
                label: 'LA.onboarding.infection-damage.label',
                explain: 'LA.onboarding.infection-damage.explain',
                keys: ['enableInfectionDamageIntegration'],
            },
            {
                id: 'heat-as-energy',
                label: 'LA.onboarding.heat-as-energy.label',
                explain: 'LA.onboarding.heat-as-energy.explain',
                keys: ['convertHeatToEnergyOnHeatless'],
            },
            {
                id: 'resist-self-heat',
                label: 'LA.onboarding.resist-self-heat.label',
                explain: 'LA.onboarding.resist-self-heat.explain',
                keys: ['resistSelfHeat'],
            },

            {
                id: 'per-round-tags',
                label: 'LA.onboarding.per-round-tags.label',
                explain: 'LA.onboarding.per-round-tags.explain',
                keys: ['enablePerRoundTurnTags'],
            },
        ],
    },
    {
        id: 'vision',
        label: 'LA.onboarding.vision.label',
        icon: 'fas fa-eye',
        blurb: 'LA.onboarding.vision.blurb',
        questions: [
            {
                id: 'lancer-vision',
                label: 'LA.onboarding.lancer-vision.label',
                explain: 'LA.onboarding.lancer-vision.explain',
                keys: ['lancerVisionAutoAdd'],
            },
            {
                id: 'lancer-los',
                label: 'LA.onboarding.lancer-los.label',
                explain: 'LA.onboarding.lancer-los.explain',
                keys: ['lancerLos'],
            },
            {
                id: 'detection-combat-only',
                label: 'LA.onboarding.detection-combat-only.label',
                explain: 'LA.onboarding.detection-combat-only.explain',
                keys: ['lancerSensorCombatOnly', 'lancerAwarenessCombatOnly'],
            },
            {
                id: 'bulwark-los',
                label: 'LA.onboarding.bulwark-los.label',
                explain: 'LA.onboarding.bulwark-los.explain',
                keys: ['bulwarkBlocksLineOfSight'],
            },
            {
                id: 'vision-from-edge',
                label: 'LA.onboarding.vision-from-edge.label',
                explain: 'LA.onboarding.vision-from-edge.explain',
                keys: ['visionFromEdgeEnabled'],
                warn: 'LA.onboarding.vision-from-edge.warn',
            },
            {
                id: 'auto-token-height',
                label: 'LA.onboarding.auto-token-height.label',
                explain: 'LA.onboarding.auto-token-height.explain',
                keys: ['autoTokenHeight'],
                condition: () => game.modules.get('wall-height')?.active,
            },
            {
                id: 'vehicle-squad-height',
                label: 'LA.onboarding.vehicle-squad-height.label',
                explain: 'LA.onboarding.vehicle-squad-height.explain',
                keys: ['autoTokenHeightVehicleSquad'],
                condition: () => game.modules.get('wall-height')?.active && getModuleSetting('autoTokenHeight'),
            },
        ],
    },
    {
        id: 'automation',
        label: 'LA.onboarding.automation.label',
        icon: 'fas fa-boxes-stacked',
        blurb: 'LA.onboarding.automation.blurb',
        questions: [
            {
                id: 'reaction-notify',
                label: 'LA.onboarding.reaction-notify.label',
                explain: 'LA.onboarding.reaction-notify.explain',
                kind: 'choice',
                keys: ['reactionNotificationMode'],
                choices: [
                    { value: 'both', label: 'LA.onboarding.reaction-notify.choices.both' },
                    { value: 'gm', label: 'LA.onboarding.reaction-notify.choices.gm' },
                    { value: 'owner', label: 'LA.onboarding.reaction-notify.choices.owner' },
                ],
            },
            {
                id: 'consume-action',
                label: 'LA.onboarding.consume-action.label',
                explain: 'LA.onboarding.consume-action.explain',
                keys: ['consumeAction'],
            },
            {
                id: 'consume-reaction',
                label: 'LA.onboarding.consume-reaction.label',
                explain: 'LA.onboarding.consume-reaction.explain',
                keys: ['consumeReaction'],
            },
            {
                id: 'link-manual-deploy',
                label: 'LA.onboarding.link-manual-deploy.label',
                explain: 'LA.onboarding.link-manual-deploy.explain',
                keys: ['linkManualDeploy'],
            },
            {
                id: 'lasossis-items',
                label: 'LA.onboarding.lasossis-items.label',
                explain: 'LA.onboarding.lasossis-items.explain',
                keys: ['enableLaSossisItems'],
                link: { path: 'modules/lancer-automations/extra/LaSossis_Npc_Deployables.lcp', label: 'LA.onboarding.lasossis-items.link' },
            },
            {
                id: 'scan-source',
                label: 'LA.onboarding.scan-source.label',
                explain: 'LA.onboarding.scan-source.explain',
                kind: 'choice',
                keys: ['scanJournalSource'],
                choices: [
                    { value: 'system', label: 'LA.onboarding.scan-source.choices.system' },
                    { value: 'lancer-automations', label: 'LA.onboarding.scan-source.choices.lancer-automations' },
                ],
            },
            {
                id: 'scan-ownership',
                label: 'LA.onboarding.scan-ownership.label',
                explain: 'LA.onboarding.scan-ownership.explain',
                kind: 'choice',
                keys: ['scanPlayerOwnershipMode'],
                choices: [
                    { value: 'self', label: 'LA.onboarding.scan-ownership.choices.self' },
                    { value: 'all', label: 'LA.onboarding.scan-ownership.choices.all' },
                    { value: 'group', label: 'LA.onboarding.scan-ownership.choices.group' },
                ],
            },
        ],
    },
    {
        id: 'battle-wrecks',
        label: 'LA.onboarding.battle-wrecks.label',
        icon: 'fas fa-flag-checkered',
        blurb: 'LA.onboarding.battle-wrecks.blurb',
        questions: [
            {
                id: 'battle-log',
                label: 'LA.onboarding.battle-log.label',
                explain: 'LA.onboarding.battle-log.explain',
                keys: ['battleLogEnabled'],
            },
            {
                id: 'wrecks',
                label: 'LA.onboarding.wrecks.label',
                explain: 'LA.onboarding.wrecks.explain',
                keys: ['enableWrecks'],
            },
            {
                id: 'wreck-cinematics',
                label: 'LA.onboarding.wreck-cinematics.label',
                explain: 'LA.onboarding.wreck-cinematics.explain',
                keys: ['enableWreckAnimation', 'enableWreckAudio'],
                condition: () => getModuleSetting('enableWrecks') !== false,
            },
            {
                id: 'remove-wrecks-combat',
                label: 'LA.onboarding.remove-wrecks-combat.label',
                explain: 'LA.onboarding.remove-wrecks-combat.explain',
                keys: ['enableRemoveFromCombat'],
            },
            {
                id: 'actor-token-sync',
                label: 'LA.onboarding.actor-token-sync.label',
                explain: 'LA.onboarding.actor-token-sync.explain',
                keys: ['syncActorImgToToken', 'syncActorNameToToken'],
            },
            {
                id: 'roll-uplink',
                label: 'LA.onboarding.roll-uplink.label',
                explain: 'LA.onboarding.roll-uplink.explain',
                keys: ['uplinkEnabled'],
            },
        ],
    },
];

// One-click loadout: question id -> answer. Absent id = leave the current value.
const RECOMMENDED = {
    'tah-enabled': true,
    'range-preview-hover': true,
    'tah-narrative-mode': true,
    'token-stat-bar': true,
    'token-stat-hint': true,
    'stat-privacy': 'owner',
    'status-fx-master': true,
    'additional-statuses': true,
    'deployable-lines': true,
    'tf-border-under-token': true,
    'guardian-bulwark-aura': 'combat',
    'attack-targeting': true,
    'auto-start-targeting': true,
    'stat-roll-targeting': true,
    'target-info': 'gm',
    'area-elevation-aware': true,
    'overlap-picker': true,
    'range-preview-attack-card': true,
    'display-tools-to-others': true,
    'knockback-flow': true,
    'throw-flow': true,
    'builtin-ruler': true,
    'count-3d-distance': true,
    'climb-waypoints': true,
    'terrain-elevation': true,
    'tactical-distance': 'combat',
    'ruler-per-step': true,
    'pathfind-drag': true,
    'split-at-speed-tiers': true,
    'ctrl-ruler': 'tool',
    'target-cursor': true,
    'ruler-cursor': true,
    'split-at-boundaries': true,
    'alt-struct': false,
    'auto-struct-followup': true,
    'one-struct-npc': true,
    'heat-as-energy': true,
    'resist-self-heat': true,
    'per-round-tags': true,
    'lancer-vision': true,
    'lancer-los': true,
    'detection-combat-only': true,
    'bulwark-los': true,
    'vision-from-edge': true,
    'auto-token-height': true,
    'vehicle-squad-height': false,
    'reaction-notify': 'both',
    'consume-action': true,
    'consume-reaction': true,
    'link-manual-deploy': true,
    'lasossis-items': false,
    'scan-ownership': 'group',
    'battle-log': true,
    'wrecks': true,
    'wreck-cinematics': true,
    'remove-wrecks-combat': true,
    'actor-token-sync': false,
    'obstruction-step-over': true,
};

const QUICK_IDS = new Set([
    'prevent-wasd-movement',
    'tah-keyboard-nav',
    'tah-click-to-open',
    'half-size-tokens',
    'token-hud-buttons',
    'dialog-theme',
    'stat-privacy',
    'reveal-without-scan',
    'scan-reveal',
    'effect-notifications',
    'ppg-actions',
    'infection-damage',
    'overwatch-style',
    'engagement-block',
    'movement-cap',
    'auto-damage-roll',
    'auto-damage-apply',
    'scan-source',
]);

// Shown by default in the walk-through; the rest sits behind each group's "Show all" expander.
const ESSENTIAL_IDS = new Set([
    'tah-enabled',
    'tah-click-to-open',
    'dialog-theme',
    'token-stat-bar',
    'token-stat-hint',
    'stat-privacy',
    'tf-border-under-token',
    'attack-targeting',
    'target-info',
    'knockback-flow',
    'throw-flow',
    'auto-damage-roll',
    'auto-damage-apply',
    'builtin-ruler',
    'tactical-distance',
    'pathfind-drag',
    'ctrl-ruler',
    'overwatch-style',
    'engagement-block',
    'movement-cap',
    'alt-struct',
    'lancer-los',
    'auto-token-height',
    'reaction-notify',
    'lasossis-items',
    'scan-source',
    'battle-log',
    'wrecks',
]);

// Scope and reload are read from the live registrations, never authored above.
const _mod = (question) => question.module ?? MODULE_ID;
const _reg = (key, mod = MODULE_ID) => game.settings.settings.get(`${mod}.${key}`);

/** @param {OnbQuestion} question */
function _scope(question)
{
    if (question.kind === 'sfx' || question.kind === 'reactions' || question.reaction)
        return 'world';
    const scopes = new Set((question.keys || []).map(key => _reg(key, _mod(question))?.scope));
    return scopes.size === 1 ? [...scopes][0] : 'mixed';
}

/** @param {OnbQuestion} question FCS can only force client-scoped settings. */
function _forceable(question)
{
    if (!isFCSActive() || question.kind === 'sfx' || question.kind === 'reactions' || question.reaction)
        return false;
    if (_mod(question) !== MODULE_ID)
        return false;
    return _scope(question) === 'client';
}

/** @param {OnbQuestion} question Current live value, used to pre-select the answer. */
function _currentValue(question)
{
    if (question.kind === 'sfx')
    {
        const cfg = getModuleSetting('statusFXConfig') ?? {};
        return cfg[question.sfxSub] !== undefined ? !!cfg[question.sfxSub] : true;
    }
    if (question.kind === 'reactions')
        return question.readCurrent();
    if (question.reaction)
        return !!ReactionManager.getGeneralReactions()[question.reaction.name]?.reactions?.[question.reaction.index]?.enabled;
    if (question.read)
        return question.read();
    try
    {
        return game.settings.get(_mod(question), question.keys[0]);
    }
    catch
    {
        return false;
    }
}

// Every question on groups/questions whose condition currently passes.
function _visibleQuestions()
{
    const out = [];
    for (const group of GROUPS)
    {
        if (group.condition && !group.condition())
            continue;
        for (const question of group.questions)
        {
            if (!question.condition || question.condition())
                out.push(question);
        }
    }
    return out;
}

/** @param {OnbQuestion} question @param {any} fcs */
function _questionVM(question, fcs)
{
    const current = _currentValue(question);
    const forceable = _forceable(question);
    const fullKey0 = `${MODULE_ID}.${question.keys[0] ?? ''}`;
    return {
        id: question.id,
        label: localize(question.label),
        explain: localize(question.explain),
        warn: localize(question.warn ?? null),
        advanced: !ESSENTIAL_IDS.has(question.id),
        isChoice: question.kind === 'choice' || question.kind === 'reactions',
        choices: (question.kind === 'choice' || question.kind === 'reactions')
            ? (question.choices || []).map(choice => ({ value: choice.value, label: localize(choice.label), selected: choice.value === current }))
            : null,
        isYes: (question.kind === 'choice' || question.kind === 'reactions') ? false : !!current,
        originalValue: (question.kind === 'choice' || question.kind === 'reactions') ? String(current) : (current ? 'yes' : 'no'),
        link: question.link
            ? { url: question.link.url ?? foundry.utils.getRoute(question.link.path), label: localize(question.link.label) }
            : null,
        forceable,
        forced: forceable ? getFCSMode(fullKey0, fcs) !== 'open' : false,
    };
}

// Human label for a question's stored value, used in the summary diff.
function _valueLabel(questionEl, value)
{
    const select = questionEl.querySelector('select');
    if (select)
    {
        const option = select.querySelector(`option[value="${value}"]`);
        return option ? option.textContent.trim() : value;
    }
    return value === 'yes' ? 'Yes' : 'No';
}

// Apply general-reaction enabled toggles: [{ name, index, enabled }] into the saved config.
async function _applyReactionToggles(toggles)
{
    const saved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
    const byName = {};
    for (const { name, index, enabled } of toggles)
    {
        const entry = byName[name] || { ...saved[name] };
        const reactions = Array.isArray(entry.reactions) ? [...entry.reactions] : [];
        while (reactions.length <= index)
            reactions.push(null);
        reactions[index] = { ...reactions[index], enabled };
        entry.reactions = reactions;
        byName[name] = entry;
    }
    for (const [name, entry] of Object.entries(byName))
        await ReactionManager.saveGeneralReaction(name, entry);
}

export class SettingsOnboarding extends FormApplication
{
    constructor(options = {})
    {
        super({}, options);
        this._page = 0;
        this._quickPages = null;
        this._needsReload = false;
        this._applied = false;
        this._reloadPending = false;
        this._done = new Promise(resolve =>
        {
            this._resolveDone = resolve;
        });
    }

    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: 'lancer-automations-onboarding',
            title: localize('LA.onboarding.windowTitle'),
            template: TEMPLATE,
            width: 720,
            height: 640,
            resizable: true,
            closeOnSubmit: true,
            submitOnClose: false,
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
        });
    }

    getData()
    {
        const fcs = getFCSData();
        const pages = [];
        pages.push({ type: 'intro', isIntro: true });
        for (const group of GROUPS)
        {
            if (group.condition && !group.condition())
                continue;
            const questions = group.questions
                .filter(question => !question.condition || question.condition())
                .map(question => _questionVM(question, fcs));
            if (!questions.length)
                continue;
            pages.push({ type: 'group', isGroup: true, id: group.id, label: localize(group.label), icon: group.icon, blurb: localize(group.blurb), questions, advCount: questions.filter(question => question.advanced).length });
        }
        pages.push({ type: 'summary', isSummary: true });

        if (this._page >= pages.length)
            this._page = pages.length - 1;
        pages.forEach((page, index) =>
        {
            page.index = index; page.hidden = index !== this._page;
        });

        return {
            pages,
            fcsActive: isFCSActive(),
        };
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        const root = html[0] ?? html;
        this.bringToTop?.();

        root.querySelector('.la-onb-back')?.addEventListener('click', () => this._goto(this._step(-1)));
        root.querySelector('.la-onb-skip')?.addEventListener('click', () => this._onSkip());
        root.querySelector('.la-onb-reco')?.addEventListener('click', () => this._applyRecommended(root));
        root.querySelectorAll('.la-onb-more').forEach(button =>
        {
            button.addEventListener('click', () =>
            {
                if (!button.dataset.showLabel)
                    button.dataset.showLabel = button.innerHTML;
                const expanded = button.dataset.expanded === '1';
                button.dataset.expanded = expanded ? '' : '1';
                button.innerHTML = expanded ? button.dataset.showLabel : '<i class="fas fa-chevron-up"></i> Hide advanced';
                button.closest('.la-onb-page')?.querySelectorAll('.la-onb-q.la-onb-adv').forEach(row =>
                {
                    row.style.display = expanded ? 'none' : '';
                });
            });
        });
        root.querySelector('.la-onb-next')?.addEventListener('click', () =>
        {
            const lastIndex = root.querySelectorAll('.la-onb-page').length - 1;
            if (this._page >= lastIndex)
                this.submit();
            else
                this._goto(this._step(1));
        });
        this._syncChrome(root);
    }

    _goto(target)
    {
        const root = this.element[0] ?? this.element;
        const pages = root.querySelectorAll('.la-onb-page');
        const clamped = Math.max(0, Math.min(target, pages.length - 1));
        this._page = clamped;
        if (this._quickPages && clamped === 0)
        {
            this._quickPages = null;
            root.querySelectorAll('.la-onb-q').forEach(row =>
            {
                row.style.display = row.classList.contains('la-onb-adv') ? 'none' : '';
            });
            root.querySelectorAll('.la-onb-more').forEach(button =>
            {
                button.style.display = '';
                button.dataset.expanded = '';
                if (button.dataset.showLabel)
                    button.innerHTML = button.dataset.showLabel;
            });
        }
        pages.forEach((page, index) =>
        {
            page.style.display = index === clamped ? '' : 'none';
        });
        this._syncChrome(root);
    }

    _syncChrome(root)
    {
        const pages = root.querySelectorAll('.la-onb-page');
        const lastIndex = pages.length - 1;
        const step = root.querySelector('.la-onb-step');
        if (step)
        {
            step.textContent = this._quickPages
                ? `Step ${this._quickPages.indexOf(this._page) + 1} of ${this._quickPages.length}`
                : `Step ${this._page + 1} of ${pages.length}`;
        }
        const back = root.querySelector('.la-onb-back');
        if (back)
            back.style.visibility = this._page === 0 ? 'hidden' : 'visible';
        const next = root.querySelector('.la-onb-next');
        if (next)
        {
            next.innerHTML = this._page >= lastIndex
                ? '<i class="fas fa-check"></i> Apply &amp; Continue'
                : 'Next <i class="fas fa-arrow-right"></i>';
        }
        if (this._page >= lastIndex)
            this._buildSummary(root);
    }

    _buildSummary(root)
    {
        const list = root.querySelector('.la-onb-summary-list');
        if (!list)
            return;
        const rows = [];
        root.querySelectorAll('.la-onb-q[data-qid]').forEach(questionEl =>
        {
            const original = questionEl.dataset.original;
            const select = questionEl.querySelector('select');
            const current = select
                ? select.value
                : questionEl.querySelector('input[type="radio"]:checked')?.value;
            if (current === undefined || current === original)
                return;
            rows.push(`<div style="padding:5px 0; border-bottom:1px solid color-mix(in srgb, var(--primary-color, #782e22) 12%, transparent);">${questionEl.dataset.label} &nbsp;<b>${_valueLabel(questionEl, original)} &rarr; ${_valueLabel(questionEl, current)}</b></div>`);
        });
        list.innerHTML = rows.length
            ? rows.join('')
            : '<p style="opacity:0.7;">No changes.</p>';
    }

    _applyRecommended(root)
    {
        for (const question of _visibleQuestions())
        {
            const value = RECOMMENDED[question.id];
            if (value === undefined || QUICK_IDS.has(question.id))
                continue;
            const questionEl = root.querySelector(`.la-onb-q[data-qid="${question.id}"]`);
            if (!questionEl)
                continue;
            const select = questionEl.querySelector('select');
            if (select)
            {
                select.value = String(value);
                continue;
            }
            const radio = questionEl.querySelector(`input[type="radio"][value="${value ? 'yes' : 'no'}"]`);
            if (radio)
                radio.checked = true;
        }
        const pages = [...root.querySelectorAll('.la-onb-page')];
        this._quickPages = [0];
        pages.forEach((page, index) =>
        {
            const rows = [...page.querySelectorAll('.la-onb-q')];
            if (!rows.some(row => QUICK_IDS.has(row.dataset.qid)))
                return;
            for (const row of rows)
                row.style.display = QUICK_IDS.has(row.dataset.qid) ? '' : 'none';
            this._quickPages.push(index);
        });
        root.querySelectorAll('.la-onb-more').forEach(button =>
        {
            button.style.display = 'none';
        });
        this._quickPages.push(pages.length - 1);
        this._goto(this._quickPages[1]);
    }

    _step(direction)
    {
        if (!this._quickPages)
            return this._page + direction;
        const pos = this._quickPages.indexOf(this._page);
        if (pos < 0)
            return this._page + direction;
        const next = Math.max(0, Math.min(pos + direction, this._quickPages.length - 1));
        return this._quickPages[next];
    }

    _onSkip()
    {
        this._applied = false;
        this.close();
    }

    async _updateObject(_event, formData)
    {
        const fcs = getFCSData();
        const changes = new Map();
        const sfxDelta = {};
        const forceEntries = [];
        const reactionToggles = [];

        for (const question of _visibleQuestions())
        {
            const raw = formData[`q.${question.id}`];
            if (raw === undefined)
                continue;

            if (question.kind === 'sfx')
                sfxDelta[question.sfxSub] = raw === 'yes';
            else if (question.kind === 'reactions')
            {
                if (raw !== question.readCurrent())
                    reactionToggles.push(...question.togglesFor(raw));
            }
            else if (question.kind === 'choice')
            {
                if (question.apply)
                {
                    for (const [key, value] of Object.entries(question.apply(/** @type {any} */ (raw))))
                        changes.set(`${_mod(question)}.${key}`, value);
                }
                else
                    changes.set(`${_mod(question)}.${question.keys[0]}`, raw);
            }
            else if (question.reaction)
            {
                const yes = raw === 'yes';
                if (yes !== _currentValue(question))
                    reactionToggles.push({ name: question.reaction.name, index: question.reaction.index, enabled: yes });
            }
            else
            {
                const yes = raw === 'yes';
                const patch = question.apply ? question.apply(yes) : Object.fromEntries(question.keys.map(key => [key, yes]));
                for (const [key, value] of Object.entries(patch))
                    changes.set(`${_mod(question)}.${key}`, value);
            }

            if (fcs && _forceable(question))
            {
                const want = formData[`fcs.${question.id}`] ? 'hard' : 'open';
                for (const key of question.keys)
                {
                    const full = `${MODULE_ID}.${key}`;
                    if (getFCSMode(full, fcs) !== want)
                        forceEntries.push({ fullKey: full, mode: want });
                }
            }
        }

        for (const [fullKey, value] of changes)
        {
            const setting = game.settings.settings.get(fullKey);
            if (!setting)
            {
                console.warn(`${MODULE_ID} | onboarding: unregistered key ${fullKey}`);
                continue;
            }
            if (setting.scope === 'world' && !game.user?.isGM)
                continue;
            const dot = fullKey.indexOf('.');
            const mod = fullKey.slice(0, dot);
            const key = fullKey.slice(dot + 1);
            let prev;
            try
            {
                prev = game.settings.get(mod, key);
            }
            catch
            {
                continue;
            }
            if (prev === value)
                continue;
            if (setting.requiresReload)
                this._needsReload = true;
            try
            {
                await game.settings.set(mod, key, value);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | could not save ${fullKey}`, err);
            }
        }

        if (Object.keys(sfxDelta).length && game.user?.isGM)
        {
            try
            {
                const existing = getModuleSetting('statusFXConfig') ?? {};
                const merged = { ...existing, ...sfxDelta };
                if (!foundry.utils.objectsEqual(existing, merged))
                {
                    await game.settings.set(MODULE_ID, 'statusFXConfig', merged);
                    if (_reg('statusFXConfig')?.requiresReload)
                        this._needsReload = true;
                }
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | could not save statusFXConfig`, err);
            }
        }

        if (forceEntries.length)
        {
            try
            {
                await setFCSForceBulk(forceEntries, fcs);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | FCS write failed`, err);
            }
        }

        if (reactionToggles.length && game.user?.isGM)
        {
            try
            {
                await _applyReactionToggles(reactionToggles);
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | reaction toggle failed`, err);
            }
        }

        this._applied = true;
        ui.notifications.info(localize('LA.notify.lancerAutomationsSetupApplied'));
    }

    async close(options)
    {
        const closed = await super.close(options);
        if (this._needsReload)
        {
            this._needsReload = false;
            const reload = await Dialog.confirm({
                title: localize('LA.dialogTitle.reloadRequired'),
                content: `<p>${localize('LA.onboarding.reloadPrompt')}</p>`,
                yes: () => true,
                no: () => false,
                defaultYes: true,
            });
            if (reload)
            {
                this._reloadPending = true;
                foundry.utils.debouncedReload();
            }
        }
        this._resolveDone?.(this._applied);
        return closed;
    }
}

export function registerOnboardingBootstrap()
{
    game.settings.registerMenu(MODULE_ID, 'settingsOnboardingMenu', {
        name: 'LA.settings.settingsOnboardingMenu.name',
        label: 'LA.settings.settingsOnboardingMenu.label',
        hint: 'LA.settings.settingsOnboardingMenu.hint',
        icon: 'fas fa-wand-magic-sparkles',
        type: SettingsOnboarding,
        restricted: true,
    });

    Hooks.once('ready', () =>
    {
        for (const group of GROUPS)
        {
            for (const question of group.questions)
            {
                if (question.kind === 'sfx' || question.kind === 'reactions')
                    continue;
                for (const key of (question.keys || []))
                {
                    if (!_reg(key, _mod(question)))
                        console.warn(`${MODULE_ID} | onboarding references unregistered setting: ${_mod(question)}.${key}`);
                }
            }
        }
    });
}

/** Shows the wizard for GMs as part of the tour-welcome flow. Returns false if a reload is pending. */
export async function maybeRunSettingsOnboarding()
{
    if (!game.user?.isGM)
        return true;
    const app = new SettingsOnboarding();
    app.render(true);
    await app._done;
    return !app._reloadPending;
}

export function runSettingsOnboarding()
{
    if (!game.user?.isGM)
        return;
    new SettingsOnboarding().render(true);
}
