/* global Hooks, CONFIG, DetectionMode, OutlineOverlayFilter, Token, game, canvas, ui */

import { getTokenDistance } from "../combat/overwatch.js";
import { getTokenVisionLOS, isAnyTokenMoving } from "./visionFromEdge.js";
import {
    SETTING_LOS_HEIGHT_RULE, lancerHasLineOfSight, setLastOverlaySignature, _lastOverlaySignature, _losPairsClear, _losInvalidateAll,
    _collectSightEdges, _segmentBlocked, _tokenLosPoints, _tokenSamplePoints, _blindedBlocksSight,
} from "./losEngine.js";
export {
    invalidateLosCaches, lancerHasLineOfSight, hasLineOfSight, makeSkimRayCaster, makeCellRayCaster,
    lancerSightEdgeRecords, getEyeWallSegments, isPointInEyeSolid, makeEyeSolidTester, computeSightlineRays,
} from "./losEngine.js";

import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { localize } from '../tools/string-utils.js';
const SETTING_AUTO_ADD = 'lancerVisionAutoAdd';
const SETTING_LOS = 'lancerLos';
const SETTING_LOS_DEBUG = 'lancerLosDebug';
const SETTING_SILH_LEGACY_OVERLAY = 'lancerSilhLegacyOverlay';
const SETTING_DIM_DEFER_MOVING = 'occlusionDimDeferMoving';
const SETTING_SENSOR_COMBAT_ONLY = 'lancerSensorCombatOnly';
const SETTING_AWARENESS_COMBAT_ONLY = 'lancerAwarenessCombatOnly';
const SETTING_SENSOR_USE_MODE_RANGE = 'lancerSensorUseModeRange';
const SETTING_AWARENESS_USE_MODE_RANGE = 'lancerAwarenessUseModeRange';
const SETTING_AWARENESS_STYLE = 'lancerAwarenessStyle';
const SETTING_BASIC_SIGHT_999 = 'basicSightTo999';
const SETTING_DRAG_VISION_MODE = 'dragVisionMode';

function _isCombatActive()
{
    return !!game.combat?.started;
}

function _fovContains(visionSource, target)
{
    const fov = /** @type {any} */ (visionSource)?.fov;
    if (!fov?.contains)
        return false;
    const targetCenter = target?.center ?? { x: target?.x, y: target?.y };
    if (typeof targetCenter?.x !== 'number' || typeof targetCenter?.y !== 'number')
        return false;
    return fov.contains(targetCenter.x, targetCenter.y);
}

function _losVetoed(visionSource, target)
{
    if (!getModuleSetting(SETTING_LOS))
        return false;
    if (!(target instanceof foundry.canvas.placeables.Token))
        return false;
    const viewerToken = visionSource?.object;
    if (!viewerToken?.document)
        return false;
    return !lancerHasLineOfSight(viewerToken, target);
}

function _basicVisionSees(visionSource, target)
{
    return _fovContains(visionSource, target) && !_losVetoed(visionSource, target);
}

// Debug overlay: rays from controlled tokens; green = clear, red = blocked.
let _losDebugLayer = null;

// While a token is dragged the visible token is a preview clone; use it so debug lines track the drag.
function _laDragPreview(token)
{
    const id = token?.document?.id;
    if (!id)
        return token;
    for (const preview of canvas?.tokens?.preview?.children ?? [])
    {
        if (preview?.document?.id === id)
            return preview;
    }
    return token;
}

function _drawLosDebug()
{
    if (!_losDebugLayer || _losDebugLayer.destroyed)
        return;
    for (const child of _losDebugLayer.removeChildren())
        child.destroy();
    if (!getModuleSetting(SETTING_LOS_DEBUG))
        return;
    const edges = _collectSightEdges();
    const gfx = new PIXI.Graphics();
    _losDebugLayer.addChild(gfx);
    // Every sight edge the LOS test sees: cyan = height-limited (top shown), magenta = full-height wall.
    for (const record of edges)
    {
        const finite = Number.isFinite(record.top);
        const color = finite ? 0x33bbff : 0xff33ff;
        gfx.lineStyle(3, color, 0.85);
        gfx.moveTo(record.edge.a.x, record.edge.a.y);
        gfx.lineTo(record.edge.b.x, record.edge.b.y);
        const heightText = new PIXI.Text(finite ? record.top.toFixed(1) : 'inf', {
            fontFamily: 'monospace', fontSize: 11, fill: color, stroke: 0x000000, strokeThickness: 3,
        });
        heightText.anchor.set(0.5, 0.5);
        heightText.position.set((record.edge.a.x + record.edge.b.x) / 2, (record.edge.a.y + record.edge.b.y) / 2);
        _losDebugLayer.addChild(heightText);
    }
    const viewers = canvas?.tokens?.controlled ?? [];
    const targets = canvas?.tokens?.placeables ?? [];
    if (!viewers.length)
        return;
    for (const viewer of viewers)
    {
        if (!viewer.document)
            continue;
        const effectiveViewer = _laDragPreview(viewer);
        const eyeViewer = getTokenVisionLOS(effectiveViewer);
        const skipViewer = `la-block-los-${viewer.document.id}-`;
        for (const target of targets)
        {
            if (target === viewer || !target.document)
                continue;
            const effectiveTarget = _laDragPreview(target);
            const eyeTarget = getTokenVisionLOS(effectiveTarget);
            const viewerCenter = effectiveViewer.center;
            const targetCenter = effectiveTarget.center;
            const viewerPoints = _tokenLosPoints(effectiveViewer, viewerCenter, targetCenter);
            const targetPoints = _tokenLosPoints(effectiveTarget, viewerCenter, targetCenter);
            const ctx = {
                skipPrefixA: skipViewer,
                skipPrefixB: `la-block-los-${target.document.id}-`,
                centerA: viewerCenter,
                centerB: targetCenter,
                radiusA: Math.max(effectiveViewer.w ?? 0, effectiveViewer.h ?? 0) / 2,
                radiusB: Math.max(effectiveTarget.w ?? 0, effectiveTarget.h ?? 0) / 2,
                nearestBlock: true,
            };
            let anyClear = false;
            for (let index = 0; index < viewerPoints.length; index++)
            {
                const clear = !_segmentBlocked(viewerPoints[index], eyeViewer, targetPoints[index], eyeTarget, edges, ctx);
                if (clear)
                    anyClear = true;
                gfx.lineStyle(2, clear ? 0x22ff44 : 0xff2222, clear ? 0.7 : 0.4);
                gfx.moveTo(viewerPoints[index].x, viewerPoints[index].y);
                gfx.lineTo(targetPoints[index].x, targetPoints[index].y);
                const reasonText = new PIXI.Text(ctx.lastReason ?? '', {
                    fontFamily: 'monospace', fontSize: 10, fill: clear ? 0x22ff44 : 0xff2222, stroke: 0x000000, strokeThickness: 3,
                });
                reasonText.anchor.set(0.5, 0.5);
                const labelPoint = (!clear && ctx.blockPoint) ? ctx.blockPoint : { x: (viewerPoints[index].x + targetPoints[index].x) / 2, y: (viewerPoints[index].y + targetPoints[index].y) / 2 };
                reasonText.position.set(labelPoint.x, labelPoint.y);
                _losDebugLayer.addChild(reasonText);
                if (!clear && ctx.blockPointFar)
                {
                    const exitText = new PIXI.Text('exit', {
                        fontFamily: 'monospace', fontSize: 10, fill: 0xff2222, stroke: 0x000000, strokeThickness: 3,
                    });
                    exitText.anchor.set(0.5, 0.5);
                    exitText.alpha = 0.6;
                    exitText.position.set(ctx.blockPointFar.x, ctx.blockPointFar.y);
                    _losDebugLayer.addChild(exitText);
                }
            }
            if (!anyClear)
            {
                const denseV = _tokenSamplePoints(effectiveViewer);
                const denseT = _tokenSamplePoints(effectiveTarget);
                let found = null;
                for (const pointV of denseV)
                {
                    for (const pointT of denseT)
                    {
                        if (!_segmentBlocked(pointV, eyeViewer, pointT, eyeTarget, edges, ctx))
                        {
                            found = { pointV, pointT, reason: ctx.lastReason };
                            break;
                        }
                    }
                    if (found)
                        break;
                }
                if (found)
                {
                    anyClear = true;
                    gfx.lineStyle(2, 0x22ff44, 0.9);
                    gfx.moveTo(found.pointV.x, found.pointV.y);
                    gfx.lineTo(found.pointT.x, found.pointT.y);
                    const denseText = new PIXI.Text(`dense:${found.reason}`, {
                        fontFamily: 'monospace', fontSize: 10, fill: 0x22ff44, stroke: 0x000000, strokeThickness: 3,
                    });
                    denseText.anchor.set(0.5, 0.5);
                    denseText.position.set((found.pointV.x + found.pointT.x) / 2, (found.pointV.y + found.pointT.y) / 2);
                    _losDebugLayer.addChild(denseText);
                }
            }
            const center = effectiveTarget.center;
            const label = new PIXI.Text(`${anyClear ? 'LOS' : 'NO LOS'}  eye ${eyeViewer.toFixed(1)} -> ${eyeTarget.toFixed(1)}`, {
                fontFamily: 'monospace',
                fontSize: 13,
                fill: anyClear ? 0x33ff66 : 0xff5555,
                stroke: 0x000000,
                strokeThickness: 3,
            });
            label.anchor.set(0.5, 1);
            label.position.set(center.x, center.y - effectiveTarget.h / 2 - 4);
            _losDebugLayer.addChild(label);
        }
    }
}

