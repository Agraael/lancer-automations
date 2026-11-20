import { MODULE_ID, COMBAT_VIEW_KEYS } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag, touchesFlagsBesidesMoveTracking } from '../tools/flag-utils.js';
import { escapeHtml, localize, localizeFormat } from '../tools/string-utils.js';
import { isAltHeld } from '../tah/statbar/state.js';
import { FLASH_HOLD_MS, FLASH_SHRINK_MS } from '../tah/statbar/config.js';
import { isTokenVisible } from '../utils/lancer-token.js';
import { buildCarouselView, EVENT_FLAG, cardStatusEntries } from './carousel-view.js';
import { effectTooltipData, showStatusTooltip, moveStatusTooltip, durationText } from '../bonuses/status-tooltip.js';
import { playUiSound } from '../tah/sound.js';
import { slotHtml, headHtml, sideButtonsHtml, foldButtonHtml, incomingSlotHtml } from './carousel-html.js';
import { reconcileLanes, indexSlots, setPeak, resetPeaks, fitStrip, edgeFade, bindEdges, stopEdgeScroll, centerActive, revealSlot, resumeScroll, cancelScroll, panNames, captureRects, playFlip, rollCards, flipFold } from './carousel-layout.js';
import { registerEventSettings, openAddEvent, initEventExpiry } from './carousel-events.js';
import { getReinforcements, isPlanChange, updateReinforcement } from '../combat/reinforcements.js';
import { toggleReinforcementBar } from '../combat/reinforcement-bar.js';
import { flashToken, focusMarker, hoverMarker, markerGroup } from '../combat/reinforcement-markers.js';
import { openReinforcementMenu } from '../combat/reinforcement-menu.js';
import { LEAVING_ICON, isLeaving, toggleLeaving } from '../combat/leave-battlefield.js';

const ROOT_ID = 'la-carousel';
const SETTING_ENABLED = 'combatCarousel';
const SETTING_SHOW = 'carouselShow';
const SETTING_FOLDED = 'carouselFolded';
const SETTING_SIZE = 'carouselPortraitSize';
const SETTING_LENGTH = 'carouselLength';
const SETTING_MAX_OVERLAP = 'carouselMaxOverlap';
const SETTING_SLIDE = 'carouselDeckSlide';

const NUMBER_SETTINGS = {
    [SETTING_SIZE]: { initial: 84, min: 60, max: 140, step: 2 },
    [SETTING_LENGTH]: { initial: 100, min: 30, max: 100, step: 5 },
    [SETTING_MAX_OVERLAP]: { initial: 50, min: 0, max: 85, step: 1 },
    [SETTING_SLIDE]: { initial: 50, min: 0, max: 300, step: 10 },
};

const RENDER_DELAY_MS = 30;
const TURN_HOLD_MS = 600;
const TOKEN_KEYS = ['name', 'texture', 'disposition', 'hidden', 'flags', 'delta', 'actorId', 'actorLink'];
const SETTING_NAMESPACES = [MODULE_ID, 'token-factions', 'lancer'];

const COMBAT_ACTIONS = {
    delete: combat => combat.endCombat(),
    reset: combat => combat.resetAll(),
    previousTurn: combat => combat.previousTurn(),
    previousRound: combat => combat.previousRound(),
    addEvent: combat => openAddEvent(combat),
    reinforce: () => toggleReinforcementBar(),
    begin: combat => combat.startCombat(),
    end: combat => combat.endCombat(),
    settings: () => new foundry.applications.apps.CombatTrackerConfig().render({ force: true }),
    nextRound: combat => combat.nextRound(),
    fold: () => toggleFold(),
};

const ACTIVATE_ENTRY = {
    name: 'LANCERINITIATIVE.COMBAT.activateCombatantTurn',
    icon: '<i class="fa-solid fa-swords"></i>',
    condition: slot => game.user.isGM && !getLAFlag(viewedCombatant(slot), EVENT_FLAG),
    callback: slot => game.combat?.activateCombatant(slot.dataset.combatantId),
};

