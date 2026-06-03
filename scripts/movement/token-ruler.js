/* global CONFIG, canvas, foundry, game, Hooks, PIXI */

import { getSpeedRanges } from '../combat/speed-provider.js';
import { elevationForPreview } from './elevation.js';
import { isForceFreeMovement, isForceDebugMovement } from './keybindings.js';
import { getHexGroundElevation } from '../combat/terrain-utils.js';
import { ISO_SETTINGS, isIsoFeatureEnabled, getIsoProvider } from '../setup/iso-settings.js';

const MODULE_ID = 'lancer-automations';
const ENABLED = 'enableBuiltinSpeedProvider';
const PER_STEP_RENDER = 'rulerPerStepRender';
const LABEL_TEMPLATE = `modules/${MODULE_ID}/templates/lancer-waypoint-label.hbs`;

function settingOn() {
    try {
        return !!game.settings.get(MODULE_ID, ENABLED);
    } catch {
        return false;
    }
}

function _isoActive() {
    return !!getIsoProvider();
}
function _applyIsoCounter(displayObject) {
    const provider = getIsoProvider();
    if (!provider)
        return;
    displayObject.rotation = provider.reverseRotation;
    displayObject.skew.set(provider.reverseSkewX, provider.reverseSkewY);
    displayObject.scale.set(provider.counterScale, 1 / provider.counterScale);
}

function _isoProjectLabelPos(pos) {
    if (!isIsoFeatureEnabled(ISO_SETTINGS.waypointLabel))
        return pos;
    if (!_isoActive())
        return pos;
    const proj = canvas.stage.toGlobal({ x: pos.x, y: pos.y });
    const hud = document.getElementById('hud');
    if (!hud)
        return pos;
    const rect = hud.getBoundingClientRect();
    const zoom = canvas.stage.scale.x || 1;
    return { x: (proj.x - rect.left) / zoom, y: (proj.y - rect.top) / zoom };
}

function perStepRenderOn() {
    try {
        return !!game.settings.get(MODULE_ID, PER_STEP_RENDER);
    } catch {
        return false;
    }
}

function round(v) {
    return Math.round((Number(v) || 0) * 100) / 100;
}

function freeMoveColor() {
    try {
        const hex = game.settings.get(MODULE_ID, 'speedProvider.colorFreeMovement') || '#ffffff';
        return parseInt(hex.replace('#', ''), 16);
    } catch {
        return 0xffffff;
    }
}

function forceMoveColor() {
    try {
        const hex = game.settings.get(MODULE_ID, 'speedProvider.colorForceMovement') || '#8B5CF6';
        return parseInt(hex.replace('#', ''), 16);
    } catch {
        return 0x8B5CF6;
    }
}

class LancerTokenRuler extends foundry.canvas.placeables.tokens.TokenRuler {
    static get WAYPOINT_LABEL_TEMPLATE() {
        if (!settingOn())
            return foundry.canvas.placeables.tokens.TokenRuler.WAYPOINT_LABEL_TEMPLATE;
        return LABEL_TEMPLATE;
    }

    async draw() {
        const result = await super.draw();
        if (!settingOn())
            return result;
        this._ensureLineLayer();
        this._ensureTextLayer();
        return result;
    }

    clear() {
        if (settingOn()) {
            this._clearLayer(this._climbLineLayer);
            this._clearLayer(this._climbTextLayer);
        }
        return super.clear();
    }

    _onVisibleChange() {
        const result = super._onVisibleChange();
        if (!settingOn())
            return result;
        if (this._climbLineLayer && !this._climbLineLayer.destroyed)
            this._climbLineLayer.visible = this.visible;
        if (this._climbTextLayer && !this._climbTextLayer.destroyed)
            this._climbTextLayer.visible = this.visible;
        return result;
    }

    destroy() {
        this._destroyLayer('_climbLineLayer');
        this._destroyLayer('_climbTextLayer');
        return super.destroy();
    }

    refresh(options) {
        if (!settingOn())
            return super.refresh(options);
        this._clearLayer(this._climbLineLayer);
        this._clearLayer(this._climbTextLayer);
        this._pendingClimbCells = [];
        this._pendingTerrainCells = [];
        this._pendingSegmentLines = [];
        // super.refresh() repopulates this via _getGridHighlightStyle.
        const _g = /** @type {any} */ (globalThis);
        _g._laHexPaintCellsOrdered = [];
        const result = super.refresh(options);
        try {
            this._flushClimbArrows();
        } catch (e) {
            console.warn('lancer-automations | climb arrow render failed', e);
        }
        return result;
    }

