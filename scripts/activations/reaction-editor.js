import { MODULE_ID, PILOT_LINKED_ITEM_TYPES as RUNS_ON_ITEM_TYPES, RUNS_ON_CHOICES } from "../tools/constants.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat, escapeHtml } from "../tools/string-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";
import { openItemBrowserDialog, attachEditorResizeObserver } from "../tools/misc-tools.js";
import { installLancerHints } from "../setup/codemirror-hints.js";
import { openApiRefPopup } from "./api-reference-popup.js";
import { openDeployablePicker, openDocumentPicker } from "../interactive/deployables.js";
import { getDefaultGeneralReactionRegistry } from "./reactions-registry.js";
import { ACTIVATION_TRIGGER_SELECTOR, BUILT_IN_TRIGGERS, TRIGGER_GROUPS, TARGET_CAPABLE_TRIGGERS, SOURCE_MATCH_TRIGGERS } from "./trigger-catalog.js";
import { ReactionManager, clearScriptCache, stringToFunction, stringToAsyncFunction } from "./reaction-manager.js";

// "Actor.<id>" keys point at a world actor rather than a compendium item.
function resolveKeyedDocument(lid)
{
    const match = /^Actor\.([A-Za-z0-9]+)$/.exec(lid ?? '');
    return match ? (game.actors.get(match[1]) ?? null) : null;
}

