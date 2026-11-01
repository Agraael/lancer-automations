import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

// FilterColdSoak: a cold front creeps up the chassis, draining colour and leaving frost in the thick parts.

const coldSoakFragment = `
precision highp float;

uniform float time;
uniform float frontPeriod;
uniform float depth;
uniform vec3 coldColor;
uniform vec3 frostColor;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

// 1 deep inside the silhouette, 0 at the contour, so the frost only settles on the mass.
float depthIn(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, tapA(uv + vec2(cos(a), sin(a)) * s));
    }
    return 1.0 - m;
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a < 0.01) {
        gl_FragColor = pixel;
        return;
    }

    float front = clamp(fract(time / frontPeriod) * 2.2, 0.0, 1.0);
    float below = smoothstep(front + 0.04, front - 0.04, vFilterCoord.y);

    vec3 c = pixel.rgb / max(pixel.a, 1e-4);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 cold = mix(c, vec3(l) * coldColor * 1.8, depth);

    float frost = smoothstep(0.55, 0.9, vnoise(vFilterCoord * 22.0)) * depthIn(vTextureCoord, 0.05);

    vec4 result = vec4(mix(c, cold, below) * pixel.a, pixel.a);
    result = over(result, frostColor, frost * below * 0.35 * pixel.a);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterColdSoak extends LaCustomFilter
{
    constructor(params)
    {
        super(coldSoakFragment, params, {
            coldColor: new Float32Array([0.22, 0.25, 0.30]),
            frostColor: new Float32Array([0.62, 0.77, 0.85]),
        });
    }

    get frontPeriod()
    {
        return this.uniforms.frontPeriod;
    }
    set frontPeriod(value)
    {
        this.uniforms.frontPeriod = value;
    }

    get depth()
    {
        return this.uniforms.depth;
    }
    set depth(value)
    {
        this.uniforms.depth = value;
    }

    get coldColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coldColor);
    }
    set coldColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coldColor);
    }

    get frostColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.frostColor);
    }
    set frostColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.frostColor);
    }
}

FilterColdSoak.defaults = {
    time: 0,
    frontPeriod: 6,
    coldColor: 0x38414d,
    frostColor: 0x9fc4d8,
    depth: 0.86,
    opacity: 1.0,
};
