import { straightLineDefault, straightLineFor, isForceDebugMovement } from './keybindings.js';
import { parseAction, isRealStop } from './movement-actions.js';
import { jumpRoundUp } from './jump-rules.js';
import { getMovementBands, getMoveDataList } from './move-tracking.js';
import { isPhasing } from './cost-rules.js';
import { bodyBlocksCell } from './ground.js';

const EPS = 1e-9;
const NO_LINE_ACTIONS = new Set(['forced', 'displace', 'blink', 'teleport']);
const INHERIT_ACTIONS = new Set(['climb', 'ignore']);
const FRESH = Object.freeze({ spent: 0, line: null });
const SEED_STATUSES = ['straight_line', 'hover', 'flying'];

const _seedCache = new Map();

function cubeOf(cube)
{
    return { q: cube.q, r: cube.r, s: -cube.q - cube.r };
}

const HEX_RING = {
    perimeter: 6,
    cell: (point) => cubeOf(/** @type {any} */ (canvas.grid).getCube(point)),
    fromOffset: (offset) => cubeOf(/** @type {any} */ (canvas.grid).getCube(offset)),
    around(offset, radius)
    {
        const center = cubeOf(/** @type {any} */ (canvas.grid).getCube(offset));
        const cells = [];

        for (let dq = -radius; dq <= radius; dq++)
        {
            for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, radius - dq); dr++)
            {
                if (!dq && !dr)
                    continue;

                const cell = { q: center.q + dq, r: center.r + dr, s: center.s - dq - dr };
                cells.push({ offset: canvas.grid.getOffset(/** @type {any} */ (cell)), cell });
            }
        }

        return cells;
    },
    same: (first, second) => first.q === second.q && first.r === second.r,
    delta: (from, to) => [to.q - from.q, to.r - from.r, to.s - from.s],
    radius: (delta) => Math.max(Math.abs(delta[0]), Math.abs(delta[1]), Math.abs(delta[2])),
    distance: (from, to) => Math.max(Math.abs(to.q - from.q), Math.abs(to.r - from.r), Math.abs(to.s - from.s)),
    position(delta, radius)
    {
        const [dq, dr, ds] = delta;

        if (dq === radius && dr <= 0 && dr > -radius)
            return -dr / radius;
        if (dr === -radius && ds >= 0 && ds < radius)
            return 1 + ds / radius;
        if (ds === radius && dq <= 0 && dq > -radius)
            return 2 - dq / radius;
        if (dq === -radius && dr >= 0 && dr < radius)
            return 3 + dr / radius;
        if (dr === radius && ds <= 0 && ds > -radius)
            return 4 - ds / radius;
        return 5 + dq / radius;
    }
};

const SQUARE_RING = {
    perimeter: 8,
    cell: (point) => canvas.grid.getOffset(point),
    fromOffset: (offset) => ({ i: offset.i, j: offset.j }),
    around(offset, radius)
    {
        const cells = [];

        for (let di = -radius; di <= radius; di++)
        {
            for (let dj = -radius; dj <= radius; dj++)
            {
                if (di || dj)
                    cells.push({ offset: { i: offset.i + di, j: offset.j + dj }, cell: { i: offset.i + di, j: offset.j + dj } });
            }
        }

        return cells;
    },
    same: (first, second) => first.i === second.i && first.j === second.j,
    delta: (from, to) => [to.j - from.j, to.i - from.i],
    radius: (delta) => Math.max(Math.abs(delta[0]), Math.abs(delta[1])),
    distance: (from, to) => Math.max(Math.abs(to.j - from.j), Math.abs(to.i - from.i)),
    position(delta, radius)
    {
        const [dx, dy] = delta;

        if (dx === radius && dy < radius)
            return (dy + radius) / radius;
        if (dy === radius && dx > -radius)
            return (3 * radius - dx) / radius;
        if (dx === -radius && dy > -radius)
            return (5 * radius - dy) / radius;
        return (7 * radius + dx) / radius;
    }
};

export function straightRing()
{
    return ringGeometry();
}

export function lineStateKey(line)
{
    if (!line)
        return '-';
    return [Object.values(line.origin).join(','), line.steps, line.lo.toFixed(9), line.hi.toFixed(9)].join(':');
}

