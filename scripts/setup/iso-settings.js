/* global game, canvas, Hooks, libWrapper, PIXI, CONFIG, requestAnimationFrame */

const MODULE_ID = 'lancer-automations';

export const ISO_PERSPECTIVE_ID = 'isometric-perspective';
export const GRAPE_ISO_ID = 'grape_juice-isometrics';

export const ISO_SETTINGS = {
    statBar: 'iso.statBar',
    tacticalDistance: 'iso.tacticalDistance',
    waypointLabel: 'iso.waypointLabel',
    elevationAnimation: 'iso.elevationAnimation',
    restoreAnchor: 'iso.restoreAnchor',
    scrollingText: 'iso.scrollingText',
    targetReticle: 'iso.targetReticle',
    clickZone: 'iso.clickZone',
    selectionMarquee: 'iso.selectionMarquee',
    moduleLabels: 'iso.moduleLabels',
    effectAspect: 'iso.effectAspect',
    debugSelectionOverlay: 'iso.debugSelectionOverlay',
};

const DEFS = [
    {
        key: ISO_SETTINGS.statBar,
        name: 'Stat Bar / Nameplate / Status Icons',
        hint: 'Keep them upright above the projected token.',
    },
    {
        key: ISO_SETTINGS.tacticalDistance,
        name: 'Tactical Distance Labels',
        hint: 'Keep drag-distance labels upright.',
    },
    {
        key: ISO_SETTINGS.waypointLabel,
        name: 'Ruler Waypoint Labels',
        hint: 'Place cost labels next to the projected token instead of its orthogonal cell.',
    },
    {
        key: ISO_SETTINGS.elevationAnimation,
        name: 'Follow Terrain Elevation During Animation',
        hint: 'Raise the mesh over THT ground during movement. Isometric Perspective only.',
    },
    {
        key: ISO_SETTINGS.restoreAnchor,
        name: 'Restore Token Anchor on Non-Iso Scenes',
        hint: 'Undo the anchor override Isometric Perspective applies even to non-iso scenes.',
    },
    {
        key: ISO_SETTINGS.scrollingText,
        name: 'Scrolling Text',
        hint: 'Show damage/status floating text over the projected token instead of the orthogonal cell.',
    },
    {
        key: ISO_SETTINGS.targetReticle,
        name: 'Target Reticle',
        hint: 'Move the target arrows/pips onto the projected token.',
    },
    {
        key: ISO_SETTINGS.clickZone,
        name: 'Token Click Zone',
        hint: 'Add a hover/click/select zone over the projected token, not just its orthogonal cell.',
    },
    {
        key: ISO_SETTINGS.selectionMarquee,
        name: 'Drag-Select Rectangle',
        hint: 'Draw and select with a proper screen rectangle instead of the skewed world box.',
    },
    {
        key: ISO_SETTINGS.moduleLabels,
        name: 'Template & Terrain Labels',
        hint: 'Keep TemplateMacro center labels and Terrain Height Tools labels upright.',
    },
    {
        key: ISO_SETTINGS.effectAspect,
        name: 'Sequencer Effect Shape',
        hint: 'Un-squash upright effects on iso scenes and keep beams flat on non-iso scenes.',
    },
    {
        key: ISO_SETTINGS.debugSelectionOverlay,
        name: 'DEBUG: Draw Iso Selection Overlays',
        hint: 'Draw the marquee polygon, per-token click zones, and center/mesh test points on the canvas.',
        defaultValue: false,
    },
];

export function registerIsoSettings()
{
    for (const def of DEFS)
    {
        game.settings.register(MODULE_ID, def.key, {
            name: def.name,
            hint: def.hint,
            scope: 'client',
            config: false,
            type: Boolean,
            default: def.defaultValue ?? true,
            onChange: def.key === ISO_SETTINGS.debugSelectionOverlay ? _refreshAllTokensIsoDebug : undefined,
        });
    }
}

Hooks.on('refreshToken', (token) => _refreshTokenIsoDebug(token));
Hooks.on('canvasReady', _refreshAllTokensIsoDebug);

