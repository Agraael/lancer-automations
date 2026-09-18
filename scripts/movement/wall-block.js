import { getExternalSetting } from '../tools/settings-utils.js';

// Wall heights come from the wall-height flags as plain data, so an unflagged wall blocks at every
// elevation whether or not that module is installed.
function wallBand(wall)
{
    const flags = wall.document?.flags?.['wall-height'] ?? {};
    return {
        top: Number.isFinite(flags.top) ? flags.top : Infinity,
        bottom: Number.isFinite(flags.bottom) ? flags.bottom : -Infinity
    };
}

/**
 * Step blocker for one search: a wall stops a step when its segment crosses it and the mover's
 * elevation sits inside the wall's height band. Null when walls do not apply to the search.
 * @param {string} action movement action
 * @returns {((from: {x: number, y: number}, to: {x: number, y: number}, elevation: number) => boolean)|null} elevation in scene units
 */
export function makeWallBlocker(action)
{
    if (game.user?.isGM && getExternalSetting('core', 'unconstrainedMovement', false))
        return null;
    const wallType = CONFIG.Token?.movement?.actions?.[action]?.walls ?? 'move';
    if (!wallType)
        return null;
    const quadtree = canvas.walls?.quadtree;
    if (!quadtree)
        return null;
    const cache = new Map();
    return (from, to, elevation) =>
    {
        const key = `${Math.round(from.x)},${Math.round(from.y)}>${Math.round(to.x)},${Math.round(to.y)}@${elevation}`;
        const cached = cache.get(key);
        if (cached !== undefined)
            return cached;
        const bounds = new PIXI.Rectangle(
            Math.min(from.x, to.x) - 1, Math.min(from.y, to.y) - 1,
            Math.abs(to.x - from.x) + 2, Math.abs(to.y - from.y) + 2);
        let blocked = false;
        for (const wall of quadtree.getObjects(bounds))
        {
            const edge = wall.edge;
            if (!edge || edge[wallType] === CONST.WALL_SENSE_TYPES.NONE || wall.isOpen)
                continue;
            const { top, bottom } = wallBand(wall);
            if (elevation < bottom || elevation > top)
                continue;
            // One-way walls let a mover through from their open side.
            if (edge.direction)
            {
                const side = edge.orientPoint(from);
                if (!side || side === edge.direction)
                    continue;
            }
            if (foundry.utils.lineSegmentIntersects(edge.a, edge.b, from, to))
            {
                blocked = true;
                break;
            }
        }
        cache.set(key, blocked);
        return blocked;
    };
}
