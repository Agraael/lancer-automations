/*global game, FormApplication, mergeObject, foundry, console, document, URL, Blob, CodeMirror */

import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";
import { openItemBrowserDialog, attachEditorResizeObserver } from "../tools/misc-tools.js";
import { installLancerHints } from "../setup/codemirror-hints.js";
import { openApiRefPopup } from "./api-reference-popup.js";
import { openDeployablePicker, openDocumentPicker } from "../interactive/deployables.js";

const scriptCache = new Map();

export function clearScriptCache()
{
    console.log("lancer-automations | Clearing script compilation cache.");
    scriptCache.clear();
    Hooks.callAll('lancer-automations.clearCaches');
}

// Path-preserving: each '/' segment sanitized on its own, so devtools shows a folder tree.
function _sanitizeSourcePath(name)
{
    return String(name).split('/')
        .map(segment => segment.toLowerCase().replaceAll(/[^a-z0-9]/g, '-'))
        .filter(Boolean)
        .join('/');
}

// "Actor.<id>" keys point at a world actor rather than a compendium item.
function resolveKeyedDocument(lid)
{
    const match = /^Actor\.([A-Za-z0-9]+)$/.exec(lid ?? '');
    return match ? (game.actors.get(match[1]) ?? null) : null;
}

export function stringToFunction(str, args = [], reaction = null, sourceName = null)
{
    const trimmed = str.trim();
    const cacheKey = `${trimmed}|${args.join(',')}|${sourceName ?? ''}`;
    if (scriptCache.has(cacheKey))
        return scriptCache.get(cacheKey);

    let resolvedName = sourceName;
    if (!resolvedName)
    {
        let contentHash = 0;
        for (let charIndex = 0; charIndex < trimmed.length; charIndex++)
            contentHash = (contentHash * 31 + trimmed.charCodeAt(charIndex)) | 0;
        resolvedName = `misc/fn-${(contentHash >>> 0).toString(16)}`;
    }
    const sourcePath = `modules/lancer-automations/dynamic/${_sanitizeSourcePath(resolvedName)}.js`;
    const codeWithSourceURL = trimmed + `\n\n//# sourceURL=${sourcePath}`;

    let fn;
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('('))
    {
        // Closing `)` MUST be on its own line, otherwise the trailing //# sourceURL comment eats it.
        fn = eval(`(${codeWithSourceURL}\n)`);
    }
    else
        fn = new Function(...args, codeWithSourceURL);
    if (fn.constructor.name === 'AsyncFunction')
    {
        const blockingKeywords = ['injectBonusToNextRoll', 'changeTriggeredMove', 'cancelTriggeredMove', 'cancelChange', 'cancelAction', 'cancelAttack', 'cancelTechAttack', 'cancelCheck', 'cancelStructure', 'cancelStress', 'cancelStructureOutcome', 'cancelStressOutcome', 'cancelHpChange', 'cancelHeatChange', 'modifyRoll', 'modifyHpChange', 'modifyHeatChange'];
        const foundKeywords = blockingKeywords.filter(keyword => trimmed.includes(keyword));

        const sensitiveTriggers = new Set(['onPreMove', 'onInitAttack', 'onInitCheck', 'onInitActivation', 'onPreStatusApplied', 'onPreStatusRemoved']);
        const foundTriggers = reaction?.triggers?.filter(trigger => sensitiveTriggers.has(trigger)) || [];

        const isForceSync = reaction?.awaitActivationCompletion;

        if ((foundKeywords.length > 0 || foundTriggers.length > 0) && !isForceSync)
        {
            let reason = "";
            if (foundKeywords.length > 0)
                reason += `uses blocking logic (${foundKeywords.join(', ')})`;
            if (foundTriggers.length > 0)
                reason += (reason ? " and " : "") + `is associated with sensitive triggers (${foundTriggers.join(', ')})`;

            ui.notifications.warn(`lancer-automations | Evaluation for "${reaction?.name || 'Activation'}" is async and ${reason} without "Await Activation Completion". This will likely fail to block movement or timing-sensitive bonuses.`, {permanent: true});
        }
    }
    scriptCache.set(cacheKey, fn);
    return fn;
}

export function stringToAsyncFunction(str, args = [], name = "lancer-automations-dynamic-script")
{
    const trimmed = str.trim();
    const cacheKey = `async|${trimmed}|${args.join(',')}|${name}`;
    if (scriptCache.has(cacheKey))
        return scriptCache.get(cacheKey);

    const sourcePath = `modules/lancer-automations/dynamic/${_sanitizeSourcePath(name)}.js`;
    const codeWithSourceURL = trimmed + `\n\n//# sourceURL=${sourcePath}`;

    let fn;
    if (trimmed.startsWith('function') || trimmed.startsWith('async function') || trimmed.startsWith('async (') || trimmed.startsWith('('))
    {
        // Closing `)` MUST be on its own line, otherwise the trailing //# sourceURL comment eats it.
        fn = eval(`(${codeWithSourceURL}\n)`);
    }
    else
    {
        const AsyncFunction = Object.getPrototypeOf(async function ()
        { }).constructor;
        fn = new AsyncFunction(...args, codeWithSourceURL);
    }
    scriptCache.set(cacheKey, fn);
    return fn;
}

// Triggers whose payload carries targets, the only ones React as Target / consumption role can key on.
export const TARGET_CAPABLE_TRIGGERS = new Set([
    'onInitAttack', 'onAttack', 'onHit', 'onMiss', 'onPreDamage', 'onDamage',
    'onInitTechAttack', 'onTechAttack', 'onTechHit', 'onTechMiss',
    'onRoll', 'onCheck', 'onInitCheck', 'onInvoluntaryMove'
]);

const sameTriggerSet = (left, right) => Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every(trigger => right.includes(trigger));

export class ReactionManager
{
    static get ID()
    {
        return "lancer-automations";
    }

    static get SETTING_REACTIONS()
    {
        return "customReactions";
    }

    static get SETTING_GENERAL_REACTIONS()
    {
        return "generalReactions";
    }

    static get SETTING_FOLDERS()
    {
        return "activationFolders";
    }

    static get SETTING_STARTUP_SCRIPTS()
    {
        return "startupScripts";
    }

    static builtinStartups = [];

