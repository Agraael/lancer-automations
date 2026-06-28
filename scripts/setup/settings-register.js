/* global game */

export function registerSettings() {
    // ── Core ──
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

    // ── Features ──
    // Surfaced in the StatusFX config menu instead of the main settings panel
    game.settings.register('lancer-automations', 'additionalStatuses', {
        name: 'LaSossis Additional statuses and effects',
        hint: 'Extra statuses (Resist All, Disengage, Grappling, etc.) in the status effects list.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
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
        name: 'Enable Stat Roll Target Selection',
        hint: 'Stat rolls prompt for a target to auto-calculate difficulty.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register('lancer-automations', 'enableAttackTargeting', {
        name: 'LA Attack Targeting',
        hint: 'Adds an LA target/range picker to the attack HUD; hold Shift to target multiple.',
        scope: 'world',
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

    game.settings.register('lancer-automations', 'enablePathHexCalculation', {
        name: 'Enable Path Hex Calculation',
        hint: 'Tracks exact path hexes during movement. Needed for movement interception.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register('lancer-automations', 'experimentalBoostDetection', {
        name: 'Experimental Boost Detection (WIP)',
        hint: 'Detects Boost when cumulative drag exceeds base speed.',
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

    // ── Alt Structure ──
    game.settings.register('lancer-automations', 'enableAltStruct', {
        name: "Maria's Alternate Structure & Stress Rules",
        hint: "Integrated implementation of Maria's Alternate Structure & Stress rules. Disable if using the standalone lancer-alt-structure module.",
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    // ── One-Structure NPC Auto-Destroy ──
    game.settings.register('lancer-automations', 'enableOneStructNpc', {
        name: 'One-Structure NPC Auto-Destroy',
        hint: 'NPCs with max structure 1 skip the structure table and are destroyed on the first structure hit.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    // ── Vision ──
    game.settings.register('lancer-automations', 'dragVisionMultiplier', {
        name: 'Drag Vision Radius Multiplier',
        hint: '1 = full vision while dragging, 0.5 = half, 0 = none.',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 1
    });

    // ── Wreck system ──
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
    for (const cat of ['mech', 'human', 'monstrosity', 'biological']) {
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
            default: (cat === 'mech' || cat === 'monstrosity') ? 'aura' : 'none',
            choices: {
                none: 'Nothing',
                terrain: 'THT Difficult Terrain',
                aura: 'Aura on wreck (movement +1)',
            },
        });
    }
    game.settings.register('lancer-automations', 'wreckAssetsPath', {
        name: 'Wreck Assets Folder',
        hint: 'Custom folder for wreck images/effects/audio. Leave blank for built-in.',
        scope: 'world',
        config: false,
        type: String,
        default: '',
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
        name: 'Guardian / Bulwark Aura',
        hint: '"Only in Combat" requires the GAA Fork.',
        scope: 'world',
        config: false,
        type: String,
        choices: { off: 'Disabled', combat: 'Only in Combat', always: 'Always' },
        default: 'always',
    });
    game.settings.register('lancer-automations', 'syncActorImgToToken', {
        name: 'Sync actor portrait to token image',
        hint: 'When the prototype token image changes, also update the actor portrait (used in the Actors directory).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'syncActorNameToToken', {
        name: 'Sync actor name to token name',
        hint: 'When the prototype token name changes, also update the actor name (Actors directory).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'scanJournalSource', {
        name: 'Scan journal source',
        hint: 'System: native Lancer v3 scan journal. LA legacy: the older Lancer Automations custom journal template.',
        scope: 'world',
        config: false,
        type: String,
        choices: { system: 'Lancer System (v3)', 'lancer-automations': 'Lancer Automations (legacy)' },
        default: 'system',
    });
    game.settings.register('lancer-automations', 'scanPlayerOwnershipMode', {
        name: 'Scan ownership when a player scans',
        hint: 'Who gets owner permission on the journal entry when a non-GM scans. GM scans always grant ownership to all players.',
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
        name: 'Auto Token Height (Wall Height)',
        hint: 'If Wall Height is active, auto-set tokenHeight to actor size + 0.1 so tokens can peek above walls of their size.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register('lancer-automations', 'autoTokenHeightVehicleSquad', {
        name: 'Vehicle & Squad Height Adjustments',
        hint: 'Vehicles get reduced height (size 1 = 0.5, otherwise size-1, capped at 4). Squads get 0.5.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });
    // ── Debug ──
    game.settings.register('lancer-automations', 'debugBoostDetection', {
        name: 'Debug: Boost Detection',
        hint: 'Show UI notifications when boost detection triggers.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

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
