/*global game, console, URL, Blob */

import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";
import { MODULE_ID } from "../tools/constants.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { sameTriggerSet } from "./trigger-catalog.js";
import { ReactionConfig } from "./reaction-config.js";
export { TARGET_CAPABLE_TRIGGERS, SOURCE_MATCH_TRIGGERS, TRIGGER_GROUPS, BUILT_IN_TRIGGERS, ACTIVATION_TRIGGERS } from "./trigger-catalog.js";
export { ReactionEditor } from "./reaction-editor.js";
export { StartupScriptEditor } from "./startup-script-editor.js";
export { ReactionConfig };

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

        const sensitiveTriggers = new Set(['onPreMove', 'onPreInvoluntaryMove', 'onInitAttack', 'onInitCheck', 'onInitActivation', 'onInitEndActivation', 'onPreStatusApplied', 'onPreStatusRemoved']);
        const foundTriggers = reaction?.triggers?.filter(trigger => sensitiveTriggers.has(trigger)) || [];

        const isForceSync = reaction?.awaitActivationCompletion;

        if ((foundKeywords.length > 0 || foundTriggers.length > 0) && !isForceSync)
        {
            let reason = "";
            if (foundKeywords.length > 0)
                reason += `uses blocking logic (${foundKeywords.join(', ')})`;
            if (foundTriggers.length > 0)
                reason += (reason ? " and " : "") + `is associated with sensitive triggers (${foundTriggers.join(', ')})`;

            ui.notifications.warn(localizeFormat('LA.notify.asyncEvaluationWarning', { name: reaction?.name || 'Activation', reason }), {permanent: true});
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

export class ReactionManager
{
    static get ID()
    {
        return MODULE_ID;
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
            name: "LA.settings.customReactions.name",
            hint: "LA.settings.customReactions.hint",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, {
            name: "LA.settings.generalReactions.name",
            hint: "LA.settings.generalReactions.hint",
            scope: "world",
            config: false,
            type: Object,
            default: {}
        });

        game.settings.registerMenu(ReactionManager.ID, "reactionConfig", {
            name: "LA.settings.reactionConfig.name",
            label: "LA.settings.reactionConfig.label",
            hint: "LA.settings.reactionConfig.hint",
            icon: "fas fa-bolt",
            type: ReactionConfig,
            restricted: true
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_FOLDERS, {
            name: "LA.settings.activationFolders.name",
            hint: "LA.settings.activationFolders.hint",
            scope: "world",
            config: false,
            type: Array,
            default: []
        });

        game.settings.register(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, {
            name: "LA.settings.startupScripts.name",
            hint: "LA.settings.startupScripts.hint",
            scope: "world",
            config: false,
            type: Array,
            default: []
        });

        game.settings.register(ReactionManager.ID, "enableLaSossisItems", {
            name: "LA.settings.enableLaSossisItems.name",
            hint: "LA.settings.enableLaSossisItems.hint",
            scope: "world",
            config: false,
            type: Boolean,
            default: false,
            requiresReload: true
        });

        game.settings.register(ReactionManager.ID, "enablePersonalStuff", {
            name: "LA.settings.enablePersonalStuff.name",
            hint: "LA.settings.enablePersonalStuff.hint",
            scope: "world",
            config: false,
            type: Boolean,
            default: false,
            requiresReload: true
        });
    }

    static getFolders()
    {
        return getModuleSetting(ReactionManager.SETTING_FOLDERS) || [];
    }

    static async saveFolders(folders)
    {
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_FOLDERS, folders);
    }

    static getStartupScripts()
    {
        return getModuleSetting(ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
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
        const userSaved = getModuleSetting(ReactionManager.SETTING_REACTIONS) || {};
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

    static newSavedItemEntry(lid, itemType = "any")
    {
        const defaultReactions = getDefaultItemReactionRegistry()[lid]?.reactions ?? [];
        return { itemType, reactions: defaultReactions.map(defaultReaction => ({ enabled: defaultReaction.enabled !== false })) };
    }

    static getGeneralReactions()
    {
        const defaults = getDefaultGeneralReactionRegistry();
        const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};

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
        const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        userSaved[name] = reaction;
        clearScriptCache();
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, userSaved);
    }

    static async deleteGeneralReaction(name, index = null)
    {
        const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
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
        const itemReactions = ReactionManager.stripWorkshopIds(getModuleSetting(ReactionManager.SETTING_REACTIONS) || {});
        const generalReactions = ReactionManager.stripWorkshopIds(getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {});
        const startupScripts = ReactionManager.stripWorkshopIds((getModuleSetting(ReactionManager.SETTING_STARTUP_SCRIPTS) || [])
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
            const value = getModuleSetting(setting.key);
            if (value !== undefined)
                settings[setting.key] = value;
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

        ui.notifications.info(localize('LA.notify.configurationExportedSuccessfully'));
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
                const existing = getModuleSetting(ReactionManager.SETTING_REACTIONS) || {};
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
                const existing = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
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
                const existing = getModuleSetting(ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
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
                        console.warn(`lancer-automations | failed to restore setting ${settingKey}:`, error);
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
                        console.warn(`lancer-automations | failed to restore ${moduleId}.${settingKey}:`, error);
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
                        console.warn(`lancer-automations | failed to restore keybinding ${moduleId}.${settingKey}:`, error);
                    }
                }
            }

            clearScriptCache();
            ui.notifications.info(localize('LA.notify.importApplied'));
            return true;
        }
        catch (error)
        {
            ui.notifications.error(localizeFormat('LA.notify.importApplyFailed', { error: error.message }));
            return false;
        }
    }
}
