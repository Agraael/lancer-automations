import { ReactionManager, ReactionEditor, StartupScriptEditor, clearScriptCache } from "./reaction-manager.js";
import { escapeHtml as esc } from "../tools/string-utils.js";

const REPO_OWNER = 'Agraael';
const REPO_NAME = 'Lancer-automations-workshop';
const REPO_BRANCH = 'main';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;
const CONTRIBUTE_URL = `${REPO_URL}#putting-something-in`;
const TREE_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${REPO_BRANCH}?recursive=1`;
const RAW_BASE = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${REPO_BRANCH}/`;
const PACK_TYPE = 'lancer-automations-pack';

const REACTION_FIELDS = [
    'reactionPath', 'triggers', 'evaluate', 'comments', 'triggerDescription', 'effectDescription',
    'isReaction', 'actionType', 'frequency', 'checkReaction', 'requireCanProvoke', 'checkUsage',
    'autoActivate', 'awaitActivationCompletion', 'onlyOnSourceMatch', 'activationType', 'activationMode',
    'activationMacro', 'activationCode', 'onInit', 'onMessage', 'triggerSelf', 'triggerOther',
    'outOfCombat', 'dispositionFilter'
];

const state = {
    tree: null,
    treeFetchedAt: 0,
    files: new Map(),
    view: { mode: 'list', author: null },
    checked: new Set(),
    manager: null,
    root: null
};

// Remote access

async function fetchTree(force = false)
{
    if (state.tree && !force)
        return state.tree;
    const response = await fetch(TREE_URL, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`GitHub tree request failed (${response.status})`);
    const data = await response.json();
    state.tree = (data.tree || []).filter(entry => entry.type === 'blob');
    state.treeFetchedAt = Date.now();
    return state.tree;
}

async function fetchFile(path, force = false)
{
    if (!force && state.files.has(path))
        return state.files.get(path);
    const url = RAW_BASE + path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok)
        throw new Error(`Fetch failed for ${path} (${response.status})`);
    const text = await response.text();
    state.files.set(path, text);
    return text;
}

// Tree parsing and identity

function getContributors()
{
    const contributors = new Map();
    for (const entry of (state.tree || []))
    {
        const match = entry.path.match(/^contributors\/([^/]+)\/(.+)$/);
        if (!match || match[1] === '_template')
            continue;
        const [, author, rel] = match;
        if (!contributors.has(author))
            contributors.set(author, { author, listMd: null, automations: [], packs: [], startups: [] });
        const contributor = contributors.get(author);
        if (/^list\.md$/i.test(rel))
            contributor.listMd = entry.path;
        else if (/^Automations\/[^/]+\.json$/i.test(rel))
            contributor.automations.push(entry.path);
        else if (/^Packs\/[^/]+\.json$/i.test(rel))
            contributor.packs.push(entry.path);
        else if (/^Startups\/[^/]+\.json$/i.test(rel))
            contributor.startups.push(entry.path);
    }
    return [...contributors.values()].sort((first, second) => first.author.localeCompare(second.author));
}

