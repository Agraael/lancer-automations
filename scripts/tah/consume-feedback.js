// Floating consume feedback on every client: mirrors the extra-bar approach (per-client last-seen snapshot diffed on the updateItem hook, masked via scan) so no pre-value broadcast is needed.

import { playStatsSound } from './sound.js';
import { isActorScannedForUser } from '../tools/scan-lookup.js';

const MODULE_ID = 'lancer-automations';
const _lastConsume = new Map();

function _readNum(root, dotPath)
{
    const raw = foundry.utils.getProperty(root, dotPath);
    return raw === undefined || raw === null ? undefined : Number(raw);
}

function _readBool(root, dotPath)
{
    const raw = foundry.utils.getProperty(root, dotPath);
    return raw === undefined ? undefined : !!raw;
}

// uses can be a nested object {value, max} OR a raw number depending on the item type.
function _readUses(root)
{
    const nested = foundry.utils.getProperty(root, 'system.uses.value');
    if (nested !== undefined && nested !== null)
        return Number(nested);
    const raw = foundry.utils.getProperty(root, 'system.uses');
    if (typeof raw === 'number')
        return raw;
    return undefined;
}

// change can arrive as {'system.uses.value': N} (flat) OR {system: {uses: {value: N}}} (nested).
function _changeUses(change)
{
    const nested = foundry.utils.getProperty(change, 'system.uses.value');
    if (nested !== undefined)
        return Number(nested);
    const raw = foundry.utils.getProperty(change, 'system.uses');
    if (typeof raw === 'number')
        return raw;
    return undefined;
}

const RESOURCE_FIELDS = {
    uses:        { read: _readUses,                                                      get: _changeUses },
    loading:     { read: (item) => _readBool(item, 'system.loaded'),                     get: (change) => _readBool(change, 'system.loaded') },
    charged:     { read: (item) => _readBool(item, 'system.charged'),                    get: (change) => _readBool(change, 'system.charged') },
    perTurn:     { read: (item) => _readNum(item, 'system.uses_per_turn.value'),         get: (change) => _readNum(change, 'system.uses_per_turn.value') },
    perRound:    { read: (item) => _readNum(item, 'system.uses_per_round.value'),        get: (change) => _readNum(change, 'system.uses_per_round.value') },
    reserveUsed: { read: (item) => _readBool(item, 'system.used'),                       get: (change) => _readBool(change, 'system.used') },
};

function _formatLabel(type, pre, post)
{
    const signedDelta = (delta) => `${delta > 0 ? '+' : ''}${delta}`;
    switch (type)
    {
        case 'uses':        return `Uses ${signedDelta(post - pre)}`;
        case 'loading':     return post ? 'Loaded' : 'Unloaded';
        case 'charged':     return post ? 'Charged' : 'Discharged';
        case 'perTurn':     return `Per-Turn ${signedDelta(post - pre)}`;
        case 'perRound':    return `Per-Round ${signedDelta(post - pre)}`;
        case 'reserveUsed': return post ? 'Reserve Used' : 'Reserve Restored';
        default:            return '';
    }
}

// Mirror of the extra-bar 'scanned' visibility: GM/owner and own-side actors reveal; NPC/deployable need a scan.
function _canSeeConsume(actor)
{
    if (game.user?.isGM || actor?.isOwner)
        return true;
    if (actor?.type === 'pilot' || actor?.type === 'mech')
        return true;
    if (actor?.getFlag?.(MODULE_ID, 'scannedByAll'))
        return true;
    return isActorScannedForUser(actor, game.user);
}

function _floatingNumbersOn()
{
    try
    {
        return !!game.settings.get('lancer', 'floatingNumbers');
    }
    catch
    {
        return true;
    }
}

