import { isHexGrid, getHexCenter, drawHexAt, getOccupiedOffsets } from "../combat/grid-helpers.js";
import { getHexGroundElevation } from "../combat/terrain-utils.js";
import { TG } from "./canvas-palette.js";
import { addGraphicsBelowTokens, gridLineWidth } from "./canvas-primitives.js";
import { _rulerMove } from "../main.js";
import { broadcastToolPresence, clearToolPresence, startToolHeartbeat } from "./presence.js";
import { movePathLegs } from "./move-waypoints.js";
import { awaitMovementSettled } from "../movement/move-api.js";

// Footprint + polyline trace for a move; broadcasts to other clients unless suppressed.
let _moveTraceSeq = 0;
export function drawMovementTrace(token, originalEndPos, newEndPos = null, { suppressBroadcast = false, path = null, newPath = null } = {})
{
    const trace = new PIXI.Graphics();
    const centerStart = token.center;
    const gridSize = canvas.grid.size;

    // Line follows the real move path when the caller has one; beeline otherwise.
    const polyline = (targetCenter, pathWps) =>
    {
        const points = [{ x: centerStart.x, y: centerStart.y }];
        for (const pathWp of Array.isArray(pathWps) ? pathWps : [])
            points.push({ x: pathWp.x + token.w / 2, y: pathWp.y + token.h / 2 });
        const last = points.at(-1);
        if (Math.round(last.x) !== Math.round(targetCenter.x) || Math.round(last.y) !== Math.round(targetCenter.y))
            points.push(targetCenter);
        return points;
    };
    const drawPolyline = (points) =>
    {
        trace.moveTo(points[0].x, points[0].y);
        for (let pointIdx = 1; pointIdx < points.length; pointIdx++)
            trace.lineTo(points[pointIdx].x, points[pointIdx].y);
    };

    const drawFootprint = (targetX, targetY, lineColor, fillColor) =>
    {
        trace.lineStyle(gridLineWidth(3), lineColor, 0.8);
        trace.beginFill(fillColor, 0.3);
        const offsets = getOccupiedOffsets(token, { x: targetX, y: targetY });
        for (const cellOffset of offsets)
        {
            if (isHexGrid())
                drawHexAt(trace, cellOffset.col, cellOffset.row);
            else
            {
                const cellCenter = getHexCenter(cellOffset.col, cellOffset.row);
                trace.drawRect(cellCenter.x - gridSize / 2, cellCenter.y - gridSize / 2, gridSize, gridSize);
            }
        }
        trace.endFill();
    };

    drawFootprint(token.document.x, token.document.y, TG.traceStart, TG.traceStart);

    const originalColor = newEndPos ? 0xff0000 : TG.traceEnd;
    const centerOriginal = { x: originalEndPos.x + token.w/2, y: originalEndPos.y + token.h/2 };
    drawFootprint(originalEndPos.x, originalEndPos.y, originalColor, originalColor);

    const originalPoints = polyline(centerOriginal, path);
    trace.lineStyle(gridLineWidth(4), TG.traceLine, 0.5);
    drawPolyline(originalPoints);

    let newPoints = null;
    if (newEndPos)
    {
        const centerNew = { x: newEndPos.x + token.w/2, y: newEndPos.y + token.h/2 };
        drawFootprint(newEndPos.x, newEndPos.y, TG.traceEnd, TG.traceEnd);

        newPoints = polyline(centerNew, newPath);
        trace.lineStyle(gridLineWidth(4), TG.traceLine, 1);
        drawPolyline(newPoints);
    }

    addGraphicsBelowTokens(trace);

    // Mirror the trace to other clients (relay sites pass suppressBroadcast so only the origin broadcasts).
    if (!suppressBroadcast)
    {
        const kind = `moveTrace:${token.id}:${++_moveTraceSeq}`;
        const startCells = getOccupiedOffsets(token).map(offset => `${offset.col},${offset.row}`);
        const origCells = getOccupiedOffsets(token, { x: originalEndPos.x, y: originalEndPos.y }).map(offset => `${offset.col},${offset.row}`);
        const newCells = newEndPos ? getOccupiedOffsets(token, { x: newEndPos.x, y: newEndPos.y }).map(offset => `${offset.col},${offset.row}`) : [];
        const traceLines = [];
        for (let pointIdx = 1; pointIdx < originalPoints.length; pointIdx++)
            traceLines.push({ x1: originalPoints[pointIdx - 1].x, y1: originalPoints[pointIdx - 1].y, x2: originalPoints[pointIdx].x, y2: originalPoints[pointIdx].y });
        for (let pointIdx = 1; pointIdx < (newPoints?.length ?? 0); pointIdx++)
            traceLines.push({ x1: newPoints[pointIdx - 1].x, y1: newPoints[pointIdx - 1].y, x2: newPoints[pointIdx].x, y2: newPoints[pointIdx].y });
        const tracePresence = {
            originCells: startCells,
            cells: origCells,
            cellColor: originalColor,
            placedCells: newCells,
            placedColor: TG.traceEnd,
            originColor: TG.traceStart,
            lines: traceLines,
            lineColor: TG.traceLine,
            relatedToken: token,
        };
        broadcastToolPresence(kind, tracePresence);
        let destroyed = false; // guard a heartbeat tick that fires after destroy
        const stopTraceBeat = startToolHeartbeat(kind, () => destroyed ? null : tracePresence);
        const origDestroy = trace.destroy.bind(trace);
        trace.destroy = (...args) =>
        {
            destroyed = true;
            stopTraceBeat();
            clearToolPresence(kind);
            return origDestroy(...args);
        };
    }

    return trace;
}

