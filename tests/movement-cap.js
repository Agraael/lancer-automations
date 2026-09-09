/**
 * Movement Cap / Boost Offer Test Suite
 * Setup: select 6 tokens (mechs or Overcharge-capable NPCs) on an empty scene area,
 * each with free straight-line space to the EAST of at least 4x its speed. Combat is
 * created automatically. Settings are saved and restored around the run.
 * Run via:  api.tests.movementCap.runAll()
 * One mode only:  api.tests.movementCap.runPhase(false)  /  runPhase(true)
 */

import { moveTokenTo, awaitMovementSettled } from "../scripts/movement/move-api.js";
import { _transformFoundPath } from "../scripts/movement/terrain-trigger-waypoints.js";
import { getMovementHistory, getMovementCap, clearMoveData, initMovementCap, _isActiveMoveStackFor } from "../scripts/movement/move-tracking.js";

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function pass(name)
{
    console.log(`%c✅ PASS: ${name}`, 'color:limegreen; font-weight:bold;');
}

function fail(name, reason)
{
    console.error(`❌ FAIL: ${name} — ${reason}`);
}

function assert(condition, name, reason)
{
    if (condition)
        pass(name);
    else
        fail(name, reason);
}

function speedOf(token)
{
    return Number(token.actor?.system?.speed) || 0;
}

function castsOf(token)
{
    return token.document.getFlag('lancer-automations', 'moveHistory')?.boostCasts?.length ?? 0;
}

function spentOf(token)
{
    const history = getMovementHistory(token);
    return history.exists ? history.intentional.regularCost : 0;
}

function spacesMoved(token, startX)
{
    return Math.round((token.document.x - startX) / canvas.grid.size);
}

function assertHistoryCoherent(token, label, expectedCost)
{
    const data = token.document.getFlag('lancer-automations', 'moveHistory') ?? {};
    const moves = data.moves ?? [];
    const total = moves.reduce((acc, move) => acc + (move.movementCost ?? 0), 0);
    assert(total === expectedCost, `${label}: history cost ${expectedCost}`, `got ${total} over ${moves.length} moves`);
    let contiguous = true;
    for (let idx = 1; idx < moves.length; idx++)
    {
        const prev = moves[idx - 1];
        const expectedX = Math.round((prev.startPos?.x ?? 0) + prev.distanceMoved * canvas.grid.size);
        if (Math.abs(expectedX - Math.round(moves[idx].startPos?.x ?? 0)) > 1)
            contiguous = false;
    }
    assert(contiguous, `${label}: history contiguous`, JSON.stringify(moves.map(move => ({ x: Math.round(move.startPos?.x ?? 0), cost: move.movementCost }))));
    assert(moves.every(move => move.isDrag && !move.isFreeMovement), `${label}: history all drag`, 'free/involuntary entry found');
}

function visibleCard()
{
    return $('.la-info-card:visible').length > 0;
}

function clickCardChoice(index)
{
    $(`.la-info-card:visible .la-choice-item[data-choice-index="${index}"]`).first().trigger('click');
}

async function ensureCombat(tokens)
{
    let combat = game.combat;
    if (!combat)
        combat = await Combat.create({ scene: canvas.scene.id, active: true });
    const missing = tokens.filter(token => !combat.combatants.find(combatant => combatant.token?.id === token.id));
    if (missing.length)
        await combat.createEmbeddedDocuments('Combatant', missing.map(token => ({ tokenId: token.id, sceneId: canvas.scene.id, actorId: token.actor?.id })));
    if (!combat.started)
        await combat.startCombat();
    return combat;
}

async function resetToken(token)
{
    clearMoveData(token);
    initMovementCap(token);
    await delay(150);
}

// Chains have card delays, activation flows and per-leg animations: idle = settled + no card + position stable.
async function awaitIdle(token, { timeoutMs = 30000, stableMs = 2500 } = {})
{
    const start = Date.now();
    let lastX = token.document.x;
    let lastY = token.document.y;
    let stableSince = Date.now();
    while (Date.now() - start < timeoutMs)
    {
        await delay(250);
        await awaitMovementSettled(token.document);
        const moved = token.document.x !== lastX || token.document.y !== lastY;
        if (moved || visibleCard() || token.document.movement?.state === 'pending' || _isActiveMoveStackFor(token.id))
        {
            lastX = token.document.x;
            lastY = token.document.y;
            stableSince = Date.now();
            continue;
        }
        if (Date.now() - stableSince >= stableMs)
            return true;
    }
    return false;
}

