/* global game */

// Sole telemetry → display translation. Reads the event stream + actors and
// returns the shape the recap and GM card render.

import { AWARDS } from './awards.js';
import { attributeKill } from './kill-attribution.js';

const ACCENT_PALETTE = [
    '#7bd3ff', '#ffaa00', '#a577ff', '#6be08a', '#ff7bb9',
    '#4dd0e1', '#ffb84d', '#dc72ff', '#ffe066', '#ff6b6b',
];
const FALLBACK_IMG = 'icons/svg/mystery-man.svg';
const TOP_ACTION_EXCLUDE = new Set(['SKIRMISH', 'BARRAGE', 'FIGHT']);

/**
 * @param {import('./combat-telemetry.js').CombatTelemetry} telemetry
 * @param {{outcome?: 'VICTORY'|'DEFEAT'|'PARTIAL', mvpId?: string|null}} [opts]
 */
export function deriveDisplayBattle(telemetry, { outcome = 'VICTORY', mvpId = null } = {})
{
    const players = telemetry.players.map((log, idx) => _derivePlayer(log, idx, telemetry));

    // Counterparty sets for per-card DMG DEALT/TAKEN filtering.
    const idsFrom = (logs) => new Set((logs ?? []).map(log => log.tokenId));
    const playerIds     = idsFrom(telemetry.players);
    const hostileIds    = idsFrom(telemetry.hostiles);
    const friendlyIds   = idsFrom(telemetry.friendlies);
    const hostileCounterparty  = new Set([...playerIds, ...friendlyIds]);
    const friendlyCounterparty = hostileIds;
    const hostiles    = (telemetry.hostiles   ?? []).map((log, idx) => _deriveNonSquad(log, idx, telemetry, 'hostile',  hostileCounterparty));
    const friendlies  = (telemetry.friendlies ?? []).map((log, idx) => _deriveNonSquad(log, idx, telemetry, 'friendly', friendlyCounterparty));
    const neutrals    = (telemetry.neutrals   ?? []).map((log, idx) => _deriveNonSquad(log, idx, telemetry, 'neutral',  null));
    const secrets     = (telemetry.secrets    ?? []).map((log, idx) => _deriveNonSquad(log, idx, telemetry, 'secret',   null));

    for (const h of hostiles)
    {
        const attribution = _attributeKill(h, telemetry);
        h.killedBy = attribution.killerId;
        h.killedByTeam = attribution.killerTeam;
        h.assistedBy = attribution.assistIds;
    }
    for (const p of players)
    {
        p.killedList   = hostiles.filter(h => h.killedBy === p.tokenId).map(h => h.name);
        p.assistedList = hostiles.filter(h => (h.assistedBy ?? []).includes(p.tokenId)).map(h => h.name);
        p.kills   = p.killedList.length;
        p.assists = p.assistedList.length;
        for (const h of hostiles)
        {
            const round = h.round;
            if (round == null || round < 1 || round > p.killLine.length)
                continue;
            if (h.killedBy === p.tokenId)
            {
                p.killLine[round - 1]++;
                p.killAssistLine[round - 1]++;
            }
            else if ((h.assistedBy ?? []).includes(p.tokenId))
            {
                p.assistLine[round - 1]++;
                p.killAssistLine[round - 1]++;
            }
        }
    }

    const rounds = Array.from({ length: telemetry.roundCount }, (_, i) => i + 1);
    const mission = _buildMission(telemetry, outcome, players, hostiles);
    let disableAwards = false;
    try
    {
        disableAwards = !!game.settings.get('lancer-automations', 'tah.disableAwards');
    }
    catch
    { /* not ready */ }
    const { awards, mvpId: derivedMvpId } = disableAwards
        ? { awards: [], mvpId: mvpId ?? null }
        : _buildAwards(players, mvpId);
    return { mission, rounds, players, hostiles, friendlies, neutrals, secrets, awards, mvpId: derivedMvpId };
}


