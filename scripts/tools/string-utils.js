/**
 * Localize a label, leaving anything that is not a non-empty string alone.
 * Foundry returns an unknown key unchanged, so plain English passes through.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function localize(value)
{
    if (typeof value !== 'string' || !value)
        return value;
    return /** @type {T} */ (game.i18n?.localize(value) ?? value);
}

/**
 * Localize a key that carries {placeholders}.
 * @param {string} key
 * @param {Record<string, any>} data
 * @returns {string}
 */
export function localizeFormat(key, data)
{
    return game.i18n?.format(key, data) ?? key;
}

// Escape a string for safe HTML interpolation (covers & < > " ').
export function escapeHtml(value)
{
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}