    static initialize()
    {
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
            config: false,
            type: Boolean,
            default: false,
            requiresReload: true
        });

        game.settings.register(ReactionManager.ID, "enablePersonalStuff", {
            name: "LaSossis's Personal Stuff",
            hint: "My personal bag of tweaks, might not be useful to anyone else.",
            scope: "world",
            config: false,
            type: Boolean,
            default: false,
            requiresReload: true
        });
    }

    static getFolders()
    {
        return game.settings.get(ReactionManager.ID, ReactionManager.SETTING_FOLDERS) || [];
    }

    static async saveFolders(folders)
    {
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_FOLDERS, folders);
    }

    static getStartupScripts()
    {
        return game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
    }

    static async saveStartupScripts(scripts)
    {
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, scripts);
    }

    static async createFolder(name)
    {
        const folders = ReactionManager.getFolders();
        if (folders.some(folder => folder.name === name))
            return;
        folders.push({ name: name, items: [] });
        await ReactionManager.saveFolders(folders);
    }

    static async renameFolder(oldName, newName)
    {
        const folders = ReactionManager.getFolders();
        const folder = folders.find(folder => folder.name === oldName);
        if (folder)
            folder.name = newName;
        await ReactionManager.saveFolders(folders);
    }

    static async deleteFolder(name)
    {
        let folders = ReactionManager.getFolders();
        folders = folders.filter(folder => folder.name !== name);
        await ReactionManager.saveFolders(folders);
    }

    static async assignToFolder(folderName, activationKey)
    {
        const folders = ReactionManager.getFolders();
        for (const folder of folders)
            folder.items = folder.items.filter(itemKey => itemKey !== activationKey);
        const target = folders.find(folder => folder.name === folderName);
        if (target)
            target.items.push(activationKey);
        await ReactionManager.saveFolders(folders);
    }

    static async unassignFromFolder(activationKey)
    {
        const folders = ReactionManager.getFolders();
        for (const folder of folders)
            folder.items = folder.items.filter(itemKey => itemKey !== activationKey);
        await ReactionManager.saveFolders(folders);
    }

    static getAllReactions()
    {
        const defaults = getDefaultItemReactionRegistry();
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const merged = { ...defaults };
        for (const [lid, userEntry] of Object.entries(userSaved))
        {
            const def = defaults[lid];
            if (!def)
            {
                merged[lid] = userEntry;
                continue;
            }
            // Layer user saved over its default so stubs like { enabled: false } inherit triggers/evaluate/etc.
            merged[lid] = {
                ...def,
                ...userEntry,
                reactions: Array.isArray(userEntry.reactions)
                    ? userEntry.reactions.map((userReaction, index) => ({ ...(def.reactions?.[index] ?? {}), ...(userReaction ?? {}) }))
                    : (def.reactions ?? []),
            };
        }
        return merged;
    }

    static getReactions(lid)
    {
        const all = ReactionManager.getAllReactions();
        return all[lid];
    }

    static getGeneralReactions()
    {
        const defaults = getDefaultGeneralReactionRegistry();
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const result = {};
        for (const [name, def] of Object.entries(defaults))
        {
            const saved = userSaved[name];
            if (!saved)
                result[name] = def;
            else if (Array.isArray(def.reactions))
            {
                // Group: a full saved sub replaces its default sub, enabled-only saves just toggle.
                // A legacy flat save applies to the one sub sharing its trigger set.
                const savedSubs = Array.isArray(saved.reactions) ? saved.reactions : null;
                const legacyIdx = (!savedSubs && saved.triggers !== undefined)
                    ? def.reactions.findIndex(sub => sameTriggerSet(sub.triggers, saved.triggers))
                    : -1;
                result[name] = {
                    ...def,
                    reactions: def.reactions.map((subReaction, index) =>
                    {
                        const savedSub = savedSubs ? savedSubs[index] : (index === legacyIdx ? saved : undefined);
                        if (!savedSub)
                            return subReaction;
                        if (savedSub.triggers !== undefined)
                            return savedSub;
                        return savedSub.enabled === undefined ? subReaction : { ...subReaction, enabled: savedSub.enabled };
                    })
                };
            }
            else if (saved.triggers !== undefined)
                result[name] = saved; // full save shadows a flat default
            else
                result[name] = { ...def, ...saved };
        }
        for (const [name, saved] of Object.entries(userSaved))
        {
            if (!(name in defaults))
                result[name] = saved;
        }
        return result;
    }

    static getGeneralReaction(name)
    {
        const generals = ReactionManager.getGeneralReactions();
        return generals[name];
    }

    static async saveGeneralReaction(name, reaction)
    {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        userSaved[name] = reaction;
        clearScriptCache();
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
    }

    static async deleteGeneralReaction(name, index = null)
    {
        const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        if (!userSaved[name])
            return;
        const idx = (index === null || index === undefined || index === '') ? null : Number.parseInt(index);
        const reactions = userSaved[name].reactions;
        const isDefaultGroup = Array.isArray(getDefaultGeneralReactionRegistry()[name]?.reactions);
        if (isDefaultGroup && Number.isFinite(idx) && Array.isArray(reactions) && idx >= 0 && idx < reactions.length)
        {
            // Slots are aligned to the default group's indices, so clear instead of splicing
            reactions[idx] = null;
            if (reactions.every(sub => !sub || Object.keys(sub).length === 0))
                delete userSaved[name];
        }
        else if (Number.isFinite(idx) && Array.isArray(reactions) && reactions.length > 1 && idx >= 0 && idx < reactions.length)
            reactions.splice(idx, 1);
        else
            delete userSaved[name];
        clearScriptCache();
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
    }

    // Legacy export/import stays workshop-agnostic
    static stripWorkshopIds(value)
    {
        if (Array.isArray(value))
            return value.map(entry => ReactionManager.stripWorkshopIds(entry));
        if (value && typeof value === 'object')
        {
            const result = {};
            for (const [key, sub] of Object.entries(value))
            {
                if (key === 'workshopId')
                    continue;
                result[key] = ReactionManager.stripWorkshopIds(sub);
            }
            return result;
        }
        return value;
    }

    static async exportReactions()
    {
        const itemReactions = ReactionManager.stripWorkshopIds(game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {});
        const generalReactions = ReactionManager.stripWorkshopIds(game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {});
        const startupScripts = ReactionManager.stripWorkshopIds((game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [])
            .filter(script => !script.builtin));

        const skip = new Set([
            ReactionManager.SETTING_REACTIONS,
            ReactionManager.SETTING_GENERAL_REACTIONS,
            ReactionManager.SETTING_STARTUP_SCRIPTS,
            ReactionManager.SETTING_FOLDERS,
        ]);
        const settings = {};
        for (const setting of game.settings.settings.values())
        {
            if (setting.namespace !== ReactionManager.ID)
                continue;
            if (skip.has(setting.key))
                continue;
            try
            {
                settings[setting.key] = game.settings.get(ReactionManager.ID, setting.key);
            }
            catch
            { /* skip unreadable */ }
        }

        const externalSettings = {};
        const keybindings = {};
        try
        {
            const mod = await import('../setup/settingsMenus.js');
            for (const { module, key } of (mod.getExportableModuleBooleanFields?.() ?? []))
            {
                if (!game.modules.get(module)?.active)
                    continue;
                try
                {
                    externalSettings[`${module}.${key}`] = game.settings.get(module, key);
                }
                catch
                { /* skip */ }
            }
            for (const { module, key } of (mod.getExportableKeybindingFields?.() ?? []))
            {
                if (module !== ReactionManager.ID && !game.modules.get(module)?.active)
                    continue;
                const bindings = game.keybindings.bindings.get(`${module}.${key}`);
                if (Array.isArray(bindings))
                    keybindings[`${module}.${key}`] = bindings.map(binding => ({ key: binding.key, modifiers: [...(binding.modifiers ?? [])] }));
            }
        }
        catch
        { /* settingsMenus unavailable */ }

        const exportData = {
            version: 2,
            exportDate: new Date().toISOString(),
            itemReactions,
            generalReactions,
            startupScripts,
            settings,
            externalSettings,
            keybindings,
        };

        const jsonStr = JSON.stringify(exportData, null, 2);
        globalThis.saveDataToFile(jsonStr, "application/json", `lancer-automations-${new Date().toISOString().slice(0, 10)}.json`);

        ui.notifications.info("Configuration exported successfully.");
    }

    static async applyImportSelection(data, selection)
    {
        try
        {
            const pickedItem = selection?.itemReactions ?? new Set();
            const pickedGeneral = selection?.generalReactions ?? new Set();
            const pickedStartup = selection?.startupScripts ?? new Set();
            const pickedSettings = selection?.settings ?? new Set();
            const pickedExternal = selection?.externalSettings ?? new Set();

            if (pickedItem.size && data.itemReactions)
            {
                const existing = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
                const merged = { ...existing };
                for (const lid of pickedItem)
                {
                    if (data.itemReactions[lid] !== undefined)
                        merged[lid] = data.itemReactions[lid];
                }
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, merged);
            }

            if (pickedGeneral.size && data.generalReactions)
            {
                const existing = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
                const merged = { ...existing };
                for (const name of pickedGeneral)
                {
                    if (data.generalReactions[name] !== undefined)
                        merged[name] = data.generalReactions[name];
                }
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, merged);
            }

            if (pickedStartup.size && Array.isArray(data.startupScripts))
            {
                const existing = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
                const existingKeys = new Set(existing.map(script => script.id ?? script.name));
                const merged = [...existing];
                for (let i = 0; i < data.startupScripts.length; i++)
                {
                    const script = data.startupScripts[i];
                    const key = script?.id ?? script?.name ?? String(i);
                    if (!pickedStartup.has(String(key)))
                        continue;
                    if (existingKeys.has(key))
                        continue;
                    merged.push(script);
                    existingKeys.add(key);
                }
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, merged);
            }

            if (pickedSettings.size && data.settings)
            {
                for (const settingKey of pickedSettings)
                {
                    if (!(settingKey in data.settings))
                        continue;
                    if (!game.settings.settings.get(`${ReactionManager.ID}.${settingKey}`))
                        continue;
                    try
                    {
                        await game.settings.set(ReactionManager.ID, settingKey, data.settings[settingKey]);
                    }
                    catch (error)
                    {
                        console.warn(`[lancer-automations] failed to restore setting ${settingKey}:`, error);
                    }
                }
            }

            if (pickedExternal.size && data.externalSettings)
            {
                for (const composite of pickedExternal)
                {
                    if (!(composite in data.externalSettings))
                        continue;
                    const dot = composite.indexOf('.');
                    if (dot < 0)
                        continue;
                    const moduleId = composite.slice(0, dot);
                    const settingKey = composite.slice(dot + 1);
                    if (!game.modules.get(moduleId)?.active)
                        continue;
                    if (!game.settings.settings.get(`${moduleId}.${settingKey}`))
                        continue;
                    try
                    {
                        await game.settings.set(moduleId, settingKey, data.externalSettings[composite]);
                    }
                    catch (error)
                    {
                        console.warn(`[lancer-automations] failed to restore ${moduleId}.${settingKey}:`, error);
                    }
                }
            }

            const pickedKeybindings = selection?.keybindings ?? new Set();
            if (pickedKeybindings.size && data.keybindings)
            {
                for (const composite of pickedKeybindings)
                {
                    if (!(composite in data.keybindings))
                        continue;
                    const dot = composite.indexOf('.');
                    if (dot < 0)
                        continue;
                    const moduleId = composite.slice(0, dot);
                    const settingKey = composite.slice(dot + 1);
                    if (moduleId !== ReactionManager.ID && !game.modules.get(moduleId)?.active)
                        continue;
                    if (!game.keybindings.actions.get(`${moduleId}.${settingKey}`))
                        continue;
                    try
                    {
                        await game.keybindings.set(moduleId, settingKey, data.keybindings[composite]);
                    }
                    catch (error)
                    {
                        console.warn(`[lancer-automations] failed to restore keybinding ${moduleId}.${settingKey}:`, error);
                    }
                }
            }

            clearScriptCache();
            ui.notifications.info("Import applied.");
            return true;
        }
        catch (error)
        {
            ui.notifications.error(`Failed to apply import: ${error.message}`);
            return false;
        }
    }
}

