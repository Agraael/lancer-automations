/* global Hooks, CONFIG, DetectionMode, OutlineOverlayFilter, Token, game, canvas, ui */

import { getTokenDistance } from "../combat/overwatch.js";

const MODULE_ID = 'lancer-automations';
const SETTING_AUTO_ADD = 'lancerVisionAutoAdd';
const SETTING_SENSOR_COMBAT_ONLY = 'lancerSensorCombatOnly';
const SETTING_AWARENESS_COMBAT_ONLY = 'lancerAwarenessCombatOnly';
const SETTING_SENSOR_USE_MODE_RANGE = 'lancerSensorUseModeRange';
const SETTING_AWARENESS_USE_MODE_RANGE = 'lancerAwarenessUseModeRange';
const SETTING_BASIC_SIGHT_999 = 'basicSightTo999';
const SETTING_DRAG_VISION_MODE = 'dragVisionMode';

function _getSetting(key) {
    try {
        return game.settings.get(MODULE_ID, key);
    } catch (e) {
        return undefined;
    }
}

function _isCombatActive() {
    return !!game.combat?.started;
}

function _basicVisionSees(visionSource, target) {
    const fov = /** @type {any} */ (visionSource)?.fov;
    if (!fov?.contains)
        return false;
    const tc = target?.center ?? { x: target?.x, y: target?.y };
    if (typeof tc?.x !== 'number' || typeof tc?.y !== 'number')
        return false;
    return fov.contains(tc.x, tc.y);
}

function _isBlockedByTokenEdge(visionSource, target) {
    if (!canvas?.edges || !target) {
        return false;
    }
    const srcTokenId = visionSource?.object?.id;
    const src = { x: visionSource.x, y: visionSource.y };
    const dst = target.center ?? { x: target.x, y: target.y };
    for (const edge of canvas.edges.values()) {
        const id = edge.id;
        if (typeof id !== 'string' || !id.startsWith('la-block-los-')) {
            continue;
        }
        if (srcTokenId && id.startsWith(`la-block-los-${srcTokenId}-`)) {
            continue;
        }
        if (foundry.utils.lineSegmentIntersects(src, dst, edge.a, edge.b)) {
            return true;
        }
    }
    return false;
}

function _applyScaledThickness(filter, input) {
    const w = input?.filterFrame?.width ?? input?.width ?? 100;
    const h = input?.filterFrame?.height ?? input?.height ?? 100;
    const sz = Math.max(w, h);
    filter.thickness = Math.max(1, sz * 0.001);
}

class SilhouetteOutlineFilter extends OutlineOverlayFilter {
    apply(filterManager, input, output, clear, currentState) {
        super.apply(filterManager, input, output, clear, currentState);
    }

