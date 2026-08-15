// TAH hover-triggered range pulse + weapon-row range resolution.
// (Persistent GAA-based range auras were removed; range toggles now proxy the Advanced Measure tool.)

import { getMaxWeaponReach_WithBonus, getActorMaxThreat, getMaxItemRanges_WithBonus, weaponPulseRange } from '../tools/misc-tools.js';
import { getActorMaxReach_WithBonus } from '../tools/weapon-bonus-utils.js';
import { rangePulse, RANGE_PULSE_PRIORITY, RANGE_GLOW } from '../interactive/canvas.js';
import { resolveDeployRangeCount } from '../interactive/deployables.js';
import { resolveGrantedActionRange } from '../interactive/action-overlays.js';

const _rangePreviewOwnerByTokenId = new Map();
const hoverPulseOwner = tokenId => `tah-hover:${tokenId}`;

export async function activateRangePreview(token, range, ownerEl = null, glowColor = RANGE_GLOW.manual)
{
    if (!token || range == null)
        return;
    const radius = Math.max(1, range);
    rangePulse.setRange(hoverPulseOwner(token.id), { token, range: radius, includeSelf: false, priority: RANGE_PULSE_PRIORITY.HOVER, glowColor });
    if (ownerEl)
        _rangePreviewOwnerByTokenId.set(token.id, ownerEl);
}

export function deactivateRangePreview(token)
{
    if (!token)
        return;
    _rangePreviewOwnerByTokenId.delete(token.id);
    rangePulse.clear(hoverPulseOwner(token.id));
}

// Drop previews whose source row left the DOM (its column closed).
export function cleanupDetachedRangePreviews()
{
    for (const [tokenId, ownerEl] of _rangePreviewOwnerByTokenId)
    {
        if (ownerEl?.isConnected)
            continue;
        rangePulse.clear(hoverPulseOwner(tokenId));
        _rangePreviewOwnerByTokenId.delete(tokenId);
    }
}

/** Sensor range for an actor (synchronous). */
function getSensorRange(actor)
{
    if (!actor)
        return 10;
    if (actor.type === 'pilot')
        return 5;
    return actor.system?.sensor_range ?? 10;
}

// Fixed range-1 melee/utility actions; no card range preview for these.
export const FIXED_MELEE_ACTIONS = new Set(['ram', 'ramming speed', 'grapple', 'improvised attack', 'pick up weapon', 'pickup weapon']);

/**
 * @param {string|undefined} actionName
 * @param {any} actor
 * @param {any|null} item
 * @returns {Promise<number|null>} range to preview, or null for no preview
 */
export async function getAttackRange(actionName, actor, item)
{
    const name = (actionName ?? '').toLowerCase().trim();
    if (name === 'basic attack' || name === 'damage')
        return null;
    if (FIXED_MELEE_ACTIONS.has(name))
        return 1;
    if (name === 'skirmish' || name === 'barrage')
    {
        const input = item ?? actor;
        if (!input)
            return 1;
        return Math.max(1, getActorMaxReach_WithBonus(input));
    }
    if (name === 'thrown' || name === 'throw')
    {
        const input = item ?? actor;
        if (!input)
            return 1;
        return Math.max(1, await getMaxWeaponReach_WithBonus(input));
    }
    if (item)
    {
        const reach = await getMaxWeaponReach_WithBonus(item);
        if (reach > 0)
            return Math.max(1, reach);
    }
    return null;
}

/** @param {any} item */
function isWeaponItem(item)
{
    return !!item && (String(item.type ?? '').includes('weapon') || item.system?.type === 'Weapon');
}

/**
 * Glow color matching the kind of range being previewed.
 * @param {string|undefined} category
 * @param {string|undefined} actionName
 * @param {any|null} item
 */
export function getRangeGlowForAction(category, actionName, item)
{
    const name = (actionName ?? '').toLowerCase().trim();
    if (name === 'overwatch')
        return RANGE_GLOW.threat;
    if (category === 'Tech')
        return RANGE_GLOW.sensor;
    if (FIXED_MELEE_ACTIONS.has(name) || name === 'thrown' || name === 'throw')
        return RANGE_GLOW.weapon;
    if (isWeaponItem(item))
        return RANGE_GLOW.weapon;
    if (name === 'skirmish' || name === 'barrage')
        return RANGE_GLOW.reach;
    return RANGE_GLOW.manual;
}

async function getItemMaxReach(item, actor)
{
    const ranges = await getMaxItemRanges_WithBonus(item, actor);
    const ALL_TYPES = ['Range', 'Line', 'Cone', 'Blast', 'Burst', 'Threat', 'Thrown', 'Deploy'];
    return Math.max(0, ...ALL_TYPES.map(rangeType => ranges[rangeType] ?? 0));
}

async function computePreviewRange(category, actionName, actor, item, profile, deployLid)
{
    const base = await computePreviewRangeBase(category, actionName, actor, item, profile, deployLid);
    return actionName ? resolveGrantedActionRange(actor, actionName, base) : base;
}

async function computePreviewRangeBase(category, actionName, actor, item, profile, deployLid)
{
    if (category === 'Deployables')
    {
        if (deployLid)
            return resolveDeployRangeCount(item ?? null, deployLid, actor).range;
        const deployRange = item?.getFlag?.('lancer-automations', 'deployRange') ?? 1;
        return Math.max(1, deployRange);
    }
    if (profile?.range?.length)
    {
        const ranges = {};
        for (const { type, val: value } of profile.range)
            ranges[type] = Math.max(ranges[type] ?? 0, Number(value) || 0);
        const max = weaponPulseRange(ranges);
        return max > 0 ? Math.max(1, max) : null;
    }
    if (item)
    {
        const reach = await getItemMaxReach(item, actor);
        if (reach > 0)
            return Math.max(1, reach);
    }
    if (category === 'Tech')
        return getSensorRange(actor);
    if (category === 'Actions')
    {
        const name = (actionName ?? '').toLowerCase().trim();
        if (name === 'overwatch')
            return Math.max(1, await getActorMaxThreat(actor));
        if (name === 'search')
            return actor?.type === 'pilot' ? 5 : getSensorRange(actor);
        if (name === 'disengage')
            return 1;
        if (name === 'eject')
            return 6;
        return null;
    }
    if (category === 'Attacks')
        return getAttackRange(actionName, actor, null);
    return null;
}

/**
 * Called by _openCol for every row that carries hoverData.
 * @param {{ actor: any, item?: any, action?: { name: string, activation?: string }, category?: string, profile?: any, token?: any, isEntering: boolean, isLeaving: boolean, el?: any, deployLid?: string }} data
 */
export async function onHudRowHover({ actor, item, action, category, profile, token, isEntering, el, deployLid })
{
    if (!token)
        return;
    try
    {
        if (!game.settings.get('lancer-automations', 'tah.rangePreview'))
            return;
    }
    catch
    {
        return;
    }
    if (isEntering)
    {
        const range = await computePreviewRange(category, action?.name, actor, item ?? null, profile ?? null, deployLid);
        if (range != null)
            await activateRangePreview(token, range, el, getRangeGlowForAction(category, action?.name, item ?? null));
    }
    else
        deactivateRangePreview(token);
}
