const FULL_TURN = Math.PI * 2;
const VISION_BUCKETS = 1024;
const RAY_EPSILON = 1e-7;
const EDGE_ALPHA = 0.5;
const SAME_DIRECTION = 1e-4;
const FILL_MAX_BEAM = (10 * Math.PI) / 180;
const FILL_MARGIN = Math.PI / 180;
const FILL_LIMIT = 4;

let scene = null;

function normalizeAngle(angle)
{
    let normalized = angle;
    while (normalized < 0)
        normalized += FULL_TURN;
    while (normalized >= FULL_TURN)
        normalized -= FULL_TURN;
    return normalized;
}

function groundAt(pointX, pointY)
{
    const column = Math.floor((pointX - scene.rectX) / scene.rasterSize);
    const row = Math.floor((pointY - scene.rectY) / scene.rasterSize);

    if (column < 0 || row < 0 || column >= scene.rasterColumns || row >= scene.rasterRows)
        return 0;
    return scene.ground[(row * scene.rasterColumns) + column];
}

function crossingsAlong(originX, originY, dirX, dirY, maxDistance, walls)
{
    const found = [];

    for (const wall of walls)
    {
        const wallX = wall.bx - wall.ax;
        const wallY = wall.by - wall.ay;
        const denom = (dirX * wallY) - (dirY * wallX);

        if (Math.abs(denom) < 1e-12)
            continue;

        const toX = wall.ax - originX;
        const toY = wall.ay - originY;
        const along = ((toX * wallY) - (toY * wallX)) / denom;
        const onWall = ((toX * dirY) - (toY * dirX)) / denom;

        if (along <= 0 || along > maxDistance || onWall < 0 || onWall > 1)
            continue;
        found.push({ distance: along, bottom: wall.bottom, top: wall.top });
    }

    found.sort((left, right) => left.distance - right.distance);
    return found;
}

function pointHidden(eyeHeight, distance, targetHeight, crossings)
{
    for (const crossing of crossings)
    {
        if (crossing.distance >= distance)
            break;

        const height = eyeHeight + ((targetHeight - eyeHeight) * crossing.distance / distance);
        if (height <= crossing.top && height >= crossing.bottom)
            return true;
    }

    return false;
}

function angularBuckets(originX, originY, walls, count)
{
    const buckets = Array.from({ length: count }, () => []);

    for (const wall of walls)
    {
        const angleA = Math.atan2(wall.ay - originY, wall.ax - originX);
        const angleB = Math.atan2(wall.by - originY, wall.bx - originX);
        let span = angleB - angleA;
        while (span <= -Math.PI)
            span += FULL_TURN;
        while (span > Math.PI)
            span -= FULL_TURN;

        const start = normalizeAngle(span >= 0 ? angleA : angleB);
        const first = Math.floor((start / FULL_TURN) * count) - 1;
        const covered = Math.min(count, Math.ceil((Math.abs(span) / FULL_TURN) * count) + 3);
        for (let offset = 0; offset < covered; offset++)
            buckets[(((first + offset) % count) + count) % count].push(wall);
    }

    return buckets;
}

