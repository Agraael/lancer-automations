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
    const FCS = typeof ForceClientSettings === 'undefined' ? null : /** @type {any} */ (ForceClientSettings);
    if (FCS?.forced)
        FCS.forced = new Map(Object.entries(forced));
}

function _ownValue(fullKey, setting)
{
    const raw = globalThis.localStorage.getItem(fullKey);
    if (raw === null)
        return setting.default;
    try
    {
        return JSON.parse(raw);
    }
    catch
    {
        return raw;
    }
}

async function _storeForcedValue(fullKey)
{
    const setting = game.settings.settings.get(/** @type {any} */ (fullKey));
    if (!setting)
        return;
    const forcedKey = `_${fullKey}`;
    if (!game.settings.settings.has(/** @type {any} */ (`force-client-settings.${forcedKey}`)))
    {
        const data = /** @type {any} */ ({ ...setting, scope: 'world', config: false, onChange: null });
        if (data.type instanceof foundry.data.fields.DataField)
            data.type = Object.assign(Object.create(Object.getPrototypeOf(data.type)), data.type);
        game.settings.register(/** @type {any} */ ('force-client-settings'), forcedKey, data);
    }
    await game.settings.set(/** @type {any} */ ('force-client-settings'), forcedKey, _ownValue(fullKey, setting));
}

export async function repairFCSForcedValues(fcs)
{
    if (!game.user?.isGM || !fcs)
        return;
    const world = game.settings.storage.get('world');
    for (const fullKey of fcs.forced.keys())
    {
        if (!world?.getSetting(`force-client-settings._${fullKey}`))
            await _storeForcedValue(fullKey);
    }
}

/**
 * Set one key to an explicit mode. 'open' removes the force entirely.
 * @param {string} fullKey "<module>.<key>"
 * @param {'open'|'soft'|'hard'} mode
 * @param {any} fcs
 */
export async function setFCSForce(fullKey, mode, fcs)
{
    await setFCSForceBulk([{ fullKey, mode }], fcs);
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
        {
            delete forced[fullKey];
            continue;
        }
        await _storeForcedValue(fullKey);
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