function _isoPerspectiveActive()
{
    const mod = game.modules.get(ISO_PERSPECTIVE_ID);
    if (!mod?.active)
        return false;
    try
    {
        return !!game.settings.get(ISO_PERSPECTIVE_ID, 'worldIsometricFlag');
    }
    catch
    {
        return false;
    }
}

function _grapeActive()
{
    return !!game.modules.get(GRAPE_ISO_ID)?.active;
}

export function isAnyIsoModuleActive()
{
    return _isoPerspectiveActive() || _grapeActive();
}

// Active iso provider for the scene, or null.
// Iso counter-transform state for a token, or null if not applicable.
export function getIsoStateForToken(token)
{
    const provider = getIsoProvider(token?.scene);
    if (!provider || provider.isTokenDisabled(token))
        return null;
    return {
        reverseRotation: provider.reverseRotation,
        reverseSkewX: provider.reverseSkewX,
        reverseSkewY: provider.reverseSkewY,
        counterScale: provider.counterScale,
    };
}

export function getIsoProvider(scene)
{
    const activeScene = scene ?? canvas.scene;
    if (!activeScene)
        return null;

    if (_isoPerspectiveActive())
    {
        if (activeScene.getFlag(ISO_PERSPECTIVE_ID, 'isometricEnabled'))
            return ISO_PERSPECTIVE_PROVIDER;
    }
    if (_grapeActive())
    {
        if (activeScene.getFlag(GRAPE_ISO_ID, 'is_isometric'))
            return GRAPE_PROVIDER;
    }
    return null;
}

const COUNTER_SCALE = 0.76; // 1/sqrt(sqrt(3)), cancels True Iso aspect on both modules.

const ISO_PERSPECTIVE_PROVIDER = {
    id: ISO_PERSPECTIVE_ID,
    isTokenDisabled(token)
    {
        return !!token?.document?.getFlag(ISO_PERSPECTIVE_ID, 'isoTokenDisabled');
    },
    reverseRotation: Math.PI / 4,
    reverseSkewX: 0,
    reverseSkewY: 0,
    counterScale: COUNTER_SCALE,
    elevationDelta(elevation)
    {
        const scale = canvas.scene.grid.size / canvas.scene.grid.distance;
        const d = elevation * scale;
        return { x: d, y: -d };
    },
};

const GRAPE_PROVIDER = {
    id: GRAPE_ISO_ID,
    isTokenDisabled(token)
    {
        return !!token?.document?.getFlag(GRAPE_ISO_ID, 'disable_isometric_token');
    },
    reverseRotation: Math.PI / 4,
    reverseSkewX: 0,
    reverseSkewY: 0,
    counterScale: COUNTER_SCALE,
    // Grape moves elevation through mesh.anchor.y rather than mesh.position, so a position delta does nothing.
    elevationDelta()
    {
        return { x: 0, y: 0 };
    },
};

export function isIsoFeatureEnabled(featureKey)
{
    if (!isAnyIsoModuleActive())
        return false;
    try
    {
        return !!game.settings.get(MODULE_ID, featureKey);
    }
    catch
    {
        return false;
    }
}

// Some features only make sense for iso-perspective (elevationAnimation, restoreAnchor).
export function isIsoPerspectiveFeatureEnabled(featureKey)
{
    if (!_isoPerspectiveActive())
        return false;
    try
    {
        return !!game.settings.get(MODULE_ID, featureKey);
    }
    catch
    {
        return false;
    }
}

// Skew/scale that cancels the iso stage so a label reads flat (set via obj.skew/scale, rotation 0).
// Decomposed by hand because setFromMatrix collapses skewX+skewY≈0 to a rotation and loses the shear.
export function isoLabelTransform(scene, settingKey = null)
{
    if (settingKey)
    {
        try
        {
            if (!game.settings.get(MODULE_ID, settingKey))
                return null;
        }
        catch
        {
            return null;
        }
    }
    if (!getIsoProvider(scene))
        return null;
    const stage = canvas.app?.stage;
    if (!stage)
        return null;
    const t = new PIXI.Transform();
    t.rotation = stage.rotation;
    t.skew.set(stage.skew.x, stage.skew.y);
    t.updateLocalTransform();
    const m = t.localTransform.clone().invert();
    return {
        skewX: -Math.atan2(-m.c, m.d),
        skewY: Math.atan2(m.b, m.a),
        scaleX: Math.hypot(m.a, m.b),
        scaleY: Math.hypot(m.c, m.d),
    };
}

