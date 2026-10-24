// permanent/indefinite skip turns; otherwise adjust for whether it's origin's current turn.
export function buildDuration(durationLabel, originID, turnsInput)
{
    if (durationLabel === 'permanent')
        return { label: 'permanent', turns: null, rounds: null };
    if (durationLabel === 'indefinite')
        return { label: 'indefinite', turns: null, rounds: null };
    if (durationLabel === 'encounter')
        return { label: 'encounter', turns: null, rounds: null };
    if (durationLabel === 'roundEnd' || durationLabel === 'roundStart')
        return { label: durationLabel, turns: null, rounds: Math.max(1, Number(turnsInput) || 1) };
    const isOriginTurn = game.combat?.current?.tokenId === originID;
    const turns = (durationLabel === 'end' && isOriginTurn) ? turnsInput + 1 : (turnsInput === 0 ? 1 : turnsInput);
    return { label: durationLabel, turns, rounds: 0, _preAdjusted: true };
}

/**
 * Duration ending at the end of a token's own turn, N turns out. Handles the +1 when it is
 * already that token's turn, and stamps the token as the turn origin.
 * @param {any} token
 * @param {number} [turns=1]
 * @returns {object}
 */
export function untilEndOfTurn(token, turns = 1)
{
    const id = token?.id ?? token;
    return { ...buildDuration('end', id, turns), overrideTurnOriginId: id };
}

/**
 * Same, ending at the start of the token's turn.
 * @param {any} token
 * @param {number} [turns=1]
 * @returns {object}
 */
export function untilStartOfTurn(token, turns = 1)
{
    const id = token?.id ?? token;
    return { ...buildDuration('start', id, turns), overrideTurnOriginId: id };
}

export function untilEndOfRound(rounds = 1)
{
    return buildDuration('roundEnd', null, rounds);
}

export function untilStartOfRound(rounds = 1)
{
    return buildDuration('roundStart', null, rounds);
}

export function untilEndOfEncounter()
{
    return buildDuration('encounter', null, 0);
}

/**
 * Stable key for the current combat turn, null out of combat.
 * Use it to tell "the turn this happened on" from any later turn.
 * @returns {string|null}
 */
export function currentTurnKey()
{
    const combat = game.combat;
    if (!combat)
        return null;
    const combatant = /** @type {any} */ (combat.combatant);
    const activations = combatant?.activations ?? combatant?.system?.activations;
    const used = activations ? Math.max(0, (Number(activations.max) || 0) - (Number(activations.value) || 0)) : 0;
    return `${combat.id}:${combat.round}:${combatant?.id ?? combat.turn ?? 'none'}:${used}`;
}