function castFan(origin, eyeHeight, walls, maxDistance)
{
    const rayStep = FULL_TURN / scene.rays;
    const buckets = angularBuckets(origin.x, origin.y, walls, scene.rays);
    const fan = new Array(scene.rays).fill(null);
    const lowestTarget = scene.minGround + scene.targetAbove;

    for (let ray = 0; ray < scene.rays; ray++)
    {
        const angle = ray * rayStep;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        const crossings = crossingsAlong(origin.x, origin.y, dirX, dirY, maxDistance, buckets[ray]);

        if (!crossings.length)
            continue;

        let reach = 0;
        for (const crossing of crossings)
            reach = Math.max(reach, crossing.distance * (eyeHeight - lowestTarget) / (eyeHeight - crossing.top));

        const end = Math.min(maxDistance, reach + scene.step);
        const hiddenAt = distance => pointHidden(eyeHeight, distance, groundAt(origin.x + (dirX * distance), origin.y + (dirY * distance)) + scene.targetAbove, crossings);
        let runStart = null;
        let previousDistance = null;
        let previousHidden = false;
        const intervals = [];

        for (let distance = crossings[0].distance + 0.5; distance <= end; distance += scene.step)
        {
            const hidden = hiddenAt(distance);

            if (previousDistance === null)
            {
                if (hidden)
                    runStart = crossings[0].distance;
            }
            else if (hidden !== previousHidden)
            {
                let low = previousDistance;
                let high = distance;

                for (let refine = 0; refine < scene.refineSteps; refine++)
                {
                    const middle = (low + high) / 2;
                    if (hiddenAt(middle) === previousHidden)
                        low = middle;
                    else
                        high = middle;
                }

                const boundary = (low + high) / 2;

                if (hidden)
                    runStart = boundary;
                else
                {
                    intervals.push(runStart, boundary);
                    runStart = null;
                }
            }

            previousDistance = distance;
            previousHidden = hidden;
        }

        if (runStart !== null)
            intervals.push(runStart, end);
        if (intervals.length)
            fan[ray] = intervals;
    }

    return { intervals: fan, buckets, eyeHeight };
}

function signedAlongRay(intervals, distance)
{
    if (!intervals)
        return -scene.limit;

    let nearest = -scene.limit;

    for (let index = 0; index < intervals.length; index += 2)
    {
        const start = intervals[index];
        const end = intervals[index + 1];

        if (distance >= start && distance <= end)
            return Math.min(scene.limit, distance - start, end - distance);
        nearest = Math.max(nearest, distance < start ? distance - start : end - distance);
    }

    return nearest;
}

function fieldInFan(fan, origin, pointX, pointY)
{
    const offsetX = pointX - origin.x;
    const offsetY = pointY - origin.y;
    const position = normalizeAngle(Math.atan2(offsetY, offsetX)) / (FULL_TURN / scene.rays);
    const lower = Math.floor(position);
    const blend = position - lower;
    const distance = Math.hypot(offsetX, offsetY);
    const lowerValue = signedAlongRay(fan.intervals[lower % scene.rays], distance);
    const upperValue = signedAlongRay(fan.intervals[(lower + 1) % scene.rays], distance);

    if ((lowerValue > 0) !== (upperValue > 0))
    {
        const crossings = crossingsAlong(origin.x, origin.y, offsetX / distance, offsetY / distance, distance + 1, fan.buckets[lower % scene.rays]);
        const hidden = pointHidden(fan.eyeHeight, distance, groundAt(pointX, pointY) + scene.targetAbove, crossings);
        return hidden ? Math.max(lowerValue, upperValue) : Math.min(lowerValue, upperValue);
    }

    return lowerValue + ((upperValue - lowerValue) * blend);
}

function shadeBox(fan, origin)
{
    const { ramp, rays } = scene;
    const rayStep = FULL_TURN / rays;
    const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };

    for (let ray = 0; ray < rays; ray++)
    {
        const intervals = fan.intervals[ray];
        if (!intervals)
            continue;

        const angle = ray * rayStep;

        for (const side of [angle - rayStep, angle + rayStep])
        {
            const sideX = Math.cos(side);
            const sideY = Math.sin(side);

            for (let index = 0; index < intervals.length; index += 2)
            {
                for (const distance of [Math.max(0, intervals[index] - ramp), intervals[index + 1] + ramp])
                {
                    const pointX = origin.x + (sideX * distance);
                    const pointY = origin.y + (sideY * distance);
                    box.minX = Math.min(box.minX, pointX);
                    box.maxX = Math.max(box.maxX, pointX);
                    box.minY = Math.min(box.minY, pointY);
                    box.maxY = Math.max(box.maxY, pointY);
                }
            }
        }
    }

    return box;
}

