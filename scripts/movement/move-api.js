/**
 * Move a token from code through Token.move(); extraOpts pass through as move options.
 * Involuntary by default (no cap consumption); pass `isDrag: true` to consume the cap like a real drag.
 * @param {Token|TokenDocument} tokenLike
 * @param {{x: number, y: number, elevation?: number, action?: string}|Array<object>} destination  Top-left x/y in pixels, or a full waypoint array.
 * @param {Record<string, any>} [extraOpts]  Reserved: method, constrainOptions, autoRotate, showRuler.
 * @returns {Promise<boolean>}
 */
export async function moveTokenTo(tokenLike, destination, extraOpts = {})
{
    if (!tokenLike || !destination)
        return false;
    const tokenDoc = tokenLike.document ?? tokenLike;
    if (!tokenDoc?.move)
        return false;
    if (Array.isArray(destination) && !destination.length)
        return false;

    const waypoint = Array.isArray(destination)
        ? destination.map(pathWp => ({ elevation: tokenDoc.elevation, ...pathWp }))
        : {
            x: destination.x,
            y: destination.y,
            elevation: destination.elevation ?? tokenDoc.elevation,
            action: destination.action
        };

    const { method = 'api', constrainOptions, autoRotate, showRuler, ...options } = extraOpts;

    let dragAutoRotate;
    try
    {
        dragAutoRotate = options.isDrag ? game.settings.get('core', 'tokenAutoRotate') : undefined;
    }
    catch
    {
        dragAutoRotate = undefined;
    }
    return tokenDoc.move(waypoint, {
        method,
        constrainOptions,
        autoRotate: autoRotate ?? dragAutoRotate,
        showRuler: showRuler ?? (options.isDrag ? true : undefined),
        ...options
    });
}

// Wait out a region-split pending remainder before firing the next leg.
export async function awaitMovementSettled(tokenDoc)
{
    for (let attempt = 0; attempt < 240; attempt++)
    {
        const animation = tokenDoc.rendered ? tokenDoc.object?.movementAnimationPromise : null;
        if (animation)
            await animation;
        if (tokenDoc.movement?.state !== 'pending')
            return;
        await new Promise(resolve => setTimeout(resolve, 50));
    }
}
