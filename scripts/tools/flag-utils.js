import { MODULE_ID } from './constants.js';

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
    return doc?.setFlag?.(MODULE_ID, key, value);
}

/**
 * Clear one of this module's flags from a Document.
 * @param {any} doc Document to clear on.
 * @param {string} key Flag key, without the namespace.
 * @returns {Promise<any>|undefined} The update promise, or undefined with no document.
 */
export function unsetLAFlag(doc, key)
{
    return doc?.unsetFlag?.(MODULE_ID, key);
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

export const FlagsAPI = { getLAFlag, setLAFlag, unsetLAFlag, getLAFlags };
