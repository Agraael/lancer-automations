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

// Compass bearing in degrees to the unit vector the shaders read as dirV.
export function setDirVFromDegrees(uniforms, degrees)
{
    const radians = (degrees * Math.PI) / 180;
    uniforms.dirV[0] = -Math.sin(radians);
    uniforms.dirV[1] = Math.cos(radians);
}

const _tempRect = new PIXI.Rectangle();

// Inlined from TokenMagic's CustomFilter.apply() for stable vFilterCoord + self-driven time.
export function applyCustomFilter(filter, filterManager, input, output, clear)
{
    const now = performance.now();
    const dt = (now - filter._lastTime) / 1000;
    filter._lastTime = now;
    filter.uniforms.time += dt * filter._timeSpeed;

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

            localBounds.pad(scaleX * filter.boundsPadding.x, scaleY * filter.boundsPadding.y);
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

            localBounds.pad(scaleX * filter.boundsPadding.x, scaleY * filter.boundsPadding.y);
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
