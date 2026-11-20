import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE } from '../filter-core.js';

const forgeSeamsFragment = `
precision highp float;

uniform float time;
uniform float blocks;
uniform float jitter;
uniform float gapMin;
uniform float gapMax;
uniform float breathRate;
uniform float chaos;
uniform float periodVar;
uniform float shut;
uniform float restGlow;
uniform float move;
uniform float moveRate;
uniform float heat;
uniform float throb;
uniform float glowW;
uniform float darken;
uniform float rim;
uniform float reach;
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

vec3 blackbody(float level)
{
    vec3 deep = vec3(0.3, 0.02, 0.0);
    vec3 red = vec3(0.9, 0.1, 0.02);
    vec3 orange = vec3(1.0, 0.5, 0.1);
    vec3 white = vec3(1.0, 0.95, 0.78);
    return level < 0.33 ? mix(deep, red, level * 3.0) : level < 0.66 ? mix(red, orange, (level - 0.33) * 3.0) : mix(orange, white, (level - 0.66) * 3.0);
}

vec2 driftAt(vec2 cell)
{
    float seed = hash1(cell + 9.1);
    return (vec2(vnoise(vec2(time * moveRate, seed * 53.0)), vnoise(vec2(time * moveRate + 31.0, seed * 71.0))) - 0.5) * 2.0 * move;
}

vec2 siteAt(vec2 cell)
{
    return cell + 0.5 + (hash2(cell) - 0.5) * jitter + driftAt(cell);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    vec2 grid = sprite * blocks;
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

    float seed = hash1(cell);
    float beat = 0.5 + 0.5 * sin(time * 6.2832 / throb * mix(1.0, 0.6 + 0.8 * hash1(cell + 2.1), periodVar) + seed * mix(1.5, 6.2832, chaos));
    float heatNow = heat * (0.65 + 0.35 * beat);
    float cycle = fract(time * breathRate * mix(1.0, 0.6 + 0.8 * hash1(cell + 5.3), periodVar) / 6.2832 + seed * chaos);
    float rise = sin(3.14159 * clamp(cycle / max(1.0 - shut, 0.02), 0.0, 1.0));
    float gap = mix(gapMin, gapMax, rise * rise);
    float inset = gap * 0.5;

    float rimHeat = 0.0;
    if (rim > 0.001)
    {
        float body = (ringMinSolid(vTextureCoord, reach * 0.2) + ringMinSolid(vTextureCoord, reach * 0.45) + ringMinSolid(vTextureCoord, reach * 0.7) + ringMinSolid(vTextureCoord, reach)) * 0.25;
        rimHeat = (1.0 - body) * rim * heatNow;
    }

    vec4 result;
    if (edge < inset)
    {
        float depth = 1.0 - edge / max(inset, 1e-4);
        float level = clamp(heatNow * (0.85 + 0.3 * depth), 0.0, 1.0);
        result = vec4(blackbody(level) * pixel.a, pixel.a);
    }
    else
    {
        vec2 centre = (base + site) / blocks;
        vec2 home = centre - driftAt(cell) / blocks;
        vec2 pulled = home + (sprite - centre) / max(1.0 - gap, 1e-3);
        vec4 shard = tapC(spriteToTex(pulled));
        vec3 shardColor = shard.rgb / max(shard.a, 1e-4);
        float opening = smoothstep(0.0, 0.35, (gap - gapMin) / max(gapMax - gapMin, 1e-4));
        float level = clamp(max(heatNow * 0.85 * mix(restGlow, 1.0, opening) * exp(-(edge - inset) / glowW), rimHeat), 0.0, 1.0);
        float glow = smoothstep(0.08, 0.5, level) * smoothstep(0.9, 0.995, shard.a);
        vec3 color = mix(shardColor * (1.0 - darken), clamp(shardColor * 0.25 + blackbody(level), 0.0, 1.0), glow);
        result = vec4(color * shard.a, shard.a);
    }

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterForgeSeams extends LaCustomFilter
{
    constructor(params)
    {
        super(forgeSeamsFragment, params);
        this.spriteCoords = true;
    }

    get blocks()
    {
        return this.uniforms.blocks;
    }
    set blocks(value)
    {
        this.uniforms.blocks = value;
    }

    get jitter()
    {
        return this.uniforms.jitter;
    }
    set jitter(value)
    {
        this.uniforms.jitter = value;
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

    get breathRate()
    {
        return this.uniforms.breathRate;
    }
    set breathRate(value)
    {
        this.uniforms.breathRate = value;
    }

    get chaos()
    {
        return this.uniforms.chaos;
    }
    set chaos(value)
    {
        this.uniforms.chaos = value;
    }

    get periodVar()
    {
        return this.uniforms.periodVar;
    }
    set periodVar(value)
    {
        this.uniforms.periodVar = value;
    }

    get shut()
    {
        return this.uniforms.shut;
    }
    set shut(value)
    {
        this.uniforms.shut = value;
    }

    get restGlow()
    {
        return this.uniforms.restGlow;
    }
    set restGlow(value)
    {
        this.uniforms.restGlow = value;
    }

    get move()
    {
        return this.uniforms.move;
    }
    set move(value)
    {
        this.uniforms.move = value;
    }

    get moveRate()
    {
        return this.uniforms.moveRate;
    }
    set moveRate(value)
    {
        this.uniforms.moveRate = value;
    }

    get heat()
    {
        return this.uniforms.heat;
    }
    set heat(value)
    {
        this.uniforms.heat = value;
    }

    get throb()
    {
        return this.uniforms.throb;
    }
    set throb(value)
    {
        this.uniforms.throb = value;
    }

    get glowW()
    {
        return this.uniforms.glowW;
    }
    set glowW(value)
    {
        this.uniforms.glowW = value;
    }

    get darken()
    {
        return this.uniforms.darken;
    }
    set darken(value)
    {
        this.uniforms.darken = value;
    }

    get rim()
    {
        return this.uniforms.rim;
    }
    set rim(value)
    {
        this.uniforms.rim = value;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }
}

FilterForgeSeams.defaults = {
    time: 0,
    blocks: 10,
    jitter: 0.85,
    gapMin: 0,
    gapMax: 0.1,
    breathRate: 1.5,
    chaos: 1,
    periodVar: 0,
    shut: 0.75,
    restGlow: 0,
    move: 0.12,
    moveRate: 0.35,
    heat: 0.9,
    throb: 2,
    glowW: 0.05,
    darken: 0.1,
    rim: 0,
    reach: 0.1,
    opacity: 0.96,
};
