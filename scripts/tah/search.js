/* global $, game */

import { onHudRowHover } from './hover.js';
import { playUiSound } from './sound.js';
import { tahScale, laHudStripeStyle } from './item-helpers.js';

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
export function openSearchResults(col, results, { el, makeRow, token, brighten, onCtrlRightClick = null })
{
    col.children(':not(.la-hud-col-label)').remove();
    col.find('.la-hud-col-label').text('Results');

    // Align top with first category row
    const firstRow = el.children().first().find('.la-hud-row').first();
    const colTop = firstRow.length ? (firstRow.offset().top - el.offset().top) / tahScale() : 0;
    col.css('top', colTop);

    const maxItems = game.settings.get('lancer-automations', 'tah.maxColumnItems') ?? 0;
    const maxHeight = maxItems > 0 ? `${48 * maxItems}px` : '420px';
    const scrollWrap = $(`<div class="la-hud-search-scroll lancer-scroll" style="max-height:${maxHeight};overflow-y:auto;overflow-x:hidden;"></div>`);
    if (!results.length)
        scrollWrap.append($(`<div class="la-hud-muted">No results</div>`));
    else
    {
        for (const item of results)
        {
            const row = makeRow(item.label, false, item.icon ?? 'fas fa-circle-dot', item.activation ?? null, item.badge ?? null, item.badgeColor ?? null, 0, item.sizeLevel ?? null);
            if (item.favKey)
                row.attr('data-la-fav-key', item.favKey);
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
            row.css({ flexWrap: 'wrap', height: 'auto', minHeight: '44px' }).prepend($(`<span class="la-hud-cat" style="width:100%;font-size:0.58em;text-transform:uppercase;letter-spacing:0.06em;line-height:1.4;padding-bottom:1px;opacity:0.85;${catColor}">${item._catLabel}</span>`));
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
                    onCtrlRightClick(item, row);
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