function runShade(job)
{
    const origins = [];
    const fans = [];
    const fanBox = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };
    const reachBox = { minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity };

    for (const viewer of job.viewers)
    {
        const walls = [];
        for (let index = 0; index < viewer.walls.length; index += 6)
            walls.push({ ax: viewer.walls[index], ay: viewer.walls[index + 1], bx: viewer.walls[index + 2], by: viewer.walls[index + 3], bottom: viewer.walls[index + 4], top: viewer.walls[index + 5] });

        const viewerOrigins = [];
        for (let index = 0; index < viewer.origins.length; index += 2)
            viewerOrigins.push({ x: viewer.origins[index], y: viewer.origins[index + 1] });

        const viewerFans = viewerOrigins.map(origin => castFan(origin, viewer.eyeHeight, walls, viewer.maxDistance + viewer.reachPad));
        const viewerBox = shadeBox(viewerFans[0], viewerOrigins[0]);
        fanBox.minX = Math.max(fanBox.minX, viewerBox.minX);
        fanBox.minY = Math.max(fanBox.minY, viewerBox.minY);
        fanBox.maxX = Math.min(fanBox.maxX, viewerBox.maxX);
        fanBox.maxY = Math.min(fanBox.maxY, viewerBox.maxY);
        reachBox.minX = Math.max(reachBox.minX, viewer.centerX - viewer.maxDistance);
        reachBox.minY = Math.max(reachBox.minY, viewer.centerY - viewer.maxDistance);
        reachBox.maxX = Math.min(reachBox.maxX, viewer.centerX + viewer.maxDistance);
        reachBox.maxY = Math.min(reachBox.maxY, viewer.centerY + viewer.maxDistance);
        origins.push(...viewerOrigins);
        fans.push(...viewerFans);
    }

    const { cell, ramp } = scene;
    let leadFan = 0;

    const fieldFromAll = (pointX, pointY) =>
    {
        let field = Math.min(scene.limit, fieldInFan(fans[leadFan], origins[leadFan], pointX, pointY));
        if (field <= 0)
            return field;

        for (let index = 0; index < origins.length; index++)
        {
            if (index === leadFan)
                continue;
            field = Math.min(field, fieldInFan(fans[index], origins[index], pointX, pointY));

            if (field <= 0)
            {
                leadFan = index;
                return field;
            }
        }

        return field;
    };

    const result = { columns: 0, rows: 0, shaded: 0, alphaData: new Uint8Array(0) };

    if (fanBox.minX >= fanBox.maxX || fanBox.minY >= fanBox.maxY)
        return result;

    const originX = Math.max(scene.rectX, reachBox.minX, fanBox.minX - (2 * cell));
    const originY = Math.max(scene.rectY, reachBox.minY, fanBox.minY - (2 * cell));
    const endX = Math.min(scene.rectX + scene.rectWidth, reachBox.maxX, fanBox.maxX + (2 * cell));
    const endY = Math.min(scene.rectY + scene.rectHeight, reachBox.maxY, fanBox.maxY + (2 * cell));
    const columns = Math.max(0, Math.ceil((endX - originX) / cell));
    const rows = Math.max(0, Math.ceil((endY - originY) / cell));
    const alphaData = new Uint8Array(columns * rows * 4).fill(255);
    const coarseColumns = Math.ceil(columns / 2);
    const coarseRows = Math.ceil(rows / 2);
    const coarse = new Float64Array(coarseColumns * coarseRows);

    for (let row = 0; row < coarseRows; row++)
    {
        const pointY = originY + (((row * 2) + 1) * cell);
        for (let column = 0; column < coarseColumns; column++)
            coarse[(row * coarseColumns) + column] = fieldFromAll(originX + (((column * 2) + 1) * cell), pointY);
    }

    const settledBlock = (row, column) =>
    {
        const hidden = coarse[(row * coarseColumns) + column] >= ramp;

        for (let nearRow = Math.max(0, row - 1); nearRow <= Math.min(coarseRows - 1, row + 1); nearRow++)
        {
            for (let nearColumn = Math.max(0, column - 1); nearColumn <= Math.min(coarseColumns - 1, column + 1); nearColumn++)
            {
                const value = coarse[(nearRow * coarseColumns) + nearColumn];
                if (hidden ? value < ramp : value > 0)
                    return false;
            }
        }

        return true;
    };

    const fields = new Float64Array(columns * rows);

    for (let blockRow = 0; blockRow < coarseRows; blockRow++)
    {
        for (let blockColumn = 0; blockColumn < coarseColumns; blockColumn++)
        {
            const settled = settledBlock(blockRow, blockColumn);

            for (let row = blockRow * 2; row < Math.min(rows, (blockRow * 2) + 2); row++)
            {
                for (let column = blockColumn * 2; column < Math.min(columns, (blockColumn * 2) + 2); column++)
                    fields[(row * columns) + column] = settled ? coarse[(blockRow * coarseColumns) + blockColumn] : fieldFromAll(originX + ((column + 0.5) * cell), originY + ((row + 0.5) * cell));
            }
        }
    }

    const touchesVisible = (row, column) =>
    {
        for (let nearRow = Math.max(0, row - 1); nearRow <= Math.min(rows - 1, row + 1); nearRow++)
        {
            for (let nearColumn = Math.max(0, column - 1); nearColumn <= Math.min(columns - 1, column + 1); nearColumn++)
            {
                if (fields[(nearRow * columns) + nearColumn] <= 0)
                    return true;
            }
        }

        return false;
    };

    let shaded = 0;

    for (let row = 0; row < rows; row++)
    {
        for (let column = 0; column < columns; column++)
        {
            const field = fields[(row * columns) + column];
            const alphaIndex = (((row * columns) + column) * 4) + 3;

            if (field <= 0)
            {
                alphaData[alphaIndex] = 0;
                continue;
            }

            const peak = touchesVisible(row, column) ? EDGE_ALPHA : 1;
            alphaData[alphaIndex] = Math.round(255 * Math.min(peak, field / ramp));
            shaded++;
        }
    }

    return { originX, originY, columns, rows, alphaData, shaded, cell };
}

