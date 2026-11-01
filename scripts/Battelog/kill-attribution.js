const BUCKETS = ['players', 'hostiles', 'friendlies', 'neutrals', 'secrets'];
const BUCKET_TEAM = {
    players: 'player',
    hostiles: 'hostile',
    friendlies: 'friendly',
    neutrals: 'neutral',
    secrets: 'secret',
};

export function matchUndoneDamage(events)
{
    const undone = new Map();
    const damageByTarget = new Map();
    for (const ev of [...events].sort((lhs, rhs) => (lhs.seq ?? 0) - (rhs.seq ?? 0)))
    {
        if (ev.type === 'damage' && !ev.dotCredit)
        {
            if (!damageByTarget.has(ev.targetId))
                damageByTarget.set(ev.targetId, []);
            damageByTarget.get(ev.targetId).push(ev);
        }
        else if (ev.type === 'damage-undo' && !ev.matched)
        {
            const candidates = damageByTarget.get(ev.targetId) ?? [];
            for (let idx = candidates.length - 1; idx >= 0; idx--)
            {
                const damage = candidates[idx];
                if ((damage.hpLanded ?? 0) !== (ev.hpRestored ?? 0) || (damage.overshieldAbsorbed ?? 0) !== (ev.overshieldRestored ?? 0))
                    continue;
                undone.set(ev, damage);
                candidates.splice(idx, 1);
                break;
            }
        }
    }
    return undone;
}

export function attributeKill(telemetry, victimTokenId, cutoffRound, cause = null)
{
    const allLogs = [];
    const teamOf = new Map();
    for (const bucket of BUCKETS)
    {
        for (const log of telemetry?.[bucket] ?? [])
        {
            allLogs.push(log);
            teamOf.set(log.tokenId, BUCKET_TEAM[bucket]);
        }
    }
    const sideOf = new Map(allLogs.map(log => [log.tokenId, log.side ?? 'player']));
    const victimSide = sideOf.get(victimTokenId) ?? 'enemy';
    const meltdownSeqs = cause === 'reactor'
        ? (allLogs.find(log => log.tokenId === victimTokenId)?.events ?? []).filter(ev => ev.type === 'meltdown').map(ev => ev.seq ?? 0)
        : [];
    const cutoffSeq = meltdownSeqs.length ? Math.max(...meltdownSeqs) : Infinity;
    const contributions = [];
    const undoneDamage = new Set(matchUndoneDamage(allLogs.flatMap(log => log.events)).values());
    const add = (id, round, seq, pilot = false) =>
    {
        if (!id || id === victimTokenId || (sideOf.get(id) ?? 'player') === victimSide || (seq ?? 0) > cutoffSeq)
            return;
        contributions.push({ id, round, seq: seq ?? 0, pilot });
    };
    for (const log of allLogs)
    {
        for (const ev of log.events)
        {
            if (ev.round > cutoffRound)
                continue;
            if (ev.type === 'damage' && ev.targetId === victimTokenId)
            {
                if (!undoneDamage.has(ev))
                    add(ev.byId, ev.round, ev.seq, !!ev.pilotTokenId);
            }
            else if (ev.type === 'attack' && ev.byId !== victimTokenId)
            {
                for (const target of ev.targets ?? [])
                {
                    if (target.targetId === victimTokenId && target.hit)
                        add(ev.byId, ev.round, ev.seq, !!ev.pilotTokenId);
                }
            }
            else if (ev.type === 'action' && ev.category === 'save' && ev.byId === victimTokenId && ev.forcedBy)
                add(ev.forcedBy, ev.round, ev.seq);
        }
    }
    if (contributions.length === 0)
        return { killerId: null, killerTeam: 'unknown', assistIds: [], killerIsPilot: false, pilotAssistIds: [] };

    contributions.sort((lhs, rhs) => lhs.round - rhs.round || lhs.seq - rhs.seq);
    const killerId = contributions.at(-1).id;
    const assistIds = [...new Set(contributions.map(entry => entry.id))].filter(id => id !== killerId);
    const lastPilot = new Map(contributions.map(entry => [entry.id, entry.pilot]));
    return {
        killerId,
        killerTeam: teamOf.get(killerId) ?? 'unknown',
        assistIds,
        killerIsPilot: contributions.at(-1).pilot,
        pilotAssistIds: assistIds.filter(id => lastPilot.get(id)),
    };
}
