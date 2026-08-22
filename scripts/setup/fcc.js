// Force Client Controls bridge. FCC only decorates Foundry's own controls config, so the
// module's Control tab reads its live maps and reuses its toggle to stay in sync.
const FCC_ID = 'force-client-controls';

// Declared at classic-script top level, so it lives in the global lexical scope, not on globalThis.
function fccClass()
{
    return typeof ForceClientControls === 'undefined' ? null : /** @type {any} */ (ForceClientControls);
}

export function isFCCActive()
{
    return !!game.modules.get(FCC_ID)?.active && !!fccClass();
}

export function getFCCData()
{
    if (!isFCCActive())
        return null;
    const FCC = fccClass();
    if (!(FCC.forced instanceof Map) || !(FCC.unlocked instanceof Map))
        return null;
    return { forced: FCC.forced, unlocked: FCC.unlocked };
}

/**
 * @param {string} action "<module>.<action>"
 * @param {any} fcc
 * @param {boolean} isGM
 * @returns {string} "<open|soft|hard|unlocked>-<gm|client>"
 */
export function getFCCModeKey(action, fcc, isGM)
{
    let mode = fcc.forced.get(action)?.mode ?? 'open';
    if ((mode === 'soft' || isGM) && fcc.unlocked.has(action))
        mode = 'unlocked';
    return mode + (isGM ? '-gm' : '-client');
}

/** @param {any} event @param {string} action */
export async function toggleFCCForce(event, action)
{
    const FCC = fccClass();
    if (typeof FCC?.clickToggleForceControls !== 'function')
        return;
    const noRender = { render: () => null };
    await FCC.clickToggleForceControls(event, action, noRender);
}