    static createFragmentShader() {
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
            float lineWidth = 0.015;
            float scan = pow(smoothstep(lineWidth, 0.0, lineDist), 4.0);

            vec3 fill = outlineColor.rgb * scan * texAlpha;
            vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
            gl_FragColor = vec4((fill + outline) * resultAlpha, resultAlpha);
        }
        `;
    }
}

class ScanlineOutlineFilter extends OutlineOverlayFilter {
    apply(filterManager, input, output, clear, currentState) {
        super.apply(filterManager, input, output, clear, currentState);
    }

    static createFragmentShader() {
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

class DetectionModeLancerAwareness extends DetectionMode {
    static getDetectionFilter() {
        if (this._detectionFilter) {
            return this._detectionFilter;
        }
        const f = SilhouetteOutlineFilter.create({ outlineColor: [1, 0.85, 0.15, 1] });
        f.thickness = 1.25;
        this._detectionFilter = f;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target) {
        if (!(target instanceof Token)) {
            return false;
        }
        if (_getSetting(SETTING_AWARENESS_COMBAT_ONLY) && !_isCombatActive()) {
            return false;
        }
        if (_basicVisionSees(visionSource, target)) {
            return false;
        }
        if (target.document?.getFlag?.(MODULE_ID, 'awarenessMode') === 'ignore') {
            return false;
        }
        // Sensor wins: if the same observer's sensor mode would detect this target, suppress awareness.
        if (_sensorCanDetect(visionSource, target)) {
            return false;
        }
        return true;
    }

    _testRange(visionSource, mode, target, test) {
        if (_getSetting(SETTING_AWARENESS_USE_MODE_RANGE)) {
            return super._testRange(visionSource, mode, target, test);
        }
        return true;
    }
}

function _sensorCanDetect(visionSource, target) {
    const sourceToken = visionSource?.object;
    if (!sourceToken?.document)
        return false;
    const sensorMode = sourceToken.document.detectionModes?.find(m => m.id === 'lancerSensor');
    if (!sensorMode?.enabled)
        return false;
    if (_getSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive())
        return false;
    const targetMode = target.document?.getFlag?.(MODULE_ID, 'awarenessMode');
    if (targetMode && targetMode !== 'default')
        return false;
    const sensorRange = sourceToken.actor?.system?.sensor_range;
    if ((sensorRange ?? 0) <= 0)
        return false;
    const candidates = _sourceWithPreview(sourceToken);
    const targets = _sourceWithPreview(target);
    for (const src of candidates) {
        for (const tgt of targets) {
            try {
                if (getTokenDistance(src, tgt) <= sensorRange)
                    return true;
            } catch (e) {
                // ignore
            }
        }
    }
    return false;
}

class DetectionModeLancerSensor extends DetectionMode {
    static getDetectionFilter() {
        if (this._detectionFilter) {
            return this._detectionFilter;
        }
        const f = ScanlineOutlineFilter.create({ outlineColor: [0.329, 0.620, 1.0, 1.0] });
        f.thickness = 1.25;
        this._detectionFilter = f;
        return this._detectionFilter;
    }

    _canDetect(visionSource, target) {
        if (!(target instanceof Token)) {
            return false;
        }
        if (_getSetting(SETTING_SENSOR_COMBAT_ONLY) && !_isCombatActive()) {
            return false;
        }
        if (_basicVisionSees(visionSource, target)) {
            return false;
        }
        const mode = target.document?.getFlag?.(MODULE_ID, 'awarenessMode');
        if (mode && mode !== 'default') {
            return false;
        }
        return true;
    }

    _testRange(visionSource, mode, target, test) {
        if (_getSetting(SETTING_SENSOR_USE_MODE_RANGE)) {
            return super._testRange(visionSource, mode, target, test);
        }
        const sourceToken = visionSource.object;
        const sensorRange = sourceToken?.actor?.system?.sensor_range;
        if ((sensorRange ?? 0) <= 0) {
            return false;
        }
        if (!sourceToken?.document || !target?.document) {
            return super._testRange(visionSource, mode, target, test);
        }
        const candidates = _sourceWithPreview(sourceToken);
        const targets = _sourceWithPreview(target);
        for (const src of candidates) {
            for (const tgt of targets) {
                try {
                    if (getTokenDistance(src, tgt) <= sensorRange) {
                        return true;
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
        return false;
    }
}

function _sourceWithPreview(token) {
    if (!token) {
        return [];
    }
    const list = [token];
    if (token._original?.document) {
        list.push(token._original);
    }
    const previews = canvas?.tokens?.preview?.children ?? [];
    for (const c of previews) {
        if (c instanceof Token && c._original === token) {
            list.push(c);
        }
    }
    return list;
}

function _registerVisionSettings() {
    const refreshPerception = () => {
        if (canvas?.perception) {
            canvas.perception.update({ refreshVision: true });
        }
    };
    game.settings.register(MODULE_ID, SETTING_AUTO_ADD, {
        name: 'Auto-add Lancer detection modes on token creation',
        hint: 'When a new token is placed, automatically add Lancer Sensors and Battlefield Awareness to its detection modes.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_COMBAT_ONLY, {
        name: 'Lancer Sensors: combat only',
        hint: 'Lancer Sensors detect tokens only when combat is active.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_COMBAT_ONLY, {
        name: 'Battlefield Awareness: combat only',
        hint: 'Battlefield Awareness detects tokens only when combat is active.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_SENSOR_USE_MODE_RANGE, {
        name: 'Lancer Sensors: use detection-mode range',
        hint: 'When on, Sensors uses the per-token mode range (Foundry default). When off, it auto-pulls actor.system.sensor_range.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_AWARENESS_USE_MODE_RANGE, {
        name: 'Battlefield Awareness: use detection-mode range',
        hint: 'When on, Awareness uses the per-token mode range (finite). When off, range is infinite.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false,
        onChange: refreshPerception
    });
    game.settings.register(MODULE_ID, SETTING_BASIC_SIGHT_999, {
        name: 'Basic vision range = 999',
        hint: 'Override basicSight and lightPerception detection range to 999 on auto-created tokens.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: false
    });
    game.settings.register(MODULE_ID, SETTING_DRAG_VISION_MODE, {
        name: 'Drag-vision mode',
        hint: 'How to interpret the Drag Vision Multiplier value while a token is being dragged.',
        scope: 'world',
        config: false,
        type: String,
        choices: {
            ratio: 'Ratio (multiply current radius)',
            flat: 'Flat (range in scene units)'
        },
        default: 'ratio'
    });
}

// v13 picks the first hit in order; sensor must precede awareness.
const _CANONICAL_ORDER = ['basicSight', 'lightPerception', 'lancerSensor', 'lancerAwareness'];

// Lancer v3 rejects null/Infinity range.
function _sanitizeMode(m) {
    if (!m)
        return null;
    const range = Number.isFinite(m.range) ? m.range : 0;
    return { ...m, range };
}

function _augmentDetectionModes(existing) {
    const original = [...(existing ?? [])];
    const byId = new Map(original.filter(m => m?.id).map(m => [m.id, _sanitizeMode(m)]));
    if (!byId.has('lancerSensor'))
        byId.set('lancerSensor', { id: 'lancerSensor', enabled: true, range: 0 });
    if (!byId.has('lancerAwareness'))
        byId.set('lancerAwareness', { id: 'lancerAwareness', enabled: true, range: 0 });
    const ordered = [];
    for (const id of _CANONICAL_ORDER) {
        if (byId.has(id)) {
            ordered.push(byId.get(id));
            byId.delete(id);
        }
    }
    for (const m of byId.values())
        ordered.push(m);
    const orderChanged = ordered.length !== original.length
        || ordered.some((m, i) => original[i]?.id !== m?.id);
    const rangesSanitized = ordered.some((m, i) => {
        const orig = original.find(o => o?.id === m?.id);
        return orig && orig.range !== m.range;
    });
    return { updates: ordered, changed: orderChanged || rangesSanitized };
}

function _onCreateToken(tokenDoc, _options, userId) {
    if (game.user.id !== userId) {
        return;
    }
    if (!_getSetting(SETTING_AUTO_ADD)) {
        return;
    }
    const update = {};
    const { updates, changed } = _augmentDetectionModes(tokenDoc.detectionModes);
    if (changed) {
        update.detectionModes = updates;
    }
    if (_getSetting(SETTING_BASIC_SIGHT_999) && tokenDoc.sight?.range !== 999) {
        update["sight.range"] = 999;
    }
    if (Object.keys(update).length > 0) {
        tokenDoc.update(update);
    }
}

window.lancerAutoVisionSetup = async function (activeSceneOnly = false) {
    if (!game.user.isGM) {
        return;
    }
    const overrideSightRange = _getSetting(SETTING_BASIC_SIGHT_999);

    ui.notifications.info("Updating prototype token vision...");
    await Promise.all(game.actors.map(a => {
        const proto = a.prototypeToken;
        const { updates, changed } = _augmentDetectionModes(proto?.detectionModes);
        const update = {};
        if (changed) {
            update["prototypeToken.detectionModes"] = updates;
        }
        if (overrideSightRange && proto?.sight?.range !== 999) {
            update["prototypeToken.sight.range"] = 999;
        }
        if (Object.keys(update).length === 0) {
            return null;
        }
        return a.update(update);
    }));

    ui.notifications.info("Updating placed token vision...");
    for (const s of game.scenes) {
        if (activeSceneOnly && s !== game.canvas.scene) {
            continue;
        }
        const updates = [];
        for (const t of s.tokens) {
            if (!t.actor) {
                continue;
            }
            const { updates: dm, changed } = _augmentDetectionModes(t.detectionModes);
            const u = { _id: t.id };
            let any = false;
            if (changed) {
                u.detectionModes = dm;
                any = true;
            }
            if (overrideSightRange && t.sight?.range !== 999) {
                u["sight.range"] = 999;
                any = true;
            }
            if (any) {
                updates.push(u);
            }
        }
        if (updates.length === 0) {
            continue;
        }
        try {
            await s.updateEmbeddedDocuments("Token", updates);
        } catch (err) {
            console.warn(`lancer-automations | vision update failed in scene ${s.name}`, err);
        }
    }
    ui.notifications.info("Token vision updated.");
};

export function initLancerDetectionModes() {
    Hooks.once('init', () => {
        _registerVisionSettings();
        CONFIG.Canvas.detectionModes.lancerAwareness = new DetectionModeLancerAwareness({
            id: 'lancerAwareness',
            label: 'Lancer: Battlefield Awareness',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
        CONFIG.Canvas.detectionModes.lancerSensor = new DetectionModeLancerSensor({
            id: 'lancerSensor',
            label: 'Lancer: Sensors',
            type: DetectionMode.DETECTION_TYPES.SIGHT,
            walls: false,
            angle: false,
            tokenConfig: true
        });
    });
    Hooks.on('createToken', _onCreateToken);
    Hooks.on('canvasReady', _installSilhouetteOverlayTicker);
    _patchRenderDetectionFilter();
}

// Foundry's stock SilhouetteOutlineFilter renders broken bodies for scale<=1
// and overlaps our overlay. Skip its render entirely when we're handling the token.
function _patchRenderDetectionFilter() {
    const proto = /** @type {any} */ (Token.prototype);
    const orig = proto._renderDetectionFilter;
    proto._renderDetectionFilter = function(renderer) {
        const filterName = this.detectionFilter?.constructor?.name;
        if (filterName === 'SilhouetteOutlineFilter') {
            return;
        }
        return orig.call(this, renderer);
    };
}

// ---------------------------------------------------------------------------
// Sprite-based silhouette overlay (bypasses PIXI filter pipeline FBO bug for scale<=1)
// ---------------------------------------------------------------------------

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
    } else {
        float scanY = mod(time * 0.0008, 1.0);
        float lineDist = abs(vTextureCoord.y - scanY);
        float scan = pow(smoothstep(0.005, 0.0, lineDist), 4.0);
        vec3 fill = outlineColor.rgb * scan * texAlpha;
        vec3 outline = outlineColor.rgb * (1.0 - texAlpha) * (0.4 + 0.8 * scan);
        gl_FragColor = vec4((fill + outline) * resultAlpha, resultAlpha);
    }
}
`;

function _makeSilhouetteMesh(token, color) {
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
        simpleMode: 0
    });
    const mesh = new PIXI.Mesh(geometry, shader);
    mesh.name = _OVERLAY_NAME;
    mesh.zIndex = 500;
    return mesh;
}