function ringGeometry()
{
    const grid = canvas?.grid;
    if (!grid || grid.isGridless)
        return null;
    if (grid.isHexagonal)
        return HEX_RING;
    return /** @type {any} */ (grid).diagonals === CONST.GRID_DIAGONALS.ILLEGAL ? null : SQUARE_RING;
}

function arcOf(ring, origin, cell, near)
{
    const delta = ring.delta(origin, cell);
    const radius = ring.radius(delta);
    if (!radius)
        return { radius, lo: -Infinity, hi: Infinity };

    let center = ring.position(delta, radius);
    if (Number.isFinite(near))
        center += Math.round((near - center) / ring.perimeter) * ring.perimeter;

    const half = 0.5 / radius;
    return { radius, lo: center - half, hi: center + half };
}

function lineMid(line)
{
    return line.steps > 0 ? (line.lo + line.hi) / 2 : Number.NaN;
}

export function freshLine(origin)
{
    return { origin, steps: 0, lo: -Infinity, hi: Infinity };
}

export function continuesLine(ring, line, from, to)
{
    if (!line || line.steps <= 0)
        return false;
    if (ring.distance(line.origin, to) !== line.steps + ring.distance(from, to))
        return false;

    const arc = arcOf(ring, line.origin, to, lineMid(line));
    return Math.min(arc.hi, line.hi) - Math.max(arc.lo, line.lo) > EPS;
}

export function extendLine(ring, line, to)
{
    const arc = arcOf(ring, line.origin, to, lineMid(line));
    if (!arc.radius)
        return line;
    if (line.steps <= 0)
        return { origin: line.origin, steps: arc.radius, lo: arc.lo, hi: arc.hi };
    return { origin: line.origin, steps: arc.radius, lo: Math.max(line.lo, arc.lo), hi: Math.min(line.hi, arc.hi) };
}

export function bandEdges(token)
{
    const bands = getMovementBands(token).filter(band => band.size > 0);
    return { maxima: bands.map(band => band.max), size: bands.at(-1)?.size ?? 0 };
}

export function actionSpan(edges, spent)
{
    let start = 0;

    for (const max of edges.maxima)
    {
        if (max > spent + EPS)
            return { start, end: max };
        start = max;
    }

    const size = edges.size || 1;
    const extra = Math.floor((spent - start) / size + EPS);
    return { start: start + extra * size, end: start + (extra + 1) * size };
}

function resolvePlaces(tokenDoc, waypoints)
{
    const source = tokenDoc._source;
    let { x, y, width, height, shape } = source;
    let action = tokenDoc.movementAction;

    return waypoints.map(waypoint =>
    {
        x = waypoint.x ?? x;
        y = waypoint.y ?? y;
        width = waypoint.width ?? width;
        height = waypoint.height ?? height;
        shape = waypoint.shape ?? shape;
        action = waypoint.action ?? action;
        return { x, y, width, height, shape, action, movementId: waypoint.movementId ?? null };
    });
}

function centerOf(tokenDoc, place)
{
    const gridSize = canvas.grid.size;
    const size = tokenDoc.getSize?.(place) ?? { width: place.width * gridSize, height: place.height * gridSize };
    return { x: place.x + size.width / 2, y: place.y + size.height / 2 };
}

function samePlace(first, second)
{
    return !!first && !!second && Math.round(first.x) === Math.round(second.x) && Math.round(first.y) === Math.round(second.y);
}

function lineKind(action)
{
    const { base, free } = parseAction(action);
    if (free)
        return 'free';
    if (NO_LINE_ACTIONS.has(base) || CONFIG.Token.movement.actions[base]?.teleport)
        return 'none';
    return 'move';
}

function tokenPaths(tokenDoc, places, centers)
{
    const memo = new Map();

    return (from, to) =>
    {
        const key = `${from}|${to}`;
        let path = memo.get(key);

        if (!path)
        {
            try
            {
                const dims = { width: places[from].width, height: places[from].height, shape: places[from].shape };
                const anchorOf = (place) => tokenDoc._positionToGridOffset({ x: place.x, y: place.y, ...dims });
                path = canvas.grid.getDirectPath([anchorOf(places[from]), anchorOf(places[to])])
                    .map(anchor => canvas.grid.getOffset(centerOf(tokenDoc, { ...tokenDoc._gridOffsetToPosition(anchor, dims), ...dims })));
            }
            catch
            {
                path = canvas.grid.getDirectPath([centers[from], centers[to]]);
            }

            memo.set(key, path);
        }

        return path;
    };
}