function leaveEntry(stay)
{
    return {
        name: stay ? 'LA.tokenHud.label.stayOnBattlefield' : 'LA.tokenHud.label.leaveBattlefield',
        icon: `<img class="la-menu-icon" src="${LEAVING_ICON}" alt="">`,
        condition: (slot) =>
        {
            const combatant = viewedCombatant(slot);
            return !!combatant?.token && combatant.isOwner && !getLAFlag(combatant, EVENT_FLAG) && isLeaving(combatant.actor) === stay;
        },
        callback: slot => toggleLeaving([viewedCombatant(slot)?.token]),
    };
}

function trackerEntries()
{
    const entries = [ACTIVATE_ENTRY, ...ui.combat._getEntryContextOptions()];
    const removeAt = entries.findIndex(entry => entry.name === 'COMBAT.CombatantRemove');
    entries.splice(removeAt < 0 ? entries.length : removeAt, 0, leaveEntry(false), leaveEntry(true));
    return entries;
}

const CARD_ACTIONS = {
    toggleHidden: combatant => ui.combat._onToggleHidden(combatant),
    toggleDefeated: combatant => ui.combat._onToggleDefeatedStatus(combatant),
    ping: combatant => ui.combat._onPingCombatant(combatant),
};

let _root = null;
let _renderTimer = null;
let _turnHold = null;
let _combatId = null;
let _currentId;
let _introPending = false;
let _folding = false;
let _hoveredToken = null;
let _hoveredSlotId = null;
let _canvasHoverId = null;
let _statusTip = null;
let _statusChip = null;
let _depChip = null;
const _depCycle = new Map();
let _buttonsHtml = { left: null, right: null };
const _shown = new Map();
const _laneLeft = new Map();
const _peeking = new Set();
const _thumbsPending = new Set();
const _thumbsFailed = new Set();

function numberSetting(key)
{
    const { initial, min, max } = NUMBER_SETTINGS[key];
    const value = Number(getModuleSetting(key));
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : initial;
}

function queueRender(delay)
{
    if (_renderTimer)
        return;
    _renderTimer = setTimeout(() =>
    {
        _renderTimer = null;
        render();
    }, delay);
}

function scheduleRender()
{
    queueRender(RENDER_DELAY_MS);
}

function inViewedCombat(actor)
{
    return !!actor && !!game.combat?.combatants.some(combatant => combatant.actor === actor || combatant.actorId === actor.id);
}

function shownOnCarousel(actor)
{
    return inViewedCombat(actor) || (actor?.type === 'deployable' && !!game.combat);
}

function viewedCombatant(slot)
{
    return slot ? game.combat?.combatants.get(slot.dataset.combatantId) ?? null : null;
}

function isActivationSpend(combatant, changed)
{
    const combat = combatant.parent;
    if (!combat?.started || combat.turn !== null)
        return false;
    if (Object.keys(changed).some(key => key !== '_id' && key !== 'system'))
        return false;
    if (Object.keys(changed.system ?? {}).some(key => key !== 'activations'))
        return false;

    const value = changed.system?.activations?.value;
    const shown = _shown.get(combatant.id)?.actsValue;
    return Number.isFinite(value) && Number.isFinite(shown) && value < shown;
}

function holdForTurn()
{
    clearTimeout(_turnHold);
    _turnHold = setTimeout(releaseTurnHold, TURN_HOLD_MS);
}

function releaseTurnHold()
{
    clearTimeout(_turnHold);
    _turnHold = null;
    scheduleRender();
}

function hoverTokenIn(slot, event)
{
    const token = canvas.ready && slot?.dataset.tokenId ? canvas.tokens.get(slot.dataset.tokenId) : null;
    if (token && token === _hoveredToken)
        return;
    hoverTokenOut(event);

    if (token?._canHover(game.user, event) && ui.combat._isTokenVisible(token))
    {
        token._onHoverIn(event, { hoverOutOthers: true });
        _hoveredToken = token;
    }
}

