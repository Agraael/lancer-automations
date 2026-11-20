import { LaCustomFilter, GLSL_FILTER_INPUTS, setDirVFromDegrees } from '../filter-core.js';

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
uniform float inkStrength;
uniform float inkHold;
uniform float inkW;
uniform vec3 ghostColor;
uniform vec3 snapColor;
uniform vec3 inkColor;
uniform vec2 dirV;
${GLSL_FILTER_INPUTS}

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

float ringMax(vec2 uv, float radius)
{
    vec2 span = outputFrame.zw * inputSize.zw * radius;
    float highest = 0.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982;
        highest = max(highest, tapA(uv + vec2(cos(angle), sin(angle)) * span));
    }
    return highest;
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

    float rim = clamp(pixel.a - ringMin(vTextureCoord, 0.012), 0.0, 1.0) * smoothstep(0.9, 0.995, pixel.a);
    float snap = exp(-fract(ph - 0.76 + 1.0) / 0.05);
    float outside = clamp(ringMax(vTextureCoord, inkW) - pixel.a, 0.0, 1.0);

    vec4 result = over(pixel, inkColor, clamp(outside * inkStrength * (inkHold + (1.0 - inkHold) * snap) * opacity, 0.0, 1.0));
    result = over(result, snapColor, clamp(rim * holdStrength * opacity, 0.0, 1.0));
    result = over(result, ghostColor, clamp(ghost * opacity, 0.0, 1.0));
    result = over(result, snapColor, clamp(rim * snap * snapStrength * opacity, 0.0, 1.0));

    gl_FragColor = result;
}
`;

export class FilterNoDrift extends LaCustomFilter
{
    constructor(params)
    {
        super(noDriftFragment, params, {
            ghostColor: new Float32Array([0.58, 0.65, 0.72]),
            snapColor: new Float32Array([0.91, 0.95, 1.0]),
            inkColor: new Float32Array([0.04, 0.06, 0.09]),
            dirV: new Float32Array([0.0, -1.0]),
        });
    }

    get inkStrength()
    {
        return this.uniforms.inkStrength;
    }
    set inkStrength(value)
    {
        this.uniforms.inkStrength = value;
    }

    get inkHold()
    {
        return this.uniforms.inkHold;
    }
    set inkHold(value)
    {
        this.uniforms.inkHold = value;
    }

    get inkW()
    {
        return this.uniforms.inkW;
    }
    set inkW(value)
    {
        this.uniforms.inkW = value;
    }

    get inkColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.inkColor);
    }
    set inkColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.inkColor);
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
    inkStrength: 0,
    inkHold: 0,
    inkW: 0.011,
    inkColor: 0x0b1016,
    opacity: 1.0,
};
