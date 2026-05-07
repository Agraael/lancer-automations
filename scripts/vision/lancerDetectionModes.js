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
    if (!fov?.contains) return false;
    const tc = target?.center ?? { x: target?.x, y: target?.y };
    if (typeof tc?.x !== 'number' || typeof tc?.y !== 'number') return false;
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
        _applyScaledThickness(this, input);
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
            vec4 ownColor = texture2D(uSampler, vTextureCoord);
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

            // Vertical scanline sweeping top -> bottom, looping. Line draws
            // across the silhouette body as well as the outline.
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
        _applyScaledThickness(this, input);
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
            vec4 ownColor = texture2D(uSampler, vTextureCoord);
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

            // Vertical CRT scanline sweeping top -> bottom, looping.
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
        return true;
    }

    _testRange(visionSource, mode, target, test) {
        if (_getSetting(SETTING_AWARENESS_USE_MODE_RANGE)) {
            return super._testRange(visionSource, mode, target, test);
        }
        return true;
    }
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

function _augmentDetectionModes(existing) {
    const updates = [...(existing ?? [])];
    const has = (id) => updates.some(m => m?.id === id);
    let changed = false;
    if (!has('lancerSensor')) {
        updates.push({ id: 'lancerSensor', enabled: true, range: 0 });
        changed = true;
    }
    if (!has('lancerAwareness')) {
        updates.push({ id: 'lancerAwareness', enabled: true, range: 0 });
        changed = true;
    }
    return { updates, changed };
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
        return a.update(update, { diff: false, recursive: false });
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
            await s.updateEmbeddedDocuments("Token", updates, { diff: false, recursive: false });
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
}
