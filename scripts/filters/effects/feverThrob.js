import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const feverThrobFragment = `
precision highp float;

uniform float time;
uniform float stack;
uniform float veinScale;
uniform float thick;
uniform float period;
uniform vec3 veinColor;
uniform vec3 feverColor;
uniform vec3 hotColor;
uniform vec3 ink;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

float fbm(vec2 p)
{
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++)
    {
        v += amp * vnoise(p);
        p = p * 2.03 + vec2(17.0, 9.0);
        amp *= 0.5;
    }
    return v;
}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

float band(float v, float t, float w)
{
    return smoothstep(t - w, t + w, v);
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
}

float ringMinS(vec2 uv, float r)
{
    vec2 s = texPerSprite() * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, tapA(uv + vec2(cos(a), sin(a)) * s));
    }
    return m;
}

float hitAlong(vec2 uv, vec2 stepVec)
{
    float dist = 1.0;
    for (int i = 0; i < 10; i++)
    {
        float k = float(i) / 9.0;
        dist = min(dist, mix(1.0, k, step(0.55, tapA(uv + stepVec * k))));
    }

    float lo = max(dist - 1.0 / 9.0, 0.0);
    float hi = dist;
    for (int j = 0; j < 3; j++)
    {
        float probe = 0.5 * (lo + hi);
        float hit = step(0.55, tapA(uv + stepVec * probe));
        hi = mix(hi, probe, hit);
        lo = mix(probe, lo, hit);
    }
    return mix(hi, 1.0, step(0.999, dist));
}

float beatEnv(float t, float beatPeriod)
{
    float ph = fract(t / beatPeriod);
    return exp(-ph * 14.0) + 0.7 * exp(-max(ph - 0.16, 0.0) * 14.0) * step(0.16, ph);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 down = vec2(0.0, texPerSprite().y);
    float solid = step(0.55, pixel.a);
    float beat = beatEnv(time, period);
    float grow = min(0.6 + 0.12 * stack, 1.4);

    float spread = 0.05 * grow;
    float zone = solid * clamp((1.0 - ringMinS(vTextureCoord, spread)) * 0.6 + (1.0 - ringMinS(vTextureCoord, spread * 0.5)) * 0.4, 0.0, 1.0);

    vec2 w = vFilterCoord + 0.06 * vec2(fbm(vFilterCoord * 4.0), fbm(vFilterCoord * 4.0 + 7.3));
    float r1 = 1.0 - abs(vnoise(w * veinScale) * 2.0 - 1.0);
    float r2 = 1.0 - abs(vnoise(w * veinScale * 2.3 + 5.1) * 2.0 - 1.0);
    float th = thick * (1.0 + 0.8 * beat);
    float vein = max(band(r1, 1.0 - th, 0.02), band(r2, 1.0 - th * 0.6, 0.02) * 0.8) * zone;
    float inkVein = max(band(r1, 1.0 - th * 2.2, 0.03), band(r2, 1.0 - th * 1.4, 0.03) * 0.8) * zone * (1.0 - vein);
    float hotCore = band(r1, 1.0 - th * 0.35, 0.02) * zone;

    float hi = hitAlong(vTextureCoord, down * 0.16 * grow);
    float roof = 0.0;
    for (int r = 1; r < 9; r++)
        roof = max(roof, step(0.55, tapA(vTextureCoord - down * 0.4 * float(r) / 8.0)));

    vec2 q = vec2(vFilterCoord.x * 9.0, vFilterCoord.y * 3.0 + time * 1.8);
    float n = fbm(q);
    float puffField = mix(-1.0, n * 1.6 - 0.7 - hi * 1.4 + beat * 0.45, (1.0 - solid) * step(hi, 0.999) * (1.0 - roof));
    float puffBody = band(puffField, 0.0, 0.02);
    float puffCore = band(puffField, 0.25, 0.02);
    float puffInk = band(puffField, -0.04, 0.012) * (1.0 - puffBody);

    vec3 veinTint = mix(veinColor, feverColor, clamp(beat * 1.2, 0.0, 1.0));
    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    vec3 flush = mix(base, max(base, feverColor * 0.6), solid * zone * beat * 0.35);

    vec4 result = vec4(flush * pixel.a, pixel.a);
    result = over(result, ink, max(inkVein, puffInk) * 0.85);
    result = over(result, veinTint, vein);
    result = over(result, hotColor, hotCore * (0.4 + 0.6 * beat));
    result = over(result, veinColor, puffBody * 0.9);
    result = over(result, hotColor, puffCore * 0.9);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterFeverThrob extends LaCustomFilter
{
    constructor(params)
    {
        super(feverThrobFragment, params, {
            veinColor: new Float32Array([0.49, 1.0, 0.23]),
            feverColor: new Float32Array([1.0, 0.48, 0.13]),
            hotColor: new Float32Array([1.0, 0.94, 0.54]),
            ink: new Float32Array([0.08, 0.02, 0.16]),
        });
        this.spriteCoords = true;
    }

    get stack()
    {
        return this.uniforms.stack;
    }
    set stack(value)
    {
        this.uniforms.stack = value;
    }

    get veinScale()
    {
        return this.uniforms.veinScale;
    }
    set veinScale(value)
    {
        this.uniforms.veinScale = value;
    }

    get thick()
    {
        return this.uniforms.thick;
    }
    set thick(value)
    {
        this.uniforms.thick = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get veinColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.veinColor);
    }
    set veinColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.veinColor);
    }

    get feverColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.feverColor);
    }
    set feverColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.feverColor);
    }

    get hotColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hotColor);
    }
    set hotColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hotColor);
    }

    get ink()
    {
        return PIXI.utils.rgb2hex(this.uniforms.ink);
    }
    set ink(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.ink);
    }
}

FilterFeverThrob.defaults = {
    time: 0,
    stack: 2,
    veinScale: 17,
    thick: 0.18,
    period: 3.05,
    veinColor: 0x7cff3a,
    feverColor: 0xff7a22,
    hotColor: 0xfff08a,
    ink: 0x14062a,
    opacity: 1.0,
};