    _clearLayer(layer) {
        if (layer && !layer.destroyed)
            layer.removeChildren().forEach(c => c.destroy({ children: true }));
    }

    _destroyLayer(key) {
        const layer = this[key];
        if (layer && !layer.destroyed) {
            layer.parent?.removeChild(layer);
            layer.destroy({ children: true });
        }
        this[key] = null;
    }

    _ensureLineLayer() {
        if (this._climbLineLayer && !this._climbLineLayer.destroyed)
            return this._climbLineLayer;
        const parent = this.token?.layer?._rulerPaths;
        if (!parent)
            return null;
        this._climbLineLayer = new PIXI.Container();
        this._climbLineLayer.eventMode = 'none';
        this._climbLineLayer.visible = !!this.visible;
        parent.addChild(this._climbLineLayer);
        return this._climbLineLayer;
    }

    _ensureTextLayer() {
        if (this._climbTextLayer && !this._climbTextLayer.destroyed)
            return this._climbTextLayer;
        const parent = canvas.controls;
        if (!parent)
            return null;
        this._climbTextLayer = new PIXI.Container();
        this._climbTextLayer.eventMode = 'none';
        this._climbTextLayer.visible = !!this.visible;
        parent.addChild(this._climbTextLayer);
        return this._climbTextLayer;
    }