// With tier split on, the path goes through the drag planner's transform so it commits per tier like a real drag.
function dragEast(token, spaces)
{
    const doc = token.document;
    const dest = { x: doc.x + spaces * canvas.grid.size, y: doc.y, elevation: doc.elevation };
    let waypoints = dest;
    if (game.settings.get('lancer-automations', 'splitMovementAtSpeedTiers'))
    {
        const src = doc._source;
        const shapeFields = { width: src.width, height: src.height, shape: src.shape };
        const origin = { x: doc.x, y: doc.y, elevation: doc.elevation, ...shapeFields };
        const destWp = { ...dest, ...shapeFields, snapped: true, explicit: true, checkpoint: true };
        const transformed = _transformFoundPath(token, [origin, destWp]);
        if (Array.isArray(transformed) && transformed.length > 1)
            waypoints = transformed.slice(1);
    }
    return moveTokenTo(token, waypoints, { isDrag: true, useRuler: true });
}

// Waits for a card, clicks a choice, or fails after timeout.
async function clickWhenCardShows(index, name, timeoutMs = 15000)
{
    const start = Date.now();
    while (Date.now() - start < timeoutMs)
    {
        await delay(250);
        if (visibleCard())
        {
            await delay(300);
            clickCardChoice(index);
            return true;
        }
    }
    fail(name, 'expected a card, none appeared');
    return false;
}

async function scenarioInCap(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    dragEast(token, speed);
    await awaitIdle(token);
    assert(spacesMoved(token, startX) === speed, `${label}: walked ${speed}`, `moved ${spacesMoved(token, startX)}`);
    assert(castsOf(token) === 0, `${label}: no boost cast`, `casts ${castsOf(token)}`);
    assertHistoryCoherent(token, label, speed);
}

async function scenarioBoost(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    dragEast(token, speed * 2);
    await awaitIdle(token);
    assert(castsOf(token) === 1, `${label}: one boost cast`, `casts ${castsOf(token)}`);
    assert(spacesMoved(token, startX) === speed * 2, `${label}: walked ${speed * 2}`, `moved ${spacesMoved(token, startX)}`);
    assert(getMovementCap(token) === speed * 2, `${label}: cap ${speed * 2}`, `cap ${getMovementCap(token)}`);
    assertHistoryCoherent(token, label, speed * 2);
}

async function scenarioOvercharge(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    dragEast(token, speed * 3);
    await awaitIdle(token);
    assert(castsOf(token) === 2, `${label}: two boost casts`, `casts ${castsOf(token)}`);
    assert(spacesMoved(token, startX) === speed * 3, `${label}: walked ${speed * 3}`, `moved ${spacesMoved(token, startX)}`);
    assertHistoryCoherent(token, label, speed * 3);
}

async function scenarioBeyond(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    dragEast(token, speed * 3 + 2);
    const clickedStop = await clickWhenCardShows(0, `${label}: cancel card`);
    await awaitIdle(token);
    if (clickedStop)
        pass(`${label}: cancel card appeared, Stop clicked`);
    assert(spacesMoved(token, startX) <= speed * 3, `${label}: excess not walked`, `moved ${spacesMoved(token, startX)}`);
    assertHistoryCoherent(token, label, spacesMoved(token, startX));
}

function dumpMoves(token, label)
{
    const data = token.document.getFlag('lancer-automations', 'moveHistory') ?? {};
    const rows = (data.moves ?? []).map(move => ({
        movementId: move.movementId ?? '',
        cost: move.movementCost,
        dist: move.distanceMoved,
        fromX: Math.round(move.startPos?.x ?? 0),
        drag: !!move.isDrag,
        free: !!move.isFreeMovement,
    }));
    console.log(`${label}: casts ${data.boostCasts?.length ?? 0}, cap ${getMovementCap(token)}, spent ${spentOf(token)}, moveState ${token.document.movement?.state}`);
    console.table(rows);
}

