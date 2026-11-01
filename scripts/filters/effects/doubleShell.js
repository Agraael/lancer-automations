import { LaCustomFilter, GLSL_FILTER_INPUTS } from '../filter-core.js';

// FilterDoubleShell: a second contour ring outside the silhouette, inside a bloom, with a pulsing gap.
// No alpha early-out: the outer shell and the bloom both live outside the sprite.

const doubleShellFragment = `
precision highp float;

uniform float time;
uniform float pulsePeriod;
uniform float gapMin;
uniform float gapMax;
uniform float innerWidth;
uniform float outerWidth;
uniform float bloomWidth;
uniform vec3 innerColor;
uniform vec3 outerColor;
uniform vec3 bloomColor;
uniform float innerStrength;
uniform float outerStrength;
uniform float bloom;
${GLSL_FILTER_INPUTS}

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

    float ph = 0.5 + 0.5 * sin(time * 6.28318 / pulsePeriod);
    float gap = mix(gapMin, gapMax, ph);

    float inner = clamp(pixel.a - ringMin(vTextureCoord, innerWidth), 0.0, 1.0);
    float outer = clamp(ringMax(vTextureCoord, gap + outerWidth) - ringMax(vTextureCoord, gap), 0.0, 1.0);
    float glow = clamp(ringMax(vTextureCoord, gap + bloomWidth) - pixel.a, 0.0, 1.0);

    vec4 result = over(pixel, bloomColor, clamp(glow * bloom * (0.35 + 0.65 * ph) * 0.5 * opacity, 0.0, 1.0));
    result = over(result, innerColor, clamp(inner * innerStrength * opacity, 0.0, 1.0));
    result = over(result, outerColor, clamp(outer * outerStrength * (0.45 + 0.55 * ph) * opacity, 0.0, 1.0));

    gl_FragColor = result;
}
`;

export class FilterDoubleShell extends LaCustomFilter
{
    constructor(params)
    {
        super(doubleShellFragment, params, {
            innerColor: new Float32Array([0.80, 0.95, 1.0]),
            outerColor: new Float32Array([0.29, 0.79, 0.94]),
            bloomColor: new Float32Array([0.18, 0.56, 0.85]),
        });
    }

    get pulsePeriod()
    {
        return this.uniforms.pulsePeriod;
    }
    set pulsePeriod(value)
    {
        this.uniforms.pulsePeriod = value;
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

    get innerWidth()
    {
        return this.uniforms.innerWidth;
    }
    set innerWidth(value)
    {
        this.uniforms.innerWidth = value;
    }

    get outerWidth()
    {
        return this.uniforms.outerWidth;
    }
    set outerWidth(value)
    {
        this.uniforms.outerWidth = value;
    }

    get bloomWidth()
    {
        return this.uniforms.bloomWidth;
    }
    set bloomWidth(value)
    {
        this.uniforms.bloomWidth = value;
    }

    get innerColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.innerColor);
    }
    set innerColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.innerColor);
    }

    get outerColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.outerColor);
    }
    set outerColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.outerColor);
    }

    get bloomColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.bloomColor);
    }
    set bloomColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.bloomColor);
    }

    get innerStrength()
    {
        return this.uniforms.innerStrength;
    }
    set innerStrength(value)
    {
        this.uniforms.innerStrength = value;
    }

    get outerStrength()
    {
        return this.uniforms.outerStrength;
    }
    set outerStrength(value)
    {
        this.uniforms.outerStrength = value;
    }

    get bloom()
    {
        return this.uniforms.bloom;
    }
    set bloom(value)
    {
        this.uniforms.bloom = value;
    }
}

FilterDoubleShell.defaults = {
    time: 0,
    pulsePeriod: 2.0,
    gapMin: 0.018,
    gapMax: 0.01,
    innerWidth: 0.004,
    outerWidth: 0.004,
    bloomWidth: 0.01,
    innerColor: 0xcdf2ff,
    outerColor: 0x49c9f0,
    bloomColor: 0x2f8fd8,
    innerStrength: 0.0,
    outerStrength: 0.6,
    bloom: 0.7,
    opacity: 1.0,
};
