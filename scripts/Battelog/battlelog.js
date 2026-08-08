/* global Hooks, game, console */

import { mockCombatTelemetry } from './combat-telemetry-mock.js';
import { deriveDisplayBattle } from './combat-telemetry-derive.js';
import { openBattleLogGMCard } from './gm-card.js';
import { openBattleLogRecap } from './recap.js';
import { registerCombatRecorder, consumeCombatTelemetry } from './combat-recorder.js';
import { registerDamageCapture } from './damage-capture.js';
import { registerAttackCapture } from './attack-capture.js';
import { registerStateCapture } from './state-capture.js';
import { registerActionCapture } from './action-capture.js';
import { registerMoveCapture } from './move-capture.js';
import { getModuleSetting } from "../tools/settings-utils.js";

registerCombatRecorder();
registerDamageCapture();
registerAttackCapture();
registerStateCapture();
registerActionCapture();
registerMoveCapture();

function _mockAndLog()
{
    const telemetry = mockCombatTelemetry();
    console.log('[Battle Log] CombatTelemetry:', telemetry);
    const battle = deriveDisplayBattle(telemetry);
    console.log('[Battle Log] Derived display battle:', battle);
    return battle;
}

export function openBattleLogGMCardTest()
{
    openBattleLogGMCard(_mockAndLog());
}

export function openBattleLogRecapTest()
{
    const battle = _mockAndLog();
    openBattleLogRecap(battle, { outcome: battle.mission.outcome, mvpId: battle.mvpId ?? null });
}

function _battleLogEnabled()
{
    return getModuleSetting('battleLogEnabled');
}

Hooks.on('deleteCombat', (combat) =>
{
    if (!game.user?.isGM)
        return;
    if (!_battleLogEnabled())
        return;
    const telemetry = consumeCombatTelemetry(combat.id);
    if (!telemetry)
        return;
    if ((telemetry.players?.length ?? 0) === 0 && (telemetry.hostiles?.length ?? 0) === 0)
        return;
    console.log('[Battle Log] Real combat telemetry:', telemetry);
    const battle = deriveDisplayBattle(telemetry);
    console.log('[Battle Log] Derived battle:', battle);
    openBattleLogGMCard(battle);
});
