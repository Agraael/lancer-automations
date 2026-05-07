/* global Hooks, game, canvas, CONST, foundry, PIXI, $ */

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'blocksLineOfSight';
const EDGE_PREFIX = 'la-block-los';
const SETTING_BULWARK_BLOCKS = 'bulwarkBlocksLineOfSight';

function shouldTokenBlock(token) {
    const doc = token?.document ?? token;
    if (!doc)
        return false;
    if (doc.getFlag?.(MODULE_ID, FLAG_KEY))
        return true;
    const actor = (doc.actor) ?? token.actor;
    if (actor?.statuses?.has?.('bulwark')) {
        try {
            return game.settings.get(MODULE_ID, SETTING_BULWARK_BLOCKS) !== false;
        } catch (e) {
            return true;
        }
    }
    return false;
}

function _edgePrefix(token) {
    const id = token.id ?? token.document?.id;
    return `${EDGE_PREFIX}-${id}-`;
}

function _hasEdges(token) {
    if (!canvas?.edges)
        return false;
    const prefix = _edgePrefix(token);
    for (const key of canvas.edges.keys()) {
        if (key.startsWith(prefix))
            return true;
    }
    return false;
}

function _removeEdges(token) {
    if (!canvas?.edges)
        return;
    const prefix = _edgePrefix(token);
    const toDelete = [];
    for (const key of canvas.edges.keys()) {
        if (key.startsWith(prefix))
            toDelete.push(key);
    }
    for (const key of toDelete)
        canvas.edges.delete(key);
}

function _getTokenElevationBounds(token) {
    const doc = token.document ?? token;
    const grid = canvas?.grid?.distance ?? 1;
    const elevation = doc.elevation ?? 0;

    // token.losHeight (from wall-height) is elevation + heightPortion. Use it directly as top.
    let losTotal = token.losHeight;
    if (typeof losTotal !== 'number') {
        const flagHeight = doc.flags?.['wall-height']?.tokenHeight;
        if (flagHeight && flagHeight > 0)
            losTotal = elevation + flagHeight;
        else {
            const size = token.actor?.system?.size;
            losTotal = elevation + ((size && size > 0) ? size * grid : grid);
        }
    }

    // Wall sits 0.1 below LOS height so same-height tokens (source at losHeight) peek above.
    const top = Math.max(elevation + 0.01, losTotal - 0.1);
    return { bottom: elevation, top };
}

function _getEdgeSegments(token) {
    const b = token.bounds;
    if (!b)
        return [];
    const shape = token.shape;
    if (shape instanceof PIXI.Polygon && shape.points?.length >= 6) {
        const pts = shape.points;
        const n = pts.length;
        const last = (pts[n - 2] === pts[0] && pts[n - 1] === pts[1]) ? n - 2 : n;
        const segments = [];
        for (let i = 0; i < last; i += 2) {
            const j = (i + 2) % last;
            segments.push([
                { x: b.x + pts[i],     y: b.y + pts[i + 1] },
                { x: b.x + pts[j],     y: b.y + pts[j + 1] }
            ]);
        }
        return segments;
    }
    return [
        [{ x: b.x,     y: b.y      }, { x: b.right, y: b.y      }],
        [{ x: b.right, y: b.y      }, { x: b.right, y: b.bottom }],
        [{ x: b.right, y: b.bottom }, { x: b.x,     y: b.bottom }],
        [{ x: b.x,     y: b.bottom }, { x: b.x,     y: b.y      }]
    ];
}

