import { LaCustomFilter, GLSL_FILTER_INPUTS } from '../filter-core.js';

const outOfFocusFragment = `
precision highp float;

uniform float time;
uniform float minBlur;
uniform float maxBlur;
uniform float period;
uniform float haze;
uniform vec3 hazeColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

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

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    float focus = smoothstep(0.0, 1.0, 0.5 + 0.5 * sin(time * 6.2832 / period));
    vec2 spread = texPerSprite() * mix(minBlur, maxBlur, focus);

    vec4 blurred = pixel * 0.2;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.785398 + 0.39;
        vec2 offset = vec2(cos(angle), sin(angle)) * spread;
        blurred += tapC(vTextureCoord + offset) * 0.06 + tapC(vTextureCoord + offset * 0.5) * 0.04;
    }

    vec3 color = blurred.rgb / max(blurred.a, 1e-4);
    color = mix(color, color * 0.75 + hazeColor * 0.3, haze * (0.6 + 0.4 * focus));
    vec4 result = vec4(clamp(color, 0.0, 1.0) * blurred.a, blurred.a);
    result = over(result, hazeColor, clamp((blurred.a - pixel.a) * haze * 1.5, 0.0, 1.0) * (1.0 - solidA(pixel.a)));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterOutOfFocus extends LaCustomFilter
{
    constructor(params)
    {
        super(outOfFocusFragment, params, {
            hazeColor: new Float32Array([0.87, 0.9, 0.94]),
        });
        this.spriteCoords = true;
    }

    get minBlur()
    {
        return this.uniforms.minBlur;
    }
    set minBlur(value)
    {
        this.uniforms.minBlur = value;
    }

    get maxBlur()
    {
        return this.uniforms.maxBlur;
    }
    set maxBlur(value)
    {
        this.uniforms.maxBlur = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get haze()
    {
        return this.uniforms.haze;
    }
    set haze(value)
    {
        this.uniforms.haze = value;
    }

    get hazeColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hazeColor);
    }
    set hazeColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hazeColor);
    }
}

FilterOutOfFocus.defaults = {
    time: 0,
    minBlur: 0.012,
    maxBlur: 0.035,
    period: 3.4,
    haze: 0.35,
    hazeColor: 0xdfe6f0,
    opacity: 1,
};
