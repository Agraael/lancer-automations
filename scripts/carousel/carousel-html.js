import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { isReinforcementBarOpen } from '../combat/reinforcement-bar.js';
import { VISIBILITY_ICONS, teamHiddenIcon, teamLabelKey } from '../combat/reinforcements.js';
import { LEAVING_ICON } from '../combat/leave-battlefield.js';

const SPENT_GLYPH = '#555555';
const PIP_STEP_MS = 140;
const PIP_PENDING = '#2b2b2b';
const AMBIENT_BREATH_MS = 1600;

const percent = (value, max) => (max > 0 ? Math.max(0, Math.min(1, value / max)) * 100 : 0);
const ambientDelay = () => `animation-delay:-${Math.round(performance.now() % AMBIENT_BREATH_MS)}ms`;

function tooltip(key)
{
    return escapeHtml(localize(key));
}

function flashChunk(oldValue, newValue, max, kind = '')
{
    if (oldValue === undefined || oldValue === newValue || max <= 0)
        return '';

    const from = percent(Math.min(oldValue, newValue), max);
    const to = percent(Math.max(oldValue, newValue), max);

    if (to - from <= 0)
        return '';
    return `<div class="lac-flash${kind ? ` k-${kind}` : ''}" style="left:${from}%;width:${to - from}%;transform-origin:${newValue < oldValue ? 'left' : 'right'}"></div>`;
}