async function scenarioSecondDrag(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    dragEast(token, speed + 2);
    await awaitIdle(token);
    assert(castsOf(token) === 1, `${label}: first drag boosted`, `casts ${castsOf(token)} spent ${spentOf(token)}`);
    dragEast(token, speed);
    await awaitIdle(token);
    assert(castsOf(token) === 2, `${label}: second drag overcharged`, `casts ${castsOf(token)} spent ${spentOf(token)}`);
    const walkedAll = spacesMoved(token, startX) === speed * 2 + 2;
    assert(walkedAll, `${label}: walked ${speed * 2 + 2}`, `moved ${spacesMoved(token, startX)}`);
    if (!walkedAll)
        dumpMoves(token, label);
    assertHistoryCoherent(token, label, speed * 2 + 2);
}

async function scenarioIgnore(token, label)
{
    const speed = speedOf(token);
    const startX = token.document.x;
    await game.settings.set('lancer-automations', 'enableBoostOffer', 'yes');
    try
    {
        dragEast(token, speed * 2);
        await clickWhenCardShows(1, `${label}: offer card`);
        await awaitIdle(token);
        assert(castsOf(token) === 0, `${label}: no cast on Ignore`, `casts ${castsOf(token)}`);
        assert(spacesMoved(token, startX) === speed * 2, `${label}: walked anyway`, `moved ${spacesMoved(token, startX)}`);
        assertHistoryCoherent(token, label, speed * 2);
    }
    finally
    {
        await game.settings.set('lancer-automations', 'enableBoostOffer', 'auto');
    }
}

const SCENARIOS = [scenarioInCap, scenarioBoost, scenarioOvercharge, scenarioBeyond, scenarioSecondDrag, scenarioIgnore];

async function runPhase(tierSplit, tokenOffset = 0)
{
    const label = tierSplit ? 'splitON' : 'splitOFF';
    console.log(`%c── Phase ${label} ──`, 'color:cyan; font-weight:bold;');
    const tokens = canvas.tokens.controlled.slice(tokenOffset, tokenOffset + SCENARIOS.length);
    if (tokens.length < SCENARIOS.length)
    {
        fail(label, `select ${SCENARIOS.length} tokens (got ${tokens.length})`);
        return;
    }
    await ensureCombat(tokens);
    await game.settings.set('lancer-automations', 'splitMovementAtSpeedTiers', tierSplit);
    for (let idx = 0; idx < SCENARIOS.length; idx++)
    {
        const token = tokens[idx];
        await resetToken(token);
        if (speedOf(token) < 3)
        {
            fail(`${label}/${SCENARIOS[idx].name}`, `token ${token.name} speed < 3`);
            continue;
        }
        await SCENARIOS[idx](token, `${label}/${SCENARIOS[idx].name}`);
        await delay(500);
    }
}

async function runAll()
{
    const saved = {
        capDetect: game.settings.get('lancer-automations', 'enableMovementCapDetection'),
        boostOffer: game.settings.get('lancer-automations', 'enableBoostOffer'),
        tierSplit: game.settings.get('lancer-automations', 'splitMovementAtSpeedTiers'),
    };
    console.log('%c── Movement Cap Test Suite ──', 'color:gold; font-weight:bold;');
    try
    {
        await game.settings.set('lancer-automations', 'enableMovementCapDetection', true);
        await game.settings.set('lancer-automations', 'enableBoostOffer', 'auto');
        const freshSecondPhase = canvas.tokens.controlled.length >= SCENARIOS.length * 2;
        await runPhase(false, 0);
        await runPhase(true, freshSecondPhase ? SCENARIOS.length : 0);
    }
    finally
    {
        await game.settings.set('lancer-automations', 'enableMovementCapDetection', saved.capDetect);
        await game.settings.set('lancer-automations', 'enableBoostOffer', saved.boostOffer);
        await game.settings.set('lancer-automations', 'splitMovementAtSpeedTiers', saved.tierSplit);
    }
    console.log('%c── Movement Cap Test Suite complete ──', 'color:gold; font-weight:bold;');
}

export const MovementCapTests = { runAll, runPhase };