export function spawnConsumeFeedback(actor, type, pre, post, labelOverride = null)
{
    try
    {
        const tokens = actor?.getActiveTokens?.() ?? [];
        const token = tokens.find(/** @type {any} */ activeToken => activeToken.visible) ?? tokens[0];
        if (!token || !token.visible)
            return;
        const revealed = _canSeeConsume(actor);
        const text = revealed ? (labelOverride ?? _formatLabel(type, pre, post)) : '???';
        if (!text)
            return;
        const delta = (typeof pre === 'number' && typeof post === 'number') ? post - pre : 0;
        if (_floatingNumbersOn() && canvas?.interface?.createScrollingText)
        {
            const fill = !revealed ? '#888888' : (delta > 0 ? '#66cc66' : (delta < 0 ? '#ff9955' : '#cccccc'));
            // Masked feedback uses a constant direction so scroll up/down never leaks gain-vs-spend.
            const direction = !revealed
                ? CONST.TEXT_ANCHOR_POINTS.TOP
                : (delta > 0 ? CONST.TEXT_ANCHOR_POINTS.BOTTOM : CONST.TEXT_ANCHOR_POINTS.TOP);
            canvas.interface.createScrollingText(token.center, text, {
                anchor: CONST.TEXT_ANCHOR_POINTS.BOTTOM,
                direction,
                fontSize: 28,
                fill,
                stroke: 0,
                strokeThickness: 4,
                jitter: 0.25,
            });
        }
        if (revealed)
            playStatsSound('generic_stat');
    }
    catch (err)
    {
        console.warn(`${MODULE_ID} | consume-feedback: spawn failed`, err);
    }
}

function _snapshotItem(item)
{
    if (!item?.uuid)
        return;
    for (const [type, { read }] of Object.entries(RESOURCE_FIELDS))
    {
        const value = read(item);
        if (value !== undefined)
            _lastConsume.set(`${item.uuid}:${type}`, value);
    }
    if (item.type === 'bond')
    {
        (item.system?.powers ?? []).forEach((/** @type {any} */ power, /** @type {number} */ powerIdx) =>
        {
            const value = power?.uses?.value;
            if (value !== undefined && value !== null)
                _lastConsume.set(`${item.uuid}:power:${powerIdx}`, Number(value));
        });
    }
}

// Seed the per-client snapshot from the current scene so the first consume already has a previous value.
function _seedFromCanvas()
{
    _lastConsume.clear();
    for (const token of canvas?.tokens?.placeables ?? [])
    {
        const actor = token.actor;
        if (!actor)
            continue;
        for (const item of actor.items ?? [])
            _snapshotItem(item);
    }
}

export function initConsumeFeedback()
{
    Hooks.on('canvasReady', _seedFromCanvas);
    if (canvas?.ready)
        _seedFromCanvas();

    Hooks.on('updateItem', (item, change, options) =>
    {
        try
        {
            if (!item?.uuid)
                return;
            const actor = item.parent;
            if (actor?.documentName !== 'Actor')
                return;
            // Suppressed updates still refresh the snapshot so the next real delta stays correct.
            const suppressed = options?.laConsumeFeedback === false;
            for (const [type, { get }] of Object.entries(RESOURCE_FIELDS))
            {
                const post = get(change);
                if (post === undefined)
                    continue;
                const key = `${item.uuid}:${type}`;
                const prev = _lastConsume.get(key);
                _lastConsume.set(key, post);
                // Unknown prev = first sight this session: seed silently. Equal = no-op write.
                if (prev === undefined || prev === post || suppressed)
                    continue;
                spawnConsumeFeedback(actor, type, prev, post);
            }
            if (item.type === 'bond' && change.system?.powers !== undefined)
            {
                (/** @type {any[]} */ (item.system?.powers ?? [])).forEach((power, powerIdx) =>
                {
                    const raw = power?.uses?.value;
                    if (raw === undefined || raw === null)
                        return;
                    const post = Number(raw);
                    const key = `${item.uuid}:power:${powerIdx}`;
                    const prev = _lastConsume.get(key);
                    _lastConsume.set(key, post);
                    if (prev === undefined || prev === post || suppressed)
                        return;
                    const delta = post - prev;
                    spawnConsumeFeedback(actor, 'uses', prev, post, `${power.name} ${delta > 0 ? '+' : ''}${delta}`);
                });
            }
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | consume-feedback: updateItem handler failed`, err);
        }
    });
}
