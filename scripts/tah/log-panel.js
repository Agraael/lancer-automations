/* global $, game */

import { HudPanel } from './hud-panel.js';
import { escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';

function relTime(/** @type {number} */ timestamp)
{
    const diff = (Date.now() - timestamp) / 1000;
    if (diff < 60)
        return `${Math.floor(diff)}s ago`;
    if (diff < 3600)
        return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400)
        return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

export class LogPanel extends HudPanel
{
    open(anchorRow)
    {
        this._resetPanel(anchorRow);
        const actor = this._actor;
        const token = this._token;
        if (!actor)
            return;

        const tokenId = token?.id ?? null;
        const actorId = actor.id;

        const messages = /** @type {any[]} */ ([...game.messages.values()])
            .filter(msg =>
            {
                const speaker = msg.speaker;
                if (tokenId && speaker.token === tokenId)
                    return true;
                if (speaker.actor === actorId)
                    return true;
                return false;
            })
            .filter(m => m.content?.startsWith('<div c'))
            .slice(-40)
            .reverse();

        const panel = $(htmlToElement(`<div class="la-hud-panel la-hud-log-panel"></div>`));

        panel.append(htmlToElement(`<div class="la-hud-col-label">Log · ${escapeHtml(token?.name ?? actor.name)}</div>`));

        const list = $(htmlToElement(`<div class="la-hud-log-list"></div>`));

        if (!messages.length)
            list.append(`<div class="la-log-empty">No log entries.</div>`);
        else
        {
            for (const msg of messages)
            {
                const div = document.createElement('div');
                div.innerHTML = msg.content;
                const headerEl = div.querySelector('.lancer-header, .lancer-stat-header, .card-header, h3');
                const name = headerEl?.textContent?.trim() ?? 'Action';
                const time = relTime(msg.timestamp);

                const row = $(htmlToElement(`<div class="la-log-row">` +
                    `<div class="la-log-row__head">` +
                    `<span class="la-log-row__name">${escapeHtml(name)}</span>` +
                    `<span class="la-log-row__time">${time}</span>` +
                    `</div>` +
                    `<div class="la-log-content">${msg.content}</div>` +
                    `</div>`));

                row.on('mouseenter', () => this._cancelCollapse());
                row.on('click', (ev) =>
                {
                    ev.stopPropagation();
                    const content = row.find('.la-log-content');
                    if (content.css('max-height') === '0px')
                        content.css({ 'max-height': '500px', 'margin-top': '4px' });
                    else
                        content.css({ 'max-height': '0', 'margin-top': '0' });
                });

                list.append(row);
            }
        }

        panel.append(list);

        this._mount(panel, anchorRow);
    }
}
