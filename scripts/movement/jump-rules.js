const EPS = 1e-9;

export const CLIMB_WAYPOINTS_SETTING = 'enableClimbWaypoints';

export function jumpRoundUp(bandEnd, spent, unit)
{
    return unit >= 2 - EPS && Math.abs(bandEnd - spent - 1) <= EPS ? 1 : 0;
}

export function stampsClimb(surface, previous, { climbDown = false, jumping = true, hop = false, lift = 0, jumpHeight })
{
    if (surface === previous)
        return false;
    return climbDown || !(jumping && (hop || surface < previous) && previous - (surface + lift) <= jumpHeight + EPS);
}

export function walkJumpRests(count, rules)
{
    const { takeoff, jumpHeight, airHexes } = rules;
    const rests = [];
    let lastSurface = takeoff;

    const firstLowerHeld = (end) =>
    {
        let edge = end;

        while (edge > 0 && rests[edge - 1].held && rests[edge - 1].ground.surface < lastSurface - EPS)
            edge--;

        return edge;
    };

    const airTooLong = (end, toIdx) =>
    {
        const edge = firstLowerHeld(end);
        return edge < end && rules.hexesBetween(edge > 0 ? rests[edge - 1].idx : 0, toIdx) > airHexes;
    };

    const climbDownBefore = (end) =>
    {
        const edge = firstLowerHeld(end);
        if (edge === end)
            return null;

        const fallen = rests[edge];
        Object.assign(fallen, { surface: fallen.ground.surface, brushed: !!fallen.ground.brushed, held: false, climbDown: true });
        rests.length = edge + 1;
        lastSurface = fallen.surface;
        return fallen.idx;
    };

    for (let idx = 1; idx < count; idx++)
    {
        if (!rules.counts(idx))
            continue;

        const jumping = rules.jumping(idx);
        const lands = jumping && rules.landsAt(idx);

        if (jumping && !lands)
        {
            const held = rules.holdAt(idx, lastSurface);

            if (held === null || held <= lastSurface + EPS)
            {
                const ground = rules.groundAt(idx, lastSurface);
                const restart = ground.surface >= lastSurface - EPS && airTooLong(rests.length, idx) ? climbDownBefore(rests.length) : null;

                if (restart !== null)
                {
                    idx = restart;
                    continue;
                }

                rests.push({ idx, surface: lastSurface, brushed: false, held: true, climbDown: false, ground });
                continue;
            }
        }

        let rest = rules.restAt(idx, lastSurface);

        if (jumping && rest.surface > lastSurface + EPS)
        {
            let fall = rests.length - 1;

            while (fall >= 0 && rests[fall].held && rules.sameHex(rests[fall].idx, idx))
                fall--;

            if (fall >= 0 && rests[fall].held)
            {
                const tooDeep = lastSurface - rests[fall].ground.surface > jumpHeight + EPS;
                const restart = tooDeep || airTooLong(fall + 1, rests[fall].idx) ? climbDownBefore(fall + 1) : null;

                if (restart !== null)
                {
                    idx = restart;
                    continue;
                }

                for (const fallen of rests.slice(fall))
                {
                    const grounded = rules.groundAt(fallen.idx, lastSurface);
                    Object.assign(fallen, { surface: grounded.surface, brushed: !!grounded.brushed, held: false });
                    lastSurface = grounded.surface;
                }

                rest = rules.restAt(idx, lastSurface);
            }
        }
        else if (lands && rests.at(-1)?.held && (lastSurface - (rest.surface + rules.landingLift(idx)) > jumpHeight + EPS || airTooLong(rests.length, idx)))
        {
            const restart = climbDownBefore(rests.length);

            if (restart !== null)
            {
                idx = restart;
                continue;
            }
        }

        rests.push({ idx, surface: rest.surface, brushed: !!rest.brushed, held: false, climbDown: false });
        lastSurface = rest.surface;
    }

    return rests;
}

export function walkJumpAir(count, state, { holdAt, groundAt, landsAt, riseAbove = Infinity })
{
    const holds = new Set();

    const closeRun = () =>
    {
        if (state.run > 0)
            state.span = Math.max(state.span, state.run + 1);
        state.run = 0;
    };

    for (let idx = 1; idx < count; idx++)
    {
        const landing = landsAt(idx);
        const held = landing ? null : holdAt(idx, state.elevation);

        if (held !== null && held <= state.elevation + EPS)
        {
            const under = groundAt(idx, state.elevation, false);

            if (under !== null && under < state.elevation - EPS)
                state.run++;
            else
                closeRun();

            holds.add(idx);
            continue;
        }

        closeRun();
        const surface = groundAt(idx, state.elevation, landing);
        if (surface === null)
            continue;

        state.elevation = surface;
        state.peak = Math.max(state.peak, surface);

        if (surface > riseAbove + EPS)
            return { holds, rose: true };
    }

    return { holds, rose: false };
}
