/* global canvas, game, Hooks, foundry, jQuery, $, libWrapper, PIXI */

/*
   Lancer-style vision: see from the token's perimeter, not its center.
   Foundry's default polygon originates at the center, so a 4x4 mech can't
   peek around a corner that its body already pokes past. Fix: spawn extra
   PointVisionSource instances along the token's edges; Foundry unions all
   registered sources, so the rendered vision is "see from any sample".

       *----*----*       C  --->|--- *
       |         |              wall  ^ source nudged to here
       *    C    *
       |         |       Per sample, raycast C -> sample. If a sight wall
       *----*----*       blocks, the source goes 4 px past the hit toward
                         C, so it sits inside the same wall enclosure as
                         the token's center (no leak through flush walls).

*/

const MODULE_ID = 'lancer-automations';
const FLAG_KEY = 'visionFromEdge';
const SETTING_ENABLED = 'visionFromEdgeEnabled';
const SETTING_SAMPLE_MODE = 'visionFromEdgeSampleMode';
const SOURCE_ID_PART = 'la-edge';

function _getVisionSourceClass() {
    return foundry?.canvas?.sources?.PointVisionSource
        ?? globalThis.PointVisionSource
        ?? null;
}

function _isEdgeVisionEnabled(tokenDoc) {
    const flag = tokenDoc?.getFlag?.(MODULE_ID, FLAG_KEY);
    if (flag === 'on') {
        return true;
    }
    if (flag === 'off') {
        return false;
    }
    return game.settings.get(MODULE_ID, SETTING_ENABLED) === true;
}

function _getSampleCount(tokenDoc) {
    const mode = game.settings.get(MODULE_ID, SETTING_SAMPLE_MODE);
    if (mode === 'corners4') {
        return 4;
    }
    if (mode === 'perimeter8') {
        return 8;
    }
    const w = tokenDoc?.width ?? 1;
    const h = tokenDoc?.height ?? 1;
    return (w >= 3 || h >= 3) ? 8 : 4;
}

function _getSamplePoints(token) {
    const tokenDoc = token.document;
    const count = _getSampleCount(tokenDoc);
    const size = token.getSize?.() ?? { width: token.w, height: token.h };
    const x0 = tokenDoc.x;
    const y0 = tokenDoc.y;
    const x1 = x0 + size.width;
    const y1 = y0 + size.height;
    const cx = x0 + size.width / 2;
    const cy = y0 + size.height / 2;
    const eps = 1;
    const ix0 = x0 + eps;
    const iy0 = y0 + eps;
    const ix1 = x1 - eps;
    const iy1 = y1 - eps;

    const raw = [
        { x: ix0, y: iy0 },
        { x: ix1, y: iy0 },
        { x: ix1, y: iy1 },
        { x: ix0, y: iy1 }
    ];
    if (count > 4) {
        raw.push(
            { x: cx, y: iy0 },
            { x: ix1, y: cy },
            { x: cx, y: iy1 },
            { x: ix0, y: cy }
        );
    }
    return raw.map(pt => _nudgePastWall(pt, { x: cx, y: cy }, token));
}

function _getTokenVisionLOS(token) {
    const doc = token.document;
    const elev = doc.elevation ?? 0;
    const tokenHeight = doc.flags?.['wall-height']?.tokenHeight
        ?? doc.flags?.elevatedvision?.tokenHeight
        ?? 1;
    return elev + tokenHeight;
}

function _edgeBlocksAtLOS(edge, los) {
    if ((edge.sight ?? 0) <= 0) {
        return false;
    }
    const flags = edge.object?.document?.flags?.['wall-height']
        ?? edge.object?.flags?.['wall-height']
        ?? {};
    const wallBottom = flags.bottom ?? Number.NEGATIVE_INFINITY;
    const wallTop = flags.top ?? Number.POSITIVE_INFINITY;
    return wallBottom <= los && los <= wallTop;
}

