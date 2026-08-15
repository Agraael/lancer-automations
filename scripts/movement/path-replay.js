// Path replay for movement cancel/redirect: follows the route the token actually dragged.

function posEq(first, second)
{
    return Math.round(first.x) === Math.round(second.x) && Math.round(first.y) === Math.round(second.y);
}

export function getOriginalMovePath(document, options)
{
    const waypoints = options?.movement?.[document.id]?.waypoints;
    return Array.isArray(waypoints) ? waypoints.map(waypoint => ({ ...waypoint })) : [];
}

export function legUsable(leg, startPos)
{
    return Array.isArray(leg) && leg.length > 0 && !(leg.length === 1 && posEq(leg[0], startPos));
}

function densify(token, startPos, waypoints, action)
{
    const doc = token.document;
    const src = doc._source;
    const startWp = {
        x: startPos.x,
        y: startPos.y,
        elevation: startPos.elevation ?? doc.elevation ?? 0,
        width: src.width,
        height: src.height,
        shape: src.shape,
        action: action ?? waypoints[0]?.action
    };
    const path = [startWp, ...waypoints];
    const terrainPath = token.createTerrainMovementPath ? token.createTerrainMovementPath(path, { preview: true }) : path;
    return { densePath: doc.getCompleteMovementPath(terrainPath), src };
}

function boundaryWaypoint(cell, src, action)
{
    return {
        x: cell.x,
        y: cell.y,
        elevation: cell.elevation,
        width: src.width,
        height: src.height,
        shape: src.shape,
        action: cell.action ?? action,
        snapped: true,
        explicit: false,
        checkpoint: true
    };
}

// Legs cut at cost budgets (grid units); legs.length === budgets.length + 1. Null when the walk fails.
export function splitPathAtCosts(token, waypoints, startPos, budgets, action)
{
    try
    {
        if (!Array.isArray(waypoints) || !waypoints.length)
            return null;
        const { densePath, src } = densify(token, startPos, waypoints, action);
        const hasFlyAction = densePath.some(cell => String(cell.action ?? '').includes('fly'));
        const measureInput = hasFlyAction ? densePath : densePath.map(cell => ({ ...cell, checkpoint: true }));
        const measure = token.measureMovementPath(measureInput, { preview: true });
        const sceneDist = canvas.scene?.grid?.distance ?? 1;
        const targets = budgets.map(budget => budget * sceneDist);
        const legs = [[]];
        let cumCost = 0;
        let wpCursor = 0;
        let targetIdx = 0;
        const closeLeg = (cell) =>
        {
            const currentLeg = legs.at(-1);
            const lastWp = currentLeg.at(-1);
            if (!lastWp || !posEq(lastWp, cell))
                currentLeg.push(boundaryWaypoint(cell, src, action));
            legs.push([]);
        };
        const snappedBoundaryIdx = (denseIdx) =>
        {
            let backIdx = denseIdx - 1;
            while (backIdx > 0 && densePath[backIdx].snapped === false)
                backIdx--;
            return backIdx;
        };
        for (let denseIdx = 1; denseIdx < densePath.length; denseIdx++)
        {
            const segCost = Number(measure.waypoints?.[denseIdx]?.backward?.cost ?? 0);
            while (targetIdx < targets.length && cumCost + segCost > targets[targetIdx] + 1e-6)
            {
                closeLeg(densePath[snappedBoundaryIdx(denseIdx)]);
                targetIdx++;
            }
            cumCost += segCost;
            while (wpCursor < waypoints.length && posEq(waypoints[wpCursor], densePath[denseIdx]))
            {
                const consumed = waypoints[wpCursor];
                legs.at(-1).push(consumed);
                wpCursor++;
                const nextWp = waypoints[wpCursor];
                if (nextWp && posEq(nextWp, consumed) && nextWp.elevation !== consumed.elevation)
                    break;
            }
        }
        while (targetIdx < targets.length)
        {
            closeLeg(densePath.at(-1));
            targetIdx++;
        }
        if (wpCursor !== waypoints.length)
            return null;
        return legs;
    }
    catch (err)
    {
        console.warn('lancer-automations | path split failed, falling back to beeline', err);
        return null;
    }
}

// Original route truncated at the redirect position; null when the position is off the path.
export function trimPathToPosition(token, waypoints, startPos, position, action)
{
    try
    {
        if (!Array.isArray(waypoints) || !waypoints.length || !position)
            return null;
        const { densePath, src } = densify(token, startPos, waypoints, action);
        const trimmed = [];
        let wpCursor = 0;
        for (let denseIdx = 1; denseIdx < densePath.length; denseIdx++)
        {
            const cell = densePath[denseIdx];
            while (wpCursor < waypoints.length && posEq(waypoints[wpCursor], cell))
            {
                const consumed = waypoints[wpCursor];
                trimmed.push(consumed);
                wpCursor++;
                const nextWp = waypoints[wpCursor];
                if (nextWp && posEq(nextWp, consumed) && nextWp.elevation !== consumed.elevation)
                    break;
            }
            if (posEq(cell, position))
            {
                const lastWp = trimmed.at(-1);
                if (!lastWp || !posEq(lastWp, cell))
                    trimmed.push(boundaryWaypoint(cell, src, action));
                return trimmed;
            }
        }
        return null;
    }
    catch (err)
    {
        console.warn('lancer-automations | path trim failed, falling back to beeline', err);
        return null;
    }
}
