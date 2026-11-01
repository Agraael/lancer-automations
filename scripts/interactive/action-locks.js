import { addActorFlags } from "./document-flags.js";
import { getLAFlag, setLAFlag, unsetLAFlag } from "../tools/flag-utils.js";
import { localize } from "../tools/string-utils.js";
import { getItemActionLocks, lockEntryId } from "../combat/action-limits.js";

function _resolveActor(target)
{
    if (!target)
        return null;
    if (target.documentName === 'Actor')
        return target;
    return target.actor ?? target.document?.actor ?? null;
}

// Item target: lock lives on the item (off while destroyed/disabled, gone when removed). Actor target: source-tracked manual lock.
export async function lockActorAction(target, actionName, sourceIdOrOpts = null, opts = null, kind = null)
{
    if (target?.documentName === 'Item')
    {
        if (!actionName)
        {
            ui.notifications.error(localize('LA.notify.lockActorActionNameRequired'));
            return null;
        }
        const reason = (typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : sourceIdOrOpts?.reason) ?? null;
        const locks = /** @type {any[]} */ (getLAFlag(target,'actionLocks') ?? []);
        if (locks.some(lock => lock?.actionName === actionName))
            return target;
        await setLAFlag(target,'actionLocks', [...locks, { actionName, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) }]);
        return target;
    }
    const actor = _resolveActor(target);
    const sourceId = typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : null;
    if (!actor || !actionName || !sourceId)
    {
        ui.notifications.error(localize('LA.notify.lockActorActionArgs'));
        return null;
    }
    const reason = opts?.reason ?? null;
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActions')) ?? {};
    const entries = Array.isArray(current[actionName]) ? current[actionName].slice() : [];
    const idx = entries.findIndex(entry => lockEntryId(entry) === sourceId);
    const entry = (reason || kind) ? { id: sourceId, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) } : sourceId;
    if (idx === -1)
        entries.push(entry);
    else if (reason)
        entries[idx] = entry;
    await addActorFlags(actor, { lockedActions: { ...current, [actionName]: entries } });
    return actor;
}

/**
 * Same as lockActorAction, but keyed on activation type instead of a single action name.
 * @param {Item|Actor|Token} target - Item: lock held by the item. Actor: source-tracked manual lock.
 * @param {string|string[]} activationTypes - e.g. `"Quick"` or `["Full", "Protocol"]`. `"*"` locks every type.
 * @param {string|{reason?: string, except?: string[]}} [sourceIdOrOpts] - Actor target: sourceId. Item target: opts.
 * @param {{reason?: string, except?: string[]}} [opts] - Actor target only.
 * @returns {Promise<Item|Actor|null>}
 */
