import {
    getHexCenter, pixelToOffset,
    getOccupiedOffsets,
    getDistanceTokenToPoint,
} from "../../combat/grid-helpers.js";
import { getHexGroundElevation } from "../../combat/terrain-utils.js";
import { isPhasing } from "../../movement/cost-rules.js";
import { movePathLegs } from "../move-waypoints.js";
import { awaitMovementSettled } from "../../movement/move-api.js";
import { moveTokenRuler } from "./moveTokenRuler.js";

/**
 * Move a token to a destination, bypassing normal movement rules (like knockback).
 * If no destination is provided, opens the drag-ruler picker (moveTokenRuler).
 * Records movement in lancer-automations history.
 * @param {Token} token - The token to move
 * @param {Object} [options={}]
 * @param {{x: number, y: number}} [options.destination] - Destination center point. If omitted, interactive mode.
 * @param {number} [options.cost] - Override movement cost (default: actual grid distance)
 * @param {boolean} [options.teleport=false] - If true, moves as teleport ("blink" action)
 * @param {string} [options.action] - Movement action key from CONFIG.Token.movement.actions ("fly", "walk", "blink", ...). Animates the move with that type; forced (ignores walls/cost). Takes precedence over teleport.
 * @param {number} [options.range=-1] - Max range in grid units (-1 = unlimited)
 * @param {boolean} [options.canBeBlocked=false] - Direct mode: stop the move before blocking token bodies
 * @param {string} [options.title] - Card title (default: "TELEPORT" or "MOVE")
 * @param {string} [options.description="Select destination."] - Card description
 * @returns {Promise<TokenDocument|null>} Updated doc, or null if cancelled
 */
export async function moveToken(token, options = {})
{
    if (Array.isArray(token) && !options.destination)
        return moveTokenRuler(token, /** @type {any} */ (options));
    if (!token?.document)
        return null;

    if (!options.destination)
    {
        return moveTokenRuler(token, {
            range: options.range ?? -1,
            cost: options.cost,
            free: /** @type {any} */ (options).free,
            urgent: /** @type {any} */ (options).urgent,
            action: options.action ?? (options.teleport ? 'blink' : null),
            title: options.title ?? (options.teleport ? "TELEPORT" : "MOVE"),
            description: options.description ?? "Select destination.",
            icon: /** @type {any} */ (options).icon,
            headerClass: /** @type {any} */ (options).headerClass
        });
    }

    const center = canvas.grid.getCenterPoint(options.destination);
    let destTopLeft = token.getSnappedPosition({ x: center.x - token.w / 2, y: center.y - token.h / 2 });

    // Path collision check: stop before blocking tokens
    if (options.canBeBlocked && !isPhasing(token.document))
    {
        const startCenterCheck = token.getCenterPoint({ x: token.document.x, y: token.document.y });
        const endCenterCheck = token.getCenterPoint(destTopLeft);
        const ray = new Ray(startCenterCheck, endCenterCheck);
        if (ray.distance > 0)
        {
            const movingIsIntangible = !!token.actor?.statuses?.has('intangible');
            const selfOffsets = getOccupiedOffsets(token);
            const selfKeys = new Set(selfOffsets.map(cellOffset => `${cellOffset.col},${cellOffset.row}`));

            const sampleCount = Math.max(Math.ceil(ray.distance / Math.min(canvas.grid.sizeX, canvas.grid.sizeY)), 1);
            const pathOffsets = [];
            const seenKeys = new Set();
            for (let sampleIdx = 0; sampleIdx <= sampleCount; sampleIdx++)
            {
                const samplePoint = ray.project(sampleIdx / sampleCount);
                const sampleOffset = pixelToOffset(samplePoint.x, samplePoint.y);
                const key = `${sampleOffset.col},${sampleOffset.row}`;
                if (!seenKeys.has(key) && !selfKeys.has(key))
                {
                    seenKeys.add(key);
                    pathOffsets.push(sampleOffset);
                }
            }

            const allTokens = canvas.tokens.placeables.filter(other => other.id !== token.id && other.actor);
            for (let pathIdx = 0; pathIdx < pathOffsets.length; pathIdx++)
            {
                const sampleOffset = pathOffsets[pathIdx];
                const blocked = allTokens.find(other =>
                {
                    const otherIsIntangible = !!other.actor?.statuses?.has('intangible');
                    if (movingIsIntangible !== otherIsIntangible)
                        return false;
                    const otherOffsets = getOccupiedOffsets(other);
                    return otherOffsets.some(otherOffset => otherOffset.col === sampleOffset.col && otherOffset.row === sampleOffset.row);
                });
                if (blocked)
                {
                    ui.notifications.warn(`Movement blocked by ${blocked.name}.`);
                    if (pathIdx === 0)
                        return null;
                    const lastFreeOffset = pathOffsets[pathIdx - 1];
                    const lastFreeCenter = getHexCenter(lastFreeOffset.col, lastFreeOffset.row);
                    destTopLeft = token.getSnappedPosition({
                        x: lastFreeCenter.x - token.w / 2,
                        y: lastFreeCenter.y - token.h / 2
                    });
                    break;
                }
            }
        }
    }

    const endCenter = token.getCenterPoint(destTopLeft);
    const moveCost = options.cost ?? getDistanceTokenToPoint(endCenter, token);

    // Direct mode has no picker-resolved elevation; fall back to the terrain under the destination.
    const updateData = { ...destTopLeft };
    if (typeof destTopLeft.elevation !== 'number')
    {
        const terrainAPI = globalThis.terrainHeightTools;
        if (terrainAPI)
        {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(token, destTopLeft))
            {
                const groundHeight = getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI);
                if (groundHeight > maxHeight)
                    maxHeight = groundHeight;
            }
            updateData.elevation = maxHeight;
        }
    }

    const moveFlags = {
        isDrag: true,
        rulerSegment: false,
        firstRulerSegment: true,
        lastRulerSegment: true,
        lancerSegmentCost: moveCost,
        lancerSegmentDistance: moveCost,
        lancerTerrainPenalty: 0
    };
    const action = options.action ?? (options.teleport ? 'blink' : null);
    if (action)
    {
        const actions = /** @type {any} */ (globalThis).CONFIG?.Token?.movement?.actions ?? {};
        if (!actions[action])
            console.warn(`lancer-automations | moveToken: unknown movement action "${action}", core falls back to displace.`);
        moveFlags.teleport = !!actions[action]?.teleport;
        const legs = movePathLegs(null, { ...updateData, action });
        for (let legIdx = 0; legIdx < legs.length; legIdx++)
        {
            const isLast = legIdx === legs.length - 1;
            await token.document.move({ ...legs[legIdx], action }, {
                ...moveFlags,
                lancerSegmentCost: isLast ? moveCost : 0,
                lancerSegmentDistance: isLast ? moveCost : 0,
                constrainOptions: { ignoreWalls: true, ignoreCost: true },
                autoRotate: false,
                showRuler: false
            });
            await awaitMovementSettled(token.document);
        }
        return token.document;
    }
    const doc = await token.document.update(updateData, moveFlags);
    return doc;
}
