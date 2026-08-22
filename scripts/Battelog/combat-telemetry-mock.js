/* global game */

// Simulates a plausible Lancer combat and emits a CombatTelemetry event stream.
// Sole source of invented data; the recap aggregates everything from the events.

import { DOT_TYPES, SAVE_KINDS } from './combat-telemetry.js';

const WEAPONS = [
    { name: 'SIEGE CANNON',    dtype: 'explosive', dice: [4, 8], reach: 'ranged' },
    { name: 'CHAIN AXE',       dtype: 'kinetic',   dice: [3, 6], reach: 'melee'  },
    { name: 'FLAK CANNON',     dtype: 'kinetic',   dice: [3, 5], reach: 'ranged' },
    { name: 'THERMAL LANCE',   dtype: 'energy',    dice: [4, 7], reach: 'ranged' },
    { name: 'AUX PISTOL',      dtype: 'kinetic',   dice: [1, 3], reach: 'ranged' },
    { name: 'HEAT GUN',        dtype: 'heat',      dice: [2, 4], reach: 'ranged' },
    { name: 'FLAME PROJECTOR', dtype: 'burn',      dice: [2, 3], reach: 'ranged' },
];
// Names sourced from token-action-hud-lancer's action registry.
const TECH_ACTS      = ['INVADE', 'FRAG SIGNAL'];
const TECH_UTILITIES = ['LOCK ON', 'SCAN', 'BOLSTER'];
const QUICK_ACTIONS  = ['HIDE', 'SEARCH', 'INTERACT', 'AID', 'HANDLE', 'RAM', 'GRAPPLE', 'BOOTUP', 'EJECT'];
const REACTIONS      = ['OVERWATCH', 'BRACE'];
const UTILITY_ACTS   = ['STABILIZE', 'DISENGAGE', 'MOUNT', 'PROTOCOL', 'STABILIZE', 'CORE POWER', 'SQUEEZE', 'BOOST'];

const PLAYER_HIT_CHANCE  = 0.75;
const HOSTILE_HIT_CHANCE = 0.55;
const CRIT_CHANCE = 0.1;
const DOT_APPLY_CHANCE = 0.35;
const DOT_MAX = 4;

// Fake floors so a bare or misconfigured actor still yields a plausible fight.
const PLAYER_HP_FLOOR  = 20;
const PLAYER_HEAT_FLOOR = 6;
const HOSTILE_HP_FLOOR = 10;
const HOSTILE_HEAT_FLOOR = 5;

const _rand   = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
const _pick   = arr => arr[Math.floor(Math.random() * arr.length)];
const _chance = p => Math.random() < p;

function pickRandom(arr, count)
{
    const pool = [...arr];
    const out = [];
    while (out.length < count && pool.length > 0)
        out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    return out;
}

function freshState(actor, hpFloor, heatFloor, structMax = 4, stressMax = 4, side = 'hostile')
{
    const sys = actor?.system ?? {};
    const hpMax = Math.max(hpFloor, Number(sys.hp?.max) || 0);
    return {
        side,                         // 'player' → cannot die naturally; 'hostile' → normal cascade
        hp: hpMax,
        hpMax,
        structMax: Math.max(1, Number(sys.structure?.max) || structMax),
        struct: Math.max(1, Number(sys.structure?.max) || structMax),
        stressMax: Math.max(1, Number(sys.stress?.max) || stressMax),
        stress: Math.max(1, Number(sys.stress?.max) || stressMax),
        heat: 0,
        heatMax: Math.max(heatFloor, Number(sys.heat?.max) || 0),
        armor: Number(sys.armor) || 0,
        overshield: 0,
        destroyed: false,
        dot: { burn: 0, infection: 0 },
        dotSource: { burn: null, infection: null },
    };
}

let _turn = null;

function pushEvent(log, event)
{
    if (_turn != null && event.round >= 1 && event.turn === undefined)
        event.turn = _turn;
    log.events.push(event);
}

