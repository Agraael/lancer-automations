import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';

const SPENT_GLYPH = '#555555';

const percent = (value, max) => (max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0);

function tooltip(key)
{
    return escapeHtml(localize(key));
}

function flashChunk(oldValue, newValue, max)
{
    if (oldValue === undefined || oldValue === newValue || max <= 0)
        return '';
    const from = percent(Math.min(oldValue, newValue), max);
    const to = percent(Math.max(oldValue, newValue), max);
    if (to - from <= 0)
        return '';
    return `<div class="lac-flash" style="left:${from}%;width:${to - from}%;transform-origin:${newValue < oldValue ? 'left' : 'right'}"></div>`;
}

function pipDots(pips, oldValue)
{
    const low = oldValue === undefined ? pips.value : Math.min(oldValue, pips.value);
    const high = oldValue === undefined ? pips.value : Math.max(oldValue, pips.value);
    let html = '';
    for (let slot = 0; slot < pips.max; slot++)
    {
        const lit = slot >= pips.max - pips.value;
        const flashed = slot >= pips.max - high && slot < pips.max - low;
        html += `<i class="${lit ? 'on' : ''}${flashed ? ' fx-flash' : ''}"${lit ? ` style="background:${escapeHtml(pips.color)}"` : ''}></i>`;
    }
    return `<span class="lac-dots">${html}</span>`;
}

function hpOverlays(model, bar, old)
{
    const max = Math.max(bar.max, 1);
    const fill = percent(bar.value, max);
    let html = '';
    if (model.overshield > 0)
        html += `<div class="lac-os" style="width:${percent(model.overshield, max)}%"></div>`;
    if (model.burn > 0)
    {
        const width = Math.min(percent(model.burn, max), fill);
        if (width > 0)
            html += `<div class="lac-burn" style="left:${fill - width}%;width:${width}%"></div>`;
    }
    return html + flashChunk(old.hp, bar.value, max) + flashChunk(old.overshield, model.overshield, max);
}

function heatOverlays(model, bar, old)
{
    const max = Math.max(bar.max, 1);
    const fill = percent(bar.value, max);
    let html = bar.id === 'heat' && model.danger ? '<div class="lac-danger"></div>' : '';
    if (bar.id === 'heat' && model.infection > 0)
    {
        const width = Math.min(percent(model.infection, max), 100 - fill);
        if (width > 0)
            html += `<div class="lac-inf" style="left:${fill}%;width:${width}%"></div>`;
    }
    return html + flashChunk(old[bar.id], bar.value, max);
}

function barLine(bar, overlays, className, style = '')
{
    return `<div class="lac-line ${className}"${style ? ` style="${style}"` : ''}><div class="lac-fill" style="width:${percent(bar.value, Math.max(bar.max, 1))}%;background:${escapeHtml(bar.color)}"></div>${overlays}</div>`;
}

function extraEntry(entry, old)
{
    const previous = old[`extra:${entry.id}`];
    if (!entry.segmented)
        return barLine(entry, flashChunk(previous, entry.value, Math.max(entry.max, 1)), 'lac-extra', `flex-basis:${entry.width}%`);
    const low = previous === undefined ? entry.value : Math.min(previous, entry.value);
    const high = previous === undefined ? entry.value : Math.max(previous, entry.value);
    let cells = '';
    for (let slot = 0; slot < entry.max; slot++)
    {
        const lit = slot < entry.value;
        const flashed = slot >= low && slot < high;
        cells += `<i class="${lit ? 'on' : ''}${flashed ? ' fx-flash' : ''}"${lit ? ` style="background:${escapeHtml(entry.color)}"` : ''}></i>`;
    }
    return `<span class="lac-segs" style="flex-basis:${entry.width}%">${cells}</span>`;
}

