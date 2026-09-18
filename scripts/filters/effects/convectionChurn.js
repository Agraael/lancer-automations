import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

// FilterConvectionChurn: domain-warped noise drags the plating upward in circulation cells, so the
// chassis reads as liquid turning over rather than solid metal.

const convectionChurnFragment = `
precision highp float;

uniform float time;
uniform float churnScale;
uniform float rise;
uniform float warpAmp;
uniform float mixAmt;
uniform float rimWidth;
uniform float rimGlow;
uniform vec3 hotColor;
uniform vec3 coolColor;
uniform vec3 rimColor;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}
${GLSL_VNOISE}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float ringMin(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, tapC(uv + vec2(cos(a), sin(a)) * s).a);
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

    if (pixel.a < 0.01) {
        gl_FragColor = pixel;
        return;
    }

    vec2 q = vFilterCoord * churnScale;
    float w1 = vnoise(q + vec2(0.0, -time * rise));
    float w2 = vnoise(q * 1.7 + vec2(w1 * 2.0, -time * rise * 1.6));

    vec4 s = tapC(vTextureCoord + (vec2(w1, w2) - 0.5) * warpAmp * outputFrame.zw * inputSize.zw);
    vec3 c = s.rgb / max(s.a, 1e-4);

    float heat = smoothstep(0.35, 0.85, w2);
    float low = smoothstep(0.2, 1.0, vFilterCoord.y);
    vec3 melt = mix(coolColor, hotColor, clamp(heat + low * 0.5, 0.0, 1.0));
    c = mix(c, melt * (0.5 + 0.9 * dot(c, vec3(0.299, 0.587, 0.114))), mixAmt);

    vec4 result = vec4(c * s.a, s.a);
    float rim = clamp(pixel.a - ringMin(vTextureCoord, rimWidth), 0.0, 1.0);
    result = over(result, rimColor, clamp(rim * rimGlow * (0.55 + 0.45 * heat) * opacity, 0.0, 1.0));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterConvectionChurn extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, convectionChurnFragment);

        this.uniforms.hotColor = new Float32Array([1.0, 0.54, 0.12]);
        this.uniforms.coolColor = new Float32Array([0.29, 0.16, 0.11]);
        this.uniforms.rimColor = new Float32Array([1.0, 0.75, 0.42]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterConvectionChurn.defaults);

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

    get churnScale()
    {
        return this.uniforms.churnScale;
    }
    set churnScale(value)
    {
        this.uniforms.churnScale = value;
    }

    get rise()
    {
        return this.uniforms.rise;
    }
    set rise(value)
    {
        this.uniforms.rise = value;
    }

    get warpAmp()
    {
        return this.uniforms.warpAmp;
    }
    set warpAmp(value)
    {
        this.uniforms.warpAmp = value;
    }

    get mixAmt()
    {
        return this.uniforms.mixAmt;
    }
    set mixAmt(value)
    {
        this.uniforms.mixAmt = value;
    }

    get rimWidth()
    {
        return this.uniforms.rimWidth;
    }
    set rimWidth(value)
    {
        this.uniforms.rimWidth = value;
    }

    get rimGlow()
    {
        return this.uniforms.rimGlow;
    }
    set rimGlow(value)
    {
        this.uniforms.rimGlow = value;
    }

    get hotColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hotColor);
    }
    set hotColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hotColor);
    }

    get coolColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coolColor);
    }
    set coolColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coolColor);
    }

    get rimColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.rimColor);
    }
    set rimColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.rimColor);
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

FilterConvectionChurn.defaults = {
    time: 0,
    hotColor: 0xff8a1e,
    coolColor: 0x4a2a1c,
    rimColor: 0xffc06a,
    churnScale: 4,
    rise: 0.35,
    warpAmp: 0.035,
    mixAmt: 0.38,
    rimWidth: 0.008,
    rimGlow: 0,
    opacity: 1.0,
};
