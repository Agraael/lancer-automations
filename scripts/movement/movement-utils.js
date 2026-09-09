import { getHexGroundElevation } from '../combat/terrain-utils.js';

const THT_ID = 'terrain-height-tools';

// Terrain Height Tools API if the module is active, else null.
export function thtApi()
{
    if (!game.modules.get(THT_ID)?.active)
        return null;
    return globalThis.terrainHeightTools ?? null;
}

// Mechs step over sub-SIZE walls; humans, squads, specialists, and vehicles do not.
export function canPassObstructions(tokenDoc)
{
    if (tokenDoc.getFlag?.('lancer-automations', 'noObstructionPass') || tokenDoc.actor?.getFlag?.('lancer-automations', 'noObstructionPass'))
        return false;
    const actor = tokenDoc?.actor;
    if (!actor || actor.type === 'pilot')
        return false;
    if (actor.items?.some?.(item => item.type === 'npc_template' && /vehicle|squad|human|specialist/i.test(item.system?.lid ?? '')))
        return false;
    return true;
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
