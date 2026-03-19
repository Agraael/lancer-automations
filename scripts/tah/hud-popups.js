/* global $ */

import { laDetailPopup, laBindPopupBehavior } from '../interactive/detail-renderers.js';
import { ReactionManager } from '../reaction-manager.js';

function hasAutomation(itemOrName) {
    const lid = itemOrName?.system?.lid;
    const group = lid ? ReactionManager.getReactions(lid) : ReactionManager.getGeneralReaction(itemOrName);
    return !!(group?.reactions?.length);
}

/**
 * Position and animate a popup into view next to `anchorEl`.
 * Passes the popup hover callbacks so that hovering the popup keeps HUD columns alive.
 *
 * @param {any}    popup            jQuery popup element (not yet in DOM).
 * @param {any}    anchorEl         jQuery element to position next to.
 * @param {{ cancelCollapse: () => void, scheduleCollapse: () => void }} ctx
 */
export function showPopupAt(popup, anchorEl, { cancelCollapse, scheduleCollapse }) {
    $('body').append(popup);
    const offset = anchorEl.offset() ?? { left: 300, top: 100 };
    const pw = popup.outerWidth(), ph = popup.outerHeight();
    const wx = window.innerWidth,  wy = window.innerHeight;
    let px = offset.left + anchorEl.outerWidth() + 2;
    const flipped = px + pw > wx - 10;
    if (flipped)
        px = offset.left - pw - 2;
    let py = offset.top;
    if (py + ph > wy - 10)
        py = wy - ph - 10;
    const finalLeft = Math.max(10, px);
    popup.css({ position: 'fixed', left: finalLeft, top: Math.max(10, py), opacity: 0 });
    popup.animate({ opacity: 1 }, { duration: 150, easing: 'swing' });
    laBindPopupBehavior(popup);
    // Hovering the popup keeps columns alive
    popup.on('mouseenter', cancelCollapse).on('mouseleave', scheduleCollapse);
    // Invisible bridge over the gap between the anchor row and the popup — prevents
    // mouseleave from firing on the HUD while the mouse crosses the gap.
    if (!flipped) {
        const anchorRight = offset.left + anchorEl.outerWidth();
        const bridgeW = finalLeft - anchorRight;
        if (bridgeW > 0) {
            const bridge = $('<div class="la-hud-popup-bridge">').css({
                position: 'fixed',
                left: anchorRight,
                top: Math.max(10, py),
                width: bridgeW,
                height: Math.min(ph, anchorEl.outerHeight() + 20),
                zIndex: 9998,
                pointerEvents: 'all',
            });
            bridge.on('mouseenter', cancelCollapse).on('mouseleave', scheduleCollapse);
            $('body').append(bridge);
            const mo = new MutationObserver(() => {
                if (!document.contains(popup[0])) {
                    bridge.remove(); mo.disconnect();
                }
            });
            mo.observe(document.body, { childList: true });
        }
    }
}

/**
 * Toggle a detail popup: if the same popup is already open, close it; otherwise open a new one.
 * Handles the remove-existing / create / data-stamp / show cycle.
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
export function toggleDetailPopup({ cssClass, dataKey, dataValue, title, subtitle, bodyHtml, theme = 'default', item = null, row, showPopupAt: show, postRender = null }) {
    const selector = '.' + cssClass.trim().split(/\s+/).pop(); // last class is the specific one
    const existing = $(selector);
    if (existing.length && existing.data(dataKey) === dataValue) {
        existing.remove();
        return;
    }
    existing.remove();
    if (!bodyHtml)
        return;
    const popup = laDetailPopup(cssClass, title, subtitle, bodyHtml, theme);
    if (item && hasAutomation(item)) {
        const closeBtn = popup.find('.la-detail-close');
        closeBtn.wrap('<div style="display:flex;align-items:center;gap:4px;"></div>');
        closeBtn.before($(`<span style="color:#e8a020;font-size:0.9em;cursor:default;" title="Has automation">⚡</span>`));
    }
    popup.data(dataKey, dataValue);
    if (postRender)
        postRender(popup);
    show(popup, row);
}
