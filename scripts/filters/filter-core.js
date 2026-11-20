/**
 * Shared plumbing for the LA custom TokenMagic filters: the vertex shader every one of them uses,
 * and the apply() body that advances their clock and rebuilds the filter matrix.
 */

export const customVertex2D = `
precision mediump float;

attribute vec2 aVertexPosition;

uniform mat3 projectionMatrix;
uniform mat3 filterMatrix;
uniform vec4 inputSize;
uniform vec4 outputFrame;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;

vec4 filterVertexPosition(void)
{
    vec2 position = aVertexPosition * max(outputFrame.zw, vec2(0.)) + outputFrame.xy;
    return vec4((projectionMatrix * vec3(position, 1.0)).xy, 0., 1.);
}

vec2 filterTextureCoord(void)
{
    return aVertexPosition * (outputFrame.zw * inputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
    vFilterCoord = (filterMatrix * vec3(vTextureCoord, 1.0)).xy;
}
`;

// mediump matches customVertex2D, since a precision mismatch on a shared uniform fails to link.
export const GLSL_FILTER_INPUTS = `
uniform float opacity;
uniform mediump vec4 inputSize;
uniform mediump vec4 outputFrame;
uniform vec4 inputClamp;
uniform sampler2D uSampler;

varying vec2 vTextureCoord;
varying vec2 vFilterCoord;`;

// GLSL helpers shared by the effect shaders. Interpolate them, never retype: the constants must match to the digit.
export const GLSL_HASH1 = `
float hash1(vec2 p) {
    return fract(sin(dot(p, vec2(43.27, 81.63))) * 4358.5453);
}`;

export const GLSL_HASH2 = `
vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)),
             dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}`;

