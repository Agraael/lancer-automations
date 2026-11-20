import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

const chromaRotPlusFragment = `
precision highp float;

uniform float time;
uniform float blocks;
uniform float drift;
uniform float levels;
uniform float strength;
uniform float dropThreshold;
uniform float edgeRot;
uniform float coreRot;
uniform float depth;
uniform float flakes;
uniform float shed;
uniform float stepRate;
uniform vec3 rotColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float tapS(vec2 uv)
{
    return smoothstep(0.86, 0.96, tapA(uv));
}

float luma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

float solidA(float alpha)
{
    return smoothstep(0.9, 0.995, alpha);
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

float softOutS(vec2 uv, float range)
{
    vec2 tps = texPerSprite();
    float acc = 0.0;
    float wsum = 0.0;
    for (int ring = 1; ring < 7; ring++)
    {
        float rad = float(ring) / 6.0;
        float weight = 1.0 - rad * 0.75;
        for (int spoke = 0; spoke < 8; spoke++)
        {
            float angle = float(spoke) * 0.7853982 + float(ring) * 0.39;
            acc += tapS(uv + vec2(cos(angle), sin(angle)) * range * rad * tps) * weight;
            wsum += weight;
        }
    }
    float dSoft = 1.0 - clamp(acc / wsum * 2.6, 0.0, 1.0);
    return dSoft * dSoft;
}

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float tick = mod(floor(time * stepRate), 512.0);
    float solid = solidA(pixel.a);

    vec2 cell = floor(sprite * blocks);
    vec2 centre = (cell + 0.5) / blocks;
    vec2 offset = (hash2(cell + tick * 31.0) - 0.5) * drift;
    vec4 tap = tapC(spriteToTex(centre + offset));
    float shade = floor(hash1(cell + tick * 3.1) * levels + 0.5) / levels;
    float mis = clamp(luma(tap.rgb / max(tap.a, 1e-4)) * 2.0, 0.0, 1.0);
    float plate = clamp(0.18 + 0.7 * shade + 0.35 * mis, 0.0, 1.0);
    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    vec3 rotted = rotColor * clamp(plate * (0.5 + 0.8 * luma(base)), 0.0, 1.0);
    rotted = mix(rotted, rotColor * 0.09, step(dropThreshold, hash1(cell + tick * 7.3)));
    float nearEdge = 1.0 - step(0.5, ringMinSolid(spriteToTex(centre), depth));
    float rot = step(1.0 - mix(coreRot, edgeRot, nearEdge), hash1(cell + tick * 5.7));
    vec4 result = vec4(mix(base, rotted, strength * rot * solid) * pixel.a, pixel.a);

    float band = (1.0 - smoothstep(0.0, 0.85, sqrt(softOutS(vTextureCoord, shed)))) * (1.0 - solid);
    vec2 flakeCell = floor(sprite * blocks * 1.4);
    vec2 flakePos = fract(sprite * blocks * 1.4);
    float alive = step(1.0 - flakes, hash1(flakeCell + tick * 2.3));
    float inFlake = step(abs(flakePos.x - 0.5), 0.3) * step(abs(flakePos.y - 0.5), 0.3);
    float flakeShade = 0.3 + 0.55 * floor(hash1(flakeCell + tick * 1.7) * levels + 0.5) / levels;
    result = over(result, rotColor * flakeShade, inFlake * alive * band);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterChromaRotPlus extends LaCustomFilter
{
    constructor(params)
    {
        super(chromaRotPlusFragment, params, {
            rotColor: new Float32Array([0.72, 0.74, 0.76]),
        });
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

    get drift()
    {
        return this.uniforms.drift;
    }
    set drift(value)
    {
        this.uniforms.drift = value;
    }

    get levels()
    {
        return this.uniforms.levels;
    }
    set levels(value)
    {
        this.uniforms.levels = value;
    }

    get strength()
    {
        return this.uniforms.strength;
    }
    set strength(value)
    {
        this.uniforms.strength = value;
    }

    get dropThreshold()
    {
        return this.uniforms.dropThreshold;
    }
    set dropThreshold(value)
    {
        this.uniforms.dropThreshold = value;
    }

    get edgeRot()
    {
        return this.uniforms.edgeRot;
    }
    set edgeRot(value)
    {
        this.uniforms.edgeRot = value;
    }

    get coreRot()
    {
        return this.uniforms.coreRot;
    }
    set coreRot(value)
    {
        this.uniforms.coreRot = value;
    }

    get depth()
    {
        return this.uniforms.depth;
    }
    set depth(value)
    {
        this.uniforms.depth = value;
    }

    get flakes()
    {
        return this.uniforms.flakes;
    }
    set flakes(value)
    {
        this.uniforms.flakes = value;
    }

    get shed()
    {
        return this.uniforms.shed;
    }
    set shed(value)
    {
        this.uniforms.shed = value;
    }

    get stepRate()
    {
        return this.uniforms.stepRate;
    }
    set stepRate(value)
    {
        this.uniforms.stepRate = value;
    }

    get rotColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.rotColor);
    }
    set rotColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.rotColor);
    }
}

FilterChromaRotPlus.defaults = {
    time: 0,
    blocks: 28,
    drift: 0.08,
    levels: 4,
    strength: 0.92,
    dropThreshold: 0.5,
    edgeRot: 0.6,
    coreRot: 0.08,
    depth: 0.1,
    flakes: 0.3,
    shed: 0.08,
    stepRate: 3,
    rotColor: 0xb8bcc2,
    opacity: 0.9,
};
