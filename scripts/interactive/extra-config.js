// Per-item Extra Config: auto-consume opt-out list + consume/recharge API.
// Future Extra Config features live under the same flag object with their own get/set pairs.

import { getPerSceneLimit, itemAllTags } from '../combat/per-frequency-tags.js';

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'extraConfig';

export const CANONICAL_TYPES = ['uses', 'loading', 'charged', 'perTurn', 'perRound', 'perScene', 'reserveUsed'];

export const RESOURCE_LABELS = {
    uses:        'Uses (Limited)',
    loading:     'Loading',
    charged:     'Recharge',
    perTurn:     'Per-Turn',
    perRound:    'Per-Round',
    perScene:    'Per-Scene',
    reserveUsed: 'Reserve Used',
};

export function _hasResource(item, type)
{
    if (!item)
        return false;
    const tags = itemAllTags(item);
    const hasTag = (lid) => tags.some?.(/** @type {any} */ tag => tag?.lid === lid);
    switch (type)
    {
        case 'uses':
            return (Number(item.system?.uses?.max) || 0) > 0 || !!item.isLimited?.() || hasTag('tg_limited');
        case 'loading':
            return !!item.isLoading?.() || hasTag('tg_loading');
        case 'charged':
            return !!(item.is_npc_feature?.() && (item.isRecharge?.() || hasTag('tg_recharge')));
        case 'perTurn':
            return hasTag('tg_turn') || (Number(item.system?.uses_per_turn?.value) || 0) > 0;
        case 'perRound':
            return hasTag('tg_round') || (Number(item.system?.uses_per_round?.value) || 0) > 0;
        case 'perScene':
            return getPerSceneLimit(item) > 0;
        case 'reserveUsed':
            return !!(item.is_reserve?.() && item.system?.consumable);
        default:
            return false;
    }
}

export function _detectResources(item)
{
    return CANONICAL_TYPES.filter(type => _hasResource(item, type));
}

/** @returns {object|null} The stored extra config, or null */
export function getExtraConfig(item)
{
    if (!item?.getFlag)
        return null;
    return item.getFlag(MODULE_ID, FLAG_KEY) ?? null;
}

// Deep-merge patch into Extra Config; prefer explicit helpers when they exist.
/** @returns {Promise<object>} The stored config after the change */
export async function configureItemExtraConfig(item, patch)
{
    if (!item?.setFlag)
        throw new Error('configureItemExtraConfig: invalid item');
    const cur = getExtraConfig(item) ?? {};
    const next = { ...cur, ...(patch ?? {}) };
    await item.setFlag(MODULE_ID, FLAG_KEY, next);
    return next;
}

/** @returns {Set<string>} Tag types with auto-consume turned off */
export function getAutoConsumeDisabled(item)
{
    const cfg = getExtraConfig(item);
    const list = Array.isArray(cfg?.autoConsumeDisabled) ? cfg.autoConsumeDisabled : [];
    return new Set(list);
}

/** @returns {boolean} */
export function isAutoConsumeDisabled(item, type)
{
    return getAutoConsumeDisabled(item).has(type);
}

/**
 * Toggle auto-consume opt-out for a single resource type.
 * @param {any} item
 * @param {'uses'|'loading'|'charged'|'perTurn'|'perRound'|'reserveUsed'} type
 * @param {boolean} disabled - true = do NOT auto-consume on activation; false = default behaviour.
 * @returns {Promise<string[]>} the new autoConsumeDisabled array
 */
export async function setItemAutoConsumeDisabled(item, type, disabled)
{
    if (!item?.setFlag)
        throw new Error('setItemAutoConsumeDisabled: invalid item');
    if (!CANONICAL_TYPES.includes(type))
        throw new Error(`setItemAutoConsumeDisabled: unknown type '${type}'`);
    const cur = getAutoConsumeDisabled(item);
    if (disabled)
        cur.add(type);
    else
        cur.delete(type);
    const disabledTypes = [...cur];
    await configureItemExtraConfig(item, { autoConsumeDisabled: disabledTypes });
    return disabledTypes;
}

/**
 * Set opt-out for every resource type the item actually has (mass toggle).
 * @param {any} item
 * @param {boolean} disabled
 * @returns {Promise<string[]>}
 */
export async function setItemAutoConsumeDisabledAll(item, disabled)
{
    if (!item?.setFlag)
        throw new Error('setItemAutoConsumeDisabledAll: invalid item');
    const disabledTypes = disabled ? _detectResources(item) : [];
    await configureItemExtraConfig(item, { autoConsumeDisabled: disabledTypes });
    return disabledTypes;
}

function _clampAt(value, max)
{
    const floored = Math.max(0, value);
    return (max === Infinity || max === undefined || max === null || !Number.isFinite(max)) ? floored : Math.min(max, floored);
}

