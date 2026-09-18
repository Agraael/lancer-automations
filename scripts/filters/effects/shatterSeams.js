import { customVertex2D, applyCustomFilter, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

// FilterShatterSeams: openSeams on Voronoi plates instead of a square grid, so the shards are irregular.
// jitter 0 collapses the sites back onto the grid and gives you squares again.

const shatterSeamsFragment = `
precision highp float;

uniform float time;
uniform float blocks;
uniform float jitter;
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

vec2 siteAt(vec2 cell)
{
    return cell + 0.5 + (hash2(cell) - 0.5) * jitter;
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uvSpan = outputFrame.zw * inputSize.zw;
    vec2 g = vFilterCoord * blocks;
    vec2 gi = floor(g);
    vec2 gf = fract(g);

    vec2 site = vec2(0.5);
    vec2 cell = gi;
    float best = 8.0;
    for (int y = -1; y <= 1; y++)
    {
        for (int x = -1; x <= 1; x++)
        {
            vec2 nb = vec2(float(x), float(y));
            vec2 s = siteAt(gi + nb) - gi;
            float dist = dot(s - gf, s - gf);
            if (dist < best) { best = dist; site = s; cell = gi + nb; }
        }
    }

    // Second pass: distance to the bisector with every other site is the distance to the plate border.
    float edge = 8.0;
    for (int y = -1; y <= 1; y++)
    {
        for (int x = -1; x <= 1; x++)
        {
            vec2 s = siteAt(gi + vec2(float(x), float(y))) - gi;
            vec2 diff = s - site;
            float len = length(diff);
            // Distance from the midpoint back toward us, so it is positive inside our own plate.
            if (len > 0.001)
                edge = min(edge, dot(0.5 * (s + site) - gf, diff / len));
        }
    }

    float gap = mix(gapMin, gapMax, 0.5 + 0.5 * cos(time * breathRate + hash1(cell) * 2.51));
    float inset = gap * 0.5;

    vec4 result;

    if (edge < inset)
    {
        // Vacated by the shrinking plate. Gated by the original alpha so nothing leaks outside.
        float depth = 1.0 - edge / max(inset, 1e-4);
        vec3 tone = mix(seamCore, seamColor, smoothstep(0.0, 1.0, depth));
        float seamA = (1.0 - smoothstep(0.0, 0.85, depth)) * pixel.a * seamGain;
        result = vec4(tone * seamA, seamA);
    }
    else
    {
        vec2 centre = (gi + site) / blocks;
        vec2 pulled = centre + (vFilterCoord - centre) / max(1.0 - gap, 1e-3);

        // Stepped misalignment, never tweened.
        float k = mod(floor(time * 4.0), 512.0);
        pulled += (hash2(cell + k * 23.0) - 0.5) * 0.3 * step(misalignChance, hash1(cell + k * 7.0)) / blocks;

        vec4 tap = texture2D(uSampler, clamp(vTextureCoord + (pulled - vFilterCoord) * uvSpan, inputClamp.xy, inputClamp.zw));

        // One-sided lip on the shard face turned toward the light.
        float lit = max(0.0, dot(normalize(vFilterCoord - centre + 1e-5), lightDir));
        float near = smoothstep(1.0 - lipW, 1.0, 1.0 - edge * 2.0);
        tap.rgb += lipColor * near * lit * lipGain * tap.a;
        result = tap;
    }

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterShatterSeams extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, shatterSeamsFragment);

        this.uniforms.seamColor = new Float32Array([1.0, 0.0, 0.07]);
        this.uniforms.seamCore = new Float32Array([1.0, 0.58, 0.50]);
        this.uniforms.lipColor = new Float32Array([1.0, 0.93, 0.86]);
        this.uniforms.lightDir = new Float32Array([0.707, -0.707]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterShatterSeams.defaults);

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

    get jitter()
    {
        return this.uniforms.jitter;
    }
    set jitter(value)
    {
        this.uniforms.jitter = value;
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

FilterShatterSeams.defaults = {
    time: 0,
    blocks: 14,
    jitter: 0.85,
    gapMin: 0.0,
    gapMax: 0.105,
    breathRate: 3.5,
    misalignChance: 1,
    seamColor: 0xff0011,
    seamCore: 0xff9580,
    seamGain: 1.0,
    lipColor: 0xffeddb,
    lipGain: 0.4,
    lipW: 0.08,
    lightAngle: 30,
    opacity: 0.96,
};
