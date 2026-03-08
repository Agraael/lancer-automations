/*global game, FormApplication, mergeObject, foundry, TextEditor */

import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";
import { openItemBrowserDialog } from "./misc-tools.js";

const scriptCache = new Map();

export function clearScriptCache() {
    console.log("lancer-automations | Clearing script compilation cache.");
    scriptCache.clear();
    Hooks.callAll('lancer-automations.clearCaches');
}

export function stringToFunction(str, args = [], reaction = null) {
    const trimmed = str.trim();
    const cacheKey = `${trimmed}|${args.join(',')}`;
    if (scriptCache.has(cacheKey)) {
        return scriptCache.get(cacheKey);
    }

    let fn;
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('(')) {
        fn = eval(`(${trimmed})`);
    } else {
        fn = new Function(...args, trimmed);
    }
    if (fn.constructor.name === 'AsyncFunction') {
        const blockingKeywords = ['injectBonusToNextRoll', 'changeTriggeredMove', 'cancelTriggeredMove', 'cancelChange', 'cancelAction', 'cancelAttack', 'cancelTechAttack', 'cancelCheck'];
        const foundKeywords = blockingKeywords.filter(k => trimmed.includes(k));

        const sensitiveTriggers = ['onPreMove', 'onInitAttack', 'onInitCheck', 'onInitActivation', 'onPreStatusApplied', 'onPreStatusRemoved'];
        const foundTriggers = reaction?.triggers?.filter(t => sensitiveTriggers.includes(t)) || [];

        const isForceSync = reaction?.forceSynchronous;

        if ((foundKeywords.length > 0 || foundTriggers.length > 0) && !isForceSync) {
            let reason = "";
            if (foundKeywords.length > 0) {
                reason += `uses blocking logic (${foundKeywords.join(', ')})`;
            }
            if (foundTriggers.length > 0) {
                reason += (reason ? " and " : "") + `is associated with sensitive triggers (${foundTriggers.join(', ')})`;
            }

            ui.notifications.warn(`lancer-automations | Evaluation for "${reaction?.name || 'Activation'}" is async and ${reason} without "Force Synchronous". This will likely fail to block movement or timing-sensitive bonuses.`, {permanent: true});
        }
    }
    scriptCache.set(cacheKey, fn);
    return fn;
}

export function stringToAsyncFunction(str, args = [], name = "lancer-automations-dynamic-script") {
    const trimmed = str.trim();
    const cacheKey = `async|${trimmed}|${args.join(',')}|${name}`;
    if (scriptCache.has(cacheKey)) {
        return scriptCache.get(cacheKey);
    }

    // Sanitize name for sourceURL (no spaces, alphanumeric/dashes)
    const sanitizedName = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const sourcePath = `modules/lancer-automations/dynamic/${sanitizedName}.js`;
    const codeWithSourceURL = trimmed + `\n\n//# sourceURL=${sourcePath}`;

    let fn;
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('(')) {
        fn = eval(`(${codeWithSourceURL})`);
    } else {
        const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor;
        fn = new AsyncFunction(...args, codeWithSourceURL);
    }
    scriptCache.set(cacheKey, fn);
    return fn;
}

export class ReactionManager {
    static get ID() {
        return "lancer-automations";
    }

    static get SETTING_REACTIONS() {
        return "customReactions";
    }

    static get SETTING_GENERAL_REACTIONS() {
        return "generalReactions";
    }

    static get SETTING_FOLDERS() {
        return "activationFolders";
    }

    static get SETTING_STARTUP_SCRIPTS() {
        return "startupScripts";
    }

    static builtinStartups = [];

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

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_FOLDERS, {
            name: "Activation Folders",
            hint: "Folder assignments for custom activations.",
            scope: "world",
            config: false,
            type: Array,
            default: []
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, {
            name: "Startup Scripts",
            hint: "JS scripts that run on module ready.",
            scope: "world",
            config: false,
            type: Array,
            default: []
        });