function pipDots(pips, oldValue)
{
    const low = oldValue === undefined ? pips.value : Math.min(oldValue, pips.value);
    const high = oldValue === undefined ? pips.value : Math.max(oldValue, pips.value);
    const loss = oldValue !== undefined && pips.value < oldValue;
    let html = '';

    for (let slot = 0; slot < pips.max; slot++)
    {
        const lit = slot >= pips.max - pips.value;
        const flashed = slot >= pips.max - high && slot < pips.max - low;
        let style = lit ? `background:${escapeHtml(pips.color)};` : '';

        if (flashed)
        {
            const order = loss ? slot - (pips.max - high) : pips.max - low - 1 - slot;
            style += `--d:${order * PIP_STEP_MS}ms;--pc:${loss ? escapeHtml(pips.color) : PIP_PENDING};`;
        }

        const flashClass = loss ? ' fx-flash' : ' fx-flash fx-gain';
        html += `<i class="${lit ? 'on' : ''}${flashed ? flashClass : ''}"${style ? ` style="${style}"` : ''}></i>`;
    }

    const gained = oldValue !== undefined && pips.value > oldValue;
    if (gained)
        return `<span class="lac-dots fx-mend" style="--gc:${escapeHtml(pips.color)}">${html}</span>`;
    return `<span class="lac-dots${loss ? ' fx-hit' : ''}">${html}</span>`;
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
            html += `<div class="lac-burn" style="left:${fill - width}%;width:${width}%;${ambientDelay()}"></div>`;
    }

    const hpKind = old.hp !== undefined && bar.value < old.hp ? 'hpLoss' : 'hpGain';
    const osKind = old.overshield !== undefined && model.overshield < old.overshield ? 'osLoss' : 'osGain';
    return html + flashChunk(old.hp, bar.value, max, hpKind) + flashChunk(old.overshield, model.overshield, max, osKind);
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
            html += `<div class="lac-inf" style="left:${fill}%;width:${width}%;${ambientDelay()}"></div>`;
    }

    let heatKind = '';
    if (bar.id === 'heat')
        heatKind = old.heat !== undefined && bar.value > old.heat ? 'heatUp' : 'heatDown';
    return html + flashChunk(old[bar.id], bar.value, max, heatKind);
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

    const lostArmor = Math.max(0, (old.armor ?? model.armor) - model.armor);
    const gainedArmor = Math.max(0, model.armor - (old.armor ?? model.armor));
    const armorSlots = model.armor + lostArmor;

    const rows = model.rows.map((row, index) =>
    {
        const pips = row.pips ? pipDots(row.pips, old[row.pips.id]) : (model.pipSlots ? '<span class="lac-dots"></span>' : '');
        if (!row.bar)
            return `<div class="lac-bar-row">${pips}</div>`;

        const isHp = row.bar.id === 'hp';
        const line = barLine(row.bar, isHp ? hpOverlays(model, row.bar, old) : heatOverlays(model, row.bar, old), isHp ? 'lac-hp' : 'lac-heat');
        let armor = '';

        if (isHp && armorSlots > 0)
            armor = `<div class="lac-armor">${'<i></i>'.repeat(model.armor - gainedArmor)}${'<i class="fx-gain"></i>'.repeat(gainedArmor)}${'<i class="fx-crack"></i>'.repeat(lostArmor)}</div>`;
        else if (armorSlots > 0)
            armor = `<div class="lac-armor is-spacer">${'<i></i>'.repeat(armorSlots)}</div>`;
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
    const glyph = `<i class="cci cci-reaction lac-react ${card.reaction ? 'is-up' : 'is-spent'}${fx}${card.flashOnly ? ' flash-only' : ''}" data-tooltip="${tooltip(label)}"></i>`;
    return fx === ' fx-spend' ? `<span class="lac-fxwrap">${glyph}<b class="lac-ring"></b></span>` : glyph;
}

function shakeClass(model, old)
{
    if (!model || !old)
        return '';

    const now = {};

    for (const row of model.rows)
    {
        if (row.pips)
            now[row.pips.id] = row.pips.value;
        if (row.bar)
            now[row.bar.id] = row.bar.value;
    }

    const dropped = id => old[id] !== undefined && now[id] !== undefined && now[id] < old[id];
    if (dropped('structure') || dropped('stress'))
        return 'fx-shake-l';

    const heatUp = old.heat !== undefined && now.heat !== undefined && now.heat > old.heat;
    const shieldLost = old.overshield !== undefined && model.overshield < old.overshield;
    return dropped('hp') || heatUp || shieldLost ? 'fx-shake-s' : '';
}

function statusTile(status, index)
{
    const badge = status.badge
        ? `<b class="lac-st-n" style="color:${status.badge.color}">${status.badge.count}${status.badge.uses ? `<small style="color:${status.badge.usesColor}">${status.badge.uses}</small>` : ''}</b>`
        : '';

    return `<span class="lac-st" data-st="${index}"><img src="${escapeHtml(status.img)}" alt=""/>${badge}</span>`;
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
    return `${shown}<span class="lac-st lac-st-more" data-more="${cap - 1}">+${card.statuses.length - cap + 1}</span>`;
}

function depChip(group)
{
    const count = group.tokenIds.length;
    const down = group.state === 'down';
    const classes = ['lac-dep', group.state === 'used' ? 'is-used' : '', down ? 'is-down' : '', group.hidden ? 'is-hidden' : ''].filter(Boolean).join(' ');
    const label = count > 1 ? `${group.name} ×${count}` : group.name;
    const hp = group.hpShown && !down ? `<span class="lac-dep-hp"><i style="width:${percent(group.hp, group.hpMax)}%"></i></span>` : '';

    return `<span class="${classes}" data-dep-tokens="${group.tokenIds.join(',')}" data-token-id="${group.tokenIds[0]}" data-tooltip="${escapeHtml(label)}">`
        + `<i class="lac-dep-art" style="background-image:url(&quot;${escapeHtml(group.art)}&quot;)"></i>`
        + `${down ? '<i class="fa-solid fa-skull"></i>' : ''}${count > 1 ? `<b class="lac-dep-n">${count}</b>` : ''}${hp}</span>`;
}

function depsRow(card, size)
{
    if (!card.deps?.length)
        return '';

    const chip = size * 0.3;
    const cap = Math.max(1, Math.floor((size * (card.active ? 1.45 : 1.25) + 3) / (chip + 3)));
    if (card.deps.length <= cap)
        return `<div class="lac-deps">${card.deps.map(depChip).join('')}</div>`;

    const rest = card.deps.slice(cap - 1).flatMap(group => group.tokenIds);
    const more = `<span class="lac-dep lac-dep-more" data-dep-tokens="${rest.join(',')}" data-token-id="${rest[0]}">+${rest.length}</span>`;
    return `<div class="lac-deps">${card.deps.slice(0, cap - 1).map(depChip).join('')}${more}</div>`;
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
        card.leaving ? 'is-leaving' : '',
        justActivated ? 'fx-activate' : '',
        shakeClass(card.bar, old),
    ].filter(Boolean).join(' ');

    const cardClasses = ['lac-card', card.active ? 'is-active' : '', card.defeated ? 'is-defeated' : ''].filter(Boolean).join(' ');
    return `<div class="${slotClasses}" data-id="${card.id}" data-combatant-id="${card.id}"${card.tokenId ? ` data-token-id="${card.tokenId}"` : ''} data-flip>`
        + `<article class="${cardClasses}"><div class="lac-art" style="background-image:url(&quot;${escapeHtml(card.img)}&quot;)">`
        + `${card.active ? '<div class="lac-scan"></div>' : ''}${cardButtons(card)}<div class="lac-pips">${corner}</div>`
        + `${card.leaving ? `<span class="lac-leave-chip"><img src="${LEAVING_ICON}" alt=""></span>` : ''}`
        + `<div class="lac-shade"><div class="lac-name"><span class="lac-name-clip"><span class="lac-name-text">${nameHtml(card)}</span></span></div>${status}</div>`
        + `</div></article>${barHtml(card, old)}${depsRow(card, size)}</div>`;
}

