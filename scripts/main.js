/*global PIXI, libWrapper */

import "./movement/token-ruler.js";
import "./movement/tactical-distance.js";
import "./movement/iso-elevation-anim.js";
import "./movement/elevation.js";
import "./movement/cost-rules.js";
import "./movement/vision-throttle.js";
import "./movement/movement-actions.js";
import "./movement/movement-wheel.js";
import "./interactive/overlap-picker.js";
import "./movement/history.js";
import "./movement/keybindings.js";
import { moveTokenTo } from "./movement/move-api.js";
import { isForceFreeMovement, isForceDebugMovement } from "./movement/keybindings.js";
import { OverwatchAPI, getTokenDistance } from "./combat/overwatch.js";
import { refreshActionLimits, registerActionLimitsHooks } from "./combat/action-limits.js";
import { laDetailPopup } from "./interactive/detail-renderers.js";
import { ReactionManager, stringToFunction, stringToAsyncFunction, ReactionConfig } from "./activations/reaction-manager.js";
import { CompendiumToolsAPI } from "./tools/compendium-tools.js";
import { displayReactionPopup, activateReaction } from "./activations/reactions-ui.js";
import { ReactionsAPI } from "./activations/reactions-registry.js";
import { cancelRulerDrag ,
    InteractiveAPI,
    chooseToken, knockBackToken,
    startChoiceCard, deployWeaponToken,
    revertMovement, clearMovementHistory,
    drawMovementTrace,
    getActiveGMId, getTokenOwnerUserId,
    handleManualDeployLink, startWaitCard,
    resolveDeployableSourceItem,
    rechargeExtraActionsForActor
} from './interactive/index.js';
import {
    EffectsAPI,
    consumeEffectCharge,
    processDurationEffects,
    initCollapseHook,
    findEffectOnToken,
    runInOnInitTriggerContext,
} from "./bonuses/flagged-effects.js";
import {
    getMovementPathHexes, drawDebugPath, accDiffTargetToken
} from "./combat/grid-helpers.js";
import {
    genericBonusStepDamage,
    injectKnockbackCheckbox,
    injectNoBonusDmgCheckbox,
    getImmunityBonuses,
    checkEffectImmunities,
    checkDamageResistances,
    applyDamageImmunities,
    hasCritImmunity,
    hasHitImmunity,
    hasMissImmunity,
    executeGenericBonusMenu,

    flattenBonuses,
    isBonusApplicable,
    genericAccuracyStepAttack,
    genericAccuracyStepTechAttack,
    genericAccuracyStepWeaponAttack,
    genericAccuracyStepStatRoll,
    BonusesAPI
} from "./bonuses/genericBonuses.js";
import { EffectManagerAPI } from "./bonuses/effectManager.js";
import { TerrainAPI } from "./combat/terrain-utils.js";

import { MiscAPI, getItemLID, isItemAvailable, hasReactionAvailable, getWeaponProfiles_WithBonus, executeSimpleActivation, consumeAction } from "./tools/misc-tools.js";
import { checkModuleUpdate } from "./setup/version-check.js";
import { registerModuleFlows, registerFlowStatePersistence, injectExtraDataUtility,
    bindChatMessageStateInterceptor,
    ActiveFlowState,
    forceTechHUDStep
} from "./activations/flows.js";
import { DowntimeAPI } from "./tools/downtime.js";
import { RestAPI } from "./tools/rest.js";
import { ScanAPI, registerScanFlowSteps } from "./tools/scan.js";
import { LAAuras, AurasAPI } from "./tools/aura.js";
import { initDelayedAppearanceHook, delayedTokenAppearance } from "./combat/reinforcement.js";
import { CardStackTests } from "../tests/card-stack.js";
import { FlowQueueTests } from "../tests/flow-queue.js";
import { registerAltStructFlowSteps, initAltStructReady } from "./alt-struct/index.js";
import { injectDisabledSchemaField, registerDisabledFlowSteps, registerPermanentStatusFlowSteps, onRenderActorSheet, onRenderItemSheet, injectDisabledCSS, ItemDisabledAPI, registerExtraTrackableAttributes, registerMeleeCoverFix, patchStatRollCardTemplate, initCustomFlowDispatch, registerUseAmmoFlow, repairLCPData, TriggerUseAmmoFlow, wrapInitTechAttackData, wrapInitAttackData } from "./setup/lancer-modif.js";
import { registerStatusFXSettings, initStatusFX } from "./fx/statusFX.js";
import { registerRerollFlowSteps } from "./activations/reroll.js";
import { registerAccDiffTargetButton } from "./activations/accdiff-target-button.js";
registerAccDiffTargetButton();
import { initFlowQueue, runInFlowBody } from "./activations/flow-queue.js";
import { LA_INLINE_ATTACK_FX, playDefaultThrowFX, _flowResolveActivationLabel, _flowSourceToken } from "./fx/actionFX.js";
import * as actionFX from "./fx/actionFX.js";
import { initSocket, setTokenFlag, unsetTokenFlag, awaitPendingAck } from "./socket.js";
export { socketRequestWithAck, setTokenFlag, unsetTokenFlag } from "./socket.js";
import { registerSettingsMenus, LancerAutomationsConfig } from "./setup/settingsMenus.js";
import { registerSettings } from "./setup/settings-register.js";
import {
    onAttackStep, onHitMissStep, onDamageStep,
    onPreStructureStep, onStructureStep, onPreStressStep, onStressStep,
    onTechAttackStep, onTechHitMissStep, onCheckStep,
    stunnedAutoFailStep, onInitCheckStep, onInitAttackStep, onInitTechAttackStep,
    onActivationStep, onInitActivationStep,
    _buildCancelFn
} from "./activations/flow-steps.js";
import {
    noBonusDmgInjectStep,
    wrapRollDamageForNoBonusDmg,
    wrapStatRollFlatModifier,
    wrapRollReliable,
    wrapApplySelfHeat,
    wrapExtraActionRecharge
} from "./activations/flow-wraps.js";
import { installJb2aHooks } from "./fx/jb2a-fallback.js";
import { registerTourBootstrap, startConfigTour, startActivationManagerTour } from "./setup/tour.js";
import { registerTokenStatBarSettings, initTokenStatBar, ExtraBarsAPI } from "./tah/tokenStatBar.js";
import { registerTokenStatHintSettings, initTokenStatHint } from "./tah/tokenStatHint.js";
import { registerIsoSettings, getIsoProvider, isoLabelTransform } from "./setup/iso-settings.js";
import {
    LANCER_ACTOR_TYPES,
    isLancerActor,
    hasMechStats,
    hasReaction,
    isTokenInCombat,
    isTokenVisible,
} from "./utils/lancer-token.js";
import { updateStructure, preWreck, canvasReadyWreck, tileHUDButton, initWreckTokenConfig } from "./tools/wreck.js";
import './filters/customFilters.js';
import './setup/scene-dim-from-image.js';
import './setup/migrations.js';
import { checkCompatibility } from "./setup/checkCompatibility.js";
import { injectInfectionSchemaField, injectInfectionDamageType, injectInfectionCSS, registerInfectionFlows, initInfectionHooks, applyInfection, onRenderActorSheetInfection } from "./bonuses/infection.js";
import { injectPerFrequencySchemaFields, registerPerFrequencyFlowSteps, initPerFrequencyHooks, onRenderActorSheetPerFrequency } from "./combat/per-frequency-tags.js";
import { initVisionFromEdge } from "./vision/visionFromEdge.js";
import { initTokenBlocksVision } from "./vision/tokenBlocksVision.js";
import { initLancerDetectionModes } from "./vision/lancerDetectionModes.js";
import { initVisionDisableOnSelect } from "./vision/vision-disable-on-select.js";
import {
    getReactionItems, checkOnMessageReactions, _buildStartRelatedFlow,
    handleTrigger, deserializeTriggerData, checkOnInitReactions,
    processEffectConsumption
} from "./activations/reactions-engine.js";
export { getReactionItems, checkOnMessageReactions, _buildStartRelatedFlow, handleTrigger, deserializeTriggerData };
import {
    statRollTargetSelectStep, throwChoiceStep, syncThrowToAccDiffStep,
    syncAccDiffToThrowStep, throwDeployStep, knockbackInjectStep, knockbackDamageStep,
    playInlineAttackFX, playThrowFXIfNeeded, pullInjectedTagsFromAttack,
    _actorSuppressId, _lwfxSuppressActors
} from "./activations/flow-steps-extra.js";
import {
    _isActiveMoveStackFor, _wipeMoveStack, _advanceMoveStack,
    clearMoveData, undoMoveData, getCumulativeMoveData, getIntentionalMoveData,
    getMovementCap, getMoveDataList, getMovementHistory,
    initMovementCap, increaseMovementCap, _rulerMove
} from "./movement/move-tracking.js";
export { _isActiveMoveStackFor, _wipeMoveStack, _advanceMoveStack, _rulerMove };
import { laStabilizePrompt, laStabilizeExtras } from "./activations/stabilize-flow.js";
import "./setup/status-effects.js";
import "./combat/actor-change-hooks.js";
import "./movement/token-move-hooks.js";

