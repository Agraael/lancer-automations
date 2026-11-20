import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1, GLSL_HASH2 } from '../filter-core.js';

const filmEchoFragment = `
precision highp float;

uniform float time;
uniform float tone;
uniform float grain;
uniform float grainSize;
uniform float weave;
uniform float scratches;
uniform float flicker;
uniform float vignette;
uniform float radius;
uniform float speed;
uniform float echoes;
uniform float fade;
uniform float tintMix;
uniform vec3 sepiaColor;
uniform vec3 tintEcho;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}
${GLSL_HASH2}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float luma(vec3 rgb)
{
    return dot(rgb, vec3(0.299, 0.587, 0.114));
}

float solidA(float alpha)
{
    return smoothstep(0.9, 0.995, alpha);
}

vec2 spriteToTex(vec2 sprite)
{
    vec2 shifted = sprite - vec2(filterMatrix[2][0], filterMatrix[2][1]);
    float m00 = filterMatrix[0][0];
    float m10 = filterMatrix[1][0];
    float m01 = filterMatrix[0][1];
    float m11 = filterMatrix[1][1];
    float det = m00 * m11 - m10 * m01;
    return vec2(m11 * shifted.x - m10 * shifted.y, -m01 * shifted.x + m00 * shifted.y) / det;
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float tick = mod(floor(time * 18.0), 512.0);
    vec2 weaveShift = (hash2(vec2(tick, 1.7)) - 0.5) * weave;
    vec4 art = tapC(spriteToTex(sprite + weaveShift));

    vec4 trail = vec4(0.0);
    for (int index = 3; index >= 1; index--)
    {
        float fi = float(index);
        float on = step(fi - 0.5, echoes);
        float angle = time * speed - fi * 0.7;
        vec2 offset = vec2(cos(angle), sin(angle)) * radius * (0.6 + 0.25 * fi);
        vec4 echo = tapC(spriteToTex(sprite + weaveShift - offset));
        float weight = pow(fade, fi) * on * solidA(echo.a);
        vec3 echoColor = mix(echo.rgb / max(echo.a, 1e-4), tintEcho, tintMix);
        trail = vec4(trail.rgb * (1.0 - echo.a * weight) + echoColor * echo.a * weight, trail.a * (1.0 - echo.a * weight) + echo.a * weight);
    }

    vec4 merged = vec4(art.rgb + trail.rgb * (1.0 - art.a), art.a + trail.a * (1.0 - art.a));
    vec3 color = merged.rgb / max(merged.a, 1e-4);
    color = mix(color, vec3(luma(color)) * sepiaColor * 1.35, tone);
    color += (hash1(floor(sprite * grainSize) + tick * 7.3) - 0.5) * grain;

    for (int lane = 0; lane < 2; lane++)
    {
        float fl = float(lane);
        float slot = floor(tick / 3.0);
        float scratchX = hash1(vec2(slot + fl * 11.0, 5.0));
        float live = step(1.0 - scratches * 0.6, hash1(vec2(slot * 1.3 + fl, 9.0)));
        float line = 1.0 - smoothstep(0.0015, 0.004, abs(sprite.x - scratchX));
        color = mix(color, fl > 0.5 ? color * 0.45 : min(color + 0.35, vec3(1.0)), line * live);
    }

    color *= 1.0 + (hash1(vec2(tick, 3.3)) - 0.5) * flicker;
    color *= mix(1.0 - vignette, 1.0, 1.0 - smoothstep(0.25, 0.75, length(sprite - 0.5)));

    gl_FragColor = mix(pixel, vec4(clamp(color, 0.0, 1.0) * merged.a, merged.a), opacity);
}
`;

export class FilterFilmEcho extends LaCustomFilter
{
    constructor(params)
    {
        super(filmEchoFragment, params, {
            sepiaColor: new Float32Array([0.85, 0.70, 0.42]),
            tintEcho: new Float32Array([1.0, 0.82, 0.48]),
        });
        this.spriteCoords = true;
    }

    get tone()
    {
        return this.uniforms.tone;
    }
    set tone(value)
    {
        this.uniforms.tone = value;
    }

    get grain()
    {
        return this.uniforms.grain;
    }
    set grain(value)
    {
        this.uniforms.grain = value;
    }

    get grainSize()
    {
        return this.uniforms.grainSize;
    }
    set grainSize(value)
    {
        this.uniforms.grainSize = value;
    }

    get weave()
    {
        return this.uniforms.weave;
    }
    set weave(value)
    {
        this.uniforms.weave = value;
    }

    get scratches()
    {
        return this.uniforms.scratches;
    }
    set scratches(value)
    {
        this.uniforms.scratches = value;
    }

    get flicker()
    {
        return this.uniforms.flicker;
    }
    set flicker(value)
    {
        this.uniforms.flicker = value;
    }

    get vignette()
    {
        return this.uniforms.vignette;
    }
    set vignette(value)
    {
        this.uniforms.vignette = value;
    }

    get radius()
    {
        return this.uniforms.radius;
    }
    set radius(value)
    {
        this.uniforms.radius = value;
    }

    get speed()
    {
        return this.uniforms.speed;
    }
    set speed(value)
    {
        this.uniforms.speed = value;
    }

    get echoes()
    {
        return this.uniforms.echoes;
    }
    set echoes(value)
    {
        this.uniforms.echoes = value;
    }

    get fade()
    {
        return this.uniforms.fade;
    }
    set fade(value)
    {
        this.uniforms.fade = value;
    }

    get tintMix()
    {
        return this.uniforms.tintMix;
    }
    set tintMix(value)
    {
        this.uniforms.tintMix = value;
    }

    get sepiaColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.sepiaColor);
    }
    set sepiaColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.sepiaColor);
    }

    get tintEcho()
    {
        return PIXI.utils.rgb2hex(this.uniforms.tintEcho);
    }
    set tintEcho(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.tintEcho);
    }
}

FilterFilmEcho.defaults = {
    time: 0,
    tone: 0.7,
    grain: 0.18,
    grainSize: 220,
    weave: 0.004,
    scratches: 0.8,
    flicker: 0.12,
    vignette: 0.45,
    radius: 0.035,
    speed: 1.6,
    echoes: 3,
    fade: 0.55,
    tintMix: 0.45,
    sepiaColor: 0xd9b26a,
    tintEcho: 0xffd27a,
    opacity: 1,
};
