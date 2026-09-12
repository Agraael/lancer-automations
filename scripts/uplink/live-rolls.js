// Live open-roll registry for the uplink: one slot per HUD dialog, live only
// while its dialog is on screen, streamed from player clients to the GM.

import { getMaxItemRanges_WithBonus } from '../tools/weapon-bonus-utils.js';
import { predictBonusDamage } from '../activations/flow-wraps.js';
import { captureSnapshot } from './snapshots.js';
import { getSettingEnabled } from '../setup/settings-register.js';

const FLOW_KINDS = {
    BasicAttackFlow: 'attack',
    WeaponAttackFlow: 'attack',
    TechAttackFlow: 'tech',
    StatRollFlow: 'hase',
    DamageRollFlow: 'damage'
};
const SLOT_OF = { attack: 'attack', tech: 'attack', hase: 'hase', damage: 'damage' };
const SLOT_SELECTOR = {
    attack: 'form[id^="accdiff"] #attack-accdiff-dialog',
    hase: 'form[id^="accdiff"] #hase-accdiff-dialog',
    damage: '#damage-hud'
};
const HASE_STATS = new Set(['HULL', 'AGI', 'SYS', 'ENG']);
const WATCH_MS = 150;
const NEVER_SHOWN_DROP_MS = 5000;
const CHANNEL = 'module.lancer-automations';
// The stream doubles as heartbeat, so it sends every Nth watch tick unchanged.
const STREAM_EVERY_TICKS = 3;
const REMOTE_STALE_MS = 5000;
const REMOTE_SWEEP_MS = 2000;

const _slots = new Map();
const _remote = new Map();
const _rangeCache = new WeakMap();
const _bonusDamageCache = new WeakMap();
let _watch = null;
let _remoteSweep = null;
let _streamCounter = 0;


function emit(action, payload)
{
    try
    {
        game.socket.emit(CHANNEL, { action, payload });
    }
    catch (err)
    {
        console.warn('lancer-automations | uplink emit failed', err);
    }
}

function emitClose(entry)
{
    if (entry.visible)
        emit('uplinkRollClose', { rollId: entry.id });
}

/** Per-roll weapon ranges (bonus-adjusted), computed once at registration. */
export function getCachedRanges(state)
{
    return _rangeCache.get(state) || null;
}

/** Predicted bonus damage for an attack roll, computed once at registration. */
export function getCachedBonusDamage(state)
{
    return _bonusDamageCache.get(state) || null;
}

/** Display label for a StatRollFlow: the HASE stat, Skill, Grit, or Check. */
export function statRollLabel(state)
{
    const statKey = String(state.data?.path || '').split('.').pop()?.toUpperCase() || '';
    if (HASE_STATS.has(statKey))
        return statKey;
    if (statKey === 'CURR_RANK')
        return 'Skill';
    if (statKey === 'GRIT')
        return 'Grit';
    return 'Check';
}

function notify()
{
    Hooks.callAll('lancer-automations.uplinkLiveRolls');
}

function slotVisible(slot)
{
    return !!document.querySelector(SLOT_SELECTOR[slot]);
}

function stopWatchIfIdle()
{
    if (_slots.size === 0 && _watch !== null)
    {
        clearInterval(_watch);
        _watch = null;
    }
}

// Flips entries visible when their dialog mounts, drops them when it closes,
// and streams visible entries to the GM (the stream doubles as heartbeat).
function watchTick()
{
    let changed = false;
    _streamCounter++;
    for (const [slot, entry] of _slots)
    {
        const present = slotVisible(slot);
        if (!entry.visible && present)
        {
            entry.visible = true;
            changed = true;
            emit('uplinkRollOpen', {
                rollId: entry.id,
                kind: entry.kind,
                slot: entry.slot,
                actorName: entry.actorName,
                actorImg: entry.actorImg,
                userName: entry.userName,
                checkLabel: entry.checkLabel
            });
        }
        else if (entry.visible && !present)
        {
            _slots.delete(slot);
            emitClose(entry);
            changed = true;
        }
        else if (!entry.visible && !present && Date.now() - entry.ts > NEVER_SHOWN_DROP_MS)
        {
            _slots.delete(slot);
        }
        if (entry.visible && _streamCounter % STREAM_EVERY_TICKS === 0)
        {
            const snapshot = captureSnapshot(entry.kind, entry.state);
            if (snapshot)
                emit('uplinkRollSnapshot', { rollId: entry.id, snapshot });
        }
    }
    stopWatchIfIdle();
    if (changed)
        notify();
}