function _derivePlayer(log, idx, telemetry)
{
    const actor = _actor(log.actorId);
    const sys = /** @type {any} */ (actor?.system ?? {});
    const events = log.events;

    const statTicks = events.filter(ev => ev.type === 'stat-tick');
    const startTick = statTicks.find(ev => ev.round === 0);
    const hpTickPeak = Math.max(0, ...statTicks.map(ev => ev.hp ?? 0));
    const heatTickPeak = Math.max(0, ...statTicks.map(ev => ev.heat ?? 0));
    const hpMax     = Math.max(_asNum(sys.hp?.max,        0), hpTickPeak,  10);
    const heatMax   = Math.max(_asNum(sys.heat?.max,      0), heatTickPeak, 6);
    const structMax = _asNum(sys.structure?.max, 4);
    const stressMax = _asNum(sys.stress?.max,    4);
    const repairsMax = _asNum(sys.repairs?.max, 5);
    const repairsUsed = events.filter(ev => ev.type === 'action' && ev.name === 'SELF REPAIR').length;
    // Positive tick deltas = healing, negative heat deltas = cooling; structure/stress resets excluded.
    const structRounds = new Set(events.filter(ev => ev.type === 'structure-loss').map(ev => ev.round));
    const stressRounds = new Set(events.filter(ev => ev.type === 'stress-loss').map(ev => ev.round));
    let hpRestored = 0;
    let heatCooled = 0;
    for (let tickIdx = 1; tickIdx < statTicks.length; tickIdx++)
    {
        const prevTick = statTicks[tickIdx - 1];
        const curTick = statTicks[tickIdx];
        const hpDelta = (curTick.hp ?? 0) - (prevTick.hp ?? 0);
        if (hpDelta > 0 && !structRounds.has(curTick.round) && !structRounds.has(prevTick.round))
            hpRestored += hpDelta;
        const heatDelta = (prevTick.heat ?? 0) - (curTick.heat ?? 0);
        if (heatDelta > 0 && !stressRounds.has(curTick.round) && !stressRounds.has(prevTick.round))
            heatCooled += heatDelta;
    }
    hpRestored = Math.max(0, hpRestored - events.reduce((sum, ev) => sum + (ev.type === 'damage-undo' ? (ev.hpRestored ?? 0) : 0), 0));
    // corePower = true means "spent" (matches recap display "USED" vs "HELD").
    const corePower = events.some(ev => ev.type === 'action' && ev.name === 'CORE POWER');

    const frameName = sys.loadout?.frame?.value?.name ?? sys.frame?.name ?? 'UNKNOWN FRAME';
    const pilotName = sys.pilot?.value?.name ?? actor?.name ?? 'PILOT';
    const manufacturer = sys.loadout?.frame?.value?.system?.source ?? sys.frame?.source ?? 'GMS';
    const pilotLevel = _asNum(sys.pilot?.value?.system?.level ?? sys.pilot?.level, 2);
    const favWeapon = _attackNameCounts(
        events,
        ev => ev.type === 'attack' && ev.byId === log.tokenId && ev.category === 'weapon' && !ev.basic && ev.targets?.some(target => target.hit),
        ev => ev.weaponName,
    ).top ?? '-';
    const topAction = _actionCounts(
        events,
        ev => ev.type === 'action' && ev.byId === log.tokenId && ev.success
            && !TOP_ACTION_EXCLUDE.has(ev.name) && !!ev.activation,
    ).top ?? '-';

    const rawHp   = _tickLine(events, 'hp', telemetry.roundCount, hpMax);
    const rawHeat = _tickLine(events, 'heat', telemetry.roundCount, 0);
    // Per-round struct / stress, walking loss events cumulatively.
    const structAtRound = new Array(telemetry.roundCount).fill(0);
    const stressAtRound = new Array(telemetry.roundCount).fill(0);
    {
        let struct = startTick ? _asNum(startTick.structure, structMax) : structMax;
        let stress = startTick ? _asNum(startTick.stress, stressMax) : stressMax;
        for (let r = 1; r <= telemetry.roundCount; r++)
        {
            for (const ev of events)
            {
                if (ev.round !== r)
                    continue;
                if (ev.type === 'structure-loss')
                    struct = Math.max(0, struct - 1);
                if (ev.type === 'stress-loss')
                    stress = Math.max(0, stress - 1);
            }
            structAtRound[r - 1] = struct;
            stressAtRound[r - 1] = stress;
        }
    }
    // Effective pools: HP falls from hpMax*structMax → 0, heat rises 0 → heatMax*stressMax.
    const line = rawHp.map((hp, i) => Math.max(0, hp + (structAtRound[i] - 1) * hpMax));
    const heatLine = rawHeat.map((heat, i) => heat + (stressMax - stressAtRound[i]) * heatMax);

    const dmgLine  = _perRoundSum(events, telemetry.roundCount, ev => (
        ev.type === 'damage' && ev.byId === log.tokenId
            ? (ev.damages ?? []).reduce((n, d) => n + (d.amount ?? 0), 0)
            : 0
    ));
    const killLine        = _perRoundSum(events, telemetry.roundCount, () => 0);
    const assistLine      = _perRoundSum(events, telemetry.roundCount, () => 0);
    const killAssistLine  = _perRoundSum(events, telemetry.roundCount, () => 0);
    const hpEnd = rawHp.at(-1) ?? hpMax;
    const heatEnd = rawHeat.at(-1) ?? 0;
    const heatPeak = Math.max(0, ...rawHeat);
    const destroyed = events.some(ev => ev.type === 'destroyed');

    const breakdown = _buildBreakdown(events, telemetry, log.tokenId);
    const dmgDealt = breakdown.dmgOut.types.reduce((n, t) => n + t.v, 0);
    const dmgTaken = breakdown.dmgIn.types.reduce((n, t) => n + t.v, 0);
    const attacks = breakdown.weapons.reduce((n, w) => n + w.n, 0);
    const techAtk = breakdown.techActs.reduce((n, t) => n + t.n, 0);
    const skills  = breakdown.skills.reduce((n, s) => n + s.n, 0);
    const attackTargets = events
        .filter(ev => ev.type === 'attack' && ev.byId === log.tokenId && ev.category === 'weapon')
        .flatMap(ev => ev.targets ?? []);
    const shots = attackTargets.length;
    const hits  = attackTargets.filter(target => target.hit).length;
    const accuracy = shots > 0 ? Math.round(hits / shots * 100) : 0;
    const perRoundActions = new Map();
    for (const ev of events)
    {
        if (ev.type === 'action' && ev.byId === log.tokenId)
            perRoundActions.set(ev.round, (perRoundActions.get(ev.round) ?? 0) + 1);
    }
    const maxActionsInTurn = Math.max(0, ...perRoundActions.values());
    // From events, not the actor: the actor is untouched during mock runs.
    const structEnd = structAtRound.at(-1) ?? structMax;
    const stressEnd = stressAtRound.at(-1) ?? stressMax;

    // Structure death zeroes HP, meltdown zeroes heat, whatever the last tick said.
    const displayHpEnd   = destroyed && structEnd === 0 ? 0 : hpEnd;
    const displayHeatEnd = destroyed && stressEnd === 0 ? 0 : heatEnd;

    const effectiveHpMax   = hpMax   * structMax;
    const effectiveHpEnd   = Math.max(0, displayHpEnd + (structEnd - 1) * hpMax);
    const heatCapacityMax  = heatMax * stressMax;
    const heatConsumedEnd  = displayHeatEnd + (stressMax - stressEnd) * heatMax;

    const startStruct = startTick ? _asNum(startTick.structure, structMax) : structMax;
    const startStress = startTick ? _asNum(startTick.stress, stressMax) : stressMax;
    const startHp     = startTick ? Math.max(0, _asNum(startTick.hp, hpMax) + (startStruct - 1) * hpMax) : effectiveHpMax;
    const startHeat   = startTick ? _asNum(startTick.heat, 0) + (stressMax - startStress) * heatMax : 0;

    // Split damage: physical = everything except HEAT (infection is excluded from the display cell).
    const heatDmgDealt      = breakdown.dmgOut.types.find(type => type.k === 'HEAT')?.v ?? 0;
    const physicalDmgDealt  = breakdown.dmgOut.types
        .filter(type => type.k !== 'HEAT' && type.k !== 'INFECTION')
        .reduce((n, type) => n + type.v, 0);
    const heatDmgTaken      = breakdown.dmgIn.types.find(type => type.k === 'HEAT')?.v ?? 0;
    const physicalDmgTaken  = breakdown.dmgIn.types
        .filter(type => type.k !== 'HEAT' && type.k !== 'INFECTION')
        .reduce((n, type) => n + type.v, 0);

    return {
        id: _slug(actor?.name ?? log.actorId) + '-' + idx,
        tokenId: log.tokenId,
        actorId: log.actorId,
        callsign: String(log.name ?? actor?.name ?? 'PILOT').toUpperCase(),
        pilot:    String(pilotName).toUpperCase(),
        mechName: String(log.name ?? actor?.name ?? 'MECH').toUpperCase(),
        frame:    String(frameName).toUpperCase(),
        mfr:      String(manufacturer).toUpperCase(),
        ll: pilotLevel,
        accent: ACCENT_PALETTE[idx % ACCENT_PALETTE.length],
        img: actor?.img ?? FALLBACK_IMG,
        hpMax,
        hpEnd: displayHpEnd,
        structMax,
        structEnd,
        heatMax,
        heatEnd: displayHeatEnd,
        heatPeak,
        stressMax,
        stressEnd,
        effectiveHpMax,
        effectiveHpEnd,
        startHp,
        startHeat,
        heatCapacityMax,
        heatConsumedEnd,
        corePower,
        destroyed,
        repairs: repairsUsed,
        repairsMax,
        hpRestored,
        heatCooled,
        favWeapon: String(favWeapon).toUpperCase(),
        topAction: String(topAction).toUpperCase(),
        dmgDealt,
        dmgTaken,
        physicalDmgDealt,
        heatDmgDealt,
        physicalDmgTaken,
        heatDmgTaken,
        attacks,
        techAtk,
        skills,
        shots,
        hits,
        accuracy,
        moves: events.reduce((n, ev) => n + (ev.type === 'move' && !ev.knockback ? (ev.distance ?? 0) : 0), 0),
        maxActionsInTurn,
        // Filled in by attribution pass.
        kills: 0,
        assists: 0,
        killedList: [],
        assistedList: [],
        line,
        heatLine,
        dmgLine,
        killLine,
        assistLine,
        killAssistLine,
        gearLost: _gearLost(actor, events),
        bd: breakdown,
    };
}