export function barHtml(card, old)
{
    const model = card.bar;
    if (!model)
        return '';
    const rows = model.rows.map((row, index) =>
    {
        const pips = row.pips ? pipDots(row.pips, old[row.pips.id]) : (model.pipSlots ? '<span class="lac-dots"></span>' : '');
        if (!row.bar)
            return `<div class="lac-bar-row">${pips}</div>`;
        const isHp = row.bar.id === 'hp';
        const line = barLine(row.bar, isHp ? hpOverlays(model, row.bar, old) : heatOverlays(model, row.bar, old), isHp ? 'lac-hp' : 'lac-heat');
        const armor = isHp && model.armor > 0 ? `<div class="lac-armor">${'<i></i>'.repeat(model.armor)}</div>` : '';
        return `<div class="lac-bar-row" data-row="${index}">${pips}${line}${armor}</div>`;
    }).join('');
    const extras = model.extras.map(line => `<div class="lac-bar-row lac-extras">${line.map(entry => extraEntry(entry, old)).join('')}</div>`).join('');
    return `<div class="lac-bar${card.flashOnly ? ' flash-only' : ''}" style="--pipcols:${model.pipSlots || 0}">${rows}${extras}</div>`;
}

function activationGlyphs(card, laneColor, started)
{
    const color = escapeHtml(laneColor);
    let html = '';
    for (let index = 0; index < card.actsMax; index++)
    {
        if (card.active && index === card.actsValue)
        {
            const click = card.owner;
            html += `<i class="cci cci-deactivate lac-act${click ? ' is-click' : ''}" style="color:${color}"${click ? ` data-end="${card.id}" data-tooltip="${tooltip('LANCERINITIATIVE.COMBAT.deactivateCombatantTurn')}" role="button" tabindex="0"` : ''}></i>`;
            continue;
        }
        const filled = index < card.actsValue;
        const click = filled && started && !card.defeated;
        html += `<i class="cci cci-activate lac-act${filled ? '' : ' is-used'}${click ? ' is-click' : ''}" style="color:${filled ? color : SPENT_GLYPH}"${click ? ` data-act="${card.id}" data-tooltip="${tooltip('LANCERINITIATIVE.COMBAT.activateCombatantTurn')}" role="button" tabindex="0"` : ''}></i>`;
    }
    return html;
}

function reactionBolt(card, previous)
{
    if (card.reaction === null)
        return '';
    const fx = previous === undefined || previous === card.reaction ? '' : (card.reaction ? ' fx-refresh' : ' fx-spend');
    const label = card.reaction ? 'LA.carousel.reaction.available' : 'LA.carousel.reaction.used';
    return `<i class="cci cci-reaction lac-react ${card.reaction ? 'is-up' : 'is-spent'}${fx}${card.flashOnly ? ' flash-only' : ''}" data-tooltip="${tooltip(label)}"></i>`;
}

function statusTile(status)
{
    const badge = status.badge
        ? `<b class="lac-st-n" style="color:${status.badge.color}">${status.badge.count}${status.badge.uses ? `<small style="color:${status.badge.usesColor}">${status.badge.uses}</small>` : ''}</b>`
        : '';
    return `<span class="lac-st"><img src="${escapeHtml(status.img)}" alt=""/>${badge}</span>`;
}

function statusCap(size, active)
{
    const tile = size * 0.16 + 2;
    const gap = 3;
    return Math.max(2, Math.floor((size * (active ? 1.45 : 1.25) - 12 + gap) / (tile + gap)));
}

function statusRow(card, size)
{
    const cap = statusCap(size, card.active);
    if (card.statuses.length <= cap)
        return card.statuses.map(statusTile).join('');
    const shown = card.statuses.slice(0, cap - 1).map(statusTile).join('');
    return `${shown}<span class="lac-st lac-st-more">+${card.statuses.length - cap + 1}</span>`;
}

function nameHtml(card)
{
    const text = escapeHtml(card.name.text);
    return card.name.unknown ? `<s class="horus--subtle lac-unknown">${text}</s>` : text;
}

function cardButtons(card)
{
    let html = '';
    if (game.user.isGM)
    {
        html += `<i class="fa-solid fa-eye-slash" data-card-action="toggleHidden" data-tooltip="${tooltip('COMBAT.ToggleVis')}"></i>`;
        html += `<i class="fa-solid fa-skull" data-card-action="toggleDefeated" data-tooltip="${tooltip('COMBAT.ToggleDead')}"></i>`;
    }
    if (card.canPing)
        html += `<i class="fa-solid fa-bullseye-arrow" data-card-action="ping" data-tooltip="${tooltip('COMBAT.PingCombatant')}"></i>`;
    return html ? `<div class="lac-btns">${html}</div>` : '';
}