function _nudgePastWall(sample, center, token) {
    if (!canvas?.edges || !token) {
        return sample;
    }
    const los = _getTokenVisionLOS(token);
    const dx = center.x - sample.x;
    const dy = center.y - sample.y;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) {
        return sample;
    }

    const ownPrefix = `la-block-los-${token.id}-`;
    let closest = null;
    let closestT = Infinity;
    for (const edge of canvas.edges.values()) {
        if (edge.type !== 'wall') {
            continue;
        }
        if (edge.id?.startsWith(ownPrefix)) {
            continue;
        }
        if (!_edgeBlocksAtLOS(edge, los)) {
            continue;
        }
        if (!foundry.utils.lineSegmentIntersects(sample, center, edge.a, edge.b)) {
            continue;
        }
        const inter = foundry.utils.lineLineIntersection(sample, center, edge.a, edge.b);
        if (!inter) {
            continue;
        }
        const t = ((inter.x - sample.x) * dx + (inter.y - sample.y) * dy) / len2;
        if (t < closestT) {
            closestT = t;
            closest = inter;
        }
    }
    if (!closest) {
        return sample;
    }
    const len = Math.sqrt(len2);
    const past = 4;
    return {
        x: closest.x + (dx / len) * past,
        y: closest.y + (dy / len) * past
    };
}

function _edgeSourceId(token, idx) {
    return `${token.sourceId}.${SOURCE_ID_PART}.${idx}`;
}

function _destroyEdgeSources(token) {
    if (!canvas?.effects?.visionSources) {
        return false;
    }
    const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
    let removed = false;
    for (const id of [...canvas.effects.visionSources.keys()]) {
        if (id.startsWith(prefix)) {
            const source = canvas.effects.visionSources.get(id);
            try {
                source?.destroy?.();
            } catch (e) {
                // ignore
            }
            canvas.effects.visionSources.delete(id);
            removed = true;
        }
    }
    return removed;
}

function _buildEdgeSources(token) {
    if (!canvas?.effects?.visionSources || !token?.document) {
        return false;
    }
    _destroyEdgeSources(token);

    if (!token.document.sight?.enabled) {
        return false;
    }
    if (!token.vision || token.vision.disabled) {
        return false;
    }
    if (!_isEdgeVisionEnabled(token.document)) {
        return false;
    }

    const SourceClass = _getVisionSourceClass();
    if (!SourceClass) {
        return false;
    }

    let primaryData;
    try {
        primaryData = token._getVisionSourceData();
    } catch (e) {
        return false;
    }
    if (!primaryData) {
        return false;
    }

    const samples = _getSamplePoints(token);
    let added = false;
    samples.forEach((pt, idx) => {
        const sourceId = _edgeSourceId(token, idx);
        try {
            // Lie about shape/bounds so Foundry's sweep filters don't
            // claim the whole token footprint as "self area".
            const tinyBounds = new PIXI.Rectangle(pt.x - 1, pt.y - 1, 2, 2);
            const objectStandIn = new Proxy(token, {
                get(target, prop) {
                    if (prop === 'shape') {
                        return null;
                    }
                    if (prop === 'bounds') {
                        return tinyBounds;
                    }
                    return Reflect.get(target, prop, target);
                }
            });
            const source = new SourceClass({ sourceId, object: objectStandIn });
            const halfSize = primaryData.externalRadius ?? 0;
            const clipRadius = primaryData.radius ?? 0;
            if (clipRadius > 0) {
                source._laEdgeClipCircle = new PIXI.Circle(primaryData.x, primaryData.y, clipRadius);
            }
            source.initialize({
                ...primaryData,
                x: pt.x,
                y: pt.y,
                disabled: false,
                externalRadius: 1,
                radius: Math.max(0, (primaryData.radius ?? 0) - halfSize),
                lightRadius: Math.max(0, (primaryData.lightRadius ?? 0) - halfSize)
            });
            if (typeof source.add === 'function') {
                source.add();
            } else {
                canvas.effects.visionSources.set(sourceId, source);
            }
            added = true;
        } catch (e) {
            console.warn(`${MODULE_ID} | edge vision source ${idx} for token ${token.id} failed to initialize:`, e);
        }
    });
    return added;
}

function _refreshVision() {
    if (!canvas?.perception) {
        return;
    }
    canvas.perception.update({ refreshVision: true });
}

function _isVisionRelevantChange(change) {
    if (!change) {
        return false;
    }
    if (['x', 'y', 'width', 'height', 'hexagonalShape', 'rotation', 'elevation', 'sight'].some(k => k in change)) {
        return true;
    }
    if (change?.flags?.[MODULE_ID]?.[FLAG_KEY] !== undefined) {
        return true;
    }
    return false;
}

