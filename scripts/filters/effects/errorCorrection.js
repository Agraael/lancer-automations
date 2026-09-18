import { customVertex2D, applyCustomFilter } from '../filter-core.js';

// FilterErrorCorrection: a band sweeps up the chassis and sharpens contrast as it passes.

const errorCorrectionFragment = `
precision highp float;

uniform float time;
uniform float bandWidth;
uniform float period;
uniform float boost;
uniform vec3 bandColor;
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

    float sweep = 1.0 - fract(time / period);
    float band = 1.0 - smoothstep(0.0, bandWidth, abs(vFilterCoord.y - sweep));

    vec3 c = pixel.rgb / max(pixel.a, 1e-4);
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    vec3 crisp = clamp((c - 0.5) * (1.0 + boost) + 0.5, 0.0, 1.0);

    vec4 result = vec4(mix(c, crisp, band) * pixel.a, pixel.a);
    result = over(result, bandColor, band * 0.28 * pixel.a * (0.4 + l));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterErrorCorrection extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, errorCorrectionFragment);

        this.uniforms.bandColor = new Float32Array([0.50, 0.91, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterErrorCorrection.defaults);

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

    get bandWidth()
    {
        return this.uniforms.bandWidth;
    }
    set bandWidth(value)
    {
        this.uniforms.bandWidth = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get boost()
    {
        return this.uniforms.boost;
    }
    set boost(value)
    {
        this.uniforms.boost = value;
    }

    get bandColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.bandColor);
    }
    set bandColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.bandColor);
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

FilterErrorCorrection.defaults = {
    time: 0,
    bandColor: 0x7fe8ff,
    bandWidth: 0.09,
    period: 2.7,
    boost: 0,
    opacity: 1.0,
};
