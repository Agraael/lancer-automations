import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

// FilterChromaRot: the luma plane stays sharp while the colour decays into mis-registered grey blocks.

// highp, not mediump: the block hash is seeded on a growing time index and degenerates at mediump.
const chromaRotFragment = `
precision highp float;

uniform float time;
uniform vec3 color;
uniform float blocks;
uniform float drift;
uniform float levels;
uniform float strength;
uniform float dropThreshold;
uniform float rotThreshold;
uniform float stepRate;
uniform float lockPeriod;
uniform float lockWidth;
uniform float rollPeriod;
uniform float opacity;
// mediump on purpose: customVertex2D is a mediump shader, and a precision mismatch on a uniform
// shared between stages fails to link.
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}
${GLSL_HASH2}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    float luma = dot(base, vec3(0.299, 0.587, 0.114));

    // Hard steps, never a tween. Wrapped so the hash argument stays small over a long session.
    float tick = mod(floor(time * stepRate), 512.0);

    // A brief snap back to true colour, so the player can re-read the chassis.
    float lock = step(1.0 - lockWidth, fract(time / lockPeriod));

    vec2 uvSpan = outputFrame.zw * inputSize.zw;
    vec2 cell = floor(vFilterCoord * blocks);
    vec2 centre = (cell + 0.5) / blocks;
    vec2 off = (hash2(cell + tick * 31.0) - 0.5) * drift * (1.0 - lock);
    vec2 tc = vTextureCoord + (centre - vFilterCoord + off) * uvSpan;

    bool inside = all(greaterThanEqual(tc, inputClamp.xy)) && all(lessThanEqual(tc, inputClamp.zw));
    vec4 tap = inside ? texture2D(uSampler, tc) : vec4(0.0);
    float blockLuma = dot(tap.rgb / max(tap.a, 1e-4), vec3(0.299, 0.587, 0.114));

    float quant = max(levels, 1.0);

    // Plate level comes from the hash: a near-black chassis has no luma range to drive it with.
    float shade = floor(hash1(cell + tick * 3.1) * quant + 0.5) / quant;
    float mis = clamp(blockLuma * 2.0, 0.0, 1.0);

    // A dropped block carries no data at all: flat and dead, never a smear.
    float dropped = max(step(dropThreshold, hash1(cell + tick * 7.3)), inside ? 0.0 : 1.0);

    float rowSeed = floor(vFilterCoord.y * blocks * 0.5);
    float roll = step(0.88, fract(time / rollPeriod + hash1(vec2(rowSeed, 0.0)))) * (1.0 - lock);

    float plate = clamp(0.18 + 0.70 * shade + 0.35 * mis, 0.0, 1.0) * mix(1.0, 1.45, roll);

    // Luma only modulates, so metal edges stay sharp inside each plate.
    vec3 rotted = color * clamp(plate * (0.50 + 0.80 * luma), 0.0, 1.0);
    rotted = mix(rotted, color * 0.09, dropped);

    // Only some blocks rot. The rest keep the chassis colour, which is what makes the rot legible.
    float rot = step(rotThreshold, hash1(cell + tick * 5.7));

    float amount = clamp(strength * opacity * rot * (1.0 - lock), 0.0, 1.0);
    gl_FragColor = vec4(mix(base, rotted, amount) * pixel.a, pixel.a);
}
`;

export class FilterChromaRot extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, chromaRotFragment);

        this.uniforms.color = new Float32Array([1.0, 1.0, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterChromaRot.defaults);

        // 1.0, so stepRate and the two periods below are in real seconds.
        this._timeSpeed = params?.timeSpeed ?? 1.0;
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

    get blocks()
    {
        return this.uniforms.blocks;
    }
    set blocks(value)
    {
        this.uniforms.blocks = value;
    }

    get drift()
    {
        return this.uniforms.drift;
    }
    set drift(value)
    {
        this.uniforms.drift = value;
    }

    get levels()
    {
        return this.uniforms.levels;
    }
    set levels(value)
    {
        this.uniforms.levels = value;
    }

    get strength()
    {
        return this.uniforms.strength;
    }
    set strength(value)
    {
        this.uniforms.strength = value;
    }

    get dropThreshold()
    {
        return this.uniforms.dropThreshold;
    }
    set dropThreshold(value)
    {
        this.uniforms.dropThreshold = value;
    }

    get rotThreshold()
    {
        return this.uniforms.rotThreshold;
    }
    set rotThreshold(value)
    {
        this.uniforms.rotThreshold = value;
    }

    get stepRate()
    {
        return this.uniforms.stepRate;
    }
    set stepRate(value)
    {
        this.uniforms.stepRate = value;
    }

    get lockPeriod()
    {
        return this.uniforms.lockPeriod;
    }
    set lockPeriod(value)
    {
        this.uniforms.lockPeriod = value;
    }

    get lockWidth()
    {
        return this.uniforms.lockWidth;
    }
    set lockWidth(value)
    {
        this.uniforms.lockWidth = value;
    }

    get rollPeriod()
    {
        return this.uniforms.rollPeriod;
    }
    set rollPeriod(value)
    {
        this.uniforms.rollPeriod = value;
    }

    get opacity()
    {
        return this.uniforms.opacity;
    }
    set opacity(value)
    {
        this.uniforms.opacity = value;
    }
}

FilterChromaRot.defaults = {
    time: 0,
    color: 0xb8bcc2,
    blocks: 22,
    drift: 0.045,
    levels: 5,
    strength: 0.85,
    dropThreshold: 0.86,
    rotThreshold: 0.76,
    stepRate: 6.0,
    lockPeriod: 2.7,
    lockWidth: 0.0,
    rollPeriod: 4.0,
    opacity: 1.0,
};
