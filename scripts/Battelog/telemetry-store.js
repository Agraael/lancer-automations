/* global game, CONST, console */

// Combat-scoped telemetry storage. Data lives on the Combat as a flag so it
// dies with the encounter and survives F5s while the combat exists.

import { getRelativeDisposition } from '../combat/overwatch.js';

const MODULE = 'lancer-automations';
const FLAG_TELEMETRY = 'telemetry';
const SETTING_FRIENDLY_MECH_AS_SQUAD = 'tah.telemetryFriendlyMechAsSquad';

export const BUCKETS = ['players', 'hostiles', 'friendlies', 'neutrals', 'secrets'];

function friendlyMechAsSquad()
{
    try
    {
        return !!game.settings.get(MODULE, SETTING_FRIENDLY_MECH_AS_SQUAD);
    }
    catch
    {
        return true;
    }
}

const _canonical = new Map();
const _writeChains = new Map();

export function getTelemetry(combat)
{
    if (combat?.id && _canonical.has(combat.id))
        return _canonical.get(combat.id);
    return combat?.getFlag?.(MODULE, FLAG_TELEMETRY) ?? null;
}

// Writers mutate one stable per-combat object; Foundry re-clones the flag on every update, so we never persist a re-read clone.
function _writable(combat)
{
    if (!combat?.id)
        return null;
    if (!_canonical.has(combat.id))
    {
        const current = combat.getFlag?.(MODULE, FLAG_TELEMETRY);
        if (current)
            _canonical.set(combat.id, current);
    }
    return _canonical.get(combat.id) ?? null;
}

function _enqueueWrite(combat)
{
    const telemetry = combat?.id ? _canonical.get(combat.id) : null;
    if (!telemetry)
        return Promise.resolve();
    const prev = _writeChains.get(combat.id) ?? Promise.resolve();
    const next = prev.then(() => combat.setFlag(MODULE, FLAG_TELEMETRY, telemetry))
        .catch(error => console.error('lancer-automations | telemetry write failed:', error));
    _writeChains.set(combat.id, next);
    return next;
}

export function mutateTelemetry(combat, mutate)
{
    const result = mutate(_writable(combat));
    if (!result)
        return Promise.resolve();
    return _enqueueWrite(combat);
}

export function forgetCombat(combatId)
{
    _writeChains.delete(combatId);
    _canonical.delete(combatId);
}

function _debugLog(entryId, event)
{
    try
    {
        if (game.settings.get(MODULE, 'tah.telemetryDebug'))
            console.log('[Battle Log telemetry]', entryId, event);
    }
    catch
    {
        void 0;
    }
}

/**
 * Foundry disposition on the placed token, falling back to prototype.
 * @param {any} combatant
 */
function combatantDisposition(combatant)
{
    return combatant?.token?.disposition
        ?? combatant?.actor?.prototypeToken?.disposition
        ?? null;
}

/**
 * Any non-GM ownership at OWNER (3) level.
 * @param {any} actor
 */
function isPlayerOwned(actor)
{
    const ownership = actor?.ownership ?? {};
    for (const [userId, level] of Object.entries(ownership))
    {
        if (level < 3)
            continue;
        const user = game.users?.get(userId);
        if (user && !user.isGM)
            return true;
    }
    return false;
}

/**
 * Buckets (each returned string is the flag array name):
 *   - 'players'    = MECH owned by a non-GM user, plus friendly MECHs when
 *                    `tah.telemetryFriendlyMechAsSquad` is on.
 *   - 'hostiles'   = HOSTILE disposition (mech or npc).
 *   - 'friendlies' = FRIENDLY disposition, not counted as squad.
 *   - 'neutrals'   = NEUTRAL disposition (mech or npc).
 *   - 'secrets'    = SECRET disposition (mech or npc).
 *   - 'exclude'    = anything else (non-mech/npc actors, missing actor).
 * @param {any} combatant
 * @returns {'players'|'hostiles'|'friendlies'|'neutrals'|'secrets'|'exclude'}
 */
