import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE, applyCustomFilter, fillEdgeAnchors } from '../filter-core.js';

const teslaTremorFragment = `
precision highp float;

uniform float time;
uniform float tremor;
uniform float rate;
uniform float burstPeriod;
uniform float burstLen;
uniform float sparks;
uniform float arcs;
uniform float reach;
uniform float jag;
uniform float bend;
uniform float boltWidth;
uniform float flicker;
uniform float rim;
uniform float hot;
uniform float ink;
uniform float idle;
uniform float idleChance;
uniform float idleReach;
uniform float idleRate;
uniform vec3 boltColor;
uniform vec3 glowColor;
uniform vec3 inkColor;
uniform vec4 anchors[16];
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}
${GLSL_VNOISE}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float solidA(float alpha)
{
    return smoothstep(0.9, 0.995, alpha);
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
}

float ringMinS(vec2 uv, float radius)
{
    vec2 span = texPerSprite() * radius;
    float lowest = 1.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982;
        lowest = min(lowest, tapA(uv + vec2(cos(angle), sin(angle)) * span));
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
    float px = inputSize.z / texPerSprite().x;
    float phase = fract(time / burstPeriod);
    float inBurst = step(phase, burstLen);
    float envelope = inBurst * smoothstep(0.0, 0.03, phase) * (1.0 - smoothstep(burstLen * 0.75, burstLen, phase));
    float calm = 1.0 - inBurst;
    float tick = mod(floor(time * rate), 512.0);
    vec2 shakeSprite = (hash2(vec2(tick, 4.0)) - 0.5) * 2.0 * tremor * inBurst;
    vec2 shakeTex = shakeSprite * texPerSprite();

    vec4 result = tapC(vTextureCoord + shakeTex);
    float rimA = clamp(result.a - ringMinS(vTextureCoord + shakeTex, 0.012), 0.0, 1.0) * solidA(result.a);
    float crackle = 0.55 + 0.9 * vnoise(vec2(atan(sprite.y - 0.5, sprite.x - 0.5) * 16.0, time * 5.0));
    result = over(result, glowColor, clamp(rimA * rim * (mix(0.4, 0.55 * crackle, calm * idle) + 0.9 * envelope), 0.0, 1.0));

    float arcTick = mod(floor(time * flicker), 512.0);
    float idleTick = mod(floor(time * idleRate), 512.0);
    float spark = step(1.0 - sparks * 0.035, hash1(floor(sprite * 60.0) + tick * 3.7)) * rimA * max(envelope, calm * idle * 0.35);
    result = over(result, boltColor, spark);

    float spots = 0.0;
    for (int index = 0; index < 16; index++)
    {
        float fi = float(index);
        float burstOn = step(fi + 0.5, arcs) * step(0.15, hash1(vec2(fi, arcTick))) * step(0.001, envelope);
        float idleOn = step(fi + 0.5, arcs) * step(1.0 - idleChance, hash1(vec2(fi + 40.0, idleTick))) * calm;
        float power = max(burstOn * envelope, idleOn * idle);
        float on = step(0.001, power);
        vec4 anchor = anchors[index];
        float found = step(-8.0, anchor.x);
        vec2 root = anchor.xy - shakeSprite;
        vec2 normal = anchor.zw;
        vec2 tangent = vec2(-normal.y, normal.x);
        float boltLength = reach * mix(0.6, 1.0, vnoise(vec2(fi * 3.1, time * 1.6))) * mix(idleReach, 0.55 + 0.45 * envelope, burstOn);
        vec2 rel = sprite - root;
        float along = dot(rel, normal);
        float lateral = dot(rel, tangent);
        float progress = along / boltLength;
        float curve = (hash1(vec2(fi, floor(time / burstPeriod))) - 0.5) * bend * along * progress;
        float wiggle = ((vnoise(vec2(progress * 5.0 + fi * 7.0, time * 1.5)) - 0.5) * 2.0 * jag + (vnoise(vec2(progress * 17.0 + fi * 3.0, arcTick * 1.7)) - 0.5) * jag * 0.5) * smoothstep(0.0, 0.12, progress);
        float dist = abs(lateral - curve - wiggle) + max(-along, 0.0) * 3.0;
        float width = boltWidth * mix(1.25, 0.45, clamp(progress, 0.0, 1.0)) * mix(0.7, 1.0, burstOn);
        float live = on * found * step(progress, 1.0) * (1.0 - smoothstep(0.75, 1.0, progress)) * power;

        float forkProgress = (progress - 0.35) / 0.55;
        float side = sign(hash1(vec2(fi, 13.0 + floor(time / burstPeriod))) - 0.5);
        float forkWiggle = curve + wiggle + side * forkProgress * boltLength * 0.35 + (vnoise(vec2(forkProgress * 9.0 + fi * 5.0, arcTick * 1.3)) - 0.5) * jag;
        float forkDist = abs(lateral - forkWiggle) + max(-along, 0.0) * 3.0;
        float forkLive = on * found * step(0.0, forkProgress) * step(forkProgress, 1.0) * (1.0 - smoothstep(0.6, 1.0, forkProgress)) * 0.75 * power;
        float forkWidth = width * 0.7;

        result = over(result, inkColor, max((1.0 - smoothstep(width * 1.5, width * 1.5 + px, dist)) * live, (1.0 - smoothstep(forkWidth * 1.5, forkWidth * 1.5 + px, forkDist)) * forkLive) * ink);
        result = over(result, glowColor, max(exp(-dist / (width * 3.0)) * live, exp(-forkDist / (forkWidth * 3.0)) * forkLive) * 0.5);
        result = over(result, boltColor, max((1.0 - smoothstep(width * 0.5, width * 0.5 + px, dist)) * live, (1.0 - smoothstep(forkWidth * 0.5, forkWidth * 0.5 + px, forkDist)) * forkLive));
        spots += exp(-length(rel) / 0.014) * on * found * power;
    }

    result = over(result, glowColor, clamp(spots, 0.0, 1.0) * 0.7 * hot);
    result = over(result, boltColor, clamp(spots * 1.5 - 0.5, 0.0, 1.0) * hot);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterTeslaTremor extends LaCustomFilter
{
    constructor(params)
    {
        super(teslaTremorFragment, params, {
            boltColor: new Float32Array([0.95, 0.99, 1.0]),
            glowColor: new Float32Array([0.37, 0.84, 1.0]),
            inkColor: new Float32Array([0.01, 0.09, 0.13]),
            anchors: new Float32Array(64).fill(-9),
        });
        this.spriteCoords = true;
    }

    apply(filterManager, input, output, clear)
    {
        this._updateAnchors(filterManager.activeState.target);
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    _updateAnchors(target)
    {
        fillEdgeAnchors(this.uniforms.anchors, target, this.uniforms.arcs ?? 0, this.uniforms.time, this._drift ?? 0);
    }

    get tremor()
    {
        return this.uniforms.tremor;
    }
    set tremor(value)
    {
        this.uniforms.tremor = value;
    }

    get rate()
    {
        return this.uniforms.rate;
    }
    set rate(value)
    {
        this.uniforms.rate = value;
    }

    get burstPeriod()
    {
        return this.uniforms.burstPeriod;
    }
    set burstPeriod(value)
    {
        this.uniforms.burstPeriod = value;
    }

    get burstLen()
    {
        return this.uniforms.burstLen;
    }
    set burstLen(value)
    {
        this.uniforms.burstLen = value;
    }

    get sparks()
    {
        return this.uniforms.sparks;
    }
    set sparks(value)
    {
        this.uniforms.sparks = value;
    }

    get arcs()
    {
        return this.uniforms.arcs;
    }
    set arcs(value)
    {
        this.uniforms.arcs = value;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get drift()
    {
        return this._drift;
    }
    set drift(value)
    {
        this._drift = value;
    }

    get jag()
    {
        return this.uniforms.jag;
    }
    set jag(value)
    {
        this.uniforms.jag = value;
    }

    get bend()
    {
        return this.uniforms.bend;
    }
    set bend(value)
    {
        this.uniforms.bend = value;
    }

    get boltWidth()
    {
        return this.uniforms.boltWidth;
    }
    set boltWidth(value)
    {
        this.uniforms.boltWidth = value;
    }

    get flicker()
    {
        return this.uniforms.flicker;
    }
    set flicker(value)
    {
        this.uniforms.flicker = value;
    }

    get rim()
    {
        return this.uniforms.rim;
    }
    set rim(value)
    {
        this.uniforms.rim = value;
    }

    get hot()
    {
        return this.uniforms.hot;
    }
    set hot(value)
    {
        this.uniforms.hot = value;
    }

    get ink()
    {
        return this.uniforms.ink;
    }
    set ink(value)
    {
        this.uniforms.ink = value;
    }

    get idle()
    {
        return this.uniforms.idle;
    }
    set idle(value)
    {
        this.uniforms.idle = value;
    }

    get idleChance()
    {
        return this.uniforms.idleChance;
    }
    set idleChance(value)
    {
        this.uniforms.idleChance = value;
    }

    get idleReach()
    {
        return this.uniforms.idleReach;
    }
    set idleReach(value)
    {
        this.uniforms.idleReach = value;
    }

    get idleRate()
    {
        return this.uniforms.idleRate;
    }
    set idleRate(value)
    {
        this.uniforms.idleRate = value;
    }

    get boltColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.boltColor);
    }
    set boltColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.boltColor);
    }

    get glowColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.glowColor);
    }
    set glowColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.glowColor);
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

FilterTeslaTremor.defaults = {
    time: 0,
    tremor: 0.008,
    rate: 24,
    burstPeriod: 1.6,
    burstLen: 0.5,
    sparks: 0.8,
    arcs: 12,
    reach: 0.2,
    drift: 0.45,
    jag: 0.02,
    bend: 0.5,
    boltWidth: 0.008,
    flicker: 12,
    rim: 0.5,
    hot: 0.9,
    ink: 0.45,
    idle: 0.8,
    idleChance: 0.2,
    idleReach: 0.6,
    idleRate: 6,
    boltColor: 0xf2fdff,
    glowColor: 0x5fd6ff,
    inkColor: 0x031820,
    opacity: 1,
};
