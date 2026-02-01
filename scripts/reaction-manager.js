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
            name: "Custom Reactions",
            hint: "Define custom reactions for items.",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, {
            name: "General Reactions",
            hint: "Define reactions that apply to all tokens.",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.registerMenu(ReactionManager.ID, "reactionConfig", {
            name: "Reaction Manager",
            label: "Open Reaction Manager",
            hint: "Configure custom reactions and triggers.",
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
            title: "Reaction Manager",
            id: "reaction-manager-config",
            template: `modules/lancer-reactionChecker/templates/reaction-config.html`,
            width: 800,
            height: 700,
            resizable: true,
            tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "custom" }]
        });
    }

    getData() {
        const userItemSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const userGeneralSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const defaultGeneralRegistry = getDefaultGeneralReactionRegistry();
        const defaultItemRegistry = getDefaultItemReactionRegistry();

        const defaultList = [];
        const allReactions = [];

        // Helper to ensure enabled defaults to true
        const startEnabled = (r) => {
            if (r.enabled === undefined) r.enabled = true;
            return r;
        };

        const isPureDefault = (saved, def) => {
            if (!saved || !def) return false;
            const s = foundry.utils.deepClone(saved);
            const d = foundry.utils.deepClone(def);
            delete s.enabled;
            delete d.enabled;
            return foundry.utils.objectsEqual(s, d);
        };

        // 1. Process ITEM reactions
        // Add User Customized Items
        for (const [lid, data] of Object.entries(userItemSettings)) {
            data.reactions.forEach((reaction, index) => {
                const defItem = defaultItemRegistry[lid]?.reactions?.find(r => r.name === reaction.name);
                if (defItem && isPureDefault(reaction, defItem)) return;

                allReactions.push(startEnabled({
                    lid: lid,
                    name: reaction.name || lid,
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
        // Add Default Items
        for (const [lid, data] of Object.entries(defaultItemRegistry)) {
            data.reactions.forEach((reaction, index) => {
                // Try to find matching user entry by name or index? Name is safer for defaults.
                const userEntry = userItemSettings[lid]?.reactions?.find(r => r.name === reaction.name);
                const isPure = isPureDefault(userEntry, reaction);
                const isOverridden = !!userEntry && !isPure;
                const enabledState = isPure ? userEntry.enabled : reaction.enabled;

                defaultList.push(startEnabled({
                    lid: lid,
                    name: reaction.name || lid,
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

        // 2. Process GENERAL reactions
        // Add User Customized Generals
        for (const [name, reaction] of Object.entries(userGeneralSettings)) {
            const def = defaultGeneralRegistry[name];
            if (def && isPureDefault(reaction, def)) continue;

            allReactions.push(startEnabled({
                name: name,
                lid: null,
                triggers: reaction.triggers?.join(", ") || "",
                isGeneral: true,
                isCustom: true,
                original: reaction,
                enabled: reaction.enabled
            }));
        }
        // Add Default Generals
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
            title: "Reaction Manager Help",
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
                const defaults = getDefaultGeneralReactionRegistry();
                if (defaults[name]) {
                    userSaved[name] = foundry.utils.deepClone(defaults[name]);
                    userSaved[name].enabled = checked;
                }
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
                    userItemSettings[lid] = foundry.utils.deepClone(defaults[lid]);
                    if (userItemSettings[lid].reactions?.[index]) {
                        userItemSettings[lid].reactions[index].enabled = checked;
                    }
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
            title: "Edit Reaction",
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
            onAttack: "{ attacker, weapon, targets, attackType, attackName, tags, distance }",
            onHit: "{ attacker, weapon, target, roll, isCrit, attackType, attackName, tags, distance }",
            onMiss: "{ attacker, weapon, target, roll, attackType, attackName, tags, distance }",
            onDamage: "{ attacker, weapon, target, damages, types, isCrit, attackType, attackName, tags, distance }",
            onMove: "{ mover, distance, elevation, startPos, endPos }",
            onTurnStart: "{ token, distance }",
            onTurnEnd: "{ token, distance }",
            onStatusApplied: "{ token, statusId, effect, distance }",
            onStatusRemoved: "{ token, statusId, effect, distance }",
            onStructure: "{ token, remainingStructure, rollResult, distance }",
            onStress: "{ token, remainingStress, rollResult, distance }",
            onHeat: "{ token, heatGained, currentHeat, inDangerZone, distance }",
            onDestroyed: "{ token, distance }",
            onTechAttack: "{ attacker, techItem, targets, attackName, isInvade, tags, distance }",
            onTechHit: "{ attacker, techItem, target, roll, attackName, isInvade, tags, distance }",
            onTechMiss: "{ attacker, techItem, target, roll, attackName, isInvade, tags, distance }",
            onCheck: "{ token, statName, roll, total, success, distance }",
            onReaction: "{ token, reactionName, reactionItem, distance }",
            onHPRestored: "{ token, hpRestored, currentHP, maxHP, distance }",
            onHpLoss: "{ token, hpLost, currentHP, distance }",
            onClearHeat: "{ token, heatCleared, currentHeat, distance }"
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
            triggers: this._getTriggerOptions(reaction.triggers || []),
            evaluate: reaction.evaluate?.toString() || "return true;",
            triggerHelp: triggerHelp,
            activationType: reaction.activationType || "none",
            activationMode: reaction.activationMode || "after",
            activationMacro: reaction.activationMacro || "",
            activationCode: reaction.activationCode || "",
            reactionIndex: data.reactionIndex
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

        // Toggle activation type fields
        const activationTypeSelect = html.find('#activationType');
        const macroFields = html.find('.activation-macro');
        const codeFields = html.find('.activation-code');

        const toggleActivationFields = () => {
            const type = activationTypeSelect.val();
            macroFields.toggle(type === 'macro');
            codeFields.toggle(type === 'code');
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

        const updatePreview = async () => {
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

            // Resolve action name
            let foundActionName = null;
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
                    }
                }
            } catch (e) {
                console.warn("lancer-reactionChecker | Error resolving action name:", e);
            }

            // Update UI
            previewItemName.html(`<strong>Item:</strong> ${foundItemName}`);
            if (foundActionName && foundActionName !== foundItemName) {
                if (previewActionName.length) {
                    previewActionName.html(`<strong>Action:</strong> ${foundActionName}`).show();
                } else {
                    previewItemName.after(`<span id="preview-action-name" style="margin-left: 10px;"><strong>Action:</strong> ${foundActionName}</span>`);
                }
            } else {
                previewActionName.hide();
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
            "onReaction", "onHPRestored", "onHpLoss", "onClearHeat"
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
            if (!name) return ui.notifications.error("Reaction Name is required for general reactions");

            const newReaction = {
                triggers: triggers,
                evaluate: formData.evaluate,
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.isReaction === true || formData.isReaction === "on",
                activationType: formData.activationType || "none",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || ""
            };

            await ReactionManager.saveGeneralReaction(name, newReaction);
        } else {
            const lid = formData.lid;
            if (!lid) return ui.notifications.error("Item LID is required");

            const newReaction = {
                reactionPath: formData.reactionPath || "system.trigger",
                triggers: triggers,
                evaluate: formData.evaluate,
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.isReaction === true || formData.isReaction === "on",
                activationType: formData.activationType || "none",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || ""
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