/** Flow step inserted right before each show*HUD. Always continues the flow. */
export async function uplinkHudOpenStep(state)
{
    try
    {
        const kind = FLOW_KINDS[state.name];
        if (kind && !game.user?.isGM && getSettingEnabled('uplinkEnabled'))
        {
            const slot = SLOT_OF[kind];
            _slots.set(slot, {
                id: foundry.utils.randomID(),
                kind,
                slot,
                state,
                ts: Date.now(),
                visible: false,
                actorName: state.actor?.name || '',
                actorImg: state.actor?.img || '',
                userName: game.user?.name || '',
                checkLabel: kind === 'hase' ? statRollLabel(state) : ''
            });
            _watch ??= setInterval(watchTick, WATCH_MS);
            if (state.item && !_rangeCache.has(state))
                _rangeCache.set(state, await getMaxItemRanges_WithBonus(state.item, state.actor));
            if ((kind === 'attack' || kind === 'tech') && !_bonusDamageCache.has(state))
                _bonusDamageCache.set(state, await predictBonusDamage(state));
        }
    }
    catch (err)
    {
        console.warn('lancer-automations | uplink live register failed', err);
    }
    return true;
}

export function resolveLiveRoll(state)
{
    for (const [slot, entry] of _slots)
    {
        if (entry.state === state)
        {
            _slots.delete(slot);
            emitClose(entry);
            if (entry.visible)
                notify();
        }
    }
    stopWatchIfIdle();
}

/** Rolls streamed by players, GM side only. */
export function getLiveRolls()
{
    return Array.from(_remote.values());
}

function sweepRemote()
{
    let changed = false;
    for (const [rollId, entry] of _remote)
    {
        if (Date.now() - entry.lastSeen > REMOTE_STALE_MS)
        {
            _remote.delete(rollId);
            changed = true;
        }
    }
    if (_remote.size === 0 && _remoteSweep !== null)
    {
        clearInterval(_remoteSweep);
        _remoteSweep = null;
    }
    if (changed)
        notify();
}

export function onUplinkRollOpen(payload)
{
    if (!game.user?.isGM || !payload?.rollId)
        return;
    _remote.set(payload.rollId, {
        id: payload.rollId,
        kind: payload.kind,
        slot: payload.slot,
        actorName: payload.actorName || '',
        actorImg: payload.actorImg || '',
        userName: payload.userName || '',
        checkLabel: payload.checkLabel || '',
        snapshot: null,
        lastSeen: Date.now()
    });
    _remoteSweep ??= setInterval(sweepRemote, REMOTE_SWEEP_MS);
    notify();
}

export function onUplinkRollSnapshot(payload)
{
    if (!game.user?.isGM || !payload?.rollId)
        return;
    const snapshot = payload.snapshot;
    let entry = _remote.get(payload.rollId);
    const isNew = !entry && !!snapshot;
    if (isNew)
    {
        entry = {
            id: payload.rollId,
            kind: snapshot.kind,
            slot: null,
            actorName: snapshot.actorName || '',
            actorImg: snapshot.actorImg || '',
            userName: snapshot.user || '',
            checkLabel: snapshot.checkLabel || '',
            snapshot: null,
            lastSeen: 0
        };
        _remote.set(payload.rollId, entry);
        _remoteSweep ??= setInterval(sweepRemote, REMOTE_SWEEP_MS);
    }
    if (!entry)
        return;
    entry.snapshot = snapshot ?? entry.snapshot;
    entry.lastSeen = Date.now();
    if (isNew)
        notify();
}

export function onUplinkRollClose(payload)
{
    if (!game.user?.isGM)
        return;
    if (_remote.delete(payload?.rollId))
        notify();
}
