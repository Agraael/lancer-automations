import { getLAFlag } from '../tools/flag-utils.js';
import { laTokenGameplayHeight } from '../tools/token-height.js';
import { isHostile } from '../combat/overwatch.js';

export function isSolidToken(token)
{
    const doc = token?.document ?? token;
    return !!doc && !!getLAFlag(doc, 'solid');
}

let _solidIndex = null;

function invalidateSolidIndex()
{
    _solidIndex = null;
}

for (const hook of /** @type {any[]} */ (['canvasReady', 'createToken', 'updateToken', 'deleteToken', 'updateActor']))
    Hooks.on(hook, invalidateSolidIndex);

function buildSolidIndex()
{
    const sceneDistance = canvas.scene?.dimensions?.distance || 1;
    const gridless = canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS;
    const gridSize = canvas.grid?.size ?? 100;
    const entries = [];

    for (const token of canvas.tokens?.placeables ?? [])
    {
        const doc = token.document;
        if (doc.hidden || !isSolidToken(doc))
            continue;

        const bottom = (doc.elevation ?? 0) / sceneDistance;
        let cells = null;

        if (!gridless)
        {
            try
            {
                cells = new Set((doc.getOccupiedGridSpaceOffsets?.() ?? []).map(offset => `${offset.j},${offset.i}`));
            }
            catch
            {
                cells = new Set();
            }
        }

        entries.push({
            id: doc.id,
            band: { bottom, top: bottom + laTokenGameplayHeight(doc) },
            cells,
            bounds: new PIXI.Rectangle(doc.x, doc.y, (doc.width ?? 1) * gridSize, (doc.height ?? 1) * gridSize)
        });
    }

    return entries;
}

function solidEntries()
{
    if (!canvas?.ready)
        return [];
    _solidIndex ??= buildSolidIndex();
    return _solidIndex;
}

export function solidTokenBandsAtCell(col, row, excludeTokenId = null)
{
    const entries = solidEntries();
    if (!entries.length)
        return [];

    const key = `${col},${row}`;
    let center = null;
    const bands = [];

    for (const entry of entries)
    {
        if (entry.id === excludeTokenId)
            continue;

        if (entry.cells)
        {
            if (entry.cells.has(key))
                bands.push(entry.band);
            continue;
        }

        center ??= canvas.grid.getCenterPoint({ i: row, j: col });
        if (entry.bounds.contains(center.x, center.y))
            bands.push(entry.band);
    }

    return bands;
}

export function solidTokenBandsAtPoint(x, y, excludeTokenId = null)
{
    const entries = solidEntries();
    if (!entries.length)
        return [];

    if (canvas.grid?.type !== CONST.GRID_TYPES.GRIDLESS)
    {
        const offset = canvas.grid.getOffset({ x, y });
        return solidTokenBandsAtCell(offset.j, offset.i, excludeTokenId);
    }

    return entries.filter(entry => entry.id !== excludeTokenId && entry.bounds.contains(x, y)).map(entry => entry.band);
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

export function blocksBody(mover, other)
{
    const otherDoc = other?.document;
    if (!otherDoc || otherDoc.hidden || other.id === mover?.id)
        return false;
    if (getLAFlag(otherDoc, 'isWreck') || isSolidToken(otherDoc))
        return false;

    const actor = other.actor;
    if (!actor)
        return false;
    if (actor.system?.structure?.value === 0 || actor.system?.stress?.value === 0)
        return false;
    if ((actor.type === 'pilot' || actor.type === 'deployable') && (actor.system?.hp?.value ?? 1) <= 0)
        return false;

    const moverSize = Number(mover.actor?.system?.size ?? 1) || 1;
    const otherSize = Number(actor.system?.size ?? 1) || 1;
    const sameIntangible = !!mover.actor?.statuses?.has('intangible') === !!actor.statuses?.has('intangible');
    return otherSize >= moverSize && sameIntangible && isHostile(mover, other);
}

let _bodyIndex = new Map();

function invalidateBodyIndex()
{
    _bodyIndex = new Map();
}

for (const hook of ['canvasReady', 'createToken', 'updateToken', 'deleteToken', 'updateActor', 'createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect'])
    Hooks.on(hook, invalidateBodyIndex);

function buildBodyIndex(mover)
{
    const sceneDistance = canvas.scene?.dimensions?.distance || 1;
    const index = new Map();

    for (const other of canvas.tokens?.placeables ?? [])
    {
        if (!blocksBody(mover, other))
            continue;

        const doc = other.document;
        const bottom = (doc.elevation ?? 0) / sceneDistance;
        const band = { bottom, top: bottom + laTokenGameplayHeight(doc) };
        let offsets = [];

        try
        {
            offsets = doc.getOccupiedGridSpaceOffsets?.() ?? [];
        }
        catch
        {
            offsets = [];
        }

        for (const offset of offsets)
        {
            const key = `${offset.j},${offset.i}`;
            const bands = index.get(key);
            if (bands)
                bands.push(band);
            else
                index.set(key, [band]);
        }
    }

    return index;
}

export function flyerBodyBandsAtCell(moverDoc, col, row)
{
    const mover = moverDoc?.object ?? canvas.tokens?.get(moverDoc?.id);
    if (!mover || !canvas?.ready || canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS)
        return [];

    let index = _bodyIndex.get(mover.id);

    if (!index)
    {
        index = buildBodyIndex(mover);
        _bodyIndex.set(mover.id, index);
    }

    return index.get(`${col},${row}`) ?? [];
}

export function bodyBlocksCell(moverDoc, col, row)
{
    return flyerBodyBandsAtCell(moverDoc, col, row).length > 0;
}

export function groundBandsAtCell(shapes, typeById, col, row, { excludeTokenId = null, solidTokens = true, bodiesFor = null } = {})
{
    const bands = solidBands(shapes, typeById);
    if (solidTokens)
        bands.push(...solidTokenBandsAtCell(col, row, excludeTokenId));
    if (bodiesFor)
        bands.push(...flyerBodyBandsAtCell(bodiesFor, col, row));
    return bands;
}

export function groundBandsAtPoint(shapes, typeById, x, y, { excludeTokenId = null, solidTokens = true } = {})
{
    const bands = solidBands(shapes, typeById);
    if (solidTokens)
        bands.push(...solidTokenBandsAtPoint(x, y, excludeTokenId));
    return bands;
}

export function groundTop(bands)
{
    let top = 0;

    for (const band of bands)
    {
        if (band.top > top)
            top = band.top;
    }

    return top;
}

export function solidTokenTopAt(x, y, excludeTokenId = null)
{
    return groundTop(solidTokenBandsAtPoint(x, y, excludeTokenId));
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
