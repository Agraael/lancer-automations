import { getDefaultItemReactionRegistry, getDefaultGeneralReactionRegistry } from "./reactions-registry.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";
import { openItemBrowserDialog } from "../tools/misc-tools.js";
import { ReactionEditor } from "./reaction-editor.js";
import { StartupScriptEditor } from "./startup-script-editor.js";
import { findActivationConflicts, collectEditedDefaults, bindConflictDrawer, closeConflictDrawer } from "./activation-conflicts.js";
import { ACTIVATION_TRIGGERS, sameTriggerSet } from "./trigger-catalog.js";
import { ReactionManager, clearScriptCache } from "./reaction-manager.js";

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
            ui.notifications?.warn?.('The Automation Manager is GM-only.');
            return this;
        }
        return super.render(force, options);
    }

    static get defaultOptions()
    {
        return mergeObject(super.defaultOptions, {
            title: localize('LA.dialogTitle.activationManager'),
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
        const userItemSettings = getModuleSetting(ReactionManager.SETTING_REACTIONS) || {};
        const userGeneralSettings = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};

        const defaultGeneralRegistry = getDefaultGeneralReactionRegistry();
        const defaultItemRegistry = getDefaultItemReactionRegistry();

        const defaultList = [];
        const allReactions = [];

        const keysToLookup = new Set([
            ...Object.keys(userItemSettings).map(key => key.trim()),
            ...Object.keys(defaultItemRegistry).map(key => key.trim())
        ]);

        const itemMap = new Map();

        for (const item of game.items)
        {
            const lid = item.system?.lid;
            if (lid && keysToLookup.has(lid))
            {
                itemMap.set(lid, {
                    name: item.name,
                    system: item.system
                });
                keysToLookup.delete(lid);
            }
        }

        // Indices fetched in parallel, cold compendium loads are slow.
        if (keysToLookup.size > 0)
        {
            const itemPacks = game.packs.filter(pack => pack.documentName === "Item");
            const indices = await Promise.all(itemPacks.map(pack => pack.getIndex({
                fields: ["system.lid", "system.actions", "system.ranks", "system.profiles"]
            })));

            for (const index of indices)
            {
                if (keysToLookup.size === 0)
                    break;
                for (const entry of index)
                {
                    const lid = entry.system?.lid;
                    if (lid && keysToLookup.has(lid))
                    {
                        itemMap.set(lid, {
                            name: entry.name,
                            system: entry.system
                        });
                        keysToLookup.delete(lid);
                        if (keysToLookup.size === 0)
                            break;
                    }
                }
            }
        }

        // Leftover keys may be Actor UUIDs rather than item LIDs.
        if (keysToLookup.size > 0)
        {
            for (const key of [...keysToLookup])
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
                    keysToLookup.delete(key);
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

        this._conflictReport = {
            conflicts: findActivationConflicts({
                items: ReactionManager.getAllReactions(),
                generals: ReactionManager.getGeneralReactions(),
                userItemSettings,
                userGeneralSettings,
                defaultItemRegistry,
                defaultGeneralRegistry,
                itemMap,
                resolveActionName,
                activationTriggers: ACTIVATION_TRIGGERS
            }),
            edited: collectEditedDefaults(defaultList)
        };

        return {
            allReactions: allReactions,
            unfiledReactions: unfiledReactions,
            customFolders: customFolders,
            defaultReactions: defaultList,
            defaultFolders: defaultFolders,
            allTriggers: allTriggers,
            startupScripts: startupScripts,
            conflictCount: this._conflictReport.conflicts.length
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
        bindConflictDrawer(this, html);
        html.find('.item-find-btn').click(async () =>
        {
            const result = await openItemBrowserDialog();
            if (result?.lid)
            {
                try
                {
                    await navigator.clipboard.writeText(result.lid);
                    ui.notifications.info(localizeFormat('LA.notify.copiedLid', { lid: result.lid }));
                }
                catch
                {
                    ui.notifications.info(localizeFormat('LA.notify.lidValue', { lid: result.lid }));
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
                byTrigger = $(htmlToElement('<div class="scrollable scrollable-by-trigger" style="display: none;"></div>')).appendTo(list);

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
                const groupEl = $(htmlToElement(`
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
                `));
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
                    title: localize('LA.dialogTitle.createFolder'),
                    content: `
                        <div class="form-group">
                            <label>Folder Name</label>
                            <input type="text" name="folderName" placeholder="${localize('LA.activationManager.folderNamePlaceholder')}" autofocus>
                        </div>
                    `,
                    buttons: {
                        ok: {
                            label: localize("LA.common.create"),
                            icon: '<i class="fas fa-folder-plus"></i>',
                            callback: (dlg) => resolve(String(dlg.find('[name=folderName]').val() ?? '').trim())
                        },
                        cancel: cancelButton(() => resolve(null))
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
                    title: localize('LA.dialogTitle.renameFolder'),
                    content: `
                        <div class="form-group">
                            <label>${localize('LA.activationManager.newName')}</label>
                            <input type="text" name="folderName" value="${oldName}" autofocus>
                        </div>
                    `,
                    buttons: {
                        ok: {
                            label: localize("LA.common.rename"),
                            icon: '<i class="fas fa-pen"></i>',
                            callback: (dlg) => resolve(String(dlg.find('[name=folderName]').val() ?? '').trim())
                        },
                        cancel: cancelButton(() => resolve(null))
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
                    title: localize('LA.dialogTitle.deleteFolder'),
                    content: `
                        <div class="form-group">
                            <p style="margin-bottom: 10px;">${localizeFormat('LA.activationManager.confirmDeleteFolder', { name: folderName })}</p>
                            <p class="notes">${localize('LA.activationManager.keepOrDeleteHint')}</p>
                        </div>
                    `,
                    buttons: {
                        keep: {
                            label: localize("LA.activationManager.keepItems"),
                            icon: '<i class="fas fa-inbox"></i>',
                            callback: () => resolve("keep")
                        },
                        all: {
                            label: localize("LA.activationManager.deleteAll"),
                            icon: '<i class="fas fa-trash"></i>',
                            callback: () => resolve("all")
                        },
                        cancel: cancelButton(() => resolve(null))
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
                            let userReactions = getModuleSetting(ReactionManager.SETTING_REACTIONS);
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
            title: localize('LA.dialogTitle.activationManagerHelp'),
            content: content,
            buttons: {
                ok: {
                    label: localize("LA.common.close"),
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
                    const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};
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
            const userReactions = getModuleSetting(ReactionManager.SETTING_REACTIONS) || {};
            const entry = userReactions[lid];
            if (entry)
            {
                const reactions = entry.reactions;
                const defaultReaction = getDefaultItemReactionRegistry()[lid]?.reactions?.[index];
                if (Number.isFinite(index) && Array.isArray(reactions) && reactions.length > 1 && index >= 0 && index < reactions.length)
                {
                    if (defaultReaction)
                        reactions[index] = { enabled: defaultReaction.enabled !== false };
                    else
                        reactions.splice(index, 1);
                }
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
            new ReactionEditor({ isGeneral: false, lid, reaction, reactionIndex }).render(true);
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
            const userSaved = getModuleSetting(ReactionManager.SETTING_GENERAL_REACTIONS) || {};

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
            const userItemSettings = getModuleSetting(ReactionManager.SETTING_REACTIONS) || {};

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
            title: localize('LA.dialogTitle.deleteStartupScript'),
            content: `<p>${localizeFormat('LA.activationManager.confirmDeleteScript', { name: scripts[idx].name })}</p>`
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
        closeConflictDrawer(this);
        if (this._needsReload)
        {
            const reload = await Dialog.confirm({
                title: localize('LA.dialogTitle.reloadRequired'),
                content: localize('LA.activationManager.content.changesMadeToActivationsOrStartup'),
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
