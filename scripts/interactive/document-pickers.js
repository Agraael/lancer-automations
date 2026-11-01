import { localize, localizeFormat } from "../tools/string-utils.js";

/**
 * Searchable picker for deployable actors across all Actor compendia.
 * onPick receives the picked entry, return 'keep-open' to prevent auto-close.
 * @param {{ title?: string, onPick?: (entry: {lid: string, uuid: string, name: string, img: string, pack: string, type: string}) => any }} [opts]
 */
export async function openDeployablePicker({ title = 'Find Deployable', onPick = null } = {})
{
    const deployables = [];
    for (const pack of game.packs)
    {
        if (pack.documentName !== 'Actor')
            continue;
        const index = await pack.getIndex({ fields: ['system.lid', 'type', 'img'] });
        for (const entry of index)
        {
            if (entry.type !== 'deployable')
                continue;
            const lid = entry.system?.lid;
            if (!lid)
                continue;
            deployables.push({
                name: entry.name,
                lid,
                type: entry.type,
                img: entry.img || 'icons/svg/mystery-man.svg',
                uuid: entry.uuid,
                pack: pack.metadata.label,
            });
        }
    }
    deployables.sort((left, right) => left.name.localeCompare(right.name));
    const MAX_RESULTS = 50;
    const canPick = !!onPick;
    const subtitle = canPick
        ? 'Search for a deployable actor by name or LID. Click an entry to pick it.'
        : 'Search for a deployable actor by name or LID. Click <i class="fas fa-copy"></i> to copy.';

    const buildEntry = (deployableEntry) => `
        <div class="lancer-item-card deployable-entry" data-lid="${deployableEntry.lid}" style="margin-bottom:6px;padding:10px;${canPick ? '' : 'cursor:default;'}">
            <div class="lancer-item-icon"><i class="fas fa-rocket"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${deployableEntry.name}</div>
                <div class="lancer-item-details">${deployableEntry.type} | LID: ${deployableEntry.lid}</div>
            </div>
            <a class="copy-lid-btn" title="Copy LID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;

    let dlg = null;
    dlg = new Dialog({
        title,
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">${title}</h1>
                <p class="lancer-dialog-subtitle">${subtitle}</p>
            </div>
            <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                <div style="flex:1;position:relative;">
                    <i class="fas fa-search lancer-search-icon"></i>
                    <input type="text" id="deploy-search" placeholder="${localize('LA.common.searchByNameOrLid')}" style="padding-left:35px;">
                </div>
                <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                    <input type="checkbox" id="deploy-show-all"> Show all
                </label>
            </div>
            <div id="deploy-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">
                <div style="padding:20px;text-align:center;color:#888;font-style:italic;">
                    <i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables…
                </div>
            </div>
        `,
        buttons: { close: { label: `<i class="fas fa-times"></i> ${localize('LA.common.close')}` } },
        render: (html) =>
        {
            const searchInput = html.find('#deploy-search');
            const showAllCb = html.find('#deploy-show-all');
            const listContainer = html.find('#deploy-list');

            const updateList = () =>
            {
                const query = String(searchInput.val() || '').toLowerCase().trim();
                const showAll = showAllCb.is(':checked');
                if (!query && !showAll)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search deployables…</div>');
                    return;
                }
                const matched = deployables.filter(deployable => !query || deployable.name.toLowerCase().includes(query) || deployable.lid.toLowerCase().includes(query));
                if (matched.length === 0)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No deployables found.</div>');
                    return;
                }
                const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                const more = matched.length - slice.length;
                let resultHtml = slice.map(buildEntry).join('');
                if (more > 0)
                    resultHtml += `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more, keep typing or check 'Show all'</div>`;
                listContainer.html(resultHtml);
            };

            let timer;
            searchInput.on('input', () =>
            {
                clearTimeout(timer); timer = setTimeout(updateList, 200);
            });
            showAllCb.on('change', updateList);

            listContainer.on('click', '.copy-lid-btn', async function (ev)
            {
                ev.preventDefault();
                ev.stopPropagation();
                const lid = $(this).closest('.deployable-entry').data('lid');
                if (lid)
                {
                    await navigator.clipboard.writeText(lid);
                    ui.notifications.info(localizeFormat('LA.notify.copiedLid', { lid }));
                }
            });
            if (canPick)
            {
                listContainer.on('click', '.deployable-entry', async (ev) =>
                {
                    if ($(ev.target).closest('.copy-lid-btn').length)
                        return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const lid = $(ev.currentTarget).data('lid');
                    const entry = deployables.find(deployable => deployable.lid === lid);
                    if (!entry)
                        return;
                    const result = await onPick(entry);
                    if (result !== 'keep-open')
                        dlg?.close();
                });
            }
            listContainer.on('contextmenu', '.deployable-entry', async function (ev)
            {
                ev.preventDefault();
                const entry = deployables.find(deployable => deployable.lid === $(this).data('lid'));
                if (entry)
                {
                    const actor = /** @type {any} */ (await fromUuid(entry.uuid));
                    if (actor)
                        actor.sheet.render(true);
                }
            });
            setTimeout(() => searchInput.focus(), 50);
        },
    }, { width: 600, height: 580, classes: ['lancer-dialog-base', 'lancer-item-browser-dialog', 'lancer-no-title'] });
    dlg.render(true);
}

/**
 * Search dialog over world actors and scenes.
 * @param {{ title?: string, onPick?: (entry: { uuid: string, id: string, name: string, documentName: string }) => Promise<any> }} [opts]
 */