function followsDirectPath(ring, cells, pathBetween, from, to)
{
    const path = pathBetween(from, to).map(offset => ring.fromOffset(offset));
    let cursor = 1;

    for (let index = from + 1; index < to; index++)
    {
        if (ring.same(cells[index], cells[index - 1]))
            continue;
        while (cursor < path.length && !ring.same(path[cursor], cells[index]))
            cursor++;
        if (cursor >= path.length)
            return false;
        cursor++;
    }

    return true;
}

function lineVertices(ring, cells, pathBetween, waypoints, places, jumps)
{
    const last = places.length - 1;
    const anchors = [];
    const softStops = new Set();

    for (let index = 1; index < last; index++)
    {
        const waypoint = waypoints[index];
        const vertex = waypoint.checkpoint && !waypoint.intermediate;
        const kindEdge = lineKind(places[index].action) !== lineKind(places[index + 1].action);
        const jumpEdge = !!jumps[index - 1] !== !!jumps[index] || (jumps[index - 1] && isRealStop(waypoint));
        if (vertex || jumpEdge || kindEdge)
            anchors.push(index);
        if (!kindEdge && ((jumpEdge && !vertex) || (vertex && waypoint.explicit !== true)))
            softStops.add(index);
    }

    anchors.push(last);
    const stops = [0];
    const through = new Set();
    const splitsLine = (waypoint) => waypoint.intermediate && waypoint.explicit;
    const straightRuns = new Map();
    let runStart = 0;

    const runIsStraight = (start, end) =>
    {
        const memoKey = `${start}|${end}`;
        if (straightRuns.has(memoKey))
            return straightRuns.get(memoKey);

        const joints = [start];

        for (let index = start + 1; index < end; index++)
        {
            if (softStops.has(index) && waypoints[index].checkpoint && !waypoints[index].intermediate)
                joints.push(index);
        }

        joints.push(end);
        const line = pathBetween(start, end).map(offset => ring.fromOffset(offset));
        const straight = followsDirectPath(ring, cells, pathBetween, start, end)
            || (joints.every((joint, index) => index === 0 || followsDirectPath(ring, cells, pathBetween, joints[index - 1], joint))
                && joints.slice(1, -1).every(joint => line.some(cell => ring.same(cell, cells[joint]))));

        straightRuns.set(memoKey, straight);
        return straight;
    };

    for (const anchor of anchors)
    {
        while (stops.at(-1) < anchor)
        {
            const from = stops.at(-1);
            let to = anchor;
            const runEnd = anchors.find(next => next >= anchor && !softStops.has(next));
            const straightRun = (softStops.has(from) || softStops.has(to)) && runIsStraight(runStart, runEnd);

            if (straightRun && softStops.has(from))
                through.add(from);
            if (straightRun && softStops.has(to))
                through.add(to);

            if (!straightRun && !followsDirectPath(ring, cells, pathBetween, from, to))
            {
                to = -1;

                for (let index = anchor - 1; index > from; index--)
                {
                    if (splitsLine(waypoints[index]) && followsDirectPath(ring, cells, pathBetween, from, index))
                    {
                        to = index;
                        break;
                    }
                }

                if (to < 0)
                {
                    to = anchor - 1;
                    while (to > from + 1 && !followsDirectPath(ring, cells, pathBetween, from, to))
                        to--;
                }
            }

            stops.push(to);
            if (!softStops.has(to))
                runStart = to;
        }
    }

    return { stops, through };
}

function legIsStraight(tokenDoc, place, history, line)
{
    const { base, free } = parseAction(place.action);
    if (free || NO_LINE_ACTIONS.has(base) || CONFIG.Token.movement.actions[base]?.teleport)
        return false;

    const explicit = place.movementId && history.ids.has(place.movementId)
        ? straightLineDefault(tokenDoc, place.action) !== (history.flips.get(place.movementId) ?? false)
        : straightLineFor(tokenDoc, place.action);

    return explicit || (INHERIT_ACTIONS.has(base) && !!line);
}