function statTick(entry, round, state)
{
    pushEvent(entry, {
        type: 'stat-tick',
        round,
        tokenId: entry.tokenId,
        hp: state.hp,
        heat: state.heat,
        structure: state.struct,
        stress: state.stress,
        burn: state.dot?.burn ?? 0,
        infection: state.dot?.infection ?? 0,
        overshield: state.overshield ?? 0,
        repairs: 0,
    });
}

// Order: overshield first, then armor, then HP.
function absorbDamage(state, damageType, raw)
{
    let remaining = raw;
    let absorbedOvershield = 0;
    if (state.overshield > 0 && remaining > 0)
    {
        const eaten = Math.min(state.overshield, remaining);
        state.overshield -= eaten;
        remaining -= eaten;
        absorbedOvershield = eaten;
    }
    let absorbedArmor = 0;
    // Armor only bites once per instance and doesn't apply to heat/burn/infection.
    const bypassArmor = damageType === 'heat' || damageType === 'burn' || damageType === 'infection';
    if (!bypassArmor && state.armor > 0 && remaining > 0)
    {
        absorbedArmor = Math.min(state.armor, remaining);
        remaining -= absorbedArmor;
    }
    return { landed: Math.max(0, remaining), absorbedArmor, absorbedOvershield };
}

// Lancer rule: hp ≤ 0 and structure > 0 → structure damage. Overkill carries
// into the next pool: hp becomes (hp + hpMax). Structure at 0 = destroyed.
function applyHpDamage(round, combatant, state, landed)
{
    if (landed <= 0)
        return false;
    state.hp -= landed;
    if (state.hp > 0 || state.destroyed || state.struct <= 0)
        return false;
    // Mock cheat: reserve exactly one force-destroyed mech for post-sim. Players
    // at their last structure refill without losing it and without dying.
    if (state.side === 'player' && state.struct === 1)
    {
        state.hp += state.hpMax;
        return false;
    }
    state.struct -= 1;
    pushEvent(combatant, { type: 'structure-loss', round, tokenId: combatant.tokenId });
    state.hp += state.hpMax;
    if (state.struct === 0)
    {
        state.destroyed = true;
        return true;
    }
    return false;
}

function weaponAttack(round, actor, actorState, target, targetState, hitChance)
{
    const weapon = _pick(WEAPONS);
    // Roughly 15 % of weapon attacks are "smart" and target e-def.
    const defense = _chance(0.15) ? 'edef' : 'evasion';
    const hit = Math.random() < hitChance;
    const crit = hit && Math.random() < CRIT_CHANCE;
    const attackType = weapon.reach === 'melee' ? 'Melee' : 'Ranged';
    const targetEntry = { targetId: target.tokenId, hit, defense };
    if (crit)
        targetEntry.crit = true;
    pushEvent(actor, {
        type: 'attack',
        round,
        byId: actor.tokenId,
        category: 'weapon',
        weaponName: weapon.name,
        attackType,
        targets: [targetEntry],
    });
    if (!hit)
        return;
    const rawAmount = _rand(weapon.dice[0], weapon.dice[1]) * (crit ? 2 : 1);
    const { landed, absorbedArmor, absorbedOvershield } = absorbDamage(targetState, weapon.dtype, rawAmount);
    pushEvent(actor, {
        type: 'damage',
        round,
        byId: actor.tokenId,
        targetId: target.tokenId,
        damages: [{ type: weapon.dtype, amount: rawAmount }],
        hpLanded: landed,
        overshieldAbsorbed: absorbedOvershield,
        armorAbsorbed: absorbedArmor,
    });
    const destroyed = applyHpDamage(round, target, targetState, landed);
    if (weapon.dtype === 'burn' && _chance(DOT_APPLY_CHANCE) && !targetState.destroyed)
    {
        targetState.dot.burn = Math.min(DOT_MAX, targetState.dot.burn + _rand(2, 3));
        targetState.dotSource.burn = actor.tokenId;
    }
    if (destroyed)
    {
        pushEvent(target, { type: 'destroyed', round, tokenId: target.tokenId });
        return true;
    }
    return false;
}

