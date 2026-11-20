import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const dataBleedFragment = `
precision highp float;

uniform float time;
uniform float stack;
uniform float reach;
uniform float upBias;
uniform float cols;
uniform float rise;
uniform float density;
uniform float gapLo;
uniform float gapSoft;
uniform float bandW;
uniform float blockSize;
uniform float amount;
uniform float tickRate;
uniform float rimWidth;
uniform float light;
uniform float lightReach;
uniform vec3 codeColor;
uniform vec3 headColor;
uniform vec3 backColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
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

float glyphAt(vec2 cellF, vec2 cellId, float tick)
{
    vec2 sub = floor((cellF - vec2(0.15, 0.08)) / vec2(0.7, 0.84) * vec2(3.0, 5.0));
    float inside = step(0.15, cellF.x) * step(cellF.x, 0.85) * step(0.08, cellF.y) * step(cellF.y, 0.92);
    return inside * step(0.45, hash1(vec2(cellId.x * 7.0 + sub.x, cellId.y * 11.0 + sub.y) + tick * 3.1));
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    float solid = step(0.55, pixel.a);
    float grow = min(0.6 + 0.12 * stack, 1.4);

    vec4 outHit = softOut(vTextureCoord, reach * grow);
    float found = step(outHit.x, 0.999);
    float open = smoothstep(gapLo, gapLo + gapSoft, outHit.w);
    float strength = clamp(1.0 - outHit.x * (1.25 - upBias * outHit.z), 0.0, 1.0) * found * open * (1.0 - solid);

    float glyphs = 0.0;
    for (int layer = 0; layer < 2; layer++)
    {
        float layerF = float(layer);
        float cellScale = cols * (1.0 + layerF * 0.5);
        vec2 grid = vec2(vFilterCoord.x * cellScale + sin(vFilterCoord.y * 7.0 + time + layerF * 2.0) * 0.4, vFilterCoord.y * cellScale + mod(time * rise * cellScale, 2048.0));
        vec2 cellId = floor(grid);
        vec2 cellF = fract(grid);
        float alive = step(1.0 - density, hash1(cellId + layerF * 17.0));
        float glyphTick = mod(floor(time * 6.0 + hash1(cellId) * 9.0), 64.0);
        float keep = step((1.0 - strength) * 0.85, hash1(floor(cellF * vec2(3.0, 5.0)) + cellId * 1.7));
        glyphs = max(glyphs, alive * glyphAt(cellF, cellId + layerF * 31.0, glyphTick) * keep);
    }
    float alpha = glyphs * smoothstep(0.0, 0.4, strength);

    float edgeBand = solid * (1.0 - step(0.5, ringMinS(vTextureCoord, bandW * grow)));
    vec2 block = floor(vFilterCoord / blockSize);
    float blockTick = mod(floor(time * tickRate + hash1(block) * 3.0), 256.0);
    float blockRoll = hash1(block + blockTick * 1.7);
    float shift = (hash1(block + blockTick * 2.3) - 0.5) * 0.06;
    vec4 moved = tapC(vTextureCoord + vec2(shift * texPerSprite().x, 0.0));
    float blockGlyph = glyphAt(fract(vFilterCoord / blockSize), block, blockTick);
    float hit = step(1.0 - amount, blockRoll);
    float black = step(1.0 - amount * 0.35, blockRoll);

    float flick = 0.7 + 0.3 * vnoise(vec2(vFilterCoord.x * 6.0 + vFilterCoord.y * 3.0, time * 5.0));
    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    vec3 movedBase = moved.rgb / max(moved.a, 1e-4);
    float luma = dot(base, vec3(0.299, 0.587, 0.114));
    float glow = clamp(solid * (1.0 - ringMinS(vTextureCoord, lightReach)) * light * (0.6 + 0.12 * stack) * flick, 0.0, 1.0);
    vec3 lit = mix(base, max(base, codeColor * (0.35 + 0.65 * luma * 3.0)), glow * 0.75);
    lit = mix(lit, mix(movedBase, codeColor, 0.35), edgeBand * hit * (1.0 - black));
    lit = mix(lit, backColor, edgeBand * black);

    vec4 result = vec4(mix(base, min(lit, vec3(1.0)), solid) * pixel.a, pixel.a);
    result = over(result, codeColor, edgeBand * black * blockGlyph);
    result = over(result, codeColor, alpha * 0.95);
    result = over(result, headColor, alpha * step(0.8, strength) * 0.6);
    float rim = solid * (1.0 - step(0.5, ringMinS(vTextureCoord, rimWidth))) * step(0.0005, rimWidth);
    result = over(result, codeColor, rim * 0.9);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterDataBleed extends LaCustomFilter
{
    constructor(params)
    {
        super(dataBleedFragment, params, {
            codeColor: new Float32Array([0.30, 1.0, 0.23]),
            headColor: new Float32Array([0.92, 1.0, 0.85]),
            backColor: new Float32Array([0.02, 0.13, 0.04]),
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

    get upBias()
    {
        return this.uniforms.upBias;
    }
    set upBias(value)
    {
        this.uniforms.upBias = value;
    }

    get cols()
    {
        return this.uniforms.cols;
    }
    set cols(value)
    {
        this.uniforms.cols = value;
    }

    get rise()
    {
        return this.uniforms.rise;
    }
    set rise(value)
    {
        this.uniforms.rise = value;
    }

    get density()
    {
        return this.uniforms.density;
    }
    set density(value)
    {
        this.uniforms.density = value;
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

    get bandW()
    {
        return this.uniforms.bandW;
    }
    set bandW(value)
    {
        this.uniforms.bandW = value;
    }

    get blockSize()
    {
        return this.uniforms.blockSize;
    }
    set blockSize(value)
    {
        this.uniforms.blockSize = value;
    }

    get amount()
    {
        return this.uniforms.amount;
    }
    set amount(value)
    {
        this.uniforms.amount = value;
    }

    get tickRate()
    {
        return this.uniforms.tickRate;
    }
    set tickRate(value)
    {
        this.uniforms.tickRate = value;
    }

    get rimWidth()
    {
        return this.uniforms.rimWidth;
    }
    set rimWidth(value)
    {
        this.uniforms.rimWidth = value;
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

    get codeColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.codeColor);
    }
    set codeColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.codeColor);
    }

    get headColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.headColor);
    }
    set headColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.headColor);
    }

    get backColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.backColor);
    }
    set backColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.backColor);
    }
}

FilterDataBleed.defaults = {
    time: 0,
    stack: 1,
    reach: 0.075,
    upBias: 0.68,
    cols: 21,
    rise: 0.2,
    density: 0.31,
    gapLo: 0.15,
    gapSoft: 0.2,
    bandW: 0.035,
    blockSize: 0.02,
    amount: 0.65,
    tickRate: 6,
    rimWidth: 0.01,
    light: 0.4,
    lightReach: 0.03,
    codeColor: 0x4dff3a,
    headColor: 0xeaffd8,
    backColor: 0x04210a,
    opacity: 1,
};