initLancerDetectionModes();

let deployableConnectionsGraphic = null;
let _hoverConnectionToken = null;
let _hoverConnectionTicker = null;
let _dashOffset = 0;

function _drawDashedLine(g, x1, y1, x2, y2, dashLength = 8, spaceLength = 14, offset = 0) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);
    if (dist <= 0)
        return;
    const ux = dx / dist;
    const uy = dy / dist;
    const period = dashLength + spaceLength;
    const norm = ((offset % period) + period) % period;
    let traveled = -norm;
    while (traveled < dist) {
        const a = Math.max(0, traveled);
        const b = Math.min(dist, traveled + dashLength);
        if (b > a) {
            g.moveTo(x1 + ux * a, y1 + uy * a);
            g.lineTo(x1 + ux * b, y1 + uy * b);
        }
        traveled += period;
    }
}



// drop Lancer's Math.max(1, size) so 0.5-size tokens stick instead of reverting
function patchHalfSizeTokens() {
    const docClass = /** @type {any} */ (CONFIG.Token.documentClass);
    if (!docClass)
        return;

    docClass.prototype._preCreate = async function (...[data, options, user]) {
        const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];
        const self = /** @type {any} */ (this);
        const isLancerActor = LANCER_ACTOR_TYPES.includes(self.actor?.type);
        if (isLancerActor
            && game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !self.getFlag(game.system.id, 'manual_token_size')) {
            const rawSize = self.actor?.system?.size;
            const newSize = typeof rawSize === 'number' && rawSize > 0 ? rawSize : 1;
            /** @type {Record<string, number>} */
            const updates = { width: newSize, height: newSize };
            // hex bbox isn't square; pointy and flat orientations need different offsets
            if (newSize < 1 && canvas?.grid) {
                const gs = canvas.grid.size;
                const gt = canvas.grid.type;
                const HEX = 2 / Math.sqrt(3);
                const isPointy = (gt === 2 || gt === 3);
                const isFlat = (gt === 4 || gt === 5);
                const bbW = isFlat ? gs * HEX : gs;
                const bbH = isPointy ? gs * HEX : gs;
                const cc = canvas.grid.getCenterPoint
                    ? canvas.grid.getCenterPoint({ x: self.x + bbW / 2, y: self.y + bbH / 2 })
                    : { x: self.x + gs / 2, y: self.y + gs / 2 };
                updates.x = cc.x - (newSize * bbW) / 2;
                updates.y = cc.y - (newSize * bbH) / 2;
            }
            self.updateSource(updates);
        }
        // skip Lancer's _preCreate (it has Math.max(1))
        const grandparent = /** @type {any} */ (TokenDocument.prototype);
        return grandparent._preCreate.call(this, data, options, user);
    };

    docClass.prototype._onRelatedUpdate = function (update, options) {
        // skip Lancer's _onRelatedUpdate (it has Math.max(1))
        const grandparent = /** @type {any} */ (TokenDocument.prototype);
        grandparent._onRelatedUpdate.call(this, update, options);
        const LANCER_ACTOR_TYPES = ['mech', 'pilot', 'npc', 'deployable'];
        const self = /** @type {any} */ (this);
        if (LANCER_ACTOR_TYPES.includes(self.actor?.type)
            && game.settings.get(game.system.id, 'automationOptions')?.token_size
            && !self.getFlag(game.system.id, 'manual_token_size')) {
            const rawSize = self.actor?.system?.size;
            const newSize = typeof rawSize === 'number' && rawSize > 0 ? rawSize : undefined;
            if (self.isOwner && self.id && newSize !== undefined
                && (self.width !== newSize || self.height !== newSize)) {
                self.update({ width: newSize, height: newSize });
            }
        }
    };

    console.log('lancer-automations | Patched token sizing to allow 0.5-size tokens');
}


