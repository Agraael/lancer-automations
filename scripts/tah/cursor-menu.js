import { playUiSound } from './sound.js';

const MENU_CLASS = 'la-menu-popup';

const _cursor = { x: 0, y: 0 };
document.addEventListener('pointermove', (event) =>
{
    _cursor.x = event.clientX;
    _cursor.y = event.clientY;
}, true);

export function lastCursor()
{
    return { ..._cursor };
}

/**
 * Small menu at the cursor, in the HUD's own style rather than a Foundry dialog.
 * @param {object} [options]
 * @param {string} [options.head] label above the rows
 * @param {any[]} [options.rows] { value, label, glyph, cls }
 * @param {number} [options.x] defaults to the last pointer position
 * @param {number} [options.y] defaults to the last pointer position
 * @param {Function} [options.onEnter] fires while the cursor is inside, to hold a column open
 * @param {Function} [options.onLeave] fires on leave and on close
 * @returns {Promise<any>} the chosen row's value, or null when dismissed
 */
export function openCursorMenu({ head = '', rows = [], x = null, y = null, onEnter = null, onLeave = null } = {})
{
    return new Promise((resolve) =>
    {
        $(`.${MENU_CLASS}`).remove();
        const popup = $(`<div class="${MENU_CLASS}"></div>`);
        let settled = false;
        const close = (result) =>
        {
            if (settled)
                return;
            settled = true;
            document.removeEventListener('mousedown', onOutside, true);
            document.removeEventListener('keydown', onKey, true);
            popup.remove();
            onLeave?.();
            resolve(result);
        };
        const onOutside = (event) =>
        {
            if (popup[0]?.contains(/** @type {any} */ (event.target)))
                return;
            close(null);
        };
        const onKey = (event) =>
        {
            if (event.key !== 'Escape')
                return;
            event.preventDefault();
            event.stopPropagation();
            close(null);
        };

        if (head)
            popup.append(`<div class="la-menu-popup-head">${head}</div>`);
        for (const row of rows)
        {
            const glyph = row.glyph ? `<span class="la-menu-popup-glyph">${row.glyph}</span>` : '';
            const rowEl = $(`<div class="la-menu-popup-row ${row.cls ?? ''}">${glyph}${row.label}</div>`);
            rowEl.on('mouseenter', () => playUiSound('statusHover'));
            rowEl.on('mousedown', (ev) => ev.preventDefault());
            rowEl.on('click', (ev) =>
            {
                ev.preventDefault();
                ev.stopPropagation();
                close(row.value);
            });
            popup.append(rowEl);
        }

        popup.on('mouseenter', () => onEnter?.());
        popup.on('mouseleave', () => onLeave?.());
        $('body').append(popup);
        // The cursor still has to cross the gap to reach it, so hold the column from the start.
        onEnter?.();
        const anchorX = x ?? _cursor.x;
        const anchorY = y ?? _cursor.y;
        const width = popup.outerWidth() ?? 0;
        const height = popup.outerHeight() ?? 0;
        popup.css({
            left: Math.max(6, Math.min(anchorX + 12, window.innerWidth - width - 6)),
            top: Math.max(6, Math.min(anchorY + 12, window.innerHeight - height - 6))
        });
        playUiSound('details');
        setTimeout(() =>
        {
            if (settled)
                return;
            document.addEventListener('mousedown', onOutside, true);
            document.addEventListener('keydown', onKey, true);
        }, 0);
    });
}
