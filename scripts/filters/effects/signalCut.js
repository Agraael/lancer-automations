import { LaCustomFilter, GLSL_FILTER_INPUTS, GLSL_HASH1 } from '../filter-core.js';

const signalCutFragment = `
precision highp float;

uniform float time;
uniform float charSize;
uniform float bandW;
uniform float blocks;
uniform float fill;
uniform float speed;
uniform float plate;
uniform float rimW;
uniform float rimAlpha;
uniform float period;
uniform float spikeLen;
uniform float bands;
uniform float tear;
uniform float split;
uniform float tint;
uniform vec3 codeColor;
uniform vec3 headColor;
uniform vec3 plateColor;
uniform mediump mat3 filterMatrix;
${GLSL_FILTER_INPUTS}

${GLSL_HASH1}

float tapA(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw)).a;
}

vec4 tapC(vec2 uv)
{
    return texture2D(uSampler, clamp(uv, inputClamp.xy, inputClamp.zw));
}

float solidA(float alpha)
{
    return smoothstep(0.9, 0.995, alpha);
}

vec2 texPerSprite()
{
    return vec2(1.0 / length(vec2(filterMatrix[0][0], filterMatrix[0][1])), 1.0 / length(vec2(filterMatrix[1][0], filterMatrix[1][1])));
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

float edgeDist(vec2 sprite, float reach)
{
    vec2 toCentre = vec2(0.5) - sprite;
    float span = length(toCentre);
    if (span < 1e-4 || tapA(spriteToTex(sprite)) > 0.9)
        return 0.0;

    vec2 dir = toCentre / span;
    float outer = 0.0;
    float inner = -1.0;
    for (int probeIndex = 1; probeIndex < 9; probeIndex++)
    {
        float probe = reach * float(probeIndex) / 8.0;
        float hit = tapA(spriteToTex(sprite + dir * probe));
        if (inner < 0.0 && hit > 0.9)
            inner = probe;
        if (inner < 0.0)
            outer = probe;
    }
    if (inner < 0.0)
        return 9.0;

    for (int halving = 0; halving < 4; halving++)
    {
        float mid = 0.5 * (outer + inner);
        if (tapA(spriteToTex(sprite + dir * mid)) > 0.9)
            inner = mid;
        else
            outer = mid;
    }
    return 0.5 * (outer + inner);
}

float ringMinS(vec2 uv, float radius)
{
    vec2 span = texPerSprite() * radius;
    float lowest = 1.0;
    for (int index = 0; index < 8; index++)
    {
        float angle = float(index) * 0.7853982;
        lowest = min(lowest, tapA(uv + vec2(cos(angle), sin(angle)) * span));
    }
    return lowest;
}

float bitZero(vec2 cell)
{
    return 1.0 - step(0.5, cell.x) * step(cell.x, 1.5) * step(0.5, cell.y) * step(cell.y, 3.5);
}

float bitOne(vec2 cell)
{
    float stem = step(0.5, cell.x) * step(cell.x, 1.5);
    float flag = step(cell.x, 0.5) * step(0.5, cell.y) * step(cell.y, 1.5);
    float foot = step(3.5, cell.y);
    return clamp(stem + flag + foot, 0.0, 1.0);
}

vec4 over(vec4 base, vec3 rgb, float amount)
{
    return vec4(base.rgb * (1.0 - amount) + rgb * amount, base.a * (1.0 - amount) + amount);
}

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);
    vec2 sprite = vFilterCoord;
    float phase = fract(time / period);
    float spike = step(phase, spikeLen);
    float tick = mod(floor(time * 20.0), 512.0);

    float row = floor(sprite.y * bands);
    float shift = (hash1(vec2(row, tick)) - 0.5) * 2.0 * tear * spike * step(0.45, hash1(vec2(row * 1.3, tick + 2.0)));
    vec2 offset = vec2(shift, 0.0) * texPerSprite();
    vec4 art = tapC(vTextureCoord + offset);
    float red = tapC(vTextureCoord + offset + vec2(split * spike, 0.0) * texPerSprite()).r;
    vec3 color = vec3(red, art.g, art.b) / max(art.a, 1e-4);
    color = mix(color, color * 0.5 + codeColor * 0.65, spike * tint * solidA(art.a));
    vec4 result = vec4(clamp(color, 0.0, 1.0) * art.a, art.a);

    vec2 grid = sprite / charSize;
    vec2 cellId = floor(grid);
    vec2 cellCentre = (cellId + 0.5) * charSize;
    float edge = edgeDist(cellCentre, bandW + charSize);
    float inBand = step(0.0005, edge) * step(edge, bandW);
    vec2 fromCentre = cellCentre - vec2(0.5);
    float flow = (atan(fromCentre.y, fromCentre.x) / 6.2832 + 0.5) * blocks - time * speed + spike * hash1(vec2(tick, 5.0)) * 3.0;
    float packet = floor(flow);
    float packetPos = fract(flow);
    float inBlock = step(packetPos, mix(fill, 1.0, spike));
    float head = smoothstep(fill * 0.7, fill, packetPos) * inBlock;
    float digit = step(0.5, hash1(cellId + packet * 7.13 + spike * tick));
    vec2 bitCell = floor(fract(grid) * vec2(4.0, 6.0));
    float bit = step(bitCell.x, 2.5) * step(bitCell.y, 4.5) * mix(bitZero(bitCell), bitOne(bitCell), digit);
    float live = inBand * inBlock;
    result = over(result, plateColor, live * plate);
    result = over(result, mix(codeColor, headColor, head), bit * live);

    float rimLine = clamp(art.a - ringMinS(vTextureCoord + offset, rimW), 0.0, 1.0) * solidA(art.a);
    result = over(result, codeColor, rimLine * clamp(rimAlpha + spike * 0.5, 0.0, 1.0));

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterSignalCut extends LaCustomFilter
{
    constructor(params)
    {
        super(signalCutFragment, params, {
            codeColor: new Float32Array([0.44, 0.53, 1.0]),
            headColor: new Float32Array([0.87, 0.9, 1.0]),
            plateColor: new Float32Array([0.05, 0.14, 0.35]),
        });
        this.spriteCoords = true;
    }

    get charSize()
    {
        return this.uniforms.charSize;
    }
    set charSize(value)
    {
        this.uniforms.charSize = value;
    }

    get bandW()
    {
        return this.uniforms.bandW;
    }
    set bandW(value)
    {
        this.uniforms.bandW = value;
    }

    get blocks()
    {
        return this.uniforms.blocks;
    }
    set blocks(value)
    {
        this.uniforms.blocks = value;
    }

    get fill()
    {
        return this.uniforms.fill;
    }
    set fill(value)
    {
        this.uniforms.fill = value;
    }

    get speed()
    {
        return this.uniforms.speed;
    }
    set speed(value)
    {
        this.uniforms.speed = value;
    }

    get plate()
    {
        return this.uniforms.plate;
    }
    set plate(value)
    {
        this.uniforms.plate = value;
    }

    get rimW()
    {
        return this.uniforms.rimW;
    }
    set rimW(value)
    {
        this.uniforms.rimW = value;
    }

    get rimAlpha()
    {
        return this.uniforms.rimAlpha;
    }
    set rimAlpha(value)
    {
        this.uniforms.rimAlpha = value;
    }

    get period()
    {
        return this.uniforms.period;
    }
    set period(value)
    {
        this.uniforms.period = value;
    }

    get spikeLen()
    {
        return this.uniforms.spikeLen;
    }
    set spikeLen(value)
    {
        this.uniforms.spikeLen = value;
    }

    get bands()
    {
        return this.uniforms.bands;
    }
    set bands(value)
    {
        this.uniforms.bands = value;
    }

    get tear()
    {
        return this.uniforms.tear;
    }
    set tear(value)
    {
        this.uniforms.tear = value;
    }

    get split()
    {
        return this.uniforms.split;
    }
    set split(value)
    {
        this.uniforms.split = value;
    }

    get tint()
    {
        return this.uniforms.tint;
    }
    set tint(value)
    {
        this.uniforms.tint = value;
    }

    get codeColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.codeColor);
    }
    set codeColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.codeColor);
    }

    get headColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.headColor);
    }
    set headColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.headColor);
    }

    get plateColor()
    {
        return PIXI.utils.rgb2hex(this.uniforms.plateColor);
    }
    set plateColor(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.plateColor);
    }
}

FilterSignalCut.defaults = {
    time: 0,
    charSize: 0.028,
    bandW: 0.02,
    blocks: 6,
    fill: 0.6,
    speed: 1.2,
    plate: 0.85,
    rimW: 0.01,
    rimAlpha: 0.36,
    period: 2.2,
    spikeLen: 0.18,
    bands: 26,
    tear: 0.03,
    split: 0.006,
    tint: 0.45,
    codeColor: 0x7088ff,
    headColor: 0xdde6ff,
    plateColor: 0x0c235a,
    opacity: 0.9,
};
