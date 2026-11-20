import { evalCellStep, footprintShapesAt, footprintRestingSurface, jumpSize, jumpReach } from './cost-rules.js';
import { actionSpan, continuesLine } from './straight-line.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { CLIMB_WAYPOINTS_SETTING, jumpRoundUp, stampsClimb, walkJumpAir, walkJumpRests } from './jump-rules.js';

const EPS = 1e-9;

export function makePairCache(cellIndex)
{
    const memo = new Map();

    return (from, to, first, second, third, fourth, compute) =>
    {
        const fromIndex = cellIndex(from);
        let row = memo.get(fromIndex);

        if (!row)
        {
            row = new Map();
            memo.set(fromIndex, row);
        }

        const toIndex = cellIndex(to);
        let entries = row.get(toIndex);

        if (!entries)
        {
            entries = [];
            row.set(toIndex, entries);
        }

        for (let index = 0; index < entries.length; index++)
        {
            const entry = entries[index];
            if (entry.first === first && entry.second === second && entry.third === third && entry.fourth === fourth)
                return entry.value;
        }

        const value = compute();
        entries.push({ first, second, third, fourth, value });
        return value;
    };
}

export function makeJumpReach(base)
{
    const { tokenDoc, ring, edges, ctx, typeById, flying, footprintCache, cellIndex, keyOf, footprintKeysOf, cellBlocked, wallBlocked, facingMatters, facingAfterStep, startOffset, originX, originY, sceneDistance } = base;
    const jumpHeight = jumpSize(tokenDoc);
    const airHexes = jumpReach(tokenDoc);
    const climbStamps = !!getModuleSetting(CLIMB_WAYPOINTS_SETTING);
    const bandSizes = edges.maxima.map((max, index) => max - (edges.maxima[index - 1] ?? 0));
    const smallestBand = Math.max(1, Math.min(...bandSizes));
    const wallCache = makePairCache(cellIndex);
    const billCache = makePairCache(cellIndex);
    const legCache = makePairCache(cellIndex);
    const facingX = (facing) => (facingMatters ? facing?.x : 0);
    const facingY = (facing) => (facingMatters ? facing?.y : 0);
    const footByIndex = new Map();

    const footAt = (offset) =>
    {
        const index = cellIndex(offset);
        let fpResult = footByIndex.get(index);

        if (!fpResult)
        {
            const cacheKey = keyOf(offset);
            fpResult = footprintCache.get(cacheKey);

            if (!fpResult)
            {
                fpResult = footprintShapesAt(tokenDoc, offset, typeById, { flyerBodies: flying });
                footprintCache.set(cacheKey, fpResult);
            }

            footByIndex.set(index, fpResult);
        }

        return fpResult;
    };

    const surfaceMemo = { hold: new Map(), ground: new Map() };

    const restingAt = (offset, reference, mode) =>
    {
        const index = cellIndex(offset);
        let byReference = surfaceMemo[mode].get(index);

        if (!byReference)
        {
            byReference = new Map();
            surfaceMemo[mode].set(index, byReference);
        }

        let rest = byReference.get(reference);

        if (rest === undefined)
        {
            rest = footprintRestingSurface(footAt(offset), typeById, ctx.zHeight, reference, mode, ctx.standingRule, ctx.moverSize);
            byReference.set(reference, rest);
        }

        return rest;
    };

    const holdOf = (offset, reference) => restingAt(offset, reference, 'hold')?.surface ?? null;

    const groundOf = (offset, reference, landing = false) =>
    {
        const rest = restingAt(offset, reference, 'ground');
        if (!rest)
            return reference;
        return landing ? rest.landingSurface : rest.surface;
    };

    const wallBetween = (fromOffset, toOffset, facing, elevation) =>
        !!wallBlocked && wallCache(fromOffset, toOffset, elevation, 0, facingX(facing), facingY(facing), () => !!wallBlocked(fromOffset, toOffset, facing, elevation));

    const stepBill = (fromOffset, toOffset, elevation, landing) =>
        billCache(fromOffset, toOffset, elevation, landing ? 1 : 0, 0, 0, () => evalCellStep(tokenDoc, toOffset, { prevFootprintKeys: footprintKeysOf(fromOffset), tokenElev: elevation, floor: elevation, manualDelta: 0, landing }, ctx));

    let anchorOrigin = null;

    try
    {
        anchorOrigin = tokenDoc._positionToGridOffset({ x: originX, y: originY, width: tokenDoc.width, height: tokenDoc.height, shape: tokenDoc.shape });
    }
    catch
    {
        anchorOrigin = null;
    }

    const hexGrid = /** @type {any} */ (canvas.grid);
    const hexAnchors = !!anchorOrigin && canvas.grid.isHexagonal;
    const startCube = hexAnchors ? hexGrid.getCube(startOffset) : null;
    const anchorCube = hexAnchors ? hexGrid.getCube(anchorOrigin) : null;
    const anchorShifted = !!anchorOrigin && (anchorOrigin.i !== startOffset.i || anchorOrigin.j !== startOffset.j);

    const shiftCell = (offset, sign) =>
    {
        if (!hexAnchors)
            return { i: offset.i + sign * (anchorOrigin.i - startOffset.i), j: offset.j + sign * (anchorOrigin.j - startOffset.j) };

        const cube = hexGrid.getCube(offset);
        return hexGrid.getOffset({ q: cube.q + sign * (anchorCube.q - startCube.q), r: cube.r + sign * (anchorCube.r - startCube.r), s: cube.s + sign * (anchorCube.s - startCube.s) });
    };

    const legPath = (fromOffset, toOffset) =>
    {
        if (!anchorOrigin)
            return canvas.grid.getDirectPath([canvas.grid.getCenterPoint(fromOffset), canvas.grid.getCenterPoint(toOffset)]);
        if (!anchorShifted)
            return canvas.grid.getDirectPath([fromOffset, toOffset]);
        return canvas.grid.getDirectPath([shiftCell(fromOffset, 1), shiftCell(toOffset, 1)]).map(step => shiftCell(step, -1));
    };

    const pathCache = makePairCache(cellIndex);
    const runCache = makePairCache(cellIndex);
    const pathOf = (fromOffset, toOffset) => pathCache(fromOffset, toOffset, 0, 0, 0, 0, () => legPath(fromOffset, toOffset));

    const plainRunOf = (fromOffset, toOffset) => runCache(fromOffset, toOffset, 0, 0, 0, 0, () =>
    {
        const path = pathOf(fromOffset, toOffset);
        let run = 0;

        while (run + 1 < path.length && plainAt(path[run + 1]))
            run++;
        return { run, whole: run === path.length - 1 };
    });

    const legNow = { path: null, last: 0 };

    const airRules = {
        holdAt: (index, height) => holdOf(legNow.path[index], height),
        groundAt: (index, height, landing) => groundOf(legNow.path[index], height, landing),
        landsAt: index => index === legNow.last
    };

    const restRules = {
        takeoff: 0,
        jumpHeight,
        airHexes,
        counts: () => true,
        jumping: () => true,
        landsAt: index => index === legNow.last,
        holdAt: (index, height) => holdOf(legNow.path[index], height),
        groundAt: (index, height) => restingAt(legNow.path[index], height, 'ground') ?? { surface: height },
        restAt: (index, lastSurface) => (index === legNow.last
            ? { surface: groundOf(legNow.path[index], lastSurface, true) }
            : restingAt(legNow.path[index], lastSurface, 'ground') ?? { surface: lastSurface }),
        sameHex: () => false,
        hexesBetween: (fromIdx, toIdx) => toIdx - fromIdx,
        landingLift: () => 0
    };

    const wholeJump = (path, takeoff, facing) =>
    {
        const last = path.length - 1;
        const air = { elevation: takeoff, peak: takeoff, run: 0, span: 0 };
        legNow.path = path;
        legNow.last = last;
        const { holds } = walkJumpAir(path.length, air, airRules);

        const deep = takeoff - air.elevation > jumpHeight + EPS || air.span > airHexes;
        if (deep || air.peak > takeoff + EPS)
            holds.clear();

        let elevation = takeoff;
        let highest = takeoff;
        let walkCost = 0;
        let landingPenalty = 0;
        let legFacing = facing;

        for (let index = 1; index <= last; index++)
        {
            if (wallBetween(path[index - 1], path[index], legFacing, elevation * sceneDistance))
                return null;
            if (facingMatters)
                legFacing = facingAfterStep(legFacing, path[index - 1], path[index]);

            if (holds.has(index))
                continue;

            const bill = stepBill(path[index - 1], path[index], elevation, index === last);
            walkCost += 1 + (bill.stepClimbCost + bill.stepMalus) / sceneDistance + bill.penalty;
            elevation = bill.nextTokenElev;
            highest = Math.max(highest, elevation);
            if (index === last)
                landingPenalty = bill.penalty;
        }

        const legal = !deep && takeoff - elevation <= jumpHeight + EPS && highest - takeoff <= (last <= 1 ? jumpHeight + EPS : EPS);
        const piece = legal ? { jump: true, steps: last, cost: 2 * last + landingPenalty } : { jump: false, steps: last, cost: walkCost };
        return { pieces: [piece], landing: elevation, facing: legFacing, steps: last };
    };

    const jumpPieces = (fromOffset, toOffset, takeoff, facing) =>
    {
        const path = pathOf(fromOffset, toOffset);
        const last = path.length - 1;
        if (last < 1)
            return null;

        for (let index = 1; index <= last; index++)
        {
            if (cellBlocked(path[index]))
                return null;
        }

        if (!climbStamps)
            return wholeJump(path, takeoff, facing);

        legNow.path = path;
        legNow.last = last;
        restRules.takeoff = takeoff;
        const rests = walkJumpRests(path.length, restRules);

        const surfaceAt = (index) => (index === 0 ? takeoff : rests[index - 1].surface);
        const hop = last <= 1 && surfaceAt(last) - takeoff <= jumpHeight + EPS;
        const stampRule = { climbDown: false, hop, jumpHeight };
        const downRule = { climbDown: true, hop, jumpHeight };
        const pieces = [];
        let legFacing = facing;
        let jumpSteps = 0;

        const closeJump = (endIndex) =>
        {
            if (!jumpSteps)
                return;

            const penalty = stepBill(path[endIndex - 1], path[endIndex], surfaceAt(endIndex - 1), endIndex === last).penalty;
            pieces.push({ jump: true, steps: jumpSteps, cost: 2 * jumpSteps + penalty });
            jumpSteps = 0;
        };

        for (let index = 1; index <= last; index++)
        {
            const from = surfaceAt(index - 1);
            if (wallBetween(path[index - 1], path[index], legFacing, from * sceneDistance))
                return null;
            if (facingMatters)
                legFacing = facingAfterStep(legFacing, path[index - 1], path[index]);

            const rest = rests[index - 1];
            if (!stampsClimb(rest.surface, from, rest.climbDown ? downRule : stampRule))
            {
                jumpSteps++;
                continue;
            }

            closeJump(index - 1);
            const bill = stepBill(path[index - 1], path[index], surfaceAt(index - 1), index === last);
            pieces.push({ jump: false, steps: 1, cost: 1 + (bill.stepClimbCost + bill.stepMalus) / sceneDistance + bill.penalty });
        }

        closeJump(last);
        return { pieces, landing: surfaceAt(last), facing: legFacing, steps: last };
    };

    const jumpLeg = (node, target, startSpent) =>
    {
        const leg = legCache(node.offset, target, node.elevation, 0, facingX(node.facing), facingY(node.facing), () => jumpPieces(node.offset, target, node.elevation, node.facing));
        if (!leg)
            return null;

        let spent = startSpent;
        let airborne = false;

        for (const piece of leg.pieces)
        {
            if (!piece.jump)
            {
                const span = actionSpan(edges, spent);
                if (airborne && spent - span.start > EPS)
                    spent = span.end;
                airborne = false;
                spent += piece.cost;
                continue;
            }

            const unit = piece.cost / piece.steps;

            for (let step = 0; step < piece.steps; step++)
            {
                const end = actionSpan(edges, spent).end;
                spent += unit - jumpRoundUp(end, spent, unit);
                if (spent >= end - EPS && step < piece.steps - 1)
                    return null;
            }

            airborne = piece.cost > EPS;
        }

        return { spent, elevation: leg.landing, facing: leg.facing, steps: leg.steps };
    };

    const legStart = (node, targetCell) =>
    {
        const span = actionSpan(edges, node.spent);
        if (node.spent - span.start <= EPS)
            return node.spent;
        if (node.landed)
            return span.end;
        if (node.kind === 'line' && node.line?.steps > 0)
            return continuesLine(ring, node.line, node.cell, targetCell) ? node.spent : span.end;
        return node.spent;
    };

    const legFloor = (hexes) => Math.max(hexes, 2 * hexes - 1 - Math.floor(2 * hexes / smallestBand));
    const startCell = ring.fromOffset(startOffset);
    const terrainField = { radius: -1, distances: new Map() };

    const plainAt = (offset) => footAt(offset).cellBands.every(bands => !bands.length);

    const terrainDistance = (offset, radius) =>
    {
        if (terrainField.radius < radius)
        {
            const fieldRadius = radius + 2;
            const distances = new Map();
            let frontier = [];

            for (const { offset: cellOffset } of [{ offset: startOffset }, ...ring.around(startOffset, fieldRadius)])
            {
                if (plainAt(cellOffset))
                    continue;
                distances.set(cellIndex(cellOffset), 0);
                frontier.push(cellOffset);
            }

            for (let depth = 1; frontier.length; depth++)
            {
                const next = [];

                for (const cellOffset of frontier)
                {
                    for (const { offset: neighbor, cell } of ring.around(cellOffset, 1))
                    {
                        const index = cellIndex(neighbor);
                        if (distances.has(index) || ring.distance(startCell, cell) > fieldRadius)
                            continue;
                        distances.set(index, depth);
                        next.push(neighbor);
                    }
                }

                frontier = next;
            }

            Object.assign(terrainField, { radius: fieldRadius, distances });
        }

        return terrainField.distances.get(cellIndex(offset)) ?? Infinity;
    };

    const jumpBounds = (node, limit) =>
    {
        const room = Math.ceil(limit - node.spent - EPS);
        const fieldRadius = ring.distance(startCell, node.cell) + room;
        const resting = Math.abs(groundOf(node.offset, node.elevation) - node.elevation) <= EPS;
        const near = resting ? terrainDistance(node.offset, fieldRadius) : 0;
        let flatMax = 0;

        while (flatMax < room && node.spent + legFloor(flatMax + 1) <= limit + EPS)
            flatMax++;

        const floorAt = (hexes, target) =>
        {
            if (!resting)
                return hexes;

            const far = terrainDistance(target, fieldRadius);
            const cheap = climbStamps
                ? Math.max(0, Math.min(hexes, hexes + 1 - far) - Math.max(1, near - 1) + 1)
                : (near >= 1 && near + far > hexes ? 0 : hexes);
            const doubled = 2 * hexes - cheap;
            return Math.max(hexes, doubled - 1 - Math.floor(doubled / smallestBand));
        };

        const crossesBand = (hexes, target, startSpent) =>
        {
            if (!resting || near < 1)
                return false;

            const need = Math.max(2, (actionSpan(edges, startSpent).end - EPS - startSpent) / 2 + 1);
            if (hexes < need)
                return false;

            const nearRun = near + terrainDistance(target, fieldRadius) > hexes ? hexes : (climbStamps ? Math.min(near - 1, hexes) : 0);
            if (nearRun >= need)
                return true;

            const { run, whole } = plainRunOf(node.offset, target);
            return (whole || climbStamps ? run : 0) >= need;
        };

        return { radius: near > room + 1 ? flatMax : room, floorAt, crossesBand };
    };

    return { jumpLeg, legStart, jumpBounds };
}