// Stage skew sticks around between scenes, so clear any leftover when the new scene isn't iso.
Hooks.on('canvasReady', () =>
{
    if (!isAnyIsoModuleActive())
        return;
    if (getIsoProvider(canvas.scene))
        return; // iso scene: leave the transform to the iso module
    const stage = canvas.app?.stage;
    if (!stage)
        return;
    if (stage.rotation !== 0)
        stage.rotation = 0;
    if (stage.skew?.x !== 0 || stage.skew?.y !== 0)
        stage.skew.set(0, 0);
});

// Turning iso off leaves stale iso transforms on tokens, tiles and the background. Redraw the scene.
Hooks.on('updateScene', (scene, changes) =>
{
    if (!isAnyIsoModuleActive() || scene.id !== canvas.scene?.id)
        return;
    const flags = changes.flags ?? {};
    if (!(ISO_PERSPECTIVE_ID in flags) && !(GRAPE_ISO_ID in flags))
        return;
    if (getIsoProvider(scene))
        return; // turned on instead, iso handles it
    requestAnimationFrame(() => canvas.draw());
});

// Scrolling combat text (damage / status) over the sprite.

// #scrollingText is private, so find it by its config zIndex.
function _scrollTextContainer()
{
    const z = CONFIG?.Canvas?.groups?.interface?.zIndexScrollingText ?? 1100;
    return (canvas.interface?.children ?? []).find(c => c instanceof PIXI.Container && c.zIndex === z) ?? null;
}

// Only set while it holds the iso recipe. The text wrapper maps origins through it.
let _scrollContainer = null;

function _tokenAtPoint(point)
{
    const toks = canvas.tokens?.placeables ?? [];
    for (const token of toks)
    {
        const center = token.center;
        if (center && Math.abs(center.x - point.x) < 1 && Math.abs(center.y - point.y) < 1)
            return token;
    }
    return toks.find(token => token.bounds?.contains?.(point.x, point.y)) ?? null;
}

// Give the container the stat-bar recipe so the text reads the same way as the bars.
Hooks.on('canvasReady', () =>
{
    const container = _scrollTextContainer();
    if (!container)
    {
        _scrollContainer = null; return;
    }
    const iso = isIsoFeatureEnabled(ISO_SETTINGS.scrollingText) ? getIsoProvider(canvas.scene) : null;
    if (iso)
    {
        container.position.set(0, 0);
        container.pivot.set(0, 0);
        container.rotation = iso.reverseRotation;
        container.skew.set(iso.reverseSkewX, iso.reverseSkewY);
        container.scale.set(iso.counterScale, 1 / iso.counterScale);
        _scrollContainer = container;
    }
    else
    {
        container.rotation = 0;
        container.skew.set(0, 0);
        container.scale.set(1, 1);
        _scrollContainer = null;
    }
    container.transform.updateLocalTransform();
});

function _marqueeActive()
{
    return isIsoFeatureEnabled(ISO_SETTINGS.selectionMarquee) && !!getIsoProvider(canvas.scene);
}

// The drawn screen rectangle as a world quad, so the marquee and selection match what's boxed.
function _isoSelectQuad()
{
    const interaction = canvas.mouseInteractionManager?.interactionData;
    if (!interaction?.origin || !interaction?.destination)
        return null;
    const worldTransform = canvas.stage.worldTransform;
    const screenOrigin = worldTransform.apply(new PIXI.Point(interaction.origin.x, interaction.origin.y));
    const screenDest = worldTransform.apply(new PIXI.Point(interaction.destination.x, interaction.destination.y));
    const screen = [
        new PIXI.Point(screenOrigin.x, screenOrigin.y), new PIXI.Point(screenDest.x, screenOrigin.y),
        new PIXI.Point(screenDest.x, screenDest.y), new PIXI.Point(screenOrigin.x, screenDest.y),
    ];
    return screen.map(screenPoint => worldTransform.applyInverse(screenPoint));
}