    _flushClimbArrows() {
        const cells = this._pendingClimbCells;
        const tCells = this._pendingTerrainCells;
        const segLines = this._pendingSegmentLines;
        this._pendingClimbCells = null;
        this._pendingTerrainCells = null;
        this._pendingSegmentLines = null;

        const lineLayer = this._ensureLineLayer();
        const textLayer = this._ensureTextLayer();
        if (!lineLayer || !textLayer)
            return;

        const outline = this._configureOutline?.() ?? { thickness: 1, color: 0x000000 };
        const outlineThickness = outline.thickness ?? 1;
        const outlineColor = outline.color ?? 0x000000;

        const lerpColor = (a, b, t) => {
            const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
            const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
            return ((Math.round(ar + (br - ar) * t) << 16) | (Math.round(ag + (bg - ag) * t) << 8) | Math.round(ab + (bb - ab) * t));
        };

        const validSegs = (segLines ?? []).filter(s => Array.isArray(s.centroids) && s.centroids.length >= 2);
        if (validSegs.length > 0) {
            const firstSeg = validSegs[0];
            const widthRef = firstSeg.style?.width ?? 4;
            const fallback = PIXI.Color.shared.setValue(firstSeg.style?.color ?? 0xffffff).toNumber();

            // One point per waypoint, using Foundry's black-dot center calc + tier color.
            // Hex paint iterates reverse so we reverse first.
            const _g = /** @type {any} */ (globalThis);
            const hexOrdered = (_g._laHexPaintCellsOrdered ?? []).slice().reverse();
            const isForce = validSegs.some(s => s.isForce);
            const isFree = validSegs.some(s => s.isFree);
            const renderPts = [];
            const seenKey = new Set();
            for (const e of hexOrdered) {
                const key = e.waypointKey ?? `fallback:${e.cellKey}`;
                if (seenKey.has(key))
                    continue;
                seenKey.add(key);
                let px, py;
                if (e.waypointCenter) {
                    px = e.waypointCenter.x;
                    py = e.waypointCenter.y;
                } else {
                    const c = canvas.grid.getCenterPoint(e.offset);
                    px = c.x; py = c.y;
                }
                const raw = isForce
                    ? forceMoveColor()
                    : (isFree
                        ? freeMoveColor()
                        : (e.tierColor ?? fallback));
                renderPts.push({ x: px, y: py, color: PIXI.Color.shared.setValue(raw).toNumber() });
            }

            if (renderPts.length >= 2 && widthRef > 0) {
                const alpha = 1;
                if (outlineThickness > 0) {
                    const outlineG = new PIXI.Graphics();
                    outlineG.lineStyle({
                        width: widthRef + outlineThickness * 2,
                        color: outlineColor,
                        alpha,
                        join: PIXI.LINE_JOIN.ROUND,
                        cap: PIXI.LINE_CAP.ROUND
                    });
                    outlineG.moveTo(renderPts[0].x, renderPts[0].y);
                    for (let i = 1; i < renderPts.length; i++)
                        outlineG.lineTo(renderPts[i].x, renderPts[i].y);
                    lineLayer.addChild(outlineG);
                }

                const innerG = new PIXI.Graphics();
                const lineOpts = { width: widthRef, alpha, join: PIXI.LINE_JOIN.ROUND, cap: PIXI.LINE_CAP.ROUND };
                innerG.moveTo(renderPts[0].x, renderPts[0].y);
                for (let i = 1; i < renderPts.length; i++) {
                    const a = renderPts[i - 1], b = renderPts[i];
                    if (a.color === b.color) {
                        innerG.lineStyle({ ...lineOpts, color: a.color });
                        innerG.lineTo(b.x, b.y);
                    } else {
                        const N = 8;
                        for (let k = 1; k <= N; k++) {
                            const t = k / N;
                            const x = a.x + (b.x - a.x) * t;
                            const y = a.y + (b.y - a.y) * t;
                            innerG.lineStyle({ ...lineOpts, color: lerpColor(a.color, b.color, (k - 0.5) / N) });
                            innerG.lineTo(x, y);
                        }
                    }
                }
                lineLayer.addChild(innerG);
            }
        }

        if (Array.isArray(cells) && cells.length) {
            const fontSize = Math.max(10, Math.round(canvas.grid.size * 0.15));
            const textStyle = foundry.canvas.containers.PreciseText.getTextStyle({
                fontFamily: 'Signika',
                fontSize,
                fontWeight: '700',
                fill: '#ffffff',
                stroke: '#000000',
                strokeThickness: Math.max(3, Math.round(fontSize * 0.2)),
                align: 'center'
            });
            for (const c of cells) {
                const label = `${c.delta > 0 ? '↑' : '↓'}${Math.abs(c.delta)}`;
                const text = new foundry.canvas.containers.PreciseText(label, textStyle);
                text.anchor.set(0.5, 0.5);
                text.position.set(c.x, c.y);
                _applyIsoCounter(text);
                textLayer.addChild(text);
            }
        }

        if (Array.isArray(tCells) && tCells.length) {
            const fontSize = Math.max(10, Math.round(canvas.grid.size * 0.15));
            const warnStyle = foundry.canvas.containers.PreciseText.getTextStyle({
                fontFamily: 'Signika',
                fontSize,
                fontWeight: '700',
                fill: '#ff6d33ff',
                stroke: '#000000',
                strokeThickness: Math.max(3, Math.round(fontSize * 0.2)),
                align: 'center'
            });
            for (const c of tCells) {
                const text = new foundry.canvas.containers.PreciseText('⚠', warnStyle);
                text.anchor.set(0.5, 0.5);
                text.position.set(c.x, c.y);
                _applyIsoCounter(text);
                textLayer.addChild(text);
            }
        }
    }

    /**
     * Look up the LA move-data entry for a PASSED waypoint by its movementId.
     * Returns null for live drag waypoints (no movementId stamped yet) or when no LA entry exists
     * (move was made before LA flagged moves, or move was debug-mode which skips LA recording).
     */
    _passedMoveData(waypoint) {
        if (waypoint?.stage !== 'passed' || !waypoint.movementId)
            return null;
        const laApi = game.modules.get('lancer-automations')?.api;
        const moves = laApi?.getMoveDataList?.(this.token.document.id) ?? [];
        return moves.find(m => m.movementId === waypoint.movementId) || null;
    }

    /**
     * For a PASSED waypoint, sum the cost contributions of intentional-regular moves up to and
     * including this waypoint's move. Free moves contribute 0 to the cumulative tier total -
     * same exclusion the cap uses. Walk _source._movementHistory in order; a waypoint counts only
     * if its movementId belongs to a logged regular move.
     */
    _cumulativeRegularCostThrough(waypoint) {
        const sourceHistory = this.token.document._source?._movementHistory ?? [];
        if (!sourceHistory.length)
            return 0;
        const laApi = game.modules.get('lancer-automations')?.api;
        const moves = laApi?.getMoveDataList?.(this.token.document.id) ?? [];
        const regularMovementIds = new Set(
            moves.filter(m => m.isDrag && !m.isFreeMovement && m.movementId).map(m => m.movementId)
        );
        let total = 0;
        for (const w of sourceHistory) {
            if (regularMovementIds.has(w.movementId)) {
                const c = w.cost;
                if (c !== null && c !== undefined && c !== Infinity)
                    total += c;
            }
            if (w.movementId === waypoint.movementId
                && w.x === waypoint.x && w.y === waypoint.y
                && w.elevation === waypoint.elevation)
                break;
        }
        return total;
    }