function simplify(points)
{
    const unique = [];

    for (const point of points)
    {
        const last = unique.at(-1);
        if (last && Math.abs(last[0] - point[0]) < 1e-6 && Math.abs(last[1] - point[1]) < 1e-6)
            continue;
        unique.push(point);
    }

    const kept = [];
    const count = unique.length;

    for (let index = 0; index < count; index++)
    {
        const previous = kept.length ? kept.at(-1) : unique[(index - 1 + count) % count];
        const current = unique[index];
        const next = unique[(index + 1) % count];
        const firstX = current[0] - previous[0];
        const firstY = current[1] - previous[1];
        const secondX = next[0] - current[0];
        const secondY = next[1] - current[1];
        const scale = Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY);
        const cross = (firstX * secondY) - (firstY * secondX);

        if (scale > 0 && Math.abs(cross) <= 1e-9 * scale && ((firstX * secondX) + (firstY * secondY)) > 0)
            continue;
        kept.push(current);
    }

    const flat = new Float64Array(kept.length * 2);
    kept.forEach((point, index) =>
    {
        flat[index * 2] = point[0];
        flat[(index * 2) + 1] = point[1];
    });
    return flat;
}

function blocksFrom(edge, originX, originY, wallDirectionMode)
{
    const orientation = ((edge.ay - originY) * (edge.bx - originX)) - ((edge.ax - originX) * (edge.by - originY));
    if (orientation === 0)
        return false;

    const side = orientation < 0 ? 1 : 2;
    if (edge.direction && wallDirectionMode !== 2 && ((wallDirectionMode === 0) === (side === edge.direction)))
        return false;

    if (edge.thresholdDistance > 0 && edge.senseType >= 30)
    {
        const spanX = edge.bx - edge.ax;
        const spanY = edge.by - edge.ay;
        const lengthSquared = (spanX * spanX) + (spanY * spanY);
        const along = lengthSquared ? Math.min(1, Math.max(0, (((originX - edge.ax) * spanX) + ((originY - edge.ay) * spanY)) / lengthSquared)) : 0;
        const distance = Math.hypot(edge.ax + (spanX * along) - originX, edge.ay + (spanY * along) - originY);
        const externalRadius = 1;

        if (edge.senseType === 30 ? Math.max(distance - externalRadius, 0) < edge.thresholdDistance : (distance + externalRadius) > edge.thresholdDistance)
            return false;
    }

    return true;
}