function _rebuildAll() {
    if (!canvas?.tokens) {
        return;
    }
    let changed = false;
    for (const token of canvas.tokens.placeables) {
        if (_buildEdgeSources(token)) {
            changed = true;
        } else if (_destroyEdgeSources(token)) {
            changed = true;
        }
    }
    if (changed) {
        _refreshVision();
    }
}

function _onUpdateToken(tokenDoc, change) {
    if (!_isVisionRelevantChange(change)) {
        return;
    }
    const token = tokenDoc.object;
    if (!token) {
        return;
    }
    _buildEdgeSources(token);
    _refreshVision();
}

function _onCreateToken(tokenDoc) {
    const token = tokenDoc.object;
    if (!token) {
        return;
    }
    if (_buildEdgeSources(token)) {
        _refreshVision();
    }
}

function _onDeleteToken(tokenDoc) {
    const token = tokenDoc.object;
    if (!token) {
        return;
    }
    if (_destroyEdgeSources(token)) {
        _refreshVision();
    }
}

function _onCanvasReady() {
    _rebuildAll();
    if (game.settings.get(MODULE_ID, 'visionFromEdgeDebug')) {
        /** @type {any} */ (globalThis).lancerVisionDebug?.show?.();
    }
}

function _cleanOrphanEdgeSources() {
    if (!canvas?.effects?.visionSources) {
        return;
    }
    const validSourceIds = new Set((canvas.tokens?.placeables ?? []).map(t => t.sourceId));
    const marker = `.${SOURCE_ID_PART}.`;
    let changed = false;
    for (const id of [...canvas.effects.visionSources.keys()]) {
        const markerIdx = id.indexOf(marker);
        if (markerIdx === -1) {
            continue;
        }
        const baseSourceId = id.slice(0, markerIdx);
        if (validSourceIds.has(baseSourceId)) {
            continue;
        }
        const source = canvas.effects.visionSources.get(id);
        try {
            source?.destroy?.();
        } catch (e) {
            // ignore
        }
        canvas.effects.visionSources.delete(id);
        changed = true;
    }
    if (changed) {
        _refreshVision();
    }
}

function _onControlToken(token) {
    try {
        _buildEdgeSources(token);
        _refreshVision();
    } catch (e) {
        // ignore
    }
}

function _onRenderTokenConfig(app, html) {
    const $html = (typeof jQuery !== 'undefined' && html instanceof jQuery) ? html : $(html);
    const $visionTab = $html.find('.tab[data-tab="vision"]');
    if (!$visionTab.length) {
        return;
    }

    const tokenDoc = app.token ?? app.object ?? app.document;
    const current = tokenDoc?.getFlag?.(MODULE_ID, FLAG_KEY);
    const val = current === 'on' ? 'on' : current === 'off' ? 'off' : 'default';

    const block = `
        <hr/>
        <div class="form-group">
            <label data-tooltip="Vision computed from the token's perimeter (Lancer LOS-style) so larger tokens can peek around corners. 'Default' follows the world setting.">Vision From Edge</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.${FLAG_KEY}">
                    <option value="default" ${val === 'default' ? 'selected' : ''}>Default (world setting)</option>
                    <option value="on" ${val === 'on' ? 'selected' : ''}>On</option>
                    <option value="off" ${val === 'off' ? 'selected' : ''}>Off</option>
                </select>
            </div>
        </div>
    `;
    $visionTab.append(block);
    app.setPosition?.({ height: 'auto' });
}

let _debugContainer = null;
let _debugHookIds = [];

function _drawDebugMarkers() {
    if (!_debugContainer) {
        return;
    }
    for (const c of _debugContainer.removeChildren()) {
        c.destroy();
    }
    const colors = [0xff0000, 0x00ff00, 0x3366ff, 0xffff00, 0xff00ff, 0x00ffff, 0xff8000, 0x8000ff];
    for (const token of canvas.tokens?.controlled ?? []) {
        const prefix = `${token.sourceId}.${SOURCE_ID_PART}.`;
        const center = token.center;
        let idx = 0;
        for (const [id, source] of canvas.effects.visionSources.entries()) {
            if (!id.startsWith(prefix)) {
                continue;
            }
            const color = colors[idx % colors.length];
            const g = new PIXI.Graphics();
            g.lineStyle(2, color, 0.6).moveTo(center.x, center.y).lineTo(source.data.x, source.data.y);
            g.beginFill(color, 0.9).lineStyle(0).drawCircle(source.data.x, source.data.y, 8).endFill();
            _debugContainer.addChild(g);
            idx++;
        }
    }
}