function _installLosDebug()
{
    if (!_losDebugLayer || _losDebugLayer.destroyed)
    {
        _losDebugLayer = new PIXI.Container();
        _losDebugLayer.eventMode = 'none';
    }
    if (canvas?.stage && _losDebugLayer.parent !== canvas.stage)
        canvas.stage.addChild(_losDebugLayer);
    _drawLosDebug();
}

const AWARENESS_STYLES = { silhouette: 0, outline: 1, veil: 2 };

// How much of the veil silhouette stays opaque.
const VEIL_ALPHA = 0.35;

function _awarenessStyleMode()
{
    return AWARENESS_STYLES[getModuleSetting(SETTING_AWARENESS_STYLE)] ?? AWARENESS_STYLES.veil;
}

class SilhouetteOutlineFilter extends foundry.canvas.rendering.filters.OutlineOverlayFilter
{
    apply(filterManager, input, output, clear, currentState)
    {
        if (!this.uniforms.simpleMode)
        {
            super.apply(filterManager, input, output, clear, currentState);
            return;
        }
        const thickness = this.thickness * canvas.stage.scale.x;
        this.uniforms.time = canvas.app.ticker.lastTime;
        this.uniforms.thickness[0] = thickness / input._frame.width;
        this.uniforms.thickness[1] = thickness / input._frame.height;
        filterManager.applyFilter(this, input, output, clear);
    }

    static createFragmentShader()
    {
        return `
        varying vec2 vTextureCoord;
        varying vec2 vFilterCoord;
        uniform sampler2D uSampler;

        uniform vec2 thickness;
        uniform vec4 outlineColor;
        uniform vec4 filterClamp;
        uniform float alphaThreshold;
        uniform float time;
        uniform float styleMode;
        uniform float simpleMode;

        ${this.CONSTANTS}

        void main(void) {
            vec4 ownColor = texture2D(uSampler, clamp(vTextureCoord, filterClamp.xy, filterClamp.zw));
            float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
            float maxAlpha = 0.0;
            vec2 displaced;
            vec4 curColor;
            for ( float angle = 0.0; angle <= TWOPI; angle += ${(Math.PI * 2 / 30).toFixed(7)} ) {
                displaced.x = vTextureCoord.x + thickness.x * cos(angle);
                displaced.y = vTextureCoord.y + thickness.y * sin(angle);
                curColor = texture2D(uSampler, clamp(displaced, filterClamp.xy, filterClamp.zw));
                curColor.a = clamp((curColor.a - 0.6) * 2.5, 0.0, 1.0);
                maxAlpha = max(maxAlpha, curColor.a);
            }
            float resultAlpha = max(maxAlpha, texAlpha);

            if ( simpleMode > 0.5 ) {
                vec2 toCenter = vFilterCoord - vec2(0.5);
                float pixelAngle = atan(toCenter.y, toCenter.x);
                float rotA = mod(time * 0.0015, TWOPI) - 3.14159;
                float rotB = mod(time * 0.0015 + 3.14159, TWOPI) - 3.14159;
                float dA = abs(pixelAngle - rotA); dA = min(dA, TWOPI - dA);
                float dB = abs(pixelAngle - rotB); dB = min(dB, TWOPI - dB);
                float rot = max(pow(smoothstep(1.2, 0.0, dA), 2.0), pow(smoothstep(1.2, 0.0, dB), 2.0));
                vec3 ring = outlineColor.rgb * (1.0 - texAlpha) * (0.35 + 0.85 * rot);
                gl_FragColor = vec4(ring * resultAlpha, (1.0 - texAlpha) * resultAlpha);
                return;
            }

            float scanY = mod(time * 0.0008, 1.0);
            float lineDist = abs(vFilterCoord.y - scanY);
            float lineWidth = 0.015;
            float scan = pow(smoothstep(lineWidth, 0.0, lineDist), 4.0);

            if ( styleMode > 0.5 ) {
                float bodyAlpha = styleMode < 1.5 ? 0.0 : texAlpha * ${VEIL_ALPHA};
                float rimAlpha = (1.0 - texAlpha) * maxAlpha;
                vec3 rim = outlineColor.rgb * rimAlpha * (0.4 + 0.8 * scan);
                gl_FragColor = vec4(rim, bodyAlpha + rimAlpha);
                return;
            }

            vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
            gl_FragColor = vec4(outline * resultAlpha, resultAlpha);
        }
        `;
    }
}

class ScanlineOutlineFilter extends foundry.canvas.rendering.filters.OutlineOverlayFilter
{
    apply(filterManager, input, output, clear, currentState)
    {
        super.apply(filterManager, input, output, clear, currentState);
    }

