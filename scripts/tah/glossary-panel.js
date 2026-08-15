/* global $, game, fromUuid */

import { playUiSound } from './sound.js';
import { HudPanel } from './hud-panel.js';

/** Pull every visible scan journal entry. */
function _collectVisibleScans()
{
    /** @type {any[]} */
    const out = [];
    for (const entry of game.journal ?? [])
    {
        const flag = entry.flags?.['lancer-automations']?.scan;
        if (!flag)
            continue;
        if (!entry.testUserPermission(game.user, 'OBSERVER'))
            continue;
        const titleMatch = entry.name.match(/^SCAN:\s*\d+\s*-\s*(.+)$/);
        const titleName = titleMatch ? titleMatch[1].trim() : null;
        const name = titleName ?? flag.actorName ?? entry.name;
        out.push({
            uuid: entry.uuid,
            name,
            displayName: entry.name,
            img: flag.actorImg ?? 'icons/svg/mystery-man.svg',
            scanIndex: flag.scanIndex ?? '',
            scannedAt: flag.scannedAt ?? 0,
        });
    }
    out.sort((a, b) => (b.scannedAt || 0) - (a.scannedAt || 0));
    return out;
}

export class GlossaryPanel extends HudPanel
{
    open(anchorRow)
    {
        this._resetPanel(anchorRow);

        const scans = _collectVisibleScans();

        const panel = $(`<div class="la-hud-panel la-hud-glossary-panel"></div>`);
        panel.append(`<div class="la-hud-col-label">Glossary &middot; Scanned Units</div>`);

        const searchWrap = $(`<div class="la-hud-panel-search"><input type="text" placeholder="Search by name…"></div>`);
        const search = searchWrap.find('input');
        panel.append(searchWrap);

        const list = $(`<div class="la-hud-glossary-list"></div>`);
        const empty = $(`<div class="la-hud-glossary-empty">No scans visible to you yet.</div>`);

        const renderRows = (filter) =>
        {
            list.empty();
            const q = filter?.trim().toLowerCase() ?? '';
            const filtered = q
                ? scans.filter((s) => s.name.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q))
                : scans;
            if (!filtered.length)
            {
                list.append(empty.clone());
                return;
            }
            for (const s of filtered)
            {
                const row = $(`<div class="la-glossary-row">
                    <img class="la-glossary-row__img" src="${s.img}" alt="">
                    <div class="la-glossary-row__body">
                        <span class="la-hud-clip"><span class="la-hud-pan la-glossary-row__name">${s.name}</span></span>
                        <span class="la-glossary-row__sub">${s.scanIndex ? `SCAN ${s.scanIndex}` : s.displayName}</span>
                    </div>
                    <i class="fas fa-book-open la-glossary-row__icon"></i>
                </div>`);
                row.on('mouseenter', () =>
                {
                    this._cancelCollapse();
                    playUiSound('statusHover');
                    row.css('background', 'color-mix(in srgb, var(--la-plate), #000 12%)');
                    const clip = row.find('.la-hud-clip')[0];
                    const pan  = row.find('.la-hud-pan')[0];
                    if (clip && pan)
                    {
                        const overflow = pan.scrollWidth - clip.clientWidth;
                        if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }
                });
                row.on('mouseleave', () =>
                {
                    row.css('background', 'var(--la-plate)');
                    row.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });
                row.on('click', async (ev) =>
                {
                    ev.stopPropagation();
                    try
                    {
                        const doc = /** @type {any} */ (await fromUuid(s.uuid));
                        if (doc?.sheet)
                            doc.sheet.render(true);
                    }
                    catch (e)
                    {
                        console.error('lancer-automations | Glossary click failed', e);
                    }
                });
                list.append(row);
            }
        };

        renderRows('');
        search.on('input', (ev) => renderRows(/** @type {any} */ (ev.target).value));
        // Stop the search input from collapsing the HUD
        search.on('mousedown click focus', (ev) => ev.stopPropagation());

        panel.append(list);

        this._mount(panel, anchorRow, { clampSize: true });
        setTimeout(() => search.trigger('focus'), 50);
    }
}
