import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

const sliceTearFragment = `
precision highp float;

uniform float time;
uniform float tickRate;
uniform float burstRate;
uniform float burstChance;
uniform float bands;
uniform float tear;
uniform float tearChance;
uniform float split;
uniform float splitWobble;
uniform float splitSpeed;
uniform float splitSway;
uniform float blockGrid;
uniform float blockChance;
uniform float scan;
uniform vec3 glitchA;
uniform vec3 glitchB;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;
${GLSL_HASH1}
${GLSL_HASH2}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 span = outputFrame.zw * inputSize.zw;

    float tick = mod(floor(time * tickRate), 512.0);
    float burstTick = mod(floor(time * burstRate), 512.0);
    float burst = step(1.0 - burstChance, hash1(vec2(burstTick, 3.3)));
    float amp = mix(0.15, 1.0, burst);

    float band = floor(vFilterCoord.y * bands + hash1(vec2(tick, 1.9)) * 3.0);
    float tearOn = step(1.0 - tearChance * amp, hash1(vec2(band, tick)));
    float offset = (hash1(vec2(band, tick + 17.0)) - 0.5) * 2.0 * tear * tearOn * amp;

    vec2 cell = floor(vFilterCoord * blockGrid);
    float block = step(1.0 - blockChance * amp, hash1(cell + tick * 0.37));
    vec2 jump = (hash2(cell + tick) - 0.5) * 0.5 * block;

    vec2 base = vTextureCoord + (vec2(offset, 0.0) + jump) * span;
    float shift = split * (0.4 + amp) * (1.0 + splitWobble * sin(time * splitSpeed * 6.2831853)) * (0.85 + 0.3 * hash1(vec2(tick, 9.1)));
    vec2 shiftDir = normalize(vec2(1.0, splitSway * sin(time * splitSpeed * 3.7 + 1.3)));
    vec4 red = tapC(base + shiftDir * shift * span);
    vec4 green = tapC(base);
    vec4 blue = tapC(base - shiftDir * shift * span);
    float alpha = max(green.a, max(red.a, blue.a));
    vec4 result = vec4(red.r, green.g, blue.b, alpha);

    float stripe = step(0.5, fract(vFilterCoord.y * 60.0 + tick * 0.5));
    vec3 tint = mix(glitchA, glitchB, step(0.5, hash1(cell + tick + 5.0)));
    result = over(result, tint, clamp(block * alpha * (0.35 + 0.4 * stripe) * opacity, 0.0, 1.0));
    result = over(result, tint, clamp(tearOn * amp * alpha * 0.18 * opacity, 0.0, 1.0));
    result.rgb *= 1.0 - scan * step(0.5, fract(vFilterCoord.y * 140.0)) * amp;

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterSliceTear extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, sliceTearFragment);

        this.uniforms.glitchA = new Float32Array([0.58, 0.13, 0.71]);
        this.uniforms.glitchB = new Float32Array([0.61, 1.0, 0.23]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterSliceTear.defaults);

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

    get tickRate()
    {
        return this.uniforms.tickRate;
    }
    set tickRate(value)
    {
        this.uniforms.tickRate = value;
    }

    get burstRate()
    {
        return this.uniforms.burstRate;
    }
    set burstRate(value)
    {
        this.uniforms.burstRate = value;
    }

    get burstChance()
    {
        return this.uniforms.burstChance;
    }
    set burstChance(value)
    {
        this.uniforms.burstChance = value;
    }

    get bands()
    {
        return this.uniforms.bands;
    }
    set bands(value)
    {
        this.uniforms.bands = value;
    }

    get tear()
    {
        return this.uniforms.tear;
    }
    set tear(value)
    {
        this.uniforms.tear = value;
    }

    get tearChance()
    {
        return this.uniforms.tearChance;
    }
    set tearChance(value)
    {
        this.uniforms.tearChance = value;
    }

    get split()
    {
        return this.uniforms.split;
    }
    set split(value)
    {
        this.uniforms.split = value;
    }

    get splitWobble()
    {
        return this.uniforms.splitWobble;
    }
    set splitWobble(value)
    {
        this.uniforms.splitWobble = value;
    }

    get splitSpeed()
    {
        return this.uniforms.splitSpeed;
    }
    set splitSpeed(value)
    {
        this.uniforms.splitSpeed = value;
    }

    get splitSway()
    {
        return this.uniforms.splitSway;
    }
    set splitSway(value)
    {
        this.uniforms.splitSway = value;
    }

    get blockGrid()
    {
        return this.uniforms.blockGrid;
    }
    set blockGrid(value)
    {
        this.uniforms.blockGrid = value;
    }

    get blockChance()
    {
        return this.uniforms.blockChance;
    }
    set blockChance(value)
    {
        this.uniforms.blockChance = value;
    }

    get scan()
    {
        return this.uniforms.scan;
    }
    set scan(value)
    {
        this.uniforms.scan = value;
    }

    get glitchA()
    {
        return PIXI.utils.rgb2hex(this.uniforms.glitchA);
    }
    set glitchA(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.glitchA);
    }

    get glitchB()
    {
        return PIXI.utils.rgb2hex(this.uniforms.glitchB);
    }
    set glitchB(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.glitchB);
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

FilterSliceTear.defaults = {
    time: 0,
    tickRate: 15,
    burstRate: 1.2,
    burstChance: 0.15,
    bands: 22,
    tear: 0.12,
    tearChance: 0.3,
    split: 0.015,
    splitWobble: 0.3,
    splitSpeed: 0.4,
    splitSway: 0.35,
    blockGrid: 19,
    blockChance: 0.04,
    scan: 0.25,
    glitchA: 0x9422b4,
    glitchB: 0x9bff3a,
    opacity: 1.0,
};