function clockArcsSvg(clock)
{
    const step = 360 / clock.max;
    const gap = Math.min(10, step * 0.22);
    const point = (degrees) =>
    {
        const radians = (degrees - 90) * Math.PI / 180;
        return `${(6 + 4.4 * Math.cos(radians)).toFixed(2)} ${(6 + 4.4 * Math.sin(radians)).toFixed(2)}`;
    };

    let paths = '';
    for (let segment = 1; segment <= clock.max; segment++)
    {
        const start = (segment - 1) * step + gap / 2;
        const end = start + step - gap;
        const stroke = segment <= clock.value ? escapeHtml(clock.color) : 'rgba(255,255,255,0.22)';
        paths += `<path d="M${point(start)}A4.4 4.4 0 ${end - start > 180 ? 1 : 0} 1 ${point(end)}" stroke="${stroke}"/>`;
    }
    return `<svg viewBox="0 0 12 12">${paths}</svg>`;
}

function incomingCorner(card)
{
    if (card.roundsLeft <= 0)
        return `<span class="lac-rounds lac-rf-due"><i class="fa-solid fa-arrow-down"></i>${escapeHtml(localize('LA.reinforcement.now'))}</span>`;
    if (!card.byClock)
        return `<span class="lac-rounds"><i class="fa-solid fa-hourglass-half"></i>${card.roundsLeft}</span>`;
    if (!card.clock)
        return '<span class="lac-rounds"><i class="fa-solid fa-clock"></i>?</span>';
    return `<span class="lac-rounds lac-rf-clock">${clockArcsSvg(card.clock)}${card.clock.value}/${card.clock.max}</span>`;
}

