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

/**
 * Solid height bands among THT shapes, grid units.
 * @param {object[]} shapes
 * @param {Map} typeById terrain type by id
 * @returns {{bottom: number, top: number}[]}
 */
export function solidBands(shapes, typeById)
{
    const bands = [];
    for (const shape of shapes ?? [])
    {
        const terrainType = typeById?.get(shape.terrainTypeId);
        if (!terrainType?.usesHeight || !terrainType?.isSolid)
            continue;
        bands.push({
            bottom: shape.bottom ?? shape.elevation ?? 0,
            top: shape.top ?? ((shape.elevation ?? 0) + (shape.height ?? 0))
        });
    }
    return bands;
}

/**
 * Surface a token rests on in one cell, grid units.
 * ground: the highest surface with room above it at or below height, else the lowest one above.
 * hold: height is a floor. Rise out of any band filling the body, never below the floor.
 * @param {{bottom: number, top: number}[]} bands
 * @param {number} zHeight token height, grid units
 * @param {number} height current elevation, grid units
 * @param {'ground'|'hold'} mode
 * @returns {number}
 */
export function restingSurface(bands, zHeight, height, mode)
{
    if (mode === 'hold')
    {
        let surface = height;
        for (let pass = 0; pass <= bands.length; pass++)
        {
            let pushed = surface;
            for (const band of bands)
            {
                if (band.top > pushed + 1e-6 && band.bottom < surface + zHeight - 1e-6)
                    pushed = band.top;
            }
            if (pushed === surface)
                break;
            surface = pushed;
        }
        return surface;
    }
    const fits = surface => !bands.some(band => band.top > surface + 1e-6 && band.bottom < surface + zHeight - 1e-6);
    let below = -Infinity;
    let above = Infinity;
    for (const surface of [0, ...bands.map(band => band.top)])
    {
        if (!fits(surface))
            continue;
        if (surface <= height + 1e-6)
            below = Math.max(below, surface);
        else
            above = Math.min(above, surface);
    }
    return below > -Infinity ? below : above;
}

/**
 * Standing rule across a footprint: rest on the lowest cell unless one rises SIZE or more above it.
 * @param {number[]} cellSurfaces
 * @param {number} moverSize
 * @param {boolean} standing whether the mover may step over sub-SIZE obstructions
 * @returns {{surface: number, brushed: boolean, landingSurface: number}} brushed when a taller cell was ignored, landingSurface where the mover rests if it stops here
 */
export function footprintSurface(cellSurfaces, moverSize, standing)
{
    const maxTop = Math.max(...cellSurfaces);
    if (!standing || cellSurfaces.length < 2 || !(moverSize > 1))
        return { surface: maxTop, brushed: false, landingSurface: maxTop };
    const minTop = Math.min(...cellSurfaces);
    if (maxTop - minTop < moverSize - 1e-6)
        return { surface: minTop, brushed: maxTop - minTop > 1e-6, landingSurface: maxTop };
    return { surface: maxTop, brushed: false, landingSurface: maxTop };
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
    if (!getSettingEnabled('enableObstructionStepOver'))
        return false;
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