function techAction(round, actor, actorState, target, targetState)
{
    if (_chance(0.4))
    {
        pushEvent(actor, { type: 'action', round, byId: actor.tokenId, activation: 'Quick Tech', name: _pick(TECH_UTILITIES), success: true });
        return;
    }
    const name = _pick(TECH_ACTS);
    const success = _chance(0.7);
    const targetEntry = { targetId: target.tokenId, hit: success, defense: 'edef' };
    pushEvent(actor, {
        type: 'attack',
        round,
        byId: actor.tokenId,
        category: 'tech',
        weaponName: name,
        attackType: 'Tech',
        targets: [targetEntry],
    });
    // INVADE occasionally applies infection; other tech has no damage.
    if (success && name === 'INVADE' && _chance(0.5))
    {
        const raw = _rand(2, 4);
        const { landed, absorbedArmor, absorbedOvershield } = absorbDamage(targetState, 'infection', raw);
        pushEvent(actor, {
            type: 'damage',
            round,
            byId: actor.tokenId,
            targetId: target.tokenId,
            damages: [{ type: 'infection', amount: raw }],
            hpLanded: landed,
            overshieldAbsorbed: absorbedOvershield,
            armorAbsorbed: absorbedArmor,
        });
        targetState.dot.infection = Math.min(DOT_MAX, targetState.dot.infection + _rand(1, 2));
        targetState.dotSource.infection = actor.tokenId;
        applyHpDamage(round, target, targetState, landed);
    }
    if (targetState.destroyed)
    {
        pushEvent(target, { type: 'destroyed', round, tokenId: target.tokenId });
        return true;
    }
    return false;
}

function quickAction(round, actor)
{
    pushEvent(actor, {
        type: 'action',
        round,
        byId: actor.tokenId,
        activation: 'Quick',
        name: _pick(QUICK_ACTIONS),
        success: _chance(0.8),
    });
}

function reactionAction(round, actor)
{
    pushEvent(actor, {
        type: 'action',
        round,
        byId: actor.tokenId,
        activation: 'Reaction',
        name: _pick(REACTIONS),
        success: true,
    });
}

function utilityAction(round, actor, actorState)
{
    const name = _pick(UTILITY_ACTS);
    // Self-repair heals a bit; count it as a state change but not an incoming damage event.
    if (name === 'SELF REPAIR')
        actorState.hp = Math.min(actorState.hpMax, actorState.hp + _rand(2, 4));
    pushEvent(actor, {
        type: 'action',
        round,
        byId: actor.tokenId,
        activation: 'Quick',
        name,
        success: true,
    });
}

function saveAction(round, actor)
{
    pushEvent(actor, {
        type: 'action',
        round,
        byId: actor.tokenId,
        category: 'save',
        name: _pick(SAVE_KINDS),
        success: _chance(0.65),
    });
}

function moveAction(round, actor)
{
    pushEvent(actor, {
        type: 'move',
        round,
        byId: actor.tokenId,
        distance: _rand(2, 6),
        knockback: false,
    });
}

function dotTicks(round, target, targetState)
{
    let destroyedThisRound = false;
    for (const dtype of DOT_TYPES)
    {
        const amount = targetState.dot[dtype];
        if (amount <= 0 || targetState.destroyed)
            continue;
        const sourceId = targetState.dotSource[dtype] ?? target.tokenId;
        const { landed, absorbedArmor, absorbedOvershield } = absorbDamage(targetState, dtype, amount);
        pushEvent(target, {
            type: 'damage',
            round,
            byId: sourceId,
            targetId: target.tokenId,
            damages: [{ type: dtype, amount }],
            hpLanded: landed,
            overshieldAbsorbed: absorbedOvershield,
            armorAbsorbed: absorbedArmor,
        });
        const destroyed = applyHpDamage(round, target, targetState, landed);
        if (destroyed)
        {
            pushEvent(target, { type: 'destroyed', round, tokenId: target.tokenId });
            destroyedThisRound = true;
        }
    }
    return destroyedThisRound;
}

