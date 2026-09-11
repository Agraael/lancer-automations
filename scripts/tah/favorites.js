import { openCursorMenu } from './cursor-menu.js';

import { MODULE_ID } from '../tools/constants.js';
const WHEEL_FLAGS = ['tahFavorites', 'tahFavorites2'];

export const WHEEL_COUNT = WHEEL_FLAGS.length;

export function favoriteKeys(wheel)
{
    return /** @type {any} */ (game.user).getFlag(MODULE_ID, WHEEL_FLAGS[wheel - 1]) || [];
}

/**
 * @param {string|null} key
 * @returns {number} wheel number, 0 when the key is on no wheel
 */
export function favoriteWheel(key)
{
    if (!key)
        return 0;
    for (let wheel = 1; wheel <= WHEEL_COUNT; wheel++)
    {
        if (favoriteKeys(wheel).includes(key))
            return wheel;
    }
    return 0;
}

export function hasSecondWheel()
{
    return favoriteKeys(2).length > 0;
}

/**
 * A favorite lives on one wheel, so assigning strips it from the others.
 * @param {string|null} key
 * @param {number} wheel target wheel, 0 to remove
 * @returns {Promise<number>}
 */
export async function setFavoriteWheel(key, wheel)
{
    if (!key)
        return 0;
    for (let target = 1; target <= WHEEL_COUNT; target++)
    {
        const keys = favoriteKeys(target);
        const wanted = target === wheel;
        if (wanted === keys.includes(key))
            continue;
        const next = wanted ? [...keys, key] : keys.filter(entry => entry !== key);
        await /** @type {any} */ (game.user).setFlag(MODULE_ID, WHEEL_FLAGS[target - 1], next);
    }
    return wheel;
}

// The digit only shows once a second wheel is in use: with one wheel it says nothing.
export function favMarkHtml(wheel)
{
    if (!wheel)
        return '';
    const digit = hasSecondWheel() ? `<span class="la-hud-fav-digit">${wheel}</span>` : '';
    return `<span class="la-hud-fav-mark">★${digit}</span>`;
}

/**
 * Wheel picker at the cursor. Never offers the wheel the item already sits on, and
 * only offers Remove when there is something to remove, so it is always two rows.
 * @param {number} x
 * @param {number} y
 * @param {number} currentWheel
 * @param {object} [hooks] onEnter / onLeave hold the HUD column open while the cursor is inside
 * @returns {Promise<number|null>} chosen wheel, 0 for remove, null when dismissed
 */
export function openFavoritePopup(x, y, currentWheel, { onEnter = null, onLeave = null } = {})
{
    const rows = [];
    for (let wheel = 1; wheel <= WHEEL_COUNT; wheel++)
    {
        if (wheel !== currentWheel)
            rows.push({ value: wheel, label: `Wheel ${wheel}`, glyph: `★<span class="la-hud-fav-digit">${wheel}</span>` });
    }
    if (currentWheel)
        rows.push({ value: 0, label: 'Remove', glyph: '✕', cls: 'la-menu-popup-danger' });
    return openCursorMenu({
        head: currentWheel ? `On wheel ${currentWheel}` : 'Not favorited',
        rows,
        x,
        y,
        onEnter,
        onLeave,
    });
}