function hoverTokenOut(event)
{
    if (_hoveredToken && !_hoveredToken.destroyed)
        _hoveredToken._onHoverOut(event);
    _hoveredToken = null;
}

function closeStatusTip()
{
    _statusTip?.remove();
    _statusTip = null;
    _statusChip = null;
}

function statusTipData(chip, actor)
{
    const entries = cardStatusEntries(actor);

    if (chip.dataset.more === undefined)
    {
        const entry = entries[Number(chip.dataset.st)];
        return entry ? effectTooltipData(actor, entry.effect) : null;
    }

    const hidden = entries.slice(Number(chip.dataset.more));
    if (!hidden.length)
        return null;

    const lines = hidden.map(entry =>
    {
        const duration = durationText(entry.effect);
        return `<div>${escapeHtml(entry.effect.name)}${duration ? ` <span class="la-status-tooltip-duration">· ${escapeHtml(duration)}</span>` : ''}</div>`;
    });

    return { name: escapeHtml(localizeFormat('LA.carousel.moreStatuses', { count: hidden.length })), description: lines.join('') };
}

function syncStatusTip(chip, slot)
{
    if (chip === _statusChip)
        return;
    closeStatusTip();
    const actor = chip ? viewedCombatant(slot)?.actor : null;
    const data = actor ? statusTipData(chip, actor) : null;

    if (!data)
        return;
    _statusChip = chip;
    _statusTip = showStatusTooltip(data);
    const rect = chip.getBoundingClientRect();
    moveStatusTooltip(_statusTip, rect.right, rect.top, 8);
    playUiSound('statusHover');
}

function syncDepChip(chip)
{
    if (chip === _depChip)
        return;
    _depChip = chip;
    if (chip)
        playUiSound('statusHover');
}

function selectNextDeployable(chip)
{
    const ids = (chip.dataset.depTokens ?? '').split(',').filter(Boolean);
    if (!ids.length || !canvas.ready)
        return;

    const key = ids.join(',');
    const index = ((_depCycle.get(key) ?? -1) + 1) % ids.length;
    _depCycle.set(key, index);
    const token = canvas.tokens.get(ids[index]);
    if (!token?.actor?.testUserPermission(game.user, 'OBSERVER'))
        return;
    token.control({ releaseOthers: true });
    canvas.animatePan(token.center);
}

function onClick(event)
{
    const combat = game.combat;
    if (!combat)
        return;

    const depChip = event.target.closest('.lac-dep');

    if (depChip)
    {
        selectNextDeployable(depChip);
        return;
    }

    const control = event.target.closest('[data-combat-action]');

    if (control)
    {
        COMBAT_ACTIONS[control.dataset.combatAction]?.(combat);
        return;
    }

    const glyph = event.target.closest('.lac-act.is-click');

    if (glyph)
    {
        if (glyph.dataset.end)
            combat.deactivateCombatant(glyph.dataset.end);
        else if (glyph.dataset.act)
            combat.activateCombatant(glyph.dataset.act);
        return;
    }

    const incoming = event.target.closest('.lac-rf-in');

    if (incoming)
    {
        const step = event.target.closest('[data-rf-step]');
        if (step)
            stepIncoming(combat, incoming.dataset.rfEntry, Number(step.dataset.rfStep));
        else
            focusMarker(incoming.dataset.rfEntry);
        return;
    }

    const slot = event.target.closest('.lac-slot');
    const cardAction = event.target.closest('[data-card-action]');
    const combatant = viewedCombatant(slot);

    if (cardAction)
    {
        if (combatant)
            CARD_ACTIONS[cardAction.dataset.cardAction]?.(combatant);
        return;
    }

    if (!slot || !combatant?.token)
        return;
    const token = combatant.token.object;
    if (combatant.token.isOwner)
        ui.combat._onCombatantMouseDown(event, slot);
    else
        /** @type {any} */ (ui.combat)._onPanToCombatant(combatant);
    if (combatant.token.isOwner ? token?.controlled : token && /** @type {any} */ (ui.combat)._isTokenVisible(token))
        flashToken(token);
}

