import { tahScale } from './item-helpers.js';

export class HudPanel
{
    constructor({ actor, token, el, cancelCollapse, scheduleCollapse })
    {
        this._actor            = actor;
        this._token            = token;
        this._el               = el;
        this._cancelCollapse   = cancelCollapse;
        this._scheduleCollapse = scheduleCollapse;

        this._panel  = null;
        this._anchor = null;
    }

    get isVisible()
    {
        return this._panel?.is(':visible') ?? false;
    }

    close()
    {
        if (this._panel)
        {
            const panel = this._panel;
            this._panel = null;
            panel.stop(true).animate({ opacity: 0, marginLeft: -10 }, 250, function ()
            {
                $(this).remove();
            });
        }
    }

    refresh()
    {
        if (this._panel && this._anchor)
            this.open(this._anchor);
    }

    _resetPanel(anchorRow)
    {
        if (this._panel)
        {
            this._panel.stop(true).remove();
            this._panel = null;
        }
        this._anchor = anchorRow;
    }

    _mount(panel, anchorRow, { useParentCol = true, clampSize = false, clampTop = false } = {})
    {
        // Position to the right of the column containing the anchor row
        const scale = tahScale();
        let topInHud = (anchorRow.offset().top - this._el.offset().top) / scale;
        let leftInHud;
        if (useParentCol)
        {
            const parentCol = anchorRow.closest('[class*="la-hud-col"]').length ? anchorRow.closest('[class*="la-hud-col"]') : anchorRow.parent();
            leftInHud = parentCol.length
                ? ((parentCol.offset().left - this._el.offset().left) / scale + /** @type {number} */ (parentCol.outerWidth()))
                : /** @type {number} */ (/** @type {any} */ (this._el.children().first()).outerWidth());
        }
        else
            leftInHud = /** @type {any} */ (this._el.children().first()).outerWidth();
        panel.css({ position: 'absolute', top: topInHud, left: leftInHud, zIndex: 10 });

        this._el.append(panel);

        if (clampSize)
        {
            // Clamp width, height, then vertical position to the viewport
            const margin = 8;
            const hudOffset = this._el.offset();
            const panelLeftOnPage = hudOffset.left + leftInHud * scale;
            panel.css({ maxWidth: Math.max(280, (window.innerWidth - panelLeftOnPage - margin) / scale) });
            panel.css({ maxHeight: Math.max(180, (window.innerHeight - hudOffset.top - margin) / scale - topInHud) });
            const panelHeight = /** @type {any} */ (panel[0]).getBoundingClientRect().height;
            const maxTopInHud = (window.innerHeight - margin - panelHeight - hudOffset.top) / scale;
            if (topInHud > maxTopInHud)
            {
                topInHud = Math.max((margin - hudOffset.top) / scale, maxTopInHud);
                panel.css({ top: topInHud, maxHeight: Math.max(180, (window.innerHeight - hudOffset.top - margin) / scale - topInHud) });
            }
        }
        else if (clampTop)
        {
            // Shift up if the panel would overflow the bottom of the viewport
            const margin = 8;
            const panelHeight = /** @type {any} */ (panel[0]).getBoundingClientRect().height;
            const hudTop = this._el.offset().top;
            const maxTopInHud = (window.innerHeight - margin - panelHeight - hudTop) / scale;
            if (topInHud > maxTopInHud)
                topInHud = Math.max((margin - hudTop) / scale, maxTopInHud);
            panel.css({ top: topInHud });
        }

        panel.on('mouseleave', this._scheduleCollapse).on('mouseenter', this._cancelCollapse);
        panel.css({ opacity: 0, marginLeft: -10 }).animate({ opacity: 1, marginLeft: 0 }, 150);
        this._panel = panel;
    }
}
