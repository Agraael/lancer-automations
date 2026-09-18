import { customVertex2D, applyCustomFilter } from '../filter-core.js';

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

export class FilterOverflowWrap extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, overflowWrapFragment);

        this.uniforms.lineColor = new Float32Array([0.62, 0.62, 0.62]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterOverflowWrap.defaults);

        this._timeSpeed = params?.timeSpeed ?? 1.0;
        this._lastTime = performance.now();

        this.zOrder = 200;
        this.animated = {};
        this.setTMParams(params);
        if (!this.dummy)
            this.normalizeTMParams();
    }

    apply(filterManager, input, output, clear)
    {
        applyCustomFilter(this, filterManager, input, output, clear);
    }

    get time()
    {
        return this.uniforms.time;
    }
    set time(value)
    {
        this.uniforms.time = value;
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

    get opacity()
    {
        return this.uniforms.opacity;
    }
    set opacity(value)
    {
        this.uniforms.opacity = value;
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
