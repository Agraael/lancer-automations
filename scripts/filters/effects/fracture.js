import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE } from '../filter-core.js';

// FilterFracture: Voronoi F2-F1 glowing cracks with noise distortion.

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

${GLSL_HASH2}
${GLSL_HASH1}
${GLSL_VNOISE}

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

    // Noise mask: randomly hide sections of cracks
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

export class FilterFracture extends PIXI.Filter
{
    constructor(params)
    {
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
        if (!this.dummy)
            this.normalizeTMParams();
    }

    apply(filterManager, input, output, clear)
    {
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    get time()
    {
        return this.uniforms.time;
    }
    set time(value)
    {
        this.uniforms.time = value;
    }

    get color()
    {
        return PIXI.utils.rgb2hex(this.uniforms.color);
    }
    set color(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.color);
    }

    get intensity()
    {
        return this.uniforms.intensity;
    }
    set intensity(value)
    {
        this.uniforms.intensity = value;
    }

    get scale()
    {
        return this.uniforms.scale;
    }
    set scale(value)
    {
        this.uniforms.scale = value;
    }

    get crackWidth()
    {
        return this.uniforms.crackWidth;
    }
    set crackWidth(value)
    {
        this.uniforms.crackWidth = value;
    }

    get opacity()
    {
        return this.uniforms.opacity;
    }
    set opacity(value)
    {
        this.uniforms.opacity = value;
    }

    get warpStrength()
    {
        return this.uniforms.warpStrength;
    }
    set warpStrength(value)
    {
        this.uniforms.warpStrength = value;
    }

    get noiseScale()
    {
        return this.uniforms.noiseScale;
    }
    set noiseScale(value)
    {
        this.uniforms.noiseScale = value;
    }

    get maskAmount()
    {
        return this.uniforms.maskAmount;
    }
    set maskAmount(value)
    {
        this.uniforms.maskAmount = value;
    }

    get blend()
    {
        return this.uniforms.blend;
    }
    set blend(value)
    {
        this.uniforms.blend = Math.floor(value);
    }
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
