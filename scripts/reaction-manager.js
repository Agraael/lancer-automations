/*global game, FormApplication, mergeObject, foundry, TextEditor */

import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";

export function stringToFunction(str, args = []) {
    const trimmed = str.trim();
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('(')) {
        return eval(`(${trimmed})`);
    }
    return new Function(...args, trimmed);
}

export function stringToAsyncFunction(str, args = []) {
    const trimmed = str.trim();
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('(')) {
        return eval(`(${trimmed})`);
    }
    const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
    return new AsyncFunction(...args, trimmed);
}

export class ReactionManager {
    static get ID() {
        return "lancer-reactionChecker";
    }

    static get SETTING_REACTIONS() {
        return "customReactions";
    }

    static get SETTING_GENERAL_REACTIONS() {
        return "generalReactions";
    }

    static initialize() {
        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, {
            name: "Custom Activations",
            hint: "Define custom activations for items.",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, {
            name: "General Activations",
            hint: "Define activations that apply to all tokens.",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.registerMenu(ReactionManager.ID, "reactionConfig", {
            name: "Activation Manager",
            label: "Open Activation Manager",
            hint: "Configure custom activations and triggers.",
            icon: "fas fa-bolt",
            type: ReactionConfig,
            restricted: true
        });
    }

    static getAllReactions() {
        const defaults = getDefaultItemReactionRegistry();
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        return { ...defaults, ...userSaved };
    }

    static getReactions(lid) {
        const all = ReactionManager.getAllReactions();
        return all[lid];
    }

    static getGeneralReactions() {
        const defaults = getDefaultGeneralReactionRegistry();
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        return { ...defaults, ...userSaved };
    }

    static getGeneralReaction(name) {
        const generals = ReactionManager.getGeneralReactions();
        return generals[name];
    }

    static async saveGeneralReaction(name, reaction) {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        userSaved[name] = reaction;
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
    }

    static async deleteGeneralReaction(name) {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        if (userSaved[name]) {
            delete userSaved[name];
            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
        }
    }

    static exportReactions() {
        const itemReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const generalReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const exportData = {
            version: 1,
            exportDate: new Date().toISOString(),
            itemReactions: itemReactions,
            generalReactions: generalReactions
        };

        const jsonStr = JSON.stringify(exportData, null, 2);
        const blob = new Blob([jsonStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `lancer-activations-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        ui.notifications.info("Activations exported successfully.");
    }

    static async importReactions(file, mode = "merge") {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = JSON.parse(event.target.result);

                    if (!data.itemReactions && !data.generalReactions) {
                        throw new Error("Invalid activation file format.");
                    }

                    if (mode === "replace") {
                        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, data.itemReactions || {});
                        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, data.generalReactions || {});
                    } else {
                        const existingItem = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
                        const existingGeneral = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

                        const mergedItem = { ...existingItem, ...data.itemReactions };
                        const mergedGeneral = { ...existingGeneral, ...data.generalReactions };

                        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, mergedItem);
                        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, mergedGeneral);
                    }

                    ui.notifications.info(`Activations imported successfully (${mode} mode).`);
                    resolve(true);
                } catch (e) {
                    ui.notifications.error(`Failed to import activations: ${e.message}`);
                    reject(e);
                }
            };
            reader.onerror = () => reject(new Error("Failed to read file."));
            reader.readAsText(file);
        });
    }
}

export class ReactionConfig extends FormApplication {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Activation Manager",
            id: "reaction-manager-config",
            template: `modules/lancer-reactionChecker/templates/reaction-config.html`,
            width: 800,
            height: 700,
            resizable: true,
            tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "custom" }]
        });
    }

    async getData() {
        const userItemSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const userGeneralSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const defaultGeneralRegistry = getDefaultGeneralReactionRegistry();
        const defaultItemRegistry = getDefaultItemReactionRegistry();

        const defaultList = [];
        const allReactions = [];

        const midsToLookup = new Set([
            ...Object.keys(userItemSettings).map(k => k.trim()),
            ...Object.keys(defaultItemRegistry).map(k => k.trim())
        ]);

        const itemMap = new Map();

        for (const pack of game.packs) {
            if (pack.documentName !== "Item") continue;
            if (midsToLookup.size === 0) break;

            const index = await pack.getIndex({ fields: ["system.lid"] });
            for (const entry of index) {
                if (entry.system?.lid && midsToLookup.has(entry.system.lid)) {
                    const itemDoc = await fromUuid(entry.uuid);
                    if (itemDoc) {
                        itemMap.set(entry.system.lid, {
                            name: itemDoc.name,
                            system: itemDoc.system
                        });
                        midsToLookup.delete(entry.system.lid);
                    }
                }
            }
        }

        const resolveActionName = (itemData, path) => {
            if (!itemData || !path || path === "system.trigger" || path === "system") return null;
            try {
                const pathParts = path.split(/\.|\[|\]/).filter(p => p !== "");
                let current = itemData;
                for (const part of pathParts) {
                    if (current && (typeof current === 'object' || Array.isArray(current))) {
                        current = current[part];
                    } else {
                        return null;
                    }
                }
                return current?.name || null;
            } catch (e) {
                return null;
            }
        };

        const startEnabled = (r) => {
            if (r.enabled === undefined) r.enabled = true;
            return r;
        };

        const isPureDefault = (saved, def) => {
            if (!saved || !def) return false;
            const savedKeys = Object.keys(saved);
            if (savedKeys.length === 1 && savedKeys[0] === 'enabled') return true;
            const s = foundry.utils.deepClone(saved);
            const d = foundry.utils.deepClone(def);
            delete s.enabled;
            delete d.enabled;
            return foundry.utils.objectsEqual(s, d);
        };

        for (const [rawLid, data] of Object.entries(userItemSettings)) {
            const lid = rawLid.trim();
            data.reactions.forEach((reaction, index) => {
                const reactionKeys = Object.keys(reaction);
                if (reactionKeys.length === 1 && reactionKeys[0] === 'enabled') return;

                const defItem = defaultItemRegistry[lid]?.reactions?.find(r => r.name === reaction.name);
                if (defItem && isPureDefault(reaction, defItem)) return;

                const itemInfo = itemMap.get(lid);
                let displayName = reaction.name || rawLid;
                let displaySubname = rawLid;

                if (itemInfo) {
                    const actionName = resolveActionName(itemInfo.system, reaction.reactionPath);
                    if (actionName) {
                        displayName = `${itemInfo.name}: ${actionName}`;
                    } else {
                        displayName = itemInfo.name;
                    }
                    displaySubname = lid;
                }

                allReactions.push(startEnabled({
                    lid: rawLid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: reaction.reactionPath,
                    triggers: reaction.triggers.join(", "),
                    isCustom: true,
                    isGeneral: false,
                    reactionIndex: index,
                    original: reaction,
                    enabled: reaction.enabled
                }));
            });
        }
        for (const [lid, data] of Object.entries(defaultItemRegistry)) {
            data.reactions.forEach((reaction, index) => {
                const userEntry = userItemSettings[lid]?.reactions?.[index] ||
                    userItemSettings[lid]?.reactions?.find(r => r.name === reaction.name);
                const isPure = isPureDefault(userEntry, reaction);
                const isOverridden = !!userEntry && !isPure;
                const enabledState = isPure ? userEntry.enabled : (userEntry?.enabled ?? reaction.enabled);

                const itemInfo = itemMap.get(lid);
                let displayName = reaction.name || lid;
                let displaySubname = lid;

                if (itemInfo) {
                    const actionName = resolveActionName(itemInfo.system, reaction.reactionPath);
                    if (actionName) {
                        displayName = `${itemInfo.name}: ${actionName}`;
                    } else {
                        displayName = itemInfo.name;
                    }
                    displaySubname = lid;
                }

                defaultList.push(startEnabled({
                    lid: lid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: reaction.reactionPath,
                    triggers: reaction.triggers.join(", "),
                    isGeneral: false,
                    isDefault: true,
                    isOverridden: isOverridden,
                    reactionIndex: index,
                    original: reaction,
                    enabled: enabledState
                }));
            });
        }

        for (const [name, reaction] of Object.entries(userGeneralSettings)) {
            const def = defaultGeneralRegistry[name];
            if (def && isPureDefault(reaction, def)) continue;

            allReactions.push(startEnabled({
                name: name,
                lid: null,
                triggers: reaction.triggers?.join(", ") || "",
                isGeneral: true,
                isCustom: true,
                onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
                original: reaction,
                enabled: reaction.enabled
            }));
        }
        for (const [name, reaction] of Object.entries(defaultGeneralRegistry)) {
            const userSaved = userGeneralSettings[name];
            const isPure = isPureDefault(userSaved, reaction);
            const isOverridden = !!userSaved && !isPure;

            const enabledState = isPure ? userSaved.enabled : reaction.enabled;

            defaultList.push(startEnabled({
                name: name,
                lid: null,
                triggers: reaction.triggers?.join(", ") || "",
                isGeneral: true,
                isDefault: true,
                isOverridden: isOverridden,
                onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
                original: reaction,
                enabled: enabledState
            }));
        }

        const sorter = (a, b) => {
            if (a.isGeneral !== b.isGeneral) return b.isGeneral - a.isGeneral;
            return a.name.localeCompare(b.name);
        };

        allReactions.sort(sorter);
        defaultList.sort(sorter);

        return {
            allReactions: allReactions,
            defaultReactions: defaultList
        };
    }

    activateListeners(html) {
        super.activateListeners(html);
        html.find('.add-reaction').click(this._onAddReaction.bind(this));
        html.find('.edit-reaction').click(this._onEditReaction.bind(this));
        html.find('.delete-reaction').click(this._onDeleteReaction.bind(this));
        html.find('.copy-default').click(this._onCopyDefault.bind(this));
        html.find('.reaction-enabled').change(this._onToggleEnabled.bind(this));
        html.find('.help-btn').click(this._onHelp.bind(this));
    }

    _onHelp(event) {
        event.preventDefault();
        const content = `
        <div style="font-family: 'Roboto', sans-serif; line-height: 1.5;">
            <p>Each activation can be either <strong>General</strong> (global) or <strong>Item-based</strong>.</p>
            <p>An activation listens for a specific <strong>Trigger</strong> (e.g., <code>onDamage</code> fires when a token deals damage).</p>
            <hr>
            <p>Activations are checked for every token in combat. If a token has the activation available, the <strong>Evaluation Function</strong> is executed.</p>
            <p>If the evaluation returns <code>true</code>, the activation triggers and appears in the popup window.</p>
            <p><em>(Note: Different data is passed to the evaluation function depending on the trigger type.)</em></p>
            <hr>
            <p>You can also execute <strong>Macros</strong> or plain <strong>JS Code</strong> when activating the activation from the popup.</p>
            <p>Useful functions available in this module:</p>
            <ul>
                <li><code>isHostile(token1, token2)</code></li>
                <li><code>isFriendly(token1, token2)</code></li>
            </ul>
        </div>
        `;

        new Dialog({
            title: "Activation Manager Help",
            content: content,
            buttons: {
                ok: {
                    label: "Close",
                    icon: '<i class="fas fa-check"></i>'
                }
            },
            default: "ok"
        }, { width: 500 }).render(true);
    }

    async _onAddReaction(event) {
        new ReactionEditor({}).render(true);
    }

    async _onEditReaction(event) {
        event.preventDefault();
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";

        if (isGeneral) {
            const name = li.data("name");
            const generals = ReactionManager.getGeneralReactions();
            const reaction = generals[name];
            if (!reaction) return;
            new ReactionEditor({ isGeneral: true, name, reaction }).render(true);
        } else {
            const lid = li.data("lid");
            const index = li.data("index");
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry) return;

            const reactionIndex = (typeof index !== 'undefined') ? index : 0;
            const reaction = entry.reactions[reactionIndex];
            new ReactionEditor({ isGeneral: false, lid, reaction, reactionIndex: reactionIndex }).render(true);
        }
    }

    async _onDeleteReaction(event) {
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";

        if (isGeneral) {
            const name = li.data("name");
            await ReactionManager.deleteGeneralReaction(name);
        } else {
            const lid = li.data("lid");
            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);
            if (userReactions[lid]) {
                delete userReactions[lid];
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userReactions);
            }
        }
        this.render();
    }

    async _onCopyDefault(event) {
        const li = $(event.currentTarget).closest(".reaction-item");
        const lid = li.data("lid");
        const name = li.data("name");
        const isGeneral = li.data("general");
        const index = li.data("index");

        if (isGeneral) {
            const defaultReaction = getDefaultGeneralReactionRegistry()[name];
            if (!defaultReaction) return;
            const reaction = foundry.utils.deepClone(defaultReaction);
            new ReactionEditor({ isGeneral: true, name, reaction }).render(true);
        } else {
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry) return;
            const reactionIndex = (typeof index !== 'undefined') ? index : 0;
            const reaction = foundry.utils.deepClone(entry.reactions[reactionIndex]);
            new ReactionEditor({ isGeneral: false, lid, reaction }).render(true);
        }
    }

    async _onToggleEnabled(event) {
        const checkbox = event.currentTarget;
        const li = $(checkbox).closest(".reaction-item");
        const checked = checkbox.checked;
        const isGenTag = li.attr("data-is-general") || li.attr("data-general");
        const isGeneral = isGenTag === "true";

        if (isGeneral) {
            const name = li.data("name");
            const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

            if (userSaved[name]) {
                userSaved[name].enabled = checked;
            } else {
                userSaved[name] = { enabled: checked };
            }
            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
        } else {
            const lid = li.data("lid");
            const index = li.data("index");
            const userItemSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};

            if (userItemSettings[lid]) {
                if (userItemSettings[lid].reactions?.[index]) {
                    userItemSettings[lid].reactions[index].enabled = checked;
                }
            } else {
                const defaults = getDefaultItemReactionRegistry();
                if (defaults[lid]) {
                    userItemSettings[lid] = {
                        itemType: defaults[lid].itemType,
                        reactions: defaults[lid].reactions.map((r, i) =>
                            i === parseInt(index) ? { enabled: checked } : { enabled: r.enabled !== false }
                        )
                    };
                }
            }
            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userItemSettings);
        }
        this.render();
    }

    async _updateObject(event, formData) {
    }
}

export class ReactionEditor extends FormApplication {
    constructor(object, options) {
        super(object, options);
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Edit Activation",
            id: "reaction-editor",
            template: `modules/lancer-reactionChecker/templates/reaction-editor.html`,
            width: 800,
            height: "auto",
            classes: ["lancer-reaction-editor"]
        });
    }

    async getData() {
        const data = this.object;
        const reaction = data.reaction || {};

        let foundItemName = null;
        let foundItemUuid = null;

        if (!data.isGeneral && data.lid) {
            for (const pack of game.packs) {
                if (pack.documentName !== "Item") continue;

                const index = await pack.getIndex({ fields: ["system.lid"] });
                const entry = index.find(e => e.system?.lid === data.lid);
                if (entry) {
                    foundItemName = entry.name;
                    foundItemUuid = entry.uuid;
                    break;
                }
            }
        }

        let foundActionName = null;
        const reactionPath = reaction.reactionPath || "";

        if (foundItemUuid) {
            try {
                const item = await fromUuid(foundItemUuid);
                if (item) {
                    if (!reactionPath || reactionPath === "system" || reactionPath === "") {
                        foundActionName = item.name;
                    } else {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
                        let actionData = item.system;
                        for (const part of pathParts) {
                            if (actionData && (typeof actionData === 'object' || Array.isArray(actionData))) {
                                actionData = actionData[part];
                            } else {
                                actionData = null;
                                break;
                            }
                        }
                        if (actionData && actionData.name) {
                            foundActionName = actionData.name;
                        } else {
                            foundActionName = item.name;
                        }
                    }
                }
            } catch (e) {
                console.warn("lancer-reactionChecker | Could not load item for action name:", e);
            }
        }

        const triggerHelp = {
            onAttack: "{ triggeringToken, weapon, targets, attackType, actionName, tags, actionData, distanceToTrigger }",
            onHit: "{ triggeringToken, weapon, targets: [{target, roll, crit}], attackType, actionName, tags, actionData, distanceToTrigger }",
            onMiss: "{ triggeringToken, weapon, targets: [{target, roll}], attackType, actionName, tags, actionData, distanceToTrigger }",
            onDamage: "{ triggeringToken, weapon, target, damages, types, isCrit, attackType, actionName, tags, actionData, distanceToTrigger }",
            onMove: "{ triggeringToken, distanceMoved, elevationMoved, startPos, endPos, distanceToTrigger }",
            onTurnStart: "{ triggeringToken, distanceToTrigger }",
            onTurnEnd: "{ triggeringToken, distanceToTrigger }",
            onStatusApplied: "{ triggeringToken, statusId, effect, distanceToTrigger }",
            onStatusRemoved: "{ triggeringToken, statusId, effect, distanceToTrigger }",
            onStructure: "{ triggeringToken, remainingStructure, rollResult, distanceToTrigger }",
            onStress: "{ triggeringToken, remainingStress, rollResult, distanceToTrigger }",
            onHeat: "{ triggeringToken, heatGained, currentHeat, inDangerZone, distanceToTrigger }",
            onDestroyed: "{ triggeringToken, distanceToTrigger }",
            onTechAttack: "{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData, distanceToTrigger }",
            onTechHit: "{ triggeringToken, techItem, targets: [{target, roll, crit}], actionName, isInvade, tags, actionData, distanceToTrigger }",
            onTechMiss: "{ triggeringToken, techItem, targets: [{target, roll}], actionName, isInvade, tags, actionData, distanceToTrigger }",
            onCheck: "{ triggeringToken, statName, roll, total, success, distanceToTrigger }",
            onActivation: "{ triggeringToken, actionType, actionName, item, actionData, distanceToTrigger }",
            onHPRestored: "{ triggeringToken, hpRestored, currentHP, maxHP, distanceToTrigger }",
            onHpLoss: "{ triggeringToken, hpLost, currentHP, distanceToTrigger }",
            onClearHeat: "{ triggeringToken, heatCleared, currentHeat, distanceToTrigger }"
        };

        const result = {
            isGeneral: data.isGeneral || false,
            name: data.name || "",
            lid: data.lid || "",
            foundItemName: foundItemName,
            foundItemUuid: foundItemUuid,
            foundActionName: foundActionName,
            reactionPath: reaction.reactionPath || "",
            triggerDescription: reaction.triggerDescription || "",
            effectDescription: reaction.effectDescription || "",
            isReaction: reaction.isReaction !== false,
            isReactionDefined: reaction.isReaction !== undefined,
            triggerSelf: reaction.triggerSelf === true,
            triggerOther: reaction.triggerOther !== false,
            outOfCombat: reaction.outOfCombat === true,
            autoActivate: reaction.autoActivate || false,
            onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
            triggers: this._getTriggerOptions(reaction.triggers || []),
            evaluate: reaction.evaluate?.toString() || "return true;",
            triggerHelp: triggerHelp,
            activationType: reaction.activationType || "flow",
            activationMode: reaction.activationMode || "after",
            activationMacro: reaction.activationMacro || "",
            activationCode: typeof reaction.activationCode === 'function' ? reaction.activationCode.toString() : (reaction.activationCode || ""),
            reactionIndex: data.reactionIndex,
            actionType: reaction.actionType || (reaction.isReaction !== false ? "Reaction" : "Free Action"),
            consumesReaction: reaction.consumesReaction !== false,
            actionTypeOptions: {
                "Reaction": "Reaction",
                "Free Action": "Free Action",
                "Quick Action": "Quick Action",
                "Full Action": "Full Action",
                "Protocol": "Protocol",
                "Other": "Other"
            },
            frequency: reaction.frequency || "1/Round",
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

    activateListeners(html) {
        super.activateListeners(html);

        const generalCheckbox = html.find('#isGeneral');
        const generalOnlyFields = html.find('.general-only');
        const itemOnlyFields = html.find('.item-only');

        const toggleFields = () => {
            const isGeneral = generalCheckbox.prop('checked');
            generalOnlyFields.toggle(isGeneral);
            itemOnlyFields.toggle(!isGeneral);
        };

        generalCheckbox.on('change', toggleFields);
        toggleFields();

        const onlyOnSourceMatchCheckbox = html.find('#onlyOnSourceMatch');
        const triggerCheckboxes = html.find('input[name^="trigger."]');

        const sourceMatchTriggers = [
            'onAttack', 'onHit', 'onMiss', 'onDamage',
            'onTechAttack', 'onTechHit', 'onTechMiss', 'onActivation'
        ];

        const toggleSourceMatchTriggers = () => {
            const isSourceMatch = onlyOnSourceMatchCheckbox.prop('checked');

            triggerCheckboxes.each(function () {
                const triggerName = $(this).attr('name').replace('trigger.', '');
                const isCompatible = sourceMatchTriggers.includes(triggerName);

                if (isSourceMatch && !isCompatible) {
                    $(this).prop('disabled', true);
                    $(this).prop('checked', false);
                    $(this).closest('label').css('opacity', '0.5');
                } else {
                    $(this).prop('disabled', false);
                    $(this).closest('label').css('opacity', '1');
                }
            });
        };

        onlyOnSourceMatchCheckbox.on('change', toggleSourceMatchTriggers);
        toggleSourceMatchTriggers();

        const activationTypeSelect = html.find('#activationType');
        const activationModeSelect = html.find('#activationMode');
        const macroFields = html.find('.activation-macro');
        const codeFields = html.find('.activation-code');

        const toggleActivationFields = () => {
            const type = activationTypeSelect.val();
            macroFields.toggle(type === 'macro');
            codeFields.toggle(type === 'code');
            activationModeSelect.toggle(type === 'macro' || type === 'code');
        };

        activationTypeSelect.on('change', toggleActivationFields);
        toggleActivationFields();

        html.find('.show-item-btn').on('click', async (ev) => {
            ev.preventDefault();
            const uuid = $(ev.currentTarget).data('uuid');
            if (uuid) {
                const item = await fromUuid(uuid);
                if (item) item.sheet.render(true);
            }
        });

        const lidInput = html.find('input[name="lid"]');
        const pathInput = html.find('input[name="reactionPath"]');
        const previewContainer = html.find('.item-preview-container');
        const showItemBtn = html.find('.show-item-btn');
        const previewItemName = html.find('#preview-item-name');
        const previewActionName = html.find('#preview-action-name');

        const actionTypeSelect = html.find('#actionType');
        const frequencySelect = html.find('#frequency');
        const consumesReactionContainer = html.find('#consumesReactionContainer');

        const toggleConsumesReaction = () => {
            const type = actionTypeSelect.val();
            if (type === 'Reaction') {
                consumesReactionContainer.show();
            } else {
                consumesReactionContainer.hide();
                consumesReactionContainer.find('input[type="checkbox"]').prop('checked', false);
            }
        };

        actionTypeSelect.on('change', toggleConsumesReaction);
        toggleConsumesReaction();

        const updatePreview = async (autoSelect = true) => {
            const lid = lidInput.val()?.trim();
            const reactionPath = pathInput.val()?.trim() || "";

            if (!lid) {
                previewContainer.hide();
                return;
            }

            let foundItemUuid = null;
            let foundItemName = null;

            for (const pack of game.packs) {
                if (pack.documentName !== "Item") continue;
                const index = await pack.getIndex({ fields: ["system.lid"] });
                const entry = index.find(e => e.system?.lid === lid);
                if (entry) {
                    foundItemUuid = entry.uuid;
                    foundItemName = entry.name;
                    break;
                }
            }

            if (!foundItemUuid) {
                previewContainer.hide();
                return;
            }

            let foundActionName = null;
            let detectedActionType = null;
            let detectedFrequency = null;

            try {
                const item = await fromUuid(foundItemUuid);
                if (item) {
                    if (!reactionPath || reactionPath === "" || reactionPath === "system" || reactionPath === "system.trigger") {
                        foundActionName = item.name;
                    } else {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
                        let actionData = item.system;
                        for (const part of pathParts) {
                            if (actionData && (typeof actionData === 'object' || Array.isArray(actionData))) {
                                actionData = actionData[part];
                            } else {
                                actionData = null;
                                break;
                            }
                        }
                        foundActionName = actionData?.name || item.name;

                        const activation = actionData?.activation;
                        if (activation) {
                            if (activation === "Quick") detectedActionType = "Quick Action";
                            else if (activation === "Full") detectedActionType = "Full Action";
                            else if (activation === "Reaction") detectedActionType = "Reaction";
                            else if (activation === "Free") detectedActionType = "Free Action";
                            else if (activation === "Protocol") detectedActionType = "Protocol";
                            else detectedActionType = activation;
                        }

                        if (actionData?.frequency) {
                            detectedFrequency = actionData.frequency;
                        } else if (item.system?.frequency) {
                            detectedFrequency = item.system.frequency;
                        } else if (item.system?.uses?.per) {
                            const per = item.system.uses.per;
                            if (per === "Round") detectedFrequency = "1/Round";
                            else if (per === "Scene") detectedFrequency = "1/Scene";
                            else if (per === "Combat") detectedFrequency = "1/Combat";
                            else if (per === "Mission") detectedFrequency = "1/Mission";
                        } else if (detectedActionType === "Reaction" || detectedActionType === "Free Action") {
                            detectedFrequency = "1/Round";
                        }
                    }
                }
            } catch (e) {
                console.warn("lancer-reactionChecker | Error resolving action name:", e);
            }

            previewItemName.html(`<strong>Item:</strong> ${foundItemName}`);

            if (foundItemUuid) {
                showItemBtn.data('uuid', foundItemUuid);
                showItemBtn.attr('data-uuid', foundItemUuid);
                showItemBtn.show();
            } else {
                showItemBtn.hide();
            }

            if (foundActionName && foundActionName !== foundItemName) {
                if (previewActionName.length) {
                    previewActionName.html(`<strong>Action:</strong> ${foundActionName}`).show();
                } else {
                    previewItemName.after(`<span id="preview-action-name" style="margin-left: 10px;"><strong>Action:</strong> ${foundActionName}</span>`);
                }
            } else {
                previewActionName.hide();
            }

            if (detectedActionType) {
                const options = ["Reaction", "Free Action", "Quick Action", "Full Action", "Protocol", "Other"];

                const $options = actionTypeSelect.find('option');
                $options.css('color', '');
                $options.each(function () {
                    if ($(this).val() === detectedActionType) {
                        $(this).css({
                            'color': '#4caf50',
                            'font-weight': 'bold'
                        });
                    }
                });

                if (autoSelect && (options.includes(detectedActionType) || detectedActionType === "Other")) {
                    actionTypeSelect.val(options.includes(detectedActionType) ? detectedActionType : "Other");
                    actionTypeSelect.trigger('change');
                }
            }

            if (detectedFrequency) {
                const options = ["1/Round", "Unlimited", "1/Scene", "1/Combat", "Other"];
                const $options = frequencySelect.find('option');
                $options.css('color', '');
                $options.each(function () {
                    if ($(this).val() === detectedFrequency) {
                        $(this).css({
                            'color': '#4caf50',
                            'font-weight': 'bold'
                        });
                    }
                });

                if (autoSelect && (options.includes(detectedFrequency) || detectedFrequency === "Other")) {
                    frequencySelect.val(options.includes(detectedFrequency) ? detectedFrequency : "Other");
                }
            }

            showItemBtn.data('uuid', foundItemUuid);
            previewContainer.show();
        };

        let updateTimeout;
        const debouncedUpdate = () => {
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(updatePreview, 300);
        };

        lidInput.on('input', debouncedUpdate);
        pathInput.on('input', debouncedUpdate);

        if (lidInput.val()) {
            updatePreview(false);
        }

        if (typeof CodeMirror !== 'undefined') {
            const evaluateTextarea = html.find('textarea[name="evaluate"]')[0];
            if (evaluateTextarea) {
                this.evaluateEditor = CodeMirror.fromTextArea(evaluateTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    indentUnit: 4,
                    smartIndent: true
                });
                this.evaluateEditor.on('change', (cm) => cm.save());
            }

            const activationCodeTextarea = html.find('textarea[name="activationCode"]')[0];
            if (activationCodeTextarea) {
                this.codeEditor = CodeMirror.fromTextArea(activationCodeTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    indentUnit: 4,
                    smartIndent: true
                });
                this.codeEditor.on('change', (cm) => cm.save());
            }

            const refreshEditors = () => {
                if (this.evaluateEditor) this.evaluateEditor.refresh();
                if (this.codeEditor) this.codeEditor.refresh();
            };

            activationTypeSelect.on('change', () => {
                setTimeout(refreshEditors, 50);
            });

            setTimeout(refreshEditors, 100);
        }

        html.find('.find-item-btn').on('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openItemBrowser(lidInput, pathInput, updatePreview, previewContainer);
        });
    }

    async _openItemBrowser(lidInput, pathInput, updatePreview, previewContainer) {
        const items = [];
        for (const pack of game.packs) {
            if (pack.documentName !== "Item") continue;
            const index = await pack.getIndex({ fields: ["system.lid", "type"] });
            for (const entry of index) {
                if (entry.system?.lid) {
                    items.push({
                        name: entry.name,
                        lid: entry.system.lid,
                        type: entry.type,
                        uuid: entry.uuid
                    });
                }
            }
        }

        items.sort((a, b) => a.name.localeCompare(b.name));

        const itemListHtml = items.map(item =>
            `<div class="item-browser-entry" data-lid="${item.lid}" data-uuid="${item.uuid}" style="padding: 4px 8px; cursor: pointer; border-bottom: 1px solid #333;">
                <strong>${item.name}</strong> <span style="color: #888; font-size: 0.85em;">(${item.type})</span>
            </div>`
        ).join('');

        const selectedItem = await new Promise((resolve) => {
            new Dialog({
                title: "Find Item",
                content: `
                    <div style="margin-bottom: 8px;">
                        <input type="text" id="item-search" placeholder="Search by name..." style="width: 100%;">
                    </div>
                    <div id="item-list" style="max-height: 300px; overflow-y: auto; border: 1px solid #333;">
                        ${itemListHtml}
                    </div>
                `,
                buttons: {
                    cancel: { label: "Cancel", callback: () => resolve(null) }
                },
                render: (html) => {
                    const searchInput = html.find('#item-search');
                    const listContainer = html.find('#item-list');

                    searchInput.on('input', () => {
                        const query = searchInput.val().toLowerCase();
                        listContainer.find('.item-browser-entry').each((i, el) => {
                            const name = $(el).find('strong').text().toLowerCase();
                            $(el).toggle(name.includes(query));
                        });
                    });

                    listContainer.on('click', '.item-browser-entry', (ev) => {
                        const entry = $(ev.currentTarget);
                        resolve({
                            lid: entry.data('lid'),
                            uuid: entry.data('uuid')
                        });
                        html.closest('.dialog').find('.header-button.close').click();
                    });
                },
                default: "cancel"
            }, { width: 400 }).render(true);
        });

        if (!selectedItem) return;

        const item = await fromUuid(selectedItem.uuid);
        if (!item) return;

        const actions = [];

        if (item.type === "npc_feature") {
            if (item.system?.trigger) {
                actions.push({ name: item.name, path: "", isDefault: true });
            }
            if (item.system?.actions) {
                item.system.actions.forEach((action, idx) => {
                    actions.push({ name: action.name || `Action ${idx + 1}`, path: `actions[${idx}]` });
                });
            }
        } else {
            if (item.system?.ranks) {
                item.system.ranks.forEach((rank, rIdx) => {
                    if (rank.actions) {
                        rank.actions.forEach((action, aIdx) => {
                            actions.push({
                                name: `${action.name || 'Action'} (Rank ${rIdx + 1})`,
                                path: `ranks[${rIdx}].actions[${aIdx}]`
                            });
                        });
                    }
                });
            }
            if (item.system?.profiles) {
                item.system.profiles.forEach((profile, pIdx) => {
                    if (profile.actions) {
                        profile.actions.forEach((action, aIdx) => {
                            actions.push({
                                name: `${action.name || 'Action'} (Profile: ${profile.name || pIdx + 1})`,
                                path: `profiles[${pIdx}].actions[${aIdx}]`
                            });
                        });
                    }
                });
            }
            if (item.system?.actions) {
                item.system.actions.forEach((action, idx) => {
                    actions.push({ name: action.name || `Action ${idx + 1}`, path: `actions[${idx}]` });
                });
            }
        }

        if (actions.length === 0) {
            actions.push({ name: item.name, path: "", isDefault: true });
        }

        let selectedPath = "";
        if (actions.length === 1) {
            selectedPath = actions[0].path;
        } else {
            const actionListHtml = actions.map((action, idx) =>
                `<div class="action-browser-entry" data-path="${action.path}" style="padding: 6px 8px; cursor: pointer; border-bottom: 1px solid #333;">
                    ${action.name}${action.isDefault ? ' <em>(default)</em>' : ''}<br>
                    <span style="color: #888; font-size: 0.8em;">Path: ${action.path || '(empty)'}</span>
                </div>`
            ).join('');

            selectedPath = await new Promise((resolve) => {
                new Dialog({
                    title: `Select Action from ${item.name}`,
                    content: `
                        <div style="max-height: 300px; overflow-y: auto; border: 1px solid #333;">
                            ${actionListHtml}
                        </div>
                    `,
                    buttons: {
                        cancel: { label: "Cancel", callback: () => resolve(null) }
                    },
                    render: (html) => {
                        html.find('.action-browser-entry').on('click', (ev) => {
                            resolve($(ev.currentTarget).data('path'));
                            html.closest('.dialog').find('.header-button.close').click();
                        });
                    },
                    default: "cancel"
                }, { width: 350 }).render(true);
            });

            if (selectedPath === null) return;
        }

        lidInput.val(selectedItem.lid);
        pathInput.val(selectedPath);

        await updatePreview();
    }

    _getTriggerOptions(selected) {
        const options = [
            "onAttack", "onHit", "onMiss", "onDamage",
            "onMove",
            "onTurnStart", "onTurnEnd",
            "onStatusApplied", "onStatusRemoved",
            "onStructure", "onStress", "onHeat", "onDestroyed",
            "onTechAttack", "onTechHit", "onTechMiss",
            "onCheck",
            "onActivation", "onHPRestored", "onHpLoss", "onClearHeat"
        ];
        return options.reduce((obj, trigger) => {
            obj[trigger] = selected.includes(trigger);
            return obj;
        }, {});
    }

    async _updateObject(event, formData) {
        const isGeneral = formData.isGeneral === true;

        const triggers = [];
        for (const [key, value] of Object.entries(formData)) {
            if (key.startsWith("trigger.") && value) {
                triggers.push(key.replace("trigger.", ""));
            }
        }

        const dispositionFilter = [];
        if (formData['dispositionFilter.friendly']) dispositionFilter.push('friendly');
        if (formData['dispositionFilter.neutral']) dispositionFilter.push('neutral');
        if (formData['dispositionFilter.hostile']) dispositionFilter.push('hostile');
        if (formData['dispositionFilter.secret']) dispositionFilter.push('secret');

        if (isGeneral) {
            const name = formData.name;
            if (!name) return ui.notifications.error("Activation Name is required for general activations");

            const newReaction = {
                triggers: triggers,
                evaluate: formData.evaluate,
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Reaction",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true,
                autoActivate: formData.autoActivate === true,
                onlyOnSourceMatch: formData.onlyOnSourceMatch === true,
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                triggerSelf: formData.triggerSelf === true,
                triggerOther: formData.triggerOther === true,
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            await ReactionManager.saveGeneralReaction(name, newReaction);
        } else {
            const lid = formData.lid;
            if (!lid) return ui.notifications.error("Item LID is required");

            const newReaction = {
                reactionPath: formData.reactionPath || "",
                triggers: triggers,
                evaluate: formData.evaluate,
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Reaction",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true,
                autoActivate: formData.autoActivate === true,
                onlyOnSourceMatch: formData.onlyOnSourceMatch === true,
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                triggerSelf: formData.triggerSelf === true,
                triggerOther: formData.triggerOther === true,
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);

            if (!userReactions[lid]) {
                userReactions[lid] = { itemType: "any", reactions: [] };
            }

            const index = formData.reactionIndex;
            if (index !== undefined && index !== null && index !== "") {
                if (userReactions[lid].reactions[index]) {
                    userReactions[lid].reactions[index] = newReaction;
                } else {
                    userReactions[lid].reactions.push(newReaction);
                }
            } else {
                userReactions[lid].reactions.push(newReaction);
            }

            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userReactions);
        }

        Object.values(ui.windows).forEach(w => {
            if (w.id === "reaction-manager-config") w.render();
        });
    }
}
