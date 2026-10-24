const BUCKETS = ['players', 'hostiles', 'friendlies', 'neutrals', 'secrets'];
const BUCKET_TEAM = {
    players: 'player',
    hostiles: 'hostile',
    friendlies: 'friendly',
    neutrals: 'neutral',
    secrets: 'secret',
};

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
    const undoes = [];
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
                add(ev.byId, ev.round, ev.seq, !!ev.pilotTokenId);
            else if (ev.type === 'damage-undo' && ev.targetId === victimTokenId && ev.byId !== victimTokenId)
                undoes.push({ id: ev.byId, round: ev.round });
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
    for (const undo of undoes)
    {
        const idx = contributions.findIndex(entry => entry.id === undo.id && entry.round <= undo.round);
        if (idx >= 0)
            contributions.splice(idx, 1);
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
