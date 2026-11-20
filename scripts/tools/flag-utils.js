import { MODULE_ID } from './constants.js';
import { updateRouted } from './routed-update.js';

/**
 * Read one of this module's flags off a Document.
 * Safe on a missing document, so callers never have to decide about `?.`.
 * @param {any} doc Document holding the flag.
 * @param {string} key Flag key, without the namespace.
 * @param {any} [fallback] Returned when the flag is unset.
 * @returns {any} The flag value, or `fallback`.
 */
export function getLAFlag(doc, key, fallback)
{
    const value = doc?.getFlag?.(MODULE_ID, key);
    return value === undefined ? fallback : value;
}

/**
 * Write one of this module's flags onto a Document.
 * @param {any} doc Document to write to.
 * @param {string} key Flag key, without the namespace.
 * @param {any} value Value to store.
 * @returns {Promise<any>|undefined} The update promise, or undefined with no document.
 */
export function setLAFlag(doc, key, value)
{
    if (!doc?.setFlag)
        return undefined;
    if (!needsGMWrite(doc))
        return doc.setFlag(MODULE_ID, key, value);
    return updateRouted(doc, { flags: { [MODULE_ID]: { [key]: value } } });
}

function needsGMWrite(doc)
{
    return !game.user.isGM && !doc.isOwner && !!game.users.activeGM;
}

/**
 * Clear one of this module's flags from a Document.
 * @param {any} doc Document to clear on.
 * @param {string} key Flag key, without the namespace.
 * @returns {Promise<any>|undefined} The update promise, or undefined with no document.
 */
export function unsetLAFlag(doc, key)
{
    if (!doc?.unsetFlag)
        return undefined;
    if (!needsGMWrite(doc))
        return doc.unsetFlag(MODULE_ID, key);

    const head = key.split('.');
    const tail = `-=${head.pop()}`;
    return updateRouted(doc, { [['flags', MODULE_ID, ...head, tail].join('.')]: null });
}

/**
 * This module's whole flag bag off raw data rather than a Document.
 * Hook payloads and source objects have no getFlag, so they need this instead.
 * @param {any} source Object carrying a `flags` bag.
 * @returns {any} The namespaced flag object, or undefined.
 */
export function getLAFlags(source)
{
    return source?.flags?.[MODULE_ID];
}

export const MOVE_TRACKING_FLAG_KEYS = ['moveHistory', 'movementCap'];

const _moveTrackingKeys = new Set(MOVE_TRACKING_FLAG_KEYS.flatMap(key => [key, `-=${key}`]));

export function touchesFlagsBesidesMoveTracking(change, ownOnly = false)
{
    const flags = change?.flags;
    if (!flags)
        return false;
    return Object.keys(flags).some(namespace =>
    {
        if (namespace !== MODULE_ID)
            return !ownOnly;

        const own = flags[namespace];
        return !own || typeof own !== 'object' || Object.keys(own).some(key => !_moveTrackingKeys.has(key));
    });
}

export const FlagsAPI = { getLAFlag, setLAFlag, unsetLAFlag, getLAFlags };