/**
 * Trim the token's native movement history so a cancelled drag doesn't leave a phantom waypoint.
 * Called from preUpdateToken / triggered-cancel paths.
 * @param {Token} token
 * @param {object|null} _moveInfo
 */
export function cancelRulerDrag(token, _moveInfo = null)
{
    const doc = token?.document;
    const history = doc?._source?._movementHistory;
    if (!Array.isArray(history) || history.length === 0)
        return;
    const currentX = doc.x, currentY = doc.y;
    let lastValidIdx = -1;
    for (let idx = history.length - 1; idx >= 0; idx--)
    {
        const waypoint = history[idx];
        if (Math.abs((waypoint.x ?? 0) - currentX) < 2 && Math.abs((waypoint.y ?? 0) - currentY) < 2)
        {
            lastValidIdx = idx; break;
        }
    }
    if (lastValidIdx === history.length - 1)
        return;
    const trimmed = history.slice(0, lastValidIdx + 1);
    try
    {
        doc.update({ _movementHistory: trimmed }, { diff: false });
    }
    catch (e)
    {
        console.warn('lancer-automations | cancelRulerDrag trim failed', e);
    }
}

/**
 * Apply pre-resolved knockback moves.
 * Used by knockBackToken (after the destination picker resolves) and the socket handler.
 * @param {Array<{tokenId: string, updateData: {x: number, y: number, elevation?: number, waypoints?: Array<object>}}>} moveList - Per-token resolved destinations.
 * @param {Token|null} triggeringToken - Token that caused the knockback, passed as `sourceToken` to the involuntary move triggers.
 * @param {number} distance - Max knockback distance in grid units.
 * @param {string} [actionName=""] - Name of the action that produced the knockback.
 * @param {Item} [item=null] - Source item, if any.
 * @param {Object} [options]
 * @param {boolean} [options.asVoluntary=false] - If true, skip the `action: 'forced'` move flag, so no
 *   involuntary move trigger fires (treat the displacement as a voluntary move).
 * @param {boolean} [options.setElevation=false] - If true (and Terrain Height Tools is active), snap each
 *   token to the max solid-terrain height under its destination footprint. Off by default.
 * @returns {Promise<void>}
 */
export async function applyKnockbackMoves(moveList, triggeringToken, distance, actionName = "", item = null, options = {})
{
    const asVoluntary = !!options.asVoluntary;
    const setElevation = !!options.setElevation;

    const extraOpts = {
        ignoreMovementCap: true,
        _skipBoostOffer: true,
        useRuler: true,
        constrainOptions: { ignoreWalls: true, ignoreCost: true },
        lancerInvoluntarySourceId: triggeringToken?.id ?? null,
        lancerInvoluntaryActionName: actionName,
        lancerInvoluntaryItemUuid: item?.uuid ?? null,
        ...(asVoluntary ? { isDrag: true, lancerFreeMovement: true } : {})
    };

    const terrainAPI = globalThis.terrainHeightTools;

    // Sequential: ER.moveTokenTo uses the singleton canvas.controls.ruler; parallel runs corrupt it.
    for (const { tokenId, updateData } of moveList)
    {
        const token = canvas.tokens.get(tokenId);
        if (!token)
            continue;

        const dest = { x: updateData.x, y: updateData.y };
        if (!asVoluntary)
            dest.action = 'forced';
        if (typeof updateData.elevation === 'number')
            dest.elevation = updateData.elevation; // chosen in the picker (auto-ground + Q/E offset)
        else if (setElevation && terrainAPI)
        {
            let maxHeight = 0;
            for (const cellOffset of getOccupiedOffsets(token, dest))
            {
                const cellHeight = getHexGroundElevation(cellOffset.col, cellOffset.row, terrainAPI);
                if (cellHeight > maxHeight)
                    maxHeight = cellHeight;
            }
            dest.elevation = maxHeight;
        }
        const legs = movePathLegs(updateData.waypoints, dest).map(leg => ({
            snapped: true,
            explicit: true,
            checkpoint: true,
            ...leg,
            ...((!asVoluntary && !leg.action) ? { action: 'forced' } : {})
        }));
        if (!asVoluntary)
            Hooks.callAll('lancer-automations.battelog.knockbackSource', { tokenId: token.id, sourceId: triggeringToken?.id });
        await _rulerMove(token, legs.length === 1 ? legs[0] : legs, extraOpts);
        await awaitMovementSettled(token.document);
    }
}
