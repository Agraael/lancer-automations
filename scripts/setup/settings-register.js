/* global game */

// A setting read before its registration throws, so early hooks treat that as off.
export function getSettingEnabled(key, moduleId = 'lancer-automations')
{
    try
    {
        return !!game.settings.get(moduleId, key);
    }
    catch
    {
        return false;
    }
}

export function registerSettings()
{
    // Core
    game.settings.register('lancer-automations', 'reactionNotificationMode', {
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

    game.settings.register('lancer-automations', 'consumeReaction', {
        name: 'Consume Reaction on Activation',
        hint: 'Auto-spend the token\'s reaction when a Reaction activation fires.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'qolAdvisoryShown', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'compatWarningsShown', {
        scope: 'world',
        config: false,
        type: Array,
        default: []
    });

    game.settings.register('lancer-automations', 'consumeAction', {
        name: 'Consume Action on Activation',
        hint: 'Auto-spend the token\'s Quick / Full action when an activation flow succeeds.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'overlapTokenPicker', {
        name: 'Overlapping Token Picker',
        hint: 'When clicking a token at the same spot and size as others, open a picker to choose among them.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoFocusDuration', {
        name: 'Focus Pan Duration',
        hint: 'How long the camera takes to reach the focused tokens, in milliseconds.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 200, max: 3000, step: 100 },
        default: 1000
    });

    game.settings.register('lancer-automations', 'autoFocusCards', {
        name: 'Focus on Interactive Cards',
        hint: 'Pan the canvas to the card\'s tokens when a choice, confirm or wait card shows.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoFocusAttack', {
        name: 'Focus on Attack Rolls',
        hint: 'Pan the canvas to the attacker and targets when the attack rolls, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoFocusDamage', {
        name: 'Focus on Damage Rolls',
        hint: 'Pan the canvas to the attacker and targets when damage rolls, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoFocusCheck', {
        name: 'Focus on Stat Rolls',
        hint: 'Pan the canvas to the roller and its target when a stat roll happens, or when its card reaches you.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoFocusActivation', {
        name: 'Focus on Activations',
        hint: 'Pan the canvas to the acting token when its action FX plays.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'showBonusHudButton', {
        name: 'Token HUD Bonus Button',
        hint: 'Adds a button on the Token HUD to open the Effect Manager.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showStatusEffectsHudButton', {
        name: 'Token HUD Status Effects Button',
        hint: 'Foundry\'s default "Assign Status Effects" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showCombatStateHudButton', {
        name: 'Token HUD Combat State Button',
        hint: 'Foundry\'s default "Toggle Combat State" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showTargetStateHudButton', {
        name: 'Token HUD Target State Button',
        hint: 'Foundry\'s default "Toggle Target State" button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'showRevertMovementHudButton', {
        name: 'Revert Movement Button',
        hint: 'The Revert Last Movement / Reset Movement History button on the Token HUD.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'statusHalo', {
        name: 'Status Icon Halo',
        hint: 'Status icons circle around the token instead of stacking in a column.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register('lancer-automations', 'statusHaloRadius', {
        name: 'Halo Radius',
        hint: 'Ring radius as a fraction of the token size.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0.5, max: 2, step: 0.05 },
        default: 1.15,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register('lancer-automations', 'statusIconMinZoomScale', {
        name: 'Minimum Icon Zoom Scale',
        hint: 'Below this zoom level the icons keep a constant screen size. 0 = disabled.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 4, step: 0.1 },
        default: 0,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register('lancer-automations', 'statusHaloStartAngle', {
        name: 'Halo Start Angle',
        hint: 'Angle of the first icon, in degrees counterclockwise from the token\'s right.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 360, step: 5 },
        default: 135,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register('lancer-automations', 'statusIconHover', {
        name: 'Status Icon Hover Info',
        hint: 'Hovering a status icon enlarges it and shows its name, description, duration and bonus.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Features
    // Surfaced in the StatusFX config menu instead of the main settings panel
    game.settings.register('lancer-automations', 'additionalStatuses', {
        name: 'LaSossis Additional statuses and effects',
        hint: 'Extra statuses (Resist All, Disengage, Grappling, etc.) in the status effects list.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register('lancer-automations', 'enablePerRoundTurnTags', {
        name: 'Per-Round / Per-Turn / Per-Scene Enforcement',
        hint: 'Enforce per-round and per-turn tags (tg_round, tg_turn) and per-scene frequencies ("N/scene", use="Encounter"). Blocks attacks/activations at the limit and auto-resets on round/turn/combat. Requires reload.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });

    game.settings.register('lancer-automations', 'enableInfectionDamageIntegration', {
        name: 'Infection Damage Integration',
        hint: 'Adds Infection as a fully integrated Lancer damage type. Requires reload.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register('lancer-automations', 'convertHeatToEnergyOnHeatless', {
        name: 'Heat as Energy on heatless targets',
        hint: 'Convert Heat damage to Energy when the target has no heat capacity (pilots, biological NPCs). Mirrors what Lancer does natively for pilots.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'resistSelfHeat', {
        name: 'Resist Self-Inflicted Heat',
        hint: 'Halve self-inflicted heat from self-heat, overkill, and overcharge when the mech resists Heat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoDamageRoll', {
        name: 'Auto Damage Roll',
        hint: 'Open the Damage HUD automatically after an attack.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'autoDamageApply', {
        name: 'Auto Apply Damage',
        hint: 'Apply rolled damage to targets automatically. Unowned targets are applied by the GM client.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableKnockbackFlow', {
        name: 'Automate Knockback on Hit',
        hint: 'Auto-trigger the Knockback tool on hits with Knockback-tagged weapons.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableThrowFlow', {
        name: 'Automate Throw Choice for Thrown Weapons',
        hint: 'Thrown-tagged weapons prompt Attack or Throw at the start of the flow.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'statRollTargeting', {
        name: 'Stat Roll Targeting',
        hint: 'Adds an optional single-target picker to the stat-roll HUD to auto-calculate save difficulty.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'haseChanceLabels', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'actionBadgeItemName', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'weaponFxAboveTokens', {
        name: 'Weapon FX Above Tokens',
        hint: 'Since Sequencer 4, some Lancer Weapon FX render behind tokens. This lifts them back above token art.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'enableAttackTargeting', {
        name: 'LA Attack Targeting',
        hint: 'Adds an LA target/range picker to the attack HUD; hold Shift to target multiple.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'enableDamageTargeting', {
        name: 'LA Damage Targeting',
        hint: 'Adds the LA target/range picker to the damage HUD; hold Shift to target multiple.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'clearTargetsAfterRoll', {
        name: 'Clear Targets After Roll',
        hint: 'Drop targets once an attack or damage roll resolves.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'targetInfoDisplay', {
        name: 'Target Info Labels',
        hint: 'Who sees the hit-chance and damage-range labels while targeting.',
        scope: 'world',
        config: false,
        type: String,
        choices: { off: 'No', gm: 'GM only', all: 'GM and players' },
        default: 'gm'
    });

    game.settings.register('lancer-automations', 'autoStartTargetPicking', {
        name: 'Auto-Start Target Picking',
        hint: 'Open the target picker automatically when an attack starts with no target set.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'displayToolsToOthers', {
        name: 'Share Interactive Tools',
        hint: 'Show your in-progress targeting / placement / movement tools to other clients (discreet overlay), and see theirs.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'treatGenericPrintAsActivation', {
        name: 'Treat Generic Prints as Activations',
        hint: 'Items printed via the generic method also trigger onActivation events.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableMovementCapDetection', {
        name: 'Movement Cap Detection [beta]',
        hint: 'Cancel drag movement exceeding the token\'s movement cap.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableBoostOffer', {
        name: 'Boost & Move Offer [beta]',
        hint: 'When a move exceeds the cap, offer to split it with Boost (and Overcharge for mechs or NPCs with the Overcharge action).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'showDeployableLines', {
        name: 'Show Deployable Lines',
        hint: 'Draw lines between owned tokens and their deployables on hover.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Alt Structure
    game.settings.register('lancer-automations', 'enableAltStruct', {
        name: "Maria's Alternate Structure & Stress Rules",
        hint: "Integrated implementation of Maria's Alternate Structure & Stress rules. Disable if using the standalone lancer-alt-structure module.",
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    // One-Structure NPC Auto-Destroy
    game.settings.register('lancer-automations', 'enableOneStructNpc', {
        name: 'One-Structure NPC Auto-Destroy',
        hint: 'NPCs with max structure 1 skip the structure table and are destroyed on the first structure hit.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    // Vision
    game.settings.register('lancer-automations', 'dragVisionMultiplier', {
        name: 'Drag Vision Radius Multiplier',
        hint: '1 = full vision while dragging, 0.5 = half, 0 = none.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 1
    });

    game.settings.register('lancer-automations', 'rangePulseLineOpacity', {
        name: 'Range Pulse Grid Line Opacity',
        hint: 'Opacity of the still grid lines inside the range.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0
    });

    game.settings.register('lancer-automations', 'rangePulseWaveOpacity', {
        name: 'Range Pulse Wave Opacity',
        hint: 'Opacity of the wave running through the range and of its outline.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.1, max: 1, step: 0.05 },
        default: 0.75
    });

    game.settings.register('lancer-automations', 'rangePulseLineWidth', {
        name: 'Range Pulse Wave Width',
        hint: 'Thickness of the wave and its black outline. 1 = original.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 1, max: 4, step: 0.25 },
        default: 1
    });

    game.settings.register('lancer-automations', 'rangePulseLos', {
        name: 'Range Pulse Line of Sight',
        hint: 'Experimental. Weapon reach hides hexes you cannot see. Arcing and Seeking ignore it.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'rangePulseSpeed', {
        name: 'Range Pulse Speed',
        hint: 'Speed of the wave and of the bloom. 1 = original.',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.25, max: 3, step: 0.05 },
        default: 1
    });

    game.settings.register('lancer-automations', 'rangePulseStyle', {
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

    game.settings.register('lancer-automations', 'rangePulseMotion', {
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
    game.settings.register('lancer-automations', 'enableWrecks', {
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
        game.settings.register('lancer-automations', `wreckMode_${cat}`, {
            name: `${label}: Wreck Mode`,
            hint: `How ${label} wrecks are placed.`,
            scope: 'world',
            config: false,
            type: String,
            default: 'token',
            choices: wreckModeChoices,
        });
        game.settings.register('lancer-automations', `wreckTerrain_${cat}`, {
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
    game.settings.register('lancer-automations', 'wreckAuraColor', {
        name: 'Wreck Aura Color',
        hint: 'Line and fill color of the aura left on a wreck. Applies to new wrecks.',
        scope: 'world',
        config: false,
        type: String,
        default: '#8B4513',
    });
    game.settings.register('lancer-automations', 'wreckAuraOpacity', {
        name: 'Wreck Aura Opacity',
        hint: 'Fill opacity of the wreck aura; the outline scales with it.',
        scope: 'world',
        config: false,
        type: Number,
        default: 0.2,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register('lancer-automations', 'wreckAssetsPath', {
        name: 'Wreck Assets Folder',
        hint: 'Custom folder for wreck images/effects/audio. Leave blank for built-in.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register('lancer-automations', 'wreckFactionOnDeath', {
        scope: 'world',
        config: false,
        type: String,
        default: 'same',
    });
    game.settings.register('lancer-automations', 'enableRemoveFromCombat', {
        name: 'Remove Wrecks from Combat',
        hint: 'Remove wrecked tokens from the combat tracker.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'enableWreckAnimation', {
        name: 'Wreck Explosion Effects',
        hint: 'Play explosion effects when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'enableWreckAudio', {
        name: 'Wreck Explosion Audio',
        hint: 'Play explosion sounds when tokens are wrecked.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'squadLostOnDeath', {
        name: 'Squad MIA on Death',
        hint: 'Apply MIA status to dead squads.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register('lancer-automations', 'wreckTerrainType', {
        name: 'Wreck Terrain Type',
        hint: 'Terrain Height Tools terrain type ID for wreck difficult terrain.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register('lancer-automations', 'guardianBulwarkAuraMode', {
        scope: 'world',
        config: false,
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'always',
    });
    game.settings.register('lancer-automations', 'syncActorImgToToken', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'syncActorNameToToken', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'scanJournalSource', {
        scope: 'world',
        config: false,
        type: String,
        choices: { system: 'Lancer System (v3)', 'lancer-automations': 'Lancer Automations (legacy)' },
        default: 'system',
    });
    game.settings.register('lancer-automations', 'scanPlayerOwnershipMode', {
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
    game.settings.register('lancer-automations', 'revealStatsWithoutScan', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'wreckMasterVolume', {
        name: 'Wreck Master Volume',
        hint: 'Volume of wreck explosion sounds (0 = mute, 1 = full).',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1.5, step: 0.1 },
    });
    game.settings.register('lancer-automations', 'disableHumanDeathSound', {
        name: 'Disable Human Death Sound',
        hint: 'Mute wreck sounds for human/pilot/squad deaths.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'allowHalfSizeTokens', {
        name: 'Allow Half-Size Tokens',
        hint: 'Size 0.5 actors get 0.5 grid token dimensions instead of being forced to 1.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'autoTokenHeight', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'autoTokenHeightVehicleSquad', {
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    // Debug

    game.settings.register('lancer-automations', 'debugPathHexCalculation', {
        name: 'Debug: Path Hex Calculation',
        hint: 'Draw temporary circles on the map highlighting the calculated path hex steps.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugMovement', {
        name: 'Debug: Movement',
        hint: 'Console logs from the Lancer cost-rules pipeline, revert flow, and movement recording. Also enables the on-canvas debug overlay (per-cell terrain markers).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugOutOfCombat', {
        name: 'Debug: Out of Combat Warnings',
        hint: 'Show UI warnings when an activation is skipped because the token is not in combat.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugAutomation', {
        name: 'Debug: Automation System',
        hint: 'Console logs from the reaction / trigger pipeline: which trigger fires, which reactions match, why each one is skipped or evaluated, and which activation fires.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'debugForceJb2aFree', {
        name: 'Debug: Force JB2A Free Fallbacks',
        hint: 'Pretend the JB2A Patreon module is not installed; route all premium assets through the free-version fallback registry. For testing only.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'lastNotifiedVersion', {
        name: 'Last Notified Version',
        scope: 'world',
        config: false,
        type: String,
        default: ""
    });

    game.settings.register('lancer-automations', 'linkManualDeploy', {
        name: 'Link Manually Placed Deployables',
        hint: 'Auto-link dragged deployable tokens to their owner and fire onDeploy.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'count3DDistance', {
        name: 'Count Elevation in Combat Distance',
        hint: 'Distance = max(horizontal, elevation). Off = 2D only. Affects overwatch, engagement, range checks.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });
}
