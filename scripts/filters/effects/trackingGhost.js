import { customVertex2D, applyCustomFilter } from '../filter-core.js';

// FilterTrackingGhost: stale duplicates lagging behind the body, snapping inward until they converge.
// No alpha early-out: the ghosts live exactly where the chassis is not, and are masked to stay there.

const trackingGhostFragment = `
precision mediump float;

uniform float time;
uniform vec3 colorHot;
uniform vec3 colorCold;
uniform vec2 lockDir;
uniform float spinRate;
uniform float ghostDist;
uniform float lockPeriod;
uniform float steps;
uniform float ghostOpacity;
uniform float ringWidth;
uniform float chirpStrength;
uniform float opacity;
uniform vec4 inputSize;
uniform vec4 outputFrame;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

void main()
{
    vec4 pixel = texture2D(uSampler, vTextureCoord);

    float cyc = fract(time / lockPeriod);

    // Convergence jumps in discrete refresh steps rather than sliding.
    float ease = 1.0 - cyc;
    float lag = ghostDist * floor(ease * ease * sqrt(ease) * steps) / max(steps, 1.0);

    float sn = sin(time * spinRate);
    float cs = cos(time * spinRate);
    vec2 dir = vec2(lockDir.x * cs - lockDir.y * sn, lockDir.x * sn + lockDir.y * cs);

    vec2 uvSpan = outputFrame.zw * inputSize.zw;
    vec2 offset = dir * lag * uvSpan;

    float aHot = texture2D(uSampler, vTextureCoord + offset).a;
    float aCold = texture2D(uSampler, vTextureCoord - offset).a;
    float aTrail = texture2D(uSampler, vTextureCoord + offset * 0.55).a;

    // The whole discipline: wherever the chassis has coverage the ghosts are zero, so the art is never hidden.
    float free = 1.0 - pixel.a;
    float fade = 1.0 - cyc;

    vec4 result = pixel;
    result += vec4(colorHot, 1.0) * (max(aHot, aTrail * 0.5) * free * ghostOpacity * fade);
    result += vec4(colorCold, 1.0) * (aCold * free * ghostOpacity * fade * 0.75);

    // Chirp ring at lock.
    float k = clamp((cyc - 0.88) / 0.12, 0.0, 1.0);
    float radius = length(vFilterCoord - 0.5) * 2.0;
    float ring = (1.0 - smoothstep(0.0, ringWidth, abs(radius - k * 1.2))) * (1.0 - k) * free;
    result += vec4(1.0) * (ring * chirpStrength);

    gl_FragColor = mix(pixel, result, opacity);
}
`;

export class FilterTrackingGhost extends PIXI.Filter
{
    constructor(params)
    {
        super(customVertex2D, trackingGhostFragment);

        this.uniforms.colorHot = new Float32Array([1.0, 0.27, 0.13]);
        this.uniforms.colorCold = new Float32Array([0.13, 0.85, 1.0]);
        this.uniforms.lockDir = new Float32Array([0.0, 1.0]);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, FilterTrackingGhost.defaults);

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

    get colorHot()
    {
        return PIXI.utils.rgb2hex(this.uniforms.colorHot);
    }
    set colorHot(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.colorHot);
    }

    get colorCold()
    {
        return PIXI.utils.rgb2hex(this.uniforms.colorCold);
    }
    set colorCold(value)
    {
        new PIXI.Color(value).toRgbArray(this.uniforms.colorCold);
    }

    // Bearing the firing solution comes from. Leave spinRate non-zero when the attacker is unknown.
    get lockAngle()
    {
        return this._lockAngle;
    }
    set lockAngle(value)
    {
        this._lockAngle = value;
        const radians = (value * Math.PI) / 180;
        this.uniforms.lockDir[0] = -Math.sin(radians);
        this.uniforms.lockDir[1] = Math.cos(radians);
    }

    get spinRate()
    {
        return this.uniforms.spinRate;
    }
    set spinRate(value)
    {
        this.uniforms.spinRate = value;
    }

    get ghostDist()
    {
        return this.uniforms.ghostDist;
    }
    set ghostDist(value)
    {
        this.uniforms.ghostDist = value;
    }

    get lockPeriod()
    {
        return this.uniforms.lockPeriod;
    }
    set lockPeriod(value)
    {
        this.uniforms.lockPeriod = value;
    }

    get steps()
    {
        return this.uniforms.steps;
    }
    set steps(value)
    {
        this.uniforms.steps = value;
    }

    get ghostOpacity()
    {
        return this.uniforms.ghostOpacity;
    }
    set ghostOpacity(value)
    {
        this.uniforms.ghostOpacity = value;
    }

    get ringWidth()
    {
        return this.uniforms.ringWidth;
    }
    set ringWidth(value)
    {
        this.uniforms.ringWidth = value;
    }

    get chirpStrength()
    {
        return this.uniforms.chirpStrength;
    }
    set chirpStrength(value)
    {
        this.uniforms.chirpStrength = value;
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

FilterTrackingGhost.defaults = {
    time: 0,
    colorHot: 0xff4422,
    colorCold: 0x22d8ff,
    lockAngle: 0,
    spinRate: 1.5,
    ghostDist: 0.065,
    lockPeriod: 1.4,
    steps: 10,
    ghostOpacity: 0.35,
    ringWidth: 0.002,
    chirpStrength: 0.0,
    opacity: 1.0,
};