function _isoSelectPolygon(quad)
{
    return new PIXI.Polygon(quad.flatMap(vertex => [vertex.x, vertex.y]));
}

// In iso the sprite (and its click zone) sits away from the cell center, so box either point.
function _inSelectPoly(poly, placeable)
{
    const center = placeable.center;
    if (center && poly.contains(center.x, center.y))
        return true;
    const meshPos = placeable.mesh?.position;
    return !!(meshPos && poly.contains(meshPos.x, meshPos.y));
}

function _debugOverlayOn()
{
    try
    {
        return !!game.settings.get(MODULE_ID, ISO_SETTINGS.debugSelectionOverlay);
    }
    catch
    {
        return false;
    }
}

// Draws for each token: click-zone rect (red), native shape bounds (yellow),
// center dot (cyan), mesh.position dot (magenta) so the two test-points are visible.
function _refreshTokenIsoDebug(token)
{
    if (!token?.mesh)
        return;
    const on = _debugOverlayOn();
    const existing = token._laIsoDebugGfx;
    if (!on)
    {
        if (existing && !existing.destroyed)
            existing.destroy({ children: true });
        token._laIsoDebugGfx = null;
        return;
    }
    const gfx = existing && !existing.destroyed
        ? existing
        : new PIXI.Graphics();
    if (!existing || existing.destroyed)
    {
        token._laIsoDebugGfx = gfx;
        canvas.tokens?.addChild(gfx);
    }
    gfx.clear();
    const halfW = (token.w ?? 0) / 2;
    const halfH = (token.h ?? 0) / 2;
    const meshPos = token.mesh.position;
    gfx.lineStyle(2, 0xFF3B3B, 0.9)
        .drawRect(meshPos.x - halfW, meshPos.y - halfH, halfW * 2, halfH * 2);
    if (token.shape)
    {
        try
        {
            const bounds = token.shape.getBounds?.() ?? token.bounds ?? null;
            if (bounds)
            {
                gfx.lineStyle(1, 0xFFEB3B, 0.5)
                    .drawRect(token.position.x + bounds.x, token.position.y + bounds.y, bounds.width, bounds.height);
            }
        }
        catch
        {
            // ignore bounds errors
        }
    }
    const center = token.center;
    if (center)
        gfx.beginFill(0x00E5FF, 1).drawCircle(center.x, center.y, 4).endFill();
    gfx.beginFill(0xFF00FF, 1).drawCircle(meshPos.x, meshPos.y, 4).endFill();
}

function _refreshAllTokensIsoDebug()
{
    for (const token of canvas.tokens?.placeables ?? [])
        _refreshTokenIsoDebug(token);
}