function losPolygon(originX, originY, edges, extraPoints, wallDirectionMode, maxR)
{
    const active = edges.filter(edge => blocksFrom(edge, originX, originY, wallDirectionMode));
    const buckets = angularBuckets(originX, originY, active, VISION_BUCKETS);
    const targets = new Set();
    const rayAngles = [];

    const addTarget = (pointX, pointY) =>
    {
        const key = `${pointX},${pointY}`;
        if (targets.has(key))
            return;
        targets.add(key);
        const angle = Math.atan2(pointY - originY, pointX - originX);
        rayAngles.push(angle - RAY_EPSILON, angle + RAY_EPSILON);
    };

    for (const edge of active)
    {
        addTarget(edge.ax, edge.ay);
        addTarget(edge.bx, edge.by);
    }

    for (let index = 0; index < extraPoints.length; index += 2)
        addTarget(extraPoints[index], extraPoints[index + 1]);

    const hits = [];

    for (const rawAngle of rayAngles)
    {
        const angle = normalizeAngle(rawAngle);
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        let normal = maxR;
        let limitedFirst = Infinity;
        let limitedSecond = Infinity;

        for (const edge of buckets[Math.floor((angle / FULL_TURN) * VISION_BUCKETS) % VISION_BUCKETS])
        {
            const wallX = edge.bx - edge.ax;
            const wallY = edge.by - edge.ay;
            const denom = (dirX * wallY) - (dirY * wallX);

            if (Math.abs(denom) < 1e-12)
                continue;

            const toX = edge.ax - originX;
            const toY = edge.ay - originY;
            const along = ((toX * wallY) - (toY * wallX)) / denom;
            const onWall = ((toX * dirY) - (toY * dirX)) / denom;

            if (along <= 1e-9 || onWall < 0 || onWall > 1)
                continue;
            if (edge.limited)
            {
                if (along < limitedFirst)
                {
                    limitedSecond = limitedFirst;
                    limitedFirst = along;
                }
                else if (along < limitedSecond)
                    limitedSecond = along;
            }
            else if (along < normal)
                normal = along;
        }

        const reach = Math.min(normal, limitedSecond);
        hits.push({ angle, x: originX + (dirX * reach), y: originY + (dirY * reach) });
    }

    hits.sort((left, right) => left.angle - right.angle);
    return simplify(hits.map(hit => [hit.x, hit.y]));
}

