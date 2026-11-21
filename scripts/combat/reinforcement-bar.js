import { MODULE_ID } from '../tools/constants.js';
import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { WORLD_CLOCK_TONES, WorldClocksAPI, getWorldClocks } from '../tools/world-clocks.js';
import { VISIBILITIES, VISIBILITY_ICONS, scheduleReinforcement, scheduleTokens, teamHiddenIcon, teamLabelKey, teamShownIcon, trackReinforcementClock } from './reinforcements.js';
import { showDropPreview, clearDropPreview } from './reinforcement-markers.js';

const BAR_ID = 'la-reinforcement-bar';
const CAROUSEL_BUTTON = '[data-combat-action="reinforce"]';
const ARRIVE_MODES = ['round', 'clock'];
const CLOCK_SEGMENTS = [4, 6, 8];
const CLOCK_SHOWS = ['all', 'gm', 'hidden'];
const SELECTED_FACES = 6;

/**
 * @typedef {object} ClockForm
 * @property {string} name
 * @property {number} segments
 * @property {string} tone
 * @property {string} show
 * @property {boolean} tick
 */

/** @type {{ combatId: string, round: number, visibility: string, teamHidden: boolean, mode: string, clock: string|null, form: ClockForm|null, element: HTMLElement|null }|null} */
let bar = null;

const lastChoice = { visibility: 'exact', teamHidden: false };

/** @type {{ uuid: string, doc: TokenDocument|null, texture: PIXI.Texture|null }|null} */
let dragged = null;

let selectedFrame = 0;

export const isReinforcementBarOpen = () => !!bar;

const barCombat = () => (bar ? game.combats.get(bar.combatId) ?? null : null);

const openClocks = () => getWorldClocks().filter(clock => clock.value < clock.max);

const barClock = () => (bar?.mode === 'clock' ? openClocks().find(clock => clock.lid === bar.clock) ?? null : null);

function syncButtons()
{
    for (const button of document.querySelectorAll(CAROUSEL_BUTTON))
        button.setAttribute('aria-pressed', String(!!bar));
}

function roundTiming(state, current)
{
    return `<span>${localize('LA.reinforcement.bar.round')}</span>`
        + `<button type="button" data-action="sooner"${state.round <= current + 1 ? ' disabled' : ''}>−</button>`
        + `<b class="la-rf-bar-round">${state.round}</b>`
        + '<button type="button" data-action="later">+</button>'
        + `<em>${localizeFormat('LA.reinforcement.bar.inRounds', { count: state.round - current })}</em>`;
}

function clockTiming(state)
{
    const clocks = openClocks();
    const options = clocks.map(clock => `<option value="${escapeHtml(clock.lid)}"${clock.lid === state.clock ? ' selected' : ''}>${escapeHtml(clock.name || localize('LA.clocks.unnamed'))} ${clock.value}/${clock.max}</option>`).join('');
    const select = clocks.length ? `<select data-field="clock" aria-label="${localize('LA.reinforcement.bar.clock')}">${options}</select>` : '';
    return `${select}<button type="button" data-action="newClock" aria-pressed="${!!state.form}"><i class="fas fa-plus"></i> ${localize('LA.reinforcement.bar.newClock')}</button>`;
}