export function classifyCombatant(combatant, squadRefToken = null)
{
    const actor = combatant?.actor;
    if (!actor || (actor.type !== 'mech' && actor.type !== 'npc'))
        return 'exclude';
    if (_isSquad(combatant))
        return 'players';
    const DISPOSITIONS = CONST.TOKEN_DISPOSITIONS;
    const disp = _relativeDisposition(combatant, squadRefToken);
    if (disp === DISPOSITIONS.HOSTILE)
        return 'hostiles';
    if (disp === DISPOSITIONS.SECRET)
        return 'secrets';
    if (disp === DISPOSITIONS.FRIENDLY)
        return 'friendlies';
    if (disp === DISPOSITIONS.NEUTRAL)
        return 'neutrals';
    return 'exclude';
}

function _tokenFactionsApi()
{
    try
    {
        return game.modules?.get('token-factions')?.api ?? null;
    }
    catch
    {
        return null;
    }
}

// Reads token document, not actor, to catch per-token team assignments.
function _combatantToken(combatant)
{
    return combatant?.token?.object ?? canvas.tokens?.get(combatant?.tokenId ?? combatant?.token?.id) ?? null;
}

function _isSquad(combatant)
{
    const actor = combatant?.actor;
    if (actor?.type !== 'mech')
        return false;
    if (isPlayerOwned(actor))
        return true;
    return friendlyMechAsSquad() && combatantDisposition(combatant) === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
}

// Squad reference token: a player-owned mech, else a friendly mech (GM-only play).
function _squadRefToken(combat)
{
    const combatants = [...(combat?.combatants ?? [])];
    let ref = combatants.find(combatant => combatant.actor?.type === 'mech' && isPlayerOwned(combatant.actor));
    if (!ref)
        ref = combatants.find(combatant => combatant.actor?.type === 'mech' && combatantDisposition(combatant) === CONST.TOKEN_DISPOSITIONS.FRIENDLY);
    return ref ? _combatantToken(ref) : null;
}

// Resolves via tokens so per-token team flags are honored; own disposition as fallback.
function _relativeDisposition(combatant, squadRefToken)
{
    const tok = _combatantToken(combatant);
    if (squadRefToken && tok)
        return getRelativeDisposition(squadRefToken, tok) ?? combatantDisposition(combatant);
    return combatantDisposition(combatant);
}

function factionSide(combatant, squadRefToken)
{
    if (_isSquad(combatant))
        return 'player';
    const disp = _relativeDisposition(combatant, squadRefToken);
    return (disp === CONST.TOKEN_DISPOSITIONS.HOSTILE || disp === CONST.TOKEN_DISPOSITIONS.SECRET) ? 'enemy' : 'player';
}

// Recomputes bucket + side so faction teams and tracking order don't matter.
export function reclassifyCombat(combat)
{
    const telemetry = _writable(combat);
    if (!telemetry)
        return Promise.resolve();
    const entries = [];
    for (const name of BUCKETS)
    {
        for (const entry of telemetry[name] ?? [])
            entries.push(entry);
        telemetry[name] = [];
    }
    const squadRef = _squadRefToken(combat);
    for (const entry of entries)
    {
        const combatant = combat.combatants?.find(item => (item.tokenId ?? item.actorId) === entry.tokenId);
        const bucket = combatant ? classifyCombatant(combatant, squadRef) : 'players';
        if (bucket === 'exclude')
            continue;
        entry.side = combatant ? factionSide(combatant, squadRef) : (entry.side ?? 'player');
        telemetry[bucket].push(entry);
    }
    return _enqueueWrite(combat);
}

// Warn once if the squad spans several factions; attribution uses the first.
function warnMultiplePlayerFactions(playerCombatants)
{
    const api = _tokenFactionsApi();
    if (!api?.getFactionColor)
        return;
    const identities = new Set();
    for (const combatant of playerCombatants)
    {
        const tokenId = combatant.token?.id ?? combatant.tokenId;
        const color = tokenId ? api.getFactionColor(tokenId)?.INT_S : null;
        if (color)
            identities.add(color);
    }
    if (identities.size > 1)
        /** @type {any} */ (globalThis).ui?.notifications?.warn('Battle Log: several player factions detected; using the first as the squad.');
}

