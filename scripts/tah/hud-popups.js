/* global $ */

import { laDetailPopup, laBindPopupBehavior, laRenderItemExtras } from '../interactive/detail-renderers.js';
import { ReactionManager } from '../activations/reaction-manager.js';
import { playUiSound } from './sound.js';
import { bindConsumeStatusToggles } from '../interactive/extra-config.js';
import { appendItemPips } from './item-helpers.js';

const LA_DIRECT_AUTOMATED = new Set([
    'skirmish', 'barrage', 'fight', 'stabilize', 'boot up', 'shut down',
    'basic tech', 'invade', 'basic attack', 'prepare', 'reload', 'interact',
    'handle', 'standing up', 'stand up', 'self destruct',
    'improvised attack', 'damage', 'throw weapon', 'pickup weapon',
    'deploy item', 'recall item', 'recall'
]);

function _entryIsAutomated(entry)
{
    if (!entry)
        return false;
    if (Array.isArray(entry.reactions) && entry.reactions.length)
        return true;
    return !!(entry.activationType || entry.activationCode || entry.evaluate
        || (Array.isArray(entry.triggers) && entry.triggers.length));
}

export function hasAutomation(itemOrName)
{
    if (!itemOrName)
        return false;
    const lid = itemOrName?.system?.lid ?? (typeof itemOrName?.lid === 'string' ? itemOrName.lid : null);
    if (lid && _entryIsAutomated(ReactionManager.getReactions(lid)))
        return true;
    const raw = typeof itemOrName === 'string' ? itemOrName : (itemOrName?.name ?? '');
    const name = String(raw).replace(/<[^>]*>/g, '').trim();
    if (!name)
        return false;
    if (_entryIsAutomated(ReactionManager.getGeneralReaction(name)))
        return true;
    const generals = ReactionManager.getGeneralReactions?.() ?? {};
    const lcName = name.toLowerCase();
    for (const key of Object.keys(generals))
    {
        if (key.toLowerCase() === lcName && _entryIsAutomated(generals[key]))
            return true;
    }
    return LA_DIRECT_AUTOMATED.has(lcName);
}

/**
 * Position and animate a popup into view next to `anchorEl`.
 * Passes the popup hover callbacks so that hovering the popup keeps HUD columns alive.
 *
 * @param {any}    popup            jQuery popup element (not yet in DOM).
 * @param {any}    anchorEl         jQuery element to position next to.
 * @param {{ cancelCollapse: () => void, scheduleCollapse: () => void }} ctx
 */
