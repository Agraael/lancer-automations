/* global $, game */

const S_COL_LABEL = [
    'padding:3px 12px 4px',
    'background:var(--primary-color)',
    'color:#fff',
    'font-size:0.68em',
    'letter-spacing:1px',
    'text-transform:uppercase',
    'font-weight:bold',
].join(';') + ';';

function relTime(/** @type {number} */ ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60)    return `${Math.floor(diff)}s ago`;
    if (diff < 3600)  return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export class LogPanel {
    constructor({ actor, token, el, cancelCollapse, scheduleCollapse }) {
        this._actor            = actor;
        this._token            = token;
        this._el               = el;
        this._cancelCollapse   = cancelCollapse;
        this._scheduleCollapse = scheduleCollapse;

        this._panel  = null;
        this._anchor = null;
    }

    get isVisible() {
        return this._panel?.is(':visible') ?? false;
    }

    close() {
        if (this._panel) {
            const panel = this._panel;
            this._panel = null;
            panel.stop(true).animate({ opacity: 0, marginLeft: -10 }, 250, function () { $(this).remove(); });
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
        const actor = this._actor;
        const token = this._token;
        if (!actor)
            return;

        const tokenId = token?.id ?? null;
        const actorId = actor.id;

        const messages = /** @type {any[]} */ ([...game.messages.values()])
            .filter(m => {
                const sp = m.speaker;
                if (tokenId && sp.token === tokenId) return true;
                if (sp.actor === actorId) return true;
                return false;
            })
            .filter(m => m.content?.startsWith('<div c'))
            .slice(-40)
            .reverse();

        // Panel structure
        const panel = $(`<div class="la-hud-log-panel" style="display:flex;flex-direction:column;background:#f5f5f5;border:2px solid var(--primary-color);border-radius:3px;box-shadow:0 4px 16px rgba(0,0,0,0.45);font-family:inherit;font-size:0.82em;min-width:320px;max-width:400px;"></div>`);

        // Header
        const header = $(`<div style="${S_COL_LABEL}">Log · ${token?.name ?? actor.name}</div>`);
        panel.append(header);

        // Scrollable list
        const list = $(`<div style="overflow-y:auto;max-height:420px;padding:4px 0;"></div>`);

        if (!messages.length) {
            list.append(`<div style="font-size:0.9em;color:#666;text-align:center;padding:16px 0;">No log entries.</div>`);
        } else {
            for (const msg of messages) {
                const div = document.createElement('div');
                div.innerHTML = msg.content;
                const headerEl = div.querySelector('.lancer-header, .lancer-stat-header, .card-header, h3');
                const name = headerEl?.textContent?.trim() ?? 'Action';
                const time = relTime(msg.timestamp);

                const row = $(`<div style="padding:4px 8px;border-bottom:1px solid #ddd;cursor:pointer;">` +
                    `<div style="display:flex;justify-content:space-between;align-items:center;">` +
                    `<span style="font-size:0.9em;font-weight:bold;color:#333;text-transform:uppercase;letter-spacing:0.03em;">${name}</span>` +
                    `<span style="font-size:0.78em;color:#999;">${time}</span>` +
                    `</div>` +
                    `<div class="la-log-content" style="max-height:0;overflow:hidden;transition:max-height 0.25s ease;color:#555;font-size:0.85em;margin-top:0;">${msg.content}</div>` +
                    `</div>`);

                row.on('mouseenter', () => {
                    this._cancelCollapse();
                    row.css('background', '#ffe0e0');
                });
                row.on('mouseleave', () => {
                    row.css('background', '');
                });
                row.on('click', (ev) => {
                    ev.stopPropagation();
                    const content = row.find('.la-log-content');
                    if (content.css('max-height') === '0px') {
                        content.css({ 'max-height': '500px', 'margin-top': '4px' });
                    } else {
                        content.css({ 'max-height': '0', 'margin-top': '0' });
                    }
                });

                list.append(row);
            }
        }

        panel.append(list);

        // Position to the right of the column containing the anchor row
        const topInHud  = anchorRow.offset().top - this._el.offset().top;
        const parentCol = anchorRow.closest('[class*="la-hud-col"]').length ? anchorRow.closest('[class*="la-hud-col"]') : anchorRow.parent();
        const leftInHud = parentCol.length
            ? (parentCol.offset().left - this._el.offset().left + /** @type {number} */ (parentCol.outerWidth()))
            : /** @type {number} */ (/** @type {any} */ (this._el.children().first()).outerWidth());
        panel.css({ position: 'absolute', top: topInHud, left: leftInHud, zIndex: 10 });

        this._el.append(panel);
        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.css({ opacity: 0, marginLeft: -10 }).animate({ opacity: 1, marginLeft: 0 }, 150);
        this._panel = panel;
    }
}
