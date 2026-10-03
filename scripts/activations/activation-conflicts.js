import { escapeHtml, localize, localizeFormat } from "../tools/string-utils.js";

const DRAWER_WIDTH = 300;

const activeTriggers = (sub) => [...(Array.isArray(sub.triggers) ? sub.triggers : []), ...(sub.onInit ? ['onInit'] : [])];

const entryId = (entry) => `${entry.kind}|${entry.key}|${entry.index ?? ''}`;

export function findActivationConflicts({ items, generals, userItemSettings, userGeneralSettings, defaultItemRegistry, defaultGeneralRegistry, itemMap, resolveActionName, activationTriggers })
{
    const itemEntries = [];
    const generalEntries = [];

    for (const [lid, group] of Object.entries(items))
    {
        const subs = Array.isArray(group?.reactions) ? group.reactions : [];
        const itemInfo = itemMap.get(lid.trim());
        subs.forEach((sub, index) =>
        {
            if (!sub || sub.enabled === false)
                return;
            const triggers = activeTriggers(sub);
            if (!triggers.length)
                return;
            const path = sub.reactionPath || '';
            const pathName = (path.startsWith('extraActions.') || path.startsWith('actions.'))
                ? path.slice(path.indexOf('.') + 1)
                : (itemInfo ? resolveActionName(itemInfo.system, path) : null);
            const actionName = pathName ?? ((!path && sub.onlyOnSourceMatch) ? (itemInfo?.name ?? null) : null);
            itemEntries.push({
                kind: 'item',
                key: lid,
                index,
                isCustom: !defaultItemRegistry[lid] || userItemSettings[lid]?.reactions?.[index]?.triggers !== undefined,
                triggers,
                path,
                actionName,
                name: itemInfo ? (pathName ? `${itemInfo.name}: ${pathName}` : itemInfo.name) : (sub.name || lid),
                detail: sub.comments || lid,
                multi: subs.length > 1
            });
        });
    }

    for (const [name, entry] of Object.entries(generals))
    {
        const isGroup = Array.isArray(entry?.reactions);
        const subs = isGroup ? entry.reactions : [entry];
        const saved = userGeneralSettings[name];
        subs.forEach((sub, subIndex) =>
        {
            if (!sub || (sub.enabled ?? entry.enabled) === false)
                return;
            const triggers = activeTriggers(sub);
            if (!triggers.length)
                return;
            generalEntries.push({
                kind: 'general',
                key: name,
                index: isGroup ? subIndex : null,
                isCustom: !defaultGeneralRegistry[name] || (isGroup ? saved?.reactions?.[subIndex]?.triggers !== undefined : saved?.triggers !== undefined),
                triggers,
                actionBased: !!sub.onlyOnSourceMatch,
                name,
                detail: sub.comments || '',
                multi: isGroup && subs.length > 1
            });
        });
    }

    const cards = new Map();
    const addCollision = (keyLabel, keyValue, note, trigger, members) =>
    {
        const ids = members.map(entryId).sort();
        const cardKey = `${keyLabel}|${keyValue}|${ids.join(',')}`;
        const card = cards.get(cardKey) ?? { keyLabel, keyValue, note, triggers: [], members };
        card.triggers.push(trigger);
        cards.set(cardKey, card);
    };
    const groupBy = (list, keyOf) =>
    {
        const groups = new Map();
        for (const entry of list)
        {
            const groupKey = keyOf(entry);
            if (groupKey === null || groupKey === undefined)
                continue;
            if (!groups.has(groupKey))
                groups.set(groupKey, []);
            groups.get(groupKey).push(entry);
        }
        return groups;
    };
    const triggersOf = (list) => [...new Set(list.flatMap(entry => entry.triggers))];
    const noteSame = localize('LA.reactionConfig.conflictNoteSame');

    for (const [lid, group] of groupBy(itemEntries, entry => entry.key))
    {
        for (const trigger of triggersOf(group))
        {
            const withTrigger = group.filter(entry => entry.triggers.includes(trigger));
            const byPath = activationTriggers.has(trigger) ? groupBy(withTrigger, entry => entry.path) : new Map([['', withTrigger]]);
            for (const members of byPath.values())
            {
                if (members.length > 1)
                    addCollision('LA.reactionConfig.conflictKeyLid', lid, noteSame, trigger, members);
            }
        }
    }

    for (const [name, group] of groupBy(generalEntries, entry => entry.key))
    {
        for (const trigger of triggersOf(group))
        {
            const members = group.filter(entry => entry.triggers.includes(trigger));
            if (members.length > 1)
                addCollision('LA.reactionConfig.conflictKeyName', name, noteSame, trigger, members);
        }
    }

    const itemsByAction = groupBy(itemEntries, entry => entry.actionName);
    for (const [name, group] of groupBy(generalEntries.filter(entry => entry.actionBased), entry => entry.key))
    {
        const itemGroup = itemsByAction.get(name);
        if (!itemGroup)
            continue;
        for (const trigger of triggersOf(group))
        {
            if (!activationTriggers.has(trigger))
                continue;
            const itemMembers = itemGroup.filter(entry => entry.triggers.includes(trigger));
            if (!itemMembers.length)
                continue;
            const generalMembers = group.filter(entry => entry.triggers.includes(trigger));
            addCollision('LA.reactionConfig.conflictKeyAction', name,
                localizeFormat('LA.reactionConfig.conflictNoteAction', { action: name }), trigger, [...generalMembers, ...itemMembers]);
        }
    }

    return [...cards.values()].sort((left, right) => String(left.keyValue).localeCompare(String(right.keyValue)));
}

