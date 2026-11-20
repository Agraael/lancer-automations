import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE, applyCustomFilter, fillEdgeTrail } from '../filter-core.js';

const cutTorchFragment = `
precision highp float;

uniform float time;
uniform float heads;
uniform float samples;
uniform float speed;
uniform float spacing;
uniform float jump;
uniform float cutW;
uniform float cutReach;
uniform float headR;
uniform float glowR;
uniform float glowAmt;
uniform float lineW;
uniform float edgeLo;
uniform float edgeHi;
uniform float seamR;
uniform float seamAmt;
uniform float scorchAmt;
uniform float light;
uniform float lightR;
uniform float sparks;
uniform float sparkLife;
uniform float sparkSpeed;
uniform float spread;
uniform float gravity;
uniform float streak;
uniform float sparkW;
uniform float dropGap;
uniform float dropLife;
uniform float dropKick;
uniform float dropR;
uniform float dropChance;
uniform float flareR;
uniform vec3 deep;
uniform vec3 mid;
uniform vec3 core;
uniform vec4 anchors[48];
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float tapS(vec2 uv)
{
    return smoothstep(0.86, 0.96, tapC(uv).a);
}

float luma(vec3 color)
{
    return dot(color, vec3(0.299, 0.587, 0.114));
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
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

float sdSeg(vec2 point, vec2 from, vec2 to)
{
    vec2 toPoint = point - from;
    vec2 span = to - from;
    float along = clamp(dot(toPoint, span) / dot(span, span), 0.0, 1.0);
    return length(toPoint - span * along);
}

vec2 rot2(vec2 vector, float angle)
{
    float cosA = cos(angle);
    float sinA = sin(angle);
    return vec2(vector.x * cosA - vector.y * sinA, vector.x * sinA + vector.y * cosA);
}

float star4(vec2 point, float radius)
{
    vec2 folded = abs(point) / radius;
    float sum = sqrt(folded.x + 1e-6) + sqrt(folded.y + 1e-6);
    return (sum * sum - 1.0) * radius * 0.5;
}

float toonBand(float value, float threshold, float soft)
{
    return smoothstep(threshold - soft, threshold + soft, value);
}

vec3 torchHeat(float heat)
{
    return mix(mix(deep, mid, smoothstep(0.0, 0.5, heat)), core, smoothstep(0.7, 1.0, heat));
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
    float inside = smoothstep(0.9, 0.995, pixel.a);
    float rimMask = inside * (1.0 - ringMinSolid(vTextureCoord, cutW));

    vec2 texel = inputSize.zw * lineW;
    float l00 = luma(tapC(vTextureCoord + vec2(-texel.x, -texel.y)).rgb);
    float l10 = luma(tapC(vTextureCoord + vec2(0.0, -texel.y)).rgb);
    float l20 = luma(tapC(vTextureCoord + vec2(texel.x, -texel.y)).rgb);
    float l01 = luma(tapC(vTextureCoord + vec2(-texel.x, 0.0)).rgb);
    float l21 = luma(tapC(vTextureCoord + vec2(texel.x, 0.0)).rgb);
    float l02 = luma(tapC(vTextureCoord + vec2(-texel.x, texel.y)).rgb);
    float l12 = luma(tapC(vTextureCoord + vec2(0.0, texel.y)).rgb);
    float l22 = luma(tapC(vTextureCoord + vec2(texel.x, texel.y)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = smoothstep(edgeLo, edgeHi, length(vec2(gx, gy))) * inside;

    float best = 9.0;
    float bestAge = 1.0;
    float headD = 9.0;
    float headSeed = 0.0;
    vec2 headP = vec2(-9.0);
    vec3 sparkC = vec3(0.0);
    float sparkA = 0.0;
    float haloA = 0.0;
    vec3 dropC = vec3(0.0);
    float dropA = 0.0;
    float dropGlow = 0.0;
    vec2 prev = vec2(-9.0);
    float sparkReach = sparkSpeed * sparkLife * 1.4 + 0.5 * gravity * sparkLife * sparkLife * 1.96 + 0.02;
    float lagStep = spacing / max(speed, 1e-3);
    float dropF = fract(time / dropGap);
    float dropBase = floor(time / dropGap);

    for (int index = 0; index < 48; index++)
    {
        float slot = float(index);
        if (slot + 0.5 > heads * samples)
            break;
        vec4 anchor = anchors[index];
        float sampleK = mod(slot, samples);
        float headId = floor(slot / max(samples, 1.0));
        if (sampleK < 0.5)
            prev = vec2(-9.0);
        if (anchor.x < -8.0)
        {
            prev = vec2(-9.0);
            continue;
        }
        if (sampleK < 0.5)
        {
            float hd = length(sprite - anchor.xy);
            if (hd < headD)
            {
                headD = hd;
                headSeed = slot;
                headP = anchor.xy;
            }
            if (hd < sparkReach)
            {
                for (int spark = 0; spark < 12; spark++)
                {
                    float sparkF = float(spark);
                    if (sparkF + 0.5 > sparks)
                        break;
                    float h1 = hash1(vec2(slot * 17.0 + sparkF, 5.0));
                    float h2 = hash1(vec2(slot * 17.0 + sparkF, 9.0));
                    float h3 = hash1(vec2(slot * 17.0 + sparkF, 21.0));
                    float life = sparkLife * (0.6 + 0.8 * h1);
                    float age = mod(time + h2 * life * 3.0, life);
                    vec2 dir = rot2(anchor.zw, (h3 - 0.5) * spread);
                    float spd = sparkSpeed * (0.55 + 0.9 * h2);
                    vec2 head = anchor.xy + dir * spd * age + vec2(0.0, 0.5 * gravity * age * age);
                    float tailAge = max(age - streak, 0.0);
                    vec2 tail = anchor.xy + dir * spd * tailAge + vec2(0.0, 0.5 * gravity * tailAge * tailAge);
                    float dist = sdSeg(sprite, tail, head);
                    float fade = 1.0 - age / life;
                    float width = max(sparkW * (0.45 + 0.55 * fade), px * 0.75);
                    float alpha = (1.0 - smoothstep(width - px, width + px, dist)) * clamp(fade * 1.6, 0.0, 1.0);
                    haloA = max(haloA, exp(-dist / (width * 3.0)) * fade * 0.7);
                    if (alpha > sparkA)
                    {
                        sparkA = alpha;
                        sparkC = mix(mid, core, smoothstep(0.3, 0.85, fade));
                    }
                }
            }
        }
        if (prev.x > -8.0 && length(anchor.xy - prev) < jump)
        {
            vec2 toPoint = sprite - prev;
            vec2 span = anchor.xy - prev;
            float along = clamp(dot(toPoint, span) / max(dot(span, span), 1e-8), 0.0, 1.0);
            float segDist = length(toPoint - span * along);
            if (segDist < best)
            {
                best = segDist;
                bestAge = (sampleK - 1.0 + along) / max(samples - 1.0, 1.0);
            }
            float lagA = (sampleK - 1.0) * lagStep;
            float lagB = sampleK * lagStep;
            if (lagA < dropLife)
            {
                float firstDrop = ceil(lagA / dropGap - dropF);
                for (int drop = 0; drop < 8; drop++)
                {
                    float dropIndex = firstDrop + float(drop);
                    float lag = (dropIndex + dropF) * dropGap;
                    if (lag >= lagB || lag > dropLife)
                        break;
                    if (lag < 0.0)
                        continue;
                    float dropSeed = hash1(vec2(dropBase - dropIndex, headId * 7.0 + 3.0));
                    if (dropSeed > dropChance)
                        continue;
                    vec2 origin = mix(prev, anchor.xy, (lag - lagA) / max(lagStep, 1e-4));
                    vec2 pos = origin + anchor.zw * dropKick * lag + vec2(0.0, 0.5 * gravity * lag * lag);
                    float fade = 1.0 - lag / dropLife;
                    float radius = dropR * (0.6 + 0.4 * fade) * (0.7 + 0.6 * hash1(vec2(dropBase - dropIndex, headId + 11.0)));
                    vec2 off = sprite - pos;
                    off.y /= 1.0 + gravity * lag * 0.9;
                    float dist = length(off) - radius;
                    float alpha = (1.0 - smoothstep(-px, px, dist)) * clamp(fade * 1.4, 0.0, 1.0);
                    dropGlow = max(dropGlow, exp(-max(dist, 0.0) / (radius * 2.2)) * fade * 0.8);
                    if (alpha > dropA)
                    {
                        dropA = alpha;
                        dropC = mix(deep, mix(mid, core, smoothstep(0.7, 1.0, fade)), smoothstep(0.0, 0.45, fade));
                    }
                }
            }
        }
        prev = anchor.xy;
    }

    float heat = 1.0 - bestAge;
    float near = 1.0 - smoothstep(cutReach - px, cutReach + px, best);
    float cut = rimMask * near * smoothstep(0.0, 0.12, heat);
    float flickerN = 0.8 + 0.2 * vnoise(vec2(time * 30.0, headSeed));
    float reachS = exp(-best / max(seamR, 1e-4));
    float seamHeat = edge * reachS * pow(max(heat, 0.0), 0.8) * seamAmt;
    float scorch = edge * (1.0 - smoothstep(seamR * 0.5, seamR * 2.5, best)) * (1.0 - smoothstep(0.2, 0.7, heat)) * scorchAmt;
    float headLight = exp(-headD / max(lightR, 1e-4)) * light * flickerN;
    float trailLight = exp(-best / max(lightR * 0.5, 1e-4)) * heat * heat * light * 0.5;

    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    float lum = luma(base);
    vec3 lit = base * (1.0 - 0.55 * scorch);
    lit = mix(lit, max(lit, mid * (0.35 + 0.65 * lum * 3.0)), clamp((headLight + trailLight) * 0.8, 0.0, 1.0));
    lit = mix(lit, max(lit, core * (0.5 + 0.5 * lum * 2.0)), clamp(headLight * 0.45, 0.0, 1.0));
    vec4 result = vec4(mix(base, min(lit, vec3(1.0)), inside) * pixel.a, pixel.a);
    result = over(result, deep, toonBand(seamHeat, 0.18, 0.04));
    result = over(result, mid, toonBand(seamHeat, 0.42, 0.04));
    result = over(result, core, toonBand(seamHeat, 0.78, 0.04));
    float glowA = glowAmt * exp(-best / glowR) * heat * heat;
    result = under(result, mid, clamp(glowA * 0.7 + haloA * 0.7 + dropGlow * 0.6 + headLight * 0.35, 0.0, 1.0));
    result = over(result, torchHeat(heat), clamp(cut * (0.5 + 0.5 * heat), 0.0, 1.0));
    result = over(result, dropC, clamp(dropA, 0.0, 1.0));
    float headCore = 1.0 - smoothstep(headR - px, headR + px, headD);
    float headHalo = exp(-headD / (headR * 3.0)) * flickerN;
    result = under(result, mid, clamp(headHalo * 0.8, 0.0, 1.0));
    result = over(result, core, clamp(headHalo * 0.7 + headCore, 0.0, 1.0));
    result = over(result, sparkC, clamp(sparkA, 0.0, 1.0));
    float star = star4(rot2(sprite - headP, time * 1.2 + headSeed), max(flareR * flickerN, 1e-4));
    float flare = (1.0 - smoothstep(-px, px, star)) + exp(-max(star, 0.0) / max(flareR * 0.25, 1e-4)) * 0.35 * flickerN;
    result = over(result, core, clamp(flare, 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterCutTorch extends LaCustomFilter
{
    constructor(params)
    {
        super(cutTorchFragment, params, {
            deep: new Float32Array([0.23, 0.3, 0.36]),
            mid: new Float32Array([0.19, 0.6, 0.81]),
            core: new Float32Array([1.0, 1.0, 1.0]),
            anchors: new Float32Array(192).fill(-9),
        });
        this.spriteCoords = true;
    }

    apply(filterManager, input, output, clear)
    {
        fillEdgeTrail(this.uniforms.anchors, filterManager.activeState.target, this.uniforms.heads ?? 1, this.uniforms.samples ?? 1, this.uniforms.time, this.uniforms.speed ?? 0, this.uniforms.spacing ?? 0.01);
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    get heads()
    {
        return this.uniforms.heads;
    }
    set heads(value)
    {
        this.uniforms.heads = value;
    }

    get samples()
    {
        return this.uniforms.samples;
    }
    set samples(value)
    {
        this.uniforms.samples = value;
    }

    get speed()
    {
        return this.uniforms.speed;
    }
    set speed(value)
    {
        this.uniforms.speed = value;
    }

    get spacing()
    {
        return this.uniforms.spacing;
    }
    set spacing(value)
    {
        this.uniforms.spacing = value;
    }

    get jump()
    {
        return this.uniforms.jump;
    }
    set jump(value)
    {
        this.uniforms.jump = value;
    }

    get cutW()
    {
        return this.uniforms.cutW;
    }
    set cutW(value)
    {
        this.uniforms.cutW = value;
    }

    get cutReach()
    {
        return this.uniforms.cutReach;
    }
    set cutReach(value)
    {
        this.uniforms.cutReach = value;
    }

    get headR()
    {
        return this.uniforms.headR;
    }
    set headR(value)
    {
        this.uniforms.headR = value;
    }

    get glowR()
    {
        return this.uniforms.glowR;
    }
    set glowR(value)
    {
        this.uniforms.glowR = value;
    }

    get glowAmt()
    {
        return this.uniforms.glowAmt;
    }
    set glowAmt(value)
    {
        this.uniforms.glowAmt = value;
    }

    get lineW()
    {
        return this.uniforms.lineW;
    }
    set lineW(value)
    {
        this.uniforms.lineW = value;
    }

    get edgeLo()
    {
        return this.uniforms.edgeLo;
    }
    set edgeLo(value)
    {
        this.uniforms.edgeLo = value;
    }

    get edgeHi()
    {
        return this.uniforms.edgeHi;
    }
    set edgeHi(value)
    {
        this.uniforms.edgeHi = value;
    }

    get seamR()
    {
        return this.uniforms.seamR;
    }
    set seamR(value)
    {
        this.uniforms.seamR = value;
    }

    get seamAmt()
    {
        return this.uniforms.seamAmt;
    }
    set seamAmt(value)
    {
        this.uniforms.seamAmt = value;
    }

    get scorchAmt()
    {
        return this.uniforms.scorchAmt;
    }
    set scorchAmt(value)
    {
        this.uniforms.scorchAmt = value;
    }

    get light()
    {
        return this.uniforms.light;
    }
    set light(value)
    {
        this.uniforms.light = value;
    }

    get lightR()
    {
        return this.uniforms.lightR;
    }
    set lightR(value)
    {
        this.uniforms.lightR = value;
    }

    get sparks()
    {
        return this.uniforms.sparks;
    }
    set sparks(value)
    {
        this.uniforms.sparks = value;
    }

    get sparkLife()
    {
        return this.uniforms.sparkLife;
    }
    set sparkLife(value)
    {
        this.uniforms.sparkLife = value;
    }

    get sparkSpeed()
    {
        return this.uniforms.sparkSpeed;
    }
    set sparkSpeed(value)
    {
        this.uniforms.sparkSpeed = value;
    }

    get spread()
    {
        return this.uniforms.spread;
    }
    set spread(value)
    {
        this.uniforms.spread = value;
    }

    get gravity()
    {
        return this.uniforms.gravity;
    }
    set gravity(value)
    {
        this.uniforms.gravity = value;
    }

    get streak()
    {
        return this.uniforms.streak;
    }
    set streak(value)
    {
        this.uniforms.streak = value;
    }

    get sparkW()
    {
        return this.uniforms.sparkW;
    }
    set sparkW(value)
    {
        this.uniforms.sparkW = value;
    }

    get dropGap()
    {
        return this.uniforms.dropGap;
    }
    set dropGap(value)
    {
        this.uniforms.dropGap = value;
    }

    get dropLife()
    {
        return this.uniforms.dropLife;
    }
    set dropLife(value)
    {
        this.uniforms.dropLife = value;
    }

    get dropKick()
    {
        return this.uniforms.dropKick;
    }
    set dropKick(value)
    {
        this.uniforms.dropKick = value;
    }

    get dropR()
    {
        return this.uniforms.dropR;
    }
    set dropR(value)
    {
        this.uniforms.dropR = value;
    }

    get dropChance()
    {
        return this.uniforms.dropChance;
    }
    set dropChance(value)
    {
        this.uniforms.dropChance = value;
    }

    get flareR()
    {
        return this.uniforms.flareR;
    }
    set flareR(value)
    {
        this.uniforms.flareR = value;
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
}

FilterCutTorch.defaults = {
    time: 0,
    heads: 3,
    samples: 10,
    speed: 0.06,
    spacing: 0.016,
    jump: 0.07,
    cutW: 0.007,
    cutReach: 0.013,
    headR: 0.007,
    glowR: 0.016,
    glowAmt: 0.8,
    lineW: 1.2,
    edgeLo: 0.16,
    edgeHi: 0.42,
    seamR: 0.04,
    seamAmt: 0.85,
    scorchAmt: 0.3,
    light: 0.6,
    lightR: 0.05,
    sparks: 7,
    sparkLife: 0.4,
    sparkSpeed: 0.3,
    spread: 1.4,
    gravity: 1.4,
    streak: 0.035,
    sparkW: 0.002,
    dropGap: 0.14,
    dropLife: 0.7,
    dropKick: 0.04,
    dropR: 0.0045,
    dropChance: 0.6,
    flareR: 0.02,
    deep: 0x3a4c5c,
    mid: 0x309acf,
    core: 0xffffff,
    opacity: 1,
};
