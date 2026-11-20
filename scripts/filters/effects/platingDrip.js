import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const platingDripFragment = `
precision highp float;

uniform float time;
uniform float reach;
uniform float coat;
uniform float drips;
uniform float dripLen;
uniform float dripW;
uniform float period;
uniform float sheet;
uniform float glowAmt;
uniform vec3 liquidColor;
uniform vec3 darkLiquid;
uniform vec3 inkColor;
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

float distOut(vec2 sprite, vec2 dir, float range)
{
    float lo = 0.0;
    float hi = -1.0;
    for (int index = 1; index < 9; index++)
    {
        float probe = range * float(index) / 8.0;
        float hit = tapS(spriteToTex(sprite + dir * probe));
        if (hi < 0.0 && hit < 0.5)
            hi = probe;
        if (hi < 0.0)
            lo = probe;
    }
    if (hi < 0.0)
        return range * 2.0;
    for (int index = 0; index < 3; index++)
    {
        float mid = 0.5 * (lo + hi);
        if (tapS(spriteToTex(sprite + dir * mid)) < 0.5)
            hi = mid;
        else
            lo = mid;
    }
    return 0.5 * (lo + hi);
}

float smin(float first, float second, float blend)
{
    float weight = clamp(0.5 + 0.5 * (second - first) / blend, 0.0, 1.0);
    return mix(second, first, weight) - blend * weight * (1.0 - weight);
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
    vec3 color = pixel.rgb / max(pixel.a, 1e-4);

    float up = distAlong(sprite, vec2(0.0, -1.0), reach);
    float coatT = coat * (0.35 + 0.65 * vnoise(vec2(sprite.x * 16.0, 3.0)));
    float coatD = up - coatT;

    float colW = 1.0 / drips;
    float colI = floor(sprite.x / colW);
    float seed = hash1(vec2(colI, 11.0));
    float cx = (colI + 0.3 + 0.4 * hash1(vec2(colI, 4.0))) * colW;
    float life = fract(time / period + seed);
    float snap = smoothstep(0.72, 0.78, life);
    float grow = smoothstep(0.0, 0.72, life);
    float width = min(dripW * (0.7 + 0.6 * hash1(vec2(colI, 6.0))), colW * 0.2);
    float len = dripLen * (0.35 + 0.65 * hash1(vec2(colI, 8.0))) * grow * (1.0 - snap);
    float upC = distAlong(vec2(cx, sprite.y), vec2(0.0, -1.0), reach);
    float stemR = width * mix(0.4, 0.75, smoothstep(0.0, max(len, 1e-4), upC));
    float stem = length(vec2(sprite.x - cx, upC - clamp(upC, 0.0, len))) - stemR;
    float bulb = length(vec2(sprite.x - cx, (upC - len) * 0.9)) - width * (0.75 + 0.35 * grow);
    float active = step(0.3, seed) * step(upC, reach);
    float dripD = mix(9.0, smin(stem, bulb, width * 0.7), active);
    float dropT = smoothstep(0.75, 1.0, life);
    float drop = length(vec2(sprite.x - cx, (upC - dripLen * (0.5 + 1.2 * dropT)) * 0.8)) - width * 0.8 * (1.0 - smoothstep(0.9, 1.0, life));
    float dropD = mix(9.0, drop, active * snap);
    float liquidD = min(smin(coatD, dripD, max(coat, 0.004)), dropD);

    float outside = (1.0 - inside) * step(up, reach * 1.2);
    float liquid = (1.0 - smoothstep(-px, px, liquidD)) * outside;
    float ink = (1.0 - smoothstep(0.0025 - px, 0.0025 + px, liquidD)) * outside;
    float depthL = clamp(-liquidD / max(width, 0.003), 0.0, 1.0);
    float across = clamp((sprite.x - cx) / max(width, 1e-4), -1.0, 1.0);
    float highlight = exp(-pow((across + 0.35) / 0.25, 2.0)) * step(coatT * 0.5, upC) * active;
    float flowN = vnoise(vec2(sprite.x * 50.0, sprite.y * 14.0 - time * 0.5));
    vec3 liquidC = mix(darkLiquid, liquidColor, 0.35 + 0.65 * depthL) + vec3(1.0) * (highlight * 0.45 + smoothstep(0.7, 0.95, flowN) * 0.2);

    float down = distOut(sprite, vec2(0.0, 1.0), sheet);
    float sheetA = (1.0 - smoothstep(sheet * 0.3, sheet, down)) * inside * step(0.0001, sheet);
    float streak = smoothstep(0.55, 0.85, vnoise(vec2(sprite.x * 60.0, sprite.y * 10.0 - time * 0.6)));
    vec3 coated = mix(color, mix(darkLiquid, liquidColor, 0.6 + 0.4 * streak), sheetA * 0.7);

    vec4 result = vec4(coated * pixel.a, pixel.a);
    result = under(result, liquidColor, clamp(glowAmt * 0.45 * (1.0 - smoothstep(0.0, 0.02, liquidD)) * outside, 0.0, 1.0));
    result = over(result, inkColor, ink * 0.9);
    result = over(result, clamp(liquidC, 0.0, 1.0), liquid);
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterPlatingDrip extends LaCustomFilter
{
    constructor(params)
    {
        super(platingDripFragment, params, {
            liquidColor: new Float32Array([0.72, 0.78, 0.82]),
            darkLiquid: new Float32Array([0.23, 0.27, 0.32]),
            inkColor: new Float32Array([0.05, 0.06, 0.08]),
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

    get coat()
    {
        return this.uniforms.coat;
    }
    set coat(value)
    {
        this.uniforms.coat = value;
    }

    get drips()
    {
        return this.uniforms.drips;
    }
    set drips(value)
    {
        this.uniforms.drips = value;
    }

    get dripLen()
    {
        return this.uniforms.dripLen;
    }
    set dripLen(value)
    {
        this.uniforms.dripLen = value;
    }

    get dripW()
    {
        return this.uniforms.dripW;
    }
    set dripW(value)
    {
        this.uniforms.dripW = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get sheet()
    {
        return this.uniforms.sheet;
    }
    set sheet(value)
    {
        this.uniforms.sheet = value;
    }

    get glowAmt()
    {
        return this.uniforms.glowAmt;
    }
    set glowAmt(value)
    {
        this.uniforms.glowAmt = value;
    }

    get liquidColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.liquidColor);
    }
    set liquidColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.liquidColor);
    }

    get darkLiquid()
    {
        return PIXI.utils.rgb2hex(this.uniforms.darkLiquid);
    }
    set darkLiquid(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.darkLiquid);
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

FilterPlatingDrip.defaults = {
    time: 0,
    reach: 0.12,
    coat: 0.012,
    drips: 16,
    dripLen: 0.06,
    dripW: 0.006,
    period: 5,
    sheet: 0.03,
    glowAmt: 0,
    liquidColor: 0xb8c6d2,
    darkLiquid: 0x3a4652,
    inkColor: 0x0c1014,
    opacity: 1,
};
