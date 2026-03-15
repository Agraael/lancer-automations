/* global $ */

import { onHudRowHover } from './hover.js';

/**
 * Collect search results across all categories.
 * Deduplicates by normalised label — same action appearing under multiple
 * categories gets a merged `_catLabel` like "Actions · Weapons".
 *
 * @param {string}   query      Already lowercased, trimmed query string.
 * @param {any[]}    categories Array of category objects from `_buildCategories()`.
 * @returns {{ _catLabel: string, [key: string]: any }[]}
 */
export function collectSearchResults(query, categories) {
    const results = [];
    const seen = new Map(); // normalised label → index in results

    const walk = (items, catLabel) => {
        for (const item of (items ?? [])) {
            if (item.isSectionLabel)
                continue;
            if (item.onClick) {
                const text = item.label.replace(/<[^>]+>/g, '').toLowerCase();
                if (text.includes(query)) {
                    if (seen.has(text)) {
                        // Merge category name into existing entry
                        const idx = seen.get(text);
                        if (!results[idx]._catLabel.split(' · ').includes(catLabel))
                            results[idx]._catLabel += ' · ' + catLabel;
                    } else {
                        seen.set(text, results.length);
                        results.push({ ...item, _catLabel: catLabel });
                    }
                }
            }
            // Recurse into children — many actions are nested under sub-headers
            if (item.getChildren)
                walk(item.getChildren(), catLabel);
        }
    };

    for (const cat of (categories ?? [])) {
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
 * @param {{ el: any, makeRow: Function, token: any, brighten: Function, S_MUTED: string }} ctx
 */
export function openSearchResults(col, results, { el, makeRow, token, brighten, S_MUTED }) {
    col.children(':not(.la-hud-col-label)').remove();
    col.find('.la-hud-col-label').text('Results');

    // Align top with first category row
    const firstRow = el.children().first().find('.la-hud-row').first();
    const colTop = firstRow.length ? firstRow.offset().top - el.offset().top : 0;
    col.css('top', colTop);

    if (!results.length) {
        col.append($(`<div style="${S_MUTED}">No results</div>`));
    } else {
        for (const item of results) {
            const row = makeRow(item.label, false, item.icon ?? null, item.activation ?? null, item.badge ?? null, item.badgeColor ?? null);
            if (item.highlightBg) {
                const bc = item.highlightBorderColor ?? item.highlightBg;
                row.data('restingBg', item.highlightBg).data('restingBorder', bc).data('hoverBg', brighten(item.highlightBg));
                row.css({ background: item.highlightBg, borderLeftColor: bc });
            }
            if (item.hoverData) {
                const hd = item.hoverData;
                row.on('mouseenter', () => onHudRowHover({ ...hd, token, isEntering: true,  isLeaving: false }));
                row.on('mouseleave', () => onHudRowHover({ ...hd, token, isEntering: false, isLeaving: true  }));
            }
            row.css('flex-wrap', 'wrap').prepend($(`<span style="width:100%;font-size:0.58em;color:#991e2a;text-transform:uppercase;letter-spacing:0.06em;line-height:1.4;padding-bottom:1px;opacity:0.85;">${item._catLabel}</span>`));
            row.on('click', () => item.onClick(row));
            if (item.onRightClick)
                row.on('contextmenu', ev => { ev.preventDefault(); item.onRightClick(row); });
            col.append(row);
        }
    }
    col.stop(true).css({ opacity: 0, marginLeft: -10 }).show().animate({ opacity: 1, marginLeft: 0 }, 140);
}