export function collectEditedDefaults(defaultList)
{
    const rows = defaultList.flatMap(entry => entry.isGroup
        ? entry.reactions.map(sub => ({ row: sub, multi: true }))
        : [{ row: entry, multi: false }]);
    return rows.filter(({ row }) => row.isOverridden).map(({ row, multi }) => ({
        kind: row.isGeneral ? 'general' : 'item',
        key: row.isGeneral ? row.name : row.lid,
        index: Number.isFinite(row.reactionIndex) ? row.reactionIndex : null,
        isCustom: false,
        actionBased: !!row.onlyOnSourceMatch,
        name: row.name,
        detail: [row.isGeneral ? '' : row.lid, row.triggers].filter(Boolean).join(' · '),
        multi
    }));
}

const typeIcon = (entry) =>
{
    if (entry.kind !== 'general')
        return 'fa-cube';
    return entry.actionBased ? 'fa-input-text' : 'fa-globe';
};

function renderRow(entry, refIndex, { source, editable })
{
    const indexLabel = entry.multi && Number.isFinite(entry.index) ? ` <span class="la-conflict-index">#${entry.index + 1}</span>` : '';
    return `
        <div class="la-conflict-row" data-ref="${refIndex}" tabindex="0" title="${escapeHtml(localize('LA.reactionConfig.showInList'))}">
            <i class="fas ${typeIcon(entry)} la-conflict-type"></i>
            <div class="la-conflict-text">
                <div class="la-conflict-name">${escapeHtml(entry.name)}${indexLabel}</div>
                <div class="la-conflict-detail" title="${escapeHtml(entry.detail)}">${escapeHtml(entry.detail)}</div>
            </div>
            ${source ? `<span class="la-conflict-source">${escapeHtml(source)}</span>` : ''}
            ${editable ? `<a class="la-conflict-edit" title="${escapeHtml(localize('LA.reactionConfig.edit'))}"><i class="fas fa-pen"></i></a>` : ''}
        </div>`;
}