export async function openDocumentPicker({ title = 'Find Actor or Scene', documentTypes = ['Actor', 'Scene'], onPick = null } = {})
{
    const entries = [];
    if (documentTypes.includes('Actor'))
    {
        entries.push(...game.actors.map(actor => ({
            uuid: actor.uuid,
            id: actor.id,
            name: actor.name,
            documentName: 'Actor',
            details: actor.folder ? `${actor.type} | ${actor.folder.name}` : actor.type,
            icon: 'fa-user',
        })));
    }
    if (documentTypes.includes('Scene'))
    {
        entries.push(...game.scenes.map(scene => ({
            uuid: scene.uuid,
            id: scene.id,
            name: scene.name,
            documentName: 'Scene',
            details: 'Scene',
            icon: 'fa-map',
        })));
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const MAX_RESULTS = 50;
    const canPick = !!onPick;
    const subtitle = canPick
        ? 'Search by name or UUID. Click an entry to pick it.'
        : 'Search by name or UUID. Click <i class="fas fa-copy"></i> to copy.';

    const buildEntry = (entry) => `
        <div class="lancer-item-card document-entry" data-uuid="${entry.uuid}" style="margin-bottom:6px;padding:10px;${canPick ? '' : 'cursor:default;'}">
            <div class="lancer-item-icon"><i class="fas ${entry.icon}"></i></div>
            <div class="lancer-item-content" style="flex:1;min-width:0;">
                <div class="lancer-item-name">${entry.name}</div>
                <div class="lancer-item-details">${entry.details} | ${entry.uuid}</div>
            </div>
            <a class="copy-uuid-btn" title="Copy UUID" style="color:var(--primary-color);cursor:pointer;font-size:1.1em;flex:0 0 auto;padding:0 4px;"><i class="fas fa-copy"></i></a>
        </div>`;
    const emptyHint = '<div style="padding:20px;text-align:center;color:#888;font-style:italic;"><i class="fas fa-search" style="margin-right:6px;"></i>Type to search…</div>';

    let dlg = null;
    dlg = new Dialog({
        title,
        content: `
            <div class="lancer-dialog-header" style="margin:-8px -8px 10px -8px;">
                <h1 class="lancer-dialog-title">${title}</h1>
                <p class="lancer-dialog-subtitle">${subtitle}</p>
            </div>
            <div class="lancer-search-container" style="margin-bottom:8px;display:flex;gap:6px;align-items:center;">
                <div style="flex:1;position:relative;">
                    <i class="fas fa-search lancer-search-icon"></i>
                    <input type="text" id="document-search" placeholder="${localize('LA.deployables.searchByNameOrUuid')}" style="padding-left:35px;">
                </div>
                <label style="display:flex;align-items:center;gap:4px;white-space:nowrap;font-size:0.85em;cursor:pointer;">
                    <input type="checkbox" id="document-show-all"> Show all
                </label>
            </div>
            <div id="document-list" style="height:400px;overflow-y:auto;padding:4px;border:1px solid #ddd;background:#fafafa;border-radius:4px;">${emptyHint}</div>
        `,
        buttons: { close: { label: `<i class="fas fa-times"></i> ${localize('LA.common.close')}` } },
        render: (html) =>
        {
            const searchInput = html.find('#document-search');
            const showAllCb = html.find('#document-show-all');
            const listContainer = html.find('#document-list');

            const updateList = () =>
            {
                const query = String(searchInput.val() || '').toLowerCase().trim();
                const showAll = showAllCb.is(':checked');
                if (!query && !showAll)
                {
                    listContainer.html(emptyHint);
                    return;
                }
                const matched = entries.filter(entry => !query || entry.name.toLowerCase().includes(query) || entry.uuid.toLowerCase().includes(query));
                if (matched.length === 0)
                {
                    listContainer.html('<div style="padding:20px;text-align:center;color:#888;font-style:italic;">No match.</div>');
                    return;
                }
                const slice = showAll ? matched : matched.slice(0, MAX_RESULTS);
                const more = matched.length - slice.length;
                let resultHtml = slice.map(buildEntry).join('');
                if (more > 0)
                    resultHtml += `<div style="padding:8px;text-align:center;color:#888;font-style:italic;font-size:0.85em;">${more} more, keep typing or check 'Show all'</div>`;
                listContainer.html(resultHtml);
            };

            let timer;
            searchInput.on('input', () =>
            {
                clearTimeout(timer); timer = setTimeout(updateList, 200);
            });
            showAllCb.on('change', updateList);

            listContainer.on('click', '.copy-uuid-btn', async function (ev)
            {
                ev.preventDefault();
                ev.stopPropagation();
                const uuid = $(this).closest('.document-entry').data('uuid');
                if (uuid)
                {
                    await navigator.clipboard.writeText(uuid);
                    ui.notifications.info(localizeFormat('LA.notify.copiedUuid', { uuid }));
                }
            });
            if (canPick)
            {
                listContainer.on('click', '.document-entry', async (ev) =>
                {
                    if ($(ev.target).closest('.copy-uuid-btn').length)
                        return;
                    ev.preventDefault();
                    ev.stopPropagation();
                    const entry = entries.find(candidate => candidate.uuid === $(ev.currentTarget).data('uuid'));
                    if (!entry)
                        return;
                    const result = await onPick(entry);
                    if (result !== 'keep-open')
                        dlg?.close();
                });
            }
            listContainer.on('contextmenu', '.document-entry', async function (ev)
            {
                ev.preventDefault();
                const doc = await fromUuid($(this).data('uuid'));
                doc?.sheet?.render(true);
            });
            setTimeout(() => searchInput.focus(), 50);
        },
    }, { width: 600, height: 580, classes: ['lancer-dialog-base', 'lancer-item-browser-dialog', 'lancer-no-title'] });
    dlg.render(true);
}
