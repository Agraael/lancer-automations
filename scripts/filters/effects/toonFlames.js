import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const toonFlamesFragment = `
precision highp float;

uniform float time;
uniform float stack;
uniform float reach;
uniform float thickness;
uniform float scale;
uniform float speed;
uniform float sway;
uniform float fall;
uniform float baseCut;
uniform float gapLo;
uniform float gapSoft;
uniform float hullLick;
uniform float inkWidth;
uniform float light;
uniform float lightReach;
uniform vec3 deep;
uniform vec3 mid;
uniform vec3 core;
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

vec4 softOut(vec2 uv, float range)
{
    vec2 tps = texPerSprite();
    float acc = 0.0;
    float wsum = 0.0;
    vec2 grad = vec2(0.0);
    for (int rr = 1; rr < 7; rr++)
    {
        float rad = float(rr) / 6.0;
        float w = 1.0 - rad * 0.75;
        for (int a = 0; a < 8; a++)
        {
            float ang = float(a) * 0.7853982 + float(rr) * 0.39;
            vec2 dir = vec2(cos(ang), sin(ang));
            float sampled = tapA(uv + dir * range * rad * tps);
            acc += sampled * w;
            grad += dir * sampled * w;
            wsum += w;
        }
    }

    float dSoft = 1.0 - clamp(acc / wsum * 2.6, 0.0, 1.0);
    return vec4(dSoft * dSoft, grad / max(length(grad), 1e-4), length(grad) / max(acc, 1e-4));
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    float solid = step(0.55, pixel.a);
    float grow = min(0.6 + 0.12 * stack, 1.4);
    float thick = max(thickness, 0.05);

    vec4 outHit = softOut(vTextureCoord, reach * grow * thick);
    float d = outHit.x;
    float found = step(d, 0.999);

    vec2 q = vec2(vFilterCoord.x * scale * 1.6 / thick + sway * sin(vFilterCoord.y * 9.0 / thick + time * 2.3), vFilterCoord.y * scale * 0.5 / thick + time * speed * (0.8 + 0.08 * stack));
    float n = fbm(q);
    float fallEff = fall * (1.3 - 0.55 * outHit.z);
    float open = smoothstep(gapLo, gapLo + gapSoft, outHit.w);
    float field = mix(-1.0, n * 1.7 - 0.38 - baseCut * (1.0 - d) - d * fallEff, (1.0 - solid) * found * open);
    float rimBand = solid * (1.0 - step(0.5, ringMinS(vTextureCoord, 0.025 * thick)));
    field = max(field, mix(-1.0, n * 1.5 - 1.0 + hullLick * 0.6, rimBand));

    float r1 = band(field, 0.0, 0.02);
    float r2 = band(field, 0.2, 0.02);
    float r3 = band(field, 0.48, 0.02);
    float inkLine = band(field, -inkWidth, 0.012) * (1.0 - r1);

    float flick = 0.7 + 0.3 * vnoise(vec2(vFilterCoord.x * 6.0 + vFilterCoord.y * 3.0, time * 5.0));
    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    float luma = dot(base, vec3(0.299, 0.587, 0.114));
    float glow = clamp(solid * (1.0 - ringMinS(vTextureCoord, lightReach * thick)) * light * (0.6 + 0.12 * stack) * flick, 0.0, 1.0);
    vec3 lit = mix(base, max(base, mid * (0.35 + 0.65 * luma * 3.0)), glow * 0.75);

    vec4 result = vec4(mix(base, min(lit, vec3(1.0)), solid) * pixel.a, pixel.a);
    result = over(result, ink, inkLine * 0.9);
    result = over(result, deep, r1);
    result = over(result, mid, r2);
    result = over(result, core, r3);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterToonFlames extends LaCustomFilter
{
    constructor(params)
    {
        super(toonFlamesFragment, params, {
            deep: new Float32Array([0.70, 0.13, 0.04]),
            mid: new Float32Array([1.0, 0.35, 0.08]),
            core: new Float32Array([1.0, 0.83, 0.30]),
            ink: new Float32Array([0.11, 0.04, 0.02]),
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

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get thickness()
    {
        return this.uniforms.thickness;
    }
    set thickness(value)
    {
        this.uniforms.thickness = value;
    }

    get scale()
    {
        return this.uniforms.scale;
    }
    set scale(value)
    {
        this.uniforms.scale = value;
    }

    get speed()
    {
        return this.uniforms.speed;
    }
    set speed(value)
    {
        this.uniforms.speed = value;
    }

    get sway()
    {
        return this.uniforms.sway;
    }
    set sway(value)
    {
        this.uniforms.sway = value;
    }

    get fall()
    {
        return this.uniforms.fall;
    }
    set fall(value)
    {
        this.uniforms.fall = value;
    }

    get baseCut()
    {
        return this.uniforms.baseCut;
    }
    set baseCut(value)
    {
        this.uniforms.baseCut = value;
    }

    get gapLo()
    {
        return this.uniforms.gapLo;
    }
    set gapLo(value)
    {
        this.uniforms.gapLo = value;
    }

    get gapSoft()
    {
        return this.uniforms.gapSoft;
    }
    set gapSoft(value)
    {
        this.uniforms.gapSoft = value;
    }

    get hullLick()
    {
        return this.uniforms.hullLick;
    }
    set hullLick(value)
    {
        this.uniforms.hullLick = value;
    }

    get inkWidth()
    {
        return this.uniforms.inkWidth;
    }
    set inkWidth(value)
    {
        this.uniforms.inkWidth = value;
    }

    get light()
    {
        return this.uniforms.light;
    }
    set light(value)
    {
        this.uniforms.light = value;
    }

    get lightReach()
    {
        return this.uniforms.lightReach;
    }
    set lightReach(value)
    {
        this.uniforms.lightReach = value;
    }

    get deep()
    {
        return PIXI.utils.rgb2hex(this.uniforms.deep);
    }
    set deep(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.deep);
    }

    get mid()
    {
        return PIXI.utils.rgb2hex(this.uniforms.mid);
    }
    set mid(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.mid);
    }

    get core()
    {
        return PIXI.utils.rgb2hex(this.uniforms.core);
    }
    set core(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.core);
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

FilterToonFlames.defaults = {
    time: 0,
    stack: 7,
    reach: 0.0,
    thickness: 1,
    scale: 14,
    speed: 1.5,
    sway: 0.2,
    fall: 1.0,
    baseCut: 0.55,
    gapLo: 0.15,
    gapSoft: 0.2,
    hullLick: 0.15,
    inkWidth: 0,
    light: 0.4,
    lightReach: 0.015,
    deep: 0xb3200a,
    mid: 0xff5a14,
    core: 0xffd34d,
    ink: 0x1c0904,
    opacity: 0.5,
};
