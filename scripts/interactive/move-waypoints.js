// Shared Shift+click waypoint support for interactive move pickers.

export function createWaypointCollector()
{
    let pending = [];
    let shiftHeld = false;
    const onKeyDown = (event) =>
    {
        if (event.key === 'Shift')
            shiftHeld = true;
    };
    const onKeyUp = (event) =>
    {
        if (event.key === 'Shift')
            shiftHeld = false;
    };
    document.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('keyup', onKeyUp, true);
    return {
        get list()
        {
            return pending;
        },
        get length()
        {
            return pending.length;
        },
        isAddClick(event)
        {
            const keyboardShift = !!(game.keyboard?.downKeys?.has('ShiftLeft') || game.keyboard?.downKeys?.has('ShiftRight'));
            return keyboardShift || shiftHeld || !!(event?.shiftKey ?? event?.data?.originalEvent?.shiftKey);
        },
        add(point)
        {
            pending.push(point);
        },
        take()
        {
            const taken = pending;
            pending = [];
            return taken;
        },
        clear()
        {
            pending = [];
        },
        dispose()
        {
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
        },
    };
}

export function movePathPoints(token, waypoints, destTopLeft = null)
{
    const points = [{ x: token.center.x, y: token.center.y }];
    for (const waypointRecord of waypoints ?? [])
        points.push({ x: waypointRecord.x + token.w / 2, y: waypointRecord.y + token.h / 2 });
    if (destTopLeft)
        points.push({ x: destTopLeft.x + token.w / 2, y: destTopLeft.y + token.h / 2 });
    return points;
}

export function drawMovePath(graphic, points, { markerRadius = 0 } = {})
{
    if (points.length < 2)
        return;
    graphic.moveTo(points[0].x, points[0].y);
    for (let pointIdx = 1; pointIdx < points.length; pointIdx++)
    {
        graphic.lineTo(points[pointIdx].x, points[pointIdx].y);
        if (markerRadius > 0 && pointIdx < points.length - 1)
        {
            graphic.drawCircle(points[pointIdx].x, points[pointIdx].y, markerRadius);
            graphic.moveTo(points[pointIdx].x, points[pointIdx].y);
        }
    }
}

export function movePathSegments(points)
{
    const lines = [];
    for (let pointIdx = 1; pointIdx < points.length; pointIdx++)
        lines.push({ x1: points[pointIdx - 1].x, y1: points[pointIdx - 1].y, x2: points[pointIdx].x, y2: points[pointIdx].y });
    return lines;
}

// One entry per distinct move: each waypoint is its own leg, dest last.
export function movePathLegs(waypoints, dest)
{
    return [...(Array.isArray(waypoints) ? waypoints : []), dest];
}
