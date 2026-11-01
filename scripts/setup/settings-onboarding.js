// GM setup wizard: yes/no questions that flip the module's main settings, launched from the tour welcome dialog and re-runnable from the settings menu.

import { isFCSActive, getFCSData, getFCSMode, setFCSForceBulk } from './fcs.js';
import { getModuleSetting, getExternalSetting } from '../tools/settings-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
import { ReactionManager } from '../activations/reaction-manager.js';
import { isExecutorGM } from '../tools/misc-tools.js';

import { MODULE_ID } from '../tools/constants.js';
const TEMPLATE = `modules/${MODULE_ID}/templates/settings-onboarding.html`;
const SETTING_HOTBAR_SYNCED = 'systemHotbarHidden';
const SETTING_GM_CLIENT_DEFAULTS = 'gmClientDefaults';
let _freshWorld = false;

export function isFreshWorld()
{
    return _freshWorld;
}

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
 * @property {(yes:boolean|string)=>Record<string, any>} [extra]
 * @property {()=>boolean|string} [read]
 * @property {()=>boolean} [condition]
 * @property {string} [needs]
 * @property {string} [warn]
 */

const _systemAutomation = (sub) => game.settings.get('lancer', 'automationOptions')?.[sub] !== false;

/** @type {{id:string,label:string,icon:string,blurb:string,note?:string,condition?:()=>boolean,questions:OnbQuestion[]}[]} */
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
                extra: (yes) => ({ 'lancer.actionTracker': { showHotbar: !yes } }),
            },
            {
                id: 'combat-carousel',
                label: 'LA.onboarding.combat-carousel.label',
                explain: 'LA.onboarding.combat-carousel.explain',
                keys: ['combatCarousel'],
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
                keys: ['tah.openMode'],
                read: () => getModuleSetting('tah.openMode') === 'click',
                apply: (yes) => ({ 'tah.openMode': yes ? 'click' : 'hover' }),
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
                id: 'sys-floating-numbers',
                label: 'LA.onboarding.sys-floating-numbers.label',
                explain: 'LA.onboarding.sys-floating-numbers.explain',
                module: 'lancer',
                keys: ['floatingNumbers'],
            },
            {
                id: 'stat-privacy',
                label: 'LA.onboarding.stat-privacy.label',
                explain: 'LA.onboarding.stat-privacy.explain',
                kind: 'choice',
                keys: ['statBarVisibilityOutOfCombat', 'statBarVisibilityInCombat', 'tokenStatHintHideCurrentOnScan'],
                choices: [
                    { value: 'all', label: 'LA.onboarding.stat-privacy.choices.all' },
                    { value: 'owner', label: 'LA.onboarding.stat-privacy.choices.owner' },
                    { value: 'scanned', label: 'LA.onboarding.stat-privacy.choices.scanned' },
                ],
                read: () =>
                {
                    const inCombat = getModuleSetting('statBarVisibilityInCombat');
                    if (inCombat === 'scanned' || inCombat === 'all')
                        return inCombat;
                    return 'owner';
                },
                apply: (value) =>
                {
                    if (value === 'all')
                        return { statBarVisibilityOutOfCombat: 'all', statBarVisibilityInCombat: 'all' };
                    return value === 'scanned'
                        ? { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'scanned', tokenStatHintHideCurrentOnScan: false }
                        : { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'owner', tokenStatHintHideCurrentOnScan: true };
                },
            },
            {
                id: 'scan-reveal',
                label: 'LA.onboarding.scan-reveal.label',
                explain: 'LA.onboarding.scan-reveal.explain',
                kind: 'choice',
                keys: ['scanRevealMode'],
                choices: [
                    { value: 'nobody', label: 'LA.onboarding.scan-reveal.choices.nobody' },
                    { value: 'players', label: 'LA.onboarding.scan-reveal.choices.players' },
                    { value: 'allies', label: 'LA.onboarding.scan-reveal.choices.allies' },
                    { value: 'everyone', label: 'LA.onboarding.scan-reveal.choices.everyone' },
                ],
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
            {
                id: 'sys-ui-theme',
                label: 'LA.onboarding.sys-ui-theme.label',
                explain: 'LA.onboarding.sys-ui-theme.explain',
                kind: 'choice',
                module: 'lancer',
                keys: ['uiTheme'],
                choices: ['gms', 'gmsDark', 'msmc', 'horus', 'ha', 'ssc', 'ipsn', 'gal'].map(value => ({ value, label: `lancer.uiTheme.${value}` })),
            },
            {
                id: 'sys-pause-icon',
                label: 'LA.onboarding.sys-pause-icon.label',
                explain: 'LA.onboarding.sys-pause-icon.explain',
                kind: 'choice',
                module: 'lancer',
                keys: ['pauseIcon'],
                choices: ['gms', 'horus', 'ha', 'ssc', 'ips-n', 'albatross', 'aun', 'barony', 'horizon', 'ra', 'sparri', 'voladores'].map(value => ({ value, label: `lancer.pauseIcon.${value}` })),
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
                keys: ['attackTargeting', 'enableDamageTargeting'],
                read: () => getModuleSetting('attackTargeting') !== 'off',
                apply: (yes) => ({ attackTargeting: yes ? 'picker' : 'off', enableDamageTargeting: yes }),
            },
            {
                id: 'auto-start-targeting',
                label: 'LA.onboarding.auto-start-targeting.label',
                explain: 'LA.onboarding.auto-start-targeting.explain',
                keys: ['attackTargeting'],
                needs: 'attack-targeting',
                read: () => getModuleSetting('attackTargeting') === 'auto',
                apply: (yes) => ({ attackTargeting: yes ? 'auto' : 'picker' }),
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
                id: 'auto-struct-followup',
                label: 'LA.onboarding.auto-struct-followup.label',
                explain: 'LA.onboarding.auto-struct-followup.explain',
                keys: ['autoStructFollowup'],
            },
            {
                id: 'auto-focus',
                label: 'LA.onboarding.auto-focus.label',
                explain: 'LA.onboarding.auto-focus.explain',
                keys: ['autoFocusEnabled'],
                apply: (yes) => (yes
                    ? { autoFocusEnabled: true, autoFocusAttack: true, autoFocusDamage: true, autoFocusCheck: true, autoFocusActivation: true, autoFocusCards: true }
                    : { autoFocusEnabled: false }),
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
                needs: 'builtin-ruler',
            },
            {
                id: 'terrain-elevation',
                label: 'LA.onboarding.terrain-elevation.label',
                explain: 'LA.onboarding.terrain-elevation.explain',
                keys: ['terrainElevationMode'],
                read: () => getModuleSetting('terrainElevationMode') !== 'off',
                apply: (yes) => ({ terrainElevationMode: yes ? 'both' : 'off' }),
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
                needs: 'builtin-ruler',
            },
            {
                id: 'pathfind-drag',
                label: 'LA.onboarding.pathfind-drag.label',
                explain: 'LA.onboarding.pathfind-drag.explain',
                keys: ['pathfindDragMovement'],
                needs: 'builtin-ruler',
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
                needs: 'builtin-ruler',
            },
        ],
    },
    {
        id: 'movement-beta',
        label: 'LA.onboarding.movement-beta.label',
        icon: 'fas fa-flask',
        blurb: 'LA.onboarding.movement-beta.blurb',
        note: 'LA.onboarding.movement-beta.note',
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
                        return [{ name: 'Overwatch', index: 0, enabled: false }, { name: 'Overwatch', index: 1, enabled: true }, { name: 'Overwatch', index: 2, enabled: true }];
                    if (value === 'v1')
                        return [{ name: 'Overwatch', index: 0, enabled: true }, { name: 'Overwatch', index: 1, enabled: false }, { name: 'Overwatch', index: 2, enabled: false }];
                    return [{ name: 'Overwatch', index: 0, enabled: false }, { name: 'Overwatch', index: 1, enabled: false }, { name: 'Overwatch', index: 2, enabled: false }];
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
                keys: ['enableBoostOffer'],
                choices: [
                    { value: 'off', label: 'LA.onboarding.movement-cap.choices.off' },
                    { value: 'stop', label: 'LA.onboarding.movement-cap.choices.stop' },
                    { value: 'yes', label: 'LA.onboarding.movement-cap.choices.yes' },
                    { value: 'auto', label: 'LA.onboarding.movement-cap.choices.auto' },
                ],
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
                id: 'sys-overcharge-heat',
                label: 'LA.onboarding.sys-overcharge-heat.label',
                explain: 'LA.onboarding.sys-overcharge-heat.explain',
                module: 'lancer',
                keys: ['automationOptions'],
                read: () => _systemAutomation('overcharge_heat'),
                apply: (yes) => ({ automationOptions: { overcharge_heat: yes } }),
            },
            {
                id: 'sys-self-heat',
                label: 'LA.onboarding.sys-self-heat.label',
                explain: 'LA.onboarding.sys-self-heat.explain',
                module: 'lancer',
                keys: ['automationOptions'],
                read: () => _systemAutomation('attack_self_heat'),
                apply: (yes) => ({ automationOptions: { attack_self_heat: yes } }),
            },

            {
                id: 'per-round-tags',
                label: 'LA.onboarding.per-round-tags.label',
                explain: 'LA.onboarding.per-round-tags.explain',
                keys: ['enablePerRoundTurnTags'],
            },
            {
                id: 'sys-npc-recharge',
                label: 'LA.onboarding.sys-npc-recharge.label',
                explain: 'LA.onboarding.sys-npc-recharge.explain',
                module: 'lancer',
                keys: ['automationOptions'],
                read: () => _systemAutomation('npc_recharge'),
                apply: (yes) => ({ automationOptions: { npc_recharge: yes } }),
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
                id: 'sys-limited-loading',
                label: 'LA.onboarding.sys-limited-loading.label',
                explain: 'LA.onboarding.sys-limited-loading.explain',
                module: 'lancer',
                keys: ['automationOptions'],
                read: () => _systemAutomation('limited_loading'),
                apply: (yes) => ({ automationOptions: { limited_loading: yes } }),
            },
            {
                id: 'link-manual-deploy',
                label: 'LA.onboarding.link-manual-deploy.label',
                explain: 'LA.onboarding.link-manual-deploy.explain',
                keys: ['linkManualDeploy'],
            },
            {
                id: 'deployable-art',
                label: 'LA.onboarding.deployable-art.label',
                explain: 'LA.onboarding.deployable-art.explain',
                keys: ['defaultDeployableArt'],
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
                id: 'sys-scan-output',
                label: 'LA.onboarding.sys-scan-output.label',
                explain: 'LA.onboarding.sys-scan-output.explain',
                kind: 'choice',
                module: 'lancer',
                keys: ['scanOutputs'],
                choices: ['both', 'chat', 'journal'].map(value => ({ value, label: `lancer.scanOutput.${value}` })),
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
                keys: ['enableWreckAnimation', 'wreckMasterVolume'],
                read: () => !!getModuleSetting('enableWreckAnimation'),
                apply: (yes) => ({ enableWreckAnimation: yes, wreckMasterVolume: yes ? 1 : 0 }),
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
                keys: ['uplinkEnabled', 'uplinkAutoOpen'],
            },
        ],
    },
];