// Bilinear value noise over hash1, so GLSL_HASH1 must come first in the shader.
export const GLSL_VNOISE = `
float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash1(i);
    float b = hash1(i + vec2(1.0, 0.0));
    float c = hash1(i + vec2(0.0, 1.0));
    float d = hash1(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

export const GLSL_BLENDER_VEC3 = `
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
}`;

// Compass bearing in degrees to the unit vector the shaders read as dirV.
export function setDirVFromDegrees(uniforms, degrees)
{
    const radians = (degrees * Math.PI) / 180;
    uniforms.dirV[0] = -Math.sin(radians);
    uniforms.dirV[1] = Math.cos(radians);
}

const _tempRect = new PIXI.Rectangle();
const _artFractions = new WeakMap();
const STILL_SECONDS = 1;
let _animationsOff = null;

function animationsOff()
{
    if (_animationsOff === null)
        _animationsOff = !!game.settings?.settings?.has(/** @type {any} */ ('tokenmagic.disableAnimations')) && /** @type {any} */ (game.settings).get('tokenmagic', 'disableAnimations') === true;
    return _animationsOff;
}

function artFractions(texture)
{
    if (!texture?.valid)
        return null;

    if (_artFractions.has(texture))
        return _artFractions.get(texture);

    const alphaData = /** @type {any} */ (foundry.canvas.TextureLoader.getTextureAlphaData(texture, 0.25));
    const fractions = alphaData?.width && alphaData.maxX > alphaData.minX && alphaData.maxY > alphaData.minY
        ? {
            left: alphaData.minX / alphaData.width,
            top: alphaData.minY / alphaData.height,
            right: alphaData.maxX / alphaData.width,
            bottom: alphaData.maxY / alphaData.height,
        }
        : null;
    _artFractions.set(texture, fractions);
    return fractions;
}

function fitArtBounds(target, bounds)
{
    const fractions = artFractions(target.texture);
    if (!fractions)
        return;

    const left = bounds.x + bounds.width * fractions.left;
    const top = bounds.y + bounds.height * fractions.top;
    const artWidth = bounds.width * (fractions.right - fractions.left);
    const artHeight = bounds.height * (fractions.bottom - fractions.top);
    const side = Math.max(artWidth, artHeight);

    bounds.x = left + (artWidth - side) / 2;
    bounds.y = top + (artHeight - side) / 2;
    bounds.width = side;
    bounds.height = side;
}

const EDGE_ANGLES = 360;
const _edgeTables = new WeakMap();
const _localBounds = new PIXI.Rectangle();

function solidRamp(alpha)
{
    const ramp = Math.min(1, Math.max(0, (alpha / 255 - 0.86) / 0.1));
    return ramp * ramp * (3 - 2 * ramp);
}

function buildEdgeTable(alphaData, bounds)
{
    const { width, height, minX, minY, maxX, maxY, data } = alphaData;
    const trimWidth = maxX - minX;
    const artWidth = bounds.width * trimWidth / width;
    const artHeight = bounds.height * (maxY - minY) / height;
    const side = Math.max(artWidth, artHeight);
    const squareX = bounds.width * minX / width + (artWidth - side) / 2;
    const squareY = bounds.height * minY / height + (artHeight - side) / 2;
    const cell = Math.min(bounds.width / width, bounds.height / height) / side;

    const solidAt = (spriteX, spriteY) =>
    {
        const gridX = Math.floor((squareX + spriteX * side) / bounds.width * width);
        const gridY = Math.floor((squareY + spriteY * side) / bounds.height * height);
        if (gridX < minX || gridX >= maxX || gridY < minY || gridY >= maxY)
            return 0;
        return solidRamp(data[(gridY - minY) * trimWidth + (gridX - minX)]);
    };

    const table = [];
    for (let index = 0; index < EDGE_ANGLES; index++)
    {
        const angle = (index / EDGE_ANGLES) * Math.PI * 2;
        const dirX = Math.cos(angle);
        const dirY = Math.sin(angle);
        let hit = -1;
        for (let radius = 0.72; radius >= 0; radius -= cell * 0.5)
        {
            if (solidAt(0.5 + dirX * radius, 0.5 + dirY * radius) > 0.5)
            {
                hit = radius;
                break;
            }
        }
        if (hit < 0)
        {
            table.push(null);
            continue;
        }

        const edgeX = 0.5 + dirX * hit;
        const edgeY = 0.5 + dirY * hit;
        let gradX = 0;
        let gradY = 0;
        for (let offY = -2; offY <= 2; offY++)
        {
            for (let offX = -2; offX <= 2; offX++)
            {
                const value = solidAt(edgeX + offX * cell, edgeY + offY * cell);
                gradX += offX * value;
                gradY += offY * value;
            }
        }
        const gradLength = Math.hypot(gradX, gradY);
        const normX = (gradLength > 1e-3 ? -gradX / gradLength : dirX) * 0.75 + dirX * 0.25;
        const normY = (gradLength > 1e-3 ? -gradY / gradLength : dirY) * 0.75 + dirY * 0.25;
        const normLength = Math.hypot(normX, normY);
        table.push([edgeX, edgeY, normX / normLength, normY / normLength]);
    }
    return table;
}

function edgeTableFor(target)
{
    const texture = target?.texture;
    if (!texture?.valid)
        return null;

    const bounds = target.getLocalBounds(_localBounds);
    const key = `${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)}`;
    const cached = _edgeTables.get(texture);
    if (cached?.key === key)
        return cached.table;

    const alphaData = /** @type {any} */ (foundry.canvas.TextureLoader.getTextureAlphaData(texture, 0.25));
    const table = alphaData?.data?.length && alphaData.maxX > alphaData.minX && alphaData.maxY > alphaData.minY
        ? buildEdgeTable(alphaData, bounds)
        : null;
    _edgeTables.set(texture, { key, table });
    return table;
}

function edgeAtTurn(table, turn)
{
    const position = (((turn % 1) + 1) % 1) * EDGE_ANGLES;
    const low = Math.floor(position) % EDGE_ANGLES;
    const high = (low + 1) % EDGE_ANGLES;
    const blend = position - Math.floor(position);
    const lowEdge = table[low];
    const highEdge = table[high];
    let edge = lowEdge || highEdge;
    if (lowEdge && highEdge && Math.hypot(lowEdge[0] - highEdge[0], lowEdge[1] - highEdge[1]) < 0.03)
        edge = lowEdge.map((value, slot) => value + (highEdge[slot] - value) * blend);
    return edge;
}

export function fillEdgeAnchors(anchors, target, count, now, drift)
{
    anchors.fill(-9);
    const table = edgeTableFor(target);
    if (!table)
        return;

    const capped = Math.min(anchors.length / 4, Math.round(count));
    for (let index = 0; index < capped; index++)
    {
        const turn = (index + 0.5 + 0.4 * Math.sin(now * drift * 1.3 + index * 2.1) + 0.25 * Math.sin(now * drift * 0.7 + index * 5.3)) / Math.max(capped, 1);
        const edge = edgeAtTurn(table, turn);
        if (edge)
            anchors.set(edge, index * 4);
    }
}

export function fillEdgeTrail(anchors, target, heads, samples, now, speed, spacing)
{
    anchors.fill(-9);
    const table = edgeTableFor(target);
    if (!table)
        return;

    const cap = anchors.length / 4;
    const headCount = Math.max(1, Math.round(heads));
    const sampleCount = Math.max(1, Math.round(samples));
    for (let head = 0; head < headCount; head++)
    {
        for (let sample = 0; sample < sampleCount; sample++)
        {
            const index = head * sampleCount + sample;
            if (index >= cap)
                return;
            const edge = edgeAtTurn(table, now * speed + head / headCount - sample * spacing);
            if (edge)
                anchors.set(edge, index * 4);
        }
    }
}

// Inlined from TokenMagic's CustomFilter.apply() for stable vFilterCoord + self-driven time.
export function applyCustomFilter(filter, filterManager, input, output, clear)
{
    const now = performance.now();
    const dt = (now - filter._lastTime) / 1000;
    filter._lastTime = now;
    filter.uniforms.time = animationsOff() ? STILL_SECONDS * filter._timeSpeed : filter.uniforms.time + dt * filter._timeSpeed;

    const filterMatrix = filter.uniforms.filterMatrix;

    if (filterMatrix)
    {
        const { sourceFrame, destinationFrame, target } = filterManager.activeState;

        filterMatrix.set(
            destinationFrame.width, 0, 0, destinationFrame.height,
            sourceFrame.x, sourceFrame.y
        );

        const worldTransform = PIXI.Matrix.TEMP_MATRIX;
        const localBounds = target.getLocalBounds(_tempRect);
        const padFactor = filter.spriteCoords ? 0 : 1;
        if (filter.spriteCoords)
            fitArtBounds(target, localBounds);

        if (filter.sticky)
        {
            worldTransform.copyFrom(target.transform.worldTransform);
            worldTransform.invert();

            const rotation = target.transform.rotation;
            const sin = Math.sin(rotation);
            const cos = Math.cos(rotation);

            const scaleX = Math.hypot(
                cos * worldTransform.a + sin * worldTransform.c,
                cos * worldTransform.b + sin * worldTransform.d
            );

            const scaleY = Math.hypot(
                -sin * worldTransform.a + cos * worldTransform.c,
                -sin * worldTransform.b + cos * worldTransform.d
            );

            localBounds.pad(scaleX * filter.boundsPadding.x * padFactor, scaleY * filter.boundsPadding.y * padFactor);
        }
        else
        {
            const transform = target.transform;
            worldTransform.a = transform.scale.x;
            worldTransform.b = 0;
            worldTransform.c = 0;
            worldTransform.d = transform.scale.y;
            worldTransform.tx = transform.position.x - transform.pivot.x * transform.scale.x;
            worldTransform.ty = transform.position.y - transform.pivot.y * transform.scale.y;
            worldTransform.prepend(target.parent.transform.worldTransform);
            worldTransform.invert();

            const scaleX = Math.hypot(worldTransform.a, worldTransform.b);
            const scaleY = Math.hypot(worldTransform.c, worldTransform.d);

            localBounds.pad(scaleX * filter.boundsPadding.x * padFactor, scaleY * filter.boundsPadding.y * padFactor);
        }

        filterMatrix.prepend(worldTransform);
        filterMatrix.translate(-localBounds.x, -localBounds.y);
        filterMatrix.scale(1.0 / localBounds.width, 1.0 / localBounds.height);

        const filterMatrixInverse = filter.uniforms.filterMatrixInverse;

        if (filterMatrixInverse)
        {
            filterMatrixInverse.copyFrom(filterMatrix);
            filterMatrixInverse.invert();
        }
    }

    filterManager.applyFilter(filter, input, output, clear);
}

export class LaCustomFilter extends PIXI.Filter
{
    constructor(fragment, params, uniforms = {}, timeSpeed = 1.0)
    {
        super(customVertex2D, fragment);

        Object.assign(this.uniforms, uniforms);
        this.uniforms.filterMatrix = new PIXI.Matrix();
        this.uniforms.filterMatrixInverse = new PIXI.Matrix();

        Object.assign(this, /** @type {any} */ (this.constructor).defaults);

        this._timeSpeed = params?.timeSpeed ?? timeSpeed;
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

    get opacity()
    {
        return this.uniforms.opacity;
    }
    set opacity(value)
    {
        this.uniforms.opacity = value;
    }
}
