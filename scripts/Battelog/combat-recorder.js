/* global Hooks, game */

// Foundry combat lifecycle wiring for Battle Log telemetry.
// Only the GM writes; each hook is a no-op for player clients.

import {
    initTelemetry,
    ensureCombatantTracked,
    getTelemetry,
    reclassifyCombat,
    mutateTelemetry,
    forgetCombat,
} from './telemetry-store.js';
import { reconcileCombatant, forgetCombatState } from './state-capture.js';
import { getModuleSetting } from "../tools/settings-utils.js";

// Tick every tracked combatant into a telemetry object (in place). Returns it.
function _tickInto(telemetry, combat, round)
{
    for (const combatant of combat.combatants ?? [])
        reconcileCombatant(telemetry, combatant, round);
    if (round > (telemetry.roundCount ?? 0))
        telemetry.roundCount = round;
    return telemetry;
}

// Snapshot the telemetry right before Foundry deletes the combat. The flag is
// about to die; setFlag mid-delete is racy, so we ticket in-memory instead and
// hand it off via consumeCombatTelemetry() to whoever opens the GM card.
const snapshotByCombatId = new Map();

/** Pop the snapshot for the given combat id. Returns null if none. */
export function consumeCombatTelemetry(combatId)
{
    const telemetry = snapshotByCombatId.get(combatId);
    if (!telemetry)
        return null;
    snapshotByCombatId.delete(combatId);
    return telemetry;
}

function _battleLogEnabled()
{
    return getModuleSetting('battleLogEnabled');
}

export function registerCombatRecorder()
{
    Hooks.on('createCombat', async (combat) =>
    {
        if (!game.user?.isGM)
            return;
        if (!_battleLogEnabled())
            return;
        await initTelemetry(combat);
    });

    Hooks.on('combatStart', async (combat) =>
    {
        if (!game.user?.isGM)
            return;
        await reclassifyCombat(combat);
        await mutateTelemetry(combat, (telemetry) =>
        {
            if (!telemetry)
                return null;
            for (const combatant of combat.combatants ?? [])
                reconcileCombatant(telemetry, combatant, 0);
            return telemetry;
        });
    });

    Hooks.on('createCombatant', async (combatant) =>
    {
        if (!game.user?.isGM)
            return;
        const combat = combatant?.combat ?? combatant?.parent;
        if (!combat)
            return;
        await ensureCombatantTracked(combat, combatant);
    });

    // Tick at every turn and round advance.
    Hooks.on('updateCombat', async (combat, delta) =>
    {
        if (!game.user?.isGM)
            return;
        if (delta.round == null && delta.turn == null)
            return;
        await mutateTelemetry(combat, (telemetry) =>
            telemetry ? _tickInto(telemetry, combat, combat.round ?? 0) : null);
    });

    // End-of-combat: final tick mutates telemetry in memory (setFlag is racy
    // mid-delete), then stash for the delete consumer.
    Hooks.on('preDeleteCombat', (combat) =>
    {
        if (!game.user?.isGM)
            return;
        const round = combat.round ?? 0;
        const telemetry = getTelemetry(combat);
        if (!telemetry)
            return;
        if (round >= 1)
            _tickInto(telemetry, combat, round);
        telemetry.endTime = Date.now();
        snapshotByCombatId.set(combat.id, telemetry);
        forgetCombat(combat.id);
        forgetCombatState(combat.id);
    });
}