function emptyEntry(combatant)
{
    return {
        tokenId: combatant.tokenId ?? combatant.actorId,
        actorId: combatant.actorId,
        name: combatant.token?.name ?? combatant.name ?? null,
        events: [],
    };
}

export function findEntry(telemetry, entryId)
{
    for (const name of BUCKETS)
    {
        const found = telemetry[name]?.find(entry => entry.tokenId === entryId);
        if (found)
            return found;
    }
    return null;
}

function emptyTelemetry()
{
    const telemetry = { startTime: Date.now(), roundCount: 0, seq: 0 };
    for (const name of BUCKETS)
        telemetry[name] = [];
    return telemetry;
}

/**
 * Seed the telemetry flag from the initial combatant list. Idempotent.
 * @param {any} combat
 */
export function initTelemetry(combat)
{
    if (!combat || getTelemetry(combat))
        return Promise.resolve();
    const telemetry = emptyTelemetry();
    const squadRef = _squadRefToken(combat);
    const squad = [];
    for (const combatant of combat.combatants ?? [])
    {
        const bucket = classifyCombatant(combatant, squadRef);
        if (bucket === 'exclude')
            continue;
        const entry = emptyEntry(combatant);
        entry.side = factionSide(combatant, squadRef);
        telemetry[bucket].push(entry);
        if (_isSquad(combatant))
            squad.push(combatant);
    }
    warnMultiplePlayerFactions(squad);
    _canonical.set(combat.id, telemetry);
    return _enqueueWrite(combat);
}

/**
 * Track a combatant if absent; called on createCombatant for mid-combat joins.
 * @param {any} combat
 * @param {any} combatant
 */
export function ensureCombatantTracked(combat, combatant)
{
    if (!combatant?.actorId)
        return Promise.resolve();
    const telemetry = _writable(combat);
    if (!telemetry)
        return Promise.resolve();
    if (findEntry(telemetry, combatant.tokenId ?? combatant.actorId))
        return Promise.resolve();
    const squadRef = _squadRefToken(combat);
    const bucket = classifyCombatant(combatant, squadRef);
    if (bucket === 'exclude')
        return Promise.resolve();
    const entry = emptyEntry(combatant);
    entry.side = factionSide(combatant, squadRef);
    telemetry[bucket].push(entry);
    return _enqueueWrite(combat);
}

// Stamp a global seq and push, no write. For callers batching a whole tick.
export function pushEvent(telemetry, entry, event)
{
    telemetry.seq = (telemetry.seq ?? 0) + 1;
    event.seq = telemetry.seq;
    entry.events.push(event);
}

/**
 * Push an event into the entry's log and persist. No-op if the token isn't tracked.
 * @param {any} combat
 * @param {string} entryId
 * @param {any} event
 */
export function appendEvent(combat, entryId, event)
{
    const telemetry = _writable(combat);
    if (!telemetry)
        return Promise.resolve();
    const entry = findEntry(telemetry, entryId);
    if (!entry)
        return Promise.resolve();
    pushEvent(telemetry, entry, event);
    _debugLog(entryId, event);
    return _enqueueWrite(combat);
}

export function appendEventComputed(combat, entryId, build)
{
    const telemetry = _writable(combat);
    if (!telemetry)
        return Promise.resolve();
    const entry = findEntry(telemetry, entryId);
    if (!entry)
        return Promise.resolve();
    const event = build(telemetry, entry);
    if (!event)
        return Promise.resolve();
    pushEvent(telemetry, entry, event);
    _debugLog(entryId, event);
    return _enqueueWrite(combat);
}

/**
 * Bump the recorded round count. Called when combat.round advances.
 * @param {any} combat
 * @param {number} round
 */
export function setRoundCount(combat, round)
{
    const telemetry = _writable(combat);
    if (!telemetry || round <= telemetry.roundCount)
        return Promise.resolve();
    telemetry.roundCount = round;
    return _enqueueWrite(combat);
}
