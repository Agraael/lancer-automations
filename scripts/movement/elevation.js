/* global game, canvas, Hooks, libWrapper, foundry, CONST */

const MODULE_ID = 'lancer-automations';
const AUTO_ELEVATION = 'autoTokenElevation';
const THT_ID = 'terrain-height-tools';
const THT_IGNORE_FLAG = 'ignoreAutoElevation';
const LA_IGNORE_RULER_FLAG = 'ignoreRulerAutoElevation';

// Per-drag offset bumped by [/]/[\]; resets on drag start/cancel.
let _dragElevationOffset = 0;
export function getDragElevationOffset() {
    return _dragElevationOffset;
}
function resetDragElevation() {
    _dragElevationOffset = 0;
}

function isEnabled() {
    try {
        return !!game.settings.get(MODULE_ID, AUTO_ELEVATION);
    } catch {
        return false;
    }
}

function thtApi() {
    if (!game.modules.get(THT_ID)?.active)
        return null;
    return globalThis.terrainHeightTools ?? null;
}

// Footprint sample points (world space) for gridless terrain lookups.
function gridlessFootprintPoints(tokenDoc, position) {
    const gridSize = canvas.grid?.size ?? canvas.dimensions?.size ?? 1;
    const x = position?.x ?? tokenDoc.x ?? 0;
    const y = position?.y ?? tokenDoc.y ?? 0;
    const wPx = (position?.width ?? tokenDoc.width ?? 1) * gridSize;
    const hPx = (position?.height ?? tokenDoc.height ?? 1) * gridSize;
    const cols = Math.max(1, Math.round(wPx / gridSize));
    const rows = Math.max(1, Math.round(hPx / gridSize));
    const pts = [];
    for (let c = 0; c < cols; c++)
        for (let r = 0; r < rows; r++)
            pts.push([x + (c + 0.5) * (wPx / cols), y + (r + 0.5) * (hPx / rows)]);
    return pts;
}

function terrainTopUnder(tokenDoc, position) {
    const tht = thtApi();
    if (!tht)
        return null;
    const terrainTypes = tht.getTerrainTypes?.() ?? [];
    const typeById = new Map(terrainTypes.map(t => [t.id, t]));

    let highest = null;
    const consider = (shapes) => {
        for (const shape of shapes) {
            const tt = typeById.get(shape.terrainTypeId);
            if (!tt?.usesHeight || !tt?.isSolid)
                continue;
            const top = shape.top ?? (shape.elevation + shape.height);
            if (highest == null || top > highest)
                highest = top;
        }
    };

    if (canvas.grid?.type === CONST.GRID_TYPES.GRIDLESS) {
        // Gridless: sample the footprint by world point.
        for (const [px, py] of gridlessFootprintPoints(tokenDoc, position)) {
            try {
                consider(tht.getShapesAtPoint?.(px, py) ?? []);
            } catch { /* ignore */ }
        }
    } else {
        let offsets = [];
        try {
            offsets = tokenDoc.getOccupiedGridSpaceOffsets?.(position ?? {}) ?? [];
        } catch { /* invalid */ }
        for (const off of offsets)
            consider(tht.getCell?.(off.j, off.i) ?? []);
    }
    return highest;
}

function shouldAutoElevate(tokenDoc, { ruler = true } = {}) {
    if (!isEnabled())
        return false;
    if (tokenDoc.getFlag?.(THT_ID, THT_IGNORE_FLAG))
        return false;
    if (ruler && tokenDoc.getFlag?.(MODULE_ID, LA_IGNORE_RULER_FLAG))
        return false;
    return true;
}

function newElevationFor(tokenDoc, position) {
    const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
    const originTop = terrainTopUnder(tokenDoc, { x: tokenDoc.x, y: tokenDoc.y }) ?? 0;
    const destTop = terrainTopUnder(tokenDoc, position) ?? 0;
    const terrainDelta = (destTop - originTop) * sceneDistance;
    const userDelta = _dragElevationOffset * sceneDistance;
    return (tokenDoc.elevation ?? 0) + terrainDelta + userDelta;
}

function bumpDragElevation(delta) {
    _dragElevationOffset += delta;
    for (const tok of canvas.tokens?.placeables ?? []) {
        const idata = tok.mouseInteractionManager?.interactionData;
        const contexts = idata?.contexts;
        if (!contexts)
            continue;
        for (const context of Object.values(contexts)) {
            if (!context?.destination || !context.token?.document || !context.clonedToken?.document)
                continue;
            const newElev = elevationForPreview(context.token.document, context.destination);
            context.clonedToken.document.elevation = newElev;
            context.clonedToken.renderFlags?.set?.({ refresh: true });
            // Stamp the new elevation and dirty the destination so the re-plan below actually runs:
            // _updateDragDestination skips on an unchanged x/y point and ignores elevation otherwise.
            context.destination = { ...context.destination, elevation: newElev, _laElevReplan: Math.random() };
        }
        try {
            tok._updateDragDestination?.(idata.destination, { snap: false });
        } catch { /* ignore */ }
    }
}