    _tierForWaypoint(waypoint) {
        if (!settingOn())
            return undefined;
        const ranges = getSpeedRanges(this.token);
        if (!ranges.length)
            return undefined;
        let total;
        if (waypoint.stage === 'passed') {
            total = this._cumulativeRegularCostThrough(waypoint);
        } else {
            // measurement.cost includes history; we want regular history + this drag only.
            const laApi = game.modules.get('lancer-automations')?.api;
            const prior = Number(laApi?.getMovementHistory?.(this.token.document.id)?.intentional?.regular ?? 0);
            let lastPassed = waypoint.previous;
            while (lastPassed && lastPassed.stage !== 'passed')
                lastPassed = lastPassed.previous;
            const passedCost = Number(lastPassed?.measurement?.cost ?? 0);
            const dragDelta = Math.max(0, Number(waypoint.measurement?.cost ?? 0) - passedCost);
            total = prior + dragDelta;
        }
        for (const r of ranges)
            if (total <= r.max)
                return r;
        return null; // over max
    }

    _computeSegmentStyle(waypoint) {
        const base = super._getSegmentStyle(waypoint);
        if (!settingOn())
            return base;
        if (!base.width)
            return base;
        if (waypoint.action === 'forced')
            return { ...base, color: forceMoveColor() };
        if (waypoint.stage !== 'passed') {
            if (isForceDebugMovement())
                return { ...base, alpha: 0 };
            if (isForceFreeMovement())
                return { ...base, color: freeMoveColor() };
        } else {
            const md = this._passedMoveData(waypoint);
            if (md && md.isForceMovement)
                return { ...base, color: forceMoveColor() };
            if (md && (md.isFreeMovement || !md.isDrag))
                return { ...base, color: freeMoveColor() };
            // No LA entry but a real movementId = debug-mode move; skip drawing it.
            if (waypoint.movementId && md === null
                && (game.modules.get('lancer-automations')?.api?.getMoveDataList?.(this.token.document.id)?.length ?? 0) > 0) {
                return { ...base, alpha: 0 };
            }
        }
        const tier = this._tierForWaypoint(waypoint);
        if (tier === undefined)
            return base;
        if (tier === null)
            return { ...base, color: 0x000000, alpha: 0.6 };
        return { ...base, color: tier.color };
    }

    _getSegmentStyle(waypoint) {
        // Debug moves draw no cost decorations.
        if (waypoint?.stage !== 'passed' && isForceDebugMovement())
            return this._computeSegmentStyle(waypoint);
        // auto-climb sub-segment: the group's polyline handles it, hide the native line.
        if (waypoint?.measurement?.lancerSkipNativeSegment === true)
            return { width: 0 };
        const cells = waypoint?.measurement?.lancerClimbCells;
        if (waypoint?.stage !== 'passed' && Array.isArray(cells) && cells.length && Array.isArray(this._pendingClimbCells)) {
            this._pendingClimbCells.push(...cells);
        }
        const tCells = waypoint?.measurement?.lancerTerrainCells;
        if (waypoint?.stage !== 'passed' && Array.isArray(tCells) && tCells.length && Array.isArray(this._pendingTerrainCells)) {
            this._pendingTerrainCells.push(...tCells);
        }
        const style = this._computeSegmentStyle(waypoint);
        if (!perStepRenderOn())
            return style;
        if (style.alpha === 0)
            return style;
        const centroids = waypoint?.measurement?.lancerStepCentroids;
        if (Array.isArray(centroids) && centroids.length >= 2 && Array.isArray(this._pendingSegmentLines)) {
            const baseCum = this._segmentBaseCumulative(waypoint);
            const isFree = style.color === freeMoveColor();
            const isForce = waypoint.action === 'forced' || style.color === forceMoveColor();
            this._pendingSegmentLines.push({ centroids, style, baseCum, isFree, isForce });
            return { ...style, width: 0 };
        }
        // No polyline to draw (e.g. gridless), so keep the native line.
        return style;
    }

