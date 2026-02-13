/**
 * Get all grid cells occupied by a token.
 * @param {Token} token - The token to get cells for
 * @returns {Array<[number, number]>} Array of [gridX, gridY] coordinates
 */
export function getTokenCells(token) {
    const grid = canvas.grid;
    const cells = [];
    const visitedCells = new Set();

    // Use FoundryVTT's native method to get occupied spaces
    const occupiedSpaces = token.getOccupiedSpaces();

    // Convert pixel coordinates to grid coordinates
    for (const space of occupiedSpaces) {
        const [gridX, gridY] = grid.getGridPositionFromPixels(space.x, space.y);
        const cellKey = `${gridX},${gridY}`;

        if (!visitedCells.has(cellKey)) {
            visitedCells.add(cellKey);
            cells.push([gridX, gridY]);
        }
    }

    return cells;
}

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token - The token to check ground height for
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number} Maximum ground height across all occupied cells
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI) {
    const cells = getTokenCells(token);
    const terrainTypes = terrainAPI.getTerrainTypes?.() || [];
    let maxGroundHeight = 0;

    for (const [x, y] of cells) {
        // Get existing terrain data at this cell
        const existingTerrain = terrainAPI.getCell(y, x) || [];

        // Find the highest terrain height at this position (only consider terrain that blocks movement)
        for (const terrain of existingTerrain) {
            // Find the terrain type configuration
            const terrainType = terrainTypes.find(t => t.id === terrain.terrainTypeId);

            // Only consider this terrain if it blocks movement
            if (terrainType && terrainType.blockMovement) {
                const totalHeight = (terrain.elevation || 0) + (terrain.height || 0);
                if (totalHeight > maxGroundHeight) {
                    maxGroundHeight = totalHeight;
                }
            }
        }
    }

    return maxGroundHeight;
}