function lineBlocker(tokenDoc, history)
{
    if (history.recorded || isPhasing(tokenDoc))
        return null;

    const single = (tokenDoc.width ?? 1) === 1 && (tokenDoc.height ?? 1) === 1;

    return (offset, shift) =>
    {
        let footprint = [offset];

        if (!single)
        {
            const center = canvas.grid.getCenterPoint(offset);

            try
            {
                footprint = tokenDoc.getOccupiedGridSpaceOffsets({ x: center.x - shift.x, y: center.y - shift.y, width: tokenDoc.width, height: tokenDoc.height, shape: tokenDoc.shape });
            }
            catch
            {
                footprint = [offset];
            }
        }

        return footprint.some(cell => bodyBlocksCell(tokenDoc, cell.j, cell.i));
    };
}

function findBlock(blocker, centers, places, pathBetween, from, to)
{
    for (let seg = from; seg < to; seg++)
    {
        const shift = { x: centers[seg].x - places[seg].x, y: centers[seg].y - places[seg].y };
        const path = pathBetween(seg, seg + 1);

        for (let step = 1; step < path.length; step++)
        {
            if (!blocker(path[step], shift))
                continue;

            const freeCenter = canvas.grid.getCenterPoint(path[step - 1]);
            return { index: seg + 1, cell: path[step], free: { x: freeCenter.x - shift.x, y: freeCenter.y - shift.y } };
        }
    }

    return null;
}

function walkLegs(tokenDoc, ring, waypoints, costs, { start, edges, history, jumps = [], jumpActions = jumps })
{
    const places = resolvePlaces(tokenDoc, waypoints);
    const burns = new Array(costs.length).fill(0);
    const discounts = new Array(costs.length).fill(0);
    const lost = new Array(places.length).fill(0);
    const centers = places.map(place => centerOf(tokenDoc, place));
    const cells = centers.map(center => ring.cell(center));
    const pathBetween = tokenPaths(tokenDoc, places, centers);
    const { stops, through } = lineVertices(ring, cells, pathBetween, waypoints, places, jumps);
    const blocker = lineBlocker(tokenDoc, history);
    let block = null;
    let spent = start.spent;
    let line = start.line;
    let airborne = !!start.airborne;
    let landed = !!start.landed;

    const roundedUp = (seg, unit, walked) => (!history.recorded && jumps[seg] ? jumpRoundUp(actionSpan(edges, walked).end, walked, unit) : 0);

    const restartCell = (restart) => (restart.cell
        ?? ring.fromOffset(pathBetween(restart.seg, restart.seg + 1).at(restart.step) ?? canvas.grid.getOffset(centers[restart.seg + 1])));

    const firstRestart = (from, to, legCosts) =>
    {
        let walked = spent;

        for (let seg = from; seg < to; seg++)
        {
            const cost = legCosts[seg - from];
            if (!Number.isFinite(cost))
                return null;

            const steps = ring.radius(ring.delta(cells[seg], cells[seg + 1]));

            if (!steps)
            {
                const end = actionSpan(edges, walked).end;
                walked += cost;
                if (cost > EPS && walked >= end - EPS)
                    return { cell: cells[seg] };
                continue;
            }

            const unit = cost / steps;

            for (let step = 1; step <= steps; step++)
            {
                const end = actionSpan(edges, walked).end;
                walked += unit - roundedUp(seg, unit, walked);
                if (unit > EPS && walked >= end - EPS)
                    return { seg, step };
            }
        }

        return null;
    };

    const endsOffLine = (from, to, legCosts) =>
    {
        const restart = history.recorded ? null : firstRestart(from, to, legCosts);
        if (!restart)
            return false;

        const cell = restartCell(restart);
        return !ring.same(cell, cells[from]) && !ring.same(cell, cells[to]) && !continuesLine(ring, line, cells[from], cell);
    };

    for (let stopIdx = 0; stopIdx < stops.length - 1; stopIdx++)
    {
        const from = stops[stopIdx];
        const to = stops[stopIdx + 1];
        const moving = !ring.same(cells[from], cells[to]);
        const legCosts = costs.slice(from, to);

        if (airborne && (landed || !jumpActions[from]))
        {
            landed = true;

            if (lineKind(places[to].action) === 'move' && (moving || legCosts.some(cost => cost > EPS)))
            {
                const span = actionSpan(edges, spent);

                if (spent - span.start > EPS)
                {
                    const burn = span.end - spent;
                    spent = span.end;
                    lost[from] += burn;
                    if (history.recorded)
                        legCosts[0] = Math.max(0, legCosts[0] - burn);
                    else
                        burns[from] += burn;
                    line = null;
                }

                airborne = false;
                landed = false;
            }
        }

        const straight = moving && legIsStraight(tokenDoc, places[to], history, line);
        const planned = !(places[to].movementId && history.ids.has(places[to].movementId));

        if (blocker && !block && straight && planned && parseAction(places[to].action).base !== 'fly')
            block = findBlock(blocker, centers, places, pathBetween, from, to);

        if (straight && line?.steps > 0 && !through.has(from) && (!continuesLine(ring, line, cells[from], cells[to]) || endsOffLine(from, to, legCosts)))
        {
            const span = actionSpan(edges, spent);

            if (spent - span.start > EPS)
            {
                const burn = span.end - spent;
                spent = span.end;
                lost[from] += burn;
                if (history.recorded)
                    legCosts[0] = Math.max(0, legCosts[0] - burn);
                else
                    burns[from] += burn;
            }

            line = null;
        }

        if (straight)
            line ??= freshLine(cells[from]);

        let restart = null;

        for (let seg = from; seg < to; seg++)
        {
            const cost = legCosts[seg - from];
            if (!Number.isFinite(cost))
                return { burns, discounts, lost, end: { spent, line: null }, block };

            if (jumps[seg] && cost > EPS)
                airborne = true;

            const steps = ring.radius(ring.delta(cells[seg], cells[seg + 1]));

            if (!steps)
            {
                const end = actionSpan(edges, spent).end;
                spent += cost;
                if (cost > EPS && spent >= end - EPS)
                    restart = { cell: cells[seg] };
                continue;
            }

            const unit = cost / steps;

            for (let step = 1; step <= steps; step++)
            {
                const end = actionSpan(edges, spent).end;
                const rounded = roundedUp(seg, unit, spent);
                discounts[seg] += rounded;
                spent += unit - rounded;
                if (unit > EPS && spent >= end - EPS)
                    restart = { seg, step };
            }
        }

        if (!straight)
        {
            if (moving)
                line = null;
            else if (restart && line)
                line = freshLine(restartCell(restart));
        }
        else
        {
            if (restart)
                line = freshLine(restartCell(restart));
            if (!through.has(to))
                line = extendLine(ring, line, cells[to]);
        }

        if (airborne && isRealStop(waypoints[to]))
            landed = true;
    }

    return { burns, discounts, lost, end: { spent, line, airborne, landed }, block };
}

