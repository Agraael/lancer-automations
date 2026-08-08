/* global Hooks, game, canvas, CONST, foundry, PIXI, $ */

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'blocksLineOfSight';
const EDGE_PREFIX = 'la-block-los';
const SETTING_BULWARK_BLOCKS = 'bulwarkBlocksLineOfSight';

function shouldTokenBlock(token)
{
    const doc = token?.document ?? token;
    if (!doc)
        return false;
    if (doc.getFlag?.(MODULE_ID, FLAG_KEY))
        return true;
    const actor = (doc.actor) ?? token.actor;
    if (actor?.statuses?.has?.('bulwark'))
    {
        try
        {
            return game.settings.get(MODULE_ID, SETTING_BULWARK_BLOCKS) !== false;
        }
        catch (e)
        {
            return true;
        }
    }
    return false;
}

function _edgePrefix(token)
{
    const id = token.id ?? token.document?.id;
    return `${EDGE_PREFIX}-${id}-`;
}

function _hasEdges(token)
{
    if (!canvas?.edges)
        return false;
    const prefix = _edgePrefix(token);
    for (const key of canvas.edges.keys())
    {
        if (key.startsWith(prefix))
            return true;
    }
    return false;
}

function _removeEdges(token)
{
    if (!canvas?.edges)
        return;
    const prefix = _edgePrefix(token);
    const toDelete = [];
    for (const key of canvas.edges.keys())
    {
        if (key.startsWith(prefix))
            toDelete.push(key);
    }
    for (const key of toDelete)
        canvas.edges.delete(key);
}

function _getTokenElevationBounds(token)
{
    const doc = token.document ?? token;
    const grid = canvas?.grid?.distance ?? 1;
    const elevation = doc.elevation ?? 0;

    let losTotal = token.losHeight;
    if (typeof losTotal !== 'number')
    {
        const flagHeight = doc.flags?.['wall-height']?.tokenHeight;
        if (flagHeight && flagHeight > 0)
            losTotal = elevation + flagHeight;
        else
        {
            const size = token.actor?.system?.size;
            losTotal = elevation + ((size && size > 0) ? size * grid : grid);
        }
    }

    // Sit 0.1 below LOS height so same-height tokens peek above.
    const top = Math.max(elevation + 0.01, losTotal - 0.1);
    return { bottom: elevation, top };
}

function _getEdgeSegments(token)
{
    const bounds = token.bounds;
    if (!bounds)
        return [];
    const shape = token.shape;
    if (shape instanceof PIXI.Polygon && shape.points?.length >= 6)
    {
        const pts = shape.points;
        const ptCount = pts.length;
        const last = (pts[ptCount - 2] === pts[0] && pts[ptCount - 1] === pts[1]) ? ptCount - 2 : ptCount;
        const segments = [];
        for (let ptIdx = 0; ptIdx < last; ptIdx += 2)
        {
            const nextPtIdx = (ptIdx + 2) % last;
            segments.push([
                { x: bounds.x + pts[ptIdx],     y: bounds.y + pts[ptIdx + 1] },
                { x: bounds.x + pts[nextPtIdx], y: bounds.y + pts[nextPtIdx + 1] }
            ]);
        }
        return segments;
    }
    return [
        [{ x: bounds.x,     y: bounds.y      }, { x: bounds.right, y: bounds.y      }],
        [{ x: bounds.right, y: bounds.y      }, { x: bounds.right, y: bounds.bottom }],
        [{ x: bounds.right, y: bounds.bottom }, { x: bounds.x,     y: bounds.bottom }],
        [{ x: bounds.x,     y: bounds.bottom }, { x: bounds.x,     y: bounds.y      }]
    ];
}

function _addEdges(token)
{
    if (!canvas?.edges || !token)
        return;
    const segments = _getEdgeSegments(token);
    if (!segments.length)
        return;
    const prefix = _edgePrefix(token);
    const { top, bottom } = _getTokenElevationBounds(token);
    // Wall Height's _testEdgeInclusion reads edge.object.document.flags['wall-height']; give it a stub.
    const wallStub = { document: { flags: { 'wall-height': { top, bottom } } } };
    for (let i = 0; i < segments.length; i++)
    {
        const id = `${prefix}${i}`;
        const edge = new foundry.canvas.geometry.edges.Edge(segments[i][0], segments[i][1], {
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

function _refreshToken(token)
{
    if (!token)
        return;
    _removeEdges(token);
    if (shouldTokenBlock(token))
        _addEdges(token);
    canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
}

function _refreshAll()
{
    if (!canvas?.tokens)
        return;
    for (const token of canvas.tokens.placeables)
    {
        _removeEdges(token);
        if (shouldTokenBlock(token))
            _addEdges(token);
    }
    canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
}

function _onRenderTokenConfig(app, html)
{
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

export function initTokenBlocksVision()
{
    game.settings.register(MODULE_ID, SETTING_BULWARK_BLOCKS, {
        name: 'Bulwark blocks line of sight',
        hint: 'Tokens with the Bulwark status block line of sight.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () => _refreshAll()
    });

    Hooks.on('canvasReady', () => _refreshAll());

    Hooks.on('createToken', (tokenDoc) =>
    {
        const token = canvas.tokens?.get(tokenDoc.id);
        if (token)
            _refreshToken(token);
    });

    Hooks.on('deleteToken', (tokenDoc) =>
    {
        _removeEdges({ id: tokenDoc.id });
        canvas.perception?.update?.({ refreshEdges: true, refreshVision: true, refreshLighting: true }, true);
    });

    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        const token = canvas.tokens?.get(tokenDoc.id);
        if (!token)
            return;
        const flagChanged = change?.flags?.[MODULE_ID]?.[FLAG_KEY] !== undefined;
        const heightFlagChanged = change?.flags?.['wall-height']?.tokenHeight !== undefined;
        const moved = ['x', 'y', 'width', 'height', 'elevation'].some(k => k in change);
        if (flagChanged || heightFlagChanged || moved)
            _refreshToken(token);
    });

    Hooks.on('refreshToken', (token, opts) =>
    {
        if (!opts?.refreshPosition && !opts?.refreshSize)
            return;
        if (!shouldTokenBlock(token) && !_hasEdges(token))
            return;
        _refreshToken(token);
    });

    // Bulwark status apply / remove
    Hooks.on('createActiveEffect', (effect) =>
    {
        if (!effect.statuses?.has?.('bulwark'))
            return;
        const actor = effect.parent;
        const token = actor?.getActiveTokens?.()?.[0];
        if (token)
            _refreshToken(token);
    });

    Hooks.on('deleteActiveEffect', (effect) =>
    {
        if (!effect.statuses?.has?.('bulwark'))
            return;
        const actor = effect.parent;
        const token = actor?.getActiveTokens?.()?.[0];
        if (token)
            _refreshToken(token);
    });

    Hooks.on('renderTokenConfig', _onRenderTokenConfig);
    Hooks.on('renderPrototypeTokenConfig', _onRenderTokenConfig);
}
