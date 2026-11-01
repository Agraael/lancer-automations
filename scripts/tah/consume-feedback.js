// Floating consume feedback on every client: mirrors the extra-bar approach (per-client last-seen snapshot diffed on the updateItem hook, masked via scan) so no pre-value broadcast is needed.

import { playStatsSound } from './sound.js';
import { isActorScannedForUser } from '../tools/scan-lookup.js';

import { MODULE_ID } from '../tools/constants.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { getExternalSetting } from '../tools/settings-utils.js';
const _lastConsume = new Map();
const _seenDocs = new Set();
const SUB_FIELDS = { uses_per_turn: 'perTurn', uses_per_round: 'perRound', uses_per_scene: 'perScene', uses_per_mission: 'perMission' };
// Per-X fields count uses spent, so their delta is shown inverted (spend = -1).
const USED_COUNTER_TYPES = new Set(Object.values(SUB_FIELDS));

// Per-action / per-rank counters stored under the perFreqSub flag.
function _subEntries(item)
{
    const map = getLAFlag(item,'perFreqSub') ?? {};
    const out = [];
    for (const [subKey, entry] of Object.entries(map))
    {
        for (const [field, type] of Object.entries(SUB_FIELDS))
        {
            const raw = entry?.[field]?.value;
            if (raw === undefined || raw === null)
                continue;
            out.push({ key: `${item.uuid}:sub:${subKey}:${field}`, type, subKey, value: Number(raw) });
        }
    }
    return out;
}

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
    perScene:    { read: (item) => _readNum(item, 'system.uses_per_scene.value'),        get: (change) => _readNum(change, 'system.uses_per_scene.value') },
    perMission:  { read: (item) => _readNum(item, 'system.uses_per_mission.value'),      get: (change) => _readNum(change, 'system.uses_per_mission.value') },
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
        case 'perTurn':     return `Per-Turn ${signedDelta(pre - post)}`;
        case 'perRound':    return `Per-Round ${signedDelta(pre - post)}`;
        case 'perScene':    return `Per-Encounter ${signedDelta(pre - post)}`;
        case 'perMission':  return `Per-Mission ${signedDelta(pre - post)}`;
        case 'reserveUsed': return post ? 'Reserve Used' : 'Reserve Restored';
        case 'core':        return `Core Power ${signedDelta(post - pre)}`;
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
    return isActorScannedForUser(actor, game.user);
}

function _floatingNumbersOn()
{
    return !!getExternalSetting('lancer', 'floatingNumbers', true);
}

function _feedbackTokens(actor)
{
    const own = actor?.getActiveTokens?.() ?? [];
    if (own.length || actor?.type !== 'pilot')
        return own;
    return (canvas?.tokens?.placeables ?? []).filter(token => token.actor?.system?.pilot?.value?.id === actor.id);
}

export function spawnConsumeFeedback(actor, type, pre, post, labelOverride = null)
{
    try
    {
        const tokens = _feedbackTokens(actor);
        const token = tokens.find(/** @type {any} */ activeToken => activeToken.visible) ?? tokens[0];
        if (!token || !token.visible)
            return;
        const revealed = _canSeeConsume(actor);
        const text = revealed ? (labelOverride ?? _formatLabel(type, pre, post)) : '???';
        if (!text)
            return;
        const rawDelta = (typeof pre === 'number' && typeof post === 'number') ? post - pre : 0;
        const delta = USED_COUNTER_TYPES.has(type) ? -rawDelta : rawDelta;
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
    _seenDocs.add(item.uuid);
    for (const [type, { read }] of Object.entries(RESOURCE_FIELDS))
    {
        const value = read(item);
        if (value !== undefined)
            _lastConsume.set(`${item.uuid}:${type}`, value);
    }
    for (const entry of _subEntries(item))
        _lastConsume.set(entry.key, entry.value);
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

function _snapshotActor(actor)
{
    if (!actor?.uuid)
        return;
    _seenDocs.add(actor.uuid);
    const core = _readNum(actor, 'system.core_energy');
    if (core !== undefined)
        _lastConsume.set(`${actor.uuid}:core`, core);
    for (const entry of _subEntries(actor))
        _lastConsume.set(entry.key, entry.value);
}

function _spawnSubChanges(doc, actor, suppressed)
{
    for (const entry of _subEntries(doc))
    {
        const prev = _lastConsume.get(entry.key) ?? (_seenDocs.has(doc.uuid) ? 0 : undefined);
        _lastConsume.set(entry.key, entry.value);
        if (prev === undefined || prev === entry.value || suppressed)
            continue;
        spawnConsumeFeedback(actor, entry.type, prev, entry.value);
    }
}

// Seed the per-client snapshot from the current scene so the first consume already has a previous value.
function _seedFromCanvas()
{
    _lastConsume.clear();
    _seenDocs.clear();
    for (const token of canvas?.tokens?.placeables ?? [])
    {
        const actor = token.actor;
        if (!actor)
            continue;
        for (const owner of [actor, actor.system?.pilot?.value])
        {
            if (!owner)
                continue;
            _snapshotActor(owner);
            for (const item of owner.items ?? [])
                _snapshotItem(item);
        }
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
            const suppressed = /** @type {any} */ (options)?.laConsumeFeedback === false;
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
            if (Object.keys(foundry.utils.flattenObject(change)).some(key => key.includes('perFreqSub')))
                _spawnSubChanges(item, actor, suppressed);
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

    Hooks.on('updateActor', (actor, change, options) =>
    {
        try
        {
            if (!actor?.uuid)
                return;
            const suppressed = /** @type {any} */ (options)?.laConsumeFeedback === false;
            const core = _readNum(change, 'system.core_energy');
            if (core !== undefined)
            {
                const key = `${actor.uuid}:core`;
                const prev = _lastConsume.get(key);
                _lastConsume.set(key, core);
                if (prev !== undefined && prev !== core && !suppressed)
                    spawnConsumeFeedback(actor, 'core', prev, core);
            }
            if (Object.keys(foundry.utils.flattenObject(change)).some(key => key.includes('perFreqSub')))
                _spawnSubChanges(actor, actor, suppressed);
        }
        catch (err)
        {
            console.warn(`${MODULE_ID} | consume-feedback: updateActor handler failed`, err);
        }
    });
}