function _buildBreakdown(events, telemetry, byId)
{
    const allLogs = [
        ...telemetry.players,
        ...telemetry.hostiles,
        ...(telemetry.friendlies ?? []),
        ...(telemetry.neutrals ?? []),
        ...(telemetry.secrets ?? []),
    ];
    const dmgOutByType = new Map();
    let mitigatedOutArmor = 0;
    let mitigatedOutOvershield = 0;
    const dmgInByType = new Map();
    let mitigatedInArmor = 0;
    let mitigatedInOvershield = 0;
    let evaded = 0;
    let edef = 0;
    let attacksTaken = 0;
    let techTaken = 0;
    let evasionRolledAgainst = 0;
    let edefRolledAgainst = 0;
    for (const c of allLogs)
    {
        for (const ev of c.events)
        {
            if (ev.type === 'damage')
            {
                if (ev.byId === byId)
                {
                    for (const d of (ev.damages ?? []))
                        dmgOutByType.set(d.type, (dmgOutByType.get(d.type) ?? 0) + (d.amount ?? 0));
                    mitigatedOutArmor      += ev.armorAbsorbed ?? 0;
                    mitigatedOutOvershield += ev.overshieldAbsorbed ?? 0;
                }
                if (ev.targetId === byId)
                {
                    for (const d of (ev.damages ?? []))
                        dmgInByType.set(d.type, (dmgInByType.get(d.type) ?? 0) + (d.amount ?? 0));
                    mitigatedInArmor      += ev.armorAbsorbed ?? 0;
                    mitigatedInOvershield += ev.overshieldAbsorbed ?? 0;
                }
            }
            else if (ev.type === 'attack')
            {
                for (const t of (ev.targets ?? []))
                {
                    if (t.targetId !== byId)
                        continue;
                    if (ev.category === 'weapon')
                        attacksTaken++;
                    if (ev.category === 'tech')
                        techTaken++;
                    if (t.defense === 'evasion')
                        evasionRolledAgainst++;
                    if (t.defense === 'edef')
                        edefRolledAgainst++;
                    if (!t.hit)
                    {
                        if (t.defense === 'evasion')
                            evaded++;
                        if (t.defense === 'edef')
                            edef++;
                    }
                }
            }
        }
    }

    // Weapon/tech counts from attack events; skills still live on `action` events.
    const weaponCounts = _attackCountsByCategory(events, byId, 'weapon');
    const techCounts   = _attackCountsByCategory(events, byId, 'tech');
    const skillCounts  = _actionCountsByNames(events, byId);

    const haseAcc = _haseAcc(events, byId);
    const acc = _accuracySplit(events, byId, haseAcc);

    let maxTurn = 0;
    let knockback = 0;
    const perRoundMove = new Map();
    for (const ev of events)
    {
        if (ev.type !== 'move' || ev.byId !== byId)
            continue;
        if (ev.knockback)
            knockback += ev.distance ?? 0;
        else
            perRoundMove.set(ev.round, (perRoundMove.get(ev.round) ?? 0) + (ev.distance ?? 0));
    }
    for (const total of perRoundMove.values())
        maxTurn = Math.max(maxTurn, total);
    // Knockback dealt: forced moves on anyone that this token caused.
    let knockbackDealt = 0;
    for (const other of allLogs)
    {
        for (const ev of other.events)
        {
            if (ev.type === 'move' && ev.knockback && ev.sourceId === byId)
                knockbackDealt += ev.distance ?? 0;
        }
    }

    return {
        dmgOut: {
            types: [...dmgOutByType.entries()].map(([k, v]) => ({ k: k.toUpperCase(), v })),
            mitigatedArmor: mitigatedOutArmor,
            mitigatedOvershield: mitigatedOutOvershield,
            mitigated: mitigatedOutArmor + mitigatedOutOvershield,
        },
        dmgIn: {
            types: [...dmgInByType.entries()].map(([k, v]) => ({ k: k.toUpperCase(), v })),
            mitigatedArmor: mitigatedInArmor,
            mitigatedOvershield: mitigatedInOvershield,
            mitigated: mitigatedInArmor + mitigatedInOvershield,
            evaded,
            edef,
            dodged: evaded + edef,
            attacksTaken,
            techTaken,
            evasionRolledAgainst,
            edefRolledAgainst,
        },
        acc,
        hase: { ...haseAcc.rates, attempts: haseAcc.attempts, total: haseAcc.total },
        weapons: weaponCounts,
        techActs: techCounts,
        skills: skillCounts,
        movement: { maxTurn, knockback, knockbackDealt },
    };
}

