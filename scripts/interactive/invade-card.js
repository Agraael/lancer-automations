import { startPickCard } from "./pick-card.js";
import { localize, localizeFormat, escapeHtml } from "../tools/string-utils.js";
import { laPositionPopup } from "./detail-renderers.js";
import { toggleDetailPopup, invadePopupOptions } from "../tah/hud-popups.js";

export const invadeTargetKey = token => token?.document?.uuid ?? token?.uuid ?? '';

function offReason(option)
{
    if (option.destroyed)
        return localize('LA.invade.offDestroyed');
    if (option.coreLocked)
        return localize('LA.invade.offCore');
    if (option.disabled)
        return localize('LA.invade.offDisabled');
    if (option.unavailable)
        return localize('LA.invade.offUnavailable');
    return '';
}

function showInvadeDetail(option, card, element)
{
    toggleDetailPopup({ ...invadePopupOptions(option), row: null, showPopupAt: popup => laPositionPopup(popup, card.element, element) });
}

function groupedRows(options, pickedKey)
{
    const groups = [];

    for (const option of options)
    {
        let group = groups.find(entry => entry.source === option.source);

        if (!group)
        {
            group = { source: option.source, list: [] };
            groups.push(group);
        }

        group.list.push(option);
    }

    return groups.flatMap(group => group.list.map((option, index) =>
    {
        const why = offReason(option);
        return { option, name: escapeHtml(option.name), section: index === 0 ? escapeHtml(group.source) : null, picked: option.key === pickedKey, off: !!why, why };
    }));
}

export function chooseInvadePerTarget(actor, { targets, options, preview = false, onPreview = null })
{
    const hitTargets = targets ? targets.filter(entry => entry.hit) : [{ token: null, hit: true }];
    const keys = hitTargets.map(entry => invadeTargetKey(entry.token));
    const missed = targets ? targets.filter(entry => !entry.hit).map(entry => escapeHtml(entry.token?.name ?? '')) : [];
    const multi = keys.length > 1;
    const assign = new Map();
    let active = keys[0];

    const missText = missed.length ? ` ${localizeFormat('LA.invade.missed', { names: missed.join(', ') })}` : '';
    let description = localize('LA.invade.unknown');
    if (targets)
    {
        description = multi
            ? `${localizeFormat('LA.invade.hitMany', { count: keys.length })}${missText}`
            : `${localizeFormat('LA.invade.hitOne', { name: escapeHtml(hitTargets[0].token?.name ?? '') })}${missText}`;
    }

    const confirmText = localizeFormat('LA.invade.confirm', { count: keys.length });
    const nextOpen = from => keys.slice(keys.indexOf(from) + 1).concat(keys).find(key => !assign.has(key)) ?? from;

    const strip = () =>
    {
        if (!multi)
            return '';

        const chips = targets.map((entry) =>
        {
            const key = invadeTargetKey(entry.token);
            const set = assign.get(key);
            const classes = ['la-pick-tchip', entry.hit && key === active && 'is-active', set && 'is-set', !entry.hit && 'is-miss'].filter(Boolean).join(' ');
            let line = localize('LA.invade.miss');
            if (entry.hit)
                line = set ? escapeHtml(set.name) : localize('LA.invade.choose');
            const head = entry.hit ? ` data-head="target" data-key="${key}"` : '';
            return `<div class="${classes}"${head}><img src="${entry.token?.document?.texture?.src ?? ''}" alt=""><b>${escapeHtml(entry.token?.name ?? '')}</b><i>${line}</i></div>`;
        }).join('');

        return `<div class="la-pick-targets">${chips}</div><div class="la-pick-strip-tools"><button type="button" class="la-pick-same" data-head="same"${assign.has(active) ? '' : ' disabled'}><i class="fas fa-clone"></i> ${localize('LA.invade.sameForAll')}</button></div>`;
    };

    const update = (card) =>
    {
        card.setConfirm(confirmText, assign.size === keys.length);
        card.refresh();
    };

    return startPickCard({
        title: localize('LA.invade.title'),
        origin: actor.name,
        originToken: preview ? null : (actor.getActiveTokens?.()?.[0] ?? null),
        relatedToken: multi || preview ? null : (hitTargets[0].token ?? null),
        urgent: preview,
        description,
        hint: localize('LA.invade.hint'),
        tiles: true,
        confirmText: multi ? confirmText : '',
        confirmIcon: 'fas fa-microchip',
        getHead: strip,
        getRows: () => groupedRows(options, assign.get(active)?.key),
        onPick: (row, card) =>
        {
            assign.set(active, row.option);

            if (!multi)
            {
                card.finish(assign);
                return;
            }

            active = nextOpen(active);
            update(card);
        },
        onHeadClick: (element, card) =>
        {
            if (element.dataset.head === 'target' && keys.includes(element.dataset.key))
                active = element.dataset.key;
            else if (element.dataset.head === 'same' && assign.has(active))
                keys.forEach(key => assign.set(key, assign.get(active)));
            update(card);
        },
        onConfirm: (card) =>
        {
            if (assign.size === keys.length)
                card.finish(assign);
        },
        onContext: (row, card, element) => showInvadeDetail(row.option, card, element),
        onReady: (card) =>
        {
            if (multi)
                update(card);
            onPreview?.(card);
        },
    });
}
