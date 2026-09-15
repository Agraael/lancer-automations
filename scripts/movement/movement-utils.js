import { getHexGroundElevation } from '../combat/terrain-utils.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { getSettingEnabled } from '../setup/settings-register.js';

const THT_ID = 'terrain-height-tools';

// Terrain Height Tools API if the module is active, else null.
export function thtApi()
{
    if (!game.modules.get(THT_ID)?.active)
        return null;
    return globalThis.terrainHeightTools ?? null;
}

// THT shapes live in scene flags, so a scene write or load is the only change. Each query is a quadtree walk.
let _thtCellCache = new Map();
let _thtPointCache = new Map();
function invalidateThtShapes()
{
    _thtCellCache = new Map();
    _thtPointCache = new Map();
}
Hooks.on('canvasReady', invalidateThtShapes);
Hooks.on('updateScene', invalidateThtShapes);

export function thtCellShapes(tht, col, row)
{
    const key = `${col},${row}`;
    let shapes = _thtCellCache.get(key);
    if (!shapes)
    {
        shapes = tht.getCell?.(col, row) ?? [];
        _thtCellCache.set(key, shapes);
    }
    return shapes;
}

export function thtShapesAtPoint(tht, x, y)
{
    const key = `${Math.round(x)},${Math.round(y)}`;
    let shapes = _thtPointCache.get(key);
    if (!shapes)
    {
        shapes = tht.getShapesAtPoint?.(x, y) ?? [];
        _thtPointCache.set(key, shapes);
    }
    return shapes;
}

const OBSTRUCTION_TEMPLATE_SETTINGS = {
    vehicle: 'obstructionBlocksVehicle',
    squad: 'obstructionBlocksSquad',
    human: 'obstructionBlocksHuman',
    specialist: 'obstructionBlocksSpecialist',
};

// Mechs step over sub-SIZE walls; the settings pick which NPC templates do not.
export function canPassObstructions(tokenDoc)
{
    if (getLAFlag(tokenDoc,'noObstructionPass') || getLAFlag(tokenDoc.actor,'noObstructionPass'))
        return false;
    const actor = tokenDoc?.actor;
    if (!actor || actor.type === 'pilot')
        return false;
    const blocked = Object.keys(OBSTRUCTION_TEMPLATE_SETTINGS)
        .filter(type => getSettingEnabled(OBSTRUCTION_TEMPLATE_SETTINGS[type]));
    if (blocked.length > 0)
    {
        const pattern = new RegExp(blocked.join('|'), 'i');
        if (actor.items?.some?.(item => item.type === 'npc_template' && pattern.test(item.system?.lid ?? '')))
            return false;
    }
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