    _segmentBaseCumulative(waypoint) {
        if (waypoint?.stage === 'passed')
            return this._cumulativeRegularCostThrough(waypoint?.previous ?? waypoint);
        const laApi = game.modules.get('lancer-automations')?.api;
        const prior = Number(laApi?.getMovementHistory?.(this.token.document.id)?.intentional?.regular ?? 0);
        let lastPassed = waypoint.previous;
        while (lastPassed && lastPassed.stage !== 'passed')
            lastPassed = lastPassed.previous;
        const passedCost = Number(lastPassed?.measurement?.cost ?? 0);
        const segStart = Number(waypoint.previous?.measurement?.cost ?? passedCost);
        return prior + Math.max(0, segStart - passedCost);
    }

    _tierColorAtDistance(totalDist) {
        if (!settingOn())
            return null;
        const ranges = getSpeedRanges(this.token);
        if (!ranges.length)
            return null;
        for (const r of ranges)
            if (totalDist <= r.max)
                return r.color;
        return 0x000000;
    }

    _getGridHighlightStyle(waypoint, offset) {
        // Silent region-boundary waypoint (animation slowdown only).
        if (waypoint._laSilent)
            return { alpha: 0 };
        const base = super._getGridHighlightStyle(waypoint, offset);
        // Tag each painted cell with its waypoint key + Foundry's shape center; _flushClimbArrows
        // uses these to draw the polyline through the same point as the black dot.
        if (base?.alpha > 0) {
            const _g = /** @type {any} */ (globalThis);
            _g._laHexPaintCellsOrdered = _g._laHexPaintCellsOrdered || [];
            let wc = waypoint.center;
            if (!wc) {
                try {
                    wc = this.token.document.getCenterPoint(waypoint);
                } catch {
                    wc = null;
                }
            }
            const waypointKey = `${Math.round(waypoint.x ?? 0)}|${Math.round(waypoint.y ?? 0)}|${Math.round((waypoint.elevation ?? 0) * 1000)}`;
            // Capture the tier color now so the polyline matches the hex paint (same cumulative cost).
            const isForcedHere = waypoint.action === 'forced' || waypoint.next?.action === 'forced';
            let tierColor = null;
            if (settingOn() && !isForcedHere
                && !(waypoint.stage !== 'passed' && isForceDebugMovement())
                && !(waypoint.stage !== 'passed' && isForceFreeMovement())) {
                const tier = this._tierForWaypoint(waypoint);
                if (tier === null)
                    tierColor = 0x000000;
                else if (tier !== undefined)
                    tierColor = tier.color;
            }
            _g._laHexPaintCellsOrdered.push({
                cellKey: `(${offset.i},${offset.j})`,
                offset: { i: offset.i, j: offset.j },
                waypointKey,
                waypointCenter: wc ? { x: wc.x, y: wc.y } : null,
                tierColor
            });
        }
        if (!settingOn())
            return base;
        if (!(base.alpha > 0))
            return base;
        if (waypoint.action === 'forced' || waypoint.next?.action === 'forced')
            return { ...base, color: forceMoveColor(), alpha: 0.35 };
        if (waypoint.stage !== 'passed') {
            if (isForceDebugMovement())
                return { ...base, alpha: 0 };
            if (isForceFreeMovement())
                return { ...base, color: freeMoveColor(), alpha: 0.35 };
        } else {
            const md = this._passedMoveData(waypoint);
            if (md && md.isForceMovement)
                return { ...base, color: forceMoveColor(), alpha: 0.35 };
            if (md && (md.isFreeMovement || !md.isDrag))
                return { ...base, color: freeMoveColor(), alpha: 0.35 };
            if (waypoint.movementId && md === null
                && (game.modules.get('lancer-automations')?.api?.getMoveDataList?.(this.token.document.id)?.length ?? 0) > 0) {
                return { ...base, alpha: 0 };
            }
        }
        const tier = this._tierForWaypoint(waypoint);
        if (tier === undefined)
            return base;
        if (tier === null)
            return { ...base, color: 0x000000, alpha: 0.35 };
        return { ...base, color: tier.color, alpha: 0.35 };
    }

