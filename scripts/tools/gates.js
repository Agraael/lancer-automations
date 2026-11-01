import { currentTurnKey, activationsUsed } from "../bonuses/duration-builders.js";
import { MODULE_ID } from "./constants.js";

const GATE_FLAG = 'gates';

function _gateActor(owner)
{
    return /** @type {any} */ (owner)?.actor ?? owner;
}

function _gateSubject(subject)
{
    return String(typeof subject === 'string' ? subject : (subject?.id ?? '_self')).replace(/\./g, '_');
}

// Dots in a flag key are path separators for expandObject, so a uuid-derived key would nest itself away.
function _gateKey(key)
{
    return String(key).replace(/\./g, '_');
}

// Combatant id rather than turn index, Lancer turn order is not fixed.
function _turnStamp()
{
    return game.combat?.round ? currentTurnKey() : null;
}

function _ownTurnStamp(actor)
{
    const combat = game.combat;
    const combatant = actor ? combat?.combatants.find(entry => entry.actor?.uuid === actor.uuid) : null;
    return combatant ? { r: combat.round, u: activationsUsed(combatant) } : null;
}

// A gate from another combat is dead.
function _gateBlocked(entry, actor)
{
    if (!entry || entry.c !== game.combat?.id)
        return false;
    if (entry.t != null)
        return entry.t === _turnStamp();
    if (entry.o)
    {
        const now = _ownTurnStamp(actor);
        if (!now)
            return (game.combat?.round ?? 0) <= entry.o.r;
        return now.r === entry.o.r ? now.u <= entry.o.u : now.r === entry.o.r + 1 && now.u === 0;
    }
    return entry.r === null || (game.combat?.round ?? 0) <= entry.r;
}

/**
 * True when the gate is free and `consumeGate` would succeed. Never writes.
 * @param {Token|Actor|any} owner
 * @param {string} key
 * @param {Token|Actor|string|null} [subject] - String or token. Omit for a single gate on the owner.
 * @returns {boolean}
 */
export function checkGate(owner, key, subject = null)
{
    const actor = _gateActor(owner);
    if (!actor || !key)
        return true;
    const api = game.modules.get(MODULE_ID)?.api;
    const gates = api?.getActorFlags(actor, GATE_FLAG) || {};
    return !_gateBlocked(gates[_gateKey(key)]?.[_gateSubject(subject)], actor);
}

/**
 * Take a gate. Expiry is checked on read, nothing ticks. Out of combat every call succeeds.
 * @param {Token|Actor|any} owner
 * @param {string} key - Name of the gate, e.g. `'ring_of_fire'`.
 * @param {Object} [options]
 * @param {Token|Actor|string|null} [options.subject] - String or token. Omit for a single gate on the owner.
 * @param {number|null} [options.rounds=1] - Rounds blocked counting the current one, null lasts the whole combat.
 * @param {boolean} [options.turn] - Block for the current turn instead of a round count.
 * @param {boolean} [options.ownTurn] - Block until the owner's next turn starts instead of a round count.
 * @returns {Promise<boolean>} true when the gate was free and is now taken
 */
export async function consumeGate(owner, key, options = {})
{
    const actor = _gateActor(owner);
    if (!actor || !key)
        return true;
    const api = game.modules.get(MODULE_ID)?.api;
    const gates = api.getActorFlags(actor, GATE_FLAG) || {};
    const gateKey = _gateKey(key);
    const subjectId = _gateSubject(options.subject);
    if (_gateBlocked(gates[gateKey]?.[subjectId], actor))
        return false;

    const combat = game.combat;
    if (!combat?.round)
        return true;
    const ownTurn = options.ownTurn ? _ownTurnStamp(actor) : null;
    const entry = options.turn
        ? { c: combat.id, t: _turnStamp() }
        : (ownTurn
            ? { c: combat.id, o: ownTurn }
            : { c: combat.id, r: options.rounds === null ? null : combat.round + Math.max(1, options.rounds ?? 1) - 1 });
    await api.addActorFlags(actor, { [GATE_FLAG]: { [gateKey]: { [subjectId]: entry } } });
    return true;
}

/**
 * Release a gate. Omit `subject` to release the whole key.
 * @param {Token|Actor|any} owner
 * @param {string} key
 * @param {Token|Actor|string|null} [subject]
 * @returns {Promise<void>}
 */
export async function clearGate(owner, key, subject = null)
{
    const actor = _gateActor(owner);
    if (!actor || !key)
        return;
    const api = game.modules.get(MODULE_ID)?.api;
    // setFlag merges, so null the entries instead of deleting them
    const value = subject === null ? null : { [_gateSubject(subject)]: null };
    await api.addActorFlags(actor, { [GATE_FLAG]: { [_gateKey(key)]: value } });
}

/**
 * Once-per-round gate stored on `owner`, counted separately per `subject`.
 * Out of combat every call is the first one.
 * @param {Token|Actor} owner - Holds the flag, usually the reactor.
 * @param {string} key - Name of the gate, e.g. `'ring_of_fire'`.
 * @param {Token|Actor|string} [subject] - Who is being gated. Omit for a single gate on the owner.
 * @returns {Promise<boolean>} true the first time until the owner's next turn starts, false afterwards
 */
export function consumeOncePerRound(owner, key, subject = null)
{
    return consumeGate(owner, key, { subject, ownTurn: true });
}

/**
 * Once-per-turn gate, free again when the turn changes.
 * @param {Token|Actor} owner
 * @param {string} key
 * @param {Token|Actor|string} [subject]
 * @returns {Promise<boolean>} true the first time this turn, false afterwards
 */
export function consumeOncePerTurn(owner, key, subject = null)
{
    return consumeGate(owner, key, { subject, turn: true });
}
