import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

// FilterVentColumn: heat shear across the upper chassis with a plume climbing off the silhouette above it.
// No alpha early-out: the plume lives where the sprite is not.

const ventColumnFragment = `
precision highp float;

uniform float time;
uniform float warpFreq;
uniform float warpAmp;
uniform float riseSpeed;
uniform float reach;
uniform float plumeFreq;
uniform float plumeStrength;
uniform float bodyGlow;
uniform vec3 hotColor;
uniform vec3 plumeColor;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}
${GLSL_VNOISE}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 raw = texture2D(uSampler, vTextureCoord);
    vec2 uvSpan = outputFrame.zw * inputSize.zw;

    float upper = smoothstep(0.75, 0.15, vFilterCoord.y);
    float shear = vnoise(vec2(vFilterCoord.x * warpFreq, vFilterCoord.y * 6.0 + time * riseSpeed)) - 0.5;
    vec4 pixel = tapC(vTextureCoord + vec2(shear * warpAmp * upper, 0.0) * uvSpan);

    // The plume is seeded by whatever chassis sits below this texel, so it follows the shoulders.
    float lift = 0.0;
    for (int i = 1; i < 10; i++)
    {
        float k = float(i);
        lift = max(lift, tapC(vTextureCoord + vec2(0.0, reach * k * 0.1) * uvSpan).a * (1.0 - k * 0.1));
    }

    float col = smoothstep(0.42, 0.95, vnoise(vec2(vFilterCoord.x * plumeFreq, vFilterCoord.y * 3.0 + time * riseSpeed * 1.7)));

    vec4 result = pixel;
    result = over(result, hotColor, clamp(upper * pixel.a * smoothstep(0.3, 0.9, col) * bodyGlow * opacity, 0.0, 1.0));
    result = over(result, plumeColor, clamp(lift * (1.0 - pixel.a) * col * plumeStrength * opacity, 0.0, 1.0));

    gl_FragColor = mix(raw, result, opacity);
}
`;

export class FilterVentColumn extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, ventColumnFragment);

        this.uniforms.hotColor = new Float32Array([1.0, 0.55, 0.23]);
        this.uniforms.plumeColor = new Float32Array([1.0, 0.81, 0.60]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterVentColumn.defaults);

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

    get warpFreq()
    {
        return this.uniforms.warpFreq;
    }
    set warpFreq(value)
    {
        this.uniforms.warpFreq = value;
    }

    get warpAmp()
    {
        return this.uniforms.warpAmp;
    }
    set warpAmp(value)
    {
        this.uniforms.warpAmp = value;
    }

    get riseSpeed()
    {
        return this.uniforms.riseSpeed;
    }
    set riseSpeed(value)
    {
        this.uniforms.riseSpeed = value;
    }

    get reach()
    {
        return this.uniforms.reach;
    }
    set reach(value)
    {
        this.uniforms.reach = value;
    }

    get plumeFreq()
    {
        return this.uniforms.plumeFreq;
    }
    set plumeFreq(value)
    {
        this.uniforms.plumeFreq = value;
    }

    get plumeStrength()
    {
        return this.uniforms.plumeStrength;
    }
    set plumeStrength(value)
    {
        this.uniforms.plumeStrength = value;
    }

    get bodyGlow()
    {
        return this.uniforms.bodyGlow;
    }
    set bodyGlow(value)
    {
        this.uniforms.bodyGlow = value;
    }

    get hotColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hotColor);
    }
    set hotColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hotColor);
    }

    get plumeColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.plumeColor);
    }
    set plumeColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.plumeColor);
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

FilterVentColumn.defaults = {
    time: 0,
    warpFreq: 16,
    warpAmp: 0.012,
    riseSpeed: 1.4,
    reach: 0.07,
    plumeFreq: 17,
    plumeStrength: 1.2,
    bodyGlow: 0.55,
    hotColor: 0xff8442,
    plumeColor: 0xfeb76c,
    opacity: 1.0,
};