function historyContext(tokenDoc, recorded)
{
    const ids = new Set(recorded.map(waypoint => waypoint.movementId).filter(Boolean));
    const flips = new Map();

    if (ids.size)
    {
        for (const move of getMoveDataList(tokenDoc))
        {
            if (move.movementId && ids.has(move.movementId))
                flips.set(move.movementId, !!move.straightFlip);
        }
    }

    return { ids, flips };
}

function historySeed(tokenDoc, ring, recorded, history, edges)
{
    const last = recorded.at(-1);
    const statuses = SEED_STATUSES.map(id => (tokenDoc.actor?.statuses?.has(id) ? 1 : 0)).join('') + (straightLineDefault(tokenDoc, 'walk') ? 1 : 0);
    const key = [recorded.length, last.movementId, Math.round(last.x), Math.round(last.y), edges.maxima.join(','), [...history.flips.values()].map(Number).join(''), statuses].join('|');
    const cached = _seedCache.get(tokenDoc.id);

    if (cached?.key === key && cached.ring === ring)
        return cached.seed;

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const costs = recorded.slice(1).map(waypoint => (Number.isFinite(waypoint.cost) ? waypoint.cost : 0) / sceneDistance);
    const jumps = resolvePlaces(tokenDoc, recorded).slice(1).map(place =>
    {
        const { base, free } = parseAction(place.action);
        return base === 'jump' && !free;
    });

    const seed = walkLegs(tokenDoc, ring, recorded, costs, { start: FRESH, edges, jumps, history: { ...history, recorded: true } }).end;
    _seedCache.set(tokenDoc.id, { key, ring, seed });
    return seed;
}

function startState(tokenDoc, ring, places, waypoints, recorded, history, edges)
{
    if (!recorded.length)
        return FRESH;

    const firstId = waypoints[0]?.movementId;
    if (firstId && firstId === recorded[0].movementId && samePlace(places[0], recorded[0]))
        return FRESH;
    if (!samePlace(places[0], recorded.at(-1)))
        return FRESH;
    return historySeed(tokenDoc, ring, recorded, history, edges);
}

