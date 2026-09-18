import { customVertex2D, applyCustomFilter, GLSL_HASH1, setDirVFromDegrees } from '../filter-core.js';

// FilterRicochetLip: rounds come in along a bearing and die on the leading edge instead of landing.
// No alpha early-out: confine 0 lets the streaks fly through open ground.

const ricochetLipFragment = `
precision highp float;

uniform float time;
uniform float lanes;
uniform float laneTight;
uniform float flightPeriod;
uniform float trailLen;
uniform float hardness;
uniform float throughFloor;
uniform float lipWidth;
uniform float onSprite;
uniform float bodyFade;
uniform float confine;
uniform float roundStrength;
uniform float sparkStrength;
uniform float lipStrength;
uniform vec3 roundColor;
uniform vec3 sparkColor;
uniform vec3 lipColor;
uniform vec2 dirV;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

vec4 over(vec4 base, vec3 rgb, float a)
{
    return vec4(base.rgb * (1.0 - a) + rgb * a, base.a * (1.0 - a) + a);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    vec2 span = outputFrame.zw * inputSize.zw;
    vec2 b = normalize(dirV);
    vec2 d = vFilterCoord - 0.5;

    float along = dot(d, b);
    float across = dot(d, vec2(-b.y, b.x));

    // Each lane runs on its own clock so the rounds never arrive as a rank.
    float lane = floor(across * lanes);
    float ph = fract(time / flightPeriod + hash1(vec2(lane, 3.0)));
    float head = mix(-0.75, 0.75, ph);
    float inLane = exp(-abs(fract(across * lanes + 0.5) - 0.5) * laneTight);

    float blocked = 0.0;
    for (int i = 1; i < 9; i++) blocked = max(blocked, tapA(vTextureCoord - b * span * (0.025 * float(i))));
    float pass = (1.0 - blocked) + blocked * mix(0.95, throughFloor, hardness);

    float trail = step(along, head) * exp(-(head - along) / trailLen);
    float streak = trail * inLane * pass * (1.0 - pixel.a * bodyFade);

    // onSprite slides the lip from the free margin to just inside the leading edge.
    float outer = clamp(tapA(vTextureCoord + b * span * lipWidth) - pixel.a, 0.0, 1.0);
    float inner = clamp(pixel.a - tapA(vTextureCoord - b * span * lipWidth), 0.0, 1.0);
    float lip = mix(outer, inner, onSprite);

    float spark = exp(-abs(along - head) / mix(0.06, 0.014, hardness)) * lip * inLane;
    float mask = mix(1.0, pixel.a, confine);

    vec4 result = over(pixel, roundColor, clamp(streak * mask * roundStrength * opacity, 0.0, 1.0));
    result = over(result, sparkColor, clamp(spark * mask * mix(0.4, 1.5, hardness) * sparkStrength * opacity, 0.0, 1.0));
    result = over(result, lipColor, clamp(lip * mask * lipStrength * mix(0.35, 1.0, hardness) * opacity, 0.0, 1.0));

    gl_FragColor = result;
}
`;

export class FilterRicochetLip extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, ricochetLipFragment);

        this.uniforms.roundColor = new Float32Array([1.0, 0.85, 0.63]);
        this.uniforms.sparkColor = new Float32Array([1.0, 0.94, 0.75]);
        this.uniforms.lipColor = new Float32Array([0.60, 0.64, 0.68]);
        this.uniforms.dirV = new Float32Array([0.574, -0.819]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterRicochetLip.defaults);

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

    get lanes()
    {
        return this.uniforms.lanes;
    }
    set lanes(value)
    {
        this.uniforms.lanes = value;
    }

    get laneTight()
    {
        return this.uniforms.laneTight;
    }
    set laneTight(value)
    {
        this.uniforms.laneTight = value;
    }

    get flightPeriod()
    {
        return this.uniforms.flightPeriod;
    }
    set flightPeriod(value)
    {
        this.uniforms.flightPeriod = value;
    }

    get trailLen()
    {
        return this.uniforms.trailLen;
    }
    set trailLen(value)
    {
        this.uniforms.trailLen = value;
    }

    get hardness()
    {
        return this.uniforms.hardness;
    }
    set hardness(value)
    {
        this.uniforms.hardness = value;
    }

    get throughFloor()
    {
        return this.uniforms.throughFloor;
    }
    set throughFloor(value)
    {
        this.uniforms.throughFloor = value;
    }

    get lipWidth()
    {
        return this.uniforms.lipWidth;
    }
    set lipWidth(value)
    {
        this.uniforms.lipWidth = value;
    }

    get onSprite()
    {
        return this.uniforms.onSprite;
    }
    set onSprite(value)
    {
        this.uniforms.onSprite = value;
    }

    get bodyFade()
    {
        return this.uniforms.bodyFade;
    }
    set bodyFade(value)
    {
        this.uniforms.bodyFade = value;
    }

    get confine()
    {
        return this.uniforms.confine;
    }
    set confine(value)
    {
        this.uniforms.confine = value;
    }

    get roundStrength()
    {
        return this.uniforms.roundStrength;
    }
    set roundStrength(value)
    {
        this.uniforms.roundStrength = value;
    }

    get sparkStrength()
    {
        return this.uniforms.sparkStrength;
    }
    set sparkStrength(value)
    {
        this.uniforms.sparkStrength = value;
    }

    get lipStrength()
    {
        return this.uniforms.lipStrength;
    }
    set lipStrength(value)
    {
        this.uniforms.lipStrength = value;
    }

    get roundColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.roundColor);
    }
    set roundColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.roundColor);
    }

    get sparkColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.sparkColor);
    }
    set sparkColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.sparkColor);
    }

    get lipColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.lipColor);
    }
    set lipColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.lipColor);
    }

    // Compass bearing the rounds come from, same convention as the token ground shadow.
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

FilterRicochetLip.defaults = {
    time: 0,
    roundColor: 0xffd9a0,
    sparkColor: 0xfff0c0,
    lipColor: 0x9aa3ae,
    bearing: 215,
    lanes: 24,
    laneTight: 6,
    flightPeriod: 2.9,
    trailLen: 0.23,
    hardness: 0,
    throughFloor: 0.66,
    lipWidth: 0.004,
    onSprite: 1,
    bodyFade: 0.44,
    confine: 1,
    roundStrength: 1,
    sparkStrength: 1.1,
    lipStrength: 0.3,
    opacity: 1.0,
};
