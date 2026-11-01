import { statusIconEntries, statusBadge, durationBadge } from '../bonuses/flagged-effects.js';
import { escapeHtml as esc } from '../tools/string-utils.js';

export const EFFECT_TILE_CSS = `
.la-stat-plate-tiles {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
}
.la-stat-plate-tile {
    position: relative;
    width: 22px;
    height: 22px;
    box-sizing: border-box;
    background: #1e1e1e;
    border: 1px solid #353535;
    display: grid;
    place-items: center;
}
.la-stat-plate-tile img,
.la-stat-plate-name img {
    width: 16px;
    height: 16px;
    border: none;
    background: none;
}
.la-stat-plate-name img {
    width: 13px;
    height: 13px;
}
.la-stat-plate-badge {
    position: absolute;
    height: 11px;
    min-width: 11px;
    padding: 0 2px;
    box-sizing: border-box;
    border-radius: 6px;
    background: #14161a;
    border: 1px solid;
    font: 700 8px/9px monospace;
    text-align: center;
}
.la-stat-plate-badge.la-tl { left: -4px; top: -4px; }
.la-stat-plate-badge.la-br { right: -4px; bottom: -4px; }
.la-stat-plate-badge.la-tr { right: -4px; top: -4px; }
.la-stat-plate-names {
    display: grid;
    grid-template-columns: repeat(2, max-content);
    column-gap: 12px;
    row-gap: 3px;
}
.la-stat-plate-name {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: 8.5px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    color: #d6d6d6;
    white-space: nowrap;
}
.la-stat-plate-name .la-stat-plate-badge {
    position: static;
}
`;

let _injected = false;

export function ensureEffectTileStyle()
{
    if (_injected)
        return;
    _injected = true;
    const styleEl = document.createElement('style');
    styleEl.id = 'la-effect-tile-styles';
    styleEl.textContent = EFFECT_TILE_CSS;
    document.head.appendChild(styleEl);
}

export function effectTileEntries(actor)
{
    return statusIconEntries(actor);
}

function tileBadge(position, color, text)
{
    return `<span class="la-stat-plate-badge${position ? ` ${position}` : ''}" style="color:${esc(color)};border-color:color-mix(in srgb, ${esc(color)} 55%, #000);">${esc(String(text))}</span>`;
}

export function effectTilesHtml(entries, { names = false, titles = true } = {})
{
    const items = entries.map(entry =>
    {
        const effect = entry.effect;
        const duration = durationBadge(effect);
        const count = statusBadge(entry);
        const badges = [
            duration ? tileBadge(names ? '' : 'la-tl', duration.color, duration.text) : '',
            count ? tileBadge(names ? '' : 'la-br', count.color, count.count) : '',
            count && count.uses !== null ? tileBadge(names ? '' : 'la-tr', count.usesColor, count.uses) : '',
        ].join('');
        const icon = `<img src="${esc(effect.img)}" alt="">`;
        if (names)
            return `<span class="la-stat-plate-name">${icon}<span>${esc(effect.name)}</span>${badges}</span>`;
        return `<span class="la-stat-plate-tile"${titles ? ` title="${esc(effect.name)}"` : ''}>${icon}${badges}</span>`;
    });
    return `<div class="${names ? 'la-stat-plate-names' : 'la-stat-plate-tiles'}">${items.join('')}</div>`;
}