function pathWorkshopId(path)
{
    return path.replace(/^contributors\//, '');
}

function authorOfId(workshopId)
{
    return String(workshopId).split('/')[0];
}

function fileNameOf(path)
{
    return path.split('/').pop();
}

function classifyPayload(json)
{
    if (json?.type === PACK_TYPE)
        return 'pack';
    if (json?.reaction && typeof json.reaction === 'object')
        return 'automation';
    if (typeof json?.code === 'string')
        return 'startup';
    return 'unknown';
}

// Local lookup and comparison

function findLocalByWorkshopId(workshopId)
{
    const items = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
    for (const [lid, group] of Object.entries(items))
    {
        const reactions = group?.reactions || [];
        for (let index = 0; index < reactions.length; index++)
        {
            if (reactions[index]?.workshopId === workshopId)
                return { kind: 'item', lid, index, entry: reactions[index] };
        }
    }
    const generals = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
    for (const [name, entry] of Object.entries(generals))
    {
        if (entry?.workshopId === workshopId)
            return { kind: 'general', name, entry };
    }
    const startups = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
    for (const script of startups)
    {
        if (script?.workshopId === workshopId)
            return { kind: 'startup', id: script.id, entry: script };
    }
    return null;
}

function comparableReaction(reaction)
{
    const result = {};
    for (const field of REACTION_FIELDS)
    {
        let value = reaction?.[field];
        if (typeof value === 'function')
            value = value.toString();
        result[field] = value ?? null;
    }
    if (!Array.isArray(result.dispositionFilter) || result.dispositionFilter.length === 0)
        result.dispositionFilter = null;
    return result;
}

function reactionsEqual(remote, local)
{
    return foundry.utils.objectsEqual(comparableReaction(remote), comparableReaction(local));
}

/** @returns {'new'|'update'|'ok'|'broken'|null} null = content not fetched yet */
function fileStatus(path)
{
    const text = state.files.get(path);
    if (text === undefined)
        return null;
    let json;
    try
    {
        json = JSON.parse(text);
    }
    catch
    {
        return 'broken';
    }
    const kind = classifyPayload(json);
    const workshopId = pathWorkshopId(path);

    if (kind === 'automation')
    {
        const local = findLocalByWorkshopId(workshopId);
        if (!local)
            return 'new';
        if (json.isGeneral && local.kind === 'general' && (json.name || json.lid) !== local.name)
            return 'update';
        return reactionsEqual(json.reaction, local.entry) ? 'ok' : 'update';
    }
    if (kind === 'startup')
    {
        const local = findLocalByWorkshopId(workshopId);
        if (!local)
            return 'new';
        const sameCode = (local.entry.code || '') === (json.code || '');
        const sameDescription = (local.entry.description || '') === (json.description || '');
        return sameCode && sameDescription ? 'ok' : 'update';
    }
    if (kind === 'pack')
    {
        const statuses = packEntries(json, workshopId).map(entry => entry.status);
        if (!statuses.length)
            return 'broken';
        if (statuses.every(status => status === 'ok'))
            return 'ok';
        if (statuses.every(status => status === 'new'))
            return 'new';
        return 'update';
    }
    return 'broken';
}

// Pack contents

function packEntries(json, packWorkshopId)
{
    const entries = [];
    for (const [lid, group] of Object.entries(json.itemReactions || {}))
    {
        const workshopId = `${packWorkshopId}::item::${lid}`;
        entries.push({ section: 'item', key: lid, label: lid, workshopId, group, status: packItemStatus(workshopId, group) });
    }
    for (const [name, reaction] of Object.entries(json.generalReactions || {}))
    {
        const workshopId = `${packWorkshopId}::general::${name}`;
        const local = findLocalByWorkshopId(workshopId);
        let status = 'new';
        if (local)
            status = (local.name === name && reactionsEqual(reaction, local.entry)) ? 'ok' : 'update';
        entries.push({ section: 'general', key: name, label: name, workshopId, reaction, status });
    }
    for (const script of (json.startupScripts || []))
    {
        const key = script.id ?? script.name ?? '';
        const workshopId = `${packWorkshopId}::startup::${key}`;
        const local = findLocalByWorkshopId(workshopId);
        let status = 'new';
        if (local)
            status = ((local.entry.code || '') === (script.code || '')) ? 'ok' : 'update';
        entries.push({ section: 'startup', key, label: script.name || key, workshopId, script, status });
    }
    return entries;
}

function packItemStatus(workshopId, group)
{
    const items = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
    const localReactions = [];
    for (const localGroup of Object.values(items))
    {
        for (const reaction of (localGroup?.reactions || []))
        {
            if (reaction?.workshopId === workshopId)
                localReactions.push(reaction);
        }
    }
    const remote = group?.reactions || [];
    if (!localReactions.length)
        return 'new';
    if (localReactions.length !== remote.length)
        return 'update';
    return remote.every((reaction, index) => reactionsEqual(reaction, localReactions[index])) ? 'ok' : 'update';
}

// Import engine

async function importAutomationPayload(json, workshopId)
{
    const author = authorOfId(workshopId);
    if (json.isGeneral)
    {
        const name = json.name || json.lid;
        if (!name)
            throw new Error('General activation without a name.');
        const generals = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
        for (const [otherName, other] of Object.entries(generals))
        {
            if (other?.workshopId === workshopId && otherName !== name)
                delete generals[otherName];
        }
        generals[name] = { ...json.reaction, workshopId };
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, generals);
        await ReactionManager.createFolder(author);
        await ReactionManager.assignToFolder(author, `general::${name}`);
    }
    else
    {
        const lid = json.lid;
        if (!lid)
            throw new Error('Item activation without a LID.');
        const items = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        const newReaction = { ...json.reaction, workshopId };
        let placed = false;
        for (const [otherLid, group] of Object.entries(items))
        {
            const reactions = group?.reactions || [];
            const index = reactions.findIndex(reaction => reaction?.workshopId === workshopId);
            if (index < 0)
                continue;
            if (otherLid === lid)
            {
                reactions[index] = newReaction;
                placed = true;
            }
            else
                reactions.splice(index, 1);
        }
        if (!placed)
        {
            if (!items[lid])
                items[lid] = { itemType: 'any', reactions: [] };
            items[lid].reactions.push(newReaction);
        }
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, items);
        await ReactionManager.createFolder(author);
        await ReactionManager.assignToFolder(author, `item::${lid}`);
    }
}

