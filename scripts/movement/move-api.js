/* global canvas */

/**
 * Move a token from code through Token.move(); extraOpts pass through as move options.
 * Involuntary by default (no cap consumption); pass `isDrag: true` to consume the cap like a real drag.
 * @param {Token|TokenDocument} tokenLike
 * @param {{x: number, y: number, elevation?: number, action?: string}} destination  Top-left x/y in pixels.
 * @param {Record<string, any>} [extraOpts]  Reserved: method, constrainOptions, autoRotate, showRuler.
 * @returns {Promise<boolean>}
 */
export async function moveTokenTo(tokenLike, destination, extraOpts = {}) {
    if (!tokenLike || !destination)
        return false;
    const tokenDoc = tokenLike.document ?? tokenLike;
    if (!tokenDoc?.move)
        return false;

    const waypoint = {
        x: destination.x,
        y: destination.y,
        elevation: destination.elevation ?? tokenDoc.elevation,
        action: destination.action
    };

    const { method = 'api', constrainOptions, autoRotate, showRuler, ...options } = extraOpts;

    return tokenDoc.move(waypoint, { method, constrainOptions, autoRotate, showRuler, ...options });
}
