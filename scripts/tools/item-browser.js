let _sharedPackItemCache = null;

Hooks.on('lancer-automations.clearCaches', () => {
    _sharedPackItemCache = null;
});

async function _fetchPackItems() {
    if (_sharedPackItemCache)
        return _sharedPackItemCache;

    const items = [];
    for (const pack of game.packs) {
        if (pack.documentName !== "Item")
            continue;
        const index = await pack.getIndex({ fields: ["system.lid", "type", "system.actions", "system.ranks", "system.profiles", "system.trigger"] });
        for (const entry of index) {
            if (!entry.system?.lid)
                continue;
            let actionCount = 0;
            if (entry.type === "npc_feature") {
                if (entry.system?.trigger)
                    actionCount++;
                if (entry.system?.actions)
                    actionCount += entry.system.actions.length;
            } else {
                if (entry.system?.ranks)
                    entry.system.ranks.forEach(r => {
                        actionCount += (r.actions?.length || 0);
                    });
                if (entry.system?.profiles)
                    entry.system.profiles.forEach(p => {
                        actionCount += (p.actions?.length || 0);
                    });
                if (entry.system?.actions)
                    actionCount += entry.system.actions.length;
            }
            if (actionCount === 0)
                actionCount = 1;
            items.push({ name: entry.name, lid: entry.system.lid, type: entry.type, uuid: entry.uuid, actionCount });
        }
    }
    items.sort((a, b) => a.name.localeCompare(b.name));
    _sharedPackItemCache = items;
    return items;
}

/**
 * Shared item browser dialog. Empty by default; debounced search; 50-result cap unless "Show all".
 * Right-click an entry to open its sheet.
 * @returns {Promise<{lid: string, uuid: string}|null>}
 */
export async function openItemBrowserDialog() {
    const items = await _fetchPackItems();

    const sortedTypes = [...new Set(items.map(i => i.type))].sort();
    const typeOptions = sortedTypes.map(t =>
        `<option value="${t}">${game.i18n.localize(CONFIG.Item.typeLabels?.[t]) || t}</option>`
    ).join('');

    const MAX_RESULTS = 50;

    const buildItemHtml = (item) => {
        const countLabel = item.actionCount > 1
            ? `<span style="font-size:0.8em;opacity:0.7;font-weight:normal;">(${item.actionCount} actions)</span>`
            : '';
        return `<div class="lancer-item-card item-browser-entry" data-lid="${item.lid}" data-uuid="${item.uuid}" data-type="${item.type}" style="margin-bottom:6px;padding:10px;">
            <div class="lancer-item-icon"><i class="fas fa-cube"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${item.name} ${countLabel}</div>
                <div class="lancer-item-details">${item.type} | LID: ${item.lid}</div>
            </div>
            <a class="copy-lid-btn" title="Copy LID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;
    };

    return new Promise((resolve) => {
        const dialog = new Dialog({
            title: "Find Item",
            content: `
                <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                    <h1 class="lancer-dialog-title">Find Item</h1>
                    <p class="lancer-dialog-subtitle">Search for an item by name or filter by category. Click <i class="fas fa-copy"></i> to copy LID.</p>
                </div>
                <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                    <div style="flex:2;position:relative;">
                        <i class="fas fa-search lancer-search-icon"></i>
                        <input type="text" id="item-search" placeholder="Search by name or LID..." style="padding-left:35px;">
                    </div>
                    <select id="type-filter" style="flex:1;">
                        <option value="">All Types</option>
                        ${typeOptions}
                    </select>
                    <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                        <input type="checkbox" id="show-all-items"> Show all
                    </label>
                </div>
                <div id="item-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                    <div style="padding:20px;text-align:center;color:#888;font-style:italic;">
                        <i class="fas fa-search" style="margin-right:6px;"></i>Type to search items…
                    </div>
                </div>
            `,
            buttons: {
                cancel: { label: '<i class="fas fa-times"></i> Cancel', callback: () => resolve(null) }
            },
            render: (html) => {
                const searchInput = html.find('#item-search');
                const typeFilter = html.find('#type-filter');
                const showAllCb = html.find('#show-all-items');
                const listContainer = html.find('#item-list');

                const updateList = () => {
                    const query = (String)(searchInput.val()).toLowerCase().trim();
                    const type = typeFilter.val();
                    const showAll = showAllCb.is(':checked');

                    if (!query && !showAll) {
                        listContainer.html(`<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search items…</div>`);
                        return;
                    }

                    const matched = items.filter(item => {
                        if (type && item.type !== type)
                            return false;
                        if (!query)
                            return true;
                        return item.name.toLowerCase().includes(query) || item.lid.toLowerCase().includes(query);
                    });

                    if (matched.length === 0) {
                        listContainer.html(`<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No items found.</div>`);
                        return;
                    }

                    const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                    const more = matched.length - slice.length;
                    const moreHtml = more > 0
                        ? `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more — keep typing to narrow down.</div>`
                        : '';
                    listContainer.html(slice.map(buildItemHtml).join('') + moreHtml);
                };

                let _debounceTimer = null;
                const debouncedUpdate = () => {
                    clearTimeout(_debounceTimer);
                    _debounceTimer = setTimeout(updateList, 120);
                };

                searchInput.on('input', debouncedUpdate);
                typeFilter.on('change', updateList);
                showAllCb.on('change', updateList);

                listContainer.on('click', '.item-browser-entry', (ev) => {
                    const el = $(ev.currentTarget);
                    resolve({ lid: el.data('lid'), uuid: el.data('uuid') });
                    dialog.close();
                });

                listContainer.on('contextmenu', '.item-browser-entry', async (ev) => {
                    ev.preventDefault();
                    const uuid = $(ev.currentTarget).data('uuid');
                    if (uuid) {
                        const item = /** @type {Item} */ (await fromUuid(uuid));
                        if (item)
                            item.sheet.render(true);
                    }
                });

                listContainer.on('click', '.copy-lid-btn', async function (ev) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const lid = $(this).closest('.item-browser-entry').data('lid');
                    if (lid) {
                        await navigator.clipboard.writeText(lid);
                        ui.notifications.info(`Copied LID: ${lid}`);
                    }
                });

                searchInput.trigger('focus');
            },
            default: "cancel"
        }, {
            width: 500,
            classes: ["lancer-dialog-base", "lancer-item-browser-dialog", "lancer-no-title"]
        });
        dialog.render(true);
    });
}