async function importStartupPayload(json, workshopId, fileName)
{
    const author = authorOfId(workshopId);
    const scripts = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS) || [];
    const name = `${author} - ${String(fileName).replace(/\.json$/i, '')}`;
    const index = scripts.findIndex(script => script?.workshopId === workshopId);
    const entry = {
        id: index >= 0 ? scripts[index].id : foundry.utils.randomID(),
        name,
        description: json.description || '',
        enabled: index >= 0 ? scripts[index].enabled !== false : json.enabled !== false,
        code: json.code || '',
        workshopId
    };
    if (index >= 0)
        scripts[index] = entry;
    else
        scripts.push(entry);
    await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_STARTUP_SCRIPTS, scripts);
}

async function importPackEntry(entry)
{
    const author = authorOfId(entry.workshopId);
    if (entry.section === 'item')
    {
        const items = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
        for (const group of Object.values(items))
        {
            const reactions = group?.reactions || [];
            for (let index = reactions.length - 1; index >= 0; index--)
            {
                if (reactions[index]?.workshopId === entry.workshopId)
                    reactions.splice(index, 1);
            }
        }
        if (!items[entry.key])
            items[entry.key] = { itemType: entry.group?.itemType || 'any', reactions: [] };
        for (const reaction of (entry.group?.reactions || []))
            items[entry.key].reactions.push({ ...reaction, workshopId: entry.workshopId });
        await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, items);
        await ReactionManager.createFolder(author);
        await ReactionManager.assignToFolder(author, `item::${entry.key}`);
    }
    else if (entry.section === 'general')
        await importAutomationPayload({ isGeneral: true, name: entry.key, reaction: entry.reaction }, entry.workshopId);
    else if (entry.section === 'startup')
        await importStartupPayload(entry.script, entry.workshopId, entry.script.name || entry.key);
}

/** @returns {Promise<number>} imported entry count */
async function importPath(path)
{
    const text = await fetchFile(path);
    const json = JSON.parse(text);
    const kind = classifyPayload(json);
    const workshopId = pathWorkshopId(path);
    if (kind === 'automation')
    {
        await importAutomationPayload(json, workshopId);
        return 1;
    }
    if (kind === 'startup')
    {
        await importStartupPayload(json, workshopId, fileNameOf(path));
        return 1;
    }
    if (kind === 'pack')
    {
        const entries = packEntries(json, workshopId);
        for (const entry of entries)
            await importPackEntry(entry);
        return entries.length;
    }
    throw new Error(`Unrecognized file content: ${path}`);
}

function afterImport()
{
    clearScriptCache();
    state.manager?.render();
}

// Editors

async function openWorkshopFile(path)
{
    let json;
    try
    {
        json = JSON.parse(await fetchFile(path));
    }
    catch (err)
    {
        ui.notifications.error(`Could not open ${fileNameOf(path)}: ${err.message}`);
        renderCurrentView();
        return;
    }
    renderCurrentView();

    const kind = classifyPayload(json);
    const workshopId = pathWorkshopId(path);
    if (kind === 'automation')
    {
        new ReactionEditor({
            isGeneral: json.isGeneral === true,
            lid: json.lid || '',
            name: json.name || (json.isGeneral ? json.lid : ''),
            reaction: { ...json.reaction, workshopId },
            reactionIndex: undefined,
            workshopPreview: true
        }).render(true);
    }
    else if (kind === 'startup')
    {
        const author = authorOfId(workshopId);
        const local = findLocalByWorkshopId(workshopId);
        new StartupScriptEditor({
            script: {
                id: local?.entry?.id || foundry.utils.randomID(),
                name: `${author} - ${fileNameOf(path).replace(/\.json$/i, '')}`,
                description: json.description || '',
                enabled: json.enabled !== false,
                code: json.code || '',
                workshopId
            },
            manager: state.manager,
            workshopPreview: true
        }).render(true);
    }
    else if (kind === 'pack')
        openWorkshopPackDialog(path, json);
    else
        ui.notifications.warn(`${fileNameOf(path)} is not a recognized automation, pack, or startup file.`);
}

