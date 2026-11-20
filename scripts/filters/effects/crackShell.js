import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE } from '../filter-core.js';

const crackShellFragment = `
precision highp float;

uniform float time;
uniform float reach;
uniform float gap;
uniform float thick;
uniform float cells;
uniform float shellA;
uniform float crackW;
uniform float period;
uniform float breakChance;
uniform float liftMax;
uniform float flicker;
uniform float shimmer;
uniform float glowAmt;
uniform float glowR;
uniform float ink;
uniform vec3 shellColor;
uniform vec3 coreColor;
uniform vec3 inkColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}
${GLSL_VNOISE}

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

float distAlong(vec2 sprite, vec2 dir, float range)
{
    float lo = 0.0;
    float hi = -1.0;
    for (int index = 1; index < 9; index++)
    {
        float probe = range * float(index) / 8.0;
        float hit = tapS(spriteToTex(sprite + dir * probe));
        if (hi < 0.0 && hit > 0.5)
            hi = probe;
        if (hi < 0.0)
            lo = probe;
    }
    if (hi < 0.0)
        return range * 2.0;
    for (int index = 0; index < 3; index++)
    {
        float mid = 0.5 * (lo + hi);
        if (tapS(spriteToTex(sprite + dir * mid)) > 0.5)
            hi = mid;
        else
            lo = mid;
    }
    return 0.5 * (lo + hi);
}

vec3 shellVoro(vec2 point)
{
    vec2 cellBase = floor(point);
    vec2 cellFrac = fract(point);
    vec2 nearestCell = vec2(0.0);
    vec2 nearestRel = vec2(0.0);
    float minDist = 8.0;
    for (int row = -1; row <= 1; row++)
    {
        for (int col = -1; col <= 1; col++)
        {
            vec2 offset = vec2(float(col), float(row));
            vec2 rel = offset + hash2(cellBase + offset) - cellFrac;
            float distSq = dot(rel, rel);
            if (distSq < minDist)
            {
                minDist = distSq;
                nearestRel = rel;
                nearestCell = offset;
            }
        }
    }
    minDist = 8.0;
    for (int row = -2; row <= 2; row++)
    {
        for (int col = -2; col <= 2; col++)
        {
            vec2 offset = nearestCell + vec2(float(col), float(row));
            vec2 rel = offset + hash2(cellBase + offset) - cellFrac;
            vec2 diff = rel - nearestRel;
            if (dot(diff, diff) > 1e-5)
                minDist = min(minDist, dot(0.5 * (nearestRel + rel), normalize(diff)));
        }
    }
    return vec3(minDist, cellBase + nearestCell);
}

float bandAt(float value, float lo, float hi, float soft)
{
    return smoothstep(lo - soft, lo + soft, value) * (1.0 - smoothstep(hi - soft, hi + soft, value));
}

float lineAt(float value, float at, float soft)
{
    return 1.0 - smoothstep(soft * 0.5, soft * 1.5, abs(value - at));
}

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

vec4 under(vec4 top, vec3 rgb, float amount)
{
    return vec4(top.rgb + rgb * amount * (1.0 - top.a), top.a + amount * (1.0 - top.a));
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float px = inputSize.z / texPerSprite().x;
    float outside = 1.0 - smoothstep(0.9, 0.995, pixel.a);
    if (outside <= 0.0)
    {
        gl_FragColor = pixel;
        return;
    }

    vec3 soft = softOutS(vTextureCoord, reach);
    float dist = outside > 0.01 ? distAlong(sprite, soft.yz, reach) : 0.0;
    vec3 voro = shellVoro(sprite * cells);
    float seed = hash1(voro.yz);
    float cycle = time / period + seed;
    float phase = fract(cycle);
    float breaks = step(hash1(voro.yz + floor(cycle) * 7.31), breakChance);
    float lift = breaks * liftMax * pow(smoothstep(0.0, 0.6, phase), 0.6);
    float crumble = vnoise(sprite * 140.0 + seed * 13.0);
    float pieceLive = breaks * step(0.002, phase) * (1.0 - smoothstep(0.35, 0.6, phase)) * step(crumble * smoothstep(0.2, 0.55, phase), 0.45);
    float reform = mix(1.0, smoothstep(0.6, 0.95, phase), breaks);
    float flick = 1.0 - flicker * step(0.74, vnoise(vec2(seed * 37.0, time * 7.0)));

    float lo = gap;
    float hi = gap + thick;
    float baseBand = bandAt(dist, lo, hi, px) * outside;
    float pieceBand = bandAt(dist - lift, lo, hi, px) * outside;
    float crack = 1.0 - smoothstep(crackW * cells * 0.5, crackW * cells * 0.5 + px * cells, voro.x);
    float edgeOut = lineAt(dist, hi - px, px * 1.5);
    float edgeIn = lineAt(dist, lo + px, px);
    float flash = breaks * exp(-phase * 30.0);
    float sweep = pow(0.5 + 0.5 * sin(time * 1.7 - dot(sprite, vec2(7.0, 4.0))), 10.0) * shimmer;

    vec4 result = pixel;
    float glowA = glowAmt * exp(-abs(dist - (lo + hi) * 0.5) / glowR) * outside * reform * flick;
    result = under(result, shellColor, clamp(glowA * 0.4, 0.0, 1.0));
    result = over(result, inkColor, clamp(ink * lineAt(dist, hi + px * 1.5, px) * reform, 0.0, 1.0));
    float baseA = baseBand * reform * flick * (shellA + edgeOut * 0.6 + edgeIn * 0.3 + crack * 0.6 + sweep * 0.35);
    vec3 baseC = mix(shellColor, coreColor, clamp(edgeOut * 0.55 + crack * 0.8 + sweep, 0.0, 1.0));
    result = over(result, baseC, clamp(baseA, 0.0, 1.0));
    result = over(result, coreColor, clamp(baseBand * flash, 0.0, 1.0));
    float pieceEdge = lineAt(dist - lift, hi - px, px * 1.5);
    float pieceA = pieceBand * pieceLive * (shellA + 0.35 + pieceEdge * 0.4 + crack * 0.5);
    vec3 pieceC = mix(coreColor, shellColor, smoothstep(0.0, 0.3, phase) * (1.0 - pieceEdge * 0.4));
    result = over(result, inkColor, clamp(ink * lineAt(dist - lift, hi + px * 1.5, px) * pieceLive * outside, 0.0, 1.0));
    result = over(result, pieceC, clamp(pieceA, 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterCrackShell extends LaCustomFilter
{
    constructor(params)
    {
        super(crackShellFragment, params, {
            shellColor: new Float32Array([0.81, 0.87, 0.94]),
            coreColor: new Float32Array([1.0, 1.0, 1.0]),
            inkColor: new Float32Array([0.05, 0.09, 0.13]),
        });
        this.spriteCoords = true;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get gap()
    {
        return this.uniforms.gap;
    }
    set gap(value)
    {
        this.uniforms.gap = value;
    }

    get thick()
    {
        return this.uniforms.thick;
    }
    set thick(value)
    {
        this.uniforms.thick = value;
    }

    get cells()
    {
        return this.uniforms.cells;
    }
    set cells(value)
    {
        this.uniforms.cells = value;
    }

    get shellA()
    {
        return this.uniforms.shellA;
    }
    set shellA(value)
    {
        this.uniforms.shellA = value;
    }

    get crackW()
    {
        return this.uniforms.crackW;
    }
    set crackW(value)
    {
        this.uniforms.crackW = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get breakChance()
    {
        return this.uniforms.breakChance;
    }
    set breakChance(value)
    {
        this.uniforms.breakChance = value;
    }

    get liftMax()
    {
        return this.uniforms.liftMax;
    }
    set liftMax(value)
    {
        this.uniforms.liftMax = value;
    }

    get flicker()
    {
        return this.uniforms.flicker;
    }
    set flicker(value)
    {
        this.uniforms.flicker = value;
    }

    get shimmer()
    {
        return this.uniforms.shimmer;
    }
    set shimmer(value)
    {
        this.uniforms.shimmer = value;
    }

    get glowAmt()
    {
        return this.uniforms.glowAmt;
    }
    set glowAmt(value)
    {
        this.uniforms.glowAmt = value;
    }

    get glowR()
    {
        return this.uniforms.glowR;
    }
    set glowR(value)
    {
        this.uniforms.glowR = value;
    }

    get ink()
    {
        return this.uniforms.ink;
    }
    set ink(value)
    {
        this.uniforms.ink = value;
    }

    get shellColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.shellColor);
    }
    set shellColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.shellColor);
    }

    get coreColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coreColor);
    }
    set coreColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coreColor);
    }

    get inkColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.inkColor);
    }
    set inkColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.inkColor);
    }
}

FilterCrackShell.defaults = {
    time: 0,
    reach: 0.09,
    gap: 0.007,
    thick: 0.02,
    cells: 14,
    shellA: 0.32,
    crackW: 0.006,
    period: 3.6,
    breakChance: 0.15,
    liftMax: 0.025,
    flicker: 0.5,
    shimmer: 0.8,
    glowAmt: 0.7,
    glowR: 0.014,
    ink: 0.5,
    shellColor: 0xcfdff0,
    coreColor: 0xffffff,
    inkColor: 0x0e1620,
    opacity: 1,
};