    _getWaypointLabelContext(waypoint, _state) {
        if (!settingOn())
            return super._getWaypointLabelContext(waypoint, _state);
        if (!waypoint.previous)
            return null; // no label on origin
        if (!waypoint.explicit)
            return null; // hide on intermediate path nodes

        const m = waypoint.measurement;
        if (!m)
            return null;

        const ray = waypoint.ray;
        if (!ray)
            return null;

        const totalCost = round(m.cost);
        const deltaCost = round(m.backward?.cost ?? 0);

        // Use the landing elevation, not the raw waypoint elevation.
        const destElev = elevationForPreview(this.token.document, waypoint);
        const prevElev = waypoint.previous?.elevation ?? this.token.document.elevation ?? 0;
        const elevDelta = round(destElev - prevElev);
        const elevArrow = elevDelta > 0 ? 'fa-solid fa-arrow-up'
            : elevDelta < 0 ? 'fa-solid fa-arrow-down'
                : '';

        // Vertical cost goes through the elevation arrow, not this number.
        const debugMove = isForceDebugMovement();
        const penalty = debugMove ? 0 : round((m.lancerClimbMalus ?? 0) + (m.lancerTerrainPenalty ?? 0));
        const penaltyZone = !debugMove && !!m.lancerPenaltyZone;

        const showSecondLine = !!(elevArrow || penalty || penaltyZone);
        const units = canvas.scene?.grid?.units ?? '';
        const isLast = !waypoint.next;
        const uiScale = canvas.dimensions.uiScale;

        const labelAnchor = _isoActive() ? {
            x: ray.B.x,
            y: ray.B.y + (isLast ? 0.5 * this.token.h : 0) + (16 * uiScale)
        } : {
            x: ray.B.x + (isLast ? 0.5 * this.token.w + 16 * uiScale : 0),
            y: ray.B.y + (isLast ? 0 : 16 * uiScale)
        };
        const labelPos = _isoProjectLabelPos(labelAnchor);

        return {
            cssClass: isLast ? 'last' : '',
            position: labelPos,
            uiScale,
            action: waypoint.actionConfig,
            totalCost,
            deltaCost: deltaCost && deltaCost !== totalCost ? deltaCost : 0,
            elevArrow,
            elevAbs: Math.abs(elevDelta),
            penalty,
            penaltyZone,
            showSecondLine,
            units
        };
    }
}

function _thtGroundAt(point) {
    if (!globalThis.terrainHeightTools)
        return 0;
    const offset = canvas.grid.getOffset(point);
    return getHexGroundElevation(offset.j, offset.i) || 0;
}

class LancerCanvasRuler extends foundry.canvas.interaction.Ruler {
    _getWaypointLabelContext(waypoint, state) {
        const ctx = super._getWaypointLabelContext(waypoint, state);
        if (!settingOn())
            return ctx;
        if (ctx?.position)
            ctx.position = _isoProjectLabelPos(ctx.position);
        if (!ctx?.elevation || !waypoint.previous)
            return ctx;
        const here = _thtGroundAt(waypoint) + (waypoint.elevation || 0);
        const prev = _thtGroundAt(waypoint.previous) + (waypoint.previous.elevation || 0);
        const delta = here - prev;
        ctx.elevation.total = here;
        ctx.elevation.hidden = here === 0 && delta === 0;
        if (delta > 0) {
            ctx.elevation.icon = 'fa-solid fa-arrow-up';
            ctx.elevation.delta = `+${delta}`;
        } else if (delta < 0) {
            ctx.elevation.icon = 'fa-solid fa-arrow-down';
            ctx.elevation.delta = `${delta}`;
        } else {
            delete ctx.elevation.delta;
        }
        return ctx;
    }
}

Hooks.once('init', () => {
    CONFIG.Token.rulerClass = LancerTokenRuler;
    CONFIG.Canvas.rulerClass = LancerCanvasRuler;
    game.settings.register(MODULE_ID, PER_STEP_RENDER, {
        name: 'Per-step Ruler Path',
        hint: 'Polyline through each grid step instead of a straight line.',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false
    });
});

// HUD only realigns on canvas.pan(); without this kick, waypoint labels stay at the previous scene's offsets after a swap.
Hooks.on('canvasReady', () => {
    try {
        canvas.hud?.align();
    } catch {
        /* hud may not be rendered yet */
    }
});