    static createFragmentShader()
    {
        return `
        varying vec2 vTextureCoord;
        varying vec2 vFilterCoord;
        uniform sampler2D uSampler;

        uniform vec2 thickness;
        uniform vec4 outlineColor;
        uniform vec4 filterClamp;
        uniform float alphaThreshold;
        uniform float time;

        ${this.CONSTANTS}

        void main(void) {
            vec4 ownColor = texture2D(uSampler, clamp(vTextureCoord, filterClamp.xy, filterClamp.zw));
            float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
            float maxAlpha = 0.0;
            vec2 displaced;
            vec4 curColor;
            for ( float angle = 0.0; angle <= TWOPI; angle += ${(Math.PI * 2 / 30).toFixed(7)} ) {
                displaced.x = vTextureCoord.x + thickness.x * cos(angle);
                displaced.y = vTextureCoord.y + thickness.y * sin(angle);
                curColor = texture2D(uSampler, clamp(displaced, filterClamp.xy, filterClamp.zw));
                curColor.a = clamp((curColor.a - 0.6) * 2.5, 0.0, 1.0);
                maxAlpha = max(maxAlpha, curColor.a);
            }
            float resultAlpha = max(maxAlpha, texAlpha);

            float scanY = mod(time * 0.0008, 1.0);
            float lineDist = abs(vFilterCoord.y - scanY);
            float lineWidth = 0.04;
            float scan = pow(smoothstep(lineWidth, 0.0, lineDist), 3.0);

            vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
            vec4 outlineColor4 = vec4(outline * resultAlpha, resultAlpha);
            gl_FragColor = mix(outlineColor4, vec4(0.0), texAlpha);
        }
        `;
    }
}

// Identity passthrough; a null filter would hide detected tokens under unexplored fog.
class PlainVisionFilter extends PIXI.Filter
{
}

class DetectionModeLancerLineOfSight extends foundry.canvas.perception.DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        this._detectionFilter = new PlainVisionFilter();
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof foundry.canvas.placeables.Token))
            return false;
        if (!getModuleSetting(SETTING_LOS))
            return false;
        // plain-sight semantics: blind viewers and invisible targets stay hidden
        if (!super._canDetect(visionSource, target))
            return false;
        if (getLAFlag(target.document,'awarenessMode') === 'ignore')
            return false;
        const viewerToken = visionSource?.object;
        if (!viewerToken?.document)
            return false;
        if (_blindedBlocksSight(viewerToken, target))
            return false;
        return lancerHasLineOfSight(target, viewerToken);
    }

    _testRange(visionSource, mode, target, test)
    {
        return true;
    }
}

// Marker so the overlay ticker paints a gray desaturated fill (see _tickSilhouetteOverlays).
class ShadowVisionFilter extends PIXI.Filter
{
}

class PrimaryCopyFilter extends foundry.canvas.rendering.filters.AbstractBaseMaskFilter
{
    static fragmentShader = `
    precision highp float;
    varying vec2 vTextureCoord;
    varying vec2 vMaskTextureCoord;
    uniform sampler2D uSampler;
    uniform sampler2D primaryTexture;
    uniform sampler2D visionTexture;

    void main(void) {
        float revealed = texture2D(uSampler, vTextureCoord).a * (1.0 - texture2D(visionTexture, vMaskTextureCoord).r);
        gl_FragColor = vec4(texture2D(primaryTexture, vMaskTextureCoord).rgb * revealed, revealed);
    }
    `;

    static defaultUniforms = {
        primaryTexture: PIXI.Texture.EMPTY,
        visionTexture: PIXI.Texture.EMPTY,
        screenDimensions: [1, 1]
    };

    apply(filterManager, input, output, clear, currentState)
    {
        this.uniforms.primaryTexture = canvas.primary.renderTexture;
        this.uniforms.visionTexture = /** @type {any} */ (canvas.masks).vision.renderTexture;
        super.apply(filterManager, input, output, clear, currentState);
    }
}

let _primaryCopyFilter = null;
function _getPrimaryCopyFilter()
{
    if (_primaryCopyFilter)
        return _primaryCopyFilter;
    _primaryCopyFilter = PrimaryCopyFilter.create();
    return _primaryCopyFilter;
}

// 2D-visible but 3D-occluded: renders a gray fill instead of hiding or fully showing.
class DetectionModeLancerLosShadow extends foundry.canvas.perception.DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        this._detectionFilter = new ShadowVisionFilter();
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof foundry.canvas.placeables.Token))
            return false;
        if (getLAFlag(target.document,'awarenessMode') === 'ignore')
            return false;
        if (_blindedBlocksSight(visionSource?.object, target))
            return false;
        if (!_fovContains(visionSource, target))
            return false;
        if (_sensorCanDetect(visionSource, target))
            return false;
        if (_losCanDetect(target))
            return false;
        return _losVetoed(visionSource, target);
    }

    _testRange(visionSource, mode, target, test)
    {
        return true;
    }
}

class DetectionModeLancerAwareness extends foundry.canvas.perception.DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        const filter = SilhouetteOutlineFilter.create({ outlineColor: [1, 0.85, 0.15, 1], styleMode: _awarenessStyleMode(), simpleMode: 0 });
        filter.thickness = 1.25;
        this._detectionFilter = filter;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof foundry.canvas.placeables.Token))
            return false;
        if (getModuleSetting(SETTING_AWARENESS_COMBAT_ONLY) && !_isCombatActive())
            return false;
        if (_basicVisionSees(visionSource, target))
            return false;
        if (getLAFlag(target.document,'awarenessMode') === 'ignore')
            return false;
        // Sensor wins: any of the user's sources on sensors suppresses awareness, whichever source testVisibility reaches first.
        if (_anySensorCanDetect(target))
            return false;
        if (_losCanDetect(target))
            return false;
        return true;
    }

    _testRange(visionSource, mode, target, test)
    {
        if (getModuleSetting(SETTING_AWARENESS_USE_MODE_RANGE))
            return super._testRange(visionSource, mode, target, test);
        return true;
    }
}

// LOS wins: a full reveal from any of the user's sources suppresses the silhouette modes, whatever the source order.
function _losCanDetect(target)
{
    if (!getModuleSetting(SETTING_LOS))
        return false;
    const losMode = CONFIG.Canvas.detectionModes.lancerLineOfSight;
    if (!losMode)
        return false;
    for (const source of canvas?.effects?.visionSources?.values?.() ?? [])
    {
        if (!source.active)
            continue;
        const entry = source.object?.document?.detectionModes?.find(modeEntry => modeEntry.id === 'lancerLineOfSight');
        if (!entry?.enabled)
            continue;
        if (losMode._canDetect(source, target))
            return true;
    }
    return false;
}

function _anySensorCanDetect(target)
{
    for (const source of canvas?.effects?.visionSources?.values?.() ?? [])
    {
        if (!source.active)
            continue;
        if (_sensorCanDetect(source, target))
            return true;
    }
    return false;
}

