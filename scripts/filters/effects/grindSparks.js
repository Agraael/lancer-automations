import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE, applyCustomFilter, fillEdgeAnchors } from '../filter-core.js';

const grindSparksFragment = `
precision highp float;

uniform float time;
uniform float reach;
uniform float fallReach;
uniform float cols;
uniform float rows;
uniform float fallSpeed;
uniform float density;
uniform float slant;
uniform float sparkW;
uniform float rimW;
uniform float rimScale;
uniform float rimSpeed;
uniform float rimHeat;
uniform float light;
uniform float lightReach;
uniform float poolR;
uniform float poolAmt;
uniform float points;
uniform float burst;
uniform float duty;
uniform float sparks;
uniform float sparkLife;
uniform float sparkSpeed;
uniform float spread;
uniform float lift;
uniform float gravity;
uniform float streak;
uniform float sprayW;
uniform float spotR;
uniform vec3 deep;
uniform vec3 mid;
uniform vec3 core;
uniform vec4 anchors[16];
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

float toonBand(float value, float threshold, float soft)
{
    return smoothstep(threshold - soft, threshold + soft, value);
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

    float flick = 0.75 + 0.25 * vnoise(vec2(time * 9.0, sprite.x * 3.0 + sprite.y * 2.0));
    float rainA = 0.0;
    vec3 rainC = vec3(0.0);
    float rainGlow = 0.0;
    if (inside < 1.0)
    {
    vec3 soft = softOutS(vTextureCoord, reach);
    float softDist = sqrt(soft.x);
    float near = (1.0 - inside) * clamp(1.0 - softDist * 1.15, 0.0, 1.0) * smoothstep(-0.7, 0.1, -soft.z);
    float below = 0.0;
    for (int probe = 1; probe < 6; probe++)
    {
        float off = fallReach * float(probe) / 5.0;
        below = max(below, tapS(spriteToTex(sprite - vec2(0.0, off))) * (1.0 - float(probe - 1) / 5.0));
    }
    float field = max(near, below * 0.9 * (1.0 - inside));
    vec2 outward = -soft.yz;
    for (int layer = 0; layer < 2; layer++)
    {
        float layerF = float(layer);
        float colsL = cols * (1.0 + 0.6 * layerF);
        float rowsL = rows * (1.0 + 0.6 * layerF);
        float speedL = fallSpeed * (1.0 - 0.3 * layerF);
        vec2 grid = vec2(sprite.x * colsL, sprite.y * rowsL - time * speedL * rowsL + layerF * 7.31);
        vec2 cell = floor(grid);
        vec2 cellFrac = fract(grid);
        float cellHash = hash1(cell + layerF * 19.7);
        if (cellHash < 1.0 - density)
            continue;
        if (hash1(cell * 1.37 + 5.1) < 1.0 - field)
            continue;
        vec2 cellSize = vec2(1.0 / colsL, 1.0 / rowsL);
        float xo = 0.2 + 0.6 * hash1(cell + 3.3);
        float lean = clamp(outward.x, -1.0, 1.0) * slant;
        vec2 top = vec2(xo - lean * 0.5, 0.08) * cellSize;
        vec2 bottom = vec2(xo + lean * 0.5, 0.92) * cellSize;
        vec2 toTop = cellFrac * cellSize - top;
        vec2 span = bottom - top;
        float along = clamp(dot(toTop, span) / dot(span, span), 0.0, 1.0);
        float dist = length(toTop - span * along);
        float width = max(sparkW * (1.0 - 0.35 * layerF), px * 0.75) * (0.5 + 0.5 * along);
        float twinkle = 0.55 + 0.45 * sin(time * (16.0 + 9.0 * cellHash) + cellHash * 41.0);
        float vis = smoothstep(0.0, 0.25, field);
        float alpha = (1.0 - smoothstep(width - px * 0.5, width + px * 0.5, dist)) * (0.25 + 0.75 * along) * twinkle * vis;
        rainGlow = max(rainGlow, exp(-dist / (width * 3.0)) * along * twinkle * 0.6 * vis);
        if (alpha > rainA)
        {
            rainA = alpha;
            rainC = mix(deep, mix(mid, core, smoothstep(0.75, 0.95, along)), smoothstep(0.0, 0.5, along));
        }
    }
    }

    float rim = 0.0;
    float edgeLight = 0.0;
    if (inside > 0.0)
    {
        rim = inside * (1.0 - ringMinSolid(vTextureCoord, rimW));
        edgeLight = inside * (1.0 - ringMinSolid(vTextureCoord, lightReach)) * light * flick;
    }
    float friction = vnoise(sprite * rimScale + vec2(time * rimSpeed, -time * rimSpeed * 0.7)) * 0.65 + vnoise(sprite * rimScale * 2.3 - vec2(time * rimSpeed * 1.7, 0.0)) * 0.35;
    float heatR = rim * smoothstep(0.6, 0.86, friction) * rimHeat;
    float reachLen = sparkSpeed * sparkLife * 1.4 + 0.5 * gravity * sparkLife * sparkLife * 1.96 + 0.03;

    vec3 sprayC = vec3(0.0);
    float sprayA = 0.0;
    float sprayGlow = 0.0;
    float spotA = 0.0;
    float pool = 0.0;
    for (int index = 0; index < 16; index++)
    {
        float slot = float(index);
        if (slot + 0.5 > points)
            break;
        vec4 anchor = anchors[index];
        if (anchor.x < -8.0)
            continue;
        vec2 rel = sprite - anchor.xy;
        if (length(rel) > max(reachLen, poolR * 4.0))
            continue;
        vec2 normal = anchor.zw;
        vec2 tangent = vec2(-normal.y, normal.x);
        float phase0 = hash1(vec2(slot, 2.0));
        float phase = fract(time / burst + phase0);
        float grinding = smoothstep(0.0, 0.04, phase) * (1.0 - smoothstep(duty - 0.04, duty, phase));
        float cooled = clamp((phase - duty) / max(1.0 - duty, 0.01), 0.0, 1.0);
        float heatNow = max(grinding, step(duty, phase) * (1.0 - cooled));
        pool = max(pool, heatNow * exp(-length(rel) / max(poolR, 1e-4)) * (0.85 + 0.15 * vnoise(vec2(time * 20.0, slot))));
        spotA = max(spotA, grinding * exp(-dot(rel, rel) / max(spotR * spotR, 1e-6)) * (0.8 + 0.2 * vnoise(vec2(time * 25.0, slot))));
        for (int spark = 0; spark < 16; spark++)
        {
            float sparkF = float(spark);
            if (sparkF + 0.5 > sparks)
                break;
            float h1 = hash1(vec2(slot * 17.0 + sparkF, 5.0));
            float h2 = hash1(vec2(slot * 17.0 + sparkF, 9.0));
            float h3 = hash1(vec2(slot * 17.0 + sparkF, 21.0));
            float life = sparkLife * (0.6 + 0.8 * h1);
            float age = mod(time + h2 * life * 3.0, life);
            float birth = time - age;
            float birthPhase = fract(birth / burst + phase0);
            if (birthPhase < 0.02 || birthPhase > duty)
                continue;
            float side = hash1(vec2(slot, floor(birth / burst + phase0))) < 0.5 ? -1.0 : 1.0;
            vec2 dir = rot2(normalize(normal * lift + tangent * side), (h3 - 0.5) * spread);
            float speed = sparkSpeed * (0.55 + 0.9 * h2);
            vec2 head = anchor.xy + dir * speed * age + vec2(0.0, 0.5 * gravity * age * age);
            float tailAge = max(age - streak, 0.0);
            vec2 tail = anchor.xy + dir * speed * tailAge + vec2(0.0, 0.5 * gravity * tailAge * tailAge);
            float dist = sdSeg(sprite, tail, head);
            float fade = 1.0 - age / life;
            float width = max(sprayW * (0.45 + 0.55 * fade), px * 0.75);
            float alpha = (1.0 - smoothstep(width - px, width + px, dist)) * clamp(fade * 1.6, 0.0, 1.0);
            sprayGlow = max(sprayGlow, exp(-dist / (width * 3.0)) * fade * 0.7);
            if (alpha > sprayA)
            {
                sprayA = alpha;
                sprayC = mix(mid, core, smoothstep(0.3, 0.85, fade));
            }
        }
    }

    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    float lum = luma(base);
    float lightAmt = clamp(edgeLight + pool * poolAmt * inside, 0.0, 1.0);
    vec3 lit = mix(base, max(base, mid * (0.35 + 0.65 * lum * 3.0)), lightAmt * 0.75);
    lit = mix(lit, max(lit, core * (0.45 + 0.55 * lum * 2.0)), clamp(pool * poolAmt * inside * 0.45, 0.0, 1.0));
    vec4 result = vec4(mix(base, min(lit, vec3(1.0)), inside) * pixel.a, pixel.a);
    result = over(result, deep, toonBand(heatR, 0.12, 0.03));
    result = over(result, mid, toonBand(heatR, 0.42, 0.03));
    result = over(result, core, toonBand(heatR, 0.78, 0.03));
    result = under(result, mid, clamp(rainGlow * 0.55 + sprayGlow * 0.7 + spotA * 0.5 + pool * poolAmt * 0.35 * (1.0 - inside), 0.0, 1.0));
    result = over(result, rainC, clamp(rainA, 0.0, 1.0));
    result = over(result, sprayC, clamp(sprayA, 0.0, 1.0));
    result = over(result, core, clamp(spotA * (0.5 + 0.5 * inside), 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterGrindSparks extends LaCustomFilter
{
    constructor(params)
    {
        super(grindSparksFragment, params, {
            deep: new Float32Array([0.6, 0.12, 0.02]),
            mid: new Float32Array([1.0, 0.54, 0.16]),
            core: new Float32Array([1.0, 0.96, 0.78]),
            anchors: new Float32Array(64).fill(-9),
        });
        this.spriteCoords = true;
    }

    apply(filterManager, input, output, clear)
    {
        fillEdgeAnchors(this.uniforms.anchors, filterManager.activeState.target, this.uniforms.points ?? 0, this.uniforms.time, this._drift ?? 0);
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    get drift()
    {
        return this._drift;
    }
    set drift(value)
    {
        this._drift = value;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get fallReach()
    {
        return this.uniforms.fallReach;
    }
    set fallReach(value)
    {
        this.uniforms.fallReach = value;
    }

    get cols()
    {
        return this.uniforms.cols;
    }
    set cols(value)
    {
        this.uniforms.cols = value;
    }

    get rows()
    {
        return this.uniforms.rows;
    }
    set rows(value)
    {
        this.uniforms.rows = value;
    }

    get fallSpeed()
    {
        return this.uniforms.fallSpeed;
    }
    set fallSpeed(value)
    {
        this.uniforms.fallSpeed = value;
    }

    get density()
    {
        return this.uniforms.density;
    }
    set density(value)
    {
        this.uniforms.density = value;
    }

    get slant()
    {
        return this.uniforms.slant;
    }
    set slant(value)
    {
        this.uniforms.slant = value;
    }

    get sparkW()
    {
        return this.uniforms.sparkW;
    }
    set sparkW(value)
    {
        this.uniforms.sparkW = value;
    }

    get rimW()
    {
        return this.uniforms.rimW;
    }
    set rimW(value)
    {
        this.uniforms.rimW = value;
    }

    get rimScale()
    {
        return this.uniforms.rimScale;
    }
    set rimScale(value)
    {
        this.uniforms.rimScale = value;
    }

    get rimSpeed()
    {
        return this.uniforms.rimSpeed;
    }
    set rimSpeed(value)
    {
        this.uniforms.rimSpeed = value;
    }

    get rimHeat()
    {
        return this.uniforms.rimHeat;
    }
    set rimHeat(value)
    {
        this.uniforms.rimHeat = value;
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

    get poolR()
    {
        return this.uniforms.poolR;
    }
    set poolR(value)
    {
        this.uniforms.poolR = value;
    }

    get poolAmt()
    {
        return this.uniforms.poolAmt;
    }
    set poolAmt(value)
    {
        this.uniforms.poolAmt = value;
    }

    get points()
    {
        return this.uniforms.points;
    }
    set points(value)
    {
        this.uniforms.points = value;
    }

    get burst()
    {
        return this.uniforms.burst;
    }
    set burst(value)
    {
        this.uniforms.burst = value;
    }

    get duty()
    {
        return this.uniforms.duty;
    }
    set duty(value)
    {
        this.uniforms.duty = value;
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

    get lift()
    {
        return this.uniforms.lift;
    }
    set lift(value)
    {
        this.uniforms.lift = value;
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

    get sprayW()
    {
        return this.uniforms.sprayW;
    }
    set sprayW(value)
    {
        this.uniforms.sprayW = value;
    }

    get spotR()
    {
        return this.uniforms.spotR;
    }
    set spotR(value)
    {
        this.uniforms.spotR = value;
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

FilterGrindSparks.defaults = {
    time: 0,
    reach: 0.074,
    fallReach: 0.02,
    cols: 23,
    rows: 15,
    fallSpeed: 0.55,
    density: 0.42,
    slant: 0.3,
    sparkW: 0.0022,
    rimW: 0.012,
    rimScale: 30,
    rimSpeed: 1.2,
    rimHeat: 1,
    light: 0.45,
    lightReach: 0.03,
    poolR: 0.03,
    poolAmt: 0.8,
    points: 4,
    drift: 0.07,
    burst: 1.7,
    duty: 0.7,
    sparks: 12,
    sparkLife: 0.3,
    sparkSpeed: 0.45,
    spread: 1,
    lift: 0.6,
    gravity: 1.4,
    streak: 0.06,
    sprayW: 0.003,
    spotR: 0.016,
    deep: 0x9a1f06,
    mid: 0xff8a2a,
    core: 0xfff4c8,
    opacity: 1,
};