export async function lockActorActionTypes(target, activationTypes, sourceIdOrOpts = null, opts = null, kind = null)
{
    const types = (Array.isArray(activationTypes) ? activationTypes : [activationTypes]).filter(Boolean).map(type => String(type));
    if (!types.length)
    {
        ui.notifications.error(localize('LA.notify.lockActorActionTypesEmpty'));
        return null;
    }
    const settings = (typeof sourceIdOrOpts === 'object' && sourceIdOrOpts !== null ? sourceIdOrOpts : opts) ?? {};
    const except = (Array.isArray(settings.except) ? settings.except : [settings.except]).filter(Boolean).map(name => String(name));
    const reason = settings.reason ?? null;

    if (target?.documentName === 'Item')
    {
        const locks = /** @type {any[]} */ (getLAFlag(target,'actionTypeLocks') ?? []);
        const kept = locks.filter(lock => String(lock?.types) !== String(types));
        const entry = /** @type {any} */ ({ types, except });
        if (reason)
            entry.reason = reason;
        if (kind)
            entry.kind = kind;
        await setLAFlag(target,'actionTypeLocks', [...kept, entry]);
        return target;
    }

    const actor = _resolveActor(target);
    const sourceId = typeof sourceIdOrOpts === 'string' ? sourceIdOrOpts : null;
    if (!actor || !sourceId)
    {
        ui.notifications.error(localize('LA.notify.lockActorActionTypesArgs'));
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActionTypes')) ?? {};
    const next = { ...current };
    for (const type of types)
    {
        const entries = Array.isArray(next[type]) ? next[type].slice() : [];
        const idx = entries.findIndex(entry => lockEntryId(entry) === sourceId);
        const entry = { id: sourceId, except, ...(reason ? { reason } : {}), ...(kind ? { kind } : {}) };
        if (idx === -1)
            entries.push(entry);
        else
            entries[idx] = entry;
        next[type] = entries;
    }
    await addActorFlags(actor, { lockedActionTypes: next });
    return actor;
}

/** Inverse of lockActorActionTypes. Item target drops the item's lock, actor target unlocks by sourceId. */
export async function unlockActorActionTypes(target, activationTypes = null, sourceId = null, kind = null)
{
    const types = activationTypes
        ? (Array.isArray(activationTypes) ? activationTypes : [activationTypes]).filter(Boolean).map(type => String(type))
        : null;

    if (target?.documentName === 'Item')
    {
        if (!types)
        {
            if (kind === null)
            {
                await unsetLAFlag(target,'actionTypeLocks');
                return target;
            }
            const all = /** @type {any[]} */ (getLAFlag(target,'actionTypeLocks') ?? []);
            await setLAFlag(target,'actionTypeLocks', all.filter(lock => (lock?.kind ?? null) !== kind));
            return target;
        }
        const locks = /** @type {any[]} */ (getLAFlag(target,'actionTypeLocks') ?? []);
        await setLAFlag(target,'actionTypeLocks', locks.filter(lock => String(lock?.types) !== String(types) || (lock?.kind ?? null) !== kind));
        return target;
    }

    const actor = _resolveActor(target);
    if (!actor || !types || !sourceId)
    {
        ui.notifications.error(localize('LA.notify.unlockActorActionTypesArgs'));
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActionTypes')) ?? {};
    const next = { ...current };
    for (const type of types)
    {
        const entries = Array.isArray(next[type]) ? next[type].filter(entry => lockEntryId(entry) !== sourceId || (entry?.kind ?? null) !== kind) : [];
        if (entries.length)
            next[type] = entries;
        else
            delete next[type];
    }
    await addActorFlags(actor, { lockedActionTypes: next });
    return actor;
}

/** Inverse of lockActorAction. Item target drops the item's lock, actor target unlocks by sourceId. */
export async function unlockActorAction(target, actionName, sourceId = null, kind = null)
{
    if (target?.documentName === 'Item')
    {
        const locks = /** @type {any[]} */ (getLAFlag(target,'actionLocks') ?? []);
        const kept = locks.filter(lock => lock?.actionName !== actionName || (lock?.kind ?? null) !== kind);
        if (kept.length !== locks.length)
            await setLAFlag(target,'actionLocks', kept);
        return target;
    }
    const actor = _resolveActor(target);
    if (!actor || !actionName || !sourceId)
    {
        ui.notifications.error(localize('LA.notify.unlockActorActionArgs'));
        return null;
    }
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActions')) ?? {};
    const entries = Array.isArray(current[actionName]) ? current[actionName].filter(entry => lockEntryId(entry) !== sourceId || (entry?.kind ?? null) !== kind) : [];
    const next = { ...current };
    if (entries.length)
        next[actionName] = entries;
    else
        delete next[actionName];
    await addActorFlags(actor, { lockedActions: next });
    return actor;
}

/** Same as lockActorAction, but shown yellow (disabled) in the HUD instead of grey. */
export async function disableActorAction(target, actionName, sourceIdOrOpts = null, opts = null)
{
    return lockActorAction(target, actionName, sourceIdOrOpts, opts, 'disabled');
}

/** Inverse of disableActorAction. Only removes disabled-kind entries. */
export async function enableActorAction(target, actionName, sourceId = null)
{
    return unlockActorAction(target, actionName, sourceId, 'disabled');
}

/** Same as lockActorActionTypes, but shown yellow (disabled) in the HUD instead of grey. */
export async function disableActorActionTypes(target, activationTypes, sourceIdOrOpts = null, opts = null)
{
    return lockActorActionTypes(target, activationTypes, sourceIdOrOpts, opts, 'disabled');
}

/** Inverse of disableActorActionTypes. Only removes disabled-kind entries. */
export async function enableActorActionTypes(target, activationTypes = null, sourceId = null)
{
    return unlockActorActionTypes(target, activationTypes, sourceId, 'disabled');
}

/** Marks the item destroyed (Lancer native field). */
export async function destroyItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.destroyed': true });
    return item;
}

/** Marks the item disabled (skipped by locks, greyed by the system). */
export async function disableItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.disabled': true });
    return item;
}

/** Clears destroyed and disabled on the item. */
export async function restoreItem(item)
{
    if (item?.documentName !== 'Item')
        return null;
    await item.update({ 'system.destroyed': false, 'system.disabled': false });
    return item;
}

export function isActionLocked(target, actionName)
{
    const actor = _resolveActor(target);
    if (!actor || !actionName)
        return false;
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActions')) ?? {};
    if (Array.isArray(current[actionName]) && current[actionName].length > 0)
        return true;
    return getItemActionLocks(actor, actionName).length > 0;
}

export function getLockedActions(target)
{
    const actor = _resolveActor(target);
    if (!actor)
        return [];
    const current = /** @type {Record<string,any[]>} */(getLAFlag(actor,'lockedActions')) ?? {};
    const names = new Set(Object.keys(current).filter(key => Array.isArray(current[key]) && current[key].length > 0));
    for (const lock of getItemActionLocks(actor))
        names.add(lock.actionName);
    return [...names];
}
