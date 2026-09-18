import { customVertex2D, applyCustomFilter, GLSL_HASH1 } from '../filter-core.js';

// FilterAblativeCrust: angular plates that build and shed just outside the contour, each on its own clock.
// No alpha early-out: the crust lives in the free ring outside the sprite.

const ablativeCrustFragment = `
precision highp float;

uniform float time;
uniform float crustWidth;
uniform float segments;
uniform float shedPeriod;
uniform float shedDrift;
uniform float reverse;
uniform float grainScale;
uniform float lipStrength;
uniform vec3 crustColor;
uniform vec3 coreColor;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
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

    vec2 d = vFilterCoord - 0.5;
    vec2 rad = normalize(d + vec2(1e-5));
    float ang = atan(d.y, d.x);
    float seg = floor((ang + 3.14159) / 6.28318 * segments);

    float ph = fract(time / shedPeriod + hash1(vec2(seg, 7.0)));
    float grow = smoothstep(0.0, 0.3, ph);
    float gone = smoothstep(0.6, 1.0, ph);
    float life = grow * (1.0 - gone);

    // Forward the plate drifts off at the end of its life, reversed it arrives from out there instead.
    float drift = mix(gone, 1.0 - grow, reverse) * shedDrift;
    vec2 uv = vTextureCoord - rad * outputFrame.zw * inputSize.zw * drift;

    float band = clamp(ringMax(uv, crustWidth) - tapA(uv), 0.0, 1.0);
    float grain = step(0.35, hash1(floor(vFilterCoord * grainScale) + floor(time * 2.0)));

    vec4 result = over(pixel, crustColor, clamp(band * life * (0.55 + 0.45 * grain) * opacity, 0.0, 1.0));
    float lip = clamp(pixel.a - ringMin(vTextureCoord, crustWidth * 0.45), 0.0, 1.0);
    result = over(result, coreColor, clamp(lip * lipStrength * opacity, 0.0, 1.0));

    gl_FragColor = result;
}
`;

export class FilterAblativeCrust extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, ablativeCrustFragment);

        this.uniforms.crustColor = new Float32Array([0.79, 0.66, 0.51]);
        this.uniforms.coreColor = new Float32Array([1.0, 0.85, 0.63]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterAblativeCrust.defaults);

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

    get crustWidth()
    {
        return this.uniforms.crustWidth;
    }
    set crustWidth(value)
    {
        this.uniforms.crustWidth = value;
    }

    get segments()
    {
        return this.uniforms.segments;
    }
    set segments(value)
    {
        this.uniforms.segments = value;
    }

    get shedPeriod()
    {
        return this.uniforms.shedPeriod;
    }
    set shedPeriod(value)
    {
        this.uniforms.shedPeriod = value;
    }

    get shedDrift()
    {
        return this.uniforms.shedDrift;
    }
    set shedDrift(value)
    {
        this.uniforms.shedDrift = value;
    }

    get reverse()
    {
        return this.uniforms.reverse;
    }
    set reverse(value)
    {
        this.uniforms.reverse = value;
    }

    get grainScale()
    {
        return this.uniforms.grainScale;
    }
    set grainScale(value)
    {
        this.uniforms.grainScale = value;
    }

    get lipStrength()
    {
        return this.uniforms.lipStrength;
    }
    set lipStrength(value)
    {
        this.uniforms.lipStrength = value;
    }

    get crustColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.crustColor);
    }
    set crustColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.crustColor);
    }

    get coreColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coreColor);
    }
    set coreColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coreColor);
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

FilterAblativeCrust.defaults = {
    time: 0,
    crustColor: 0xc9a882,
    coreColor: 0xffd8a0,
    crustWidth: 0.012,
    segments: 10,
    shedPeriod: 3.2,
    shedDrift: 0.09,
    reverse: 1,
    grainScale: 200,
    lipStrength: 0.0,
    opacity: 0.52,
};
