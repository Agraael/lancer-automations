/* global $, game, fromUuid */

import { playUiSound } from './sound.js';

const S_COL_LABEL = [
    'padding:3px 12px 4px',
    'background:var(--primary-color)',
    'color:#fff',
    'font-size:0.68em',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'font-weight:bold',
].join(';') + ';';

/** Pull every visible scan journal entry. */
function _collectVisibleScans() {
    /** @type {any[]} */
    const out = [];
    for (const entry of game.journal ?? []) {
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

export class GlossaryPanel {
    constructor({ el, cancelCollapse, scheduleCollapse }) {
        this._el = el;
        this._cancelCollapse = cancelCollapse;
        this._scheduleCollapse = scheduleCollapse;
        this._panel = null;
        this._anchor = null;
    }

    get isVisible() {
        return this._panel?.is(':visible') ?? false;
    }

    close() {
        if (this._panel) {
            const panel = this._panel;
            this._panel = null;
            panel.stop(true).animate({ opacity: 0, marginLeft: -10 }, 250, function () {
                $(this).remove();
            });
        }
    }

    refresh() {
        if (this._panel && this._anchor)
            this.open(this._anchor);
    }

    open(anchorRow) {
        if (this._panel) {
            this._panel.stop(true).remove();
            this._panel = null;
        }
        this._anchor = anchorRow;

        const scans = _collectVisibleScans();

        const panel = $(`<div class="la-hud-glossary-panel" style="display:flex;flex-direction:column;background:#f5f5f5;border:2px solid var(--primary-color);border-radius:3px;box-shadow:0 4px 16px rgba(0,0,0,0.45);font-family:inherit;font-size:0.82em;width:480px;"></div>`);
        panel.append(`<div style="${S_COL_LABEL}">Glossary &middot; Scanned Units</div>`);

        const searchWrap = $(`<div style="padding:6px 8px;box-sizing:border-box;"><input type="text" placeholder="Search by name…" style="width:100%;padding:5px 8px;border:1px solid #999;border-radius:3px;background:#fff;color:#222;font-size:0.95em;box-sizing:border-box;"></div>`);
        const search = searchWrap.find('input');
        panel.append(searchWrap);

        const list = $(`<div class="la-hud-glossary-list" style="overflow-y:auto;padding:4px 6px 8px;display:grid;grid-template-columns:1fr 1fr;gap:4px;flex:1;min-height:80px;"></div>`);
        const empty = $(`<div style="grid-column:1 / -1;font-size:0.9em;color:#666;text-align:center;padding:16px 8px;">No scans visible to you yet.</div>`);

        const renderRows = (filter) => {
            list.empty();
            const q = filter?.trim().toLowerCase() ?? '';
            const filtered = q
                ? scans.filter((s) => s.name.toLowerCase().includes(q) || s.displayName.toLowerCase().includes(q))
                : scans;
            if (!filtered.length) {
                list.append(empty.clone());
                return;
            }
            for (const s of filtered) {
                const row = $(`<div class="la-glossary-row" style="display:flex;align-items:center;gap:6px;padding:4px 6px;background:#fff;border:1px solid #ddd;border-left:3px solid var(--primary-color);border-radius:2px;cursor:pointer;color:#222;min-width:0;">
                    <img src="${s.img}" style="width:32px;height:32px;border-radius:3px;border:1px solid #888;object-fit:cover;background:#1a1a1a;flex-shrink:0;" alt="">
                    <div style="display:flex;flex-direction:column;flex:1;min-width:0;">
                        <span class="la-hud-clip" style="overflow:hidden;min-width:0;"><span class="la-hud-pan" style="display:inline-block;white-space:nowrap;padding-right:8px;font-weight:600;font-size:0.92em;">${s.name}</span></span>
                        <span style="font-size:0.72em;color:#777;letter-spacing:0.5px;">${s.scanIndex ? `SCAN ${s.scanIndex}` : s.displayName}</span>
                    </div>
                    <i class="fas fa-book-open" style="color:#999;font-size:0.85em;flex-shrink:0;"></i>
                </div>`);
                row.on('mouseenter', () => {
                    this._cancelCollapse();
                    playUiSound('statusHover');
                    row.css('background', 'color-mix(in srgb, var(--primary-color) 18%, #f5f5f5)');
                    const clip = row.find('.la-hud-clip')[0];
                    const pan  = row.find('.la-hud-pan')[0];
                    if (clip && pan) {
                        const overflow = pan.scrollWidth - clip.clientWidth;
                        if (overflow > 4)
                            $(clip).stop(true).delay(300).animate({ scrollLeft: overflow }, { duration: overflow * 20, easing: 'linear' });
                    }
                });
                row.on('mouseleave', () => {
                    row.css('background', '#fff');
                    row.find('.la-hud-clip').stop(true).animate({ scrollLeft: 0 }, { duration: 120, easing: 'swing' });
                });
                row.on('click', async (ev) => {
                    ev.stopPropagation();
                    try {
                        const doc = /** @type {any} */ (await fromUuid(s.uuid));
                        if (doc?.sheet)
                            doc.sheet.render(true);
                    } catch (e) {
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

        let topInHud = anchorRow.offset().top - this._el.offset().top;
        const parentCol = anchorRow.closest('[class*="la-hud-col"]').length ? anchorRow.closest('[class*="la-hud-col"]') : anchorRow.parent();
        const leftInHud = parentCol.length
            ? (parentCol.offset().left - this._el.offset().left + /** @type {number} */ (parentCol.outerWidth()))
            : /** @type {number} */ (/** @type {any} */ (this._el.children().first()).outerWidth());
        panel.css({ position: 'absolute', top: topInHud, left: leftInHud, zIndex: 10 });

        this._el.append(panel);

        // Adapt to viewport: clamp width / height / vertical position to whatever space is available.
        const margin = 8;
        const hudOffset = this._el.offset();
        const hudTop = hudOffset.top;
        const hudLeft = hudOffset.left;
        const panelLeftOnPage = hudLeft + leftInHud;
        const maxWidth = Math.max(280, window.innerWidth - panelLeftOnPage - margin);
        panel.css({ maxWidth });
        const maxHeight = Math.max(180, window.innerHeight - hudTop - topInHud - margin);
        panel.css({ maxHeight });
        const panelHeight = /** @type {any} */ (panel[0]).getBoundingClientRect().height;
        const maxTopInHud = window.innerHeight - margin - panelHeight - hudTop;
        if (topInHud > maxTopInHud) {
            topInHud = Math.max(margin - hudTop, maxTopInHud);
            const newMaxHeight = Math.max(180, window.innerHeight - hudTop - topInHud - margin);
            panel.css({ top: topInHud, maxHeight: newMaxHeight });
        }

        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.css({ opacity: 0, marginLeft: -10 }).animate({ opacity: 1, marginLeft: 0 }, 150);
        this._panel = panel;
        setTimeout(() => search.trigger('focus'), 50);
    }
}