function renderDrawer(report, refs)
{
    const sourceCustom = localize('LA.reactionConfig.conflictFromCustom');
    const sourceDefault = localize('LA.reactionConfig.conflictFromDefault');
    const cards = report.conflicts.map(card =>
    {
        const rows = card.members.map(member =>
        {
            refs.push({ revealRef: member, editRef: member.isCustom ? member : null });
            return renderRow(member, refs.length - 1, { source: member.isCustom ? sourceCustom : sourceDefault, editable: member.isCustom });
        }).join('');
        return `
            <div class="la-conflict-card">
                <div class="la-conflict-head">
                    <span class="la-conflict-badge">${escapeHtml(localize('LA.reactionConfig.conflictBothFire'))}</span>
                    <span class="la-conflict-triggers">${card.triggers.map(trigger => `<code>${escapeHtml(trigger)}</code>`).join(' ')}</span>
                </div>
                <div class="la-conflict-key">${escapeHtml(localize(card.keyLabel))} <span>${escapeHtml(card.keyValue)}</span></div>
                <div class="la-conflict-list">${rows}</div>
                <div class="la-conflict-note">${escapeHtml(card.note)}</div>
            </div>`;
    }).join('');

    const editedRows = report.edited.map(entry =>
    {
        refs.push({ revealRef: entry, editRef: { ...entry, isCustom: true } });
        return renderRow(entry, refs.length - 1, { source: null, editable: true });
    }).join('');
    const editedSection = report.edited.length ? `
        <div class="la-conflict-section">
            <div class="la-conflict-section-title"><span>${escapeHtml(localize('LA.reactionConfig.editedDefaults'))}</span><span>${report.edited.length}</span></div>
            <div class="la-conflict-note">${escapeHtml(localize('LA.reactionConfig.editedDefaultsHint'))}</div>
            <div class="la-conflict-list">${editedRows}</div>
        </div>` : '';

    return `
        <div class="la-conflict-top">
            <div class="la-conflict-title">${escapeHtml(localize('LA.reactionConfig.conflicts'))}</div>
            <a class="la-conflict-close" title="${escapeHtml(localize('LA.common.close'))}">&times;</a>
        </div>
        <div class="la-conflict-summary">${escapeHtml(localizeFormat('LA.reactionConfig.conflictsSummary', { conflicts: report.conflicts.length, edited: report.edited.length }))}</div>
        <div class="la-conflict-body">
            ${cards || `<div class="la-conflict-empty">${escapeHtml(localize('LA.reactionConfig.noConflicts'))}</div>`}
            ${editedSection}
        </div>`;
}

function findRows(app, tab, ref)
{
    const rows = app.element.find(`.tab[data-tab="${tab}"] .scrollable:not(.scrollable-by-trigger) .reaction-item:not(.group-header):not(.folder-header)`).toArray();
    const sameKey = rows.filter(el => (el.dataset.isGeneral === 'true') === (ref.kind === 'general')
        && (ref.kind === 'general' ? el.dataset.name : el.dataset.lid) === ref.key);
    const wantedIndex = ref.index === null ? '' : String(ref.index);
    const exact = sameKey.filter(el => (el.dataset.index ?? '') === wantedIndex);
    return exact.length ? exact : sameKey;
}

function revealRow(app, ref)
{
    const tab = ref.isCustom ? 'custom' : 'defaults';
    app._tabs?.[0]?.activate(tab);
    const tabEl = app.element.find(`.tab[data-tab="${tab}"]`);
    tabEl.find('.group-by-trigger-toggle.active').trigger('click');
    const row = findRows(app, tab, ref)[0];
    if (!row)
        return;
    $(row).parents('.reaction-sublist').each((_index, sublist) =>
    {
        $(sublist).show();
        $(sublist).prev('.group-header').find('.expand-icon').removeClass('fa-caret-right').addClass('fa-caret-down');
    });
    $(row).parents('.folder-content').each((_index, content) =>
    {
        $(content).show();
        $(content).prev('.folder-header').find('.folder-expand-icon').removeClass('fa-folder').addClass('fa-folder-open');
    });
    if (!$(row).is(':visible'))
    {
        tabEl.find('.trigger-filter').val('');
        tabEl.find('.search-input').val('').trigger('input');
    }
    const scroller = $(row).closest('.scrollable')[0];
    if (scroller)
    {
        const delta = row.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
        scroller.scrollTo({ top: scroller.scrollTop + delta - scroller.clientHeight / 3, behavior: 'smooth' });
    }
    row.classList.remove('la-conflict-flash');
    row.getBoundingClientRect();
    row.classList.add('la-conflict-flash');
}

