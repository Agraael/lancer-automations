import { LaCustomFilter, GLSL_HASH1, GLSL_HASH2, GLSL_VNOISE, GLSL_BLENDER_VEC3 } from '../filter-core.js';

// FilterFracture: Voronoi F2-F1 glowing cracks with noise distortion.

const fractureFragment = `
precision mediump float;

uniform float time;
uniform vec3 color;
uniform float intensity;
uniform float scale;
uniform float crackWidth;
uniform float opacity;
uniform float warpStrength;
uniform float noiseScale;
uniform float maskAmount;
uniform int blend;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

${GLSL_BLENDER_VEC3}

${GLSL_HASH2}
${GLSL_HASH1}
${GLSL_VNOISE}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    if (pixel.a == 0.) {
        gl_FragColor = pixel;
        return;
    }

    vec2 uv = vFilterCoord * scale;

    // Distort UV with noise to make edges jagged/crackly
    vec2 distort = vec2(
        vnoise(uv * noiseScale + time * 0.1) - 0.5,
        vnoise(uv * noiseScale + vec2(5.0, 3.0) + time * 0.1) - 0.5
    ) * warpStrength * 0.3;
    uv += distort;

    // Voronoi F2-F1
    vec2 ip = floor(uv);
    vec2 fp = fract(uv);

    float d1 = 8.0;
    float d2 = 8.0;

    for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
            vec2 neighbor = vec2(float(i), float(j));
            vec2 point = hash2(ip + neighbor);
            point = 0.5 + 0.5 * sin(time + 6.2831 * point);
            vec2 diff = neighbor + point - fp;
            float dist = length(diff);

            if (dist < d1) {
                d2 = d1;
                d1 = dist;
            } else if (dist < d2) {
                d2 = dist;
            }
        }
    }

    // F2-F1: zero at cell boundaries, large inside cells
    float edge = d2 - d1;

    // Noise mask: hide random sections so the cracks never read as continuous lines
    float mask = vnoise(uv * 2.5 + time * 0.05);
    mask = smoothstep(maskAmount, maskAmount + 0.3, mask);

    // Exponential glow: bright core with tight falloff
    float glow = exp(-edge / crackWidth) * mask;

    // Sharp bright core
    float core = exp(-edge / (crackWidth * 0.15)) * mask;

    float total = clamp((glow * 0.6 + core * 0.8) * intensity, 0.0, 1.0);

    // White-hot core, colored glow
    vec3 crackCol = mix(color, vec3(1.0), core);
    vec4 crackColor = vec4(crackCol * total * opacity, 1.0);

    gl_FragColor = blenderVec3(blend, pixel, crackColor) * pixel.a;
}
`;

export class FilterFracture extends LaCustomFilter
{
    constructor(params)
    {
        super(fractureFragment, params, { color: new Float32Array([1.0, 1.0, 1.0]) }, 0.3);
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

    get crackWidth()
    {
        return this.uniforms.crackWidth;
    }
    set crackWidth(value)
    {
        this.uniforms.crackWidth = value;
    }

    get warpStrength()
    {
        return this.uniforms.warpStrength;
    }
    set warpStrength(value)
    {
        this.uniforms.warpStrength = value;
    }

    get noiseScale()
    {
        return this.uniforms.noiseScale;
    }
    set noiseScale(value)
    {
        this.uniforms.noiseScale = value;
    }

    get maskAmount()
    {
        return this.uniforms.maskAmount;
    }
    set maskAmount(value)
    {
        this.uniforms.maskAmount = value;
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

FilterFracture.defaults = {
    time: 0,
    color: 0xcccccc,
    intensity: 1.0,
    scale: 10,
    crackWidth: 0.02,
    opacity: 0.8,
    warpStrength: 1.0,
    noiseScale: 4.0,
    maskAmount: 0.25,
    blend: 2,
};