export function incomingSlotHtml(card)
{
    const art = card.known
        ? `<span class="lac-rf-art" style="background-image:url(&quot;${escapeHtml(card.img)}&quot;)"></span>`
        : '<i class="fa-solid fa-question lac-rf-q"></i>';

    const corner = incomingCorner(card);

    const vis = (game.user.isGM && card.visibility !== 'exact'
        ? `<span class="lac-rf-vis is-${card.visibility}" data-tooltip="${tooltip(`LA.reinforcement.visibility.${card.visibility}`)}"><i class="fa-solid ${VISIBILITY_ICONS[card.visibility]}"></i></span>`
        : '')
        + (card.edited ? `<span class="lac-rf-edit" data-tooltip="${tooltip('LA.reinforcement.edited')}"><i class="fa-solid fa-pen"></i></span>` : '')
        + (card.teamHidden ? `<span class="lac-rf-team" data-tooltip="${tooltip(teamLabelKey('badge'))}">${teamHiddenIcon()}</span>` : '');

    const step = game.user.isGM && !card.byClock
        ? `<span class="lac-rf-step">${card.canSooner ? '<b data-rf-step="-1">−</b>' : ''}<b data-rf-step="1">+</b></span>`
        : '';

    const slotClasses = ['lac-slot', 'lac-rf-in', card.roundsLeft <= 0 ? 'is-due' : ''].filter(Boolean).join(' ');
    return `<div class="${slotClasses}" data-id="${card.id}" data-rf-entry="${card.id}" data-flip>`
        + `<article class="lac-card"><div class="lac-art">${art}<span class="lac-rf-tint"></span><span class="lac-rf-scan"></span>`
        + `<div class="lac-pips">${corner}</div>${vis}${step}`
        + `<div class="lac-shade"><div class="lac-name"><span class="lac-name-clip"><span class="lac-name-text">${nameHtml(card)}</span></span></div></div>`
        + '</div></article></div>';
}

export function headHtml(lane, burnIndex, sweep)
{
    let glyphs = '';
    for (let index = 0; index < lane.actsMax; index++)
        glyphs += `<i class="cci cci-activate${index < lane.actsLeft ? '' : ' is-used'}${index === burnIndex ? ' fx-burn' : ''}"></i>`;

    const acts = lane.events ? '' : `<span class="lac-head-acts">${glyphs}</span>`;
    return `<div class="lac-head${sweep ? ' fx-sweep' : ''}" data-id="lane-${escapeHtml(lane.key)}" data-flip><span class="lac-head-name">${escapeHtml(lane.name)}</span>${acts}</div>`;
}

function controlButton(action, icon, label, pressed = null)
{
    const text = tooltip(label);
    const state = pressed === null ? '' : ` aria-pressed="${pressed}"`;
    return `<button type="button" class="ui-control icon ${icon}" data-combat-action="${action}" data-tooltip="${text}" aria-label="${text}"${state}></button>`;
}

function reinforceButton(planned)
{
    const count = planned ? `<span class="lac-rf-count">${planned}</span>` : '';
    return `<span class="lac-rf-wrap">${controlButton('reinforce', 'fa-solid fa-parachute-box', 'LA.reinforcement.title', isReinforcementBarOpen())}${count}</span>`;
}

export function foldButtonHtml(folded)
{
    return folded
        ? controlButton('fold', 'fa-solid fa-caret-down', 'LA.carousel.unfold')
        : controlButton('fold', 'fa-solid fa-caret-up', 'LA.carousel.fold');
}
export function sideButtonsHtml(started, planned = 0)
{
    const left = [
        controlButton('delete', 'fa-solid fa-trash', 'COMBAT.Delete'),
        controlButton('reset', 'fa-solid fa-undo', 'COMBAT.InitiativeReset'),
        controlButton('previousTurn', 'fa-solid fa-chevron-left', 'COMBAT.TurnPrev'),
        controlButton('previousRound', 'fa-solid fa-chevrons-left', 'COMBAT.RoundPrev'),
    ].join('');

    const right = [
        controlButton('addEvent', 'fa-solid fa-globe', 'LA.carousel.addEvent.title'),
        reinforceButton(planned),
        started ? controlButton('end', 'fa-solid fa-ban', 'COMBAT.End') : controlButton('begin', 'fa-solid fa-play', 'COMBAT.Begin'),
        controlButton('settings', 'fa-solid fa-cog', 'COMBAT.Settings'),
        controlButton('nextRound', 'fa-solid fa-chevrons-right', 'COMBAT.RoundNext'),
    ].join('');

    return { left, right };
}
