import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1 } from '../filter-core.js';

const chainSetsFragment = `
precision highp float;

uniform float time;
uniform float sets;
uniform float spacing;
uniform float pitch;
uniform float speed;
uniform float lineWidth;
uniform float glowWidth;
uniform float glow;
uniform float intensity;
uniform float halo;
uniform float sway;
uniform float speedVar;
uniform float stutter;
uniform float pullPeriod;
uniform float fade;
uniform vec3 color;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}

float tapS(vec2 uv)
{
    return smoothstep(0.86, 0.96, texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a);
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
}

vec2 rotate(vec2 point, float angle)
{
    float cosA = cos(angle);
    float sinA = sin(angle);
    return vec2(point.x * cosA - point.y * sinA, point.x * sinA + point.y * cosA);
}

vec4 under(vec4 top, vec3 rgb, float amount)
{
    return vec4(top.rgb + rgb * amount * (1.0 - top.a), top.a + amount * (1.0 - top.a));
}

float chainLine(vec2 local, float linkPitch)
{
    float bend = 0.3 * linkPitch;
    float run = 0.34 * linkPitch;
    float faceIndex = floor(local.x / (2.0 * linkPitch) + 0.5) * 2.0;
    vec2 face = vec2(local.x - faceIndex * linkPitch, local.y);
    float ring = abs(length(vec2(max(abs(face.x) - run, 0.0), face.y)) - bend);
    float edgeIndex = floor((local.x - linkPitch) / (2.0 * linkPitch) + 0.5) * 2.0 + 1.0;
    vec2 edge = vec2(local.x - edgeIndex * linkPitch, local.y);
    float bar = length(vec2(max(abs(edge.x) - run - bend, 0.0), edge.y));
    return min(ring, bar);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float px = inputSize.z / texPerSprite().x;
    float solid = smoothstep(0.9, 0.995, pixel.a);

    float lit = 0.0;
    float coreMax = 0.0;
    for (int index = 0; index < 4; index++)
    {
        float fi = float(index);
        if (fi + 0.5 > sets)
            break;
        float angle = index == 0 ? 0.55 : index == 1 ? -0.85 : index == 2 ? 0.2 : -0.35;
        float drift = index == 0 ? 1.0 : index == 1 ? -0.8 : index == 2 ? 0.6 : -0.5;
        vec2 turned = rotate(sprite - 0.5, -angle);
        float centreLane = floor(turned.y / spacing + 0.5);
        for (int neighbour = 0; neighbour < 3; neighbour++)
        {
            float lane = centreLane + float(neighbour) - 1.0;
            float phaseSeed = hash1(vec2(lane, fi));
            float speedSeed = hash1(vec2(lane, fi + 9.0));
            float waveSeed = hash1(vec2(lane, fi + 17.0));
            float vary = 1.0 + (speedSeed - 0.5) * 2.0 * speedVar;
            float beat = time / pullPeriod + waveSeed;
            float pulled = (floor(beat) + smoothstep(0.0, 0.25, fract(beat))) * pullPeriod;
            float travel = mix(time, pulled, stutter) * speed * drift * vary;
            float bendOffset = sway * sin(turned.x * 9.0 + time * 0.9 + waveSeed * 6.2832);
            float lineDist = chainLine(vec2(turned.x + travel + phaseSeed * 4.0 * pitch, turned.y - lane * spacing - bendOffset), pitch);
            float show = mix(1.0, smoothstep(0.3, 0.7, 0.5 + 0.5 * sin(time * 0.7 * (0.6 + speedSeed) + waveSeed * 6.2832)), fade);
            float core = (1.0 - smoothstep(lineWidth - px, lineWidth + px, lineDist)) * show;
            coreMax = max(coreMax, core);
            lit = max(lit, clamp(core + exp(-lineDist / max(glowWidth, 1e-4)) * glow * show * 0.5, 0.0, 1.0));
        }
    }

    vec3 light = clamp(mix(color, vec3(1.0), coreMax * 0.25) * lit * intensity * solid * opacity, 0.0, 1.0);
    vec4 result = vec4(1.0 - (1.0 - pixel.rgb) * (1.0 - light), pixel.a);

    float outer = mix(0.5, 2.0, 0.5 - 0.5 * cos(time * 6.2832 / 3.0)) * halo;
    float cover = 0.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.785398 + 0.2;
        vec2 dir = vec2(cos(angle), sin(angle));
        cover += tapS(vTextureCoord + dir * texPerSprite() * 0.02) + 0.6 * tapS(vTextureCoord + dir * texPerSprite() * 0.045);
    }
    cover /= 12.8;

    gl_FragColor = under(result, color, clamp(cover * outer * 0.55, 0.0, 1.0) * (1.0 - pixel.a));
}
`;

export class FilterChainSets extends LaCustomFilter
{
    constructor(params)
    {
        super(chainSetsFragment, params, {
            color: new Float32Array([0.8, 0.67, 0.4]),
        });
        this.spriteCoords = true;
    }

    get sets()
    {
        return this.uniforms.sets;
    }
    set sets(value)
    {
        this.uniforms.sets = value;
    }

    get spacing()
    {
        return this.uniforms.spacing;
    }
    set spacing(value)
    {
        this.uniforms.spacing = value;
    }

    get pitch()
    {
        return this.uniforms.pitch;
    }
    set pitch(value)
    {
        this.uniforms.pitch = value;
    }

    get speed()
    {
        return this.uniforms.speed;
    }
    set speed(value)
    {
        this.uniforms.speed = value;
    }

    get lineWidth()
    {
        return this.uniforms.lineWidth;
    }
    set lineWidth(value)
    {
        this.uniforms.lineWidth = value;
    }

    get glowWidth()
    {
        return this.uniforms.glowWidth;
    }
    set glowWidth(value)
    {
        this.uniforms.glowWidth = value;
    }

    get glow()
    {
        return this.uniforms.glow;
    }
    set glow(value)
    {
        this.uniforms.glow = value;
    }

    get intensity()
    {
        return this.uniforms.intensity;
    }
    set intensity(value)
    {
        this.uniforms.intensity = value;
    }

    get halo()
    {
        return this.uniforms.halo;
    }
    set halo(value)
    {
        this.uniforms.halo = value;
    }

    get sway()
    {
        return this.uniforms.sway;
    }
    set sway(value)
    {
        this.uniforms.sway = value;
    }

    get speedVar()
    {
        return this.uniforms.speedVar;
    }
    set speedVar(value)
    {
        this.uniforms.speedVar = value;
    }

    get stutter()
    {
        return this.uniforms.stutter;
    }
    set stutter(value)
    {
        this.uniforms.stutter = value;
    }

    get pullPeriod()
    {
        return this.uniforms.pullPeriod;
    }
    set pullPeriod(value)
    {
        this.uniforms.pullPeriod = value;
    }

    get fade()
    {
        return this.uniforms.fade;
    }
    set fade(value)
    {
        this.uniforms.fade = value;
    }

    get color()
    {
        return PIXI.utils.rgb2hex(this.uniforms.color);
    }
    set color(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.color);
    }
}

FilterChainSets.defaults = {
    time: 0,
    sets: 4,
    spacing: 0.34,
    pitch: 0.045,
    speed: 0.06,
    lineWidth: 0.0035,
    glowWidth: 0.012,
    glow: 0.7,
    intensity: 1,
    halo: 1,
    sway: 0,
    speedVar: 0,
    stutter: 0,
    pullPeriod: 1.6,
    fade: 0,
    color: 0xccaa66,
    opacity: 0.85,
};