function _sensorCanDetect(visionSource, target)
{
    const sourceToken = visionSource?.object;
    if (!sourceToken?.document)
        return false;
    const sensorMode = sourceToken.document.detectionModes?.find(modeEntry => modeEntry.id === 'lancerSensor');
    if (!sensorMode?.enabled)
        return false;
    if (getModuleSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive())
        return false;
    const targetMode = getLAFlag(target.document,'awarenessMode');
    if (targetMode && targetMode !== 'default')
        return false;
    const sensorRange = sourceToken.actor?.system?.sensor_range;
    if ((sensorRange ?? 0) <= 0)
        return false;
    const candidates = _sourcePositions(sourceToken);
    const targets = _sourceWithPreview(target);
    for (const src of candidates)
    {
        for (const targetPreview of targets)
        {
            try
            {
                if (getTokenDistance(src, targetPreview) <= sensorRange)
                    return true;
            }
            catch (e)
            {
                // ignore
            }
        }
    }
    return false;
}

class DetectionModeLancerSensor extends foundry.canvas.perception.DetectionMode
{
    static getDetectionFilter()
    {
        if (this._detectionFilter)
            return this._detectionFilter;
        const filter = ScanlineOutlineFilter.create({ outlineColor: [0.329, 0.620, 1.0, 1.0] });
        filter.thickness = 1.25;
        this._detectionFilter = filter;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target)
    {
        if (!(target instanceof foundry.canvas.placeables.Token))
            return false;
        if (getModuleSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive())
            return false;
        if (_basicVisionSees(visionSource, target))
            return false;
        const mode = getLAFlag(target.document,'awarenessMode');
        if (mode && mode !== 'default')
            return false;
        if (_losCanDetect(target))
            return false;
        return true;
    }

    _testRange(visionSource, mode, target, test)
    {
        if (getModuleSetting(SETTING_SENSOR_USE_MODE_RANGE))
            return super._testRange(visionSource, mode, target, test);
        const sourceToken = visionSource.object;
        const sensorRange = sourceToken?.actor?.system?.sensor_range;
        if ((sensorRange ?? 0) <= 0)
            return false;
        if (!sourceToken?.document || !target?.document)
            return super._testRange(visionSource, mode, target, test);
        const candidates = _sourcePositions(sourceToken);
        const targets = _sourceWithPreview(target);
        for (const src of candidates)
        {
            for (const targetPreview of targets)
            {
                try
                {
                    if (getTokenDistance(src, targetPreview) <= sensorRange)
                        return true;
                }
                catch (e)
                {
                    // ignore
                }
            }
        }
        return false;
    }
}

function _sourcePositions(token)
{
    if (token?.isPreview)
        return [token];
    return _sourceWithPreview(token);
}

function _sourceWithPreview(token)
{
    if (!token)
        return [];
    const list = [token];
    if (token._original?.document)
        list.push(token._original);
    const previews = canvas?.tokens?.preview?.children ?? [];
    for (const preview of previews)
    {
        if (preview instanceof foundry.canvas.placeables.Token && preview._original === token)
            list.push(preview);
    }
    return list;
}

function _registerVisionSettings()
{
    const refreshPerception = () =>
    {
        if (canvas?.perception)
            canvas.perception.update({ refreshVision: true });
    };
    game.settings.register(MODULE_ID, SETTING_SILH_LEGACY_OVERLAY, {
        name: 'LA.settings.lancerSilhLegacyOverlay.name',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () =>
        {
            _markOverlayDirty();
            refreshPerception();
        }
    });
    game.settings.register(MODULE_ID, SETTING_DIM_DEFER_MOVING, {
        name: 'LA.settings.occlusionDimDeferMoving.name',
        hint: 'LA.settings.occlusionDimDeferMoving.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: () =>
        {
            _markOverlayDirty();
            refreshPerception();
        }
    });
    game.settings.register(MODULE_ID, SETTING_AUTO_ADD, {
        name: 'LA.settings.lancerVisionAutoAdd.name',
        hint: 'LA.settings.lancerVisionAutoAdd.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_COMBAT_ONLY, {
        name: 'LA.settings.lancerSensorCombatOnly.name',
        hint: 'LA.settings.lancerSensorCombatOnly.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_COMBAT_ONLY, {
        name: 'LA.settings.lancerAwarenessCombatOnly.name',
        hint: 'LA.settings.lancerAwarenessCombatOnly.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_USE_MODE_RANGE, {
        name: 'LA.settings.lancerSensorUseModeRange.name',
        hint: 'LA.settings.lancerSensorUseModeRange.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_USE_MODE_RANGE, {
        name: 'LA.settings.lancerAwarenessUseModeRange.name',
        hint: 'LA.settings.lancerAwarenessUseModeRange.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_STYLE, {
        name: 'LA.settings.lancerAwarenessStyle.name',
        hint: 'LA.settings.lancerAwarenessStyle.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            silhouette: 'LA.settings.lancerAwarenessStyle.choices.silhouette',
            veil: 'LA.settings.lancerAwarenessStyle.choices.veil',
            outline: 'LA.settings.lancerAwarenessStyle.choices.outline'
        },
        default: 'veil',
        onChange: () =>
        {
            const filter = /** @type {any} */ (DetectionModeLancerAwareness)._detectionFilter;
            if (filter)
                filter.uniforms.styleMode = _awarenessStyleMode();
            // The overlay signature does not carry the style, so force the next pass to recompute.
            setLastOverlaySignature(null);
            _markOverlayDirty();
            refreshPerception();
        }
    });
    game.settings.register(MODULE_ID, SETTING_LOS, {
        name: 'LA.settings.lancerLos.name',
        hint: 'LA.settings.lancerLos.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_LOS_HEIGHT_RULE, {
        name: 'LA.settings.lancerLosHeightRule.name',
        hint: 'LA.settings.lancerLosHeightRule.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            discrete: 'LA.settings.lancerLosHeightRule.choices.discrete',
            trig: 'LA.settings.lancerLosHeightRule.choices.trig'
        },
        default: 'discrete',
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_LOS_DEBUG, {
        name: 'LA.settings.lancerLosDebug.name',
        hint: 'LA.settings.lancerLosDebug.hint',
        scope: 'client',
        config: false,
        type: Boolean,
        default: false,
        onChange: () => _drawLosDebug()
    });
    game.settings.register(MODULE_ID, SETTING_BASIC_SIGHT_999, {
        name: 'LA.settings.basicSightTo999.name',
        hint: 'LA.settings.basicSightTo999.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });
    game.settings.register(MODULE_ID, SETTING_DRAG_VISION_MODE, {
        name: 'LA.settings.dragVisionMode.name',
        hint: 'LA.settings.dragVisionMode.hint',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            full: 'LA.settings.dragVisionMode.choices.full',
            ratio: 'LA.settings.dragVisionMode.choices.ratio',
            flat: 'LA.settings.dragVisionMode.choices.flat'
        },
        default: 'full'
    });
}

// v13 first-hit order: sensor+awareness precede shadow so they fire on no-LOS tokens; shadow is last.
const _CANONICAL_ORDER = ['basicSight', 'lightPerception', 'lancerLineOfSight', 'lancerSensor', 'lancerAwareness', 'lancerLosShadow'];