// One-click loadout: question id -> answer. Absent id = leave the current value.
const RECOMMENDED = {
    'tah-enabled': true,
    'combat-carousel': true,
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
    'target-info': 'all',
    'sys-floating-numbers': true,
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
    'detection-combat-only': false,
    'bulwark-los': true,
    'vision-from-edge': true,
    'auto-token-height': true,
    'vehicle-squad-height': false,
    'reaction-notify': 'both',
    'consume-action': true,
    'consume-reaction': true,
    'link-manual-deploy': true,
    'deployable-art': true,
    'lasossis-items': false,
    'scan-ownership': 'all',
    'battle-log': true,
    'wrecks': true,
    'wreck-cinematics': true,
    'remove-wrecks-combat': true,
    'actor-token-sync': false,
    'roll-uplink': true,
    'obstruction-step-over': true,
};

const QUICK_IDS = new Set([
    'dialog-theme',
    'stat-privacy',
    'overwatch-style',
    'movement-cap',
]);

// Shown by default in the walk-through; the rest sits behind each group's "Show all" expander.
const ESSENTIAL_IDS = new Set([
    'tah-enabled',
    'combat-carousel',
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
    return getExternalSetting(_mod(question), question.keys?.[0], false);
}

function _answerOf(question)
{
    const current = _currentValue(question);
    if (question.kind === 'choice' || question.kind === 'reactions')
        return String(current);
    return current ? 'yes' : 'no';
}

function _patchFor(question, answer)
{
    const arg = question.kind === 'choice' ? answer : (answer === true || answer === 'yes');
    let patch;
    if (question.apply)
        patch = question.apply(arg);
    else if (question.kind === 'choice')
        patch = { [question.keys[0]]: arg };
    else
        patch = Object.fromEntries(question.keys.map(key => [key, arg]));
    const out = new Map(Object.entries(patch).map(([key, value]) => [`${_mod(question)}.${key}`, value]));
    for (const [fullKey, value] of Object.entries(question.extra?.(arg) ?? {}))
        out.set(fullKey, value);
    return out;
}

function _queueChange(changes, fullKey, value)
{
    const pending = changes.get(fullKey);
    const partial = foundry.utils.getType(value) === 'Object' && foundry.utils.getType(pending) === 'Object';
    changes.set(fullKey, partial ? { ...pending, ...value } : value);
}

function _withCurrent(prev, value)
{
    if (foundry.utils.getType(value) !== 'Object')
        return value;
    return { ...(prev?.toObject?.() ?? prev ?? {}), ...value };
}

function _sameSetting(prev, next)
{
    if (next && typeof next === 'object')
        return foundry.utils.objectsEqual(prev?.toObject?.() ?? prev ?? {}, next);
    return prev === next;
}

async function _seedRecommended()
{
    for (const question of _visibleQuestions())
    {
        const answer = RECOMMENDED[question.id];
        if (answer === undefined || QUICK_IDS.has(question.id) || _mod(question) !== MODULE_ID)
            continue;
        if (question.kind === 'sfx' || question.kind === 'reactions' || question.reaction)
            continue;
        for (const [fullKey, value] of _patchFor(question, answer))
        {
            const key = fullKey.slice(MODULE_ID.length + 1);
            if (!fullKey.startsWith(`${MODULE_ID}.`) || _reg(key)?.scope !== 'world' || getModuleSetting(key) === value)
                continue;
            await game.settings.set(MODULE_ID, key, value);
        }
    }
}

async function _applyGmClientDefaults()
{
    const defaults = getModuleSetting(SETTING_GM_CLIENT_DEFAULTS);
    let needsReload = false;
    for (const { key: fullKey, value } of (Array.isArray(defaults) ? defaults : []))
    {
        const setting = game.settings.settings.get(fullKey);
        if (setting?.scope !== 'client' || globalThis.localStorage.getItem(fullKey) !== null)
            continue;
        const dot = fullKey.indexOf('.');
        await game.settings.set(fullKey.slice(0, dot), fullKey.slice(dot + 1), value);
        needsReload ||= !!setting.requiresReload;
    }
    if (needsReload)
        ui.notifications.info(localize('LA.notify.gmClientDefaultsApplied'));
}

async function _hideSystemHotbarOnce()
{
    if (_freshWorld && getModuleSetting('tahEnabled'))
    {
        const tracker = game.settings.get('lancer', 'actionTracker');
        if (tracker?.showHotbar !== false)
            await game.settings.set('lancer', 'actionTracker', _withCurrent(tracker, { showHotbar: false }));
    }
    await game.settings.set(MODULE_ID, SETTING_HOTBAR_SYNCED, true);
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
        needs: question.needs ?? '',
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
    return localize(value === 'yes' ? 'LA.onboardingUi.yes' : 'LA.onboardingUi.no');
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
            const advCount = questions.filter(question => question.advanced).length;
            pages.push({ type: 'group', isGroup: true, id: group.id, label: localize(group.label), icon: group.icon, blurb: localize(group.blurb), note: localize(group.note ?? ''), questions, advCount, moreLabel: localizeFormat('LA.onboardingUi.showAll', { count: advCount }) });
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
        const syncNeeds = () =>
        {
            root.querySelectorAll('.la-onb-q[data-needs]').forEach(row =>
            {
                row.hidden = root.querySelector(`input[name="q.${row.dataset.needs}"]:checked`)?.value === 'no';
            });
        };
        root.addEventListener('change', syncNeeds);
        syncNeeds();

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
                button.innerHTML = expanded ? button.dataset.showLabel : `<i class="fas fa-chevron-up"></i> ${localize('LA.onboardingUi.hideAdvanced')}`;
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
                ? localizeFormat('LA.onboardingUi.stepOf', { current: this._quickPages.indexOf(this._page) + 1, total: this._quickPages.length })
                : localizeFormat('LA.onboardingUi.stepOf', { current: this._page + 1, total: pages.length });
        }
        const back = root.querySelector('.la-onb-back');
        if (back)
            back.style.visibility = this._page === 0 ? 'hidden' : 'visible';
        const next = root.querySelector('.la-onb-next');
        if (next)
        {
            next.innerHTML = this._page >= lastIndex
                ? `<i class="fas fa-check"></i> ${localize('LA.onboardingUi.applyAmpContinue')}`
                : `${localize('LA.onboardingUi.next')} <i class="fas fa-arrow-right"></i>`;
        }
        if (this._page >= lastIndex)
            this._buildSummary(root);
    }

    _buildSummary(root)
    {
        const list = root.querySelector('.la-onb-summary-list');
        if (!list)
            return;
        const rowStyle = 'padding:5px 0; border-bottom:1px solid color-mix(in srgb, var(--primary-color, #782e22) 12%, transparent);';
        const rows = [];
        const alsoOn = [];
        root.querySelectorAll('.la-onb-q[data-qid]').forEach(questionEl =>
        {
            const original = questionEl.dataset.original;
            const select = questionEl.querySelector('select');
            const current = select
                ? select.value
                : questionEl.querySelector('input[type="radio"]:checked')?.value;
            if (current === undefined)
                return;
            if (current !== original)
                rows.push(`<div style="${rowStyle}">${questionEl.dataset.label} &nbsp;<b>${_valueLabel(questionEl, original)} &rarr; ${_valueLabel(questionEl, current)}</b></div>`);
            else if (!select && current === 'yes' && ESSENTIAL_IDS.has(questionEl.dataset.qid))
                alsoOn.push(`<div style="${rowStyle}">${questionEl.dataset.label} &nbsp;<b>${_valueLabel(questionEl, current)}</b></div>`);
        });
        const changes = rows.length
            ? rows.join('')
            : `<p style="opacity:0.7;">${localize('LA.onboardingUi.noChanges')}</p>`;
        const onBlock = alsoOn.length
            ? `<h3 style="margin:14px 0 4px; font-size:0.95em; border-bottom:1px solid var(--la-edge);">${localize('LA.onboardingUi.alsoOn')}</h3>${alsoOn.join('')}`
            : '';
        list.innerHTML = changes + onBlock;
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

            if (raw !== _answerOf(question))
            {
                if (question.kind === 'sfx')
                    sfxDelta[question.sfxSub] = raw === 'yes';
                else if (question.kind === 'reactions')
                    reactionToggles.push(...question.togglesFor(raw));
                else if (question.reaction)
                    reactionToggles.push({ name: question.reaction.name, index: question.reaction.index, enabled: raw === 'yes' });
                else
                {
                    for (const [fullKey, value] of _patchFor(question, raw))
                        _queueChange(changes, fullKey, value);
                }
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

        const clientAnswers = {};
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
            const next = _withCurrent(prev, value);
            if (_sameSetting(prev, next))
                continue;
            if (setting.requiresReload)
                this._needsReload = true;
            try
            {
                await game.settings.set(mod, key, next);
                if (setting.scope === 'client')
                    clientAnswers[fullKey] = next;
            }
            catch (err)
            {
                console.warn(`${MODULE_ID} | could not save ${fullKey}`, err);
            }
        }

        if (Object.keys(clientAnswers).length && game.user?.isGM)
        {
            const stored = Array.isArray(getModuleSetting(SETTING_GM_CLIENT_DEFAULTS)) ? getModuleSetting(SETTING_GM_CLIENT_DEFAULTS) : [];
            const merged = new Map(stored.map(entry => [entry.key, entry.value]));
            for (const [fullKey, value] of Object.entries(clientAnswers))
                merged.set(fullKey, value);
            await game.settings.set(MODULE_ID, SETTING_GM_CLIENT_DEFAULTS, [...merged].map(([key, value]) => ({ key, value })));
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

    game.settings.register(MODULE_ID, SETTING_HOTBAR_SYNCED, {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    game.settings.register(MODULE_ID, SETTING_GM_CLIENT_DEFAULTS, {
        scope: 'world',
        config: false,
        type: Array,
        default: [],
    });

    _freshWorld = !game.settings.storage.get('world')?.contents?.some(setting => setting.key?.startsWith(`${MODULE_ID}.`));

    Hooks.once('ready', () =>
    {
        if (_freshWorld && isExecutorGM())
            _seedRecommended().catch(err => console.warn(`${MODULE_ID} | seeding recommended settings failed`, err));
        if (isExecutorGM() && !getModuleSetting(SETTING_HOTBAR_SYNCED))
            _hideSystemHotbarOnce().catch(err => console.warn(`${MODULE_ID} | hiding the system hotbar failed`, err));
        _applyGmClientDefaults().catch(err => console.warn(`${MODULE_ID} | applying the GM's client answers failed`, err));
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
