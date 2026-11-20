import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_VNOISE } from '../filter-core.js';

const wireFrameFragment = `
precision highp float;

uniform float time;
uniform float patchScale;
uniform float cover;
uniform float drift;
uniform float hollow;
uniform float lineW;
uniform float edgeLo;
uniform float edgeHi;
uniform float seeThrough;
uniform float pulseRate;
uniform float tornW;
uniform float rimGlow;
uniform float rimR;
uniform vec3 frameColor;
uniform vec3 coreColor;
uniform vec3 darkColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_VNOISE}

float fbm(vec2 point)
{
    float value = 0.0;
    float amp = 0.5;
    for (int octave = 0; octave < 4; octave++)
    {
        value += amp * vnoise(point);
        point = point * 2.03 + vec2(17.0, 9.0);
        amp *= 0.5;
    }
    return value;
}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float tapS(vec2 uv)
{
    return smoothstep(0.86, 0.96, tapC(uv).a);
}

float luma(vec3 color)
{
    return dot(color, vec3(0.299, 0.587, 0.114));
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
}

float ringMaxSolid(vec2 uv, float radius)
{
    vec2 span = texPerSprite() * radius;
    float highest = 0.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982 + 0.39;
        highest = max(highest, tapS(uv + vec2(cos(angle), sin(angle)) * span));
    }
    return highest;
}

vec4 under(vec4 top, vec3 rgb, float amount)
{
    return vec4(top.rgb + rgb * amount * (1.0 - top.a), top.a + amount * (1.0 - top.a));
}

float wireField(vec2 point)
{
    return fbm(point * patchScale + vec2(time * drift, -time * drift * 0.7)) + 0.08 * sin(time * 0.6 + point.x * 5.0);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float px = inputSize.z / texPerSprite().x;
    float inside = smoothstep(0.9, 0.995, pixel.a);

    vec2 texel = inputSize.zw * lineW;
    float l00 = luma(tapC(vTextureCoord + vec2(-texel.x, -texel.y)).rgb);
    float l10 = luma(tapC(vTextureCoord + vec2(0.0, -texel.y)).rgb);
    float l20 = luma(tapC(vTextureCoord + vec2(texel.x, -texel.y)).rgb);
    float l01 = luma(tapC(vTextureCoord + vec2(-texel.x, 0.0)).rgb);
    float l21 = luma(tapC(vTextureCoord + vec2(texel.x, 0.0)).rgb);
    float l02 = luma(tapC(vTextureCoord + vec2(-texel.x, texel.y)).rgb);
    float l12 = luma(tapC(vTextureCoord + vec2(0.0, texel.y)).rgb);
    float l22 = luma(tapC(vTextureCoord + vec2(texel.x, texel.y)).rgb);
    float gx = (l20 + 2.0 * l21 + l22) - (l00 + 2.0 * l01 + l02);
    float gy = (l02 + 2.0 * l12 + l22) - (l00 + 2.0 * l10 + l20);
    float edge = smoothstep(edgeLo, edgeHi, length(vec2(gx, gy))) * inside;

    float field = wireField(sprite);
    float eps = 0.004;
    vec2 grad = vec2(wireField(sprite + vec2(eps, 0.0)) - field, wireField(sprite + vec2(0.0, eps)) - field) / eps;
    float signedD = (field - cover) / max(length(grad), 0.5);
    float gone = smoothstep(-px, px, signedD) * inside;
    float tornWidth = max(tornW, px);
    float torn = (1.0 - smoothstep(tornWidth * 0.5, tornWidth, abs(signedD))) * inside;
    float pulse = 0.55 + 0.45 * sin(time * pulseRate - (sprite.x * 9.0 + sprite.y * 14.0));
    float crackle = 0.7 + 0.3 * vnoise(vec2(sprite.x * 60.0 + time * 4.0, sprite.y * 60.0));

    vec3 color = pixel.rgb / max(pixel.a, 1e-4);
    vec3 col = mix(color, darkColor, gone * hollow);
    float frameA = clamp(edge * (seeThrough + gone) * pulse, 0.0, 1.0);
    col = mix(col, frameColor, frameA);
    col = mix(col, coreColor, clamp(edge * gone * pulse * pulse * 0.45, 0.0, 1.0));
    col = mix(col, mix(frameColor, coreColor, 0.5), clamp(torn * crackle, 0.0, 1.0));

    vec4 result = vec4(col * pixel.a, pixel.a);
    float halo = clamp(ringMaxSolid(vTextureCoord, rimR) - inside, 0.0, 1.0);
    result = under(result, frameColor, clamp(halo * rimGlow * (0.6 + 0.4 * pulse), 0.0, 1.0));
    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterWireFrame extends LaCustomFilter
{
    constructor(params)
    {
        super(wireFrameFragment, params, {
            frameColor: new Float32Array([1.0, 0.63, 0.25]),
            coreColor: new Float32Array([1.0, 0.94, 0.82]),
            darkColor: new Float32Array([0.1, 0.05, 0.02]),
        });
        this.spriteCoords = true;
    }

    get patchScale()
    {
        return this.uniforms.patchScale;
    }
    set patchScale(value)
    {
        this.uniforms.patchScale = value;
    }

    get cover()
    {
        return this.uniforms.cover;
    }
    set cover(value)
    {
        this.uniforms.cover = value;
    }

    get drift()
    {
        return this.uniforms.drift;
    }
    set drift(value)
    {
        this.uniforms.drift = value;
    }

    get hollow()
    {
        return this.uniforms.hollow;
    }
    set hollow(value)
    {
        this.uniforms.hollow = value;
    }

    get lineW()
    {
        return this.uniforms.lineW;
    }
    set lineW(value)
    {
        this.uniforms.lineW = value;
    }

    get edgeLo()
    {
        return this.uniforms.edgeLo;
    }
    set edgeLo(value)
    {
        this.uniforms.edgeLo = value;
    }

    get edgeHi()
    {
        return this.uniforms.edgeHi;
    }
    set edgeHi(value)
    {
        this.uniforms.edgeHi = value;
    }

    get seeThrough()
    {
        return this.uniforms.seeThrough;
    }
    set seeThrough(value)
    {
        this.uniforms.seeThrough = value;
    }

    get pulseRate()
    {
        return this.uniforms.pulseRate;
    }
    set pulseRate(value)
    {
        this.uniforms.pulseRate = value;
    }

    get tornW()
    {
        return this.uniforms.tornW;
    }
    set tornW(value)
    {
        this.uniforms.tornW = value;
    }

    get rimGlow()
    {
        return this.uniforms.rimGlow;
    }
    set rimGlow(value)
    {
        this.uniforms.rimGlow = value;
    }

    get rimR()
    {
        return this.uniforms.rimR;
    }
    set rimR(value)
    {
        this.uniforms.rimR = value;
    }

    get frameColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.frameColor);
    }
    set frameColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.frameColor);
    }

    get coreColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.coreColor);
    }
    set coreColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.coreColor);
    }

    get darkColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.darkColor);
    }
    set darkColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.darkColor);
    }
}

FilterWireFrame.defaults = {
    time: 0,
    patchScale: 3.6,
    cover: 0.6,
    drift: 0.05,
    hollow: 0.7,
    lineW: 1.2,
    edgeLo: 0.14,
    edgeHi: 0.4,
    seeThrough: 0,
    pulseRate: 3,
    tornW: 0.004,
    rimGlow: 0.55,
    rimR: 0.012,
    frameColor: 0xffa040,
    coreColor: 0xfff0d0,
    darkColor: 0x1a0c06,
    opacity: 1,
};