function coolHeat(state)
{
    if (state.heat > 0)
        state.heat = Math.max(0, state.heat - 1);
}

// Lancer rule: heat > heatMax and stress > 0 → overheat. Leftover carries over
// (heat becomes heat - heatMax). Stress at 0 = destroyed (reactor meltdown).
function gainHeat(round, combatant, state, amount)
{
    if (amount <= 0)
        return;
    state.heat += amount;
    while (state.heat > state.heatMax && state.stress > 0)
    {
        state.stress -= 1;
        state.heat -= state.heatMax;
        pushEvent(combatant, { type: 'stress-loss', round, tokenId: combatant.tokenId });
    }
    if (state.heat > state.heatMax)
        state.heat = state.heatMax;
}

// Lancer action economy per turn: 1 protocol (top of turn) + (1 full OR 2 quick)
// + 1 move + optional reaction + optional free actions.
function playerTurn(round, actor, actorState, targets)
{
    if (targets.length === 0)
        return;
    const hasTargets = () => targets.some(t => !t.__state.destroyed);

    if (_chance(0.3))
        pushEvent(actor, { type: 'action', round, byId: actor.tokenId, activation: 'Protocol', name: 'PROTOCOL', success: true });

    if (_chance(0.5))
    {
        // Full action: BARRAGE (2 attacks), FULL TECH, STABILIZE, DISENGAGE.
        const roll = Math.random();
        if (roll < 0.55)
        {
            weaponAttack(round, actor, actorState, ...pickTargetWithState(targets), PLAYER_HIT_CHANCE);
            if (hasTargets())
                weaponAttack(round, actor, actorState, ...pickTargetWithState(targets), PLAYER_HIT_CHANCE);
        }
        else if (roll < 0.75)
        {
            techAction(round, actor, actorState, ...pickTargetWithState(targets));
            if (hasTargets())
                techAction(round, actor, actorState, ...pickTargetWithState(targets));
        }
        else
            utilityAction(round, actor, actorState);
    }
    else
    {
        // Two quick actions from any quick slot: SKIRMISH, quick tech, quick utility, etc.
        for (let i = 0; i < 2; i++)
        {
            if (!hasTargets())
                break;
            const roll = Math.random();
            if (roll < 0.5)
                weaponAttack(round, actor, actorState, ...pickTargetWithState(targets), PLAYER_HIT_CHANCE);
            else if (roll < 0.75)
                techAction(round, actor, actorState, ...pickTargetWithState(targets));
            else if (roll < 0.9)
                quickAction(round, actor);
            else
                utilityAction(round, actor, actorState);
        }
    }

    if (_chance(0.75))
        moveAction(round, actor);
    if (_chance(0.35))
        reactionAction(round, actor);
    if (_chance(0.3))
        saveAction(round, actor);
    gainHeat(round, actor, actorState, _rand(0, 2));
}

function hostileTurn(round, actor, actorState, targets)
{
    if (targets.length === 0)
        return;
    const roll = Math.random();
    if (roll < 0.55)
        weaponAttack(round, actor, actorState, ...pickTargetWithState(targets), HOSTILE_HIT_CHANCE);
    else if (roll < 0.75)
        techAction(round, actor, actorState, ...pickTargetWithState(targets));
    if (_chance(0.3))
        moveAction(round, actor);
    gainHeat(round, actor, actorState, _rand(0, 1));
}

