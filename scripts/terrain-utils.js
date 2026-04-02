import { getOccupiedOffsets } from "./grid-helpers.js";

/**
 * Get all grid cells occupied by a token.
 * @param {Token} token - The token to get cells for
 * @returns {Array<[number, number]>} Array of [row, col] coordinates
 */
export function getTokenCells(token) {
    const offsets = getOccupiedOffsets(token);
    return offsets.map(o => [o.row, o.col]);
}

// Cache for terrain types to avoid redundant API calls and array searches
const _terrainCache = {
    solidMap: new Map(),
    timestamp: 0,
    ttl: 2000 // 2 second TTL is safe for terrain config changes
};

/**
 * Get the maximum ground height under a token considering all occupied cells.
 * @param {Token} token - The token to check ground height for
 * @param {Object} terrainAPI - The Terrain Height Tools API
 * @returns {number} Maximum ground height across all occupied cells
 */
export function getMaxGroundHeightUnderToken(token, terrainAPI) {
    const cells = getTokenCells(token);

    // Refresh terrain type cache if expired
    const now = Date.now();
    if (now - _terrainCache.timestamp > _terrainCache.ttl) {
        const types = terrainAPI.getTerrainTypes?.() || [];
        _terrainCache.solidMap.clear();
        for (const t of types) {
            if (t.usesHeight && t.isSolid) {
                _terrainCache.solidMap.set(t.id, t);
            }
        }
        _terrainCache.timestamp = now;
    }

    let maxGroundHeight = 0;

    for (const [x, y] of cells) {
        // Get existing terrain data at this cell
        const existingTerrain = terrainAPI.getCell(y, x) || [];

        // Find the highest terrain height at this position (only consider solid height-using terrain)
        for (const terrain of existingTerrain) {
            if (_terrainCache.solidMap.has(terrain.terrainTypeId)) {
                const totalHeight = (terrain.elevation || 0) + (terrain.height || 0);
                if (totalHeight > maxGroundHeight) {
                    maxGroundHeight = totalHeight;
                }
            }
        }
    }

    return maxGroundHeight;
}

export const TerrainAPI = {
    getTokenCells,
    getMaxGroundHeightUnderToken
};