function _attackCountsByCategory(events, byId, category)
{
    const counts = new Map();
    for (const ev of events)
    {
        if (ev.type !== 'attack' || ev.byId !== byId || ev.category !== category)
            continue;
        const name = ev.weaponName ?? '-';
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([k, n]) => ({ k, n }));
}

function _attackNameCounts(events, filter, nameOf)
{
    const counts = new Map();
    for (const ev of events)
    {
        if (!filter(ev))
            continue;
        const name = nameOf(ev) ?? '-';
        counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    let top = null;
    let topCount = 0;
    for (const [name, count] of counts)
    {
        if (count > topCount)
        {
            top = name;
            topCount = count;
        }
    }
    return { top, counts };
}

function _actionCountsByNames(events, byId)
{
    const counts = new Map();
    for (const ev of events)
    {
        if (ev.type !== 'action' || ev.byId !== byId || !ev.activation)
            continue;
        counts.set(ev.name, (counts.get(ev.name) ?? 0) + 1);
    }
    return [...counts.entries()].map(([k, n]) => ({ k, n }));
}

function _haseAcc(events, byId)
{
    const attempts = { hull: 0, agi: 0, sys: 0, eng: 0 };
    const passes   = { hull: 0, agi: 0, sys: 0, eng: 0 };
    for (const ev of events)
    {
        if (ev.type !== 'action' || ev.byId !== byId || (ev.category !== 'save' && ev.category !== 'check'))
            continue;
        const key = ev.name;
        if (attempts[key] === undefined)
            continue;
        attempts[key]++;
        if (ev.success)
            passes[key]++;
    }
    const pct = k => attempts[k] > 0 ? Math.round(passes[k] / attempts[k] * 100) : null;
    const totalAttempts = attempts.hull + attempts.agi + attempts.sys + attempts.eng;
    const totalPasses = passes.hull + passes.agi + passes.sys + passes.eng;
    return {
        rates: { H: pct('hull'), A: pct('agi'), S: pct('sys'), E: pct('eng') },
        attempts,
        total: {
            attempts: totalAttempts,
            passes: totalPasses,
            rate: totalAttempts > 0 ? Math.round(totalPasses / totalAttempts * 100) : null,
        },
    };
}

function _accuracySplit(events, byId, haseAcc)
{
    let rangedShots = 0, rangedHits = 0;
    let meleeShots  = 0, meleeHits  = 0;
    let techShots   = 0, techHits   = 0;
    let crits = 0;
    for (const ev of events)
    {
        if (ev.type !== 'attack' || ev.byId !== byId)
            continue;
        const isTech = ev.category === 'tech';
        const isMelee = ev.attackType === 'Melee';
        for (const t of (ev.targets ?? []))
        {
            if (isTech)
            {
                techShots++;
                if (t.hit)
                    techHits++;
            }
            else if (isMelee)
            {
                meleeShots++;
                if (t.hit)
                    meleeHits++;
                if (t.crit)
                    crits++;
            }
            else
            {
                rangedShots++;
                if (t.hit)
                    rangedHits++;
                if (t.crit)
                    crits++;
            }
        }
    }
    const rangedAcc = rangedShots > 0 ? Math.round(rangedHits / rangedShots * 100) : null;
    const meleeAcc  = meleeShots  > 0 ? Math.round(meleeHits  / meleeShots  * 100) : null;
    const techAcc   = techShots   > 0 ? Math.round(techHits   / techShots   * 100) : null;
    // Average only over save kinds that were actually attempted.
    const haseAvg = haseAcc.total.rate;
    const totalShots = rangedShots + meleeShots + techShots;
    const totalHits  = rangedHits  + meleeHits  + techHits;
    const totalAcc = totalShots > 0 ? Math.round(totalHits / totalShots * 100) : null;
    return {
        ranged: rangedAcc,
        rangedShots,
        melee: meleeAcc,
        meleeShots,
        tech: techAcc,
        techShots,
        totalShots,
        totalHits,
        total: totalAcc,
        hase: haseAvg,
        crits,
    };
}

function _actionCounts(events, filter)
{
    const counts = new Map();
    for (const ev of events)
    {
        if (!filter(ev))
            continue;
        counts.set(ev.name, (counts.get(ev.name) ?? 0) + 1);
    }
    let top = null;
    let topCount = 0;
    for (const [name, count] of counts)
    {
        if (count > topCount)
        {
            top = name;
            topCount = count;
        }
    }
    return { top, counts };
}

function _tickLine(events, field, roundCount, defaultValue)
{
    const map = new Map();
    for (const ev of events)
    {
        if (ev.type === 'stat-tick')
            map.set(ev.round, ev[field]);
    }
    const out = [];
    let cur = defaultValue;
    for (let r = 1; r <= roundCount; r++)
    {
        if (map.has(r))
            cur = map.get(r);
        out.push(cur);
    }
    return out;
}

function _perRoundSum(events, roundCount, valueFor)
{
    const out = new Array(roundCount).fill(0);
    for (const ev of events)
    {
        if (ev.round == null || ev.round < 1 || ev.round > roundCount)
            continue;
        out[ev.round - 1] += valueFor(ev);
    }
    return out;
}


// counterpartyIds null = count all damage, no counterparty filter.
function _deriveNonSquad(log, idx, telemetry, side, counterpartyIds)
{
    const actor = _actor(log.actorId);
    const sys = /** @type {any} */ (actor?.system ?? {});
    const events = log.events;

    const actorItems = /** @type {any[]} */ ([...(actor?.items ?? [])]);
    const classItem = actorItems.find(i => i.type === 'npc_class');
    const cls = classItem?.name ?? sys.class?.name ?? 'GRUNT';
    const templateNames = actorItems
        .filter(i => i.type === 'npc_template')
        .map(i => String(i.name ?? '').toUpperCase());
    const tier = _asNum(sys.tier, 1);
    const size = _asNum(sys.size, 1);
    const actorType = actor?.type === 'mech' ? 'mech' : 'npc';
    const frameName = actorType === 'mech'
        ? String(sys.loadout?.frame?.value?.name ?? sys.frame?.name ?? 'UNKNOWN FRAME').toUpperCase()
        : null;
    const ll = actorType === 'mech'
        ? _asNum(sys.pilot?.value?.system?.level ?? sys.pilot?.level, 0)
        : null;
    const destroyedEv = events.find(ev => ev.type === 'destroyed');
    const killed = !!destroyedEv;
    const addToBucket = (bucket, type, amount) =>
    {
        if (type === 'heat')
            bucket.heat += amount;
        else if (type !== 'infection')
            bucket.physical += amount;
    };
    const matches = (id) => !counterpartyIds || counterpartyIds.has(id);
    const dealtBucket = { physical: 0, heat: 0 };
    const takenBucket = { physical: 0, heat: 0 };
    const allLogs = [
        ...telemetry.players,
        ...telemetry.hostiles,
        ...(telemetry.friendlies ?? []),
        ...(telemetry.neutrals ?? []),
        ...(telemetry.secrets ?? []),
    ];
    for (const c of allLogs)
    {
        for (const ev of c.events)
        {
            if (ev.type === 'damage')
            {
                if (ev.byId === log.tokenId && matches(ev.targetId))
                {
                    for (const d of (ev.damages ?? []))
                        addToBucket(dealtBucket, d.type, d.amount ?? 0);
                }
                if (ev.targetId === log.tokenId && matches(ev.byId))
                {
                    for (const d of (ev.damages ?? []))
                        addToBucket(takenBucket, d.type, d.amount ?? 0);
                }
            }
            else if (ev.type === 'damage-undo')
            {
                const reverted = (ev.hpRestored ?? 0) + (ev.overshieldRestored ?? 0);
                if (ev.byId === log.tokenId && matches(ev.targetId))
                    dealtBucket.physical = Math.max(0, dealtBucket.physical - reverted);
                if (ev.targetId === log.tokenId && matches(ev.byId))
                    takenBucket.physical = Math.max(0, takenBucket.physical - reverted);
            }
        }
    }
    const dmgDealt = dealtBucket.physical + dealtBucket.heat;
    const dmgTaken = takenBucket.physical + takenBucket.heat;

    return {
        id: _slug(actor?.name ?? log.actorId) + '-' + side + '-' + idx,
        tokenId: log.tokenId,
        actorId: log.actorId,
        side,
        name: String(log.name ?? actor?.name ?? side.toUpperCase()).toUpperCase(),
        cls:  String(cls).toUpperCase(),
        img:  actor?.img ?? FALLBACK_IMG,
        tier,
        size,
        templates: templateNames,
        actorType,
        frameName,
        ll,
        scanned: true,
        killed,
        round: destroyedEv?.round ?? null,
        dmgDealt,
        dmgTaken,
        physicalDmgDealt: dealtBucket.physical,
        heatDmgDealt:     dealtBucket.heat,
        physicalDmgTaken: takenBucket.physical,
        heatDmgTaken:     takenBucket.heat,
        // Filled in by attribution pass (hostiles only).
        killedBy: null,
        assistedBy: [],
    };
}


function _attributeKill(victim, telemetry)
{
    if (!victim.killed || victim.round == null)
        return { killerId: null, killerTeam: null, assistIds: [] };
    return attributeKill(telemetry, victim.tokenId, victim.round);
}


function _buildMission(telemetry, outcome, players, hostiles)
{
    const end = new Date(telemetry.endTime);
    const date = end.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    const missionDate = `2050.${String(end.getMonth() + 1).padStart(2, '0')}.${String(end.getDate()).padStart(2, '0')}`;
    const totalMin = Math.max(0, Math.round((telemetry.endTime - telemetry.startTime) / 60000));
    const realtime = `${Math.floor(totalMin / 60)}h ${String(totalMin % 60).padStart(2, '0')}m`;
    const operational = players.filter(p => !p.destroyed).length;
    return {
        date,
        missionDate,
        realtime,
        combatants: players.length + hostiles.length,
        outcome,
        rounds: telemetry.roundCount,
        squadStatus: `${operational} / ${players.length} OPERATIONAL`,
    };
}

/**
 * Award pass: each award goes to the highest-stat player clearing the minimum; MVP = GM pick, else most-decorated player, else none.
 * @returns {{ awards: any[], mvpId: string|null }}
 */
function _buildAwards(players, mvpId)
{
    const awards = [];
    for (const award of AWARDS)
    {
        let topPlayer = null;
        let topValue = -Infinity;
        for (const p of players)
        {
            const v = award.stat(p);
            if (v > topValue)
            {
                topValue = v;
                topPlayer = p;
            }
        }
        if (!topPlayer || topValue < award.minValue)
            continue;
        awards.push({
            key: award.key,
            holder: topPlayer.id,
            label: award.label,
            icon: award.icon,
            stat: award.format(topValue, topPlayer),
            sub: award.description,
        });
    }

    let finalMvpId = null;
    if (mvpId && players.some(p => p.id === mvpId))
        finalMvpId = mvpId;
    else
    {
        const countByHolder = new Map();
        for (const a of awards)
            countByHolder.set(a.holder, (countByHolder.get(a.holder) ?? 0) + 1);
        let bestCount = 0;
        for (const [pid, n] of countByHolder)
        {
            if (n > bestCount)
            {
                bestCount = n;
                finalMvpId = pid;
            }
        }
    }
    if (finalMvpId)
    {
        const mvp = players.find(p => p.id === finalMvpId);
        if (mvp)
        {
            awards.unshift({
                key: 'MVP',
                holder: mvp.id,
                label: 'MVP',
                icon: 'fa-star',
                stat: '',
                sub: 'Recognized as the squad standout this engagement',
            });
        }
    }
    // KIA is not a competitive award; every destroyed pilot gets one.
    for (const p of players)
    {
        if (!p.destroyed)
            continue;
        awards.unshift({
            key: 'KIA',
            holder: p.id,
            label: 'KIA',
            icon: 'fa-coffin-cross',
            stat: 'MECH LOST',
            sub: 'Mech destroyed in the line of duty',
        });
    }
    return { awards, mvpId: finalMvpId };
}


function _actor(actorId)
{
    return actorId ? game.actors?.get(actorId) : null;
}

function _asNum(v, fallback)
{
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
}

function _asStr(v, fallback)
{
    const s = String(v ?? '').trim();
    return s || fallback;
}

function _slug(str)
{
    return String(str ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/(^-|-$)/g, '') || 'unknown';
}

function _gearLost(actor, events = [])
{
    const weapons = [];
    const systems = [];
    // Real-usage source: the actor's destroyed items.
    if (actor?.items)
    {
        for (const item of actor.items)
        {
            const destroyed = item.system?.destroyed === true || item.system?.cascading === true;
            if (!destroyed)
                continue;
            const t = item.type;
            if (t === 'mech_weapon' || t === 'pilot_weapon' || t === 'npc_weapon')
                weapons.push(String(item.name).toUpperCase());
            else if (t === 'mech_system' || t === 'pilot_gear' || t === 'npc_system')
                systems.push(String(item.name).toUpperCase());
        }
    }
    // Mock source: gear-lost events on the combatant log.
    for (const ev of events)
    {
        if (ev.type !== 'gear-lost')
            continue;
        const name = String(ev.name ?? '').toUpperCase();
        if (ev.kind === 'weapon' && !weapons.includes(name))
            weapons.push(name);
        if (ev.kind === 'system' && !systems.includes(name))
            systems.push(name);
    }
    return { weapons, systems };
}
