import { invalidateLosCaches } from './lancerDetectionModes.js';
import { refreshTokenBlockEdges } from './tokenBlocksVision.js';

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
const FLAG_KEY = 'losBlock';
const SETTING_FLAG_ONLY = 'lancerLosFlagOnly';
const EDGE_PREFIX = 'la-wall-los-';
const WALL_COLOR = 0xFF4444;

/** True when LA line of sight uses only LA-flagged walls, ignoring plain sight walls. */
export function laLosFlagOnly()
{
    return getModuleSetting(SETTING_FLAG_ONLY) === true;
}

/** Sweep edgeOptions for LA-owned sweeps: laSight edges in, plain walls out in flag-only mode. */
export function laSightEdgeOptions()
{
    return laLosFlagOnly() ? { laSight: true, wall: false } : { laSight: true };
}

function _shouldMirror(wallDoc)
{
    if (!wallDoc?.getFlag?.(MODULE_ID, FLAG_KEY))
        return false;
    // Outside flag-only mode a wall that already blocks sight is in every test, a mirror would double its edges.
    if (!laLosFlagOnly() && (wallDoc.sight ?? 0) > 0)
        return false;
    if (wallDoc.door > 0 && wallDoc.ds === CONST.WALL_DOOR_STATES.OPEN)
        return false;
    return true;
}

function _edgeId(wallDoc)
{
    return `${EDGE_PREFIX}${wallDoc.id}`;
}

function _addMirror(wallDoc)
{
    const coords = wallDoc.c;
    if (!canvas?.edges || !Array.isArray(coords) || coords.length < 4)
        return;
    const id = _edgeId(wallDoc);
    // Real document as the object so wall-height reads its top/bottom flags.
    const edge = new foundry.canvas.geometry.edges.Edge(
        { x: coords[0], y: coords[1] },
        { x: coords[2], y: coords[3] },
        {
            id,
            object: /** @type {any} */ ({ document: wallDoc }),
            type: 'laSight',
            direction: wallDoc.dir ?? CONST.WALL_DIRECTIONS.BOTH,
            light: CONST.WALL_SENSE_TYPES.NONE,
            sight: CONST.WALL_SENSE_TYPES.NORMAL,
            sound: CONST.WALL_SENSE_TYPES.NONE,
            move: CONST.WALL_SENSE_TYPES.NONE,
        });
    canvas.edges.set(id, edge);
}

function _refreshWall(wallDoc)
{
    if (!canvas?.edges)
        return;
    canvas.edges.delete(_edgeId(wallDoc));
    if (_shouldMirror(wallDoc))
        _addMirror(wallDoc);
    invalidateLosCaches();
    canvas.perception?.update?.({ refreshVision: true }, true);
}

function _refreshAll()
{
    if (!canvas?.edges || !canvas.scene)
        return;
    const toDelete = [];
    for (const key of canvas.edges.keys())
    {
        if (key.startsWith(EDGE_PREFIX))
            toDelete.push(key);
    }
    for (const key of toDelete)
        canvas.edges.delete(key);
    for (const wallDoc of canvas.scene.walls)
    {
        if (_shouldMirror(wallDoc))
            _addMirror(wallDoc);
    }
    invalidateLosCaches();
}

// laSight edges enter a sweep only when its config opts in via edgeOptions.laSight.
function _patchSweepEdgeTypes()
{
    const cls = CONFIG.Canvas?.polygonBackends?.sight ?? foundry.canvas.geometry.ClockwiseSweepPolygon;
    const proto = cls?.prototype;
    if (!proto?._determineEdgeTypes || proto._laSightPatched)
        return;
    const original = proto._determineEdgeTypes;
    proto._determineEdgeTypes = function (type, priority, config = {})
    {
        const edgeTypes = original.call(this, type, priority, config);
        if (config?.edgeOptions?.laSight)
            edgeTypes.laSight = { mode: 1, priority: -Infinity };
        return edgeTypes;
    };
    proto._laSightPatched = true;
}

// Flagged walls render red on the wall layer. Doors keep their state colors.
function _patchWallColor()
{
    const proto = foundry.canvas.placeables.Wall?.prototype;
    if (!proto?._getWallColor || proto._laColorPatched)
        return;
    const original = proto._getWallColor;
    proto._getWallColor = function ()
    {
        const doc = this.document;
        if (doc?.getFlag?.(MODULE_ID, FLAG_KEY) && !(doc.door > 0))
            return WALL_COLOR;
        return original.call(this);
    };
    proto._laColorPatched = true;
}

function _onRenderWallConfig(app, html)
{
    const el = html instanceof HTMLElement ? html : html?.[0];
    if (!el || el.querySelector(`input[name="flags.${MODULE_ID}.${FLAG_KEY}"]`))
        return;
    const doc = app.document;
    const checked = !!doc?.getFlag?.(MODULE_ID, FLAG_KEY);
    const anchor = el.querySelector('[name="door"]')?.closest('fieldset');
    if (!anchor)
        return;
    anchor.insertAdjacentHTML('afterend', `
        <fieldset>
            <legend>Lancer Automations</legend>
            <div class="form-group">
                <label>Blocks LA Line of Sight</label>
                <div class="form-fields">
                    <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_KEY}" ${checked ? 'checked' : ''}>
                </div>
                <p class="hint">Blocks Lancer line of sight, not Foundry vision.</p>
            </div>
        </fieldset>
    `);
    app.setPosition?.({ height: 'auto' });
}

export function initLaWallLos()
{
    _patchSweepEdgeTypes();
    _patchWallColor();
    game.settings.register(MODULE_ID, SETTING_FLAG_ONLY, {
        name: 'Flagged walls only',
        hint: 'Lancer line of sight uses only LA-flagged walls.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () =>
        {
            _refreshAll();
            refreshTokenBlockEdges();
            canvas?.perception?.update?.({ refreshVision: true }, true);
        }
    });
    Hooks.on('canvasReady', _refreshAll);
    Hooks.on('createWall', (wallDoc) =>
    {
        if (wallDoc.parent === canvas?.scene)
            _refreshWall(wallDoc);
    });
    Hooks.on('deleteWall', (wallDoc) =>
    {
        if (wallDoc.parent !== canvas?.scene || !canvas?.edges)
            return;
        canvas.edges.delete(_edgeId(wallDoc));
        invalidateLosCaches();
        canvas.perception?.update?.({ refreshVision: true }, true);
    });
    Hooks.on('updateWall', (wallDoc, change) =>
    {
        if (wallDoc.parent !== canvas?.scene)
            return;
        const flagChanged = change?.flags?.[MODULE_ID]?.[FLAG_KEY] !== undefined;
        const relevant = ['c', 'sight', 'door', 'ds', 'dir'].some(key => key in change)
            || flagChanged
            || change?.flags?.['wall-height'] !== undefined;
        if (relevant)
            _refreshWall(wallDoc);
        if (flagChanged)
            wallDoc.object?.renderFlags.set({ refreshLine: true, refreshEndpoints: true });
    });
    Hooks.on('renderWallConfig', _onRenderWallConfig);
}