function clipToCircle(polygon, originX, originY, centerX, centerY, radius)
{
    const count = polygon.length / 2;
    if (count < 3)
        return polygon;

    const vertexAngles = new Float64Array(count);
    for (let index = 0; index < count; index++)
        vertexAngles[index] = normalizeAngle(Math.atan2(polygon[(index * 2) + 1] - originY, polygon[index * 2] - originX));

    const offsetX = originX - centerX;
    const offsetY = originY - centerY;
    const inside = (offsetX * offsetX) + (offsetY * offsetY) - (radius * radius);

    const circleReach = (dirX, dirY) =>
    {
        const half = (dirX * offsetX) + (dirY * offsetY);
        return -half + Math.sqrt(Math.max(0, (half * half) - inside));
    };

    const samples = [];
    for (let index = 0; index < count; index++)
        samples.push({ angle: vertexAngles[index], vertex: index });

    const density = Math.max(32, Math.ceil(Math.PI / Math.sqrt(2 / radius)));

    for (let step = 0; step < density; step++)
    {
        const circleAngle = (step / density) * FULL_TURN;
        const pointX = centerX + (Math.cos(circleAngle) * radius);
        const pointY = centerY + (Math.sin(circleAngle) * radius);
        samples.push({ angle: normalizeAngle(Math.atan2(pointY - originY, pointX - originX)), vertex: -1 });
    }

    for (let index = 0; index < count; index++)
    {
        const next = (index + 1) % count;
        const startX = polygon[index * 2];
        const startY = polygon[(index * 2) + 1];
        const spanX = polygon[next * 2] - startX;
        const spanY = polygon[(next * 2) + 1] - startY;
        const quadA = (spanX * spanX) + (spanY * spanY);

        if (!quadA)
            continue;

        const quadB = 2 * ((spanX * (startX - centerX)) + (spanY * (startY - centerY)));
        const quadC = ((startX - centerX) ** 2) + ((startY - centerY) ** 2) - (radius * radius);
        const discriminant = (quadB * quadB) - (4 * quadA * quadC);

        if (discriminant < 0)
            continue;

        const root = Math.sqrt(discriminant);

        for (const along of [(-quadB - root) / (2 * quadA), (-quadB + root) / (2 * quadA)])
        {
            if (along <= 0 || along >= 1)
                continue;
            samples.push({ angle: normalizeAngle(Math.atan2(startY + (spanY * along) - originY, startX + (spanX * along) - originX)), vertex: -1 });
        }
    }

    samples.sort((left, right) => left.angle - right.angle);

    const segmentFor = (angle) =>
    {
        if (angle < vertexAngles[0] || angle >= vertexAngles[count - 1])
            return count - 1;

        let low = 0;
        let high = count - 1;

        while (low < high)
        {
            const middle = (low + high + 1) >> 1;
            if (vertexAngles[middle] <= angle)
                low = middle;
            else
                high = middle - 1;
        }

        return low;
    };

    const points = [];

    for (const sample of samples)
    {
        const dirX = Math.cos(sample.angle);
        const dirY = Math.sin(sample.angle);
        const circleDistance = circleReach(dirX, dirY);
        let polygonDistance;

        if (sample.vertex >= 0)
            polygonDistance = Math.hypot(polygon[sample.vertex * 2] - originX, polygon[(sample.vertex * 2) + 1] - originY);
        else
        {
            const index = segmentFor(sample.angle);
            const next = (index + 1) % count;
            const startX = polygon[index * 2];
            const startY = polygon[(index * 2) + 1];
            const spanX = polygon[next * 2] - startX;
            const spanY = polygon[(next * 2) + 1] - startY;
            const denom = (dirX * spanY) - (dirY * spanX);
            polygonDistance = Math.abs(denom) < 1e-12
                ? Math.hypot(startX - originX, startY - originY)
                : (((startX - originX) * spanY) - ((startY - originY) * spanX)) / denom;
        }

        if (sample.vertex >= 0 && polygonDistance <= circleDistance)
            points.push([polygon[sample.vertex * 2], polygon[(sample.vertex * 2) + 1]]);
        else
        {
            const reach = Math.min(polygonDistance, circleDistance);
            points.push([originX + (dirX * reach), originY + (dirY * reach)]);
        }
    }

    return simplify(points);
}

function clipToSector(polygon, originX, originY, centerAngle, span)
{
    const count = polygon.length / 2;
    const startAngle = centerAngle - (span / 2);

    const reachAlong = (angle) =>
    {
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        let nearest = Infinity;

        for (let index = 0; index < count; index++)
        {
            const next = (index + 1) % count;
            const spanX = polygon[next * 2] - polygon[index * 2];
            const spanY = polygon[(next * 2) + 1] - polygon[(index * 2) + 1];
            const denom = (dirX * spanY) - (dirY * spanX);
            if (Math.abs(denom) < 1e-12)
                continue;
            const toX = polygon[index * 2] - originX;
            const toY = polygon[(index * 2) + 1] - originY;
            const along = ((toX * spanY) - (toY * spanX)) / denom;
            const onEdge = ((toX * dirY) - (toY * dirX)) / denom;
            if (along > 0 && onEdge >= 0 && onEdge <= 1)
                nearest = Math.min(nearest, along);
        }

        return nearest;
    };

    const inside = [];

    for (let index = 0; index < count; index++)
    {
        const offset = normalizeAngle(Math.atan2(polygon[(index * 2) + 1] - originY, polygon[index * 2] - originX) - startAngle);
        if (offset <= span)
            inside.push({ offset, x: polygon[index * 2], y: polygon[(index * 2) + 1] });
    }

    inside.sort((left, right) => left.offset - right.offset);
    const startReach = reachAlong(startAngle);
    const endReach = reachAlong(startAngle + span);

    if (startReach === Infinity || endReach === Infinity)
        return new Float64Array(0);

    return simplify([
        [originX, originY],
        [originX + (Math.cos(startAngle) * startReach), originY + (Math.sin(startAngle) * startReach)],
        ...inside.map(point => [point.x, point.y]),
        [originX + (Math.cos(startAngle + span) * endReach), originY + (Math.sin(startAngle + span) * endReach)],
    ]);
}

