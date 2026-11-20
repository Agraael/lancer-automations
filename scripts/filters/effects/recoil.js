import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1 } from '../filter-core.js';

const recoilFragment = `
precision highp float;

uniform float time;
uniform float period;
uniform float recoil;
uniform float streaks;
uniform float reach;
uniform float flash;
uniform vec3 hitColor;
uniform vec3 coreColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float tapS(vec2 uv)
{
    return smoothstep(0.86, 0.96, tapC(uv).a);
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
}

vec2 spriteToTex(vec2 sprite)
{
    vec2 shifted = sprite - vec2(filterMatrix[2][0], filterMatrix[2][1]);
    float m00 = filterMatrix[0][0];
    float m10 = filterMatrix[1][0];
    float m01 = filterMatrix[0][1];
    float m11 = filterMatrix[1][1];
    float det = m00 * m11 - m10 * m01;
    return vec2(m11 * shifted.x - m10 * shifted.y, -m01 * shifted.x + m00 * shifted.y) / det;
}

vec3 softOutS(vec2 uv, float range)
{
    vec2 tps = texPerSprite();
    float acc = 0.0;
    float wsum = 0.0;
    vec2 grad = vec2(0.0);
    for (int ring = 1; ring < 7; ring++)
    {
        float rad = float(ring) / 6.0;
        float weight = 1.0 - rad * 0.75;
        for (int spoke = 0; spoke < 8; spoke++)
        {
            float angle = float(spoke) * 0.7853982 + float(ring) * 0.39;
            vec2 dir = vec2(cos(angle), sin(angle));
            float sampled = tapS(uv + dir * range * rad * tps);
            acc += sampled * weight;
            grad += dir * sampled * weight;
            wsum += weight;
        }
    }
    float dSoft = 1.0 - clamp(acc / wsum * 2.6, 0.0, 1.0);
    return vec3(dSoft * dSoft, grad / max(length(grad), 1e-4));
}

float ringMinSolid(vec2 uv, float radius)
{
    vec2 span = texPerSprite() * radius;
    float lowest = 1.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982;
        lowest = min(lowest, tapS(uv + vec2(cos(angle), sin(angle)) * span));
    }
    return lowest;
}

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;

    float hitIndex = floor(time / period);
    float since = fract(time / period) * period;
    float angle = hash1(vec2(hitIndex, 4.0)) * 6.2832;
    vec2 dir = vec2(cos(angle), sin(angle));
    float jolt = smoothstep(0.0, 0.03, since) * exp(-since / 0.22);
    vec2 shoved = spriteToTex(sprite - dir * recoil * jolt);

    vec4 art = tapC(shoved);
    float inside = smoothstep(0.9, 0.995, art.a);
    vec3 field = softOutS(shoved, reach);
    float dist = sqrt(field.x);
    vec2 outward = -field.yz;

    float far = smoothstep(0.35, 0.85, dot(outward, dir));
    vec2 across = vec2(-dir.y, dir.x);
    float lane = floor(dot(sprite, across) * 90.0);
    float seed = hash1(vec2(lane, hitIndex));
    float fly = since * (0.5 + seed) * 0.9;
    float along = dist - fly / reach;
    float streak = step(0.55, seed) * smoothstep(0.0, 0.05, along + 0.6) * (1.0 - smoothstep(0.0, 0.08, along)) * (1.0 - smoothstep(0.999, 1.0, dist));
    float life = exp(-since / 0.35) * streaks;
    float near = smoothstep(0.35, 0.85, dot(outward, -dir));
    float rim = clamp(art.a - ringMinSolid(shoved, 0.014), 0.0, 1.0) * inside;

    vec4 result = art;
    result = over(result, hitColor, clamp(rim * (0.35 + near * flash * exp(-since / 0.18) * 2.0), 0.0, 1.0));
    result = over(result, hitColor, clamp(streak * far * life * (1.0 - inside), 0.0, 1.0));
    result = over(result, coreColor, clamp(streak * far * life * (1.0 - inside) * 0.6 * step(0.8, seed), 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterRecoil extends LaCustomFilter
{
    constructor(params)
    {
        super(recoilFragment, params, {
            hitColor: new Float32Array([0.6, 0.27, 0.8]),
            coreColor: new Float32Array([0.91, 0.84, 1.0]),
        });
        this.spriteCoords = true;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get recoil()
    {
        return this.uniforms.recoil;
    }
    set recoil(value)
    {
        this.uniforms.recoil = value;
    }

    get streaks()
    {
        return this.uniforms.streaks;
    }
    set streaks(value)
    {
        this.uniforms.streaks = value;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get flash()
    {
        return this.uniforms.flash;
    }
    set flash(value)
    {
        this.uniforms.flash = value;
    }

    get hitColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hitColor);
    }
    set hitColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hitColor);
    }

    get coreColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coreColor);
    }
    set coreColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coreColor);
    }
}

FilterRecoil.defaults = {
    time: 0,
    period: 2.4,
    recoil: 0.03,
    streaks: 1,
    reach: 0.09,
    flash: 0.8,
    hitColor: 0x9944cc,
    coreColor: 0xe9d6ff,
    opacity: 1,
};
