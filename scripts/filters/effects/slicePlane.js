import { customVertex2D, applyCustomFilter, setDirVFromDegrees } from '../filter-core.js';

// FilterSlicePlane: a cut travels across the chassis and the two halves slide apart along it, then close.
// No alpha early-out: the displaced half lands where the sprite is not.

const slicePlaneFragment = `
precision highp float;

uniform float time;
uniform float slide;
uniform float rate;
uniform float bounce;
uniform float travel;
uniform vec3 edgeColor;
uniform vec2 dirV;
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

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
    vec4 orig = texture2D(uSampler, vTextureCoord);

    vec2 n = normalize(dirV);
    float ph = fract(time * rate);

    // bounce 1 runs the cut back and forth, bounce 0 sends it one way and restarts.
    float sweep = mix(ph, abs(ph * 2.0 - 1.0), step(0.5, bounce));
    float cutPos = mix(-travel, travel, sweep);
    float open = sin(clamp(sweep, 0.0, 1.0) * 3.14159);

    float cut = dot(vFilterCoord - 0.5, n) - cutPos;
    float side = step(0.0, cut);
    vec2 t = vec2(-n.y, n.x);

    vec4 pixel = tapC(vTextureCoord + t * (side * 2.0 - 1.0) * slide * open * outputFrame.zw * inputSize.zw);

    float seam = 1.0 - smoothstep(0.0, 0.014, abs(cut));
    vec4 result = over(pixel, edgeColor, seam * max(pixel.a, orig.a) * 0.9 * (0.35 + 0.65 * open));

    gl_FragColor = mix(orig, result, opacity);
}
`;

export class FilterSlicePlane extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, slicePlaneFragment);

        this.uniforms.edgeColor = new Float32Array([0.63, 0.42, 1.0]);
        this.uniforms.dirV = new Float32Array([-0.423, 0.906]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterSlicePlane.defaults);

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

    get slide()
    {
        return this.uniforms.slide;
    }
    set slide(value)
    {
        this.uniforms.slide = value;
    }

    get rate()
    {
        return this.uniforms.rate;
    }
    set rate(value)
    {
        this.uniforms.rate = value;
    }

    get bounce()
    {
        return this.uniforms.bounce;
    }
    set bounce(value)
    {
        this.uniforms.bounce = value;
    }

    get travel()
    {
        return this.uniforms.travel;
    }
    set travel(value)
    {
        this.uniforms.travel = value;
    }

    get edgeColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.edgeColor);
    }
    set edgeColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.edgeColor);
    }

    // Compass bearing the cut plane faces, same convention as the token ground shadow.
    get cutAngle()
    {
        return this._cutAngle;
    }
    set cutAngle(value)
    {
        this._cutAngle = value;
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

FilterSlicePlane.defaults = {
    time: 0,
    cutAngle: 25,
    slide: 0.01,
    edgeColor: 0xa06cff,
    rate: 0.35,
    bounce: 0,
    travel: 0.9,
    opacity: 1.0,
};