function editRow(app, ref)
{
    const row = findRows(app, 'custom', ref)[0];
    if (row)
        $(row).find('.edit-reaction').trigger('click');
}

function setDrawerOpen(app, open)
{
    const drawer = app._conflictDrawer;
    if (!drawer)
        return;
    app._conflictDrawerOpen = open;
    app._conflictFollow?.disconnect();
    app._conflictFollow = null;
    const appEl = app.element?.[0];
    if (!open || !appEl)
    {
        drawer.classList.remove('open');
        return;
    }
    const place = () =>
    {
        const rect = appEl.getBoundingClientRect();
        const viewportWidth = globalThis.innerWidth || 1920;
        const openLeft = (rect.right + DRAWER_WIDTH + 12 > viewportWidth) && (rect.left - DRAWER_WIDTH - 12 >= 0);
        const appZ = Number.parseInt(globalThis.getComputedStyle(appEl).zIndex, 10);
        drawer.classList.toggle('flip', openLeft);
        drawer.style.top = (rect.top + 14) + 'px';
        drawer.style.left = (openLeft ? (rect.left - DRAWER_WIDTH + 6) : (rect.right - 6)) + 'px';
        drawer.style.height = (rect.height - 28) + 'px';
        drawer.style.zIndex = String(Number.isFinite(appZ) ? appZ - 1 : 90);
    };
    place();
    drawer.getBoundingClientRect();
    drawer.classList.add('open');
    app._conflictFollow = new MutationObserver(() => place());
    app._conflictFollow.observe(appEl, { attributes: true, attributeFilter: ['style'] });
}

function onDrawerClick(app, event)
{
    const target = /** @type {HTMLElement} */ (event.target);
    if (target.closest('.la-conflict-close'))
    {
        setDrawerOpen(app, false);
        return;
    }
    const rowEl = /** @type {HTMLElement} */ (target.closest('.la-conflict-row'));
    const entry = rowEl ? app._conflictRefs?.[Number(rowEl.dataset.ref)] : null;
    if (!entry)
        return;
    if (target.closest('.la-conflict-edit'))
    {
        if (entry.editRef)
            editRow(app, entry.editRef);
        return;
    }
    revealRow(app, entry.revealRef);
}

export function bindConflictDrawer(app, html)
{
    let drawer = app._conflictDrawer;
    if (!drawer)
    {
        drawer = document.createElement('aside');
        drawer.className = 'la-conflict-drawer lancer-dialog-base';
        drawer.addEventListener('click', (event) => onDrawerClick(app, event));
        drawer.addEventListener('keydown', (event) =>
        {
            if ((event.key === 'Enter' || event.key === ' ') && /** @type {HTMLElement} */ (event.target).matches('.la-conflict-row'))
            {
                event.preventDefault();
                onDrawerClick(app, event);
            }
        });
        document.body.appendChild(drawer);
        app._conflictDrawer = drawer;
    }
    const refs = [];
    drawer.innerHTML = renderDrawer(app._conflictReport ?? { conflicts: [], edited: [] }, refs);
    app._conflictRefs = refs;
    html.find('.conflict-btn').on('click', () => setDrawerOpen(app, !app._conflictDrawerOpen));
    if (app._conflictDrawerOpen)
        setDrawerOpen(app, true);
}

export function closeConflictDrawer(app)
{
    app._conflictFollow?.disconnect();
    app._conflictFollow = null;
    app._conflictDrawer?.remove();
    app._conflictDrawer = null;
    app._conflictDrawerOpen = false;
}