function onIncomingMenu(event)
{
    const incoming = event.target.closest('.lac-rf-in');
    if (!incoming || !game.user.isGM || !game.combat)
        return;
    event.preventDefault();
    event.stopPropagation();
    openReinforcementMenu(game.combat, incoming.dataset.rfEntry, event, markerGroup(incoming.dataset.rfEntry, game.combat.id));
}

function stepIncoming(combat, id, step)
{
    const entry = getReinforcements(combat).find(other => other.id === id);
    if (!entry || entry.round + step <= (combat.round ?? 0))
        return;
    updateReinforcement(id, { round: entry.round + step }, combat);
}

function onDoubleClick(event)
{
    const slot = event.target.closest('.lac-slot');
    if (!slot || event.target.closest('.lac-act, [data-card-action], .lac-dep'))
        return;

    const combatant = viewedCombatant(slot);
    if (!combatant || getLAFlag(combatant, EVENT_FLAG))
        return;
    if (slot.classList.contains('is-active'))
        game.combat.deactivateCombatant(combatant.id);
    else
        game.combat.activateCombatant(combatant.id);
}

function onKeyDown(event)
{
    if (event.key !== 'Enter' && event.key !== ' ')
        return;

    const glyph = event.target.closest('.lac-act.is-click');
    if (!glyph)
        return;
    event.preventDefault();
    glyph.click();
}

function onPointerOver(event)
{
    const strip = _root?.querySelector('.lac-strip');
    if (!strip)
        return;

    const cards = event.target.closest('.lac-cards');
    const slot = event.target.closest('.lac-slot');
    resetPeaks(strip, cards);
    if (cards && slot)
        setPeak(cards, Number(slot.style.getPropertyValue('--j')) || 0);
    _hoveredSlotId = slot?.dataset.id ?? (cards ? _hoveredSlotId : null);
    const depChip = event.target.closest('.lac-dep');
    if (slot)
        hoverTokenIn(depChip ?? slot, event);
    else
        hoverTokenOut(event);
    hoverMarker(slot?.dataset.rfEntry ?? null);
    syncDepChip(depChip);
    syncStatusTip(event.target.closest('.lac-st'), slot);
}

function onPointerLeave(event)
{
    const strip = _root?.querySelector('.lac-strip');
    if (strip)
        resetPeaks(strip);
    _hoveredSlotId = null;
    hoverTokenOut(event);
    hoverMarker(null);
    syncDepChip(null);
    closeStatusTip();
}