function insertModuleFlowSteps(flowSteps, flows) {
    flowSteps.set('lancer-automations:onAttack', onAttackStep);
    flowSteps.set('lancer-automations:onHitMiss', onHitMissStep);
    flowSteps.set('lancer-automations:onDamage', onDamageStep);
    flowSteps.set('lancer-automations:onPreStructure', onPreStructureStep);
    flowSteps.set('lancer-automations:onStructure', onStructureStep);
    flowSteps.set('lancer-automations:onPreStress', onPreStressStep);
    flowSteps.set('lancer-automations:onStress', onStressStep);
    flowSteps.set('lancer-automations:onTechAttack', onTechAttackStep);
    flowSteps.set('lancer-automations:onTechHitMiss', onTechHitMissStep);
    flowSteps.set('lancer-automations:onCheck', onCheckStep);
    flowSteps.set('lancer-automations:onActivation', onActivationStep);
    flowSteps.set('lancer-automations:onInitActivation', onInitActivationStep);
    flowSteps.set('lancer-automations:onInitCheck', onInitCheckStep);
    flowSteps.set('lancer-automations:stunnedAutoFail', stunnedAutoFailStep);
    flowSteps.set('lancer-automations:onInitAttack', onInitAttackStep);
    flowSteps.set('lancer-automations:onInitTechAttack', onInitTechAttackStep);
    flowSteps.set('lancer-automations:knockbackInject', knockbackInjectStep);
    flowSteps.set('lancer-automations:knockbackDamage', knockbackDamageStep);
    flowSteps.set('lancer-automations:noBonusDmgInject', noBonusDmgInjectStep);
    flowSteps.set('lancer-automations:pullInjectedTagsFromAttack', pullInjectedTagsFromAttack);
    flowSteps.set('lancer-automations:stubBasicAttackItemForFx', playInlineAttackFX);
    flowSteps.set('lancer-automations:playThrowFXIfNeeded', playThrowFXIfNeeded);
    flowSteps.set('lancer-automations:throwChoice', throwChoiceStep);
    flowSteps.set('lancer-automations:throwDeploy', throwDeployStep);
    flowSteps.set('lancer-automations:syncThrowToAccDiff', syncThrowToAccDiffStep);
    flowSteps.set('lancer-automations:syncAccDiffToThrow', syncAccDiffToThrowStep);

    flowSteps.set('lancer-automations:genericAccuracyStepAttack', genericAccuracyStepAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepTechAttack', genericAccuracyStepTechAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepWeaponAttack', genericAccuracyStepWeaponAttack);
    flowSteps.set('lancer-automations:genericAccuracyStepStatRoll', genericAccuracyStepStatRoll);
    flowSteps.set('lancer-automations:genericBonusStepDamage', genericBonusStepDamage);

    flowSteps.set('lancer-automations:statRollTargetSelect', statRollTargetSelectStep);

    flowSteps.set('lancer-automations:forceTechHUD', forceTechHUDStep);

    flows.get('BasicAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepTechAttack');
    flows.get('TechAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:forceTechHUD');
    flows.get('WeaponAttackFlow')?.insertStepBefore('showAttackHUD', 'lancer-automations:genericAccuracyStepWeaponAttack');

    flows.get('BasicAttackFlow')?.insertStepAfter('initAttackData', 'lancer-automations:onInitAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('initAttackData', 'lancer-automations:onInitAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('initTechAttackData', 'lancer-automations:onInitTechAttack');

    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:statRollTargetSelect');
    flows.get('StatRollFlow')?.insertStepBefore('showStatRollHUD', 'lancer-automations:genericAccuracyStepStatRoll');

    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:genericBonusStepDamage');

    flows.get('WeaponAttackFlow')?.insertStepBefore('initAttackData', 'lancer-automations:throwChoice');
    // mirror LA's throw choice into v3's native thrown flag (so the HUD opens with it ticked)
    flows.get('WeaponAttackFlow')?.insertStepAfter('lancer-automations:onInitAttack', 'lancer-automations:syncThrowToAccDiff');
    // mirror back: if the user ticks Thrown in the HUD, drive LA's throwDeploy step
    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:syncAccDiffToThrow');
    flows.get('WeaponAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('WeaponAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('WeaponAttackFlow')?.insertStepAfter('lancer-automations:onHitMiss', 'lancer-automations:throwDeploy');

    flows.get('BasicAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onAttack');
    flows.get('BasicAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onHitMiss');
    flows.get('BasicAttackFlow')?.insertStepAfter('printAttackCard', 'lancer-automations:stubBasicAttackItemForFx');
    flows.get('BasicAttackFlow')?.insertStepAfter('lancer-automations:stubBasicAttackItemForFx', 'lancer-automations:playThrowFXIfNeeded');
    flows.get('WeaponAttackFlow')?.insertStepAfter('printAttackCard', 'lancer-automations:playThrowFXIfNeeded');

    flows.get('TechAttackFlow')?.insertStepAfter('showAttackHUD', 'lancer-automations:onTechAttack');
    flows.get('TechAttackFlow')?.insertStepAfter('rollAttacks', 'lancer-automations:onTechHitMiss');

    // anchor onDamage/knockbackDamage after whichever of crit/normal actually ran
    const damageFlow = flows.get('DamageRollFlow');
    if (damageFlow?.steps) {
        const critIdx = damageFlow.steps.indexOf('rollCritDamage');
        const normIdx = damageFlow.steps.indexOf('rollNormalDamage');
        const anchorIdx = Math.max(critIdx, normIdx);
        if (anchorIdx >= 0) {
            damageFlow.steps.splice(anchorIdx + 1, 0, 'lancer-automations:onDamage', 'lancer-automations:knockbackDamage');
        }
    }
    flows.get('DamageRollFlow')?.insertStepBefore('setDamageTags', 'lancer-automations:pullInjectedTagsFromAttack');
    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:knockbackInject');
    flows.get('DamageRollFlow')?.insertStepBefore('showDamageHUD', 'lancer-automations:noBonusDmgInject');

    wrapStatRollFlatModifier(flowSteps);
    // knockback-only flows have no damage dice; keep rollReliable from aborting them
    wrapRollReliable(flowSteps);
    wrapRollDamageForNoBonusDmg(flowSteps);
    wrapApplySelfHeat(flowSteps);
    // Fragment Signal's tech title gets clobbered without this
    wrapInitTechAttackData(flowSteps);
    // preserve caller-supplied title/action/effect on Ram and friends
    wrapInitAttackData(flowSteps);
    wrapExtraActionRecharge(flowSteps, flows);

    flows.get('StructureFlow')?.insertStepBefore('preStructureRollChecks', 'lancer-automations:onPreStructure');
    flows.get('StructureFlow')?.insertStepAfter('rollStructureTable', 'lancer-automations:onStructure');
    flows.get('OverheatFlow')?.insertStepBefore('preOverheatRollChecks', 'lancer-automations:onPreStress');
    flows.get('OverheatFlow')?.insertStepAfter('rollOverheatTable', 'lancer-automations:onStress');

    flows.get('StatRollFlow')?.insertStepBefore('lancer-automations:genericAccuracyStepStatRoll', 'lancer-automations:onInitCheck');
    flows.get('StatRollFlow')?.insertStepBefore('rollCheck', 'lancer-automations:stunnedAutoFail');
    flows.get('StatRollFlow')?.insertStepAfter('rollCheck', 'lancer-automations:onCheck');

    flows.get('ActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SimpleActivationFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('SystemFlow')?.insertStepAfter('printSystemCard', 'lancer-automations:onActivation');
    flows.get('TalentFlow')?.insertStepAfter('printTalentCard', 'lancer-automations:onActivation');
    flows.get('CoreActiveFlow')?.insertStepAfter('printActionUseCard', 'lancer-automations:onActivation');
    flows.get('OverchargeFlow')?.insertStepAfter('printOverchargeCard', 'lancer-automations:onActivation');
    flows.get('StabilizeFlow')?.insertStepAfter('printStabilizeResult', 'lancer-automations:onActivation');

    // sit before applySelfHeat where it exists; Talent/SimpleActivation have no consumption step
    flows.get('ActivationFlow')?.insertStepAfter('initActivationData', 'lancer-automations:onInitActivation');
    flows.get('CoreActiveFlow')?.insertStepAfter('initActivationData', 'lancer-automations:onInitActivation');
    flows.get('SystemFlow')?.insertStepAfter('initSystemUseData', 'lancer-automations:onInitActivation');
    flows.get('TalentFlow')?.insertStepAfter('printTalentCard', 'lancer-automations:onInitActivation');
    flows.get('SimpleActivationFlow')?.insertStepBefore('printActionUseCard', 'lancer-automations:onInitActivation');
    // Overcharge/Stabilize have no init step; put it at the start so they stay cancellable
    flows.get('OverchargeFlow')?.insertStepBefore('initOverchargeData', 'lancer-automations:onInitActivation');
    flows.get('StabilizeFlow')?.insertStepBefore('initializeStabilize', 'lancer-automations:onInitActivation');

}

function openResetMovementDialog(token) {
    if (!token)
        return;
    new Dialog({
        title: `Movement History: ${token.name}`,
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">Movement History</h2>
                <p class="lancer-dialog-subtitle">${token.name}</p>
            </div>
            <div class="form-group">
                <p>What would you like to do with the movement history?</p>
            </div>
        `,
        buttons: {
            revertOne: {
                icon: '<i class="fas fa-step-backward"></i>',
                label: "Revert Last Move",
                callback: () => revertMovement(token)
            },
            clear: {
                icon: '<i class="fas fa-trash"></i>',
                label: "Reset History",
                callback: () => clearMovementHistory(token, false)
            },
            revert: {
                icon: '<i class="fas fa-undo-alt"></i>',
                label: "Reset & Revert All",
                callback: () => clearMovementHistory(token, true)
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "clear"
    }, {
        classes: ["lancer-dialog-base", "lancer-no-title"],
        width: 400,
        height: 300
    }).render(true);
}

Hooks.on('init', () => {
    console.log('lancer-automations | Init');
    registerSettings();
    registerStatusFXSettings(); // StatusFX settings + config menu
    registerSettingsMenus(); // Grouped Activations / Combat / Deployables menus
    registerTourBootstrap();
    registerTokenStatBarSettings(); // Custom token stat bar (standalone setting)
    registerTokenStatHintSettings(); // Hover stat-hint popup
    registerIsoSettings(); // Isometric-perspective compat toggles
    registerFlowStatePersistence();

    initVisionFromEdge(); // Lancer-style vision: spawn perimeter vision sources for flagged tokens
    initTokenBlocksVision(); // Per-token "Blocks Line of Sight" flag + Bulwark status auto-blocking
    registerActionLimitsHooks();
    initVisionDisableOnSelect();
    injectDisabledSchemaField(); // Add system.disabled field to item schemas
    injectDisabledCSS(); // Item Disabled system
    injectInfectionSchemaField(); // Add system.infection field to actor schemas
    if (game.settings.get('lancer-automations', 'enableInfectionDamageIntegration')) {
        injectInfectionDamageType(); // Add "Infection" to DamageField choices
        injectInfectionCSS(); // Infection damage icon + color
    }
    injectPerFrequencySchemaFields();
    patchStatRollCardTemplate();

    game.keybindings.register('lancer-automations', 'resetMovement', {
        name: 'Reset Movement',
        hint: 'Open the movement history reset dialog for the selected token.',
        editable: [{ key: 'KeyH' }],
        onDown: () => {
            const token = canvas.tokens?.controlled[0];
            if (!token) {
                ui.notifications.warn('Please select a token first.');
                return;
            }
            openResetMovementDialog(token);
        },
        precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL
    });
});


Hooks.on("lancer.registerFlows", (flowSteps, flows) => {
    flowSteps.set('renderStabilizePrompt', laStabilizePrompt);
    flowSteps.set('lancer-automations:stabilizeExtras', laStabilizeExtras);
    try {
        flows.get('StabilizeFlow')?.insertStepAfter('applyStabilizeUpdates', 'lancer-automations:stabilizeExtras');
    } catch (e) {
        console.warn('lancer-automations | could not insert stabilizeExtras step:', e);
    }
    registerModuleFlows(flowSteps, flows);
    insertModuleFlowSteps(flowSteps, flows);
    registerAltStructFlowSteps(flowSteps, flows);
    registerDisabledFlowSteps(flowSteps, flows); // Item Disabled system
    registerPermanentStatusFlowSteps(flowSteps, flows); // Permanent statuses survive Full Repair
    registerMeleeCoverFix(flowSteps, flows);
    registerUseAmmoFlow(flowSteps, flows); // Ammo flow
    registerInfectionFlows(flowSteps, flows); // Infection flow + stabilize/repair clearing
    registerRerollFlowSteps(flowSteps, flows); // onRoll trigger + reroll/changeRoll
    registerScanFlowSteps(flowSteps, flows); // Override v3's printScanCard + post-process journal
    registerPerFrequencyFlowSteps(flowSteps, flows);
});


// lancer-alternative-sheets reads prototypeToken on null compendium actors; resolve them here
function patchFromUuidSyncForCompendiumActors() {
    if (typeof globalThis.fromUuidSync !== 'function')
        return;
    const orig = /** @type {any} */ (globalThis.fromUuidSync);
    if (orig._laCompendiumPatched)
        return;
    const patched = function (uuid, ...rest) {
        const r = orig.call(this, uuid, ...rest);
        if (r || typeof uuid !== 'string' || !/^Actor\.[A-Za-z0-9]+$/.test(uuid))
            return r;
        const id = uuid.split('.').pop();
        for (const pack of game.packs?.filter(p => p.documentName === 'Actor') ?? []) {
            const doc = pack.get?.(id);
            if (doc) return doc;
        }
        return r;
    };
    patched._laCompendiumPatched = true;
    globalThis.fromUuidSync = patched;
}

Hooks.once('ready', async () => {
    installJb2aHooks();
    initAltStructReady();
    patchFromUuidSyncForCompendiumActors();

    // Lancer's renderCombatDock listener does html.find(); v13 hands a raw HTMLElement, so wrap it
    if (typeof libWrapper !== 'undefined') {
        try {
            libWrapper.register('lancer-automations', 'Hooks.callAll', function (wrapped, hook, ...args) {
                if (hook === 'renderCombatDock' && args[1] instanceof HTMLElement) {
                    args[1] = $(args[1]);
                }
                return wrapped(hook, ...args);
            }, 'WRAPPER');
        } catch (e) {
            console.warn('lancer-automations | Could not wrap Hooks.callAll for renderCombatDock fix:', e);
        }

        // floor the TokenHUD at one grid cell so sub-1x1 tokens don't cram the buttons
        try {
            const hudNs = /** @type {any} */ (foundry.applications).hud;
            libWrapper.register('lancer-automations', 'foundry.applications.hud.BasePlaceableHUD.prototype._updatePosition', function (wrapped, position) {
                const result = wrapped(position);
                if (!(this instanceof hudNs.TokenHUD)) return result;
                try { if (!game.settings.get('lancer-automations', 'tokenStatBar')) return result; } catch { return result; }
                const dims = /** @type {any} */ (canvas.dimensions);
                const s = dims?.uiScale ?? 1;
                const gridSize = dims?.size ?? 100;
                const minSize = gridSize / s;
                if (result.width < minSize) {
                    result.left -= ((minSize - result.width) / 2) * s;
                    result.width = minSize;
                }
                if (result.height < minSize) {
                    result.top -= ((minSize - result.height) / 2) * s;
                    result.height = minSize;
                }
                return result;
            }, 'WRAPPER');
        } catch (e) {
            console.warn('lancer-automations | Could not wrap TokenHUD _updatePosition:', e);
        }
    }

    // gated on a setting; deferred to 'ready' because registerFlows can fire before LA's init
    if (game.settings.get('lancer-automations', 'treatGenericPrintAsActivation')) {
        const flows = game.lancer?.flows;
        flows?.get('SimpleHTMLFlow')?.insertStepAfter('printGenericHTML', 'lancer-automations:onActivation');
        flows?.get('SendUnknownToChat')?.insertStepAfter('printFeatureCard', 'lancer-automations:onActivation');
    }

    if (game.user.isGM) {
        for (const tokenDoc of game.scenes.active?.tokens ?? []) {
            const actor = tokenDoc.actor;
            if (!actor)
                continue;
        }
    }

    initCollapseHook();

    if (typeof libWrapper !== 'undefined') {
        // intercept currentProfile/rangesFor to apply persistent range bonuses from actor flags
        const _ATTACK_TAGS = new Set(['all', 'attack']);

        function _getRangeBonuses(item) {
            const actor = item.parent;
            if (!actor)
                return null;
            const state = { actor, item, data: {} };
            const bonuses = [
                ...flattenBonuses(actor.getFlag('lancer-automations', 'global_bonuses')),
                ...(actor.getFlag('lancer-automations', 'constant_bonuses') ?? [])
            ].filter(b => b?.type === 'range' && isBonusApplicable(b, _ATTACK_TAGS, state));
            return bonuses.length ? bonuses : null;
        }

        function _applyRangeBonusesToArray(baseRange, bonuses) {
            const range = baseRange.map(r => Object.assign(Object.create(Object.getPrototypeOf(r)), r));
            for (const bonus of bonuses) {
                const rangeType = bonus.rangeType;
                const rangeMode = bonus.rangeMode || 'add';
                const isOverride = rangeMode === 'override';
                const isChange = rangeMode === 'change';
                const val = Number.parseInt(bonus.val) || 0;
                if (isChange) {
                    const RangeClass = range[0]?.constructor;
                    range.length = 0;
                    if (RangeClass && RangeClass !== Object) {
                        range.push(new RangeClass({ type: rangeType, val }));
                    } else {
                        range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
                    }
                } else {
                    const existingIdx = range.findIndex(r => r.type === rangeType);
                    if (existingIdx !== -1) {
                        const entry = range[existingIdx];
                        entry.val = isOverride ? val : (Number.parseInt(entry.val) || 0) + val;
                    } else {
                        const RangeClass = range[0]?.constructor;
                        if (RangeClass && RangeClass !== Object) {
                            range.push(new RangeClass({ type: rangeType, val }));
                        } else {
                            range.push({ type: rangeType, val, icon: `cci-${rangeType.toLowerCase()}`, formatted: `${rangeType} ${val}` });
                        }
                    }
                }
            }
            return range;
        }

        libWrapper.register('lancer-automations', 'CONFIG.Item.documentClass.prototype.currentProfile',
            function(wrapped) {
                const result = wrapped.call(this);
                const bonuses = _getRangeBonuses(this);
                if (!bonuses)
                    return result;
                result.range = _applyRangeBonusesToArray(result.range, bonuses);
                return result;
            }, 'WRAPPER');

        // attack HUD uses this to pick Blast/Burst/Cone/Line buttons; route through currentProfile
        libWrapper.register('lancer-automations', 'CONFIG.Item.documentClass.prototype.rangesFor',
            function(wrapped, types) {
                if (!_getRangeBonuses(this))
                    return wrapped.call(this, types);
                const filter = new Set(types);
                return this.currentProfile().range.filter(r => filter.has(r.type));
            }, 'MIXED');

        libWrapper.register('lancer-automations', 'Token.prototype._getVisionSourceData',
            function (wrapped, ...args) {
                const data = wrapped(...args);
                if (this.isPreview) {
                    const value = game.settings.get('lancer-automations', 'dragVisionMultiplier');
                    let mode = 'ratio';
                    try {
                        mode = game.settings.get('lancer-automations', 'dragVisionMode');
                    } catch (e) {
                        mode = 'ratio';
                    }
                    if (mode === 'flat' && value > 0) {
                        const px = this.getLightRadius(value);
                        data.radius = Math.min(data.radius, px);
                        data.lightRadius = Math.min(data.lightRadius, px);
                    } else if (value < 1) {
                        data.radius *= value;
                        data.lightRadius *= value;
                    }
                }
                return data;
            }, 'WRAPPER');

        // suppress lwfx's per-weapon FX if LA already played one inline (Ram/Grapple/throw)
        libWrapper.register('lancer-automations', 'Macro.prototype.execute',
            function (wrapped, ...args) {
                try {
                    const flowInfo = this.getFlag?.('lancer-weapon-fx', 'flowInfo');
                    if (flowInfo) {
                        const id = _actorSuppressId(flowInfo.sourceToken)
                            ?? _actorSuppressId(flowInfo.sourceToken?.document);
                        if (id && _lwfxSuppressActors.has(id)) {
                            _lwfxSuppressActors.delete(id);
                            return;
                        }
                    }
                } catch { /* fall through */ }
                return wrapped.call(this, ...args);
            }, 'MIXED');
    }
});

// After each scene load (including page reload), force-refresh all token effects so
// the collapse wrapper runs even if tokens were drawn before our hook was registered.
Hooks.on('canvasReady', () => {
    canvas.tokens?.placeables.forEach(t => t.renderFlags?.set({ refreshEffects: true }));

    if (deployableConnectionsGraphic && !deployableConnectionsGraphic.destroyed) {
        deployableConnectionsGraphic.destroy();
    }
    deployableConnectionsGraphic = new PIXI.Graphics();
    if (canvas.tokens) {
        canvas.tokens.addChild(deployableConnectionsGraphic);
    }
});

function _redrawHoverConnections() {
    if (!deployableConnectionsGraphic || deployableConnectionsGraphic.destroyed)
        return;
    deployableConnectionsGraphic.clear();
    const token = _hoverConnectionToken;
    if (!token)
        return;
    if (!token.actor?.isOwner)
        return;
    if (!game.settings.get('lancer-automations', 'showDeployableLines'))
        return;
    const sourceUuid = token.actor?.uuid;
    if (!sourceUuid)
        return;

    const ownerUuidFlag = token.document.getFlag('lancer-automations', 'ownerActorUuid');
    deployableConnectionsGraphic.lineStyle(2, 0xffd700, 0.6);
    if (ownerUuidFlag) {
        const ownerToken = canvas.tokens.placeables.find(t => t.actor?.uuid === ownerUuidFlag);
        if (ownerToken)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, ownerToken.center.x, ownerToken.center.y, 8, 14, _dashOffset);
    } else {
        const deployables = canvas.tokens.placeables.filter(t =>
            t.document.getFlag('lancer-automations', 'ownerActorUuid') === sourceUuid
        );
        for (const dep of deployables)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, dep.center.x, dep.center.y, 8, 14, _dashOffset);
    }

    const partnerUuids = [];
    const actor = token.actor;
    const pilotUuid = actor?.system?.pilot?.value?.uuid;
    const activeMechUuid = actor?.system?.active_mech?.value?.uuid;
    if (actor?.type === 'mech' && pilotUuid)
        partnerUuids.push(pilotUuid);
    if (actor?.type === 'pilot' && activeMechUuid)
        partnerUuids.push(activeMechUuid);
    if (partnerUuids.length)
        deployableConnectionsGraphic.lineStyle(2, 0x4caf50, 0.6);
    for (const uuid of partnerUuids) {
        const partner = canvas.tokens.placeables.find(t => t.actor?.uuid === uuid);
        if (partner)
            _drawDashedLine(deployableConnectionsGraphic, token.center.x, token.center.y, partner.center.x, partner.center.y, 8, 14, _dashOffset);
    }
}

Hooks.on('hoverToken', (token, hovered) => {
    _hoverConnectionToken = hovered ? token : null;
    _redrawHoverConnections();
    if (_hoverConnectionToken && !_hoverConnectionTicker) {
        _hoverConnectionTicker = () => {
            _dashOffset = (_dashOffset - 0.25) % 1000;
            _redrawHoverConnections();
        };
        canvas.app?.ticker?.add(_hoverConnectionTicker);
    } else if (!_hoverConnectionToken && _hoverConnectionTicker) {
        canvas.app?.ticker?.remove(_hoverConnectionTicker);
        _hoverConnectionTicker = null;
    }
});

// token destroyed mid-hover would otherwise leave a stale line
Hooks.on('deleteToken', () => {
    if (deployableConnectionsGraphic && !deployableConnectionsGraphic.destroyed) {
        deployableConnectionsGraphic.clear();
    }
});

const userHelpers = new Map();

function registerUserHelper(name, fn) {
    if (typeof fn !== 'function') {
        console.warn(`lancer-automations | registerUserHelper: "${name}" is not a function.`);
        return;
    }
    userHelpers.set(name, fn);
}

function getUserHelper(name) {
    return userHelpers.get(name) ?? null;
}

const builtinStartups = [];

function registerBuiltinStartup(entry) {
    builtinStartups.push(entry);
}

async function syncBuiltinStartups() {
    ReactionManager.builtinStartups = [];
    let persistentScripts = ReactionManager.getStartupScripts();
    let persistentChanged = false;

    for (const entry of builtinStartups) {
        // legacy: builtin scripts used to be stored in the persistent list
        const persistentIdx = persistentScripts.findIndex(s => s.id === entry.id);
        if (persistentIdx !== -1) {
            persistentScripts.splice(persistentIdx, 1);
            persistentChanged = true;
        }

        const settingEnabled = entry.settingKey
            ? (game.settings.get(ReactionManager.ID, entry.settingKey) ?? true)
            : true;

        if (!settingEnabled)
            continue;

        try {
            const response = await fetch(`/modules/lancer-automations/${entry.filePath}`);
            const code = await response.text();
            ReactionManager.builtinStartups.push({
                id: entry.id,
                name: entry.name,
                description: entry.description,
                enabled: true,
                code,
                builtin: true
            });
            console.log(`lancer-automations | Registered built-in startup: ${entry.name}`);
        } catch (e) {
            console.error(`lancer-automations | Failed to load built-in startup "${entry.name}":`, e);
        }
    }

    if (persistentChanged) {
        await ReactionManager.saveStartupScripts(persistentScripts);
    }
}

function runStartupScripts(api) {
    const userScripts = ReactionManager.getStartupScripts();
    const allScripts = [...ReactionManager.builtinStartups, ...userScripts];

    for (const script of allScripts) {
        if (!script.enabled)
            continue;
        try {
            const fn = stringToAsyncFunction(script.code, ['api'], script.name);
            fn(api);
        } catch (e) {
            console.error(`lancer-automations | Startup script "${script.name}" failed:`, e);
        }
    }
}

registerBuiltinStartup({
    id: 'builtin-lasossis-items',
    settingKey: 'enableLaSossisItems',
    name: "LaSossis's Items",
    description: "LaSossis's item activations",
    filePath: 'startups/itemActivations.js'
});

registerBuiltinStartup({
    id: 'builtin-lasossis-personal',
    settingKey: 'enablePersonalStuff',
    name: "LaSossis's Personal Stuff",
    description: "Personal tweaks",
    filePath: 'startups/personalStuff.js'
});

Hooks.on('ready', async () => {
    console.log('lancer-automations | Ready');

    ReactionManager.initialize();
    LAAuras.init();

    game.modules.get('lancer-automations').api = /** @type {any} */ ({
        ...OverwatchAPI,
        ...ReactionsAPI,
        ...EffectsAPI,
        ...BonusesAPI,
        ...InteractiveAPI,
        ...MiscAPI,
        ...CompendiumToolsAPI,
        ...EffectManagerAPI,
        ...TerrainAPI,
        ...DowntimeAPI,
        ...ScanAPI,
        ...RestAPI,
        ...AurasAPI,
        ...ItemDisabledAPI,
        ...ExtraBarsAPI,
        applyInfection,
        repairLCPData,
        TriggerUseAmmoFlow,
        setTokenFlag,
        unsetTokenFlag,
        startConfigTour,
        startActivationManagerTour,
        clearMoveData,
        undoMoveData,
        getCumulativeMoveData,
        getIntentionalMoveData,
        getMovementHistory,
        getMoveDataList,
        getMovementCap,
        increaseMovementCap,
        initMovementCap,
        actionFX,
        processEffectConsumption,
        handleTrigger,
        registerUserHelper,
        getUserHelper,
        getActiveGMId,
        getTokenOwnerUserId,
        delayedTokenAppearance,
        getIsoProvider,
        isoLabelTransform,
        LANCER_ACTOR_TYPES,
        isLancerActor,
        hasMechStats,
        hasReaction,
        isTokenInCombat,
        isTokenVisible,
        tests: {
            cardStack: CardStackTests,
            flowQueue: FlowQueueTests,
        }
    });
    initSocket();
    // canvasReady drew rulers before api existed; refresh so free-move trails aren't tier-1 blue
    for (const tok of canvas.tokens?.placeables ?? []) {
        tok.renderFlags?.set?.({ refreshRuler: true });
    }
    // wait one tick so initFlowQueue ends up the outermost wrap on game.lancer.flowSteps
    setTimeout(initFlowQueue, 0);

    initDelayedAppearanceHook();
    await syncBuiltinStartups();
    runStartupScripts(game.modules.get('lancer-automations').api);
    Hooks.callAll('lancer-automations.ready', game.modules.get('lancer-automations').api);

    registerExtraTrackableAttributes();
    initCustomFlowDispatch();

    initStatusFX();
    initTokenStatBar();
    initTokenStatHint();
    if (game.settings.get('lancer-automations', 'enableInfectionDamageIntegration'))
        initInfectionHooks();
    initPerFrequencyHooks();
    initWreckTokenConfig();

    if (game.settings.get('lancer-automations', 'allowHalfSizeTokens')) {
        patchHalfSizeTokens();
    }

    checkCompatibility();
});

Hooks.on('renderActorSheet', onRenderActorSheet);
Hooks.on('renderActorSheet', (app, html, data) => {
    if (!game.settings.get('lancer-automations', 'enableInfectionDamageIntegration')) {
        return;
    }
    onRenderActorSheetInfection(app, html, data);
});

Hooks.on('renderActorSheet', (app, html) => onRenderActorSheetPerFrequency(app, html));

Hooks.on('renderItemSheet', onRenderItemSheet);

function _isLikelyWhiteIcon(src) {
    if (!src)
        return false;
    if (/\/assets\/icons\/white\//.test(src))
        return true;
    if (/\/lancer-automations\/icons\/[^/]+\.svg$/i.test(src))
        return true;
    return false;
}

Hooks.on('renderChatMessageHTML', (app, htmlOrEl, data) => {
    // v13 passes a raw HTMLElement; wrap so the jQuery handler still works
    const html = htmlOrEl instanceof HTMLElement ? $(htmlOrEl) : htmlOrEl;
    html.find('img').each((_, el) => {
        if (_isLikelyWhiteIcon(el.getAttribute('src')))
            el.classList.add('la-invert-icon');
    });
    bindChatMessageStateInterceptor(app, html);
    if (html.find('.lancer-damage-targets').length) {
        const damageTypes = html.find('.lancer-dice-formula i.cci[class*="damage--"]')
            .map((_, el) => Array.from(el.classList)
                .find(c => c.startsWith('damage--'))
                ?.replace('damage--', '')
            ).get();

        if (damageTypes.length) {
            html.find('.lancer-damage-target').each((_, targetEl) => {
                const target = $(targetEl);
                const uuid = target.data('uuid');
                if (!uuid)
                    return;

                const actor = /** @type {Actor} */ (/** @type {any} */ (fromUuidSync(uuid))?.actor || fromUuidSync(uuid));
                if (!actor)
                    return;

                let tagsContainer = target.find('.lancer-damage-tags');
                let tagsContainerCreated = false;
                if (!tagsContainer.length) {
                    tagsContainer = $('<div class="lancer-damage-tags"></div>');
                    tagsContainerCreated = true;
                }

                let tagsHtml = '';

                const immuneTypes = new Set();
                getImmunityBonuses(actor, "damage").forEach(b => {
                    b.damageTypes?.forEach(t => immuneTypes.add(t.toLowerCase()));
                });

                immuneTypes.forEach(dtype => {
                    if (dtype === 'variable' || dtype === 'all')
                        return;
                    const capitalizedType = dtype.charAt(0).toUpperCase() + dtype.slice(1);
                    const tooltip = `Immune to ${capitalizedType}`;
                    if (!tagsContainer.find(`span[data-tooltip="${tooltip}"]`).length) {
                        tagsHtml += `<span class="lancer-damage-tag" data-tooltip="${tooltip}"><i class="mdi mdi-shield i--xs"></i></span>`;
                    }
                });

                const resistTypes = new Set();
                getImmunityBonuses(actor, "resistance").forEach(b => {
                    b.damageTypes?.forEach(t => resistTypes.add(t.toLowerCase()));
                });

                resistTypes.forEach(dtype => {
                    if (dtype === 'variable' || dtype === 'all')
                        return;
                    const capitalizedType = dtype.charAt(0).toUpperCase() + dtype.slice(1);
                    const tooltip = `Resist ${capitalizedType}`;
                    if (!tagsContainer.find(`span[data-tooltip="${tooltip}"]`).length && !tagsContainer.find(`span[data-tooltip="Resistance to ${capitalizedType}"]`).length) {
                        tagsHtml += `<span class="lancer-damage-tag" data-tooltip="${tooltip}"><i class="mdi mdi-shield-half-full i--xs"></i></span>`;
                    }
                });

                if (tagsHtml) {
                    if (tagsContainerCreated) {
                        const rollsTags = target.find('.lancer-damage-rolls-tags');
                        if (rollsTags.length) {
                            tagsContainer.append(tagsHtml);
                            rollsTags.append(tagsContainer);
                        }
                    } else {
                        tagsContainer.append(tagsHtml);
                    }
                }
            });
        }
    }

    // crit-immune: a "hit" chip on a 20+ roll means a crit was downgraded; recolor it
    html.find('.lancer-hit-target').each((_, targetEl) => {
        const target = $(targetEl);
        const hitChip = target.find('.lancer-hit-chip');

        if (hitChip.length && hitChip.hasClass('hit')) {
            const rollTotalStr = target.find('.dice-total').text();
            const rollTotal = Number.parseInt(rollTotalStr, 10);

            if (!Number.isNaN(rollTotal) && rollTotal >= 20) {
                hitChip.css({
                    'background-color': '#eab308',
                    'color': '#000',
                    'border-color': '#ca8a04'
                });
                hitChip.attr('data-tooltip', 'Immune to Critical Hits');
            }
        }
    });
});

// HUD re-renders fire twice; dedupe the TMFX button
Hooks.on('renderBasePlaceableHUD', (hud, form) => {
    queueMicrotask(() => {
        const buttons = form.querySelectorAll('button[data-action="tmfx-editor"]');
        for (let i = 1; i < buttons.length; i++) buttons[i].remove();
    });
});

Hooks.on('renderTokenHUD', (hud, htmlOrEl, data) => {
    // v13 hands a raw HTMLElement; wrap so the jQuery below works
    const html = htmlOrEl instanceof HTMLElement ? $(htmlOrEl) : htmlOrEl;
    if (!game.settings.get('lancer-automations', 'showStatusEffectsHudButton')) {
        html.find('[data-palette="effects"]').remove();
    }
    if (!game.settings.get('lancer-automations', 'showCombatStateHudButton')) {
        html.find('.control-icon[data-action="combat"]').remove();
    }
    if (!game.settings.get('lancer-automations', 'showTargetStateHudButton')) {
        html.find('.control-icon[data-action="target"]').remove();
    }

    if (game.settings.get('lancer-automations', 'showBonusHudButton')) {
        const token = hud.object;
        if (token?.actor) {
            const button = $(`<div class="control-icon" data-action="bonus-menu" data-tooltip="Lancer EffectManager">
                <i class="cci cci-accuracy i--m"></i>
            </div>`);
            button.on('click', (e) => {
                e.preventDefault();
                executeGenericBonusMenu(token.actor);
            });
            html.find('.col.right').append(button);
        }
    }

    const leftColumn = html.find(".col.left");
    if (leftColumn.length === 0)
        return;
    if (html.find('.lancer-ruler-reset-button').length)
        return;

    if (!game.combat?.started) {
        return;
    }

    if (!game.settings.get('lancer-automations', 'showRevertMovementHudButton')) {
        return;
    }

    const resetButtonHtml = `
    <div class="control-icon lancer-ruler-reset-button" title="Movement History">
        <i class="fas fa-shoe-prints fa-fw"></i>
    </div>
  `;

    leftColumn.append(resetButtonHtml);
    const btn = html.find('.lancer-ruler-reset-button');
    btn.on('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const token = hud.object;
        if (!token)
            return;

        await revertMovement(token);
    });

    btn.on('contextmenu', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const token = hud.object;
        openResetMovementDialog(token);
    });
});

Hooks.on('combatTurnChange', async (combat, prior, current) => {
    if (!game.users.activeGM?.isSelf) {
        return;
    }
    if (prior.combatantId) {
        const endingCombatant = combat.combatants.get(prior.combatantId);
        const endingToken = endingCombatant?.token ? canvas.tokens.get(endingCombatant.token.id) : null;
        if (endingToken) {
            await handleTrigger('onTurnEnd', { triggeringToken: endingToken });
            processDurationEffects('end', endingToken.id);
        }
    }

    if (current.combatantId) {
        const startingCombatant = combat.combatants.get(current.combatantId);
        const startingToken = startingCombatant?.token ? canvas.tokens.get(startingCombatant.token.id) : null;
        if (startingToken) {
            clearMoveData(startingToken.document.id);
            initMovementCap(startingToken);
            await handleTrigger('onTurnStart', { triggeringToken: startingToken });
            processDurationEffects('start', startingToken.id);
            if (startingToken.actor)
                await rechargeExtraActionsForActor(startingToken.actor);
            await refreshActionLimits(startingToken, { turnStart: true });
        }
    }

});

Hooks.on('combatStart', async (combat) => {
    if (!game.users.activeGM?.isSelf) {
        return;
    }
    await handleTrigger('onRoundStart', { combat, round: combat.round ?? 1 });
});

Hooks.on('combatRound', async (combat, updateData) => {
    if (!game.users.activeGM?.isSelf) {
        return;
    }
    await handleTrigger('onRoundStart', { combat, round: updateData?.round ?? combat.round });
});

// boost offer + cap detection both read the cap, so seed it for everyone at start
Hooks.on('combatStart', (combat) => {
    if (!game.settings.get('lancer-automations', 'enableMovementCapDetection')
        && !game.settings.get('lancer-automations', 'enableBoostOffer')) {
        return;
    }
    for (const combatant of combat.combatants) {
        const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
        if (token) {
            initMovementCap(token);
        }
    }
});

Hooks.on('createCombatant', async (combatant, options, userId) => {
    if (game.user.id !== userId)
        return;
    const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
    if (!token)
        return;
    initMovementCap(token);
    await handleTrigger('onEnterCombat', { triggeringToken: token });
});

Hooks.on('deleteCombatant', async (combatant, options, userId) => {
    if (game.user.id !== userId)
        return;
    const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
    if (!token)
        return;
    await handleTrigger('onExitCombat', { triggeringToken: token });
});

Hooks.on('deleteCombat', async (combat, options, userId) => {
    if (game.user.id !== userId)
        return;
    for (const combatant of combat.combatants) {
        const token = combatant.token ? canvas.tokens.get(combatant.token.id) : null;
        if (!token)
            continue;
        await handleTrigger('onExitCombat', { triggeringToken: token });
    }
});

Hooks.on('preCreateActiveEffect', (effect, _data, options, _userId) => {
    if (options?.skipPreStatusHooks)
        return true;

    const actor = effect.parent;
    if (!actor)
        return true;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;
    if (!statusId)
        return true;

    const effectData = effect.toObject();
    const immunitySources = checkEffectImmunities(actor, statusId, effect);
    if (immunitySources.length > 0) {
        (async () => {
            await Promise.resolve();
            await startChoiceCard({
                title: "ACTIVATE IMMUNITY?",
                description: `<b>${actor.name}</b> affected by <b>${statusId}</b>.<hr>Immunity from: <i>${immunitySources.join(", ")}</i>. Activate?`,
                icon: "mdi mdi-shield",
                mode: "or",
                choices: [
                    {
                        text: "Yes (Resist Effect)",
                        icon: "fas fa-check",
                        callback: async () => {
                            ui.notifications.info(`${actor.name} resisted ${statusId}`);
                        }
                    },
                    {
                        text: "No (Allow Effect)",
                        icon: "fas fa-times",
                        callback: async () => {
                            await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { skipPreStatusHooks: true });
                        }
                    }
                ]
            });
        })().catch(() => {});
        return false;
    }

    let cancelChange = false;
    const _cancelledBy = options?._cancelledBy || [];
    const cancelChangeFn = _buildCancelFn({
        setFlag: () => {
            cancelChange = true;
        },
        cancelledBy: _cancelledBy,
        getIgnoreCallback: () => async () => {
            await actor.createEmbeddedDocuments("ActiveEffect", [effectData], { _cancelledBy });
        },
        defaultReason: "This status change has been blocked.",
        defaultTitle: "STATUS BLOCKED",
        choice1Text: "Confirm",
        choice2Text: "Ignore (Allow Effect)",
    });

    handleTrigger('onPreStatusApplied', { triggeringToken: token, statusId, effect, cancelChange: cancelChangeFn, _cancelledBy });

    if (cancelChange) {
        cancelChangeFn.wait()?.catch(() => {});
        return false;
    }
});

Hooks.on('preDeleteActiveEffect', (effect, options, _userId) => {
    if (options?.skipPreStatusHooks)
        return true;

    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;
    if (!statusId)
        return;

    let cancelChange = false;
    const _cancelledBy = options?._cancelledBy || [];
    const cancelChangeFn = _buildCancelFn({
        setFlag: () => {
            cancelChange = true;
        },
        cancelledBy: _cancelledBy,
        getIgnoreCallback: () => async () => {
            effect.delete({ _cancelledBy: _cancelledBy });
        },
        defaultReason: "This status removal has been blocked.",
        defaultTitle: "REMOVAL BLOCKED",
        choice1Text: "Confirm",
        choice2Text: "Ignore (Delete Effect)",
    });

    handleTrigger('onPreStatusRemoved', { triggeringToken: token, statusId, effect, cancelChange: cancelChangeFn, _cancelledBy: _cancelledBy });

    if (cancelChange) {
        cancelChangeFn.wait()?.catch(() => {});
        return false;
    }
});

Hooks.on('createActiveEffect', async (effect, _options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    await handleTrigger('onStatusApplied', { triggeringToken: token, statusId, effect });
});

Hooks.on('deleteActiveEffect', async (effect, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    const actor = effect.parent;
    if (!actor)
        return;

    const token = actor.token ? canvas.tokens.get(actor.token.id) : actor.getActiveTokens()?.[0];
    const statusId = effect.statuses?.first() || effect.name;

    await handleTrigger('onStatusRemoved', { triggeringToken: token, statusId, effect });

    // grouped effects share lifetime: removing one removes the rest
    const groupId = effect.flags?.['lancer-automations']?.consumption?.groupId;
    if (groupId && !options?.skipGroupCleanup) {
        const groupEffects = actor.effects.filter(e =>
            e.id !== effect.id && e.flags?.['lancer-automations']?.consumption?.groupId === groupId
        );
        if (groupEffects.length > 0) {
            actor.deleteEmbeddedDocuments("ActiveEffect", groupEffects.map(e => e.id), { skipGroupCleanup: true });
        }
    }
});

Hooks.on('updateActiveEffect', (effect, change, options, userId) => {
    if (userId !== game.userId) {
        return;
    }
    if (options?.skipGroupSync)
        return;
    const newStack = change?.flags?.statuscounter?.value;
    if (newStack === undefined)
        return;

    const actor = effect.parent;
    if (!actor)
        return;

    const groupId = effect.flags?.['lancer-automations']?.consumption?.groupId;
    if (!groupId)
        return;

    const groupEffects = actor.effects.filter(e =>
        e.id !== effect.id && e.flags?.['lancer-automations']?.consumption?.groupId === groupId
    );
    if (groupEffects.length === 0)
        return;

    const updates = groupEffects
        .filter(e => (e.flags?.statuscounter?.value ?? 1) !== newStack)
        .map(e => ({
            _id: e.id,
            "flags.statuscounter.value": newStack,
            "flags.statuscounter.visible": newStack > 1
        }));
    if (updates.length > 0) {
        actor.updateEmbeddedDocuments("ActiveEffect", updates, { skipGroupSync: true });
    }
});


Hooks.on('preDeleteToken', async (tokenDocument, _options, userId) => {
    if (userId !== game.userId)
        return;
    const actor = tokenDocument.actor;
    if (!actor)
        return;
    const structure = actor.system?.structure?.value ?? 1;
    const stress = actor.system?.stress?.value ?? 1;
    if (structure > 0 && stress > 0)
        return;
    const token = canvas.tokens.get(tokenDocument.id)
        ?? { document: tokenDocument, id: tokenDocument.id, name: tokenDocument.name, actor };
    await handleTrigger('onDestroyed', { triggeringToken: token });
});

Hooks.on('createToken', (tokenDocument, options, userId) => {
    if (userId !== game.userId)
        return;
    const token = canvas.tokens.get(tokenDocument.id);
    if (!token)
        return;
    setTimeout(() => {
        checkOnInitReactions(token);
        handleManualDeployLink(tokenDocument);
        handleTrigger('onTokenCreated', { triggeringToken: token });
    }, 100);
});

Hooks.on('preDeleteToken', (tokenDocument, _options, userId) => {
    if (userId !== game.userId)
        return;
    const token = canvas.tokens.get(tokenDocument.id);
    if (!token)
        return;
    // fire before the token leaves canvas.tokens so self-reactors can still resolve it
    handleTrigger('onTokenRemoved', { triggeringToken: token });
});


Hooks.on('canvasReady', () => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        canvasReadyWreck();
    }
});
Hooks.on('createToken', (tokenDoc, options, userId) => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        preWreck(tokenDoc, options, userId);
    }
});

const TEMPLATE_NO_PROVOKE_NAMES = new Set([
    'Template Throw',
    'Template Hard Cover',
    'Template Wreck',
]);
Hooks.on('createToken', async (tokenDoc, _options, userId) => {
    if (userId !== game.userId)
        return;
    const baseName = tokenDoc?.baseActor?.name ?? tokenDoc?.actor?.name ?? '';
    if (!TEMPLATE_NO_PROVOKE_NAMES.has(baseName))
        return;
    const actor = tokenDoc.actor;
    const api = game.modules.get('lancer-automations')?.api;
    if (!actor || !api?.addConstantBonus)
        return;
    try {
        await api.addConstantBonus(actor, {
            id: 'la-deployable-no-provoke',
            name: 'No Provoke',
            type: 'immunity',
            subtype: 'provoke'
        });
    } catch (e) {
        console.warn('lancer-automations | could not add provoke immunity to template token:', e);
    }
});
Hooks.on('renderTileHUD', (app, html) => {
    if (game.settings.get('lancer-automations', 'enableWrecks')) {
        tileHUDButton(app, html);
    }
});

Hooks.on('renderSettings', (app, html) => {
    // v13 hands an HTMLElement; sidebar is split into <section class="settings|documentation|access">
    const root = html instanceof HTMLElement ? html : html[0];
    const settingsSection = root.querySelector('section.settings');
    if (!settingsSection) return;
    if (settingsSection.querySelector('#lancer-automations-overview')) return; // already added

    const makeBtn = (id, icon, label) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.id = id;
        b.dataset.action = id;
        b.innerHTML = `<i class="fa-solid ${icon}" inert></i> ${label}`;
        return b;
    };
    const divider = document.createElement('h4');
    divider.className = 'divider';
    divider.textContent = 'Lancer Automations';
    const overviewButton = makeBtn('lancer-automations-overview', 'fa-cog', 'Lancer Automations');
    const managerButton = makeBtn('lancer-automations-manager', 'fa-tasks', 'Activation Manager');
    settingsSection.append(divider, overviewButton, managerButton);

    overviewButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        new LancerAutomationsConfig().render(true);
    });
    managerButton.addEventListener('click', (ev) => {
        ev.preventDefault();
        new ReactionConfig().render(true);
    });
});



