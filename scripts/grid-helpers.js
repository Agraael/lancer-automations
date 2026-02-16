/* global canvas, CONST */

// Shared grid helper functions used across lancer-automations modules.

export function isHexGrid() {
    return canvas.grid.type === CONST.GRID_TYPES.HEXODDR ||
        canvas.grid.type === CONST.GRID_TYPES.HEXEVENR ||
        canvas.grid.type === CONST.GRID_TYPES.HEXODDQ ||
        canvas.grid.type === CONST.GRID_TYPES.HEXEVENQ;
}

export function isColumnarHex() {
    const gridType = canvas.grid.type;
    return gridType === 4 || gridType === 5;
}

export function offsetToCube(col, row) {
    const gridType = canvas.grid.type;
    let q, r, s;

    switch (gridType) {
    case 2:
        q = col - Math.floor((row - (row & 1)) / 2);
        r = row;
        s = -q - r;
        break;
    case 3:
        q = col - Math.floor((row + (row & 1)) / 2);
        r = row;
        s = -q - r;
        break;
    case 4:
        q = col;
        r = row - Math.floor((col - (col & 1)) / 2);
        s = -q - r;
        break;
    case 5:
        q = col;
        r = row - Math.floor((col + (col & 1)) / 2);
        s = -q - r;
        break;
    default:
        q = col;
        r = row;
        s = 0;
    }

    return { q, r, s };
}

export function cubeToOffset(cube) {
    const gridType = canvas.grid.type;
    let col, row;

    switch (gridType) {
    case 2:
        col = cube.q + Math.floor((cube.r - (cube.r & 1)) / 2);
        row = cube.r;
        break;
    case 3:
        col = cube.q + Math.floor((cube.r + (cube.r & 1)) / 2);
        row = cube.r;
        break;
    case 4:
        col = cube.q;
        row = cube.r + Math.floor((cube.q - (cube.q & 1)) / 2);
        break;
    case 5:
        col = cube.q;
        row = cube.r + Math.floor((cube.q + (cube.q & 1)) / 2);
        break;
    default:
        col = cube.q;
        row = cube.r;
    }

    return { col, row };
}

export function cubeDistance(a, b) {
    return Math.max(
        Math.abs(a.q - b.q),
        Math.abs(a.r - b.r),
        Math.abs(a.s - b.s)
    );
}

export function getHexesInRange(center, range) {
    const results = [];
    for (let q = -range; q <= range; q++) {
        for (let r = Math.max(-range, -q - range); r <= Math.min(range, -q + range); r++) {
            const s = -q - r;
            results.push({
                q: center.q + q,
                r: center.r + r,
                s: center.s + s
            });
        }
    }
    return results;
}

export function getHexCenter(col, row) {
    if (canvas.grid.getCenterPoint) {
        const p = canvas.grid.getCenterPoint({ i: row, j: col });
        return { x: p.x, y: p.y };
    } else {
        const [cx, cy] = canvas.grid.grid.getCenter(row, col);
        return { x: cx, y: cy };
    }
}

export function pixelToOffset(x, y) {
    if (canvas.grid.getOffset) {
        const offset = canvas.grid.getOffset({ x, y });
        return { col: offset.j, row: offset.i };
    } else {
        const pos = canvas.grid.grid.getGridPositionFromPixels(x, y);
        return { col: pos[1], row: pos[0] };
    }
}

export function getTokenCenterOffset(token) {
    const doc = token.document;
    const gridSize = canvas.grid.size;
    const centerX = doc.x + (doc.width * gridSize / 2);
    const centerY = doc.y + (doc.height * gridSize / 2);
    return pixelToOffset(centerX, centerY);
}

export function getHexVertices(col, row) {
    const center = getHexCenter(col, row);
    const points = [];
    const gridSize = canvas.grid.size;

    if (canvas.grid.getShape) {
        const shape = canvas.grid.getShape();
        if (shape && shape.points && shape.points.length > 0) {
            for (let i = 0; i < shape.points.length; i += 2) {
                points.push({ x: shape.points[i] + center.x, y: shape.points[i + 1] + center.y });
            }
            return points;
        }
    }

    const isFlat = (canvas.grid.type === 4 || canvas.grid.type === 5);
    const startAngle = isFlat ? 0 : 30;
    const radius = (gridSize / 2) * 1.1547;

    for (let i = 0; i < 6; i++) {
        const angle_deg = 60 * i + startAngle;
        const angle_rad = Math.PI / 180 * angle_deg;
        points.push({
            x: center.x + radius * Math.cos(angle_rad),
            y: center.y + radius * Math.sin(angle_rad)
        });
    }
    return points;
}

export function drawHexAt(graphics, col, row) {
    if (isHexGrid()) {
        const vertices = getHexVertices(col, row);
        const points = [];
        for (const v of vertices) {
            points.push(v.x, v.y);
        }
        graphics.drawPolygon(points);
    } else {
        const center = getHexCenter(col, row);
        const gridSize = canvas.grid.size;
        graphics.drawCircle(center.x, center.y, gridSize / 3);
    }
}