function _syncOverlayTransform(mesh, token, simple) {
    const pmesh = token.mesh;
    if (!pmesh)
        return;
    const w = pmesh.width || token.w;
    const h = pmesh.height || token.h;
    const ax = pmesh.anchor?.x ?? 0.5;
    const ay = pmesh.anchor?.y ?? 0.5;
    const localX = pmesh.position.x - token.position.x;
    const localY = pmesh.position.y - token.position.y;
    // Anchor compensation must be rotated: pmesh rotates around its anchor, so its visual center
    // sits at position + R(rot) * (w*(0.5-ax), h*(0.5-ay)). The overlay centers on its own position.
    const dx = w * (0.5 - ax);
    const dy = h * (0.5 - ay);
    const rot = pmesh.rotation || 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    mesh.position.set(localX + cos * dx - sin * dy, localY + sin * dx + cos * dy);
    mesh.scale.set(w, h);
    mesh.rotation = rot;
    const stageScale = canvas.stage?.scale?.x ?? 1;
    const thicknessFactor = simple ? 0.1 : 0.35;
    const osc = simple ? 1 : 0.75 + 0.5 * (Math.cos(performance.now() / 1500 * Math.PI * 2) * 0.5 + 0.5);
    mesh.shader.uniforms.thickness[0] = thicknessFactor * osc * stageScale / w;
    mesh.shader.uniforms.thickness[1] = thicknessFactor * osc * stageScale / h;
}

