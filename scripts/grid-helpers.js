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

export function drawHexAt(graphics, col, row) {
    const center = getHexCenter(col, row);

    if (canvas.grid.getShape) {
        const shape = canvas.grid.getShape();
        if (shape && shape.points) {
            const translatedPoints = [];
            for (let i = 0; i < shape.points.length; i += 2) {
                translatedPoints.push(shape.points[i] + center.x);
                translatedPoints.push(shape.points[i + 1] + center.y);
            }
            graphics.drawPolygon(translatedPoints);
            return;
        }
    }
    const gridSize = canvas.grid.size;
    graphics.drawCircle(center.x, center.y, gridSize / 3);
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