const _ZERO_SCRUB_IDS = new Set(['lancerLineOfSight', 'lancerLosShadow', 'lancerSensor', 'lancerAwareness', 'lightPerception', 'basicSight']);

// range 0 = legacy sanitizer damage (it zeroed every row it touched); v13 reads 0 as "detects nothing"
function _sanitizeMode(mode)
{
    if (!mode)
        return null;
    const copy = { ...mode };
    if (_ZERO_SCRUB_IDS.has(copy.id) && copy.range === 0)
        copy.range = null;
    return copy;
}

function _augmentDetectionModes(existing)
{
    const original = [...(existing ?? [])];
    const byId = new Map(original.filter(mode => mode?.id).map(mode => [mode.id, _sanitizeMode(mode)]));
    // range null = unlimited (Foundry preps it to Infinity); 0 would mean "detects nothing"
    if (!byId.has('lancerLineOfSight'))
        byId.set('lancerLineOfSight', { id: 'lancerLineOfSight', enabled: true, range: null });
    if (!byId.has('lancerLosShadow'))
        byId.set('lancerLosShadow', { id: 'lancerLosShadow', enabled: true, range: null });
    if (!byId.has('lancerSensor'))
        byId.set('lancerSensor', { id: 'lancerSensor', enabled: true, range: null });
    if (!byId.has('lancerAwareness'))
        byId.set('lancerAwareness', { id: 'lancerAwareness', enabled: true, range: null });
    const ordered = [];
    for (const id of _CANONICAL_ORDER)
    {
        if (byId.has(id))
        {
            ordered.push(byId.get(id));
            byId.delete(id);
        }
    }
    for (const mode of byId.values())
        ordered.push(mode);
    const orderChanged = ordered.length !== original.length
        || ordered.some((mode, i) => original[i]?.id !== mode?.id);
    const rangesSanitized = ordered.some(mode =>
    {
        const orig = original.find(origMode => origMode?.id === mode?.id);
        return orig && orig.range !== mode.range;
    });
    return { updates: ordered, changed: orderChanged || rangesSanitized };
}

function _onCreateToken(tokenDoc, _options, userId)
{
    if (game.user.id !== userId)
        return;
    if (!getModuleSetting(SETTING_AUTO_ADD))
        return;
    const update = {};
    const { updates, changed } = _augmentDetectionModes(tokenDoc._source?.detectionModes ?? tokenDoc.detectionModes);
    if (changed)
        update.detectionModes = updates;
    if (getModuleSetting(SETTING_BASIC_SIGHT_999) && tokenDoc.sight?.range !== null)
        update["sight.range"] = null;
    if (Object.keys(update).length > 0)
        tokenDoc.update(update);
}

window.lancerAutoVisionSetup = async function (activeSceneOnly = false)
{
    if (!game.user.isGM)
        return;
    const overrideSightRange = getModuleSetting(SETTING_BASIC_SIGHT_999);

    ui.notifications.info(localize('LA.notify.updatingPrototypeTokenVision'));
    await Promise.all(game.actors.map(actor =>
    {
        const proto = actor.prototypeToken;
        const { updates, changed } = _augmentDetectionModes(proto?._source?.detectionModes ?? proto?.detectionModes);
        const update = {};
        if (changed)
            update["prototypeToken.detectionModes"] = updates;
        if (overrideSightRange && proto?.sight?.range !== null)
            update["prototypeToken.sight.range"] = null;
        if (Object.keys(update).length === 0)
            return null;
        return actor.update(update);
    }));

    ui.notifications.info(localize('LA.notify.updatingPlacedTokenVision'));
    for (const scene of game.scenes)
    {
        if (activeSceneOnly && scene !== game.canvas.scene)
            continue;
        const updates = [];
        for (const tokenDoc of scene.tokens)
        {
            if (!tokenDoc.actor)
                continue;
            const { updates: detectionModeUpdates, changed } = _augmentDetectionModes(tokenDoc._source?.detectionModes ?? tokenDoc.detectionModes);
            const tokenUpdate = { _id: tokenDoc.id };
            let hasUpdates = false;
            if (changed)
            {
                tokenUpdate.detectionModes = detectionModeUpdates;
                hasUpdates = true;
            }
            if (overrideSightRange && tokenDoc.sight?.range !== null)
            {
                tokenUpdate["sight.range"] = null;
                hasUpdates = true;
            }
            if (hasUpdates)
                updates.push(tokenUpdate);
        }
        if (updates.length === 0)
            continue;
        try
        {
            await scene.updateEmbeddedDocuments("Token", updates);
        }
        catch (err)
        {
            console.warn(`lancer-automations | vision update failed in scene ${scene.name}`, err);
        }
    }
    ui.notifications.info(localize('LA.notify.tokenVisionUpdated'));
};