export class ReactionConfig extends FormApplication
{
    constructor(object, options)
    {
        super(object, options);
        this._needsReload = false;
    }

    render(force, options)
    {
        if (!game.user?.isGM)
        {
            ui.notifications?.warn?.('The Activation Manager is GM-only.');
            return this;
        }
        return super.render(force, options);
    }

    static get defaultOptions()
    {
        return mergeObject(super.defaultOptions, {
            title: "Activation Manager",
            id: "reaction-manager-config",
            classes: [...super.defaultOptions.classes, 'lancer-dialog-base', 'lancer-no-title'],
            template: `modules/lancer-automations/templates/reaction-config.html`,
            width: 800,
            height: 850,
            resizable: true,
            tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "custom" }]
        });
    }

    async getData()
    {
        const userItemSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const userGeneralSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const defaultGeneralRegistry = getDefaultGeneralReactionRegistry();
        const defaultItemRegistry = getDefaultItemReactionRegistry();

        const defaultList = [];
        const allReactions = [];

        const midsToLookup = new Set([
            ...Object.keys(userItemSettings).map(key => key.trim()),
            ...Object.keys(defaultItemRegistry).map(key => key.trim())
        ]);

        const itemMap = new Map();

        for (const item of game.items)
        {
            const lid = item.system?.lid;
            if (lid && midsToLookup.has(lid))
            {
                itemMap.set(lid, {
                    name: item.name,
                    system: item.system
                });
                midsToLookup.delete(lid);
            }
        }

        // Indices fetched in parallel, cold compendium loads are slow.
        if (midsToLookup.size > 0)
        {
            const itemPacks = game.packs.filter(pack => pack.documentName === "Item");
            const indices = await Promise.all(itemPacks.map(pack => pack.getIndex({
                fields: ["system.lid", "system.actions", "system.ranks", "system.profiles"]
            })));

            for (const index of indices)
            {
                if (midsToLookup.size === 0)
                    break;
                for (const entry of index)
                {
                    const lid = entry.system?.lid;
                    if (lid && midsToLookup.has(lid))
                    {
                        itemMap.set(lid, {
                            name: entry.name,
                            system: entry.system
                        });
                        midsToLookup.delete(lid);
                        if (midsToLookup.size === 0)
                            break;
                    }
                }
            }
        }

        // Leftover keys may be Actor UUIDs rather than item LIDs.
        if (midsToLookup.size > 0)
        {
            for (const key of [...midsToLookup])
            {
                let actor = null;
                if (/^Actor\.[A-Za-z0-9]+$/.test(key))
                    actor = game.actors.get(key.slice('Actor.'.length));
                else if (key.startsWith('Compendium.') && key.includes('.Actor.'))
                {
                    try
                    {
                        actor = /** @type {any} */ (await fromUuid(key));
                    }
                    catch
                    { /* ignore */ }
                }
                if (actor?.documentName === 'Actor')
                {
                    itemMap.set(key, { name: `${actor.name} (Actor)`, system: actor.system });
                    midsToLookup.delete(key);
                }
            }
        }

        const resolveActionName = (itemData, path) =>
        {
            if (!itemData || !path || path === "system.trigger" || path === "system")
                return null;
            try
            {
                const pathParts = path.split(/[.[\]]/).filter(segment => segment !== "");
                let current = itemData;
                for (const part of pathParts)
                {
                    if (current && (typeof current === 'object' || Array.isArray(current)))
                        current = current[part];
                    else
                        return null;
                }
                return current?.name || null;
            }
            catch (error)
            {
                console.warn("lancer-automations | Error resolving action name:", error);
                return null;
            }
        };

        const startEnabled = (reaction) =>
        {
            if (reaction.enabled === undefined)
                reaction.enabled = true;
            return reaction;
        };

        const isPureDefault = (saved, def) =>
        {
            if (!saved || !def)
                return false;
            const savedKeys = Object.keys(saved);
            if (savedKeys.length === 1 && savedKeys[0] === 'enabled')
                return true;
            // Pure enable-toggle: saved keys are only 'enabled', 'reactions' and/or 'workshopId'.
            if (savedKeys.every(savedKey => savedKey === 'enabled' || savedKey === 'reactions' || savedKey === 'workshopId'))
            {
                const reacts = saved.reactions;
                if (!reacts || (Array.isArray(reacts) && reacts.every(sub =>
                {
                    if (!sub)
                        return true;
                    return Object.keys(sub).every(reactionKey => reactionKey === 'enabled' || reactionKey === 'workshopId');
                })))
                    return true;
            }
            const savedClone = foundry.utils.deepClone(saved);
            const defaultClone = foundry.utils.deepClone(def);
            delete savedClone.enabled;
            delete savedClone.workshopId;
            delete defaultClone.enabled;
            return foundry.utils.objectsEqual(savedClone, defaultClone);
        };

        // Grouping: custom items
        for (const [rawLid, itemEntry] of Object.entries(userItemSettings))
        {
            const lid = rawLid.trim();
            const validReactions = [];

            itemEntry.reactions.forEach((reaction, index) =>
            {
                const reactionKeys = Object.keys(reaction);
                if (reactionKeys.length === 1 && reactionKeys[0] === 'enabled')
                    return;

                const defItem = defaultItemRegistry[lid]?.reactions?.find(defReaction => defReaction.name === reaction.name);
                if (defItem && isPureDefault(reaction, defItem))
                    return;

                const itemInfo = itemMap.get(lid);
                let displayName = reaction.name || rawLid;
                let displaySubname = rawLid;

                if (itemInfo)
                {
                    const actionName = resolveActionName(itemInfo.system, reaction.reactionPath);
                    if (actionName)
                        displayName = `${itemInfo.name}: ${actionName}`;
                    else
                        displayName = itemInfo.name;
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
                    comments: reaction.comments || "",
                    workshopId: reaction.workshopId || null
                }));
            });

            if (validReactions.length === 0)
                continue;

            if (validReactions.length === 1)
                allReactions.push(validReactions[0]);
            else
            {
                const first = validReactions[0];
                const uniqueTriggers = [...new Set(validReactions.flatMap(reaction => reaction.triggers.split(", ")))].filter(Boolean).join(", ");
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
                    enabled: validReactions.every(reaction => reaction.enabled)
                });
            }
        }

        // Grouping: default items
        for (const [lid, itemConfig] of Object.entries(defaultItemRegistry))
        {
            const validReactions = [];
            itemConfig.reactions.forEach((reaction, index) =>
            {
                const userEntry = userItemSettings[lid]?.reactions?.[index] ||
                    userItemSettings[lid]?.reactions?.find(userReaction => userReaction.name === reaction.name);
                const isPure = isPureDefault(userEntry, reaction);
                const isOverridden = !!userEntry && !isPure;
                const enabledState = isPure ? userEntry.enabled : (userEntry?.enabled ?? reaction.enabled);

                const itemInfo = itemMap.get(lid);
                let displayName = reaction.name || lid;
                let displaySubname = lid;

                if (itemInfo)
                {
                    const actionName = resolveActionName(itemInfo.system, reaction.reactionPath);
                    if (actionName)
                        displayName = `${itemInfo.name}: ${actionName}`;
                    else
                        displayName = itemInfo.name;
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
                    category: itemConfig.category || "",
                    comments: reaction.comments || ""
                }));
            });

            if (validReactions.length === 0)
                continue;

            if (validReactions.length === 1)
                defaultList.push(validReactions[0]);
            else
            {
                const first = validReactions[0];
                const uniqueTriggers = [...new Set(validReactions.flatMap(reaction => reaction.triggers.split(", ")))].filter(Boolean).join(", ");
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
                    enabled: validReactions.every(reaction => reaction.enabled),
                    category: itemConfig.category || ""
                });
            }
        }

        // Grouping: custom general reactions
        for (const [name, reaction] of Object.entries(userGeneralSettings))
        {
            const def = defaultGeneralRegistry[name];
            if (def && isPureDefault(reaction, def))
                continue;

            if (Array.isArray(def?.reactions) && Array.isArray(reaction.reactions))
            {
                // Per-sub overrides of a grouped default: one row per fully saved sub
                reaction.reactions.forEach((savedSub, index) =>
                {
                    if (!savedSub || savedSub.triggers === undefined)
                        return;
                    allReactions.push(startEnabled({
                        name: name,
                        lid: null,
                        triggers: [...(savedSub.triggers || []), ...(savedSub.onInit ? ["onInit"] : [])].join(", "),
                        isGeneral: true,
                        isCustom: true,
                        onlyOnSourceMatch: savedSub.onlyOnSourceMatch || false,
                        reactionIndex: index,
                        original: savedSub,
                        enabled: savedSub.enabled,
                        comments: savedSub.comments || "",
                        workshopId: savedSub.workshopId || null
                    }));
                });
                continue;
            }

            allReactions.push(startEnabled({
                name: name,
                lid: null,
                triggers: [...(reaction.triggers || []), ...(reaction.onInit ? ["onInit"] : [])].join(", "),
                isGeneral: true,
                isCustom: true,
                onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
                original: reaction,
                enabled: reaction.enabled,
                comments: reaction.comments || "",
                workshopId: reaction.workshopId || null
            }));
        }

        // Grouping: default general reactions
        for (const [name, reaction] of Object.entries(defaultGeneralRegistry))
        {
            const userSaved = userGeneralSettings[name];

            if (Array.isArray(reaction.reactions))
            {
                const savedSubs = Array.isArray(userSaved?.reactions) ? userSaved.reactions : null;
                const legacyIdx = (!savedSubs && userSaved?.triggers !== undefined)
                    ? reaction.reactions.findIndex(sub => sameTriggerSet(sub.triggers, userSaved.triggers))
                    : -1;
                const validReactions = reaction.reactions.map((subReaction, index) =>
                {
                    const enabledState = savedSubs?.[index]?.enabled ?? subReaction.enabled ?? reaction.enabled;
                    return startEnabled({
                        name: name,
                        lid: null,
                        triggers: [...(subReaction.triggers || []), ...(subReaction.onInit ? ["onInit"] : [])].join(", "),
                        isGeneral: true,
                        isDefault: true,
                        isOverridden: savedSubs?.[index]?.triggers !== undefined || index === legacyIdx,
                        onlyOnSourceMatch: subReaction.onlyOnSourceMatch || false,
                        reactionIndex: index,
                        original: subReaction,
                        enabled: enabledState,
                        category: reaction.category || "",
                        comments: subReaction.comments || ""
                    });
                });

                if (validReactions.length === 1)
                    defaultList.push(validReactions[0]);
                else
                {
                    const uniqueTriggers = [...new Set(validReactions.flatMap(validReaction => validReaction.triggers.split(", ")))].filter(Boolean).join(", ");
                    defaultList.push({
                        name: name,
                        lid: null,
                        triggers: uniqueTriggers,
                        isGeneral: true,
                        isDefault: true,
                        isGroup: true,
                        reactions: validReactions,
                        enabled: validReactions.every(validReaction => validReaction.enabled),
                        category: reaction.category || ""
                    });
                }
            }
            else
            {
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

        const sorter = (left, right) =>
        {
            if (left.isGeneral !== right.isGeneral)
                return right.isGeneral - left.isGeneral;
            return left.name.localeCompare(right.name);
        };

        allReactions.sort(sorter);
        defaultList.sort(sorter);

        const categoryMap = new Map();
        for (const item of defaultList)
        {
            const cat = item.category || "Other";
            if (!categoryMap.has(cat))
                categoryMap.set(cat, []);
            categoryMap.get(cat).push(item);
        }
        const defaultFolders = [];
        for (const [catName, items] of categoryMap)
        {
            defaultFolders.push({
                folderName: catName,
                isFolder: true,
                items: items
            });
        }
        defaultFolders.sort((left, right) =>
        {
            if (left.folderName === "General")
                return -1;
            if (right.folderName === "General")
                return 1;
            return left.folderName.localeCompare(right.folderName);
        });

        const folderSettings = ReactionManager.getFolders();
        const getActivationKey = (activation) => activation.isGeneral ? `general::${activation.name}` : `item::${activation.lid}`;

        const assignedKeys = new Set();
        const customFolders = folderSettings.map(folder =>
        {
            const keySet = new Set(folder.items || []);
            const folderItems = allReactions.filter(reaction => keySet.has(getActivationKey(reaction)));
            folderItems.forEach(reaction => assignedKeys.add(getActivationKey(reaction)));
            return {
                folderName: folder.name,
                isFolder: true,
                items: folderItems
            };
        });

        const unfiledReactions = allReactions.filter(reaction => !assignedKeys.has(getActivationKey(reaction)));

        // for the trigger filter dropdown
        const allTriggerSet = new Set();
        for (const activation of [...allReactions, ...defaultList])
        {
            const trigStr = activation.triggers || "";
            trigStr.split(", ").filter(Boolean).forEach(trigger => allTriggerSet.add(trigger.trim()));
            if (activation.reactions)
            {
                activation.reactions.forEach(sub =>
                {
                    const subTrig = sub.triggers || "";
                    subTrig.split(", ").filter(Boolean).forEach(trigger => allTriggerSet.add(trigger.trim()));
                });
            }
        }
        const allTriggers = [...allTriggerSet].sort((left, right) => left.localeCompare(right));

        const userScripts = ReactionManager.getStartupScripts();
        const startupScripts = [
            ...ReactionManager.builtinStartups.map(script => ({ ...script, builtin: true })),
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

    activateListeners(html)
    {
        super.activateListeners(html);
        html.find('.add-reaction').click(this._onAddReaction.bind(this));
        html.find('.edit-reaction').click(this._onEditReaction.bind(this));
        html.find('.delete-reaction').click(this._onDeleteReaction.bind(this));
        html.find('.copy-default').click(this._onCopyDefault.bind(this));
        html.find('.reaction-enabled').change(this._onToggleEnabled.bind(this));
        html.find('.help-btn').click(this._onHelp.bind(this));
        html.find('.item-find-btn').click(async () =>
        {
            const result = await openItemBrowserDialog();
            if (result?.lid)
            {
                try
                {
                    await navigator.clipboard.writeText(result.lid);
                    ui.notifications.info(`Copied LID: ${result.lid}`);
                }
                catch
                {
                    ui.notifications.info(`LID: ${result.lid}`);
                }
            }
        });
        html.find('.add-script').click(this._onAddScript.bind(this));
        html.find('.edit-script').click(this._onEditScript.bind(this));
        html.find('.delete-script').click(this._onDeleteScript.bind(this));
        html.find('.script-enabled').change(this._onToggleScript.bind(this));

        html.find('.group-header').click((ev) =>
        {
            ev.preventDefault();
            const header = $(ev.currentTarget);
            const icon = header.find('.expand-icon');
            const sublist = header.next('.reaction-sublist');

            if (sublist.is(':visible'))
            {
                sublist.slideUp(200);
                icon.removeClass('fa-caret-down').addClass('fa-caret-right');
            }
            else
            {
                sublist.slideDown(200);
                icon.removeClass('fa-caret-right').addClass('fa-caret-down');
            }
        });

        html.find('.folder-header').click((ev) =>
        {
            ev.preventDefault();
            const header = $(ev.currentTarget);
            const icon = header.find('.folder-expand-icon');
            const content = header.next('.folder-content');

            if (content.is(':visible'))
            {
                content.slideUp(200);
                icon.removeClass('fa-folder-open').addClass('fa-folder');
            }
            else
            {
                content.slideDown(200);
                icon.removeClass('fa-folder').addClass('fa-folder-open');
            }
        });

        const applyFilters = (container) =>
        {
            const searchInput = container.find('.search-input');
            const triggerFilter = container.find('.trigger-filter');
            const scrollable = container.find('.scrollable');

            const searchVal = String(searchInput.val() || '').toLowerCase();
            const triggerVal = triggerFilter.val() || '';

            // For folder-based (defaults) tab
            scrollable.find('.category-folder').each(function ()
            {
                const folder = $(this);
                let anyVisible = false;

                folder.find('.reaction-item:not(.group-header):not(.folder-header)').each(function ()
                {
                    const item = $(this);
                    const name = (item.data('name') || '').toString().toLowerCase();
                    const lid = (item.data('lid') || '').toString().toLowerCase();
                    const triggers = (item.find('.col-triggers').text() || '').toLowerCase();

                    const matchesSearch = !searchVal || name.includes(searchVal) || lid.includes(searchVal);
                    const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                    if (matchesSearch && matchesTrigger)
                    {
                        item.show();
                        anyVisible = true;
                    }
                    else
                        item.hide();
                });

                folder.find('.reaction-group-container').each(function ()
                {
                    const group = $(this);
                    const groupHeader = group.find('.group-header');
                    const name = (groupHeader.data('name') || '').toString().toLowerCase();
                    const triggers = (groupHeader.find('.col-triggers').text() || '').toLowerCase();

                    const matchesSearch = !searchVal || name.includes(searchVal);
                    const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                    if (matchesSearch && matchesTrigger)
                    {
                        group.show();
                        anyVisible = true;
                    }
                    else
                        group.hide();
                });

                if (anyVisible)
                    folder.show();
                else
                    folder.hide();
            });

            // For non-folder items (custom tab)
            scrollable.find('> .reaction-item, > .reaction-group-container').each(function ()
            {
                const el = $(this);
                const name = (el.data('name') || el.find('.group-header').data('name') || '').toString().toLowerCase();
                const lid = (el.data('lid') || el.find('.group-header').data('lid') || '').toString().toLowerCase();
                const triggers = (el.find('.col-triggers').first().text() || '').toLowerCase();

                const matchesSearch = !searchVal || name.includes(searchVal) || lid.includes(searchVal);
                const matchesTrigger = !triggerVal || triggers.includes(triggerVal.toLowerCase());

                if (matchesSearch && matchesTrigger)
                    el.show();
                else
                    el.hide();
            });
        };

        html.find('.search-input').on('input', function ()
        {
            const container = $(this).closest('.tab');
            applyFilters(container);
        });

        html.find('.trigger-filter').on('change', function ()
        {
            const container = $(this).closest('.tab');
            applyFilters(container);
        });

        const buildByTriggerView = (container) =>
        {
            const list = container.find('.reaction-list');
            let byTrigger = list.find('.scrollable-by-trigger');
            if (byTrigger.length)
                byTrigger.empty();
            else
                byTrigger = $('<div class="scrollable scrollable-by-trigger" style="display: none;"></div>').appendTo(list);

            const groups = new Map();
            list.find('.scrollable .reaction-item:not(.group-header):not(.folder-header)').each(function ()
            {
                const row = $(this);
                const triggers = (row.find('.col-triggers').text() || '').split(',').map(triggerName => triggerName.trim()).filter(Boolean);
                if (triggers.length === 0)
                    triggers.push('(no trigger)');
                for (const trig of triggers)
                {
                    if (!groups.has(trig))
                        groups.set(trig, []);
                    groups.get(trig).push(row);
                }
            });

            const sortedTriggers = [...groups.keys()].sort();
            for (const trig of sortedTriggers)
            {
                const rows = groups.get(trig);
                const groupEl = $(`
                    <div class="trigger-group" data-trigger="${trig}">
                        <div class="reaction-item flexrow folder-header" style="background: rgba(120, 46, 34, 0.15);">
                            <span class="col-enabled" style="flex: 0.15;"><i class="fas fa-bolt"></i></span>
                            <span class="col-type" style="flex: 0.3;"></span>
                            <span class="col-name" style="flex: 4;"><strong>${trig}</strong>
                                <span style="font-size: 0.8em; color: #888; margin-left: 5px;">(${rows.length})</span>
                            </span>
                            <span class="col-triggers" style="flex: 1;"></span>
                            <span class="col-controls" style="flex: 0.5;"></span>
                        </div>
                    </div>
                `);
                for (const row of rows)
                    groupEl.append(row.clone(true, true));
                byTrigger.append(groupEl);
            }
        };

        html.find('.group-by-trigger-toggle').on('click', function ()
        {
            const btn = $(this);
            const container = btn.closest('.tab');
            const list = container.find('.reaction-list');
            const original = list.find('.scrollable').not('.scrollable-by-trigger').first();
            const isOn = btn.hasClass('active');
            if (isOn)
            {
                btn.removeClass('active');
                list.find('.scrollable-by-trigger').hide();
                original.show();
            }
            else
            {
                btn.addClass('active');
                buildByTriggerView(container);
                original.hide();
                list.find('.scrollable-by-trigger').show();
            }
        });

        const self = this;
        html.find('.create-folder-btn').click(async () =>
        {
            const name = await new Promise(resolve =>
            {
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
                            callback: (dlg) => resolve(String(dlg.find('[name=folderName]').val() ?? '').trim())
                        },
                        cancel: {
                            label: "Cancel",
                            icon: '<i class="fas fa-times"></i>',
                            callback: () => resolve(null)
                        }
                    },
                    default: "ok"
                }, { classes: ["lancer-automations-dialog", 'lancer-dialog-base', 'lancer-no-title'] }).render(true);
            });
            if (name)
            {
                await ReactionManager.createFolder(name);
                self.render();
            }
        });

        html.find('.export-pack-btn').click(async () =>
        {
            const mod = await import('./reaction-export-import.js');
            mod.openPackExport();
        });

        html.find('.import-pack-btn').click(async () =>
        {
            const mod = await import('./reaction-export-import.js');
            mod.openPackImport(() => self.render());
        });

        const workshopRoot = html.find('.tab[data-tab="workshop"] .la-workshop-root')[0];
        if (workshopRoot)
        {
            const bootWorkshop = async () =>
            {
                const mod = await import('./workshop-browser.js');
                mod.renderWorkshopTab(self, workshopRoot);
            };
            html.find('nav.sheet-tabs a[data-tab="workshop"]').on('click', bootWorkshop);
            if (this._tabs?.[0]?.active === 'workshop')
                bootWorkshop();
        }

        html.find('.rename-folder-btn').click(async function (ev)
        {
            ev.stopPropagation();
            const oldName = $(this).closest('.category-folder').data('folder');
            const newName = await new Promise(resolve =>
            {
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
                            callback: (dlg) => resolve(String(dlg.find('[name=folderName]').val() ?? '').trim())
                        },
                        cancel: {
                            label: "Cancel",
                            icon: '<i class="fas fa-times"></i>',
                            callback: () => resolve(null)
                        }
                    },
                    default: "ok"
                }, { classes: ["lancer-automations-dialog", 'lancer-dialog-base', 'lancer-no-title'] }).render(true);
            });
            if (newName && newName !== oldName)
            {
                await ReactionManager.renameFolder(oldName, newName);
                self.render();
            }
        });

        html.find('.delete-folder-btn').click(async function (ev)
        {
            ev.stopPropagation();
            const folderName = $(this).closest('.category-folder').data('folder');
            const result = await new Promise(resolve =>
            {
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
                }, { classes: ["lancer-automations-dialog", 'lancer-dialog-base', 'lancer-no-title'] }).render(true);
            });
            if (!result)
                return;

            if (result === "all")
            {
                const folders = ReactionManager.getFolders();
                const folder = folders.find(entry => entry.name === folderName);
                if (folder)
                {
                    for (const key of folder.items)
                    {
                        if (key.startsWith("general::"))
                        {
                            const name = key.replace("general::", "");
                            await ReactionManager.deleteGeneralReaction(name);
                        }
                        else if (key.startsWith("item::"))
                        {
                            const lid = key.replace("item::", "");
                            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);
                            if (userReactions[lid])
                            {
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

        const customTab = html.find('[data-tab="custom"]');

        customTab.find('.reaction-item:not(.group-header):not(.folder-header)').attr('draggable', 'true');
        customTab.find('.reaction-group-container').attr('draggable', 'true');

        customTab.on('dragstart', '.reaction-item[draggable="true"], .reaction-group-container[draggable="true"]', function (ev)
        {
            const el = $(this);
            const isGeneral = el.data('is-general') === true || el.data('is-general') === 'true';
            const lid = el.data('lid');
            const name = el.data('name');
            const key = isGeneral ? `general::${name}` : `item::${lid}`;
            ev.originalEvent.dataTransfer.setData('text/plain', key);
            el.addClass('dragging');
        });

        customTab.on('dragend', '.reaction-item, .reaction-group-container', function ()
        {
            $(this).removeClass('dragging');
            customTab.find('.drag-over').removeClass('drag-over');
        });

        customTab.on('dragover', '.folder-header, .unfiled-header', function (ev)
        {
            ev.preventDefault();
            $(this).addClass('drag-over');
        });

        customTab.on('dragleave', '.folder-header, .unfiled-header', function ()
        {
            $(this).removeClass('drag-over');
        });

        customTab.on('drop', '.folder-header', async function (ev)
        {
            ev.preventDefault();
            $(this).removeClass('drag-over');
            const key = ev.originalEvent.dataTransfer.getData('text/plain');
            const folderName = $(this).closest('.category-folder').data('folder');
            if (key && folderName)
            {
                await ReactionManager.assignToFolder(folderName, key);
                self.render();
            }
        });

        customTab.on('drop', '.unfiled-header', async function (ev)
        {
            ev.preventDefault();
            $(this).removeClass('drag-over');
            const key = ev.originalEvent.dataTransfer.getData('text/plain');
            if (key)
            {
                await ReactionManager.unassignFromFolder(key);
                self.render();
            }
        });
    }

    _onHelp(event)
    {
        event.preventDefault();
        const content = /*html*/`
        <div style="font-family: 'Roboto', sans-serif; line-height: 1.5;">
            <p>This system got bigger to a point I can't explain it in a few words.</p>
            <p>As always the main reference is the <a href="https://agraael.github.io/lancer-automations/">documentation</a> and the <a href="https://agraael.github.io/lancer-automations/API_REFERENCE.html">API reference</a>.</p>
            <p>You can ask me questions if you don't understand something on <a href="https://discord.com/channels/426286410496999425/1436087781666455642">discord</a>.</p>
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
        }, { width: 500, classes: ["lancer-automations-dialog", 'lancer-dialog-base', 'lancer-no-title'] }).render(true);
    }

    async _onAddReaction(event)
    {
        new ReactionEditor({}).render(true);
    }

    async _onEditReaction(event)
    {
        event.preventDefault();
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";

        if (isGeneral)
        {
            const name = li.data("name");
            const rawIndex = li.data("index");
            const parsed = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? NaN : Number.parseInt(rawIndex);
            const generals = ReactionManager.getGeneralReactions();
            const entry = generals[name];
            if (!entry)
                return;
            let reaction;
            let reactionIndex;
            if (Array.isArray(entry.reactions))
            {
                if (Number.isFinite(parsed))
                {
                    reaction = entry.reactions[parsed];
                    reactionIndex = parsed;
                }
                else
                {
                    // Legacy flat save over a grouped default: open the save, aimed at its trigger-matched sub
                    const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
                    reaction = (userSaved[name]?.triggers !== undefined) ? userSaved[name] : entry;
                    const legacyIdx = entry.reactions.findIndex(sub => sameTriggerSet(sub.triggers, reaction.triggers));
                    reactionIndex = legacyIdx >= 0 ? legacyIdx : undefined;
                }
            }
            else
                reaction = entry;
            if (!reaction)
                return;
            new ReactionEditor({ isGeneral: true, name, reaction, reactionIndex }).render(true);
        }
        else
        {
            const lid = li.data("lid");
            const rawIndex = li.data("index");
            const parsed = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? 0 : Number.parseInt(rawIndex);
            const reactionIndex = Number.isFinite(parsed) ? parsed : 0;
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry || !Array.isArray(entry.reactions))
                return;
            const reaction = entry.reactions[reactionIndex];
            if (!reaction)
                return;
            new ReactionEditor({ isGeneral: false, lid, reaction, reactionIndex }).render(true);
        }
    }

    async _onDeleteReaction(event)
    {
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";
        const rawIndex = li.data("index");
        const index = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? null : Number.parseInt(rawIndex);

        if (isGeneral)
        {
            const name = li.data("name");
            await ReactionManager.deleteGeneralReaction(name, index);
        }
        else
        {
            const lid = li.data("lid");
            const userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
            const entry = userReactions[lid];
            if (entry)
            {
                const reactions = entry.reactions;
                if (Number.isFinite(index) && Array.isArray(reactions) && reactions.length > 1 && index >= 0 && index < reactions.length)
                    reactions.splice(index, 1);
                else
                    delete userReactions[lid];
                await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userReactions);
            }
        }
        clearScriptCache();
        this.render();
    }

    async _onCopyDefault(event)
    {
        const li = $(event.currentTarget).closest(".reaction-item");
        const lid = li.data("lid");
        const name = li.data("name");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";
        const index = li.data("index");

        if (isGeneral)
        {
            const defaultEntry = getDefaultGeneralReactionRegistry()[name];
            if (!defaultEntry)
                return;
            const parsed = (index === undefined || index === null || index === '') ? NaN : Number.parseInt(index);
            const isSub = Array.isArray(defaultEntry.reactions) && Number.isFinite(parsed);
            const reaction = isSub
                ? foundry.utils.deepClone(defaultEntry.reactions[parsed])
                : foundry.utils.deepClone(defaultEntry);
            if (!reaction)
                return;
            new ReactionEditor({ isGeneral: true, name, reaction, reactionIndex: isSub ? parsed : undefined }).render(true);
        }
        else
        {
            const all = ReactionManager.getAllReactions();
            const entry = all[lid];
            if (!entry || !Array.isArray(entry.reactions))
                return;
            const parsed = (index === undefined || index === null || index === '') ? 0 : Number.parseInt(index);
            const reactionIndex = Number.isFinite(parsed) ? parsed : 0;
            const src = entry.reactions[reactionIndex];
            if (!src)
                return;
            const reaction = foundry.utils.deepClone(src);
            new ReactionEditor({ isGeneral: false, lid, reaction }).render(true);
        }
    }

    async _onToggleEnabled(event)
    {
        const checkbox = event.currentTarget;
        const li = $(checkbox).closest(".reaction-item");
        const checked = checkbox.checked;
        const isGeneral = li.attr("data-is-general") === "true";

        if (isGeneral)
        {
            const name = li.data("name");
            const index = li.data("index");
            const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};

            if (!userSaved[name])
                userSaved[name] = {};

            const subIndex = (index === undefined || index === null || index === '') ? NaN : Number.parseInt(index);
            if (Number.isFinite(subIndex))
            {
                if (!Array.isArray(userSaved[name].reactions))
                    userSaved[name].reactions = [];
                if (!userSaved[name].reactions[subIndex])
                    userSaved[name].reactions[subIndex] = {};
                userSaved[name].reactions[subIndex].enabled = checked;
            }
            else
                userSaved[name].enabled = checked;
            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
        }
        else
        {
            const lid = li.data("lid");
            const rawIndex = li.data("index");
            const reactionIndex = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? 0 : Number.parseInt(rawIndex);
            if (!Number.isFinite(reactionIndex))
                return;
            const userItemSettings = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};

            if (userItemSettings[lid])
            {
                if (!Array.isArray(userItemSettings[lid].reactions))
                    userItemSettings[lid].reactions = [];
                if (!userItemSettings[lid].reactions[reactionIndex])
                    userItemSettings[lid].reactions[reactionIndex] = {};
                userItemSettings[lid].reactions[reactionIndex].enabled = checked;
            }
            else
            {
                const defaults = getDefaultItemReactionRegistry();
                if (defaults[lid])
                {
                    userItemSettings[lid] = {
                        itemType: defaults[lid].itemType,
                        reactions: defaults[lid].reactions.map((defaultReaction, idx) =>
                            idx === reactionIndex ? { enabled: checked } : { enabled: defaultReaction.enabled !== false }
                        )
                    };
                }
            }
            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, userItemSettings);
        }
        clearScriptCache();
    }

    _onAddScript(event)
    {
        event.preventDefault();
        this._openScriptEditor(null);
    }

    _onEditScript(event)
    {
        event.preventDefault();
        const li = $(event.currentTarget).closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const script = scripts.find(entry => entry.id === id)
            || (ReactionManager.builtinStartups || []).find(entry => entry.id === id);
        if (!script)
            return;
        this._openScriptEditor(script);
    }

    async _onDeleteScript(event)
    {
        event.preventDefault();
        const li = $(event.currentTarget).closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const idx = scripts.findIndex(script => script.id === id);
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

    async _onToggleScript(event)
    {
        const checkbox = $(event.currentTarget);
        const li = checkbox.closest('.script-item');
        const id = li.data('id');
        const scripts = ReactionManager.getStartupScripts();
        const script = scripts.find(entry => entry.id === id);
        if (!script)
            return;
        script.enabled = checkbox.prop('checked');
        await ReactionManager.saveStartupScripts(scripts);
        this._needsReload = true;
    }

    _openScriptEditor(script)
    {
        new StartupScriptEditor({ script, manager: this }).render(true);
    }

    async _updateObject(event, formData)
    {}

    async close(options = {})
    {
        if (this._needsReload)
        {
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

export class StartupScriptEditor extends FormApplication
{
    constructor(object, options)
    {
        super(object, options);
        this._codeEditor = null;
    }

    static get defaultOptions()
    {
        return mergeObject(super.defaultOptions, {
            title: "Startup Script",
            id: "startup-script-editor",
            template: `modules/lancer-automations/templates/startup-script-editor.html`,
            width: 700,
            height: 580,
            resizable: true,
            classes: ["lancer-reaction-editor", "lancer-dialog-base", "lancer-no-title"]
        });
    }

    get title()
    {
        const script = this.object?.script;
        if (!script)
            return "New Startup Script";
        return script.builtin ? `View: ${script.name}` : `Edit: ${script.name}`;
    }

    async getData()
    {
        const script = this.object?.script;
        return {
            id: script?.id ?? foundry.utils.randomID(),
            name: script?.name ?? "",
            description: script?.description ?? "",
            enabled: script?.enabled !== false,
            code: script?.code ?? "",
            builtin: !!script?.builtin,
            workshopId: script?.workshopId ?? "",
            workshopPreview: this.object?.workshopPreview === true
        };
    }

    activateListeners(html)
    {
        super.activateListeners(html);

        const isBuiltin = !!this.object?.script?.builtin;
        const host = html.find('.sse-codemirror-host')[0];
        const textarea = html.find('textarea[name="code"]')[0];
        if (host && typeof CodeMirror !== 'undefined')
        {
            const initialValue = textarea?.value ?? "";
            this._codeEditor = CodeMirror(host, {
                value: initialValue,
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                matchBrackets: true,
                styleActiveLine: true,
                indentUnit: 4,
                lineWrapping: false,
                scrollbarStyle: 'native',
                readOnly: isBuiltin
            });
            if (!isBuiltin)
            {
                this._codeEditor.on('change', (cm) =>
                {
                    if (textarea)
                        textarea.value = cm.getValue();
                });
                installLancerHints(this._codeEditor, 'startup');
            }
            const fit = () =>
            {
                if (!this._codeEditor || !host?.isConnected)
                    return;
                const height = host.clientHeight;
                if (height <= 0)
                    return;
                this._codeEditor.setSize('100%', height);
                const cmEl = host.querySelector('.CodeMirror');
                if (cmEl)
                    cmEl.style.setProperty('height', height + 'px', 'important');
                this._codeEditor.refresh();
            };
            requestAnimationFrame(() => requestAnimationFrame(fit));
            const resizeObserver = new ResizeObserver(fit);
            resizeObserver.observe(host);
            this._codeEditorRO = resizeObserver;
        }
    }

    async close(options)
    {
        try
        {
            this._codeEditorRO?.disconnect?.();
        }
        catch
        { /* ignore */ }
        return super.close(options);
    }

    async _updateObject(event, formData)
    {
        if (this.object?.script?.builtin)
            return;

        const id = formData.id ?? foundry.utils.randomID();
        const name = (formData.name ?? "").trim();
        if (!name)
        {
            ui.notifications.warn('Script name is required.');
            throw new Error('Script name is required.');
        }

        const entry = {
            id,
            name,
            description: (formData.description ?? "").trim(),
            enabled: !!formData.enabled,
            code: formData.code ?? ""
        };
        if (formData.workshopId)
            entry.workshopId = formData.workshopId;

        const scripts = ReactionManager.getStartupScripts();
        const isNew = !this.object?.script && !entry.workshopId;
        if (isNew)
            scripts.push(entry);
        else
        {
            const idx = scripts.findIndex(script => script.id === id || (entry.workshopId && script.workshopId === entry.workshopId));
            if (idx >= 0)
                scripts[idx] = entry;
            else
                scripts.push(entry);
        }

        await ReactionManager.saveStartupScripts(scripts);
        if (this.object?.manager)
        {
            this.object.manager._needsReload = true;
            this.object.manager.render();
        }
    }
}

export class ReactionEditor extends FormApplication
{

    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            title: "Edit Activation",
            id: "reaction-editor",
            template: `modules/lancer-automations/templates/reaction-editor.html`,
            width: 800,
            height: 1100,
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
            onPreStatusApplied: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, allowConfirm, userIdControl), canTriggerReaction}",
            onPreStatusRemoved: "{ triggeringToken, statusId, effect, cancelChange(reasonText, title, allowConfirm, userIdControl), canTriggerReaction}",
            onStatusApplied: "{ triggeringToken, statusId, effect, distanceToTrigger, canTriggerReaction}",
            onStatusRemoved: "{ triggeringToken, statusId, effect, distanceToTrigger, canTriggerReaction}",
            onPreStructure: "{ triggeringToken, remainingStructure, cancelStructure(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onStructure: "{ triggeringToken, remainingStructure, rollResult, rollDice, cancelStructureOutcome(reasonText, title, allowConfirm, userIdControl), modifyRoll(newTotal), flowState, distanceToTrigger, canTriggerReaction}",
            onPreStress: "{ triggeringToken, remainingStress, cancelStress(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onStress: "{ triggeringToken, remainingStress, rollResult, rollDice, cancelStressOutcome(reasonText, title, allowConfirm, userIdControl), modifyRoll(newTotal), flowState, distanceToTrigger, canTriggerReaction}",
            onHeatGain: "{ triggeringToken, heatChange, currentHeat, inDangerZone, distanceToTrigger, canTriggerReaction}",
            onDestroyed: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
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
            onInitActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, cancelAction(reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onActivation: "{ triggeringToken, actionType, actionName, item, actionData, deployable, reactionJustConsumed, endActivation, extraData, flowState, distanceToTrigger, canTriggerReaction}",
            onPreHpChange: "{ triggeringToken, previousHP, newHP, delta, cancelHpChange(reasonText, title, allowConfirm, userIdControl), modifyHpChange(newValue, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onHpGain: "{ triggeringToken, hpChange, currentHP, maxHP, distanceToTrigger, canTriggerReaction}",
            onHpLoss: "{ triggeringToken, hpLost, currentHP, distanceToTrigger, canTriggerReaction}",
            onPreHeatChange: "{ triggeringToken, previousHeat, newHeat, delta, cancelHeatChange(reasonText, title, allowConfirm, userIdControl), modifyHeatChange(newValue, reasonText, allowConfirm, userIdControl, preConfirm, postChoice), distanceToTrigger, canTriggerReaction}",
            onHeatLoss: "{ triggeringToken, heatCleared, currentHeat, distanceToTrigger, canTriggerReaction}",
            onInvoluntaryMove: "{ triggeringToken, token, distance, actionName, item, destination: {x,y}, cancel(reason), distanceToTrigger, canTriggerReaction}",
            onRoll: "{ triggeringToken, rollType: 'attackRoll'|'techAttackRoll'|'damageRoll'|'skillRoll'|'structureRoll'|'stressRoll', roll, total, success, targets, item, isReroll, rerollCount, hitTokens, reroll(reasonText, subtype, title, allowConfirm, userIdControl), changeRoll(newTotal, reasonText, title, allowConfirm, userIdControl), flowState, distanceToTrigger, canTriggerReaction}",
            onDeploy: "{ triggeringToken, item, deployedTokens, deployType, distanceToTrigger, canTriggerReaction}",
            onUpdate: "{ triggeringToken, document, change, options, canTriggerReaction}",
            onEnterCombat: "{ triggeringToken, distanceToTrigger, canTriggerReaction}",
            onExitCombat: "{ triggeringToken, distanceToTrigger, canTriggerReaction}"
        };

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
            outOfCombat: reaction.outOfCombat === true,
            autoActivate: reaction.autoActivate || false,
            awaitActivationCompletion: reaction.awaitActivationCompletion ?? (reaction.autoActivate ?? false),
            onlyOnSourceMatch: reaction.onlyOnSourceMatch || false,
            sceneReactor: reaction.sceneReactor || "off",
            sceneId: reaction.sceneId || "",
            sceneOptions: game.scenes.map(scene => ({ id: scene.id, name: scene.name })).sort((left, right) => left.name.localeCompare(right.name)),
            triggers: this._getTriggerOptions(reaction.triggers || []),
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
            checkReaction: reaction.checkReaction !== false,
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
                const isGeneral = html.find('#isGeneral').prop('checked');
                const name = isGeneral ? String(html.find('input[name="name"]').val() || "") : "";
                const lid = isGeneral ? name : String(html.find('input[name="lid"]').val() || "");
                const payload = { isGeneral, lid, name, reaction };
                await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                ui.notifications.info("Activation copied to clipboard.");
            }
            catch (error)
            {
                ui.notifications.error("Failed to copy to clipboard.");
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
                    ui.notifications.error(`${entry.role}: ${error.message}`);
                }
            }
            if (compiled)
                ui.notifications.info(`Compiled ${compiled} function(s) under dynamic/${base}/ - see devtools Sources.`);
        });

        html.find('.clipboard-paste').on('click', async () =>
        {
            try
            {
                const text = await navigator.clipboard.readText();
                const payload = JSON.parse(text);
                if (!payload?.reaction)
                {
                    ui.notifications.error("Clipboard does not contain a valid activation.");
                    return;
                }
                this.object = { ...this.object, ...payload, name: payload.name ?? (payload.isGeneral ? payload.lid : (this.object.name ?? "")) };
                this.render();
            }
            catch (error)
            {
                ui.notifications.error("Failed to load from clipboard: invalid JSON.");
            }
        });

        const onlyOnSourceMatchCheckbox = html.find('input[name="onlyOnSourceMatch"]');
        const triggerTargetCheckbox = html.find('input[name="triggerTarget"]');
        const triggerCheckboxes = html.find('input[name^="trigger."]');

        const sourceMatchTriggers = new Set([
            'onAttack', 'onHit', 'onMiss', 'onPreDamage', 'onDamage',
            'onTechAttack', 'onTechHit', 'onTechMiss', 'onActivation', 'onInitActivation',
            'onInitAttack', 'onInitTechAttack', 'onInvoluntaryMove', 'onDeploy', 'onRoll'
        ]);

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
                    $(this).closest('label').css('opacity', '0.5');
                }
                else
                {
                    $(this).prop('disabled', false);
                    $(this).closest('label').css('opacity', '1');
                }
            });
        };

        onlyOnSourceMatchCheckbox.on('change', (ev) =>
        {
            // Sync all checkboxes with this name (DOM has two: one for General, one for Item)
            const isChecked = $(ev.currentTarget).prop('checked');
            onlyOnSourceMatchCheckbox.prop('checked', isChecked);
            toggleSourceMatchTriggers();
        });
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
            const hasActivationTrigger = html.find('input[name="trigger.onActivation"], input[name="trigger.onInitActivation"]').is(':checked');
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
        html.on('change', 'input[name="trigger.onActivation"], input[name="trigger.onInitActivation"]', toggleRecursionWarning);
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
        const checkReactionContainer = html.find('#checkReactionContainer');

        const toggleConsumesReaction = () =>
        {
            const type = actionTypeSelect.val();
            if (type === 'Reaction')
                checkReactionContainer.removeClass('hidden');
            else
            {
                checkReactionContainer.addClass('hidden');
                checkReactionContainer.find('input[type="checkbox"]').prop('checked', false);
            }
        };

        actionTypeSelect.on('change', toggleConsumesReaction);
        toggleConsumesReaction();

        const autoActivateCheckbox = html.find('input[name="autoActivate"]');
        const forceSyncOption = html.find('.force-sync-option');
        const syncAutoActivateLock = () =>
        {
            const checked = autoActivateCheckbox.prop('checked');
            forceSyncOption.toggle(checked);
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
                {
                    actionTypeSelect.val(options.has(detectedActionType) ? detectedActionType : "Other");
                    actionTypeSelect.trigger('change');
                }
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

        let updateTimeout;
        const debouncedUpdate = () =>
        {
            clearTimeout(updateTimeout);
            updateTimeout = setTimeout(updatePreview, 300);
        };

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

        const updateGroupCounts = () =>
        {
            html.find('.trigger-group').each(function ()
            {
                const checked = $(this).find('.trigger-group-body input:checked').length;
                const countEl = $(this).find('.trigger-group-count');
                countEl.text(checked > 0 ? `(${checked})` : '');
            });
        };
        html.find('.trigger-group-header').on('click', function ()
        {
            $(this).closest('.trigger-group').toggleClass('collapsed');
        });
        html.find('.trigger-group-body input').on('change', updateGroupCounts);
        updateGroupCounts();

        html.find('.trigger-group').each(function ()
        {
            const checked = $(this).find('.trigger-group-body input:checked').length;
            if (checked === 0)
                $(this).addClass('collapsed');
        });

        html.find('#open-api-ref').on('click', () =>
        {
            if (this._apiRefPopup && document.body.contains(this._apiRefPopup.element))
            {
                this._closeApiRefPopup();
                return;
            }
            this._apiRefPopup = openApiRefPopup();
        });

        html.find('#open-trigger-ref').on('click', () =>
        {
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
                title: "Unsaved changes",
                content: "<p style='padding:4px 2px;'>This activation has unsaved changes.</p>",
                buttons: {
                    save: {
                        icon: '<i class="far fa-save"></i>',
                        label: "Save & Close",
                        callback: () =>
                        {
                            picked = 'save';
                        }
                    },
                    discard: {
                        icon: '<i class="fas fa-trash"></i>',
                        label: "Discard",
                        callback: () =>
                        {
                            picked = 'discard';
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-arrow-left"></i>',
                        label: "Keep Editing",
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
            title: `Edit ${title}`,
            content: dialogContent,
            buttons: {
                save: {
                    label: "Save & Close",
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
            ui.notifications.warn("Please select an item or deployable first.");
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
            ui.notifications.error(`Item or deployable with LID "${lid}" not found in any compendium.`);
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
                title: `Select Action`,
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
                        label: '<i class="fas fa-minus"></i> No specific action',
                        callback: () => resolve("")
                    },
                    cancel: {
                        label: '<i class="fas fa-times"></i> Cancel',
                        callback: () => resolve(null)
                    }
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
        const groups = [
            { label: "Combat", triggers: ["onEnterCombat", "onExitCombat", "onRoundStart", "onTurnStart", "onTurnEnd"] },
            { label: "Movement", triggers: ["onPreMove", "onMove", "onInvoluntaryMove"] },
            { label: "Rolls", triggers: ["onRoll"] },
            { label: "Attack", triggers: ["onInitAttack", "onAttack", "onHit", "onMiss", "onPreDamage", "onDamage"] },
            { label: "Tech", triggers: ["onInitTechAttack", "onTechAttack", "onTechHit", "onTechMiss"] },
            { label: "Activation", triggers: ["onInitActivation", "onActivation", "onInitCheck", "onCheck", "onDeploy"] },
            { label: "Status", triggers: ["onPreStatusApplied", "onPreStatusRemoved", "onStatusApplied", "onStatusRemoved"] },
            { label: "HP / Heat", triggers: ["onPreHpChange", "onHpGain", "onHpLoss", "onPreHeatChange", "onHeatGain", "onHeatLoss"] },
            { label: "Structure / Stress", triggers: ["onPreStructure", "onStructure", "onPreStress", "onStress", "onDestroyed"] },
            { label: "Token", triggers: ["onTokenCreated", "onTokenRemoved", "onTokenVisibility"] },
            { label: "Other", triggers: ["onUpdate"] }
        ];
        return groups.map(group => ({
            label: group.label,
            items: group.triggers.map(triggerKey => ({ key: triggerKey, checked: selected.includes(triggerKey) }))
        }));
    }

    async _updateObject(event, formData)
    {
        this._lastSaveOk = false;
        const isGeneral = formData.isGeneral === true;

        const triggers = [];
        for (const [key, value] of Object.entries(formData))
        {
            if (key.startsWith("trigger.") && value)
                triggers.push(key.replace("trigger.", ""));
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
            ? formData.onlyOnSourceMatch.some(value => value === true || value === "on")
            : (formData.onlyOnSourceMatch === true || formData.onlyOnSourceMatch === "on");

        if (isGeneral)
        {
            const name = formData.name;
            if (!name)
                return ui.notifications.error("Activation Name is required for general activations");

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
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            if (formData.workshopId && formData.name === formData.originalName)
                newReaction.workshopId = formData.workshopId;

            if (newReaction.workshopId)
            {
                const savedGenerals = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS);
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
                const userSaved = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
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
                return ui.notifications.error("Item LID is required");

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
                outOfCombat: formData.outOfCombat === true,
                dispositionFilter: dispositionFilter.length > 0 ? dispositionFilter : null
            };

            if (formData.workshopId)
                newReaction.workshopId = formData.workshopId;

            let userReactions = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS);

            if (!userReactions[lid])
                userReactions[lid] = { itemType: "any", reactions: [] };

            let index = formData.reactionIndex;
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
            title: 'Find Actor',
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
