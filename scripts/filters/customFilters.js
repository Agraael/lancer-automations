/**
 * Custom TokenMagic filters for lancer-automations.
 * Registers filter types at import time (before any hooks fire).
 */
import { FilterType } from '../../../../modules/tokenmagic/module/tokenmagicBundle.js';

// ---------------------------------------------------------------------------
// FilterFracture — Voronoi F2-F1 glowing cracks with noise distortion
// ---------------------------------------------------------------------------

const fractureFragment = `
precision mediump float;

uniform float time;
uniform vec3 color;
uniform float intensity;
uniform float scale;
uniform float crackWidth;
uniform float opacity;
uniform float warpStrength;
uniform float noiseScale;
uniform float maskAmount;
uniform int blend;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 blenderVec3(int blend, vec4 fColv4, vec4 sColv4)
{
    vec3 fCol = vec3(fColv4);
    vec3 sCol = vec3(sColv4);
    if      (blend == 1)  { fCol = fCol * sCol; }
    else if (blend == 2)  { fCol = (1. - (1. - fCol) * (1. - sCol)); }
    else if (blend == 3)  { fCol = min(fCol, sCol); }
    else if (blend == 4)  { fCol = max(fCol, sCol); }
    else if (blend == 5)  { fCol = abs(fCol - sCol); }
    else if (blend == 6)  { fCol = 1. - abs(1. - fCol - sCol); }
    else if (blend == 7)  { fCol = fCol + sCol - (2. * fCol * sCol); }
    else if (blend == 8)  { fCol = all(lessThanEqual(fCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 9)  { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 10) { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol + fCol * fCol * (1. - 2. * sCol)) : sqrt(fCol) * (2. * sCol - 1.) + (2. * fCol) * (1. - sCol); }
    else if (blend == 11) { fCol = fCol / (1.0 - sCol); }
    else if (blend == 12) { fCol = 1.0 - (1.0 - fCol) / sCol; }
    else if (blend == 13) { fCol = fCol + sCol; }
    else                  { fCol = fCol + sCol; }
    return vec4(fCol, 1.0);
}

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(43.27, 81.63))) * 4358.5453);
}

float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash1(i);
    float b = hash1(i + vec2(1.0, 0.0));
    float c = hash1(i + vec2(0.0, 1.0));
    float d = hash1(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uv = vFilterCoord * scale;

    // Distort UV with noise to make edges jagged/crackly
    vec2 distort = vec2(
        vnoise(uv * noiseScale + time * 0.1) - 0.5,
        vnoise(uv * noiseScale + vec2(5.0, 3.0) + time * 0.1) - 0.5
    ) * warpStrength * 0.3;
    uv += distort;

    // Voronoi F2-F1
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);

    float d1 = 8.0;
    float d2 = 8.0;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 neighbor = vec2(float(i), float(j));
            vec2 point = hash2(ip + neighbor);
            point = 0.5 + 0.5 * sin(time + 6.2831 * point);
            vec2 diff = neighbor + point - fp;
            float dist = length(diff);

            if (dist < d1) {
                d2 = d1;
                d1 = dist;
            } else if (dist < d2) {
                d2 = dist;
            }
        }
    }

    // F2-F1: zero at cell boundaries, large inside cells
    float edge = d2 - d1;

    // Noise mask — randomly hide sections of cracks
    // Uses position along the edge to break up continuous lines
    float mask = vnoise(uv * 2.5 + time * 0.05);
    mask = smoothstep(maskAmount, maskAmount + 0.3, mask);

    // Exponential glow: bright core with tight falloff
    float glow = exp(-edge / crackWidth) * mask;

    // Sharp bright core
    float core = exp(-edge / (crackWidth * 0.15)) * mask;

    float total = clamp((glow * 0.6 + core * 0.8) * intensity, 0.0, 1.0);

    // White-hot core, colored glow
    vec3 crackCol = mix(color, vec3(1.0), core);
    vec4 crackColor = vec4(crackCol * total * opacity, 1.0);

    gl_FragColor = blenderVec3(blend, pixel, crackColor) * pixel.a;
}
`;

const customVertex2D = `
precision mediump float;

attribute vec2 aVertexPosition;

uniform mat3 projectionMatrix;
uniform mat3 filterMatrix;
uniform vec4 inputSize;
uniform vec4 outputFrame;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 filterVertexPosition(void)
{
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0., 1.);
}

vec2 filterTextureCoord(void)
{
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFilterCoord = (filterMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`;

