import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE } from '../filter-core.js';

const naniteSwarmFragment = `
precision highp float;

uniform float time;
uniform float cells;
uniform float moteSize;
uniform float density;
uniform vec3 nanite;
uniform vec3 dim;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}
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

float ringMax(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 0.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = max(m, texture2D(uSampler, clamp(uv + vec2(cos(a), sin(a)) * s, inputClamp.xy, inputClamp.zw)).a);
    }
    return m;
}

float band(float v, float t, float w)
{
    return smoothstep(t - w, t + w, v);
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    float solid = step(0.55, pixel.a);
    float near = step(0.5, ringMax(vTextureCoord, 0.012));
    float swarm = fbm(vFilterCoord * 3.0 + vec2(mod(time * 0.12, 512.0), -mod(time * 0.07, 512.0)));
    float blinkTime = mod(time, 4096.0);

    float motes = 0.0;
    for (int layer = 0; layer < 2; layer++)
    {
        float fl = float(layer);
        float sc = cells * (1.0 + fl * 0.8);
        vec2 g = vFilterCoord * sc + fl * 3.7;
        vec2 id = floor(g);
        vec2 f = fract(g);
        vec2 h = hash2(id + fl * 9.1);
        float ph = blinkTime * (0.6 + h.x * 1.2) + h.y * 6.2832;
        vec2 c = vec2(0.5) + 0.3 * vec2(cos(ph), sin(ph * 1.3));
        vec2 dv = abs(f - c);
        float sz = moteSize * (1.0 - fl * 0.35);
        float on = step(1.0 - swarm * density, h.x * 0.5 + h.y * 0.5);
        float blink = step(0.25, fract(blinkTime * 3.0 + h.y * 7.0));
        motes += on * blink * (1.0 - step(sz, max(dv.x, dv.y)));
    }
    motes = clamp(motes, 0.0, 1.0) * near;

    float haze = (1.0 - solid) * ringMax(vTextureCoord, 0.025) * band(swarm, 0.5, 0.1) * 0.35;
    float tint = solid * band(swarm, 0.55, 0.08) * 0.25;

    vec4 result = pixel;
    result = over(result, dim, tint);
    result = over(result, nanite, haze);
    result = over(result, nanite, motes);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterNaniteSwarm extends LaCustomFilter
{
    constructor(params)
    {
        super(naniteSwarmFragment, params, {
            nanite: new Float32Array([0.62, 1.0, 0.35]),
            dim: new Float32Array([0.18, 0.42, 0.12]),
        });
    }

    get cells()
    {
        return this.uniforms.cells;
    }
    set cells(value)
    {
        this.uniforms.cells = value;
    }

    get moteSize()
    {
        return this.uniforms.moteSize;
    }
    set moteSize(value)
    {
        this.uniforms.moteSize = value;
    }

    get density()
    {
        return this.uniforms.density;
    }
    set density(value)
    {
        this.uniforms.density = value;
    }

    get nanite()
    {
        return PIXI.utils.rgb2hex(this.uniforms.nanite);
    }
    set nanite(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.nanite);
    }

    get dim()
    {
        return PIXI.utils.rgb2hex(this.uniforms.dim);
    }
    set dim(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.dim);
    }
}

FilterNaniteSwarm.defaults = {
    time: 0,
    cells: 50,
    moteSize: 0.2,
    density: 0.85,
    nanite: 0x9dff5a,
    dim: 0x2d6b1e,
    opacity: 0.64,
};