export class ReactionEditor extends FormApplication
{

    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: localize('LA.dialogTitle.editActivation'),
            id: "reaction-editor",
            template: `modules/lancer-automations/templates/reaction-editor.html`,
            width: 860,
            height: Math.min(1100, Math.max(640, Math.round(document.documentElement.clientHeight * 0.9))),
            resizable: true,
            closeOnSubmit: false,
            classes: ["lancer-reaction-editor", "lancer-dialog-base", "lancer-no-title"]
        });
    }

    async getData()
    {
        const config = this.object;
        const reaction = config.reaction || {};

        let foundItemName = null;
        let foundItemUuid = null;
        let foundItemKind = "Item";
        let foundItemType = null;

        const keyedDoc = (!config.isGeneral && config.lid) ? resolveKeyedDocument(config.lid) : null;
        if (keyedDoc)
        {
            foundItemName = keyedDoc.name;
            foundItemUuid = keyedDoc.uuid;
            foundItemKind = keyedDoc.documentName;
        }
        else if (!config.isGeneral && config.lid)
        {
            for (const pack of game.packs)
            {
                if (pack.documentName !== "Item")
                    continue;

                const index = await pack.getIndex({ fields: ["system.lid"] });
                const entry = index.find(idxEntry => idxEntry.system?.lid === config.lid);
                if (entry)
                {
                    foundItemName = entry.name;
                    foundItemUuid = entry.uuid;
                    break;
                }
            }
        }

        let foundActionName = null;
        let foundEffectDescription = "";
        const reactionPath = reaction.reactionPath || "";

        if (foundItemUuid)
        {
            try
            {
                const item = await fromUuid(foundItemUuid);
                if (item)
                {
                    foundItemType = item.type;
                    const rootSystem = item.system;
                    let actionData = rootSystem;

                    if (!reactionPath || reactionPath === "system" || reactionPath === "")
                        foundActionName = item.name;
                    else
                    {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(segment => segment !== "");
                        for (const part of pathParts)
                        {
                            if (actionData && (typeof actionData === 'object' || Array.isArray(actionData)))
                                actionData = actionData[part];
                            else
                            {
                                actionData = null;
                                break;
                            }
                        }
                        if (actionData?.name)
                            foundActionName = actionData.name;
                        else
                            foundActionName = item.name;
                    }

                    foundEffectDescription = actionData?.effect || actionData?.on_hit || actionData?.on_crit || rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit || "";
                }
            }
            catch (error)
            {
                console.warn("lancer-automations | Could not load item for action name:", error);
            }
        }

        this._triggerHelp = {
            onAttack: "{ triggeringToken, weapon, targets, hitTokens, attackType, actionName, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onHit: "{ triggeringToken, weapon, targets: [{target, roll, crit}], hitTokens, attackType, actionName, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onMiss: "{ triggeringToken, weapon, targets: [{target, roll}], hitTokens, attackType, actionName, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onPreDamage: "{ triggeringToken, weapon, targets, hitTokens, attackType, actionName, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onDamage: "{ triggeringToken, weapon, target, hitTokens, damages, types, isCrit, isHit, attackType, actionName, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onPreMove: "{ triggeringToken, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, isUndo, isModified, pathHexes }, cancel(), cancelTriggeredMove(reasonText, allowConfirm, userIdControl, preConfirm, postChoice), changeTriggeredMove(position, extraData, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onMove: "{ triggeringToken, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, pathHexes, isFreeMovement, movementCost, isModified, extraData }, distanceToTrigger, canTriggerReaction}",
            onTurnStart: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onTurnEnd: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onRoundStart: "{ combat, round, canTriggerReaction}",
            onRoundEnd: "{ combat, round, canTriggerReaction}",
            onPreStatusApplied: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, allowConfirm, userIdControl), canTriggerReaction}",
            onPreStatusRemoved: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, allowConfirm, userIdControl), canTriggerReaction}",
            onStatusApplied: "{ triggeringToken, statusId, effect, distanceToTrigger, canTriggerReaction}",
            onStatusRemoved: "{ triggeringToken, statusId, effect, distanceToTrigger, canTriggerReaction}",
            onPreStructure: "{ triggeringToken, remainingStructure, cancelStructure(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onStructure: "{ triggeringToken, remainingStructure, rollResult, rollDice, cancelStructureOutcome(reasonText, title, allowConfirm, userIdControl), modifyRoll(newTotal), flowState, distanceToTrigger, canTriggerReaction}",
            onPreStress: "{ triggeringToken, remainingStress, cancelStress(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onStress: "{ triggeringToken, remainingStress, rollResult, rollDice, cancelStressOutcome(reasonText, title, allowConfirm, userIdControl), modifyRoll(newTotal), flowState, distanceToTrigger, canTriggerReaction}",
            onHeatGain: "{ triggeringToken, heatChange, currentHeat, inDangerZone, distanceToTrigger, canTriggerReaction}",
            onDestroyed: "{ triggeringToken, cause, distanceToTrigger, canTriggerReaction}",
            onTokenCreated: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onTokenRemoved: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onTokenVisibility: "{ triggeringToken, isHidden, distanceToTrigger, canTriggerReaction}",
            onTechAttack: "{ triggeringToken, techItem, targets, hitTokens, actionName, isInvade, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onTechHit: "{ triggeringToken, techItem, targets: [{target, roll, crit}], hitTokens, actionName, isInvade, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onTechMiss: "{ triggeringToken, techItem, targets: [{target, roll}], hitTokens, actionName, isInvade, tags, actionData, flowState, distanceToTrigger, canTriggerReaction}",
            onCheck: "{ triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal, flowState, distanceToTrigger, canTriggerReaction}",
            onInitCheck: "{ triggeringToken, statName, checkAgainstToken, targetVal, cancelCheck(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onInitAttack: "{ triggeringToken, weapon, targets, hitTokens, actionName, tags, actionData, cancelAttack(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onInitTechAttack: "{ triggeringToken, techItem, targets, hitTokens, actionName, isInvade, tags, actionData, cancelTechAttack(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onInitActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, endActivation, cancelAction(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, reactionJustConsumed, endActivation, extraData, flowState, distanceToTrigger, canTriggerReaction}",
            onInitEndActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, endActivation, cancelAction(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onEndActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, reactionJustConsumed, endActivation, extraData, flowState, distanceToTrigger, canTriggerReaction}",
            onPostActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, reactionJustConsumed, endActivation, extraData, flowState, results, distanceToTrigger, canTriggerReaction}",
            onPostEndActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, reactionJustConsumed, endActivation, extraData, flowState, results, distanceToTrigger, canTriggerReaction}",
            onPreHpChange: "{ triggeringToken, previousHP, newHP, delta, cancelHpChange(reasonText, title, allowConfirm, userIdControl), modifyHpChange(newValue, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onHpGain: "{ triggeringToken, hpChange, currentHP, maxHP, distanceToTrigger, canTriggerReaction}",
            onHpLoss: "{ triggeringToken, hpLost, currentHP, distanceToTrigger, canTriggerReaction}",
            onPreHeatChange: "{ triggeringToken, previousHeat, newHeat, delta, cancelHeatChange(reasonText, title, allowConfirm, userIdControl), modifyHeatChange(newValue, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onHeatLoss: "{ triggeringToken, heatCleared, currentHeat, distanceToTrigger, canTriggerReaction}",
            onPreInvoluntaryMove: "{ triggeringToken, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, isUndo, isModified, pathHexes }, sourceToken, actionName, item, cancel(), cancelTriggeredMove(reasonText, allowConfirm, userIdControl, preConfirm, postChoice), changeTriggeredMove(position, extraData, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onInvoluntaryMove: "{ triggeringToken, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, pathHexes, isFreeMovement, movementCost, isModified, extraData }, sourceToken, actionName, item, distanceToTrigger, canTriggerReaction}",
            onRoll: "{ triggeringToken, rollType: 'attackRoll'|'techAttackRoll'|'damageRoll'|'skillRoll'|'structureRoll'|'stressRoll', roll, total, success, targets, item, isReroll, rerollCount, hitTokens, reroll(reasonText, subtype, title, allowConfirm, userIdControl), changeRoll(newTotal, reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onDeploy: "{ triggeringToken, item, deployedTokens, deployType, distanceToTrigger, canTriggerReaction}",
            onUpdate: "{ triggeringToken, document, change, options, distanceToTrigger, canTriggerReaction}",
            onEnterCombat: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onExitCombat: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onFullRepair: "{ triggeringToken, distanceToTrigger, canTriggerReaction}"
        };

        const triggerGroups = this._getTriggerOptions(reaction.triggers || []);
        const triggerPairs = [];
        for (let start = 0; start < triggerGroups.length; start += 2)
            triggerPairs.push(triggerGroups.slice(start, start + 2));

        const result = {
            isGeneral: config.isGeneral || false,
            name: config.name || "",
            lid: config.lid || "",
            foundItemName: foundItemName,
            foundItemKind,
            foundItemUuid: foundItemUuid,
            foundActionName: foundActionName,
            reactionPath: reaction.reactionPath || "",
            triggerDescription: reaction.triggerDescription || "",
            effectDescription: reaction.effectDescription || foundEffectDescription || "",
            comments: reaction.comments || "",
            isReaction: reaction.isReaction !== false,
            isReactionDefined: reaction.isReaction !== undefined,
            triggerSelf: reaction.triggerSelf === true,
            triggerOther: reaction.triggerOther !== false,
            triggerTarget: reaction.triggerTarget === true,
            triggerEnvironment: reaction.triggerEnvironment === true,
            outOfCombat: reaction.outOfCombat === true,
            autoActivate: reaction.autoActivate || false,
            awaitActivationCompletion: reaction.awaitActivationCompletion ?? (reaction.autoActivate ?? false),
            onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
            runsOn: RUNS_ON_CHOICES.includes(reaction.runsOn) ? reaction.runsOn : "mech",
            runsOnApplies: !config.isGeneral && RUNS_ON_ITEM_TYPES.includes(foundItemType),
            sceneReactor: reaction.sceneReactor || "off",
            sceneId: reaction.sceneId || "",
            sceneOptions: game.scenes.map(scene => ({ id: scene.id, name: scene.name })).sort((left, right) => left.name.localeCompare(right.name)),
            triggerPairs,
            bandOpen: !reaction.triggers?.length || !getModuleSetting('reactionEditorBandFolded'),
            customTriggers: (reaction.triggers || []).filter(trigger => !BUILT_IN_TRIGGERS.has(trigger)).join(", "),
            evaluate: reaction.evaluate?.toString() || "return true;",
            triggerHelp: this._triggerHelp,
            activationType: reaction.activationType || "flow",
            activationMode: reaction.activationMode || "instead",
            activationMacro: reaction.activationMacro || "",
            activationCode: typeof reaction.activationCode === 'function' ? reaction.activationCode.toString() : (reaction.activationCode || ""),
            reactionIndex: config.reactionIndex,
            workshopId: reaction.workshopId || "",
            workshopAuthor: (reaction.workshopId || "").split('/')[0] || "",
            workshopPreview: config.workshopPreview === true,
            originalName: config.name || "",
            onInit: typeof reaction.onInit === 'function' ? reaction.onInit.toString() : (reaction.onInit || ""),
            onMessage: typeof reaction.onMessage === 'function' ? reaction.onMessage.toString() : (reaction.onMessage || ""),
            actionType: reaction.actionType || "Automation",
            checkReaction: reaction.checkReaction === true,
            requireCanProvoke: reaction.requireCanProvoke === true,
            checkUsage: reaction.checkUsage ?? true,
            actionTypeOptions: {
                "Automation": "Automation",
                "Reaction": "Reaction",
                "Free Action": "Free Action",
                "Quick Action": "Quick Action",
                "Full Action": "Full Action",
                "Protocol": "Protocol",
                "Other": "Other"
            },
            frequency: reaction.frequency || "Unlimited",
            frequencyOptions: {
                "1/Round": "1/Round",
                "Unlimited": "Unlimited",
                "1/Scene": "1/Scene",
                "1/Combat": "1/Combat",
                "Other": "Other"
            },
            dispositionFilter: {
                friendly: reaction.dispositionFilter?.includes('friendly') || false,
                neutral: reaction.dispositionFilter?.includes('neutral') || false,
                hostile: reaction.dispositionFilter?.includes('hostile') || false,
                secret: reaction.dispositionFilter?.includes('secret') || false
            }
        };
        return result;
    }

    activateListeners(html)
    {
        super.activateListeners(html);

        this._bindDirtyTracking(html);
        html.find('.la-close-btn').on('click', () => this.close());

        const generalCheckbox = html.find('#isGeneral');
        const generalOnlyFields = html.find('.general-only');
        const itemOnlyFields = html.find('.item-only');

        const toggleFields = () =>
        {
            const isGeneral = generalCheckbox.prop('checked');
            generalOnlyFields.toggle(isGeneral);
            itemOnlyFields.toggle(!isGeneral);
        };

        generalCheckbox.on('change', toggleFields);
        toggleFields();

        // Clipboard copy: read live form + editor values
        html.find('.clipboard-copy').on('click', async () =>
        {
            try
            {
                const existingReaction = this.object?.reaction ?? {};
                const triggers = [];
                html.find('input[name^="trigger."]').each(function ()
                {
                    if ($(this).prop('checked'))
                        triggers.push($(this).attr('name').replace('trigger.', ''));
                });
                const dispositionFilter = [];
                ['friendly', 'neutral', 'hostile', 'secret'].forEach(disposition =>
                {
                    if (html.find(`input[name="dispositionFilter.${disposition}"]`).prop('checked'))
                        dispositionFilter.push(disposition);
                });
                const reaction = {
                    triggers,
                    evaluate: this.evaluateEditor ? this.evaluateEditor.getValue() : (html.find('textarea[name="evaluate"]').val() || ""),
                    triggerDescription: String(html.find('textarea[name="triggerDescription"]').val() || ""),
                    effectDescription: String(html.find('textarea[name="effectDescription"]').val() || ""),
                    actionType: String(html.find('select[name="actionType"]').val() || existingReaction.actionType || "Automation"),
                    frequency: String(html.find('select[name="frequency"]').val() || existingReaction.frequency || "Unlimited"),
                    checkReaction: html.find('input[name="checkReaction"]').prop('checked'),
                    requireCanProvoke: html.find('input[name="requireCanProvoke"]').prop('checked'),
                    checkUsage: html.find('input[name="checkUsage"]').prop('checked'),
                    autoActivate: html.find('input[name="autoActivate"]').prop('checked'),
                    awaitActivationCompletion: html.find('input[name="awaitActivationCompletion"]').prop('checked'),
                    triggerSelf: html.find('input[name="triggerSelf"]').prop('checked'),
                    triggerOther: html.find('input[name="triggerOther"]').prop('checked'),
                    triggerTarget: html.find('input[name="triggerTarget"]').prop('checked'),
                    triggerEnvironment: html.find('input[name="triggerEnvironment"]').prop('checked'),
                    outOfCombat: html.find('input[name="outOfCombat"]').prop('checked'),
                    onlyOnSourceMatch: html.find('input[name="onlyOnSourceMatch"]').filter(':checked').length > 0,
                    sceneReactor: String(html.find('select[name="sceneReactor"]').val() || existingReaction.sceneReactor || "off"),
                    sceneId: String(html.find('select[name="sceneId"]').val() || ""),
                    activationType: String(html.find('select[name="activationType"]').val() || existingReaction.activationType || "flow"),
                    activationMode: String(html.find('select[name="activationMode"]').val() || existingReaction.activationMode || "instead"),
                    activationMacro: String(html.find('input[name="activationMacro"]').val() || ""),
                    activationCode: this.codeEditor ? this.codeEditor.getValue() : (html.find('textarea[name="activationCode"]').val() || ""),
                    onInit: this.onInitEditor ? this.onInitEditor.getValue() : (html.find('textarea[name="onInit"]').val() || ""),
                    onMessage: this.onMessageEditor ? this.onMessageEditor.getValue() : (html.find('textarea[name="onMessage"]').val() || ""),
                    reactionPath: String(html.find('input[name="reactionPath"]').val() || ""),
                    comments: String(html.find('input[name="commentsItem"], input[name="commentsGeneral"]').filter(':visible').val() || ""),
                    dispositionFilter: dispositionFilter.length ? dispositionFilter : null,
                };
                const runsOn = String(html.find('input[name="runsOn"]:checked').val() || 'mech');
                if (runsOn !== 'mech')
                    reaction.runsOn = runsOn;
                const isGeneral = html.find('#isGeneral').prop('checked');
                const name = isGeneral ? String(html.find('input[name="name"]').val() || "") : "";
                const lid = isGeneral ? name : String(html.find('input[name="lid"]').val() || "");
                const payload = { isGeneral, lid, name, reaction };
                await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                ui.notifications.info(localize('LA.notify.activationCopiedToClipboard'));
            }
            catch (error)
            {
                ui.notifications.error(localize('LA.notify.failedToCopyToClipboard'));
            }
        });

        // compile now under the engine's source names so devtools lists them before the first trigger
        html.find('.debug-preload').on('click', () =>
        {
            const isGeneral = html.find('input[name="isGeneral"]').prop('checked');
            const generalName = String(html.find('input[name="name"]').val() || 'activation');
            const lid = String(html.find('input[name="lid"]').val() || '');
            const reactionIndex = Number(html.find('input[name="reactionIndex"]').val() || 0);
            const base = isGeneral ? generalName : `${lid || 'item'}/${reactionIndex}`;
            const triggerArgs = ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"];
            const sources = [
                { code: this.evaluateEditor?.getValue(), role: 'evaluate', sync: true, args: triggerArgs },
                { code: this.codeEditor?.getValue(), role: 'activation', sync: false, args: triggerArgs },
                { code: this.onInitEditor?.getValue(), role: 'onInit', sync: true, args: ["token", "item", "api"] },
                { code: this.onMessageEditor?.getValue(), role: 'onMessage', sync: false, args: ["triggerType", "data", "reactorToken", "item", "activationName", "api"] }
            ];
            let compiled = 0;
            for (const entry of sources)
            {
                if (!entry.code?.trim())
                    continue;
                try
                {
                    if (entry.sync)
                        stringToFunction(entry.code, entry.args, null, `${base}/${entry.role}`);
                    else
                        stringToAsyncFunction(entry.code, entry.args, `${base}/${entry.role}`);
                    compiled++;
                }
                catch (error)
                {
                    ui.notifications.error(localizeFormat('LA.notify.labeledError', { label: entry.role, error: error.message }));
                }
            }
            if (compiled)
                ui.notifications.info(localizeFormat('LA.notify.compiledFunctions', { count: compiled, base }));
        });

        html.find('.clipboard-paste').on('click', async () =>
        {
            try
            {
                const text = await navigator.clipboard.readText();
                const payload = JSON.parse(text);
                if (!payload?.reaction)
                {
                    ui.notifications.error(localize('LA.notify.clipboardDoesNotContainAValidActivation'));
                    return;
                }
                this.object = { ...this.object, ...payload, name: payload.name ?? (payload.isGeneral ? payload.lid : (this.object.name ?? "")) };
                this.render();
            }
            catch (error)
            {
                ui.notifications.error(localize('LA.notify.failedToLoadFromClipboardInvalidJson'));
            }
        });

        let syncGroupCounts = () => { };
        const onlyOnSourceMatchCheckbox = html.find('input[name="onlyOnSourceMatch"]');
        const triggerTargetCheckbox = html.find('input[name="triggerTarget"]');
        const triggerCheckboxes = html.find('input[name^="trigger."]');

        const sourceMatchTriggers = SOURCE_MATCH_TRIGGERS;

        const toggleSourceMatchTriggers = () =>
        {
            const isSourceMatch = onlyOnSourceMatchCheckbox.filter(':checked').length > 0;
            const isTargetOn = triggerTargetCheckbox.prop('checked');
            const isGeneral = generalCheckbox.prop('checked');

            triggerCheckboxes.each(function ()
            {
                const triggerName = $(this).attr('name').replace('trigger.', '');
                let isCompatible = sourceMatchTriggers.has(triggerName);

                // onDeploy source matching only makes sense for Item reactions, not General
                if (triggerName === 'onDeploy' && isGeneral)
                    isCompatible = false;

                if ((isSourceMatch && !isCompatible) || (isTargetOn && !TARGET_CAPABLE_TRIGGERS.has(triggerName)))
                {
                    $(this).prop('disabled', true);
                    $(this).prop('checked', false);
                    $(this).closest('label').addClass('locked').css('opacity', '');
                }
                else
                {
                    $(this).closest('label').removeClass('locked').css('opacity', '');
                    $(this).prop('disabled', false);
                }
            });
            syncGroupCounts();
        };

        onlyOnSourceMatchCheckbox.on('change', toggleSourceMatchTriggers);
        triggerTargetCheckbox.on('change', toggleSourceMatchTriggers);
        toggleSourceMatchTriggers();

        const activationTypeSelect = html.find('#activationType');
        const activationModeSelect = html.find('#activationMode');
        const macroFields = html.find('.activation-macro');
        const codeFields = html.find('.activation-code');

        const recursionWarning = html.find('#activation-recursion-warning');
        const afterModeWarning = html.find('#activation-after-warning');

        const toggleRecursionWarning = () =>
        {
            const type = activationTypeSelect.val();
            const mode = activationModeSelect.val();
            const hasActivationTrigger = html.find(ACTIVATION_TRIGGER_SELECTOR).is(':checked');
            const risky = hasActivationTrigger && (type === 'flow' || ((type === 'macro' || type === 'code') && mode === 'after'));
            recursionWarning.toggle(!!risky);
            afterModeWarning.toggle((type === 'macro' || type === 'code') && mode === 'after');
        };

        const toggleActivationFields = () =>
        {
            const type = activationTypeSelect.val();
            macroFields.toggle(type === 'macro');
            codeFields.toggle(type === 'code');
            activationModeSelect.toggle(type === 'macro' || type === 'code');
            toggleRecursionWarning();
        };

        activationTypeSelect.on('change', toggleActivationFields);
        activationModeSelect.on('change', toggleRecursionWarning);
        html.on('change', ACTIVATION_TRIGGER_SELECTOR, toggleRecursionWarning);
        toggleActivationFields();

        html.find('.show-item-btn').on('click', async (ev) =>
        {
            ev.preventDefault();
            const uuid = $(ev.currentTarget).data('uuid');
            if (uuid)
            {
                const item = /** @type {Item} */ (await fromUuid(uuid));
                if (item)
                    item.sheet.render(true);
            }
        });

        const lidInput = html.find('input[name="lid"]');
        const pathInput = html.find('input[name="reactionPath"]');
        const previewContainer = html.find('.item-preview-container');
        const showItemBtn = html.find('.show-item-btn');
        const previewItemName = html.find('#preview-item-name');

        const actionTypeSelect = html.find('#actionType');
        const frequencySelect = html.find('#frequency');

        const autoActivateCheckbox = html.find('input[name="autoActivate"]');
        const forceSyncOption = html.find('.force-sync-option');
        const frequencyOption = html.find('.frequency-option');
        const syncAutoActivateLock = () =>
        {
            const checked = autoActivateCheckbox.prop('checked');
            forceSyncOption.toggle(checked);
            frequencyOption.toggle(!checked);
        };
        autoActivateCheckbox.on('change', syncAutoActivateLock);
        syncAutoActivateLock();

        const updatePreview = async (autoSelect = true) =>
        {
            const lid = lidInput.val()?.trim();
            const reactionPath = pathInput.val()?.trim() || "";

            if (!lid)
                return;

            let foundItemUuid = null;
            let foundItemName = null;
            let foundItemKind = "Item";

            const keyedDoc = resolveKeyedDocument(lid);
            if (keyedDoc)
            {
                foundItemUuid = keyedDoc.uuid;
                foundItemName = keyedDoc.name;
                foundItemKind = keyedDoc.documentName;
            }
            else
            {
                for (const pack of game.packs)
                {
                    if (pack.documentName !== "Item")
                        continue;
                    const index = await pack.getIndex({ fields: ["system.lid"] });
                    const entry = index.find(indexEntry => indexEntry.system?.lid === lid);
                    if (entry)
                    {
                        foundItemUuid = entry.uuid;
                        foundItemName = entry.name;
                        break;
                    }
                }
            }

            if (!foundItemUuid)
                return;

            let foundActionName = null;
            let detectedActionType = null;
            let detectedFrequency = null;

            try
            {
                const item = await fromUuid(foundItemUuid);
                if (item)
                {
                    html.find('.la-runs-on').toggle(!html.find('#isGeneral').prop('checked') && RUNS_ON_ITEM_TYPES.includes(item.type));
                    if (!reactionPath || reactionPath === "" || reactionPath === "system" || reactionPath === "system.trigger")
                        foundActionName = item.name;
                    else
                    {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(segment => segment !== "");
                        let actionData = item.system;
                        for (const part of pathParts)
                        {
                            if (actionData && (typeof actionData === 'object' || Array.isArray(actionData)))
                                actionData = actionData[part];
                            else
                            {
                                actionData = null;
                                break;
                            }
                        }
                        foundActionName = actionData?.name || item.name;

                        const activation = actionData?.activation;
                        if (activation)
                        {
                            if (activation === "Quick")
                                detectedActionType = "Quick Action";
                            else if (activation === "Full")
                                detectedActionType = "Full Action";
                            else if (activation === "Reaction")
                                detectedActionType = "Reaction";
                            else if (activation === "Free")
                                detectedActionType = "Free Action";
                            else if (activation === "Protocol")
                                detectedActionType = "Protocol";
                            else
                                detectedActionType = activation;
                        }

                        if (actionData?.frequency)
                            detectedFrequency = actionData.frequency;
                        else if (item.system?.frequency)
                            detectedFrequency = item.system.frequency;
                        else if (item.system?.uses?.per)
                        {
                            const per = item.system.uses.per;
                            if (per === "Round")
                                detectedFrequency = "1/Round";
                            else if (per === "Scene")
                                detectedFrequency = "1/Scene";
                            else if (per === "Combat")
                                detectedFrequency = "1/Combat";
                            else if (per === "Mission")
                                detectedFrequency = "1/Mission";
                        }
                        else if (detectedActionType === "Reaction" || detectedActionType === "Free Action")
                            detectedFrequency = "1/Round";
                    }
                }
            }
            catch (error)
            {
                console.warn("lancer-automations | Error resolving action name:", error);
            }

            previewItemName.html(`<strong>${foundItemKind}:</strong> ${foundItemName}`);

            if (foundItemUuid)
            {
                showItemBtn.data('uuid', foundItemUuid);
                showItemBtn.attr('data-uuid', foundItemUuid);
                showItemBtn.show();
            }
            else
                showItemBtn.hide();

            const $existingAction = html.find('#preview-action-name');
            if (foundActionName && foundActionName !== foundItemName)
            {
                if ($existingAction.length)
                    $existingAction.html(`<strong>Action:</strong> ${foundActionName}`).show();
                else
                    previewItemName.after(`<span id="preview-action-name" style="margin-left: 10px;"><strong>Action:</strong> ${foundActionName}</span>`);
            }
            else
                $existingAction.hide();

            if (detectedActionType)
            {
                const options = new Set(["Reaction", "Free Action", "Quick Action", "Full Action", "Protocol", "Other"]);

                const $options = actionTypeSelect.find('option');
                $options.css('color', '');
                $options.each(function ()
                {
                    if ($(this).val() === detectedActionType)
                    {
                        $(this).css({
                            'color': '#4caf50',
                            'font-weight': 'bold'
                        });
                    }
                });

                if (autoSelect && (options.has(detectedActionType) || detectedActionType === "Other"))
                    actionTypeSelect.val(options.has(detectedActionType) ? detectedActionType : "Other");
            }

            if (detectedFrequency)
            {
                const options = new Set(["1/Round", "Unlimited", "1/Scene", "1/Combat", "Other"]);
                const $options = frequencySelect.find('option');
                $options.css('color', '');
                $options.each(function ()
                {
                    if ($(this).val() === detectedFrequency)
                    {
                        $(this).css({
                            'color': '#4caf50',
                            'font-weight': 'bold'
                        });
                    }
                });

                if (autoSelect && (options.has(detectedFrequency) || detectedFrequency === "Other"))
                    frequencySelect.val(options.has(detectedFrequency) ? detectedFrequency : "Other");
            }

            showItemBtn.data('uuid', foundItemUuid);
            previewContainer.show();
        };

        const debouncedUpdate = foundry.utils.debounce(() => updatePreview(), 300);

        lidInput.on('input', debouncedUpdate);
        pathInput.on('input', debouncedUpdate);

        if (lidInput.val())
            updatePreview(false);

        if (typeof CodeMirror !== 'undefined')
        {
            const evaluateTextarea = html.find('textarea[name="evaluate"]')[0];
            if (evaluateTextarea)
            {
                this.evaluateEditor = CodeMirror.fromTextArea(evaluateTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    styleActiveLine: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.evaluateEditor.on('change', (editor) =>
                {
                    editor.save();
                    this._markDirty();
                });
                installLancerHints(this.evaluateEditor, 'evaluate');
            }

            const activationCodeTextarea = html.find('textarea[name="activationCode"]')[0];
            if (activationCodeTextarea)
            {
                this.codeEditor = CodeMirror.fromTextArea(activationCodeTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    styleActiveLine: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.codeEditor.on('change', (editor) =>
                {
                    editor.save();
                    this._markDirty();
                });
                installLancerHints(this.codeEditor, 'activationCode');
            }

            const onInitTextarea = html.find('textarea[name="onInit"]')[0];
            if (onInitTextarea)
            {
                this.onInitEditor = CodeMirror.fromTextArea(onInitTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    styleActiveLine: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.onInitEditor.on('change', (editor) =>
                {
                    editor.save();
                    this._markDirty();
                });
                installLancerHints(this.onInitEditor, 'onInit');
            }

            const onMessageTextarea = html.find('textarea[name="onMessage"]')[0];
            if (onMessageTextarea)
            {
                this.onMessageEditor = CodeMirror.fromTextArea(onMessageTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    styleActiveLine: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.onMessageEditor.on('change', (editor) =>
                {
                    editor.save();
                    this._markDirty();
                });
                installLancerHints(this.onMessageEditor, 'onMessage');
            }

            const refreshEditors = () =>
            {
                if (this.evaluateEditor)
                    this.evaluateEditor.refresh();
                if (this.codeEditor)
                    this.codeEditor.refresh();
                if (this.onInitEditor)
                    this.onInitEditor.refresh();
                if (this.onMessageEditor)
                    this.onMessageEditor.refresh();
            };

            activationTypeSelect.on('change', () =>
            {
                setTimeout(refreshEditors, 50);
            });

            html.find('details.code-section').on('toggle', function ()
            {
                if (!this.open)
                    return;
                setTimeout(refreshEditors, 0);
            });

            setTimeout(refreshEditors, 100);
        }

        html.find('.find-item-btn').on('click', async (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openItemBrowser(lidInput, pathInput, updatePreview, previewContainer);
        });

        html.find('.find-action-btn').on('click', async (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openActionBrowser(lidInput.val(), pathInput, updatePreview);
        });

        html.find('.find-deployable-btn').on('click', async (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openDeployableBrowser(lidInput, pathInput, updatePreview);
        });

        html.find('.find-document-btn').on('click', async (ev) =>
        {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openDocumentBrowser(lidInput, pathInput, updatePreview);
        });

        html.find('.expand-editor').on('click', this._onExpandEditor.bind(this));

        const bandFold = html.find('.la-band-fold');
        const isShown = (element) => !$(element).closest('[style*="display: none"], [style*="display:none"]').length;
        const checkedLabels = (selector) => html.find(selector).filter(':checked').filter((_, input) => isShown(input))
            .map((_, input) => $(input).closest('label').find('span').first().text().trim()).get();
        const selectedText = (selector) => (isShown(html.find(selector)) ? [html.find(selector).find('option:selected').text().trim()] : []);
        const updateBandDigest = () =>
        {
            const triggers = [
                ...html.find('input[name^="trigger."]:checked').map((_, input) => String($(input).attr('name')).replace('trigger.', '')).get(),
                ...String(html.find('#custom-triggers').val() ?? '').split(',').map(entry => entry.trim()).filter(Boolean),
            ];
            const parts = [
                checkedLabels('input[name="triggerSelf"], input[name="triggerOther"], input[name="triggerTarget"], input[name="triggerEnvironment"], input[name="outOfCombat"]'),
                checkedLabels('input[name^="dispositionFilter."]'),
                checkedLabels('input[name="runsOn"]'),
                checkedLabels('input[name="checkReaction"], input[name="checkUsage"], input[name="requireCanProvoke"]'),
                checkedLabels('input[name="autoActivate"], input[name="awaitActivationCompletion"]'),
                [...selectedText('select[name="actionType"]'), ...selectedText('select[name="frequency"]')],
            ].filter(labels => labels.length).map(labels => escapeHtml(labels.join(', ')));
            if (triggers.length)
                parts.unshift(`<code>${escapeHtml(triggers.join(', '))}</code>`);
            bandFold.find('.la-fold-digest').html(parts.join('<span class="la-sep">·</span>'));
        };
        bandFold.on('change input', updateBandDigest);
        generalCheckbox.on('change', updateBandDigest);
        const slideMs = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 150;
        html.find('details.code-section > summary').on('click', function (event)
        {
            if ($(event.target).closest('a, button, input, select').length)
                return;
            event.preventDefault();
            const details = $(this).parent();
            const content = details.children(':not(summary)').stop(true, true);
            const closing = !!details.prop('open');
            if (details.hasClass('la-band-fold'))
                game.settings.set(MODULE_ID, 'reactionEditorBandFolded', closing);
            if (closing)
            {
                content.slideUp(slideMs).promise().done(() =>
                {
                    details.prop('open', false);
                    content.css('display', '');
                });
                return;
            }
            details.prop('open', true);
            content.hide().slideDown(slideMs).promise().done(() => content.css('display', ''));
        });

        const groupBody = (header) => html.find(`.trigger-group-body[data-group="${$(header).data('group')}"]`);
        const setGroupCollapsed = (header, collapsed) =>
        {
            $(header).toggleClass('collapsed', collapsed);
            groupBody(header).stop(true, true).toggleClass('collapsed', collapsed);
        };

        const updateGroupCounts = () =>
        {
            html.find('.trigger-group-header').each(function ()
            {
                const checked = groupBody(this).find('input:checked').length;
                $(this).find('.trigger-group-count').text(checked > 0 ? `(${checked})` : '');
            });
            const customCount = String(html.find('#custom-triggers').val() ?? '').split(',').filter(entry => entry.trim()).length;
            const total = html.find('input[name^="trigger."]:checked').length + customCount;
            html.find('.trigger-selected-count').text(`${total} selected`);
            updateBandDigest();
        };
        syncGroupCounts = updateGroupCounts;
        html.find('.trigger-group-header').on('click', function ()
        {
            const collapsed = !$(this).hasClass('collapsed');
            const body = groupBody(this).stop(true, true);
            $(this).toggleClass('collapsed', collapsed);
            if (collapsed)
            {
                body.slideUp(slideMs, () => body.addClass('collapsed').css('display', ''));
                return;
            }
            body.removeClass('collapsed').hide().slideDown(slideMs, () => body.css('display', ''));
        });
        html.find('.trigger-group-body input').on('change', updateGroupCounts);
        html.find('#custom-triggers').on('input', updateGroupCounts);
        updateGroupCounts();

        html.find('.trigger-group-header').each(function ()
        {
            if (groupBody(this).find('input:checked').length === 0)
                setGroupCollapsed(this, true);
        });

        const triggerSearch = html.find('#trigger-search');
        triggerSearch.on('input', function ()
        {
            const query = String($(this).val() || '').trim().toLowerCase();
            html.find('.trigger-group-header').each(function ()
            {
                const body = groupBody(this);
                let visible = 0;
                body.find('.trigger-item').each(function ()
                {
                    const key = String($(this).find('input').attr('name') || '').replace('trigger.', '');
                    const match = !query || key.toLowerCase().includes(query);
                    $(this).toggle(match);
                    if (match)
                        visible++;
                });
                if (query)
                    setGroupCollapsed(this, false);
                else if (body.find('input:checked').length === 0)
                    setGroupCollapsed(this, true);
                $(this).css('display', visible > 0 ? '' : 'none');
                body.css('display', visible > 0 ? '' : 'none');
            });
        });

        html.find('#open-api-ref').on('click', (event) =>
        {
            event.preventDefault();
            if (this._apiRefPopup && document.body.contains(this._apiRefPopup.element))
            {
                this._closeApiRefPopup();
                return;
            }
            this._apiRefPopup = openApiRefPopup();
        });

        html.find('#open-trigger-ref').on('click', (event) =>
        {
            event.preventDefault();
            if (this._triggerRefPopup && document.body.contains(this._triggerRefPopup))
            {
                this._closeTriggerRefPopup();
                return;
            }

            const triggerHelp = this._triggerHelp ?? {};
            const checked = new Set();
            html.find('input[name^="trigger."]:checked').each(function ()
            {
                checked.add($(this).attr('name').replace('trigger.', ''));
            });

            const rows = Object.entries(triggerHelp)
                .sort((left, right) => left[0].localeCompare(right[0]))
                .map(([key, help]) =>
                {
                    const isActive = checked.has(key);
                    const inner = help.replace(/^\{\s*|\s*\}$/g, '');
                    // Split on commas, honoring (), {}, and [] nesting
                    const fields = [];
                    let depth = 0, current = '';
                    for (const ch of inner)
                    {
                        if (ch === '(' || ch === '{' || ch === '[')
                            depth++;
                        else if (ch === ')' || ch === '}' || ch === ']')
                            depth--;
                        if (ch === ',' && depth === 0)
                        {
                            fields.push(current.trim());
                            current = '';
                        }
                        else
                            current += ch;
                    }
                    if (current.trim())
                        fields.push(current.trim());

                    const tagBase = "display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 0.78em; margin: 1px 2px; max-width: 100%; white-space: normal; word-break: break-word;";
                    const tags = fields.map(field =>
                    {
                        const fnMatch = field.match(/^(\w+)\((.+)\)$/);
                        if (fnMatch)
                            return `<span title="${fnMatch[1]}( ${fnMatch[2]} )" style="${tagBase} background: color-mix(in srgb, var(--primary-color), transparent 75%); color: var(--la-accent); font-weight: bold; cursor: help;">${fnMatch[1]}()</span>`;
                        if (field.match(/^\w+\(\)$/))
                            return `<span style="${tagBase} background: color-mix(in srgb, var(--primary-color), transparent 75%); color: var(--la-accent); font-weight: bold;">${field}</span>`;
                        return `<span style="${tagBase} background: color-mix(in srgb, var(--la-plate), var(--la-ink) 12%); color: var(--la-ink);">${field}</span>`;
                    }).join('');
                    const expanded = isActive;
                    return `<div class="la-trigger-ref-row" data-key="${key}" style="border-bottom: 1px solid var(--la-edge); ${isActive ? 'background: color-mix(in srgb, var(--primary-color), transparent 93%);' : ''}">
                        <div class="la-trigger-ref-head" style="padding: 5px 8px; font-weight: bold; font-size: 0.85em; ${isActive ? 'color: var(--la-accent);' : 'color: var(--la-ink);'} cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px;">
                            <span class="la-caret" style="display: inline-block; width: 0.7em; transition: transform 0.1s;">${expanded ? '\u25BC' : '\u25B6'}</span>
                            <span>${key}</span>
                        </div>
                        <div class="la-trigger-ref-body" style="padding: 0 8px 6px 20px; line-height: 1.5; display: ${expanded ? 'block' : 'none'};">${tags}</div>
                    </div>`;
                }).join('');

            const popup = document.createElement('div');
            popup.innerHTML = `
                <div style="display: flex; align-items: center; padding: 6px 10px; background: var(--primary-color); color: #fff; cursor: move; border-radius: 6px 6px 0 0; font-weight: bold; font-size: 0.85em;">
                    <span style="flex:1;">Trigger Data Reference</span>
                    <span id="trigger-ref-close" style="cursor: pointer; font-size: 1.2em; line-height: 1;">&times;</span>
                </div>
                <div style="max-height: 400px; overflow-y: auto; padding: 4px;">${rows}</div>
            `;
            Object.assign(popup.style, {
                position: 'fixed',
                top: '100px',
                left: '100px',
                width: '420px',
                background: 'var(--la-plate)',
                border: '2px solid var(--primary-color)',
                borderRadius: '6px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
                zIndex: '10000',
                fontFamily: 'inherit'
            });

            const header = popup.querySelector('div');
            let dragging = false, dx = 0, dy = 0;
            header.addEventListener('mousedown', (event) =>
            {
                dragging = true;
                dx = event.clientX - popup.offsetLeft;
                dy = event.clientY - popup.offsetTop;
                event.preventDefault();
            });
            const onDocMove = (event) =>
            {
                if (!dragging)
                    return;
                popup.style.left = (event.clientX - dx) + 'px';
                popup.style.top = (event.clientY - dy) + 'px';
            };
            const onDocUp = () =>
            {
                dragging = false;
            };
            document.addEventListener('mousemove', onDocMove);
            document.addEventListener('mouseup', onDocUp);
            this._triggerRefDocHandlers = { move: onDocMove, up: onDocUp };

            popup.querySelector('#trigger-ref-close').addEventListener('click', () =>
            {
                this._closeTriggerRefPopup();
            });

            popup.querySelectorAll('.la-trigger-ref-head').forEach(head =>
            {
                head.addEventListener('click', () =>
                {
                    const body = head.nextElementSibling;
                    const caret = head.querySelector('.la-caret');
                    const open = body.style.display !== 'none';
                    body.style.display = open ? 'none' : 'block';
                    if (caret)
                        caret.textContent = open ? '\u25B6' : '\u25BC';
                });
            });

            document.body.appendChild(popup);
            this._triggerRefPopup = popup;
        });
    }

    _closeTriggerRefPopup()
    {
        if (this._triggerRefDocHandlers)
        {
            document.removeEventListener('mousemove', this._triggerRefDocHandlers.move);
            document.removeEventListener('mouseup', this._triggerRefDocHandlers.up);
            this._triggerRefDocHandlers = null;
        }
        this._triggerRefPopup?.remove();
        this._triggerRefPopup = null;
    }

    _closeApiRefPopup()
    {
        this._apiRefPopup?.destroy();
        this._apiRefPopup = null;
    }

    _bindDirtyTracking(html)
    {
        this._dirty = false;
        html.find('input, select, textarea').on('change input', () => this._markDirty());
        // CodeMirror fires change while it builds, so only arm once the render settles.
        setTimeout(() =>
        {
            this._dirty = false;
            this._refreshDirtyMark();
        }, 0);
    }

    _markDirty()
    {
        if (this._dirty)
            return;
        this._dirty = true;
        this._refreshDirtyMark();
    }

    _refreshDirtyMark()
    {
        this.element?.find?.('.la-dirty-star').text(this._dirty ? ' *' : '');
    }

    async _onSubmit(event, options = {})
    {
        this._lastSaveOk = false;
        const icon = this.element?.find?.('.la-save-icon');
        icon?.removeClass('far fa-save').addClass('fas fa-spinner fa-spin');
        try
        {
            const [result] = await Promise.all([
                super._onSubmit(event, options),
                new Promise(resolve => setTimeout(resolve, 400)),
            ]);
            if (this._lastSaveOk)
            {
                this._dirty = false;
                this._refreshDirtyMark();
            }
            return result;
        }
        finally
        {
            icon?.removeClass('fas fa-spinner fa-spin').addClass('far fa-save');
        }
    }

    _confirmUnsaved()
    {
        return new Promise((resolve) =>
        {
            let picked = 'cancel';
            new Dialog({
                title: localize('LA.dialogTitle.unsavedChanges'),
                content: localize('LA.activationManager.content.thisActivationHasUnsavedChanges'),
                buttons: {
                    save: {
                        icon: '<i class="far fa-save"></i>',
                        label: localize("LA.common.saveAndClose"),
                        callback: () =>
                        {
                            picked = 'save';
                        }
                    },
                    discard: {
                        icon: '<i class="fas fa-trash"></i>',
                        label: localize("LA.common.discard"),
                        callback: () =>
                        {
                            picked = 'discard';
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-arrow-left"></i>',
                        label: localize("LA.common.keepEditing"),
                        callback: () =>
                        {
                            picked = 'cancel';
                        }
                    }
                },
                default: 'save',
                close: () => resolve(picked)
            }, { classes: ["lancer-dialog-base", "lancer-no-title"] }).render(true);
        });
    }

    async close(options = {})
    {
        if (this._dirty && !options.force)
        {
            const picked = await this._confirmUnsaved();
            if (picked === 'cancel')
                return;
            if (picked === 'save')
            {
                await this.submit({ preventClose: true, preventRender: true });
                if (!this._lastSaveOk)
                    return;
            }
        }
        this._closeTriggerRefPopup();
        this._closeApiRefPopup();
        return super.close(options);
    }

    async _onExpandEditor(event)
    {
        event.preventDefault();
        const targetName = $(event.currentTarget).data('target');
        let editorInstance;
        let title;

        if (targetName === 'evaluate')
        {
            editorInstance = this.evaluateEditor;
            title = "Evaluate Function";
        }
        else if (targetName === 'activationCode')
        {
            editorInstance = this.codeEditor;
            title = "Activation Code";
        }
        else if (targetName === 'onInit')
        {
            editorInstance = this.onInitEditor;
            title = "onInit Code";
        }
        else if (targetName === 'onMessage')
        {
            editorInstance = this.onMessageEditor;
            title = "onMessage Code";
        }

        if (!editorInstance)
            return;

        const content = editorInstance.getValue();

        const dialogContent = `
            <div class="expanded-cm-host"></div>
            <style>
                .expanded-editor-dialog .window-content {
                    padding: 0 !important;
                    overflow: hidden !important;
                    background: #272822;
                }
                .expanded-editor-dialog .dialog-buttons {
                    height: 40px !important;
                    min-height: 40px !important;
                    max-height: 40px !important;
                    background: #333 !important;
                    border-top: 1px solid #111 !important;
                    padding: 0 !important;
                    margin: 0 !important;
                    display: flex !important;
                    overflow: hidden !important;
                }
                .expanded-editor-dialog button.dialog-button {
                    background: #444 !important;
                    color: #fff !important;
                    border: none !important;
                    border-right: 1px solid #222 !important;
                    width: 100% !important;
                    height: 100% !important;
                    margin: 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    font-size: 1em !important;
                    border-radius: 0 !important;
                    box-shadow: none !important;
                }
                .expanded-editor-dialog button.dialog-button:last-child { border-right: none !important; }
                .expanded-editor-dialog button.dialog-button:hover { background: #555 !important; }
            </style>
        `;

        let expandedEditor;
        let resizeObserver;

        new Dialog({
            title: localizeFormat('LA.effectManager.editTitle', { title }),
            content: dialogContent,
            buttons: {
                save: {
                    label: localize("LA.common.saveAndClose"),
                    icon: '<i class="fas fa-save" style="margin-right: 8px;"></i>',
                    callback: () =>
                    {
                        editorInstance.setValue(expandedEditor.getValue());
                    }
                }
            },
            default: "save",
            render: (html) =>
            {
                const host = html.find('.expanded-cm-host')[0];
                expandedEditor = CodeMirror(host, {
                    value: content,
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    styleActiveLine: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                installLancerHints(expandedEditor, targetName);

                const windowEl = html.closest('.window-app')[0];
                resizeObserver = attachEditorResizeObserver(expandedEditor, windowEl);
            },
            close: () =>
            {
                resizeObserver?.disconnect();
            }
        }, {
            width: 800,
            height: 600,
            resizable: true,
            classes: ["dialog", "expanded-editor-dialog", 'lancer-dialog-base', 'lancer-no-title']
        }).render(true);
    }

    async _openItemBrowser(lidInput, pathInput, updatePreview, previewContainer)
    {
        const selectedItem = await openItemBrowserDialog();

        if (!selectedItem)
            return;

        const item = await fromUuid(selectedItem.uuid);
        if (!item)
            return;

        const actions = this._getItemActions(item);

        const selectedPath = await this._showActionSelectionDialog(item.name, actions);
        if (selectedPath === null)
            return;

        lidInput.val(selectedItem.lid);
        pathInput.val(selectedPath);

        await updatePreview();
    }

    async _openActionBrowser(lid, pathInput, updatePreview)
    {
        if (!lid)
        {
            ui.notifications.warn(localize('LA.notify.pleaseSelectAnItemOrDeployableFirst'));
            return;
        }

        let item = null;
        for (const pack of game.packs)
        {
            if (pack.documentName !== "Item")
                continue;
            const index = await pack.getIndex({ fields: ["system.lid", "type", "system.actions", "system.ranks", "system.profiles", "system.trigger"] });
            const entry = index.find(indexEntry => indexEntry.system?.lid === lid);
            if (entry)
            {
                item = await fromUuid(entry.uuid);
                break;
            }
        }

        // Fallback: deployable actor compendiums.
        if (!item)
        {
            for (const pack of game.packs)
            {
                if (pack.documentName !== "Actor")
                    continue;
                const index = await pack.getIndex({ fields: ["system.lid", "type", "system.actions", "system.activation"] });
                const entry = index.find(indexEntry => indexEntry.type === 'deployable' && indexEntry.system?.lid === lid);
                if (entry)
                {
                    item = await fromUuid(entry.uuid);
                    break;
                }
            }
        }

        if (!item)
        {
            ui.notifications.error(localizeFormat('LA.notify.lidNotFound', { lid }));
            return;
        }

        const actions = this._getItemActions(item);

        const selectedPath = await this._showActionSelectionDialog(item.name, actions);
        if (selectedPath !== null)
        {
            pathInput.val(selectedPath);
            await updatePreview();
        }
    }

    _getItemActions(item)
    {
        const actions = [];

        if (item.type === "deployable")
        {
            // Top-level "Activate" itself (empty path matches the activate click).
            actions.push({ name: `${item.name} (Activate)`, path: "", isDefault: true });
            const list = item.system?.actions ?? [];
            list.forEach((action, idx) =>
            {
                const name = action.name || `Action ${idx + 1}`;
                actions.push({ name, path: `actions.${name}` });
            });
            return actions;
        }

        if (item.type === "bond")
        {
            (item.system?.powers ?? []).forEach((power, powerIdx) =>
            {
                const rank = power.master ? ' (Master)' : power.veteran ? ' (Veteran)' : '';
                actions.push({ name: `${power.name || `Power ${powerIdx + 1}`}${rank}`, path: `powers[${powerIdx}]` });
            });
            return actions;
        }

        if (item.type === "npc_feature")
        {
            if (item.system?.trigger)
                actions.push({ name: item.name, path: "", isDefault: true });
            if (item.system?.actions)
            {
                item.system.actions.forEach((action, idx) =>
                {
                    actions.push({ name: action.name || `Action ${idx + 1}`, path: `actions[${idx}]` });
                });
            }
        }
        else
        {
            if (item.system?.ranks)
            {
                item.system.ranks.forEach((rank, rIdx) =>
                {
                    actions.push({ name: `${rank.name || `Rank ${rIdx + 1}`} (Rank ${rIdx + 1})`, path: `ranks[${rIdx}]` });
                    if (rank.actions)
                    {
                        rank.actions.forEach((action, aIdx) =>
                        {
                            actions.push({
                                name: `${action.name || 'Action'} (Rank ${rIdx + 1})`,
                                path: `ranks[${rIdx}].actions[${aIdx}]`
                            });
                        });
                    }
                });
            }
            if (item.system?.profiles)
            {
                item.system.profiles.forEach((profile, pIdx) =>
                {
                    actions.push({
                        name: `${profile.name || `Profile ${pIdx + 1}`} (profile)`,
                        path: `profiles[${pIdx}]`
                    });
                    if (profile.actions)
                    {
                        profile.actions.forEach((action, aIdx) =>
                        {
                            actions.push({
                                name: `${action.name || 'Action'} (Profile: ${profile.name || pIdx + 1})`,
                                path: `profiles[${pIdx}].actions[${aIdx}]`
                            });
                        });
                    }
                });
            }
            if (item.system?.actions)
            {
                item.system.actions.forEach((action, idx) =>
                {
                    actions.push({ name: action.name || `Action ${idx + 1}`, path: `actions[${idx}]` });
                });
            }
            // Frame: core power + frame trait actions.
            if (item.type === "frame")
            {
                const coreSystem = item.system?.core_system;
                if (coreSystem)
                {
                    if (coreSystem.active_name)
                        actions.push({ name: `${coreSystem.active_name} (Core Power)`, path: `core_system` });
                    (coreSystem.active_actions ?? []).forEach((action, idx) =>
                    {
                        actions.push({
                            name: `${action.name || `Active Action ${idx + 1}`} (Core)`,
                            path: `core_system.active_actions[${idx}]`
                        });
                    });
                    (coreSystem.passive_actions ?? []).forEach((action, idx) =>
                    {
                        actions.push({
                            name: `${action.name || `Passive Action ${idx + 1}`} (Core Passive)`,
                            path: `core_system.passive_actions[${idx}]`
                        });
                    });
                }
                (item.system?.traits ?? []).forEach((trait, tIdx) =>
                {
                    actions.push({ name: `${trait.name || `Trait ${tIdx + 1}`} (Trait)`, path: `traits[${tIdx}]` });
                    (trait.actions ?? []).forEach((action, aIdx) =>
                    {
                        actions.push({
                            name: `${action.name || 'Action'} (Trait: ${trait.name || tIdx + 1})`,
                            path: `traits[${tIdx}].actions[${aIdx}]`
                        });
                    });
                });
            }
        }

        if (actions.length === 0)
            actions.push({ name: item.name, path: "", isDefault: true });
        return actions;
    }

    async _showActionSelectionDialog(itemName, actions)
    {
        const actionListHtml = actions.map((action, idx) =>
            `<div class="lancer-item-card action-browser-entry" data-path="${action.path}" style="margin-bottom: 6px; padding: 10px;">
                <div class="lancer-item-icon"><i class="fas fa-bolt"></i></div>
                <div class="lancer-item-content">
                    <div class="lancer-item-name">${action.name}${action.isDefault ? ' <em>(default)</em>' : ''}</div>
                    <div class="lancer-item-details">Path: ${action.path || '(empty)'}</div>
                </div>
            </div>`
        ).join('');

        return await new Promise((resolve) =>
        {
            const dialog = new Dialog({
                title: localize('LA.dialogTitle.selectAction'),
                content: `
                    <div class="lancer-dialog-header" style="margin: -8px -8px 10px -8px;">
                        <h1 class="lancer-dialog-title">Select Action</h1>
                        <p class="lancer-dialog-subtitle">Choose which action from <strong>${itemName}</strong> to trigger.</p>
                    </div>
                    <div id="action-list" style="max-height: 350px; overflow-y: auto; padding: 4px; border: 1px solid #ddd; background: var(--la-plate); border-radius: 4px;">
                        ${actionListHtml}
                    </div>
                `,
                buttons: {
                    noAction: {
                        label: `<i class="fas fa-minus"></i> ${localize("LA.activationManager.noSpecificAction")}`,
                        callback: () => resolve("")
                    },
                    cancel: cancelButton(() => resolve(null))
                },
                render: (html) =>
                {
                    html.find('.action-browser-entry').on('click', (ev) =>
                    {
                        resolve($(ev.currentTarget).data('path'));
                        dialog.close();
                    });
                },
                default: "cancel"
            }, {
                width: 400,
                classes: ["lancer-dialog-base", "lancer-action-browser-dialog", 'lancer-no-title']
            });
            dialog.render(true);
        });
    }

    _getTriggerOptions(selected)
    {
        const help = this._triggerHelp ?? {};
        const hasCancelFn = (triggerKey) => /\w+\s*\(/.test(help[triggerKey] ?? "");

        return TRIGGER_GROUPS.map((group, index) => ({
            index,
            label: localize(group.label),
            items: group.triggers.map(triggerKey => ({
                key: triggerKey,
                checked: selected.includes(triggerKey),
                cx: hasCancelFn(triggerKey),
                tg: TARGET_CAPABLE_TRIGGERS.has(triggerKey),
                sm: SOURCE_MATCH_TRIGGERS.has(triggerKey)
            }))
        }));
    }

    /**
     * Compile each non-empty code field so a syntax error is reported here
     * instead of surfacing later inside the engine's error boundary.
     * @param {Record<string, any>} formData
     * @returns {string|null} the first field name that failed to compile
     */
    _findSyntaxError(formData)
    {
        const fields = [
            { name: "Evaluate Function", code: formData.evaluate, args: ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], async: false },
            { name: "Activation Code", code: formData.activationCode, args: ["triggerType", "triggerData", "reactorToken", "item", "activationName", "api"], async: true },
            { name: "onInit Code", code: formData.onInit, args: ["token", "item", "api"], async: false },
            { name: "onMessage Code", code: formData.onMessage, args: ["triggerType", "data", "reactorToken", "item", "activationName", "api"], async: true }
        ];

        for (const field of fields)
        {
            const code = String(field.code ?? "").trim();
            if (!code)
                continue;
            try
            {
                if (field.async)
                    stringToAsyncFunction(code, field.args, `validate-${field.name}`);
                else
                    stringToFunction(code, field.args, null, `validate-${field.name}`);
            }
            catch (error)
            {
                ui.notifications.error(localizeFormat('LA.notify.labeledError', { label: field.name, error: error.message }));
                return field.name;
            }
        }
        return null;
    }

    async _updateObject(event, formData)
    {
        this._lastSaveOk = false;

        if (this._findSyntaxError(formData))
            return;

        const isGeneral = formData.isGeneral === true;

        const triggers = [];
        for (const [key, value] of Object.entries(formData))
        {
            if (key.startsWith("trigger.") && value)
                triggers.push(key.replace("trigger.", ""));
        }
        for (const entry of String(formData.customTriggers ?? "").split(","))
        {
            const customTrigger = entry.trim();
            if (!customTrigger || triggers.includes(customTrigger))
                continue;
            if (customTrigger.startsWith("onInit"))
                return ui.notifications.error(localizeFormat('LA.notify.customTriggerOnInit', { name: customTrigger }));
            triggers.push(customTrigger);
        }

        const dispositionFilter = [];
        if (formData['dispositionFilter.friendly'])
            dispositionFilter.push('friendly');
        if (formData['dispositionFilter.neutral'])
            dispositionFilter.push('neutral');
        if (formData['dispositionFilter.hostile'])
            dispositionFilter.push('hostile');
        if (formData['dispositionFilter.secret'])
            dispositionFilter.push('secret');

        const isSourceMatch = formData.onlyOnSourceMatch === true || formData.onlyOnSourceMatch === "on";

        if (isGeneral)
        {
            const name = formData.name;
            if (!name)
                return ui.notifications.error(localize('LA.notify.activationNameIsRequiredForGeneralActivations'));

            const newReaction = {
                triggers: triggers,
                evaluate: formData.evaluate,
                comments: formData.commentsGeneral || "",
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Automation",
                frequency: formData.frequency || "1/Round",
                checkReaction: formData.checkReaction === true,
                requireCanProvoke: formData.requireCanProvoke === true,
                checkUsage: formData.checkUsage === true,
                autoActivate: formData.autoActivate === true,
                awaitActivationCompletion: formData.awaitActivationCompletion === true,
                onlyOnSourceMatch: isSourceMatch,
                sceneReactor: formData.sceneReactor || "off",
                sceneId: formData.sceneId || "",
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "instead",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                onInit: formData.onInit || "",
                onMessage: formData.onMessage || "",
                triggerSelf: formData.triggerSelf === true,
                triggerOther: formData.triggerOther === true,
                triggerTarget: formData.triggerTarget === true,
                triggerEnvironment: formData.triggerEnvironment === true,
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            if (formData.workshopId && formData.name === formData.originalName)
                newReaction.workshopId = formData.workshopId;

            if (newReaction.workshopId)
            {
                const savedGenerals = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS);
                let staleRemoved = false;
                for (const [otherName, other] of Object.entries(savedGenerals))
                {
                    if (otherName !== name && other?.workshopId === newReaction.workshopId)
                    {
                        delete savedGenerals[otherName];
                        staleRemoved = true;
                    }
                }
                if (staleRemoved)
                    await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, savedGenerals);
            }

            const defEntry = getDefaultGeneralReactionRegistry()[name];
            const subIdx = Number.parseInt(formData.reactionIndex);
            if (Array.isArray(defEntry?.reactions) && Number.isFinite(subIdx) && defEntry.reactions[subIdx])
            {
                // Overriding one sub of a grouped default: store in its slot, keep the others on defaults
                const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
                const existing = userSaved[name];
                const subs = Array.isArray(existing?.reactions) ? existing.reactions : [];
                subs[subIdx] = newReaction;
                userSaved[name] = { reactions: subs };
                clearScriptCache();
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
            }
            else
                await ReactionManager.saveGeneralReaction(name, newReaction);
        }
        else
        {
            const lid = formData.lid;
            if (!lid)
                return ui.notifications.error(localize('LA.notify.itemLidIsRequired'));

            const newReaction = {
                reactionPath: formData.reactionPath || "",
                triggers: triggers,
                evaluate: formData.evaluate,
                comments: formData.commentsItem || "",
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Automation",
                frequency: formData.frequency || "1/Round",
                checkReaction: formData.checkReaction === true,
                requireCanProvoke: formData.requireCanProvoke === true,
                checkUsage: formData.checkUsage === true,
                autoActivate: formData.autoActivate === true,
                awaitActivationCompletion: formData.awaitActivationCompletion === true,
                onlyOnSourceMatch: isSourceMatch,
                sceneReactor: formData.sceneReactor || "off",
                sceneId: formData.sceneId || "",
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "instead",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                onInit: formData.onInit || "",
                onMessage: formData.onMessage || "",
                triggerSelf: formData.triggerSelf === true,
                triggerOther: formData.triggerOther === true,
                triggerTarget: formData.triggerTarget === true,
                triggerEnvironment: formData.triggerEnvironment === true,
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            if (RUNS_ON_CHOICES.includes(formData.runsOn) && formData.runsOn !== 'mech')
                newReaction.runsOn = formData.runsOn;

            if (formData.workshopId)
                newReaction.workshopId = formData.workshopId;

            let userReactions = getModuleSetting(ReactionManager.SETTING_REACTIONS);

            if (!userReactions[lid])
                userReactions[lid] = ReactionManager.newSavedItemEntry(lid);

            let index = String(lid) === String(this.object.lid ?? '') ? formData.reactionIndex : '';
            if ((index === undefined || index === null || index === "") && newReaction.workshopId)
            {
                const existing = userReactions[lid].reactions.findIndex(entry => entry?.workshopId === newReaction.workshopId);
                if (existing >= 0)
                    index = existing;
            }
            if (index !== undefined && index !== null && index !== "")
            {
                if (userReactions[lid].reactions[index])
                    userReactions[lid].reactions[index] = newReaction;
                else
                    userReactions[lid].reactions.push(newReaction);
            }
            else
                userReactions[lid].reactions.push(newReaction);

            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userReactions);
        }

        if (this.object.workshopPreview && String(formData.workshopId || "").includes('/') &&
            (!isGeneral || formData.name === formData.originalName))
        {
            const author = formData.workshopId.split('/')[0];
            await ReactionManager.createFolder(author);
            await ReactionManager.assignToFolder(author, isGeneral ? `general::${formData.name}` : `item::${formData.lid}`);
        }

        this._lastSaveOk = true;
        clearScriptCache();

        Object.values(ui.windows).forEach(app =>
        {
            if (app.id === "reaction-manager-config")
                app.render();
        });
    }

    /** Like item browser but for deployable actors. Omit lidInput for copy-only mode. */
    async _openDeployableBrowser(lidInput = null, pathInput = null, updatePreview = null)
    {
        await openDeployablePicker({
            onPick: lidInput ? async (entry) =>
            {
                const actor = /** @type {any} */ (await fromUuid(entry.uuid));
                if (!actor)
                    return 'keep-open';
                const actions = this._getItemActions(actor);
                const selectedPath = await this._showActionSelectionDialog(actor.name, actions);
                if (selectedPath === null)
                    return 'keep-open';
                lidInput.val(entry.lid);
                if (pathInput)
                    pathInput.val(selectedPath);
                if (typeof updatePreview === 'function')
                    await updatePreview();
            } : null,
        });
    }

    async _openDocumentBrowser(lidInput, pathInput, updatePreview)
    {
        await openDocumentPicker({
            title: localize('LA.dialogTitle.findActor'),
            documentTypes: ['Actor'],
            onPick: async (entry) =>
            {
                const actor = game.actors.get(entry.id);
                if (!actor)
                    return 'keep-open';
                const selectedPath = await this._showActionSelectionDialog(actor.name, this._getItemActions(actor));
                if (selectedPath === null)
                    return 'keep-open';
                lidInput.val(entry.uuid);
                pathInput.val(selectedPath);
                await updatePreview();
            }
        });
    }
}
