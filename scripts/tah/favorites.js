import { openCursorMenu } from './cursor-menu.js';

import { getLAFlag, setLAFlag } from '../tools/flag-utils.js';
import { localize, localizeFormat } from '../tools/string-utils.js';
const WHEEL_FLAGS = ['tahFavorites', 'tahFavorites2', 'tahFavorites3'];

export const WHEEL_COUNT = WHEEL_FLAGS.length;

let _pendingWrites = Promise.resolve();

function queueWrite(task)
{
    const run = _pendingWrites.then(task);
    _pendingWrites = run.catch(() => null);
    return run;
}

export function favoriteKeys(wheel)
{
    return getLAFlag(game.user,WHEEL_FLAGS[wheel - 1]) || [];
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
    for (let wheel = 2; wheel <= WHEEL_COUNT; wheel++)
    {
        if (favoriteKeys(wheel).length > 0)
            return true;
    }
    return false;
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
    return queueWrite(async () =>
    {
        for (let target = 1; target <= WHEEL_COUNT; target++)
        {
            const keys = favoriteKeys(target);
            const wanted = target === wheel;
            if (wanted === keys.includes(key))
                continue;
            const next = wanted ? [...keys, key] : keys.filter(entry => entry !== key);
            await setLAFlag(game.user,WHEEL_FLAGS[target - 1], next);
        }
        return wheel;
    });
}

export function migrateFavoriteKeys(pairs)
{
    if (!pairs?.size)
        return Promise.resolve();
    return queueWrite(async () =>
    {
        for (let wheel = 1; wheel <= WHEEL_COUNT; wheel++)
        {
            const keys = favoriteKeys(wheel);
            if (!keys.some(key => pairs.has(key)))
                continue;
            await setLAFlag(game.user, WHEEL_FLAGS[wheel - 1], [...new Set(keys.map(key => pairs.get(key) ?? key))]);
        }
    }).catch(err => console.warn('lancer-automations | favorite key migration failed', err));
}

// The digit only shows once a wheel past the first is in use: with one wheel it says nothing.
export function favMarkHtml(wheel)
{
    if (!wheel)
        return '';
    const digit = hasSecondWheel() ? `<span class="la-hud-fav-digit">${wheel}</span>` : '';
    return `<span class="la-hud-fav-mark">★${digit}</span>`;
}

/**
 * Wheel picker at the cursor. Never offers the wheel the item already sits on, and
 * only offers Remove when there is something to remove, so it is always WHEEL_COUNT rows.
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
            rows.push({ value: wheel, label: localizeFormat('LA.tokenHud.wheel', { n: wheel }), glyph: `★<span class="la-hud-fav-digit">${wheel}</span>` });
    }
    if (currentWheel)
        rows.push({ value: 0, label: localize('LA.common.remove'), glyph: '✕', cls: 'la-menu-popup-danger' });
    return openCursorMenu({
        head: currentWheel
            ? localizeFormat('LA.tokenHud.onWheel', { n: currentWheel })
            : localize('LA.tokenHud.notFavorited'),
        rows,
        x,
        y,
        onEnter,
        onLeave,
    });
}

export function collectFavorites(categories, wheel = 0)
{
    const favs = wheel ? favoriteKeys(wheel) : Array.from({ length: WHEEL_COUNT }, (_, index) => favoriteKeys(index + 1)).flat();
    if (!favs.length)
        return [];
    const favSet = new Set(favs);
    const results = [];
    const seen = new Set();
    const migrations = new Map();
    const walk = (items, catLabel) =>
    {
        for (const item of (items ?? []))
        {
            if (item.isSectionLabel)
                continue;
            if (item.onClick)
            {
                const key = favKeyOf(item);
                const legacy = key && !favSet.has(key) ? legacyFavKeyOf(item) : null;
                const matched = key && (favSet.has(key) || (legacy && legacy !== key && favSet.has(legacy)));
                if (matched && !seen.has(key))
                {
                    seen.add(key);
                    if (legacy && legacy !== key && favSet.has(legacy))
                        migrations.set(legacy, key);
                    results.push({ ...item, _catLabel: catLabel, favKey: key });
                }
            }
            if (item.getChildren)
                walk(item.getChildren(), catLabel);
        }
    };
    for (const cat of (categories ?? []))
    {
        if (cat.isStatusPanel)
            continue;
        walk(cat.getItems?.(), cat.label);
    }
    migrateFavoriteKeys(migrations);
    return results;
}

export function applyFavMark(row, wheel = 1)
{
    row.css({ position: 'relative' });
    row.find('.la-hud-fav-mark').remove();
    row.append(favMarkHtml(wheel));
    // Striped rows are dark, the default dark star vanishes on them.
    if (row.data('restingBg') && !row.hasClass('la-hud-spent'))
        row.find('.la-hud-fav-mark').css('color', '#fff');
}

export function clearFavMark(row)
{
    row.find('.la-hud-fav-mark').remove();
}

export function favKeyOf(item)
{
    if (item?.favKey)
        return item.favKey;
    const sourceUuid = item?.hoverData?.item?.uuid;
    if (sourceUuid)
    {
        // Rows for an action ON the item key separately from the item row itself.
        const actionName = item.hoverData.action?.name;
        return actionName ? `${sourceUuid}|${actionName}` : sourceUuid;
    }
    return item?.stableKey ?? item?.onRightClick?.favId ?? item?.labelHtml ?? item?.label ?? null;
}

export function legacyFavKeyOf(item)
{
    if (item?.favKey || item?.hoverData?.item?.uuid)
        return favKeyOf(item);
    return item?.labelHtml ?? item?.label ?? null;
}

export function favoriteWheelOf(item)
{
    const key = favKeyOf(item);
    const wheel = favoriteWheel(key);
    const legacy = wheel ? null : legacyFavKeyOf(item);
    if (!legacy || legacy === key)
        return wheel;
    const legacyWheel = favoriteWheel(legacy);
    if (legacyWheel)
        migrateFavoriteKeys(new Map([[legacy, key]]));
    return legacyWheel;
}
