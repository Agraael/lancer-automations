import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const codeRainFragment = `
precision highp float;

uniform float time;
uniform float stack;
uniform float cols;
uniform float cover;
uniform float fall;
uniform float trailLen;
uniform float glitch;
uniform float glitchRate;
uniform vec3 codeColor;
uniform vec3 headColor;
uniform vec3 backColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

float fbm(vec2 p)
{
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++)
    {
        v += amp * vnoise(p);
        p = p * 2.03 + vec2(17.0, 9.0);
        amp *= 0.5;
    }
    return v;
}

float band(float v, float t, float w)
{
    return smoothstep(t - w, t + w, v);
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

float ringMinS(vec2 uv, float r)
{
    vec2 s = vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1]))) * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, texture2D(uSampler, clamp(uv + vec2(cos(a), sin(a)) * s, inputClamp.xy, inputClamp.zw)).a);
    }
    return m;
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    float solid = step(0.55, pixel.a);
    float grow = min(0.6 + 0.12 * stack, 1.4);

    float infectN = fbm(vFilterCoord * 2.4 + 9.0);
    float region = solid * band(infectN, 1.0 - cover * grow, 0.04);

    float rows = cols * 1.5;
    float colId = floor(vFilterCoord.x * cols);
    float rowF = vFilterCoord.y * rows;
    float rowId = floor(rowF);
    float spd = 0.6 + hash1(vec2(colId, 3.0)) * 0.9;
    float loopLen = rows * 1.2;
    float headA = mod(time * spd * fall + hash1(vec2(colId, 7.0)) * loopLen, loopLen) - rows * 0.1;
    float headB = mod(headA + rows * 0.1 + loopLen * 0.5, loopLen) - rows * 0.1;
    float trailA = (headA - rowId) / trailLen;
    float trailB = (headB - rowId) / trailLen;
    float lit = max(step(0.0, trailA) * (1.0 - smoothstep(0.0, 1.0, trailA)), step(0.0, trailB) * (1.0 - smoothstep(0.0, 1.0, trailB)));
    float head = max(step(abs(rowId - floor(headA)), 0.5), step(abs(rowId - floor(headB)), 0.5));

    vec2 cellF = vec2(fract(vFilterCoord.x * cols), fract(rowF));
    vec2 sub = floor((cellF - vec2(0.15, 0.08)) / vec2(0.7, 0.84) * vec2(3.0, 5.0));
    float inside = step(0.15, cellF.x) * step(cellF.x, 0.85) * step(0.08, cellF.y) * step(cellF.y, 0.92);
    float glyphTick = mod(floor(time * 5.0 + hash1(vec2(colId, rowId)) * 9.0), 64.0);
    float glyph = inside * step(0.45, hash1(vec2(colId * 7.0 + sub.x, rowId * 11.0 + sub.y) + glyphTick * 3.1));

    vec3 base = pixel.rgb / max(pixel.a, 1e-4);
    vec3 dark = mix(base, base * 0.3 + backColor * 0.6, region * 0.6);
    vec4 result = vec4(dark * pixel.a, pixel.a);
    result = over(result, codeColor, region * glyph * lit * 0.95);
    result = over(result, headColor, region * glyph * head);

    float glitchTick = mod(floor(time * glitchRate), 512.0);
    float slice = floor(vFilterCoord.y * 48.0);
    float sliceOn = step(1.0 - glitch * 0.25, hash1(vec2(slice, glitchTick)));
    float sliceShift = (hash1(vec2(slice, glitchTick + 3.0)) - 0.5) * 0.03 * sliceOn;
    float sliceDrop = step(1.0 - glitch * 0.12, hash1(vec2(slice, glitchTick + 9.0)));
    vec2 rimUV = vTextureCoord + vec2(sliceShift / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 0.0);
    float rimSolid = step(0.55, texture2D(uSampler, clamp(rimUV, inputClamp.xy, inputClamp.zw)).a);
    float rim = rimSolid * (1.0 - step(0.5, ringMinS(rimUV, 0.012))) * (1.0 - sliceDrop);
    result = over(result, mix(codeColor, headColor, sliceOn), rim * 0.95);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterCodeRain extends LaCustomFilter
{
    constructor(params)
    {
        super(codeRainFragment, params, {
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

    get cols()
    {
        return this.uniforms.cols;
    }
    set cols(value)
    {
        this.uniforms.cols = value;
    }

    get cover()
    {
        return this.uniforms.cover;
    }
    set cover(value)
    {
        this.uniforms.cover = value;
    }

    get fall()
    {
        return this.uniforms.fall;
    }
    set fall(value)
    {
        this.uniforms.fall = value;
    }

    get trailLen()
    {
        return this.uniforms.trailLen;
    }
    set trailLen(value)
    {
        this.uniforms.trailLen = value;
    }

    get glitch()
    {
        return this.uniforms.glitch;
    }
    set glitch(value)
    {
        this.uniforms.glitch = value;
    }

    get glitchRate()
    {
        return this.uniforms.glitchRate;
    }
    set glitchRate(value)
    {
        this.uniforms.glitchRate = value;
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

FilterCodeRain.defaults = {
    time: 0,
    stack: 5,
    cols: 38,
    cover: 0.95,
    fall: 11,
    trailLen: 16,
    glitch: 0.75,
    glitchRate: 6,
    codeColor: 0x4dff3a,
    headColor: 0xeaffd8,
    backColor: 0x04210a,
    opacity: 0.56,
};
