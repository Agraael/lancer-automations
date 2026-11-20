import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE, setDirVFromDegrees } from '../filter-core.js';

const thermalScanFragment = `
precision highp float;

uniform float time;
uniform float period;
uniform float bandWidth;
uniform float linger;
uniform float strength;
uniform float depth;
uniform float grain;
uniform vec2 dirV;
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

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

vec3 thermal(float level)
{
    vec3 cold = vec3(0.03, 0.02, 0.1);
    vec3 violet = vec3(0.4, 0.05, 0.55);
    vec3 red = vec3(0.92, 0.12, 0.12);
    vec3 orange = vec3(1.0, 0.58, 0.08);
    vec3 white = vec3(1.0, 0.97, 0.8);
    return level < 0.25 ? mix(cold, violet, level * 4.0) : level < 0.5 ? mix(violet, red, (level - 0.25) * 4.0) : level < 0.75 ? mix(red, orange, (level - 0.5) * 4.0) : mix(orange, white, (level - 0.75) * 4.0);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float inside = smoothstep(0.9, 0.995, pixel.a);
    vec3 color = pixel.rgb / max(pixel.a, 1e-4);

    vec2 dir = normalize(dirV);
    float pos = dot(sprite - 0.5, dir) + 0.5;
    float cycle = fract(time / period);
    float front = cycle * 1.7 - 0.35;
    float behind = front - pos;
    float closing = 1.0 - smoothstep(0.85, 1.0, cycle);
    float lead = smoothstep(-0.02, 0.0, behind);

    float body = 0.0;
    if (inside > 0.0 && lead > 0.0 && closing > 0.0)
        body = (ringMinSolid(vTextureCoord, depth * 0.3) + ringMinSolid(vTextureCoord, depth * 0.6) + ringMinSolid(vTextureCoord, depth) + ringMinSolid(vTextureCoord, depth * 1.6)) * 0.25;
    float wobble = vnoise(sprite * 9.0 + vec2(0.0, time * 0.4)) - 0.5;
    float speck = hash1(floor(sprite * 160.0) + mod(floor(time * 15.0), 997.0)) - 0.5;
    float temperature = clamp(0.12 + body * 0.52 + dot(color, vec3(0.299, 0.587, 0.114)) * 0.32 + wobble * 0.1 + speck * grain * 0.08, 0.0, 1.0);
    float trail = exp(-max(behind - bandWidth, 0.0) / (linger * (0.15 + temperature * 1.6)));
    float reveal = lead * trail * closing * inside;
    float frontLine = (1.0 - smoothstep(0.0, 0.012, abs(behind))) * closing * inside;

    vec3 scanned = thermal(temperature) * (0.9 + 0.1 * step(0.5, fract(sprite.y * 110.0)));
    vec4 result = vec4(mix(color, scanned, reveal * strength) * pixel.a, pixel.a);
    result = over(result, vec3(1.0, 0.93, 0.8), frontLine * 0.75);
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterThermalScan extends LaCustomFilter
{
    constructor(params)
    {
        super(thermalScanFragment, params, {
            dirV: new Float32Array([0, -1]),
        });
        this.spriteCoords = true;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get bandWidth()
    {
        return this.uniforms.bandWidth;
    }
    set bandWidth(value)
    {
        this.uniforms.bandWidth = value;
    }

    get linger()
    {
        return this.uniforms.linger;
    }
    set linger(value)
    {
        this.uniforms.linger = value;
    }

    get strength()
    {
        return this.uniforms.strength;
    }
    set strength(value)
    {
        this.uniforms.strength = value;
    }

    get depth()
    {
        return this.uniforms.depth;
    }
    set depth(value)
    {
        this.uniforms.depth = value;
    }

    get grain()
    {
        return this.uniforms.grain;
    }
    set grain(value)
    {
        this.uniforms.grain = value;
    }

    get tilt()
    {
        return this._tilt;
    }
    set tilt(value)
    {
        this._tilt = value;
        setDirVFromDegrees(this.uniforms, value);
    }
}

FilterThermalScan.defaults = {
    time: 0,
    period: 3.2,
    tilt: 180,
    bandWidth: 0.18,
    linger: 0.25,
    strength: 0.9,
    depth: 0.07,
    grain: 0.6,
    opacity: 1,
};
