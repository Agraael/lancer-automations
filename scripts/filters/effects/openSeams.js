import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

// FilterOpenSeams: plates contract toward their own centres, so the seam is where a plate actually moved.

const openSeamsFragment = `
precision highp float;

uniform float time;
uniform float blocks;
uniform float gapMin;
uniform float gapMax;
uniform float breathRate;
uniform float misalignChance;
uniform vec3 seamColor;
uniform vec3 seamCore;
uniform float seamGain;
uniform vec2 lightDir;
uniform vec3 lipColor;
uniform float lipGain;
uniform float lipW;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_HASH1}
${GLSL_HASH2}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uvSpan = outputFrame.zw * inputSize.zw;
    vec2 grid = vFilterCoord * blocks;
    vec2 cell = floor(grid);
    vec2 bl = fract(grid);

    // Each plate breathes on its own phase, so the opening ripples instead of pulsing as one.
    float gap = mix(gapMin, gapMax, 0.5 + 0.5 * cos(time * breathRate + hash1(cell) * 2.51));
    vec2 sh = (bl - 0.5) / max(1.0 - gap, 1e-3) + 0.5;

    // Stepped misalignment, never tweened.
    float k = mod(floor(time * 4.0), 512.0);
    sh += (hash2(cell + k * 23.0) - 0.5) * 0.3 * step(misalignChance, hash1(cell + k * 7.0));

    float outAmt = max(max(-sh.x, sh.x - 1.0), max(-sh.y, sh.y - 1.0));

    vec4 result;

    if (outAmt > 0.0)
    {
        // This texel is where a plate used to be. Gated by the original alpha so nothing leaks outside.
        float ratio = outAmt / max(gap, 1e-3);
        vec3 edge = mix(seamCore, seamColor, smoothstep(0.0, 0.5, ratio));
        float seamA = (1.0 - smoothstep(0.0, 0.4, ratio)) * pixel.a * seamGain;
        result = vec4(edge * seamA, seamA);
    }
    else
    {
        vec2 off = ((cell + sh) / blocks - vFilterCoord) * uvSpan;
        vec4 tap = texture2D(uSampler, clamp(vTextureCoord + off, inputClamp.xy, inputClamp.zw));
        vec2 e2 = abs(sh - 0.5) * 2.0;

        // One-sided lip: only the border face turned toward the light, which is what sells a lifted plate.
        vec2 face = step(e2.yx, e2.xy) * sign(sh - 0.5);
        float lit = max(0.0, dot(normalize(face + 1e-4), lightDir));
        float near = smoothstep(1.0 - lipW, 1.0, max(e2.x, e2.y));
        tap.rgb += lipColor * near * lit * lipGain * tap.a;
        result = tap;
    }

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterOpenSeams extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, openSeamsFragment);

        this.uniforms.seamColor = new Float32Array([1.0, 0.18, 0.24]);
        this.uniforms.seamCore = new Float32Array([1.0, 0.69, 0.63]);
        this.uniforms.lipColor = new Float32Array([0.85, 0.77, 0.69]);
        this.uniforms.lightDir = new Float32Array([0.707, -0.707]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterOpenSeams.defaults);

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

    get blocks()
    {
        return this.uniforms.blocks;
    }
    set blocks(value)
    {
        this.uniforms.blocks = value;
    }

    get gapMin()
    {
        return this.uniforms.gapMin;
    }
    set gapMin(value)
    {
        this.uniforms.gapMin = value;
    }

    get gapMax()
    {
        return this.uniforms.gapMax;
    }
    set gapMax(value)
    {
        this.uniforms.gapMax = value;
    }

    get breathRate()
    {
        return this.uniforms.breathRate;
    }
    set breathRate(value)
    {
        this.uniforms.breathRate = value;
    }

    get misalignChance()
    {
        return this.uniforms.misalignChance;
    }
    set misalignChance(value)
    {
        this.uniforms.misalignChance = value;
    }

    get seamColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.seamColor);
    }
    set seamColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.seamColor);
    }

    get seamCore()
    {
        return PIXI.utils.rgb2hex(this.uniforms.seamCore);
    }
    set seamCore(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.seamCore);
    }

    get seamGain()
    {
        return this.uniforms.seamGain;
    }
    set seamGain(value)
    {
        this.uniforms.seamGain = value;
    }

    get lipColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.lipColor);
    }
    set lipColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.lipColor);
    }

    get lipGain()
    {
        return this.uniforms.lipGain;
    }
    set lipGain(value)
    {
        this.uniforms.lipGain = value;
    }

    get lipW()
    {
        return this.uniforms.lipW;
    }
    set lipW(value)
    {
        this.uniforms.lipW = value;
    }

    // Compass bearing the light comes from, same convention as the token ground shadow.
    get lightAngle()
    {
        return this._lightAngle;
    }
    set lightAngle(value)
    {
        this._lightAngle = value;
        const radians = (value * Math.PI) / 180;
        this.uniforms.lightDir[0] = -Math.sin(radians);
        this.uniforms.lightDir[1] = Math.cos(radians);
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

FilterOpenSeams.defaults = {
    time: 0,
    blocks: 12,
    gapMin: 0.02,
    gapMax: 0.12,
    breathRate: 2.86,
    misalignChance: 0.92,
    seamColor: 0xff2d3c,
    seamCore: 0xffb0a0,
    seamGain: 1.0,
    lipColor: 0xd8c4b0,
    lipGain: 0.5,
    lipW: 0.12,
    lightAngle: 225,
    opacity: 1.0,
};
