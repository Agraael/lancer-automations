/* global $, game */

function relTime(/** @type {number} */ ts) {
    const diff = (Date.now() - ts) / 1000;
    if (diff < 60)
        return `${Math.floor(diff)}s ago`;
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)}h ago`;
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
        const actor = this._actor;
        const token = this._token;
        if (!actor)
            return;

        const tokenId = token?.id ?? null;
        const actorId = actor.id;

        const messages = /** @type {any[]} */ ([...game.messages.values()])
            .filter(m => {
                const sp = m.speaker;
                if (tokenId && sp.token === tokenId)
                    return true;
                if (sp.actor === actorId)
                    return true;
                return false;
            })
            .filter(m => m.content?.startsWith('<div c'))
            .slice(-40)
            .reverse();

        // Panel structure
        const panel = $(`<div class="la-hud-panel la-hud-log-panel"></div>`);

        // Header
        const header = $(`<div class="la-hud-col-label">Log · ${token?.name ?? actor.name}</div>`);
        panel.append(header);

        // Scrollable list
        const list = $(`<div class="la-hud-log-list"></div>`);

        if (!messages.length) {
            list.append(`<div class="la-log-empty">No log entries.</div>`);
        } else {
            for (const msg of messages) {
                const div = document.createElement('div');
                div.innerHTML = msg.content;
                const headerEl = div.querySelector('.lancer-header, .lancer-stat-header, .card-header, h3');
                const name = headerEl?.textContent?.trim() ?? 'Action';
                const time = relTime(msg.timestamp);

                const row = $(`<div class="la-log-row">` +
                    `<div class="la-log-row__head">` +
                    `<span class="la-log-row__name">${name}</span>` +
                    `<span class="la-log-row__time">${time}</span>` +
                    `</div>` +
                    `<div class="la-log-content">${msg.content}</div>` +
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
