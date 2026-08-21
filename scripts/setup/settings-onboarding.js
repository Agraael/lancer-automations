// GM setup wizard: yes/no questions that flip the module's main settings, launched from the tour welcome dialog and re-runnable from the settings menu.

import { isFCSActive, getFCSData, getFCSMode, setFCSForceBulk } from './fcs.js';
import { ReactionManager } from '../activations/reaction-manager.js';

const MODULE_ID = 'lancer-automations';
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
 * @property {(yes:boolean)=>Record<string, any>} [apply]
 * @property {()=>boolean} [read]
 * @property {()=>boolean} [condition]
 * @property {string} [warn]
 */

/** @type {{id:string,label:string,icon:string,blurb:string,condition?:()=>boolean,questions:OnbQuestion[]}[]} */
const GROUPS = [
    {
        id: 'interface',
        label: 'Action HUD',
        icon: 'fas fa-th-list',
        blurb: 'The Token Action HUD: the on-token action menu and how it opens.',
        questions: [
            {
                id: 'tah-enabled',
                label: 'Show the Token Action HUD when you select a token?',
                explain: 'A custom action menu on your token: items, skills, stats, scans, favorites, search, and range previews.',
                keys: ['tahEnabled'],
            },
            {
                id: 'prevent-wasd-movement',
                label: 'Stop bare W/A/S/D/Q/E from moving the selected token?',
                explain: 'Keeps bare W/A/S/D/Q/E from nudging the selected token.',
                keys: ['tah.preventWasdMovement'],
            },
            {
                id: 'range-preview-hover',
                label: 'Pulse a weapon\'s range when you hover it in the HUD?',
                explain: 'Hovering a weapon or action in the HUD shows its range on the map.',
                keys: ['tah.rangePreview'],
            },
            {
                id: 'tah-click-to-open',
                label: 'Open the HUD on click instead of hover?',
                explain: 'HUD categories open on click, not on mouse-over.',
                keys: ['tah.clickToOpen'],
            },
            {
                id: 'tah-keyboard-nav',
                label: 'Drive the HUD from the keyboard?',
                explain: 'Shift+WASD moves, Shift+E clicks, Shift+Q right-clicks.',
                keys: ['tah.keyboardNav'],
            },
            {
                id: 'tah-narrative-mode',
                label: 'Enable the narrative HUD with no token selected?',
                explain: 'A HUD you can link to a pilot for narrative play.',
                keys: ['tah.narrativeMode'],
            },
            {
                id: 'ppg-actions',
                label: 'Add the Aid / Handle / Interact / Squeeze actions to the HUD?',
                explain: 'Homebrew actions from PPG (Prototype Pattern Group), shown in the Actions category.',
                keys: ['tah.showAidHandleInteractSqueeze'],
            },
        ],
    },
    {
        id: 'tokens-statuses',
        label: 'Tokens & Statuses',
        icon: 'fas fa-tags',
        blurb: 'Token bars, hover info, and status effects.',
        questions: [
            {
                id: 'token-stat-bar',
                label: 'Replace the token bars with the custom Lancer stat bars?',
                explain: 'Bars tailored to Lancer. Turn Bar Brawl off on your tokens for them to show.',
                keys: ['tokenStatBar'],
                condition: () => !game.modules.get('barbrawl')?.active,
            },
            {
                id: 'token-stat-hint',
                label: 'Show a stats popup when you hover a token?',
                explain: 'A hover popup with a token\'s full stats.',
                keys: ['tokenStatHintEnabled'],
            },
            {
                id: 'stat-privacy',
                label: 'What do players see of non-owned tokens?',
                explain: 'Owners only: bars stay private and current values show as "?". Owners + scanned: a scan reveals bars in combat and real values.',
                kind: 'choice',
                keys: ['statBarVisibilityOutOfCombat', 'statBarVisibilityInCombat', 'tokenStatHintHideCurrentOnScan'],
                choices: [
                    { value: 'owner', label: 'Owners only' },
                    { value: 'scanned', label: 'Owners + scanned' },
                ],
                read: () => game.settings.get(MODULE_ID, 'statBarVisibilityInCombat') === 'scanned' ? 'scanned' : 'owner',
                apply: (value) => value === 'scanned'
                    ? { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'scanned', tokenStatHintHideCurrentOnScan: false }
                    : { statBarVisibilityOutOfCombat: 'owner', statBarVisibilityInCombat: 'owner', tokenStatHintHideCurrentOnScan: true },
            },
            {
                id: 'reveal-without-scan',
                label: 'Show enemy stats without scanning them first?',
                explain: 'Otherwise the popup, the scanned stat bars, and the consume feedback keep an NPC\'s stats hidden until someone runs a SCAN on it.',
                keys: ['revealStatsWithoutScan'],
            },
            {
                id: 'status-fx-master',
                label: 'Show visual effects for statuses?',
                explain: 'Glows and shaders for statuses like Danger Zone, Burn, and Stunned.',
                kind: 'sfx',
                sfxSub: 'master',
                keys: [],
            },
            {
                id: 'additional-statuses',
                label: 'Add the extra LaSossis statuses?',
                explain: 'My own statuses for states LCPs and alternate structure tables describe but never register: Immovable, Climber, Brace, Dazed, and more.',
                keys: ['additionalStatuses'],
            },
            {
                id: 'half-size-tokens',
                label: 'Let size-0.5 actors use half a grid space?',
                explain: 'A size-0.5 actor\'s token takes up half a grid square instead of a full 1x1.',
                keys: ['allowHalfSizeTokens'],
            },
            {
                id: 'deployable-lines',
                label: 'Draw lines from a token to its deployables on hover?',
                explain: 'Hovering a token links it to the deployables it owns.',
                keys: ['showDeployableLines'],
            },
            {
                id: 'token-hud-buttons',
                label: 'Slim down the token right-click HUD?',
                explain: 'Hides Foundry\'s status, combat, and target buttons plus the module\'s extra HUD buttons.',
                keys: ['showStatusEffectsHudButton', 'showCombatStateHudButton', 'showTargetStateHudButton', 'showBonusHudButton', 'showRevertMovementHudButton'],
                read: () => !game.settings.get(MODULE_ID, 'showStatusEffectsHudButton'),
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
                label: 'Draw Token Factions borders below the token art, with no fill?',
                explain: 'The faction ring renders under the sprite and its color fill is removed.',
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
                label: 'Show a Guardian / Bulwark aura on those tokens?',
                explain: 'Marks Guardian and Bulwark tokens with an aura. "In combat" needs the GAA fork.',
                kind: 'choice',
                keys: ['guardianBulwarkAuraMode'],
                choices: [
                    { value: 'off', label: 'No' },
                    { value: 'combat', label: 'In combat' },
                    { value: 'always', label: 'Always' },
                ],
            },
            {
                id: 'dialog-theme',
                label: 'Which theme for the Lancer windows?',
                explain: 'The Lancer Style Library theme.',
                kind: 'choice',
                module: 'lancer-style-library',
                keys: ['theme'],
                choices: [
                    { value: 'light', label: 'Light' },
                    { value: 'dark', label: 'Dark' },
                    { value: 'lancer', label: 'Follow Lancer' },
                ],
                condition: () => !!game.modules.get('lancer-style-library')?.active,
            },
        ],
    },
    {
        id: 'targeting',
        label: 'Targeting',
        icon: 'fas fa-crosshairs',
        blurb: 'Picking targets and reading hit chance from the attack and damage HUDs.',
        questions: [
            {
                id: 'attack-targeting',
                label: 'Add the target / area picker to the attack and damage HUDs?',
                explain: 'Place your target, blast, cone, or line straight from the attack or damage dialog. Hold Shift on damage to hit several targets.',
                keys: ['enableAttackTargeting', 'enableDamageTargeting'],
            },
            {
                id: 'auto-start-targeting',
                label: 'Open that picker automatically when an attack starts with no target?',
                explain: 'Opens the picker the moment you begin an attack with no target set.',
                keys: ['autoStartTargetPicking'],
            },
            {
                id: 'stat-roll-targeting',
                label: 'Add a target button to stat and skill rolls?',
                explain: 'A HULL / AGI / SYS / ENG roll gets the same target button as an attack, using the picked token\'s save or matching stat as the difficulty.',
                keys: ['statRollTargeting'],
            },
            {
                id: 'target-info',
                label: 'Show each target\'s hit chance and damage while aiming?',
                explain: 'Shows your chance to hit and the damage you\'d deal, right on each target.',
                kind: 'choice',
                keys: ['targetInfoDisplay'],
                choices: [
                    { value: 'off', label: 'No' },
                    { value: 'gm', label: 'GM only' },
                    { value: 'all', label: 'GM and players' },
                ],
            },
        ],
    },
    {
        id: 'attacks-areas',
        label: 'Areas & Attack Automation',
        icon: 'fas fa-bomb',
        blurb: 'Placed areas and attack-time automations.',
        questions: [
            {
                id: 'area-elevation-aware',
                label: 'Make placed areas 3D by default?',
                explain: 'Blasts, cones, and lines follow terrain height instead of staying flat.',
                keys: ['tah.areaElevationAware'],
            },
            {
                id: 'overlap-picker',
                label: 'Show a picker when tokens sit on the same spot?',
                explain: 'Clicking a stack of same-size tokens opens a list to pick from.',
                keys: ['overlapTokenPicker'],
            },
            {
                id: 'range-preview-attack-card',
                label: 'Show the attacker\'s range on the canvas when the attack card opens?',
                explain: 'Pulses the attacker\'s reach on the map as the attack card appears.',
                keys: ['tah.rangePreviewOnAttackCard'],
            },
            {
                id: 'display-tools-to-others',
                label: 'Show your in-progress tools to other players, and see theirs?',
                explain: 'Target picking, zone and token placement, and movement traces show to other players as a faded ghost. Hidden tokens are never broadcast.',
                keys: ['displayToolsToOthers'],
            },
            {
                id: 'knockback-flow',
                label: 'Automate knockback on hits with Knockback weapons?',
                explain: 'A Knockback checkbox on the damage dialog reads the weapon\'s Knockback tag and runs the knockback tool right after damage.',
                keys: ['enableKnockbackFlow'],
            },
            {
                id: 'throw-flow',
                label: 'Ask "Attack or Throw?" when you use a Thrown weapon?',
                explain: 'Attacking with a throwable weapon first asks whether to attack with it or throw it onto the field.',
                keys: ['enableThrowFlow'],
            },
            {
                id: 'auto-damage-roll',
                label: 'Open the damage roll automatically after an attack?',
                explain: 'The damage dialog opens on its own once the attack card is posted.',
                keys: ['autoDamageRoll'],
            },
            {
                id: 'auto-damage-apply',
                label: 'Apply rolled damage to targets automatically?',
                explain: 'Rolled damage is applied to the targets without a confirm step.',
                keys: ['autoDamageApply'],
            },
        ],
    },
    {
        id: 'ruler',
        label: 'The Ruler & Measurement',
        icon: 'fas fa-ruler-combined',
        blurb: 'The Lancer ruler and how movement distance is measured.',
        questions: [
            {
                id: 'builtin-ruler',
                label: 'Replace Foundry\'s ruler with the Lancer ruler?',
                explain: 'A ruler with Lancer speed tiers, free and force movement, and terrain elevation readout. Also powers the Advanced Measure tool.',
                keys: ['enableBuiltinSpeedProvider'],
                condition: () => !game.modules.get('lancer-speed-provider')?.active,
            },
            {
                id: 'count-3d-distance',
                label: 'Count elevation when measuring combat distance?',
                explain: 'Elevation feeds range checks like overwatch, engagement, and weapon range.',
                keys: ['count3DDistance'],
            },
            {
                id: 'climb-waypoints',
                label: 'Split movement with climb steps when terrain height changes?',
                explain: 'Adds a climb step wherever terrain elevation changes under the token, so the cost is billed at each climb.',
                keys: ['enableClimbWaypoints'],
            },
            {
                id: 'terrain-elevation',
                label: 'Track terrain height under tokens as they move?',
                explain: 'Tokens follow Terrain Height Tools elevation during ruler moves and measurements.',
                keys: ['disableAutoTerrainElevation', 'disableAutoElevationOnMeasure'],
                read: () => !game.settings.get(MODULE_ID, 'disableAutoTerrainElevation'),
                apply: (yes) => ({ disableAutoTerrainElevation: !yes, disableAutoElevationOnMeasure: !yes }),
            },
            {
                id: 'tactical-distance',
                label: 'Show tactical distance labels while dragging a token?',
                explain: 'Distance and elevation delta to every other visible token.',
                kind: 'choice',
                keys: ['enableTacticalDistance'],
                choices: [
                    { value: 'off', label: 'Off' },
                    { value: 'combat', label: 'In combat' },
                    { value: 'always', label: 'Always' },
                ],
            },
        ],
    },
    {
        id: 'ruler-extras',
        label: 'Ruler Extras & Advanced Measure',
        icon: 'fas fa-ruler-vertical',
        blurb: 'Ruler rendering, pathfinding, and the Advanced Measure tool.',
        questions: [
            {
                id: 'ruler-per-step',
                label: 'Draw the ruler path through each grid cell?',
                explain: 'Draws the path cell by cell instead of a straight line.',
                keys: ['rulerPerStepRender'],
            },
            {
                id: 'pathfind-drag',
                label: 'Route dragged movement around obstacles?',
                explain: 'Paths a drag around hostile bodies and high terrain instead of straight through.',
                keys: ['pathfindDragMovement'],
            },
            {
                id: 'split-at-speed-tiers',
                label: 'Split a drag where the speed tier changes?',
                explain: 'Breaks a drag into sub-moves at each speed-tier change.',
                keys: ['splitMovementAtSpeedTiers'],
            },
            {
                id: 'ctrl-ruler',
                label: 'Hold Ctrl to switch to the Measure Distance ruler?',
                explain: 'A quick measuring ruler on Ctrl; part of the Advanced Measure tool (needs the Lancer ruler).',
                kind: 'choice',
                keys: ['ctrlRulerMode'],
                choices: [
                    { value: 'none', label: 'No' },
                    { value: 'tool', label: 'In Advanced Measure' },
                    { value: 'always', label: 'Always' },
                ],
            },
            {
                id: 'target-cursor',
                label: 'Show a target cursor while the Select Target tool is active?',
                explain: 'Swaps the cursor to the target icon and plays a sound when you toggle the tool.',
                keys: ['targetToolCursor'],
            },
            {
                id: 'ruler-cursor',
                label: 'Show a ruler cursor while the Measure Distance tool is active?',
                explain: 'Swaps the cursor and plays a sound when you toggle the measuring tool.',
                keys: ['rulerToolCursor'],
            },
        ],
    },
    {
        id: 'movement-beta',
        label: 'Movement: Interrupts',
        icon: 'fas fa-flask',
        blurb: 'Features that interrupt or reshape movement mid-drag.',
        questions: [
            {
                id: 'overwatch-style',
                label: 'How should Overwatch trigger?',
                explain: 'Notify: a reminder pops up after a hostile moves in your threat. Interrupt: the move pauses to offer Overwatch before it happens.',
                kind: 'reactions',
                keys: [],
                choices: [
                    { value: 'off', label: 'No reminder' },
                    { value: 'v1', label: 'Notify after move' },
                    { value: 'v2', label: 'Interrupt before move' },
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
                label: 'Stop a token\'s movement when it moves into engagement?',
                explain: 'A move ends the moment the token comes adjacent to a hostile of equal or greater size.',
                keys: [],
                reaction: { name: 'Engagement Interrupt Movement', index: 0 },
            },
            {
                id: 'movement-cap',
                label: 'Enforce the movement cap and offer to Boost when a move goes over?',
                explain: 'Cancels a drag longer than the token can move, and offers to split it with Boost or Overcharge instead.',
                keys: ['enableMovementCapDetection', 'enableBoostOffer'],
            },
            {
                id: 'split-at-boundaries',
                label: 'Split a drag into sub-moves at each trigger boundary it crosses?',
                explain: 'Fires THT, TemplateMacro, Grid-Aware Auras, and region triggers as the token reaches each boundary, instead of all at once at the end.',
                keys: ['splitMovementAtTriggerBoundaries'],
            },
        ],
    },
    {
        id: 'structure',
        label: 'Structure, Damage & Turns',
        icon: 'fas fa-heart-crack',
        blurb: 'Rules variants for structure, stress, damage, and use limits.',
        questions: [
            {
                id: 'alt-struct',
                label: 'Use Maria\'s Alternate Structure & Stress rules?',
                explain: 'Swaps Lancer\'s structure and overheat rolls for the keep-lowest alternative ruleset.',
                keys: ['enableAltStruct'],
                warn: 'Turn off any standalone alt-structure module first.',
            },
            {
                id: 'one-struct-npc',
                label: 'Destroy 1-structure NPCs instantly instead of rolling?',
                explain: 'A 1-structure NPC is destroyed (or Exposed) instead of rolling on the structure table.',
                keys: ['enableOneStructNpc'],
            },
            {
                id: 'infection-damage',
                label: 'Automate the Infection damage type (from HORUS: Thy Hubris Manifest)?',
                explain: 'Taking Infection deals Heat now; at end of turn a Systems check clears it or deals the Heat again.',
                keys: ['enableInfectionDamageIntegration'],
            },
            {
                id: 'heat-as-energy',
                label: 'Deal Heat as Energy damage to targets with no heat track?',
                explain: 'Targets that can\'t take Heat take it as Energy damage instead.',
                keys: ['convertHeatToEnergyOnHeatless'],
            },
            {
                id: 'resist-self-heat',
                label: 'Halve self-heat when the mech resists Heat?',
                explain: 'A mech with Heat resistance takes half of its own self-inflicted heat.',
                keys: ['resistSelfHeat'],
            },

            {
                id: 'per-round-tags',
                label: 'Enforce per-round / per-turn / per-scene use limits?',
                explain: 'Items tagged with those limits get pip counters and are capped.',
                keys: ['enablePerRoundTurnTags'],
            },
        ],
    },
    {
        id: 'vision',
        label: 'Vision & Token Height',
        icon: 'fas fa-eye',
        blurb: 'Lancer detection modes, line of sight, and Wall Height integration.',
        questions: [
            {
                id: 'lancer-vision',
                label: 'Auto-add Lancer Sensors and Battlefield Awareness to new tokens?',
                explain: 'Two Lancer detection modes on every new token: Sensors (ranged) and Battlefield Awareness (sees any unit).',
                keys: ['lancerVisionAutoAdd'],
            },
            {
                id: 'lancer-los',
                label: 'Use Lancer wall-based line of sight?',
                explain: 'Reciprocal sight through walls: you see a token only if it could see you.',
                keys: ['lancerLos'],
            },
            {
                id: 'detection-combat-only',
                label: 'Only draw Sensors and Battlefield Awareness in combat?',
                explain: 'The detection-mode highlights show in combat and hide otherwise.',
                keys: ['lancerSensorCombatOnly', 'lancerAwarenessCombatOnly'],
            },
            {
                id: 'bulwark-los',
                label: 'Let tokens with Bulwark block line of sight?',
                explain: 'A Bulwarked token breaks sight through it, elevation-aware with Wall Height.',
                keys: ['bulwarkBlocksLineOfSight'],
            },
            {
                id: 'vision-from-edge',
                label: 'Compute vision from the token\'s edge instead of its center?',
                explain: 'Samples sight from the token\'s perimeter, so a large token can see around a corner.',
                keys: ['visionFromEdgeEnabled'],
                warn: 'Experimental.',
            },
            {
                id: 'auto-token-height',
                label: 'Set each token\'s height to its size?',
                explain: 'A token\'s Wall Height matches its size, so it can peek over walls and same-size tokens.',
                keys: ['autoTokenHeight'],
                condition: () => game.modules.get('wall-height')?.active,
            },
            {
                id: 'vehicle-squad-height',
                label: 'Lower that height for vehicles and squads?',
                explain: 'Vehicles and squads get a reduced height (my take, not an official rule).',
                keys: ['autoTokenHeightVehicleSquad'],
                condition: () => game.modules.get('wall-height')?.active && game.settings.get(MODULE_ID, 'autoTokenHeight'),
            },
        ],
    },
    {
        id: 'automation',
        label: 'Activations & Content',
        icon: 'fas fa-boxes-stacked',
        blurb: 'Activation behavior, the prebuilt content pack, and scanning.',
        questions: [
            {
                id: 'reaction-notify',
                label: 'Who should see the activation popup?',
                explain: 'Who gets the prompt when an activation fires.',
                kind: 'choice',
                keys: ['reactionNotificationMode'],
                choices: [
                    { value: 'both', label: 'GM and Owner' },
                    { value: 'gm', label: 'GM only' },
                    { value: 'owner', label: 'Owner only' },
                ],
            },
            {
                id: 'consume-action',
                label: 'Auto-spend a token\'s Quick or Full action when an activation succeeds?',
                explain: 'Spends the action automatically when an activation flow completes.',
                keys: ['consumeAction'],
            },
            {
                id: 'consume-reaction',
                label: 'Auto-spend a token\'s reaction when a Reaction activation fires?',
                explain: 'Spends the token\'s reaction for the round.',
                keys: ['consumeReaction'],
            },
            {
                id: 'link-manual-deploy',
                label: 'Link deployables you drop onto the scene yourself?',
                explain: 'A deployable you place by hand links to your token, just like using the deploy menu.',
                keys: ['linkManualDeploy'],
            },
            {
                id: 'lasossis-items',
                label: 'Install LaSossis\'s prebuilt item activations?',
                explain: '30+ of my own item automations, like Dispersal Shield and Defense Net. Some deployables need my personal NPC Deployables LCP.',
                keys: ['enableLaSossisItems'],
                link: { path: 'modules/lancer-automations/extra/LaSossis_Npc_Deployables.lcp', label: 'Get the Deployables LCP' },
            },
            {
                id: 'scan-source',
                label: 'Which scan should produce the result?',
                explain: 'Use the legacy scan journal or the native Lancer-system scan.',
                kind: 'choice',
                keys: ['scanJournalSource'],
                choices: [
                    { value: 'system', label: 'Lancer system' },
                    { value: 'lancer-automations', label: 'Legacy' },
                ],
            },
            {
                id: 'scan-ownership',
                label: 'When a player scans, who can read the result?',
                explain: 'Ownership on the scan journal for a player scan. GM scans always share with all.',
                kind: 'choice',
                keys: ['scanPlayerOwnershipMode'],
                choices: [
                    { value: 'self', label: 'Just them' },
                    { value: 'all', label: 'Everyone' },
                    { value: 'group', label: 'Their group' },
                ],
            },
        ],
    },
    {
        id: 'battle-wrecks',
        label: 'Battle Log & Wrecks',
        icon: 'fas fa-flag-checkered',
        blurb: 'Combat telemetry, wrecks, and keeping actor and token in sync.',
        questions: [
            {
                id: 'battle-log',
                label: 'Record combat telemetry and show a recap when combat ends?',
                explain: 'Tracks the fight and shows a recap card at the end.',
                keys: ['battleLogEnabled'],
            },
            {
                id: 'wrecks',
                label: 'Drop a wreck when a unit hits 0 structure?',
                explain: 'Spawns a wreck on the field when a unit is destroyed.',
                keys: ['enableWrecks'],
            },
            {
                id: 'wreck-cinematics',
                label: 'Play the explosion and sound on wreck?',
                explain: 'A cinematic boom when a unit is wrecked. Per-player.',
                keys: ['enableWreckAnimation', 'enableWreckAudio'],
                condition: () => game.settings.get(MODULE_ID, 'enableWrecks') !== false,
            },
            {
                id: 'remove-wrecks-combat',
                label: 'Drop wrecked tokens from the combat tracker?',
                explain: 'When a unit dies and leaves a wreck, its token is taken out of the turn order.',
                keys: ['enableRemoveFromCombat'],
            },
            {
                id: 'actor-token-sync',
                label: 'Keep a token\'s image and name synced to its actor?',
                explain: 'Editing a prototype token\'s image or name updates the actor to match.',
                keys: ['syncActorImgToToken', 'syncActorNameToToken'],
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
};

const QUICK_IDS = new Set([
    'prevent-wasd-movement',
    'tah-keyboard-nav',
    'tah-click-to-open',
    'half-size-tokens',
    'token-hud-buttons',
    'dialog-theme',
    'stat-privacy',
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
        const cfg = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
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
        label: question.label,
        explain: question.explain,
        warn: question.warn ?? null,
        advanced: !ESSENTIAL_IDS.has(question.id),
        isChoice: question.kind === 'choice' || question.kind === 'reactions',
        choices: (question.kind === 'choice' || question.kind === 'reactions')
            ? (question.choices || []).map(choice => ({ value: choice.value, label: choice.label, selected: choice.value === current }))
            : null,
        isYes: (question.kind === 'choice' || question.kind === 'reactions') ? false : !!current,
        originalValue: (question.kind === 'choice' || question.kind === 'reactions') ? String(current) : (current ? 'yes' : 'no'),
        link: question.link
            ? { url: question.link.url ?? foundry.utils.getRoute(question.link.path), label: question.link.label }
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
    const saved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
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
            title: 'Lancer Automations Setup',
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
            pages.push({ type: 'group', isGroup: true, id: group.id, label: group.label, icon: group.icon, blurb: group.blurb, questions, advCount: questions.filter(question => question.advanced).length });
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
                const existing = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
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
        ui.notifications.info('Lancer Automations setup applied.');
    }

    async close(options)
    {
        const closed = await super.close(options);
        if (this._needsReload)
        {
            this._needsReload = false;
            const reload = await Dialog.confirm({
                title: 'Reload Required',
                content: '<p>Some of your answers need a reload to take effect. Reload now? The tour will start once Foundry is back.</p>',
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
        name: 'Setup Wizard',
        label: 'Run Setup Wizard',
        hint: 'Walk through the main Lancer Automations settings as yes/no questions.',
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