function openInnerPackEntryEditor(entry)
{
    if (entry.section === 'item')
    {
        const reaction = entry.group?.reactions?.[0];
        if (!reaction)
            return;
        new ReactionEditor({
            isGeneral: false,
            lid: entry.key,
            name: '',
            reaction: { ...reaction, workshopId: entry.workshopId },
            reactionIndex: undefined,
            workshopPreview: true
        }).render(true);
    }
    else if (entry.section === 'general')
    {
        new ReactionEditor({
            isGeneral: true,
            lid: entry.key,
            name: entry.key,
            reaction: { ...entry.reaction, workshopId: entry.workshopId },
            reactionIndex: undefined,
            workshopPreview: true
        }).render(true);
    }
    else if (entry.section === 'startup')
    {
        new StartupScriptEditor({
            script: { ...entry.script, id: findLocalByWorkshopId(entry.workshopId)?.entry?.id || foundry.utils.randomID(), workshopId: entry.workshopId },
            manager: state.manager,
            workshopPreview: true
        }).render(true);
    }
}

// Rendering helpers

function statusBadge(status)
{
    const badges = {
        new: ['NEW', 'var(--la-accent)'],
        update: ['UPDATE', '#b3822d'],
        ok: ['OK', '#3c8c4a'],
        broken: ['BROKEN', '#a33']
    };
    if (!status || !badges[status])
        return '';
    const [label, color] = badges[status];
    return `<span style="font-size: 0.75em; font-weight: bold; color: ${color}; border: 1px solid ${color}; border-radius: 3px; padding: 0 5px; margin-left: 6px;">${label}</span>`;
}

function renderMarkdown(markdown)
{
    const showdownLib = globalThis.showdown;
    if (!showdownLib)
        return `<pre style="white-space: pre-wrap;">${esc(markdown)}</pre>`;
    let html;
    try
    {
        const converter = new showdownLib.Converter({ tables: true, strikethrough: true, ghCodeBlocks: true, simplifiedAutoLink: true });
        html = converter.makeHtml(markdown);
    }
    catch
    {
        return `<pre style="white-space: pre-wrap;">${esc(markdown)}</pre>`;
    }
    if (globalThis.DOMPurify)
        html = globalThis.DOMPurify.sanitize(html);
    return html;
}

function lastSyncLabel()
{
    if (!state.treeFetchedAt)
        return '';
    const minutes = Math.round((Date.now() - state.treeFetchedAt) / 60000);
    return minutes < 1 ? 'just now' : `${minutes} min ago`;
}

function renderCurrentView()
{
    if (!state.root)
        return;
    if (state.view.mode === 'contributor')
        renderContributorView(state.view.author);
    else
        renderListView();
}

// Main list view

function contributorSummary(contributor)
{
    const parts = [];
    if (contributor.automations.length)
        parts.push(`${contributor.automations.length} automation${contributor.automations.length === 1 ? '' : 's'}`);
    if (contributor.packs.length)
        parts.push(`${contributor.packs.length} pack${contributor.packs.length === 1 ? '' : 's'}`);
    if (contributor.startups.length)
        parts.push(`${contributor.startups.length} startup${contributor.startups.length === 1 ? '' : 's'}`);
    return parts.join(', ') || 'empty';
}