function applyAutoElevationToWaypoint(tokenDoc, waypoint) {
    if (!waypoint || typeof waypoint !== 'object')
        return false;
    if (waypoint.x == null || waypoint.y == null)
        return false;
    const newElev = newElevationFor(tokenDoc, {
        x: waypoint.x,
        y: waypoint.y,
        width: waypoint.width ?? tokenDoc.width,
        height: waypoint.height ?? tokenDoc.height
    });
    if (waypoint.elevation === newElev)
        return false;
    waypoint.elevation = newElev;
    return true;
}

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, AUTO_ELEVATION, {
        name: 'Auto-elevate tokens on terrain',
        hint: 'When a token is created or moved, set its elevation to the top of the highest solid THT terrain under it.',
        scope: 'world',
        type: Boolean,
        default: true,
        config: false
    });

});

export function bumpDragElevationFromKey(delta) {
    bumpDragElevation(delta);
}

Hooks.on('preCreateToken', (tokenDoc, _data, _options, userId) => {
    if (userId !== game.userId)
        return;
    if (!shouldAutoElevate(tokenDoc, { ruler: false }))
        return;
    const top = terrainTopUnder(tokenDoc, {});
    if (top != null && top > 0) {
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        tokenDoc.updateSource({ elevation: top * sceneDistance });
    }
});

export function elevationForPreview(tokenDoc, waypoint) {
    if (!shouldAutoElevate(tokenDoc))
        return tokenDoc.elevation;
    return newElevationFor(tokenDoc, {
        x: waypoint.x,
        y: waypoint.y,
        width: waypoint.width ?? tokenDoc.width,
        height: waypoint.height ?? tokenDoc.height
    });
}

Hooks.once('ready', () => {
    if (!game.modules.get('lib-wrapper')?.active)
        return;

    // Native Ctrl+wheel and Q/E elevation would add to pathfinder cost; we route to our offset.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onDragMouseWheel', function() {}, 'OVERRIDE');

    // Native Q/E during drag also adds to pathfinder cost. Route to our offset mechanism.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._changeDragElevation', function(delta) {
        bumpDragElevation(Math.sign(delta));
    }, 'OVERRIDE');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._onDragLeftStart', function(wrapped, event) {
        resetDragElevation();
        return wrapped.call(this, event);
    }, 'WRAPPER');

    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._updateDragDestination', function(wrapped, point, options) {
        const result = wrapped.call(this, point, options);
        const contexts = Object.values(this.mouseInteractionManager?.interactionData?.contexts ?? {});
        const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
        for (const context of contexts) {
            if (!context?.destination || !context.token?.document)
                continue;
            // Stamp the destination elevation so Foundry's path planner treats a pure-vertical drag as a real waypoint.
            const newElev = shouldAutoElevate(context.token.document)
                ? elevationForPreview(context.token.document, context.destination)
                : (context.token.document.elevation ?? 0) + _dragElevationOffset * sceneDistance;
            context.destination.elevation = newElev;
            if (context.clonedToken?.document && context.clonedToken.document.elevation !== newElev) {
                context.clonedToken.document.elevation = newElev;
                context.clonedToken.renderFlags?.set?.({ refresh: true });
            }
        }
        return result;
    }, 'WRAPPER');

    // Only place we change stored elevation, keeping the path to one segment.
    libWrapper.register(MODULE_ID, 'foundry.canvas.placeables.Token.prototype._prepareDragLeftDropUpdates', function(wrapped, event) {
        const result = wrapped.call(this, event);
        const [updates, options] = result;
        // Pure-elevation drag: native drop skips contexts whose path has just the origin (no horizontal move).
        // Synthesize an elevation-only waypoint at the current position so Q/E offset is committed.
        if (_dragElevationOffset !== 0) {
            const contexts = event?.interactionData?.contexts ?? {};
            for (const [id, ctx] of Object.entries(contexts)) {
                if ((ctx?.foundPath?.length ?? 0) > 1)
                    continue;
                const doc = canvas.scene.tokens.get(id);
                if (!doc)
                    continue;
                const sceneDistance = canvas.scene?.dimensions?.distance ?? 1;
                const elev = (doc.elevation ?? 0) + _dragElevationOffset * sceneDistance;
                if (!updates.some(u => u._id === id))
                    updates.push({ _id: id });
                options.movement ??= {};
                options.movement[id] = {
                    waypoints: [{ x: doc.x, y: doc.y, elevation: elev, action: undefined, snapped: true, explicit: true }],
                    method: "dragging",
                    constrainOptions: this._getDragConstrainOptions()
                };
            }
        }
        if (!shouldAutoElevate(this.document))
            return result;
        for (const id of Object.keys(options?.movement ?? {})) {
            const doc = canvas.scene.tokens.get(id);
            if (!doc)
                continue;
            const waypoints = options.movement[id].waypoints;
            if (!Array.isArray(waypoints))
                continue;
            for (const wp of waypoints)
                applyAutoElevationToWaypoint(doc, wp);
        }
        return result;
    }, 'WRAPPER');

    // Only drag-moves get auto-elevated; config edits, api calls, paste, undo, keyboard pass through.
    libWrapper.register(MODULE_ID, 'foundry.documents.TokenDocument.prototype.move', function(wrapped, waypoints, options = {}) {
        if (options.method !== 'dragging')
            return wrapped.call(this, waypoints, options);
        if (!shouldAutoElevate(this))
            return wrapped.call(this, waypoints, options);
        const wpArr = Array.isArray(waypoints) ? waypoints : [waypoints];
        for (const wp of wpArr)
            applyAutoElevationToWaypoint(this, wp);
        return wrapped.call(this, wpArr, options);
    }, 'WRAPPER');
});
