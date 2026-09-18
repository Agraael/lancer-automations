import { customVertex2D, applyCustomFilter, setDirVFromDegrees } from '../filter-core.js';

// FilterNoDrift: a shear ghost leaning further off the body each cycle, then snapped back on the rim.
// No alpha early-out: the ghost is drawn exactly where the body is not.

const noDriftFragment = `
precision highp float;

uniform float time;
uniform float tryPeriod;
uniform float slip;
uniform float ghostStrength;
uniform float holdStrength;
uniform float snapStrength;
uniform vec3 ghostColor;
uniform vec3 snapColor;
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

    vec2 b = normalize(dirV);
    float ph = fract(time / tryPeriod);

    // Long creep out, then a short window where it is yanked home.
    float push = smoothstep(0.0, 0.7, ph) - smoothstep(0.72, 0.8, ph);
    float g = tapA(vTextureCoord - b * outputFrame.zw * inputSize.zw * push * slip);
    float ghost = clamp(g - pixel.a, 0.0, 1.0) * (0.3 + 0.7 * push) * ghostStrength;

    float rim = clamp(pixel.a - ringMin(vTextureCoord, 0.012), 0.0, 1.0);
    float snap = exp(-fract(ph - 0.76 + 1.0) / 0.05);

    vec4 result = over(pixel, snapColor, clamp(rim * holdStrength * opacity, 0.0, 1.0));
    result = over(result, ghostColor, clamp(ghost * opacity, 0.0, 1.0));
    result = over(result, snapColor, clamp(rim * snap * snapStrength * opacity, 0.0, 1.0));

    gl_FragColor = result;
}
`;

export class FilterNoDrift extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, noDriftFragment);

        this.uniforms.ghostColor = new Float32Array([0.58, 0.65, 0.72]);
        this.uniforms.snapColor = new Float32Array([0.91, 0.95, 1.0]);
        this.uniforms.dirV = new Float32Array([0.0, -1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterNoDrift.defaults);

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

    get tryPeriod()
    {
        return this.uniforms.tryPeriod;
    }
    set tryPeriod(value)
    {
        this.uniforms.tryPeriod = value;
    }

    get slip()
    {
        return this.uniforms.slip;
    }
    set slip(value)
    {
        this.uniforms.slip = value;
    }

    get ghostStrength()
    {
        return this.uniforms.ghostStrength;
    }
    set ghostStrength(value)
    {
        this.uniforms.ghostStrength = value;
    }

    get holdStrength()
    {
        return this.uniforms.holdStrength;
    }
    set holdStrength(value)
    {
        this.uniforms.holdStrength = value;
    }

    get snapStrength()
    {
        return this.uniforms.snapStrength;
    }
    set snapStrength(value)
    {
        this.uniforms.snapStrength = value;
    }

    get ghostColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.ghostColor);
    }
    set ghostColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.ghostColor);
    }

    get snapColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.snapColor);
    }
    set snapColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.snapColor);
    }

    // Compass bearing the push comes from, same convention as the token ground shadow.
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

FilterNoDrift.defaults = {
    time: 0,
    ghostColor: 0x94a6b8,
    snapColor: 0xe8f2ff,
    bearing: 180,
    tryPeriod: 3.4,
    slip: 0.03,
    ghostStrength: 0.3,
    holdStrength: 0.15,
    snapStrength: 0.75,
    opacity: 1.0,
};
