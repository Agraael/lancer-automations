import { getHexGroundElevation } from '../combat/terrain-utils.js';

const THT_ID = 'terrain-height-tools';

// Terrain Height Tools API if the module is active, else null.
export function thtApi()
{
    if (!game.modules.get(THT_ID)?.active)
        return null;
    return globalThis.terrainHeightTools ?? null;
}

// Terrain ground elevation at a world point; 0 if THT is absent or off-grid.
export function thtGroundAt(point)
{
    if (!globalThis.terrainHeightTools)
        return 0;
    try
    {
        const offset = canvas.grid.getOffset(point);
        return getHexGroundElevation(offset.j, offset.i) || 0;
    }
    catch
    {
        return 0;
    }
}