export function slotHtml(card, lane, { size, started, old, oldReaction, justActivated })
{
    const cols = card.actsMax >= 3 ? Math.ceil(Math.sqrt(card.actsMax)) : 0;
    const corner = card.event
        ? (card.roundsLeft === null ? '' : `<span class="lac-rounds" data-tooltip="${escapeHtml(localizeFormat('LA.carousel.event.roundsLeft', { rounds: card.roundsLeft }))}"><i class="fa-solid fa-hourglass-half"></i>${card.roundsLeft}</span>`)
        : `<span class="lac-acts${cols ? ' is-grid' : ''}"${cols ? ` style="--cols:${cols}"` : ''}>${activationGlyphs(card, lane.color, started)}</span>${reactionBolt(card, oldReaction)}`;
    const status = card.event ? '' : `<div class="lac-status">${statusRow(card, size)}</div>`;
    const slotClasses = [
        'lac-slot',
        card.active ? 'is-active' : '',
        !card.event && !card.defeated && card.actsValue === 0 && !card.active ? 'is-spent' : '',
        card.hidden ? 'is-hidden' : '',
        justActivated ? 'fx-activate' : '',
    ].filter(Boolean).join(' ');
    const cardClasses = ['lac-card', card.active ? 'is-active' : '', card.defeated ? 'is-defeated' : ''].filter(Boolean).join(' ');
    return `<div class="${slotClasses}" data-id="${card.id}" data-combatant-id="${card.id}"${card.tokenId ? ` data-token-id="${card.tokenId}"` : ''} data-flip>`
        + `<article class="${cardClasses}"><div class="lac-art" style="background-image:url(&quot;${escapeHtml(card.img)}&quot;)">`
        + `${card.active ? '<div class="lac-scan"></div>' : ''}${cardButtons(card)}<div class="lac-pips">${corner}</div>`
        + `<div class="lac-shade"><div class="lac-name"><span class="lac-name-clip"><span class="lac-name-text">${nameHtml(card)}</span></span></div>${status}</div>`
        + `</div></article>${barHtml(card, old)}</div>`;
}

export function headHtml(lane, burnIndex, sweep)
{
    let glyphs = '';
    for (let index = 0; index < lane.actsMax; index++)
        glyphs += `<i class="cci cci-activate${index < lane.actsLeft ? '' : ' is-used'}${index === burnIndex ? ' fx-burn' : ''}"></i>`;
    const acts = lane.events ? '' : `<span class="lac-head-acts">${glyphs}</span>`;
    return `<div class="lac-head${sweep ? ' fx-sweep' : ''}" data-id="lane-${escapeHtml(lane.key)}" data-flip><span class="lac-head-name">${escapeHtml(lane.name)}</span>${acts}</div>`;
}

function controlButton(action, icon, label)
{
    const text = tooltip(label);
    return `<button type="button" class="ui-control icon ${icon}" data-combat-action="${action}" data-tooltip="${text}" aria-label="${text}"></button>`;
}

export function sideButtonsHtml(started)
{
    const left = [
        controlButton('delete', 'fa-solid fa-trash', 'COMBAT.Delete'),
        controlButton('reset', 'fa-solid fa-undo', 'COMBAT.InitiativeReset'),
        controlButton('previousTurn', 'fa-solid fa-chevron-left', 'COMBAT.TurnPrev'),
        controlButton('previousRound', 'fa-solid fa-chevrons-left', 'COMBAT.RoundPrev'),
    ].join('');
    const right = [
        controlButton('addEvent', 'fa-solid fa-globe', 'LA.carousel.addEvent.title'),
        started ? controlButton('end', 'fa-solid fa-ban', 'COMBAT.End') : controlButton('begin', 'fa-solid fa-play', 'COMBAT.Begin'),
        controlButton('settings', 'fa-solid fa-cog', 'COMBAT.Settings'),
        controlButton('nextRound', 'fa-solid fa-chevrons-right', 'COMBAT.RoundNext'),
    ].join('');
    return { left, right };
}