export function applyStraightLines(tokenDoc, waypoints, result)
{
    const ring = ringGeometry();
    if (!ring || !Array.isArray(waypoints) || waypoints.length < 2 || !result?.segments?.length)
        return result;
    if (result.waypoints?.length !== waypoints.length || isForceDebugMovement())
        return result;

    const recorded = tokenDoc.movementHistory ?? [];
    const history = historyContext(tokenDoc, recorded);
    const places = resolvePlaces(tokenDoc, waypoints);
    const anyStraight = [...history.flips.values()].some(Boolean)
        || places.some(place => straightLineFor(tokenDoc, place.action) || straightLineDefault(tokenDoc, place.action))
        || resolvePlaces(tokenDoc, recorded).some(place => parseAction(place.action).base === 'jump');

    if (!anyStraight)
        return result;

    const edges = bandEdges(tokenDoc.object ?? tokenDoc);
    if (!edges.maxima.length)
        return result;

    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const start = startState(tokenDoc, ring, places, waypoints, recorded, history, edges);
    const costs = result.segments.map(segment => Number(segment.cost) / sceneDistance);

    const jumpActions = result.segments.map((_segment, index) =>
    {
        const { base, free } = parseAction(places[index + 1].action);
        return base === 'jump' && !free;
    });

    const jumps = result.segments.map((segment, index) => jumpActions[index] && !segment.to?.lancerJumpIllegal);

    const walked = walkLegs(tokenDoc, ring, waypoints, costs, { start, edges, jumps, jumpActions, history: { ...history, recorded: false } });
    let added = 0;
    let saved = 0;

    result.segments.forEach((segment, index) =>
    {
        const burn = walked.burns[index] * sceneDistance;
        const discount = walked.discounts[index] * sceneDistance;

        if (burn > 0)
        {
            segment.cost += burn;
            if (segment.to)
                segment.to.lancerStraightBurn = burn;
            added += burn;
        }

        if (discount > 0)
        {
            const groupEnd = result.segments.slice(index).find(later => later.to?.lancerJumpExtra > 0);

            segment.cost -= discount;
            saved += discount;
            if (groupEnd)
                groupEnd.to.lancerJumpExtra -= discount;
        }

        if (added !== saved && segment.to)
            segment.to.cost += added - saved;
    });

    walked.lost.forEach((lost, index) =>
    {
        if (lost > 0)
            result.waypoints[index].lancerStraightLost = lost * sceneDistance;
    });

    if (walked.block)
    {
        for (let index = walked.block.index; index < result.waypoints.length; index++)
            result.waypoints[index].lancerStraightBlocked = true;
        result.lancerStraightBlock = walked.block;
    }

    result.cost += added - saved;
    result.lancerStraightBurn = added;
    result.lancerStraightEnd = walked.end;
    return result;
}

export function straightLineBlock(tokenDoc, waypoints)
{
    if (!Array.isArray(waypoints) || waypoints.length < 2)
        return null;
    return tokenDoc.measureMovementPath(waypoints)?.lancerStraightBlock ?? null;
}

export function isStraightMove(tokenDoc, action)
{
    return lineKind(action) === 'move' && straightLineFor(tokenDoc, action) && !!ringGeometry();
}

export function straightStartState(tokenDoc, waypoint)
{
    const ring = ringGeometry();
    if (!ring || !waypoint)
        return null;

    const edges = bandEdges(tokenDoc.object ?? tokenDoc);
    if (!edges.maxima.length)
        return null;

    const recorded = tokenDoc.movementHistory ?? [];
    const history = historyContext(tokenDoc, recorded);
    return startState(tokenDoc, ring, resolvePlaces(tokenDoc, [waypoint]), [waypoint], recorded, history, edges);
}

export function straightStateAfter(tokenDoc, waypoints)
{
    if (!Array.isArray(waypoints) || !waypoints.length)
        return null;
    if (waypoints.length === 1)
        return straightStartState(tokenDoc, waypoints[0]);

    const result = tokenDoc.measureMovementPath(waypoints);
    if (result?.lancerStraightEnd)
        return result.lancerStraightEnd;

    const start = straightStartState(tokenDoc, waypoints[0]);
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    return { spent: (start?.spent ?? 0) + (Number(result?.cost) || 0) / sceneDistance, line: null };
}