function findBeams(points, originX, originY, minReach)
{
    const count = points.length / 2;
    const beams = [];

    if (count < 4)
        return beams;

    const angles = new Float64Array(count);
    const radii = new Float64Array(count);
    let start = 0;

    for (let index = 0; index < count; index++)
    {
        const offsetX = points[index * 2] - originX;
        const offsetY = points[(index * 2) + 1] - originY;
        angles[index] = Math.atan2(offsetY, offsetX);
        radii[index] = Math.hypot(offsetX, offsetY);
        if (radii[index] < radii[start])
            start = index;
    }

    const vertexAt = step => (start + step) % count;
    const pointAt = step => ({ x: points[vertexAt(step) * 2], y: points[(vertexAt(step) * 2) + 1] });
    const spread = (fromStep, toStep) => normalizeAngle(angles[vertexAt(toStep)] - angles[vertexAt(fromStep)]);

    for (let step = 0; step < count; step++)
    {
        const nearRadius = radii[vertexAt(step)];
        if (spread(step, step + 1) > SAME_DIRECTION || radii[vertexAt(step + 1)] - nearRadius < minReach)
            continue;

        let peak = 0;
        let close = -1;

        for (let scan = step + 1; scan <= count; scan++)
        {
            if (spread(step, scan) > FILL_MAX_BEAM)
                break;
            const radius = radii[vertexAt(scan)];
            const isDrop = scan > step + 1 && spread(scan - 1, scan) <= SAME_DIRECTION && radii[vertexAt(scan - 1)] - radius >= minReach;
            if (isDrop && peak - radius >= (peak - nearRadius) / 2)
                close = scan;
            peak = Math.max(peak, radius);
            if (isDrop && radius <= nearRadius + minReach)
                break;
        }

        if (close < 0)
            continue;
        beams.push({ left: pointAt(step), right: pointAt(close), width: spread(step, close) });
        step = close - 1;
    }

    return beams;
}

