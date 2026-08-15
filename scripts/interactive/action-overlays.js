// Combat data attached to an item's native actions, kept in a flag so re-imports don't wipe it.

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'actionOverlays';

// setFlag treats dots in keys as paths; action names can contain them.
function _encodeKey(name)
{
    return String(name).replace(/\./g, '$DOT$');
}

function _resolveDoc(target)
{
    const anyTarget = /** @type {any} */ (target);
    if (!anyTarget)
        return null;
    return (anyTarget.documentName === 'Item') ? anyTarget : (anyTarget.actor ?? anyTarget.document ?? anyTarget);
}

/**
 * @typedef {Object} ActionOverlay
 * @property {'attack'|'damage'} laCombat
 * @property {number} [attack_bonus]
 * @property {number} [accuracy]
 * @property {number} [difficulty]
 * @property {'Melee'|'Ranged'} [attack_type]
 * @property {{lid: string, val?: string}[]} [tags]
 * @property {{val: string, type: string}[]} [damage]
 * @property {{type: string, val: string|number}[]} [range]
 */

/**
 * Every overlay on an item, keyed by action name.
 * @param {Item|Token|Actor} target
 * @returns {Record<string, ActionOverlay>}
 */
export function getActionOverlays(target)
{
    const doc = _resolveDoc(target);
    const map = doc?.getFlag?.(MODULE_ID, FLAG_KEY) || {};
    const out = {};
    for (const [key, value] of Object.entries(map))
        out[String(key).replace(/\$DOT\$/g, '.')] = value;
    return out;
}

/**
 * The overlay for one action, or null.
 * @param {Item|Token|Actor} target
 * @param {string} actionName
 * @returns {ActionOverlay|null}
 */
export function getActionOverlay(target, actionName)
{
    const doc = _resolveDoc(target);
    if (!doc || !actionName)
        return null;
    const map = doc.getFlag?.(MODULE_ID, FLAG_KEY) || {};
    return map[_encodeKey(actionName)] ?? null;
}

/**
 * Attach or patch combat data on a native action. Patch-merge; empty values clear a field,
 * null removes the overlay.
 * @param {Item|Token|Actor} target
 * @param {string} actionName  Name as it appears in system.actions
 * @param {ActionOverlay|null} overlay
 * @returns {Promise<Item|Actor|null>} The updated document, or null on failure
 */
export async function setActionOverlay(target, actionName, overlay)
{
    const doc = _resolveDoc(target);
    if (!doc || !actionName)
    {
        ui.notifications.error("setActionOverlay: target and actionName are required.");
        return null;
    }
    const map = doc.getFlag?.(MODULE_ID, FLAG_KEY) || {};
    const encoded = _encodeKey(actionName);
    let next = null;
    if (overlay !== null)
    {
        next = { ...map[encoded] };
        for (const [key, value] of Object.entries(overlay))
        {
            if (value == null || value === '' || (Array.isArray(value) && !value.length))
                delete next[key];
            else
                next[key] = value;
        }
        if (Object.keys(next).length === 0)
            next = null;
    }
    // setFlag merges, so stale keys/fields must be dropped with the -= syntax first.
    if (map[encoded] !== undefined)
        await doc.update({ [`flags.${MODULE_ID}.${FLAG_KEY}.-=${encoded}`]: null });
    if (next)
        await doc.setFlag(MODULE_ID, FLAG_KEY, { [encoded]: next });
    return doc;
}

/**
 * Drop the overlay from an action.
 * @param {Item|Token|Actor} target
 * @param {string} actionName
 * @returns {Promise<Item|Actor|null>}
 */
export async function removeActionOverlay(target, actionName)
{
    return setActionOverlay(target, actionName, null);
}

/**
 * Action range after overlay grants. Entry modes like AE changes: upgrade (default), add, override.
 * @param {Actor} actor
 * @param {string} actionName
 * @param {number|null} base
 * @returns {number|null}
 */
export function resolveGrantedActionRange(actor, actionName, base = null)
{
    let upgrade = null;
    let override = null;
    let add = 0;
    let found = false;
    for (const item of /** @type {any} */ (actor)?.items ?? [])
    {
        if (item.system?.destroyed || item.system?.disabled)
            continue;
        const overlay = /** @type {any} */ (getActionOverlay(item, actionName));
        for (const entry of (overlay?.range ?? []))
        {
            found = true;
            const val = Number(entry?.val) || 0;
            const mode = entry?.mode ?? overlay.rangeMode ?? 'upgrade';
            if (mode === 'add')
                add += val;
            else if (mode === 'override')
                override = Math.max(override ?? 0, val);
            else
                upgrade = Math.max(upgrade ?? 0, val);
        }
    }
    if (!found)
        return base;
    const start = override ?? Math.max(base ?? 0, upgrade ?? 0);
    return Math.max(0, start + add);
}

/**
 * Fold stored combat data onto native actions. Name / activation / detail are never
 * overwritten, so action index and dedupe stay aligned with system.actions.
 * @param {Item|Actor} item
 * @param {Array} actions
 * @returns {Array}
 */
export function applyActionOverlays(item, actions)
{
    if (!item || !actions?.length)
        return actions ?? [];
    const map = item.getFlag?.(MODULE_ID, FLAG_KEY) || {};
    if (!Object.keys(map).length)
        return actions;
    return actions.map(action =>
    {
        const overlay = map[_encodeKey(action?.name ?? '')];
        if (!overlay?.laCombat)
            return action;
        return { ...action, ...overlay, name: action.name, activation: action.activation, detail: action.detail, _hasOverlay: true };
    });
}
