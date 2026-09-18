import { openRadialWheel, closeRadialWheel, isRadialWheelOpen, refreshRadialWheel } from '../tools/radial-wheel.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { hud } from './index.js';
import { laHudRenderIcon, laHudStripeStyle } from './item-helpers.js';
import { onHudRowHover, deactivateRangePreview } from './hover.js';
import { playUiSound } from './sound.js';
import { lastCursor } from './cursor-menu.js';

import { MODULE_ID } from '../tools/constants.js';

import { localize } from '../tools/string-utils.js';
let _openToken = null;
let _refreshTimer = null;
let _page = 1;
let _pageCount = 1;
function plainTitle(label)
{
    return String(label ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Opens the TAH favorites column and fires the real row's right-click, popup anchored there.
function openFavoriteDetails(favorite, favoriteIndex)
{
    if (!hud.openFavoritesColumn())
        return;
    const scrollWrap = document.querySelector('.la-hud-search-scroll');
    let rowEl = favorite.favKey
        ? scrollWrap?.querySelector(`[data-la-fav-key="${CSS.escape(favorite.favKey)}"]`)
        : null;
    if (!rowEl)
        rowEl = scrollWrap?.querySelectorAll('.la-hud-row')?.[favoriteIndex] ?? null;
    if (!rowEl)
        return;
    rowEl.scrollIntoView({ block: 'nearest' });
    hud._setActive($(scrollWrap), $(rowEl));
    $(scrollWrap).one('mouseenter', () => hud._setActive($(scrollWrap), $()));
    $('.la-hud-popup').remove();
    if (favorite.onRightClick)
        $(rowEl).trigger('contextmenu');
}

// Macro rows carry no icon field: theirs is markup inside the label.
function labelIconEl(label)
{
    if (typeof label !== 'string' || !label.includes('<'))
        return null;
    const holder = document.createElement('div');
    holder.innerHTML = label;
    return holder.querySelector('img, i');
}

function buildWheelItem(favorite, favoriteIndex, token)
{
    return {
        key: favorite.favKey ?? String(favoriteIndex),
        title: plainTitle(favorite.label),
        current: false,
        buildContent: (buttonEl) =>
        {
            buttonEl.classList.add('lancer-aw-btn');
            const embedded = !favorite.icon ? labelIconEl(favorite.label) : null;
            if (embedded)
            {
                embedded.style.cssText = 'width:24px;height:24px;font-size:24px;margin:0;';
                buttonEl.replaceChildren(embedded);
                return;
            }
            buttonEl.innerHTML = laHudRenderIcon(favorite.icon ?? 'fas fa-circle-dot', 24);
        },
        styleButton: (buttonEl) =>
        {
            const stripe = laHudStripeStyle(favorite);
            if (!stripe)
                return;
            buttonEl.classList.add('striped');
            buttonEl.style.setProperty('--aw-bg', stripe.bg);
            buttonEl.style.setProperty('--aw-hover-bg', stripe.hoverBg);
            buttonEl.style.setProperty('--aw-border', stripe.border);
            buttonEl.style.setProperty('--aw-color', stripe.color);
            buttonEl.style.setProperty('--aw-hover-color', stripe.hoverColor);
        },
        onHoverChange: (isEntering) =>
        {
            if (!favorite.hoverData)
                return;
            onHudRowHover({ ...favorite.hoverData, token, isEntering, isLeaving: !isEntering });
        },
        onSelect: () => favorite.onClick(),
        onRightClick: () => openFavoriteDetails(favorite, favoriteIndex)
    };
}

function wheelItems(page, token)
{
    return (hud.getFavorites(page) ?? []).map((favorite, favoriteIndex) => buildWheelItem(favorite, favoriteIndex, token));
}

function switchPage(page, token)
{
    const items = wheelItems(page, token);
    if (!items.length)
        return;
    _page = page;
    playUiSound('toggle');
    refreshRadialWheel(items, { page });
}

export async function toggleActionWheel()
{
    if (isRadialWheelOpen())
    {
        closeRadialWheel(); return;
    }
    if (!getModuleSetting('tahEnabled'))
    {
        ui.notifications.info(localize('LA.notify.enableTheTokenActionHudToUse'));
        return;
    }
    const token = canvas.tokens?.controlled?.[0] ?? null;
    // No selection: the narrative HUD's favorites, centered on the cursor.
    if (!token && !getModuleSetting('tah.narrativeMode'))
        return;
    if (token)
    {
        if (!hud.getFavorites() || hud._token !== token)
            await hud.bind([token]);
    }
    else if (!hud.getFavorites())
        await hud.bindNarrative();
    const firstPage = hud.getFavorites(1) ?? [];
    const secondPage = hud.getFavorites(2) ?? [];
    if (!firstPage.length && !secondPage.length)
    {
        ui.notifications.info(localize('LA.notify.noFavoriteActionsYetMarkActionsWith'));
        return;
    }
    _pageCount = secondPage.length ? 2 : 1;
    _page = firstPage.length ? 1 : 2;
    _openToken = token;
    openRadialWheel({
        token,
        anchor: token ? null : lastCursor(),
        rootClass: 'lancer-action-wheel',
        showLabel: true,
        pageCount: _pageCount,
        page: _page,
        onPageChange: (nextPage) => switchPage(nextPage, token),
        onClose: () =>
        {
            _openToken = null;
            if (token)
                deactivateRangePreview(token);
        },
        items: wheelItems(_page, token)
    });
}

// Item or actor changed while the wheel is open: rebuild it with fresh statuses.
function scheduleWheelRefresh(changedDoc)
{
    const token = _openToken;
    if (!token)
        return;
    const actor = changedDoc?.documentName === 'Item' ? changedDoc.parent : changedDoc;
    if (!actor || actor !== token.actor)
        return;
    clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() =>
    {
        if (!_openToken)
            return;
        refreshRadialWheel(wheelItems(_page, _openToken));
    }, 100);
}

Hooks.on('updateItem', (item) => scheduleWheelRefresh(item));
Hooks.on('createItem', (item) => scheduleWheelRefresh(item));
Hooks.on('deleteItem', (item) => scheduleWheelRefresh(item));
Hooks.on('updateActor', (actor) => scheduleWheelRefresh(actor));
Hooks.on('deleteToken', (tokenDoc) =>
{
    if (_openToken && tokenDoc.id === _openToken.id)
        closeRadialWheel();
});

Hooks.once('init', () =>
{
    game.keybindings.register(MODULE_ID, 'actionWheel', {
        name: 'LA.keybindings.actionWheel.name',
        hint: 'LA.keybindings.actionWheel.hint',
        editable: [{ key: 'KeyF' }],
        onDown: () =>
        {
            if (!canvas.tokens?.controlled?.length && !getModuleSetting('tah.narrativeMode'))
                return false;
            toggleActionWheel();
            return true;
        },
        repeat: false,
        precedence: CONST.KEYBINDING_PRECEDENCE.PRIORITY
    });
});