export function initLancerDetectionModes()
{
    Hooks.once('init', () =>
    {
        _registerVisionSettings();
        CONFIG.Canvas.detectionModes.lancerAwareness = new DetectionModeLancerAwareness({
            id: 'lancerAwareness',
            label: 'LA.detectionMode.battlefieldAwareness',
            type: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerSensor = new DetectionModeLancerSensor({
            id: 'lancerSensor',
            label: 'LA.detectionMode.sensors',
            type: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerLineOfSight = new DetectionModeLancerLineOfSight({
            id: 'lancerLineOfSight',
            label: 'LA.detectionMode.lineOfSight',
            type: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerLosShadow = new DetectionModeLancerLosShadow({
            id: 'lancerLosShadow',
            label: 'LA.detectionMode.lineOfSightShadow',
            type: foundry.canvas.perception.DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        _wrapPlainSightVeto(CONFIG.Canvas.detectionModes.basicSight);
        _wrapPlainSightVeto(CONFIG.Canvas.detectionModes.lightPerception);
    });
    Hooks.on('sightRefresh', () =>
    {
        _markOverlayDirty();
        _drawLosDebug();
    });
    Hooks.on('controlToken', _losPairsClear);
    // Every edge writer invalidates on its own, so only wall, scene and setting changes drop the edges here.
    for (const hook of ['canvasReady', 'canvasTearDown', 'createWall', 'updateWall', 'deleteWall', 'clientSettingChanged', 'updateSetting'])
        Hooks.on(hook, _losInvalidateAll);
    // Position and elevation live in the pair key. Size, shape and eye-height flags feed the rays but do not.
    Hooks.on('updateToken', (tokenDoc, change) =>
    {
        if (['width', 'height', 'shape', 'flags'].some(key => key in change))
            _losPairsClear();
    });
    Hooks.on('createToken', _onCreateToken);
    Hooks.on('canvasReady', _installSilhouetteOverlayTicker);
    Hooks.on('canvasTearDown', _clearFootprints);
    Hooks.on('canvasReady', _installLosDebug);
    Hooks.on('controlToken', _drawLosDebug);
    Hooks.on('refreshToken', _drawLosDebug);
    Hooks.on('controlToken', _markOverlayDirty);
    Hooks.on('updateToken', _markOverlayDirty);
    _patchRenderDetectionFilter();
}

// 3D occlusion gate on plain sight only; sensors/awareness intentionally detect without LOS.
function _wrapPlainSightVeto(mode)
{
    if (!mode || mode._laLosVeto)
        return;
    mode._laLosVeto = true;
    const original = mode._canDetect.bind(mode);
    mode._canDetect = (visionSource, target) =>
    {
        const result = original(visionSource, target);
        if (!result)
            return result;
        // The Lancer LOS and shadow modes own token detection, so basic vision never clips a token at a wall.
        if (getModuleSetting(SETTING_LOS) && target instanceof foundry.canvas.placeables.Token && getLAFlag(target.document,'awarenessMode') !== 'ignore')
            return false;
        return result;
    };
}

const _MESH_FILTER_NAMES = new Set(['SilhouetteOutlineFilter', 'ScanlineOutlineFilter']);
const _REVEAL_FILTER_NAMES = new Set(['PlainVisionFilter', 'ShadowVisionFilter']);
const _LOS_REVEAL_VIA_COPY = true;
const _LOS_REVEAL_VIA_MASK = false;

// Stock SilhouetteOutlineFilter breaks at scale<=1 and conflicts with our overlay; skip it.
function _patchRenderDetectionFilter()
{
    const proto = /** @type {any} */ (foundry.canvas.placeables.Token.prototype);
    const orig = proto._renderDetectionFilter;
    // Hover raises zIndex, and at the re-sorted position the pass loses its body fill.
    const origRefreshState = proto._refreshState;
    proto._refreshState = function()
    {
        origRefreshState.call(this);
        if (!this.controlled && _MESH_FILTER_NAMES.has(this.detectionFilter?.constructor?.name))
            this.zIndex = 0;
    };
    const frameRect = new PIXI.Rectangle();
    const chainFilters = [];
    // fresh bounds (not the cached getBounds(true)), mesh filters kept so displacement FX carry over
    const renderWithMeshFilters = (token, renderer, filter = token.detectionFilter) =>
    {
        const mesh = token.mesh;
        if (!mesh)
            return;
        frameRect.copyFrom(mesh.getBounds(false));
        frameRect.pad(0.1 * Math.max(frameRect.width, frameRect.height));
        const originalFilters = mesh.filters;
        const originalTint = mesh.tint;
        const originalAlpha = mesh.worldAlpha;
        chainFilters.length = 0;
        for (const filter of originalFilters ?? [])
        {
            if (filter?.constructor?.name === 'FilterTransform')
                chainFilters.push(filter);
        }
        chainFilters.push(filter);
        mesh.filterArea = frameRect;
        mesh.filters = chainFilters;
        mesh.tint = 0xFFFFFF;
        mesh.worldAlpha = 1;
        mesh.pluginName = 'batch';
        try
        {
            mesh.render(renderer);
        }
        finally
        {
            mesh.filters = originalFilters;
            mesh.tint = originalTint;
            mesh.worldAlpha = originalAlpha;
            mesh.pluginName = null;
            mesh.filterArea = null;
        }
    };
    proto._renderDetectionFilter = function(renderer)
    {
        const filterName = this.detectionFilter?.constructor?.name;
        if (filterName === 'SilhouetteOutlineFilter')
        {
            if (!getModuleSetting(SETTING_SILH_LEGACY_OVERLAY))
                renderWithMeshFilters(this, renderer, getLAFlag(this.document, 'awarenessMode') === 'simple' ? _getSimpleSilhouetteFilter() : this.detectionFilter);
            return;
        }
        if (filterName === 'ScanlineOutlineFilter')
        {
            renderWithMeshFilters(this, renderer);
            return;
        }
        if (_REVEAL_FILTER_NAMES.has(filterName))
        {
            if (_LOS_REVEAL_VIA_COPY)
                renderWithMeshFilters(this, renderer, _getPrimaryCopyFilter());
            else if (!_LOS_REVEAL_VIA_MASK)
                this.mesh?.render(renderer);
            return;
        }
        return orig.call(this, renderer);
    };
}

// Sprite-based silhouette overlay (bypasses PIXI filter pipeline FBO bug for scale<=1)

const _OVERLAY_NAME = 'lancer-silhouette-overlay';

const _SILH_VERT = `
precision mediump float;
attribute vec2 aVertexPosition;
attribute vec2 aTextureCoord;
uniform mat3 translationMatrix;
uniform mat3 projectionMatrix;
varying vec2 vTextureCoord;
void main() {
    gl_Position = vec4((projectionMatrix * translationMatrix * vec3(aVertexPosition, 1.0)).xy, 0.0, 1.0);
    vTextureCoord = aTextureCoord;
}
`;

const _SILH_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
uniform vec4 outlineColor;
uniform float time;
uniform vec2 thickness;
uniform float alphaThreshold;
uniform float simpleMode;
uniform float styleMode;
#define TWOPI 6.28318530718

void main(void) {
    vec4 ownColor = texture2D(uSampler, vTextureCoord);
    float texAlpha = smoothstep(alphaThreshold, 1.0, ownColor.a);
    float maxAlpha = 0.0;
    for (float angle = 0.0; angle <= TWOPI; angle += 0.105) {
        vec2 displaced = vTextureCoord + vec2(thickness.x * cos(angle), thickness.y * sin(angle));
        vec4 c = texture2D(uSampler, clamp(displaced, vec2(0.001), vec2(0.999)));
        c.a = smoothstep(0.45, 0.8, c.a);
        maxAlpha = max(maxAlpha, c.a);
    }
    float resultAlpha = max(maxAlpha, texAlpha);
    if (simpleMode > 0.5) {
        vec2 toCenter = vTextureCoord - vec2(0.5);
        float pixelAngle = atan(toCenter.y, toCenter.x);
        float rotA = mod(time * 0.0015, TWOPI) - 3.14159;
        float rotB = mod(time * 0.0015 + 3.14159, TWOPI) - 3.14159;
        float dA = abs(pixelAngle - rotA); dA = min(dA, TWOPI - dA);
        float dB = abs(pixelAngle - rotB); dB = min(dB, TWOPI - dB);
        float rot = max(pow(smoothstep(1.2, 0.0, dA), 2.0), pow(smoothstep(1.2, 0.0, dB), 2.0));
        vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.35 + 0.85 * rot);
        gl_FragColor = vec4(outline * resultAlpha, (1.0 - texAlpha) * resultAlpha);
    } else if (styleMode > 0.5) {
        float scanY = mod(time * 0.0008, 1.0);
        float lineDist = abs(vTextureCoord.y - scanY);
        float scan = pow(smoothstep(0.005, 0.0, lineDist), 4.0);
        float bodyAlpha = styleMode < 1.5 ? 0.0 : texAlpha * ${VEIL_ALPHA};
        float rimAlpha = (1.0 - texAlpha) * maxAlpha;
        vec3 rim = outlineColor.rgb * rimAlpha * (0.4 + 0.8 * scan);
        gl_FragColor = vec4(rim, bodyAlpha + rimAlpha);
    } else {
        float scanY = mod(time * 0.0008, 1.0);
        float lineDist = abs(vTextureCoord.y - scanY);
        float scan = pow(smoothstep(0.005, 0.0, lineDist), 4.0);
        vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
        gl_FragColor = vec4(outline * resultAlpha, resultAlpha);
    }
}
`;

function _makeSilhouetteMesh(token, color)
{
    const tex = token.mesh?.texture;
    if (!tex)
        return null;
    const geometry = new PIXI.Geometry()
        .addAttribute('aVertexPosition', [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2)
        .addAttribute('aTextureCoord', [0, 0, 1, 0, 1, 1, 0, 1], 2)
        .addIndex([0, 1, 2, 0, 2, 3]);
    const program = PIXI.Program.from(_SILH_VERT, _SILH_FRAG);
    const shader = new PIXI.Shader(program, {
        uSampler: tex,
        outlineColor: color,
        time: 0,
        thickness: [0.04, 0.04],
        alphaThreshold: 0.6,
        simpleMode: 0,
        styleMode: 0
    });
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.name = _OVERLAY_NAME;
    return mesh;
}

function _syncOverlayTransform(mesh, token, simple)
{
    const tokenMesh = token.mesh;
    if (!tokenMesh)
        return;
    const meshWidth = tokenMesh.width || token.w;
    const meshHeight = tokenMesh.height || token.h;
    // mirror: tokenMesh.width/height are abs(); use the signed scale to mirror the overlay quad
    const mirrorX = Math.sign(tokenMesh.scale?.x ?? 1) || 1;
    const mirrorY = Math.sign(tokenMesh.scale?.y ?? 1) || 1;
    const anchorX = tokenMesh.anchor?.x ?? 0.5;
    const anchorY = tokenMesh.anchor?.y ?? 0.5;
    const localX = tokenMesh.position.x - token.position.x;
    const localY = tokenMesh.position.y - token.position.y;
    // anchor offset is in mesh-local space, so it flips with the sprite before rotation
    const anchorOffsetX = mirrorX * meshWidth * (0.5 - anchorX);
    const anchorOffsetY = mirrorY * meshHeight * (0.5 - anchorY);
    const rot = tokenMesh.rotation || 0;
    const cosRot = Math.cos(rot);
    const sinRot = Math.sin(rot);
    mesh.position.set(localX + cosRot * anchorOffsetX - sinRot * anchorOffsetY, localY + sinRot * anchorOffsetX + cosRot * anchorOffsetY);
    mesh.scale.set(mirrorX * meshWidth, mirrorY * meshHeight);
    mesh.rotation = rot;
    if (mesh.skew && tokenMesh.skew)
        mesh.skew.set(tokenMesh.skew.x ?? 0, tokenMesh.skew.y ?? 0);
    const stageScale = canvas.stage?.scale?.x ?? 1;
    const thicknessFactor = simple ? 0.1 : 0.35;
    const pulse = simple ? 1 : 0.75 + 0.5 * (Math.cos(performance.now() / 1500 * Math.PI * 2) * 0.5 + 0.5);
    mesh.shader.uniforms.thickness[0] = thicknessFactor * pulse * stageScale / meshWidth;
    mesh.shader.uniforms.thickness[1] = thicknessFactor * pulse * stageScale / meshHeight;
}

const _OVERLAY_COLOR = [1, 0.85, 0.15, 1];
const _OVERLAY_COLOR_SIMPLE = [1.0, 0.55, 0.15, 1.0];

let _simpleSilhouetteFilter = null;
function _getSimpleSilhouetteFilter()
{
    if (_simpleSilhouetteFilter)
        return _simpleSilhouetteFilter;
    const filter = SilhouetteOutlineFilter.create({ outlineColor: _OVERLAY_COLOR_SIMPLE, styleMode: 0, simpleMode: 1 });
    filter.thickness = 1.25;
    _simpleSilhouetteFilter = filter;
    return _simpleSilhouetteFilter;
}

function _getOverlayConfig(token)
{
    const filterName = token.detectionFilter?.constructor?.name;
    if (filterName !== 'SilhouetteOutlineFilter')
        return null;
    if (!getModuleSetting(SETTING_SILH_LEGACY_OVERLAY))
        return null;
    const mode = getLAFlag(token.document,'awarenessMode') ?? 'default';
    if (mode === 'ignore' || mode === 'visible')
        return null;
    const simple = mode === 'simple';
    return { color: simple ? _OVERLAY_COLOR_SIMPLE : _OVERLAY_COLOR, simple, styleMode: simple ? 0 : _awarenessStyleMode() };
}

// Multiply tint that dims a token to a Foundry-shadow look while keeping its colours.
const _DIM_TINT = 0x999999;

// Dim rather than hide occluded tokens so sensor/awareness overlays still show.
function _isOccludedFromUser(token)
{
    if (!getModuleSetting(SETTING_LOS) || !token?.document)
        return false;
    const sources = canvas?.effects?.visionSources;
    if (!sources || !sources.size)
        return false;
    for (const source of sources.values())
    {
        const viewer = source.object;
        if (!viewer?.document || viewer === token)
            return false;
        if (lancerHasLineOfSight(viewer, token))
            return false;
    }
    return true;
}

function _applyOcclusionDim(token)
{
    if (!token.mesh)
        return;
    const dim = token.visible && _isOccludedFromUser(token);
    if (dim)
    {
        token._laDimmed = true;
        token.mesh.tint = _DIM_TINT;
    }
    else if (token._laDimmed)
    {
        token._laDimmed = false;
        token.mesh.tint = 0xffffff;
    }
}

// Dirty-flag + 500ms fallback; avoids per-frame per-token LOS raycasts.
const _overlayTokens = new Map();
let _overlayDirty = true;
let _lastOverlayRefresh = 0;

function _markOverlayDirty()
{
    _overlayDirty = true;
}

// Everything the dim + overlay pass reads, except walls and settings, which reset the signature directly.
function _overlaySignature()
{
    const parts = [];
    // Collection iterates values, so take entries for the id.
    for (const [sourceId, source] of canvas?.effects?.visionSources?.entries() ?? [])
    {
        const data = source?.data;
        parts.push(`${sourceId}:${Math.round(data?.x ?? 0)},${Math.round(data?.y ?? 0)},${data?.elevation ?? 0},${source?.active ? 1 : 0}`);
    }
    parts.push('|');
    for (const token of canvas?.tokens?.placeables ?? [])
    {
        const doc = token.document;
        parts.push(`${doc.id}:${Math.round(doc.x)},${Math.round(doc.y)},${doc.elevation ?? 0},${token.visible ? 1 : 0},${token.detectionFilter?.constructor?.name ?? 0}`);
    }
    return parts.join(';');
}

function _refreshOverlayState()
{
    _overlayDirty = false;
    // A throttled drag cell fires sightRefresh without moving a source; the answers cannot have changed.
    const signature = _overlaySignature();
    if (signature === _lastOverlaySignature)
        return;
    // Occlusion costs a LOS raycast per token per source and goes stale a frame later while something
    // moves, so hold the dim until the move lands. Null signature forces that landing pass to recompute.
    const holdDim = getModuleSetting(SETTING_DIM_DEFER_MOVING) === true && isAnyTokenMoving();
    setLastOverlaySignature(holdDim ? null : signature);
    _overlayTokens.clear();
    if (!canvas?.tokens?.placeables)
        return;
    for (const token of canvas.tokens.placeables)
    {
        if (!holdDim)
            _applyOcclusionDim(token);
        const overlayConfig = _getOverlayConfig(token);
        const existing = token.children.find(child => child.name === _OVERLAY_NAME);
        if (!overlayConfig)
        {
            if (existing)
                existing.destroy({ children: true });
            continue;
        }
        let mesh = existing;
        if (!mesh)
        {
            mesh = _makeSilhouetteMesh(token, overlayConfig.color);
            if (!mesh)
                continue;
            // above the token base layers, below bars / status icons / nameplate
            const uiIndex = token.children.indexOf(token.bars);
            if (uiIndex >= 0)
                token.addChildAt(mesh, uiIndex);
            else
                token.addChild(mesh);
        }
        mesh.shader.uniforms.outlineColor = overlayConfig.color;
        mesh.shader.uniforms.simpleMode = overlayConfig.simple ? 1 : 0;
        mesh.shader.uniforms.styleMode = overlayConfig.styleMode;
        if (mesh.shader.uniforms.uSampler !== token.mesh?.texture && token.mesh?.texture)
            mesh.shader.uniforms.uSampler = token.mesh.texture;
        _overlayTokens.set(token, overlayConfig.simple);
    }
}

const _FOOT_FRAG = `
precision mediump float;
varying vec2 vTextureCoord;
uniform sampler2D uSampler;
void main(void) {
    gl_FragColor = vec4(min(1.0, texture2D(uSampler, vTextureCoord).a * 1000.0));
}
`;

let _footProgram = null;
let _footRoot = null;
const _footprints = new Map();

function _ensureFootRoot()
{
    const mask = canvas?.masks?.vision;
    if (!mask)
        return null;
    if (_footRoot?.destroyed)
        _footRoot = null;
    if (!_footRoot)
        _footRoot = new PIXI.Container();
    if (_footRoot.parent !== mask)
        mask.addChild(_footRoot);
    return _footRoot;
}

function _makeFootprintMesh(tex)
{
    const uvs = /** @type {any} */ (tex)._uvs?.uvsFloat32;
    const geometry = new PIXI.Geometry()
        .addAttribute('aVertexPosition', [-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2)
        .addAttribute('aTextureCoord', uvs ? Array.from(uvs) : [0, 0, 1, 0, 1, 1, 0, 1], 2)
        .addIndex([0, 1, 2, 0, 2, 3]);
    _footProgram ??= PIXI.Program.from(_SILH_VERT, _FOOT_FRAG);
    const mesh = new PIXI.Mesh(geometry, new PIXI.Shader(_footProgram, { uSampler: tex }));
    mesh.state.blendMode = PIXI.BLEND_MODES.MAX_COLOR;
    return mesh;
}

function _syncFootprint(entry, tokenMesh)
{
    const meshWidth = tokenMesh.width;
    const meshHeight = tokenMesh.height;
    const mirrorX = Math.sign(tokenMesh.scale.x) || 1;
    const mirrorY = Math.sign(tokenMesh.scale.y) || 1;
    const offsetX = mirrorX * meshWidth * (0.5 - tokenMesh.anchor.x);
    const offsetY = mirrorY * meshHeight * (0.5 - tokenMesh.anchor.y);
    const rot = tokenMesh.rotation;
    const cosRot = Math.cos(rot);
    const sinRot = Math.sin(rot);
    const posX = tokenMesh.position.x + cosRot * offsetX - sinRot * offsetY;
    const posY = tokenMesh.position.y + sinRot * offsetX + cosRot * offsetY;
    const scaleX = mirrorX * meshWidth * 1.1;
    const scaleY = mirrorY * meshHeight * 1.1;
    if (entry.posX === posX && entry.posY === posY && entry.rot === rot && entry.scaleX === scaleX && entry.scaleY === scaleY)
        return false;
    entry.posX = posX;
    entry.posY = posY;
    entry.rot = rot;
    entry.scaleX = scaleX;
    entry.scaleY = scaleY;
    entry.mesh.position.set(posX, posY);
    entry.mesh.scale.set(scaleX, scaleY);
    entry.mesh.rotation = rot;
    return true;
}

function _clearFootprints()
{
    for (const entry of _footprints.values())
        entry.mesh.destroy();
    _footprints.clear();
    if (_footRoot && !_footRoot.destroyed)
        _footRoot.destroy({ children: true });
    _footRoot = null;
}

function _tickFootprints()
{
    if (!_LOS_REVEAL_VIA_MASK)
        return;
    const root = _ensureFootRoot();
    if (!root)
        return;
    let changed = false;
    const live = new Set();
    for (const token of canvas.tokens?.placeables ?? [])
    {
        const tokenMesh = token.mesh;
        if (!tokenMesh?.texture || !token.visible || !tokenMesh.visible || !_REVEAL_FILTER_NAMES.has(token.detectionFilter?.constructor?.name))
            continue;
        live.add(token.id);
        let entry = _footprints.get(token.id);
        if (entry && entry.tex !== tokenMesh.texture)
        {
            entry.mesh.destroy();
            entry = null;
        }
        if (!entry)
        {
            entry = { tex: tokenMesh.texture, mesh: root.addChild(_makeFootprintMesh(tokenMesh.texture)), posX: NaN, posY: NaN, rot: NaN, scaleX: NaN, scaleY: NaN };
            _footprints.set(token.id, entry);
            changed = true;
        }
        if (_syncFootprint(entry, tokenMesh))
            changed = true;
    }
    for (const [id, entry] of _footprints)
    {
        if (live.has(id))
            continue;
        entry.mesh.destroy();
        _footprints.delete(id);
        changed = true;
    }
    if (changed)
        canvas.masks.vision.renderDirty = true;
}

function _tickSilhouetteOverlays()
{
    const now = performance.now();
    if (_overlayDirty || now - _lastOverlayRefresh > 500)
    {
        _refreshOverlayState();
        _lastOverlayRefresh = now;
    }
    _tickFootprints();
    if (!_overlayTokens.size)
        return;
    for (const [token, simple] of _overlayTokens)
    {
        const mesh = token.children?.find(child => child.name === _OVERLAY_NAME);
        if (!mesh || mesh.destroyed)
        {
            _overlayTokens.delete(token);
            continue;
        }
        if (token.targetArrows && token.targetArrows.zIndex < 600)
            token.targetArrows.zIndex = 600;
        if (token.targetPips && token.targetPips.zIndex < 600)
            token.targetPips.zIndex = 600;
        mesh.shader.uniforms.time = now;
        if (mesh.shader.uniforms.uSampler !== token.mesh?.texture && token.mesh?.texture)
            mesh.shader.uniforms.uSampler = token.mesh.texture;
        _syncOverlayTransform(mesh, token, simple);
    }
}

let _silhouetteTickerInstalled = false;
function _installSilhouetteOverlayTicker()
{
    _markOverlayDirty();
    if (_silhouetteTickerInstalled)
        return;
    canvas.app.ticker.add(_tickSilhouetteOverlays);
    _silhouetteTickerInstalled = true;
}
