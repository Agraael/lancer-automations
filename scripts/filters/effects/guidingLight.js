import { customVertex2D, applyCustomFilter, setDirVFromDegrees } from '../filter-core.js';

// FilterGuidingLight: a key light from the helper's side with a gleam travelling the lit contour.

const guidingLightFragment = `
precision highp float;

uniform float time;
uniform float rimWidth;
uniform float sweepPeriod;
uniform float gleamWidth;
uniform float keyLight;
uniform float gleamGain;
uniform float rimStrength;
uniform vec3 aidColor;
uniform vec2 dirV;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

float ringMin(vec2 uv, float r)
{
    vec2 s = outputFrame.zw * inputSize.zw * r;
    float m = 1.0;
    for (int i = 0; i < 8; i++)
    {
        float a = float(i) * 0.7853982;
        m = min(m, tapA(uv + vec2(cos(a), sin(a)) * s));
    }
    return m;
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 b = normalize(dirV);
    vec2 d = vFilterCoord - 0.5;

    // Only the face turned toward the helper picks the light up, so the far side stays untouched.
    float lit = pow(clamp(dot(normalize(d + vec2(1e-5)), b), 0.0, 1.0), 1.6);
    float along = dot(d, vec2(-b.y, b.x));
    float gleam = exp(-abs(along - (fract(time / sweepPeriod) * 1.4 - 0.7)) / gleamWidth);

    float rim = clamp(pixel.a - ringMin(vTextureCoord, rimWidth), 0.0, 1.0);

    vec3 c = pixel.rgb / max(pixel.a, 1e-4);
    c += aidColor * lit * dot(c, vec3(0.299, 0.587, 0.114)) * (keyLight + gleamGain * gleam);

    vec4 result = vec4(c * pixel.a, pixel.a);
    result = over(result, aidColor, clamp(rim * lit * (0.25 + 1.4 * gleam) * rimStrength * opacity, 0.0, 1.0));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterGuidingLight extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, guidingLightFragment);

        this.uniforms.aidColor = new Float32Array([0.66, 0.94, 0.78]);
        this.uniforms.dirV = new Float32Array([0.5, -0.866]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterGuidingLight.defaults);

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

    get rimWidth()
    {
        return this.uniforms.rimWidth;
    }
    set rimWidth(value)
    {
        this.uniforms.rimWidth = value;
    }

    get sweepPeriod()
    {
        return this.uniforms.sweepPeriod;
    }
    set sweepPeriod(value)
    {
        this.uniforms.sweepPeriod = value;
    }

    get gleamWidth()
    {
        return this.uniforms.gleamWidth;
    }
    set gleamWidth(value)
    {
        this.uniforms.gleamWidth = value;
    }

    get keyLight()
    {
        return this.uniforms.keyLight;
    }
    set keyLight(value)
    {
        this.uniforms.keyLight = value;
    }

    get gleamGain()
    {
        return this.uniforms.gleamGain;
    }
    set gleamGain(value)
    {
        this.uniforms.gleamGain = value;
    }

    get rimStrength()
    {
        return this.uniforms.rimStrength;
    }
    set rimStrength(value)
    {
        this.uniforms.rimStrength = value;
    }

    get aidColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.aidColor);
    }
    set aidColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.aidColor);
    }

    // Compass bearing the helper stands at, same convention as the token ground shadow.
    get bearing()
    {
        return this._bearing;
    }
    set bearing(value)
    {
        this._bearing = value;
        setDirVFromDegrees(this.uniforms, value);
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

FilterGuidingLight.defaults = {
    time: 0,
    aidColor: 0xa9f0c6,
    bearing: 150,
    rimWidth: 0.02,
    sweepPeriod: 2.6,
    gleamWidth: 0.22,
    keyLight: 0.85,
    gleamGain: 1.55,
    rimStrength: 0.45,
    opacity: 1.0,
};
