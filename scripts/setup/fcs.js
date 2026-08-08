// Shared helpers for the optional Force Client Settings module. FCS can force
// only client-scoped settings; world settings are already global.

export function isFCSActive()
{
    return !!game.modules.get('force-client-settings')?.active;
}

/** @returns {{forced: Map<string, any>, unlocked: Map<string, any>} | null} */
export function getFCSData()
{
    if (!isFCSActive())
        return null;
    try
    {
        const forced = new Map(Object.entries(
            game.settings.get('force-client-settings', 'forced') ?? {}
        ));
        const unlocked = new Map(Object.entries(
            game.settings.get('force-client-settings', 'unlocked') ?? {}
        ));
        return { forced, unlocked };
    }
    catch
    {
        return null;
    }
}

/**
 * @param {string} fullKey "<module>.<key>"
 * @param {any} fcs
 * @returns {'open'|'soft'|'hard'}
 */
export function getFCSMode(fullKey, fcs)
{
    return fcs?.forced?.get(fullKey)?.mode ?? 'open';
}

// Refresh FCS's in-memory map so a lock applies without a reload.
function _livePatch(forced)
{
    const FCS = /** @type {any} */ (globalThis).ForceClientSettings;
    if (FCS?.forced)
        FCS.forced = new Map(Object.entries(forced));
}

/**
 * Set one key to an explicit mode. 'open' removes the force entirely.
 * @param {string} fullKey "<module>.<key>"
 * @param {'open'|'soft'|'hard'} mode
 * @param {any} fcs
 */
export async function setFCSForce(fullKey, mode, fcs)
{
    if (!game.user?.isGM || !fcs)
        return;
    const forced = Object.fromEntries(fcs.forced);
    if (mode === 'open')
        delete forced[fullKey];
    else
        forced[fullKey] = { mode };
    await game.settings.set('force-client-settings', 'forced', forced);
    fcs.forced = new Map(Object.entries(forced));
    _livePatch(forced);
}

/**
 * Apply many force changes in a single write.
 * @param {{fullKey: string, mode: 'open'|'soft'|'hard'}[]} entries
 * @param {any} fcs
 */
export async function setFCSForceBulk(entries, fcs)
{
    if (!game.user?.isGM || !fcs || !entries?.length)
        return;
    const forced = Object.fromEntries(fcs.forced);
    for (const { fullKey, mode } of entries)
    {
        if (mode === 'open')
            delete forced[fullKey];
        else
            forced[fullKey] = { mode };
    }
    await game.settings.set('force-client-settings', 'forced', forced);
    fcs.forced = new Map(Object.entries(forced));
    _livePatch(forced);
}

/**
 * Cycle open -> soft -> hard -> open. Used by the config window's lock icons.
 * @param {string} fullKey "<module>.<key>"
 * @param {any} fcs
 */
export async function toggleFCSForce(fullKey, fcs)
{
    const cur = getFCSMode(fullKey, fcs);
    const next = { open: 'soft', soft: 'hard', hard: 'open' }[cur];
    await setFCSForce(fullKey, next, fcs);
}