        game.settings.register(ReactionManager.ID, "enableLaSossisItems", {
            name: "LaSossis's Items",
            hint: "Those are the item activations i made for myself, it wil create a startup script that registers them as default item activations.",
            scope: "world",
            config: true,
            type: Boolean,
            default: false,
            requiresReload: true
        });
    }

    static getFolders() {
        return game.settings.get(ReactionManager.ID, ReactionManager.SETTING_FOLDERS) || [];
    }

    static async saveFolders(folders) {
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_FOLDERS, folders);
    }

    static getStartupScripts() {
        return game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
    }

    static async saveStartupScripts(scripts) {
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, scripts);
    }

    static async createFolder(name) {
        const folders = ReactionManager.getFolders();
        if (folders.find(f => f.name === name))
            return;
        folders.push({ name: name, items: [] });
        await ReactionManager.saveFolders(folders);
    }

    static async renameFolder(oldName, newName) {
        const folders = ReactionManager.getFolders();
        const folder = folders.find(f => f.name === oldName);
        if (folder)
            folder.name = newName;
        await ReactionManager.saveFolders(folders);
    }

    static async deleteFolder(name) {
        let folders = ReactionManager.getFolders();
        folders = folders.filter(f => f.name !== name);
        await ReactionManager.saveFolders(folders);
    }

    static async assignToFolder(folderName, activationKey) {
        const folders = ReactionManager.getFolders();
        // Remove from any existing folder first
        for (const f of folders) {
            f.items = f.items.filter(k => k !== activationKey);
        }
        const target = folders.find(f => f.name === folderName);
        if (target)
            target.items.push(activationKey);
        await ReactionManager.saveFolders(folders);
    }

    static async unassignFromFolder(activationKey) {
        const folders = ReactionManager.getFolders();
        for (const f of folders) {
            f.items = f.items.filter(k => k !== activationKey);
        }
        await ReactionManager.saveFolders(folders);
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

        const result = {};
        for (const [name, def] of Object.entries(defaults)) {
            const saved = userSaved[name];
            if (!saved) {
                result[name] = def;
            } else if (Array.isArray(def.reactions) && Array.isArray(saved.reactions)) {
                // Group: apply per-sub enabled states without overriding function code
                result[name] = {
                    ...def,
                    reactions: def.reactions.map((r, i) => {
                        const savedSub = saved.reactions[i];
                        return savedSub?.enabled !== undefined ? { ...r, enabled: savedSub.enabled } : r;
                    })
                };
            } else {
                result[name] = { ...def, ...saved };
            }
        }
        // User-created general reactions not in defaults
        for (const [name, saved] of Object.entries(userSaved)) {
            if (!(name in defaults))
                result[name] = saved;
        }
        return result;
    }

    static getGeneralReaction(name) {
        const generals = ReactionManager.getGeneralReactions();
        return generals[name];
    }

    static async saveGeneralReaction(name, reaction) {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        userSaved[name] = reaction;
        clearScriptCache();
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
    }

    static async deleteGeneralReaction(name) {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        if (userSaved[name]) {
            delete userSaved[name];
            clearScriptCache();
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
                    clearScriptCache();

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
    constructor(object, options) {
        super(object, options);
        this._needsReload = false;
    }
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Activation Manager",
            id: "reaction-manager-config",
            classes: [...super.defaultOptions.classes, "lancer-no-title"],
            template: `modules/lancer-automations/templates/reaction-config.html`,
            width: 800,
            height: 850,
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

        // 1. Check World Items (Instant)
        for (const item of game.items) {
            const lid = item.system?.lid;
            if (lid && midsToLookup.has(lid)) {
                itemMap.set(lid, {
                    name: item.name,
                    system: item.system
                });
                midsToLookup.delete(lid);
            }
        }

        // 2. Check Compendiums in Parallel (Cold Load Optimization)
        if (midsToLookup.size > 0) {
            const itemPacks = game.packs.filter(p => p.documentName === "Item");
            const indices = await Promise.all(itemPacks.map(pack => pack.getIndex({
                fields: ["system.lid", "system.actions", "system.ranks", "system.profiles"]
            })));

            for (const index of indices) {
                if (midsToLookup.size === 0) {
                    break;
                }
                for (const entry of index) {
                    const lid = entry.system?.lid;
                    if (lid && midsToLookup.has(lid)) {
                        itemMap.set(lid, {
                            name: entry.name,
                            system: entry.system
                        });
                        midsToLookup.delete(lid);
                        if (midsToLookup.size === 0) {
                            break;
                        }
                    }
                }
            }
        }

        const resolveActionName = (itemData, path) => {
            if (!itemData || !path || path === "system.trigger" || path === "system")
                return null;
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
            if (r.enabled === undefined)
                r.enabled = true;
            return r;
        };

        const isPureDefault = (saved, def) => {
            if (!saved || !def)
                return false;
            const savedKeys = Object.keys(saved);
            if (savedKeys.length === 1 && savedKeys[0] === 'enabled')
                return true;
            const s = foundry.utils.deepClone(saved);
            const d = foundry.utils.deepClone(def);
            delete s.enabled;
            delete d.enabled;
            return foundry.utils.objectsEqual(s, d);
        };

        // GROUPING LOGIC FOR CUSTOM ITEMS
        for (const [rawLid, data] of Object.entries(userItemSettings)) {
            const lid = rawLid.trim();
            const validReactions = [];

            data.reactions.forEach((reaction, index) => {
                const reactionKeys = Object.keys(reaction);
                if (reactionKeys.length === 1 && reactionKeys[0] === 'enabled')
                    return;

                const defItem = defaultItemRegistry[lid]?.reactions?.find(r => r.name === reaction.name);
                if (defItem && isPureDefault(reaction, defItem))
                    return;

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

                validReactions.push(startEnabled({
                    lid: rawLid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: reaction.reactionPath,
                    triggers: [...(reaction.triggers || []), ...(reaction.onInit ? ["onInit"] : [])].join(", "),
                    isCustom: true,
                    isGeneral: false,
                    reactionIndex: index,
                    original: reaction,
                    enabled: reaction.enabled,
                    comments: reaction.comments || ""
                }));
            });

            if (validReactions.length === 0)
                continue;

            if (validReactions.length === 1) {
                allReactions.push(validReactions[0]);
            } else {
                const first = validReactions[0];
                const uniqueTriggers = [...new Set(validReactions.flatMap(r => r.triggers.split(", ")))].filter(t => t).join(", ");
                const itemInfo = itemMap.get(lid);
                const groupName = itemInfo ? itemInfo.name : first.name.split(':')[0].trim();

                allReactions.push({
                    lid: lid,
                    name: groupName,
                    subname: first.subname,
                    triggers: uniqueTriggers,
                    isCustom: true,
                    isGeneral: false,
                    isGroup: true,
                    reactions: validReactions,
                    enabled: validReactions.every(r => r.enabled)
                });
            }
        }

        // GROUPING LOGIC FOR DEFAULTS (ITEMS)
        for (const [lid, data] of Object.entries(defaultItemRegistry)) {
            const validReactions = [];
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

                validReactions.push(startEnabled({
                    lid: lid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: reaction.reactionPath,
                    triggers: [...(reaction.triggers || []), ...(reaction.onInit ? ["onInit"] : [])].join(", "),
                    isGeneral: false,
                    isDefault: true,
                    isOverridden: isOverridden,
                    reactionIndex: index,
                    original: reaction,
                    enabled: enabledState,
                    category: data.category || "",
                    comments: reaction.comments || ""
                }));
            });

            if (validReactions.length === 0)
                continue;

            if (validReactions.length === 1) {
                defaultList.push(validReactions[0]);
            } else {
                const first = validReactions[0];
                const uniqueTriggers = [...new Set(validReactions.flatMap(r => r.triggers.split(", ")))].filter(t => t).join(", ");
                const itemInfo = itemMap.get(lid);
                const groupName = itemInfo ? itemInfo.name : first.name.split(':')[0].trim();

                defaultList.push({
                    lid: lid,
                    name: groupName,
                    subname: first.subname,
                    triggers: uniqueTriggers,
                    isGeneral: false,
                    isDefault: true,
                    isGroup: true,
                    reactions: validReactions,
                    enabled: validReactions.every(r => r.enabled),
                    category: data.category || ""
                });
            }
        }

        // GROUPING LOGIC FOR GENERAL REACTIONS (CUSTOM)
        for (const [name, reaction] of Object.entries(userGeneralSettings)) {
            const def = defaultGeneralRegistry[name];
            if (def && isPureDefault(reaction, def))
                continue;

            allReactions.push(startEnabled({
                name: name,
                lid: null,
                triggers: [...(reaction.triggers || []), ...(reaction.onInit ? ["onInit"] : [])].join(", "),
                isGeneral: true,
                isCustom: true,
                onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
                original: reaction,
                enabled: reaction.enabled,
                comments: reaction.comments || ""
            }));
        }

        // GROUPING LOGIC FOR GENERAL REACTIONS (DEFAULTS)
        for (const [name, reaction] of Object.entries(defaultGeneralRegistry)) {
            const userSaved = userGeneralSettings[name];

            if (Array.isArray(reaction.reactions)) {
                const validReactions = reaction.reactions.map((subReaction, index) => {
                    const enabledState = userSaved?.reactions?.[index]?.enabled ?? subReaction.enabled ?? reaction.enabled;
                    return startEnabled({
                        name: name,
                        lid: null,
                        triggers: [...(subReaction.triggers || []), ...(subReaction.onInit ? ["onInit"] : [])].join(", "),
                        isGeneral: true,
                        isDefault: true,
                        isOverridden: false,
                        onlyOnSourceMatch: subReaction.onlyOnSourceMatch || false,
                        reactionIndex: index,
                        original: subReaction,
                        enabled: enabledState,
                        category: reaction.category || "",
                        comments: subReaction.comments || ""
                    });
                });

                if (validReactions.length === 1) {
                    defaultList.push(validReactions[0]);
                } else {
                    const uniqueTriggers = [...new Set(validReactions.flatMap(r => r.triggers.split(", ")))].filter(t => t).join(", ");
                    defaultList.push({
                        name: name,
                        lid: null,
                        triggers: uniqueTriggers,
                        isGeneral: true,
                        isDefault: true,
                        isGroup: true,
                        reactions: validReactions,
                        enabled: validReactions.every(r => r.enabled),
                        category: reaction.category || ""
                    });
                }
            } else {
                const isPure = isPureDefault(userSaved, reaction);
                const isOverridden = !!userSaved && !isPure;
                const enabledState = isPure ? userSaved.enabled : reaction.enabled;

                defaultList.push(startEnabled({
                    name: name,
                    lid: null,
                    triggers: [...(reaction.triggers || []), ...(reaction.onInit ? ["onInit"] : [])].join(", "),
                    isGeneral: true,
                    isDefault: true,
                    isOverridden: isOverridden,
                    onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
                    original: reaction,
                    enabled: enabledState,
                    category: reaction.category || "",
                    comments: reaction.comments || ""
                }));
            }
        }

        const sorter = (a, b) => {
            if (a.isGeneral !== b.isGeneral)
                return b.isGeneral - a.isGeneral;
            return a.name.localeCompare(b.name);
        };

        allReactions.sort(sorter);
        defaultList.sort(sorter);

        // Group defaults by category into folders
        const categoryMap = new Map();
        for (const item of defaultList) {
            const cat = item.category || "Other";
            if (!categoryMap.has(cat))
                categoryMap.set(cat, []);
            categoryMap.get(cat).push(item);
        }
        const defaultFolders = [];
        for (const [catName, items] of categoryMap) {
            defaultFolders.push({
                folderName: catName,
                isFolder: true,
                items: items
            });
        }
        // Sort folders by name (General first)
        defaultFolders.sort((a, b) => {
            if (a.folderName === "General")
                return -1;
            if (b.folderName === "General")
                return 1;
            return a.folderName.localeCompare(b.folderName);
        });

        // Build custom folders for the custom tab
        const folderSettings = ReactionManager.getFolders();
        const getActivationKey = (r) => r.isGeneral ? `general::${r.name}` : `item::${r.lid}`;

        // Build folders with their items
        const assignedKeys = new Set();
        const customFolders = folderSettings.map(f => {
            const keySet = new Set(f.items || []);
            const folderItems = allReactions.filter(r => keySet.has(getActivationKey(r)));
            folderItems.forEach(r => assignedKeys.add(getActivationKey(r)));
            return {
                folderName: f.name,
                isFolder: true,
                items: folderItems
            };
        });

        // Unfiled items
        const unfiledReactions = allReactions.filter(r => !assignedKeys.has(getActivationKey(r)));

        // Collect all unique triggers for the filter dropdown
        const allTriggerSet = new Set();
        for (const r of [...allReactions, ...defaultList]) {
            const trigStr = r.triggers || "";
            trigStr.split(", ").filter(t => t).forEach(t => allTriggerSet.add(t.trim()));
            if (r.reactions) {
                r.reactions.forEach(sub => {
                    const subTrig = sub.triggers || "";
                    subTrig.split(", ").filter(t => t).forEach(t => allTriggerSet.add(t.trim()));
                });
            }
        }
        const allTriggers = [...allTriggerSet].sort();

        const userScripts = ReactionManager.getStartupScripts();
        const startupScripts = [
            ...ReactionManager.builtinStartups.map(s => ({ ...s, builtin: true })),
            ...userScripts
        ];

        return {
            allReactions: allReactions,
            unfiledReactions: unfiledReactions,
            customFolders: customFolders,
            defaultReactions: defaultList,
            defaultFolders: defaultFolders,
            allTriggers: allTriggers,
            startupScripts: startupScripts
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
        html.find('.add-script').click(this._onAddScript.bind(this));
        html.find('.edit-script').click(this._onEditScript.bind(this));
        html.find('.delete-script').click(this._onDeleteScript.bind(this));
        html.find('.script-enabled').change(this._onToggleScript.bind(this));

        // Group expand/collapse
        html.find('.group-header').click((ev) => {
            ev.preventDefault();
            const header = $(ev.currentTarget);
            const icon = header.find('.expand-icon');
            const sublist = header.next('.reaction-sublist');

            if (sublist.is(':visible')) {
                sublist.slideUp(200);
                icon.removeClass('fa-caret-down').addClass('fa-caret-right');
            } else {
                sublist.slideDown(200);
                icon.removeClass('fa-caret-right').addClass('fa-caret-down');
            }
        });

        // Folder expand/collapse
        html.find('.folder-header').click((ev) => {
            ev.preventDefault();
            const header = $(ev.currentTarget);
            const icon = header.find('.folder-expand-icon');
            const content = header.next('.folder-content');

            if (content.is(':visible')) {
                content.slideUp(200);
                icon.removeClass('fa-folder-open').addClass('fa-folder');
            } else {
                content.slideDown(200);
                icon.removeClass('fa-folder').addClass('fa-folder-open');
            }
        });

        // Search + trigger filter
        const applyFilters = (container) => {
            const searchInput = container.find('.search-input');
            const triggerFilter = container.find('.trigger-filter');
            const scrollable = container.find('.scrollable');

            const searchVal = (searchInput.val() || '').toLowerCase();
            const triggerVal = triggerFilter.val() || '';

            // For folder-based (defaults) tab
            scrollable.find('.category-folder').each(function () {
                const folder = $(this);
                let anyVisible = false;

                folder.find('.reaction-item:not(.group-header):not(.folder-header)').each(function () {
                    const item = $(this);
                    const name = (item.data('name') || '').toString().toLowerCase();
                    const lid = (item.data('lid') || '').toString().toLowerCase();
                    const triggers = (item.find('.col-triggers').text() || '').toLowerCase();

                    const matchesSearch = !searchVal || name.includes(searchVal) || lid.includes(searchVal);
                    const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                    if (matchesSearch && matchesTrigger) {
                        item.show();
                        anyVisible = true;
                    } else {
                        item.hide();
                    }
                });

                // Also check groups
                folder.find('.reaction-group-container').each(function () {
                    const group = $(this);
                    const groupHeader = group.find('.group-header');
                    const name = (groupHeader.data('name') || '').toString().toLowerCase();
                    const triggers = (groupHeader.find('.col-triggers').text() || '').toLowerCase();

                    const matchesSearch = !searchVal || name.includes(searchVal);
                    const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                    if (matchesSearch && matchesTrigger) {
                        group.show();
                        anyVisible = true;
                    } else {
                        group.hide();
                    }
                });

                // Hide folder if no visible items
                if (anyVisible) {
                    folder.show();
                } else {
                    folder.hide();
                }
            });

            // For non-folder items (custom tab)
            scrollable.find('> .reaction-item, > .reaction-group-container').each(function () {
                const el = $(this);
                const name = (el.data('name') || el.find('.group-header').data('name') || '').toString().toLowerCase();
                const lid = (el.data('lid') || el.find('.group-header').data('lid') || '').toString().toLowerCase();
                const triggers = (el.find('.col-triggers').first().text() || '').toLowerCase();

                const matchesSearch = !searchVal || name.includes(searchVal) || lid.includes(searchVal);
                const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                if (matchesSearch && matchesTrigger) {
                    el.show();
                } else {
                    el.hide();
                }
            });
        };

        html.find('.search-input').on('input', function () {
            const container = $(this).closest('.tab');
            applyFilters(container);
        });

        html.find('.trigger-filter').on('change', function () {
            const container = $(this).closest('.tab');
            applyFilters(container);
        });

        // Custom folder management
        const self = this;
        html.find('.create-folder-btn').click(async () => {
            const name = await new Promise(resolve => {
                new Dialog({
                    title: "Create Folder",
                    content: `
                        <div class="form-group">
                            <label>Folder Name</label>
                            <input type="text" name="folderName" placeholder="Enter folder name..." autofocus>
                        </div>
                    `,
                    buttons: {
                        ok: { 
                            label: "Create", 
                            icon: '<i class="fas fa-folder-plus"></i>',
                            callback: (dlg) => resolve(dlg.find('[name=folderName]').val()?.trim()) 
                        },
                        cancel: { 
                            label: "Cancel", 
                            icon: '<i class="fas fa-times"></i>',
                            callback: () => resolve(null) 
                        }
                    },
                    default: "ok"
                }, { classes: ["lancer-automations-dialog"] }).render(true);
            });
            if (name) {
                await ReactionManager.createFolder(name);
                self.render();
            }
        });

        html.find('.rename-folder-btn').click(async function (ev) {
            ev.stopPropagation();
            const oldName = $(this).closest('.category-folder').data('folder');
            const newName = await new Promise(resolve => {
                new Dialog({
                    title: "Rename Folder",
                    content: `
                        <div class="form-group">
                            <label>New Name</label>
                            <input type="text" name="folderName" value="${oldName}" autofocus>
                        </div>
                    `,
                    buttons: {
                        ok: { 
                            label: "Rename", 
                            icon: '<i class="fas fa-pen"></i>',
                            callback: (dlg) => resolve(dlg.find('[name=folderName]').val()?.trim()) 
                        },
                        cancel: { 
                            label: "Cancel", 
                            icon: '<i class="fas fa-times"></i>',
                            callback: () => resolve(null) 
                        }
                    },
                    default: "ok"
                }, { classes: ["lancer-automations-dialog"] }).render(true);
            });
            if (newName && newName !== oldName) {
                await ReactionManager.renameFolder(oldName, newName);
                self.render();
            }
        });

        html.find('.delete-folder-btn').click(async function (ev) {
            ev.stopPropagation();
            const folderName = $(this).closest('.category-folder').data('folder');
            const result = await new Promise(resolve => {
                new Dialog({
                    title: "Delete Folder",
                    content: `
                        <div class="form-group">
                            <p style="margin-bottom: 10px;">Are you sure you want to delete folder "<strong>${folderName}</strong>"?</p>
                            <p class="notes">Choose whether to keep the activations inside the folder (unfiled) or delete them entirely.</p>
                        </div>
                    `,
                    buttons: {
                        keep: { 
                            label: "Keep Items", 
                            icon: '<i class="fas fa-inbox"></i>', 
                            callback: () => resolve("keep") 
                        },
                        all: { 
                            label: "Delete All", 
                            icon: '<i class="fas fa-trash"></i>', 
                            callback: () => resolve("all") 
                        },
                        cancel: { 
                            label: "Cancel", 
                            icon: '<i class="fas fa-times"></i>',
                            callback: () => resolve(null) 
                        }
                    },
                    default: "keep"
                }, { classes: ["lancer-automations-dialog"] }).render(true);
            });
            if (!result)
                return;

            if (result === "all") {
                // Delete all activations inside the folder
                const folders = ReactionManager.getFolders();
                const folder = folders.find(f => f.name === folderName);
                if (folder) {
                    for (const key of folder.items) {
                        if (key.startsWith("general::")) {
                            const name = key.replace("general::", "");
                            await ReactionManager.deleteGeneralReaction(name);
                        } else if (key.startsWith("item::")) {
                            const lid = key.replace("item::", "");
                            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);
                            if (userReactions[lid]) {
                                delete userReactions[lid];
                                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userReactions);
                            }
                        }
                    }
                }
            }
            await ReactionManager.deleteFolder(folderName);
            self.render();
        });

        // Drag and drop for custom tab
        const customTab = html.find('[data-tab="custom"]');

        // Make draggable items
        customTab.find('.reaction-item:not(.group-header):not(.folder-header)').attr('draggable', 'true');
        customTab.find('.reaction-group-container').attr('draggable', 'true');

        customTab.on('dragstart', '.reaction-item[draggable="true"], .reaction-group-container[draggable="true"]', function (ev) {
            const el = $(this);
            const isGeneral = el.data('is-general') === true || el.data('is-general') === 'true';
            const lid = el.data('lid');
            const name = el.data('name');
            const key = isGeneral ? `general::${name}` : `item::${lid}`;
            ev.originalEvent.dataTransfer.setData('text/plain', key);
            el.addClass('dragging');
        });

        customTab.on('dragend', '.reaction-item, .reaction-group-container', function () {
            $(this).removeClass('dragging');
            customTab.find('.drag-over').removeClass('drag-over');
        });

        // Drop targets: folder headers and unfiled area
        customTab.on('dragover', '.folder-header, .unfiled-header', function (ev) {
            ev.preventDefault();
            $(this).addClass('drag-over');
        });

        customTab.on('dragleave', '.folder-header, .unfiled-header', function () {
            $(this).removeClass('drag-over');
        });

        customTab.on('drop', '.folder-header', async function (ev) {
            ev.preventDefault();
            $(this).removeClass('drag-over');
            const key = ev.originalEvent.dataTransfer.getData('text/plain');
            const folderName = $(this).closest('.category-folder').data('folder');
            if (key && folderName) {
                await ReactionManager.assignToFolder(folderName, key);
                self.render();
            }
        });

        customTab.on('drop', '.unfiled-header', async function (ev) {
            ev.preventDefault();
            $(this).removeClass('drag-over');
            const key = ev.originalEvent.dataTransfer.getData('text/plain');
            if (key) {
                await ReactionManager.unassignFromFolder(key);
                self.render();
            }
        });
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
            const index = li.data("index");
            const generals = ReactionManager.getGeneralReactions();
            const entry = generals[name];
            if (!entry)
                return;
            const reaction = (Array.isArray(entry.reactions) && typeof index !== 'undefined')
                ? entry.reactions[index]
                : entry;
            if (!reaction)
                return;
            new ReactionEditor({ isGeneral: true, name, reaction }).render(true);
        } else {
            const lid = li.data("lid");
            const index = li.data("index");
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry)
                return;

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
        this._needsReload = true;
        clearScriptCache();
        this.render();
    }

    async _onCopyDefault(event) {
        const li = $(event.currentTarget).closest(".reaction-item");
        const lid = li.data("lid");
        const name = li.data("name");
        const isGeneral = li.data("general");
        const index = li.data("index");

        if (isGeneral) {
            const defaultEntry = getDefaultGeneralReactionRegistry()[name];
            if (!defaultEntry)
                return;
            const reaction = (Array.isArray(defaultEntry.reactions) && typeof index !== 'undefined')
                ? foundry.utils.deepClone(defaultEntry.reactions[index])
                : foundry.utils.deepClone(defaultEntry);
            if (!reaction)
                return;
            new ReactionEditor({ isGeneral: true, name, reaction }).render(true);
        } else {
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry)
                return;
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
            const index = li.data("index");
            const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

            if (!userSaved[name])
                userSaved[name] = {};

            if (index !== undefined && index !== null && index !== '') {
                if (!Array.isArray(userSaved[name].reactions))
                    userSaved[name].reactions = [];
                const i = parseInt(index);
                if (!userSaved[name].reactions[i])
                    userSaved[name].reactions[i] = {};
                userSaved[name].reactions[i].enabled = checked;
            } else {
                userSaved[name].enabled = checked;
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
        this._needsReload = true;
        clearScriptCache();
        this.render();
    }

    _onAddScript(event) {
        event.preventDefault();
        this._openScriptEditor(null);
    }

    _onEditScript(event) {
        event.preventDefault();
        const li = $(event.currentTarget).closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const script = scripts.find(s => s.id === id);
        if (!script)
            return;
        this._openScriptEditor(script);
    }

    async _onDeleteScript(event) {
        event.preventDefault();
        const li = $(event.currentTarget).closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const idx = scripts.findIndex(s => s.id === id);
        if (idx === -1)
            return;
        const confirmed = await Dialog.confirm({
            title: 'Delete Startup Script',
            content: `<p>Delete script "<strong>${scripts[idx].name}</strong>"?</p>`
        });
        if (!confirmed)
            return;
        scripts.splice(idx, 1);
        await ReactionManager.saveStartupScripts(scripts);
        this._needsReload = true;
        this.render();
    }

    async _onToggleScript(event) {
        const checkbox = $(event.currentTarget);
        const li = checkbox.closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const script = scripts.find(s => s.id === id);
        if (!script)
            return;
        script.enabled = checkbox.prop('checked');
        await ReactionManager.saveStartupScripts(scripts);
        this._needsReload = true;
    }

    _openScriptEditor(script) {
        new StartupScriptEditor({ script, manager: this }).render(true);
    }

    async _updateObject(event, formData) {
    }

    async close(options = {}) {
        if (this._needsReload) {
            const reload = await Dialog.confirm({
                title: "Reload Required",
                content: "<p>Changes made to activations or startup scripts require a reload to apply. Reload now?</p>",
                yes: () => true,
                no: () => false,
                defaultYes: false
            });
            if (reload)
                foundry.utils.debouncedReload();
        }
        return super.close(options);
    }
}

