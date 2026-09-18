import { customVertex2D, applyCustomFilter } from '../filter-core.js';

// FilterSeamBeat: the open-seams split driven by a falling beat, so the chassis is hammered apart on a clock.
// No alpha early-out: the halo lives outside the sprite.

const seamBeatFragment = `
precision highp float;

uniform float time;
uniform float blocks;
uniform float setPeriod;
uniform float beats;
uniform float gapMin;
uniform float gapMax;
uniform vec3 seamColor;
uniform vec3 seamCore;
uniform vec3 rimColor;
uniform float seamStrength;
uniform float coreStrength;
uniform float rimWidth;
uniform float rimBase;
uniform float rimKick;
uniform float glow;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float tapA(vec2 uv)
{
    return tapC(uv).a;
}

float ringMin(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, tapA(uv + vec2(cos(a), sin(a)) * s));
    }
    return m;
}

float ringMax(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 0.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = max(m, tapA(uv + vec2(cos(a), sin(a)) * s));
    }
    return m;
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    float cyc = fract(time / setPeriod);
    float idx = floor(cyc * beats);
    float beat = exp(-fract(cyc * beats) / 0.14) * (1.0 - idx / beats);

    float gap = mix(gapMin, gapMax, beat);
    vec2 cell = floor(vFilterCoord * blocks);
    vec2 centre = (cell + 0.5) / blocks;
    vec2 pulled = centre + (vFilterCoord - centre) * (1.0 + gap);

    vec4 plate = tapC(vTextureCoord + (pulled - vFilterCoord) * outputFrame.zw * inputSize.zw);
    float seam = clamp(pixel.a - plate.a, 0.0, 1.0);

    vec4 result = plate;
    result = over(result, seamColor, clamp(seam * seamStrength * opacity, 0.0, 1.0));
    result = over(result, seamCore, clamp(seam * seam * coreStrength * (0.25 + 0.75 * beat) * opacity, 0.0, 1.0));

    float rim = clamp(pixel.a - ringMin(vTextureCoord, rimWidth), 0.0, 1.0);
    float halo = clamp(ringMax(vTextureCoord, rimWidth * 3.5) - pixel.a, 0.0, 1.0);
    result = over(result, rimColor, clamp(rim * (rimBase + rimKick * beat) * opacity, 0.0, 1.0));
    result = over(result, rimColor, clamp(halo * glow * beat * opacity, 0.0, 1.0));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterSeamBeat extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, seamBeatFragment);

        this.uniforms.seamColor = new Float32Array([1.0, 0.18, 0.24]);
        this.uniforms.seamCore = new Float32Array([1.0, 0.69, 0.63]);
        this.uniforms.rimColor = new Float32Array([1.0, 0.23, 0.16]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterSeamBeat.defaults);

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

    get blocks()
    {
        return this.uniforms.blocks;
    }
    set blocks(value)
    {
        this.uniforms.blocks = value;
    }

    get setPeriod()
    {
        return this.uniforms.setPeriod;
    }
    set setPeriod(value)
    {
        this.uniforms.setPeriod = value;
    }

    get beats()
    {
        return this.uniforms.beats;
    }
    set beats(value)
    {
        this.uniforms.beats = value;
    }

    get gapMin()
    {
        return this.uniforms.gapMin;
    }
    set gapMin(value)
    {
        this.uniforms.gapMin = value;
    }

    get gapMax()
    {
        return this.uniforms.gapMax;
    }
    set gapMax(value)
    {
        this.uniforms.gapMax = value;
    }

    get seamColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.seamColor);
    }
    set seamColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.seamColor);
    }

    get seamCore()
    {
        return PIXI.utils.rgb2hex(this.uniforms.seamCore);
    }
    set seamCore(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.seamCore);
    }

    get rimColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.rimColor);
    }
    set rimColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.rimColor);
    }

    get seamStrength()
    {
        return this.uniforms.seamStrength;
    }
    set seamStrength(value)
    {
        this.uniforms.seamStrength = value;
    }

    get coreStrength()
    {
        return this.uniforms.coreStrength;
    }
    set coreStrength(value)
    {
        this.uniforms.coreStrength = value;
    }

    get rimWidth()
    {
        return this.uniforms.rimWidth;
    }
    set rimWidth(value)
    {
        this.uniforms.rimWidth = value;
    }

    get rimBase()
    {
        return this.uniforms.rimBase;
    }
    set rimBase(value)
    {
        this.uniforms.rimBase = value;
    }

    get rimKick()
    {
        return this.uniforms.rimKick;
    }
    set rimKick(value)
    {
        this.uniforms.rimKick = value;
    }

    get glow()
    {
        return this.uniforms.glow;
    }
    set glow(value)
    {
        this.uniforms.glow = value;
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

FilterSeamBeat.defaults = {
    time: 0,
    blocks: 9,
    setPeriod: 4.9,
    beats: 2,
    gapMin: 0.0,
    gapMax: 0.3,
    seamColor: 0xff2d3c,
    seamCore: 0xffb0a0,
    rimColor: 0xff3a2a,
    seamStrength: 1.0,
    coreStrength: 0.8,
    rimWidth: 0.016,
    rimBase: 0.15,
    rimKick: 1.1,
    glow: 0.9,
    opacity: 1.0,
};