async function _applyResourceDelta(item, type, delta)
{
    switch (type)
    {
        case 'uses':
        {
            const cur = Number(item.system?.uses?.value) || 0;
            const max = Number(item.system?.uses?.max);
            const next = _clampAt(cur + delta, Number.isFinite(max) && max > 0 ? max : Infinity);
            await item.update({ 'system.uses.value': next });
            return next;
        }
        case 'loading':
        {
            const loaded = delta > 0;
            await item.update({ 'system.loaded': loaded });
            return loaded;
        }
        case 'charged':
        {
            const charged = delta > 0;
            await item.update({ 'system.charged': charged });
            return charged;
        }
        case 'perTurn':
        {
            const cur = Number(item.system?.uses_per_turn?.value) || 0;
            await item.update({ 'system.uses_per_turn.value': _clampAt(cur + delta, Infinity) });
            return Number(item.system?.uses_per_turn?.value) || 0;
        }
        case 'perRound':
        {
            const cur = Number(item.system?.uses_per_round?.value) || 0;
            await item.update({ 'system.uses_per_round.value': _clampAt(cur + delta, Infinity) });
            return Number(item.system?.uses_per_round?.value) || 0;
        }
        case 'reserveUsed':
        {
            const used = delta < 0;
            await item.update({ 'system.used': used });
            return used;
        }
        default:
            return null;
    }
}

/**
 * @param {any} item
 * @param {'uses'|'loading'|'charged'|'perTurn'|'perRound'|'reserveUsed'} type
 * @param {number} [amount=1]
 * @returns {Promise<number|boolean|null>}
 */
export async function consumeItemResource(item, type, amount = 1)
{
    if (!item)
        throw new Error('consumeItemResource: invalid item');
    if (!_hasResource(item, type))
        throw new Error(`consumeItemResource: item "${item.name}" does not have resource '${type}'`);
    return _applyResourceDelta(item, type, -Math.abs(Number(amount) || 1));
}

/**
 * @param {any} item
 * @param {'uses'|'loading'|'charged'|'perTurn'|'perRound'|'reserveUsed'} type
 * @param {number} [amount=1]
 * @returns {Promise<number|boolean|null>}
 */
export async function rechargeItemResource(item, type, amount = 1)
{
    if (!item)
        throw new Error('rechargeItemResource: invalid item');
    if (!_hasResource(item, type))
        throw new Error(`rechargeItemResource: item "${item.name}" does not have resource '${type}'`);
    return _applyResourceDelta(item, type, Math.abs(Number(amount) || 1));
}

// TAH detail popup: render + bind an inline auto-consume status block with per-type toggles.
export function _usesCountSuffix(item, type)
{
    if (type !== 'uses')
        return '';
    const max = Number(item?.system?.uses?.max) || 0;
    return max > 0 ? ` · <b style="color:#e0c060;">${item.system.uses.value ?? 0}/${max}</b>` : '';
}

export function renderConsumeStatusHtml(item)
{
    const present = _detectResources(item);
    if (!present.length)
        return '';
    const disabled = getAutoConsumeDisabled(item);
    const rows = present.map(type =>
    {
        const off = disabled.has(type);
        const icon = off ? 'fa-square-xmark' : 'fa-square-check';
        const color = off ? '#c97a2b' : '#3a9e6e';
        const verb = off ? 'Does NOT consume' : 'Consumes';
        return `<div class="la-ec-inline-row" data-type="${type}" style="display:flex;align-items:center;gap:6px;padding:2px 6px;cursor:pointer;user-select:none;font-size:0.82em;color:#ccc;" title="Click to toggle auto-consume for ${RESOURCE_LABELS[type]}">
            <i class="fas ${icon}" style="color:${color};"></i>
            <span>${verb} <b>${RESOURCE_LABELS[type]}</b> on activation${_usesCountSuffix(item, type)}</span>
        </div>`;
    }).join('');
    return `<div class="la-ec-inline" style="margin-bottom:6px;padding:4px 6px;background:rgba(0,0,0,0.15);border-radius:3px;">
        <div style="font-size:0.72em;text-transform:uppercase;letter-spacing:0.05em;color:#888;margin:2px 4px 3px;">Auto-Consume</div>
        ${rows}
    </div>`;
}

export function bindConsumeStatusToggles(root, item)
{
    if (!root?.find || !item)
        return;
    root.find('.la-ec-inline-row').each((_i, /** @type {any} */ el) =>
    {
        const $el = /** @type {any} */ (globalThis.$)(el);
        $el.on('click', async () =>
        {
            const type = String($el.data('type') ?? '');
            if (!CANONICAL_TYPES.includes(type))
                return;
            const isOff = getAutoConsumeDisabled(item).has(type);
            await setItemAutoConsumeDisabled(item, type, !isOff);
            const newDisabled = getAutoConsumeDisabled(item);
            const nowOff = newDisabled.has(type);
            const iconEl = $el.find('i');
            iconEl.removeClass('fa-square-xmark fa-square-check');
            iconEl.addClass(nowOff ? 'fa-square-xmark' : 'fa-square-check');
            iconEl.css('color', nowOff ? '#c97a2b' : '#3a9e6e');
            $el.find('span').html(`${nowOff ? 'Does NOT consume' : 'Consumes'} <b>${RESOURCE_LABELS[type]}</b> on activation${_usesCountSuffix(item, type)}`);
        });
    });
}

export const ExtraConfigAPI = {
    configureItemExtraConfig,
    getExtraConfig,
    getAutoConsumeDisabled,
    isAutoConsumeDisabled,
    setItemAutoConsumeDisabled,
    setItemAutoConsumeDisabledAll,
    consumeItemResource,
    rechargeItemResource,
};