window.lancerVisionDebug = {
    show() {
        if (_debugContainer) {
            _drawDebugMarkers();
            return;
        }
        _debugContainer = new PIXI.Container();
        canvas.controls.addChild(_debugContainer);
        const events = ['controlToken', 'updateToken', 'refreshToken', 'sightRefresh', 'canvasReady'];
        _debugHookIds = events.map(name => ({ name, id: Hooks.on(name, _drawDebugMarkers) }));
        _drawDebugMarkers();
    },
    hide() {
        if (!_debugContainer) {
            return;
        }
        for (const h of _debugHookIds) {
            Hooks.off(h.name, h.id);
        }
        _debugHookIds = [];
        _debugContainer.destroy({ children: true });
        _debugContainer = null;
    },
    refresh: _drawDebugMarkers
};

export function initVisionFromEdge() {
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: 'Vision From Edge',
        hint: 'When enabled, all tokens have their vision computed from their perimeter (Lancer LOS-style) instead of from their center, allowing larger tokens to peek around corners. Per-token override available in the Token Config Vision tab.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _rebuildAll()
    });

    game.settings.register(MODULE_ID, 'visionFromEdgeDebug', {
        name: 'Vision From Edge: Debug Overlay',
        hint: 'Draw the perimeter sample points on the canvas (calls lancerVisionDebug.show / hide).',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: (val) => {
            const dbg = /** @type {any} */ (globalThis).lancerVisionDebug;
            if (val)
                dbg?.show?.();
            else
                dbg?.hide?.();
        }
    });

    game.settings.register(MODULE_ID, SETTING_SAMPLE_MODE, {
        name: 'Vision From Edge: Sample Density',
        hint: 'Number of vision sample points per flagged token. Adaptive uses 8 for tokens 3x3 or larger, 4 otherwise.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            corners4: '4 (corners only)',
            perimeter8: '8 (corners + edge midpoints)',
            adaptive: 'Adaptive (recommended)'
        },
        default: 'adaptive',
        onChange: () => _rebuildAll()
    });

    Hooks.on('canvasReady', _onCanvasReady);
    Hooks.on('createToken', _onCreateToken);
    Hooks.on('updateToken', _onUpdateToken);
    Hooks.on('deleteToken', _onDeleteToken);
    Hooks.on('controlToken', _onControlToken);
    Hooks.on('renderTokenConfig', _onRenderTokenConfig);
    Hooks.on('closeTokenConfig', _cleanOrphanEdgeSources);

    // Wraps the per-token vision init so edges resync during animation,
    // control changes, and document updates.
    Hooks.once('ready', () => {
        if (typeof libWrapper === 'undefined') {
            return;
        }
        libWrapper.register(MODULE_ID, 'Token.prototype.initializeVisionSource', function (wrapped, ...args) {
            const result = wrapped(...args);
            try {
                const opts = args[0] ?? {};
                if (opts.deleted) {
                    _destroyEdgeSources(this);
                } else {
                    _buildEdgeSources(this);
                }
            } catch (e) {
                // ignore
            }
            return result;
        }, 'WRAPPER');

        const VisionSourceClass = _getVisionSourceClass();
        if (VisionSourceClass?.prototype?._createShapes) {
            libWrapper.register(MODULE_ID, 'foundry.canvas.sources.PointVisionSource.prototype._createShapes', function (wrapped, ...args) {
                wrapped(...args);
                const clip = this._laEdgeClipCircle;
                if (!clip || !this.los?.applyConstraint) {
                    return;
                }
                try {
                    const clipped = this.los.applyConstraint(clip);
                    this.shape = clipped;
                    this.los = clipped;
                } catch (e) {
                    // ignore
                }
            }, 'WRAPPER');
        }
    });
}
