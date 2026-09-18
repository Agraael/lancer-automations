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
    const raw = getModuleSetting('enableBoostOffer', false);
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
        name: 'LA.settings.reactionNotificationMode.name',
        hint: 'LA.settings.reactionNotificationMode.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            "both": "LA.settings.reactionNotificationMode.choices.both",
            "gm": "LA.settings.reactionNotificationMode.choices.gm",
            "owner": "LA.settings.reactionNotificationMode.choices.owner"
        },
        default: "both"
    });

    game.settings.register(MODULE_ID,'effectNotificationMode', {
        name: 'LA.settings.effectNotificationMode.name',
        hint: 'LA.settings.effectNotificationMode.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            "public": "LA.settings.effectNotificationMode.choices.public",
            "whisper": "LA.settings.effectNotificationMode.choices.whisper",
            "off": "LA.settings.effectNotificationMode.choices.off"
        },
        default: "public"
    });

    game.settings.register(MODULE_ID,'consumeReaction', {
        name: 'LA.settings.consumeReaction.name',
        hint: 'LA.settings.consumeReaction.hint',
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
        name: 'LA.settings.consumeAction.name',
        hint: 'LA.settings.consumeAction.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'overlapTokenPicker', {
        name: 'LA.settings.overlapTokenPicker.name',
        hint: 'LA.settings.overlapTokenPicker.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusDuration', {
        name: 'LA.settings.autoFocusDuration.name',
        hint: 'LA.settings.autoFocusDuration.hint',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 200, max: 3000, step: 100 },
        default: 1000
    });

    game.settings.register(MODULE_ID,'autoFocusCards', {
        name: 'LA.settings.autoFocusCards.name',
        hint: 'LA.settings.autoFocusCards.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusAttack', {
        name: 'LA.settings.autoFocusAttack.name',
        hint: 'LA.settings.autoFocusAttack.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusDamage', {
        name: 'LA.settings.autoFocusDamage.name',
        hint: 'LA.settings.autoFocusDamage.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusCheck', {
        name: 'LA.settings.autoFocusCheck.name',
        hint: 'LA.settings.autoFocusCheck.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoFocusActivation', {
        name: 'LA.settings.autoFocusActivation.name',
        hint: 'LA.settings.autoFocusActivation.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'showBonusHudButton', {
        name: 'LA.settings.showBonusHudButton.name',
        hint: 'LA.settings.showBonusHudButton.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showStatusEffectsHudButton', {
        name: 'LA.settings.showStatusEffectsHudButton.name',
        hint: 'LA.settings.showStatusEffectsHudButton.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showCombatStateHudButton', {
        name: 'LA.settings.showCombatStateHudButton.name',
        hint: 'LA.settings.showCombatStateHudButton.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showTargetStateHudButton', {
        name: 'LA.settings.showTargetStateHudButton.name',
        hint: 'LA.settings.showTargetStateHudButton.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'showRevertMovementHudButton', {
        name: 'LA.settings.showRevertMovementHudButton.name',
        hint: 'LA.settings.showRevertMovementHudButton.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'statusHalo', {
        name: 'LA.settings.statusHalo.name',
        hint: 'LA.settings.statusHalo.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusHaloRadius', {
        name: 'LA.settings.statusHaloRadius.name',
        hint: 'LA.settings.statusHaloRadius.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0.5, max: 2, step: 0.05 },
        default: 1.15,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusIconMinZoomScale', {
        name: 'LA.settings.statusIconMinZoomScale.name',
        hint: 'LA.settings.statusIconMinZoomScale.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 4, step: 0.1 },
        default: 0,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusHaloStartAngle', {
        name: 'LA.settings.statusHaloStartAngle.name',
        hint: 'LA.settings.statusHaloStartAngle.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 360, step: 5 },
        default: 135,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusIconHover', {
        name: 'LA.settings.statusIconHover.name',
        hint: 'LA.settings.statusIconHover.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'statusCounterColor', {
        name: 'LA.settings.statusCounterColor.name',
        hint: 'LA.settings.statusCounterColor.hint',
        scope: 'world',
        config: false,
        type: String,
        default: '#00aaff',
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusUsageColor', {
        name: 'LA.settings.statusUsageColor.name',
        hint: 'LA.settings.statusUsageColor.hint',
        scope: 'world',
        config: false,
        type: String,
        default: '#c39bff',
        onChange: () =>
        {
            canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }));
            ui.combat?.render();
        }
    });

    game.settings.register(MODULE_ID,'statusDurationColor', {
        name: 'LA.settings.statusDurationColor.name',
        hint: 'LA.settings.statusDurationColor.hint',
        scope: 'world',
        config: false,
        type: String,
        default: '#ffd700',
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    game.settings.register(MODULE_ID,'statusBadgeFontScale', {
        name: 'LA.settings.statusBadgeFontScale.name',
        hint: 'LA.settings.statusBadgeFontScale.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0.5, max: 2, step: 0.05 },
        default: 1,
        onChange: () => canvas?.tokens?.placeables.forEach(token => token.renderFlags.set({ redrawEffects: true }))
    });

    // Features
    // Surfaced in the StatusFX config menu instead of the main settings panel
    game.settings.register(MODULE_ID,'additionalStatuses', {
        name: 'LA.settings.additionalStatuses.name',
        hint: 'LA.settings.additionalStatuses.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'enablePerRoundTurnTags', {
        name: 'LA.settings.enablePerRoundTurnTags.name',
        hint: 'LA.settings.enablePerRoundTurnTags.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'enableInfectionDamageIntegration', {
        name: 'LA.settings.enableInfectionDamageIntegration.name',
        hint: 'LA.settings.enableInfectionDamageIntegration.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        requiresReload: true
    });

    game.settings.register(MODULE_ID,'convertHeatToEnergyOnHeatless', {
        name: 'LA.settings.convertHeatToEnergyOnHeatless.name',
        hint: 'LA.settings.convertHeatToEnergyOnHeatless.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'resistSelfHeat', {
        name: 'LA.settings.resistSelfHeat.name',
        hint: 'LA.settings.resistSelfHeat.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoDamageRoll', {
        name: 'LA.settings.autoDamageRoll.name',
        hint: 'LA.settings.autoDamageRoll.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoDamageApply', {
        name: 'LA.settings.autoDamageApply.name',
        hint: 'LA.settings.autoDamageApply.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'autoStructFollowup', {
        name: 'LA.settings.autoStructFollowup.name',
        hint: 'LA.settings.autoStructFollowup.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableKnockbackFlow', {
        name: 'LA.settings.enableKnockbackFlow.name',
        hint: 'LA.settings.enableKnockbackFlow.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableThrowFlow', {
        name: 'LA.settings.enableThrowFlow.name',
        hint: 'LA.settings.enableThrowFlow.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'statRollTargeting', {
        name: 'LA.settings.statRollTargeting.name',
        hint: 'LA.settings.statRollTargeting.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'uplinkEnabled', {
        name: 'LA.settings.uplinkEnabled.name',
        hint: 'LA.settings.uplinkEnabled.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'uplinkAutoOpen', {
        name: 'LA.settings.uplinkAutoOpen.name',
        hint: 'LA.settings.uplinkAutoOpen.hint',
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
        name: 'LA.settings.weaponFxAboveTokens.name',
        hint: 'LA.settings.weaponFxAboveTokens.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'enableAttackTargeting', {
        name: 'LA.settings.enableAttackTargeting.name',
        hint: 'LA.settings.enableAttackTargeting.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'enableDamageTargeting', {
        name: 'LA.settings.enableDamageTargeting.name',
        hint: 'LA.settings.enableDamageTargeting.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'clearTargetsAfterRoll', {
        name: 'LA.settings.clearTargetsAfterRoll.name',
        hint: 'LA.settings.clearTargetsAfterRoll.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'targetInfoDisplay', {
        name: 'LA.settings.targetInfoDisplay.name',
        hint: 'LA.settings.targetInfoDisplay.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            off: 'LA.settings.targetInfoDisplay.choices.off',
            gm: 'LA.settings.targetInfoDisplay.choices.gm',
            all: 'LA.settings.targetInfoDisplay.choices.all',
        },
        default: 'gm'
    });

    game.settings.register(MODULE_ID,'autoStartTargetPicking', {
        name: 'LA.settings.autoStartTargetPicking.name',
        hint: 'LA.settings.autoStartTargetPicking.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'displayToolsToOthers', {
        name: 'LA.settings.displayToolsToOthers.name',
        hint: 'LA.settings.displayToolsToOthers.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'treatGenericPrintAsActivation', {
        name: 'LA.settings.treatGenericPrintAsActivation.name',
        hint: 'LA.settings.treatGenericPrintAsActivation.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableMovementCapDetection', {
        name: 'LA.settings.enableMovementCapDetection.name',
        hint: 'LA.settings.enableMovementCapDetection.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableBoostOffer', {
        name: 'LA.settings.enableBoostOffer.name',
        hint: 'LA.settings.enableBoostOffer.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            no: 'LA.settings.enableBoostOffer.choices.no',
            yes: 'LA.settings.enableBoostOffer.choices.yes',
            auto: 'LA.settings.enableBoostOffer.choices.auto',
        },
        default: 'no'
    });

    const refreshShadows = () => import('../fx/token-ground-shadow.js')
        .then(module => module.refreshAllGroundShadows());

    game.settings.register(MODULE_ID,'tokenGroundShadow', {
        name: 'LA.settings.tokenGroundShadow.name',
        hint: 'LA.settings.tokenGroundShadow.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshShadows
    });

    game.settings.register(MODULE_ID,'tokenGroundShadowThrow', {
        name: 'LA.settings.tokenGroundShadowThrow.name',
        hint: 'LA.settings.tokenGroundShadowThrow.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 40, step: 1 },
        default: 9,
        onChange: refreshShadows
    });

    game.settings.register(MODULE_ID,'tokenGroundShadowOpacity', {
        name: 'LA.settings.tokenGroundShadowOpacity.name',
        hint: 'LA.settings.tokenGroundShadowOpacity.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0.05, max: 1, step: 0.05 },
        default: 0.55,
        onChange: refreshShadows
    });

    game.settings.register(MODULE_ID,'showDeployableLines', {
        name: 'LA.settings.showDeployableLines.name',
        hint: 'LA.settings.showDeployableLines.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true
    });

    // Alt Structure
    game.settings.register(MODULE_ID,'enableAltStruct', {
        name: 'LA.settings.enableAltStruct.name',
        hint: 'LA.settings.enableAltStruct.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        requiresReload: true,
    });

    // One-Structure NPC Auto-Destroy
    game.settings.register(MODULE_ID,'enableOneStructNpc', {
        name: 'LA.settings.enableOneStructNpc.name',
        hint: 'LA.settings.enableOneStructNpc.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
    });

    // Vision
    game.settings.register(MODULE_ID,'dragVisionMultiplier', {
        name: 'LA.settings.dragVisionMultiplier.name',
        hint: 'LA.settings.dragVisionMultiplier.hint',
        scope: 'world',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseLineOpacity', {
        name: 'LA.settings.rangePulseLineOpacity.name',
        hint: 'LA.settings.rangePulseLineOpacity.hint',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0, max: 1, step: 0.05 },
        default: 0
    });

    game.settings.register(MODULE_ID,'rangePulseWaveOpacity', {
        name: 'LA.settings.rangePulseWaveOpacity.name',
        hint: 'LA.settings.rangePulseWaveOpacity.hint',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.1, max: 1, step: 0.05 },
        default: 0.75
    });

    game.settings.register(MODULE_ID,'rangePulseLineWidth', {
        name: 'LA.settings.rangePulseLineWidth.name',
        hint: 'LA.settings.rangePulseLineWidth.hint',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 1, max: 4, step: 0.25 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseLos', {
        name: 'LA.settings.rangePulseLos.name',
        hint: 'LA.settings.rangePulseLos.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'rangePulseSpeed', {
        name: 'LA.settings.rangePulseSpeed.name',
        hint: 'LA.settings.rangePulseSpeed.hint',
        scope: 'client',
        config: false,
        type: Number,
        range: { min: 0.25, max: 3, step: 0.05 },
        default: 1
    });

    game.settings.register(MODULE_ID,'rangePulseStyle', {
        name: 'LA.settings.rangePulseStyle.name',
        hint: 'LA.settings.rangePulseStyle.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            inset: 'LA.settings.rangePulseStyle.choices.inset',
            bracket: 'LA.settings.rangePulseStyle.choices.bracket'
        },
        default: 'inset'
    });

    game.settings.register(MODULE_ID,'rangePulseMotion', {
        name: 'LA.settings.rangePulseMotion.name',
        hint: 'LA.settings.rangePulseMotion.hint',
        scope: 'client',
        config: false,
        type: String,
        choices: {
            wave: 'LA.settings.rangePulseMotion.choices.wave',
            bloom: 'LA.settings.rangePulseMotion.choices.bloom'
        },
        default: 'bloom'
    });

    // Wreck system
    game.settings.register(MODULE_ID,'enableWrecks', {
        name: 'LA.settings.enableWrecks.name',
        hint: 'LA.settings.enableWrecks.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    // Per-category wreck mode + terrain.
    const wreckModeChoices = {
        token: 'LA.settings.wreckMode.choices.token',
        tile: 'LA.settings.wreckMode.choices.tile',
        none: 'LA.settings.wreckMode.choices.none',
    };
    for (const cat of ['mech', 'vehicle', 'human', 'monstrosity', 'biological'])
    {
        game.settings.register(MODULE_ID,`wreckMode_${cat}`, {
            name: 'LA.settings.wreckMode.name',
            hint: 'LA.settings.wreckMode.hint',
            scope: 'world',
            config: false,
            type: String,
            default: 'token',
            choices: wreckModeChoices,
        });
        game.settings.register(MODULE_ID,`wreckTerrain_${cat}`, {
            name: 'LA.settings.wreckTerrain.name',
            hint: 'LA.settings.wreckTerrain.hint',
            scope: 'world',
            config: false,
            type: String,
            default: (cat === 'mech' || cat === 'vehicle' || cat === 'monstrosity') ? 'aura' : 'none',
            choices: {
                none: 'LA.settings.wreckTerrain.choices.none',
                terrain: 'LA.settings.wreckTerrain.choices.terrain',
                aura: 'LA.settings.wreckTerrain.choices.aura',
            },
        });
    }
    game.settings.register(MODULE_ID,'wreckAuraColor', {
        name: 'LA.settings.wreckAuraColor.name',
        hint: 'LA.settings.wreckAuraColor.hint',
        scope: 'world',
        config: false,
        type: String,
        default: '#8B4513',
    });
    game.settings.register(MODULE_ID,'wreckAuraOpacity', {
        name: 'LA.settings.wreckAuraOpacity.name',
        hint: 'LA.settings.wreckAuraOpacity.hint',
        scope: 'world',
        config: false,
        type: Number,
        default: 0.2,
        range: { min: 0, max: 1, step: 0.05 },
    });
    game.settings.register(MODULE_ID,'wreckAssetsPath', {
        name: 'LA.settings.wreckAssetsPath.name',
        hint: 'LA.settings.wreckAssetsPath.hint',
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
        name: 'LA.settings.enableRemoveFromCombat.name',
        hint: 'LA.settings.enableRemoveFromCombat.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'enableWreckAnimation', {
        name: 'LA.settings.enableWreckAnimation.name',
        hint: 'LA.settings.enableWreckAnimation.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'enableWreckAudio', {
        name: 'LA.settings.enableWreckAudio.name',
        hint: 'LA.settings.enableWreckAudio.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'squadLostOnDeath', {
        name: 'LA.settings.squadLostOnDeath.name',
        hint: 'LA.settings.squadLostOnDeath.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
    });
    game.settings.register(MODULE_ID,'wreckTerrainType', {
        name: 'LA.settings.wreckTerrainType.name',
        hint: 'LA.settings.wreckTerrainType.hint',
        scope: 'world',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE_ID,'guardianBulwarkAuraMode', {
        scope: 'world',
        config: false,
        type: String,
        choices: {
            off: 'LA.settings.guardianBulwarkAuraMode.choices.off',
            combat: 'LA.settings.guardianBulwarkAuraMode.choices.combat',
            always: 'LA.settings.guardianBulwarkAuraMode.choices.always',
        },
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
        choices: {
            system: 'LA.settings.scanJournalSource.choices.system',
            'lancer-automations': 'LA.settings.scanJournalSource.choices.lancer-automations',
        },
        default: 'system',
    });
    game.settings.register(MODULE_ID,'scanPlayerOwnershipMode', {
        scope: 'world',
        config: false,
        type: String,
        choices: {
            self: 'LA.settings.scanPlayerOwnershipMode.choices.self',
            all: 'LA.settings.scanPlayerOwnershipMode.choices.all',
            group: 'LA.settings.scanPlayerOwnershipMode.choices.group',
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
        name: 'LA.settings.wreckMasterVolume.name',
        hint: 'LA.settings.wreckMasterVolume.hint',
        scope: 'client',
        config: false,
        type: Number,
        default: 1,
        range: { min: 0, max: 1.5, step: 0.1 },
    });
    game.settings.register(MODULE_ID,'disableHumanDeathSound', {
        name: 'LA.settings.disableHumanDeathSound.name',
        hint: 'LA.settings.disableHumanDeathSound.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
    });
    game.settings.register(MODULE_ID,'allowHalfSizeTokens', {
        name: 'LA.settings.allowHalfSizeTokens.name',
        hint: 'LA.settings.allowHalfSizeTokens.hint',
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
        name: 'LA.settings.debugPathHexCalculation.name',
        hint: 'LA.settings.debugPathHexCalculation.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugMovement', {
        name: 'LA.settings.debugMovement.name',
        hint: 'LA.settings.debugMovement.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugOutOfCombat', {
        name: 'LA.settings.debugOutOfCombat.name',
        hint: 'LA.settings.debugOutOfCombat.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugAutomation', {
        name: 'LA.settings.debugAutomation.name',
        hint: 'LA.settings.debugAutomation.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'debugForceJb2aFree', {
        name: 'LA.settings.debugForceJb2aFree.name',
        hint: 'LA.settings.debugForceJb2aFree.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'lastNotifiedVersion', {
        name: 'LA.settings.lastNotifiedVersion.name',
        scope: 'world',
        config: false,
        type: String,
        default: ""
    });

    game.settings.register(MODULE_ID,'linkManualDeploy', {
        name: 'LA.settings.linkManualDeploy.name',
        hint: 'LA.settings.linkManualDeploy.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'count3DDistance', {
        name: 'LA.settings.count3DDistance.name',
        hint: 'LA.settings.count3DDistance.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });

    game.settings.register(MODULE_ID,'enableObstructionStepOver', {
        name: 'LA.settings.enableObstructionStepOver.name',
        hint: 'LA.settings.enableObstructionStepOver.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksVehicle', {
        name: 'LA.settings.obstructionBlocksVehicle.name',
        hint: 'LA.settings.obstructionBlocksVehicle.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksSquad', {
        name: 'LA.settings.obstructionBlocksSquad.name',
        hint: 'LA.settings.obstructionBlocksSquad.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksHuman', {
        name: 'LA.settings.obstructionBlocksHuman.name',
        hint: 'LA.settings.obstructionBlocksHuman.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });

    game.settings.register(MODULE_ID,'obstructionBlocksSpecialist', {
        name: 'LA.settings.obstructionBlocksSpecialist.name',
        hint: 'LA.settings.obstructionBlocksSpecialist.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });
}