function onWheel(event)
{
    const strip = event.target.closest('.lac-main')?.querySelector('.lac-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth + 1 || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
        return;
    event.preventDefault();
    cancelScroll(strip);
    strip.scrollLeft += event.deltaY;
}

function rootHtml()
{
    return '<div class="lac-buttons left"></div><div class="lac-main"><div class="lac-strip"></div>'
        + '<div class="lac-edge left" data-dir="-1"><i class="fa-solid fa-chevrons-left"></i></div>'
        + '<div class="lac-edge right" data-dir="1"><i class="fa-solid fa-chevrons-right"></i></div>'
        + `<div class="lac-empty"><i class="fa-solid fa-swords"></i><span>${escapeHtml(localize('LA.carousel.empty'))}</span></div></div><div class="lac-buttons right"></div>`;
}

function mount()
{
    if (_root?.isConnected)
        return;

    const host = document.getElementById('ui-top');
    if (!host)
        return;
    _root = document.createElement('div');
    _root.id = ROOT_ID;
    _root.innerHTML = rootHtml();
    _root.addEventListener('click', onClick);
    _root.addEventListener('dblclick', onDoubleClick);
    _root.addEventListener('contextmenu', onIncomingMenu);
    _root.addEventListener('keydown', onKeyDown);
    _root.addEventListener('pointerover', onPointerOver);
    _root.addEventListener('pointerleave', onPointerLeave);
    _root.addEventListener('wheel', onWheel, { passive: false });
    const main = _root.querySelector('.lac-main');
    main.querySelector('.lac-strip').addEventListener('scroll', event => edgeFade(event.currentTarget));
    bindEdges(main);
    ui.combat._createContextMenu(trackerEntries, '.lac-slot:not(.lac-rf-in)', { container: _root, fixed: true });
    host.prepend(_root);
    _buttonsHtml = { left: null, right: null };
    _introPending = true;
}

function unmount()
{
    hoverTokenOut();
    hoverMarker(null);
    closeStatusTip();
    stopEdgeScroll();
    _root?.remove();
    _root = null;
    _combatId = null;
    _currentId = undefined;
    _hoveredSlotId = null;
    _canvasHoverId = null;
    _depChip = null;
    _depCycle.clear();
    _shown.clear();
    _laneLeft.clear();
}

function applyLiveClasses()
{
    if (!_root)
        return;
    _root.classList.toggle('alt-peek', isAltHeld());
    const pointerInside = _root.matches(':hover');

    for (const slot of _root.querySelectorAll('.lac-slot'))
    {
        const tokenId = slot.dataset.tokenId;
        const token = tokenId && canvas.ready ? canvas.tokens.get(tokenId) : null;
        slot.classList.toggle('is-hovered', !!token?.hover && (!pointerInside || token === _hoveredToken));
        slot.classList.toggle('is-controlled', !!token?.controlled);
        slot.classList.toggle('is-targeted', !!token?.targeted?.has(game.user));
        slot.classList.toggle('alt-ok', !!token && isTokenVisible(token));
        slot.classList.toggle('bar-peek', !!tokenId && _peeking.has(tokenId));
    }
}

function seatDeployableChips(strip)
{
    for (const deps of strip.querySelectorAll('.lac-deps'))
    {
        const bar = deps.previousElementSibling?.classList.contains('lac-bar') ? deps.previousElementSibling : null;
        deps.style.setProperty('--lac-bar-h', `${bar?.offsetHeight ?? 0}px`);
    }
}

function applyPeaks(strip)
{
    resetPeaks(strip);

    const selector = _hoveredSlotId
        ? `.lac-slot[data-id="${CSS.escape(_hoveredSlotId)}"]`
        : (_canvasHoverId ? `.lac-slot[data-token-id="${CSS.escape(_canvasHoverId)}"]` : null);

    const hovered = selector ? strip.querySelector(selector) : null;
    if (hovered)
        setPeak(hovered.parentElement, Number(hovered.style.getPropertyValue('--j')) || 0);
}

function requestThumbnails(view, combat)
{
    for (const lane of view.lanes)
    {
        for (const card of lane.cards)
        {
            if (!card.needsThumb || _thumbsPending.has(card.id) || _thumbsFailed.has(card.id))
                continue;

            const combatant = combat.combatants.get(card.id);
            if (!combatant)
                continue;
            _thumbsPending.add(card.id);
            ui.combat._getCombatantThumbnail(combatant)
                .then(scheduleRender, () => _thumbsFailed.add(card.id))
                .finally(() => _thumbsPending.delete(card.id));
        }
    }
}

function laneItems(view, size, memory = { currentId: _currentId, laneLeft: _laneLeft, shown: _shown })
{
    const currentChanged = memory.currentId !== undefined && view.currentId !== memory.currentId && view.currentId !== null;
    return view.lanes.map(lane =>
    {
        const previousLeft = memory.laneLeft.get(lane.key);
        const burnIndex = previousLeft !== undefined && lane.actsLeft < previousLeft ? lane.actsLeft : -1;
        const activeId = lane.cards.find(card => card.active)?.id ?? null;
        const sweep = currentChanged && activeId !== null;

        const slots = lane.cards.map(card =>
        {
            const shown = memory.shown.get(card.id);
            const old = card.bar && shown?.values ? shown.values : {};

            const html = slotHtml(card, lane, {
                size,
                started: view.started,
                old,
                oldReaction: shown?.reaction ?? undefined,
                justActivated: currentChanged && card.active,
            });

            const key = JSON.stringify({ ...card, values: undefined, needsThumb: undefined, color: lane.color, size, started: view.started });
            return { id: card.id, key, html };
        });

        for (const card of lane.incoming)
            slots.push({ id: card.id, key: JSON.stringify({ ...card, incoming: true, color: lane.color, size }), html: incomingSlotHtml(card) });

        const headKey = JSON.stringify({ name: lane.name, max: lane.actsMax, left: lane.actsLeft, events: lane.events, activeId });
        return { key: lane.key, color: lane.color, head: { key: headKey, html: headHtml(lane, burnIndex, sweep) }, slots };
    });
}

function remember(view)
{
    _shown.clear();
    _laneLeft.clear();

    for (const lane of view.lanes)
    {
        _laneLeft.set(lane.key, lane.actsLeft);
        for (const card of lane.cards)
            _shown.set(card.id, { values: card.values, reaction: card.reaction, actsValue: card.actsValue });
    }

    _currentId = view.currentId;
}

async function toggleFold()
{
    if (!_root || _folding)
        return;

    const folded = !getModuleSetting(SETTING_FOLDED);
    _folding = true;

    try
    {
        const rolling = folded ? rollCards(_root, true) : [];
        await Promise.all(rolling.map(animation => animation.finished));
        await game.settings.set(MODULE_ID, SETTING_FOLDED, folded);
        if (!_root)
            return;

        flipFold(_root, () =>
        {
            _root.classList.toggle('is-folded', folded);
            render();
        });
        rolling.forEach(animation => animation.cancel());
        if (folded)
            return;

        rollCards(_root, false);
        const strip = _root.querySelector('.lac-strip');
        if (strip?.classList.contains('is-scroll'))
            centerActive(strip);
    }
    finally
    {
        _folding = false;
    }
}

function buttonsHtml(started, folded, planned)
{
    const buttons = game.user.isGM ? sideButtonsHtml(started, planned) : { left: '', right: '' };
    buttons.left = foldButtonHtml(folded) + buttons.left;
    return buttons;
}

function renderButtons(started, folded)
{
    const buttons = buttonsHtml(started, folded, getReinforcements(game.combat).length);

    for (const side of ['left', 'right'])
    {
        if (buttons[side] === _buttonsHtml[side])
            continue;
        _root.querySelector(`.lac-buttons.${side}`).innerHTML = buttons[side];
        _buttonsHtml[side] = buttons[side];
    }
}

function render()
{
    const combat = game.combat;

    if (!getModuleSetting(SETTING_ENABLED) || !getModuleSetting(SETTING_SHOW) || !combat)
    {
        unmount();
        return;
    }

    if (_turnHold)
        return;

    const view = buildCarouselView(combat);
    mount();
    if (!_root)
        return;
    const folded = !!getModuleSetting(SETTING_FOLDED);
    _root.classList.toggle('is-empty', !view.lanes.length);
    _root.classList.toggle('is-folded', folded);

    if (combat.id !== _combatId)
    {
        _combatId = combat.id;
        _currentId = undefined;
        _shown.clear();
        _laneLeft.clear();
        _introPending = true;
    }

    const size = numberSetting(SETTING_SIZE);
    _root.style.setProperty('--lac-size', `${size}px`);
    _root.style.setProperty('--lac-length', `${numberSetting(SETTING_LENGTH)}%`);
    _root.style.setProperty('--lac-slide', `${numberSetting(SETTING_SLIDE)}ms`);
    _root.style.setProperty('--lac-flash-hold', `${FLASH_HOLD_MS}ms`);
    _root.style.setProperty('--lac-flash-shrink', `${FLASH_SHRINK_MS}ms`);

    requestThumbnails(view, combat);
    renderButtons(view.started, folded);

    const strip = _root.querySelector('.lac-strip');
    const previousRects = captureRects(_root);
    const keepScroll = strip.scrollLeft;
    strip.classList.add('no-win-anim');
    reconcileLanes(strip, laneItems(view, size));
    if (_statusChip && !_statusChip.isConnected)
        closeStatusTip();
    seatDeployableChips(strip);
    indexSlots(strip);
    applyPeaks(strip);
    applyLiveClasses();
    fitStrip(strip, size, numberSetting(SETTING_MAX_OVERLAP));
    panNames(strip);

    if (strip.classList.contains('is-scroll'))
    {
        strip.scrollLeft = keepScroll;
        if (view.currentId && view.currentId !== _currentId)
            centerActive(strip);
        else
            resumeScroll(strip);
    }

    edgeFade(strip);
    playFlip(_root, previousRects, _introPending);
    _introPending = false;
    requestAnimationFrame(() => requestAnimationFrame(() => strip.classList.remove('no-win-anim')));
    remember(view);
}

export function carouselPreview(view, planned = 0)
{
    const root = document.createElement('div');
    const size = numberSetting(SETTING_SIZE);
    root.id = ROOT_ID;
    root.innerHTML = rootHtml();
    root.style.setProperty('--lac-size', `${size}px`);
    root.style.setProperty('--lac-length', `${numberSetting(SETTING_LENGTH)}%`);
    root.style.setProperty('--lac-slide', `${numberSetting(SETTING_SLIDE)}ms`);

    const buttons = buttonsHtml(view.started, false, planned);
    root.querySelector('.lac-buttons.left').innerHTML = buttons.left;
    root.querySelector('.lac-buttons.right').innerHTML = buttons.right;

    const strip = root.querySelector('.lac-strip');
    reconcileLanes(strip, laneItems(view, size, { currentId: undefined, laneLeft: new Map(), shown: new Map() }));
    indexSlots(strip);
    return root;
}

export function fitCarouselPreview(root)
{
    const strip = root.querySelector('.lac-strip');
    seatDeployableChips(strip);
    fitStrip(strip, numberSetting(SETTING_SIZE), numberSetting(SETTING_MAX_OVERLAP));
    panNames(strip);
    edgeFade(strip);
}

export function registerCarouselSettings()
{
    const register = (key, scope, type, initial, range) => game.settings.register(MODULE_ID, key, {
        name: `LA.settings.${key}.name`,
        hint: `LA.settings.${key}.hint`,
        scope,
        config: false,
        type,
        default: initial,
        ...(range ? { range } : {}),
        onChange: scheduleRender,
    });

    register(SETTING_ENABLED, 'world', Boolean, true);
    register(SETTING_SHOW, 'client', Boolean, true);
    game.settings.register(MODULE_ID, SETTING_FOLDED, { scope: 'client', config: false, type: Boolean, default: false });
    for (const [key, { initial, min, max, step }] of Object.entries(NUMBER_SETTINGS))
        register(key, 'client', Number, initial, { min, max, step });
    registerEventSettings();
}

export function initCarousel()
{
    initEventExpiry();
    for (const hook of /** @type {const} */ (['canvasReady', 'createCombat', 'deleteCombat', 'createCombatant', 'deleteCombatant', 'createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']))
        Hooks.on(hook, scheduleRender);
    Hooks.on('combatStart', () =>
    {
        _introPending = true;
        scheduleRender();
    });
    Hooks.on('updateCombat', (combat, changed) =>
    {
        if ('turn' in changed && _turnHold)
            releaseTurnHold();
        else if (COMBAT_VIEW_KEYS.some(key => key in changed) || isPlanChange(changed))
            scheduleRender();
    });
    Hooks.on(`${MODULE_ID}.worldClocksChanged`, () =>
    {
        if (getReinforcements(game.combat).some(entry => entry.clock))
            scheduleRender();
    });
    Hooks.on('updateCombatant', (combatant, changed) =>
    {
        if (!Object.keys(changed).some(key => key !== 'flags' && key !== '_id'))
            return;
        if (isActivationSpend(combatant, changed))
            holdForTurn();
        scheduleRender();
    });
    Hooks.on('renderCombatTracker', app =>
    {
        if (!app.isPopout && (game.combat?.id ?? null) !== _combatId)
            scheduleRender();
    });
    Hooks.on('updateActor', actor =>
    {
        if (shownOnCarousel(actor))
            scheduleRender();
    });

    for (const hook of /** @type {const} */ (['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect']))
    {
        Hooks.on(hook, effect =>
        {
            if (shownOnCarousel(effect.parent))
                scheduleRender();
        });
    }

    for (const hook of /** @type {const} */ (['createToken', 'deleteToken']))
    {
        Hooks.on(hook, tokenDoc =>
        {
            if (shownOnCarousel(tokenDoc.actor))
                scheduleRender();
        });
    }

    Hooks.on('updateItem', item =>
    {
        if (inViewedCombat(item.parent))
            scheduleRender();
    });
    Hooks.on('updateToken', (tokenDoc, changed) =>
    {
        if (TOKEN_KEYS.some(key => key in changed && (key !== 'flags' || touchesFlagsBesidesMoveTracking(changed)))
            && (game.combat?.combatants.some(combatant => combatant.tokenId === tokenDoc.id) || shownOnCarousel(tokenDoc.actor)))
            scheduleRender();
    });

    for (const hook of /** @type {const} */ (['createSetting', 'updateSetting', 'deleteSetting']))
    {
        Hooks.on(hook, setting =>
        {
            const key = setting.key ?? '';
            if (SETTING_NAMESPACES.some(namespace => key.startsWith(`${namespace}.`)))
                scheduleRender();
        });
    }

    Hooks.on('lancer-automations.statBarFlash', (tokenId, flashing) =>
    {
        if (flashing)
            _peeking.add(tokenId);
        else
            _peeking.delete(tokenId);
        scheduleRender();
    });
    Hooks.on('hoverToken', (token, hovered) =>
    {
        if (hovered && !_root?.matches(':hover'))
            _canvasHoverId = token.id;
        else if (!hovered && _canvasHoverId === token.id)
            _canvasHoverId = null;
        applyLiveClasses();
        const strip = _root?.querySelector('.lac-strip');
        if (!strip)
            return;
        applyPeaks(strip);
        if (hovered && !_root.matches(':hover'))
            revealSlot(strip, strip.querySelector(`.lac-slot[data-token-id="${CSS.escape(token.id)}"]`));
    });
    Hooks.on('targetToken', applyLiveClasses);
    Hooks.on('sightRefresh', applyLiveClasses);
    Hooks.on('controlToken', () =>
    {
        applyLiveClasses();
        scheduleRender();
    });

    const onAlt = event =>
    {
        if (event.type === 'blur' || event.key === 'Alt')
            applyLiveClasses();
    };

    window.addEventListener('keydown', onAlt);
    window.addEventListener('keyup', onAlt);
    window.addEventListener('blur', onAlt);
    window.addEventListener('resize', scheduleRender);
    document.fonts?.addEventListener?.('loadingdone', () =>
    {
        if (_root)
            panNames(_root);
    });
    scheduleRender();
}