function contributorBadgeSummary(contributor)
{
    const paths = [...contributor.automations, ...contributor.packs, ...contributor.startups];
    if (!paths.length || !paths.every(path => state.files.has(path)))
        return '';
    const statuses = paths.map(path => fileStatus(path));
    const news = statuses.filter(status => status === 'new').length;
    const updates = statuses.filter(status => status === 'update').length;
    if (!news && !updates)
        return '<span style="color: #3c8c4a; font-size: 0.85em;">all imported</span>';
    const parts = [];
    if (news)
        parts.push(`${news} new`);
    if (updates)
        parts.push(`<b style="color: #b3822d;">${updates} update${updates === 1 ? '' : 's'}</b>`);
    return `<span style="font-size: 0.85em; color: var(--la-ink-dim);">${parts.join(', ')}</span>`;
}

function renderListView()
{
    const contributors = getContributors();
    const rows = contributors.map(contributor => `
        <div class="reaction-item flexrow la-ws-contrib" data-author="${esc(contributor.author)}" style="cursor: pointer;">
            <span class="col-enabled"></span>
            <span class="col-type"><i class="fas fa-folder" title="Contributor" style="color: var(--primary-color);"></i></span>
            <span class="col-name"><strong>${esc(contributor.author)}</strong>
                <span style="font-size: 0.85em; color: var(--la-ink-dim); margin-left: 6px;">${contributorSummary(contributor)}</span>
            </span>
            <span class="col-triggers">${contributorBadgeSummary(contributor)}</span>
            <span class="col-controls"><i class="fas fa-chevron-right"></i></span>
        </div>`).join('');

    state.root.innerHTML = `
        <div class="lancer-action-buttons" style="margin: 0 0 8px 0;">
            <button type="button" class="lancer-action-btn la-ws-refresh"><i class="fas fa-rotate"></i> Refresh</button>
        </div>
        <p class="notes" style="margin-bottom: 8px; font-size: 11px; color: var(--la-ink-dim);">
            Want to share your own? <a class="la-ws-contribute" style="cursor: pointer; color: var(--primary-color); font-weight: bold;">Contribute on GitHub</a>
            <span style="float: right;">last sync: ${lastSyncLabel()}</span>
        </p>
        <div class="reaction-list flexcol" style="flex: 1; display: flex; flex-direction: column; min-height: 0;">
            <div class="reaction-header flexrow">
                <span class="col-enabled"></span>
                <span class="col-type">Type</span>
                <span class="col-name">Contributor</span>
                <span class="col-triggers">Status</span>
                <span class="col-controls"></span>
            </div>
            <div class="scrollable">
                ${rows || '<p class="notes" style="text-align: center; padding: 16px;">No contributors found.</p>'}
            </div>
        </div>`;

    const root = state.root;
    root.querySelector('.la-ws-refresh')?.addEventListener('click', async () =>
    {
        try
        {
            state.files.clear();
            await fetchTree(true);
        }
        catch (err)
        {
            ui.notifications.error(`Workshop refresh failed: ${err.message}`);
        }
        renderCurrentView();
    });
    root.querySelector('.la-ws-contribute')?.addEventListener('click', () => window.open(CONTRIBUTE_URL, '_blank'));
    for (const row of root.querySelectorAll('.la-ws-contrib'))
        row.addEventListener('click', () => openContributor(row.dataset.author));
}

// Contributor view

async function openContributor(author)
{
    state.view = { mode: 'contributor', author };
    state.checked.clear();
    const contributor = getContributors().find(candidate => candidate.author === author);
    if (!contributor)
        return renderListView();

    state.root.innerHTML = '<p class="notes" style="text-align: center; padding: 16px;"><i class="fas fa-spinner fa-spin"></i> Loading files...</p>';
    const paths = [...contributor.automations, ...contributor.packs, ...contributor.startups];
    if (contributor.listMd)
        paths.push(contributor.listMd);
    await Promise.allSettled(paths.map(path => fetchFile(path)));
    renderContributorView(author);
}

function fileControlHtml(path)
{
    const checked = state.checked.has(path) ? 'checked' : '';
    return `<input type="checkbox" class="la-ws-check" ${checked}><a class="la-ws-open">${esc(fileNameOf(path))}</a>${statusBadge(fileStatus(path))}`;
}

function fileRow(path)
{
    return `
        <div class="reaction-item flexrow">
            <span class="col-name"><span class="la-ws-file" data-path="${esc(path)}">${fileControlHtml(path)}</span></span>
            <span class="col-controls"></span>
        </div>`;
}

