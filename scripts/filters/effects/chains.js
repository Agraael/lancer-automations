import { customVertex2D, applyCustomFilter } from '../filter-core.js';

// FilterChains: crossing chain-link pattern overlay.

const chainsFragment = `
precision mediump float;

uniform float time;
uniform vec3 color;
uniform float intensity;
uniform float scale;
uniform float linkWidth;
uniform float linkGap;
uniform float opacity;
uniform int blend;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 blenderVec3(int blend, vec4 fColv4, vec4 sColv4)
{
    vec3 fCol = vec3(fColv4);
    vec3 sCol = vec3(sColv4);
    if      (blend == 1)  { fCol = fCol * sCol; }
    else if (blend == 2)  { fCol = (1. - (1. - fCol) * (1. - sCol)); }
    else if (blend == 3)  { fCol = min(fCol, sCol); }
    else if (blend == 4)  { fCol = max(fCol, sCol); }
    else if (blend == 5)  { fCol = abs(fCol - sCol); }
    else if (blend == 6)  { fCol = 1. - abs(1. - fCol - sCol); }
    else if (blend == 7)  { fCol = fCol + sCol - (2. * fCol * sCol); }
    else if (blend == 8)  { fCol = all(lessThanEqual(fCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 9)  { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol) : (1. - 2. * (1. - fCol) * (1. - sCol)); }
    else if (blend == 10) { fCol = all(lessThanEqual(sCol, vec3(0.5))) ? (2. * fCol * sCol + fCol * fCol * (1. - 2. * sCol)) : sqrt(fCol) * (2. * sCol - 1.) + (2. * fCol) * (1. - sCol); }
    else if (blend == 11) { fCol = fCol / (1.0 - sCol); }
    else if (blend == 12) { fCol = 1.0 - (1.0 - fCol) / sCol; }
    else if (blend == 13) { fCol = fCol + sCol; }
    else                  { fCol = fCol + sCol; }
    return vec4(fCol, 1.0);
}

// Diagonal chain pattern using distance fields
// Each chain = a diagonal stripe with wavy edges (link bumps)

// Distance to a set of repeating diagonal lines with chain-link bumps
float chainPattern(vec2 uv, float angle, float spacing, float width, float bumpFreq, float bumpAmp, float phase) {
    float c = cos(angle);
    float s = sin(angle);
    vec2 ruv = vec2(c * uv.x + s * uv.y, -s * uv.x + c * uv.y);

    // Phase animation along the chain
    ruv.x += phase;

    // Distance to nearest line (repeating in Y perpendicular to chain direction)
    float lineY = mod(ruv.y + spacing * 0.5, spacing) - spacing * 0.5;

    // Chain link bumps: wavy edges that create oval-link appearance
    float bump = sin(ruv.x * bumpFreq) * bumpAmp;
    // Alternate bump phase for each line to simulate interlocking
    float lineIdx = floor((ruv.y + spacing * 0.5) / spacing);
    bump *= (mod(lineIdx, 2.0) == 0.0) ? 1.0 : -1.0;

    float d = abs(lineY + bump) - width;
    return d;
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uv = vFilterCoord * scale;
    float phase = time * 0.15;

    float spacing = linkGap;
    float width = linkWidth;
    float bumpFreq = 6.2831 / (linkWidth * 4.0); // link length
    float bumpAmp = linkWidth * 0.5;

    // Multiple chain sets at varied angles
    float d1 = chainPattern(uv, 0.55, spacing, width, bumpFreq, bumpAmp, phase);
    float d2 = chainPattern(uv, -0.85, spacing * 1.1, width, bumpFreq, bumpAmp, -phase * 0.8);
    float d3 = chainPattern(uv, 0.2, spacing * 0.9, width, bumpFreq, bumpAmp, phase * 0.6);
    float d4 = chainPattern(uv, -0.35, spacing * 1.2, width, bumpFreq, bumpAmp, -phase * 0.5);

    float d = min(min(d1, d2), min(d3, d4));

    // Hollow: show only the outline of each link
    float ring = abs(d) - width * 0.3;

    // Sharp metallic edge + glow
    float core = 1.0 - smoothstep(0.0, 0.01, ring);
    float glow = 0.3 * (1.0 - smoothstep(0.0, 0.04, ring));
    float total = clamp((core + glow) * intensity, 0.0, 1.0);

    vec3 chainCol = mix(color, vec3(1.0), core * 0.4);
    vec4 chainColor = vec4(chainCol * total * opacity, 1.0);

    gl_FragColor = blenderVec3(blend, pixel, chainColor) * pixel.a;
}
`;

export class FilterChains extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, chainsFragment);

        this.uniforms.color = new Float32Array([1.0, 1.0, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterChains.defaults);

        this._timeSpeed = params?.timeSpeed ?? 0.5;
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

    get color()
    {
        return PIXI.utils.rgb2hex(this.uniforms.color);
    }
    set color(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.color);
    }

    get intensity()
    {
        return this.uniforms.intensity;
    }
    set intensity(value)
    {
        this.uniforms.intensity = value;
    }

    get scale()
    {
        return this.uniforms.scale;
    }
    set scale(value)
    {
        this.uniforms.scale = value;
    }

    get linkWidth()
    {
        return this.uniforms.linkWidth;
    }
    set linkWidth(value)
    {
        this.uniforms.linkWidth = value;
    }

    get linkGap()
    {
        return this.uniforms.linkGap;
    }
    set linkGap(value)
    {
        this.uniforms.linkGap = value;
    }

    get opacity()
    {
        return this.uniforms.opacity;
    }
    set opacity(value)
    {
        this.uniforms.opacity = value;
    }

    get blend()
    {
        return this.uniforms.blend;
    }
    set blend(value)
    {
        this.uniforms.blend = Math.floor(value);
    }
}

FilterChains.defaults = {
    time: 0,
    color: 0x888888,
    intensity: 1.5,
    scale: 8,
    linkWidth: 0.06,
    linkGap: 0.8,
    opacity: 0.8,
    blend: 2,
};