function pickTargetWithState(targets)
{
    const target = _pick(targets);
    return [target, target.__state];
}

/**
 * @returns {import('./combat-telemetry.js').CombatTelemetry}
 */
export function mockCombatTelemetry({ small = _chance(0.5) } = {})
{
    const mechs = game.actors?.filter(a => a.type === 'mech') ?? [];
    const excludedNpcClasses = new Set(['human', 'pilot']);
    const npcClassName = actor => String(
        actor?.items?.find?.(item => item.type === 'npc_class')?.name ?? '',
    ).toLowerCase();
    const npcs = (game.actors?.filter(a => a.type === 'npc') ?? [])
        .filter(a => !excludedNpcClasses.has(npcClassName(a)));
    // Full Lancer pools (4 structure, 4 stress). Players won't die in the sim; one is forced destroyed post-sim.
    // Fabricated token ids mirror real per-token entries; clones get numbered names.
    const mockEntry = (actor, index, count) => ({
        tokenId: actor.id + '-t' + index,
        actorId: actor.id,
        name: count > 1 ? `${actor.name} ${index + 1}` : actor.name,
        events: [],
    });
    const players = pickRandom(mechs, Math.min(mechs.length, small ? _rand(2, 3) : _rand(3, 5)))
        .map(actor => ({ ...mockEntry(actor, 0, 1), __state: freshState(actor, PLAYER_HP_FLOOR, PLAYER_HEAT_FLOOR, 4, 4, 'player') }));
    // Bigger hostile pool + hostiles have 1 structure so ~90 % actually get killed.
    const hostiles = [];
    const typePool = pickRandom(npcs, Math.min(npcs.length, small ? _rand(2, 3) : _rand(6, 9)));
    for (const typeActor of typePool)
    {
        const count = small ? _rand(1, 2) : _rand(3, 5);
        for (let copy = 0; copy < count; copy++)
            hostiles.push({ ...mockEntry(typeActor, copy, count), __state: freshState(typeActor, HOSTILE_HP_FLOOR, HOSTILE_HEAT_FLOOR, 1) });
    }
    // Ancillary sides so the recap can preview friendlies / neutrals / secrets.
    const friendlies = [];
    if (npcs.length > 0)
    {
        for (const typeActor of pickRandom(npcs, _rand(1, 2)))
        {
            const count = _rand(1, 2);
            for (let copy = 0; copy < count; copy++)
                friendlies.push({ ...mockEntry(typeActor, copy, count), __state: freshState(typeActor, HOSTILE_HP_FLOOR, HOSTILE_HEAT_FLOOR, 3, 3, 'friendly') });
        }
    }
    const neutrals = [];
    if (npcs.length > 0 && _chance(0.7))
    {
        const typeActor = _pick(npcs);
        neutrals.push({ ...mockEntry(typeActor, 0, 1), __state: freshState(typeActor, HOSTILE_HP_FLOOR, HOSTILE_HEAT_FLOOR, 2, 2, 'neutral') });
    }
    const secrets = [];
    if (npcs.length > 0 && _chance(0.5))
    {
        const typeActor = _pick(npcs);
        secrets.push({ ...mockEntry(typeActor, 0, 1), __state: freshState(typeActor, HOSTILE_HP_FLOOR, HOSTILE_HEAT_FLOOR, 2, 2, 'secret') });
    }
    const roundCount = small ? _rand(3, 4) : _rand(8, 12);

    for (let round = 1; round <= roundCount; round++)
    {
        const combatants = [...players, ...hostiles, ...friendlies, ...neutrals, ...secrets];
        const tickAll = () =>
        {
            for (const combatant of combatants)
            {
                if (!combatant.__state.destroyed)
                    statTick(combatant, round, combatant.__state);
            }
        };
        // Mirror the real recorder: everyone ticks at every turn, so changes land mid-round.
        let turnIdx = 0;
        const startTurn = (combatant) =>
        {
            if (combatant.__state.destroyed)
                return false;
            _turn = turnIdx++;
            return true;
        };
        const actAlly = (ally) =>
        {
            if (!startTurn(ally))
                return;
            const targets = hostiles.filter(hostile => !hostile.__state.destroyed);
            if (players.includes(ally))
                playerTurn(round, ally, ally.__state, targets);
            else
                hostileTurn(round, ally, ally.__state, targets);
            tickAll();
        };
        const actFoe = (foe) =>
        {
            if (!startTurn(foe))
                return;
            hostileTurn(round, foe, foe.__state, players.filter(player => !player.__state.destroyed));
            tickAll();
        };
        // Lancer alternating activation: one ally acts, then a proportional share of hostiles.
        const aliveAllies = [...players, ...friendlies].filter(ally => !ally.__state.destroyed);
        const aliveFoes = hostiles.filter(foe => !foe.__state.destroyed);
        const ratio = aliveAllies.length > 0 ? aliveFoes.length / aliveAllies.length : aliveFoes.length;
        let foeIdx = 0;
        let foeBudget = 0;
        for (const ally of aliveAllies)
        {
            actAlly(ally);
            foeBudget += ratio;
            while (foeBudget >= 1 && foeIdx < aliveFoes.length)
            {
                actFoe(aliveFoes[foeIdx++]);
                foeBudget -= 1;
            }
        }
        while (foeIdx < aliveFoes.length)
            actFoe(aliveFoes[foeIdx++]);
        // Neutrals / secrets fire occasionally at anyone still up.
        for (const combatant of [...neutrals, ...secrets])
        {
            if (!startTurn(combatant))
                continue;
            if (_chance(0.3))
            {
                const anyone = [...players, ...hostiles, ...friendlies]
                    .filter(target => !target.__state.destroyed && target !== combatant);
                if (anyone.length > 0)
                    hostileTurn(round, combatant, combatant.__state, anyone);
            }
            tickAll();
        }
        // End-of-round upkeep lands on the last turn.
        _turn = Math.max(0, turnIdx - 1);
        for (const combatant of combatants)
        {
            if (!combatant.__state.destroyed)
                dotTicks(round, combatant, combatant.__state);
        }
        for (const combatant of combatants)
            coolHeat(combatant.__state);
        tickAll();
        _turn = null;
    }

    // Force exactly one player mech destroyed post-sim; Lancer death = 0 structure or 0 stress.
    if (players.length > 0)
    {
        const doomed = [...players].sort((a, b) => (a.__state.hp / a.__state.hpMax) - (b.__state.hp / b.__state.hpMax))[0];
        const useStructure = _chance(0.5);
        const cascadeType = useStructure ? 'structure-loss' : 'stress-loss';
        const startingCount = useStructure ? doomed.__state.struct : doomed.__state.stress;
        const lossRounds = Array.from({ length: startingCount }, () => _rand(2, roundCount)).sort((a, b) => a - b);
        for (const r of lossRounds)
            pushEvent(doomed, { type: cascadeType, round: r, tokenId: doomed.tokenId });
        if (useStructure)
            doomed.__state.struct = 0;
        else
            doomed.__state.stress = 0;
        doomed.__state.destroyed = true;
        _turn = _rand(0, Math.max(0, players.length + hostiles.length - 1));
        pushEvent(doomed, { type: 'destroyed', round: lossRounds.at(-1), tokenId: doomed.tokenId });
        _turn = null;
    }

    // Give each survivor a varied end state so the recap doesn't show everyone at max.
    for (const combatant of [...players, ...hostiles, ...friendlies, ...neutrals, ...secrets])
    {
        const state = combatant.__state;
        if (state.destroyed)
            continue;
        const finalHp = Math.max(1, Math.round(state.hpMax * (_rand(30, 100) / 100)));
        state.hp = finalHp;
        const targetStructLosses = _rand(0, state.structMax - 1);
        const alreadyLostStruct = combatant.events.filter(ev => ev.type === 'structure-loss').length;
        for (let i = alreadyLostStruct; i < targetStructLosses && state.struct > 1; i++)
        {
            pushEvent(combatant, { type: 'structure-loss', round: _rand(2, roundCount), tokenId: combatant.tokenId });
            state.struct -= 1;
        }
        const targetStressLosses = _rand(0, state.stressMax - 1);
        const alreadyLostStress = combatant.events.filter(ev => ev.type === 'stress-loss').length;
        for (let i = alreadyLostStress; i < targetStressLosses && state.stress > 1; i++)
        {
            pushEvent(combatant, { type: 'stress-loss', round: _rand(2, roundCount), tokenId: combatant.tokenId });
            state.stress -= 1;
        }
        const finalHeat = _rand(0, state.heatMax);
        state.heat = finalHeat;
        statTick(combatant, roundCount, state);
    }

    // Random repairs used + core power spent, per surviving player.
    for (const player of players)
    {
        if (player.__state.destroyed)
            continue;
        const repairsUsed = _rand(0, 4);
        for (let i = 0; i < repairsUsed; i++)
            pushEvent(player, { type: 'action', round: _rand(2, roundCount), byId: player.tokenId, activation: 'Quick', name: 'SELF REPAIR', success: true });
        if (_chance(0.5))
            pushEvent(player, { type: 'action', round: _rand(2, roundCount), byId: player.tokenId, activation: 'Full', name: 'CORE POWER', success: true });
    }

    // Stamp one mech with lost gear.
    if (players.length > 0)
    {
        const gearVictim = _pick(players);
        const lostWeapons = _pickN(['SIEGE CANNON', 'THERMAL LANCE', 'FLAK CANNON', 'CHAIN AXE', 'AUX PISTOL'], _rand(1, 2));
        const lostSystems = _pickN(['REACTOR VENT', 'NEXUS DRIVE', 'STOCK PLATING', 'ARC PROJECTOR'], _rand(1, 2));
        for (const name of lostWeapons)
            pushEvent(gearVictim, { type: 'gear-lost', round: _rand(2, roundCount), tokenId: gearVictim.tokenId, kind: 'weapon', name });
        for (const name of lostSystems)
            pushEvent(gearVictim, { type: 'gear-lost', round: _rand(2, roundCount), tokenId: gearVictim.tokenId, kind: 'system', name });
    }

    // Push hostile casualties to ~90 %.
    const targetDead = Math.floor(hostiles.length * 0.9);
    const stillAlive = hostiles.filter(h => !h.__state.destroyed);
    const finishOff = Math.max(0, targetDead - (hostiles.length - stillAlive.length));
    const doomedHostiles = pickRandom(stillAlive, finishOff);
    for (const h of doomedHostiles)
    {
        h.__state.destroyed = true;
        _turn = _rand(0, Math.max(0, players.length + hostiles.length - 1));
        pushEvent(h, { type: 'destroyed', round: _rand(2, roundCount), tokenId: h.tokenId });
        _turn = null;
    }

    const endTime = Date.now();
    const startTime = endTime - (45 + _rand(0, 75)) * 60 * 1000;
    const strip = (entry, side) => ({ tokenId: entry.tokenId, actorId: entry.actorId, name: entry.name, side, events: entry.events });
    const stripSide = side => entry => strip(entry, side);
    return {
        startTime,
        endTime,
        roundCount,
        players: players.map(stripSide('player')),
        hostiles: hostiles.map(stripSide('enemy')),
        friendlies: friendlies.map(stripSide('player')),
        neutrals: neutrals.map(stripSide('enemy')),
        secrets: secrets.map(stripSide('enemy')),
    };
}

function _pickN(arr, n)
{
    return pickRandom(arr, Math.min(n, arr.length));
}