const _OVERLAY_COLOR = [1, 0.85, 0.15, 1];
const _OVERLAY_COLOR_SIMPLE = [1.0, 0.55, 0.15, 1.0];

function _getOverlayCfg(token) {
    const filterName = token.detectionFilter?.constructor?.name;
    if (filterName !== 'SilhouetteOutlineFilter') {
        return null;
    }
    const mode = token.document?.getFlag?.(MODULE_ID, 'awarenessMode') ?? 'default';
    if (mode === 'ignore' || mode === 'visible') {
        return null;
    }
    const simple = mode === 'simple';
    return { color: simple ? _OVERLAY_COLOR_SIMPLE : _OVERLAY_COLOR, simple };
}

function _tickSilhouetteOverlays() {
    if (!canvas?.tokens?.placeables)
        return;
    const t = performance.now();
    for (const token of canvas.tokens.placeables) {
        const cfg = _getOverlayCfg(token);
        const existing = token.children.find(c => c.name === _OVERLAY_NAME);
        if (!cfg) {
            if (existing)
                existing.destroy({ children: true });
            continue;
        }
        let mesh = existing;
        if (!mesh) {
            mesh = _makeSilhouetteMesh(token, cfg.color);
            if (!mesh)
                continue;
            token.addChild(mesh);
            token.sortableChildren = true;
        }
        if (token.targetArrows && token.targetArrows.zIndex < 600) {
            token.targetArrows.zIndex = 600;
        }
        if (token.targetPips && token.targetPips.zIndex < 600) {
            token.targetPips.zIndex = 600;
        }
        mesh.shader.uniforms.time = t;
        mesh.shader.uniforms.outlineColor = cfg.color;
        mesh.shader.uniforms.simpleMode = cfg.simple ? 1 : 0;
        if (mesh.shader.uniforms.uSampler !== token.mesh?.texture && token.mesh?.texture) {
            mesh.shader.uniforms.uSampler = token.mesh.texture;
        }
        _syncOverlayTransform(mesh, token, cfg.simple);
    }
}

let _silhouetteTickerInstalled = false;
function _installSilhouetteOverlayTicker() {
    if (_silhouetteTickerInstalled)
        return;
    canvas.app.ticker.add(_tickSilhouetteOverlays);
    _silhouetteTickerInstalled = true;
}
