/* global $, game */

import { onHudRowHover } from './hover.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { playUiSound } from './sound.js';
import { tahScale, laHudStripeStyle } from './item-helpers.js';
import { favoriteWheel, favMarkHtml } from './favorites.js';

/**
 * Collect search results across all categories.
 * Deduplicates by label; same action across categories gets a merged `_catLabel` like "Actions · Weapons".
 *
 * @param {string}   query      Already lowercased, trimmed query string.
 * @param {any[]}    categories Array of category objects from `_buildCategories()`.
 * @returns {{ _catLabel: string, [key: string]: any }[]}
 */
export function collectSearchResults(query, categories)
{
    const results = [];
    const seen = new Map(); // normalised label → index in results

    const walk = (items, catLabel) =>
    {
        for (const item of (items ?? []))
        {
            if (item.isSectionLabel)
                continue;
            if (item.onClick)
            {
                const plainLabel = item.label.replace(/<[^>]+>/g, '').toLowerCase();
                if (plainLabel.includes(query))
                {
                    if (seen.has(plainLabel))
                    {
                        const idx = seen.get(plainLabel);
                        if (!results[idx]._catLabel.split(' · ').includes(catLabel))
                            results[idx]._catLabel += ' · ' + catLabel;
                    }
                    else
                    {
                        seen.set(plainLabel, results.length);
                        results.push({ ...item, _catLabel: catLabel });
                    }
                }
            }
            // Many actions nest under sub-headers; recurse
            if (item.getChildren)
                walk(item.getChildren(), catLabel);
        }
    };

    for (const cat of (categories ?? []))
    {
        if (cat.isStatusPanel)
            continue;
        walk(cat.getItems?.(), cat.label);
    }
    return results;
}

/**
 * Populate `col` with search result rows and animate it open.
 *
 * @param {any} col     jQuery column element (c2).
 * @param {any[]} results  From `collectSearchResults`.
 * @param {{ el: any, makeRow: Function, token: any, brighten: Function }} ctx
 */
const CAT_ABBREV = {
    'Actions': 'ACT',
    'Attributes': 'ATTR',
    'Deployables': 'DEPL',
    'Resources': 'RES',
    'Statuses': 'STATUS',
    'Systems': 'SYS',
    'Talents': 'TAL',
    'Utility': 'UTIL',
    'Weapons': 'WPN',
};

function catLabel(label)
{
    return CAT_ABBREV[label] ?? label;
}

export function openSearchResults(col, results, { el, makeRow, token, brighten, onCtrlRightClick = null })
{
    col.children(':not(.la-hud-col-label)').remove();
    col.find('.la-hud-col-label').text('Results');

    // Align top with first category row
    const firstRow = el.children().first().find('.la-hud-row').first();
    const colTop = firstRow.length ? (firstRow.offset().top - el.offset().top) / tahScale() : 0;
    col.css('top', colTop);

    const maxItems = getModuleSetting('tah.maxColumnItems') ?? 0;
    const maxHeight = maxItems > 0 ? `${48 * maxItems}px` : '420px';
    const scrollWrap = $(`<div class="la-hud-search-scroll lancer-scroll" style="max-height:${maxHeight};overflow-y:auto;overflow-x:hidden;"></div>`);
    if (!results.length)
        scrollWrap.append($(`<div class="la-hud-muted">No results</div>`));
    else
    {
        for (const item of results)
        {
            const labelHasIcon = typeof item.label === 'string' && item.label.includes('<');
            const rowIcon = item.icon ?? (labelHasIcon ? null : 'fas fa-circle-dot');
            const row = makeRow(item.label, false, rowIcon, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null, 0, item.sizeLevel ?? null);
            if (item.favKey)
            {
                row.attr('data-la-fav-key', item.favKey);
                const wheel = favoriteWheel(item.favKey);
                if (wheel)
                    row.css('position', 'relative').append(favMarkHtml(wheel));
            }
            if (item.highlightBg)
            {
                const borderColor = item.highlightBorderColor ?? item.highlightBg;
                row.data('restingBg', item.highlightBg).data('restingBorder', borderColor).data('hoverBg', brighten(item.highlightBg));
                row.css({ background: item.highlightBg, borderLeftColor: borderColor });
            }
            const stripe = laHudStripeStyle(item);
            if (stripe)
            {
                row.data('restingBg', stripe.bg).data('restingBorder', stripe.border).data('hoverBg', stripe.hoverBg)
                    .data('restingColor', stripe.color).data('hoverColor', stripe.hoverColor);
                row.css({ background: stripe.bg, borderLeftColor: stripe.border, color: stripe.color });
                // Keep leading icon visible on dark stripes: flip whatever invert state laHudRenderIcon left.
                const leadingIcon = row.find('img.la-hud-icon').first();
                if (leadingIcon.length)
                {
                    const styleAttr = leadingIcon.attr('style') || '';
                    const wasInverted = styleAttr.includes('invert(1)');
                    leadingIcon.css({ filter: wasInverted ? 'none' : 'invert(1)', opacity: '0.55' });
                }
            }
            if (item.hoverData)
            {
                const hoverData = item.hoverData;
                row.on('mouseenter', () => onHudRowHover({ ...hoverData, token, isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hoverData, token, isEntering: false, isLeaving: true  }));
            }
            const catColor = (stripe || item.highlightBg) ? 'color:rgba(255,255,255,0.9);' : '';
            row.append($(`<span class="la-hud-cat" style="flex-shrink:0;padding-right:8px;font-size:0.62em;text-transform:uppercase;letter-spacing:0.06em;line-height:1;opacity:0.8;${catColor}" title="${item._catLabel}">${catLabel(item._catLabel)}</span>`));
            row.on('mouseenter', () => playUiSound('hover'));
            row.on('click', () =>
            {
                playUiSound('open'); item.onClick(row);
            });
            row.on('contextmenu', ev =>
            {
                if (ev.ctrlKey && onCtrlRightClick && item.favKey)
                {
                    ev.preventDefault();
                    ev.stopImmediatePropagation();
                    onCtrlRightClick(item, row, ev);
                    return;
                }
                if (!item.onRightClick)
                    return;
                ev.preventDefault(); playUiSound('details'); item.onRightClick(row);
            });
            scrollWrap.append(row);
        }
    }
    col.append(scrollWrap);
    col.stop(true).css({ opacity: 0, marginLeft: -10 }).show().animate({ opacity: 1, marginLeft: 0 }, 250);
}
