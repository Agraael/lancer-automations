/* global $, game */

import { onHudRowHover } from './hover.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { playUiSound } from './sound.js';
import { tahScale, laHudStripeStyle, applyStripeStyle, slideInCol } from './item-helpers.js';
import { favoriteWheel, favMarkHtml } from './favorites.js';
import { localize } from '../tools/string-utils.js';

/**
 * Collect search results across all categories.
 * Deduplicates by row key; same action across categories gets a merged `_catLabel` like "Actions · Weapons".
 *
 * @param {string}   query      Already lowercased, trimmed query string.
 * @param {any[]}    categories Array of category objects from `_buildCategories()`.
 * @returns {{ _catLabel: string, [key: string]: any }[]}
 */
export function collectSearchResults(query, categories, keyOf = null)
{
    const results = [];
    const seen = new Map(); // row key → index in results

    const walk = (items, catLabel) =>
    {
        for (const item of (items ?? []))
        {
            if (item.isSectionLabel)
                continue;
            if (item.onClick)
            {
                const plainLabel = String(item.text ?? item.label).toLowerCase();
                if (plainLabel.includes(query))
                {
                    const key = keyOf?.(item) ?? plainLabel;
                    if (seen.has(key))
                    {
                        const idx = seen.get(key);
                        if (!results[idx]._catLabel.split(' · ').includes(catLabel))
                            results[idx]._catLabel += ' · ' + catLabel;
                    }
                    else
                    {
                        seen.set(key, results.length);
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

// [category label key, chip key]. Looked up by rendered label, so the map is built per
// call: the category labels are localized and follow the active language.
const CAT_ABBREV_KEYS = [
    ['LA.tokenHud.label.actions', 'LA.tokenHud.abbrev.actions'],
    ['LA.tokenHud.label.attributes', 'LA.tokenHud.abbrev.attributes'],
    ['LA.tokenHud.label.deployables', 'LA.tokenHud.abbrev.deployables'],
    ['LA.tokenHud.label.resources', 'LA.tokenHud.abbrev.resources'],
    ['LA.tokenHud.label.systems', 'LA.tokenHud.abbrev.systems'],
    ['LA.tokenHud.label.talents', 'LA.tokenHud.abbrev.talents'],
    ['LA.tokenHud.label.utility', 'LA.tokenHud.abbrev.utility'],
    ['LA.tokenHud.label.weapons', 'LA.tokenHud.abbrev.weapons'],
    ['LA.tokenHud.label.macros', 'LA.tokenHud.abbrev.macros'],
    ['LA.tokenHud.label.tech', 'LA.tokenHud.abbrev.tech'],
    ['LA.tokenHud.label.frame', 'LA.tokenHud.abbrev.frame'],
    ['LA.tokenHud.label.class', 'LA.tokenHud.abbrev.class'],
    ['LA.tokenHud.label.pilot', 'LA.tokenHud.abbrev.pilot'],
    ['LA.tokenHud.label.gear', 'LA.tokenHud.abbrev.gear'],
];

// An item found in two categories carries "A · B", so abbreviate each part.
function catLabel(label)
{
    const abbrev = new Map(CAT_ABBREV_KEYS.map(([labelKey, chipKey]) => [localize(labelKey), localize(chipKey)]));
    return String(label).split(' · ').map(part => abbrev.get(part) ?? part).join(' · ');
}

/**
 * Populate `col` with search result rows and animate it open.
 *
 * @param {any} col     jQuery column element (c2).
 * @param {any[]} results  From `collectSearchResults`.
 * @param {{ el: any, makeRow: Function, token: any, onCtrlRightClick?: Function|null }} ctx
 */
export function openSearchResults(col, results, { el, makeRow, token, onCtrlRightClick = null })
{
    col.children(':not(.la-hud-col-label)').remove();
    col.find('.la-hud-col-label').attr('data-col', 'results').text(localize('LA.tokenHud.col.results'));

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
            const labelHasIcon = typeof item.labelHtml === 'string' && item.labelHtml.includes('<');
            const rowIcon = item.icon ?? (labelHasIcon ? null : 'fas fa-circle-dot');
            const row = makeRow(item.label, false, rowIcon, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null, 0, item.sizeLevel ?? null, item.labelHtml ?? null);
            if (item.favKey)
            {
                row.attr('data-la-fav-key', item.favKey);
                const wheel = favoriteWheel(item.favKey);
                if (wheel)
                    row.css('position', 'relative').append(favMarkHtml(wheel));
            }
            const stripe = laHudStripeStyle(item);
            if (stripe)
                applyStripeStyle(row, stripe);
            if (item.hoverData)
            {
                const hoverData = item.hoverData;
                row.on('mouseenter', () => onHudRowHover({ ...hoverData, token, isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hoverData, token, isEntering: false, isLeaving: true  }));
            }
            const catColor = stripe && !stripe.light ? 'color:rgba(255,255,255,0.9);' : '';
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
    slideInCol(col, { duration: 250, guard: false });
}
