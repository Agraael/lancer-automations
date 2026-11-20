import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

const heatPurgeFragment = `
precision highp float;

uniform float time;
uniform float period;
uniform float strength;
uniform float heat;
uniform float shards;
uniform float spread;
uniform float outline;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}

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

float ringMaxSolid(vec2 uv, float radius)
{
    vec2 span = texPerSprite() * radius;
    float highest = 0.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982 + 0.39;
        highest = max(highest, tapS(uv + vec2(cos(angle), sin(angle)) * span));
    }
    return highest;
}

vec4 under(vec4 top, vec3 rgb, float amount)
{
    return vec4(top.rgb + rgb * amount * (1.0 - top.a), top.a + amount * (1.0 - top.a));
}

vec3 blackbody(float level)
{
    vec3 deep = vec3(0.3, 0.02, 0.0);
    vec3 red = vec3(0.9, 0.1, 0.02);
    vec3 orange = vec3(1.0, 0.5, 0.1);
    vec3 white = vec3(1.0, 0.95, 0.78);
    return level < 0.33 ? mix(deep, red, level * 3.0) : level < 0.66 ? mix(red, orange, (level - 0.33) * 3.0) : mix(orange, white, (level - 0.66) * 3.0);
}

float phaseOf(vec2 cell)
{
    return fract(time / period + hash1(cell) * spread * 0.2);
}

float gapOf(vec2 cell)
{
    float phase = phaseOf(cell);
    return 0.11 * strength * smoothstep(0.6, 0.66, phase) * (1.0 - smoothstep(0.68, 1.0, phase)) * (0.75 + 0.5 * hash1(cell + 3.3));
}

vec2 driftOf(vec2 cell)
{
    return normalize(hash2(cell + 7.7) - 0.5 + 1e-4) * gapOf(cell) * 0.4;
}

vec2 siteAt(vec2 cell)
{
    return cell + 0.5 + (hash2(cell) - 0.5) + driftOf(cell);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float inside = smoothstep(0.9, 0.995, pixel.a);
    vec2 grid = sprite * shards;
    vec2 base = floor(grid);
    vec2 local = fract(grid);

    vec2 site = vec2(0.5);
    vec2 cell = base;
    float best = 8.0;
    for (int row = -1; row <= 1; row++)
    {
        for (int column = -1; column <= 1; column++)
        {
            vec2 around = vec2(float(column), float(row));
            vec2 candidate = siteAt(base + around) - base;
            float dist = dot(candidate - local, candidate - local);
            if (dist < best)
            {
                best = dist;
                site = candidate;
                cell = base + around;
            }
        }
    }

    float edge = 8.0;
    for (int row = -1; row <= 1; row++)
    {
        for (int column = -1; column <= 1; column++)
        {
            vec2 candidate = siteAt(base + vec2(float(column), float(row))) - base;
            vec2 diff = candidate - site;
            float len = length(diff);
            if (len > 0.001)
                edge = min(edge, dot(0.5 * (candidate + site) - local, diff / len));
        }
    }

    float phase = phaseOf(cell);
    float build = smoothstep(0.0, 0.62, phase);
    float burst = smoothstep(0.6, 0.66, phase);
    float settle = smoothstep(0.68, 1.0, phase);
    float flash = burst * exp(-max(phase - 0.62, 0.0) * period / 0.25);
    float level = clamp(heat * mix(0.2 + 0.6 * build, 0.15, settle) + flash * 0.25, 0.0, 1.0);
    float gap = gapOf(cell);
    float inset = gap * 0.5;
    float opening = clamp(gap / max(0.11 * strength, 1e-4), 0.0, 1.0);
    vec4 result;
    if (edge < inset)
    {
        float depth = 1.0 - edge / max(inset, 1e-4);
        result = vec4(blackbody(clamp(level + 0.2 + 0.25 * depth, 0.0, 1.0)) * pixel.a, pixel.a);
    }
    else
    {
        vec2 centre = (base + site) / shards;
        vec2 home = centre - driftOf(cell) / shards;
        vec2 pulled = home + (sprite - centre) / max(1.0 - gap, 1e-3);
        vec4 shard = tapC(spriteToTex(pulled));
        vec3 shardColor = shard.rgb / max(shard.a, 1e-4);
        float shardSolid = smoothstep(0.9, 0.995, shard.a);
        float glow = 0.0;
        if (shardSolid > 0.0)
        {
            float body = (ringMinSolid(vTextureCoord, 0.014) + ringMinSolid(vTextureCoord, 0.035)) * 0.5;
            float rimHeat = (1.0 - body) * outline * level;
            float temp = clamp(max(level * exp(-(edge - inset) / (0.03 * (1.0 + 1.2 * opening))), rimHeat), 0.0, 1.0);
            glow = smoothstep(0.1, 0.5, temp) * shardSolid;
            vec3 color = mix(shardColor * 0.88, clamp(shardColor * 0.25 + blackbody(temp), 0.0, 1.0), glow);
            result = vec4(color * shard.a, shard.a);
        }
        else
            result = vec4(shardColor * 0.88 * shard.a, shard.a);
    }

    float aura = 0.0;
    if (inside < 1.0 && result.a < 1.0)
        aura = (ringMaxSolid(vTextureCoord, 0.012) * 0.6 + ringMaxSolid(vTextureCoord, 0.026) * 0.4) * (1.0 - inside) * (1.0 - result.a);
    result = under(result, blackbody(0.5 + 0.45 * flash), clamp(aura * (opening * 0.55 + flash * 0.6) * heat, 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterHeatPurge extends LaCustomFilter
{
    constructor(params)
    {
        super(heatPurgeFragment, params);
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

    get strength()
    {
        return this.uniforms.strength;
    }
    set strength(value)
    {
        this.uniforms.strength = value;
    }

    get heat()
    {
        return this.uniforms.heat;
    }
    set heat(value)
    {
        this.uniforms.heat = value;
    }

    get shards()
    {
        return this.uniforms.shards;
    }
    set shards(value)
    {
        this.uniforms.shards = value;
    }

    get spread()
    {
        return this.uniforms.spread;
    }
    set spread(value)
    {
        this.uniforms.spread = value;
    }

    get outline()
    {
        return this.uniforms.outline;
    }
    set outline(value)
    {
        this.uniforms.outline = value;
    }
}

FilterHeatPurge.defaults = {
    time: 0,
    period: 4.5,
    strength: 1,
    heat: 1,
    shards: 11,
    spread: 0.3,
    outline: 0.45,
    opacity: 1,
};