function gapFills(job, edges, sightings)
{
    const tolerance = job.grid / 10;
    const near = (first, second) => Math.hypot(first.x - second.x, first.y - second.y) <= tolerance;
    const clusters = [];

    for (const sighting of sightings)
    {
        const found = clusters.find(cluster => near(cluster.left, sighting.left) && near(cluster.right, sighting.right));
        if (!found)
        {
            clusters.push({ left: sighting.left, right: sighting.right, width: sighting.width, viewpoints: [sighting.viewpoint] });
            continue;
        }
        found.width = Math.max(found.width, sighting.width);
        if (!found.viewpoints.includes(sighting.viewpoint))
            found.viewpoints.push(sighting.viewpoint);
    }

    const shared = clusters.filter(cluster => cluster.viewpoints.length >= 2).sort((left, right) => right.width - left.width);
    const sightLimited = job.sightRadius > 0 && job.sightRadius < job.maxR;
    const lightLimited = job.fullLightRadius > 0 && job.fullLightRadius < job.maxR;
    const fills = [];

    for (const cluster of shared)
    {
        if (fills.length >= FILL_LIMIT)
            break;

        const pivotX = Math.round((cluster.left.x + cluster.right.x) / 2);
        const pivotY = Math.round((cluster.left.y + cluster.right.y) / 2);
        const fromCenter = Math.hypot(pivotX - job.centerX, pivotY - job.centerY);
        const seesSight = !sightLimited || fromCenter < job.sightRadius;
        const seesLight = !lightLimited || fromCenter < job.fullLightRadius;

        if (!seesSight && !seesLight)
            continue;

        const directions = cluster.viewpoints.map(point => Math.atan2(pivotY - point.y, pivotX - point.x));
        let lowest = 0;
        let highest = 0;

        for (const direction of directions)
        {
            const offset = normalizeAngle(direction - directions[0] + Math.PI) - Math.PI;
            lowest = Math.min(lowest, offset);
            highest = Math.max(highest, offset);
        }

        const center = directions[0] + ((lowest + highest) / 2);
        const span = highest - lowest + FILL_MARGIN;
        const los = losPolygon(pivotX, pivotY, edges, job.points, job.wallDirectionMode, job.maxR);
        const sightBase = sightLimited && seesSight ? clipToCircle(los, pivotX, pivotY, job.centerX, job.centerY, job.sightRadius) : los;
        const lightBase = lightLimited && seesLight ? clipToCircle(los, pivotX, pivotY, job.centerX, job.centerY, job.fullLightRadius) : los;
        const sight = clipToSector(sightBase, pivotX, pivotY, center, span);

        if (sight.length < 6)
            continue;

        fills.push({
            pivot: { x: pivotX, y: pivotY },
            sight,
            light: lightBase === sightBase ? null : clipToSector(lightBase, pivotX, pivotY, center, span),
            seesSight,
            seesLight,
        });
    }

    return fills;
}

function runVision(job)
{
    const edges = [];

    for (let index = 0; index < job.edges.length; index += 8)
    {
        edges.push({
            ax: job.edges[index],
            ay: job.edges[index + 1],
            bx: job.edges[index + 2],
            by: job.edges[index + 3],
            limited: job.edges[index + 4] === 1,
            direction: job.edges[index + 5],
            senseType: job.edges[index + 6],
            thresholdDistance: job.edges[index + 7],
        });
    }

    const polygons = [];
    const sightings = [];

    for (let index = 0; index < job.viewpoints.length; index += 2)
    {
        const originX = Math.round(job.viewpoints[index]);
        const originY = Math.round(job.viewpoints[index + 1]);
        const los = losPolygon(originX, originY, edges, job.points, job.wallDirectionMode, job.maxR);

        if (job.fillGaps)
        {
            const viewpoint = { x: originX, y: originY };
            for (const beam of findBeams(los, originX, originY, job.grid))
                sightings.push({ viewpoint, left: beam.left, right: beam.right, width: beam.width });
        }

        const sight = job.sightRadius > 0 && job.sightRadius < job.maxR ? clipToCircle(los, originX, originY, job.centerX, job.centerY, job.sightRadius) : los;
        const light = job.lightRadius > 0 && job.lightRadius < job.maxR ? clipToCircle(los, originX, originY, originX, originY, job.lightRadius) : los;
        polygons.push({ sight, light: light === sight ? null : light });
    }

    if (sightings.length)
        polygons.push(...gapFills(job, edges, sightings));

    return { polygons };
}

self.onmessage = (event) =>
{
    const message = event.data;

    if (message.type === 'scene')
    {
        scene = message;
        return;
    }

    try
    {
        const result = { type: 'result', id: message.id, viewer: message.viewer, part: message.part, shade: null, vision: null };
        const transfer = new Set();

        if (message.shade)
        {
            result.shade = runShade(message.shade);
            transfer.add(result.shade.alphaData.buffer);
        }

        if (message.vision)
        {
            result.vision = runVision(message.vision);

            for (const polygon of result.vision.polygons)
            {
                transfer.add(polygon.sight.buffer);
                if (polygon.light)
                    transfer.add(polygon.light.buffer);
            }
        }

        self.postMessage(result, { transfer: [...transfer] });
    }
    catch (err)
    {
        self.postMessage({ type: 'failed', id: message.id, viewer: message.viewer, part: message.part, error: String(err?.stack ?? err) });
    }
};