const _tempRect = new PIXI.Rectangle();

export class FilterFracture extends PIXI.Filter {
    constructor(params) {
        super(customVertex2D, fractureFragment);

        this.uniforms.color = new Float32Array([1.0, 1.0, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterFracture.defaults);

        this._timeSpeed = params?.timeSpeed ?? 0.3;
        this._lastTime = performance.now();

        this.zOrder = 200;
        this.animated = {};
        this.setTMParams(params);
        if (!this.dummy) {
            this.normalizeTMParams();
        }
    }

    /**
     * Inlined from TokenMagic's CustomFilter.apply() for stable vFilterCoord,
     * plus self-driven time animation.
     */
    apply(filterManager, input, output, clear) {
        const now = performance.now();
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;
        this.uniforms.time += dt * this._timeSpeed;

        const filterMatrix = this.uniforms.filterMatrix;

        if (filterMatrix) {
            const { sourceFrame, destinationFrame, target } = filterManager.activeState;

            filterMatrix.set(
                destinationFrame.width, 0, 0, destinationFrame.height,
                sourceFrame.x, sourceFrame.y
            );

            const worldTransform = PIXI.Matrix.TEMP_MATRIX;
            const localBounds = target.getLocalBounds(_tempRect);

            if (this.sticky) {
                worldTransform.copyFrom(target.transform.worldTransform);
                worldTransform.invert();

                const rotation = target.transform.rotation;
                const sin = Math.sin(rotation);
                const cos = Math.cos(rotation);
                const scaleX = Math.hypot(
                    cos * worldTransform.a + sin * worldTransform.c,
                    cos * worldTransform.b + sin * worldTransform.d
                );
                const scaleY = Math.hypot(
                    -sin * worldTransform.a + cos * worldTransform.c,
                    -sin * worldTransform.b + cos * worldTransform.d
                );

                localBounds.pad(scaleX * this.boundsPadding.x, scaleY * this.boundsPadding.y);
            } else {
                const transform = target.transform;
                worldTransform.a = transform.scale.x;
                worldTransform.b = 0;
                worldTransform.c = 0;
                worldTransform.d = transform.scale.y;
                worldTransform.tx = transform.position.x - transform.pivot.x * transform.scale.x;
                worldTransform.ty = transform.position.y - transform.pivot.y * transform.scale.y;
                worldTransform.prepend(target.parent.transform.worldTransform);
                worldTransform.invert();

                const scaleX = Math.hypot(worldTransform.a, worldTransform.b);
                const scaleY = Math.hypot(worldTransform.c, worldTransform.d);

                localBounds.pad(scaleX * this.boundsPadding.x, scaleY * this.boundsPadding.y);
            }

            filterMatrix.prepend(worldTransform);
            filterMatrix.translate(-localBounds.x, -localBounds.y);
            filterMatrix.scale(1.0 / localBounds.width, 1.0 / localBounds.height);

            const filterMatrixInverse = this.uniforms.filterMatrixInverse;
            if (filterMatrixInverse) {
                filterMatrixInverse.copyFrom(filterMatrix);
                filterMatrixInverse.invert();
            }
        }

        filterManager.applyFilter(this, input, output, clear);
    }

    get time() { return this.uniforms.time; }
    set time(value) { this.uniforms.time = value; }

    get color() { return PIXI.utils.rgb2hex(this.uniforms.color); }
    set color(value) { new PIXI.Color(value).toRgbArray(this.uniforms.color); }

    get intensity() { return this.uniforms.intensity; }
    set intensity(value) { this.uniforms.intensity = value; }

    get scale() { return this.uniforms.scale; }
    set scale(value) { this.uniforms.scale = value; }

    get crackWidth() { return this.uniforms.crackWidth; }
    set crackWidth(value) { this.uniforms.crackWidth = value; }

    get opacity() { return this.uniforms.opacity; }
    set opacity(value) { this.uniforms.opacity = value; }

    get warpStrength() { return this.uniforms.warpStrength; }
    set warpStrength(value) { this.uniforms.warpStrength = value; }

    get noiseScale() { return this.uniforms.noiseScale; }
    set noiseScale(value) { this.uniforms.noiseScale = value; }

    get maskAmount() { return this.uniforms.maskAmount; }
    set maskAmount(value) { this.uniforms.maskAmount = value; }

    get blend() { return this.uniforms.blend; }
    set blend(value) { this.uniforms.blend = Math.floor(value); }
}

FilterFracture.defaults = {
    time: 0,
    color: 0xcccccc,
    intensity: 1.0,
    scale: 10,
    crackWidth: 0.02,
    opacity: 0.8,
    warpStrength: 1.0,
    noiseScale: 4.0,
    maskAmount: 0.25,
    blend: 2,
};

// ---------------------------------------------------------------------------
// FilterChains — Crossing chain-link pattern overlay
// ---------------------------------------------------------------------------

const chainsFragment = `
precision mediump float;

uniform float time;
uniform vec3 color;
uniform float intensity;
uniform float scale;
uniform float linkWidth;
uniform float linkGap;
uniform float opacity;
uniform int blend;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 blenderVec3(int blend, vec4 fColv4, vec4 sColv4)
{
    vec3 fCol = vec3(fColv4);
    vec3 sCol = vec3(sColv4);
    if      (blend == 1)  { fCol = fCol * sCol; }
    else if (blend == 2)  { fCol = (1. - (1. - fCol) * (1. - sCol)); }
    else if (blend == 3)  { fCol = min(fCol, sCol); }
    else if (blend == 4)  { fCol = max(fCol, sCol); }
    else if (blend == 5)  { fCol = abs(fCol - sCol); }
    else if (blend == 6)  { fCol = 1. - abs(1. - fCol - sCol); }
    else if (blend == 7)  { fCol = fCol + sCol - (2. * fCol * sCol); }
    else if (blend == 8)  { fCol = all(lessThanEqual(fCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 9)  { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 10) { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol + fCol * fCol * (1. - 2. * sCol)) : sqrt(fCol) * (2. * sCol - 1.) + (2. * fCol) * (1. - sCol); }
    else if (blend == 11) { fCol = fCol / (1.0 - sCol); }
    else if (blend == 12) { fCol = 1.0 - (1.0 - fCol) / sCol; }
    else if (blend == 13) { fCol = fCol + sCol; }
    else                  { fCol = fCol + sCol; }
    return vec4(fCol, 1.0);
}

// Diagonal chain pattern using distance fields
// Each chain = a diagonal stripe with wavy edges (link bumps)

// Distance to a set of repeating diagonal lines with chain-link bumps
float chainPattern(vec2 uv, float angle, float spacing, float width, float bumpFreq, float bumpAmp, float phase) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 ruv = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);

    // Phase animation along the chain
    ruv.x += phase;

    // Distance to nearest line (repeating in Y perpendicular to chain direction)
    float lineY = mod(ruv.y + spacing * 0.5, spacing) - spacing * 0.5;

    // Chain link bumps: wavy edges that create oval-link appearance
    float bump = sin(ruv.x * bumpFreq) * bumpAmp;
    // Alternate bump phase for each line to simulate interlocking
    float lineIdx = floor((ruv.y + spacing * 0.5) / spacing);
    bump *= (mod(lineIdx, 2.0) == 0.0) ? 1.0 : -1.0;

    float d = abs(lineY + bump) - width;
    return d;
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uv = vFilterCoord * scale;
    float phase = time * 0.15;

    float spacing = linkGap;
    float width = linkWidth;
    float bumpFreq = 6.2831 / (linkWidth * 4.0); // link length
    float bumpAmp = linkWidth * 0.5;

    // Multiple chain sets at varied angles
    float d1 = chainPattern(uv, 0.55, spacing, width, bumpFreq, bumpAmp, phase);
    float d2 = chainPattern(uv, -0.85, spacing * 1.1, width, bumpFreq, bumpAmp, -phase * 0.8);
    float d3 = chainPattern(uv, 0.2, spacing * 0.9, width, bumpFreq, bumpAmp, phase * 0.6);
    float d4 = chainPattern(uv, -0.35, spacing * 1.2, width, bumpFreq, bumpAmp, -phase * 0.5);

    float d = min(min(d1, d2), min(d3, d4));

    // Hollow: show only the outline of each link
    float ring = abs(d) - width * 0.3;

    // Sharp metallic edge + glow
    float core = 1.0 - smoothstep(0.0, 0.01, ring);
    float glow = 0.3 * (1.0 - smoothstep(0.0, 0.04, ring));
    float total = clamp((core + glow) * intensity, 0.0, 1.0);

    vec3 chainCol = mix(color, vec3(1.0), core * 0.4);
    vec4 chainColor = vec4(chainCol * total * opacity, 1.0);

    gl_FragColor = blenderVec3(blend, pixel, chainColor) * pixel.a;
}
`;

export class FilterChains extends PIXI.Filter {
    constructor(params) {
        super(customVertex2D, chainsFragment);

        this.uniforms.color = new Float32Array([1.0, 1.0, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterChains.defaults);

        this._timeSpeed = params?.timeSpeed ?? 0.5;
        this._lastTime = performance.now();

        this.zOrder = 200;
        this.animated = {};
        this.setTMParams(params);
        if (!this.dummy) {
            this.normalizeTMParams();
        }
    }

    apply(filterManager, input, output, clear) {
        const now = performance.now();
        const dt = (now - this._lastTime) / 1000;
        this._lastTime = now;
        this.uniforms.time += dt * this._timeSpeed;

        const filterMatrix = this.uniforms.filterMatrix;

        if (filterMatrix) {
            const { sourceFrame, destinationFrame, target } = filterManager.activeState;

            filterMatrix.set(
                destinationFrame.width, 0, 0, destinationFrame.height,
                sourceFrame.x, sourceFrame.y
            );

            const worldTransform = PIXI.Matrix.TEMP_MATRIX;
            const localBounds = target.getLocalBounds(_tempRect);

            if (this.sticky) {
                worldTransform.copyFrom(target.transform.worldTransform);
                worldTransform.invert();

                const rotation = target.transform.rotation;
                const sin = Math.sin(rotation);
                const cos = Math.cos(rotation);
                const scaleX = Math.hypot(
                    cos * worldTransform.a + sin * worldTransform.c,
                    cos * worldTransform.b + sin * worldTransform.d
                );
                const scaleY = Math.hypot(
                    -sin * worldTransform.a + cos * worldTransform.c,
                    -sin * worldTransform.b + cos * worldTransform.d
                );

                localBounds.pad(scaleX * this.boundsPadding.x, scaleY * this.boundsPadding.y);
            } else {
                const transform = target.transform;
                worldTransform.a = transform.scale.x;
                worldTransform.b = 0;
                worldTransform.c = 0;
                worldTransform.d = transform.scale.y;
                worldTransform.tx = transform.position.x - transform.pivot.x * transform.scale.x;
                worldTransform.ty = transform.position.y - transform.pivot.y * transform.scale.y;
                worldTransform.prepend(target.parent.transform.worldTransform);
                worldTransform.invert();

                const scaleX = Math.hypot(worldTransform.a, worldTransform.b);
                const scaleY = Math.hypot(worldTransform.c, worldTransform.d);

                localBounds.pad(scaleX * this.boundsPadding.x, scaleY * this.boundsPadding.y);
            }

            filterMatrix.prepend(worldTransform);
            filterMatrix.translate(-localBounds.x, -localBounds.y);
            filterMatrix.scale(1.0 / localBounds.width, 1.0 / localBounds.height);

            const filterMatrixInverse = this.uniforms.filterMatrixInverse;
            if (filterMatrixInverse) {
                filterMatrixInverse.copyFrom(filterMatrix);
                filterMatrixInverse.invert();
            }
        }

        filterManager.applyFilter(this, input, output, clear);
    }

    get time() { return this.uniforms.time; }
    set time(value) { this.uniforms.time = value; }

    get color() { return PIXI.utils.rgb2hex(this.uniforms.color); }
    set color(value) { new PIXI.Color(value).toRgbArray(this.uniforms.color); }

    get intensity() { return this.uniforms.intensity; }
    set intensity(value) { this.uniforms.intensity = value; }

    get scale() { return this.uniforms.scale; }
    set scale(value) { this.uniforms.scale = value; }

    get linkWidth() { return this.uniforms.linkWidth; }
    set linkWidth(value) { this.uniforms.linkWidth = value; }

    get linkGap() { return this.uniforms.linkGap; }
    set linkGap(value) { this.uniforms.linkGap = value; }

    get opacity() { return this.uniforms.opacity; }
    set opacity(value) { this.uniforms.opacity = value; }

    get blend() { return this.uniforms.blend; }
    set blend(value) { this.uniforms.blend = Math.floor(value); }
}

FilterChains.defaults = {
    time: 0,
    color: 0x888888,
    intensity: 1.5,
    scale: 8,
    linkWidth: 0.06,
    linkGap: 0.8,
    opacity: 0.8,
    blend: 2,
};

/**
 * Register custom filters into TokenMagic's FilterType at import time.
 */
FilterType.fracture = FilterFracture;
FilterType.chains = FilterChains;
console.log('lancer-automations | Registered custom TMFX filters');