/** Replaces file references inside the rendered List.md with the interactive controls. */
function buildEnhancedList(contributor, allPaths)
{
    const listText = contributor.listMd ? state.files.get(contributor.listMd) : null;
    const container = document.createElement('div');
    container.className = 'la-ws-listmd';
    container.innerHTML = listText ? renderMarkdown(listText) : '';

    const lookup = new Map();
    for (const path of allPaths)
    {
        const rel = path.replace(/^contributors\/[^/]+\//, '');
        lookup.set(rel.toLowerCase(), path);
        lookup.set(fileNameOf(path).toLowerCase(), path);
    }

    const matched = new Set();
    for (const codeEl of [...container.querySelectorAll('code')])
    {
        const key = codeEl.textContent.trim().toLowerCase();
        const path = lookup.get(key);
        if (!path)
            continue;
        matched.add(path);
        const control = document.createElement('span');
        control.className = 'la-ws-file';
        control.dataset.path = path;
        control.innerHTML = fileControlHtml(path);
        codeEl.replaceWith(control);
    }
    return { container, matched };
}

function wireFileControls(root)
{
    for (const control of root.querySelectorAll('.la-ws-file[data-path]'))
    {
        const path = control.dataset.path;
        control.querySelector('.la-ws-open')?.addEventListener('click', () => openWorkshopFile(path));
        control.querySelector('.la-ws-check')?.addEventListener('change', (event) =>
        {
            const checked = event.currentTarget.checked;
            if (checked)
                state.checked.add(path);
            else
                state.checked.delete(path);
            for (const twin of root.querySelectorAll(`.la-ws-file[data-path="${CSS.escape(path)}"] .la-ws-check`))
                twin.checked = checked;
            const counter = root.querySelector('.la-ws-count');
            if (counter)
                counter.textContent = String(state.checked.size);
        });
    }
}

function renderContributorView(author)
{
    const contributor = getContributors().find(candidate => candidate.author === author);
    if (!contributor)
        return renderListView();

    const allPaths = [...contributor.automations, ...contributor.packs, ...contributor.startups];
    const { container, matched } = buildEnhancedList(contributor, allPaths);
    const unlisted = allPaths.filter(path => !matched.has(path));

    state.root.innerHTML = `
        <div class="lancer-action-buttons" style="margin: 0 0 8px 0;">
            <button type="button" class="lancer-action-btn la-ws-back"><i class="fas fa-arrow-left"></i> Back</button>
            <span style="flex: 1; align-self: center; text-align: center; font-weight: bold; text-transform: uppercase; letter-spacing: 1px;">${esc(author)}</span>
            <button type="button" class="lancer-action-btn la-ws-github"><i class="fab fa-github"></i> Open on GitHub</button>
        </div>
        <div class="scrollable" style="flex: 1;">
            ${unlisted.length ? `
            <div class="reaction-list flexcol" style="margin-top: 8px;">
                <div class="reaction-header flexrow"><span class="col-name">Not listed in List.md</span><span class="col-controls"></span></div>
                ${unlisted.map(fileRow).join('')}
            </div>` : ''}
        </div>
        <div class="lancer-action-buttons" style="margin: 8px 0 0 0;">
            <button type="button" class="lancer-action-btn la-ws-import-selected"><i class="fas fa-file-import"></i> Import selected (<span class="la-ws-count">${state.checked.size}</span>)</button>
        </div>`;

    const root = state.root;
    const scrollable = root.querySelector('.scrollable');
    if (container.innerHTML.trim())
        scrollable.prepend(container);
    else
        scrollable.insertAdjacentHTML('afterbegin', '<p class="notes" style="padding: 8px;">No List.md provided.</p>');

    root.querySelector('.la-ws-back')?.addEventListener('click', () =>
    {
        state.view = { mode: 'list', author: null };
        renderListView();
    });
    root.querySelector('.la-ws-github')?.addEventListener('click', () =>
    {
        const url = contributor.listMd
            ? `${REPO_URL}/blob/${REPO_BRANCH}/${contributor.listMd.split('/').map(encodeURIComponent).join('/')}`
            : `${REPO_URL}/tree/${REPO_BRANCH}/contributors/${encodeURIComponent(author)}`;
        window.open(url, '_blank');
    });
    for (const anchor of root.querySelectorAll('.la-ws-listmd a'))
        anchor.setAttribute('target', '_blank');

    wireFileControls(root);

    root.querySelector('.la-ws-import-selected')?.addEventListener('click', async () =>
    {
        const paths = [...state.checked];
        if (!paths.length)
            return ui.notifications.warn('Nothing selected.');
        let imported = 0;
        const failed = [];
        for (const path of paths)
        {
            try
            {
                imported += await importPath(path);
                state.checked.delete(path);
            }
            catch (err)
            {
                failed.push(`${fileNameOf(path)}: ${err.message}`);
            }
        }
        afterImport();
        if (imported)
            ui.notifications.info(`Imported ${imported} workshop entr${imported === 1 ? 'y' : 'ies'}.`);
        for (const message of failed)
            ui.notifications.error(`Import failed: ${message}`);
    });
}

// Pack dialog

function openWorkshopPackDialog(path, json)
{
    const workshopId = pathWorkshopId(path);
    const author = authorOfId(workshopId);
    const entries = packEntries(json, workshopId);
    const sections = [
        ['item', 'Item activations'],
        ['general', 'General activations'],
        ['startup', 'Startup scripts']
    ];

    const body = sections.map(([section, label]) =>
    {
        const rows = entries.filter(entry => entry.section === section).map(entry => `
            <label style="display: flex; align-items: center; gap: 6px; font-size: 0.9em;">
                <input type="checkbox" class="la-wsp-check" data-id="${esc(entry.workshopId)}" ${entry.status === 'ok' ? '' : 'checked'}>
                <a class="la-wsp-open" data-id="${esc(entry.workshopId)}" style="cursor: pointer; color: var(--primary-color);">${esc(entry.label)}</a>
                ${statusBadge(entry.status)}
            </label>`);
        if (!rows.length)
            return '';
        return `<div style="font-weight: bold; margin-top: 8px;">${label}</div>${rows.join('')}`;
    }).join('');

    new Dialog({
        title: `Pack: ${json.name || fileNameOf(path)} (${author})`,
        content: `<div class="lancer-scroll" style="max-height: 55vh; overflow-y: auto; display: flex; flex-direction: column; gap: 2px;">${body || '<p class="notes">Empty pack.</p>'}</div>`,
        buttons: {
            import: {
                icon: '<i class="fas fa-file-import"></i>',
                label: 'Import selected',
                callback: async (html) =>
                {
                    const chosen = new Set();
                    html.find('.la-wsp-check:checked').each((_index, element) => chosen.add(element.dataset.id));
                    const picked = entries.filter(entry => chosen.has(entry.workshopId));
                    if (!picked.length)
                        return ui.notifications.warn('Nothing selected.');
                    for (const entry of picked)
                        await importPackEntry(entry);
                    afterImport();
                    ui.notifications.info(`Imported ${picked.length} entr${picked.length === 1 ? 'y' : 'ies'} from ${json.name || fileNameOf(path)}.`);
                }
            },
            cancel: { icon: '<i class="fas fa-times"></i>', label: 'Close' }
        },
        default: 'import',
        render: (html) =>
        {
            html.find('.la-wsp-open').on('click', (event) =>
            {
                const id = event.currentTarget.dataset.id;
                const entry = entries.find(candidate => candidate.workshopId === id);
                if (entry)
                    openInnerPackEntryEditor(entry);
            });
        }
    }, { width: 520, classes: ['lancer-automations-dialog', 'lancer-dialog-base'] }).render(true);
}

// Entry point

export async function renderWorkshopTab(manager, root)
{
    state.manager = manager;
    state.root = root;
    if (!state.tree)
    {
        root.innerHTML = '<p class="notes" style="text-align: center; padding: 16px;"><i class="fas fa-spinner fa-spin"></i> Loading the workshop...</p>';
        try
        {
            await fetchTree();
        }
        catch (err)
        {
            root.innerHTML = `
                <p class="notes" style="text-align: center; padding: 16px; color: #a33;">Could not reach the workshop: ${esc(err.message)}</p>
                <div style="text-align: center;"><button type="button" class="lancer-action-btn la-ws-retry"><i class="fas fa-rotate"></i> Retry</button></div>`;
            root.querySelector('.la-ws-retry')?.addEventListener('click', () => renderWorkshopTab(manager, root));
            return;
        }
    }
    renderCurrentView();
}