function _addEdges(token) {
    if (!canvas?.edges || !token)
        return;
    const segments = _getEdgeSegments(token);
    if (!segments.length)
        return;
    const prefix = _edgePrefix(token);
    const { top, bottom } = _getTokenElevationBounds(token);
    // Terrain-wall semantics: LIMITED sense blocks after the second crossing.
    // Outside sees up to the far edge of the shape (sees the token, not past it).
    // Inside sees out (only one edge between the source and outside).
    // Wall Height's _testEdgeInclusion reads edge.object and calls getWallBounds(edge.object),
    // which falls back to wall.document then reads .flags['wall-height']. We give it a stub.
    const wallStub = { document: { flags: { 'wall-height': { top, bottom } } } };
    for (let i = 0; i < segments.length; i++) {
        const id = `${prefix}${i}`;
        const edge = new foundry.canvas.edges.Edge(segments[i][0], segments[i][1], {
            id,
            object: /** @type {any} */(wallStub),
            type: 'wall',
            light: CONST.WALL_SENSE_TYPES.LIMITED,
            sight: CONST.WALL_SENSE_TYPES.LIMITED,
            sound: CONST.WALL_SENSE_TYPES.NONE,
            move: CONST.WALL_SENSE_TYPES.NONE
        });
        canvas.edges.set(id, edge);
    }
}

function _refreshToken(token) {
    if (!token)
        return;
    _removeEdges(token);
    if (shouldTokenBlock(token))
        _addEdges(token);
    canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
}

function _refreshAll() {
    if (!canvas?.tokens)
        return;
    for (const t of canvas.tokens.placeables) {
        _removeEdges(t);
        if (shouldTokenBlock(t))
            _addEdges(t);
    }
    canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
}

function _onRenderTokenConfig(app, html) {
    const $html = html instanceof jQuery ? html : $(html);
    const $visionTab = $html.find('.tab[data-tab="vision"]');
    if (!$visionTab.length)
        return;
    const tokenDoc = app.token ?? app.object ?? app.document;
    const checked = !!tokenDoc?.getFlag?.(MODULE_ID, FLAG_KEY);
    const block = `
        <hr/>
        <div class="form-group">
            <label data-tooltip="Token blocks line of sight through its bounding box. The Bulwark status enables this automatically while active.">Blocks Line of Sight</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_KEY}" ${checked ? 'checked' : ''}>
            </div>
        </div>
    `;
    $visionTab.append(block);
    app.setPosition?.({ height: 'auto' });
}

export function initTokenBlocksVision() {
    game.settings.register(MODULE_ID, SETTING_BULWARK_BLOCKS, {
        name: 'Bulwark blocks line of sight',
        hint: 'When enabled, the Bulwark status automatically makes a token block line of sight (per-token override still available in Token Config Vision tab).',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => _refreshAll()
    });

    Hooks.on('canvasReady', () => _refreshAll());

    Hooks.on('createToken', (tokenDoc) => {
        const t = canvas.tokens?.get(tokenDoc.id);
        if (t)
            _refreshToken(t);
    });

    Hooks.on('deleteToken', (tokenDoc) => {
        _removeEdges({ id: tokenDoc.id });
        canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
    });

    Hooks.on('updateToken', (tokenDoc, change) => {
        const t = canvas.tokens?.get(tokenDoc.id);
        if (!t)
            return;
        const flagChanged = change?.flags?.[MODULE_ID]?.[FLAG_KEY] !== undefined;
        const heightFlagChanged = change?.flags?.['wall-height']?.tokenHeight !== undefined;
        const moved = ['x', 'y', 'width', 'height', 'elevation'].some(k => k in change);
        if (flagChanged || heightFlagChanged || moved)
            _refreshToken(t);
    });

    Hooks.on('refreshToken', (token, opts) => {
        if (!opts?.refreshPosition && !opts?.refreshSize)
            return;
        if (!shouldTokenBlock(token) && !_hasEdges(token))
            return;
        _refreshToken(token);
    });

    // Bulwark status apply / remove
    Hooks.on('createActiveEffect', (effect) => {
        if (!effect.statuses?.has?.('bulwark'))
            return;
        const actor = effect.parent;
        const t = actor?.getActiveTokens?.()?.[0];
        if (t)
            _refreshToken(t);
    });

    Hooks.on('deleteActiveEffect', (effect) => {
        if (!effect.statuses?.has?.('bulwark'))
            return;
        const actor = effect.parent;
        const t = actor?.getActiveTokens?.()?.[0];
        if (t)
            _refreshToken(t);
    });

    Hooks.on('renderTokenConfig', _onRenderTokenConfig);
    Hooks.on('renderPrototypeTokenConfig', _onRenderTokenConfig);
}
