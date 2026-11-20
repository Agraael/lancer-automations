import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE, applyCustomFilter, fillEdgeAnchors } from '../filter-core.js';

const shedPlatesFragment = `
precision highp float;

uniform float time;
uniform float points;
uniform float period;
uniform float size;
uniform float toss;
uniform float fall;
uniform float tumble;
uniform vec3 emberColor;
uniform vec3 darkColor;
uniform vec4 anchors[24];
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
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

float sdBox(vec2 point, vec2 halfSize)
{
    vec2 dist = abs(point) - halfSize;
    return length(max(dist, 0.0)) + min(max(dist.x, dist.y), 0.0);
}

vec2 rot2(vec2 vector, float angle)
{
    float cosA = cos(angle);
    float sinA = sin(angle);
    return vec2(vector.x * cosA - vector.y * sinA, vector.x * sinA + vector.y * cosA);
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
    float inside = smoothstep(0.9, 0.995, pixel.a);
    vec4 result = pixel;

    for (int index = 0; index < 24; index++)
    {
        float slot = float(index);
        if (slot + 0.5 > points)
            break;
        vec4 anchor = anchors[index];
        if (anchor.x < -8.0)
            continue;

        vec2 normal = anchor.zw;
        vec2 tangent = vec2(-normal.y, normal.x);
        float life = fract(time / period + hash1(vec2(slot, 3.0)));
        vec2 home = anchor.xy - normal * size * 0.55;

        vec2 holeRel = sprite - home;
        vec2 holeLocal = vec2(dot(holeRel, tangent), dot(holeRel, normal));
        float holeDist = sdBox(holeLocal, vec2(size, size * 0.6)) + 0.003 * (vnoise(holeLocal * 400.0 + slot * 3.0) - 0.5);
        float holeOpen = smoothstep(0.0, 0.06, life) * (1.0 - smoothstep(0.8, 1.0, life));
        float hole = (1.0 - smoothstep(-px, px, holeDist)) * holeOpen * inside;
        float lip = (1.0 - smoothstep(0.0, 0.008, abs(holeDist))) * holeOpen * inside;
        result = over(result, darkColor, hole * 0.92);
        result = over(result, emberColor, clamp(lip * (0.6 + 0.4 * vnoise(vec2(time * 5.0, slot))), 0.0, 1.0));

        float fly = smoothstep(0.03, 0.85, life);
        vec2 plateAt = home + normal * toss * fly + vec2(0.0, fall * fly * fly);
        float turn = tumble * fly * (hash1(vec2(slot, 7.0)) - 0.5) * 5.0;
        vec2 plateRel = rot2(sprite - plateAt, -turn);
        vec2 plateLocal = vec2(dot(plateRel, tangent), dot(plateRel, normal));
        float plateDist = sdBox(plateLocal, vec2(size, size * 0.6)) + 0.003 * (vnoise(plateLocal * 400.0 + slot * 3.0) - 0.5);
        float plate = (1.0 - smoothstep(-px, px, plateDist)) * (1.0 - smoothstep(0.45, 0.95, life)) * step(0.03, life);
        vec4 source = tapC(spriteToTex(home + tangent * plateLocal.x + normal * plateLocal.y));
        vec3 plateColor = source.rgb / max(source.a, 1e-4);
        result = over(result, plateColor * 0.85, plate * smoothstep(0.9, 0.995, source.a));
        result = over(result, emberColor, clamp((1.0 - smoothstep(0.0, 0.006, abs(plateDist))) * plate, 0.0, 1.0));
    }

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterShedPlates extends LaCustomFilter
{
    constructor(params)
    {
        super(shedPlatesFragment, params, {
            emberColor: new Float32Array([1.0, 0.48, 0.18]),
            darkColor: new Float32Array([0.08, 0.04, 0.02]),
            anchors: new Float32Array(96).fill(-9),
        });
        this.spriteCoords = true;
    }

    apply(filterManager, input, output, clear)
    {
        fillEdgeAnchors(this.uniforms.anchors, filterManager.activeState.target, this.uniforms.points ?? 0, this.uniforms.time, this._drift ?? 0);
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    get points()
    {
        return this.uniforms.points;
    }
    set points(value)
    {
        this.uniforms.points = value;
    }

    get drift()
    {
        return this._drift;
    }
    set drift(value)
    {
        this._drift = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get size()
    {
        return this.uniforms.size;
    }
    set size(value)
    {
        this.uniforms.size = value;
    }

    get toss()
    {
        return this.uniforms.toss;
    }
    set toss(value)
    {
        this.uniforms.toss = value;
    }

    get fall()
    {
        return this.uniforms.fall;
    }
    set fall(value)
    {
        this.uniforms.fall = value;
    }

    get tumble()
    {
        return this.uniforms.tumble;
    }
    set tumble(value)
    {
        this.uniforms.tumble = value;
    }

    get emberColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.emberColor);
    }
    set emberColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.emberColor);
    }

    get darkColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.darkColor);
    }
    set darkColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.darkColor);
    }
}

FilterShedPlates.defaults = {
    time: 0,
    points: 10,
    drift: 0.12,
    period: 3.2,
    size: 0.05,
    toss: 0.15,
    fall: 0.06,
    tumble: 1,
    emberColor: 0xff7a2e,
    darkColor: 0x150b06,
    opacity: 1,
};
