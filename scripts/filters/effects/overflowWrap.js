import { LaCustomFilter } from '../filter-core.js';

// FilterOverflowWrap: banding that crawls down the chassis, phase-shifted by local brightness so it wraps the shape.

const overflowWrapFragment = `
precision highp float;

uniform float time;
uniform float period;
uniform float lines;
uniform float thickness;
uniform vec3 lineColor;
uniform float opacity;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

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

    vec3 c = pixel.rgb / max(pixel.a, 1e-4);
    float shade = dot(c, vec3(0.299, 0.587, 0.114));

    float phase = fract(vFilterCoord.y * lines - time / period + shade * 0.6);
    float line = smoothstep(1.0 - thickness, 1.0, phase);

    vec4 result = over(pixel, lineColor, line * (0.35 + 0.8 * shade) * pixel.a);
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterOverflowWrap extends LaCustomFilter
{
    constructor(params)
    {
        super(overflowWrapFragment, params, { lineColor: new Float32Array([0.62, 0.62, 0.62]) });
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get lines()
    {
        return this.uniforms.lines;
    }
    set lines(value)
    {
        this.uniforms.lines = value;
    }

    get thickness()
    {
        return this.uniforms.thickness;
    }
    set thickness(value)
    {
        this.uniforms.thickness = value;
    }

    get lineColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.lineColor);
    }
    set lineColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.lineColor);
    }
}

FilterOverflowWrap.defaults = {
    time: 0,
    lineColor: 0x9e9e9e,
    period: 1.1,
    lines: 8,
    thickness: 0.33,
    opacity: 1.0,
};