Hooks.once('ready', () =>
{
    if (!game.modules.get('lib-wrapper')?.active)
        return;
    libWrapper.register(MODULE_ID, 'foundry.canvas.groups.InterfaceCanvasGroup.prototype.createScrollingText',
        function (wrapped, origin, content, options)
        {
            const container = _scrollContainer;
            if (!container || container.destroyed || !origin)
                return wrapped.call(this, origin, content, options);
            const tok = _tokenAtPoint(origin);
            const target = tok?.mesh ? tok.mesh.position : origin;
            // inverse-map through the recipe so it lands at `target` on screen, uprighted
            container.transform.updateLocalTransform();
            const local = container.localTransform.applyInverse(new PIXI.Point(target.x, target.y));
            return wrapped.call(this, local, content, options);
        }, 'WRAPPER');

    libWrapper.register(MODULE_ID, 'foundry.canvas.layers.ControlsLayer.prototype.drawSelect',
        function (wrapped, coords)
        {
            if (!_marqueeActive())
                return wrapped.call(this, coords);
            const quad = _isoSelectQuad();
            if (!quad)
                return wrapped.call(this, coords);
            this.select.clear()
                .lineStyle(3 * canvas.dimensions.uiScale, 0xFF9829, 0.9)
                .drawPolygon(quad.flatMap(p => [p.x, p.y]));
        }, 'MIXED');

    libWrapper.register(MODULE_ID, 'foundry.canvas.layers.PlaceablesLayer.prototype.selectObjects',
        function (wrapped, coords, opts = {})
        {
            if (!this.options.controllableObjects || !_marqueeActive())
                return wrapped.call(this, coords, opts);
            const quad = _isoSelectQuad();
            if (!quad)
                return wrapped.call(this, coords, opts);
            const poly = _isoSelectPolygon(quad);
            const releaseOthers = opts.releaseOthers ?? true;
            const oldSet = new Set(this.controlled);
            const newSet = new Set();
            for (const p of this.controllableObjects())
            {
                if (_inSelectPoly(poly, p))
                    newSet.add(p);
            }
            const toRelease = oldSet.difference(newSet);
            if (releaseOthers)
                toRelease.forEach(p => p.release());
            const toControl = newSet.difference(oldSet);
            toControl.forEach(p => p.control({ releaseOthers: false }));
            return (releaseOthers && toRelease.size > 0) || toControl.size > 0;
        }, 'MIXED');

    libWrapper.register(MODULE_ID, 'foundry.canvas.layers.TokenLayer.prototype.targetObjects',
        function (wrapped, coords, opts = {})
        {
            if (!_marqueeActive())
                return wrapped.call(this, coords, opts);
            const quad = _isoSelectQuad();
            if (!quad)
                return wrapped.call(this, coords, opts);
            const poly = _isoSelectPolygon(quad);
            const targets = [];
            for (const token of this.placeables)
            {
                if (!token.visible || !token.renderable || token.document.isSecret)
                    continue;
                if (_inSelectPoly(poly, token))
                    targets.push(token.id);
            }
            return this.setTargets(targets, { mode: (opts.releaseOthers ?? true) ? 'replace' : 'acquire' });
        }, 'MIXED');
});

// Sequencer's iso plugin skews stretchTo/overlay effects without checking the scene flag.
// CanvasEffect isn't exported, so patch its prototype off the first effect we see.
let _flatScenePatched = false;
function _effectOnFlatScene(effect)
{
    if (!isIsoFeatureEnabled(ISO_SETTINGS.effectAspect))
        return false;
    const scene = game.scenes.get(effect?.data?.sceneId) ?? canvas.scene;
    return !getIsoProvider(scene);
}
function _flattenIsoContainer(effect)
{
    const container = effect?.isometricContainer;
    if (!container || container.destroyed || !_effectOnFlatScene(effect))
        return;
    container.skew.set(0, 0);
    container.scale.set(1, 1);
    container.rotation = 0;
}
function _patchSequencerFlatScenes(effect)
{
    if (_flatScenePatched)
        return;
    let proto = Object.getPrototypeOf(effect);
    while (proto && !Object.hasOwn(proto, '_transformSprite'))
        proto = Object.getPrototypeOf(proto);
    if (!proto)
        return;
    _flatScenePatched = true;
    for (const name of ['_transformSprite', '_rotateTowards', '_transformAttachedNoStretchSprite'])
    {
        const original = proto[name];
        if (typeof original !== 'function')
            continue;
        proto[name] = function (...args)
        {
            const result = original.apply(this, args);
            if (result instanceof Promise)
            {
                return result.then((value) =>
                {
                    _flattenIsoContainer(this);
                    return value;
                });
            }
            _flattenIsoContainer(this);
            return result;
        };
    }
}
Hooks.on('createSequencerEffect', _patchSequencerFlatScenes);

// Sequencer's iso plugin stands effects up (45deg on isometricContainer) but skips the aspect
// counter-scale, so billboarded FX render squashed. Overlay and beam effects use other paths.
Hooks.on('createSequencerEffect', (effect) =>
{
    if (!isIsoFeatureEnabled(ISO_SETTINGS.effectAspect))
        return;
    const iso = getIsoProvider(canvas.scene);
    if (!iso)
        return;
    if (effect?.data?.isometric?.overlay || effect?.data?.rotateTowards || effect?.data?.stretchTo)
        return;
    let tries = 0;
    const apply = () =>
    {
        const container = effect?.isometricContainer;
        if (!container || container.destroyed)
        {
            if (tries++ < 120)
                requestAnimationFrame(apply);
            return;
        }
        container.scale.set(iso.counterScale, 1 / iso.counterScale);
    };
    apply();
});