export function measureGridDistance(c1, c2) {
    return canvas.grid.measurePath
        ? canvas.grid.measurePath([c1, c2]).distance
        : canvas.grid.measureDistance(c1, c2);
}

export function getOccupiedOffsets(token, overridePos = null) {
    const doc = token.document;
    const x = overridePos ? overridePos.x : doc.x;
    const y = overridePos ? overridePos.y : doc.y;
    const gridSize = canvas.grid.size;

    const centerX = x + (doc.width * gridSize / 2);
    const centerY = y + (doc.height * gridSize / 2);
    const centerOffset = pixelToOffset(centerX, centerY);

    if (doc.width <= 1 && doc.height <= 1) {
        return [centerOffset];
    }

    const offsets = [];
    const scanRadius = Math.ceil(Math.max(doc.width, doc.height));

    for (let di = -scanRadius; di <= scanRadius; di++) {
        for (let dj = -scanRadius; dj <= scanRadius; dj++) {
            const col = centerOffset.col + di;
            const row = centerOffset.row + dj;

            const center = getHexCenter(col, row);

            const localX = center.x - x;
            const localY = center.y - y;

            if (token.shape && token.shape.contains(localX, localY)) {
                offsets.push({ col, row });
            }
        }
    }

    if (offsets.length === 0) {
        offsets.push(centerOffset);
    }

    return offsets;
}

export function getOccupiedCenters(token, overridePos = null) {
    const offsets = getOccupiedOffsets(token, overridePos);
    return offsets.map(o => getHexCenter(o.col, o.row));
}

export function getMinGridDistance(token1, token2, overridePos1 = null) {
    if (!isHexGrid()) {
        const centers1 = getOccupiedCenters(token1, overridePos1);
        const centers2 = getOccupiedCenters(token2);

        let minDist = Infinity;
        for (const c1 of centers1) {
            for (const c2 of centers2) {
                const dPixel = measureGridDistance(c1, c2);
                if (dPixel < minDist)
                    minDist = dPixel;
            }
        }
        return Math.round(minDist / canvas.scene.grid.distance);
    }

    const offsets1 = getOccupiedOffsets(token1, overridePos1);
    const offsets2 = getOccupiedOffsets(token2);

    let minDist = Infinity;

    for (const o1 of offsets1) {
        const cube1 = offsetToCube(o1.col, o1.row);
        for (const o2 of offsets2) {
            const cube2 = offsetToCube(o2.col, o2.row);
            const dist = cubeDistance(cube1, cube2);
            if (dist < minDist)
                minDist = dist;
        }
    }



    return minDist;
}

/**
 * Snaps a token's center to the grid, accounting for its size and grid type.
 * @param {Token} token - The token to snap
 * @param {Object} centerPoint - The desired center point {x, y}
 * @returns {Object} The snapped top-left position {x, y}
 */
export function snapTokenCenter(token, centerPoint) {
    const topLeftX = centerPoint.x - (token.w / 2);
    const topLeftY = centerPoint.y - (token.h / 2);
    return token.getSnappedPosition({ x: topLeftX, y: topLeftY });
}

/**
 * Returns a Set of occupied grid references ("col,row") for all tokens on the canvas,
 * excluding specific token IDs.
 * @param {Array<string>} excludeIds - Array of token IDs to exclude
 * @returns {Set<string>} Set of "col,row" strings
 */
export function getOccupiedGridSpaces(excludeIds = []) {
    const occupied = new Set();
    const excludeSet = new Set(excludeIds);

    for (const t of canvas.tokens.placeables) {
        if (excludeSet.has(t.id))
            continue;
        if (!t.actor)
            continue;
        if (t.document.hidden)
            continue;

        const tOffsets = getOccupiedOffsets(t);
        for (const o of tOffsets) {
            occupied.add(`${o.col},${o.row}`);
        }
    }
    return occupied;
}

export function getDistanceTokenToPoint(point, token) {
    // Calculate center of the token
    const tokenCenterOffset = getTokenCenterOffset(token);

    // For hex grids, use cube distance between centers
    if (isHexGrid()) {
        const tokenCenterCube = offsetToCube(tokenCenterOffset.col, tokenCenterOffset.row);
        const pointOffset = pixelToOffset(point.x, point.y);
        const pointCube = offsetToCube(pointOffset.col, pointOffset.row);

        return cubeDistance(tokenCenterCube, pointCube);
    } else {
        // For square grids, use grid distance between centers
        const tokenCenter = getHexCenter(tokenCenterOffset.col, tokenCenterOffset.row);
        return Math.round(measureGridDistance(tokenCenter, point) / canvas.scene.grid.distance);
    }
}