export class StartupScriptEditor extends FormApplication {
    constructor(object, options) {
        super(object, options);
        this._codeEditor = null;
    }

    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            title: "Startup Script",
            id: "startup-script-editor",
            template: `modules/lancer-automations/templates/startup-script-editor.html`,
            width: 700,
            height: 580,
            resizable: true,
            classes: ["lancer-reaction-editor"]
        });
    }

    get title() {
        const script = this.object?.script;
        if (!script)
            return "New Startup Script";
        return script.builtin ? `View: ${script.name}` : `Edit: ${script.name}`;
    }

    async getData() {
        const script = this.object?.script;
        return {
            id: script?.id ?? foundry.utils.randomID(),
            name: script?.name ?? "",
            description: script?.description ?? "",
            enabled: script?.enabled !== false,
            code: script?.code ?? "",
            builtin: !!script?.builtin
        };
    }

    activateListeners(html) {
        super.activateListeners(html);

        const isBuiltin = !!this.object?.script?.builtin;
        const host = html.find('.sse-codemirror-host')[0];
        const textarea = html.find('textarea[name="code"]')[0];
        if (host && typeof CodeMirror !== 'undefined') {
            const initialValue = textarea?.value ?? "";
            this._codeEditor = CodeMirror(host, {
                value: initialValue,
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                matchBrackets: true,
                indentUnit: 4,
                lineWrapping: false,
                scrollbarStyle: 'native',
                readOnly: isBuiltin
            });
            if (!isBuiltin) {
                this._codeEditor.on('change', (cm) => {
                    if (textarea)
                        textarea.value = cm.getValue();
                });
            }
            setTimeout(() => this._codeEditor.refresh(), 100);
        }
    }

    async _updateObject(event, formData) {
        if (this.object?.script?.builtin)
            return;

        const id = formData.id ?? foundry.utils.randomID();
        const name = (formData.name ?? "").trim();
        if (!name) {
            ui.notifications.warn('Script name is required.');
            return;
        }

        const entry = {
            id,
            name,
            description: (formData.description ?? "").trim(),
            enabled: !!formData.enabled,
            code: formData.code ?? ""
        };

        const scripts = ReactionManager.getStartupScripts();
        const isNew = !this.object?.script;
        if (isNew) {
            scripts.push(entry);
        } else {
            const idx = scripts.findIndex(s => s.id === id);
            if (idx >= 0)
                scripts[idx] = entry;
            else
                scripts.push(entry);
        }

        await ReactionManager.saveStartupScripts(scripts);
        if (this.object?.manager) {
            this.object.manager._needsReload = true;
            this.object.manager.render();
        }
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
            template: `modules/lancer-automations/templates/reaction-editor.html`,
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
                if (pack.documentName !== "Item")
                    continue;

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
        let foundEffectDescription = "";
        const reactionPath = reaction.reactionPath || "";

        if (foundItemUuid) {
            try {
                const item = await fromUuid(foundItemUuid);
                if (item) {
                    const rootSystem = item.system;
                    let actionData = rootSystem;

                    if (!reactionPath || reactionPath === "system" || reactionPath === "") {
                        foundActionName = item.name;
                    } else {
                        const pathParts = reactionPath.split(/\.|\[|\]/).filter(p => p !== "");
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

                    foundEffectDescription = actionData?.effect || actionData?.on_hit || actionData?.on_crit || rootSystem?.effect || rootSystem?.on_hit || rootSystem?.on_crit || "";
                }
            } catch (e) {
                console.warn("lancer-automations | Could not load item for action name:", e);
            }
        }

        const triggerHelp = {
            onAttack: "{ triggeringToken, weapon, targets, attackType, actionName, tags, actionData, distanceToTrigger }",
            onHit: "{ triggeringToken, weapon, targets: [{target, roll, crit}], attackType, actionName, tags, actionData, distanceToTrigger }",
            onMiss: "{ triggeringToken, weapon, targets: [{target, roll}], attackType, actionName, tags, actionData, distanceToTrigger }",
            onDamage: "{ triggeringToken, weapon, target, damages, types, isCrit, isHit, attackType, actionName, tags, actionData, distanceToTrigger }",
            onPreMove: "{ token, distanceToMove, elevationToMove, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, pathHexes }, cancelTriggeredMove(reasonText, showCard, gmControl), changeTriggeredMove(pos, extraData), distanceToTrigger }",
            onMove: "{ triggeringToken, distanceMoved, elevationMoved, startPos, endPos, isDrag, moveInfo: { isInvoluntary, isTeleport, pathHexes, isBoost, boostSet, isModified, extraData }, distanceToTrigger }",
            onTurnStart: "{ triggeringToken, distanceToTrigger }",
            onTurnEnd: "{ triggeringToken, distanceToTrigger }",
            onPreStatusApplied: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, gmControl) }",
            onPreStatusRemoved: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, showCard, gmControl) }",
            onStatusApplied: "{ triggeringToken, statusId, effect, distanceToTrigger }",
            onStatusRemoved: "{ triggeringToken, statusId, effect, distanceToTrigger }",
            onStructure: "{ triggeringToken, remainingStructure, rollResult, distanceToTrigger }",
            onStress: "{ triggeringToken, remainingStress, rollResult, distanceToTrigger }",
            onHeat: "{ triggeringToken, heatGained, currentHeat, inDangerZone, distanceToTrigger }",
            onDestroyed: "{ triggeringToken, distanceToTrigger }",
            onTechAttack: "{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData, distanceToTrigger }",
            onTechHit: "{ triggeringToken, techItem, targets: [{target, roll, crit}], actionName, isInvade, tags, actionData, distanceToTrigger }",
            onTechMiss: "{ triggeringToken, techItem, targets: [{target, roll}], actionName, isInvade, tags, actionData, distanceToTrigger }",
            onCheck: "{ triggeringToken, statName, roll, total, success, checkAgainstToken, targetVal, distanceToTrigger }",
            onInitCheck: "{ triggeringToken, statName, checkAgainstToken, targetVal, cancelCheck(reasonText, title, showCard, gmControl), distanceToTrigger }",
            onInitAttack: "{ triggeringToken, weapon, targets, actionName, tags, actionData, cancelAttack(reasonText, title, showCard, gmControl), distanceToTrigger }",
            onInitTechAttack: "{ triggeringToken, techItem, targets, actionName, isInvade, tags, actionData, cancelTechAttack(reasonText, title, showCard, gmControl), distanceToTrigger }",
            onInitActivation: "{ triggeringToken, actionType, actionName, item, actionData, cancelAction(reasonText, title, showCard, gmControl) }",
            onActivation: "{ triggeringToken, actionType, actionName, item, actionData, distanceToTrigger, endActivation }",
            onHPRestored: "{ triggeringToken, hpRestored, currentHP, maxHP, distanceToTrigger }",
            onHpLoss: "{ triggeringToken, hpLost, currentHP, distanceToTrigger }",
            onClearHeat: "{ triggeringToken, heatCleared, currentHeat, distanceToTrigger }",
            onKnockback: "{ triggeringToken, range, pushedActors: [Actor], actionName, item, distanceToTrigger }",
            onDeploy: "{ triggeringToken, item, deployedTokens, deployType, distanceToTrigger }",
            onUpdate: "{ triggeringToken, document, change, options }",
            onEnterCombat: "{ triggeringToken, distanceToTrigger }",
            onExitCombat: "{ triggeringToken, distanceToTrigger }"
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
            effectDescription: reaction.effectDescription || foundEffectDescription || "",
            comments: reaction.comments || "",
            isReaction: reaction.isReaction !== false,
            isReactionDefined: reaction.isReaction !== undefined,
            triggerSelf: reaction.triggerSelf === true,
            triggerOther: reaction.triggerOther !== false,
            outOfCombat: reaction.outOfCombat === true,
            autoActivate: reaction.autoActivate || false,
            forceSynchronous: reaction.forceSynchronous ?? (reaction.autoActivate ?? false),
            onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
            triggers: this._getTriggerOptions(reaction.triggers || []),
            evaluate: reaction.evaluate?.toString() || "return true;",
            triggerHelp: triggerHelp,
            activationType: reaction.activationType || "flow",
            activationMode: reaction.activationMode || "after",
            activationMacro: reaction.activationMacro || "",
            activationCode: typeof reaction.activationCode === 'function' ? reaction.activationCode.toString() : (reaction.activationCode || ""),
            reactionIndex: data.reactionIndex,
            onInit: typeof reaction.onInit === 'function' ? reaction.onInit.toString() : (reaction.onInit || ""),
            actionType: reaction.actionType || "Automation",
            consumesReaction: reaction.consumesReaction !== false,
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

        const onlyOnSourceMatchCheckbox = html.find('input[name="onlyOnSourceMatch"]');
        const triggerCheckboxes = html.find('input[name^="trigger."]');

        const sourceMatchTriggers = [
            'onAttack', 'onHit', 'onMiss', 'onDamage',
            'onTechAttack', 'onTechHit', 'onTechMiss', 'onActivation', 'onInitActivation',
            'onInitAttack', 'onInitTechAttack', 'onKnockback', 'onDeploy'
        ];

        const toggleSourceMatchTriggers = () => {
            const isSourceMatch = onlyOnSourceMatchCheckbox.filter(':checked').length > 0;
            const isGeneral = generalCheckbox.prop('checked');

            triggerCheckboxes.each(function () {
                const triggerName = $(this).attr('name').replace('trigger.', '');
                let isCompatible = sourceMatchTriggers.includes(triggerName);

                // onDeploy source matching only makes sense for Item reactions, not General
                if (triggerName === 'onDeploy' && isGeneral) {
                    isCompatible = false;
                }

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

        onlyOnSourceMatchCheckbox.on('change', (ev) => {
            // Sync all checkboxes with this name (DOM has two: one for General, one for Item)
            const isChecked = $(ev.currentTarget).prop('checked');
            onlyOnSourceMatchCheckbox.prop('checked', isChecked);
            toggleSourceMatchTriggers();
        });
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
                if (item)
                    item.sheet.render(true);
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
                consumesReactionContainer.removeClass('hidden');
            } else {
                consumesReactionContainer.addClass('hidden');
                consumesReactionContainer.find('input[type="checkbox"]').prop('checked', false);
            }
        };

        actionTypeSelect.on('change', toggleConsumesReaction);
        toggleConsumesReaction();

        const autoActivateCheckbox = html.find('input[name="autoActivate"]');
        const forceSyncOption = html.find('.force-sync-option');
        const syncAutoActivateLock = () => {
            const checked = autoActivateCheckbox.prop('checked');
            if (checked) {
                actionTypeSelect.val('Automation');
                actionTypeSelect.trigger('change');
            }
            actionTypeSelect.prop('disabled', checked);
            forceSyncOption.toggle(checked);
        };
        autoActivateCheckbox.on('change', syncAutoActivateLock);
        syncAutoActivateLock();

        const updatePreview = async (autoSelect = true) => {
            const lid = lidInput.val()?.trim();
            const reactionPath = pathInput.val()?.trim() || "";

            if (!lid) {
                //previewContainer.show();
                return;
            }

            let foundItemUuid = null;
            let foundItemName = null;

            for (const pack of game.packs) {
                if (pack.documentName !== "Item")
                    continue;
                const index = await pack.getIndex({ fields: ["system.lid"] });
                const entry = index.find(e => e.system?.lid === lid);
                if (entry) {
                    foundItemUuid = entry.uuid;
                    foundItemName = entry.name;
                    break;
                }
            }

            if (!foundItemUuid) {
                //previewContainer.show();
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

                        if (actionData?.frequency) {
                            detectedFrequency = actionData.frequency;
                        } else if (item.system?.frequency) {
                            detectedFrequency = item.system.frequency;
                        } else if (item.system?.uses?.per) {
                            const per = item.system.uses.per;
                            if (per === "Round")
                                detectedFrequency = "1/Round";
                            else if (per === "Scene")
                                detectedFrequency = "1/Scene";
                            else if (per === "Combat")
                                detectedFrequency = "1/Combat";
                            else if (per === "Mission")
                                detectedFrequency = "1/Mission";
                        } else if (detectedActionType === "Reaction" || detectedActionType === "Free Action") {
                            detectedFrequency = "1/Round";
                        }
                    }
                }
            } catch (e) {
                console.warn("lancer-automations | Error resolving action name:", e);
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
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
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
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.codeEditor.on('change', (cm) => cm.save());
            }

            const onInitTextarea = html.find('textarea[name="onInit"]')[0];
            if (onInitTextarea) {
                this.onInitEditor = CodeMirror.fromTextArea(onInitTextarea, {
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });
                this.onInitEditor.on('change', (cm) => cm.save());
            }

            const refreshEditors = () => {
                if (this.evaluateEditor)
                    this.evaluateEditor.refresh();
                if (this.codeEditor)
                    this.codeEditor.refresh();
                if (this.onInitEditor)
                    this.onInitEditor.refresh();
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

        html.find('.find-action-btn').on('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openActionBrowser(lidInput.val(), pathInput, updatePreview);
        });

        html.find('.find-deployable-btn').on('click', async (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            await this._openDeployableBrowser();
        });

        html.find('.expand-editor').on('click', this._onExpandEditor.bind(this));
    }

    async _onExpandEditor(event) {
        event.preventDefault();
        const targetName = $(event.currentTarget).data('target');
        let editorInstance;
        let title;

        if (targetName === 'evaluate') {
            editorInstance = this.evaluateEditor;
            title = "Evaluate Function";
        } else if (targetName === 'activationCode') {
            editorInstance = this.codeEditor;
            title = "Activation Code";
        } else if (targetName === 'onInit') {
            editorInstance = this.onInitEditor;
            title = "onInit Code";
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
            title: `Edit ${title}`,
            content: dialogContent,
            buttons: {
                save: {
                    label: "Save & Close",
                    icon: '<i class="fas fa-save" style="margin-right: 8px;"></i>',
                    callback: () => {
                        editorInstance.setValue(expandedEditor.getValue());
                    }
                }
            },
            default: "save",
            render: (html) => {
                const host = html.find('.expanded-cm-host')[0];
                expandedEditor = CodeMirror(host, {
                    value: content,
                    mode: 'javascript',
                    theme: 'monokai',
                    lineNumbers: true,
                    matchBrackets: true,
                    indentUnit: 4,
                    smartIndent: true,
                    lineWrapping: false,
                    scrollbarStyle: "native"
                });

                const windowEl = html.closest('.window-app')[0];
                const updateSize = () => {
                    if (!windowEl)
                        return;
                    const headerH = windowEl.querySelector('.window-header')?.offsetHeight ?? 34;
                    const buttonH = 40; // fixed: matches forced CSS height on .dialog-buttons
                    expandedEditor.setSize(null, windowEl.offsetHeight - headerH - buttonH);
                    expandedEditor.refresh();
                };

                setTimeout(updateSize, 50);
                resizeObserver = new ResizeObserver(updateSize);
                resizeObserver.observe(windowEl);
            },
            close: () => {
                resizeObserver?.disconnect();
            }
        }, {
            width: 800,
            height: 600,
            resizable: true,
            classes: ["dialog", "expanded-editor-dialog"]
        }).render(true);
    }

    async _openItemBrowser(lidInput, pathInput, updatePreview, previewContainer) {
        const selectedItem = await openItemBrowserDialog();

        if (!selectedItem)
            return;

        const item = await fromUuid(selectedItem.uuid);
        if (!item)
            return;

        const actions = this._getItemActions(item);

        let selectedPath = "";
        if (actions.length === 1) {
            selectedPath = actions[0].path;
        } else {
            selectedPath = await this._showActionSelectionDialog(item.name, actions);
            if (selectedPath === null)
                return;
        }

        lidInput.val(selectedItem.lid);
        pathInput.val(selectedPath);

        await updatePreview();
    }

    async _openActionBrowser(lid, pathInput, updatePreview) {
        if (!lid) {
            ui.notifications.warn("Please select an item first.");
            return;
        }

        let item = null;
        for (const pack of game.packs) {
            if (pack.documentName !== "Item")
                continue;
            const index = await pack.getIndex({ fields: ["system.lid", "type", "system.actions", "system.ranks", "system.profiles", "system.trigger"] });
            const entry = index.find(e => e.system?.lid === lid);
            if (entry) {
                item = await fromUuid(entry.uuid);
                break;
            }
        }

        if (!item) {
            ui.notifications.error(`Item with LID "${lid}" not found in any compendium.`);
            return;
        }

        const actions = this._getItemActions(item);

        if (actions.length <= 1) {
            ui.notifications.info(`${item.name} has only one possible action.`);
            pathInput.val("");
            await updatePreview();
            return;
        }

        const selectedPath = await this._showActionSelectionDialog(item.name, actions);
        if (selectedPath !== null) {
            pathInput.val(selectedPath);
            await updatePreview();
        }
    }

    _getItemActions(item) {
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
        return actions;
    }

    async _showActionSelectionDialog(itemName, actions) {
        const actionListHtml = actions.map((action, idx) =>
            `<div class="lancer-item-card action-browser-entry" data-path="${action.path}" style="margin-bottom: 6px; padding: 10px;">
                <div class="lancer-item-icon"><i class="fas fa-bolt"></i></div>
                <div class="lancer-item-content">
                    <div class="lancer-item-name">${action.name}${action.isDefault ? ' <em>(default)</em>' : ''}</div>
                    <div class="lancer-item-details">Path: ${action.path || '(empty)'}</div>
                </div>
            </div>`
        ).join('');

        return await new Promise((resolve) => {
            const dialog = new Dialog({
                title: `Select Action`,
                content: `
                    <div class="lancer-dialog-header" style="margin: -8px -8px 10px -8px;">
                        <h1 class="lancer-dialog-title">Select Action</h1>
                        <p class="lancer-dialog-subtitle">Choose which action from <strong>${itemName}</strong> to trigger.</p>
                    </div>
                    <div id="action-list" style="max-height: 350px; overflow-y: auto; padding: 4px; border: 1px solid #ddd; background: #fafafa; border-radius: 4px;">
                        ${actionListHtml}
                    </div>
                `,
                buttons: {
                    noAction: {
                        label: '<i class="fas fa-minus"></i> No specific action',
                        callback: () => resolve("")
                    },
                    cancel: {
                        label: '<i class="fas fa-times"></i> Cancel',
                        callback: () => resolve(null)
                    }
                },
                render: (html) => {
                    html.find('.action-browser-entry').on('click', (ev) => {
                        resolve($(ev.currentTarget).data('path'));
                        dialog.close();
                    });
                },
                default: "cancel"
            }, {
                width: 400,
                classes: ["lancer-dialog-base", "lancer-action-browser-dialog"]
            });
            dialog.render(true);
        });
    }

    _getTriggerOptions(selected) {
        const options = [
            "onEnterCombat", "onExitCombat", "onTurnStart", "onTurnEnd",
            "onPreMove", "onMove", "onKnockback",
            "onInitAttack", "onAttack", "onHit", "onMiss", "onDamage",
            "onInitTechAttack", "onTechAttack", "onTechHit", "onTechMiss",
            "onInitActivation", "onActivation", "onDeploy",
            "onInitCheck", "onCheck",
            "onPreStatusApplied", "onPreStatusRemoved",
            "onStatusApplied", "onStatusRemoved",
            "onHPRestored", "onHpLoss", "onHeat", "onClearHeat",
            "onStructure", "onStress", "onDestroyed", "onUpdate"
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
        if (formData['dispositionFilter.friendly'])
            dispositionFilter.push('friendly');
        if (formData['dispositionFilter.neutral'])
            dispositionFilter.push('neutral');
        if (formData['dispositionFilter.hostile'])
            dispositionFilter.push('hostile');
        if (formData['dispositionFilter.secret'])
            dispositionFilter.push('secret');

        const isSourceMatch = Array.isArray(formData.onlyOnSourceMatch)
            ? formData.onlyOnSourceMatch.some(v => v === true || v === "on")
            : (formData.onlyOnSourceMatch === true || formData.onlyOnSourceMatch === "on");

        if (isGeneral) {
            const name = formData.name;
            if (!name)
                return ui.notifications.error("Activation Name is required for general activations");

            const newReaction = {
                triggers: triggers,
                evaluate: formData.evaluate,
                comments: formData.comments || "",
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Automation",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true,
                autoActivate: formData.autoActivate === true,
                forceSynchronous: formData.forceSynchronous === true,
                onlyOnSourceMatch: isSourceMatch,
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                onInit: formData.onInit || "",
                triggerSelf: formData.triggerSelf === true,
                triggerOther: formData.triggerOther === true,
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            await ReactionManager.saveGeneralReaction(name, newReaction);
        } else {
            const lid = formData.lid;
            if (!lid)
                return ui.notifications.error("Item LID is required");

            const newReaction = {
                reactionPath: formData.reactionPath || "",
                triggers: triggers,
                evaluate: formData.evaluate,
                comments: formData.comments || "",
                triggerDescription: formData.triggerDescription || "",
                effectDescription: formData.effectDescription || "",
                isReaction: formData.actionType === "Reaction",
                actionType: formData.actionType || "Automation",
                frequency: formData.frequency || "1/Round",
                consumesReaction: formData.consumesReaction === true,
                autoActivate: formData.autoActivate === true,
                forceSynchronous: formData.forceSynchronous === true,
                onlyOnSourceMatch: isSourceMatch,
                activationType: formData.activationType || "flow",
                activationMode: formData.activationMode || "after",
                activationMacro: formData.activationMacro || "",
                activationCode: formData.activationCode || "",
                onInit: formData.onInit || "",
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

        clearScriptCache();

        Object.values(ui.windows).forEach(w => {
            if (w.id === "reaction-manager-config") {
                w._needsReload = true;
                w.render();
            }
        });
    }

    /**
     * Open a dialog that lets the user browse deployable actors from compendium packs and world.
     * Each entry shows the actor name, LID, and a copy button.
     */
    async _openDeployableBrowser() {
        const deployables = [];
        for (const pack of game.packs) {
            if (pack.documentName !== 'Actor')
                continue;
            const index = await pack.getIndex({ fields: ['system.lid', 'type', 'img'] });
            for (const entry of index) {
                const lid = entry.system?.lid;
                if (!lid)
                    continue;
                deployables.push({
                    name: entry.name,
                    lid,
                    type: entry.type || 'unknown',
                    img: entry.img || 'icons/svg/mystery-man.svg',
                    uuid: entry.uuid,
                    pack: pack.metadata.label
                });
            }
        }

        for (const actor of game.actors) {
            const lid = actor.system?.lid;
            if (lid) {
                deployables.push({
                    name: actor.name,
                    lid,
                    type: actor.type || 'unknown',
                    img: actor.img || 'icons/svg/mystery-man.svg',
                    uuid: actor.uuid,
                    pack: 'World'
                });
            }
        }

        deployables.sort((a, b) => a.name.localeCompare(b.name));
        const MAX_RESULTS = 50;

        const buildEntry = (d) => `
            <div class="deployable-entry" style="display:flex;align-items:center;gap:8px;padding:6px 8px;margin-bottom:4px;background:#fff;border:1px solid #ddd;border-radius:4px;cursor:pointer;transition:background 0.15s;" data-lid="${d.lid}">
                <img src="${d.img}" style="width:32px;height:32px;border-radius:4px;border:1px solid #ccc;object-fit:cover;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:bold;font-size:0.9em;">${d.name}</div>
                    <div style="font-size:0.78em;color:#666;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${d.type} | <code style="background:rgba(153,30,42,0.08);color:#991e2a;padding:1px 4px;border-radius:3px;font-size:0.9em;">${d.lid}</code> <span style="opacity:0.5;">\u2014 ${d.pack}</span></div>
                </div>
                <a class="copy-lid-btn" title="Copy LID" style="color:#991e2a;cursor:pointer;font-size:1.1em;"><i class="fas fa-copy"></i></a>
            </div>`;

        new Dialog({
            title: 'Find Deployable',
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <h1 class="lancer-dialog-title">Find Deployable</h1>
                    <p class="lancer-dialog-subtitle">Search for a deployable actor by name or LID. Click <i class="fas fa-copy"></i> to copy.</p>
                </div>
                <div style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                    <div style="flex:1;position:relative;">
                        <i class="fas fa-search" style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:#888;"></i>
                        <input type="text" id="deploy-search" placeholder="Search by name or LID..." style="padding-left:35px;width:100%;">
                    </div>
                    <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                        <input type="checkbox" id="deploy-show-all"> Show all
                    </label>
                </div>
                <div id="deploy-list" style="height:380px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                    <div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables\u2026</div>
                </div>
            `,
            buttons: {
                close: { label: '<i class="fas fa-times"></i> Close' }
            },
            render: (html) => {
                const searchInput = html.find('#deploy-search');
                const showAllCb = html.find('#deploy-show-all');
                const listContainer = html.find('#deploy-list');

                const updateList = () => {
                    const query = searchInput.val().toLowerCase().trim();
                    const showAll = showAllCb.is(':checked');

                    if (!query && !showAll) {
                        listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables\u2026</div>');
                        return;
                    }

                    const matched = deployables.filter(d => {
                        if (!query)
                            return true;
                        return d.name.toLowerCase().includes(query) || d.lid.toLowerCase().includes(query);
                    });

                    if (matched.length === 0) {
                        listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No deployables found.</div>');
                        return;
                    }

                    const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                    const more = matched.length - slice.length;
                    let resultHtml = slice.map(buildEntry).join('');
                    if (more > 0) {
                        resultHtml += `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more \u2014 keep typing or check 'Show all'</div>`;
                    }
                    listContainer.html(resultHtml);
                };

                let timer;
                searchInput.on('input', () => {
                    clearTimeout(timer);
                    timer = setTimeout(updateList, 200);
                });
                showAllCb.on('change', updateList);

                listContainer.on('click', '.copy-lid-btn', async function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const lid = $(this).closest('.deployable-entry').data('lid');
                    if (lid) {
                        await navigator.clipboard.writeText(lid);
                        ui.notifications.info(`Copied LID: ${lid}`);
                    }
                });

                listContainer.on('contextmenu', '.deployable-entry', async function (ev) {
                    ev.preventDefault();
                    const entry = deployables.find(d => d.lid === $(this).data('lid'));
                    if (entry) {
                        const actor = await fromUuid(entry.uuid);
                        if (actor)
                            actor.sheet.render(true);
                    }
                });

                setTimeout(() => searchInput.focus(), 50);
            }
        }, { width: 600, height: 560, classes: ['lancer-reaction-editor', 'lancer-deployable-browser', 'lancer-no-title'] }).render(true);
    }
}
