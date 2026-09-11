/* global game */

import { getModuleSetting } from '../tools/settings-utils.js';
import { MODULE_ID } from '../tools/constants.js';

// Boolean view of a setting, for callers that want a guaranteed true/false.
export function getSettingEnabled(key)
{
    return !!getModuleSetting(key);
}

/**
 * Boost offer mode, normalising the boolean this setting used to store.
 * @returns {'no' | 'yes' | 'auto'}
 */
export function getBoostOfferMode()
{
    let raw;
    try
    {
        raw = getModuleSetting('enableBoostOffer');
    }
    catch
    {
        return 'no';
    }
    if (raw === true)
        return 'yes';
    if (raw === false)
        return 'no';
    return raw === 'yes' || raw === 'auto' ? raw : 'no';
}

export function registerSettings()
{
    // Core
    game.settings.register(MODULE_ID,'reactionNotificationMode', {
        name: 'Activation Notification Mode',
        hint: 'Who sees the activation popup.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            "both": "GM and Owner",
            "gm": "GM Only",
            "owner": "Owner Only"
        },
        default: "both"
    });

    game.settings.register(MODULE_ID,'effectNotificationMode', {
        name: 'Effect Notification Mode',
        hint: 'Chat message when a token gains or loses an effect or bonus.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            "public": "Public",
            "whisper": "GM and Owner",
            "off": "Off"
        },
        default: "public"
    });

    game.settings.register(MODULE_ID,'consumeReaction', {
        name: 'Consume Reaction on Activation',
        hint: 'Auto-spend the token\'s reaction when a Reaction activation fires.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'qolAdvisoryShown', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'compatWarningsShown', {
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

    game.settings.register(MODULE_ID,'consumeAction', {
        name: 'Consume Action on Activation',
        hint: 'Auto-spend the token\'s Quick / Full action when an activation flow succeeds.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'overlapTokenPicker', {
        name: 'Overlapping Token Picker',
        hint: 'When clicking a token at the same spot and size as others, open a picker to choose among them.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusDuration', {
        name: 'Focus Pan Duration',
        hint: 'How long the camera takes to reach the focused tokens, in milliseconds.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 200, max: 3000, step: 100 },
        default: 1000
    });

    game.settings.register(MODULE_ID,'autoFocusCards', {
        name: 'Focus on Interactive Cards',
        hint: 'Pan the canvas to the card\'s tokens when a choice, confirm or wait card shows.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusAttack', {
        name: 'Focus on Attack Rolls',
        hint: 'Pan the canvas to the attacker and targets when the attack rolls, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusDamage', {
        name: 'Focus on Damage Rolls',
        hint: 'Pan the canvas to the attacker and targets when damage rolls, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusCheck', {
        name: 'Focus on Stat Rolls',
        hint: 'Pan the canvas to the roller and its target when a stat roll happens, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusActivation', {
        name: 'Focus on Activations',
        hint: 'Pan the canvas to the acting token when its action FX plays.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Adds a button on the Token HUD to open the Effect Manager.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showStatusEffectsHudButton', {
        name: 'Token HUD Status Effects Button',
        hint: 'Foundry\'s default "Assign Status Effects" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showCombatStateHudButton', {
        name: 'Token HUD Combat State Button',
        hint: 'Foundry\'s default "Toggle Combat State" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showTargetStateHudButton', {
        name: 'Token HUD Target State Button',
        hint: 'Foundry\'s default "Toggle Target State" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showRevertMovementHudButton', {
        name: 'Revert Movement Button',
        hint: 'The Revert Last Movement / Reset Movement History button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'statusHalo', {
        name: 'Status Icon Halo',
        hint: 'Status icons circle around the token instead of stacking in a column.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusHaloRadius', {
        name: 'Halo Radius',
        hint: 'Ring radius as a fraction of the token size.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0.5, max: 2, step: 0.05 },
        default: 1.15,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusIconMinZoomScale', {
        name: 'Minimum Icon Zoom Scale',
        hint: 'Below this zoom level the icons keep a constant screen size. 0 = disabled.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 4, step: 0.1 },
        default: 0,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusHaloStartAngle', {
        name: 'Halo Start Angle',
        hint: 'Angle of the first icon, in degrees counterclockwise from the token\'s right.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 360, step: 5 },
        default: 135,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusIconHover', {
        name: 'Status Icon Hover Info',
        hint: 'Hovering a status icon enlarges it and shows its name, description, duration and bonus.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Features
    // Surfaced in the StatusFX config menu instead of the main settings panel
    game.settings.register(MODULE_ID,'additionalStatuses', {
        name: 'LaSossis Additional statuses and effects',
        hint: 'Extra statuses (Resist All, Disengage, Grappling, etc.) in the status effects list.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'enablePerRoundTurnTags', {
        name: 'Per-Round / Per-Turn / Per-Scene Enforcement',
        hint: 'Enforce per-round and per-turn tags (tg_round, tg_turn) and per-scene frequencies ("N/scene", use="Encounter"). Blocks attacks/activations at the limit and auto-resets on round/turn/combat. Requires reload.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'enableInfectionDamageIntegration', {
        name: 'Infection Damage Integration',
        hint: 'Adds Infection as a fully integrated Lancer damage type. Requires reload.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'convertHeatToEnergyOnHeatless', {
        name: 'Heat as Energy on heatless targets',
        hint: 'Convert Heat damage to Energy when the target has no heat capacity (pilots, biological NPCs). Mirrors what Lancer does natively for pilots.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'resistSelfHeat', {
        name: 'Resist Self-Inflicted Heat',
        hint: 'Halve self-inflicted heat from self-heat, overkill, and overcharge when the mech resists Heat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoDamageRoll', {
        name: 'Auto Damage Roll',
        hint: 'Open the Damage HUD automatically after an attack.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoDamageApply', {
        name: 'Auto Apply Damage',
        hint: 'Apply rolled damage to targets automatically. Unowned targets are applied by the GM client.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoStructFollowup', {
        name: 'Auto Structure / Stress Follow-ups',
        hint: 'Click the follow-up buttons on your own structure and stress cards automatically.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableKnockbackFlow', {
        name: 'Automate Knockback on Hit',
        hint: 'Auto-trigger the Knockback tool on hits with Knockback-tagged weapons.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableThrowFlow', {
        name: 'Automate Throw Choice for Thrown Weapons',
        hint: 'Thrown-tagged weapons prompt Attack or Throw at the start of the flow.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'statRollTargeting', {
        name: 'Stat Roll Targeting',
        hint: 'Adds an optional single-target picker to the stat-roll HUD to auto-calculate save difficulty.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'uplinkEnabled', {
        name: 'Roll Uplink (Beta)',
        hint: 'Streams players\' open roll dialogs to the GM as live mirror cards.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'uplinkAutoOpen', {
        name: 'Uplink Auto-Open',
        hint: 'Open the uplink bar as soon as a roll dialog appears.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'haseChanceLabels', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'actionBadgeItemName', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'weaponFxAboveTokens', {
        name: 'Weapon FX Above Tokens',
        hint: 'Since Sequencer 4, some Lancer Weapon FX render behind tokens. This lifts them back above token art.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'enableAttackTargeting', {
        name: 'LA Attack Targeting',
        hint: 'Adds an LA target/range picker to the attack HUD; hold Shift to target multiple.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'enableDamageTargeting', {
        name: 'LA Damage Targeting',
        hint: 'Adds the LA target/range picker to the damage HUD; hold Shift to target multiple.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'clearTargetsAfterRoll', {
        name: 'Clear Targets After Roll',
        hint: 'Drop targets once an attack or damage roll resolves.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'targetInfoDisplay', {
        name: 'Target Info Labels',
        hint: 'Who sees the hit-chance and damage-range labels while targeting.',
        scope: 'world',
        config: false,
        type: String,
        choices: { off: 'No', gm: 'GM only', all: 'GM and players' },
        default: 'gm'
    });

    game.settings.register(MODULE_ID,'autoStartTargetPicking', {
        name: 'Auto-Start Target Picking',
        hint: 'Open the target picker automatically when an attack starts with no target set.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'displayToolsToOthers', {
        name: 'Share Interactive Tools',
        hint: 'Show your in-progress targeting / placement / movement tools to other clients (discreet overlay), and see theirs.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'treatGenericPrintAsActivation', {
        name: 'Treat Generic Prints as Activations',
        hint: 'Items printed via the generic method also trigger onActivation events.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableMovementCapDetection', {
        name: 'Movement Cap Detection',
        hint: 'Cancel drag movement exceeding the token\'s movement cap.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableBoostOffer', {
        name: 'Boost & Move Offer',
        hint: 'Offer to cover an over-cap move with Boost then Overcharge (Automatic accepts without asking).',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            no: 'No',
            yes: 'Yes, ask first',
            auto: 'Automatic, no prompt',
        },
        default: 'no'
    });

    game.settings.register(MODULE_ID,'showDeployableLines', {
        name: 'Show Deployable Lines',
        hint: 'Draw lines between owned tokens and their deployables on hover.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Alt Structure
    game.settings.register(MODULE_ID,'enableAltStruct', {
        name: "Maria's Alternate Structure & Stress Rules",
        hint: "Integrated implementation of Maria's Alternate Structure & Stress rules. Disable if using the standalone lancer-alt-structure module.",
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    // One-Structure NPC Auto-Destroy
    game.settings.register(MODULE_ID,'enableOneStructNpc', {
        name: 'One-Structure NPC Auto-Destroy',
        hint: 'NPCs with max structure 1 skip the structure table and are destroyed on the first structure hit.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    // Vision
    game.settings.register(MODULE_ID,'dragVisionMultiplier', {
        name: 'Drag Vision Radius Multiplier',
        hint: '1 = full vision while dragging, 0.5 = half, 0 = none.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseLineOpacity', {
        name: 'Range Pulse Grid Line Opacity',
        hint: 'Opacity of the still grid lines inside the range.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0
    });

    game.settings.register(MODULE_ID,'rangePulseWaveOpacity', {
        name: 'Range Pulse Wave Opacity',
        hint: 'Opacity of the wave running through the range and of its outline.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.1, max: 1, step: 0.05 },
        default: 0.75
    });

    game.settings.register(MODULE_ID,'rangePulseLineWidth', {
        name: 'Range Pulse Wave Width',
        hint: 'Thickness of the wave and its black outline. 1 = original.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 1, max: 4, step: 0.25 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseLos', {
        name: 'Range Pulse Line of Sight',
        hint: 'Experimental. Weapon reach hides hexes you cannot see. Arcing and Seeking ignore it.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'rangePulseSpeed', {
        name: 'Range Pulse Speed',
        hint: 'Speed of the wave and of the bloom. 1 = original.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.25, max: 3, step: 0.05 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseStyle', {
        name: 'Range Pulse Style',
        hint: 'Shape drawn for each ring of the pulse.',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            inset: 'Inset tiles',
            bracket: 'Corner brackets'
        },
        default: 'inset'
    });

    game.settings.register(MODULE_ID,'rangePulseMotion', {
        name: 'Range Pulse Motion',
        hint: 'A bloom outward that repeats, or a single bloom that then holds still.',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            wave: 'Repeating bloom',
            bloom: 'One shot bloom'
        },
        default: 'bloom'
    });

    // Wreck system
    game.settings.register(MODULE_ID,'enableWrecks', {
        name: 'Wreck Automation',
        hint: 'Automate wrecking on structure reaching 0.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    // Per-category wreck mode + terrain.
    const wreckModeChoices = { token: 'Token', tile: 'Tile', none: 'Skip (do nothing)' };
    for (const cat of ['mech', 'vehicle', 'human', 'monstrosity', 'biological'])
    {
        const label = cat.charAt(0).toUpperCase() + cat.slice(1);
        game.settings.register(MODULE_ID,`wreckMode_${cat}`, {
            name: `${label}: Wreck Mode`,
            hint: `How ${label} wrecks are placed.`,
            scope: 'world',
            config: false,
            type: String,
            default: 'token',
            choices: wreckModeChoices,
        });
        game.settings.register(MODULE_ID,`wreckTerrain_${cat}`, {
            name: `${label}: Wreck Difficult Terrain`,
            hint: `What to leave behind for movement cost when a ${label} is wrecked.`,
            scope: 'world',
            config: false,
            type: String,
            default: (cat === 'mech' || cat === 'vehicle' || cat === 'monstrosity') ? 'aura' : 'none',
            choices: {
                none: 'Nothing',
                terrain: 'THT Difficult Terrain',
                aura: 'Aura on wreck (movement +1)',
            },
        });
    }
    game.settings.register(MODULE_ID,'wreckAuraColor', {
        name: 'Wreck Aura Color',
        hint: 'Line and fill color of the aura left on a wreck. Applies to new wrecks.',
        scope: 'world',
        config: false,
        type: String,
        default: '#8B4513',
    });
    game.settings.register(MODULE_ID,'wreckAuraOpacity', {
        name: 'Wreck Aura Opacity',
        hint: 'Fill opacity of the wreck aura. The outline scales with it.',
        scope: 'world',
        config: false,
        type: Number,
        default: 0.2,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID,'wreckAssetsPath', {
        name: 'Wreck Assets Folder',
        hint: 'Custom folder for wreck images/effects/audio. Leave blank for built-in.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE_ID,'wreckFactionOnDeath', {
        scope: 'world',
        config: false,
        type: String,
        default: 'same',
    });
    game.settings.register(MODULE_ID,'enableRemoveFromCombat', {
        name: 'Remove Wrecks from Combat',
        hint: 'Remove wrecked tokens from the combat tracker.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'enableWreckAnimation', {
        name: 'Wreck Explosion Effects',
        hint: 'Play explosion effects when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'enableWreckAudio', {
        name: 'Wreck Explosion Audio',
        hint: 'Play explosion sounds when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'squadLostOnDeath', {
        name: 'Squad MIA on Death',
        hint: 'Apply MIA status to dead squads.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'wreckTerrainType', {
        name: 'Wreck Terrain Type',
        hint: 'Terrain Height Tools terrain type ID for wreck difficult terrain.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE_ID,'guardianBulwarkAuraMode', {
        scope: 'world',
        config: false,
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'always',
    });
    game.settings.register(MODULE_ID,'syncActorImgToToken', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'syncActorNameToToken', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'scanJournalSource', {
        scope: 'world',
        config: false,
        type: String,
        choices: { system: 'Lancer System (v3)', 'lancer-automations': 'Lancer Automations (legacy)' },
        default: 'system',
    });
    game.settings.register(MODULE_ID,'scanPlayerOwnershipMode', {
        scope: 'world',
        config: false,
        type: String,
        choices: {
            self: 'Scanning player only',
            all: 'All players',
            group: 'Player\'s groups (Player Groups required)',
        },
        default: 'all',
    });
    game.settings.register(MODULE_ID,'revealStatsWithoutScan', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'scanRevealAllies', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'scanRevealPlayers', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'wreckMasterVolume', {
        name: 'Wreck Master Volume',
        hint: 'Volume of wreck explosion sounds (0 = mute, 1 = full).',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1.5, step: 0.1 },
    });
    game.settings.register(MODULE_ID,'disableHumanDeathSound', {
        name: 'Disable Human Death Sound',
        hint: 'Mute wreck sounds for human/pilot/squad deaths.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'allowHalfSizeTokens', {
        name: 'Allow Half-Size Tokens',
        hint: 'Size 0.5 actors get 0.5 grid token dimensions instead of being forced to 1.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'autoTokenHeight', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'autoTokenHeightVehicleSquad', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    // Debug

    game.settings.register(MODULE_ID,'debugPathHexCalculation', {
        name: 'Debug: Path Hex Calculation',
        hint: 'Draw temporary circles on the map highlighting the calculated path hex steps.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugMovement', {
        name: 'Debug: Movement',
        hint: 'Console logs from the Lancer cost-rules pipeline, revert flow, and movement recording. Also enables the on-canvas debug overlay (per-cell terrain markers).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugOutOfCombat', {
        name: 'Debug: Out of Combat Warnings',
        hint: 'Show UI warnings when an activation is skipped because the token is not in combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugAutomation', {
        name: 'Debug: Automation System',
        hint: 'Console logs from the reaction / trigger pipeline: which trigger fires, which reactions match, why each one is skipped or evaluated, and which activation fires.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugForceJb2aFree', {
        name: 'Debug: Force JB2A Free Fallbacks',
        hint: 'Pretend the JB2A Patreon module is not installed; route all premium assets through the free-version fallback registry. For testing only.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'lastNotifiedVersion', {
        name: 'Last Notified Version',
        scope: 'world',
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID,'linkManualDeploy', {
        name: 'Link Manually Placed Deployables',
        hint: 'Auto-link dragged deployable tokens to their owner and fire onDeploy.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'count3DDistance', {
        name: 'Count Elevation in Combat Distance',
        hint: 'Distance = max(horizontal, elevation). Off = 2D only. Affects overwatch, engagement, range checks.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'obstructionBlocksVehicle', {
        name: 'No Step-over: Vehicles',
        hint: 'Vehicle NPCs cannot step over terrain walls lower than their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksSquad', {
        name: 'No Step-over: Squads',
        hint: 'Squad NPCs cannot step over terrain walls lower than their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksHuman', {
        name: 'No Step-over: Humans',
        hint: 'Human NPCs cannot step over terrain walls lower than their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksSpecialist', {
        name: 'No Step-over: Specialists',
        hint: 'Specialist NPCs cannot step over terrain walls lower than their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });
}