export function showPopupAt(popup, anchorEl, { cancelCollapse, scheduleCollapse })
{
    $('body').append(popup);
    let uiScale = 1;
    try
    {
        uiScale = Number(game.settings.get('lancer-automations', 'tah.uiScale')) || 1;
    }
    catch
    {
        uiScale = 1;
    }
    if (uiScale !== 1)
        popup.css({ transform: `scale(${uiScale})`, 'transform-origin': 'top left' });
    const rect = anchorEl[0]?.getBoundingClientRect() ?? { left: 300, top: 100, right: 380, height: 30 };
    const popupW = popup.outerWidth() * uiScale, popupH = popup.outerHeight() * uiScale;
    const viewportW = window.innerWidth,  viewportH = window.innerHeight;
    let popupLeft = rect.right + 2;
    const flipped = popupLeft + popupW > viewportW - 10;
    if (flipped)
        popupLeft = rect.left - popupW - 2;
    let popupTop = rect.top;
    if (popupTop + popupH > viewportH - 10)
        popupTop = viewportH - popupH - 10;
    const finalLeft = Math.max(10, popupLeft);
    popup.css({ position: 'fixed', left: finalLeft, top: Math.max(10, popupTop), opacity: 0 });
    popup.animate({ opacity: 1 }, { duration: 150, easing: 'swing' });
    laBindPopupBehavior(popup);
    // Hovering the popup keeps columns alive
    popup.on('mouseenter', cancelCollapse).on('mouseleave', scheduleCollapse);
    // Invisible bridge over the anchor-to-popup gap: stops mouseleave firing mid-crossing.
    if (!flipped)
    {
        const anchorRight = rect.right;
        const bridgeWidth = finalLeft - anchorRight;
        if (bridgeWidth > 0)
        {
            const bridge = $('<div class="la-hud-popup-bridge">').css({
                position: 'fixed',
                left: anchorRight,
                top: Math.max(10, popupTop),
                width: bridgeWidth,
                height: Math.min(popupH, rect.height + 20),
                zIndex: 9998,
                pointerEvents: 'all',
            });
            bridge.on('mouseenter', cancelCollapse).on('mouseleave', scheduleCollapse);
            $('body').append(bridge);
            const observer = new MutationObserver(() =>
            {
                if (!document.contains(popup[0]))
                {
                    bridge.remove(); observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true });
        }
    }
}

/**
 * Toggle a detail popup: close it if the same one is already open, else open a new one.
 *
 * @param {{
 *   cssClass:      string,
 *   dataKey:       string,
 *   dataValue:     any,
 *   title:         string,
 *   subtitle:      string,
 *   bodyHtml:      string,
 *   theme?:        string,
 *   item?:         any,
 *   row:           any,
 *   showPopupAt:   (popup: any, row: any) => void,
 *   postRender?:   (popup: any) => void
 * }} opts
 */
export async function toggleDetailPopup({ cssClass, dataKey, dataValue, title, subtitle, bodyHtml, theme = 'default', item = null, row, showPopupAt: showAt, postRender = null, pipsItem, pipsArgs, pips = true, skipExtras = false })
{
    const selector = '.' + cssClass.trim().split(/\s+/).pop(); // last class is the specific one
    const existing = $(selector);
    if (existing.length && existing.data(dataKey) === dataValue)
    {
        existing.remove();
        return;
    }
    existing.remove();
    let composedBody = bodyHtml;
    if (item && !skipExtras)
    {
        try
        {
            const extrasHtml = await laRenderItemExtras(item);
            if (extrasHtml)
                composedBody = (composedBody || '') + extrasHtml;
        }
        catch (err)
        {
            console.warn('lancer-automations | render item extras failed:', err);
        }
    }
    const stateBannerHtml = () =>
    {
        if (item?.system?.destroyed)
            return `<p class="la-popup-state-banner" style="margin:0 0 6px 0;padding:4px 6px;background:rgba(90,34,34,0.35);border-left:3px solid #a04444;font-size:0.85em;color:#e0b0b0;"><strong>Destroyed</strong></p>`;
        if (item?.system?.disabled)
            return `<p class="la-popup-state-banner" style="margin:0 0 6px 0;padding:4px 6px;background:rgba(90,68,34,0.3);border-left:3px solid #a07744;font-size:0.85em;color:#e0c8a0;"><strong>Disabled</strong></p>`;
        return '';
    };
    composedBody = stateBannerHtml() + (composedBody || '');
    if (!composedBody)
        return;
    const popup = laDetailPopup(cssClass, title, subtitle, composedBody, theme);
    const refreshStateBanner = () =>
    {
        popup.find('.la-popup-state-banner').remove();
        const html = stateBannerHtml();
        if (html)
            popup.children().last().prepend(html);
    };
    const closeBtn = popup.find('.la-detail-close');
    const headerBtns = [];
    if (item && hasAutomation(item))
        headerBtns.push($(`<span style="color:#e8a020;font-size:0.9em;cursor:default;" title="Has automation">⚡</span>`));
    // Disable/Destroy toggles for items that support them
    if (item?.system && item.update)
    {
        if ('disabled' in item.system)
        {
            const isDisabled = !!item.system.disabled;
            const disableBtn = $(`<span class="la-popup-disable" style="cursor:pointer;font-size:0.85em;color:${isDisabled ? '#e8a020' : '#666'};padding:1px 4px;border-radius:2px;background:rgba(255,255,255,0.06);" title="${isDisabled ? 'Enable' : 'Disable'}"><i class="fas fa-ban"></i></span>`);
            disableBtn.on('click', async () =>
            {
                playUiSound('toggle');
                const nextDisabled = !item.system.disabled;
                await item.update({ 'system.disabled': nextDisabled });
                disableBtn.css('color', nextDisabled ? '#e8a020' : '#666');
                disableBtn.attr('title', nextDisabled ? 'Enable' : 'Disable');
                refreshStateBanner();
            });
            headerBtns.push(disableBtn);
        }
        if ('destroyed' in item.system)
        {
            const isDestroyed = !!item.system.destroyed;
            const destroyBtn = $(`<span class="la-popup-destroy" style="cursor:pointer;font-size:0.85em;color:${isDestroyed ? '#c33' : '#666'};padding:1px 4px;border-radius:2px;background:rgba(255,255,255,0.06);" title="${isDestroyed ? 'Repair' : 'Destroy'}"><i class="fas fa-skull-crossbones"></i></span>`);
            destroyBtn.on('click', async () =>
            {
                playUiSound('toggle');
                const nextDestroyed = !item.system.destroyed;
                await item.update({ 'system.destroyed': nextDestroyed });
                destroyBtn.css('color', nextDestroyed ? '#c33' : '#666');
                destroyBtn.attr('title', nextDestroyed ? 'Repair' : 'Destroy');
                refreshStateBanner();
            });
            headerBtns.push(destroyBtn);
        }
    }
    if (headerBtns.length)
    {
        closeBtn.wrap('<div style="display:flex;align-items:center;gap:4px;"></div>');
        for (const btn of headerBtns)
            closeBtn.before(btn);
    }
    popup.data(dataKey, dataValue);
    if (item)
    {
        try
        {
            bindConsumeStatusToggles(popup, item);
        }
        catch (err)
        {
            console.warn('lancer-automations | bind consume toggles failed:', err);
        }
    }
    if (pips !== false)
    {
        try
        {
            appendItemPips(pipsItem !== undefined ? pipsItem : item, popup, pipsArgs);
        }
        catch (err)
        {
            console.warn('lancer-automations | append item pips failed:', err);
        }
    }
    if (postRender)
        postRender(popup);
    showAt(popup, row);
}
