import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

// FilterThermalSplit: ridged noise draws seams across the plating, drifting slowly and blooming as they open.

const thermalSplitFragment = `
precision highp float;

uniform float time;
uniform float crackScale;
uniform float breathPeriod;
uniform float widthMin;
uniform float widthMax;
uniform float driftSpeed;
uniform float bloom;
uniform float heat;
uniform float coreAmt;
uniform float charAmt;
uniform float writheAmp;
uniform float writheRate;
uniform float flowRate;
uniform float flowDepth;
uniform vec3 hotColor;
uniform vec3 charColor;
uniform vec3 coreColor;
uniform float opacity;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}
${GLSL_VNOISE}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 q = vFilterCoord * crackScale + vec2(time * driftSpeed * 0.3, time * driftSpeed * 0.11);

    // Warping by its own drifting noise makes each seam snake, where a plain time offset slid them as one sheet.
    vec2 warp = vec2(vnoise(q * 0.5 + vec2(0.0, time * writheRate)),
                     vnoise(q * 0.5 + vec2(5.3, -time * writheRate * 0.8))) - 0.5;
    float noise = vnoise(q + warp * writheAmp);
    float ridge = 1.0 - abs(noise * 2.0 - 1.0);

    float region = vnoise(q * 0.3 + vec2(31.0, 17.0));
    float open = 0.5 + 0.5 * sin(time * 6.28318 / breathPeriod + region * 6.28318);
    float w = mix(widthMin, widthMax, open);

    // Four nested widths off the same ridge: white centre, hot line, char shoulders, bloom.
    float core = smoothstep(1.0 - w * 0.35, 1.0, ridge) * pixel.a;
    float crack = smoothstep(1.0 - w, 1.0, ridge) * pixel.a;
    float scorch = smoothstep(1.0 - w * 2.4, 1.0, ridge) * pixel.a;
    float halo = smoothstep(1.0 - w * 5.0, 1.0, ridge) * pixel.a;

    // Phase tied to a coarser sample of the same field, so bright patches run along a seam, not across it.
    float along = vnoise(q * 0.55 + vec2(11.0, 3.0)) * 6.0 + dot(vFilterCoord, vec2(7.0, 5.0));
    float flow = 0.5 + 0.5 * sin(along * 3.14159 - time * flowRate * 6.28318);
    float live = mix(1.0, flow, flowDepth);

    vec3 c = pixel.rgb / max(pixel.a, 1e-4);
    c = mix(c, charColor, clamp((scorch - crack) * charAmt, 0.0, 1.0));
    c += hotColor * halo * bloom * (0.25 + 0.75 * open) * 0.5;
    c = mix(c, hotColor * (0.8 + 0.6 * open), clamp(crack * heat * live, 0.0, 1.0));
    c = mix(c, coreColor, clamp(core * coreAmt * live, 0.0, 1.0));

    gl_FragColor = mix(pixel, vec4(c * pixel.a, pixel.a), opacity);
}
`;

export class FilterThermalSplit extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, thermalSplitFragment);

        this.uniforms.hotColor = new Float32Array([1.0, 0.10, 0.0]);
        this.uniforms.charColor = new Float32Array([0.16, 0.08, 0.06]);
        this.uniforms.coreColor = new Float32Array([1.0, 0.96, 0.87]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterThermalSplit.defaults);

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

    get crackScale()
    {
        return this.uniforms.crackScale;
    }
    set crackScale(value)
    {
        this.uniforms.crackScale = value;
    }

    get breathPeriod()
    {
        return this.uniforms.breathPeriod;
    }
    set breathPeriod(value)
    {
        this.uniforms.breathPeriod = value;
    }

    get widthMin()
    {
        return this.uniforms.widthMin;
    }
    set widthMin(value)
    {
        this.uniforms.widthMin = value;
    }

    get widthMax()
    {
        return this.uniforms.widthMax;
    }
    set widthMax(value)
    {
        this.uniforms.widthMax = value;
    }

    get driftSpeed()
    {
        return this.uniforms.driftSpeed;
    }
    set driftSpeed(value)
    {
        this.uniforms.driftSpeed = value;
    }

    get bloom()
    {
        return this.uniforms.bloom;
    }
    set bloom(value)
    {
        this.uniforms.bloom = value;
    }

    get heat()
    {
        return this.uniforms.heat;
    }
    set heat(value)
    {
        this.uniforms.heat = value;
    }

    get coreAmt()
    {
        return this.uniforms.coreAmt;
    }
    set coreAmt(value)
    {
        this.uniforms.coreAmt = value;
    }

    get charAmt()
    {
        return this.uniforms.charAmt;
    }
    set charAmt(value)
    {
        this.uniforms.charAmt = value;
    }

    get writheAmp()
    {
        return this.uniforms.writheAmp;
    }
    set writheAmp(value)
    {
        this.uniforms.writheAmp = value;
    }

    get writheRate()
    {
        return this.uniforms.writheRate;
    }
    set writheRate(value)
    {
        this.uniforms.writheRate = value;
    }

    get flowRate()
    {
        return this.uniforms.flowRate;
    }
    set flowRate(value)
    {
        this.uniforms.flowRate = value;
    }

    get flowDepth()
    {
        return this.uniforms.flowDepth;
    }
    set flowDepth(value)
    {
        this.uniforms.flowDepth = value;
    }

    get coreColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coreColor);
    }
    set coreColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coreColor);
    }

    get hotColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.hotColor);
    }
    set hotColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.hotColor);
    }

    get charColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.charColor);
    }
    set charColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.charColor);
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

FilterThermalSplit.defaults = {
    time: 0,
    hotColor: 0xff1900,
    charColor: 0x2a1410,
    coreColor: 0xfef6de,
    crackScale: 13.5,
    breathPeriod: 2.6,
    widthMin: 0.0,
    widthMax: 0.04,
    driftSpeed: 0.75,
    writheAmp: 1.25,
    writheRate: 0.18,
    bloom: 0.95,
    heat: 1.65,
    coreAmt: 0.9,
    charAmt: 0.75,
    flowRate: 0.66,
    flowDepth: 0.6,
    opacity: 0.97,
};