function clockFormHtml(state)
{
    const form = state.form;
    const option = (value, label, current) => `<option value="${value}"${String(value) === String(current) ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    const field = (label, control) => `<label><span>${localize(label)}</span>${control}</label>`;

    return '<div class="la-rf-clock-form">'
        + `<header><i class="fas fa-clock"></i> ${localize('LA.reinforcement.bar.newClockTitle')}</header>`
        + field('LA.common.name', `<input type="text" data-form="name" value="${escapeHtml(form.name)}">`)
        + field('LA.reinforcement.bar.segments', `<select data-form="segments">${CLOCK_SEGMENTS.map(count => option(count, String(count), form.segments)).join('')}</select>`)
        + field('LA.reinforcement.bar.color', `<select data-form="tone">${WORLD_CLOCK_TONES.map(tone => option(tone, localize(`LA.clocks.tone.${tone}`), form.tone)).join('')}</select>`)
        + field('LA.reinforcement.bar.show', `<select data-form="show">${CLOCK_SHOWS.map(show => option(show, localize(`LA.clocks.visibility.${show}`), form.show)).join('')}</select>`)
        + `<label class="la-rf-clock-tick"><input type="checkbox" data-form="tick"${form.tick ? ' checked' : ''}> ${localize('LA.reinforcement.bar.tick')}</label>`
        + `<footer><button type="button" data-action="createClock"><i class="fas fa-check"></i> ${localize('LA.common.create')}</button>`
        + `<button type="button" data-action="cancelClock">${localize('LA.common.cancel')}</button></footer>`
        + '</div>';
}

function selectedTokens()
{
    return (canvas.tokens?.controlled ?? []).filter(token => token.actor && token.document?.parent);
}

function selectedRowHtml(tokens)
{
    const add = `<button type="button" data-action="addSelected"${tokens.length ? '' : ' disabled'}><i class="fas fa-plus"></i> ${localize('LA.reinforcement.bar.add')}</button>`;
    if (!tokens.length)
        return `<div class="la-rf-bar-selected"><em>${localize('LA.reinforcement.bar.selectHint')}</em>${add}</div>`;

    const faces = tokens.slice(0, SELECTED_FACES).map(token => `<img src="${escapeHtml(token.document.texture.src ?? '')}" alt="" data-tooltip="${escapeHtml(token.name)}">`).join('');
    const more = tokens.length > SELECTED_FACES ? `<em>+${tokens.length - SELECTED_FACES}</em>` : '';
    return `<div class="la-rf-bar-selected"><span class="la-rf-bar-faces">${faces}</span>${more}${add}</div>`;
}

function barHtml(state, combat, selected = [])
{
    const visibility = state.visibility;
    const arrive = '<span class="la-rf-bar-arrive">'
        + ARRIVE_MODES.map(mode => `<button type="button" data-action="mode" data-mode="${mode}" aria-pressed="${state.mode === mode}">${localize(`LA.reinforcement.bar.${mode}`)}</button>`).join('')
        + '</span>';

    return `<div id="${BAR_ID}">`
        + '<i class="fas fa-parachute-box la-rf-bar-icon"></i>'
        + `<b>${localize('LA.reinforcement.bar.title')}</b>`
        + '<span class="la-rf-bar-sep"></span>'
        + arrive
        + (state.mode === 'clock' ? clockTiming(state) : roundTiming(state, combat.round ?? 0))
        + '<span class="la-rf-bar-sep"></span>'
        + `<button type="button" data-action="visibility"><i class="fas ${VISIBILITY_ICONS[visibility]}"></i> ${localize(`LA.reinforcement.visibility.${visibility}`)}</button>`
        + `<button type="button" data-action="team" aria-pressed="${!state.teamHidden}">${state.teamHidden ? teamHiddenIcon() : teamShownIcon()} ${localize(teamLabelKey(state.teamHidden ? 'hidden' : 'shown'))}</button>`
        + `<button type="button" class="la-rf-bar-tour" data-action="tour" data-tooltip="${localize('LA.configUi.startTour')}"><i class="fas fa-circle-question"></i></button>`
        + `<button type="button" class="la-rf-bar-close" data-action="close" aria-label="${localize('LA.common.close')}"><i class="fas fa-xmark"></i></button>`
        + selectedRowHtml(selected)
        + (state.form ? clockFormHtml(state) : '')
        + '</div>';
}

export function reinforcementBarPreview(state, round)
{
    return htmlToElement(barHtml(state, { round }));
}

function mountBar(element)
{
    const carousel = document.getElementById('la-carousel');
    if (carousel?.isConnected)
        carousel.after(element);
    else
        document.getElementById('ui-top')?.prepend(element);
}

function captureForm()
{
    const element = bar?.element;
    if (!bar?.form || !element)
        return;

    for (const input of /** @type {NodeListOf<HTMLInputElement>} */ (element.querySelectorAll('[data-form]')))
    {
        const key = input.dataset.form;
        if (key === 'tick')
            bar.form.tick = input.checked;
        else if (key === 'segments')
            bar.form.segments = Number(input.value);
        else
            bar.form[key] = input.value;
    }
}

function renderBar()
{
    const combat = barCombat();
    if (!combat)
    {
        closeReinforcementBar();
        return;
    }

    captureForm();
    bar.round = Math.max(bar.round, (combat.round ?? 0) + 1);
    if (bar.mode === 'clock' && !barClock())
        bar.clock = openClocks()[0]?.lid ?? null;

    const element = htmlToElement(barHtml(bar, combat, selectedTokens()));
    element.addEventListener('click', onBarClick);
    element.addEventListener('change', onBarChange);

    if (bar.element?.isConnected)
        bar.element.replaceWith(element);
    else
        mountBar(element);
    bar.element = element;
}

function refreshSelectedRow()
{
    cancelAnimationFrame(selectedFrame);
    selectedFrame = requestAnimationFrame(() =>
    {
        const row = bar?.element?.querySelector(':scope > .la-rf-bar-selected');
        if (row)
            row.replaceWith(htmlToElement(selectedRowHtml(selectedTokens())));
    });
}

async function addSelected()
{
    const combat = barCombat();
    const tokens = selectedTokens();
    if (!combat || !tokens.length)
        return;

    const clock = barClock();
    if (bar.mode === 'clock' && !clock)
    {
        ui.notifications.warn(localize('LA.reinforcement.bar.pickClock'));
        return;
    }

    await scheduleTokens(tokens, { round: bar.round, clock: clock?.lid ?? null, visibility: bar.visibility, teamHidden: bar.teamHidden, combat });
}

function stopPreview()
{
    dragged = null;
    clearDropPreview();
}

function closeReinforcementBar()
{
    bar?.element?.remove();
    bar = null;
    stopPreview();
    syncButtons();
}

function openReinforcementBar()
{
    if (!game.user.isGM)
    {
        ui.notifications.warn(localize('LA.reinforcement.gmOnly'));
        return;
    }

    const combat = game.combat;
    if (!combat)
    {
        ui.notifications.warn(localize('LA.notify.youMustBeInCombatToUse'));
        return;
    }

    bar = { combatId: combat.id, round: (combat.round ?? 0) + 1, visibility: lastChoice.visibility, teamHidden: lastChoice.teamHidden, mode: 'round', clock: null, form: null, element: null };
    renderBar();
    syncButtons();
}

export function toggleReinforcementBar()
{
    if (bar)
        closeReinforcementBar();
    else
        openReinforcementBar();
}

async function createClock()
{
    captureForm();
    const combat = barCombat();
    const form = bar?.form;
    if (!combat || !form)
        return;

    const lid = await WorldClocksAPI.createWorldClock(form.name.trim() || localize('LA.reinforcement.title'), { segments: form.segments, tone: form.tone, visibility: form.show });
    await trackReinforcementClock(lid, form.tick, combat);
    if (!bar)
        return;

    bar.mode = 'clock';
    bar.clock = lid;
    bar.form = null;
    renderBar();
}

function onBarClick(event)
{
    const control = event.target.closest('[data-action]');
    const action = control?.dataset.action;
    if (!bar || !action)
        return;

    if (action === 'close')
    {
        closeReinforcementBar();
        return;
    }

    if (action === 'createClock')
    {
        createClock();
        return;
    }

    if (action === 'addSelected')
    {
        addSelected();
        return;
    }

    if (action === 'tour')
    {
        import('../setup/tour.js').then(module => module.startTourAt('carousel-tour', 'reinforcement-intro'));
        return;
    }

    if (action === 'later')
        bar.round += 1;
    else if (action === 'sooner')
        bar.round -= 1;
    else if (action === 'visibility')
    {
        bar.visibility = VISIBILITIES[(VISIBILITIES.indexOf(bar.visibility) + 1) % VISIBILITIES.length];
        lastChoice.visibility = bar.visibility;
    }
    else if (action === 'team')
    {
        bar.teamHidden = !bar.teamHidden;
        lastChoice.teamHidden = bar.teamHidden;
    }
    else if (action === 'mode')
        bar.mode = control.dataset.mode;
    else if (action === 'newClock')
    {
        captureForm();
        bar.form = bar.form ? null : { name: localize('LA.reinforcement.title'), segments: CLOCK_SEGMENTS[0], tone: 'threat', show: 'all', tick: false };
    }
    else if (action === 'cancelClock')
        bar.form = null;
    renderBar();
}

function onBarChange(event)
{
    if (bar && event.target.dataset.field === 'clock')
        bar.clock = event.target.value;
}

async function loadDragged(item)
{
    const actor = await fromUuid(item.uuid);
    const doc = actor && canvas.scene ? await actor.getTokenDocument({}, { parent: canvas.scene }) : null;
    const src = doc?.texture.src;
    const texture = src ? await foundry.canvas.loadTexture(src).catch(() => null) : null;

    if (dragged !== item)
        return;
    item.doc = doc;
    item.texture = texture;
}

function onDragStart(event)
{
    stopPreview();
    if (!bar)
        return;

    const data = /** @type {any} */ (foundry.applications.ux.TextEditor.implementation.getDragEventData(event));
    if (data?.type !== 'Actor' || !data.uuid)
        return;

    dragged = { uuid: data.uuid, doc: null, texture: null };
    loadDragged(dragged);
}

function onDragOver(event)
{
    if (!bar || !dragged?.doc || !canvas.ready)
        return;

    const combat = barCombat();
    if (!combat || event.target !== canvas.app.view)
    {
        clearDropPreview();
        return;
    }

    const point = canvas.canvasCoordinatesFromClient({ x: event.clientX, y: event.clientY });
    const position = /** @type {any} */ (CONFIG.Token.objectClass)._getDropActorPosition(dragged.doc, point, { snap: !event.shiftKey });
    showDropPreview({ doc: dragged.doc, texture: dragged.texture, position, round: bar.round, clock: barClock()?.lid ?? null, visibility: bar.visibility, combat });
}

function onDropCanvasData(_canvas, data, event)
{
    const combat = barCombat();
    if (!combat || data.type !== 'Actor' || !canvas.dimensions.rect.contains(data.x, data.y))
        return true;

    stopPreview();
    const clock = barClock();
    if (bar.mode === 'clock' && !clock)
    {
        ui.notifications.warn(localize('LA.reinforcement.bar.pickClock'));
        return false;
    }

    scheduleReinforcement({
        actor: data.uuid,
        x: data.x,
        y: data.y,
        elevation: data.elevation ?? 0,
        round: bar.round,
        clock: clock?.lid ?? null,
        visibility: bar.visibility,
        teamHidden: bar.teamHidden,
        snap: !event.shiftKey,
        combat,
        scene: canvas.scene,
    });
    return false;
}

export function initReinforcementBar()
{
    Hooks.on('dropCanvasData', onDropCanvasData);

    Hooks.on('updateCombat', (combat, changed) =>
    {
        if (bar?.combatId === combat.id && 'round' in changed)
            renderBar();
    });

    Hooks.on('deleteCombat', (combat) =>
    {
        if (bar?.combatId === combat.id)
            closeReinforcementBar();
    });

    Hooks.on(`${MODULE_ID}.worldClocksChanged`, () =>
    {
        if (bar?.mode === 'clock')
            renderBar();
    });

    Hooks.on('controlToken', () =>
    {
        if (bar)
            refreshSelectedRow();
    });

    document.addEventListener('dragstart', onDragStart);
    document.addEventListener('dragover', onDragOver);
    document.addEventListener('dragend', stopPreview);
    document.addEventListener('drop', stopPreview);
}
