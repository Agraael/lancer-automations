/*global game, FormApplication, mergeObject, foundry, TextEditor */

import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";

/**
 * Manages the reaction data, merging default registry with user configurations.
 */
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
}

/**
 * UI for managing custom reactions
 */
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

        // Collect all LIDs to look up
        const midsToLookup = new Set([
            ...Object.keys(userItemSettings).map(k => k.trim()),
            ...Object.keys(defaultItemRegistry).map(k => k.trim())
        ]);

        // Bulk lookup items
        const itemMap = new Map(); // lid -> { name: string, system: object }

        // Optimize: scan compendiums for these LIDs
        // This can be heavy, so we try to be efficient
        for (const pack of game.packs) {
            if (pack.documentName !== "Item") continue;
            // Only query packs if we have LIDs to find
            if (midsToLookup.size === 0) break;

            const index = await pack.getIndex({ fields: ["system.lid"] });
            for (const entry of index) {
                if (entry.system?.lid && midsToLookup.has(entry.system.lid)) {
                    // We found an item. We need its full data to resolve action names via path
                    // But loading all might be too slow. For now let's just get the Item Name from index
                    // If we really need action name, we'd need to load the doc. 
                    // Let's try to load the doc if the user requested it.
                    const itemDoc = await fromUuid(entry.uuid);
                    if (itemDoc) {
                        itemMap.set(entry.system.lid, {
                            name: itemDoc.name,
                            system: itemDoc.system
                        });
                        midsToLookup.delete(entry.system.lid); // Found it
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
            // If saved only has 'enabled' property, it's a pure default with just the toggle state
            const savedKeys = Object.keys(saved);
            if (savedKeys.length === 1 && savedKeys[0] === 'enabled') return true;
            // Otherwise compare the full objects minus enabled
            const s = foundry.utils.deepClone(saved);
            const d = foundry.utils.deepClone(def);
            delete s.enabled;
            delete d.enabled;
            return foundry.utils.objectsEqual(s, d);
        };

        for (const [rawLid, data] of Object.entries(userItemSettings)) {
            const lid = rawLid.trim();
            data.reactions.forEach((reaction, index) => {
                // Skip minimal entries (only have 'enabled') - they're shown in defaults tab
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
                // Look up by index first (for minimal enabled-only entries), then by name
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
                useActionName: reaction.useActionName || false,
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
                useActionName: reaction.useActionName || false,
                original: reaction,
                enabled: enabledState
            }));
        }

        // Sort: Generals first (descending isGeneral), then Name
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
            <p>Each reaction can be either <strong>General</strong> (global) or <strong>Item-based</strong>.</p>
            <p>A reaction listens for a specific <strong>Trigger</strong> (e.g., <code>onDamage</code> fires when a token deals damage).</p>
            <hr>
            <p>Reactions are checked for every token in combat. If a token has the reaction available, the <strong>Evaluation Function</strong> is executed.</p>
            <p>If the evaluation returns <code>true</code>, the reaction triggers and appears in the popup window.</p>
            <p><em>(Note: Different data is passed to the evaluation function depending on the trigger type.)</em></p>
            <hr>
            <p>You can also execute <strong>Macros</strong> or plain <strong>JS Code</strong> when activating the reaction from the popup.</p>
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

            // Use index if available, otherwise 0 fallback
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
        const index = li.data("index"); // Might be useful if default has multiple

        if (isGeneral) {
            // Copy from getDefaultGeneralReactionRegistry
            const defaultReaction = getDefaultGeneralReactionRegistry()[name];
            if (!defaultReaction) return;
            const reaction = foundry.utils.deepClone(defaultReaction);
            new ReactionEditor({ isGeneral: true, name, reaction }).render(true);
        } else {
            // Copy from item-based registry
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry) return;
            // Use index if available, otherwise 0
            const reactionIndex = (typeof index !== 'undefined') ? index : 0;
            const reaction = foundry.utils.deepClone(entry.reactions[reactionIndex]);
            new ReactionEditor({ isGeneral: false, lid, reaction }).render(true); // Don't pass index here, we want to create NEW custom
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
                // Only store enabled state for defaults, not the full clone
                // This keeps it as a "pure default" that just has enabled toggled
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
                    // Only store enabled state for defaults
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

/**
 * Editor for a single reaction
 */
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
            // Search compendiums for the LID
            for (const pack of game.packs) {
                // Focus on Lancer packs if possible to optimize, or just check all Item packs
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

        // Resolve action name based on reactionPath
        let foundActionName = null;
        const reactionPath = reaction.reactionPath || "";

        if (foundItemUuid) {
            try {
                const item = await fromUuid(foundItemUuid);
                if (item) {
                    if (!reactionPath || reactionPath === "system" || reactionPath === "") {
                        // NPC item - action name is the item name itself
                        foundActionName = item.name;
                    } else {
                        // Player item - navigate to system.{reactionPath} to get action
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
                        // If we found an action object with a name, use it
                        if (actionData && actionData.name) {
                            foundActionName = actionData.name;
                        } else {
                            // Fallback to item name
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
            triggerOther: reaction.triggerOther !== false, // Default to true
            outOfCombat: reaction.outOfCombat === true, // Default to false
            autoActivate: reaction.autoActivate || false,
            useActionName: reaction.useActionName || false, // For general reactions
            triggers: this._getTriggerOptions(reaction.triggers || []),
            evaluate: reaction.evaluate?.toString() || "return true;",
            triggerHelp: triggerHelp,
            activationType: reaction.activationType || "flow",
            activationMode: reaction.activationMode || "after",
            activationMacro: reaction.activationMacro || "",
            activationCode: typeof reaction.activationCode === 'function' ? reaction.activationCode.toString() : (reaction.activationCode || ""),
            reactionIndex: data.reactionIndex,
            // New Action Type Logic
            actionType: reaction.actionType || (reaction.isReaction !== false ? "Reaction" : "Free Action"),
            consumesReaction: reaction.consumesReaction !== false, // Defaults to true
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

        // Toggle Action-Based mode for General reactions
        const useActionNameCheckbox = html.find('#useActionName');
        const triggerCheckboxes = html.find('input[name^="trigger."]');

        // Triggers that support action names
        const actionNameTriggers = [
            'onAttack', 'onHit', 'onMiss', 'onDamage',
            'onTechAttack', 'onTechHit', 'onTechMiss', 'onActivation'
        ];

        const toggleActionBasedTriggers = () => {
            const isActionBased = useActionNameCheckbox.prop('checked');

            triggerCheckboxes.each(function () {
                const triggerName = $(this).attr('name').replace('trigger.', '');
                const isCompatible = actionNameTriggers.includes(triggerName);

                if (isActionBased && !isCompatible) {
                    // Disable and uncheck incompatible triggers
                    $(this).prop('disabled', true);
                    $(this).prop('checked', false);
                    $(this).closest('label').css('opacity', '0.5');
                } else {
                    // Enable all triggers
                    $(this).prop('disabled', false);
                    $(this).closest('label').css('opacity', '1');
                }
            });
        };

        useActionNameCheckbox.on('change', toggleActionBasedTriggers);
        toggleActionBasedTriggers();

        // Toggle activation type fields
        const activationTypeSelect = html.find('#activationType');
        const activationModeSelect = html.find('#activationMode');
        const macroFields = html.find('.activation-macro');
        const codeFields = html.find('.activation-code');

        const toggleActivationFields = () => {
            const type = activationTypeSelect.val();
            macroFields.toggle(type === 'macro');
            codeFields.toggle(type === 'code');
            // Show activation mode only for macro and code
            activationModeSelect.toggle(type === 'macro' || type === 'code');
        };

        activationTypeSelect.on('change', toggleActivationFields);
        toggleActivationFields();

        // Show Item Button
        html.find('.show-item-btn').on('click', async (ev) => {
            ev.preventDefault();
            const uuid = $(ev.currentTarget).data('uuid');
            if (uuid) {
                const item = await fromUuid(uuid);
                if (item) item.sheet.render(true);
            }
        });

        // Dynamic preview update on LID or Action Path change
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
                // If not a reaction, it shouldn't consume a reaction resource by default
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

            // Search for item in compendiums
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

            // Resolve action name, type and frequency
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

                        // Auto-detect action type from activation
                        const activation = actionData?.activation;
                        if (activation) {
                            if (activation === "Quick") detectedActionType = "Quick Action";
                            else if (activation === "Full") detectedActionType = "Full Action";
                            else if (activation === "Reaction") detectedActionType = "Reaction";
                            else if (activation === "Free") detectedActionType = "Free Action";
                            else if (activation === "Protocol") detectedActionType = "Protocol";
                            else detectedActionType = activation;
                        }

                        // Attempt to detect frequency
                        if (actionData?.frequency) {
                            detectedFrequency = actionData.frequency;
                        } else if (item.system?.frequency) {
                            detectedFrequency = item.system.frequency;
                        } else if (item.system?.uses?.per) {
                            // E.g. 1/Scene -> we might map this?
                            // Standard Lancer uses "Scene", "Mission", "Round", "Combat"
                            const per = item.system.uses.per;
                            if (per === "Round") detectedFrequency = "1/Round";
                            else if (per === "Scene") detectedFrequency = "1/Scene";
                            else if (per === "Combat") detectedFrequency = "1/Combat";
                            else if (per === "Mission") detectedFrequency = "1/Mission"; // Not in our list but good to know
                        } else if (detectedActionType === "Reaction" || detectedActionType === "Free Action") {
                            // Default to 1/Round for reactions/free actions if not specified? 
                            detectedFrequency = "1/Round";
                        }
                    }
                }
            } catch (e) {
                console.warn("lancer-reactionChecker | Error resolving action name:", e);
            }

            // Update UI
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

            // Auto-select and highlight logic
            if (detectedActionType) {
                const options = ["Reaction", "Free Action", "Quick Action", "Full Action", "Protocol", "Other"];

                // Highlight options
                const $options = actionTypeSelect.find('option');
                $options.css('color', ''); // Reset
                $options.each(function () {
                    if ($(this).val() === detectedActionType) {
                        $(this).css({
                            'color': '#4caf50', // Green
                            'font-weight': 'bold'
                        });
                    }
                });

                // Auto-select the detected action type
                // We update it if it's currently on the default "Reaction" (and user hasn't likely changed it yet) 
                // OR if the preview update was triggered by a significant change (like changing path).
                // Given the user request "when action path is updated we need to update the action type", we force update.
                if (autoSelect && (options.includes(detectedActionType) || detectedActionType === "Other")) { // "Other" handling?
                    actionTypeSelect.val(options.includes(detectedActionType) ? detectedActionType : "Other");

                    // Trigger change event to update the conditional checkbox visibility
                    actionTypeSelect.trigger('change');
                }
            }

            // Auto-select and highlight logic for Frequency
            if (detectedFrequency) {
                const options = ["1/Round", "Unlimited", "1/Scene", "1/Combat", "Other"];
                // Highlight options
                const $options = frequencySelect.find('option');
                $options.css('color', ''); // Reset
                $options.each(function () {
                    if ($(this).val() === detectedFrequency) {
                        $(this).css({
                            'color': '#4caf50', // Green
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

        // Debounce to avoid too many requests
        let updateTimeout;
        const debouncedUpdate = () => {
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(updatePreview, 300);
        };

        lidInput.on('input', debouncedUpdate);
        pathInput.on('input', debouncedUpdate);

        // Initial update (highlight only)
        if (lidInput.val()) {
            updatePreview(false);
        }

        // Initialize CodeMirror if available
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

            // Handle tab switching refreshes
            // If CodeMirror is inside a tab that starts hidden, it needs a refresh when shown
            const refreshEditors = () => {
                if (this.evaluateEditor) this.evaluateEditor.refresh();
                if (this.codeEditor) this.codeEditor.refresh();
            };

            // Refresh on activationType change (since code fields toggle visibility)
            activationTypeSelect.on('change', () => {
                setTimeout(refreshEditors, 50);
            });

            // Also refresh initially
            setTimeout(refreshEditors, 100);
        }

        // Find Item Button - open item browser
        html.find('.find-item-btn').on('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openItemBrowser(lidInput, pathInput, updatePreview, previewContainer);
        });
    }

    async _openItemBrowser(lidInput, pathInput, updatePreview, previewContainer) {
        // Collect items from compendiums
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

        // Sort by name
        items.sort((a, b) => a.name.localeCompare(b.name));

        // Build item list HTML
        const itemListHtml = items.map(item =>
            `<div class="item-browser-entry" data-lid="${item.lid}" data-uuid="${item.uuid}" style="padding: 4px 8px; cursor: pointer; border-bottom: 1px solid #333;">
                <strong>${item.name}</strong> <span style="color: #888; font-size: 0.85em;">(${item.type})</span>
            </div>`
        ).join('');

        // Step 1: Select Item
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

        // Load the item to get its actions
        const item = await fromUuid(selectedItem.uuid);
        if (!item) return;

        // Collect actions from the item
        const actions = [];

        // For NPC features - direct system.trigger (no path needed)
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
            // For player items - check various paths
            // Talents: ranks[x].actions[y]
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
            // Weapons: profiles[x].actions[y] or just actions[x]
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
            // Direct actions
            if (item.system?.actions) {
                item.system.actions.forEach((action, idx) => {
                    actions.push({ name: action.name || `Action ${idx + 1}`, path: `actions[${idx}]` });
                });
            }
        }

        // If no actions found, just use empty path
        if (actions.length === 0) {
            actions.push({ name: item.name, path: "", isDefault: true });
        }

        // Step 2: Select Action (if multiple)
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

        // Apply to form fields
        lidInput.val(selectedItem.lid);
        pathInput.val(selectedPath);

        // Trigger preview update
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
        const isGeneral = formData.isGeneral === true || formData.isGeneral === "on";

        const triggers = [];
        for (const [key, value] of Object.entries(formData)) {
            if (key.startsWith("trigger.") && value) {
                triggers.push(key.replace("trigger.", ""));
            }
        }

        if (isGeneral) {
            const name = formData.name;
            if (!name) return ui.notifications.error("Activation Name is required for general activations");

            const newReaction = {
                triggers: triggers,
                evaluate: formData.evaluate,
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                // isReaction deprecated in favor of actionType, but keeping for backward compat if needed
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Reaction",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true || formData.consumesReaction === "on",
                autoActivate: formData.autoActivate === true || formData.autoActivate === "on",
                useActionName: formData.useActionName === true || formData.useActionName === "on",
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                triggerSelf: formData.triggerSelf === true || formData.triggerSelf === "on",
                triggerOther: formData.triggerOther === true || formData.triggerOther === "on",
                outOfCombat: formData.outOfCombat === true || formData.outOfCombat === "on"
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
                // isReaction deprecated in favor of actionType
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Reaction",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true || formData.consumesReaction === "on",
                autoActivate: formData.autoActivate === true || formData.autoActivate === "on",
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                triggerSelf: formData.triggerSelf === true || formData.triggerSelf === "on",
                triggerOther: formData.triggerOther === true || formData.triggerOther === "on",
                outOfCombat: formData.outOfCombat === true || formData.outOfCombat === "on"
            };

            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);

            if (!userReactions[lid]) {
                userReactions[lid] = { itemType: "any", reactions: [] };
            }

            // Check if we are updating a specific index
            const index = formData.reactionIndex;
            if (index !== undefined && index !== null && index !== "") {
                if (userReactions[lid].reactions[index]) {
                    userReactions[lid].reactions[index] = newReaction;
                } else {
                    userReactions[lid].reactions.push(newReaction); // Fallback
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
