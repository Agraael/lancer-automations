import { getDefaultItemAutomationRegistry, getDefaultGeneralAutomationRegistry } from "./automation-registry.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { htmlToElement } from "../tools/dom-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";
import { openItemBrowserDialog } from "../tools/misc-tools.js";
import { AutomationEditor } from "./automation-editor.js";
import { StartupScriptEditor } from "./startup-script-editor.js";
import { findActivationConflicts, collectEditedDefaults, bindConflictDrawer, closeConflictDrawer } from "./activation-conflicts.js";
import { ACTIVATION_TRIGGERS, sameTriggerSet } from "./trigger-catalog.js";
import { AutomationManager, clearScriptCache } from "./automation-manager.js";

export class AutomationConfig extends FormApplication
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
            template: `modules/lancer-automations/templates/automation-config.html`,
            width: 800,
            height: 850,
            resizable: true,
            tabs: [{ navSelector: ".tabs", contentSelector: ".content", initial: "custom" }]
        });
    }

    async getData()
    {
        const userItemSettings = getModuleSetting(AutomationManager.SETTING_AUTOMATIONS) || {};
        const userGeneralSettings = getModuleSetting(AutomationManager.SETTING_GENERAL_AUTOMATIONS) || {};

        const defaultGeneralRegistry = getDefaultGeneralAutomationRegistry();
        const defaultItemRegistry = getDefaultItemAutomationRegistry();

        const defaultList = [];
        const allAutomations = [];

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

        const startEnabled = (automation) =>
        {
            if (automation.enabled === undefined)
                automation.enabled = true;
            return automation;
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
                    return Object.keys(sub).every(automationKey => automationKey === 'enabled' || automationKey === 'workshopId');
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
            const validAutomations = [];

            itemEntry.reactions.forEach((automation, index) =>
            {
                const automationKeys = Object.keys(automation);
                if (automationKeys.length === 1 && automationKeys[0] === 'enabled')
                    return;

                const defItem = defaultItemRegistry[lid]?.reactions?.find(defAutomation => defAutomation.name === automation.name);
                if (defItem && isPureDefault(automation, defItem))
                    return;

                const itemInfo = itemMap.get(lid);
                let displayName = automation.name || rawLid;
                let displaySubname = rawLid;

                if (itemInfo)
                {
                    const actionName = resolveActionName(itemInfo.system, automation.reactionPath);
                    if (actionName)
                        displayName = `${itemInfo.name}: ${actionName}`;
                    else
                        displayName = itemInfo.name;
                    displaySubname = lid;
                }

                validAutomations.push(startEnabled({
                    lid: rawLid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: automation.reactionPath,
                    triggers: [...(automation.triggers || []), ...(automation.onInit ? ["onInit"] : [])].join(", "),
                    isCustom: true,
                    isGeneral: false,
                    automationIndex: index,
                    original: automation,
                    enabled: automation.enabled,
                    comments: automation.comments || "",
                    workshopId: automation.workshopId || null
                }));
            });

            if (validAutomations.length === 0)
                continue;

            if (validAutomations.length === 1)
                allAutomations.push(validAutomations[0]);
            else
            {
                const first = validAutomations[0];
                const uniqueTriggers = [...new Set(validAutomations.flatMap(automation => automation.triggers.split(", ")))].filter(Boolean).join(", ");
                const itemInfo = itemMap.get(lid);
                const groupName = itemInfo ? itemInfo.name : first.name.split(':')[0].trim();

                allAutomations.push({
                    lid: lid,
                    name: groupName,
                    subname: first.subname,
                    triggers: uniqueTriggers,
                    isCustom: true,
                    isGeneral: false,
                    isGroup: true,
                    reactions: validAutomations,
                    enabled: validAutomations.every(automation => automation.enabled)
                });
            }
        }

        // Grouping: default items
        for (const [lid, itemConfig] of Object.entries(defaultItemRegistry))
        {
            const validAutomations = [];
            itemConfig.reactions.forEach((automation, index) =>
            {
                const userEntry = userItemSettings[lid]?.reactions?.[index] ||
                    userItemSettings[lid]?.reactions?.find(userAutomation => userAutomation.name === automation.name);

                const isPure = isPureDefault(userEntry, automation);
                const isOverridden = !!userEntry && !isPure;
                const enabledState = isPure ? userEntry.enabled : (userEntry?.enabled ?? automation.enabled);

                const itemInfo = itemMap.get(lid);
                let displayName = automation.name || lid;
                let displaySubname = lid;

                if (itemInfo)
                {
                    const actionName = resolveActionName(itemInfo.system, automation.reactionPath);
                    if (actionName)
                        displayName = `${itemInfo.name}: ${actionName}`;
                    else
                        displayName = itemInfo.name;
                    displaySubname = lid;
                }

                validAutomations.push(startEnabled({
                    lid: lid,
                    name: displayName,
                    subname: displaySubname,
                    reactionPath: automation.reactionPath,
                    triggers: [...(automation.triggers || []), ...(automation.onInit ? ["onInit"] : [])].join(", "),
                    isGeneral: false,
                    isDefault: true,
                    isOverridden: isOverridden,
                    automationIndex: index,
                    original: automation,
                    enabled: enabledState,
                    category: itemConfig.category || "",
                    comments: automation.comments || ""
                }));
            });

            if (validAutomations.length === 0)
                continue;

            if (validAutomations.length === 1)
                defaultList.push(validAutomations[0]);
            else
            {
                const first = validAutomations[0];
                const uniqueTriggers = [...new Set(validAutomations.flatMap(automation => automation.triggers.split(", ")))].filter(Boolean).join(", ");
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
                    reactions: validAutomations,
                    enabled: validAutomations.every(automation => automation.enabled),
                    category: itemConfig.category || ""
                });
            }
        }

        // Grouping: custom general reactions
        for (const [name, automation] of Object.entries(userGeneralSettings))
        {
            const def = defaultGeneralRegistry[name];
            if (def && isPureDefault(automation, def))
                continue;

            if (Array.isArray(def?.reactions) && Array.isArray(automation.reactions))
            {
                // Per-sub overrides of a grouped default: one row per fully saved sub
                automation.reactions.forEach((savedSub, index) =>
                {
                    if (!savedSub || savedSub.triggers === undefined)
                        return;
                    allAutomations.push(startEnabled({
                        name: name,
                        lid: null,
                        triggers: [...(savedSub.triggers || []), ...(savedSub.onInit ? ["onInit"] : [])].join(", "),
                        isGeneral: true,
                        isCustom: true,
                        onlyOnSourceMatch: savedSub.onlyOnSourceMatch || false,
                        automationIndex: index,
                        original: savedSub,
                        enabled: savedSub.enabled,
                        comments: savedSub.comments || "",
                        workshopId: savedSub.workshopId || null
                    }));
                });
                continue;
            }

            allAutomations.push(startEnabled({
                name: name,
                lid: null,
                triggers: [...(automation.triggers || []), ...(automation.onInit ? ["onInit"] : [])].join(", "),
                isGeneral: true,
                isCustom: true,
                onlyOnSourceMatch: automation.onlyOnSourceMatch || false,
                original: automation,
                enabled: automation.enabled,
                comments: automation.comments || "",
                workshopId: automation.workshopId || null
            }));
        }

        // Grouping: default general reactions
        for (const [name, automation] of Object.entries(defaultGeneralRegistry))
        {
            const userSaved = userGeneralSettings[name];

            if (Array.isArray(automation.reactions))
            {
                const savedSubs = Array.isArray(userSaved?.reactions) ? userSaved.reactions : null;

                const legacyIdx = (!savedSubs && userSaved?.triggers !== undefined)
                    ? automation.reactions.findIndex(sub => sameTriggerSet(sub.triggers, userSaved.triggers))
                    : -1;

                const validAutomations = automation.reactions.map((subAutomation, index) =>
                {
                    const enabledState = savedSubs?.[index]?.enabled ?? subAutomation.enabled ?? automation.enabled;
                    return startEnabled({
                        name: name,
                        lid: null,
                        triggers: [...(subAutomation.triggers || []), ...(subAutomation.onInit ? ["onInit"] : [])].join(", "),
                        isGeneral: true,
                        isDefault: true,
                        isOverridden: savedSubs?.[index]?.triggers !== undefined || index === legacyIdx,
                        onlyOnSourceMatch: subAutomation.onlyOnSourceMatch || false,
                        automationIndex: index,
                        original: subAutomation,
                        enabled: enabledState,
                        category: automation.category || "",
                        comments: subAutomation.comments || ""
                    });
                });

                if (validAutomations.length === 1)
                    defaultList.push(validAutomations[0]);
                else
                {
                    const uniqueTriggers = [...new Set(validAutomations.flatMap(validAutomation => validAutomation.triggers.split(", ")))].filter(Boolean).join(", ");
                    defaultList.push({
                        name: name,
                        lid: null,
                        triggers: uniqueTriggers,
                        isGeneral: true,
                        isDefault: true,
                        isGroup: true,
                        reactions: validAutomations,
                        enabled: validAutomations.every(validAutomation => validAutomation.enabled),
                        category: automation.category || ""
                    });
                }
            }
            else
            {
                const isPure = isPureDefault(userSaved, automation);
                const isOverridden = !!userSaved && !isPure;
                const enabledState = isPure ? userSaved.enabled : automation.enabled;

                defaultList.push(startEnabled({
                    name: name,
                    lid: null,
                    triggers: [...(automation.triggers || []), ...(automation.onInit ? ["onInit"] : [])].join(", "),
                    isGeneral: true,
                    isDefault: true,
                    isOverridden: isOverridden,
                    onlyOnSourceMatch: automation.onlyOnSourceMatch || false,
                    original: automation,
                    enabled: enabledState,
                    category: automation.category || "",
                    comments: automation.comments || ""
                }));
            }
        }

        const sorter = (left, right) =>
        {
            if (left.isGeneral !== right.isGeneral)
                return right.isGeneral - left.isGeneral;
            return left.name.localeCompare(right.name);
        };

        allAutomations.sort(sorter);
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

        const folderSettings = AutomationManager.getFolders();
        const getActivationKey = (activation) => activation.isGeneral ? `general::${activation.name}` : `item::${activation.lid}`;

        const assignedKeys = new Set();

        const customFolders = folderSettings.map(folder =>
        {
            const keySet = new Set(folder.items || []);
            const folderItems = allAutomations.filter(automation => keySet.has(getActivationKey(automation)));
            folderItems.forEach(automation => assignedKeys.add(getActivationKey(automation)));
            return {
                folderName: folder.name,
                isFolder: true,
                items: folderItems
            };
        });

        const unfiledAutomations = allAutomations.filter(automation => !assignedKeys.has(getActivationKey(automation)));

        // for the trigger filter dropdown
        const allTriggerSet = new Set();

        for (const activation of [...allAutomations, ...defaultList])
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

        const userScripts = AutomationManager.getStartupScripts();

        const startupScripts = [
            ...AutomationManager.builtinStartups.map(script => ({ ...script, builtin: true })),
            ...userScripts
        ];

        this._conflictReport = {
            conflicts: findActivationConflicts({
                items: AutomationManager.getAllAutomations(),
                generals: AutomationManager.getGeneralAutomations(),
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
            allAutomations: allAutomations,
            unfiledAutomations: unfiledAutomations,
            customFolders: customFolders,
            defaultAutomations: defaultList,
            defaultFolders: defaultFolders,
            allTriggers: allTriggers,
            startupScripts: startupScripts,
            conflictCount: this._conflictReport.conflicts.length
        };
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        html.find('.add-reaction').click(this._onAddAutomation.bind(this));
        html.find('.edit-reaction').click(this._onEditAutomation.bind(this));
        html.find('.delete-reaction').click(this._onDeleteAutomation.bind(this));
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
                await AutomationManager.createFolder(name);
                self.render();
            }
        });

        html.find('.export-pack-btn').click(async () =>
        {
            const mod = await import('./automation-export-import.js');
            mod.openPackExport();
        });

        html.find('.import-pack-btn').click(async () =>
        {
            const mod = await import('./automation-export-import.js');
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
                await AutomationManager.renameFolder(oldName, newName);
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
                const folders = AutomationManager.getFolders();
                const folder = folders.find(entry => entry.name === folderName);

                if (folder)
                {
                    for (const key of folder.items)
                    {
                        if (key.startsWith("general::"))
                        {
                            const name = key.replace("general::", "");
                            await AutomationManager.deleteGeneralAutomation(name);
                        }
                        else if (key.startsWith("item::"))
                        {
                            const lid = key.replace("item::", "");
                            let userAutomations = getModuleSetting(AutomationManager.SETTING_AUTOMATIONS);

                            if (userAutomations[lid])
                            {
                                delete userAutomations[lid];
                                await game.settings.set(AutomationManager.ID, AutomationManager.SETTING_AUTOMATIONS, userAutomations);
                            }
                        }
                    }
                }
            }

            await AutomationManager.deleteFolder(folderName);
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
                await AutomationManager.assignToFolder(folderName, key);
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
                await AutomationManager.unassignFromFolder(key);
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

    async _onAddAutomation(event)
    {
        new AutomationEditor({}).render(true);
    }

    async _onEditAutomation(event)
    {
        event.preventDefault();
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";

        if (isGeneral)
        {
            const name = li.data("name");
            const rawIndex = li.data("index");
            const parsed = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? NaN : Number.parseInt(rawIndex);
            const generals = AutomationManager.getGeneralAutomations();
            const entry = generals[name];

            if (!entry)
                return;

            let automation;
            let automationIndex;

            if (Array.isArray(entry.reactions))
            {
                if (Number.isFinite(parsed))
                {
                    automation = entry.reactions[parsed];
                    automationIndex = parsed;
                }
                else
                {
                    // Legacy flat save over a grouped default: open the save, aimed at its trigger-matched sub
                    const userSaved = getModuleSetting(AutomationManager.SETTING_GENERAL_AUTOMATIONS) || {};
                    automation = (userSaved[name]?.triggers !== undefined) ? userSaved[name] : entry;
                    const legacyIdx = entry.reactions.findIndex(sub => sameTriggerSet(sub.triggers, automation.triggers));
                    automationIndex = legacyIdx >= 0 ? legacyIdx : undefined;
                }
            }
            else
                automation = entry;
            if (!automation)
                return;
            new AutomationEditor({ isGeneral: true, name, reaction: automation, automationIndex }).render(true);
        }
        else
        {
            const lid = li.data("lid");
            const rawIndex = li.data("index");
            const parsed = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? 0 : Number.parseInt(rawIndex);
            const automationIndex = Number.isFinite(parsed) ? parsed : 0;
            const all = AutomationManager.getAllAutomations();
            const entry = all[lid];

            if (!entry || !Array.isArray(entry.reactions))
                return;

            const automation = entry.reactions[automationIndex];
            if (!automation)
                return;
            new AutomationEditor({ isGeneral: false, lid, reaction: automation, automationIndex }).render(true);
        }
    }

    async _onDeleteAutomation(event)
    {
        const li = $(event.currentTarget).closest(".reaction-item");
        const isGeneral = li.data("is-general") === true || li.data("is-general") === "true";
        const rawIndex = li.data("index");
        const index = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? null : Number.parseInt(rawIndex);

        if (isGeneral)
        {
            const name = li.data("name");
            await AutomationManager.deleteGeneralAutomation(name, index);
        }
        else
        {
            const lid = li.data("lid");
            const userAutomations = getModuleSetting(AutomationManager.SETTING_AUTOMATIONS) || {};
            const entry = userAutomations[lid];

            if (entry)
            {
                const automations = entry.reactions;
                const defaultAutomation = getDefaultItemAutomationRegistry()[lid]?.reactions?.[index];

                if (Number.isFinite(index) && Array.isArray(automations) && automations.length > 1 && index >= 0 && index < automations.length)
                {
                    if (defaultAutomation)
                        automations[index] = { enabled: defaultAutomation.enabled !== false };
                    else
                        automations.splice(index, 1);
                }
                else
                    delete userAutomations[lid];
                await game.settings.set(AutomationManager.ID, AutomationManager.SETTING_AUTOMATIONS, userAutomations);
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
            const defaultEntry = getDefaultGeneralAutomationRegistry()[name];
            if (!defaultEntry)
                return;

            const parsed = (index === undefined || index === null || index === '') ? NaN : Number.parseInt(index);
            const isSub = Array.isArray(defaultEntry.reactions) && Number.isFinite(parsed);

            const automation = isSub
                ? foundry.utils.deepClone(defaultEntry.reactions[parsed])
                : foundry.utils.deepClone(defaultEntry);

            if (!automation)
                return;
            new AutomationEditor({ isGeneral: true, name, reaction: automation, automationIndex: isSub ? parsed : undefined }).render(true);
        }
        else
        {
            const all = AutomationManager.getAllAutomations();
            const entry = all[lid];

            if (!entry || !Array.isArray(entry.reactions))
                return;

            const parsed = (index === undefined || index === null || index === '') ? 0 : Number.parseInt(index);
            const automationIndex = Number.isFinite(parsed) ? parsed : 0;
            const src = entry.reactions[automationIndex];

            if (!src)
                return;

            const automation = foundry.utils.deepClone(src);
            new AutomationEditor({ isGeneral: false, lid, reaction: automation, automationIndex }).render(true);
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
            const userSaved = getModuleSetting(AutomationManager.SETTING_GENERAL_AUTOMATIONS) || {};

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
            await game.settings.set(AutomationManager.ID, AutomationManager.SETTING_GENERAL_AUTOMATIONS, userSaved);
        }
        else
        {
            const lid = li.data("lid");
            const rawIndex = li.data("index");
            const automationIndex = (rawIndex === undefined || rawIndex === null || rawIndex === '') ? 0 : Number.parseInt(rawIndex);

            if (!Number.isFinite(automationIndex))
                return;

            const userItemSettings = getModuleSetting(AutomationManager.SETTING_AUTOMATIONS) || {};

            if (userItemSettings[lid])
            {
                if (!Array.isArray(userItemSettings[lid].reactions))
                    userItemSettings[lid].reactions = [];
                if (!userItemSettings[lid].reactions[automationIndex])
                    userItemSettings[lid].reactions[automationIndex] = {};
                userItemSettings[lid].reactions[automationIndex].enabled = checked;
            }
            else
            {
                const defaults = getDefaultItemAutomationRegistry();

                if (defaults[lid])
                {
                    userItemSettings[lid] = {
                        itemType: defaults[lid].itemType,
                        reactions: defaults[lid].reactions.map((defaultAutomation, idx) =>
                            idx === automationIndex ? { enabled: checked } : { enabled: defaultAutomation.enabled !== false }
                        )
                    };
                }
            }

            await game.settings.set(AutomationManager.ID, AutomationManager.SETTING_AUTOMATIONS, userItemSettings);
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
        const scripts = AutomationManager.getStartupScripts();

        const script = scripts.find(entry => entry.id === id)
            || (AutomationManager.builtinStartups || []).find(entry => entry.id === id);

        if (!script)
            return;
        this._openScriptEditor(script);
    }

    async _onDeleteScript(event)
    {
        event.preventDefault();
        const li = $(event.currentTarget).closest('.script-item');
        const id = li.data('id');
        const scripts = AutomationManager.getStartupScripts();
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
        await AutomationManager.saveStartupScripts(scripts);
        this._needsReload = true;
        this.render();
    }

    async _onToggleScript(event)
    {
        const checkbox = $(event.currentTarget);
        const li = checkbox.closest('.script-item');
        const id = li.data('id');
        const scripts = AutomationManager.getStartupScripts();
        const script = scripts.find(entry => entry.id === id);

        if (!script)
            return;
        script.enabled = checkbox.prop('checked');
        await AutomationManager.saveStartupScripts(scripts);
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
