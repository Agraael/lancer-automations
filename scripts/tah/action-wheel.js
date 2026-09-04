import { openRadialWheel, closeRadialWheel, isRadialWheelOpen, refreshRadialWheel } from '../tools/radial-wheel.js';
import { hud } from './index.js';
import { laHudRenderIcon, laHudStripeStyle } from './item-helpers.js';
import { onHudRowHover, deactivateRangePreview } from './hover.js';

const MODULE_ID = 'lancer-automations';

let _openToken = null;
let _refreshTimer = null;

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

function buildWheelItem(favorite, favoriteIndex, token)
{
    return {
        key: favorite.favKey ?? String(favoriteIndex),
        title: plainTitle(favorite.label),
        current: false,
        buildContent: (buttonEl) =>
        {
            buttonEl.classList.add('lancer-aw-btn');
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

export async function toggleActionWheel()
{
    if (isRadialWheelOpen())
    {
        closeRadialWheel(); return;
    }
    const token = canvas.tokens?.controlled?.[0];
    if (!token)
        return;
    if (!game.settings.get(MODULE_ID, 'tahEnabled'))
    {
        ui.notifications.info('Enable the Token Action HUD to use the action wheel.');
        return;
    }
    if (!hud.getFavorites())
        await hud.bind([token]);
    const favorites = hud.getFavorites() ?? [];
    if (!favorites.length)
    {
        ui.notifications.info('No favorite actions yet. Mark actions with Ctrl+Right-click in the Token Action HUD.');
        return;
    }
    _openToken = token;
    openRadialWheel({
        token,
        rootClass: 'lancer-action-wheel',
        showLabel: true,
        onClose: () =>
        {
            _openToken = null;
            deactivateRangePreview(token);
        },
        items: favorites.map((favorite, favoriteIndex) => buildWheelItem(favorite, favoriteIndex, token))
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
        const favorites = hud.getFavorites() ?? [];
        refreshRadialWheel(favorites.map((favorite, favoriteIndex) => buildWheelItem(favorite, favoriteIndex, _openToken)));
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
        name: 'Action Wheel',
        hint: 'Open a radial wheel of your favorite TAH actions on the selected token.',
        editable: [{ key: 'KeyF' }],
        onDown: () =>
        {
            if (!canvas.tokens?.controlled?.length)
                return false;
            toggleActionWheel();
            return true;
        },
        repeat: false,
        precedence: foundry.helpers.interaction.ClientKeybindings?.PRECEDENCE?.PRIORITY ?? 2
    });
});
